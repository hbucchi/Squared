import { describe, expect, test } from 'vitest';
import { FUNCTION_SIGS, functionNames, todaySerial, type Scalar } from '../../src/engine';
import { calc } from './helpers';

/**
 * Shared test data, laid out like a small sheet:
 *
 *      A          B      C        E    F     H   I   J
 *   1  apple      1.2    red      0    F     1   2   3
 *   2  banana     0.5    yellow   50   D     4   5   6
 *   3  cherry     3      red      60   C
 *   4  apple pie  10     (blank)  70   B
 *   5  text       TRUE   #N/A     80   A
 */
const DATA: Record<string, string> = {
  A1: 'apple', B1: '1.2', C1: 'red', E1: '0', F1: 'F',
  A2: 'banana', B2: '0.5', C2: 'yellow', E2: '50', F2: 'D',
  A3: 'cherry', B3: '3', C3: 'red', E3: '60', F3: 'C',
  A4: 'apple pie', B4: '10', E4: '70', F4: 'B',
  A5: 'text', B5: 'TRUE', C5: '=NA()', E5: '80', F5: 'A',
  H1: '1', I1: '2', J1: '3', H2: '4', I2: '5', J2: '6',
};

type Expect = Scalar | string | ((v: Scalar | string) => boolean);
/** [formula, expected]. Every function in the library must appear here (see the last test). */
const CASES: Array<[string, Expect]> = [
  // ---- math & statistics
  ['=SUM(B1:B5)', 14.7], // TRUE in a range is ignored
  ['=SUM(1,"2",TRUE)', 4], // typed-in arguments are coerced
  ['=SUM(C1:C5)', '#N/A'], // errors propagate
  ['=SUM()', 0],
  ['=AVERAGE(B1:B4)', 3.675],
  ['=AVERAGE(A1:A3)', '#DIV/0!'],
  ['=MIN(E1:E5)', 0],
  ['=MAX(E1:E5,100)', 100],
  ['=MAX(A1:A3)', 0],
  ['=COUNT(A1:B5)', 4],
  ['=COUNT(1,"2","x",TRUE)', 3],
  ['=COUNTA(A1:C5)', 14],
  ['=COUNTBLANK(A1:C5)', 1],
  ['=PRODUCT(H1:J1)', 6],
  ['=MEDIAN(1,3,2,4)', 2.5],
  ['=MEDIAN(5,1,3)', 3],
  ['=VAR(2,4,4,4,5,5,7,9)', 32 / 7],
  ['=VAR.S(1,2,3,4)', 5 / 3],
  ['=VAR.P(2,4,4,4,5,5,7,9)', 4],
  ['=STDEV(2,4,4,4,5,5,7,9)', Math.sqrt(32 / 7)],
  ['=STDEV.S(1)', '#DIV/0!'],
  ['=STDEV.P(2,4,4,4,5,5,7,9)', 2],
  ['=LARGE(E1:E5,2)', 70],
  ['=LARGE(E1:E5,9)', '#NUM!'],
  ['=SMALL(E1:E5,1)', 0],
  ['=RANK(70,E1:E5)', 2],
  ['=RANK(70,E1:E5,1)', 4],
  ['=RANK(71,E1:E5)', '#N/A'],
  ['=RANK.EQ(80,E1:E5)', 1],
  ['=ABS(-3.5)', 3.5],
  ['=SQRT(16)', 4],
  ['=POWER(2,10)', 1024],
  ['=POWER(0,-1)', '#DIV/0!'],
  ['=MOD(10,3)', 1],
  ['=MOD(-3,2)', 1], // sign follows the divisor, like Excel
  ['=MOD(5,0)', '#DIV/0!'],
  ['=INT(-2.5)', -3],
  ['=TRUNC(-2.57,1)', -2.5],
  ['=ROUND(2.675,2)', 2.68], // naive JS rounding gives 2.67
  ['=ROUND(-2.5,0)', -3], // half away from zero
  ['=ROUND(1234,-2)', 1200],
  ['=ROUNDUP(3.21,1)', 3.3],
  ['=ROUNDDOWN(3.99,0)', 3],
  ['=CEILING(4.1,0.5)', 4.5],
  ['=CEILING(7)', 7],
  ['=FLOOR(4.9,2)', 4],
  ['=FLOOR(1,0)', '#DIV/0!'],
  ['=EXP(0)', 1],
  ['=LN(1)', 0],
  ['=LN(0)', '#NUM!'],
  ['=LOG10(1000)', 3],
  ['=LOG(8,2)', 3],
  ['=LOG(100)', 2],
  ['=LOG(5,1)', '#DIV/0!'],
  ['=ROUND(PI(),5)', 3.14159],
  ['=SIGN(-7)', -1],
  ['=RAND()', (v) => typeof v === 'number' && v >= 0 && v < 1],
  ['=RANDBETWEEN(3,5)', (v) => v === 3 || v === 4 || v === 5],
  ['=RANDBETWEEN(5,3)', '#NUM!'],
  ['=SUMPRODUCT(H1:J1,H2:J2)', 32],
  ['=SUMPRODUCT(H1:J1,H1:H2)', '#VALUE!'],
  ['=SUMIF(A1:A5,"apple*",B1:B5)', 11.2],
  ['=SUMIF(E1:E5,">=60")', 210],
  ['=SUMIF(C1:C4,"red",B1:B4)', 4.2],
  ['=COUNTIF(A1:A5,"<>apple")', 4],
  ['=COUNTIF(E1:E5,">"&E2)', 3],
  ['=COUNTIF(C1:C4,"")', 1],
  ['=COUNTIF(A1:A5,"?????")', 1], // exactly five characters: "apple"
  ['=COUNTIF(A1:A5,"*an*")', 1],
  ['=COUNTIF(B1:B5,TRUE)', 1],
  ['=AVERAGEIF(E1:E5,">0")', 65],
  ['=AVERAGEIF(E1:E5,">100")', '#DIV/0!'],
  ['=SUMIFS(B1:B4,A1:A4,"*e*",B1:B4,"<4")', 4.2],
  ['=SUMIFS(B1:B4,A1:A3,"a*")', '#VALUE!'], // ranges must be the same size
  ['=MAXIFS(E1:E4,A1:A5,"*")', '#VALUE!'],
  ['=COUNTIFS(C1:C4,"red",E1:E4,">10")', 1],
  ['=AVERAGEIFS(E1:E5,C1:C5,"red")', 30],
  ['=MAXIFS(E1:E5,C1:C5,"red")', 60],
  ['=MINIFS(E1:E5,A1:A5,"*a*")', 0],
  // ---- logic
  ['=IF(1>2,"yes","no")', 'no'],
  ['=IF(TRUE,1/0,5)', '#DIV/0!'],
  ['=IF(FALSE,1/0,5)', 5], // the untaken branch's error doesn't matter
  ['=IF(FALSE,1)', false],
  ['=IF("x",1,2)', '#VALUE!'],
  ['=IFS(1>2,"a",2>1,"b")', 'b'],
  ['=IFS(FALSE,1)', '#N/A'],
  ['=IFERROR(1/0,"oops")', 'oops'],
  ['=IFERROR(5,"oops")', 5],
  ['=IFNA(C5,"none")', 'none'],
  ['=IFNA(1/0,"none")', '#DIV/0!'],
  ['=AND(TRUE,1,2>1)', true],
  ['=AND(A1:A3)', '#VALUE!'], // no logical values at all
  ['=OR(FALSE,0)', false],
  ['=OR(B5,FALSE)', true],
  ['=XOR(TRUE,TRUE,TRUE)', true],
  ['=NOT(0)', true],
  ['=TRUE()', true],
  ['=FALSE()', false],
  ['=SWITCH(2,1,"one",2,"two","other")', 'two'],
  ['=SWITCH(9,1,"one","other")', 'other'],
  ['=SWITCH(9,1,"one")', '#N/A'],
  // ---- text
  ['=CONCAT(A1:A2,"!")', 'applebanana!'],
  ['=CONCATENATE("a",1,TRUE)', 'a1TRUE'],
  ['=TEXTJOIN(", ",TRUE,"a","","b")', 'a, b'],
  ['=TEXTJOIN("-",FALSE,H1:J1)', '1-2-3'],
  ['=LEN("four")', 4],
  ['=LEN(123.5)', 5],
  ['=UPPER("abc")', 'ABC'],
  ['=LOWER("DEF")', 'def'],
  ['=PROPER("hello wORLD o\'neil")', "Hello World O'Neil"],
  ['=TRIM("  a   b  ")', 'a b'],
  ['=LEFT("Hello",2)', 'He'],
  ['=LEFT("Hello")', 'H'],
  ['=LEFT("Hello",-1)', '#VALUE!'],
  ['=RIGHT("World",3)', 'rld'],
  ['=RIGHT("abc",0)', ''],
  ['=MID("spreadsheet",7,5)', 'sheet'],
  ['=MID("abc",0,1)', '#VALUE!'],
  ['=FIND("b","abcb")', 2],
  ['=FIND("b","abcb",3)', 4],
  ['=FIND("B","abc")', '#VALUE!'], // FIND is case-sensitive
  ['=SEARCH("B?","xaBcd")', 3],
  ['=SEARCH("z","abc")', '#VALUE!'],
  ['=SUBSTITUTE("a-b-c","-","+")', 'a+b+c'],
  ['=SUBSTITUTE("a-b-c","-","+",2)', 'a-b+c'],
  ['=SUBSTITUTE("abc","","x")', 'abc'],
  ['=REPLACE("abcdef",2,3,"X")', 'aXef'],
  ['=REPT("ab",3)', 'ababab'],
  ['=REPT("ab",-1)', '#VALUE!'],
  ['=TEXT(0.256,"0.0%")', '25.6%'],
  ['=TEXT(1234.5,"#,##0.00")', '1,234.50'],
  ['=TEXT(46339,"dd mmm yyyy")', '13 Nov 2026'],
  ['=TEXT("12","000")', '012'],
  ['=VALUE("1,234")', 1234],
  ['=VALUE("12%")', 0.12],
  ['=VALUE("abc")', '#VALUE!'],
  ['=EXACT("a","A")', false],
  ['=CHAR(65)', 'A'],
  ['=CODE("A")', 65],
  ['=CODE("")', '#VALUE!'],
  // ---- lookup & reference
  ['=VLOOKUP("banana",A1:C3,3,FALSE)', 'yellow'],
  ['=VLOOKUP("BANANA",A1:C3,2,FALSE)', 0.5], // case-insensitive
  ['=VLOOKUP("ch*",A1:C3,3,FALSE)', 'red'], // wildcards
  ['=VLOOKUP("kiwi",A1:C3,2,FALSE)', '#N/A'],
  ['=VLOOKUP(65,E1:F5,2)', 'C'], // approximate match (sorted data)
  ['=VLOOKUP(-1,E1:F5,2)', '#N/A'],
  ['=VLOOKUP("apple",A1:C3,4,FALSE)', '#REF!'],
  ['=VLOOKUP("apple",A1:C3,0,FALSE)', '#VALUE!'],
  ['=HLOOKUP(2,H1:J2,2,FALSE)', 5],
  ['=MATCH("cherry",A1:A5,0)', 3],
  ['=MATCH(65,E1:E5)', 3],
  ['=MATCH(65,E1:E5,0)', '#N/A'],
  ['=MATCH(2,H1:J1,0)', 2],
  ['=INDEX(A1:C3,2,3)', 'yellow'],
  ['=INDEX(H1:J1,3)', 3], // one row: the single index is a column
  ['=INDEX(A1:C3,4,1)', '#REF!'],
  ['=INDEX(A1:C3,MATCH("cherry",A1:A3,0),2)', 3],
  ['=SUM(INDEX(B1:B4,0))', 14.7],
  ['=SUM(INDEX(H1:J2,2,0))', 15],
  ['=XLOOKUP("cherry",A1:A5,C1:C5)', 'red'],
  ['=XLOOKUP("kiwi",A1:A5,C1:C5,"none")', 'none'],
  ['=XLOOKUP("kiwi",A1:A5,C1:C5)', '#N/A'],
  ['=XLOOKUP(65,E1:E5,F1:F5,,-1)', 'C'],
  ['=XLOOKUP(65,E1:E5,F1:F5,,1)', 'B'],
  ['=XLOOKUP(2,H1:J1,H2:J2)', 5],
  ['=CHOOSE(2,"a","b","c")', 'b'],
  ['=CHOOSE(4,"a","b","c")', '#VALUE!'],
  ['=ROWS(A1:C5)', 5],
  ['=COLUMNS(A1:C5)', 3],
  ['=ROW(C7)', 7],
  ['=ROW()', 99], // the test formula lives in Z99
  ['=COLUMN(C7)', 3],
  ['=COLUMN()', 26],
  // ---- information
  ['=ISBLANK(C4)', true],
  ['=ISBLANK(A1)', false],
  ['=ISNUMBER(B1)', true],
  ['=ISNUMBER("1")', false],
  ['=ISTEXT(A1)', true],
  ['=ISNONTEXT(B1)', true],
  ['=ISLOGICAL(B5)', true],
  ['=ISERROR(1/0)', true],
  ['=ISERR(C5)', false], // ISERR ignores #N/A
  ['=ISERR(1/0)', true],
  ['=ISNA(C5)', true],
  ['=ISEVEN(4)', true],
  ['=ISODD(-3)', true],
  ['=NA()', '#N/A'],
  // ---- dates (serial numbers: days since 1899-12-30)
  ['=DATE(2026,11,13)', 46339],
  ['=DATE(2024,13,1)', 45658], // month 13 rolls into next year
  ['=TIME(12,0,0)', 0.5],
  ['=DATEVALUE("2026-11-13")', 46339],
  ['=DATEVALUE("hello")', '#VALUE!'],
  ['=YEAR(46339)', 2026],
  ['=MONTH(46339)', 11],
  ['=DAY(46339)', 13],
  ['=HOUR(0.75)', 18],
  ['=MINUTE(TIME(9,41,0))', 41],
  ['=SECOND(TIME(0,0,30))', 30],
  ['=WEEKDAY(DATE(2026,11,13))', 6], // a Friday
  ['=WEEKDAY(DATE(2026,11,13),2)', 5],
  ['=EDATE(DATE(2024,1,31),1)', 45351], // clamps to 29 Feb 2024
  ['=EOMONTH(DATE(2024,1,15),1)', 45351],
  ['=DAYS(DATE(2026,12,25),DATE(2026,11,13))', 42],
  ['=DATEDIF(DATE(2000,5,10),DATE(2026,5,9),"Y")', 25],
  ['=DATEDIF(DATE(2026,1,31),DATE(2026,3,1),"M")', 1],
  ['=DATEDIF(DATE(2026,3,1),DATE(2026,1,1),"D")', '#NUM!'],
  ['=TODAY()', (v) => v === todaySerial()],
  ['=NOW()', (v) => typeof v === 'number' && Math.floor(v) === todaySerial()],
];

describe('function library', () => {
  test.each(CASES)('%s', (formula, want) => {
    const got = calc(formula, DATA);
    if (typeof want === 'function') expect(want(got)).toBe(true);
    else if (typeof want === 'number' && typeof got === 'number') expect(got).toBeCloseTo(want, 10);
    else expect(got).toBe(want);
  });

  test('every function has at least one test case', () => {
    const tested = new Set(CASES.flatMap(([f]) => f.match(/[A-Z][A-Z0-9.]*(?=\()/g) ?? []));
    expect(functionNames.filter((n) => !tested.has(n))).toEqual([]);
  });

  test('every function has a signature whose name matches', () => {
    for (const n of functionNames) expect(FUNCTION_SIGS[n].startsWith(n + '(')).toBe(true);
  });

  test('wrong number of arguments is #VALUE!', () => {
    for (const f of ['=ABS()', '=ABS(1,2)', '=LEFT()', '=IF()', '=VLOOKUP(1,A1:B2)', '=DATE(2026,1)']) {
      expect(calc(f, DATA)).toBe('#VALUE!');
    }
  });
});
