import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { cell, enter, fillCells, openBlank } from './helpers';

test('first visit shows the sample workbook', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.tab')).toHaveText(['Budget', 'Grades']);
  await expect(cell(page, 'B11')).toHaveText('2,630.00');
});

test('work is autosaved and restored after a reload', async ({ page }) => {
  await openBlank(page);
  await enter(page, 'A1', 'still here');
  await page.waitForTimeout(700); // autosave is debounced
  await page.reload();
  await expect(cell(page, 'A1')).toHaveText('still here');
});

test('save to a file and open it again', async ({ page }, info) => {
  await openBlank(page);
  await fillCells(page, { A1: '7', A2: '=A1*6' });
  // Force the download path (the File System Access picker needs a person to click).
  await page.evaluate(() => {
    (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;
    (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker = undefined;
  });
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const file = info.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(saved.sheets[0].cells.A2.v).toBe('=A1*6');

  await openBlank(page);
  await page.evaluate(() => { (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker = undefined; });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await chooser.setFiles(file);
  await expect(cell(page, 'A2')).toHaveText('42');
});

test('export a sheet as CSV', async ({ page }, info) => {
  await openBlank(page);
  await fillCells(page, { A1: 'name', B1: 'value', A2: 'a, b', B2: '=1/4' });
  await page.getByRole('button', { name: 'File' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export sheet as CSV' }).click()]);
  const file = info.outputPath('out.csv');
  await download.saveAs(file);
  expect(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')).toBe('name,value\r\n"a, b",0.25');
});

test('import a CSV as a new sheet', async ({ page }, info) => {
  await openBlank(page);
  const file = info.outputPath('people.csv');
  fs.writeFileSync(file, 'name,age\nAda,36\nAlan,41\n');
  await page.getByRole('button', { name: 'File' }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Import CSV as new sheet…' }).click()]);
  await chooser.setFiles(file);
  await expect(page.locator('.tab')).toHaveText(['Sheet1', 'people']);
  await expect(cell(page, 'B3')).toHaveText('41');
});
