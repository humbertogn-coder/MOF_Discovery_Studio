MOF Discovery Studio - data dictionary
=======================================

Source: https://github.com/humbertogn-coder/MOF_3D_Generator (see release-manifest.json for the commit).
Licence of the study data: CC-BY-4.0. Attribution: C. H. Guerrero Navarro, M. Ghotbi, P. B. Balbuena
(Texas A&M University), "Active learning for low-band-gap 3D metal-organic frameworks (code and data)".
Manuscript in preparation; publication status and DOI to be confirmed.

All frameworks are HYPOTHETICAL structures assembled with PORMAKE; none is claimed to be synthesised.
Empty cells mean "missing / not evaluated", never zero.

id                       exact candidate name in the source repository
metal, topology, node_family, linker_label, linker_family, substituent   design metadata
open_shell               metal centre with an open d shell (design metadata)
n_atoms                  atoms in the generated unit cell
density_g_cm3            density of the generated cell (g cm^-3)
pld_A, lcd_A             Zeo++ pore limiting / largest cavity diameter (Angstrom; CCDC radii, -ha OCC)
qc_passed                generated structure passed the geometric/compositional QC of src/mofal/qc.py
                         (NOT a statement about stability or synthesisability)
gap_ml_eV                surrogate prediction (mu) of the PBE band gap, eV; NOT a measured value
sigma_tree_eV            spread over all trees of the 5-member ExtraTrees ensemble (model disagreement;
                         not a calibrated standard deviation or confidence interval)
sigma_seed_eV            spread of the 5 member means (seed disagreement)
is_ood                   descriptor outside the 5-95 % QMOF range (density, PLD, n_atoms, metal fraction,
                         C per atom); not a validity verdict
ood_reasons              which descriptor(s) triggered the OOD flag
dft_status               accepted | rejected | not_available | ambiguous (study acceptance rules, label_ok)
dft_gap_eV               PBE-D3(BJ) gap, ONLY for accepted labels (method- and spin-solution dependent)
geometry_provenance      pormake_generated (all CIFs) ; dft_relaxed files are separate (.vasp)

A low predicted or computed band gap does not establish electrical conductivity, carrier mobility,
stability or synthesisability.
