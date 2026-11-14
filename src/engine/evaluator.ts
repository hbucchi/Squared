/**
 * Evaluator: walks the AST recursively, computing each node from its
 * children (a post-order traversal).
 *
 * Errors are *thrown* while evaluating so they propagate automatically.
 * Function arguments catch them and pass them on as values, so functions
 * like IFERROR and ISERROR can inspect them.
 */
import { ERR, FormulaError } from './errors';
import { FUNCS } from './functions';
import type { Ast, BinOp } from './parser';
import { RangeValue, checkNum, compare, toNum, toStr, type Scalar, type Value } from './values';

/** How a formula sees the workbook. Provided by the Workbook. */
export interface EvalContext {
  row: number;
  col: number;
  sheetName: string;
  cell(sheet: string | null, r: number, c: number): Scalar;
  range(sheet: string | null, r1: number, c1: number, r2: number, c2: number): RangeValue;
}

function binary(op: BinOp, l: Value, r: Value): Value {
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
}

function evaluate(node: Ast, ctx: EvalContext): Value {
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
}

function evalArg(node: Ast, ctx: EvalContext): Value {
  try {
    // A single-cell reference arrives as a 1×1 range, so functions can tell
    // sheet values from typed-in values (SUM ignores text in cells).
    if (node.type === 'ref') return ctx.range(node.sheet, node.r, node.c, node.r, node.c);
    return evaluate(node, ctx);
  } catch (e) {
    if (e instanceof FormulaError) return e;
    throw e;
  }
}

/** Evaluates a parsed formula to a single cell value. */
export function evaluateFormula(ast: Ast, ctx: EvalContext): Scalar {
  try {
    let v = evaluate(ast, ctx);
    if (v instanceof RangeValue) v = v.height === 1 && v.width === 1 ? v.values[0][0] : ERR.VALUE;
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? (v === 0 ? 0 : v) : ERR.NUM;
    return v;
  } catch (e) {
    if (e instanceof FormulaError) return e;
    throw e;
  }
}
