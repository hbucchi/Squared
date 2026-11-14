import { describe, expect, test } from 'vitest';
import {
  cellName, colIndex, colName, normalizeFormula, offsetFormula, parseCellName, parseFormula, quoteSheet, tokenize, transformRefs,
} from '../../src/engine';

describe('addresses', () => {
  test.each([[0, 'A'], [25, 'Z'], [26, 'AA'], [51, 'AZ'], [52, 'BA'], [701, 'ZZ'], [702, 'AAA'], [16383, 'XFD']])(
    'column %i ↔ %s', (i, name) => {
      expect(colName(i)).toBe(name);
      expect(colIndex(name)).toBe(i);
    },
  );

  test('cell names', () => {
    expect(cellName(0, 0)).toBe('A1');
    expect(parseCellName('$B$12')).toEqual({ r: 11, c: 1 });
    expect(parseCellName('A0')).toBeNull();
    expect(parseCellName('XFE1')).toBeNull();
    expect(parseCellName('hello')).toBeNull();
  });

  test.each([['Sheet1', 'Sheet1'], ['My Sheet', "'My Sheet'"], ["Bob's", "'Bob''s'"], ['A1', "'A1'"], ['TRUE', "'TRUE'"], ['2024', "'2024'"]])(
    'quoteSheet(%s) → %s', (n, q) => expect(quoteSheet(n)).toBe(q),
  );
});

describe('tokenizer', () => {
  const types = (s: string) => tokenize(s).filter((t) => t.type !== 'ws').map((t) => t.type);

  test.each([
    ['SUM(A1:B2)*2', ['func', 'lparen', 'range', 'rparen', 'op', 'num']],
    ['Sheet2!A1', ['ref']],
    ["'My Sheet'!$A$1:B2", ['range']],
    ['A:C', ['colrange']],
    ['LOG10(100)', ['func', 'lparen', 'num', 'rparen']], // LOG10 is a function, not a cell
    ['TRUE<>FALSE', ['bool', 'op', 'bool']],
    ['"a""b"&#N/A', ['str', 'op', 'err']],
    ['XFE1', ['ident']], // beyond the last column
    ['A1 % ', ['ref', 'op']],
    ['1.5E-3', ['num']],
    ['STDEV.S(1)', ['func', 'lparen', 'num', 'rparen']],
    ['@', ['unknown']],
  ])('%s', (src, want) => expect(types(src)).toEqual(want));

  test('string escapes and token positions', () => {
    const toks = tokenize('"a""b" & x');
    expect(toks[0]).toMatchObject({ type: 'str', value: 'a"b', pos: 0 });
    expect(toks.find((t) => t.type === 'ident')).toMatchObject({ name: 'x', pos: 9 });
  });
});

describe('parser', () => {
  test('builds a tree respecting precedence', () => {
    expect(parseFormula('1+2*3')).toEqual({
      type: 'bin', op: '+', left: { type: 'num', value: 1 },
      right: { type: 'bin', op: '*', left: { type: 'num', value: 2 }, right: { type: 'num', value: 3 } },
    });
  });

  test('empty arguments', () => {
    expect(parseFormula('IF(A1,,1)')).toMatchObject({ type: 'func', args: [{ type: 'ref' }, { type: 'empty' }, { type: 'num' }] });
  });
});

describe('reference rewriting', () => {
  test.each([
    ['=A1+$B$1+$C2+D$3', 2, 1, '=B3+$B$1+$C4+E$3'],
    ['=SUM(A1:B2)', 1, 1, '=SUM(B2:C3)'],
    ['=SUM(A:B)', 5, 1, '=SUM(B:C)'],
    ['=Sheet2!A1*2', 1, 0, '=Sheet2!A2*2'],
    ['=A1', -1, 0, '=#REF!'],
    ['="A1"&A1', 1, 0, '="A1"&A2'], // text in quotes is not a reference
  ])('offset %s by (%i,%i) → %s', (f, dr, dc, want) => expect(offsetFormula(f, dr, dc)).toBe(want));

  test.each([
    ['=sum(a1:b2', '=SUM(A1:B2)'],
    ['=if(true,1,2)', '=IF(TRUE,1,2)'],
    ['=round(sum(a1,a2),2', '=ROUND(SUM(A1,A2),2)'],
    ['=round(sum(a1,a2', '=ROUND(SUM(A1,A2))'],
    ['=  a1 + 1', '=  A1 + 1'],
    ['plain text', 'plain text'],
  ])('normalize %s → %s', (f, want) => expect(normalizeFormula(f)).toBe(want));

  test('transformRefs gives each reference to a callback', () => {
    expect(transformRefs('=A1+Data!B2', (t) => ({ ...t, sheet: 'X' }))).toBe('=X!A1+X!B2');
  });
});
