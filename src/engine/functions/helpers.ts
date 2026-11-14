/** Shared building blocks for the function library. */
import { ERR, FormulaError, isErr } from '../errors';
import type { EvalContext } from '../evaluator';
import { parseNumberLike } from '../input';
import { RangeValue, compare, round15, scalar, toBool, toNum, type Scalar, type Value } from '../values';

export type FormulaFunction = (args: Value[], ctx: EvalContext) => Value;

export interface FunctionDef {
  name: string;
  /** Shown as the argument hint, e.g. "ROUND(number, num_digits)". */
  sig: string;
  fn: FormulaFunction;
}

/** The function's name is taken from its signature, so the two can't disagree. */
export const define = (sig: string, fn: FormulaFunction): FunctionDef => ({ name: sig.slice(0, sig.indexOf('(')), sig, fn });

export function argc(a: Value[], min: number, max?: number): void {
  if (a.length < min || (max !== undefined && a.length > max)) throw ERR.VALUE;
}
export const has = (a: Value[], i: number): boolean => a.length > i && a[i] !== null;
export const optNum = (a: Value[], i: number, d: number): number => (has(a, i) ? toNum(a[i]) : d);
export const optBool = (a: Value[], i: number, d: boolean): boolean => (has(a, i) ? toBool(a[i]) : d);
export const int = (v: Value): number => Math.trunc(toNum(v));

export function asRange(v: Value): RangeValue {
  if (v instanceof RangeValue) return v;
  if (isErr(v)) throw v;
  return new RangeValue([[v]]);
}

/** scalar() that returns an error instead of throwing it. */
export function safe(v: Value): Scalar {
  try {
    return scalar(v);
  } catch (e) {
    if (e instanceof FormulaError) return e;
    throw e;
  }
}

/** Every value in the arguments; `ref` says whether it came from a range. */
export function* each(args: Value[]): Generator<{ v: Scalar; ref: boolean }> {
  for (const a of args) {
    if (a instanceof RangeValue) {
      for (const row of a.values) for (const v of row) yield { v, ref: true };
    } else yield { v: a, ref: false };
  }
}

/**
 * Numbers for SUM-like functions. From ranges only real numbers count (text
 * and blanks are skipped); typed-in arguments are coerced ("3" → 3).
 */
export function numbers(args: Value[]): number[] {
  const out: number[] = [];
  for (const { v, ref } of each(args)) {
    if (isErr(v)) throw v;
    if (ref) {
      if (typeof v === 'number') out.push(v);
    } else if (v !== null) out.push(toNum(v));
  }
  return out;
}

export const sum = (n: number[]): number => n.reduce((s, x) => s + x, 0);

/** Rounds half away from zero (Excel's ROUND), avoiding binary noise like 2.675 → 2.67. */
export function roundTo(x: number, d: number, mode: 'half' | 'up' | 'down'): number {
  const f = Math.pow(10, d);
  const scaled = parseFloat((Math.abs(x) * f).toPrecision(15));
  const r = mode === 'up' ? Math.ceil(scaled) : mode === 'down' ? Math.floor(scaled) : Math.round(scaled);
  const out = Math.sign(x) * parseFloat((r / f).toPrecision(15));
  return out === 0 ? 0 : out;
}

/* ---------------- wildcards & criteria ---------------- */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const hasWild = (s: string): boolean => /[*?]/.test(s);

/** Excel wildcards: * any text, ? one character, ~ escapes. */
export function wildcard(p: string): RegExp {
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '~' && i + 1 < p.length) re += escapeRe(p[++i]);
    else if (ch === '*') re += '[\\s\\S]*';
    else if (ch === '?') re += '[\\s\\S]';
    else re += escapeRe(ch);
  }
  return new RegExp('^' + re + '$', 'i');
}

type CmpOp = '=' | '<>' | '<' | '>' | '<=' | '>=';
function cmpOp(op: CmpOp, c: number): boolean {
  switch (op) {
    case '=': return c === 0;
    case '<>': return c !== 0;
    case '<': return c < 0;
    case '>': return c > 0;
    case '<=': return c <= 0;
    case '>=': return c >= 0;
  }
}

export type Test = (v: Scalar) => boolean;

/** Turns a criterion such as ">=10", "apple*" or 5 into a test function. */
export function criterion(crit: Value): Test {
  let c = safe(crit);
  if (isErr(c)) throw c;
  if (typeof c === 'number') {
    const n = c;
    return (v) => typeof v === 'number' && round15(v) === round15(n);
  }
  if (typeof c === 'boolean') {
    const b = c;
    return (v) => v === b;
  }
  if (c === null) c = '';
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(c)!;
  const op = (m[1] || '=') as CmpOp;
  const rhs = m[2];
  if (rhs === '') {
    if (op === '=') return (v) => v === null || v === '';
    if (op === '<>') return (v) => !(v === null || v === '');
  }
  const num = parseNumberLike(rhs);
  if (num) {
    const t = num.value;
    return (v) => (typeof v === 'number' ? cmpOp(op, compare(v, t)) : op === '<>');
  }
  if (/^(TRUE|FALSE)$/i.test(rhs)) {
    const b = rhs.toUpperCase() === 'TRUE';
    return (v) => (op === '<>' ? v !== b : typeof v === 'boolean' && cmpOp(op, compare(v, b)));
  }
  if (op === '=' || op === '<>') {
    const re = wildcard(rhs);
    const match: Test = (v) => typeof v === 'string' && re.test(v);
    return op === '=' ? match : (v) => !match(v);
  }
  return (v) => typeof v === 'string' && cmpOp(op, compare(v, rhs));
}

/** Shared engine for the *IFS family: the (row, col) positions matching every criterion. */
export function ifsMatches(pairs: Array<[Value, Value]>): Array<[number, number]> {
  const first = asRange(pairs[0][0]);
  const h = first.height;
  const w = first.width;
  const tests = pairs.map(([r, c]): [RangeValue, Test] => {
    const rg = asRange(r);
    if (rg.height !== h || rg.width !== w) throw ERR.VALUE;
    return [rg, criterion(c)];
  });
  const out: Array<[number, number]> = [];
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) if (tests.every(([rg, t]) => t(rg.values[i][j]))) out.push([i, j]);
  }
  return out;
}

export function pairsFrom(a: Value[], start: number): Array<[Value, Value]> {
  if ((a.length - start) % 2 !== 0 || a.length - start < 2) throw ERR.VALUE;
  const pairs: Array<[Value, Value]> = [];
  for (let i = start; i < a.length; i += 2) pairs.push([a[i], a[i + 1]]);
  return pairs;
}

/** For the *IFS functions: the value range must be the same size as the criteria ranges. */
export function sameShape(values: Value, criteria: Value): RangeValue {
  const v = asRange(values);
  const c = asRange(criteria);
  if (v.height !== c.height || v.width !== c.width) throw ERR.VALUE;
  return v;
}

export function numsAt(rg: RangeValue, cells: Array<[number, number]>): number[] {
  const out: number[] = [];
  for (const [i, j] of cells) {
    const v = rg.values[i]?.[j];
    if (typeof v === 'number') out.push(v);
  }
  return out;
}
