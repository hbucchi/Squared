# LocalCalc

A spreadsheet that runs entirely on your computer: no server, no install, no network.

**To run it:** open `index.html` in Chrome, Edge, Firefox or Safari (double-click the file).

Your work is autosaved in the browser. **File → Save** (Ctrl+S) writes a `.lcalc` file to disk.
In Chrome and Edge, later saves go straight back to the same file.

## What works today

- **Grid:** 200+ rows × 26+ columns, which grow as you scroll. Multiple sheets, resizable columns (double-click a border to autofit), and text that spills into empty cells.
- **Formulas:** about 110 Excel-compatible functions. They include SUM/AVERAGE/COUNT, the IF family,
  SUMIF(S)/COUNTIF(S), VLOOKUP/HLOOKUP/XLOOKUP/INDEX/MATCH, text, and date functions.
  Formulas also support operator precedence, `$A$1` absolute references, `Sheet2!A1` and `A:A` ranges, and Excel's error values (`#DIV/0!`, `#N/A`, `#REF!`, …). Circular references are detected.
- **Smart recalculation:** a dependency graph recalculates only the cells affected by an edit.
- **Editing:**
  - In-cell editor and formula bar.
  - Click cells while typing a formula to insert references.
  - F4 toggles `$` absolute references.
  - Function autocomplete with argument hints.
- **Excel-style shortcuts:**
  - Arrows, Ctrl+Arrows, Tab/Enter, Shift-select.
  - Ctrl+C/X/V, which also works with real Excel and Google Sheets.
  - Ctrl+D/R, Ctrl+Z/Y, Ctrl+B/I/U, Alt+= (AutoSum), Ctrl+F (Find).
- **Fill handle:** drag the ■ to copy formulas and continue series like 1, 2, 3 or "Item 1".
- **Formatting:** bold, italic, underline, strikethrough, colours, fill, alignment, wrap, and font size. Excel-style number formats (`#,##0.00`, `0.0%`, `yyyy-mm-dd`, …) are applied automatically when you type `12%` or `$5`.
- **Structure:** insert or delete rows and columns. Every formula that refers to them is rewritten, just like in Excel.
- **Files:** save/open `.lcalc` (JSON), import CSV as a new sheet, export a sheet as CSV.
- **Undo/redo** for everything.

## How it is built

```
js/formula.js    tokenizer → parser (AST) → evaluator, plus value coercion rules
js/functions.js  the function library
js/format.js     number/date formats and input parsing ("12%" → 0.12)
js/engine.js     workbook model, dependency graph, recalculation, insert/delete
js/io.js         CSV/TSV
js/app.js        the user interface
```

Run the engine tests with `npm test` (requires Node 18+).

## Ideas for next steps

- `.xlsx` import/export
- Virtualised rendering for 100k+ rows
- Charts
- Freeze panes
- Borders and merged cells
- Sort and filter
- Dynamic arrays (`FILTER`, `SORT`, `UNIQUE`)
- Conditional formatting
- Named ranges
- Packaging as a desktop app (Electron/Tauri)
