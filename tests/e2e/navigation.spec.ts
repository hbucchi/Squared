import { expect, test } from '@playwright/test';
import { cell, fillCells, openBlank } from './helpers';

test.beforeEach(async ({ page }) => openBlank(page));

const nameBox = (page: import('@playwright/test').Page) => page.locator('#nameBox');

test('arrows, Tab and Enter move the active cell', async ({ page }) => {
  await cell(page, 'B2').click();
  await page.keyboard.press('ArrowRight');
  await expect(nameBox(page)).toHaveValue('C2');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await expect(nameBox(page)).toHaveValue('D3');
  await page.keyboard.press('Shift+Enter');
  await expect(nameBox(page)).toHaveValue('D2');
  await page.keyboard.press('Control+Home');
  await expect(nameBox(page)).toHaveValue('A1');
});

test('Ctrl+Arrow jumps to the edge of the data', async ({ page }) => {
  await fillCells(page, { A1: '1', A2: '2', A3: '3', A10: 'x' });
  await cell(page, 'A1').click();
  await page.keyboard.press('Control+ArrowDown');
  await expect(nameBox(page)).toHaveValue('A3');
  await page.keyboard.press('Control+ArrowDown');
  await expect(nameBox(page)).toHaveValue('A10');
});

test('Shift-selection shows Sum, Average and Count', async ({ page }) => {
  await fillCells(page, { A1: '10', A2: '20', A3: 'text' });
  await cell(page, 'A1').click();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  const status = page.locator('#status');
  await expect(status).toContainText('Average: 15');
  await expect(status).toContainText('Count: 3');
  await expect(status).toContainText('Sum: 30');
});

test('the name box jumps to a cell or range', async ({ page }) => {
  await nameBox(page).click();
  await nameBox(page).fill('C150');
  await page.keyboard.press('Enter');
  await expect(nameBox(page)).toHaveValue('C150');
  await expect(cell(page, 'C150')).toBeInViewport();
});

test('clicking a column header selects the whole column', async ({ page }) => {
  await page.locator('#grid thead th.col-head').nth(1).click();
  await expect(page.locator('#grid thead th.col-head').nth(1)).toHaveClass(/full/);
});

test('Find moves between matches', async ({ page }) => {
  await fillCells(page, { A1: 'apple', B5: 'pineapple', C9: 'pear' });
  await cell(page, 'A1').click();
  await page.keyboard.press('Control+f');
  await page.locator('#findInput').fill('apple');
  await page.keyboard.press('Enter');
  await expect(page.locator('#findInfo')).toHaveText('2 of 2'); // active is A1, so the next is B5
  await expect(nameBox(page)).toHaveValue('B5');
  await page.keyboard.press('Enter');
  await expect(nameBox(page)).toHaveValue('A1');
});

test('scrolling to the bottom adds more rows', async ({ page }) => {
  const rows = page.locator('#grid tbody tr');
  const before = await rows.count();
  await page.locator('#gridWrap').evaluate((w) => { w.scrollTop = w.scrollHeight; });
  await expect.poll(() => rows.count()).toBeGreaterThan(before);
});
