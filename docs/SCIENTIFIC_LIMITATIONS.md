# Scientific limitations

This page lists what the data shown in MOF Discovery Studio can and cannot support. The interface wording is in [SCIENCE_GUARDRAILS.md](SCIENCE_GUARDRAILS.md).

## Structures

- All 131 frameworks are **hypothetical**, assembled in silico with PORMAKE. None is claimed to be synthesised.
- **QC passed** means the generated geometry passed geometric and compositional checks. It does not establish thermodynamic or mechanical stability, synthesisability or absence of defects. Several QC-passed frameworks collapsed or sheared during DFT relaxation (for example the M₃(CO₂)₆ pcu family, the Zn and Mn paddlewheel cds frameworks, and Fe₄ bcu-H).
- The displayed CIF is the **generated** geometry. DFT-relaxed geometries exist only for the accepted labels and are labelled separately.
- Bonds in the 3D viewer are drawn by distance (a visualization heuristic). One unit cell does not show the full connectivity of the framework; the optional 2×2×2 view only replicates atoms for display.

## Descriptors

- PLD/LCD come from Zeo++ (high-accuracy mode, CCDC radii) on the generated structure. They depend on conventions and radii, and they change after relaxation.
- Density is that of the generated cell.

## Model predictions

- μ is a 5-member ExtraTrees estimate of the **PBE** band gap, trained on QMOF plus accepted labels. It is not an experimental gap and not an HSE06 or many-body gap.
- σ_tree and σ_seed measure model disagreement. They are not calibrated uncertainties, error bars or confidence intervals.
- 89 of the 131 candidates are out of distribution by the 5-descriptor rule, so most predictions are extrapolations.
- For accepted labels, the iteration-3 model was trained on that label, so its prediction is not independent. The candidate page also shows the estimate of the model that selected it.
- The site recomputes **no** accuracy metric. Benchmark and prospective-error numbers belong to the research repository and manuscript.

## DFT labels

- The labels are PBE-D3(BJ) gaps from VASP under the study protocol. They are method-, geometry- and spin-solution-dependent. PBE without +U typically underestimates gaps of open-shell 3d frameworks; the repository's QMOF analysis finds that only about 2 % of open-shell 3d MOFs with a PBE gap below 1 eV also have an HSE06 gap below 1 eV.
- Some labels were accepted under conditional rules (hand-stopped relaxations with Fmax ≤ 0.25 eV/Å, or the relax-SCF check by a converged static). These are flagged on the candidate page and never described as fully converged.
- Spin-solution comparisons were run on a single geometry (the FM-relaxed geometry). The label is the lowest-energy converged solution found, which is not necessarily the true ground state.
- A small DFT gap is not, by itself, evidence of metallic behaviour.

## What a low band gap does not imply

Electronic conductivity, carrier mobility, charge-transport mechanism (band-like or hopping), mechanical robustness, chemical stability and synthesisability are **not** implied by a small predicted or computed band gap.

## Active learning

- The Active Learning Explorer **re-ranks frozen predictions**. It does not retrain the model, acquire new labels or run DFT.
- Replays use the recorded pools and rules. Iteration-0 rules were not stored in the repository; they are taken from the project notes and confirmed only by exact reproduction of the recorded batch.
- Scenario mode on the iteration-3 predictions is an exploration. The study selected no iteration-3 batch.
- The acquisition score is a ranking heuristic, not an energy, a conductivity or a probability.

## Not included

- xTB results (a different method; never mixed with PBE values).
- QMOF structures or tables (not redistributed), raw VASP outputs, POTCARs, trained models, and manuscript figures or text.
