# Science guardrails

This file quotes, verbatim, every piece of scientific wording used in tooltips, chart notes and the Methods page of MOF Discovery Studio. The single source in code is `src/lib/guardrails.ts`; `tests/unit/guardrails.test.ts` fails if any entry below drifts from the code.

## Principles

- Predicted, computed (DFT) and missing values are always visually and textually distinct. Missing values are shown as “—” and exported as empty/`null`, never as zero.
- `σ_tree` and `σ_seed` are called *model ensemble spread* / *seed disagreement*, never “uncertainty”, “error bar” or “95 % confidence interval”.
- A DFT gap is shown as a validated value only when `label_ok` is true. Non-accepted runs are labelled “Not accepted / diagnostic” and their gap values are not displayed.
- Generated (PORMAKE) and DFT-relaxed geometries are labelled separately; a generated CIF is never called DFT-relaxed.
- No claims of conductivity, mobility, stability, synthesisability or experimental performance. No new DFT, retraining or discovery claims.
- xTB results from the research repository are not shown; they are a different method and must never share a column with PBE values.
- No validation metrics are recomputed on the site.

## Texts used in the interface

| Key | Where it appears |
|---|---|
| `headline` | Home callout, Explorer footer note, Methods §6 |
| `predictedGap` | Explorer column/filter tooltip, Candidate “Model estimate”, Compare, Methods §3, AL “Variables explained” |
| `sigmaTree` | Explorer tooltip, Candidate, Compare, Methods §3, AL |
| `sigmaSeed` | Explorer scatter axis tooltip, Candidate, Compare, Methods §3 |
| `ood` | OOD badges, Explorer domain filter, Candidate, Compare, Methods §3, AL |
| `qc` | “QC passed” badge, Candidate “Structural QC”, Methods §1 |
| `dftAccepted` | DFT badges, Explorer DFT column, Candidate “DFT evidence”, Compare, Home stats |
| `dftRejected` | “DFT not accepted” badge and Candidate DFT section |
| `dftNotAvailable` | “Not evaluated” badge and Candidate DFT section |
| `conditional` | Methods §4 (acceptance notes on candidate pages give the per-label detail) |
| `pldLcd` | Explorer PLD/LCD tooltips and filters, Candidate, Compare, Methods §2 |
| `density` | Explorer density tooltip, Candidate, Compare, Methods §2 |
| `geometryPormake` | Candidate viewer caption (PORMAKE geometry) |
| `geometryDft` | Candidate viewer caption (DFT-relaxed geometry) |
| `bonds` | 3D viewer footer tooltip |
| `hypothetical` | “Hypothetical” badge, Home callout, Methods §1 |
| `acquisition` | Active Learning callout, Methods §5 |
| `replay` | Active Learning callout, Methods §5 |
| `kappa` | Active Learning κ slider tooltip |
| `alpha` | Active Learning α slider tooltip |
| `beta` | Active Learning β slider tooltip |
| `noConductivity` | Methods §6 |
| `smallGap` | Candidate DFT section, Methods §6 |
| `bandEdge` | Candidate “Electronic structure (DFT)” card, DFT campaign §5, Methods §4 |
| `dos` | DOS chart caption on candidate pages |
| `lastGeometry` | Viewer caption for “Last DFT step (not accepted)”, DFT campaign §2 |
| `retro` | Retrospective benchmark section (Active Learning page), Methods §5 |
| `spinSolutions` | DFT campaign §4, Methods §4 |

### `headline`

> Predicted low band gap is not equivalent to demonstrated electrical conductivity.

### `predictedGap`

> Predicted band gap (μ): mean of a 5-member ExtraTrees ensemble trained on QMOF PBE band gaps (plus the accepted DFT labels of earlier iterations). It estimates the PBE reference gap of the generated structure. It is not a measured or experimental value.

### `sigmaTree`

> Model ensemble spread (σ_tree): standard deviation over the predictions of all individual trees of all ensemble members. It describes model disagreement; it is not a calibrated standard deviation, error bar or confidence interval.

### `sigmaSeed`

> Seed disagreement (σ_seed): standard deviation of the five member-model means (different random seeds). It is a separate, much smaller source of model disagreement.

### `ood`

> Out of distribution (OOD): at least one descriptor (density, PLD, number of atoms, metal fraction, carbon per atom) lies outside the 5–95 % range of the QMOF training data. It warns that the prediction is an extrapolation; it does not mean the structure is invalid or unsynthesisable.

### `qc`

> QC passed: the generated structure satisfied the geometric and compositional checks of the study (no atomic overlaps or short non-bonded contacts, one connected framework, sensible H/C coordination, composition equal to the building blocks, density and cell limits). It does not establish thermodynamic stability, synthesisability, absence of defects or an experimentally verified structure.

### `dftAccepted`

> DFT gap (accepted label): PBE-D3(BJ) band gap from VASP that passed the study acceptance rules (label_ok). It is a method- and spin-solution-dependent computed value, not an experimental gap, and PBE typically underestimates gaps of open-shell 3d frameworks.

### `dftRejected`

> Not accepted / diagnostic: a DFT calculation was run but did not satisfy the study acceptance rules (for example framework collapse, unconverged relaxation or SCF). No validated gap is reported.

### `dftNotAvailable`

> Not evaluated: no DFT calculation was run for this candidate in the study.

### `conditional`

> Some labels were accepted under the study’s conditional rules (for example, a relaxation stopped by hand is accepted when the final maximum force is ≤ 0.25 eV/Å). These are not described as fully converged.

### `pldLcd`

> PLD and LCD (Å): pore limiting and largest cavity diameters from Zeo++ (high-accuracy mode, CCDC radii) on the generated structure. Values depend on the calculation convention and atomic radii.

### `density`

> Density (g/cm³) of the generated (PORMAKE) unit cell, not of a relaxed or experimental structure.

### `geometryPormake`

> PORMAKE-generated geometry: the hypothetical structure as assembled from building blocks, before any DFT relaxation.

### `geometryDft`

> DFT-relaxed geometry: input structure of the static calculation that produced the accepted label (end point of the PBE-D3(BJ) relaxation). Shown only for accepted labels.

### `bonds`

> Bonds are drawn by the viewer from interatomic distances. They are a visualization heuristic, not independently validated chemical bonds, and bonds across periodic boundaries may be missing. One unit cell does not show the full connectivity of the extended framework.

### `hypothetical`

> All frameworks are hypothetical structures generated in silico; none is claimed to have been synthesised.

### `acquisition`

> The acquisition score is a ranking heuristic for choosing which candidates to compute next. It is not a physical energy, a conductivity, or a probability. Lower scores rank first.

### `replay`

> This page re-ranks frozen, precomputed predictions in your browser. Moving a slider does not retrain the model and does not run new DFT calculations.

### `kappa`

> κ multiplies the ensemble spread with a negative sign: a larger κ favours candidates the model is less sure about (exploration). It does not mean those candidates perform better.

### `alpha`

> α rewards topologies with few accepted DFT labels (term α / max(1, N_topo)). N_topo counts accepted labels per topology available when the batch was selected.

### `beta`

> β penalises out-of-distribution candidates (I_ood = 1 if the OOD flag is set).

### `noConductivity`

> Electronic conductivity, carrier mobility, mechanical robustness, chemical stability and synthesisability are not implied by a small predicted or computed band gap.

### `smallGap`

> A small DFT gap is method- and spin-dependent and is not, by itself, evidence of metallic behaviour.

### `bandEdge`

> Band-edge character: share of the electronic states within 0.25 eV of the valence-band maximum (VBM) and of the conduction-band minimum (CBM) that sits on each site group (metal, μ4-O, carboxylate O, linker backbone), from the DFT projections of the accepted label (k-weighted, both spins). It describes the PBE frontier states; it is not an experimental measurement.

### `dos`

> Density of states (DOS): total and site-projected PBE DOS of the static calculation that provided the label, relative to the VBM, spin up drawn upward and spin down downward. A 0.05 eV Gaussian broadening is applied for legibility.

### `lastGeometry`

> Last DFT geometry (not accepted): final structure of a DFT relaxation that did not meet the acceptance rules. It is not converged and not a validated structure; it is shown only to illustrate the failure, for example a framework collapse.

### `retro`

> Retrospective benchmark: a simulation on QMOF, not on the generated catalogue. The QMOF PBE gap plays the role of the DFT label for pools of 150 out-of-distribution QMOF structures. It shows how selection strategies compare under these conditions; it is not a measurement on the hypothetical frameworks.

### `spinSolutions`

> Spin solutions: several initial magnetic configurations were computed on the same geometry; the label is the lowest-energy converged one. The gap can change by several tenths of an eV between solutions, which is a known sensitivity of PBE for open-shell frameworks.
