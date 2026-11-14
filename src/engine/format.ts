/**
 * Number formats.
 *
 * A cell stores a *value* (0.125) and a *format* ("0.0%"); the text you see
 * is computed: formatValue(0.125, "0.0%") → "12.5%". Formats use Excel's
 * mini-language: 0 # , . % "literal" \x, date codes yyyy mm dd hh mm ss
 * AM/PM, and ; separating positive;negative;zero sections.
 */
import { DAYS, MONTHS, serialToDate } from './dates';
import { isErr } from './errors';
import type { Scalar } from './values';

export function splitSections(fmt: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === '"') quoted = !quoted;
    if (ch === '\\' && !quoted) {
      cur += ch + (fmt[i + 1] ?? '');
      i++;
      continue;
    }
    if (ch === ';' && !quoted) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

const stripLiterals = (s: string): string => s.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '');

export function isDateFormat(sec: string): boolean {
  const s = stripLiterals(sec);
  return /[ymdhs]/i.test(s) && !/[0#?]/.test(s);
}

/** Excel's "General": integers as-is, ~10 significant digits, scientific when huge/tiny. */
export function generalFormat(n: number): string {
  if (n === 0) return '0';
  const a = Math.abs(n);
  if (a >= 1e11 || a < 1e-9) {
    return n.toExponential(5).replace(/\.?0+e/, 'e').replace('e', 'E').replace(/E([+-])(\d)$/, 'E$10$2');
  }
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toPrecision(10))).replace('e', 'E');
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

function formatDate(serial: number, sec: string): string {
  if (serial < 0) return '########';
  const p = serialToDate(serial);
  const toks: string[] = [];
  const rx = /yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|am\/pm|a\/p|"[^"]*"|\\.|\[[^\]]*\]|./gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(sec))) toks.push(m[0]);
  const low = toks.map((t) => t.toLowerCase());
  const isCode = (t: string): boolean => /^(y|m|d|h|s)/.test(t) && !/^(am|a\/)/.test(t);
  // "m" means minutes when it follows an hour or precedes seconds.
  for (let i = 0; i < low.length; i++) {
    if (low[i] !== 'm' && low[i] !== 'mm') continue;
    let j = i - 1;
    while (j >= 0 && !isCode(low[j])) j--;
    let k = i + 1;
    while (k < low.length && !isCode(low[k])) k++;
    if ((j >= 0 && low[j][0] === 'h') || (k < low.length && low[k][0] === 's')) {
      low[i] = low[i] === 'm' ? '%min' : '%mmin';
    }
  }
  const ampm = low.some((t) => t === 'am/pm' || t === 'a/p');
  const hour = ampm ? p.H % 12 || 12 : p.H;
  let out = '';
  toks.forEach((raw, i) => {
    switch (low[i]) {
      case 'yyyy': out += p.y; break;
      case 'yy': out += String(p.y).slice(-2); break;
      case 'mmmmm': out += MONTHS[p.m - 1][0]; break;
      case 'mmmm': out += MONTHS[p.m - 1]; break;
      case 'mmm': out += MONTHS[p.m - 1].slice(0, 3); break;
      case 'mm': out += pad2(p.m); break;
      case 'm': out += p.m; break;
      case 'dddd': out += DAYS[p.dow]; break;
      case 'ddd': out += DAYS[p.dow].slice(0, 3); break;
      case 'dd': out += pad2(p.d); break;
      case 'd': out += p.d; break;
      case 'hh': out += pad2(hour); break;
      case 'h': out += hour; break;
      case '%mmin': out += pad2(p.M); break;
      case '%min': out += p.M; break;
      case 'ss': out += pad2(p.S); break;
      case 's': out += p.S; break;
      case 'am/pm': out += p.H < 12 ? 'AM' : 'PM'; break;
      case 'a/p': out += p.H < 12 ? 'A' : 'P'; break;
      default:
        if (raw[0] === '"') out += raw.slice(1, -1);
        else if (raw[0] === '\\') out += raw[1] ?? '';
        else if (raw[0] !== '[') out += raw;
    }
  });
  return out;
}

type FmtPart = { lit: string } | { pat: string };

export function formatNumber(n: number, fmt: string): string {
  const sections = splitSections(fmt);
  let sec = sections[0];
  let val = n;
  let signHandled = false;
  if (n < 0 && sections.length > 1 && sections[1] !== '') {
    sec = sections[1];
    val = -n;
    signHandled = true;
  } else if (n === 0 && sections.length > 2 && sections[2] !== '') sec = sections[2];
  sec = sec.replace(/\[[^\]]*\]/g, '');
  if (isDateFormat(sec)) return formatDate(val, sec);
  if (sec === 'General' || sec === '') return generalFormat(val);

  // Split into literal text and number-pattern characters.
  const parts: FmtPart[] = [];
  for (let i = 0; i < sec.length; i++) {
    const ch = sec[i];
    if (ch === '"') {
      const end = sec.indexOf('"', i + 1);
      const stop = end < 0 ? sec.length : end;
      parts.push({ lit: sec.slice(i + 1, stop) });
      i = stop;
    } else if (ch === '\\') {
      parts.push({ lit: sec[i + 1] ?? '' });
      i++;
    } else if (ch === '_') {
      parts.push({ lit: ' ' });
      i++;
    } else if (ch === '*') i++;
    else if ('0#?.,'.includes(ch)) parts.push({ pat: ch });
    else parts.push({ lit: ch });
  }
  const lit = (p: FmtPart): string => ('lit' in p ? p.lit : '');
  const pat = (p: FmtPart): string => ('pat' in p ? p.pat : '');
  const first = parts.findIndex((p) => pat(p) !== '' && pat(p) !== ',');
  if (first < 0) return parts.map(lit).join('');
  let last = first;
  parts.forEach((p, i) => {
    if (pat(p) && '0#?.'.includes(pat(p))) last = i;
  });
  const core = parts.slice(first, last + 1).map(pat).join('');
  const prefix = parts.slice(0, first).map(lit).join('');
  const suffix = parts.slice(last + 1).map(lit).join('');
  const percent = (prefix + suffix).includes('%');

  const dot = core.indexOf('.');
  const intPat = dot < 0 ? core : core.slice(0, dot);
  const decPat = dot < 0 ? '' : core.slice(dot + 1);
  const thousands = intPat.includes(',');
  const minInt = (intPat.match(/0/g) ?? []).length;
  const minDec = (decPat.match(/0/g) ?? []).length;
  const maxDec = (decPat.match(/[0#?]/g) ?? []).length;

  if (percent) val *= 100;
  const neg = val < 0;
  const scale = Math.pow(10, maxDec);
  const rounded = Math.round(parseFloat((Math.abs(val) * scale).toPrecision(15))) / scale;
  let [ip, dp = ''] = rounded.toFixed(maxDec).split('.');
  while (dp.length > minDec && dp.endsWith('0')) dp = dp.slice(0, -1);
  if (ip === '0' && minInt === 0) ip = '';
  ip = ip.padStart(minInt, '0');
  if (thousands) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let num = ip + (dp.length ? '.' + dp : '');
  if (num === '') num = '0';
  const sign = neg && !signHandled && /[1-9]/.test(num) ? '-' : '';
  return sign + prefix + num + suffix;
}

export function formatValue(v: Scalar | undefined, fmt?: string | null): string {
  if (v === null || v === undefined) return '';
  if (isErr(v)) return v.code;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'string') return v;
  if (!fmt || fmt === 'General' || fmt === '@') return generalFormat(v);
  return formatNumber(v, fmt);
}

/** Changes the decimals a format shows (the toolbar's .0→ / ←.0 buttons). */
export function adjustDecimals(fmt: string | undefined | null, delta: number, value?: Scalar): string {
  if (!fmt || fmt === 'General') {
    let dec = 0;
    if (typeof value === 'number' && !Number.isInteger(value)) {
      const s = generalFormat(value);
      const i = s.indexOf('.');
      dec = i < 0 ? 0 : s.replace(/E.*/, '').length - i - 1;
    }
    const n = Math.max(0, dec + delta);
    return n ? '0.' + '0'.repeat(n) : '0';
  }
  return splitSections(fmt).map((sec) => {
    if (isDateFormat(sec)) return sec;
    const m = /\.(0*)/.exec(sec);
    if (m) {
      const n = Math.max(0, m[1].length + delta);
      return sec.slice(0, m.index) + (n ? '.' + '0'.repeat(n) : '') + sec.slice(m.index + m[0].length);
    }
    if (delta <= 0) return sec;
    let lastIdx = -1;
    for (let i = 0; i < sec.length; i++) if (sec[i] === '0' || sec[i] === '#') lastIdx = i;
    if (lastIdx < 0) return sec;
    return sec.slice(0, lastIdx + 1) + '.' + '0'.repeat(delta) + sec.slice(lastIdx + 1);
  }).join(';');
}
