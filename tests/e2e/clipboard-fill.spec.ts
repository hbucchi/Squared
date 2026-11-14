import { expect, test } from '@playwright/test';
import { cell, fillCells, openBlank, rawOf } from './helpers';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });
test.beforeEach(async ({ page }) => openBlank(page));

test('copying a formula shifts its relative references', async ({ page }) => {
  await fillCells(page, { A1: '1', A2: '2', B1: '10', B2: '20', A3: '=SUM(A1:A2)' });
  await cell(page, 'A3').click();
  await page.keyboard.press('Control+c');
  await expect(page.locator('#clipBox')).toBeVisible();
  await cell(page, 'B3').click();
  await page.keyboard.press('Control+v');
  await expect(cell(page, 'B3')).toHaveText('30');
  expect(await rawOf(page, 'B3')).toBe('=SUM(B1:B2)');
});

test('cut moves cells without changing the formula', async ({ page }) => {
  await fillCells(page, { A1: '5', B1: '=A1*2' });
  await cell(page, 'B1').click();
  await page.keyboard.press('Control+x');
  await cell(page, 'D4').click();
  await page.keyboard.press('Control+v');
  await expect(cell(page, 'B1')).toHaveText('');
  await expect(cell(page, 'D4')).toHaveText('10');
});

test('pasting tab-separated text from another app', async ({ page }) => {
  await cell(page, 'C2').click();
  await page.evaluate(() => navigator.clipboard.writeText('Name\tScore\nAda\t95\nAlan\t88\n'));
  await page.keyboard.press('Control+v');
  await expect(cell(page, 'C2')).toHaveText('Name');
  await expect(cell(page, 'D4')).toHaveText('88');
  await expect(cell(page, 'D4')).toHaveCSS('text-align', 'right'); // became a number
});

test('copying puts the displayed values on the system clipboard', async ({ page }) => {
  await fillCells(page, { A1: '50%', B1: '=A1*2' });
  await cell(page, 'A1').click();
  await cell(page, 'B1').click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+c');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('50%\t1');
});

test('the fill handle continues a number series', async ({ page }) => {
  await fillCells(page, { A1: '5', A2: '10' });
  await cell(page, 'A1').click();
  await cell(page, 'A2').click({ modifiers: ['Shift'] });
  const handle = await page.locator('#fillHandle').boundingBox();
  const target = await cell(page, 'A5').boundingBox();
  await page.mouse.move(handle!.x + 3, handle!.y + 3);
  await page.mouse.down();
  await page.mouse.move(target!.x + 10, target!.y + 10, { steps: 5 });
  await page.mouse.up();
  await expect(cell(page, 'A3')).toHaveText('15');
  await expect(cell(page, 'A5')).toHaveText('25');
});

test('the fill handle copies formulas and increments "Item 1"', async ({ page }) => {
  await fillCells(page, { A1: 'Item 1', B1: '3', C1: '=B1*2' });
  await cell(page, 'A1').click();
  await cell(page, 'C1').click({ modifiers: ['Shift'] });
  const handle = await page.locator('#fillHandle').boundingBox();
  const target = await cell(page, 'C3').boundingBox();
  await page.mouse.move(handle!.x + 3, handle!.y + 3);
  await page.mouse.down();
  await page.mouse.move(target!.x + 10, target!.y + 10, { steps: 5 });
  await page.mouse.up();
  await expect(cell(page, 'A3')).toHaveText('Item 3');
  await expect(cell(page, 'B3')).toHaveText('3'); // a single number is copied
  expect(await rawOf(page, 'C3')).toBe('=B3*2');
});

test('Ctrl+D fills down', async ({ page }) => {
  await fillCells(page, { A1: '2', B1: '=A1^2', A2: '3', A3: '4' });
  await cell(page, 'B1').click();
  await cell(page, 'B3').click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+d');
  await expect(cell(page, 'B3')).toHaveText('16');
});
