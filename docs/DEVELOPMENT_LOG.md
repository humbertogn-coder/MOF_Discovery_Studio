# Development log

## 2026-11-08 — v0.1.0

**Environment:** isolated cloud workspace (Linux, Node 22.23, Python 3.13, Chromium/Playwright 1.63). The research repository was cloned read-only at `e2e71fa`. No access to the user's local machine, HPRC or private files. Web search and fetch were unavailable, so provider limits could not be re-verified.

1. **Audit** (`docs/PROJECT_AUDIT.md`). Verified schemas, counts, licences and code semantics. Found the iteration-0 rules gap, the 4/2/4 caps used in iterations 1–2, the iteration-2 N_topo timing difference, and the 10 spin-sensitivity rows.
2. **Exporter** (`scripts/export_research_data.py`, stdlib only). Builds the candidate bundle, active-learning bundle, manifest with SHA-256 checksums, and provenance report. Python acquisition reference: `scripts/acquisition_ref.py`. Replay reproduces recorded scores bit-for-bit and batches exactly (iterations 0–2).
3. **Validator** (`scripts/validate_export.py`): strict JSON, safe paths, DFT-status invariants, manifest consistency, checksums, forbidden files.
4. **Frontend**: React/TS/Vite with lazy Plotly (basic bundle) and lazy 3Dmol.js 2.5.5. Six pages plus 404.
5. **Chart palette** validated with the data-viz validator (light surface). Marker symbols give secondary encoding for more than 3 categories.
6. **Visual QA** with screenshots at desktop (1360 px) and phone (Pixel 7 / iPhone 13) widths. Fixes made:
   - two-column candidate layout;
   - compact table headers;
   - removed bar text labels;
   - added a display-only 2×2×2 replication so framework connectivity is visible;
   - fixed horizontal overflow on the Methods page (long code paths), found by the E2E test.
7. **Tests**:
   - pytest: 19 tests, including a cross-check against the original pandas implementation;
   - Vitest: 55 tests;
   - Playwright: 18 tests across desktop and mobile, including CIF rendering of the smallest and largest framework of each topology, a missing-CIF fallback, downloads, active-learning reproduction and reset, and an overflow check.
   - A sub-path (`/MOF_Discovery_Studio/`) build was smoke-tested.

**Decisions**
- No diagnostic gap from a non-accepted run is displayed (kept only in JSON as `diagnostic_gap_eV`).
- Scenario-mode defaults are the code defaults (2/2/3) plus the latest recorded eligibility rules, with a one-click switch to the campaign caps (4/2/4).
- Light theme only in v0.1.
- CSV exports contain no comment lines; provenance travels in the JSON export and `DATA_README.txt`.

**Not done** (see the final report)
- No deployment (requires approval and an account).
- Provider limits not re-verified online.
- No Lighthouse audit tool available; accessibility was checked through semantic structure, keyboard focus styles and labels, without an automated axe run.

## 2026-11-11 — v0.2.0

- Deployed v0.1.0 to Cloudflare Workers static assets: https://mof-discovery-studio.humbertogn.workers.dev. Verified live: deep links, the CIF viewer, Explorer counts, and the Active Learning ✓ on all tabs.
- Exporter 1.1.0 / schema 1.1.0. New bundles:
  - `electronic/<slug>.json`: broadened DOS for the 18 labels;
  - `campaign.json`: outcomes, compute, failures, rules and spin solutions;
  - `retro-al.json`: summary statistics of `scripts/15_retrospective_al.py`;
  - `structures/dft_last/*.vasp`: last relaxation geometry of the 9 non-accepted runs.
  - Each candidate record now also has `electronic` (band-edge fractions) and `dft_last_geometry`.
- UI:
  - "Electronic structure (DFT)" card on candidate pages (band-edge bars and DOS);
  - new "DFT campaign" page;
  - retrospective benchmark section on the Active Learning page;
  - BibTeX/RIS citation block on the Methods page;
  - Open Graph social card (`public/og-image.png`, rendered from the live viewer);
  - optional Cloudflare Web Analytics via `CF_BEACON_TOKEN`.
- Guardrails: added `bandEdge`, `dos`, `lastGeometry`, `retro` and `spinSolutions`. xTB data are still not shown.

## 2026-11-21 — Bundles section (branch `generic-bundles`, not released)

The Studio can now show the result of any [mofsift](https://github.com/humbertogn-coder/mofsift) run. The work is on a branch; the deployed site is unchanged until the branch is merged. No version number was assigned.

- **New section "Bundles"** ([BUNDLES.md](BUNDLES.md)), separate from the study pages:
  - `/bundles`: open the folder written by `mofsift export` from the reader's computer (folder picker or drop), or a bundle shipped with the site;
  - `/bundles/<id>`: counts, applied filters, searchable and sortable table with a column chooser, meaning of the shown columns, data from others with licence and citation, provenance of the run;
  - `/bundles/<id>/<record>`: 3D structure in the existing viewer, values at a glance, and every value grouped by stage with its meaning and, when a stage did not run, the recorded reason.
- **Reader** (`src/lib/bundle.ts`, no dependency on the mofsift package). Column names, units, meanings and groups come from the manifest of the bundle. The SHA-256 of `candidates.json` and of each structure file is compared with the manifest; records are checked against the column dictionary; only files listed in the manifest are read, with plain relative names. Missing values stay `null` and are shown as a dash.
- **A folder from the reader's computer is read in the browser and never uploaded.** An end-to-end test checks that no request for a file of the bundle is made.
- **Example bundle** `public/bundles/pormake_small/`: the public example of mofsift (commit `f658178`), 4 records with CIFs. It holds no result of the study. `mofsift validate` accepts it, and a unit test compares every file with the manifest. `.gitattributes` keeps git from rewriting its line endings.
- **Viewer**: `StructureViewer` accepts the text of a structure from a caller (`loadText`) and an optional download address. Its behaviour on the study pages is unchanged.
- **Guardrails**: added `bundle`, `bundleLocal`, `bundleChecksum`, `bundleMissing`, `xtbProxy` and `scoreComponents`. The study pages still show no xTB data; xTB columns appear only inside a bundle, with the `xtbProxy` text.
- **Tests**: Vitest 158 (85 new: reader, sources, pages); Playwright 41 across desktop and mobile (16 new: listing, table, record with CIF rendering, downloads, a folder from the computer, a changed bundle and a changed CIF refused, overflow). The new end-to-end tests also pass on a sub-path build (`/MOF_Discovery_Studio/`). A synthetic bundle of 40,000 records (80 MB) opened in about 2 s; sorting and searching took about 0.1 s.

**Decisions**
- The study pages and the study data are untouched. The Bundles section has its own pages and its own store.
- The Studio does not judge the values of a bundle. The full check is `mofsift validate`.
- The CI of this repository does not install mofsift. The shipped bundle is checked against its own manifest by a unit test, and with `mofsift validate` by hand before it is added.
- Column explanations are below the table and not in header tooltips, because a tooltip inside a scrolling table is cut off.
- Only search, sort and a column chooser. Selecting records is the job of `mofsift filter`.

**Not done**
- Range filters, plots and comparison of records for bundles (see [ROADMAP.md](ROADMAP.md), item 10).
- Reading the Parquet or CSV table; the Studio reads `candidates.json`.
- A bundle from the computer is not kept between visits.
