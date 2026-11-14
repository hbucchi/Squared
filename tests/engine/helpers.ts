import { Workbook, isErr, parseCellName, type Scalar, type Sheet } from '../../src/engine';

export interface TestBook {
  wb: Workbook;
  s: Sheet;
  /** Value of a cell; errors are returned as their code, e.g. "#N/A". */
  get(name: string): Scalar | string;
  set(name: string, raw: string): void;
  raw(name: string): string;
}

/** Builds a one-sheet workbook from {A1: '...', ...}. */
export function book(cells: Record<string, string> = {}): TestBook {
  const wb = new Workbook();
  const s = wb.addSheet('Sheet1');
  const gks = Object.entries(cells).map(([name, raw]) => {
    const p = parseCellName(name)!;
    return wb.setRaw(s, p.r, p.c, raw);
  });
  wb.recalc(gks);
  const pos = (name: string) => parseCellName(name)!;
  return {
    wb,
    s,
    get(name) {
      const p = pos(name);
      const v = s.get(p.r, p.c)?.value ?? null;
      return isErr(v) ? v.code : v;
    },
    set(name, raw) {
      const p = pos(name);
      wb.recalc([wb.setRaw(s, p.r, p.c, raw)]);
    },
    raw(name) {
      const p = pos(name);
      return s.get(p.r, p.c)?.raw ?? '';
    },
  };
}

/** Evaluates one formula (in Z99) against optional surrounding cells. */
export const calc = (formula: string, cells: Record<string, string> = {}): Scalar | string =>
  book({ ...cells, Z99: formula }).get('Z99');
