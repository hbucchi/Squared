import path from 'node:path';
import { expect, test } from '@playwright/test';
import { cell, watchErrors } from './helpers';

test('the single-file build runs with every network request blocked', async ({ page }) => {
  const errors = watchErrors(page);
  const attempted: string[] = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file:') || url.startsWith('data:')) return route.continue();
    attempted.push(url);
    return route.abort();
  });
  await page.goto('file://' + path.resolve('dist/LocalCalc.html'));
  await expect(cell(page, 'B11')).toHaveText('2,630.00');
  await cell(page, 'C5').click();
  await page.keyboard.type('1000');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'C11')).toHaveText('2,487.00');
  expect(attempted).toEqual([]);
  expect(errors).toEqual([]);
});

test('the installed app keeps working offline', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(cell(page, 'B11')).toHaveText('2,630.00');
  await context.setOffline(false);
});
