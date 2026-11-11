# Project audit (Phase 0)

Date: 2026-11-08. Performed in an isolated cloud workspace on a fresh clone of the public repository. The clone was treated as **read-only**: `git status` was clean before and after all work, and this is enforced by `tests/python/test_export.py::test_source_repository_untouched`.

## Source

| Item | Value |
|---|---|
| Repository | https://github.com/humbertogn-coder/MOF_3D_Generator |
| Commit | `e2e71fada04e9679f95fa07412854c82db0e3dc2` (2026-10-19, "Structure figures (Fig. 4 and Fig. S5) drawn from the CIF/POSCAR files; manuscript v4.2") |
| Size | 48 MB (no models, no POTCARs, no raw VASP outputs other than inputs/CONTCAR/POSCAR/OSZICAR/EIGENVAL) |
| Licences | `LICENSE`: MIT (© 2026 C. H. Guerrero Navarro, M. Ghotbi, P. B. Balbuena). README: "Code: MIT. Data produced in this work: CC-BY-4.0." `CITATION.cff` v0.1.0, date-released 2026-10-08 |
| Publication | Manuscript in preparation (manuscript/ contains v4.x drafts); README: "Zenodo: DOI to be added". No DOI or journal acceptance found. |
| Pre-existing web app | None found in the repository. |

## Tables used (schemas verified)

| File | Rows | Notes |
|---|---|---|
| `data/catalogue/catalogue.csv` | 168 | all enumerated candidates; 131 with `passed=True` |
| `data/catalogue/passed.csv` | 131 | columns as in the specification (name … qc_reasons); names unique |
| `data/catalogue/zeopp.csv` | 131 | `LCD_A, PLD_A, LCD_along_path_A, vol_A3, density_zeo, n_atoms_zeo`; no missing PLD/LCD |
| `data/catalogue/cifs/*.cif` | 131 | PORMAKE output, P1, 1.7 MB total, largest 29.6 kB |
| `data/al/iter3/predictions.csv` | 131 | `mu, sigma_seed, sigma_tree, is_ood, ood_reasons, iteration=3`; 89 OOD |
| `data/al/iter{0,1,2}/{predictions,acquisition_ranking,selected_batch}.csv` | 131/131/11, 131/42/8, 131/26/8 | recorded pools and batches |
| `data/al/iter{1,2}/selection_rules.json` | — | caps 4/2/4, κ=1, α=0.3, β=0.5, exclusions, recorded N_topo; **no file for iteration 0** |
| `data/dft/dft_results.csv` | 37 | 27 candidate runs + 10 spin-state sensitivity runs (`<name>__afm`, `__afm2`, `__afmbs`); 18 `label_ok=True` |
| `data/dft/spin_solutions.csv` | 18 | spin-solution energies/gaps |
| `runs/iter*/<name>/static*/POSCAR` | 18 used | DFT-relaxed geometry of each accepted label (folder chosen by `label_folder()` in `scripts/22_structure_figures.py`) |
| `results/final/table_labels.csv`, `table_excluded.csv` | 18 / 9 | used only for `known_mof`, `spin_state`, `outcome` text |
| `results/qmof_pbe_vs_hse06/by_shell.csv` | 2 | one summary statistic cited as context |

## Code semantics verified

- `src/mofal/surrogate.py`: μ = mean of the 5 member means; `sigma_seed` = std of member means; `sigma_tree` = std over all trees of all members; OOD = any of density, PLD_A, n_atoms, metal_frac, C_per_atom outside the 5–95 % QMOF quantiles.
- `src/mofal/acquisition.py`: `KAPPA, ALPHA, BETA = 1.0, 0.3, 0.5`; `MAX_PER_TOPOLOGY, MAX_PER_METAL, MAX_PER_SUBSTITUENT = 2, 2, 3`; score as specified (lower is better); `N_topo` = accepted labels per topology; forced names first, counted toward caps.
- `scripts/06_select_batch.py`: excludes everything already in `dft_results.csv` (any status) and applies family/combo/max-atom rules.
- `scripts/08_parse_dft.py`: acceptance rules, including the conditional ones (hand-stopped relaxations with Fmax ≤ 0.25 eV/Å; `relax_scf_checked_by_static`; lowest-energy converged spin solution).

## Findings that shaped the implementation

1. **The study defaults differ from the caps the campaign actually used.** The code defaults are 2/2/3, but iterations 1–2 used 4/2/4 (recorded in their rules files). The replay uses the recorded settings. The scenario uses the code defaults and offers a one-click switch to 4/2/4.
2. **Iteration 0 has no rules file.** Caps 3/2/3 and the two forced closed-shell anchors (MOF-5 and cds Zn-BDC) come from the project notes. They reproduce the recorded batch exactly; with a topology cap of 2 the replay does not reproduce it. Documented as an export warning.
3. **N_topo for iteration 2.** The recorded value is cds = 4. Recomputing from the final DFT table gives cds = 5, because `cds__Co-N317__short-F4` was pending when the batch was chosen and was accepted later. The replay uses the recorded value; the UI explains the difference.
4. **Exact reproduction.** With these settings, recomputed scores match the recorded scores to 0.0 (bit-identical). The ranking order and the selected batches match for iterations 0, 1 and 2. The data contain no exact score ties.
5. **Spin-sensitivity rows.** These must not be counted as candidates or labels. They are attached to their parent candidate as diagnostics.
6. **3Dmol.js 2.5.5** parses all tested CIFs (smallest and largest of every topology) and VASP POSCARs with the exact atom counts of the catalogue.

## Architecture decision

Static site (React + TypeScript + Vite, Plotly.js basic bundle, 3Dmol.js), with a versioned JSON bundle produced offline by a standard-library Python exporter. The app lives in a sibling folder `MOF_Discovery_Studio/`, outside the research repository. No backend, database, authentication or API keys.
