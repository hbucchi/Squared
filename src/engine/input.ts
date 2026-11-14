/** Understanding what the user typed into a cell. */
import { dateToSerial, validDate } from './dates';
import { ERROR_BY_CODE } from './errors';
import type { Scalar } from './values';

export type DateOrder = 'DMY' | 'MDY';

function detectDateOrder(): DateOrder {
  try {
    const parts = new Intl.DateTimeFormat(undefined).formatToParts(new Date(2000, 10, 22));
    const order = parts.filter((p) => p.type === 'day' || p.type === 'month').map((p) => p.type[0]).join('');
    return order === 'md' ? 'MDY' : 'DMY';
  } catch {
    return 'DMY';
  }
}

/** Whether 01/02/2026 means 1 February (DMY) or January 2 (MDY). */
export const settings: { dateOrder: DateOrder } = { dateOrder: detectDateOrder() };

export interface ParsedNumber {
  value: number;
  /** A number format matching how it was typed, e.g. "0%" for "12%". */
  fmt: string | null;
}

/**
 * Recognises numbers as people type them: 1,234.5  12%  $9.99  2026-11-13
 * 13/11/2026  9:30. Returns null for anything else.
 */
export function parseNumberLike(str: string): ParsedNumber | null {
  const s = String(str).trim();
  if (!s) return null;
  let m: RegExpExecArray | null;
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return { value: parseFloat(s), fmt: null };
  if ((m = /^([+-]?)(\d{1,3}(?:,\d{3})+)(\.\d+)?$/.exec(s))) {
    return { value: parseFloat(m[1] + m[2].replace(/,/g, '') + (m[3] ?? '')), fmt: m[3] ? '#,##0.00' : '#,##0' };
  }
  if ((m = /^([+-]?)(\d{1,3}(?:,\d{3})+|\d*)(\.\d+)?\s?%$/.exec(s)) && (m[2] || m[3])) {
    return {
      value: parseFloat(m[1] + (m[2] || '0').replace(/,/g, '') + (m[3] ?? '')) / 100,
      fmt: m[3] ? '0.00%' : '0%',
    };
  }
  if ((m = /^([+-]?)([$€£¥])\s?(\d{1,3}(?:,\d{3})+|\d*)(\.\d+)?$/.exec(s)) && (m[3] || m[4])) {
    return {
      value: parseFloat(m[1] + (m[3] || '0').replace(/,/g, '') + (m[4] ?? '')),
      fmt: m[2] + (m[4] ? '#,##0.00' : '#,##0'),
    };
  }
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (validDate(y, mo, d)) return { value: dateToSerial(y, mo, d), fmt: 'yyyy-mm-dd' };
  }
  if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s))) {
    const dmy = settings.dateOrder !== 'MDY';
    const d = dmy ? +m[1] : +m[2];
    const mo = dmy ? +m[2] : +m[1];
    const y = +m[3];
    if (validDate(y, mo, d)) return { value: dateToSerial(y, mo, d), fmt: dmy ? 'dd/mm/yyyy' : 'mm/dd/yyyy' };
  }
  if ((m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s))) {
    const [h, mi, se] = [+m[1], +m[2], m[3] ? +m[3] : 0];
    if (h < 24 && mi < 60 && se < 60) {
      return { value: (h * 3600 + mi * 60 + se) / 86400, fmt: m[3] ? 'hh:mm:ss' : 'hh:mm' };
    }
  }
  return null;
}

export type ParsedInput =
  | { kind: 'empty'; value: null }
  | { kind: 'formula' }
  | { kind: 'value'; value: Scalar; fmt?: string | null };

export function parseInput(raw: string | null | undefined): ParsedInput {
  if (raw === null || raw === undefined || raw === '') return { kind: 'empty', value: null };
  if (raw[0] === "'") return { kind: 'value', value: raw.slice(1) };
  if (raw[0] === '=' && raw.length > 1) return { kind: 'formula' };
  const u = raw.trim().toUpperCase();
  if (u === 'TRUE' || u === 'FALSE') return { kind: 'value', value: u === 'TRUE' };
  if (ERROR_BY_CODE[u]) return { kind: 'value', value: ERROR_BY_CODE[u] };
  const num = parseNumberLike(raw);
  if (num) return { kind: 'value', value: num.value, fmt: num.fmt };
  return { kind: 'value', value: raw };
}
