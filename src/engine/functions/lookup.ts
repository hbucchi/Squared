/** Lookup & reference functions. */
import { ERR, isErr } from '../errors';
import { RangeValue, compare, round15, scalar, type Scalar, type Value } from '../values';
import { argc, asRange, define, hasWild, int, optBool, optNum, wildcard, type FunctionDef, type Test } from './helpers';

/** Exact-match test for lookups: case-insensitive, with wildcards for text. */
function matcher(key: Scalar): Test {
  if (typeof key === 'string') {
    if (hasWild(key)) {
      const re = wildcard(key);
      return (v) => typeof v === 'string' && re.test(v);
    }
    const k = key.toLowerCase();
    return (v) => typeof v === 'string' && v.toLowerCase() === k;
  }
  if (typeof key === 'number') return (v) => typeof v === 'number' && round15(v) === round15(key);
  return (v) => v === key;
}

/**
 * Approximate match in sorted data: the last item <= key (or >= key when
 * descending). A linear scan; a binary search would be O(log n) but would
 * differ from Excel on unsorted data.
 */
function approx(list: Scalar[], key: Scalar, desc: boolean): number {
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (v === null || isErr(v) || typeof v !== typeof key) continue;
    const c = compare(v, key);
    if (desc ? c >= 0 : c <= 0) best = i;
    else break;
  }
  return best;
}

function lookupKey(v: Value): Scalar {
  const k = scalar(v);
  if (isErr(k)) throw k;
  return k === null ? 0 : k;
}

function vhlookup(a: Value[], vertical: boolean): Scalar {
  argc(a, 3, 4);
  const key = lookupKey(a[0]);
  const t = asRange(a[1]);
  const idx = int(a[2]);
  const isApprox = optBool(a, 3, true);
  if (idx < 1) throw ERR.VALUE;
  if (idx > (vertical ? t.width : t.height)) throw ERR.REF;
  const list = vertical ? t.values.map((r) => r[0]) : t.values[0] ?? [];
  const i = isApprox ? approx(list, key, false) : list.findIndex(matcher(key));
  if (i < 0) throw ERR.NA;
  return vertical ? t.values[i][idx - 1] : t.values[idx - 1][i];
}

/** A one-row or one-column range as a flat list. */
function vector(rg: RangeValue): Scalar[] {
  if (rg.height === 1) return rg.values[0] ?? [];
  if (rg.width === 1) return rg.values.map((r) => r[0]);
  throw ERR.NA;
}

export const lookupFunctions: FunctionDef[] = [
  define('VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])', (a) => vhlookup(a, true)),
  define('HLOOKUP(lookup_value, table_array, row_index_num, [range_lookup])', (a) => vhlookup(a, false)),
  define('MATCH(lookup_value, lookup_array, [match_type])', (a) => {
    argc(a, 2, 3);
    const key = lookupKey(a[0]);
    const list = vector(asRange(a[1]));
    const type = Math.trunc(optNum(a, 2, 1));
    const i = type === 0 ? list.findIndex(matcher(key)) : approx(list, key, type < 0);
    if (i < 0) throw ERR.NA;
    return i + 1;
  }),
  define('INDEX(array, row_num, [column_num])', (a) => {
    argc(a, 2, 3);
    const rg = asRange(a[0]);
    let r = Math.trunc(optNum(a, 1, 0));
    let c = Math.trunc(optNum(a, 2, 0));
    if (a.length < 3 && rg.height === 1 && rg.width > 1) {
      c = r;
      r = 1;
    }
    if (r < 0 || c < 0 || r > rg.height || c > rg.width) throw ERR.REF;
    if (rg.width === 1 && c === 0) c = 1;
    if (r === 0 && c === 0) return rg;
    if (r === 0) return new RangeValue(rg.values.map((row) => [row[c - 1]]), rg.sheet, rg.r, (rg.c ?? 0) + c - 1);
    if (c === 0) return new RangeValue([rg.values[r - 1]], rg.sheet, (rg.r ?? 0) + r - 1, rg.c);
    return rg.values[r - 1][c - 1];
  }),
  define('XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode])', (a) => {
    argc(a, 3, 5);
    const key = lookupKey(a[0]);
    const look = asRange(a[1]);
    const ret = asRange(a[2]);
    const list = vector(look);
    const mode = Math.trunc(optNum(a, 4, 0));
    let i = list.findIndex(matcher(key));
    if (i < 0 && mode !== 0) {
      // -1: exact or next smaller; 1: exact or next larger.
      let best = -1;
      list.forEach((v, j) => {
        if (v === null || isErr(v) || typeof v !== typeof key) return;
        const c = compare(v, key);
        if (mode < 0 && c < 0 && (best < 0 || compare(v, list[best]) > 0)) best = j;
        if (mode > 0 && c > 0 && (best < 0 || compare(v, list[best]) < 0)) best = j;
      });
      i = best;
    }
    if (i < 0) {
      if (a.length > 3) return a[3];
      throw ERR.NA;
    }
    if (look.width === 1) {
      if (ret.height !== look.height) throw ERR.VALUE;
      return ret.width === 1 ? ret.values[i][0] : new RangeValue([ret.values[i]], ret.sheet, (ret.r ?? 0) + i, ret.c);
    }
    if (ret.width !== look.width) throw ERR.VALUE;
    return ret.height === 1 ? ret.values[0][i] : new RangeValue(ret.values.map((r) => [r[i]]), ret.sheet, ret.r, (ret.c ?? 0) + i);
  }),
  define('CHOOSE(index_num, value1, [value2], ...)', (a) => {
    argc(a, 2);
    const i = int(a[0]);
    if (i < 1 || i >= a.length) throw ERR.VALUE;
    return a[i];
  }),
  define('ROWS(array)', (a) => {
    argc(a, 1, 1);
    return asRange(a[0]).height;
  }),
  define('COLUMNS(array)', (a) => {
    argc(a, 1, 1);
    return asRange(a[0]).width;
  }),
  define('ROW([reference])', (a, ctx) => {
    if (!a.length) return ctx.row + 1;
    const rg = a[0];
    if (!(rg instanceof RangeValue) || rg.r === undefined) throw ERR.VALUE;
    return rg.r + 1;
  }),
  define('COLUMN([reference])', (a, ctx) => {
    if (!a.length) return ctx.col + 1;
    const rg = a[0];
    if (!(rg instanceof RangeValue) || rg.c === undefined) throw ERR.VALUE;
    return rg.c + 1;
  }),
];
