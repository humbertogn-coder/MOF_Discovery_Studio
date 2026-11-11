import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../../public/data/release-manifest.json', import.meta.url), 'utf8'));
const data = JSON.parse(readFileSync(new URL('../../public/data/candidates.json', import.meta.url), 'utf8'));
type C = { id: string; slug: string; metal: string; topology: string; formula: string; structure: { n_atoms: number }; dft: { status: string; gap_eV?: number }; prediction: { is_ood: boolean } };
const recs: C[] = data.records;

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

test('home loads the real release manifest @mobile', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Explore, compare, and prioritize');
  await expect(page.locator('.stat-n').first()).toHaveText(String(manifest.record_count));
  await expect(page.getByText(manifest.source_commit_hash.slice(0, 7)).first()).toBeVisible();
  await expect(page.getByText('Predicted low band gap is not equivalent to demonstrated electrical conductivity.').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('explorer lists real candidates and filters produce consistent counts', async ({ page }) => {
  await page.goto('./explore');
  await expect(page.locator('.results-count')).toContainText(`${recs.length} of ${recs.length}`);
  await expect(page.locator('tbody tr')).toHaveCount(recs.length);
  // metal filter
  await page.locator('summary', { hasText: 'Metal' }).click();
  await page.getByRole('checkbox', { name: /^Co \(/ }).check();
  const nCo = recs.filter((c) => c.metal === 'Co').length;
  await expect(page.locator('.results-count')).toContainText(`${nCo} of ${recs.length}`);
  await expect(page.locator('tbody tr')).toHaveCount(nCo);
  // in-domain only
  await page.getByLabel('Show only in-domain').check();
  const nCoIn = recs.filter((c) => c.metal === 'Co' && c.prediction.is_ood === false).length;
  await expect(page.locator('.results-count')).toContainText(`${nCoIn} of ${recs.length}`);
  // accepted DFT only
  await page.getByLabel('Include OOD').check();
  await page.getByLabel('DFT accepted only').check();
  const nCoAcc = recs.filter((c) => c.metal === 'Co' && c.dft.status === 'accepted').length;
  await expect(page.locator('.results-count')).toContainText(`${nCoAcc} of ${recs.length}`);
  await page.getByRole('button', { name: 'Reset all' }).click();
  await expect(page.locator('.results-count')).toContainText(`${recs.length} of ${recs.length}`);
});

test('explorer shows an explanatory empty state', async ({ page }) => {
  await page.goto('./explore');
  await page.getByPlaceholder(/Name, formula/).fill('this-does-not-exist');
  await expect(page.getByRole('heading', { name: 'No candidates match these filters' })).toBeVisible();
});

test('CSV export contains the filtered rows', async ({ page }) => {
  await page.goto('./explore');
  await page.getByPlaceholder(/Name, formula/).fill('bcu');
  const n = recs.filter((c) => c.topology === 'bcu' || c.id.includes('bcu')).length;
  await expect(page.locator('tbody tr')).toHaveCount(n);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
  const text = readFileSync((await dl.path())!, 'utf8');
  expect(text.trim().split('\r\n')).toHaveLength(n + 1);
  expect(text.split('\r\n')[0]).toContain('gap_ml_eV');
});

test('candidate detail shows real data, renders the CIF, and offers downloads @mobile', async ({ page }) => {
  const c = recs.find((r) => r.id === 'pcu__Zn-N16__short-H')!;
  const errors = trackErrors(page);
  await page.goto(`./candidate/${encodeURIComponent(c.slug)}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(c.id);
  await expect(page.locator('.viewer')).toHaveAttribute('data-state', /ready|nowebgl/);
  const state = await page.locator('.viewer').getAttribute('data-state');
  if (state === 'ready') await expect(page.locator('.viewer')).toHaveAttribute('data-atoms', String(c.structure.n_atoms));
  await expect(page.locator('.bv-n').nth(1)).toContainText(c.dft.gap_eV!.toFixed(3));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download CIF (generated)' }).click()]);
  expect(dl.suggestedFilename()).toBe(`${c.slug}.cif`);
  expect(readFileSync((await dl.path())!, 'utf8')).toContain('_cell_length_a');
  expect(errors).toEqual([]);
});

test('DFT-relaxed geometry is labelled separately and parses', async ({ page }) => {
  await page.goto('./candidate/cds__Cu-N409__short-NH2');
  await page.getByRole('button', { name: 'DFT-relaxed', exact: true }).click();
  await expect(page.locator('.viewer')).toHaveAttribute('data-format', 'vasp');
  await expect(page.locator('.viewer')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('.viewer-foot')).toContainText('DFT-relaxed (POSCAR)');
  await expect(page.getByText(/Input POSCAR|end point of the PBE-D3/).first()).toBeVisible();
});

test('every topology renders a representative CIF with the expected atom count', async ({ page }) => {
  test.setTimeout(120_000);
  const topos = [...new Set(recs.map((r) => r.topology))].sort();
  for (const t of topos) {
    const inT = recs.filter((r) => r.topology === t).sort((a, b) => a.structure.n_atoms - b.structure.n_atoms);
    for (const c of [inT[0], inT[inT.length - 1]]) {
      await page.goto(`./candidate/${c.slug}`);
      await expect(page.locator('.viewer'), c.id).toHaveAttribute('data-state', 'ready');
      await expect(page.locator('.viewer'), c.id).toHaveAttribute('data-atoms', String(c.structure.n_atoms));
    }
  }
});

test('non-accepted DFT runs are not shown as validated', async ({ page }) => {
  const c = recs.find((r) => r.dft.status === 'rejected')!;
  await page.goto(`./candidate/${c.slug}`);
  await expect(page.locator('#dft-h').locator('..')).toContainText('DFT not accepted');
  await expect(page.locator('#dft-h').locator('..').locator('.bv-n')).toHaveCount(0);
});

test('missing CIF degrades gracefully', async ({ page }) => {
  await page.route('**/structures/pormake/*.cif', (r) => r.fulfill({ status: 404, body: 'nope' }));
  await page.goto('./candidate/bcu__Co-N35__short-F4');
  await expect(page.locator('.viewer')).toHaveAttribute('data-state', 'error');
  await expect(page.getByText('The structure could not be displayed.')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Model estimate/ })).toBeVisible();
});

test('unknown candidate route shows a not-found page', async ({ page }) => {
  await page.goto('./candidate/not__a-real__mof');
  await expect(page.getByRole('heading', { name: 'Candidate not found' })).toBeVisible();
});

test('compare loads from a shareable URL', async ({ page }) => {
  const ids = ['pcu__Zn-N16__short-H', 'bcu__Co-N35__short-F4'];
  await page.goto(`./compare?ids=${ids.join(',')}`);
  for (const id of ids) await expect(page.getByRole('link', { name: id })).toBeVisible();
  await expect(page.locator('.viewer')).toHaveAttribute('data-state', /ready|nowebgl/);
});

test('active learning reproduces every recorded batch in the browser', async ({ page }) => {
  await page.goto('./active-learning');
  const tabs = page.getByRole('tab');
  await expect(tabs.first()).toBeVisible();
  const n = await tabs.count();
  expect(n).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < n; i++) {
    await tabs.nth(i).click();
    await expect(page.locator('.check-line')).toHaveClass(/ok/);
    await expect(page.locator('.check-line')).toContainText('✓');
  }
});

test('active learning: custom weights are flagged and reset restores defaults', async ({ page }) => {
  await page.goto('./active-learning');
  await page.getByRole('tab', { name: /scenario/ }).click();
  const firstBefore = await page.locator('#batch-h').locator('xpath=../..').locator('tbody tr').first().innerText();
  await page.getByLabel('κ value').fill('3');
  await expect(page.getByText('Custom settings')).toBeVisible();
  await expect(page.getByText(/Differs from the study defaults in: κ/)).toBeVisible();
  await page.getByRole('button', { name: 'Reset to study defaults' }).click();
  await expect(page.getByText('Custom settings')).toHaveCount(0);
  expect(await page.locator('#batch-h').locator('xpath=../..').locator('tbody tr').first().innerText()).toBe(firstBefore);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).first().click()]);
  expect(dl.suggestedFilename()).toContain('study-defaults');
});

test('pages have no horizontal overflow on a narrow viewport @mobile', async ({ page }) => {
  for (const p of ['./', './explore', './compare', './active-learning', './dft-campaign', './methods', './candidate/bcu__Co-N35__short-F4', './candidate/cds__Cu-N409__short-NH2']) {
    await page.goto(p);
    await page.waitForLoadState('networkidle');
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw, p).toBeLessThanOrEqual(cw + 1);
  }
});

test('methods page states provenance and publication status', async ({ page }) => {
  await page.goto('./methods');
  await expect(page.getByText(manifest.source_commit_hash).first()).toBeVisible();
  await expect(page.getByText(/publication status and DOI to be confirmed/).first()).toBeVisible();
});

test('candidate page shows band-edge character and DOS for an accepted label', async ({ page }) => {
  await page.goto('./candidate/cds__Cu-N409__short-NH2');
  await expect(page.getByRole('heading', { name: /Electronic structure \(DFT\)/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /^VBM:/ })).toBeVisible();
  await expect(page.locator('#el-h').locator('..').locator('.js-plotly-plot')).toBeVisible();
});

test('non-accepted candidate can show its last DFT geometry, labelled as not accepted', async ({ page }) => {
  await page.goto('./candidate/pcu__Mn-N548__short-H');
  await expect(page.locator('#el-h')).toHaveCount(0);
  await page.getByRole('button', { name: 'Last DFT step (not accepted)' }).click();
  await expect(page.locator('.viewer')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('.viewer-foot')).toContainText('not accepted');
});

test('DFT campaign page summarises outcomes, failures, rules and band edges @mobile', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./dft-campaign');
  await expect(page.getByRole('heading', { name: 'The DFT campaign' })).toBeVisible();
  const nFail = recs.filter((c) => c.dft.status === 'rejected').length;
  await expect(page.getByText(new RegExp(`^${nFail} of \\d+ frameworks sent to DFT`))).toBeVisible();
  await expect(page.locator('.fail-viewer .viewer')).toHaveAttribute('data-state', /ready|nowebgl/);
  await expect(page.locator('.be-table tbody tr')).toHaveCount(recs.filter((c) => c.dft.status === 'accepted').length);
  expect(errors).toEqual([]);
});

test('active learning page shows the retrospective benchmark', async ({ page }) => {
  await page.goto('./active-learning');
  await expect(page.getByRole('heading', { name: /Retrospective benchmark on QMOF/ })).toBeVisible();
  await expect(page.getByText(/At the study budget of 27 labels/)).toBeVisible();
});

test('methods page offers BibTeX and RIS citations', async ({ page }) => {
  await page.goto('./methods#citation');
  await expect(page.getByText('@software{').first()).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).first().click()]);
  expect(dl.suggestedFilename()).toBe('MOF_3D_Generator.bib');
});

test('index.html carries social-card metadata', async ({ request }) => {
  const html = await (await request.get('./')).text();
  expect(html).toContain('property="og:image"');
  expect(html).toContain('summary_large_image');
});
