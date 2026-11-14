/**
 * Cell values and the coercion rules between them.
 *
 * A cell value is a number, string, boolean, null (empty) or an error.
 * A reference to several cells evaluates to a RangeValue (a 2-D array).
 */
import { ERR, FormulaError, isErr } from './errors';
import { parseNumberLike } from './input';

export type Scalar = number | string | boolean | null | FormulaError;
export type Value = Scalar | RangeValue;

export class RangeValue {
  constructor(
    readonly values: Scalar[][],
    /** Where the range came from, when it came from the sheet (for ROW()/COLUMN()). */
    readonly sheet?: string,
    readonly r?: number,
    readonly c?: number,
  ) {}
  get height(): number {
    return this.values.length;
  }
  get width(): number {
    return this.values.length ? this.values[0].length : 0;
  }
}

/**
 * Doubles carry ~15.95 significant decimal digits; rounding to 15 hides
 * binary noise such as 0.1 + 0.2 = 0.30000000000000004.
 */
export const round15 = (x: number): number => (x === 0 ? 0 : parseFloat(x.toPrecision(15)));

/** A 1×1 range is a single value; a bigger one can't be used where one value is needed. */
export function scalar(v: Value): Scalar {
  if (v instanceof RangeValue) {
    if (v.height === 1 && v.width === 1) return v.values[0][0];
    throw ERR.VALUE;
  }
  return v;
}

export function toNum(v: Value): number {
  const s = scalar(v);
  if (s === null || s === undefined) return 0;
  if (typeof s === 'number') return s;
  if (typeof s === 'boolean') return s ? 1 : 0;
  if (isErr(s)) throw s;
  if (s.trim() === '') throw ERR.VALUE;
  const p = parseNumberLike(s);
  if (p) return p.value;
  throw ERR.VALUE;
}

export function numToText(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n);
  return String(round15(n)).replace('e', 'E');
}

export function toStr(v: Value): string {
  const s = scalar(v);
  if (s === null || s === undefined) return '';
  if (isErr(s)) throw s;
  if (typeof s === 'boolean') return s ? 'TRUE' : 'FALSE';
  if (typeof s === 'number') return numToText(s);
  return s;
}

export function toBool(v: Value): boolean {
  const s = scalar(v);
  if (s === null || s === undefined) return false;
  if (isErr(s)) throw s;
  if (typeof s === 'boolean') return s;
  if (typeof s === 'number') return s !== 0;
  const u = s.toUpperCase();
  if (u === 'TRUE') return true;
  if (u === 'FALSE') return false;
  throw ERR.VALUE;
}

/** Excel's sort order across types: numbers < text < booleans. */
const typeRank = (v: Scalar): number =>
  typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : typeof v === 'boolean' ? 3 : 0;

/** Three-way comparison (-1, 0, 1). Text compares case-insensitively. */
export function compare(av: Value, bv: Value): number {
  let a = scalar(av);
  let b = scalar(bv);
  if (isErr(a)) throw a;
  if (isErr(b)) throw b;
  const blankFor = (o: Scalar): Scalar => (typeof o === 'string' ? '' : typeof o === 'boolean' ? false : 0);
  if (a === null) a = b === null ? 0 : blankFor(b);
  if (b === null) b = blankFor(a);
  const ta = typeRank(a);
  const tb = typeRank(b);
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (typeof a === 'number' && typeof b === 'number') {
    const x = round15(a);
    const y = round15(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return a === b ? 0 : a ? 1 : -1;
}

/** Infinity and NaN are not valid spreadsheet numbers. */
export function checkNum(x: number): number {
  if (!Number.isFinite(x)) throw ERR.NUM;
  return x;
}
