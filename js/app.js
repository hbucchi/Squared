/*
 * LocalCalc — user interface.
 *
 * The grid is a plain <table>. Selection, the fill handle, the copy
 * marquee, etc. are absolutely-positioned overlay <div>s placed using the
 * table cells' offsetLeft/offsetTop. Keyboard input goes to a hidden
 * textarea ("keySink") so that native copy/paste events work.
 *
 * Every edit goes through applyChanges(), which records undo information,
 * asks the engine to recalculate, and re-renders only the touched cells.
 */
(function () {
  'use strict';
  const LC = window.LC;
  const DEFAULT_W = 100;
  const HEADER_W = 46;
  const AUTOSAVE_KEY = 'localcalc:autosave:v1';
  const DIRS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  const ERROR_HELP = {
    '#DIV/0!': 'Division by zero.',
    '#VALUE!': 'Wrong kind of value — e.g. text where a number was needed.',
    '#REF!': 'The formula refers to a cell or sheet that no longer exists.',
    '#NAME?': 'Unknown function or name — check the spelling.',
    '#N/A': 'Value not available — usually a lookup found no match.',
    '#NUM!': 'Invalid number — e.g. SQRT of a negative, or a result too large.',
    '#CIRC!': 'Circular reference — this formula (indirectly) depends on itself.',
    '#ERROR!': 'The formula could not be understood.',
  };

  const el = {};
  const App = {
    wb: null,
    sheet: null,
    tds: [], trs: [], cols: [], colHeads: [], rowHeads: [],
    anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 }, active: { r: 0, c: 0 },
    sel: { r1: 0, c1: 0, r2: 0, c2: 0 },
    selTds: [], hlHeads: [],
    editing: null, point: null, drag: null, resize: null, clip: null,
    undo: [], redo: [], views: new Map(),
    fileHandle: null, docName: 'Untitled', dirty: false,
    ac: { items: [], index: 0, start: 0 },
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const colW = (c) => App.sheet.colWidths[c] || DEFAULT_W;
  const isMulti = () => App.sel.r1 !== App.sel.r2 || App.sel.c1 !== App.sel.c2;
  const cloneStyle = (st) => (st ? Object.assign({}, st) : null);

  /* ================================================================== */
  /* Grid construction & rendering                                      */
  /* ================================================================== */
  function buildGrid() {
    const s = App.sheet;
    const t = el.grid;
    t.textContent = '';
    Object.assign(App, { tds: [], trs: [], cols: [], colHeads: [], rowHeads: [], selTds: [], hlHeads: [] });
    App.colgroup = document.createElement('colgroup');
    const c0 = document.createElement('col');
    c0.style.width = HEADER_W + 'px';
    App.colgroup.appendChild(c0);
    t.appendChild(App.colgroup);
    const thead = document.createElement('thead');
    App.headRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'corner';
    corner.title = 'Select all';
    App.headRow.appendChild(corner);
    thead.appendChild(App.headRow);
    t.appendChild(thead);
    App.tbody = document.createElement('tbody');
    t.appendChild(App.tbody);
    addCols(s.colCount);
    addRows(s.rowCount);
    for (const k of s.cells.keys()) {
      const i = k.indexOf(',');
      renderCell(+k.slice(0, i), +k.slice(i + 1));
    }
    updateTableWidth();
  }
  function addCols(n) {
    const start = App.cols.length;
    const end = Math.min(LC.MAX_COLS, start + n);
    for (let c = start; c < end; c++) {
      const col = document.createElement('col');
      col.style.width = colW(c) + 'px';
      App.colgroup.appendChild(col);
      App.cols.push(col);
      const th = document.createElement('th');
      th.className = 'col-head';
      th.textContent = LC.colName(c);
      const rz = document.createElement('div');
      rz.className = 'col-resizer';
      th.appendChild(rz);
      App.headRow.appendChild(th);
      App.colHeads.push(th);
    }
    App.trs.forEach((tr, r) => {
      for (let c = start; c < end; c++) {
        const td = document.createElement('td');
        tr.appendChild(td);
        App.tds[r].push(td);
      }
    });
    App.sheet.colCount = App.cols.length;
    if (App.trs.length) {
      for (const k of App.sheet.cells.keys()) {
        const i = k.indexOf(',');
        const c = +k.slice(i + 1);
        if (c >= start) renderCell(+k.slice(0, i), c);
      }
    }
    updateTableWidth();
  }
  function addRows(n) {
    const start = App.trs.length;
    const end = Math.min(LC.MAX_ROWS, start + n);
    const cols = App.cols.length;
    const frag = document.createDocumentFragment();
    for (let r = start; r < end; r++) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.className = 'row-head';
      th.textContent = r + 1;
      tr.appendChild(th);
      const row = new Array(cols);
      for (let c = 0; c < cols; c++) {
        const td = document.createElement('td');
        tr.appendChild(td);
        row[c] = td;
      }
      App.trs.push(tr);
      App.tds.push(row);
      App.rowHeads.push(th);
      frag.appendChild(tr);
    }
    App.tbody.appendChild(frag);
    App.sheet.rowCount = App.trs.length;
    if (start > 0) {
      for (const k of App.sheet.cells.keys()) {
        const i = k.indexOf(',');
        const r = +k.slice(0, i);
        if (r >= start && r < end) renderCell(r, +k.slice(i + 1));
      }
    }
  }
  function ensureSize(r, c) {
    if (r >= App.trs.length) addRows(Math.max(r + 1 - App.trs.length, 100));
    if (c >= App.cols.length) addCols(Math.max(c + 1 - App.cols.length, 10));
  }
  function updateTableWidth() {
    let w = HEADER_W;
    for (let c = 0; c < App.cols.length; c++) w += colW(c);
    el.grid.style.width = w + 'px';
  }

  function renderCell(r, c) {
    const row = App.tds[r];
    const td = row && row[c];
    if (!td) return;
    const cell = App.sheet.get(r, c);
    const selected = td.classList.contains('sel');
    if (!cell) {
      td.textContent = '';
      td.removeAttribute('style');
      td.className = selected ? 'sel' : '';
      td.removeAttribute('title');
      return;
    }
    const st = cell.style || {};
    const v = cell.value;
    const text = LC.formatValue(v, st.fmt);
    const align = st.align || (typeof v === 'number' ? 'right' : typeof v === 'boolean' || LC.isErr(v) ? 'center' : 'left');
    // Like Excel, left-aligned text spills over empty cells to its right.
    let spill = 0;
    if (typeof v === 'string' && text && align === 'left' && !st.wrap) {
      for (let j = c + 1; j < App.cols.length && spill < 3000; j++) {
        const n = App.sheet.get(r, j);
        if (n && n.raw !== '') break;
        spill += colW(j);
      }
    }
    if (spill) {
      td.textContent = '';
      const span = document.createElement('span');
      span.textContent = text;
      span.style.maxWidth = colW(c) - 9 + spill + 'px';
      td.appendChild(span);
    } else td.textContent = text;
    let css = 'text-align:' + align + ';';
    if (st.b) css += 'font-weight:700;';
    if (st.i) css += 'font-style:italic;';
    const deco = [st.u && 'underline', st.s && 'line-through'].filter(Boolean).join(' ');
    if (deco) css += 'text-decoration:' + deco + ';';
    if (st.color) css += 'color:' + st.color + ';';
    if (st.fill) css += 'background:' + st.fill + ';';
    if (st.fs) css += 'font-size:' + st.fs + 'px;';
    td.style.cssText = css;
    td.className = (selected ? 'sel ' : '') + (st.wrap ? 'wrap' : '') + (spill ? ' spill' : '');
    if (cell.parseError) td.title = 'Formula error: ' + cell.parseError;
    else if (LC.isErr(v)) td.title = v.code + ' — ' + (ERROR_HELP[v.code] || '');
    else td.removeAttribute('title');
  }

  /** A cell's content changed: the nearest filled cell to its left may spill differently now. */
  function renderSpillSource(r, c) {
    for (let j = c - 1; j >= 0 && j >= c - 40; j--) {
      const n = App.sheet.get(r, j);
      if (n && n.raw !== '') { renderCell(r, j); return; }
    }
  }
  function renderAllCells() {
    for (const k of App.sheet.cells.keys()) {
      const i = k.indexOf(',');
      renderCell(+k.slice(0, i), +k.slice(i + 1));
    }
  }

  /* ================================================================== */
  /* Selection & overlays                                               */
  /* ================================================================== */
  function setSel(anchor, focus, active) {
    App.anchor = anchor;
    App.focus = focus;
    App.active = active || anchor;
    App.sel = {
      r1: Math.min(anchor.r, focus.r), c1: Math.min(anchor.c, focus.c),
      r2: Math.max(anchor.r, focus.r), c2: Math.max(anchor.c, focus.c),
    };
    drawSelection();
    updateFormulaBar();
    updateStatus();
    updateToolbarState();
  }
  function selectCell(r, c, extend) {
    r = clamp(r, 0, LC.MAX_ROWS - 1);
    c = clamp(c, 0, LC.MAX_COLS - 1);
    ensureSize(r, c);
    if (extend) {
      if (App.focus.r === r && App.focus.c === c) return;
      setSel(App.anchor, { r, c }, App.active);
    } else setSel({ r, c }, { r, c }, { r, c });
  }
  const lastRow = () => App.trs.length - 1;
  const lastCol = () => App.cols.length - 1;
  function selectCols(from, to) { setSel({ r: 0, c: from }, { r: lastRow(), c: to }, { r: 0, c: from }); }
  function selectRows(from, to) { setSel({ r: from, c: 0 }, { r: to, c: lastCol() }, { r: from, c: 0 }); }
  function selectAll() { setSel({ r: 0, c: 0 }, { r: lastRow(), c: lastCol() }, App.active); }
  const inSel = (r, c) => r >= App.sel.r1 && r <= App.sel.r2 && c >= App.sel.c1 && c <= App.sel.c2;

  function drawSelection() {
    for (const td of App.selTds) td.classList.remove('sel');
    for (const th of App.hlHeads) th.classList.remove('hl', 'full');
    App.selTds = [];
    App.hlHeads = [];
    const { r1, c1, r2, c2 } = App.sel;
    const a = App.active;
    if (isMulti()) {
      for (let r = r1; r <= r2 && r < App.tds.length; r++) {
        const row = App.tds[r];
        for (let c = c1; c <= c2 && c < row.length; c++) {
          if (r === a.r && c === a.c) continue;
          row[c].classList.add('sel');
          App.selTds.push(row[c]);
        }
      }
    }
    const fullCols = r1 === 0 && r2 >= lastRow();
    const fullRows = c1 === 0 && c2 >= lastCol();
    for (let c = c1; c <= c2 && c < App.colHeads.length; c++) {
      App.colHeads[c].classList.add(fullCols ? 'full' : 'hl');
      App.hlHeads.push(App.colHeads[c]);
    }
    for (let r = r1; r <= r2 && r < App.rowHeads.length; r++) {
      App.rowHeads[r].classList.add(fullRows ? 'full' : 'hl');
      App.hlHeads.push(App.rowHeads[r]);
    }
    positionOverlays();
  }
  function rectPx(r1, c1, r2, c2) {
    r2 = Math.min(r2, lastRow());
    c2 = Math.min(c2, lastCol());
    const a = App.tds[r1][c1];
    const b = App.tds[r2][c2];
    return {
      left: a.offsetLeft, top: a.offsetTop,
      width: b.offsetLeft + b.offsetWidth - a.offsetLeft,
      height: b.offsetTop + b.offsetHeight - a.offsetTop,
    };
  }
  function placeBox(box, rc) {
    box.style.left = rc.left - 1 + 'px';
    box.style.top = rc.top - 1 + 'px';
    box.style.width = rc.width + 1 + 'px';
    box.style.height = rc.height + 1 + 'px';
  }
  function positionOverlays() {
    const { r1, c1, r2, c2 } = App.sel;
    const rc = rectPx(r1, c1, r2, c2);
    placeBox(el.selBox, rc);
    el.fillHandle.style.left = rc.left + rc.width - 5 + 'px';
    el.fillHandle.style.top = rc.top + rc.height - 5 + 'px';
    el.fillHandle.hidden = !!App.editing;
    const clip = App.clip;
    if (clip && clip.sheetId === App.sheet.id) {
      placeBox(el.clipBox, rectPx(clip.rect.r1, clip.rect.c1, clip.rect.r2, clip.rect.c2));
      el.clipBox.hidden = false;
    } else el.clipBox.hidden = true;
    if (App.editing) positionEditor();
  }
  function scrollToCell(r, c) {
    const td = App.tds[r] && App.tds[r][c];
    if (!td) return;
    const w = el.gridWrap;
    const headH = App.headRow.offsetHeight;
    const top = td.offsetTop;
    const left = td.offsetLeft;
    if (top - headH < w.scrollTop) w.scrollTop = top - headH;
    else if (top + td.offsetHeight > w.scrollTop + w.clientHeight) w.scrollTop = top + td.offsetHeight - w.clientHeight;
    if (left - HEADER_W < w.scrollLeft) w.scrollLeft = left - HEADER_W;
    else if (left + td.offsetWidth > w.scrollLeft + w.clientWidth) w.scrollLeft = left + td.offsetWidth - w.clientWidth;
  }
  const scrollToFocus = () => scrollToCell(App.focus.r, App.focus.c);
  const scrollToActive = () => scrollToCell(App.active.r, App.active.c);

  /** Enter/Tab inside a multi-cell selection walk through it, like Excel. */
  function moveWithin(dr, dc) {
    const { r1, c1, r2, c2 } = App.sel;
    let { r, c } = App.active;
    if (dr) {
      r += dr;
      if (r > r2) { r = r1; c = c + 1 > c2 ? c1 : c + 1; }
      else if (r < r1) { r = r2; c = c - 1 < c1 ? c2 : c - 1; }
    } else {
      c += dc;
      if (c > c2) { c = c1; r = r + 1 > r2 ? r1 : r + 1; }
      else if (c < c1) { c = c2; r = r - 1 < r1 ? r2 : r - 1; }
    }
    App.active = { r, c };
    drawSelection();
    updateFormulaBar();
    updateToolbarState();
    scrollToActive();
  }
  function move(dr, dc) {
    if (isMulti()) moveWithin(dr, dc);
    else { selectCell(App.active.r + dr, App.active.c + dc); scrollToActive(); }
  }
  /** Ctrl+Arrow: jump to the edge of the current block of data. */
  function jump(from, dr, dc) {
    const s = App.sheet;
    const filled = (r, c) => { const cell = s.get(r, c); return !!cell && cell.raw !== ''; };
    const inside = (r, c) => r >= 0 && c >= 0 && r <= lastRow() && c <= lastCol();
    let r = from.r + dr;
    let c = from.c + dc;
    if (!inside(r, c)) return from;
    if (filled(from.r, from.c) && filled(r, c)) {
      while (inside(r + dr, c + dc) && filled(r + dr, c + dc)) { r += dr; c += dc; }
      return { r, c };
    }
    while (inside(r, c) && !filled(r, c)) { r += dr; c += dc; }
    if (!inside(r, c)) { r -= dr; c -= dc; }
    return { r, c };
  }

  function updateFormulaBar() {
    const { r, c } = App.active;
    el.nameBox.value = LC.cellName(r, c);
    if (!App.editing) {
      const cell = App.sheet.get(r, c);
      el.formulaInput.value = cell ? cell.raw : '';
    }
  }
  function updateStatus() {
    const { r1, c1, r2, c2 } = App.sel;
    const s = App.sheet;
    if (!isMulti()) {
      const cell = s.get(r1, c1);
      el.status.innerHTML = cell && LC.isErr(cell.value) ? esc(ERROR_HELP[cell.value.code] || '') : '';
      return;
    }
    let count = 0;
    let nums = 0;
    let sum = 0;
    const visit = (cell) => {
      if (!cell || cell.raw === '') return;
      count++;
      if (typeof cell.value === 'number') { nums++; sum += cell.value; }
    };
    if ((r2 - r1 + 1) * (c2 - c1 + 1) > s.cells.size) {
      for (const [k, cell] of s.cells) {
        const i = k.indexOf(',');
        if (inSel(+k.slice(0, i), +k.slice(i + 1))) visit(cell);
      }
    } else {
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) visit(s.get(r, c));
    }
    const fmt = (n) => LC.formatValue(LC.round15(n), Number.isInteger(LC.round15(n)) ? '#,##0' : '#,##0.####');
    const parts = [];
    if (nums) parts.push('<span>Average: <b>' + fmt(sum / nums) + '</b></span>');
    if (count) parts.push('<span>Count: <b>' + count + '</b></span>');
    if (nums) parts.push('<span>Sum: <b>' + fmt(sum) + '</b></span>');
    el.status.innerHTML = parts.join('');
  }
  function updateToolbarState() {
    const cell = App.sheet.get(App.active.r, App.active.c);
    const st = (cell && cell.style) || {};
    const on = { bold: st.b, italic: st.i, underline: st.u, strike: st.s, wrap: st.wrap,
      alignLeft: st.align === 'left', alignCenter: st.align === 'center', alignRight: st.align === 'right' };
    for (const [cmd, v] of Object.entries(on)) {
      document.querySelectorAll('.toolbar [data-cmd="' + cmd + '"]').forEach((b) => b.classList.toggle('on', !!v));
    }
    const fmt = st.fmt || 'General';
    const opt = Array.from(el.numFormat.options).find((o) => o.value === fmt && !o.disabled);
    el.numFormat.value = opt ? fmt : 'custom';
    el.fontSize.value = st.fs ? String(st.fs) : '';
  }

  /* ================================================================== */
  /* Changes, undo & redo                                               */
  /* ================================================================== */
  const snap = (s, r, c) => {
    const cell = s.get(r, c);
    return cell ? { raw: cell.raw, style: cloneStyle(cell.style) } : { raw: '', style: null };
  };
  /**
   * changes: [{sheet, r, c, raw?, style?}] — `style` replaces the whole style.
   */
  function applyChanges(changes) {
    if (!changes.length) return;
    const recs = [];
    const gks = [];
    let valuesChanged = false;
    for (const ch of changes) {
      const s = ch.sheet;
      const before = snap(s, ch.r, ch.c);
      if ('style' in ch) App.wb.setStyle(s, ch.r, ch.c, ch.style, true);
      if ('raw' in ch) {
        App.wb.setRaw(s, ch.r, ch.c, ch.raw, { autoFormat: !('style' in ch) });
        valuesChanged = true;
      }
      recs.push({ sid: s.id, r: ch.r, c: ch.c, before, after: snap(s, ch.r, ch.c) });
      gks.push(App.wb.gk(s, ch.r, ch.c));
    }
    pushUndo({ type: 'cells', recs });
    afterChange(gks, valuesChanged);
  }
  function afterChange(gks, recalc) {
    const touched = recalc ? App.wb.recalc(gks) : new Set(gks);
    const sid = App.sheet.id;
    for (const gk of touched) {
      const p = LC.Workbook.parseGk(gk);
      if (p.sid !== sid) continue;
      ensureSize(p.r, p.c);
      renderCell(p.r, p.c);
      renderSpillSource(p.r, p.c);
    }
    positionOverlays();
    updateFormulaBar();
    updateStatus();
    updateToolbarState();
    markChanged();
  }
  function pushUndo(entry) {
    App.undo.push(entry);
    if (App.undo.length > 300) App.undo.shift();
    App.redo.length = 0;
  }
  function restoreRecs(recs, which) {
    const list = which === 'before' ? recs.slice().reverse() : recs;
    const gks = [];
    for (const rec of list) {
      const s = App.wb.sheetById(rec.sid);
      if (!s) continue;
      const d = rec[which];
      App.wb.setStyle(s, rec.r, rec.c, d.style, true);
      App.wb.setRaw(s, rec.r, rec.c, d.raw, { autoFormat: false });
      gks.push(App.wb.gk(s, rec.r, rec.c));
    }
    // Show where the change happened.
    const sheet = App.wb.sheetById(recs[0].sid);
    if (sheet && sheet !== App.sheet) switchSheet(sheet);
    const mine = recs.filter((x) => x.sid === App.sheet.id);
    if (mine.length) {
      const r1 = Math.min(...mine.map((x) => x.r));
      const c1 = Math.min(...mine.map((x) => x.c));
      const r2 = Math.max(...mine.map((x) => x.r));
      const c2 = Math.max(...mine.map((x) => x.c));
      ensureSize(r2, c2);
      setSel({ r: r1, c: c1 }, { r: r2, c: c2 }, { r: r1, c: c1 });
      scrollToActive();
    }
    afterChange(gks, true);
  }
  function applyEntry(entry, which) {
    if (entry.type === 'cells') restoreRecs(entry.recs, which);
    else if (entry.type === 'full') restoreState(entry[which]);
    else if (entry.type === 'width') {
      const s = App.wb.sheetById(entry.sid);
      if (s) {
        if (s !== App.sheet) switchSheet(s);
        setWidthRaw(entry.c, entry[which]);
      }
      markChanged();
    }
  }
  function undo() {
    if (App.editing) { cancelEdit(); return; }
    const e = App.undo.pop();
    if (!e) { toast('Nothing to undo'); return; }
    applyEntry(e, 'before');
    App.redo.push(e);
  }
  function redo() {
    if (App.editing) return;
    const e = App.redo.pop();
    if (!e) { toast('Nothing to redo'); return; }
    applyEntry(e, 'after');
    App.undo.push(e);
  }
  // Structural changes (rows, columns, sheets) snapshot the whole workbook.
  function snapshotState() {
    return { json: JSON.parse(JSON.stringify(App.wb.toJSON())), sheetId: App.sheet.id, sel: Object.assign({}, App.sel) };
  }
  function restoreState(st) {
    App.wb = LC.Workbook.fromJSON(st.json);
    App.sheet = App.wb.sheetById(st.sheetId) || App.wb.sheets[0];
    rebuildView(st.sel);
    markChanged();
  }
  function structural(fn) {
    if (App.editing) commitEdit();
    const before = snapshotState();
    const prevSheet = App.sheet;
    if (App.sheet) App.views.set(App.sheet.id, { sel: Object.assign({}, App.sel), active: App.active, top: el.gridWrap.scrollTop, left: el.gridWrap.scrollLeft });
    fn();
    const after = snapshotState();
    pushUndo({ type: 'full', before, after });
    App.clip = null;
    rebuildView(App.sheet === prevSheet ? App.sel : null);
    if (App.sheet !== prevSheet) el.gridWrap.scrollTo(0, 0);
    markChanged();
  }
  function rebuildView(sel) {
    buildGrid();
    renderTabs();
    const s = sel || { r1: 0, c1: 0, r2: 0, c2: 0 };
    const r1 = clamp(s.r1, 0, lastRow());
    const c1 = clamp(s.c1, 0, lastCol());
    setSel({ r: r1, c: c1 }, { r: clamp(s.r2, r1, lastRow()), c: clamp(s.c2, c1, lastCol()) }, { r: r1, c: c1 });
  }

  /* ================================================================== */
  /* In-cell editing                                                    */
  /* ================================================================== */
  function startEdit(text, opts = {}) {
    if (App.editing) return;
    const { r, c } = App.active;
    scrollToActive();
    const cell = App.sheet.get(r, c);
    const raw = cell ? cell.raw : '';
    App.editing = { r, c, sheetId: App.sheet.id, original: raw, mode: text === undefined ? 'edit' : 'enter' };
    App.point = null;
    const ed = el.editor;
    ed.value = text === undefined ? raw : text;
    const st = (cell && cell.style) || {};
    ed.style.fontWeight = st.b ? '700' : '';
    ed.style.fontStyle = st.i ? 'italic' : '';
    ed.style.fontSize = st.fs ? st.fs + 'px' : '';
    ed.style.color = st.color || '';
    ed.style.textAlign = st.align || 'left';
    ed.hidden = false;
    el.fillHandle.hidden = true;
    positionEditor();
    el.formulaInput.value = ed.value;
    if (!opts.fromBar) {
      ed.focus();
      ed.setSelectionRange(ed.value.length, ed.value.length);
    }
    updateAssist();
  }
  function positionEditor() {
    if (!App.editing || App.editing.sheetId !== App.sheet.id) return;
    const { r, c } = App.editing;
    const td = App.tds[r] && App.tds[r][c];
    if (!td) return;
    const ed = el.editor;
    ed.style.left = td.offsetLeft - 1 + 'px';
    ed.style.top = td.offsetTop - 1 + 'px';
    ed.style.width = '0px';
    ed.style.height = '0px';
    const room = Math.max(td.offsetWidth + 1, el.gridInner.offsetWidth - td.offsetLeft - 4);
    ed.style.width = Math.min(Math.max(td.offsetWidth + 1, ed.scrollWidth + 10), room) + 'px';
    const lines = ed.value.split('\n').length;
    ed.style.height = Math.max(td.offsetHeight + 1, lines * 18 + 6) + 'px';
  }
  function closeEditor() {
    App.editing = null;
    App.point = null;
    el.editor.hidden = true;
    el.pointBox.hidden = true;
    hideAssist();
  }
  /** Finishes editing; `all` (Ctrl+Enter) writes the entry into every selected cell. */
  function commitEdit(dr = 0, dc = 0, all = false) {
    const ed = App.editing;
    if (!ed) return;
    let raw = document.activeElement === el.formulaInput ? el.formulaInput.value : el.editor.value;
    closeEditor();
    if (raw[0] === '=' && raw.length > 1) raw = LC.normalizeFormula(raw);
    const sheet = App.wb.sheetById(ed.sheetId);
    if (sheet && all && isMulti()) {
      const changes = [];
      const { r1, c1, r2, c2 } = App.sel;
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          const v = raw[0] === '=' ? LC.offsetFormula(raw, r - ed.r, c - ed.c) : raw;
          changes.push({ sheet, r, c, raw: v });
        }
      }
      applyChanges(changes);
    } else if (sheet && raw !== ed.original) {
      applyChanges([{ sheet, r: ed.r, c: ed.c, raw }]);
    }
    if (dr || dc) move(dr, dc);
    else { updateFormulaBar(); positionOverlays(); }
    focusGrid();
  }
  function cancelEdit() {
    if (!App.editing) return;
    closeEditor();
    updateFormulaBar();
    positionOverlays();
    focusGrid();
  }
  function focusGrid() {
    const k = el.keySink;
    if (document.activeElement !== k) k.focus({ preventScroll: true });
    k.value = ' ';
    k.select();
  }
  /** The text box currently being typed in (cell editor or formula bar). */
  const activeInput = () => (document.activeElement === el.formulaInput ? el.formulaInput : el.editor);
  function setEditValue(v, caret) {
    el.editor.value = v;
    el.formulaInput.value = v;
    const inp = activeInput();
    inp.setSelectionRange(caret, caret);
    positionEditor();
  }

  /* --- "point mode": click/arrow to insert a reference while typing a formula --- */
  function canPoint() {
    if (!App.editing) return false;
    const inp = activeInput();
    const v = inp.value;
    if (v[0] !== '=') return false;
    const pos = inp.selectionStart;
    if (App.point && pos === App.point.end && inp.selectionEnd === pos) return true;
    return /[=(,+\-*/^&<>:]$/.test(v.slice(0, pos).replace(/\s+$/, ''));
  }
  function pointTo(p, extend) {
    const inp = activeInput();
    const pt = App.point;
    const anchor = extend && pt ? pt.anchor : { r: p.r, c: p.c };
    const focus = { r: p.r, c: p.c };
    const r1 = Math.min(anchor.r, focus.r);
    const c1 = Math.min(anchor.c, focus.c);
    const r2 = Math.max(anchor.r, focus.r);
    const c2 = Math.max(anchor.c, focus.c);
    const text = r1 === r2 && c1 === c2 ? LC.cellName(r1, c1) : LC.cellName(r1, c1) + ':' + LC.cellName(r2, c2);
    const v = inp.value;
    let start;
    let end;
    if (pt && inp.selectionStart === pt.end) { start = pt.start; end = pt.end; }
    else { start = inp.selectionStart; end = inp.selectionEnd; }
    setEditValue(v.slice(0, start) + text + v.slice(end), start + text.length);
    App.point = { start, end: start + text.length, anchor, focus };
    placeBox(el.pointBox, rectPx(r1, c1, r2, c2));
    el.pointBox.hidden = false;
    hideAssist();
  }

  /** F4 cycles a reference: A1 → $A$1 → A$1 → $A1 → A1. */
  function toggleAbsolute() {
    const inp = activeInput();
    const v = inp.value;
    if (v[0] !== '=') return;
    const pos = inp.selectionStart;
    for (const t of LC.tokenize(v.slice(1))) {
      const s = t.pos + 1;
      const e = s + t.text.length;
      if (pos < s || pos > e || (t.type !== 'ref' && t.type !== 'range')) continue;
      const parts = t.type === 'ref' ? [t.a] : [t.a, t.b];
      const state = (parts[0].absC ? 2 : 0) + (parts[0].absR ? 1 : 0); // 0=A1 3=$A$1 1=A$1 2=$A1
      const next = { 0: 3, 3: 1, 1: 2, 2: 0 }[state];
      for (const p of parts) { p.absC = next >= 2; p.absR = next % 2 === 1; }
      const nt = LC.refTokenText(t);
      setEditValue(v.slice(0, s) + nt + v.slice(e), s + nt.length);
      App.point = null;
      return;
    }
  }

  /* --- function autocomplete & argument hints --- */
  function updateAssist() {
    const inp = activeInput();
    if (!App.editing || inp !== el.editor) { hideAssist(); return; }
    const v = inp.value;
    const pos = inp.selectionStart;
    if (v[0] !== '=') { hideAssist(); return; }
    const m = /(?:[=(,+\-*/^&<>\s])([A-Za-z][A-Za-z0-9.]*)$/.exec(v.slice(0, pos));
    let items = [];
    if (m && v[pos] !== '(') {
      const pre = m[1].toUpperCase();
      items = LC.functionNames.filter((n) => n.startsWith(pre)).slice(0, 12);
      if (items.length === 1 && items[0] === pre && /^[A-Z]{1,3}\d+$/.test(pre)) items = [];
    }
    App.ac = { items, index: 0, start: m ? pos - m[1].length : pos };
    const ed = el.editor;
    const below = ed.offsetTop + ed.offsetHeight + 2;
    if (items.length) {
      el.acList.innerHTML = items.map((n, i) =>
        '<div data-i="' + i + '"' + (i === 0 ? ' class="on"' : '') + '>' + esc(n) + '</div>').join('');
      el.acList.style.left = ed.offsetLeft + 'px';
      el.acList.style.top = below + 'px';
      el.acList.hidden = false;
    } else el.acList.hidden = true;
    const ctx = !items.length && fnContext(v, pos);
    const sig = ctx && LC.FUNCTION_SIGS[ctx.name];
    if (sig) {
      const open = sig.indexOf('(');
      const args = sig.slice(open + 1, -1).split(', ');
      let idx = ctx.arg;
      if (idx >= args.length) idx = args[args.length - 1] === '...' ? args.length - 2 : -1;
      el.fnTip.innerHTML = esc(sig.slice(0, open + 1)) +
        args.map((a, i) => (i === idx ? '<b>' + esc(a) + '</b>' : esc(a))).join(', ') + ')';
      el.fnTip.style.left = ed.offsetLeft + 'px';
      el.fnTip.style.top = below + 'px';
      el.fnTip.hidden = false;
    } else el.fnTip.hidden = true;
  }
  function fnContext(v, pos) {
    const toks = LC.tokenize(v.slice(1, pos)).filter((t) => t.type !== 'ws');
    const stack = [];
    toks.forEach((t, i) => {
      if (t.type === 'lparen') stack.push({ name: i > 0 && toks[i - 1].type === 'func' ? toks[i - 1].name : null, arg: 0 });
      else if (t.type === 'rparen') stack.pop();
      else if (t.type === 'comma' && stack.length) stack[stack.length - 1].arg++;
    });
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name) return stack[i];
    return null;
  }
  function hideAssist() {
    el.acList.hidden = true;
    el.fnTip.hidden = true;
    App.ac.items = [];
  }
  function acceptAutocomplete(i) {
    const name = App.ac.items[i];
    if (!name) return;
    const ed = el.editor;
    const v = ed.value;
    const pos = ed.selectionStart;
    setEditValue(v.slice(0, App.ac.start) + name + '(' + v.slice(pos), App.ac.start + name.length + 1);
    updateAssist();
  }

  /* ================================================================== */
  /* Keyboard                                                           */
  /* ================================================================== */
  function onGridKey(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (ctrl && !e.altKey) {
      const map = { z: e.shiftKey ? 'redo' : 'undo', y: 'redo', b: 'bold', i: 'italic', u: 'underline',
        d: 'fillDown', r: 'fillRight', a: 'selectAll' };
      const cmd = map[k.toLowerCase()];
      if (cmd) { e.preventDefault(); run(cmd); return; }
      if (k === 'Home') { e.preventDefault(); selectCell(0, 0, e.shiftKey); scrollToFocus(); return; }
      if (k === 'End') {
        e.preventDefault();
        const b = App.sheet.bounds();
        selectCell(Math.max(0, b.maxRow), Math.max(0, b.maxCol), e.shiftKey);
        scrollToFocus();
        return;
      }
      if (DIRS[k]) {
        e.preventDefault();
        const t = jump(e.shiftKey ? App.focus : App.active, DIRS[k][0], DIRS[k][1]);
        selectCell(t.r, t.c, e.shiftKey);
        scrollToFocus();
        return;
      }
      if (k === ' ') { e.preventDefault(); selectCols(App.sel.c1, App.sel.c2); return; }
      return; // Ctrl+C / X / V fall through to the native clipboard events.
    }
    if (e.altKey && k === '=') { e.preventDefault(); run('autosum'); return; }
    if (DIRS[k]) {
      e.preventDefault();
      const base = e.shiftKey ? App.focus : App.active;
      selectCell(base.r + DIRS[k][0], base.c + DIRS[k][1], e.shiftKey);
      scrollToFocus();
      return;
    }
    switch (k) {
      case 'Tab': e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return;
      case 'Enter': e.preventDefault(); move(e.shiftKey ? -1 : 1, 0); return;
      case 'F2': e.preventDefault(); startEdit(); return;
      case 'Delete': e.preventDefault(); run('clearContents'); return;
      case 'Backspace': e.preventDefault(); startEdit(''); return;
      case 'Escape':
        if (App.clip) { App.clip = null; positionOverlays(); }
        return;
      case 'Home': e.preventDefault(); selectCell(App.focus.r, 0, e.shiftKey); scrollToFocus(); return;
      case 'PageDown':
      case 'PageUp': {
        e.preventDefault();
        const n = Math.max(1, Math.floor(el.gridWrap.clientHeight / 23) - 2);
        const base = e.shiftKey ? App.focus : App.active;
        selectCell(base.r + (k === 'PageDown' ? n : -n), base.c, e.shiftKey);
        scrollToFocus();
        return;
      }
    }
    if (k === ' ' && e.shiftKey) { e.preventDefault(); selectRows(App.sel.r1, App.sel.r2); return; }
    if (k.length === 1 && !e.altKey) { e.preventDefault(); startEdit(k); }
  }

  function onEditorKey(e) {
    const k = e.key;
    if (!el.acList.hidden && App.ac.items.length) {
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        const n = App.ac.items.length;
        App.ac.index = (App.ac.index + (k === 'ArrowDown' ? 1 : n - 1)) % n;
        Array.from(el.acList.children).forEach((d, i) => d.classList.toggle('on', i === App.ac.index));
        return;
      }
      if (k === 'Tab') { e.preventDefault(); acceptAutocomplete(App.ac.index); return; }
      if (k === 'Escape') { e.preventDefault(); hideAssist(); return; }
    }
    if (k === 'Enter' && e.altKey) {
      e.preventDefault();
      const inp = el.editor;
      const pos = inp.selectionStart;
      setEditValue(inp.value.slice(0, pos) + '\n' + inp.value.slice(inp.selectionEnd), pos + 1);
      return;
    }
    if (k === 'Enter') { e.preventDefault(); commitEdit(e.shiftKey ? -1 : 1, 0, e.ctrlKey || e.metaKey); return; }
    if (k === 'Tab') { e.preventDefault(); commitEdit(0, e.shiftKey ? -1 : 1); return; }
    if (k === 'Escape') { e.preventDefault(); cancelEdit(); return; }
    if (k === 'F4') { e.preventDefault(); toggleAbsolute(); return; }
    if (DIRS[k] && App.editing && App.editing.mode === 'enter') {
      const [dr, dc] = DIRS[k];
      if (el.editor.value[0] !== '=') { e.preventDefault(); commitEdit(dr, dc); return; }
      if (canPoint()) {
        e.preventDefault();
        const base = App.point ? App.point.focus : { r: App.editing.r, c: App.editing.c };
        const p = { r: clamp(base.r + dr, 0, lastRow()), c: clamp(base.c + dc, 0, lastCol()) };
        pointTo(p, e.shiftKey);
        scrollToCell(p.r, p.c);
      }
    }
  }

  /* ================================================================== */
  /* Mouse                                                              */
  /* ================================================================== */
  function cellAt(x, y) {
    const t = document.elementFromPoint(x, y);
    if (!t || !t.closest) return null;
    const td = t.closest('#grid td');
    if (td) return { kind: 'cell', r: td.parentNode.rowIndex - 1, c: td.cellIndex - 1 };
    const th = t.closest('#grid th');
    if (!th) return null;
    if (th.classList.contains('col-head')) return { kind: 'col', c: th.cellIndex - 1 };
    if (th.classList.contains('row-head')) return { kind: 'row', r: th.parentNode.rowIndex - 1 };
    return { kind: 'corner' };
  }
  function onGridMouseDown(e) {
    hideMenus();
    if (e.target.classList.contains('col-resizer')) {
      e.preventDefault();
      if (App.editing) commitEdit();
      const c = e.target.parentElement.cellIndex - 1;
      App.resize = { c, x: e.clientX, w: colW(c), cur: colW(c) };
      document.body.style.cursor = 'col-resize';
      return;
    }
    const p = cellAt(e.clientX, e.clientY);
    if (!p) return;
    if (e.button === 2) {
      if (App.editing) commitEdit();
      if (p.kind === 'cell' && !inSel(p.r, p.c)) selectCell(p.r, p.c);
      if (p.kind === 'col' && !(inSel(0, p.c) && App.sel.r2 >= lastRow())) selectCols(p.c, p.c);
      if (p.kind === 'row' && !(inSel(p.r, 0) && App.sel.c2 >= lastCol())) selectRows(p.r, p.r);
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    if (p.kind === 'cell' && canPoint()) {
      pointTo(p, e.shiftKey);
      App.drag = { type: 'point' };
      return;
    }
    if (App.editing) commitEdit();
    if (p.kind === 'cell') {
      selectCell(p.r, p.c, e.shiftKey);
      App.drag = { type: 'select' };
    } else if (p.kind === 'col') {
      const from = e.shiftKey ? App.anchor.c : p.c;
      selectCols(from, p.c);
      App.drag = { type: 'cols', from };
    } else if (p.kind === 'row') {
      const from = e.shiftKey ? App.anchor.r : p.r;
      selectRows(from, p.r);
      App.drag = { type: 'rows', from };
    } else selectAll();
    focusGrid();
  }
  function onMouseMove(e) {
    if (App.resize) {
      const R = App.resize;
      R.cur = Math.max(16, Math.round(R.w + e.clientX - R.x));
      setWidthRaw(R.c, R.cur);
      return;
    }
    const d = App.drag;
    if (!d) return;
    autoScroll(e);
    const p = cellAt(e.clientX, e.clientY);
    if (!p) return;
    if (d.type === 'select' && p.kind === 'cell') selectCell(p.r, p.c, true);
    else if (d.type === 'cols' && p.c !== undefined) selectCols(d.from, p.c);
    else if (d.type === 'rows' && p.r !== undefined) selectRows(d.from, p.r);
    else if (d.type === 'point' && p.kind === 'cell') {
      const f = App.point && App.point.focus;
      if (!f || f.r !== p.r || f.c !== p.c) pointTo(p, true);
    } else if (d.type === 'fill' && p.kind === 'cell') updateFill(p);
  }
  function autoScroll(e) {
    const rect = el.gridWrap.getBoundingClientRect();
    const w = el.gridWrap;
    if (e.clientY > rect.bottom - 24) w.scrollTop += 24;
    else if (e.clientY < rect.top + App.headRow.offsetHeight + 4) w.scrollTop -= 24;
    if (e.clientX > rect.right - 24) w.scrollLeft += 40;
    else if (e.clientX < rect.left + HEADER_W + 4) w.scrollLeft -= 40;
  }
  function onMouseUp() {
    if (App.resize) {
      const R = App.resize;
      App.resize = null;
      document.body.style.cursor = '';
      if (R.cur !== R.w) {
        pushUndo({ type: 'width', sid: App.sheet.id, c: R.c, before: R.w, after: R.cur });
        markChanged();
      }
    }
    const d = App.drag;
    App.drag = null;
    if (d && d.type === 'fill') finishFill(d);
  }
  function setWidthRaw(c, w) {
    if (w === DEFAULT_W) delete App.sheet.colWidths[c];
    else App.sheet.colWidths[c] = w;
    if (App.cols[c]) App.cols[c].style.width = w + 'px';
    updateTableWidth();
    renderAllCells();
    positionOverlays();
  }
  /** Double-click a column border: fit width to content. */
  function autofit(c) {
    const ctx = autofit.ctx || (autofit.ctx = document.createElement('canvas').getContext('2d'));
    const font = getComputedStyle(document.body).fontFamily;
    let w = 30;
    for (const [k, cell] of App.sheet.cells) {
      const i = k.indexOf(',');
      if (+k.slice(i + 1) !== c) continue;
      const st = cell.style || {};
      ctx.font = (st.i ? 'italic ' : '') + (st.b ? '700 ' : '') + (st.fs || 13) + 'px ' + font;
      const text = LC.formatValue(cell.value, st.fmt);
      for (const line of text.split('\n')) w = Math.max(w, ctx.measureText(line).width + 14);
    }
    const before = colW(c);
    const after = Math.min(600, Math.ceil(w));
    setWidthRaw(c, after);
    pushUndo({ type: 'width', sid: App.sheet.id, c, before, after });
    markChanged();
  }

  /* --- fill handle --- */
  function updateFill(p) {
    const s = App.drag.src;
    const below = p.r - s.r2;
    const above = s.r1 - p.r;
    const right = p.c - s.c2;
    const left = s.c1 - p.c;
    const vert = Math.max(below, above);
    const horiz = Math.max(right, left);
    let dest = null;
    if (vert > 0 || horiz > 0) {
      if (vert >= horiz) {
        dest = below > 0 ? { r1: s.r2 + 1, r2: p.r, c1: s.c1, c2: s.c2, dir: 'down' }
          : { r1: p.r, r2: s.r1 - 1, c1: s.c1, c2: s.c2, dir: 'up' };
      } else {
        dest = right > 0 ? { r1: s.r1, r2: s.r2, c1: s.c2 + 1, c2: p.c, dir: 'right' }
          : { r1: s.r1, r2: s.r2, c1: p.c, c2: s.c1 - 1, dir: 'left' };
      }
    }
    App.drag.dest = dest;
    if (!dest) { el.fillBox.hidden = true; return; }
    const u = union(s, dest);
    placeBox(el.fillBox, rectPx(u.r1, u.c1, u.r2, u.c2));
    el.fillBox.hidden = false;
  }
  const union = (a, b) => ({ r1: Math.min(a.r1, b.r1), c1: Math.min(a.c1, b.c1), r2: Math.max(a.r2, b.r2), c2: Math.max(a.c2, b.c2) });
  function finishFill(d) {
    el.fillBox.hidden = true;
    if (!d.dest) return;
    performFill(d.src, d.dest, false);
    const u = union(d.src, d.dest);
    setSel({ r: u.r1, c: u.c1 }, { r: u.r2, c: u.c2 }, { r: u.r1, c: u.c1 });
  }
  /** Double-click the fill handle: fill down as far as the neighbouring column goes. */
  function autoFillDown() {
    const s = App.sel;
    const filled = (r, c) => { const cell = App.sheet.get(r, c); return !!cell && cell.raw !== ''; };
    let end = s.r2;
    for (const c of [s.c1 - 1, s.c2 + 1]) {
      if (c < 0) continue;
      let r = s.r2;
      while (filled(r + 1, c)) r++;
      end = Math.max(end, r);
    }
    if (end === s.r2) return;
    performFill(Object.assign({}, s), { r1: s.r2 + 1, r2: end, c1: s.c1, c2: s.c2, dir: 'down' }, false);
    setSel({ r: s.r1, c: s.c1 }, { r: end, c: s.c2 }, { r: s.r1, c: s.c1 });
  }
  /**
   * Copies `src` across `dest`, repeating it. Formulas shift their relative
   * references; numbers (2+ cells) and "Item 1"-style text continue a series.
   */
  function performFill(src, dest, copyOnly) {
    const s = App.sheet;
    const changes = [];
    const vertical = dest.dir === 'down' || dest.dir === 'up';
    const len = vertical ? src.r2 - src.r1 + 1 : src.c2 - src.c1 + 1;
    const [l1, l2] = vertical ? [src.c1, src.c2] : [src.r1, src.r2];
    const [from, to] = vertical ? [dest.r1, dest.r2] : [dest.c1, dest.c2];
    const origin = vertical ? src.r1 : src.c1;
    for (let lane = l1; lane <= l2; lane++) {
      const srcCells = [];
      for (let i = 0; i < len; i++) {
        const r = vertical ? src.r1 + i : lane;
        const c = vertical ? lane : src.c1 + i;
        srcCells.push({ r, c, cell: s.get(r, c) });
      }
      const series = copyOnly ? null : detectSeries(srcCells.map((x) => x.cell));
      for (let pos = from; pos <= to; pos++) {
        const off = pos - origin;
        const sc = srcCells[((off % len) + len) % len];
        const r = vertical ? pos : lane;
        const c = vertical ? lane : pos;
        let raw = sc.cell ? sc.cell.raw : '';
        if (series) raw = series(off);
        else if (raw[0] === '=' && raw.length > 1) raw = LC.offsetFormula(raw, r - sc.r, c - sc.c);
        changes.push({ sheet: s, r, c, raw, style: sc.cell ? cloneStyle(sc.cell.style) : null });
      }
    }
    applyChanges(changes);
  }
  function detectSeries(cells) {
    const isPlainNum = (x) => x && x.raw[0] !== '=' && typeof x.value === 'number';
    if (cells.length >= 2 && cells.every(isPlainNum)) {
      const first = cells[0].value;
      const step = (cells[cells.length - 1].value - first) / (cells.length - 1);
      return (off) => String(LC.round15(first + step * off));
    }
    const one = cells[0];
    if (cells.length === 1 && one && typeof one.value === 'string' && one.raw[0] !== '=') {
      const m = /^(.*?)(\d+)$/.exec(one.value);
      if (m) {
        const n = parseInt(m[2], 10);
        return (off) => (n + off < 0 ? one.raw : m[1] + String(n + off).padStart(m[2].length, '0'));
      }
    }
    return null;
  }

  /* ================================================================== */
  /* Clipboard                                                          */
  /* ================================================================== */
  function selectionTSV(rect) {
    const rows = [];
    for (let r = rect.r1; r <= rect.r2; r++) {
      const row = [];
      for (let c = rect.c1; c <= rect.c2; c++) {
        const cell = App.sheet.get(r, c);
        row.push(cell ? LC.formatValue(cell.value, cell.style && cell.style.fmt) : '');
      }
      rows.push(row);
    }
    return LC.csv.stringify(rows, '\t');
  }
  function doCopy(cut) {
    const rect = clipRect();
    const cells = [];
    for (let r = rect.r1; r <= rect.r2; r++) {
      const row = [];
      for (let c = rect.c1; c <= rect.c2; c++) row.push(snap(App.sheet, r, c));
      cells.push(row);
    }
    const tsv = selectionTSV(rect);
    App.clip = { sheetId: App.sheet.id, rect, cells, tsv, cut };
    positionOverlays();
    return tsv;
  }
  /** Whole-column selections copy only the used part. */
  function clipRect() {
    const s = Object.assign({}, App.sel);
    const b = App.sheet.bounds();
    if (s.r2 >= lastRow()) s.r2 = Math.max(s.r1, b.maxRow);
    if (s.c2 >= lastCol()) s.c2 = Math.max(s.c1, b.maxCol);
    return s;
  }
  const normNL = (t) => t.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  function doPaste(text) {
    if (App.clip && normNL(text) === normNL(App.clip.tsv)) pasteInternal();
    else pasteText(text);
  }
  function pasteInternal() {
    const clip = App.clip;
    const { cells, rect, cut } = clip;
    const h = cells.length;
    const w = cells[0].length;
    const sel = App.sel;
    const selH = sel.r2 - sel.r1 + 1;
    const selW = sel.c2 - sel.c1 + 1;
    const H = selH % h === 0 && selW % w === 0 && !cut ? selH : h; // tile into a larger selection
    const W = selH % h === 0 && selW % w === 0 && !cut ? selW : w;
    const changes = [];
    const srcSheet = App.wb.sheetById(clip.sheetId);
    if (cut && srcSheet) {
      for (let r = rect.r1; r <= rect.r2; r++) for (let c = rect.c1; c <= rect.c2; c++) changes.push({ sheet: srcSheet, r, c, raw: '', style: null });
    }
    ensureSize(sel.r1 + H - 1, sel.c1 + W - 1);
    for (let i = 0; i < H; i++) {
      for (let j = 0; j < W; j++) {
        const src = cells[i % h][j % w];
        const r = sel.r1 + i;
        const c = sel.c1 + j;
        let raw = src.raw;
        if (!cut && raw[0] === '=' && raw.length > 1) raw = LC.offsetFormula(raw, r - (rect.r1 + (i % h)), c - (rect.c1 + (j % w)));
        changes.push({ sheet: App.sheet, r, c, raw, style: cloneStyle(src.style) });
      }
    }
    applyChanges(changes);
    if (cut) App.clip = null;
    setSel({ r: sel.r1, c: sel.c1 }, { r: sel.r1 + H - 1, c: sel.c1 + W - 1 }, { r: sel.r1, c: sel.c1 });
  }
  function pasteText(text) {
    const rows = LC.csv.parse(text.replace(/\r?\n$/, ''), '\t');
    if (!rows.length) return;
    const sel = App.sel;
    const changes = [];
    if (rows.length === 1 && rows[0].length === 1) {
      for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) changes.push({ sheet: App.sheet, r, c, raw: rows[0][0] });
      applyChanges(changes);
      return;
    }
    const width = Math.max(...rows.map((r) => r.length));
    ensureSize(sel.r1 + rows.length - 1, sel.c1 + width - 1);
    rows.forEach((row, i) => row.forEach((v, j) => changes.push({ sheet: App.sheet, r: sel.r1 + i, c: sel.c1 + j, raw: v })));
    applyChanges(changes);
    setSel({ r: sel.r1, c: sel.c1 }, { r: sel.r1 + rows.length - 1, c: sel.c1 + width - 1 }, { r: sel.r1, c: sel.c1 });
  }
  async function pasteFromMenu() {
    try {
      doPaste(await navigator.clipboard.readText());
    } catch (e) {
      if (App.clip) pasteInternal();
      else toast('Use Ctrl+V to paste from other apps');
    }
  }

  /* ================================================================== */
  /* Commands (toolbar, menus, shortcuts)                               */
  /* ================================================================== */
  function eachSelected(fn) {
    const { r1, c1, r2, c2 } = App.sel;
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) fn(r, c);
  }
  function setStyleAll(patch) {
    const changes = [];
    eachSelected((r, c) => {
      const cell = App.sheet.get(r, c);
      changes.push({ sheet: App.sheet, r, c, style: Object.assign({}, cell && cell.style, patch) });
    });
    applyChanges(changes);
  }
  function activeStyle() {
    const cell = App.sheet.get(App.active.r, App.active.c);
    return (cell && cell.style) || {};
  }
  const toggleStyle = (key) => setStyleAll({ [key]: !activeStyle()[key] });
  const setAlign = (a) => setStyleAll({ align: activeStyle().align === a ? null : a });
  function adjustDecimals(delta) {
    const cell = App.sheet.get(App.active.r, App.active.c);
    setStyleAll({ fmt: LC.adjustDecimals(activeStyle().fmt, delta, cell && cell.value) });
  }
  function clearContents() {
    const changes = [];
    const s = App.sheet;
    for (const [k, cell] of s.cells) {
      const i = k.indexOf(',');
      const r = +k.slice(0, i);
      const c = +k.slice(i + 1);
      if (inSel(r, c) && cell.raw !== '') changes.push({ sheet: s, r, c, raw: '' });
    }
    applyChanges(changes);
  }
  function clearFormats() {
    const changes = [];
    const s = App.sheet;
    for (const [k, cell] of s.cells) {
      const i = k.indexOf(',');
      const r = +k.slice(0, i);
      const c = +k.slice(i + 1);
      if (inSel(r, c) && cell.style) changes.push({ sheet: s, r, c, style: null });
    }
    applyChanges(changes);
  }
  function fill(dir) {
    const { r1, c1, r2, c2 } = App.sel;
    if (dir === 'down') {
      if (r1 === r2) { if (r1 > 0) performFill({ r1: r1 - 1, r2: r1 - 1, c1, c2 }, { r1, r2, c1, c2, dir }, true); }
      else performFill({ r1, r2: r1, c1, c2 }, { r1: r1 + 1, r2, c1, c2, dir }, true);
    } else if (c1 === c2) {
      if (c1 > 0) performFill({ r1, r2, c1: c1 - 1, c2: c1 - 1 }, { r1, r2, c1, c2, dir }, true);
    } else performFill({ r1, r2, c1, c2: c1 }, { r1, r2, c1: c1 + 1, c2, dir }, true);
  }
  function autosum() {
    const { r1, c1, r2, c2 } = App.sel;
    const s = App.sheet;
    const isNum = (r, c) => { const cell = s.get(r, c); return !!cell && typeof cell.value === 'number'; };
    if (!isMulti()) {
      const { r, c } = App.active;
      let top = r - 1;
      while (top >= 0 && isNum(top, c)) top--;
      if (top < r - 1) { startEdit('=SUM(' + LC.cellName(top + 1, c) + ':' + LC.cellName(r - 1, c) + ')'); return; }
      let left = c - 1;
      while (left >= 0 && isNum(r, left)) left--;
      if (left < c - 1) { startEdit('=SUM(' + LC.cellName(r, left + 1) + ':' + LC.cellName(r, c - 1) + ')'); return; }
      startEdit('=SUM()');
      el.editor.setSelectionRange(5, 5);
      updateAssist();
      return;
    }
    const changes = [];
    ensureSize(r2 + 1, c2);
    for (let c = c1; c <= c2; c++) {
      changes.push({ sheet: s, r: r2 + 1, c, raw: '=SUM(' + LC.cellName(r1, c) + ':' + LC.cellName(r2, c) + ')' });
    }
    applyChanges(changes);
  }
  function insertRows(below) {
    const { r1, r2 } = App.sel;
    const n = r2 - r1 + 1;
    structural(() => App.wb.insertRows(App.sheet, below ? r2 + 1 : r1, n));
    if (below) setSel({ r: r2 + 1, c: App.sel.c1 }, { r: r2 + n, c: App.sel.c2 });
  }
  function insertCols(right) {
    const { c1, c2 } = App.sel;
    const n = c2 - c1 + 1;
    structural(() => App.wb.insertCols(App.sheet, right ? c2 + 1 : c1, n));
    if (right) setSel({ r: App.sel.r1, c: c2 + 1 }, { r: App.sel.r2, c: c2 + n });
  }
  function deleteRows() {
    const { r1, r2 } = App.sel;
    structural(() => App.wb.deleteRows(App.sheet, r1, r2 - r1 + 1));
  }
  function deleteCols() {
    const { c1, c2 } = App.sel;
    structural(() => App.wb.deleteCols(App.sheet, c1, c2 - c1 + 1));
  }

  const commands = {
    new: () => confirmDiscard() && setWorkbook(blankWorkbook(), 'Untitled', null),
    open: openFile,
    save: () => saveFile(false),
    saveAs: () => saveFile(true),
    importCsv: () => pickFile('.csv,.tsv,.txt', importCsvSheet),
    exportCsv,
    sample: () => confirmDiscard() && setWorkbook(sampleWorkbook(), 'Sample', null),
    undo, redo,
    bold: () => toggleStyle('b'),
    italic: () => toggleStyle('i'),
    underline: () => toggleStyle('u'),
    strike: () => toggleStyle('s'),
    wrap: () => toggleStyle('wrap'),
    alignLeft: () => setAlign('left'),
    alignCenter: () => setAlign('center'),
    alignRight: () => setAlign('right'),
    noFill: () => setStyleAll({ fill: null }),
    fmtPercent: () => setStyleAll({ fmt: '0%' }),
    fmtThousands: () => setStyleAll({ fmt: '#,##0.00' }),
    decInc: () => adjustDecimals(1),
    decDec: () => adjustDecimals(-1),
    autosum,
    fillDown: () => fill('down'),
    fillRight: () => fill('right'),
    clearContents, clearFormats, selectAll,
    insertRowAbove: () => insertRows(false),
    insertRowBelow: () => insertRows(true),
    insertColLeft: () => insertCols(false),
    insertColRight: () => insertCols(true),
    deleteRow: deleteRows,
    deleteCol: deleteCols,
    addSheet: () => structural(() => { App.sheet = App.wb.addSheet(null, App.wb.sheets.indexOf(App.sheet) + 1); }),
    find: openFind,
    findNext: () => findStep(1),
    findPrev: () => findStep(-1),
    findClose: closeFind,
    shortcuts: showShortcuts,
    functions: showFunctions,
  };
  const KEEP_EDITING = new Set(['functions', 'shortcuts', 'undo']);
  function run(cmd) {
    const fn = commands[cmd];
    if (!fn) return;
    hideMenus();
    if (App.editing && !KEEP_EDITING.has(cmd)) commitEdit();
    fn();
    if (!App.editing && !['find', 'open', 'save', 'saveAs', 'importCsv'].includes(cmd) && el.findBar.hidden) focusGrid();
  }

  /* ================================================================== */
  /* Sheets (tabs)                                                      */
  /* ================================================================== */
  function renderTabs() {
    el.tabs.textContent = '';
    for (const s of App.wb.sheets) {
      const b = document.createElement('button');
      b.className = 'tab' + (s === App.sheet ? ' active' : '');
      b.textContent = s.name;
      b.title = 'Double-click to rename, right-click for options';
      b.addEventListener('mousedown', (e) => { if (e.button === 0) { e.preventDefault(); switchSheet(s); focusGrid(); } });
      b.addEventListener('dblclick', () => renameSheetUI(s, b));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        switchSheet(s);
        const i = App.wb.sheets.indexOf(s);
        showMenu(e.clientX, e.clientY, [
          { label: 'Rename', action: () => renameSheetUI(s, el.tabs.children[App.wb.sheets.indexOf(s)]) },
          { label: 'Duplicate', action: () => duplicateSheet(s) },
          { label: 'Move left', disabled: i === 0, action: () => structural(() => App.wb.moveSheet(s, i - 1)) },
          { label: 'Move right', disabled: i === App.wb.sheets.length - 1, action: () => structural(() => App.wb.moveSheet(s, i + 1)) },
          null,
          { label: 'Delete', disabled: App.wb.sheets.length < 2, action: () => deleteSheet(s) },
        ]);
      });
      el.tabs.appendChild(b);
    }
  }
  function switchSheet(s) {
    if (s === App.sheet) return;
    if (App.editing) commitEdit();
    App.views.set(App.sheet.id, { sel: Object.assign({}, App.sel), active: App.active, top: el.gridWrap.scrollTop, left: el.gridWrap.scrollLeft });
    App.sheet = s;
    const v = App.views.get(s.id);
    rebuildView(v && v.sel);
    if (v) {
      App.active = v.active;
      drawSelection();
      updateFormulaBar();
      el.gridWrap.scrollTop = v.top;
      el.gridWrap.scrollLeft = v.left;
    } else el.gridWrap.scrollTo(0, 0);
  }
  function validSheetName(name, sheet) {
    if (!name) return 'Sheet name cannot be empty.';
    if (name.length > 31) return 'Sheet names can be at most 31 characters.';
    if (/[[\]:*?/\\]/.test(name)) return 'Sheet names cannot contain [ ] : * ? / \\';
    const other = App.wb.sheetByName(name);
    if (other && other !== sheet) return 'A sheet with that name already exists.';
    return null;
  }
  function renameSheetUI(s, tabEl) {
    if (!tabEl) return;
    const input = document.createElement('input');
    input.value = s.name;
    tabEl.textContent = '';
    tabEl.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (ok && name !== s.name) {
        const problem = validSheetName(name, s);
        if (problem) toast(problem);
        else structural(() => App.wb.renameSheet(s, name));
      }
      renderTabs();
      focusGrid();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('mousedown', (e) => e.stopPropagation());
  }
  function duplicateSheet(s) {
    structural(() => {
      let name = s.name + ' (2)';
      for (let i = 3; App.wb.sheetByName(name); i++) name = s.name + ' (' + i + ')';
      const copy = App.wb.addSheet(name, App.wb.sheets.indexOf(s) + 1);
      copy.colWidths = Object.assign({}, s.colWidths);
      copy.rowCount = s.rowCount;
      copy.colCount = s.colCount;
      for (const [k, cell] of s.cells) {
        const i = k.indexOf(',');
        const r = +k.slice(0, i);
        const c = +k.slice(i + 1);
        App.wb.setStyle(copy, r, c, cloneStyle(cell.style), true);
        App.wb.setRaw(copy, r, c, cell.raw, { autoFormat: false });
      }
      App.wb.rebuild();
      App.sheet = copy;
    });
  }
  function deleteSheet(s) {
    if (App.wb.sheets.length < 2) return;
    if (s.cells.size && !confirm('Delete sheet "' + s.name + '"? Formulas that use it will show #REF!. (You can undo this.)')) return;
    structural(() => {
      const i = App.wb.sheets.indexOf(s);
      App.wb.removeSheet(s);
      App.sheet = App.wb.sheets[Math.max(0, i - 1)];
    });
  }

  /* ================================================================== */
  /* Files & persistence                                                */
  /* ================================================================== */
  function blankWorkbook() {
    const wb = new LC.Workbook();
    wb.addSheet('Sheet1');
    return wb;
  }
  function setWorkbook(wb, name, handle, activeIdx) {
    closeEditor();
    App.wb = wb;
    App.sheet = wb.sheets[activeIdx || 0] || wb.sheets[0];
    App.docName = name;
    App.fileHandle = handle;
    App.undo = [];
    App.redo = [];
    App.clip = null;
    App.views = new Map();
    App.dirty = false;
    rebuildView(null);
    el.gridWrap.scrollTo(0, 0);
    updateTitle();
    autosave();
    return true;
  }
  function confirmDiscard() {
    return !App.dirty || confirm('This workbook has changes that are not saved to a file. Continue anyway?');
  }
  function markChanged() {
    App.dirty = true;
    updateTitle();
    clearTimeout(markChanged.timer);
    markChanged.timer = setTimeout(autosave, 500);
  }
  function autosave() {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
        name: App.docName, dirty: App.dirty, active: App.wb.sheets.indexOf(App.sheet), wb: App.wb.toJSON(),
      }));
    } catch (e) {
      console.warn('Autosave failed', e);
    }
  }
  function updateTitle() {
    el.docName.textContent = App.docName;
    el.saveState.textContent = App.dirty ? '• not saved to file (kept in this browser)' : '';
    document.title = (App.dirty ? '• ' : '') + App.docName + ' — LocalCalc';
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function saveFile(as) {
    const data = JSON.stringify(App.wb.toJSON());
    if (window.showSaveFilePicker) {
      try {
        if (!App.fileHandle || as) {
          App.fileHandle = await window.showSaveFilePicker({
            suggestedName: App.docName + '.lcalc',
            types: [{ description: 'LocalCalc workbook', accept: { 'application/json': ['.lcalc'] } }],
          });
        }
        const w = await App.fileHandle.createWritable();
        await w.write(data);
        await w.close();
        App.docName = App.fileHandle.name.replace(/\.(lcalc|json)$/i, '');
        App.dirty = false;
        updateTitle();
        autosave();
        toast('Saved ' + App.fileHandle.name);
        focusGrid();
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') { focusGrid(); return; }
        console.warn('File System Access save failed; downloading instead', e);
        App.fileHandle = null;
      }
    }
    download(App.docName + '.lcalc', data, 'application/json');
    App.dirty = false;
    updateTitle();
    autosave();
    toast('Downloaded ' + App.docName + '.lcalc');
    focusGrid();
  }
  function pickFile(accept, cb) {
    el.fileInput.accept = accept;
    el.fileInput.value = '';
    el.fileInput.onchange = () => { const f = el.fileInput.files[0]; if (f) cb(f); };
    el.fileInput.click();
  }
  async function openFile() {
    if (!confirmDiscard()) return;
    if (window.showOpenFilePicker) {
      try {
        const [h] = await window.showOpenFilePicker({
          types: [{ description: 'Spreadsheets', accept: { 'application/json': ['.lcalc', '.json'], 'text/csv': ['.csv', '.tsv', '.txt'] } }],
        });
        const f = await h.getFile();
        await loadFromFile(f, /\.(lcalc|json)$/i.test(f.name) ? h : null);
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') { focusGrid(); return; }
      }
    }
    pickFile('.lcalc,.json,.csv,.tsv,.txt', (f) => loadFromFile(f, null));
  }
  const baseName = (n) => n.replace(/\.[^.]+$/, '');
  const safeSheetName = (n) => n.replace(/[[\]:*?/\\]/g, '_').slice(0, 31) || 'Sheet1';
  function fillSheet(wb, s, rows) {
    rows.forEach((row, r) => row.forEach((v, c) => { if (v !== '') wb.setRaw(s, r, c, v); }));
    s.rowCount = Math.max(200, rows.length + 20);
    s.colCount = Math.max(26, Math.max(0, ...rows.map((r) => r.length)) + 2);
    wb.rebuild();
  }
  async function loadFromFile(file, handle) {
    try {
      const text = await file.text();
      if (/\.(csv|tsv|txt)$/i.test(file.name)) {
        const wb = new LC.Workbook();
        const s = wb.addSheet(safeSheetName(baseName(file.name)));
        fillSheet(wb, s, LC.csv.parse(text, /\.tsv$/i.test(file.name) ? '\t' : undefined));
        setWorkbook(wb, baseName(file.name), null);
      } else {
        setWorkbook(LC.Workbook.fromJSON(JSON.parse(text)), baseName(file.name), handle);
      }
      toast('Opened ' + file.name);
    } catch (e) {
      alert('Could not open ' + file.name + ':\n' + e.message);
    }
    focusGrid();
  }
  async function importCsvSheet(file) {
    const text = await file.text();
    structural(() => {
      let name = safeSheetName(baseName(file.name));
      for (let i = 2; App.wb.sheetByName(name); i++) name = safeSheetName(baseName(file.name)).slice(0, 27) + ' (' + i + ')';
      const s = App.wb.addSheet(name);
      fillSheet(App.wb, s, LC.csv.parse(text, /\.tsv$/i.test(file.name) ? '\t' : undefined));
      App.sheet = s;
    });
    toast('Imported ' + file.name);
    focusGrid();
  }
  function exportCsv() {
    const rows = LC.csv.sheetToRows(App.sheet);
    download(App.docName + ' - ' + App.sheet.name + '.csv', '﻿' + LC.csv.stringify(rows), 'text/csv');
  }

  function sampleWorkbook() {
    const B = { b: true, fill: '#e7ecfb' };
    const money = { fmt: '#,##0.00' };
    const cells = {
      A1: { v: 'Monthly budget', s: { b: true, fs: 18 } },
      A2: { v: 'Edit the Actual column and watch everything recalculate.', s: { i: true, color: '#6b7280' } },
      A4: { v: 'Category', s: B }, B4: { v: 'Planned', s: Object.assign({ align: 'right' }, B) },
      C4: { v: 'Actual', s: Object.assign({ align: 'right' }, B) }, D4: { v: 'Difference', s: Object.assign({ align: 'right' }, B) },
      E4: { v: 'Status', s: B },
    };
    const rows = [['Rent', 1200, 1200], ['Groceries', 400, 452.3], ['Transport', 150, 98.5],
      ['Utilities', 180, 176.2], ['Going out', 200, 260], ['Savings', 500, 500]];
    rows.forEach(([name, plan, act], i) => {
      const r = 5 + i;
      cells['A' + r] = { v: name };
      cells['B' + r] = { v: String(plan), s: money };
      cells['C' + r] = { v: String(act), s: money };
      cells['D' + r] = { v: '=B' + r + '-C' + r, s: { fmt: '#,##0.00;[Red]-#,##0.00' } };
      cells['E' + r] = { v: '=IF(D' + r + '<0,"Over","OK")' };
    });
    Object.assign(cells, {
      A11: { v: 'Total', s: { b: true } },
      B11: { v: '=SUM(B5:B10)', s: { b: true, fmt: '#,##0.00' } },
      C11: { v: '=SUM(C5:C10)', s: { b: true, fmt: '#,##0.00' } },
      D11: { v: '=SUM(D5:D10)', s: { b: true, fmt: '#,##0.00' } },
      A13: { v: 'Biggest expense' }, B13: { v: '=INDEX(A5:A10,MATCH(MAX(C5:C10),C5:C10,0))' },
      A14: { v: 'Over-budget lines' }, B14: { v: '=COUNTIF(D5:D10,"<0")' },
      A15: { v: 'Savings rate' }, B15: { v: '=C10/C11', s: { fmt: '0.0%' } },
      A16: { v: 'Grade (from Grades sheet)' }, B16: { v: '=Grades!E2' },
      A17: { v: 'Today' }, B17: { v: '=TODAY()', s: { fmt: 'd mmm yyyy' } },
    });
    const grades = {
      A1: { v: 'Min score', s: B }, B1: { v: 'Grade', s: B },
      A2: { v: '0' }, B2: { v: 'F' }, A3: { v: '50' }, B3: { v: 'D' }, A4: { v: '60' }, B4: { v: 'C' },
      A5: { v: '70' }, B5: { v: 'B' }, A6: { v: '80' }, B6: { v: 'A' },
      D1: { v: 'Score', s: B }, E1: { v: 'Grade', s: B },
      D2: { v: '72' }, E2: { v: '=VLOOKUP(D2,A2:B6,2,TRUE)' },
      D4: { v: 'Try changing the score in D2.', s: { i: true, color: '#6b7280' } },
    };
    return LC.Workbook.fromJSON({
      sheets: [
        { name: 'Budget', colWidths: { 0: 190, 3: 110 }, cells },
        { name: 'Grades', cells: grades },
      ],
    });
  }

  /* ================================================================== */
  /* Find                                                               */
  /* ================================================================== */
  function openFind() {
    el.findBar.hidden = false;
    el.findInput.focus();
    el.findInput.select();
  }
  function closeFind() {
    el.findBar.hidden = true;
    el.findInfo.textContent = '';
    focusGrid();
  }
  function findStep(dir) {
    const q = el.findInput.value.toLowerCase();
    if (!q) return;
    const matches = [];
    for (const [k, cell] of App.sheet.cells) {
      const shown = LC.formatValue(cell.value, cell.style && cell.style.fmt).toLowerCase();
      if (shown.includes(q) || cell.raw.toLowerCase().includes(q)) {
        const i = k.indexOf(',');
        matches.push({ r: +k.slice(0, i), c: +k.slice(i + 1) });
      }
    }
    if (!matches.length) { el.findInfo.textContent = 'No matches'; return; }
    matches.sort((a, b) => a.r - b.r || a.c - b.c);
    const a = App.active;
    const after = (p) => p.r > a.r || (p.r === a.r && p.c > a.c);
    let idx;
    if (dir > 0) { idx = matches.findIndex(after); if (idx < 0) idx = 0; }
    else {
      idx = -1;
      matches.forEach((p, i) => { if (p.r < a.r || (p.r === a.r && p.c < a.c)) idx = i; });
      if (idx < 0) idx = matches.length - 1;
    }
    selectCell(matches[idx].r, matches[idx].c);
    scrollToActive();
    el.findInfo.textContent = idx + 1 + ' of ' + matches.length;
  }

  /* ================================================================== */
  /* Menus, dialogs, toasts                                             */
  /* ================================================================== */
  function hideMenus() {
    document.querySelectorAll('.titlebar .menu').forEach((m) => { m.hidden = true; });
    document.querySelectorAll('.menu-btn.open').forEach((b) => b.classList.remove('open'));
    el.ctxMenu.hidden = true;
  }
  function showMenu(x, y, items) {
    hideMenus();
    const m = el.ctxMenu;
    m.textContent = '';
    for (const it of items) {
      if (!it) { m.appendChild(document.createElement('hr')); continue; }
      const b = document.createElement('button');
      b.innerHTML = '<span>' + esc(it.label) + '</span>' + (it.key ? '<kbd>' + esc(it.key) + '</kbd>' : '');
      b.disabled = !!it.disabled;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => { hideMenus(); it.action(); if (!App.editing) focusGrid(); });
      m.appendChild(b);
    }
    m.hidden = false;
    const w = m.offsetWidth;
    const h = m.offsetHeight;
    m.style.left = Math.min(x, window.innerWidth - w - 4) + 'px';
    m.style.top = Math.min(y, window.innerHeight - h - 4) + 'px';
  }
  function gridMenu(e) {
    const p = cellAt(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    const rows = App.sel.r2 - App.sel.r1 + 1;
    const cols = App.sel.c2 - App.sel.c1 + 1;
    const rs = rows > 1 ? rows + ' rows' : 'row';
    const cs = cols > 1 ? cols + ' columns' : 'column';
    showMenu(e.clientX, e.clientY, [
      { label: 'Cut', key: 'Ctrl+X', action: () => { if (document.execCommand('cut') === false) doCopy(true); } },
      { label: 'Copy', key: 'Ctrl+C', action: () => { if (document.execCommand('copy') === false) doCopy(false); } },
      { label: 'Paste', key: 'Ctrl+V', action: pasteFromMenu },
      null,
      { label: 'Insert ' + rs + ' above', action: () => insertRows(false) },
      { label: 'Insert ' + rs + ' below', action: () => insertRows(true) },
      { label: 'Delete ' + rs, action: deleteRows },
      null,
      { label: 'Insert ' + cs + ' left', action: () => insertCols(false) },
      { label: 'Insert ' + cs + ' right', action: () => insertCols(true) },
      { label: 'Delete ' + cs, action: deleteCols },
      null,
      { label: 'Clear contents', key: 'Del', action: clearContents },
      { label: 'Clear formats', action: clearFormats },
    ]);
  }
  function showDialog(html) {
    el.dialogBody.innerHTML = html;
    el.dialog.hidden = false;
  }
  function closeDialog() {
    el.dialog.hidden = true;
    if (App.editing) el.editor.focus(); else focusGrid();
  }
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.toast.hidden = true; }, 2400);
  }
  function showShortcuts() {
    const rows = [
      ['Arrows / Tab / Enter', 'Move (Shift extends the selection or moves backwards)'],
      ['Ctrl+Arrows', 'Jump to the edge of the data'],
      ['Ctrl+Home / Ctrl+End', 'Go to A1 / last used cell'],
      ['Shift+Space / Ctrl+Space', 'Select row / column'],
      ['Type anything', 'Replace the cell contents'],
      ['F2 or double-click', 'Edit the cell'],
      ['While editing: click cells', 'Insert a reference into a formula (drag for a range)'],
      ['While editing: F4', 'Cycle $ absolute references (A1 → $A$1 → A$1 → $A1)'],
      ['While editing: Tab', 'Accept function suggestion'],
      ['Alt+Enter', 'New line inside the cell'],
      ['Ctrl+Enter', 'Write the entry into every selected cell'],
      ['Esc', 'Cancel editing'],
      ['Delete', 'Clear contents'],
      ['Ctrl+C / X / V', 'Copy / cut / paste (works with other spreadsheet apps)'],
      ['Ctrl+D / Ctrl+R', 'Fill down / fill right'],
      ['Drag the ■ handle', 'Fill: copies formulas, continues 1,2,3 and "Item 1" series'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
      ['Ctrl+B / I / U', 'Bold / italic / underline'],
      ['Alt+=', 'AutoSum'],
      ['Ctrl+F', 'Find'],
      ['Ctrl+S / Ctrl+O', 'Save / open'],
    ];
    showDialog('<h2>Keyboard shortcuts</h2><table>' +
      rows.map(([k, d]) => '<tr><td>' + esc(k) + '</td><td>' + esc(d) + '</td></tr>').join('') + '</table>');
  }
  function showFunctions() {
    const list = LC.functionNames.map((n) =>
      '<tr class="fn" data-fn="' + esc(n) + '"><td>' + esc(LC.FUNCTION_SIGS[n] || n) + '</td></tr>').join('');
    showDialog('<h2>Functions (' + LC.functionNames.length + ')</h2>' +
      '<input id="fnFilter" placeholder="Filter…" style="width:100%;padding:6px;margin-bottom:8px;border:1px solid #c9ced6;border-radius:4px">' +
      '<p style="margin:0 0 8px;color:#6b7280">Click a function to insert it into the active cell.</p>' +
      '<table id="fnTable">' + list + '</table>');
    const f = document.getElementById('fnFilter');
    f.focus();
    f.addEventListener('input', () => {
      const q = f.value.toUpperCase();
      document.querySelectorAll('#fnTable tr').forEach((tr) => { tr.hidden = !tr.dataset.fn.includes(q); });
    });
    document.getElementById('fnTable').addEventListener('click', (e) => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      el.dialog.hidden = true;
      const name = tr.dataset.fn;
      if (App.editing) {
        const inp = el.editor;
        inp.focus();
        const pos = inp.selectionStart;
        setEditValue(inp.value.slice(0, pos) + name + '(' + inp.value.slice(inp.selectionEnd), pos + name.length + 1);
      } else startEdit('=' + name + '(');
      updateAssist();
    });
  }

  /* ================================================================== */
  /* Wiring                                                             */
  /* ================================================================== */
  function bind() {
    // Grid mouse & keyboard
    el.grid.addEventListener('mousedown', onGridMouseDown);
    el.grid.addEventListener('dblclick', (e) => {
      if (e.target.classList.contains('col-resizer')) { autofit(e.target.parentElement.cellIndex - 1); return; }
      const p = cellAt(e.clientX, e.clientY);
      if (p && p.kind === 'cell' && !App.editing) startEdit();
    });
    el.gridWrap.addEventListener('mousedown', (e) => {
      if (e.target === el.gridWrap || e.target === el.gridInner) { if (App.editing) commitEdit(); focusGrid(); }
    });
    el.gridWrap.addEventListener('contextmenu', gridMenu);
    el.gridWrap.addEventListener('scroll', () => {
      const w = el.gridWrap;
      el.ctxMenu.hidden = true;
      if (w.scrollTop + w.clientHeight > w.scrollHeight - 400 && App.trs.length < LC.MAX_ROWS) addRows(100);
      if (w.scrollLeft + w.clientWidth > w.scrollWidth - 300 && App.cols.length < LC.MAX_COLS) addCols(10);
    });
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    el.fillHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (App.editing) commitEdit();
      App.drag = { type: 'fill', src: Object.assign({}, App.sel), dest: null };
    });
    el.fillHandle.addEventListener('dblclick', autoFillDown);
    el.keySink.addEventListener('keydown', onGridKey);

    // Editor
    el.editor.addEventListener('keydown', onEditorKey);
    el.editor.addEventListener('input', () => {
      App.point = null;
      el.pointBox.hidden = true;
      el.formulaInput.value = el.editor.value;
      positionEditor();
      updateAssist();
    });
    el.editor.addEventListener('click', updateAssist);
    el.editor.addEventListener('keyup', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') updateAssist(); });
    el.acList.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const d = e.target.closest('[data-i]');
      if (d) acceptAutocomplete(+d.dataset.i);
    });

    // Formula bar & name box
    el.formulaInput.addEventListener('focus', () => {
      if (!App.editing) startEdit(undefined, { fromBar: true });
      if (App.editing) App.editing.mode = 'edit';
      hideAssist();
    });
    el.formulaInput.addEventListener('input', () => {
      if (!App.editing) return;
      el.editor.value = el.formulaInput.value;
      App.point = null;
      el.pointBox.hidden = true;
      positionEditor();
    });
    el.formulaInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(e.shiftKey ? -1 : 1, 0, e.ctrlKey || e.metaKey); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
      else if (e.key === 'Tab') { e.preventDefault(); commitEdit(0, e.shiftKey ? -1 : 1); }
      else if (e.key === 'F4') { e.preventDefault(); toggleAbsolute(); }
    });
    el.nameBox.addEventListener('focus', () => { if (App.editing) commitEdit(); el.nameBox.select(); });
    el.nameBox.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { updateFormulaBar(); focusGrid(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const m = /^(?:(.+)!)?(\$?[A-Za-z]{1,3}\$?\d+)(?::(\$?[A-Za-z]{1,3}\$?\d+))?$/.exec(el.nameBox.value.trim());
      const a = m && LC.parseCellName(m[2]);
      const b = m && m[3] ? LC.parseCellName(m[3]) : a;
      if (!a || !b) { toast('Type a cell like B12 or a range like A1:C10'); return; }
      if (m[1]) {
        const s = App.wb.sheetByName(m[1].replace(/^'(.*)'$/, '$1'));
        if (!s) { toast('No sheet named ' + m[1]); return; }
        switchSheet(s);
      }
      ensureSize(Math.max(a.r, b.r), Math.max(a.c, b.c));
      setSel(a, b, a);
      scrollToCell(b.r, b.c);
      scrollToActive();
      focusGrid();
    });

    // Clipboard (fires when the hidden keySink has focus)
    document.addEventListener('copy', (e) => {
      if (document.activeElement !== el.keySink) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', doCopy(false));
    });
    document.addEventListener('cut', (e) => {
      if (document.activeElement !== el.keySink) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', doCopy(true));
    });
    document.addEventListener('paste', (e) => {
      if (document.activeElement !== el.keySink) return;
      e.preventDefault();
      doPaste(e.clipboardData.getData('text/plain'));
    });

    // Toolbar & menus
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cmd]');
      if (btn && !btn.closest('#ctxMenu')) { run(btn.dataset.cmd); return; }
      const mb = e.target.closest('.menu-btn');
      if (mb) {
        const menu = document.getElementById('menu-' + mb.dataset.menu);
        const wasOpen = !menu.hidden;
        hideMenus();
        if (!wasOpen) { menu.hidden = false; mb.classList.add('open'); }
        return;
      }
      if (!e.target.closest('.menu')) hideMenus();
    });
    document.querySelectorAll('.menu-btn').forEach((mb) => mb.addEventListener('mouseenter', () => {
      if (!document.querySelector('.menu-btn.open') || mb.classList.contains('open')) return;
      hideMenus();
      document.getElementById('menu-' + mb.dataset.menu).hidden = false;
      mb.classList.add('open');
    }));
    document.querySelectorAll('.toolbar button, .menu button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
    el.numFormat.addEventListener('change', () => {
      if (App.editing) commitEdit();
      if (el.numFormat.value !== 'custom') setStyleAll({ fmt: el.numFormat.value });
      focusGrid();
    });
    el.fontSize.addEventListener('change', () => {
      if (App.editing) commitEdit();
      setStyleAll({ fs: el.fontSize.value ? +el.fontSize.value : null });
      focusGrid();
    });
    el.textColor.addEventListener('input', () => { el.textColor.previousElementSibling.style.borderBottomColor = el.textColor.value; });
    el.textColor.addEventListener('change', () => { if (App.editing) commitEdit(); setStyleAll({ color: el.textColor.value }); focusGrid(); });
    el.fillColor.addEventListener('input', () => { el.fillColor.previousElementSibling.style.color = el.fillColor.value; });
    el.fillColor.addEventListener('change', () => { if (App.editing) commitEdit(); setStyleAll({ fill: el.fillColor.value }); focusGrid(); });
    el.addSheet.addEventListener('click', () => run('addSheet'));

    // Find bar
    el.findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
    });

    // Dialog
    el.dialogClose.addEventListener('click', closeDialog);
    el.dialog.addEventListener('mousedown', (e) => { if (e.target === el.dialog) closeDialog(); });

    // Global shortcuts that work wherever focus is
    document.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        if (!el.dialog.hidden) { closeDialog(); return; }
        if (!el.ctxMenu.hidden || document.querySelector('.menu-btn.open')) { hideMenus(); focusGrid(); return; }
      }
      if (ctrl && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 's') { e.preventDefault(); run(e.shiftKey ? 'saveAs' : 'save'); }
        else if (k === 'o') { e.preventDefault(); run('open'); }
        else if (k === 'f') { e.preventDefault(); run('find'); }
      }
    }, true);
    window.addEventListener('resize', positionOverlays);
    window.addEventListener('beforeunload', autosave);
  }

  function init() {
    for (const id of ['grid', 'gridWrap', 'gridInner', 'editor', 'nameBox', 'formulaInput', 'selBox', 'clipBox',
      'pointBox', 'fillBox', 'fillHandle', 'tabs', 'status', 'keySink', 'ctxMenu', 'acList', 'fnTip', 'fileInput',
      'docName', 'saveState', 'numFormat', 'fontSize', 'textColor', 'fillColor', 'addSheet', 'findBar', 'findInput',
      'findInfo', 'dialog', 'dialogBody', 'dialogClose', 'toast']) el[id] = document.getElementById(id);
    bind();
    let restored = false;
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        setWorkbook(LC.Workbook.fromJSON(d.wb), d.name || 'Untitled', null, d.active);
        App.dirty = !!d.dirty;
        updateTitle();
        restored = true;
      }
    } catch (e) {
      console.warn('Could not restore the autosaved workbook', e);
    }
    if (!restored) setWorkbook(sampleWorkbook(), 'Sample', null);
    focusGrid();
    // Expose for debugging in the browser console.
    window.LocalCalc = App;
  }
  init();
})();
