# Bundles: results of mofsift runs

The **Bundles** section of the Studio shows the result of any run of
[mofsift](https://github.com/humbertogn-coder/mofsift), the screening library that grew out of
the study. It is separate from the study pages: the Overview, Explorer, Compare, Active learning,
DFT campaign and Methods pages still show only the frozen snapshot of the research repository.

A bundle is the folder that `mofsift export` writes:

```
export/<project>/
  manifest.json          what is in the bundle and what produced it
  candidates.csv         the records, every column
  candidates.json        the same records as JSON, which the Studio reads
  structures/<id>.cif    the structure file of every record that has one
```

The format is described in `docs/export.md` of mofsift. The Studio reads bundles of schema
version 1.x and does not depend on the mofsift package: it needs only the folder.

## What the section shows

| Page | Address | Content |
|---|---|---|
| Bundles | `/bundles` | What a bundle is, a button to open one from your computer, and the bundles shipped with the site |
| A bundle | `/bundles/<id>` | Counts, the filters that selected the records, a searchable and sortable table with a column chooser, the meaning of every column, data from others with licence and citation, and the provenance of the run |
| A record | `/bundles/<id>/<record>` | The 3D structure, the usual values at a glance, and every value grouped by the stage that computed it, with the meaning of each column and the reason when a stage did not run |

Everything the pages say about a column (name, unit, meaning, stage) comes from the column
dictionary of the manifest. The Studio has no list of mofsift columns of its own, so a bundle with
columns it has never seen is shown the same way.

## Opening a bundle from your computer

On the Bundles page, choose the folder that `mofsift export` wrote, or drop it on the page. The
folder may also be the one that contains the bundle.

- The browser reads the files. **Nothing is uploaded**; the site has no server that could receive
  them. An end-to-end test checks that opening a folder sends no request for any file of it.
- The bundle lives in the memory of the tab. After a reload it is gone and must be opened again.
- Choosing a folder needs a desktop browser.
- A bundle exported with `export.viewer_bundle: false` has no `candidates.json` and cannot be
  shown. Export it again with `viewer_bundle: true`.

## What is checked, and what is not

When a bundle is opened the Studio

- refuses a manifest that is not a mofsift bundle, that belongs to an unfinished export, or that
  has another major schema version;
- compares the SHA-256 of `candidates.json` with the manifest and refuses the bundle when they
  differ;
- checks every record against the column dictionary: an unknown key, or a value of the wrong
  kind, is an error and not a silent conversion;
- compares the SHA-256 of a structure file with the manifest before the viewer gets it;
- reads only files the manifest lists, with plain relative names. A name with `..`, an absolute
  path or a drive letter is refused.

The Studio **does not recompute or judge the values**. It shows what the bundle contains. For the
full check of a bundle (schemas, table against records, every structure file) run
`mofsift validate <folder>`.

Limits: `candidates.json` up to 150 MB, a structure file up to 2 MB. Larger bundles are better
read from the table file with other tools.

## Missing values

A value that was not computed is `null` in the bundle and a dash on the page, never zero or an
empty text. The record page shows the status of the stage and the reason mofsift recorded, for
example a framework above the atom limit of the xTB stage. Sorting puts records without a value
last in both directions.

## Scientific wording

The fixed texts of the section live in `src/lib/guardrails.ts` (`bundle`, `bundleLocal`,
`bundleChecksum`, `bundleMissing`, `xtbProxy`, `scoreComponents`) and are quoted in
[SCIENCE_GUARDRAILS.md](SCIENCE_GUARDRAILS.md). A bundle and a record page always show:

- that an xTB gap is a semi-empirical proxy on an unrelaxed geometry, when the bundle has xTB
  columns;
- that the synthetic-accessibility components are not a probability of synthesis, when the
  bundle has score columns;
- that a small gap does not imply conductivity, stability or synthesisability.

The notices stored in the manifest are shown as well, as the bundle wrote them. Data from others
(`third_party` in the manifest) is listed with its licence and citation on the bundle page.

The study pages still show no xTB data. xTB columns appear only inside a bundle, labelled as
above, and are never placed next to the PBE values of the study.

## Bundles shipped with the site

`public/bundles/index.json` lists them; each one is a folder `public/bundles/<id>/`.

| id | What it is |
|---|---|
| `pormake_small` | The example `examples/pormake_small.yaml` of mofsift, run with mofsift at commit `f658178`: six candidates from two public PORMAKE nodes and two linkers on three nets, of which the four that pass the structural checks are in the bundle. It contains no result of the study. The `precedent_*` columns are counts derived from the QMOF database (CC BY 4.0; Rosen et al., *Matter* 2021; *npj Comput. Mater.* 2022); the database itself is not included. |

To add a bundle:

1. Check it: `mofsift validate export/<project>`.
2. Read its `manifest.json`. The `config` section holds the paths of the run as they were
   written; do not publish a path that says something private.
3. Copy the folder to `public/bundles/<id>/`. The id must be made of letters, digits, `_`, `-`
   and `.`; `local` is reserved.
4. Add an entry (`id`, `title`, `description`) to `public/bundles/index.json`.
5. Run `npm run test`. A unit test compares every file of every shipped bundle with its
   manifest, and refuses restricted files (POTCAR, WAVECAR, CHGCAR, pickled models, `qmof.csv`).

`.gitattributes` marks `public/bundles/**` as `-text`, so git does not rewrite line endings on
Windows. Without it the checksums would no longer match after a checkout.

**Only public results belong here.** A bundle on the site is published with it. Do not add a
bundle with unpublished results of the study; open it from your computer instead.

## Code

| File | Role |
|---|---|
| `src/lib/bundle.ts` | Types, the checks above, and the table helpers (grouping, sorting, search, formatting). No React |
| `src/lib/bundleSource.ts` | The two sources: the folder `public/bundles` of the site, and a folder of the reader |
| `src/app/BundleContext.tsx` | The bundles open in the tab |
| `src/pages/Bundles.tsx`, `BundleView.tsx`, `BundleRecord.tsx` | The three pages |
| `src/components/StructureViewer.tsx` | The existing viewer, which now also accepts the text of a structure from a bundle |
| `tests/unit/bundle*.test.ts(x)`, `tests/e2e/bundles.spec.ts` | Tests |

## Not done

- No filters by range, no plots and no comparison of records: search, sort and the column
  chooser only. `mofsift filter` is the place to select records.
- No merge of bundles in the browser (`mofsift merge` does it).
- The table file (`candidates.csv` or `.parquet`) is offered for download but not read.
- A bundle from the computer is not kept between visits.
