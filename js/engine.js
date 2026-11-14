/*
 * LocalCalc — workbook model & recalculation engine.
 *
 * Dependency graph: if C1 = A1 + B1, then C1 *depends on* A1 and B1.
 * We store the reverse edges ("A1 is read by C1") so that when A1 changes
 * we can walk forward and mark every affected formula dirty:
 *
 *     A1 ──► C1 ──► D1        edit A1 → dirty = {C1, D1}
 *     B1 ──┘
 *
 * Dirty cells are then evaluated on demand: evaluating D1 asks for C1,
 * which is still dirty, so C1 is evaluated first. That recursion visits
 * cells in topological order without building the order explicitly, and a
 * cell found "in progress" while being evaluated is a circular reference.
 */
(function (global) {
  'use strict';
  const LC = global.LC;
  const { ERR, FormulaError } = LC;

  class Sheet {
    constructor(id, name) {
      this.id = id;
      this.name = name;
      this.cells = new Map(); // "r,c" -> { raw, value, ast, style, parseError }
      this.colWidths = {};
      this.rowCount = 200;
      this.colCount = 26;
    }
    get(r, c) { return this.cells.get(r + ',' + c); }
    bounds() {
      let maxRow = -1;
      let maxCol = -1;
      for (const k of this.cells.keys()) {
        const i = k.indexOf(',');
        const r = +k.slice(0, i);
        const c = +k.slice(i + 1);
        if (r > maxRow) maxRow = r;
        if (c > maxCol) maxCol = c;
      }
      return { maxRow, maxCol };
    }
  }

  /** Thrown to unwind a too-deep evaluation chain (see _evaluate). */
  class Defer { constructor(gk) { this.gk = gk; } }
  const MAX_DEPTH = 250;

  const cleanStyle = (st) => {
    if (!st) return null;
    const out = {};
    for (const [k, v] of Object.entries(st)) {
      if (v === null || v === undefined || v === false || v === '') continue;
      if (k === 'fmt' && v === 'General') continue;
      out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  };

  class Workbook {
    constructor() {
      this.sheets = [];
      this.seq = 1;
      this.dependents = new Map(); // gk -> Set(gk of formulas reading it)
      this.watchers = new Map(); // gk of formula -> [ranges it reads]
      this.volatile = new Set();
      this._dirty = null;
    }

    /* ---------------- sheets ---------------- */
    gk(sheet, r, c) { return sheet.id + '!' + r + ',' + c; }
    static parseGk(gk) {
      const i = gk.indexOf('!');
      const j = gk.indexOf(',', i);
      return { sid: +gk.slice(0, i), r: +gk.slice(i + 1, j), c: +gk.slice(j + 1) };
    }
    sheetById(id) { return this.sheets.find((s) => s.id === id) || null; }
    sheetByName(name) {
      const n = String(name).toLowerCase();
      return this.sheets.find((s) => s.name.toLowerCase() === n) || null;
    }
    uniqueSheetName(base = 'Sheet') {
      let i = 1;
      while (this.sheetByName(base + i)) i++;
      return base + i;
    }
    addSheet(name, index) {
      const s = new Sheet(this.seq++, name || this.uniqueSheetName());
      if (index === undefined || index === null) this.sheets.push(s);
      else this.sheets.splice(index, 0, s);
      this.rebuild();
      return s;
    }
    renameSheet(sheet, newName) {
      const old = sheet.name.toLowerCase();
      this._rewriteFormulas((t) => {
        if (t.sheet != null && t.sheet.toLowerCase() === old) t.sheet = newName;
        return t;
      });
      sheet.name = newName;
      this.rebuild();
    }
    removeSheet(sheet) {
      const old = sheet.name.toLowerCase();
      this.sheets = this.sheets.filter((s) => s !== sheet);
      this._rewriteFormulas((t) => (t.sheet != null && t.sheet.toLowerCase() === old ? null : t));
      this.rebuild();
    }
    moveSheet(sheet, toIndex) {
      this.sheets = this.sheets.filter((s) => s !== sheet);
      this.sheets.splice(toIndex, 0, sheet);
    }

    /* ---------------- cell edits ---------------- */
    /** Sets what the user typed. Does not recalculate — call recalc(). */
    setRaw(sheet, r, c, raw, opts = {}) {
      const key = r + ',' + c;
      const gk = this.gk(sheet, r, c);
      let cell = sheet.cells.get(key);
      raw = raw === null || raw === undefined ? '' : String(raw);
      if (cell) this._unregister(gk, cell);
      if (raw === '' && !(cell && cell.style)) {
        sheet.cells.delete(key);
        return gk;
      }
      if (!cell) {
        cell = { raw: '', value: null, ast: null, style: null };
        sheet.cells.set(key, cell);
      }
      cell.raw = raw;
      cell.ast = null;
      cell.parseError = null;
      const p = LC.parseInput(raw);
      if (p.kind === 'formula') {
        this._parseInto(cell);
        if (cell.ast) this._register(gk, sheet, cell);
      } else {
        cell.value = p.value;
        // Typing "15%" or "$4.99" also applies a matching number format.
        if (p.fmt && opts.autoFormat !== false && !(cell.style && cell.style.fmt)) {
          cell.style = Object.assign({}, cell.style, { fmt: p.fmt });
        }
      }
      return gk;
    }
    setStyle(sheet, r, c, style, replace) {
      const key = r + ',' + c;
      let cell = sheet.cells.get(key);
      const next = cleanStyle(replace ? style : Object.assign({}, cell && cell.style, style));
      if (!cell) {
        if (!next) return this.gk(sheet, r, c);
        cell = { raw: '', value: null, ast: null, style: null };
        sheet.cells.set(key, cell);
      }
      cell.style = next;
      if (!next && cell.raw === '') sheet.cells.delete(key);
      return this.gk(sheet, r, c);
    }
    _parseInto(cell) {
      try {
        cell.ast = LC.parseFormula(cell.raw.slice(1));
        cell.parseError = null;
      } catch (e) {
        if (!(e instanceof LC.ParseError)) throw e;
        cell.ast = null;
        cell.parseError = e.message;
        cell.value = ERR.ERROR;
      }
    }

    /* ---------------- dependency graph ---------------- */
    _register(gk, sheet, cell) {
      const refs = LC.collectRefs(cell.ast);
      cell.deps = [];
      const ranges = [];
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
    _unregister(gk, cell) {
      if (cell.deps) {
        for (const pk of cell.deps) {
          const set = this.dependents.get(pk);
          if (set) { set.delete(gk); if (!set.size) this.dependents.delete(pk); }
        }
      }
      cell.deps = null;
      this.watchers.delete(gk);
      this.volatile.delete(gk);
    }
    rebuildDeps() {
      this.dependents.clear();
      this.watchers.clear();
      this.volatile.clear();
      for (const s of this.sheets) {
        for (const [k, cell] of s.cells) {
          if (!cell.ast) continue;
          const i = k.indexOf(',');
          this._register(this.gk(s, +k.slice(0, i), +k.slice(i + 1)), s, cell);
        }
      }
    }
    rebuild() { this.rebuildDeps(); return this.recalcAll(); }

    /* ---------------- recalculation ---------------- */
    /** Recalculates everything downstream of `changed`. Returns touched gks. */
    recalc(changed) {
      const dirty = new Set();
      const stack = [];
      for (const gk of changed) {
        stack.push(gk);
        const { sid, r, c } = Workbook.parseGk(gk);
        const s = this.sheetById(sid);
        const cell = s && s.get(r, c);
        if (cell && cell.ast) dirty.add(gk);
      }
      for (const gk of this.volatile) if (!dirty.has(gk)) { dirty.add(gk); stack.push(gk); }
      const seen = new Set();
      while (stack.length) {
        const gk = stack.pop();
        if (seen.has(gk)) continue;
        seen.add(gk);
        const deps = this.dependents.get(gk);
        if (deps) for (const d of deps) if (!dirty.has(d)) { dirty.add(d); stack.push(d); }
        if (this.watchers.size) {
          const { sid, r, c } = Workbook.parseGk(gk);
          for (const [w, ranges] of this.watchers) {
            if (dirty.has(w)) continue;
            for (const g of ranges) {
              if (g.sid === sid && r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2) {
                dirty.add(w);
                stack.push(w);
                break;
              }
            }
          }
        }
      }
      const touched = new Set(changed);
      for (const d of dirty) touched.add(d);
      this._evaluate(dirty);
      return touched;
    }
    recalcAll() {
      const dirty = new Set();
      for (const s of this.sheets) {
        for (const [k, cell] of s.cells) {
          if (cell.ast) { const i = k.indexOf(','); dirty.add(this.gk(s, +k.slice(0, i), +k.slice(i + 1))); }
        }
      }
      const touched = new Set(dirty);
      this._evaluate(dirty);
      return touched;
    }
    _evaluate(dirty) {
      if (!dirty.size) return;
      this._dirty = dirty;
      this._visiting = new Set();
      this._circular = new Set();
      this._bounds = new Map();
      const order = [...dirty].map((gk) => Object.assign({ gk }, Workbook.parseGk(gk)))
        .sort((a, b) => a.sid - b.sid || a.r - b.r || a.c - b.c);
      try {
        for (const { gk } of order) {
          if (!dirty.has(gk)) continue;
          // Explicit work stack: if a dependency chain gets too deep for the
          // JS call stack, evaluation throws Defer(x); we evaluate x first
          // and retry. Long chains (A2=A1+1 … A50000) then can't overflow.
          const work = [gk];
          while (work.length) {
            const top = work[work.length - 1];
            if (!dirty.has(top)) { work.pop(); continue; }
            try {
              this._depth = 0;
              this._evalGk(top);
              work.pop();
            } catch (e) {
              if (!(e instanceof Defer)) throw e;
              if (work.includes(e.gk)) this._circular.add(e.gk);
              else work.push(e.gk);
            }
          }
        }
      } finally {
        this._dirty = null;
        this._visiting = null;
        this._circular = null;
        this._bounds = null;
      }
    }
    _evalGk(gk) {
      const { sid, r, c } = Workbook.parseGk(gk);
      const sheet = this.sheetById(sid);
      const cell = sheet && sheet.get(r, c);
      if (!cell || !cell.ast) { this._dirty.delete(gk); return cell ? cell.value : null; }
      if (this._visiting.has(gk)) return ERR.CIRC;
      this._visiting.add(gk);
      this._depth++;
      let v;
      try {
        v = LC.evaluateFormula(cell.ast, this._ctx(sheet, r, c));
      } catch (e) {
        if (e instanceof Defer) throw e;
        console.error('Formula evaluation failed', cell.raw, e);
        v = ERR.VALUE;
      } finally {
        this._visiting.delete(gk);
        this._depth--;
      }
      cell.value = v;
      this._dirty.delete(gk);
      return v;
    }
    _valueAt(sheet, r, c) {
      const cell = sheet.cells.get(r + ',' + c);
      if (!cell) return null;
      if (!cell.ast || !this._dirty) return cell.value;
      const gk = sheet.id + '!' + r + ',' + c;
      if (!this._dirty.has(gk)) return cell.value;
      if (this._circular.has(gk) || this._visiting.has(gk)) return ERR.CIRC;
      if (this._depth >= MAX_DEPTH) throw new Defer(gk);
      return this._evalGk(gk);
    }
    _boundsOf(sheet) {
      if (this._bounds) {
        let b = this._bounds.get(sheet.id);
        if (!b) this._bounds.set(sheet.id, (b = sheet.bounds()));
        return b;
      }
      return sheet.bounds();
    }
    /** The window through which a formula sees the workbook. */
    _ctx(sheet, r, c) {
      const wb = this;
      const resolve = (name) => {
        if (name == null) return sheet;
        const s = wb.sheetByName(name);
        if (!s) throw ERR.REF;
        return s;
      };
      return {
        row: r,
        col: c,
        sheetName: sheet.name,
        cell: (name, rr, cc) => wb._valueAt(resolve(name), rr, cc),
        range: (name, r1, c1, r2, c2) => {
          const s = resolve(name);
          if (r2 >= LC.MAX_ROWS - 1) r2 = Math.min(r2, wb._boundsOf(s).maxRow); // whole column (A:A)
          const values = [];
          for (let i = r1; i <= r2; i++) {
            const row = new Array(c2 - c1 + 1);
            for (let j = c1; j <= c2; j++) row[j - c1] = wb._valueAt(s, i, j);
            values.push(row);
          }
          return new LC.RangeValue(values, s.name, r1, c1);
        },
      };
    }

    /* ---------------- structure: insert / delete rows & columns ---------------- */
    insertRows(sheet, at, n) { this._shift(sheet, 'r', at, n); sheet.rowCount += n; }
    deleteRows(sheet, at, n) { this._shift(sheet, 'r', at, -n); }
    insertCols(sheet, at, n) { this._shift(sheet, 'c', at, n); sheet.colCount += n; }
    deleteCols(sheet, at, n) { this._shift(sheet, 'c', at, -n); }

    _shift(sheet, axis, at, n) {
      const end = at - n - 1; // last deleted index when n < 0
      const moved = new Map();
      for (const [k, cell] of sheet.cells) {
        const i = k.indexOf(',');
        let r = +k.slice(0, i);
        let c = +k.slice(i + 1);
        let v = axis === 'r' ? r : c;
        if (n < 0 && v >= at && v <= end) continue;
        if (v >= at) v += n;
        if (axis === 'r') r = v; else c = v;
        moved.set(r + ',' + c, cell);
      }
      sheet.cells = moved;
      if (axis === 'c') {
        const w = {};
        for (const [k, val] of Object.entries(sheet.colWidths)) {
          const c = +k;
          if (n < 0 && c >= at && c <= end) continue;
          w[c >= at ? c + n : c] = val;
        }
        sheet.colWidths = w;
      }
      const point = (p) => {
        const v = p[axis];
        if (n > 0) { if (v >= at) p[axis] = v + n; return true; }
        if (v > end) { p[axis] = v + n; return true; }
        return v < at;
      };
      this._rewriteFormulas((t, host) => {
        const target = t.sheet == null ? host : this.sheetByName(t.sheet);
        if (target !== sheet) return t;
        if (t.type === 'ref') return point(t.a) ? t : null;
        if (t.type === 'colrange' && axis === 'r') return t;
        const lo = t.a[axis] <= t.b[axis] ? t.a : t.b;
        const hi = lo === t.a ? t.b : t.a;
        if (n > 0) { point(lo); point(hi); return t; }
        if (lo[axis] >= at && hi[axis] <= end) return null; // whole range deleted
        // Ranges shrink when their edge rows/columns are deleted.
        if (lo[axis] >= at && lo[axis] <= end) lo[axis] = at; else point(lo);
        if (hi[axis] >= at && hi[axis] <= end) hi[axis] = at - 1; else point(hi);
        return t;
      });
      this.rebuild();
    }
    _rewriteFormulas(fn) {
      for (const s of this.sheets) {
        for (const cell of s.cells.values()) {
          if (cell.raw[0] !== '=' || cell.raw.length < 2) continue;
          const next = LC.transformRefs(cell.raw, (t) => fn(t, s));
          if (next !== cell.raw) {
            cell.raw = next;
            this._parseInto(cell);
          }
        }
      }
    }

    /* ---------------- persistence ---------------- */
    toJSON() {
      return {
        app: 'LocalCalc',
        version: 1,
        sheets: this.sheets.map((s) => {
          const cells = {};
          for (const [k, cell] of s.cells) {
            const i = k.indexOf(',');
            const o = {};
            if (cell.raw !== '') o.v = cell.raw;
            if (cell.style) o.s = cell.style;
            cells[LC.cellName(+k.slice(0, i), +k.slice(i + 1))] = o;
          }
          return { id: s.id, name: s.name, rowCount: s.rowCount, colCount: s.colCount, colWidths: s.colWidths, cells };
        }),
      };
    }
    static fromJSON(obj) {
      if (!obj || !Array.isArray(obj.sheets)) throw new Error('Not a LocalCalc workbook');
      const wb = new Workbook();
      for (const sd of obj.sheets) {
        const id = Number.isInteger(sd.id) && !wb.sheetById(sd.id) ? sd.id : wb.seq;
        const s = new Sheet(id, sd.name || wb.uniqueSheetName());
        wb.seq = Math.max(wb.seq, id + 1);
        s.colWidths = Object.assign({}, sd.colWidths);
        let maxR = -1;
        let maxC = -1;
        for (const [name, o] of Object.entries(sd.cells || {})) {
          const p = LC.parseCellName(name);
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

  LC.Sheet = Sheet;
  LC.Workbook = Workbook;
  if (typeof module !== 'undefined' && module.exports) module.exports = LC;
})(typeof window !== 'undefined' ? window : globalThis);
