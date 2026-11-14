/** Information functions (IS…). */
import { ERR, isErr } from '../errors';
import { toNum, type Scalar } from '../values';
import { argc, define, safe, type FunctionDef } from './helpers';

const is = (name: string, test: (v: Scalar) => boolean): FunctionDef =>
  define(name + '(value)', (a) => {
    argc(a, 1, 1);
    return test(safe(a[0]));
  });

export const infoFunctions: FunctionDef[] = [
  is('ISBLANK', (v) => v === null),
  is('ISNUMBER', (v) => typeof v === 'number'),
  is('ISTEXT', (v) => typeof v === 'string'),
  is('ISNONTEXT', (v) => typeof v !== 'string'),
  is('ISLOGICAL', (v) => typeof v === 'boolean'),
  is('ISERROR', (v) => isErr(v)),
  is('ISERR', (v) => isErr(v) && v !== ERR.NA),
  is('ISNA', (v) => v === ERR.NA),
  define('ISEVEN(number)', (a) => {
    argc(a, 1, 1);
    return Math.trunc(toNum(a[0])) % 2 === 0;
  }),
  define('ISODD(number)', (a) => {
    argc(a, 1, 1);
    return Math.abs(Math.trunc(toNum(a[0])) % 2) === 1;
  }),
  define('NA()', () => {
    throw ERR.NA;
  }),
];
