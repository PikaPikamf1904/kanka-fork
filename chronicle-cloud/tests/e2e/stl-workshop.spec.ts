// STL Workshop (DM only): upload, analyse, enhance, compare, print estimate, download. Synthetic models.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { analyze, toSoup, weld } from '../../src/lib/stl/mesh.ts';
import { parseStl, writeBinaryStl } from '../../src/lib/stl/stlIO.ts';
import { icosphere, uvSphere } from '../unit/stlFixtures.ts';
import { enrollAsPlayer, noHorizontalOverflow, screenshot, signInAsDm } from './support.ts';

function stlFile(name: string, m: { pos: Float64Array; tri: Uint32Array }) {
  const file = path.join(test.info().outputDir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, new Uint8Array(writeBinaryStl(toSoup(m), m.tri.length / 3)));
  return file;
}

test('the DM enhances a coarse model, compares it in 3D, estimates the print and downloads a valid STL', async ({ page }) => {
  test.setTimeout(120_000);
  const coarse = stlFile('coarse-sphere.stl', uvSphere(10, 16, 8));
  await signInAsDm(page);
  await page.goto('/dm/stl');
  await expect(page.getByRole('heading', { name: 'STL Workshop' })).toBeVisible();

  // A damaged file is refused with a reason.
  const bad = path.join(test.info().outputDir, 'broken.stl');
  fs.writeFileSync(bad, 'this is not a model');
  await page.locator('input[type=file]').setInputFiles(bad);
  await expect(page.getByRole('alert')).toContainText(/not an STL file/);

  await page.locator('input[type=file]').setInputFiles(coarse);
  const analysis = page.getByRole('region', { name: 'Analysis' });
  await expect(analysis).toContainText('20.00 mm × 20.00 mm × 20.00 mm');
  await expect(analysis).toContainText('224 (114 vertices)');
  await expect(analysis).toContainText('can round them out');

  await page.getByRole('button', { name: 'Enhance' }).click();
  const result = page.getByRole('region', { name: 'Result' });
  await expect(result).toContainText('Curved surfaces were refined', { timeout: 60_000 });
  await expect(result).toContainText('Original vertices moved');
  await expect(page.getByRole('img', { name: /3D view: Original \(repaired\) and Enhanced/ })).toBeVisible();
  // The print estimate follows the oriented height.
  const printPanel = page.getByRole('region', { name: /Print on the Anycubic Photon Mono 2/ });
  await expect(printPanel).toContainText('Layers');
  const layersBefore = await printPanel.locator('dd').nth(1).innerText();
  await printPanel.getByLabel('Layer height (mm)').fill('0.025');
  await expect(printPanel.locator('dd').nth(1)).not.toHaveText(layersBefore);
  await screenshot(page, 'stl-workshop-desktop');

  // The download is a valid binary STL: re-read and analysed here.
  const [dl] = await Promise.all([page.waitForEvent('download'), result.getByRole('button', { name: 'Download enhanced STL' }).click()]);
  expect(dl.suggestedFilename()).toBe('coarse-sphere-enhanced.stl');
  const buf = fs.readFileSync(await dl.path());
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  expect(new TextDecoder().decode(new Uint8Array(ab, 0, 5))).not.toBe('solid');
  const r = analyze(weld(parseStl(ab).positions));
  expect(r.watertight).toBe(true);
  expect(r.triangles).toBeGreaterThan(224);
  expect(Math.abs(r.sizeMm[2] - 20)).toBeLessThan(0.01);
});

test('cancelling stops the work and leaves the original ready; a fine model is reported as already printer-fine', async ({ page }) => {
  test.setTimeout(180_000);
  await signInAsDm(page);
  await page.goto('/dm/stl');
  await page.locator('input[type=file]').setInputFiles(stlFile('fine.stl', icosphere(8, 6)));
  await expect(page.getByRole('region', { name: 'Analysis' })).toContainText('81,920', { timeout: 60_000 });
  await expect(page.getByRole('region', { name: 'Analysis' })).toContainText('unlikely to change the print');
  await page.getByRole('button', { name: 'Enhance' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alert')).toContainText('Cancelled');
  await expect(page.getByRole('region', { name: 'Analysis' })).toContainText('81,920', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Enhance' }).click();
  await expect(page.getByRole('region', { name: 'Result' })).toContainText('original is recommended', { timeout: 120_000 });
});

test('works at tablet width without sideways scrolling', async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await (await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true })).newPage();
  await signInAsDm(page);
  await page.goto('/dm/stl');
  await page.locator('input[type=file]').setInputFiles(stlFile('tablet.stl', uvSphere(10, 16, 8)));
  await page.getByRole('button', { name: 'Enhance' }).click();
  await expect(page.getByRole('region', { name: 'Result' })).toContainText('Curved surfaces were refined', { timeout: 60_000 });
  await noHorizontalOverflow(page);
  await screenshot(page, 'stl-workshop-tablet');
});

test('players cannot open the workshop', async ({ page }) => {
  await enrollAsPlayer(page, 'Curious Player');
  await page.goto('/dm/stl');
  await expect(page.getByRole('heading', { name: 'STL Workshop' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'STL workshop' })).toHaveCount(0);
});
