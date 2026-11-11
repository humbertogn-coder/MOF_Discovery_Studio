/**
 * Single source of the scientific wording used in tooltips, chart notes and the Methods page.
 * docs/SCIENCE_GUARDRAILS.md must quote every entry verbatim (checked by tests/unit/guardrails.test.ts).
 */
export const G = {
  headline: 'Predicted low band gap is not equivalent to demonstrated electrical conductivity.',
  predictedGap:
    'Predicted band gap (μ): mean of a 5-member ExtraTrees ensemble trained on QMOF PBE band gaps (plus the accepted DFT labels of earlier iterations). It estimates the PBE reference gap of the generated structure. It is not a measured or experimental value.',
  sigmaTree:
    'Model ensemble spread (σ_tree): standard deviation over the predictions of all individual trees of all ensemble members. It describes model disagreement; it is not a calibrated standard deviation, error bar or confidence interval.',
  sigmaSeed:
    'Seed disagreement (σ_seed): standard deviation of the five member-model means (different random seeds). It is a separate, much smaller source of model disagreement.',
  ood:
    'Out of distribution (OOD): at least one descriptor (density, PLD, number of atoms, metal fraction, carbon per atom) lies outside the 5–95 % range of the QMOF training data. It warns that the prediction is an extrapolation; it does not mean the structure is invalid or unsynthesisable.',
  qc:
    'QC passed: the generated structure satisfied the geometric and compositional checks of the study (no atomic overlaps or short non-bonded contacts, one connected framework, sensible H/C coordination, composition equal to the building blocks, density and cell limits). It does not establish thermodynamic stability, synthesisability, absence of defects or an experimentally verified structure.',
  dftAccepted:
    'DFT gap (accepted label): PBE-D3(BJ) band gap from VASP that passed the study acceptance rules (label_ok). It is a method- and spin-solution-dependent computed value, not an experimental gap, and PBE typically underestimates gaps of open-shell 3d frameworks.',
  dftRejected:
    'Not accepted / diagnostic: a DFT calculation was run but did not satisfy the study acceptance rules (for example framework collapse, unconverged relaxation or SCF). No validated gap is reported.',
  dftNotAvailable: 'Not evaluated: no DFT calculation was run for this candidate in the study.',
  conditional:
    'Some labels were accepted under the study’s conditional rules (for example, a relaxation stopped by hand is accepted when the final maximum force is ≤ 0.25 eV/Å). These are not described as fully converged.',
  pldLcd:
    'PLD and LCD (Å): pore limiting and largest cavity diameters from Zeo++ (high-accuracy mode, CCDC radii) on the generated structure. Values depend on the calculation convention and atomic radii.',
  density: 'Density (g/cm³) of the generated (PORMAKE) unit cell, not of a relaxed or experimental structure.',
  geometryPormake:
    'PORMAKE-generated geometry: the hypothetical structure as assembled from building blocks, before any DFT relaxation.',
  geometryDft:
    'DFT-relaxed geometry: input structure of the static calculation that produced the accepted label (end point of the PBE-D3(BJ) relaxation). Shown only for accepted labels.',
  bonds:
    'Bonds are drawn by the viewer from interatomic distances. They are a visualization heuristic, not independently validated chemical bonds, and bonds across periodic boundaries may be missing. One unit cell does not show the full connectivity of the extended framework.',
  hypothetical: 'All frameworks are hypothetical structures generated in silico; none is claimed to have been synthesised.',
  acquisition:
    'The acquisition score is a ranking heuristic for choosing which candidates to compute next. It is not a physical energy, a conductivity, or a probability. Lower scores rank first.',
  replay:
    'This page re-ranks frozen, precomputed predictions in your browser. Moving a slider does not retrain the model and does not run new DFT calculations.',
  kappa:
    'κ multiplies the ensemble spread with a negative sign: a larger κ favours candidates the model is less sure about (exploration). It does not mean those candidates perform better.',
  alpha:
    'α rewards topologies with few accepted DFT labels (term α / max(1, N_topo)). N_topo counts accepted labels per topology available when the batch was selected.',
  beta: 'β penalises out-of-distribution candidates (I_ood = 1 if the OOD flag is set).',
  noConductivity:
    'Electronic conductivity, carrier mobility, mechanical robustness, chemical stability and synthesisability are not implied by a small predicted or computed band gap.',
  smallGap:
    'A small DFT gap is method- and spin-dependent and is not, by itself, evidence of metallic behaviour.',
} as const;

export type GuardrailKey = keyof typeof G;
