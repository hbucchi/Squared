/** Logical functions. */
import { ERR, isErr } from '../errors';
import { compare, scalar, toBool, type Value } from '../values';
import { argc, define, each, safe, type FunctionDef } from './helpers';

function logicals(a: Value[]): boolean[] {
  const out: boolean[] = [];
  for (const { v, ref } of each(a)) {
    if (isErr(v)) throw v;
    if (ref) {
      if (typeof v === 'boolean' || typeof v === 'number') out.push(toBool(v));
    } else if (v !== null) out.push(toBool(v));
  }
  if (!out.length) throw ERR.VALUE;
  return out;
}

export const logicFunctions: FunctionDef[] = [
  define('IF(logical_test, [value_if_true], [value_if_false])', (a) => {
    argc(a, 1, 3);
    if (toBool(a[0])) return a.length > 1 ? (a[1] === null ? 0 : a[1]) : true;
    return a.length > 2 ? (a[2] === null ? 0 : a[2]) : false;
  }),
  define('IFS(test1, value1, [test2, value2], ...)', (a) => {
    if (a.length < 2 || a.length % 2) throw ERR.VALUE;
    for (let i = 0; i < a.length; i += 2) if (toBool(a[i])) return a[i + 1];
    throw ERR.NA;
  }),
  define('IFERROR(value, value_if_error)', (a) => {
    argc(a, 2, 2);
    return isErr(safe(a[0])) ? a[1] : a[0];
  }),
  define('IFNA(value, value_if_na)', (a) => {
    argc(a, 2, 2);
    return safe(a[0]) === ERR.NA ? a[1] : a[0];
  }),
  define('AND(logical1, [logical2], ...)', (a) => logicals(a).every(Boolean)),
  define('OR(logical1, [logical2], ...)', (a) => logicals(a).some(Boolean)),
  define('XOR(logical1, [logical2], ...)', (a) => logicals(a).filter(Boolean).length % 2 === 1),
  define('NOT(logical)', (a) => {
    argc(a, 1, 1);
    return !toBool(a[0]);
  }),
  define('TRUE()', () => true),
  define('FALSE()', () => false),
  define('SWITCH(expression, value1, result1, ..., [default])', (a) => {
    argc(a, 3);
    const x = scalar(a[0]);
    if (isErr(x)) throw x;
    let i = 1;
    for (; i + 1 < a.length; i += 2) if (compare(x, a[i]) === 0) return a[i + 1];
    if (i < a.length) return a[i];
    throw ERR.NA;
  }),
];
