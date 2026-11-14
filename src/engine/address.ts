/** A1-style addresses. Rows and columns are 0-based internally. */

export const MAX_ROWS = 1048576;
export const MAX_COLS = 16384;

/**
 * Column letters are a *bijective* base-26 number: A=1 … Z=26, AA=27.
 * ("Bijective" = there is no zero digit, unlike ordinary base 26.)
 */
export function colName(c: number): string {
  let s = '';
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function colIndex(name: string): number {
  let n = 0;
  const up = name.toUpperCase();
  for (let i = 0; i < up.length; i++) n = n * 26 + (up.charCodeAt(i) - 64);
  return n - 1;
}

export const cellName = (r: number, c: number): string => colName(c) + (r + 1);

export interface CellPos {
  r: number;
  c: number;
}

export function parseCellName(s: string): CellPos | null {
  const m = /^\s*\$?([A-Za-z]{1,3})\$?(\d+)\s*$/.exec(s);
  if (!m) return null;
  const c = colIndex(m[1]);
  const r = parseInt(m[2], 10) - 1;
  if (r < 0 || r >= MAX_ROWS || c >= MAX_COLS) return null;
  return { r, c };
}

/** Sheet names that could be mistaken for something else need 'quotes'. */
export function quoteSheet(name: string): string {
  const plain = /^[A-Za-z_][\w.]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) &&
    !/^(TRUE|FALSE)$/i.test(name);
  return plain ? name : "'" + name.replace(/'/g, "''") + "'";
}
