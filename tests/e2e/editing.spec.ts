import { expect, test } from '@playwright/test';
import { cell, enter, fillCells, openBlank, rawOf, shown, watchErrors } from './helpers';

test.beforeEach(async ({ page }) => openBlank(page));

test('typing values and formulas, and live recalculation', async ({ page }) => {
  const errors = watchErrors(page);
  await fillCells(page, { A1: '10', A2: '20', A3: '=sum(a1:a2' });
  await expect(cell(page, 'A3')).toHaveText('30');
  expect(await rawOf(page, 'A3')).toBe('=SUM(A1:A2)'); // normalised and auto-closed
  await enter(page, 'A1', '15');
  await expect(cell(page, 'A3')).toHaveText('35');
  expect(errors).toEqual([]);
});

test('typed formats are applied automatically', async ({ page }) => {
  await fillCells(page, { A1: '12.5%', A2: '$1,200', A3: '2026-11-13', A4: '=A1*2' });
  await expect(cell(page, 'A1')).toHaveText('12.50%');
  await expect(cell(page, 'A2')).toHaveText('$1,200');
  await expect(cell(page, 'A3')).toHaveText('2026-11-13');
  await expect(cell(page, 'A4')).toHaveText('0.25');
});

test('errors show their code and an explanation', async ({ page }) => {
  await enter(page, 'A1', '=1/0');
  await expect(cell(page, 'A1')).toHaveText('#DIV/0!');
  await expect(cell(page, 'A1')).toHaveAttribute('title', /Division by zero/);
  await cell(page, 'A1').click();
  await expect(page.locator('#status')).toContainText('Division by zero');
});

test('Escape cancels an edit; F2 edits the existing content', async ({ page }) => {
  await enter(page, 'A1', 'keep');
  await cell(page, 'A1').click();
  await page.keyboard.type('discard');
  await page.keyboard.press('Escape');
  await expect(cell(page, 'A1')).toHaveText('keep');
  await page.keyboard.press('F2');
  await page.keyboard.type('er');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'A1')).toHaveText('keeper');
});

test('clicking cells while typing a formula inserts references', async ({ page }) => {
  await fillCells(page, { A1: '6', A2: '7' });
  await cell(page, 'B1').click();
  await page.keyboard.type('=');
  await cell(page, 'A1').click();
  await page.keyboard.type('*');
  await cell(page, 'A2').click();
  await expect(page.locator('#editor')).toHaveValue('=A1*A2');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'B1')).toHaveText('42');
});

test('arrow keys point at cells in a new formula; Shift extends to a range', async ({ page }) => {
  await fillCells(page, { A1: '1', A2: '2', A3: '3' });
  await cell(page, 'B3').click();
  await page.keyboard.type('=SUM(');
  await page.keyboard.press('ArrowLeft'); // A3
  await page.keyboard.press('ArrowUp'); // A2
  await page.keyboard.press('ArrowUp'); // A1
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.locator('#editor')).toHaveValue('=SUM(A1:A3');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'B3')).toHaveText('6');
});

test('F4 cycles absolute references', async ({ page }) => {
  await cell(page, 'A1').click();
  await page.keyboard.type('=B5');
  const editor = page.locator('#editor');
  for (const want of ['=$B$5', '=B$5', '=$B5', '=B5']) {
    await page.keyboard.press('F4');
    await expect(editor).toHaveValue(want);
  }
});

test('function autocomplete and argument hints', async ({ page }) => {
  await cell(page, 'A1').click();
  await page.keyboard.type('=vlo');
  await expect(page.locator('#acList')).toBeVisible();
  await expect(page.locator('#acList')).toContainText('VLOOKUP');
  await page.keyboard.press('Tab');
  await expect(page.locator('#editor')).toHaveValue('=VLOOKUP(');
  await expect(page.locator('#fnTip b')).toHaveText('lookup_value');
  await page.keyboard.type('1,');
  await expect(page.locator('#fnTip b')).toHaveText('table_array');
});

test('editing through the formula bar', async ({ page }) => {
  await cell(page, 'C2').click();
  await page.locator('#formulaInput').click();
  await page.keyboard.type('=2+3');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'C2')).toHaveText('5');
});

test('Ctrl+Enter writes into every selected cell, adjusting formulas', async ({ page }) => {
  await fillCells(page, { A1: '1', A2: '2', A3: '3' });
  await cell(page, 'B1').click();
  await cell(page, 'B3').click({ modifiers: ['Shift'] });
  await page.keyboard.type('=A1*10');
  await page.keyboard.press('Control+Enter');
  await expect(cell(page, 'B3')).toHaveText('30');
  expect(await rawOf(page, 'B3')).toBe('=A3*10');
});

test('Alt+Enter adds a line break inside a cell', async ({ page }) => {
  await cell(page, 'A1').click();
  await page.keyboard.type('line one');
  await page.keyboard.press('Alt+Enter');
  await page.keyboard.type('line two');
  await page.keyboard.press('Enter');
  expect(await shown(page, 'A1')).toBe('line one\nline two');
});

test('AutoSum sums the numbers above', async ({ page }) => {
  await fillCells(page, { A1: '1', A2: '2', A3: '3' });
  await cell(page, 'A4').click();
  await page.keyboard.press('Alt+=');
  await expect(page.locator('#editor')).toHaveValue('=SUM(A1:A3)');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'A4')).toHaveText('6');
});

test('long text spills into empty neighbours', async ({ page }) => {
  await enter(page, 'A1', 'A fairly long piece of text');
  await expect(cell(page, 'A1')).toHaveClass(/spill/);
  await enter(page, 'B1', 'x');
  await expect(cell(page, 'A1')).not.toHaveClass(/spill/);
});
