/**
 * Parser: tokens → abstract syntax tree (AST).
 *
 * Recursive descent: one function per precedence level, each calling the
 * next-tighter level for its operands, so tighter operators are grouped
 * first. "1+2*3" parses as bin(+, 1, bin(*, 2, 3)).
 *
 *   lowest   comparison  = <> < > <= >=
 *            concat      &
 *            additive    + -
 *            multiply    * /
 *            power       ^
 *            unary       - +   (tighter than ^, like Excel: -2^2 = 4)
 *            postfix     %
 *   highest  primary     number, "text", A1, A1:B2, FUNC(...), (expr)
 */
import { MAX_ROWS } from './address';
import { ParseError, type FormulaError } from './errors';
import { tokenize, type Token } from './tokenizer';

export type BinOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=';

export type Ast =
  | { type: 'num'; value: number }
  | { type: 'str'; value: string }
  | { type: 'bool'; value: boolean }
  | { type: 'err'; value: FormulaError }
  | { type: 'ref'; sheet: string | null; r: number; c: number }
  | { type: 'range'; sheet: string | null; r1: number; c1: number; r2: number; c2: number; whole?: boolean }
  | { type: 'name'; name: string }
  | { type: 'empty' }
  | { type: 'neg' | 'pos' | 'pct'; arg: Ast }
  | { type: 'bin'; op: BinOp; left: Ast; right: Ast }
  | { type: 'func'; name: string; args: Ast[] };

export type RefAst = Extract<Ast, { type: 'ref' }>;
export type RangeAst = Extract<Ast, { type: 'range' }>;

const COMPARE = new Set(['=', '<>', '<', '>', '<=', '>=']);

export function parseFormula(src: string): Ast {
  const toks: Token[] = tokenize(src).filter((t) => t.type !== 'ws');
  let i = 0;
  const peek = (): Token | undefined => toks[i];
  const fail = (msg: string): never => {
    throw new ParseError(msg);
  };
  const isOp = (set: ReadonlySet<string>): boolean => {
    const t = toks[i];
    return !!t && t.type === 'op' && set.has(t.value);
  };
  const opValue = (): string => {
    const t = toks[i++];
    return t.type === 'op' ? t.value : '';
  };

  const binaryLevel = (ops: ReadonlySet<string>, next: () => Ast) => (): Ast => {
    let left = next();
    while (isOp(ops)) {
      const op = opValue() as BinOp;
      left = { type: 'bin', op, left, right: next() };
    }
    return left;
  };
  const UNARY = new Set(['-', '+']);
  const PCT = new Set(['%']);
  function unary(): Ast {
    if (isOp(UNARY)) {
      const op = opValue();
      return { type: op === '-' ? 'neg' : 'pos', arg: unary() };
    }
    return postfix();
  }
  function postfix(): Ast {
    let node = primary();
    while (isOp(PCT)) {
      i++;
      node = { type: 'pct', arg: node };
    }
    return node;
  }
  const power = binaryLevel(new Set(['^']), unary);
  const multiply = binaryLevel(new Set(['*', '/']), power);
  const additive = binaryLevel(new Set(['+', '-']), multiply);
  const concat = binaryLevel(new Set(['&']), additive);
  const expr = binaryLevel(COMPARE, concat);

  function primary(): Ast {
    const t = toks[i++];
    if (!t) return fail('Unexpected end of formula');
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
        if (peek()?.type !== 'rparen') fail('Missing )');
        i++;
        return e;
      }
      case 'func': {
        if (peek()?.type !== 'lparen') fail('Expected ( after ' + t.name);
        i++;
        const args: Ast[] = [];
        if (peek()?.type === 'rparen') {
          i++;
          return { type: 'func', name: t.name, args };
        }
        for (;;) {
          const p = peek();
          if (!p) fail('Missing ) after arguments to ' + t.name);
          if (p!.type === 'comma' || p!.type === 'rparen') args.push({ type: 'empty' });
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

const VOLATILE = new Set(['NOW', 'TODAY', 'RAND', 'RANDBETWEEN']);

export interface FormulaRefs {
  cells: RefAst[];
  ranges: RangeAst[];
  /** Uses NOW/TODAY/RAND… — must recalculate on every change. */
  volatile: boolean;
}

/** Every cell and range a formula reads: the edges of the dependency graph. */
export function collectRefs(ast: Ast): FormulaRefs {
  const out: FormulaRefs = { cells: [], ranges: [], volatile: false };
  (function walk(n: Ast): void {
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
