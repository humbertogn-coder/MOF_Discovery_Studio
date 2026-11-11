# Roadmap (not in v0.1)

These ideas are deliberately **out of scope** for the static MVP. Each would need a scientific review before any implementation.

1. **Retrospective Active Learning Playground.** Teach and compare acquisition strategies (random, greedy, LCB, the study's acquisition) on a leakage-free held-out set, for example the repository's retrospective QMOF benchmark (`results/retro_al/`). It requires a clear train/test provenance and a redistribution check for any QMOF-derived values.
2. **MOF Designer.** Choose metal, node, linker and topology, then run real PORMAKE assembly with the study QC. It needs a backend or WASM build of PORMAKE and the audited building-block tables. It must clearly separate "assembled" from "QC passed".
3. **Online active-learning loop** that retrains on newly acquired labels. It requires compute, model storage and a label-acceptance workflow, and is out of scope for a free static site.
4. **xTB layer.** Show periodic GFN1-xTB gaps as a separate, method-labelled column with the repository's caveats (reliable for closed-shell frameworks only). Never merge it with PBE values.
5. **Band-edge character and DOS.** Display the repository's VBM/CBM projections and DOS curves (`results/band_edges/`) for the 18 labels.
6. **Advanced periodic visualization.** Configurable supercells, bonds across boundaries, and node/linker colouring.
7. **Data API / saved collections / accounts.** Not planned; it would introduce backend costs.
8. **LLM assistant.** Not planned for scientific-accuracy and cost reasons.
9. **Internationalisation.** A Spanish UI translation.
10. **Dark theme.** It needs a second, validated chart palette.
