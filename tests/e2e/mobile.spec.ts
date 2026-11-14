import { expect, test } from '@playwright/test';
import { cell } from './helpers';

test('tap selects, a second tap edits, and the keyboard does not pop up on every tap', async ({ page }) => {
  await page.goto('./');
  await cell(page, 'C6').tap();
  await expect(page.locator('#nameBox')).toHaveValue('C6');
  expect(await page.evaluate(() => document.activeElement?.id ?? '')).not.toBe('keySink');
  await cell(page, 'C6').tap();
  await expect(page.locator('#editor')).toBeFocused();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'C6')).toHaveText('100.00');
  await expect(cell(page, 'C11')).toHaveText('2,334.70');
});

test('the toolbar scrolls sideways instead of wrapping on a phone', async ({ page }) => {
  await page.goto('./');
  const toolbar = page.locator('.toolbar');
  const box = (await toolbar.boundingBox())!;
  expect(box.height).toBeLessThan(60);
  expect(await toolbar.evaluate((t) => t.scrollWidth > t.clientWidth)).toBe(true);
});
