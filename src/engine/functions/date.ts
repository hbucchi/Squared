/** Date & time functions. Dates are serial numbers: days since 1899-12-30. */
import { dateToSerial, nowSerial, serialToDate, todaySerial, type DateParts } from '../dates';
import { ERR } from '../errors';
import { isDateFormat } from '../format';
import { parseNumberLike } from '../input';
import { toNum, toStr, type Value } from '../values';
import { argc, define, int, optNum, type FunctionDef } from './helpers';

function parts(v: Value): DateParts {
  const n = toNum(v);
  if (n < 0) throw ERR.NUM;
  return serialToDate(n);
}
const part = (k: keyof DateParts) => (a: Value[]): number => {
  argc(a, 1, 1);
  return parts(a[0])[k];
};

export const dateFunctions: FunctionDef[] = [
  define('TODAY()', () => todaySerial()),
  define('NOW()', () => nowSerial()),
  define('DATE(year, month, day)', (a) => {
    argc(a, 3, 3);
    let y = int(a[0]);
    if (y < 1900) y += 1900;
    const s = dateToSerial(y, int(a[1]), int(a[2]));
    if (s < 0) throw ERR.NUM;
    return s;
  }),
  define('TIME(hour, minute, second)', (a) => {
    argc(a, 3, 3);
    const t = (int(a[0]) * 3600 + int(a[1]) * 60 + int(a[2])) / 86400;
    if (t < 0) throw ERR.NUM;
    return t - Math.floor(t);
  }),
  define('DATEVALUE(date_text)', (a) => {
    argc(a, 1, 1);
    const p = parseNumberLike(toStr(a[0]));
    if (!p || !p.fmt || !isDateFormat(p.fmt)) throw ERR.VALUE;
    return Math.floor(p.value);
  }),
  define('YEAR(serial_number)', part('y')),
  define('MONTH(serial_number)', part('m')),
  define('DAY(serial_number)', part('d')),
  define('HOUR(serial_number)', part('H')),
  define('MINUTE(serial_number)', part('M')),
  define('SECOND(serial_number)', part('S')),
  define('WEEKDAY(serial_number, [return_type])', (a) => {
    argc(a, 1, 2);
    const dow = parts(a[0]).dow;
    const type = Math.trunc(optNum(a, 1, 1));
    if (type === 1) return dow + 1;
    if (type === 2) return ((dow + 6) % 7) + 1;
    if (type === 3) return (dow + 6) % 7;
    throw ERR.NUM;
  }),
  define('EDATE(start_date, months)', (a) => {
    argc(a, 2, 2);
    const p = parts(a[0]);
    const m = p.m + int(a[1]);
    const last = new Date(Date.UTC(p.y, m, 0)).getUTCDate();
    return dateToSerial(p.y, m, Math.min(p.d, last));
  }),
  define('EOMONTH(start_date, months)', (a) => {
    argc(a, 2, 2);
    const p = parts(a[0]);
    return dateToSerial(p.y, p.m + int(a[1]) + 1, 0);
  }),
  define('DAYS(end_date, start_date)', (a) => {
    argc(a, 2, 2);
    return Math.floor(toNum(a[0])) - Math.floor(toNum(a[1]));
  }),
  define('DATEDIF(start_date, end_date, unit)', (a) => {
    argc(a, 3, 3);
    const s = toNum(a[0]);
    const e = toNum(a[1]);
    if (s > e) throw ERR.NUM;
    const p = parts(s);
    const q = parts(e);
    const unit = toStr(a[2]).toUpperCase();
    let months = (q.y - p.y) * 12 + (q.m - p.m);
    if (q.d < p.d) months--;
    if (unit === 'D') return Math.floor(e) - Math.floor(s);
    if (unit === 'M') return months;
    if (unit === 'Y') return Math.floor(months / 12);
    throw ERR.NUM;
  }),
];
