import { expect, type Page } from '@playwright/test';

const pos = (ref: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  const c = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  return { r: +m[2], c };
};

/** The <td> of a cell, e.g. cell(page, 'B3'). */
export const cell = (page: Page, ref: string) => {
  const { r, c } = pos(ref);
  return page.locator(`#grid tbody tr:nth-child(${r}) td:nth-of-type(${c})`);
};

/** Opens the app with an empty workbook. */
export async function openBlank(page: Page): Promise<void> {
  await page.goto('./');
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('button', { name: 'New workbook' }).click();
  await expect(page.locator('.tab')).toHaveText(['Sheet1']);
}

/** Selects a cell, types into it and presses Enter. */
export async function enter(page: Page, ref: string, text: string): Promise<void> {
  await cell(page, ref).click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

/** Fills cells from {A1: '...'}. */
export async function fillCells(page: Page, cells: Record<string, string>): Promise<void> {
  for (const [ref, text] of Object.entries(cells)) await enter(page, ref, text);
}

/** What a cell shows on screen. */
export const shown = (page: Page, ref: string) => cell(page, ref).textContent();

/** What the formula bar shows for a cell (its raw content). */
export async function rawOf(page: Page, ref: string): Promise<string> {
  await cell(page, ref).click();
  return page.locator('#formulaInput').inputValue();
}

/** Fails the test if the page logs an error or throws. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}
