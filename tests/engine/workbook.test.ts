import { describe, expect, test } from 'vitest';
import { Workbook, isErr } from '../../src/engine';
import { book } from './helpers';

describe('recalculation', () => {
  test('follows dependencies through chains and ranges', () => {
    const b = book({ A1: '1', B1: '=A1*10', C1: '=B1+1', D1: '=SUM(A1:C1)' });
    expect(b.get('C1')).toBe(11);
    b.set('A1', '5');
    expect([b.get('B1'), b.get('C1'), b.get('D1')]).toEqual([50, 51, 106]);
  });

  test('only touches affected cells', () => {
    const b = book({ A1: '1', B1: '=A1+1', A2: '7', B2: '=A2+1' });
    const touched = b.wb.recalc([b.wb.setRaw(b.s, 0, 0, '2')]);
    const keys = [...touched].map((gk) => Workbook.parseGk(gk)).map(({ r, c }) => r + ',' + c).sort();
    expect(keys).toEqual(['0,0', '0,1']);
  });

  test('cells inside a range are watched', () => {
    const b = book({ A1: '1', A5: '=SUM(A1:A4)' });
    b.set('A3', '10');
    expect(b.get('A5')).toBe(11);
  });

  test('whole-column ranges see new rows', () => {
    const b = book({ A1: '1', A2: '2', B1: '=SUM(A:A)' });
    b.set('A500', '4');
    expect(b.get('B1')).toBe(7);
  });

  test('changing a formula re-links its dependencies', () => {
    const b = book({ A1: '1', A2: '100', B1: '=A1' });
    b.set('B1', '=A2');
    b.set('A1', '5');
    expect(b.get('B1')).toBe(100);
    b.set('A2', '200');
    expect(b.get('B1')).toBe(200);
  });

  test('clearing a referenced cell recalculates to 0', () => {
    const b = book({ A1: '5', B1: '=A1*2' });
    b.set('A1', '');
    expect(b.get('B1')).toBe(0);
  });
});

describe('circular references', () => {
  test('are detected and recover when broken', () => {
    const b = book({ A1: '=B1+1', B1: '=A1+1', C1: '=A1' });
    expect([b.get('A1'), b.get('B1')]).toEqual(['#CIRC!', '#CIRC!']);
    b.set('B1', '5');
    expect([b.get('A1'), b.get('C1')]).toEqual([6, 6]);
  });

  test('a cell referring to itself', () => {
    expect(book({ A1: '=A1+1' }).get('A1')).toBe('#CIRC!');
    expect(book({ A1: '=SUM(A1:A3)' }).get('A1')).toBe('#CIRC!');
  });

  test('a long cycle', () => {
    const cells: Record<string, string> = { A1: '=A400' };
    for (let r = 2; r <= 400; r++) cells['A' + r] = '=A' + (r - 1);
    expect(book(cells).get('A400')).toBe('#CIRC!');
  });
});

describe('long dependency chains', () => {
  test('20,000 chained cells do not overflow the stack (built bottom-up)', () => {
    const wb = new Workbook();
    const s = wb.addSheet('S');
    const gks = [wb.setRaw(s, 0, 0, '1')];
    for (let r = 1; r < 20000; r++) gks.push(wb.setRaw(s, r, 0, '=A' + r + '+1'));
    wb.recalc(gks);
    expect(s.get(19999, 0)?.value).toBe(20000);
    wb.recalc([wb.setRaw(s, 0, 0, '101')]);
    expect(s.get(19999, 0)?.value).toBe(20100);
  });

  test('chains pointing downwards (worst-case order) also work', () => {
    const wb = new Workbook();
    const s = wb.addSheet('S');
    const gks = [wb.setRaw(s, 5000, 0, '1')];
    for (let r = 0; r < 5000; r++) gks.push(wb.setRaw(s, r, 0, '=A' + (r + 2) + '+1'));
    wb.recalc(gks);
    expect(s.get(0, 0)?.value).toBe(5001);
  });
});

describe('sheets', () => {
  function twoSheets() {
    const wb = new Workbook();
    const a = wb.addSheet('Data');
    const b = wb.addSheet('Report');
    wb.setRaw(a, 0, 0, '42');
    wb.setRaw(b, 0, 0, '=Data!A1*2');
    wb.setRaw(b, 1, 0, '=SUM(Data!A1:A3)');
    wb.recalcAll();
    return { wb, a, b };
  }

  test('cross-sheet references recalculate', () => {
    const { wb, a, b } = twoSheets();
    expect(b.get(0, 0)?.value).toBe(84);
    wb.recalc([wb.setRaw(a, 1, 0, '8')]);
    expect(b.get(1, 0)?.value).toBe(50);
  });

  test('renaming a sheet rewrites formulas, quoting when needed', () => {
    const { wb, a, b } = twoSheets();
    wb.renameSheet(a, 'My Data');
    expect(b.get(0, 0)?.raw).toBe("='My Data'!A1*2");
    expect(b.get(0, 0)?.value).toBe(84);
  });

  test('deleting a sheet turns references into #REF!', () => {
    const { wb, a, b } = twoSheets();
    wb.removeSheet(a);
    expect(b.get(0, 0)?.raw).toBe('=#REF!*2');
    expect(isErr(b.get(0, 0)?.value) && (b.get(0, 0)?.value as { code: string }).code).toBe('#REF!');
  });

  test('a formula can refer to a sheet created later', () => {
    const wb = new Workbook();
    const a = wb.addSheet('A');
    wb.setRaw(a, 0, 0, '=Later!A1+1');
    wb.recalcAll();
    expect(isErr(a.get(0, 0)?.value)).toBe(true);
    const later = wb.addSheet('Later');
    wb.recalc([wb.setRaw(later, 0, 0, '9')]);
    expect(a.get(0, 0)?.value).toBe(10);
  });

  test('sheet names are case-insensitive and unique names are generated', () => {
    const wb = new Workbook();
    wb.addSheet();
    wb.addSheet();
    expect(wb.sheets.map((s) => s.name)).toEqual(['Sheet1', 'Sheet2']);
    expect(wb.sheetByName('sheet2')).toBe(wb.sheets[1]);
  });
});

describe('inserting and deleting rows and columns', () => {
  test('insert row shifts cells and references', () => {
    const b = book({ A1: '1', A2: '2', A3: '3', A4: '=SUM(A1:A3)', B1: '=A3*2' });
    b.wb.insertRows(b.s, 1, 1);
    expect(b.raw('A5')).toBe('=SUM(A1:A4)');
    expect(b.raw('B1')).toBe('=A4*2');
    expect(b.get('A5')).toBe(6);
  });

  test('delete row: references to it become #REF!, ranges shrink', () => {
    const b = book({ A1: '1', A2: '2', A3: '3', A4: '=SUM(A1:A3)', B1: '=A3*2' });
    b.wb.deleteRows(b.s, 2, 1);
    expect(b.raw('A3')).toBe('=SUM(A1:A2)');
    expect(b.raw('B1')).toBe('=#REF!*2');
    expect(b.get('A3')).toBe(3);
  });

  test('deleting every row of a range makes it #REF!', () => {
    const b = book({ A2: '1', A3: '2', C1: '=SUM(A2:A3)' });
    b.wb.deleteRows(b.s, 1, 2);
    expect(b.raw('C1')).toBe('=SUM(#REF!)');
  });

  test('absolute references move too (they point at the same cell)', () => {
    const b = book({ A5: '7', B1: '=$A$5' });
    b.wb.insertRows(b.s, 0, 2);
    expect(b.raw('B3')).toBe('=$A$7');
    expect(b.get('B3')).toBe(7);
  });

  test('insert and delete columns, including column widths', () => {
    const b = book({ A1: '1', B1: '2', C1: '=A1+B1', D1: '=SUM(A:B)' });
    b.s.colWidths = { 1: 150 };
    b.wb.insertCols(b.s, 1, 1);
    expect(b.raw('D1')).toBe('=A1+C1');
    expect(b.raw('E1')).toBe('=SUM(A:C)');
    expect(b.s.colWidths).toEqual({ 2: 150 });
    b.wb.deleteCols(b.s, 0, 1);
    expect(b.raw('C1')).toBe('=#REF!+B1');
  });

  test('other sheets referring to the changed sheet are updated', () => {
    const wb = new Workbook();
    const a = wb.addSheet('A');
    const b = wb.addSheet('B');
    wb.setRaw(a, 2, 0, '5');
    wb.setRaw(b, 0, 0, '=A!A3');
    wb.recalcAll();
    wb.insertRows(a, 0, 1);
    expect(b.get(0, 0)?.raw).toBe('=A!A4');
    expect(b.get(0, 0)?.value).toBe(5);
  });
});

describe('styles', () => {
  test('typing a percentage or currency applies a format', () => {
    const b = book({ A1: '12%', A2: '$5.50', A3: '1,000', A4: '2026-11-13' });
    expect(b.s.get(0, 0)?.style).toEqual({ fmt: '0%' });
    expect(b.s.get(1, 0)?.style).toEqual({ fmt: '$#,##0.00' });
    expect(b.s.get(2, 0)?.style).toEqual({ fmt: '#,##0' });
    expect(b.s.get(3, 0)?.style).toEqual({ fmt: 'yyyy-mm-dd' });
  });

  test('an existing format is not overwritten by typing', () => {
    const b = book();
    b.wb.setStyle(b.s, 0, 0, { fmt: '0.000' }, true);
    b.set('A1', '50%');
    expect(b.s.get(0, 0)?.style?.fmt).toBe('0.000');
  });

  test('empty styles are cleaned up and empty cells removed', () => {
    const b = book({ A1: 'x' });
    b.wb.setStyle(b.s, 0, 0, { b: true, fmt: 'General' }, false);
    expect(b.s.get(0, 0)?.style).toEqual({ b: true });
    b.wb.setStyle(b.s, 0, 0, { b: false }, false);
    expect(b.s.get(0, 0)?.style).toBeNull();
    b.set('A1', '');
    expect(b.s.cells.size).toBe(0);
  });

  test('a styled empty cell is kept', () => {
    const b = book();
    b.wb.setStyle(b.s, 2, 2, { fill: '#ff0' }, true);
    expect(b.s.cells.size).toBe(1);
  });
});

describe('save and load', () => {
  test('round-trips values, formulas, styles, widths and sheet ids', () => {
    const b = book({ A1: '5', A2: '=A1*2', B1: 'hi' });
    b.wb.setStyle(b.s, 0, 0, { b: true, fmt: '0.00' }, false);
    b.s.colWidths = { 0: 140 };
    const json = JSON.parse(JSON.stringify(b.wb.toJSON()));
    const wb2 = Workbook.fromJSON(json);
    const s2 = wb2.sheets[0];
    expect(s2.id).toBe(b.s.id);
    expect(s2.get(1, 0)?.value).toBe(10);
    expect(s2.get(0, 0)?.style).toEqual({ b: true, fmt: '0.00' });
    expect(s2.colWidths).toEqual({ 0: 140 });
  });

  test('a saved snapshot is not affected by later edits', () => {
    const b = book();
    b.wb.setStyle(b.s, 0, 0, { b: true }, true);
    const json = b.wb.toJSON();
    b.wb.setStyle(b.s, 0, 0, { i: true }, false);
    expect(json.sheets[0].cells?.A1.s).toEqual({ b: true });
  });

  test('cross-sheet formulas resolve after loading', () => {
    const wb = Workbook.fromJSON({
      sheets: [{ name: 'A', cells: { A1: { v: '=B!A1+1' } } }, { name: 'B', cells: { A1: { v: '41' } } }],
    });
    expect(wb.sheets[0].get(0, 0)?.value).toBe(42);
  });

  test('rejects things that are not workbooks', () => {
    expect(() => Workbook.fromJSON({} as never)).toThrow();
  });
});
