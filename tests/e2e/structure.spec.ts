import { expect, test } from '@playwright/test';
import { cell, enter, fillCells, openBlank, rawOf } from './helpers';

test.beforeEach(async ({ page }) => openBlank(page));

test('undo and redo', async ({ page }) => {
  await enter(page, 'A1', 'first');
  await enter(page, 'A1', 'second');
  await page.keyboard.press('Control+z');
  await expect(cell(page, 'A1')).toHaveText('first');
  await page.keyboard.press('Control+z');
  await expect(cell(page, 'A1')).toHaveText('');
  await page.keyboard.press('Control+y');
  await expect(cell(page, 'A1')).toHaveText('first');
});

test('inserting a row via the context menu rewrites formulas; undo restores', async ({ page }) => {
  await fillCells(page, { A1: '1', A2: '2', A3: '=SUM(A1:A2)' });
  await cell(page, 'A2').click({ button: 'right' });
  await page.getByRole('button', { name: 'Insert row above' }).click();
  expect(await rawOf(page, 'A4')).toBe('=SUM(A1:A3)');
  await expect(cell(page, 'A4')).toHaveText('3');
  await page.keyboard.press('Control+z');
  expect(await rawOf(page, 'A3')).toBe('=SUM(A1:A2)');
});

test('deleting a referenced row gives #REF!', async ({ page }) => {
  await fillCells(page, { A1: '1', A2: '2', B1: '=A2*10' });
  await page.locator('#grid tbody tr:nth-child(2) th').click({ button: 'right' });
  await page.getByRole('button', { name: 'Delete row' }).click();
  await expect(cell(page, 'B1')).toHaveText('#REF!');
});

test('sheets: add, rename (formulas follow) and delete', async ({ page }) => {
  await page.locator('#addSheet').click();
  await expect(page.locator('.tab')).toHaveText(['Sheet1', 'Sheet2']);
  await enter(page, 'A1', '21');
  await page.locator('.tab', { hasText: 'Sheet1' }).click();
  await enter(page, 'A1', '=Sheet2!A1*2');
  await expect(cell(page, 'A1')).toHaveText('42');

  await page.locator('.tab', { hasText: 'Sheet2' }).dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Input data');
  await page.keyboard.press('Enter');
  await page.locator('.tab', { hasText: 'Sheet1' }).click();
  expect(await rawOf(page, 'A1')).toBe("='Input data'!A1*2");

  page.once('dialog', (d) => d.accept());
  await page.locator('.tab', { hasText: 'Input data' }).click({ button: 'right' });
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.tab')).toHaveText(['Sheet1']);
  await expect(cell(page, 'A1')).toHaveText('#REF!');
});

test('formatting: bold, number formats and decimals', async ({ page }) => {
  await enter(page, 'A1', '1234.5');
  await cell(page, 'A1').click();
  await page.keyboard.press('Control+b');
  await expect(cell(page, 'A1')).toHaveCSS('font-weight', '700');
  await page.locator('#numFormat').selectOption('#,##0.00');
  await expect(cell(page, 'A1')).toHaveText('1,234.50');
  await page.getByTitle('More decimals').click();
  await expect(cell(page, 'A1')).toHaveText('1,234.500');
  await page.locator('#numFormat').selectOption('0.00%');
  await expect(cell(page, 'A1')).toHaveText('123450.00%');
});

test('resizing a column by dragging its border', async ({ page }) => {
  const header = page.locator('#grid thead th.col-head').first();
  const before = (await header.boundingBox())!.width;
  const grip = (await header.locator('.col-resizer').boundingBox())!;
  await page.mouse.move(grip.x + 3, grip.y + 5);
  await page.mouse.down();
  await page.mouse.move(grip.x + 63, grip.y + 5, { steps: 4 });
  await page.mouse.up();
  expect((await header.boundingBox())!.width).toBeGreaterThan(before + 50);
});
