/*
 * LocalCalc — number formats, dates and input parsing.
 *
 * A cell stores a raw *value* (e.g. 0.125) and a *format* (e.g. "0.0%").
 * Display text is computed: formatValue(0.125, "0.0%") → "12.5%".
 * Format strings follow Excel's mini-language: 0 # , . % "literal" and
 * date codes yyyy mm dd hh mm ss AM/PM, with ; separating
 * positive;negative;zero sections.
 */
(function (global) {
  'use strict';
  const LC = global.LC;
  const { isErr } = LC;

  /* ---------------- Dates as serial numbers ---------------- */
  // Excel stores dates as "days since 1899-12-30"; times are the fraction.
  const EPOCH = Date.UTC(1899, 11, 30);
  const DAY_MS = 86400000;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function dateToSerial(y, m, d) {
    return (Date.UTC(y, m - 1, d) - EPOCH) / DAY_MS;
  }
  function serialToDate(serial) {
    let days = Math.floor(serial);
    let secs = Math.round((serial - days) * 86400);
    if (secs >= 86400) { secs -= 86400; days += 1; }
    const dt = new Date(EPOCH + days * DAY_MS);
    return {
      y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), dow: dt.getUTCDay(),
      H: Math.floor(secs / 3600), M: Math.floor((secs % 3600) / 60), S: secs % 60,
    };
  }
  function nowSerial() {
    const n = new Date();
    return dateToSerial(n.getFullYear(), n.getMonth() + 1, n.getDate()) +
      (n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds()) / 86400;
  }
  function todaySerial() { return Math.floor(nowSerial()); }

  function detectDateOrder() {
    try {
      const parts = new Intl.DateTimeFormat(undefined).formatToParts(new Date(2000, 10, 22));
      const order = parts.filter((p) => p.type === 'day' || p.type === 'month').map((p) => p.type[0]).join('');
      return order === 'md' ? 'MDY' : 'DMY';
    } catch (e) {
      return 'DMY';
    }
  }
  LC.settings = LC.settings || { dateOrder: detectDateOrder() };

  /* ---------------- Formatting ---------------- */
  function splitSections(fmt) {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < fmt.length; i++) {
      const ch = fmt[i];
      if (ch === '"') q = !q;
      if (ch === '\\' && !q) { cur += ch + (fmt[i + 1] || ''); i++; continue; }
      if (ch === ';' && !q) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }
  const stripLiterals = (s) => s.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '');
  function isDateFormat(sec) {
    const s = stripLiterals(sec);
    return /[ymdhs]/i.test(s) && !/[0#?]/.test(s);
  }

  function generalFormat(n) {
    if (n === 0) return '0';
    const a = Math.abs(n);
    if (a >= 1e11 || a < 1e-9) {
      return n.toExponential(5).replace(/\.?0+e/, 'e').replace('e', 'E').replace(/E([+-])(\d)$/, 'E$10$2');
    }
    if (Number.isInteger(n)) return String(n);
    // ~10 significant digits fit a default-width cell, like Excel's General.
    return String(parseFloat(n.toPrecision(10))).replace('e', 'E');
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  function formatDate(serial, sec) {
    if (serial < 0) return '########';
    const p = serialToDate(serial);
    const toks = [];
    const rx = /yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|am\/pm|a\/p|"[^"]*"|\\.|\[[^\]]*\]|./gi;
    let m;
    while ((m = rx.exec(sec))) toks.push(m[0]);
    const low = toks.map((t) => t.toLowerCase());
    const isCode = (t) => /^(y|m|d|h|s)/.test(t) && !/^(am|a\/)/.test(t);
    // "m" means minutes when it follows an hour or precedes seconds.
    for (let i = 0; i < low.length; i++) {
      if (low[i] !== 'm' && low[i] !== 'mm') continue;
      let j = i - 1; while (j >= 0 && !isCode(low[j])) j--;
      let k = i + 1; while (k < low.length && !isCode(low[k])) k++;
      if ((j >= 0 && low[j][0] === 'h') || (k < low.length && low[k][0] === 's')) low[i] = low[i] === 'm' ? '%min' : '%mmin';
    }
    const ampm = low.some((t) => t === 'am/pm' || t === 'a/p');
    const hour = ampm ? (p.H % 12 || 12) : p.H;
    let out = '';
    for (let i = 0; i < toks.length; i++) {
      const raw = toks[i];
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
          else if (raw[0] === '\\') out += raw[1] || '';
          else if (raw[0] !== '[') out += raw;
      }
    }
    return out;
  }

  function formatNumber(n, fmt) {
    const sections = splitSections(fmt);
    let sec = sections[0];
    let val = n;
    let signHandled = false;
    if (n < 0 && sections.length > 1 && sections[1] !== '') { sec = sections[1]; val = -n; signHandled = true; }
    else if (n === 0 && sections.length > 2 && sections[2] !== '') sec = sections[2];
    sec = sec.replace(/\[[^\]]*\]/g, '');
    if (isDateFormat(sec)) return formatDate(val, sec);
    if (sec === 'General' || sec === '') return generalFormat(val);

    // Split the section into literal text and number-pattern characters.
    const parts = [];
    for (let i = 0; i < sec.length; i++) {
      const ch = sec[i];
      if (ch === '"') {
        const end = sec.indexOf('"', i + 1);
        const stop = end < 0 ? sec.length : end;
        parts.push({ lit: sec.slice(i + 1, stop) });
        i = stop;
      } else if (ch === '\\') { parts.push({ lit: sec[i + 1] || '' }); i++; }
      else if (ch === '_') { parts.push({ lit: ' ' }); i++; }
      else if (ch === '*') { i++; }
      else if ('0#?.,'.includes(ch)) parts.push({ pat: ch });
      else parts.push({ lit: ch });
    }
    const first = parts.findIndex((p) => p.pat && p.pat !== ',');
    if (first < 0) return parts.map((p) => p.lit || '').join('');
    let last = first;
    parts.forEach((p, i) => { if (p.pat && '0#?.'.includes(p.pat)) last = i; });
    const core = parts.slice(first, last + 1).map((p) => p.pat || '').join('');
    const prefix = parts.slice(0, first).map((p) => p.lit || '').join('');
    const suffix = parts.slice(last + 1).map((p) => p.lit || '').join('');
    const percent = (prefix + suffix).includes('%');

    const dot = core.indexOf('.');
    const intPat = dot < 0 ? core : core.slice(0, dot);
    const decPat = dot < 0 ? '' : core.slice(dot + 1);
    const thousands = intPat.includes(',');
    const minInt = (intPat.match(/0/g) || []).length;
    const minDec = (decPat.match(/0/g) || []).length;
    const maxDec = (decPat.match(/[0#?]/g) || []).length;

    if (percent) val *= 100;
    const neg = val < 0;
    const abs = Math.abs(val);
    const rounded = Math.round(parseFloat((abs * Math.pow(10, maxDec)).toPrecision(15))) / Math.pow(10, maxDec);
    let [ip, dp = ''] = rounded.toFixed(maxDec).split('.');
    while (dp.length > minDec && dp.endsWith('0')) dp = dp.slice(0, -1);
    if (ip === '0' && minInt === 0) ip = '';
    ip = ip.padStart(minInt, '0');
    if (thousands) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    let num = ip + (dp.length ? '.' + dp : '');
    if (num === '') num = '0';
    const isZero = !/[1-9]/.test(num);
    const sign = neg && !signHandled && !isZero ? '-' : '';
    return sign + prefix + num + suffix;
  }

  function formatValue(v, fmt) {
    if (v === null || v === undefined) return '';
    if (isErr(v)) return v.code;
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'string') return v;
    if (typeof v !== 'number') return String(v);
    if (!fmt || fmt === 'General' || fmt === '@') return generalFormat(v);
    return formatNumber(v, fmt);
  }

  /** Changes the number of decimals shown by a format (toolbar .0 / .00 buttons). */
  function adjustDecimals(fmt, delta, value) {
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

  /* ---------------- Input parsing ---------------- */
  /**
   * Recognises numbers the way a person types them: 1,234.5  12%  $9.99
   * 2026-11-13  13/11/2026  9:30. Returns {value, fmt} or null.
   */
  function parseNumberLike(str) {
    const s = String(str).trim();
    if (!s) return null;
    let m;
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return { value: parseFloat(s), fmt: null };
    if ((m = /^([+-]?)(\d{1,3}(?:,\d{3})+)(\.\d+)?$/.exec(s))) {
      return { value: parseFloat(m[1] + m[2].replace(/,/g, '') + (m[3] || '')), fmt: m[3] ? '#,##0.00' : '#,##0' };
    }
    if ((m = /^([+-]?)(\d{1,3}(?:,\d{3})+|\d*)(\.\d+)?\s?%$/.exec(s)) && (m[2] || m[3])) {
      return { value: parseFloat(m[1] + (m[2] || '0').replace(/,/g, '') + (m[3] || '')) / 100, fmt: m[3] ? '0.00%' : '0%' };
    }
    if ((m = /^([+-]?)([$€£¥])\s?(\d{1,3}(?:,\d{3})+|\d*)(\.\d+)?$/.exec(s)) && (m[3] || m[4])) {
      return {
        value: parseFloat(m[1] + (m[3] || '0').replace(/,/g, '') + (m[4] || '')),
        fmt: m[2] + (m[4] ? '#,##0.00' : '#,##0'),
      };
    }
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) {
      const y = +m[1], mo = +m[2], d = +m[3];
      if (validDate(y, mo, d)) return { value: dateToSerial(y, mo, d), fmt: 'yyyy-mm-dd' };
    }
    if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s))) {
      const dmy = LC.settings.dateOrder !== 'MDY';
      const d = dmy ? +m[1] : +m[2];
      const mo = dmy ? +m[2] : +m[1];
      const y = +m[3];
      if (validDate(y, mo, d)) return { value: dateToSerial(y, mo, d), fmt: dmy ? 'dd/mm/yyyy' : 'mm/dd/yyyy' };
    }
    if ((m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s))) {
      const h = +m[1], mi = +m[2], se = m[3] ? +m[3] : 0;
      if (h < 24 && mi < 60 && se < 60) return { value: (h * 3600 + mi * 60 + se) / 86400, fmt: m[3] ? 'hh:mm:ss' : 'hh:mm' };
    }
    return null;
  }
  function validDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  /** What did the user type into a cell? */
  function parseInput(raw) {
    if (raw === null || raw === undefined || raw === '') return { kind: 'empty', value: null };
    if (raw[0] === "'") return { kind: 'value', value: raw.slice(1) };
    if (raw[0] === '=' && raw.length > 1) return { kind: 'formula' };
    const t = raw.trim();
    const u = t.toUpperCase();
    if (u === 'TRUE' || u === 'FALSE') return { kind: 'value', value: u === 'TRUE' };
    if (LC.ERROR_BY_CODE[u]) return { kind: 'value', value: LC.ERROR_BY_CODE[u] };
    const num = parseNumberLike(t);
    if (num) return { kind: 'value', value: num.value, fmt: num.fmt };
    return { kind: 'value', value: raw };
  }

  Object.assign(LC, {
    dateToSerial, serialToDate, nowSerial, todaySerial, MONTHS, DAYS,
    formatValue, formatNumber, generalFormat, adjustDecimals, isDateFormat,
    parseNumberLike, parseInput,
  });
})(typeof window !== 'undefined' ? window : globalThis);
