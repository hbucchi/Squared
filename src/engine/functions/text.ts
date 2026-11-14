/** Text functions. */
import { ERR, isErr } from '../errors';
import { formatValue } from '../format';
import { parseNumberLike } from '../input';
import { scalar, toBool, toStr, type Value } from '../values';
import { argc, define, each, has, int, optNum, wildcard, type FunctionDef } from './helpers';

const str1 = (a: Value[]): string => {
  argc(a, 1, 1);
  return toStr(a[0]);
};
const count = (a: Value[], i: number, d: number): number => {
  const n = Math.trunc(optNum(a, i, d));
  if (n < 0) throw ERR.VALUE;
  return n;
};

export const textFunctions: FunctionDef[] = [
  define('CONCAT(text1, [text2], ...)', (a) => {
    let s = '';
    for (const { v } of each(a)) s += toStr(v);
    return s;
  }),
  define('CONCATENATE(text1, [text2], ...)', (a) => a.map(toStr).join('')),
  define('TEXTJOIN(delimiter, ignore_empty, text1, ...)', (a) => {
    argc(a, 3);
    const d = toStr(a[0]);
    const ignore = toBool(a[1]);
    const parts: string[] = [];
    for (const { v } of each(a.slice(2))) {
      const s = toStr(v);
      if (!(ignore && s === '')) parts.push(s);
    }
    return parts.join(d);
  }),
  define('LEN(text)', (a) => str1(a).length),
  define('UPPER(text)', (a) => str1(a).toUpperCase()),
  define('LOWER(text)', (a) => str1(a).toLowerCase()),
  define('PROPER(text)', (a) => str1(a).toLowerCase()
    .replace(/(^|[^a-zA-ZÀ-ɏ])([a-zA-ZÀ-ɏ])/g, (_m, p: string, c: string) => p + c.toUpperCase())),
  define('TRIM(text)', (a) => str1(a).trim().replace(/ {2,}/g, ' ')),
  define('LEFT(text, [num_chars])', (a) => {
    argc(a, 1, 2);
    return toStr(a[0]).slice(0, count(a, 1, 1));
  }),
  define('RIGHT(text, [num_chars])', (a) => {
    argc(a, 1, 2);
    const n = count(a, 1, 1);
    return n === 0 ? '' : toStr(a[0]).slice(-n);
  }),
  define('MID(text, start_num, num_chars)', (a) => {
    argc(a, 3, 3);
    const s = toStr(a[0]);
    const st = int(a[1]);
    const n = int(a[2]);
    if (st < 1 || n < 0) throw ERR.VALUE;
    return s.substr(st - 1, n);
  }),
  define('FIND(find_text, within_text, [start_num])', (a) => {
    argc(a, 2, 3);
    const f = toStr(a[0]);
    const s = toStr(a[1]);
    const st = Math.trunc(optNum(a, 2, 1));
    if (st < 1 || st > s.length + 1) throw ERR.VALUE;
    const i = s.indexOf(f, st - 1);
    if (i < 0) throw ERR.VALUE;
    return i + 1;
  }),
  define('SEARCH(find_text, within_text, [start_num])', (a) => {
    argc(a, 2, 3);
    const f = toStr(a[0]);
    const s = toStr(a[1]);
    const st = Math.trunc(optNum(a, 2, 1));
    if (st < 1 || st > s.length + 1) throw ERR.VALUE;
    const m = new RegExp(wildcard(f).source.slice(1, -1), 'i').exec(s.slice(st - 1));
    if (!m) throw ERR.VALUE;
    return m.index + st;
  }),
  define('SUBSTITUTE(text, old_text, new_text, [instance_num])', (a) => {
    argc(a, 3, 4);
    const s = toStr(a[0]);
    const o = toStr(a[1]);
    const n = toStr(a[2]);
    if (o === '') return s;
    if (!has(a, 3)) return s.split(o).join(n);
    const k = int(a[3]);
    if (k < 1) throw ERR.VALUE;
    let idx = -1;
    for (let i = 0; i < k; i++) {
      idx = s.indexOf(o, idx + 1);
      if (idx < 0) return s;
    }
    return s.slice(0, idx) + n + s.slice(idx + o.length);
  }),
  define('REPLACE(old_text, start_num, num_chars, new_text)', (a) => {
    argc(a, 4, 4);
    const s = toStr(a[0]);
    const st = int(a[1]);
    const n = int(a[2]);
    if (st < 1 || n < 0) throw ERR.VALUE;
    return s.slice(0, st - 1) + toStr(a[3]) + s.slice(st - 1 + n);
  }),
  define('REPT(text, number_times)', (a) => {
    argc(a, 2, 2);
    const n = int(a[1]);
    if (n < 0) throw ERR.VALUE;
    return toStr(a[0]).repeat(n);
  }),
  define('TEXT(value, format_text)', (a) => {
    argc(a, 2, 2);
    let v = scalar(a[0]);
    if (isErr(v)) throw v;
    if (typeof v === 'string') {
      const p = parseNumberLike(v);
      if (p) v = p.value;
    }
    return formatValue(v, toStr(a[1]));
  }),
  define('VALUE(text)', (a) => {
    argc(a, 1, 1);
    const v = scalar(a[0]);
    if (isErr(v)) throw v;
    if (typeof v === 'number') return v;
    if (v === null) return 0;
    const p = parseNumberLike(String(v));
    if (!p) throw ERR.VALUE;
    return p.value;
  }),
  define('EXACT(text1, text2)', (a) => {
    argc(a, 2, 2);
    return toStr(a[0]) === toStr(a[1]);
  }),
  define('CHAR(number)', (a) => {
    argc(a, 1, 1);
    const n = int(a[0]);
    if (n < 1 || n > 65535) throw ERR.VALUE;
    return String.fromCharCode(n);
  }),
  define('CODE(text)', (a) => {
    const s = str1(a);
    if (!s) throw ERR.VALUE;
    return s.charCodeAt(0);
  }),
];
