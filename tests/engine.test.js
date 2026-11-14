// Run with:  node --test localcalc/tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

for (const f of ['formula', 'format', 'functions', 'engine', 'io']) require(path.join(__dirname, '..', 'js', f + '.js'));
const LC = globalThis.LC;

/** Builds a one-sheet workbook from {A1: '...', ...} and returns a getter. */
function book(cells) {
  const wb = new LC.Workbook();
  const s = wb.addSheet('Sheet1');
  const gks = [];
  for (const [name, raw] of Object.entries(cells)) {
    const p = LC.parseCellName(name);
    gks.push(wb.setRaw(s, p.r, p.c, raw));
  }
  wb.recalc(gks);
  const get = (name) => {
    const p = LC.parseCellName(name);
    const cell = s.get(p.r, p.c);
    const v = cell ? cell.value : null;
    return LC.isErr(v) ? v.code : v;
  };
  const set = (name, raw) => {
    const p = LC.parseCellName(name);
    wb.recalc([wb.setRaw(s, p.r, p.c, raw)]);
  };
  const raw = (name) => { const p = LC.parseCellName(name); const c = s.get(p.r, p.c); return c ? c.raw : ''; };
  return { wb, s, get, set, raw };
}
const calc = (formula, cells = {}) => book(Object.assign({}, cells, { Z99: formula })).get('Z99');

test('arithmetic and precedence', () => {
  assert.equal(calc('=1+2*3'), 7);
  assert.equal(calc('=(1+2)*3'), 9);
  assert.equal(calc('=2^3^2'), 64); // left-associative like Excel
  assert.equal(calc('=-2^2'), 4); // unary minus binds tighter than ^
  assert.equal(calc('=50%'), 0.5);
  assert.equal(calc('=10/4'), 2.5);
  assert.equal(calc('=1/0'), '#DIV/0!');
  assert.equal(calc('="a"&1&TRUE'), 'a1TRUE');
  assert.equal(calc('=0.1+0.2=0.3'), true);
  assert.equal(calc('="abc"<"ABD"'), true);
  assert.equal(calc('=1<"a"'), true); // numbers sort before text
  assert.equal(calc('="3"+4'), 7); // numeric text is coerced
  assert.equal(calc('="x"+4'), '#VALUE!');
});

test('references, ranges and errors', () => {
  const b = book({ A1: '1', A2: '2', A3: '3', B1: '=A1+A2', B2: '=SUM(A1:A3)', B3: '=FOO(1)', B4: '=A1+', B5: '=Sheet9!A1' });
  assert.equal(b.get('B1'), 3);
  assert.equal(b.get('B2'), 6);
  assert.equal(b.get('B3'), '#NAME?');
  assert.equal(b.get('B4'), '#ERROR!');
  assert.equal(b.get('B5'), '#REF!');
});

test('recalculation follows dependencies', () => {
  const b = book({ A1: '1', B1: '=A1*10', C1: '=B1+1', D1: '=SUM(A1:C1)' });
  assert.equal(b.get('C1'), 11);
  b.set('A1', '5');
  assert.equal(b.get('B1'), 50);
  assert.equal(b.get('C1'), 51);
  assert.equal(b.get('D1'), 106);
});

test('circular references are detected', () => {
  const b = book({ A1: '=B1+1', B1: '=A1+1', C1: '=A1' });
  assert.equal(b.get('A1'), '#CIRC!');
  assert.equal(b.get('B1'), '#CIRC!');
  b.set('B1', '5');
  assert.equal(b.get('A1'), 6);
  assert.equal(b.get('C1'), 6);
});

test('very long dependency chains do not overflow the stack', () => {
  const wb = new LC.Workbook();
  const s = wb.addSheet('S');
  const gks = [wb.setRaw(s, 0, 0, '1')];
  // Built bottom-up so evaluation order is worst-case.
  for (let r = 1; r < 20000; r++) gks.push(wb.setRaw(s, r, 0, '=A' + r + '+1'));
  wb.recalc(gks);
  assert.equal(s.get(19999, 0).value, 20000);
  wb.recalc([wb.setRaw(s, 0, 0, '101')]);
  assert.equal(s.get(19999, 0).value, 20100);
});

test('cross-sheet references and sheet rename', () => {
  const wb = new LC.Workbook();
  const a = wb.addSheet('Data');
  const b = wb.addSheet('Report');
  wb.setRaw(a, 0, 0, '42');
  wb.setRaw(b, 0, 0, '=Data!A1*2');
  wb.recalcAll();
  assert.equal(b.get(0, 0).value, 84);
  wb.renameSheet(a, 'My Data');
  assert.equal(b.get(0, 0).raw, "='My Data'!A1*2");
  assert.equal(b.get(0, 0).value, 84);
  wb.removeSheet(a);
  assert.equal(b.get(0, 0).raw, '=#REF!*2');
  assert.equal(b.get(0, 0).value.code, '#REF!');
});

test('math and statistics functions', () => {
  const cells = { A1: '10', A2: '20', A3: 'text', A4: '', A5: '30' };
  assert.equal(calc('=AVERAGE(A1:A5)', cells), 20);
  assert.equal(calc('=COUNT(A1:A5)', cells), 3);
  assert.equal(calc('=COUNTA(A1:A5)', cells), 4);
  assert.equal(calc('=MAX(A1:A5)', cells), 30);
  assert.equal(calc('=MIN(A1:A5)', cells), 10);
  assert.equal(calc('=MEDIAN(1,3,2,4)'), 2.5);
  assert.equal(calc('=ROUND(2.675,2)'), 2.68);
  assert.equal(calc('=ROUND(-2.5,0)'), -3);
  assert.equal(calc('=ROUNDDOWN(3.99,0)'), 3);
  assert.equal(calc('=ROUND(1234,-2)'), 1200);
  assert.equal(calc('=MOD(-3,2)'), 1);
  assert.equal(calc('=SUMPRODUCT(A1:A2,A1:A2)', cells), 500);
  assert.equal(calc('=STDEV.P(2,4,4,4,5,5,7,9)'), 2);
  assert.equal(calc('=LARGE(A1:A5,2)', cells), 20);
  assert.equal(calc('=RANK(20,A1:A5)', cells), 2);
  assert.equal(calc('=SQRT(-1)'), '#NUM!');
});

test('conditional aggregation', () => {
  const cells = { A1: 'apple', A2: 'banana', A3: 'apple pie', A4: 'cherry', B1: '1', B2: '2', B3: '3', B4: '4' };
  assert.equal(calc('=SUMIF(A1:A4,"apple*",B1:B4)', cells), 4);
  assert.equal(calc('=COUNTIF(B1:B4,">=2")', cells), 3);
  assert.equal(calc('=COUNTIF(A1:A4,"<>apple")', cells), 3);
  assert.equal(calc('=SUMIFS(B1:B4,A1:A4,"*e*",B1:B4,"<4")', cells), 4);
  assert.equal(calc('=AVERAGEIF(B1:B4,">1")', cells), 3);
  assert.equal(calc('=COUNTIFS(A1:A4,"?????",B1:B4,1)', cells), 1);
});

test('logic and text functions', () => {
  assert.equal(calc('=IF(1>2,"yes","no")'), 'no');
  assert.equal(calc('=IF(TRUE,1/0,5)'), '#DIV/0!');
  assert.equal(calc('=IF(FALSE,1/0,5)'), 5);
  assert.equal(calc('=IFERROR(1/0,"oops")'), 'oops');
  assert.equal(calc('=AND(TRUE,1,2>1)'), true);
  assert.equal(calc('=OR(FALSE,0)'), false);
  assert.equal(calc('=IFS(1>2,"a",2>1,"b")'), 'b');
  assert.equal(calc('=SWITCH(2,1,"one",2,"two","other")'), 'two');
  assert.equal(calc('=LEFT("Hello",2)&RIGHT("World",3)'), 'Herld');
  assert.equal(calc('=MID("spreadsheet",7,5)'), 'sheet');
  assert.equal(calc('=UPPER("abc")&LOWER("DEF")&LEN("four")'), 'ABCdef4');
  assert.equal(calc('=PROPER("hello wORLD")'), 'Hello World');
  assert.equal(calc('=TRIM("  a   b  ")'), 'a b');
  assert.equal(calc('=SUBSTITUTE("a-b-c","-","+")'), 'a+b+c');
  assert.equal(calc('=SUBSTITUTE("a-b-c","-","+",2)'), 'a-b+c');
  assert.equal(calc('=FIND("b","abc")'), 2);
  assert.equal(calc('=SEARCH("B?","xaBcd")'), 3);
  assert.equal(calc('=TEXTJOIN(", ",TRUE,"a","","b")'), 'a, b');
  assert.equal(calc('=TEXT(0.256,"0.0%")'), '25.6%');
  assert.equal(calc('=TEXT(1234.5,"#,##0.00")'), '1,234.50');
  assert.equal(calc('=VALUE("1,234")'), 1234);
});

test('lookup functions', () => {
  const cells = {
    A1: 'apple', B1: '1.2', C1: 'red',
    A2: 'banana', B2: '0.5', C2: 'yellow',
    A3: 'cherry', B3: '3', C3: 'red',
    E1: '0', F1: 'F', E2: '50', F2: 'C', E3: '80', F3: 'A',
  };
  assert.equal(calc('=VLOOKUP("banana",A1:C3,3,FALSE)', cells), 'yellow');
  assert.equal(calc('=VLOOKUP("kiwi",A1:C3,2,FALSE)', cells), '#N/A');
  assert.equal(calc('=VLOOKUP(65,E1:F3,2)', cells), 'C'); // approximate match
  assert.equal(calc('=VLOOKUP(65,E1:F3,2,TRUE)', cells), 'C');
  assert.equal(calc('=MATCH("cherry",A1:A3,0)', cells), 3);
  assert.equal(calc('=INDEX(A1:C3,2,3)', cells), 'yellow');
  assert.equal(calc('=INDEX(A1:C3,MATCH("cherry",A1:A3,0),2)', cells), 3);
  assert.equal(calc('=XLOOKUP("cherry",A1:A3,C1:C3)', cells), 'red');
  assert.equal(calc('=XLOOKUP("kiwi",A1:A3,C1:C3,"none")', cells), 'none');
  assert.equal(calc('=SUM(INDEX(B1:B3,0))', cells), 4.7);
  assert.equal(calc('=CHOOSE(2,"a","b","c")'), 'b');
  assert.equal(calc('=ROW(C7)+COLUMN(C7)'), 10);
});

test('dates', () => {
  assert.equal(calc('=DATE(2026,11,13)'), 46339);
  assert.equal(calc('=YEAR(46339)&"-"&MONTH(46339)&"-"&DAY(46339)'), '2026-11-13');
  assert.equal(calc('=EOMONTH(DATE(2024,1,15),1)'), calc('=DATE(2024,2,29)'));
  assert.equal(calc('=EDATE(DATE(2024,1,31),1)'), calc('=DATE(2024,2,29)'));
  assert.equal(calc('=WEEKDAY(DATE(2026,11,13))'), 6); // a Friday
  assert.equal(calc('=DATEDIF(DATE(2000,5,10),DATE(2026,5,9),"Y")'), 25);
  assert.equal(calc('=A1+1', { A1: '2026-11-13' }), 46340);
});

test('whole-column references', () => {
  const b = book({ A1: '1', A2: '2', A3: '3', B1: '=SUM(A:A)' });
  assert.equal(b.get('B1'), 6);
  b.set('A10', '4');
  assert.equal(b.get('B1'), 10);
});

test('copying a formula shifts relative references only', () => {
  assert.equal(LC.offsetFormula('=A1+$B$1+$C2+D$3', 2, 1), '=B3+$B$1+$C4+E$3');
  assert.equal(LC.offsetFormula('=SUM(A1:B2)', 1, 1), '=SUM(B2:C3)');
  assert.equal(LC.offsetFormula('=A1', -1, 0), '=#REF!');
  assert.equal(LC.normalizeFormula('=sum(a1:b2'), '=SUM(A1:B2)');
});

test('inserting and deleting rows rewrites formulas', () => {
  const b = book({ A1: '1', A2: '2', A3: '3', A4: '=SUM(A1:A3)', B1: '=A3*2' });
  b.wb.insertRows(b.s, 1, 1); // new empty row 2
  assert.equal(b.raw('A5'), '=SUM(A1:A4)');
  assert.equal(b.raw('B1'), '=A4*2');
  assert.equal(b.get('A5'), 6);
  b.wb.deleteRows(b.s, 3, 1); // delete row 4 (the old A3)
  assert.equal(b.raw('A4'), '=SUM(A1:A3)');
  assert.equal(b.raw('B1'), '=#REF!*2');
  assert.equal(b.get('A4'), 3);
  b.wb.insertCols(b.s, 0, 1);
  assert.equal(b.raw('B4'), '=SUM(B1:B3)');
});

test('number formats', () => {
  const f = LC.formatValue;
  assert.equal(f(1234.567, '#,##0.00'), '1,234.57');
  assert.equal(f(-1234.5, '$#,##0.00'), '-$1,234.50');
  assert.equal(f(0.125, '0.0%'), '12.5%');
  assert.equal(f(-5, '0;(0)'), '(5)');
  assert.equal(f(46339, 'yyyy-mm-dd'), '2026-11-13');
  assert.equal(f(46339, 'dddd, mmmm d'), 'Friday, November 13');
  assert.equal(f(0.75, 'h:mm AM/PM'), '6:00 PM');
  assert.equal(f(1 / 3), '0.3333333333');
  assert.equal(f(123456789012), '1.23457E+11');
  assert.equal(LC.adjustDecimals('#,##0.00', 1), '#,##0.000');
  assert.equal(LC.adjustDecimals('0%', 1), '0.0%');
  assert.equal(LC.adjustDecimals('0.0', -1), '0');
});

test('input parsing', () => {
  const p = LC.parseInput;
  assert.deepEqual(p('12%'), { kind: 'value', value: 0.12, fmt: '0%' });
  assert.deepEqual(p('$1,200.50'), { kind: 'value', value: 1200.5, fmt: '$#,##0.00' });
  assert.deepEqual(p('1,000'), { kind: 'value', value: 1000, fmt: '#,##0' });
  assert.equal(p('TRUE').value, true);
  assert.equal(p("'123").value, '123');
  assert.equal(p('hello').value, 'hello');
  assert.equal(p('=A1').kind, 'formula');
});

test('save and load round-trip', () => {
  const b = book({ A1: '5', A2: '=A1*2', B1: 'hi' });
  b.wb.setStyle(b.s, 0, 0, { b: true, fmt: '0.00' });
  const json = JSON.parse(JSON.stringify(b.wb.toJSON()));
  const wb2 = LC.Workbook.fromJSON(json);
  const s2 = wb2.sheets[0];
  assert.equal(s2.get(1, 0).value, 10);
  assert.deepEqual(s2.get(0, 0).style, { b: true, fmt: '0.00' });
});

test('CSV parsing handles quotes and newlines', () => {
  const rows = LC.csv.parse('a,"b,c","say ""hi"""\n1,"multi\nline",3\n');
  assert.deepEqual(rows, [['a', 'b,c', 'say "hi"'], ['1', 'multi\nline', '3']]);
  assert.equal(LC.csv.stringify(rows), 'a,"b,c","say ""hi"""\r\n1,"multi\nline",3');
});
