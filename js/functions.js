/*
 * LocalCalc — function library.
 *
 * Each function receives already-evaluated arguments. A reference argument
 * arrives as a RangeValue (even a single cell), so a function can tell
 * "a value typed in the formula" from "a value read from the sheet" — Excel
 * treats them differently (SUM("3") is 3, but SUM(A1) ignores the text "3").
 */
(function (global) {
  'use strict';
  const LC = global.LC;
  const { ERR, isErr, RangeValue, FormulaError, scalar, toNum, toStr, toBool, compare, round15 } = LC;
  const F = LC.FUNCS;
  const SIG = LC.FUNCTION_SIGS;

  function def(name, sig, fn) { F[name] = fn; SIG[name] = sig; }
  function argc(a, min, max) {
    if (a.length < min || (max !== undefined && a.length > max)) throw ERR.VALUE;
  }
  const has = (a, i) => a.length > i && a[i] !== null;
  const optNum = (a, i, d) => (has(a, i) ? toNum(a[i]) : d);
  const optBool = (a, i, d) => (has(a, i) ? toBool(a[i]) : d);
  const int = (v) => Math.trunc(toNum(v));
  function asRange(v) {
    if (v instanceof RangeValue) return v;
    if (isErr(v)) throw v;
    return new RangeValue([[v]]);
  }
  /** scalar() that returns an error instead of throwing it. */
  function safe(v) {
    try { return scalar(v); } catch (e) { if (e instanceof FormulaError) return e; throw e; }
  }
  function* each(args) {
    for (const a of args) {
      if (a instanceof RangeValue) {
        for (const row of a.values) for (const v of row) yield { v, ref: true };
      } else yield { v: a, ref: false };
    }
  }
  /** Numbers for SUM-like functions: from ranges only real numbers count. */
  function numbers(args) {
    const out = [];
    for (const { v, ref } of each(args)) {
      if (isErr(v)) throw v;
      if (ref) { if (typeof v === 'number') out.push(v); }
      else if (v !== null) out.push(toNum(v));
    }
    return out;
  }
  const sum = (n) => n.reduce((s, x) => s + x, 0);
  function roundTo(x, d, mode) {
    const f = Math.pow(10, d);
    const scaled = parseFloat((Math.abs(x) * f).toPrecision(15));
    const r = mode === 'up' ? Math.ceil(scaled) : mode === 'down' ? Math.floor(scaled) : Math.round(scaled);
    const out = Math.sign(x) * parseFloat((r / f).toPrecision(15));
    return out === 0 ? 0 : out;
  }

  /* ---------------- Criteria (SUMIF, COUNTIF, ...) ---------------- */
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasWild = (s) => /[*?]/.test(s);
  function wildcard(p) {
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
  function cmpOp(op, c) {
    switch (op) {
      case '=': return c === 0;
      case '<>': return c !== 0;
      case '<': return c < 0;
      case '>': return c > 0;
      case '<=': return c <= 0;
      case '>=': return c >= 0;
    }
    return false;
  }
  /** Turns a criterion like ">=10", "apple*", 5 into a test function. */
  function criterion(crit) {
    let c = safe(crit);
    if (isErr(c)) throw c;
    if (typeof c === 'number') return (v) => typeof v === 'number' && round15(v) === round15(c);
    if (typeof c === 'boolean') return (v) => v === c;
    if (c === null) c = '';
    const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(String(c));
    const op = m[1] || '=';
    const rhs = m[2];
    if (rhs === '') {
      if (op === '=') return (v) => v === null || v === '';
      if (op === '<>') return (v) => !(v === null || v === '');
    }
    const num = LC.parseNumberLike(rhs);
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
      const match = (v) => typeof v === 'string' && re.test(v);
      return op === '=' ? match : (v) => !match(v);
    }
    return (v) => typeof v === 'string' && cmpOp(op, compare(v, rhs));
  }
  /** Shared engine for the *IFS family: returns the matching (i,j) cells. */
  function ifsMatches(pairs) {
    const first = asRange(pairs[0][0]);
    const h = first.height;
    const w = first.width;
    const tests = pairs.map(([r, c]) => {
      const rg = asRange(r);
      if (rg.height !== h || rg.width !== w) throw ERR.VALUE;
      return [rg, criterion(c)];
    });
    const out = [];
    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++) if (tests.every(([rg, t]) => t(rg.values[i][j]))) out.push([i, j]);
    }
    return out;
  }
  function pairsFrom(a, start) {
    if ((a.length - start) % 2 !== 0 || a.length - start < 2) throw ERR.VALUE;
    const pairs = [];
    for (let i = start; i < a.length; i += 2) pairs.push([a[i], a[i + 1]]);
    return pairs;
  }
  function numsAt(rg, cells) {
    const out = [];
    for (const [i, j] of cells) {
      const v = rg.values[i] && rg.values[i][j];
      if (typeof v === 'number') out.push(v);
    }
    return out;
  }

  /* ================================================================ */
  /* Math & statistics                                                */
  /* ================================================================ */
  def('SUM', 'SUM(number1, [number2], ...)', (a) => sum(numbers(a)));
  def('AVERAGE', 'AVERAGE(number1, [number2], ...)', (a) => {
    const n = numbers(a);
    if (!n.length) throw ERR.DIV0;
    return sum(n) / n.length;
  });
  def('MIN', 'MIN(number1, [number2], ...)', (a) => { const n = numbers(a); return n.length ? n.reduce((x, y) => Math.min(x, y)) : 0; });
  def('MAX', 'MAX(number1, [number2], ...)', (a) => { const n = numbers(a); return n.length ? n.reduce((x, y) => Math.max(x, y)) : 0; });
  def('COUNT', 'COUNT(value1, [value2], ...)', (a) => {
    let n = 0;
    for (const { v, ref } of each(a)) {
      if (typeof v === 'number') n++;
      else if (!ref && v !== null && !isErr(v)) {
        if (typeof v === 'boolean' || (typeof v === 'string' && LC.parseNumberLike(v))) n++;
      }
    }
    return n;
  });
  def('COUNTA', 'COUNTA(value1, [value2], ...)', (a) => { let n = 0; for (const { v } of each(a)) if (v !== null) n++; return n; });
  def('COUNTBLANK', 'COUNTBLANK(range)', (a) => { let n = 0; for (const { v } of each(a)) if (v === null || v === '') n++; return n; });
  def('PRODUCT', 'PRODUCT(number1, [number2], ...)', (a) => { const n = numbers(a); return n.length ? n.reduce((x, y) => x * y, 1) : 0; });
  def('MEDIAN', 'MEDIAN(number1, [number2], ...)', (a) => {
    const n = numbers(a).sort((x, y) => x - y);
    if (!n.length) throw ERR.NUM;
    const h = Math.floor(n.length / 2);
    return n.length % 2 ? n[h] : (n[h - 1] + n[h]) / 2;
  });
  function variance(a, sample) {
    const n = numbers(a);
    if (n.length < (sample ? 2 : 1)) throw ERR.DIV0;
    const m = sum(n) / n.length;
    return n.reduce((s, x) => s + (x - m) * (x - m), 0) / (n.length - (sample ? 1 : 0));
  }
  def('VAR', 'VAR(number1, [number2], ...)', (a) => variance(a, true));
  def('VAR.S', 'VAR.S(number1, [number2], ...)', (a) => variance(a, true));
  def('VAR.P', 'VAR.P(number1, [number2], ...)', (a) => variance(a, false));
  def('STDEV', 'STDEV(number1, [number2], ...)', (a) => Math.sqrt(variance(a, true)));
  def('STDEV.S', 'STDEV.S(number1, [number2], ...)', (a) => Math.sqrt(variance(a, true)));
  def('STDEV.P', 'STDEV.P(number1, [number2], ...)', (a) => Math.sqrt(variance(a, false)));
  function kth(a, largest) {
    argc(a, 2, 2);
    const n = numbers([a[0]]).sort((x, y) => (largest ? y - x : x - y));
    const k = int(a[1]);
    if (k < 1 || k > n.length) throw ERR.NUM;
    return n[k - 1];
  }
  def('LARGE', 'LARGE(array, k)', (a) => kth(a, true));
  def('SMALL', 'SMALL(array, k)', (a) => kth(a, false));
  function rank(a) {
    argc(a, 2, 3);
    const x = toNum(a[0]);
    const n = numbers([a[1]]);
    const asc = optNum(a, 2, 0) !== 0;
    if (!n.some((v) => round15(v) === round15(x))) throw ERR.NA;
    return 1 + n.filter((v) => (asc ? v < x : v > x)).length;
  }
  def('RANK', 'RANK(number, ref, [order])', rank);
  def('RANK.EQ', 'RANK.EQ(number, ref, [order])', rank);

  def('ABS', 'ABS(number)', (a) => { argc(a, 1, 1); return Math.abs(toNum(a[0])); });
  def('SQRT', 'SQRT(number)', (a) => { argc(a, 1, 1); const x = toNum(a[0]); if (x < 0) throw ERR.NUM; return Math.sqrt(x); });
  def('POWER', 'POWER(number, power)', (a) => {
    argc(a, 2, 2);
    const x = toNum(a[0]);
    const y = toNum(a[1]);
    if (x === 0 && y < 0) throw ERR.DIV0;
    return LC.checkNum(Math.pow(x, y));
  });
  def('MOD', 'MOD(number, divisor)', (a) => {
    argc(a, 2, 2);
    const n = toNum(a[0]);
    const d = toNum(a[1]);
    if (d === 0) throw ERR.DIV0;
    return round15(n - d * Math.floor(n / d));
  });
  def('INT', 'INT(number)', (a) => { argc(a, 1, 1); return Math.floor(toNum(a[0])); });
  def('TRUNC', 'TRUNC(number, [num_digits])', (a) => { argc(a, 1, 2); return roundTo(toNum(a[0]), Math.trunc(optNum(a, 1, 0)), 'down'); });
  def('ROUND', 'ROUND(number, num_digits)', (a) => { argc(a, 1, 2); return roundTo(toNum(a[0]), Math.trunc(optNum(a, 1, 0)), 'half'); });
  def('ROUNDUP', 'ROUNDUP(number, num_digits)', (a) => { argc(a, 1, 2); return roundTo(toNum(a[0]), Math.trunc(optNum(a, 1, 0)), 'up'); });
  def('ROUNDDOWN', 'ROUNDDOWN(number, num_digits)', (a) => { argc(a, 1, 2); return roundTo(toNum(a[0]), Math.trunc(optNum(a, 1, 0)), 'down'); });
  def('CEILING', 'CEILING(number, [significance])', (a) => {
    argc(a, 1, 2);
    const x = toNum(a[0]);
    const s = optNum(a, 1, 1);
    if (s === 0) return 0;
    return round15(Math.ceil(round15(x / s)) * s);
  });
  def('FLOOR', 'FLOOR(number, [significance])', (a) => {
    argc(a, 1, 2);
    const x = toNum(a[0]);
    const s = optNum(a, 1, 1);
    if (s === 0) throw ERR.DIV0;
    return round15(Math.floor(round15(x / s)) * s);
  });
  def('EXP', 'EXP(number)', (a) => { argc(a, 1, 1); return LC.checkNum(Math.exp(toNum(a[0]))); });
  def('LN', 'LN(number)', (a) => { argc(a, 1, 1); const x = toNum(a[0]); if (x <= 0) throw ERR.NUM; return Math.log(x); });
  def('LOG10', 'LOG10(number)', (a) => { argc(a, 1, 1); const x = toNum(a[0]); if (x <= 0) throw ERR.NUM; return Math.log10(x); });
  def('LOG', 'LOG(number, [base])', (a) => {
    argc(a, 1, 2);
    const x = toNum(a[0]);
    const b = optNum(a, 1, 10);
    if (x <= 0 || b <= 0) throw ERR.NUM;
    if (b === 1) throw ERR.DIV0;
    return round15(Math.log(x) / Math.log(b));
  });
  def('PI', 'PI()', () => Math.PI);
  def('SIGN', 'SIGN(number)', (a) => { argc(a, 1, 1); return Math.sign(toNum(a[0])); });
  def('RAND', 'RAND()', () => Math.random());
  def('RANDBETWEEN', 'RANDBETWEEN(bottom, top)', (a) => {
    argc(a, 2, 2);
    const lo = Math.ceil(toNum(a[0]));
    const hi = Math.floor(toNum(a[1]));
    if (lo > hi) throw ERR.NUM;
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  });
  def('SUMPRODUCT', 'SUMPRODUCT(array1, [array2], ...)', (a) => {
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
  });

  def('SUMIF', 'SUMIF(range, criteria, [sum_range])', (a) => {
    argc(a, 2, 3);
    const rg = asRange(a[0]);
    const sr = has(a, 2) ? asRange(a[2]) : rg;
    const cells = ifsMatches([[rg, a[1]]]);
    return sum(numsAt(sr, cells));
  });
  def('COUNTIF', 'COUNTIF(range, criteria)', (a) => { argc(a, 2, 2); return ifsMatches([[a[0], a[1]]]).length; });
  def('AVERAGEIF', 'AVERAGEIF(range, criteria, [average_range])', (a) => {
    argc(a, 2, 3);
    const rg = asRange(a[0]);
    const n = numsAt(has(a, 2) ? asRange(a[2]) : rg, ifsMatches([[rg, a[1]]]));
    if (!n.length) throw ERR.DIV0;
    return sum(n) / n.length;
  });
  def('SUMIFS', 'SUMIFS(sum_range, criteria_range1, criteria1, ...)', (a) => sum(numsAt(asRange(a[0]), ifsMatches(pairsFrom(a, 1)))));
  def('COUNTIFS', 'COUNTIFS(criteria_range1, criteria1, ...)', (a) => ifsMatches(pairsFrom(a, 0)).length);
  def('AVERAGEIFS', 'AVERAGEIFS(average_range, criteria_range1, criteria1, ...)', (a) => {
    const n = numsAt(asRange(a[0]), ifsMatches(pairsFrom(a, 1)));
    if (!n.length) throw ERR.DIV0;
    return sum(n) / n.length;
  });
  def('MAXIFS', 'MAXIFS(max_range, criteria_range1, criteria1, ...)', (a) => {
    const n = numsAt(asRange(a[0]), ifsMatches(pairsFrom(a, 1)));
    return n.length ? n.reduce((x, y) => Math.max(x, y)) : 0;
  });
  def('MINIFS', 'MINIFS(min_range, criteria_range1, criteria1, ...)', (a) => {
    const n = numsAt(asRange(a[0]), ifsMatches(pairsFrom(a, 1)));
    return n.length ? n.reduce((x, y) => Math.min(x, y)) : 0;
  });

  /* ================================================================ */
  /* Logic                                                            */
  /* ================================================================ */
  def('IF', 'IF(logical_test, [value_if_true], [value_if_false])', (a) => {
    argc(a, 1, 3);
    if (toBool(a[0])) return a.length > 1 ? (a[1] === null ? 0 : a[1]) : true;
    return a.length > 2 ? (a[2] === null ? 0 : a[2]) : false;
  });
  def('IFS', 'IFS(test1, value1, [test2, value2], ...)', (a) => {
    if (a.length < 2 || a.length % 2) throw ERR.VALUE;
    for (let i = 0; i < a.length; i += 2) if (toBool(a[i])) return a[i + 1];
    throw ERR.NA;
  });
  def('IFERROR', 'IFERROR(value, value_if_error)', (a) => { argc(a, 2, 2); return isErr(safe(a[0])) ? a[1] : a[0]; });
  def('IFNA', 'IFNA(value, value_if_na)', (a) => { argc(a, 2, 2); return safe(a[0]) === ERR.NA ? a[1] : a[0]; });
  function logicals(a) {
    const out = [];
    for (const { v, ref } of each(a)) {
      if (isErr(v)) throw v;
      if (ref) { if (typeof v === 'boolean' || typeof v === 'number') out.push(toBool(v)); }
      else if (v !== null) out.push(toBool(v));
    }
    if (!out.length) throw ERR.VALUE;
    return out;
  }
  def('AND', 'AND(logical1, [logical2], ...)', (a) => logicals(a).every(Boolean));
  def('OR', 'OR(logical1, [logical2], ...)', (a) => logicals(a).some(Boolean));
  def('XOR', 'XOR(logical1, [logical2], ...)', (a) => logicals(a).filter(Boolean).length % 2 === 1);
  def('NOT', 'NOT(logical)', (a) => { argc(a, 1, 1); return !toBool(a[0]); });
  def('TRUE', 'TRUE()', () => true);
  def('FALSE', 'FALSE()', () => false);
  def('SWITCH', 'SWITCH(expression, value1, result1, ..., [default])', (a) => {
    argc(a, 3);
    const x = scalar(a[0]);
    if (isErr(x)) throw x;
    let i = 1;
    for (; i + 1 < a.length; i += 2) if (compare(x, a[i]) === 0) return a[i + 1];
    if (i < a.length) return a[i];
    throw ERR.NA;
  });

  /* ================================================================ */
  /* Text                                                             */
  /* ================================================================ */
  const str1 = (a) => { argc(a, 1, 1); return toStr(a[0]); };
  def('CONCAT', 'CONCAT(text1, [text2], ...)', (a) => {
    let s = '';
    for (const { v } of each(a)) s += toStr(v);
    return s;
  });
  def('CONCATENATE', 'CONCATENATE(text1, [text2], ...)', (a) => a.map(toStr).join(''));
  def('TEXTJOIN', 'TEXTJOIN(delimiter, ignore_empty, text1, ...)', (a) => {
    argc(a, 3);
    const d = toStr(a[0]);
    const ignore = toBool(a[1]);
    const parts = [];
    for (const { v } of each(a.slice(2))) {
      const s = toStr(v);
      if (!(ignore && s === '')) parts.push(s);
    }
    return parts.join(d);
  });
  def('LEN', 'LEN(text)', (a) => str1(a).length);
  def('UPPER', 'UPPER(text)', (a) => str1(a).toUpperCase());
  def('LOWER', 'LOWER(text)', (a) => str1(a).toLowerCase());
  def('PROPER', 'PROPER(text)', (a) => str1(a).toLowerCase().replace(/(^|[^a-zA-ZÀ-ɏ])([a-zA-ZÀ-ɏ])/g, (m, p, c) => p + c.toUpperCase()));
  def('TRIM', 'TRIM(text)', (a) => str1(a).trim().replace(/ {2,}/g, ' '));
  def('LEFT', 'LEFT(text, [num_chars])', (a) => {
    argc(a, 1, 2);
    const n = Math.trunc(optNum(a, 1, 1));
    if (n < 0) throw ERR.VALUE;
    return toStr(a[0]).slice(0, n);
  });
  def('RIGHT', 'RIGHT(text, [num_chars])', (a) => {
    argc(a, 1, 2);
    const n = Math.trunc(optNum(a, 1, 1));
    if (n < 0) throw ERR.VALUE;
    const s = toStr(a[0]);
    return n === 0 ? '' : s.slice(-n);
  });
  def('MID', 'MID(text, start_num, num_chars)', (a) => {
    argc(a, 3, 3);
    const s = toStr(a[0]);
    const st = int(a[1]);
    const n = int(a[2]);
    if (st < 1 || n < 0) throw ERR.VALUE;
    return s.substr(st - 1, n);
  });
  def('FIND', 'FIND(find_text, within_text, [start_num])', (a) => {
    argc(a, 2, 3);
    const f = toStr(a[0]);
    const s = toStr(a[1]);
    const st = Math.trunc(optNum(a, 2, 1));
    if (st < 1 || st > s.length + 1) throw ERR.VALUE;
    const i = s.indexOf(f, st - 1);
    if (i < 0) throw ERR.VALUE;
    return i + 1;
  });
  def('SEARCH', 'SEARCH(find_text, within_text, [start_num])', (a) => {
    argc(a, 2, 3);
    const f = toStr(a[0]);
    const s = toStr(a[1]);
    const st = Math.trunc(optNum(a, 2, 1));
    if (st < 1 || st > s.length + 1) throw ERR.VALUE;
    const re = new RegExp(wildcard(f).source.slice(1, -1), 'i');
    const m = re.exec(s.slice(st - 1));
    if (!m) throw ERR.VALUE;
    return m.index + st;
  });
  def('SUBSTITUTE', 'SUBSTITUTE(text, old_text, new_text, [instance_num])', (a) => {
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
  });
  def('REPLACE', 'REPLACE(old_text, start_num, num_chars, new_text)', (a) => {
    argc(a, 4, 4);
    const s = toStr(a[0]);
    const st = int(a[1]);
    const n = int(a[2]);
    if (st < 1 || n < 0) throw ERR.VALUE;
    return s.slice(0, st - 1) + toStr(a[3]) + s.slice(st - 1 + n);
  });
  def('REPT', 'REPT(text, number_times)', (a) => {
    argc(a, 2, 2);
    const n = int(a[1]);
    if (n < 0) throw ERR.VALUE;
    return toStr(a[0]).repeat(n);
  });
  def('TEXT', 'TEXT(value, format_text)', (a) => {
    argc(a, 2, 2);
    let v = scalar(a[0]);
    if (isErr(v)) throw v;
    if (typeof v === 'string') { const p = LC.parseNumberLike(v); if (p) v = p.value; }
    return LC.formatValue(v, toStr(a[1]));
  });
  def('VALUE', 'VALUE(text)', (a) => {
    argc(a, 1, 1);
    const v = scalar(a[0]);
    if (isErr(v)) throw v;
    if (typeof v === 'number') return v;
    if (v === null) return 0;
    const p = LC.parseNumberLike(String(v));
    if (!p) throw ERR.VALUE;
    return p.value;
  });
  def('EXACT', 'EXACT(text1, text2)', (a) => { argc(a, 2, 2); return toStr(a[0]) === toStr(a[1]); });
  def('CHAR', 'CHAR(number)', (a) => { argc(a, 1, 1); const n = int(a[0]); if (n < 1 || n > 65535) throw ERR.VALUE; return String.fromCharCode(n); });
  def('CODE', 'CODE(text)', (a) => { const s = str1(a); if (!s) throw ERR.VALUE; return s.charCodeAt(0); });

  /* ================================================================ */
  /* Lookup & reference                                               */
  /* ================================================================ */
  /** Equality test used by exact-match lookups (case-insensitive, wildcards). */
  function matcher(key) {
    if (typeof key === 'string') {
      if (hasWild(key)) { const re = wildcard(key); return (v) => typeof v === 'string' && re.test(v); }
      const k = key.toLowerCase();
      return (v) => typeof v === 'string' && v.toLowerCase() === k;
    }
    if (typeof key === 'number') return (v) => typeof v === 'number' && round15(v) === round15(key);
    return (v) => v === key;
  }
  /** Approximate match in sorted data: last item <= key (or >= key if desc). */
  function approx(list, key, desc) {
    let best = -1;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (v === null || isErr(v) || typeof v !== typeof key) continue;
      const c = compare(v, key);
      if (desc ? c >= 0 : c <= 0) best = i;
      else break;
    }
    return best;
  }
  function lookupKey(v) {
    const k = scalar(v);
    if (isErr(k)) throw k;
    return k === null ? 0 : k;
  }
  function vhlookup(a, vertical) {
    argc(a, 3, 4);
    const key = lookupKey(a[0]);
    const t = asRange(a[1]);
    const idx = int(a[2]);
    const isApprox = optBool(a, 3, true);
    const n = vertical ? t.width : t.height;
    if (idx < 1) throw ERR.VALUE;
    if (idx > n) throw ERR.REF;
    const list = vertical ? t.values.map((r) => r[0]) : t.values[0] || [];
    const i = isApprox ? approx(list, key, false) : list.findIndex(matcher(key));
    if (i < 0) throw ERR.NA;
    return vertical ? t.values[i][idx - 1] : t.values[idx - 1][i];
  }
  def('VLOOKUP', 'VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])', (a) => vhlookup(a, true));
  def('HLOOKUP', 'HLOOKUP(lookup_value, table_array, row_index_num, [range_lookup])', (a) => vhlookup(a, false));
  function vector(rg) {
    if (rg.height === 1) return rg.values[0] || [];
    if (rg.width === 1) return rg.values.map((r) => r[0]);
    throw ERR.NA;
  }
  def('MATCH', 'MATCH(lookup_value, lookup_array, [match_type])', (a) => {
    argc(a, 2, 3);
    const key = lookupKey(a[0]);
    const list = vector(asRange(a[1]));
    const type = Math.trunc(optNum(a, 2, 1));
    const i = type === 0 ? list.findIndex(matcher(key)) : approx(list, key, type < 0);
    if (i < 0) throw ERR.NA;
    return i + 1;
  });
  def('INDEX', 'INDEX(array, row_num, [column_num])', (a) => {
    argc(a, 2, 3);
    const rg = asRange(a[0]);
    let r = Math.trunc(optNum(a, 1, 0));
    let c = Math.trunc(optNum(a, 2, 0));
    if (a.length < 3 && rg.height === 1 && rg.width > 1) { c = r; r = 1; }
    if (r < 0 || c < 0 || r > rg.height || c > rg.width) throw ERR.REF;
    if (rg.width === 1 && c === 0) c = 1;
    if (r === 0 && c === 0) return rg;
    if (r === 0) return new RangeValue(rg.values.map((row) => [row[c - 1]]), rg.sheet, rg.r, rg.c + c - 1);
    if (c === 0) return new RangeValue([rg.values[r - 1]], rg.sheet, rg.r + r - 1, rg.c);
    return rg.values[r - 1][c - 1];
  });
  def('XLOOKUP', 'XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode])', (a) => {
    argc(a, 3, 5);
    const key = lookupKey(a[0]);
    const look = asRange(a[1]);
    const ret = asRange(a[2]);
    const list = vector(look);
    const mode = Math.trunc(optNum(a, 4, 0));
    let i = list.findIndex(matcher(key));
    if (i < 0 && mode !== 0) {
      // -1: exact or next smaller, 1: exact or next larger
      let best = -1;
      list.forEach((v, j) => {
        if (v === null || isErr(v) || typeof v !== typeof key) return;
        const c = compare(v, key);
        if (mode < 0 && c < 0 && (best < 0 || compare(v, list[best]) > 0)) best = j;
        if (mode > 0 && c > 0 && (best < 0 || compare(v, list[best]) < 0)) best = j;
      });
      i = best;
    }
    if (i < 0) {
      if (a.length > 3) return a[3];
      throw ERR.NA;
    }
    if (look.width === 1) {
      if (ret.height !== look.height) throw ERR.VALUE;
      return ret.width === 1 ? ret.values[i][0] : new RangeValue([ret.values[i]], ret.sheet, ret.r + i, ret.c);
    }
    if (ret.width !== look.width) throw ERR.VALUE;
    return ret.height === 1 ? ret.values[0][i] : new RangeValue(ret.values.map((r) => [r[i]]), ret.sheet, ret.r, ret.c + i);
  });
  def('CHOOSE', 'CHOOSE(index_num, value1, [value2], ...)', (a) => {
    argc(a, 2);
    const i = int(a[0]);
    if (i < 1 || i >= a.length) throw ERR.VALUE;
    return a[i];
  });
  def('ROWS', 'ROWS(array)', (a) => { argc(a, 1, 1); return asRange(a[0]).height; });
  def('COLUMNS', 'COLUMNS(array)', (a) => { argc(a, 1, 1); return asRange(a[0]).width; });
  def('ROW', 'ROW([reference])', (a, ctx) => {
    if (!a.length) return ctx.row + 1;
    if (!(a[0] instanceof RangeValue) || a[0].r === undefined) throw ERR.VALUE;
    return a[0].r + 1;
  });
  def('COLUMN', 'COLUMN([reference])', (a, ctx) => {
    if (!a.length) return ctx.col + 1;
    if (!(a[0] instanceof RangeValue) || a[0].c === undefined) throw ERR.VALUE;
    return a[0].c + 1;
  });

  /* ================================================================ */
  /* Information                                                      */
  /* ================================================================ */
  const is = (name, test) => def(name, name + '(value)', (a) => { argc(a, 1, 1); return test(safe(a[0])); });
  is('ISBLANK', (v) => v === null);
  is('ISNUMBER', (v) => typeof v === 'number');
  is('ISTEXT', (v) => typeof v === 'string');
  is('ISNONTEXT', (v) => typeof v !== 'string');
  is('ISLOGICAL', (v) => typeof v === 'boolean');
  is('ISERROR', (v) => isErr(v));
  is('ISERR', (v) => isErr(v) && v !== ERR.NA);
  is('ISNA', (v) => v === ERR.NA);
  def('ISEVEN', 'ISEVEN(number)', (a) => { argc(a, 1, 1); return Math.trunc(toNum(a[0])) % 2 === 0; });
  def('ISODD', 'ISODD(number)', (a) => { argc(a, 1, 1); return Math.abs(Math.trunc(toNum(a[0])) % 2) === 1; });
  def('NA', 'NA()', () => { throw ERR.NA; });

  /* ================================================================ */
  /* Date & time (serial numbers: days since 1899-12-30)              */
  /* ================================================================ */
  const parts = (v) => {
    const n = toNum(v);
    if (n < 0) throw ERR.NUM;
    return LC.serialToDate(n);
  };
  def('TODAY', 'TODAY()', () => LC.todaySerial());
  def('NOW', 'NOW()', () => LC.nowSerial());
  def('DATE', 'DATE(year, month, day)', (a) => {
    argc(a, 3, 3);
    let y = int(a[0]);
    if (y < 1900) y += 1900;
    const s = LC.dateToSerial(y, int(a[1]), int(a[2]));
    if (s < 0) throw ERR.NUM;
    return s;
  });
  def('TIME', 'TIME(hour, minute, second)', (a) => {
    argc(a, 3, 3);
    const t = (int(a[0]) * 3600 + int(a[1]) * 60 + int(a[2])) / 86400;
    if (t < 0) throw ERR.NUM;
    return t - Math.floor(t);
  });
  def('DATEVALUE', 'DATEVALUE(date_text)', (a) => {
    const p = LC.parseNumberLike(str1(a));
    if (!p || !p.fmt || !LC.isDateFormat(p.fmt)) throw ERR.VALUE;
    return Math.floor(p.value);
  });
  def('YEAR', 'YEAR(serial_number)', (a) => { argc(a, 1, 1); return parts(a[0]).y; });
  def('MONTH', 'MONTH(serial_number)', (a) => { argc(a, 1, 1); return parts(a[0]).m; });
  def('DAY', 'DAY(serial_number)', (a) => { argc(a, 1, 1); return parts(a[0]).d; });
  def('HOUR', 'HOUR(serial_number)', (a) => { argc(a, 1, 1); return parts(a[0]).H; });
  def('MINUTE', 'MINUTE(serial_number)', (a) => { argc(a, 1, 1); return parts(a[0]).M; });
  def('SECOND', 'SECOND(serial_number)', (a) => { argc(a, 1, 1); return parts(a[0]).S; });
  def('WEEKDAY', 'WEEKDAY(serial_number, [return_type])', (a) => {
    argc(a, 1, 2);
    const dow = parts(a[0]).dow; // 0 = Sunday
    const type = Math.trunc(optNum(a, 1, 1));
    if (type === 1) return dow + 1;
    if (type === 2) return ((dow + 6) % 7) + 1;
    if (type === 3) return (dow + 6) % 7;
    throw ERR.NUM;
  });
  def('EDATE', 'EDATE(start_date, months)', (a) => {
    argc(a, 2, 2);
    const p = parts(a[0]);
    const m = p.m + int(a[1]);
    const last = new Date(Date.UTC(p.y, m, 0)).getUTCDate();
    return LC.dateToSerial(p.y, m, Math.min(p.d, last));
  });
  def('EOMONTH', 'EOMONTH(start_date, months)', (a) => {
    argc(a, 2, 2);
    const p = parts(a[0]);
    return LC.dateToSerial(p.y, p.m + int(a[1]) + 1, 0);
  });
  def('DAYS', 'DAYS(end_date, start_date)', (a) => { argc(a, 2, 2); return Math.floor(toNum(a[0])) - Math.floor(toNum(a[1])); });
  def('DATEDIF', 'DATEDIF(start_date, end_date, unit)', (a) => {
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
  });

  LC.functionNames = Object.keys(F).sort();
})(typeof window !== 'undefined' ? window : globalThis);
