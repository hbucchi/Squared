/*
 * LocalCalc — formula engine core
 *
 * A formula goes through three stages, exactly like a programming language:
 *
 *   "=SUM(A1:A3)*2"
 *        │ tokenize   → [func SUM] [(] [range A1:A3] [)] [op *] [num 2]
 *        │ parse      → AST: bin(*, func(SUM, [range]), num(2))
 *        │ evaluate   → walk the tree, asking the workbook for cell values
 *        ▼
 *       42
 *
 * This file holds: error values, A1-address helpers, the tokenizer, the
 * recursive-descent parser, the evaluator and the coercion rules.
 * The function library lives in functions.js.
 */
(function (global) {
  'use strict';
  const LC = (global.LC = global.LC || {});

  /* ------------------------------------------------------------------ */
  /* Error values                                                        */
  /* ------------------------------------------------------------------ */
  class FormulaError {
    constructor(code) { this.code = code; }
    toString() { return this.code; }
  }
  const ERR = {
    NULL: new FormulaError('#NULL!'),
    DIV0: new FormulaError('#DIV/0!'),
    VALUE: new FormulaError('#VALUE!'),
    REF: new FormulaError('#REF!'),
    NAME: new FormulaError('#NAME?'),
    NUM: new FormulaError('#NUM!'),
    NA: new FormulaError('#N/A'),
    CIRC: new FormulaError('#CIRC!'),
    ERROR: new FormulaError('#ERROR!'),
  };
  const ERROR_BY_CODE = {};
  for (const e of Object.values(ERR)) ERROR_BY_CODE[e.code] = e;
  const isErr = (v) => v instanceof FormulaError;

  class ParseError extends Error {}

  /* ------------------------------------------------------------------ */
  /* Addresses: column letters <-> indexes (0-based internally)          */
  /* ------------------------------------------------------------------ */
  const MAX_ROWS = 1048576;
  const MAX_COLS = 16384;

  // Columns are a bijective base-26 number: A=1 … Z=26, AA=27 …
  function colName(c) {
    let s = '';
    let n = c + 1;
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }
  function colIndex(name) {
    let n = 0;
    const up = name.toUpperCase();
    for (let i = 0; i < up.length; i++) n = n * 26 + (up.charCodeAt(i) - 64);
    return n - 1;
  }
  const cellName = (r, c) => colName(c) + (r + 1);
  function parseCellName(s) {
    const m = /^\s*\$?([A-Za-z]{1,3})\$?(\d+)\s*$/.exec(s);
    if (!m) return null;
    const c = colIndex(m[1]);
    const r = parseInt(m[2], 10) - 1;
    if (r < 0 || r >= MAX_ROWS || c >= MAX_COLS) return null;
    return { r, c };
  }
  function quoteSheet(name) {
    const plain = /^[A-Za-z_][\w.]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) &&
      !/^(TRUE|FALSE)$/i.test(name);
    return plain ? name : "'" + name.replace(/'/g, "''") + "'";
  }

  /* ------------------------------------------------------------------ */
  /* Tokenizer                                                           */
  /* ------------------------------------------------------------------ */
  // Sticky (/y) regexes match only at lastIndex, which makes a tidy scanner.
  const SHEET_P = "(?:'((?:[^']|'')+)'|([A-Za-z_][\\w.]*))!";
  const CELL_P = '(\\$?)([A-Za-z]{1,3})(\\$?)([0-9]+)';
  const END_P = '(?![\\w(!])';
  const RX = {
    ws: /\s+/y,
    str: /"((?:[^"]|"")*)"/y,
    num: /(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/y,
    err: /#(?:DIV\/0!|VALUE!|REF!|NAME\?|N\/A|NUM!|NULL!|CIRC!|ERROR!)/y,
    range: new RegExp('(?:' + SHEET_P + ')?' + CELL_P + ':' + CELL_P + END_P, 'y'),
    colrange: new RegExp('(?:' + SHEET_P + ')?(\\$?)([A-Za-z]{1,3}):(\\$?)([A-Za-z]{1,3})' + END_P, 'y'),
    cell: new RegExp('(?:' + SHEET_P + ')?' + CELL_P + END_P, 'y'),
    func: /([A-Za-z_][\w.]*)(?=\s*\()/y,
    ident: /[A-Za-z_][\w.]*/y,
    op: /<=|>=|<>|[-+*/^&=<>%]/y,
  };

  function cellPart(absC, col, absR, row) {
    const c = colIndex(col);
    const r = parseInt(row, 10) - 1;
    if (c >= MAX_COLS || r < 0 || r >= MAX_ROWS) return null;
    return { absC: absC === '$', c, absR: absR === '$', r };
  }
  function colPart(absC, col) {
    const c = colIndex(col);
    return c < MAX_COLS ? { absC: absC === '$', c } : null;
  }
  const sheetOf = (m) => (m[1] != null ? m[1].replace(/''/g, "'") : m[2] != null ? m[2] : null);

  function tokenize(src) {
    const out = [];
    let i = 0;
    const at = (rx) => { rx.lastIndex = i; return rx.exec(src); };
    while (i < src.length) {
      const ch = src[i];
      let m, tok, a, b;
      if ((m = at(RX.ws))) tok = { type: 'ws' };
      else if (ch === '"' && (m = at(RX.str))) tok = { type: 'str', value: m[1].replace(/""/g, '"') };
      else if ((m = at(RX.num))) tok = { type: 'num', value: parseFloat(m[0]) };
      else if (ch === '#' && (m = at(RX.err))) tok = { type: 'err', value: ERROR_BY_CODE[m[0]] };
      else if ((m = at(RX.range)) && (a = cellPart(m[3], m[4], m[5], m[6])) && (b = cellPart(m[7], m[8], m[9], m[10])))
        tok = { type: 'range', sheet: sheetOf(m), a, b };
      else if ((m = at(RX.colrange)) && (a = colPart(m[3], m[4])) && (b = colPart(m[5], m[6])))
        tok = { type: 'colrange', sheet: sheetOf(m), a, b };
      else if ((m = at(RX.cell)) && (a = cellPart(m[3], m[4], m[5], m[6])))
        tok = { type: 'ref', sheet: sheetOf(m), a };
      else if ((m = at(RX.func))) tok = { type: 'func', name: m[1].toUpperCase() };
      else if ((m = at(RX.ident))) {
        const u = m[0].toUpperCase();
        tok = u === 'TRUE' || u === 'FALSE' ? { type: 'bool', value: u === 'TRUE' } : { type: 'ident', name: m[0] };
      } else if ((m = at(RX.op))) tok = { type: 'op', value: m[0] };
      else {
        m = [ch];
        tok = { type: ch === '(' ? 'lparen' : ch === ')' ? 'rparen' : ch === ',' ? 'comma' : 'unknown' };
      }
      tok.text = m[0];
      tok.pos = i;
      i += m[0].length;
      out.push(tok);
    }
    return out;
  }

  const isRefTok = (t) => t.type === 'ref' || t.type === 'range' || t.type === 'colrange';
  const partText = (p) => (p.absC ? '$' : '') + colName(p.c) + (p.absR ? '$' : '') + (p.r + 1);
  const colPartText = (p) => (p.absC ? '$' : '') + colName(p.c);
  function refTokenText(t) {
    const sh = t.sheet != null ? quoteSheet(t.sheet) + '!' : '';
    if (t.type === 'ref') return sh + partText(t.a);
    if (t.type === 'range') return sh + partText(t.a) + ':' + partText(t.b);
    return sh + colPartText(t.a) + ':' + colPartText(t.b);
  }

  /**
   * Rewrites every reference in a formula. `fn` receives a copy of each
   * reference token and returns the (possibly modified) token, or null to
   * turn it into #REF!. Used for copy/paste, fill, inserting/deleting
   * rows & columns and renaming sheets.
   */
  function transformRefs(formula, fn) {
    if (formula[0] !== '=') return formula;
    let out = '=';
    for (const t of tokenize(formula.slice(1))) {
      if (isRefTok(t)) {
        const r = fn(JSON.parse(JSON.stringify(t)));
        out += r ? refTokenText(r) : '#REF!';
      } else out += t.text;
    }
    return out;
  }

  /** Relative references move by (dr, dc); $absolute parts stay put. */
  function offsetFormula(formula, dr, dc) {
    return transformRefs(formula, (t) => {
      const move = (p) => {
        if ('r' in p && !p.absR) p.r += dr;
        if (!p.absC) p.c += dc;
        return (!('r' in p) || (p.r >= 0 && p.r < MAX_ROWS)) && p.c >= 0 && p.c < MAX_COLS;
      };
      if (t.type === 'ref') return move(t.a) ? t : null;
      return move(t.a) && move(t.b) ? t : null;
    });
  }

  /** Upper-cases function names/refs and closes any unclosed parentheses. */
  function normalizeFormula(f) {
    if (f[0] !== '=') return f;
    const toks = tokenize(f.slice(1));
    let depth = 0;
    let out = '=';
    for (const t of toks) {
      if (isRefTok(t)) out += refTokenText(t);
      else if (t.type === 'func') out += t.name;
      else if (t.type === 'bool') out += t.value ? 'TRUE' : 'FALSE';
      else out += t.text;
      if (t.type === 'lparen') depth++;
      else if (t.type === 'rparen') depth--;
    }
    if (depth > 0 && !toks.some((t) => t.type === 'unknown')) out += ')'.repeat(depth);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Parser — recursive descent, one function per precedence level       */
  /* ------------------------------------------------------------------ */
  //  lowest   comparison  = <> < > <= >=
  //           concat      &
  //           additive    + -
  //           multiply    * /
  //           power       ^
  //           unary       - +        (binds tighter than ^, like Excel: -2^2 = 4)
  //           postfix     %
  //  highest  primary     number, "text", A1, A1:B2, FUNC(...), ( expr )
  const COMPARE_OPS = new Set(['=', '<>', '<', '>', '<=', '>=']);

  function parseFormula(src) {
    const toks = tokenize(src).filter((t) => t.type !== 'ws');
    let i = 0;
    const peek = () => toks[i];
    const isOp = (set) => toks[i] && toks[i].type === 'op' && set.has(toks[i].value);
    const fail = (msg) => { throw new ParseError(msg); };

    function binaryLevel(ops, next) {
      return function () {
        let left = next();
        while (isOp(ops)) {
          const op = toks[i++].value;
          left = { type: 'bin', op, left, right: next() };
        }
        return left;
      };
    }
    function unary() {
      if (isOp(new Set(['-', '+']))) {
        const op = toks[i++].value;
        return { type: op === '-' ? 'neg' : 'pos', arg: unary() };
      }
      return postfix();
    }
    function postfix() {
      let node = primary();
      while (isOp(new Set(['%']))) { i++; node = { type: 'pct', arg: node }; }
      return node;
    }
    const power = binaryLevel(new Set(['^']), unary);
    const multiply = binaryLevel(new Set(['*', '/']), power);
    const additive = binaryLevel(new Set(['+', '-']), multiply);
    const concat = binaryLevel(new Set(['&']), additive);
    const comparison = binaryLevel(COMPARE_OPS, concat);
    const expr = comparison;

    function primary() {
      const t = toks[i++];
      if (!t) fail('Unexpected end of formula');
      switch (t.type) {
        case 'num': return { type: 'num', value: t.value };
        case 'str': return { type: 'str', value: t.value };
        case 'bool': return { type: 'bool', value: t.value };
        case 'err': return { type: 'err', value: t.value };
        case 'ref': return { type: 'ref', sheet: t.sheet, r: t.a.r, c: t.a.c };
        case 'range':
          return {
            type: 'range', sheet: t.sheet,
            r1: Math.min(t.a.r, t.b.r), c1: Math.min(t.a.c, t.b.c),
            r2: Math.max(t.a.r, t.b.r), c2: Math.max(t.a.c, t.b.c),
          };
        case 'colrange':
          return {
            type: 'range', sheet: t.sheet, whole: true,
            r1: 0, c1: Math.min(t.a.c, t.b.c), r2: MAX_ROWS - 1, c2: Math.max(t.a.c, t.b.c),
          };
        case 'ident': return { type: 'name', name: t.name };
        case 'lparen': {
          const e = expr();
          if (!peek() || peek().type !== 'rparen') fail('Missing )');
          i++;
          return e;
        }
        case 'func': {
          if (!peek() || peek().type !== 'lparen') fail('Expected ( after ' + t.name);
          i++;
          const args = [];
          if (peek() && peek().type === 'rparen') { i++; return { type: 'func', name: t.name, args }; }
          for (;;) {
            const p = peek();
            if (!p) fail('Missing ) after arguments to ' + t.name);
            if (p.type === 'comma' || p.type === 'rparen') args.push({ type: 'empty' });
            else args.push(expr());
            const sep = toks[i++];
            if (!sep) fail('Missing ) after arguments to ' + t.name);
            if (sep.type === 'rparen') break;
            if (sep.type !== 'comma') fail('Unexpected "' + sep.text + '"');
          }
          return { type: 'func', name: t.name, args };
        }
        default:
          return fail('Unexpected "' + t.text + '"');
      }
    }

    if (!toks.length) fail('Empty formula');
    const ast = expr();
    if (i < toks.length) fail('Unexpected "' + toks[i].text + '"');
    return ast;
  }

  /* ------------------------------------------------------------------ */
  /* Values & coercion                                                   */
  /* ------------------------------------------------------------------ */
  // A cell value is: number | string | boolean | null (empty) | FormulaError.
  // A reference to several cells evaluates to a RangeValue (2-D array).
  class RangeValue {
    constructor(values, sheet, r, c) {
      this.values = values;
      this.sheet = sheet;
      this.r = r;
      this.c = c;
    }
    get height() { return this.values.length; }
    get width() { return this.values.length ? this.values[0].length : 0; }
  }

  const round15 = (x) => (x === 0 ? 0 : parseFloat(x.toPrecision(15)));

  function scalar(v) {
    if (v instanceof RangeValue) {
      if (v.height === 1 && v.width === 1) return v.values[0][0];
      throw ERR.VALUE;
    }
    return v;
  }
  function toNum(v) {
    v = scalar(v);
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (isErr(v)) throw v;
    if (typeof v === 'string') {
      if (v.trim() === '') throw ERR.VALUE;
      const p = LC.parseNumberLike ? LC.parseNumberLike(v) : null;
      if (p) return p.value;
      throw ERR.VALUE;
    }
    throw ERR.VALUE;
  }
  function numToText(n) {
    if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n);
    return String(round15(n)).replace('e', 'E');
  }
  function toStr(v) {
    v = scalar(v);
    if (v === null || v === undefined) return '';
    if (isErr(v)) throw v;
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') return numToText(v);
    return String(v);
  }
  function toBool(v) {
    v = scalar(v);
    if (v === null || v === undefined) return false;
    if (isErr(v)) throw v;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const u = String(v).toUpperCase();
    if (u === 'TRUE') return true;
    if (u === 'FALSE') return false;
    throw ERR.VALUE;
  }
  // Excel sort order across types: numbers < text < booleans.
  const typeRank = (v) => (typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : typeof v === 'boolean' ? 3 : 0);
  function compare(a, b) {
    a = scalar(a);
    b = scalar(b);
    if (isErr(a)) throw a;
    if (isErr(b)) throw b;
    const blankFor = (o) => (typeof o === 'string' ? '' : typeof o === 'boolean' ? false : 0);
    if (a === null) a = b === null ? 0 : blankFor(b);
    if (b === null) b = blankFor(a);
    const ta = typeRank(a);
    const tb = typeRank(b);
    if (ta !== tb) return ta < tb ? -1 : 1;
    if (ta === 1) { const x = round15(a), y = round15(b); return x < y ? -1 : x > y ? 1 : 0; }
    if (ta === 2) { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
    return a === b ? 0 : a ? 1 : -1;
  }
  function checkNum(x) {
    if (!isFinite(x)) throw ERR.NUM;
    return x;
  }

  /* ------------------------------------------------------------------ */
  /* Evaluator — a recursive walk over the AST                           */
  /* ------------------------------------------------------------------ */
  const FUNCS = (LC.FUNCS = LC.FUNCS || {});
  LC.FUNCTION_SIGS = LC.FUNCTION_SIGS || {};
  const VOLATILE = new Set(['NOW', 'TODAY', 'RAND', 'RANDBETWEEN']);

  function binary(op, l, r) {
    switch (op) {
      case '+': return checkNum(toNum(l) + toNum(r));
      case '-': return checkNum(toNum(l) - toNum(r));
      case '*': return checkNum(toNum(l) * toNum(r));
      case '/': {
        const n = toNum(l);
        const d = toNum(r);
        if (d === 0) throw ERR.DIV0;
        return checkNum(n / d);
      }
      case '^': {
        const n = toNum(l);
        const d = toNum(r);
        if (n === 0 && d < 0) throw ERR.DIV0;
        return checkNum(Math.pow(n, d));
      }
      case '&': return toStr(l) + toStr(r);
      case '=': return compare(l, r) === 0;
      case '<>': return compare(l, r) !== 0;
      case '<': return compare(l, r) < 0;
      case '>': return compare(l, r) > 0;
      case '<=': return compare(l, r) <= 0;
      case '>=': return compare(l, r) >= 0;
    }
    throw ERR.VALUE;
  }

  // Errors are *thrown* while evaluating so they propagate automatically
  // (1 + #N/A → #N/A). Function arguments catch them and pass them along as
  // values so that functions like IFERROR / ISERROR can inspect them.
  function evaluate(node, ctx) {
    switch (node.type) {
      case 'num': case 'str': case 'bool': case 'err': return node.value;
      case 'empty': return null;
      case 'ref': return ctx.cell(node.sheet, node.r, node.c);
      case 'range': return ctx.range(node.sheet, node.r1, node.c1, node.r2, node.c2);
      case 'name': throw ERR.NAME;
      case 'neg': return -toNum(evaluate(node.arg, ctx));
      case 'pos': return evaluate(node.arg, ctx);
      case 'pct': return toNum(evaluate(node.arg, ctx)) / 100;
      case 'bin': return binary(node.op, evaluate(node.left, ctx), evaluate(node.right, ctx));
      case 'func': {
        const fn = FUNCS[node.name];
        if (!fn) throw ERR.NAME;
        return fn(node.args.map((a) => evalArg(a, ctx)), ctx);
      }
    }
    throw ERR.VALUE;
  }
  function evalArg(node, ctx) {
    try {
      // A single-cell reference is passed as a 1×1 range so functions know
      // it came from the sheet (SUM ignores text in cells, but not literals).
      if (node.type === 'ref') return ctx.range(node.sheet, node.r, node.c, node.r, node.c);
      return evaluate(node, ctx);
    } catch (e) {
      if (e instanceof FormulaError) return e;
      throw e;
    }
  }
  function evaluateFormula(ast, ctx) {
    try {
      let v = evaluate(ast, ctx);
      if (v instanceof RangeValue) v = v.height === 1 && v.width === 1 ? v.values[0][0] : ERR.VALUE;
      if (v === null || v === undefined) v = 0;
      if (typeof v === 'number') v = isFinite(v) ? (v === 0 ? 0 : v) : ERR.NUM;
      return v;
    } catch (e) {
      if (e instanceof FormulaError) return e;
      throw e;
    }
  }

  /** Every cell/range a formula reads — the edges of the dependency graph. */
  function collectRefs(ast) {
    const out = { cells: [], ranges: [], volatile: false };
    (function walk(n) {
      switch (n.type) {
        case 'ref': out.cells.push(n); break;
        case 'range': out.ranges.push(n); break;
        case 'func':
          if (VOLATILE.has(n.name)) out.volatile = true;
          n.args.forEach(walk);
          break;
        case 'bin': walk(n.left); walk(n.right); break;
        case 'neg': case 'pos': case 'pct': walk(n.arg); break;
      }
    })(ast);
    return out;
  }

  Object.assign(LC, {
    FormulaError, ParseError, ERR, ERROR_BY_CODE, isErr,
    MAX_ROWS, MAX_COLS, colName, colIndex, cellName, parseCellName, quoteSheet,
    tokenize, refTokenText, isRefTok, transformRefs, offsetFormula, normalizeFormula,
    parseFormula, evaluateFormula, collectRefs, RangeValue,
    scalar, toNum, toStr, toBool, compare, round15, numToText, checkNum,
  });
})(typeof window !== 'undefined' ? window : globalThis);
