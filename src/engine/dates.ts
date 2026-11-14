/**
 * Dates are stored as *serial numbers*: days since 1899-12-30, with the
 * time of day as the fraction (0.5 = noon). Date arithmetic is then just
 * arithmetic: "date + 1" is tomorrow.
 */
const EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86400000;

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'] as const;
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** Month/day overflow rolls over, like Excel: (2024, 13, 1) is 2025-01-01. */
export function dateToSerial(y: number, m: number, d: number): number {
  return (Date.UTC(y, m - 1, d) - EPOCH) / DAY_MS;
}

export interface DateParts {
  y: number; m: number; d: number;
  /** Day of week, 0 = Sunday. */
  dow: number;
  H: number; M: number; S: number;
}

export function serialToDate(serial: number): DateParts {
  let days = Math.floor(serial);
  let secs = Math.round((serial - days) * 86400);
  if (secs >= 86400) {
    secs -= 86400;
    days += 1;
  }
  const dt = new Date(EPOCH + days * DAY_MS);
  return {
    y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), dow: dt.getUTCDay(),
    H: Math.floor(secs / 3600), M: Math.floor((secs % 3600) / 60), S: secs % 60,
  };
}

export function nowSerial(): number {
  const n = new Date();
  return dateToSerial(n.getFullYear(), n.getMonth() + 1, n.getDate()) +
    (n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds()) / 86400;
}

export const todaySerial = (): number => Math.floor(nowSerial());

export function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
