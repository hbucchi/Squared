import { describe, expect, test } from 'vitest';
import { book, calc } from './helpers';

describe('operators and precedence', () => {
  test.each([
    ['=1+2*3', 7],
    ['=(1+2)*3', 9],
    ['=2^3^2', 64], // left-associative like Excel
    ['=-2^2', 4], // unary minus binds tighter than ^
    ['=2*-3', -6],
    ['=--5', 5],
    ['=+5', 5],
    ['=50%', 0.5],
    ['=200%%', 0.02],
    ['=10/4', 2.5],
    ['=7-2-1', 4],
    ['=8/2/2', 2],
    ['=1+2&3', '33'],
    ['=1+1=2', true],
    ['=2^0.5*2^0.5=2', true], // the product is 2.0000000000000004; comparison rounds to 15 digits
    ['=1E3+1', 1001],
    ['=.5+.5', 1],
    ['=  1 +  2 ', 3],
  ])('%s → %s', (f, want) => expect(calc(f)).toBe(want));
});

describe('comparison & coercion', () => {
  test.each([
    ['=0.1+0.2=0.3', true], // 15-digit rounding hides binary noise
    ['="abc"<"ABD"', true],
    ['="A"="a"', true], // text compares case-insensitively
    ['=1<"a"', true], // numbers sort before text
    ['="z"<TRUE', true], // text sorts before booleans
    ['=TRUE+TRUE', 2],
    ['="3"+4', 7], // numeric text is coerced
    ['="1,000"*2', 2000],
    ['="50%"*2', 1],
    ['=" 3 "+1', 4],
    ['="x"+4', '#VALUE!'],
    ['=""+1', '#VALUE!'],
    ['="a"&1&TRUE', 'a1TRUE'],
    ['=1/3&""', '0.333333333333333'],
    ['=1<>2', true],
    ['=2>=2', true],
    ['=3<=2', false],
  ])('%s → %s', (f, want) => expect(calc(f)).toBe(want));

  test('empty cells act as 0 or "" depending on context', () => {
    expect(calc('=A1+1')).toBe(1);
    expect(calc('=A1&"x"')).toBe('x');
    expect(calc('=A1=0')).toBe(true);
    expect(calc('=A1=""')).toBe(true);
    expect(calc('=A1')).toBe(0); // a formula pointing at an empty cell shows 0
  });
});

describe('errors', () => {
  test.each([
    ['=1/0', '#DIV/0!'],
    ['=0^-1', '#DIV/0!'],
    ['=FOO(1)', '#NAME?'],
    ['=undefinedname+1', '#NAME?'],
    ['=10^400', '#NUM!'],
    ['=SQRT(-1)', '#NUM!'],
    ['=#N/A', '#N/A'],
    ['=#N/A+1', '#N/A'], // errors propagate through arithmetic
    ['=1/0&"x"', '#DIV/0!'],
    ['=A1:A3', '#VALUE!'], // multi-cell result can't fit in one cell
    ['=Sheet9!A1', '#REF!'],
  ])('%s → %s', (f, want) => expect(calc(f)).toBe(want));

  test.each(['=1+', '=SUM(1', '=(1', '=1)', '=SUM(1 2)', '="abc', '=*2', '=', '=1 1'])('parse error in %s', (f) => {
    expect(calc(f)).toBe(f === '=' ? '=' : '#ERROR!');
  });

  test('parse errors keep a message for the tooltip', () => {
    const b = book({ A1: '=SUM(1' });
    expect(b.s.get(0, 0)?.parseError).toMatch(/Missing \)/);
  });
});

describe('references', () => {
  test('cell, range, absolute and whole-column references', () => {
    const b = book({ A1: '1', A2: '2', A3: '3', B1: '=A1+A2', B2: '=SUM(A1:A3)', B3: '=$A$1+A$2+$A3', B4: '=SUM(A:A)' });
    expect(b.get('B1')).toBe(3);
    expect(b.get('B2')).toBe(6);
    expect(b.get('B3')).toBe(6);
    expect(b.get('B4')).toBe(6);
  });

  test('reversed ranges are normalised', () => {
    expect(calc('=SUM(A3:A1)', { A1: '1', A2: '2', A3: '3' })).toBe(6);
  });

  test('lower-case references work', () => {
    expect(calc('=sum(a1:a2)+a1', { A1: '1', A2: '2' })).toBe(4);
  });
});
