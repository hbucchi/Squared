/* LocalCalc — CSV / TSV reading and writing (RFC 4180 style quoting). */
(function (global) {
  'use strict';
  const LC = global.LC;

  function guessDelimiter(text) {
    const line = text.split(/\r?\n/, 1)[0] || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (!q && ch in counts) counts[ch]++;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
      ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
      : ',';
  }

  function parseDelimited(text, delim) {
    text = text.replace(/^﻿/, '');
    if (!delim) delim = guessDelimiter(text);
    const rows = [];
    let row = [];
    let field = '';
    let q = false;
    let quotedField = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
        } else field += ch;
        continue;
      }
      if (ch === '"' && field === '' && !quotedField) { q = true; quotedField = true; continue; }
      if (ch === delim) { row.push(field); field = ''; quotedField = false; continue; }
      if (ch === '\r') continue;
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; quotedField = false; continue; }
      field += ch;
    }
    if (field !== '' || row.length || quotedField) { row.push(field); rows.push(row); }
    return rows;
  }

  function toDelimited(rows, delim = ',') {
    return rows.map((r) => r.map((v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /["\r\n]/.test(s) || s.includes(delim) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(delim)).join('\r\n');
  }

  /** Displayed values of a sheet's used area, as rows for CSV export. */
  function sheetToRows(sheet) {
    const { maxRow, maxCol } = sheet.bounds();
    const rows = [];
    for (let r = 0; r <= maxRow; r++) {
      const row = [];
      for (let c = 0; c <= maxCol; c++) {
        const cell = sheet.get(r, c);
        row.push(cell ? LC.formatValue(cell.value, cell.style && cell.style.fmt) : '');
      }
      rows.push(row);
    }
    return rows;
  }

  LC.csv = { parse: parseDelimited, stringify: toDelimited, sheetToRows, guessDelimiter };
})(typeof window !== 'undefined' ? window : globalThis);
