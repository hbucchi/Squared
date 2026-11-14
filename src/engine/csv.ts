/** CSV / TSV reading and writing (RFC 4180-style quoting). */
import { formatValue } from './format';
import type { Sheet } from './workbook';

export function guessDelimiter(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? '';
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : ',';
}

export function parseDelimited(input: string, delim?: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const d = delim ?? guessDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let quotedField = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '' && !quotedField) {
      quoted = true;
      quotedField = true;
      continue;
    }
    if (ch === d) {
      row.push(field);
      field = '';
      quotedField = false;
      continue;
    }
    if (ch === '\r') continue;
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      quotedField = false;
      continue;
    }
    field += ch;
  }
  if (field !== '' || row.length || quotedField) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function toDelimited(rows: Array<Array<string | null | undefined>>, delim = ','): string {
  return rows.map((r) => r.map((v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /["\r\n]/.test(s) || s.includes(delim) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(delim)).join('\r\n');
}

/** Displayed values of a sheet's used area, ready for CSV export. */
export function sheetToRows(sheet: Sheet): string[][] {
  const { maxRow, maxCol } = sheet.bounds();
  const rows: string[][] = [];
  for (let r = 0; r <= maxRow; r++) {
    const row: string[] = [];
    for (let c = 0; c <= maxCol; c++) {
      const cell = sheet.get(r, c);
      row.push(cell ? formatValue(cell.value, cell.style?.fmt) : '');
    }
    rows.push(row);
  }
  return rows;
}
