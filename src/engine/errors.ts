/**
 * Spreadsheet error values (#DIV/0!, #N/A, ...).
 *
 * Errors are ordinary *values*: a cell can hold one, and most operations
 * that receive one pass it on. Internally the evaluator *throws* them so
 * they propagate automatically (1 + #N/A → #N/A).
 */
export class FormulaError {
  constructor(readonly code: ErrorCode) {}
  toString(): string {
    return this.code;
  }
}

export type ErrorCode =
  | '#NULL!' | '#DIV/0!' | '#VALUE!' | '#REF!' | '#NAME?' | '#NUM!' | '#N/A' | '#CIRC!' | '#ERROR!';

export const ERR = {
  NULL: new FormulaError('#NULL!'),
  DIV0: new FormulaError('#DIV/0!'),
  VALUE: new FormulaError('#VALUE!'),
  REF: new FormulaError('#REF!'),
  NAME: new FormulaError('#NAME?'),
  NUM: new FormulaError('#NUM!'),
  NA: new FormulaError('#N/A'),
  CIRC: new FormulaError('#CIRC!'),
  ERROR: new FormulaError('#ERROR!'),
} as const;

export const ERROR_BY_CODE: Readonly<Record<string, FormulaError>> = Object.fromEntries(
  Object.values(ERR).map((e) => [e.code, e]),
);

export const isErr = (v: unknown): v is FormulaError => v instanceof FormulaError;

/** Plain-language explanations shown in tooltips and the status bar. */
export const ERROR_HELP: Readonly<Record<ErrorCode, string>> = {
  '#NULL!': 'Ranges that do not intersect.',
  '#DIV/0!': 'Division by zero.',
  '#VALUE!': 'Wrong kind of value — e.g. text where a number was needed.',
  '#REF!': 'The formula refers to a cell or sheet that no longer exists.',
  '#NAME?': 'Unknown function or name — check the spelling.',
  '#N/A': 'Value not available — usually a lookup found no match.',
  '#NUM!': 'Invalid number — e.g. SQRT of a negative, or a result too large.',
  '#CIRC!': 'Circular reference — this formula (indirectly) depends on itself.',
  '#ERROR!': 'The formula could not be understood.',
};

/** Thrown by the parser for malformed formulas. */
export class ParseError extends Error {}
