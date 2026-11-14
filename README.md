# LocalCalc

A spreadsheet that runs entirely on your computer: no server, no install, no network.

## Getting it on your devices (100% offline)

There are two options. Both run entirely on your device, and nothing you type is ever sent anywhere.

**A. Single file: PC, Mac, Linux, Android.**
Download `LocalCalc.html` (from the hosted app, or build it with `npm run build`).

- **On a computer:** double-click it.
- **On Android:** open it with Chrome.

It's one file with everything inside it, so you can copy it to a USB stick and it still works.

**B. Install as an app: phone, tablet, PC.**
Open the hosted version once, then install it:

- **Android (Chrome):** ⋮ menu → *Install app* / *Add to Home screen*.
- **iPhone/iPad (Safari):** Share → *Add to Home Screen*.
- **Windows/Mac (Chrome/Edge):** the install icon in the address bar.

After that it opens from its own icon and works with no internet, including flight mode.

**Building it yourself:** `npm install`, then `npm run build`. This produces `dist/LocalCalc.html` (the single file) and `dist/web/` (the installable app).

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
- **Touch:** tap to select, tap again to edit, long-press for the menu.

## How it is built

The code is TypeScript in strict mode. There are no runtime dependencies; the tools below are only used for development.

```
src/engine/              the spreadsheet engine (no browser code; runs anywhere)
  tokenizer.ts           formula text → tokens
  parser.ts              tokens → syntax tree (recursive descent)
  evaluator.ts           syntax tree → value
  values.ts              value types and coercion rules (text ↔ number ↔ boolean)
  functions/             the function library, one file per category
  workbook.ts            sheets, the dependency graph, recalculation, insert/delete
  format.ts, input.ts    number/date formats; understanding what was typed
  dates.ts, csv.ts       date serial numbers; CSV/TSV
src/ui/app.ts            the user interface
src/sw.template.js       service worker (offline cache), completed at build time
public/                  manifest and icons
tests/engine/            engine tests (Vitest)
tests/e2e/               browser tests that use the app like a person (Playwright)
```

| Command | What it does |
|---|---|
| `npm run dev` | Start a local development server with live reload |
| `npm test` | Run the engine tests (~400) |
| `npm run test:e2e` | Run the browser tests against the production build (desktop + phone) |
| `npm run typecheck` | Type-check everything |
| `npm run build` | Type-check and build `dist/` |
| `npm run check` | Run everything, as the CI does |

Every push runs the same checks on GitHub Actions; pushes to `main` are then published to GitHub Pages.

## Ideas for next steps

- `.xlsx` import/export
- Canvas-based, virtualised grid for 100k+ rows (next stage of the plan)
- Calculation engine in Rust compiled to WebAssembly
- Charts
- Freeze panes
- Borders and merged cells
- Sort and filter
- Dynamic arrays (`FILTER`, `SORT`, `UNIQUE`)
- Conditional formatting
- Named ranges
- Native installers (Electron/Tauri for desktop, Capacitor for app stores)
