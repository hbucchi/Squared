/** Math, statistics and conditional aggregation. */
import { ERR, isErr } from '../errors';
import { RangeValue, checkNum, round15, toNum, type Value } from '../values';
import {
  argc, asRange, define, has, ifsMatches, int, numbers, numsAt, optNum, pairsFrom, roundTo, sameShape, sum, type FunctionDef,
} from './helpers';

const maxOf = (n: number[]): number => (n.length ? n.reduce((x, y) => Math.max(x, y)) : 0);
const minOf = (n: number[]): number => (n.length ? n.reduce((x, y) => Math.min(x, y)) : 0);
function mean(n: number[]): number {
  if (!n.length) throw ERR.DIV0;
  return sum(n) / n.length;
}
function variance(a: Value[], sample: boolean): number {
  const n = numbers(a);
  if (n.length < (sample ? 2 : 1)) throw ERR.DIV0;
  const m = sum(n) / n.length;
  return n.reduce((s, x) => s + (x - m) * (x - m), 0) / (n.length - (sample ? 1 : 0));
}
function kth(a: Value[], largest: boolean): number {
  argc(a, 2, 2);
  const n = numbers([a[0]]).sort((x, y) => (largest ? y - x : x - y));
  const k = int(a[1]);
  if (k < 1 || k > n.length) throw ERR.NUM;
  return n[k - 1];
}
function rank(a: Value[]): number {
  argc(a, 2, 3);
  const x = toNum(a[0]);
  const n = numbers([a[1]]);
  const asc = optNum(a, 2, 0) !== 0;
  if (!n.some((v) => round15(v) === round15(x))) throw ERR.NA;
  return 1 + n.filter((v) => (asc ? v < x : v > x)).length;
}
const round = (mode: 'half' | 'up' | 'down') => (a: Value[]): number => {
  argc(a, 1, 2);
  return roundTo(toNum(a[0]), Math.trunc(optNum(a, 1, 0)), mode);
};
const one = (f: (x: number) => number) => (a: Value[]): number => {
  argc(a, 1, 1);
  return f(toNum(a[0]));
};

export const mathFunctions: FunctionDef[] = [
  define('SUM(number1, [number2], ...)', (a) => sum(numbers(a))),
  define('AVERAGE(number1, [number2], ...)', (a) => mean(numbers(a))),
  define('MIN(number1, [number2], ...)', (a) => minOf(numbers(a))),
  define('MAX(number1, [number2], ...)', (a) => maxOf(numbers(a))),
  define('COUNT(value1, [value2], ...)', (a) => {
    let n = 0;
    for (const x of a) {
      if (x instanceof RangeValue) n += x.values.flat().filter((v) => typeof v === 'number').length;
      else if (typeof x === 'number' || typeof x === 'boolean') n++;
      else if (typeof x === 'string' && toNumOrNull(x) !== null) n++;
    }
    return n;
  }),
  define('COUNTA(value1, [value2], ...)', (a) => {
    let n = 0;
    for (const x of a) {
      if (x instanceof RangeValue) n += x.values.flat().filter((v) => v !== null).length;
      else if (x !== null) n++;
    }
    return n;
  }),
  define('COUNTBLANK(range)', (a) => asRange(a[0]).values.flat().filter((v) => v === null || v === '').length),
  define('PRODUCT(number1, [number2], ...)', (a) => {
    const n = numbers(a);
    return n.length ? n.reduce((x, y) => x * y, 1) : 0;
  }),
  define('MEDIAN(number1, [number2], ...)', (a) => {
    const n = numbers(a).sort((x, y) => x - y);
    if (!n.length) throw ERR.NUM;
    const h = Math.floor(n.length / 2);
    return n.length % 2 ? n[h] : (n[h - 1] + n[h]) / 2;
  }),
  define('VAR(number1, [number2], ...)', (a) => variance(a, true)),
  define('VAR.S(number1, [number2], ...)', (a) => variance(a, true)),
  define('VAR.P(number1, [number2], ...)', (a) => variance(a, false)),
  define('STDEV(number1, [number2], ...)', (a) => Math.sqrt(variance(a, true))),
  define('STDEV.S(number1, [number2], ...)', (a) => Math.sqrt(variance(a, true))),
  define('STDEV.P(number1, [number2], ...)', (a) => Math.sqrt(variance(a, false))),
  define('LARGE(array, k)', (a) => kth(a, true)),
  define('SMALL(array, k)', (a) => kth(a, false)),
  define('RANK(number, ref, [order])', rank),
  define('RANK.EQ(number, ref, [order])', rank),

  define('ABS(number)', one(Math.abs)),
  define('SQRT(number)', one((x) => {
    if (x < 0) throw ERR.NUM;
    return Math.sqrt(x);
  })),
  define('POWER(number, power)', (a) => {
    argc(a, 2, 2);
    const x = toNum(a[0]);
    const y = toNum(a[1]);
    if (x === 0 && y < 0) throw ERR.DIV0;
    return checkNum(Math.pow(x, y));
  }),
  define('MOD(number, divisor)', (a) => {
    argc(a, 2, 2);
    const n = toNum(a[0]);
    const d = toNum(a[1]);
    if (d === 0) throw ERR.DIV0;
    return round15(n - d * Math.floor(n / d));
  }),
  define('INT(number)', one(Math.floor)),
  define('TRUNC(number, [num_digits])', round('down')),
  define('ROUND(number, num_digits)', round('half')),
  define('ROUNDUP(number, num_digits)', round('up')),
  define('ROUNDDOWN(number, num_digits)', round('down')),
  define('CEILING(number, [significance])', (a) => {
    argc(a, 1, 2);
    const x = toNum(a[0]);
    const s = optNum(a, 1, 1);
    if (s === 0) return 0;
    return round15(Math.ceil(round15(x / s)) * s);
  }),
  define('FLOOR(number, [significance])', (a) => {
    argc(a, 1, 2);
    const x = toNum(a[0]);
    const s = optNum(a, 1, 1);
    if (s === 0) throw ERR.DIV0;
    return round15(Math.floor(round15(x / s)) * s);
  }),
  define('EXP(number)', one((x) => checkNum(Math.exp(x)))),
  define('LN(number)', one((x) => {
    if (x <= 0) throw ERR.NUM;
    return Math.log(x);
  })),
  define('LOG10(number)', one((x) => {
    if (x <= 0) throw ERR.NUM;
    return Math.log10(x);
  })),
  define('LOG(number, [base])', (a) => {
    argc(a, 1, 2);
    const x = toNum(a[0]);
    const b = optNum(a, 1, 10);
    if (x <= 0 || b <= 0) throw ERR.NUM;
    if (b === 1) throw ERR.DIV0;
    return round15(Math.log(x) / Math.log(b));
  }),
  define('PI()', () => Math.PI),
  define('SIGN(number)', one(Math.sign)),
  define('RAND()', () => Math.random()),
  define('RANDBETWEEN(bottom, top)', (a) => {
    argc(a, 2, 2);
    const lo = Math.ceil(toNum(a[0]));
    const hi = Math.floor(toNum(a[1]));
    if (lo > hi) throw ERR.NUM;
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }),
  define('SUMPRODUCT(array1, [array2], ...)', (a) => {
    argc(a, 1);
    const rs = a.map(asRange);
    const h = rs[0].height;
    const w = rs[0].width;
    if (rs.some((r) => r.height !== h || r.width !== w)) throw ERR.VALUE;
    let s = 0;
    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++) {
        let p = 1;
        for (const r of rs) {
          const v = r.values[i][j];
          if (isErr(v)) throw v;
          p *= typeof v === 'number' ? v : 0;
        }
        s += p;
      }
    }
    return s;
  }),

  define('SUMIF(range, criteria, [sum_range])', (a) => {
    argc(a, 2, 3);
    const rg = asRange(a[0]);
    return sum(numsAt(has(a, 2) ? asRange(a[2]) : rg, ifsMatches([[rg, a[1]]])));
  }),
  define('COUNTIF(range, criteria)', (a) => {
    argc(a, 2, 2);
    return ifsMatches([[a[0], a[1]]]).length;
  }),
  define('AVERAGEIF(range, criteria, [average_range])', (a) => {
    argc(a, 2, 3);
    const rg = asRange(a[0]);
    return mean(numsAt(has(a, 2) ? asRange(a[2]) : rg, ifsMatches([[rg, a[1]]])));
  }),
  define('SUMIFS(sum_range, criteria_range1, criteria1, ...)', (a) => sum(numsAt(sameShape(a[0], a[1]), ifsMatches(pairsFrom(a, 1))))),
  define('COUNTIFS(criteria_range1, criteria1, ...)', (a) => ifsMatches(pairsFrom(a, 0)).length),
  define('AVERAGEIFS(average_range, criteria_range1, criteria1, ...)', (a) => mean(numsAt(sameShape(a[0], a[1]), ifsMatches(pairsFrom(a, 1))))),
  define('MAXIFS(max_range, criteria_range1, criteria1, ...)', (a) => maxOf(numsAt(sameShape(a[0], a[1]), ifsMatches(pairsFrom(a, 1))))),
  define('MINIFS(min_range, criteria_range1, criteria1, ...)', (a) => minOf(numsAt(sameShape(a[0], a[1]), ifsMatches(pairsFrom(a, 1))))),
];

function toNumOrNull(s: string): number | null {
  try {
    return toNum(s);
  } catch {
    return null;
  }
}
