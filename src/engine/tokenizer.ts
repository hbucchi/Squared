/**
 * Tokenizer: turns formula text into tokens.
 *
 *   "SUM(A1:B2)*2"  →  func SUM · ( · range A1:B2 · ) · op * · num 2
 *
 * Each pattern is a "sticky" regex (flag y), which only matches exactly at
 * lastIndex — a tidy way to write a scanner.
 */
import { MAX_COLS, MAX_ROWS, colIndex, colName, quoteSheet } from './address';
import { ERROR_BY_CODE, type FormulaError } from './errors';

export interface CellPart { absC: boolean; c: number; absR: boolean; r: number }
export interface ColPart { absC: boolean; c: number }

export type RefToken =
  | { type: 'ref'; sheet: string | null; a: CellPart }
  | { type: 'range'; sheet: string | null; a: CellPart; b: CellPart }
  | { type: 'colrange'; sheet: string | null; a: ColPart; b: ColPart };

type TokenBody =
  | RefToken
  | { type: 'ws' }
  | { type: 'str'; value: string }
  | { type: 'num'; value: number }
  | { type: 'err'; value: FormulaError }
  | { type: 'bool'; value: boolean }
  | { type: 'func'; name: string }
  | { type: 'ident'; name: string }
  | { type: 'op'; value: string }
  | { type: 'lparen' } | { type: 'rparen' } | { type: 'comma' } | { type: 'unknown' };

export type Token = TokenBody & { text: string; pos: number };

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

function cellPart(absC: string, col: string, absR: string, row: string): CellPart | null {
  const c = colIndex(col);
  const r = parseInt(row, 10) - 1;
  if (c >= MAX_COLS || r < 0 || r >= MAX_ROWS) return null;
  return { absC: absC === '$', c, absR: absR === '$', r };
}
function colPart(absC: string, col: string): ColPart | null {
  const c = colIndex(col);
  return c < MAX_COLS ? { absC: absC === '$', c } : null;
}
const sheetOf = (m: RegExpExecArray): string | null =>
  m[1] != null ? m[1].replace(/''/g, "'") : m[2] != null ? m[2] : null;

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const at = (rx: RegExp): RegExpExecArray | null => {
    rx.lastIndex = i;
    return rx.exec(src);
  };
  while (i < src.length) {
    const ch = src[i];
    let m: RegExpExecArray | null;
    let a: CellPart | ColPart | null = null;
    let b: CellPart | ColPart | null = null;
    let tok: TokenBody;
    let text: string;
    if ((m = at(RX.ws))) tok = { type: 'ws' };
    else if (ch === '"' && (m = at(RX.str))) tok = { type: 'str', value: m[1].replace(/""/g, '"') };
    else if ((m = at(RX.num))) tok = { type: 'num', value: parseFloat(m[0]) };
    else if (ch === '#' && (m = at(RX.err))) tok = { type: 'err', value: ERROR_BY_CODE[m[0]] };
    else if ((m = at(RX.range)) && (a = cellPart(m[3], m[4], m[5], m[6])) && (b = cellPart(m[7], m[8], m[9], m[10]))) {
      tok = { type: 'range', sheet: sheetOf(m), a: a as CellPart, b: b as CellPart };
    } else if ((m = at(RX.colrange)) && (a = colPart(m[3], m[4])) && (b = colPart(m[5], m[6]))) {
      tok = { type: 'colrange', sheet: sheetOf(m), a, b };
    } else if ((m = at(RX.cell)) && (a = cellPart(m[3], m[4], m[5], m[6]))) {
      tok = { type: 'ref', sheet: sheetOf(m), a: a as CellPart };
    } else if ((m = at(RX.func))) tok = { type: 'func', name: m[1].toUpperCase() };
    else if ((m = at(RX.ident))) {
      const u = m[0].toUpperCase();
      tok = u === 'TRUE' || u === 'FALSE' ? { type: 'bool', value: u === 'TRUE' } : { type: 'ident', name: m[0] };
    } else if ((m = at(RX.op))) tok = { type: 'op', value: m[0] };
    else m = null;
    if (m) text = m[0];
    else {
      text = ch;
      tok = { type: ch === '(' ? 'lparen' : ch === ')' ? 'rparen' : ch === ',' ? 'comma' : 'unknown' };
    }
    out.push({ ...tok!, text, pos: i });
    i += text.length;
  }
  return out;
}

export const isRefTok = (t: Token): t is Token & RefToken =>
  t.type === 'ref' || t.type === 'range' || t.type === 'colrange';

const partText = (p: CellPart): string => (p.absC ? '$' : '') + colName(p.c) + (p.absR ? '$' : '') + (p.r + 1);
const colPartText = (p: ColPart): string => (p.absC ? '$' : '') + colName(p.c);

export function refTokenText(t: RefToken): string {
  const sh = t.sheet != null ? quoteSheet(t.sheet) + '!' : '';
  if (t.type === 'ref') return sh + partText(t.a);
  if (t.type === 'range') return sh + partText(t.a) + ':' + partText(t.b);
  return sh + colPartText(t.a) + ':' + colPartText(t.b);
}

/**
 * Rewrites every reference in a formula. `fn` gets a copy of each reference
 * token and returns it (possibly modified), or null to make it #REF!.
 * Used by copy/paste, fill, insert/delete rows & columns, sheet renames.
 */
export function transformRefs(formula: string, fn: (t: RefToken) => RefToken | null): string {
  if (formula[0] !== '=') return formula;
  let out = '=';
  for (const t of tokenize(formula.slice(1))) {
    if (isRefTok(t)) {
      const r = fn(structuredClone(t));
      out += r ? refTokenText(r) : '#REF!';
    } else out += t.text;
  }
  return out;
}

/** Relative references move by (dr, dc); $absolute parts stay put. */
export function offsetFormula(formula: string, dr: number, dc: number): string {
  return transformRefs(formula, (t) => {
    const move = (p: CellPart | ColPart): boolean => {
      if ('r' in p && !p.absR) p.r += dr;
      if (!p.absC) p.c += dc;
      return (!('r' in p) || (p.r >= 0 && p.r < MAX_ROWS)) && p.c >= 0 && p.c < MAX_COLS;
    };
    if (t.type === 'ref') return move(t.a) ? t : null;
    return move(t.a) && move(t.b) ? t : null;
  });
}

/** Upper-cases function names and references, and closes unclosed parentheses. */
export function normalizeFormula(f: string): string {
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
