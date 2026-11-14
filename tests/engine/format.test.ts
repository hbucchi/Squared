import { describe, expect, test } from 'vitest';
import { adjustDecimals, formatValue, generalFormat, parseInput, parseNumberLike, settings } from '../../src/engine';

describe('number formats', () => {
  test.each([
    [1234.567, '#,##0.00', '1,234.57'],
    [1234.5, '#,##0', '1,235'],
    [-1234.5, '$#,##0.00', '-$1,234.50'],
    [0.125, '0.0%', '12.5%'],
    [0.5, '0%', '50%'],
    [-5, '0;(0)', '(5)'],
    [0, '0;-0;"zero"', 'zero'],
    [-0.001, '0.00', '0.00'], // no "-0.00"
    [5, '000', '005'],
    [3.1, '0.0##', '3.1'],
    [3.14159, '0.0##', '3.142'],
    [0.5, '#.00', '.50'],
    [1234, '€#,##0.00', '€1,234.00'],
    [42, '"Total: "0', 'Total: 42'],
    [42, '0\\x', '42x'],
    [-3, '[Red]0;[Red]-0', '-3'],
    [12, '@', '12'],
  ])('%s with %s → %s', (v, f, want) => expect(formatValue(v, f)).toBe(want));

  test.each([
    [46339, 'yyyy-mm-dd', '2026-11-13'],
    [46339, 'dd/mm/yyyy', '13/11/2026'],
    [46339, 'mm/dd/yy', '11/13/26'],
    [46339, 'dddd, mmmm d', 'Friday, November 13'],
    [46339, 'ddd d mmm', 'Fri 13 Nov'],
    [46339, 'mmmmm', 'N'],
    [0.75, 'h:mm AM/PM', '6:00 PM'],
    [0.5 + 1 / 1440 * 5, 'hh:mm', '12:05'],
    [46339.25, 'yyyy-mm-dd hh:mm:ss', '2026-11-13 06:00:00'],
    [-1, 'yyyy-mm-dd', '########'],
  ])('date %s with %s → %s', (v, f, want) => expect(formatValue(v, f)).toBe(want));

  test.each([
    [1 / 3, '0.3333333333'],
    [123456789012, '1.23457E+11'],
    [0.00000000001, '1E-11'],
    [-42, '-42'],
    [0, '0'],
    [1e10, '10000000000'],
  ])('General: %s → %s', (v, want) => expect(generalFormat(v)).toBe(want));

  test('non-numbers', () => {
    expect(formatValue(null)).toBe('');
    expect(formatValue(true, '0.00')).toBe('TRUE');
    expect(formatValue('text', '0.00')).toBe('text');
  });

  test.each([
    ['#,##0.00', 1, '#,##0.000'],
    ['0%', 1, '0.0%'],
    ['0.0', -1, '0'],
    ['0', -1, '0'],
    ['$#,##0.00;($#,##0.00)', 1, '$#,##0.000;($#,##0.000)'],
    ['yyyy-mm-dd', 1, 'yyyy-mm-dd'],
  ])('adjustDecimals(%s, %s) → %s', (f, d, want) => expect(adjustDecimals(f, d)).toBe(want));

  test('adjustDecimals from General looks at the value', () => {
    expect(adjustDecimals(undefined, 1, 2.5)).toBe('0.00');
    expect(adjustDecimals('General', -1, 2.5)).toBe('0');
    expect(adjustDecimals(null, 1, 7)).toBe('0.0');
  });
});

describe('input parsing', () => {
  test.each([
    ['12%', 0.12, '0%'],
    ['12.5%', 0.125, '0.00%'],
    ['$1,200.50', 1200.5, '$#,##0.00'],
    ['-$5', -5, '$#,##0'],
    ['€3', 3, '€#,##0'],
    ['1,000', 1000, '#,##0'],
    ['1,234.5', 1234.5, '#,##0.00'],
    ['1e3', 1000, null],
    ['-0.5', -0.5, null],
    ['2026-11-13', 46339, 'yyyy-mm-dd'],
    ['9:30', 9.5 / 24, 'hh:mm'],
  ])('%s → %s (%s)', (s, v, fmt) => expect(parseNumberLike(s)).toEqual({ value: v, fmt }));

  test.each(['abc', '1,00', '12-34', '2026-02-30', '25:00', '', '1.2.3'])('%s is not a number', (s) => {
    expect(parseNumberLike(s)).toBeNull();
  });

  test('day/month order follows the setting', () => {
    const before = settings.dateOrder;
    settings.dateOrder = 'DMY';
    expect(parseNumberLike('13/11/2026')?.value).toBe(46339);
    settings.dateOrder = 'MDY';
    expect(parseNumberLike('11/13/2026')?.value).toBe(46339);
    expect(parseNumberLike('13/11/2026')).toBeNull();
    settings.dateOrder = before;
  });

  test('parseInput', () => {
    expect(parseInput('')).toEqual({ kind: 'empty', value: null });
    expect(parseInput('=A1')).toEqual({ kind: 'formula' });
    expect(parseInput('=')).toEqual({ kind: 'value', value: '=' });
    expect(parseInput("'123")).toEqual({ kind: 'value', value: '123' });
    expect(parseInput('true')).toEqual({ kind: 'value', value: true });
    expect(parseInput('hello')).toEqual({ kind: 'value', value: 'hello' });
    const na = parseInput('#N/A');
    expect(na.kind === 'value' && String(na.value)).toBe('#N/A');
  });
});
