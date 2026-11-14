/**
 * Workbook model & recalculation engine.
 *
 * Dependency graph: if C1 = A1 + B1, C1 *depends on* A1 and B1. We store
 * the reverse edges ("A1 is read by C1") so that when A1 changes we can walk
 * forward and mark every affected formula dirty:
 *
 *     A1 ──► C1 ──► D1        edit A1 → dirty = {C1, D1}
 *     B1 ──┘
 *
 * Dirty cells are evaluated on demand: evaluating D1 asks for C1, which is
 * still dirty, so C1 is evaluated first. The recursion visits cells in
 * topological order without building the order explicitly, and a cell
 * found "in progress" while being evaluated is a circular reference.
 */
import { MAX_ROWS, cellName, parseCellName } from './address';
import { ERR, ParseError } from './errors';
import { evaluateFormula, type EvalContext } from './evaluator';
import { parseInput } from './input';
import { collectRefs, parseFormula, type Ast } from './parser';
import { transformRefs, type CellPart, type RefToken } from './tokenizer';
import { RangeValue, type Scalar } from './values';

export interface CellStyle {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  wrap?: boolean;
  align?: 'left' | 'center' | 'right';
  color?: string;
  fill?: string;
  fs?: number;
  /** Number format, e.g. "#,##0.00". */
  fmt?: string;
}

export interface Cell {
  /** Exactly what the user typed, e.g. "=A1*2" or "12%". */
  raw: string;
  value: Scalar;
  ast: Ast | null;
  style: CellStyle | null;
  parseError?: string | null;
  /** Global keys of the single cells this formula reads. */
  deps?: string[] | null;
}

/** A "global key" identifies a cell in the whole workbook: "sheetId!row,col". */
export type GlobalKey = string;

interface WatchedRange { sid: number; r1: number; c1: number; r2: number; c2: number }

export class Sheet {
  /** "r,c" → cell. Only non-empty cells are stored (a sparse grid). */
  cells = new Map<string, Cell>();
  colWidths: Record<number, number> = {};
  rowCount = 200;
  colCount = 26;
  constructor(readonly id: number, public name: string) {}
  get(r: number, c: number): Cell | undefined {
    return this.cells.get(r + ',' + c);
  }
  bounds(): { maxRow: number; maxCol: number } {
    let maxRow = -1;
    let maxCol = -1;
    for (const k of this.cells.keys()) {
      const [r, c] = splitKey(k);
      if (r > maxRow) maxRow = r;
      if (c > maxCol) maxCol = c;
    }
    return { maxRow, maxCol };
  }
}

export function splitKey(k: string): [number, number] {
  const i = k.indexOf(',');
  return [+k.slice(0, i), +k.slice(i + 1)];
}

/** Thrown to unwind a too-deep evaluation chain (see _evaluate). */
class Defer {
  constructor(readonly gk: GlobalKey) {}
}
const MAX_DEPTH = 250;

export function cleanStyle(st: CellStyle | null | undefined): CellStyle | null {
  if (!st) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(st)) {
    if (v === null || v === undefined || v === false || v === '') continue;
    if (k === 'fmt' && v === 'General') continue;
    out[k] = v;
  }
  return Object.keys(out).length ? (out as CellStyle) : null;
}

export interface WorkbookJSON {
  app?: string;
  version?: number;
  sheets: Array<{
    id?: number;
    name?: string;
    rowCount?: number;
    colCount?: number;
    colWidths?: Record<number, number>;
    cells?: Record<string, { v?: string; s?: CellStyle }>;
  }>;
}

export class Workbook {
  sheets: Sheet[] = [];
  private seq = 1;
  /** gk → formulas that read it. */
  private dependents = new Map<GlobalKey, Set<GlobalKey>>();
  /** formula gk → the ranges it reads. */
  private watchers = new Map<GlobalKey, WatchedRange[]>();
  private volatile = new Set<GlobalKey>();
  // State that only exists during an evaluation pass:
  private dirty: Set<GlobalKey> | null = null;
  private visiting = new Set<GlobalKey>();
  private circular = new Set<GlobalKey>();
  private boundsCache = new Map<number, { maxRow: number; maxCol: number }>();
  private depth = 0;

  /* ---------------- sheets ---------------- */
  gk(sheet: Sheet, r: number, c: number): GlobalKey {
    return sheet.id + '!' + r + ',' + c;
  }
  static parseGk(gk: GlobalKey): { sid: number; r: number; c: number } {
    const i = gk.indexOf('!');
    const j = gk.indexOf(',', i);
    return { sid: +gk.slice(0, i), r: +gk.slice(i + 1, j), c: +gk.slice(j + 1) };
  }
  sheetById(id: number): Sheet | null {
    return this.sheets.find((s) => s.id === id) ?? null;
  }
  sheetByName(name: string): Sheet | null {
    const n = name.toLowerCase();
    return this.sheets.find((s) => s.name.toLowerCase() === n) ?? null;
  }
  uniqueSheetName(base = 'Sheet'): string {
    let i = 1;
    while (this.sheetByName(base + i)) i++;
    return base + i;
  }
  addSheet(name?: string | null, index?: number | null): Sheet {
    const s = new Sheet(this.seq++, name || this.uniqueSheetName());
    if (index === undefined || index === null) this.sheets.push(s);
    else this.sheets.splice(index, 0, s);
    this.rebuild();
    return s;
  }
  renameSheet(sheet: Sheet, newName: string): void {
    const old = sheet.name.toLowerCase();
    this.rewriteFormulas((t) => {
      if (t.sheet != null && t.sheet.toLowerCase() === old) t.sheet = newName;
      return t;
    });
    sheet.name = newName;
    this.rebuild();
  }
  removeSheet(sheet: Sheet): void {
    const old = sheet.name.toLowerCase();
    this.sheets = this.sheets.filter((s) => s !== sheet);
    this.rewriteFormulas((t) => (t.sheet != null && t.sheet.toLowerCase() === old ? null : t));
    this.rebuild();
  }
  moveSheet(sheet: Sheet, toIndex: number): void {
    this.sheets = this.sheets.filter((s) => s !== sheet);
    this.sheets.splice(toIndex, 0, sheet);
  }

  /* ---------------- cell edits ---------------- */
  /** Sets what the user typed. Does not recalculate — call recalc(). */
  setRaw(sheet: Sheet, r: number, c: number, raw: string | null | undefined, opts: { autoFormat?: boolean } = {}): GlobalKey {
    const key = r + ',' + c;
    const gk = this.gk(sheet, r, c);
    let cell = sheet.cells.get(key);
    const text = raw === null || raw === undefined ? '' : String(raw);
    if (cell) this.unregister(gk, cell);
    if (text === '' && !cell?.style) {
      sheet.cells.delete(key);
      return gk;
    }
    if (!cell) {
      cell = { raw: '', value: null, ast: null, style: null };
      sheet.cells.set(key, cell);
    }
    cell.raw = text;
    cell.ast = null;
    cell.parseError = null;
    const p = parseInput(text);
    if (p.kind === 'formula') {
      this.parseInto(cell);
      if (cell.ast) this.register(gk, sheet, cell);
    } else {
      cell.value = p.value;
      // Typing "15%" or "$4.99" also applies a matching number format.
      if (p.kind === 'value' && p.fmt && opts.autoFormat !== false && !cell.style?.fmt) {
        cell.style = { ...cell.style, fmt: p.fmt };
      }
    }
    return gk;
  }
  setStyle(sheet: Sheet, r: number, c: number, style: CellStyle | null, replace: boolean): GlobalKey {
    const key = r + ',' + c;
    let cell = sheet.cells.get(key);
    const next = cleanStyle(replace ? style : { ...cell?.style, ...style });
    if (!cell) {
      if (!next) return this.gk(sheet, r, c);
      cell = { raw: '', value: null, ast: null, style: null };
      sheet.cells.set(key, cell);
    }
    cell.style = next;
    if (!next && cell.raw === '') sheet.cells.delete(key);
    return this.gk(sheet, r, c);
  }
  private parseInto(cell: Cell): void {
    try {
      cell.ast = parseFormula(cell.raw.slice(1));
      cell.parseError = null;
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      cell.ast = null;
      cell.parseError = e.message;
      cell.value = ERR.ERROR;
    }
  }

  /* ---------------- dependency graph ---------------- */
  private register(gk: GlobalKey, sheet: Sheet, cell: Cell): void {
    const refs = collectRefs(cell.ast!);
    cell.deps = [];
    const ranges: WatchedRange[] = [];
    for (const ref of refs.cells) {
      const s = ref.sheet == null ? sheet : this.sheetByName(ref.sheet);
      if (!s) continue;
      const pk = this.gk(s, ref.r, ref.c);
      cell.deps.push(pk);
      let set = this.dependents.get(pk);
      if (!set) this.dependents.set(pk, (set = new Set()));
      set.add(gk);
    }
    for (const rg of refs.ranges) {
      const s = rg.sheet == null ? sheet : this.sheetByName(rg.sheet);
      if (s) ranges.push({ sid: s.id, r1: rg.r1, c1: rg.c1, r2: rg.r2, c2: rg.c2 });
    }
    if (ranges.length) this.watchers.set(gk, ranges);
    if (refs.volatile) this.volatile.add(gk);
  }
  private unregister(gk: GlobalKey, cell: Cell): void {
    for (const pk of cell.deps ?? []) {
      const set = this.dependents.get(pk);
      if (set) {
        set.delete(gk);
        if (!set.size) this.dependents.delete(pk);
      }
    }
    cell.deps = null;
    this.watchers.delete(gk);
    this.volatile.delete(gk);
  }
  rebuildDeps(): void {
    this.dependents.clear();
    this.watchers.clear();
    this.volatile.clear();
    for (const s of this.sheets) {
      for (const [k, cell] of s.cells) {
        if (!cell.ast) continue;
        const [r, c] = splitKey(k);
        this.register(this.gk(s, r, c), s, cell);
      }
    }
  }
  rebuild(): Set<GlobalKey> {
    this.rebuildDeps();
    return this.recalcAll();
  }

  /* ---------------- recalculation ---------------- */
  /** Recalculates everything downstream of `changed`. Returns the cells touched. */
  recalc(changed: Iterable<GlobalKey>): Set<GlobalKey> {
    const dirty = new Set<GlobalKey>();
    const stack: GlobalKey[] = [];
    const touched = new Set<GlobalKey>();
    for (const gk of changed) {
      touched.add(gk);
      stack.push(gk);
      const { sid, r, c } = Workbook.parseGk(gk);
      if (this.sheetById(sid)?.get(r, c)?.ast) dirty.add(gk);
    }
    for (const gk of this.volatile) {
      if (!dirty.has(gk)) {
        dirty.add(gk);
        stack.push(gk);
      }
    }
    const seen = new Set<GlobalKey>();
    while (stack.length) {
      const gk = stack.pop()!;
      if (seen.has(gk)) continue;
      seen.add(gk);
      for (const d of this.dependents.get(gk) ?? []) {
        if (!dirty.has(d)) {
          dirty.add(d);
          stack.push(d);
        }
      }
      if (this.watchers.size) {
        const { sid, r, c } = Workbook.parseGk(gk);
        for (const [w, ranges] of this.watchers) {
          if (dirty.has(w)) continue;
          if (ranges.some((g) => g.sid === sid && r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2)) {
            dirty.add(w);
            stack.push(w);
          }
        }
      }
    }
    for (const d of dirty) touched.add(d);
    this.evaluateDirty(dirty);
    return touched;
  }
  recalcAll(): Set<GlobalKey> {
    const dirty = new Set<GlobalKey>();
    for (const s of this.sheets) {
      for (const [k, cell] of s.cells) {
        if (cell.ast) {
          const [r, c] = splitKey(k);
          dirty.add(this.gk(s, r, c));
        }
      }
    }
    const touched = new Set(dirty);
    this.evaluateDirty(dirty);
    return touched;
  }
  private evaluateDirty(dirty: Set<GlobalKey>): void {
    if (!dirty.size) return;
    this.dirty = dirty;
    this.visiting = new Set();
    this.circular = new Set();
    this.boundsCache = new Map();
    const order = [...dirty].map((gk) => ({ gk, ...Workbook.parseGk(gk) }))
      .sort((a, b) => a.sid - b.sid || a.r - b.r || a.c - b.c);
    try {
      for (const { gk } of order) {
        if (!dirty.has(gk)) continue;
        // Explicit work stack: if a dependency chain gets too deep for the JS
        // call stack, evaluation throws Defer(x); we evaluate x first, then
        // retry. Long chains (A2=A1+1 … A50000) therefore can't overflow.
        const work: GlobalKey[] = [gk];
        while (work.length) {
          const top = work[work.length - 1];
          if (!dirty.has(top)) {
            work.pop();
            continue;
          }
          try {
            this.depth = 0;
            this.evalGk(top);
            work.pop();
          } catch (e) {
            if (!(e instanceof Defer)) throw e;
            if (work.includes(e.gk)) this.circular.add(e.gk);
            else work.push(e.gk);
          }
        }
      }
    } finally {
      this.dirty = null;
    }
  }
  private evalGk(gk: GlobalKey): Scalar {
    const { sid, r, c } = Workbook.parseGk(gk);
    const sheet = this.sheetById(sid);
    const cell = sheet?.get(r, c);
    if (!sheet || !cell || !cell.ast) {
      this.dirty!.delete(gk);
      return cell ? cell.value : null;
    }
    if (this.visiting.has(gk)) return ERR.CIRC;
    this.visiting.add(gk);
    this.depth++;
    let v: Scalar;
    try {
      v = evaluateFormula(cell.ast, this.context(sheet, r, c));
    } catch (e) {
      if (e instanceof Defer) throw e;
      console.error('Formula evaluation failed', cell.raw, e);
      v = ERR.VALUE;
    } finally {
      this.visiting.delete(gk);
      this.depth--;
    }
    cell.value = v;
    this.dirty!.delete(gk);
    return v;
  }
  private valueAt(sheet: Sheet, r: number, c: number): Scalar {
    const cell = sheet.cells.get(r + ',' + c);
    if (!cell) return null;
    if (!cell.ast || !this.dirty) return cell.value;
    const gk = sheet.id + '!' + r + ',' + c;
    if (!this.dirty.has(gk)) return cell.value;
    if (this.circular.has(gk) || this.visiting.has(gk)) return ERR.CIRC;
    if (this.depth >= MAX_DEPTH) throw new Defer(gk);
    return this.evalGk(gk);
  }
  private boundsOf(sheet: Sheet): { maxRow: number; maxCol: number } {
    let b = this.boundsCache.get(sheet.id);
    if (!b) this.boundsCache.set(sheet.id, (b = sheet.bounds()));
    return b;
  }
  private context(sheet: Sheet, r: number, c: number): EvalContext {
    const resolve = (name: string | null): Sheet => {
      if (name == null) return sheet;
      const s = this.sheetByName(name);
      if (!s) throw ERR.REF;
      return s;
    };
    return {
      row: r,
      col: c,
      sheetName: sheet.name,
      cell: (name, rr, cc) => this.valueAt(resolve(name), rr, cc),
      range: (name, r1, c1, r2, c2) => {
        const s = resolve(name);
        if (r2 >= MAX_ROWS - 1) r2 = Math.min(r2, this.boundsOf(s).maxRow); // whole column (A:A)
        const values: Scalar[][] = [];
        for (let i = r1; i <= r2; i++) {
          const row = new Array<Scalar>(c2 - c1 + 1);
          for (let j = c1; j <= c2; j++) row[j - c1] = this.valueAt(s, i, j);
          values.push(row);
        }
        return new RangeValue(values, s.name, r1, c1);
      },
    };
  }

  /* ---------------- structure: insert / delete rows & columns ---------------- */
  insertRows(sheet: Sheet, at: number, n: number): void {
    this.shift(sheet, 'r', at, n);
    sheet.rowCount += n;
  }
  deleteRows(sheet: Sheet, at: number, n: number): void {
    this.shift(sheet, 'r', at, -n);
  }
  insertCols(sheet: Sheet, at: number, n: number): void {
    this.shift(sheet, 'c', at, n);
    sheet.colCount += n;
  }
  deleteCols(sheet: Sheet, at: number, n: number): void {
    this.shift(sheet, 'c', at, -n);
  }

  /** Moves cells along an axis and rewrites every formula that points at them. */
  private shift(sheet: Sheet, axis: 'r' | 'c', at: number, n: number): void {
    const end = at - n - 1; // last deleted index when n < 0
    const moved = new Map<string, Cell>();
    for (const [k, cell] of sheet.cells) {
      let [r, c] = splitKey(k);
      let v = axis === 'r' ? r : c;
      if (n < 0 && v >= at && v <= end) continue;
      if (v >= at) v += n;
      if (axis === 'r') r = v;
      else c = v;
      moved.set(r + ',' + c, cell);
    }
    sheet.cells = moved;
    if (axis === 'c') {
      const w: Record<number, number> = {};
      for (const [k, val] of Object.entries(sheet.colWidths)) {
        const c = +k;
        if (n < 0 && c >= at && c <= end) continue;
        w[c >= at ? c + n : c] = val;
      }
      sheet.colWidths = w;
    }
    const point = (p: { r?: number; c: number }): boolean => {
      const v = p[axis]!;
      if (n > 0) {
        if (v >= at) p[axis] = v + n;
        return true;
      }
      if (v > end) {
        p[axis] = v + n;
        return true;
      }
      return v < at;
    };
    this.rewriteFormulas((t, host) => {
      const target = t.sheet == null ? host : this.sheetByName(t.sheet);
      if (target !== sheet) return t;
      if (t.type === 'ref') return point(t.a) ? t : null;
      if (t.type === 'colrange' && axis === 'r') return t;
      const a = t.a as CellPart;
      const b = t.b as CellPart;
      const lo = a[axis] <= b[axis] ? a : b;
      const hi = lo === a ? b : a;
      if (n > 0) {
        point(lo);
        point(hi);
        return t;
      }
      if (lo[axis] >= at && hi[axis] <= end) return null; // whole range deleted
      // Ranges shrink when their edge rows/columns are deleted.
      if (lo[axis] >= at && lo[axis] <= end) lo[axis] = at;
      else point(lo);
      if (hi[axis] >= at && hi[axis] <= end) hi[axis] = at - 1;
      else point(hi);
      return t;
    });
    this.rebuild();
  }
  private rewriteFormulas(fn: (t: RefToken, host: Sheet) => RefToken | null): void {
    for (const s of this.sheets) {
      for (const cell of s.cells.values()) {
        if (cell.raw[0] !== '=' || cell.raw.length < 2) continue;
        const next = transformRefs(cell.raw, (t) => fn(t, s));
        if (next !== cell.raw) {
          cell.raw = next;
          this.parseInto(cell);
        }
      }
    }
  }

  /* ---------------- persistence ---------------- */
  toJSON(): WorkbookJSON {
    return {
      app: 'LocalCalc',
      version: 1,
      sheets: this.sheets.map((s) => {
        const cells: Record<string, { v?: string; s?: CellStyle }> = {};
        for (const [k, cell] of s.cells) {
          const [r, c] = splitKey(k);
          const o: { v?: string; s?: CellStyle } = {};
          if (cell.raw !== '') o.v = cell.raw;
          if (cell.style) o.s = { ...cell.style };
          cells[cellName(r, c)] = o;
        }
        return { id: s.id, name: s.name, rowCount: s.rowCount, colCount: s.colCount, colWidths: { ...s.colWidths }, cells };
      }),
    };
  }
  static fromJSON(obj: WorkbookJSON): Workbook {
    if (!obj || !Array.isArray(obj.sheets)) throw new Error('Not a LocalCalc workbook');
    const wb = new Workbook();
    for (const sd of obj.sheets) {
      const id = Number.isInteger(sd.id) && !wb.sheetById(sd.id!) ? sd.id! : wb.seq;
      const s = new Sheet(id, sd.name || wb.uniqueSheetName());
      wb.seq = Math.max(wb.seq, id + 1);
      s.colWidths = { ...sd.colWidths };
      let maxR = -1;
      let maxC = -1;
      for (const [name, o] of Object.entries(sd.cells ?? {})) {
        const p = parseCellName(name);
        if (!p) continue;
        if (o.s) s.cells.set(p.r + ',' + p.c, { raw: '', value: null, ast: null, style: cleanStyle(o.s) });
        if (o.v !== undefined) wb.setRaw(s, p.r, p.c, o.v, { autoFormat: false });
        maxR = Math.max(maxR, p.r);
        maxC = Math.max(maxC, p.c);
      }
      s.rowCount = Math.max(sd.rowCount || 200, maxR + 20);
      s.colCount = Math.max(sd.colCount || 26, maxC + 5);
      wb.sheets.push(s);
    }
    if (!wb.sheets.length) wb.sheets.push(new Sheet(wb.seq++, 'Sheet1'));
    wb.rebuild();
    return wb;
  }
}
