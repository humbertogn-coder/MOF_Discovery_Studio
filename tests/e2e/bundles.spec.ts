import { expect, test, type Page } from '@playwright/test';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEMO = fileURLToPath(new URL('../../public/bundles/pormake_small', import.meta.url));
const manifest = JSON.parse(readFileSync(join(DEMO, 'manifest.json'), 'utf8'));
type R = { id: string; name: string; n_atoms: number; xtb_gap: number | null };
const recs: R[] = JSON.parse(readFileSync(join(DEMO, 'candidates.json'), 'utf8')).records;
const small = recs.find((r) => r.name === 'pcu__N16__E14')!;
const large = recs.find((r) => r.xtb_gap === null)!;

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

const names = (page: Page) => page.locator('.bundle-table tbody th a').allInnerTexts();

test('the Bundles section lists the example and opens it @mobile', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./bundles');
  await expect(page.getByRole('heading', { level: 1, name: 'Bundles' })).toBeVisible();
  await expect(page.getByText('This viewer shows what the bundle contains; it does not recompute or check the values.')).toBeVisible();
  await page.getByRole('link', { name: 'Open', exact: true }).click();
  await expect(page).toHaveURL(/\/bundles\/pormake_small$/);
  await expect(page.getByRole('heading', { level: 1, name: manifest.project })).toBeVisible();
  await expect(page.locator('.bundle-table tbody tr')).toHaveCount(manifest.counts.selected);
  await expect(page.locator('.stat-n').first()).toHaveText(String(manifest.counts.selected));
  await expect(page.getByText('candidates.json matches the checksum in the manifest')).toBeVisible();
  // one sentence is always visible; the full texts are folded under it
  await expect(page.getByText(/no score is a probability of synthesis/)).toBeVisible();
  await expect(page.getByText(/is a probability that a framework can be made/)).toBeHidden();
  await page.locator('summary', { hasText: 'What the values mean' }).click();
  await expect(page.getByText(/is a probability that a framework can be made/)).toBeVisible();
  await expect(page.getByText(/not implied by a small predicted or computed band gap/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('the study pages are reachable from the Bundles section and unchanged in the menu', async ({ page }) => {
  await page.goto('./bundles/pormake_small');
  const nav = page.getByRole('navigation', { name: /primary|main/i }).first();
  await expect(nav.getByRole('link')).toHaveText(['Overview', 'Explorer', 'Compare', 'Active learning', 'DFT campaign', 'Bundles', 'Methods & data']);
  await nav.getByRole('link', { name: 'Explorer' }).click();
  await expect(page.locator('.results-count')).toContainText('of');
});

test('the bundle table sorts, searches and never shows a missing value as a number', async ({ page }) => {
  await page.goto('./bundles/pormake_small');
  await expect(page.locator('.bundle-table tbody tr')).toHaveCount(recs.length);
  expect(await names(page)).toEqual(recs.map((r) => r.name));

  const header = page.getByRole('columnheader', { name: /^xtb_gap/ });
  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  const withGap = recs.filter((r) => r.xtb_gap !== null).sort((a, b) => a.xtb_gap! - b.xtb_gap!);
  expect(await names(page)).toEqual([...withGap.map((r) => r.name), large.name]);
  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  expect(await names(page)).toEqual([...withGap.reverse().map((r) => r.name), large.name]);

  const index = await page.locator('.bundle-table thead th').evaluateAll((ths) => ths.findIndex((th) => th.textContent?.startsWith('xtb_gap')));
  const cell = page.locator('.bundle-table tbody tr', { hasText: large.name }).locator('th, td').nth(index);
  await expect(cell).toHaveText('— not computed');

  await page.getByRole('searchbox').fill('nbo');
  await expect(page.locator('.results-count')).toContainText(`${recs.filter((r) => r.name.includes('nbo')).length} of ${recs.length}`);
  await page.getByRole('searchbox').fill('nothing like this');
  await expect(page.getByRole('heading', { name: 'No record matches' })).toBeVisible();
});

test('columns can be chosen and are explained', async ({ page }) => {
  await page.goto('./bundles/pormake_small');
  await expect(page.getByRole('columnheader', { name: /^cell_a/ })).toHaveCount(0);
  await page.locator('summary', { hasText: /^Columns \(/ }).click();
  await page.getByRole('checkbox', { name: /^cell_a \(angstrom\)/ }).check();
  await expect(page.getByRole('columnheader', { name: /^cell_a \(angstrom\)/ })).toBeVisible();
  await page.locator('summary', { hasText: 'What the shown columns mean' }).click();
  await expect(page.locator('.column-meanings')).toContainText('Cell length a.');
  await page.getByRole('button', { name: 'Back to the usual columns' }).click();
  await expect(page.getByRole('columnheader', { name: /^cell_a/ })).toHaveCount(0);
});

test('the table of a bundle of the site can be downloaded', async ({ page }) => {
  await page.goto('./bundles/pormake_small');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /Download the table/ }).click()]);
  expect(dl.suggestedFilename()).toBe('candidates.csv');
  const text = readFileSync(await dl.path(), 'utf8');
  expect(text.split('\n')[0].split(',')[0]).toBe('id');
  expect(text).toBe(readFileSync(join(DEMO, 'candidates.csv'), 'utf8'));
});

test('a record page renders the structure file of the bundle and explains every group @mobile', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(`./bundles/pormake_small/${small.id}`);
  await expect(page.getByRole('heading', { level: 1, name: small.name })).toBeVisible();
  await expect(page.locator('.viewer')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await expect(page.locator('.viewer')).toHaveAttribute('data-atoms', String(small.n_atoms));
  await expect(page.locator('.viewer-foot')).toContainText('as generated (not relaxed)');
  for (const group of ['Identity and building blocks', 'Structure and checks', 'Pore geometry (Zeo++)', 'xTB electronic proxies', 'Synthetic-accessibility components']) {
    await expect(page.getByRole('heading', { level: 3, name: group })).toBeVisible();
  }
  await expect(page.getByRole('region', { name: 'xTB electronic proxies' }).getByRole('row', { name: /^xtb_gap/ })).toContainText(`${small.xtb_gap} eV`);
  await page.locator('summary', { hasText: 'What the values mean' }).click();
  await expect(page.getByText(/It is not a DFT or measured band gap/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('a record page says why a value was not computed, and links to its neighbours', async ({ page }) => {
  await page.goto(`./bundles/pormake_small/${large.id}`);
  const xtb = page.getByRole('region', { name: 'xTB electronic proxies' });
  await expect(xtb.getByText('skipped')).toBeVisible();
  await expect(xtb.getByText('Not computed for this record:')).toBeVisible();
  await expect(xtb.getByRole('row', { name: /^xtb_gap/ })).toContainText('—');
  const previous = recs[recs.indexOf(large) - 1];
  await page.getByRole('navigation', { name: 'Neighbouring records' }).getByRole('link', { name: new RegExp(previous.id) }).click();
  await expect(page.getByRole('heading', { level: 1, name: previous.name })).toBeVisible();
  await expect(page.locator('.viewer')).toHaveAttribute('data-atoms', String(previous.n_atoms), { timeout: 30_000 });
});

test('the structure file of a record can be downloaded', async ({ page }) => {
  await page.goto(`./bundles/pormake_small/${small.id}`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download the CIF' }).click()]);
  expect(dl.suggestedFilename()).toBe(`${small.id}.cif`);
  expect(readFileSync(await dl.path(), 'utf8')).toBe(readFileSync(join(DEMO, 'structures', `${small.id}.cif`), 'utf8'));
});

test('a bundle folder on the computer is opened in the browser without sending it anywhere', async ({ page }) => {
  const errors = trackErrors(page);
  const sent: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET') sent.push(`${r.method()} ${r.url()}`);
  });
  await page.goto('./bundles');
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.getByTestId('bundle-folder').setInputFiles(DEMO);
  await expect(page).toHaveURL(/\/bundles\/local$/);
  await expect(page.getByRole('heading', { level: 1, name: manifest.project })).toBeVisible();
  await expect(page.getByText('Opened from your computer')).toBeVisible();
  await expect(page.locator('.bundle-table tbody tr')).toHaveCount(recs.length);
  await expect(page.getByRole('link', { name: /Download the table/ })).toHaveCount(0);

  await page.getByRole('link', { name: small.name }).click();
  await expect(page).toHaveURL(new RegExp(`/bundles/local/${small.id}$`));
  await expect(page.locator('.viewer')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await expect(page.locator('.viewer')).toHaveAttribute('data-atoms', String(small.n_atoms));
  // nothing of the bundle travels: no upload, and no file of a bundle is asked from the site
  expect(sent).toEqual([]);
  expect(requests.filter((u) => /\/bundles\/[^/]+\/.+/.test(new URL(u).pathname))).toEqual([]);

  await page.goto('./bundles');
  await expect(page.getByRole('heading', { level: 1, name: 'Bundles' })).toBeVisible();
  await page.goto('./bundles/local');
  await expect(page.getByRole('heading', { name: 'No bundle is open' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a bundle that was changed after the export is refused with an explanation', async ({ page }) => {
  const dir = join(mkdtempSync(join(tmpdir(), 'studio-bundle-')), 'changed');
  cpSync(DEMO, dir, { recursive: true });
  writeFileSync(join(dir, 'candidates.json'), readFileSync(join(dir, 'candidates.json'), 'utf8').replace(`"n_atoms": ${small.n_atoms}`, `"n_atoms": ${small.n_atoms + 1}`));
  await page.goto('./bundles');
  await page.getByTestId('bundle-folder').setInputFiles(dir);
  await expect(page.getByText(/candidates\.json is not the file the manifest describes/)).toBeVisible();
  await expect(page).toHaveURL(/\/bundles$/);

  const other = join(mkdtempSync(join(tmpdir(), 'studio-bundle-')), 'not_a_bundle');
  cpSync(join(DEMO, 'structures'), other, { recursive: true });
  await page.getByTestId('bundle-folder').setInputFiles(other);
  await expect(page.getByText(/No manifest\.json in this folder/)).toBeVisible();
});

test('a structure file that was changed is not rendered', async ({ page }) => {
  const dir = join(mkdtempSync(join(tmpdir(), 'studio-bundle-')), 'changed_cif');
  cpSync(DEMO, dir, { recursive: true });
  const cif = join(dir, 'structures', `${small.id}.cif`);
  writeFileSync(cif, readFileSync(cif, 'utf8').replace(/Zn/g, 'Cd'));
  await page.goto('./bundles');
  await page.getByTestId('bundle-folder').setInputFiles(dir);
  await page.getByRole('link', { name: small.name }).click();
  await expect(page.locator('.viewer')).toHaveAttribute('data-state', 'error', { timeout: 30_000 });
  await expect(page.locator('.viewer')).toContainText('its checksum differs');
});

test('unknown bundles and records get a clear message', async ({ page }) => {
  await page.goto('./bundles/not_a_bundle_of_this_site');
  await expect(page.getByText('This site has no bundle named "not_a_bundle_of_this_site".')).toBeVisible();
  await page.goto('./bundles/pormake_small/ms-0000000000000000');
  await expect(page.getByRole('heading', { name: 'Record not found' })).toBeVisible();
});

test('the Bundles pages have no horizontal overflow on a narrow viewport @mobile', async ({ page }) => {
  for (const p of ['./bundles', './bundles/pormake_small', `./bundles/pormake_small/${large.id}`, './bundles/local']) {
    await page.goto(p);
    await page.waitForLoadState('networkidle');
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw, p).toBeLessThanOrEqual(cw + 1);
  }
});
