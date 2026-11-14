/** The function registry: name → implementation, plus signatures for hints. */
import { dateFunctions } from './date';
import type { FormulaFunction, FunctionDef } from './helpers';
import { infoFunctions } from './info';
import { logicFunctions } from './logic';
import { lookupFunctions } from './lookup';
import { mathFunctions } from './math';
import { textFunctions } from './text';

export type { FormulaFunction, FunctionDef } from './helpers';

const ALL: FunctionDef[] = [
  ...mathFunctions, ...logicFunctions, ...textFunctions, ...lookupFunctions, ...infoFunctions, ...dateFunctions,
];

export const FUNCS: Readonly<Record<string, FormulaFunction>> = Object.fromEntries(ALL.map((d) => [d.name, d.fn]));
export const FUNCTION_SIGS: Readonly<Record<string, string>> = Object.fromEntries(ALL.map((d) => [d.name, d.sig]));
export const functionNames: readonly string[] = Object.keys(FUNCS).sort();
