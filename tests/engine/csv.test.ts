import { describe, expect, test } from 'vitest';
import { csv } from '../../src/engine';
import { book } from './helpers';

describe('CSV', () => {
  test('parses quotes, escaped quotes and embedded newlines', () => {
    const rows = csv.parseDelimited('a,"b,c","say ""hi"""\n1,"multi\nline",3\n');
    expect(rows).toEqual([['a', 'b,c', 'say "hi"'], ['1', 'multi\nline', '3']]);
  });

  test('round-trips through stringify', () => {
    const rows = [['a', 'b,c', 'say "hi"'], ['1', 'multi\nline', '']];
    expect(csv.parseDelimited(csv.toDelimited(rows))).toEqual(rows);
  });

  test('guesses the delimiter', () => {
    expect(csv.guessDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(csv.guessDelimiter('a\tb\n')).toBe('\t');
    expect(csv.guessDelimiter('"x;y",z')).toBe(',');
    expect(csv.guessDelimiter('single')).toBe(',');
  });

  test('handles a BOM, CRLF line endings and an empty quoted last field', () => {
    expect(csv.parseDelimited('﻿a,b\r\n1,""')).toEqual([['a', 'b'], ['1', '']]);
  });

  test('exports displayed values', () => {
    const b = book({ A1: '12%', B1: '=A1*2', A2: 'x' });
    expect(csv.sheetToRows(b.s)).toEqual([['12%', '0.24'], ['x', '']]);
  });
});
