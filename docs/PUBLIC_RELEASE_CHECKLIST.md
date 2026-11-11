# Public release checklist

Status legend: ☐ open · ☑ done in this build · ⚠ blocker that needs a human decision

## Blockers (must be resolved before a public URL exists)

- ⚠ **Advisor/team approval.** The manuscript is in preparation (target journal not confirmed). Confirm with Dr. P. B. Balbuena and M. Ghotbi that the catalogue, predictions, DFT labels and DFT-relaxed geometries may be shown publicly before publication. The data are already in a public GitHub repository under CC-BY-4.0, but a dedicated website is a more visible release.
- ⚠ **Publication wording.** The site says "manuscript in preparation; publication status and DOI to be confirmed". Update `citation_status` in `scripts/export_research_data.py` and re-export once a DOI or acceptance exists. Never add an unverified DOI.
- ⚠ **Zenodo DOI** for the research data is "to be added" upstream. Add it to the Methods page after it is minted.
- ⚠ **Hosting account.** Deploy only from an account you control (Cloudflare or GitHub), and verify the current free-plan terms ([COSTS.md](COSTS.md)).

## Content and licensing

- ⚠ **v0.2 adds unpublished analyses**: band-edge character and DOS of the 18 labels, the failure gallery with last DFT geometries, compute cost and the retrospective QMOF benchmark. Include them in the team's approval.

- ☑ Only data from the public research repository at a frozen commit (`e2e71fa`) are shipped.
- ☑ No QMOF data, POTCARs, raw VASP outputs, trained models or manuscript text and figures in the bundle (`scripts/validate_export.py` rejects restricted file patterns).
- ☑ Study data CC-BY-4.0 and research code MIT stated, with attribution on every download (JSON exports, DATA_README.txt).
- ☑ Third-party tools acknowledged (PORMAKE, Zeo++, scikit-learn, QMOF, VASP, 3Dmol.js, Plotly).
- ☐ Decide the website repository name and owner. The website code is MIT ([LICENSE](../LICENSE)); confirm the copyright holder line.
- ☐ Optional: add a contact link (for example the GitHub issues page of the website repository). No personal e-mail is shown on the site.
- ☐ Confirm that "MOF Discovery Studio" is acceptable as a name (no trademark search was done; it is a working name).

## Scientific review

- ☑ Predicted vs accepted DFT vs not-accepted vs missing are always distinct.
- ☑ σ_tree / σ_seed are never called confidence intervals.
- ☑ Generated and DFT-relaxed geometries are labelled separately.
- ☑ Conditional DFT acceptances are flagged.
- ☑ No conductivity, stability or synthesisability claims; no recomputed accuracy metrics.
- ☐ A co-author reads `docs/SCIENCE_GUARDRAILS.md` and the Methods page once and signs off on the wording.
- ☐ Check the `known_mof` identifications (MOF-5, IRMOF-3) shown on candidate pages; they come from `results/final/table_labels.csv`.

## Technical

- ☑ `npm run check` passes (validate-data, typecheck, lint, unit tests, Python tests, build).
- ☑ Playwright E2E passes on desktop and mobile; sub-path build verified.
- ☐ After deployment, run the steps in [DEPLOYMENT.md § Verifying a deployment](DEPLOYMENT.md#verifying-a-deployment) on the live URL.
- ☐ Optional: add analytics only if privacy-respecting and approved (none is included).
