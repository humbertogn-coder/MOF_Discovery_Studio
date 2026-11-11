#!/usr/bin/env python3
"""Export the MOF_3D_Generator research tables into the static MOF Discovery Studio bundle.

The source repository is treated as READ-ONLY. Nothing in it is modified or executed;
only CSV/JSON/CIF/POSCAR files are read (``src/mofal/acquisition.py`` is parsed with
``ast`` to read the default constants, never imported).

Usage
-----
    python scripts/export_research_data.py --source ../MOF_3D_Generator \
        --out public/data --docs docs [--iteration 3] [--source-commit <sha>]

Standard library only (Python >= 3.9). Outputs:

    <out>/release-manifest.json      provenance, counts, checksums, warnings
    <out>/candidates.json            one record per QC-passed candidate
    <out>/active-learning.json       frozen inputs for the acquisition replay/scenario
    <out>/structures/pormake/*.cif   PORMAKE-generated CIFs (copied byte-for-byte)
    <out>/structures/dft/*.vasp      DFT-relaxed geometries of accepted labels (POSCAR)
    <out>/DATA_README.txt            field dictionary shipped with every download
    <docs>/DATA_PROVENANCE.md        human-readable export report
"""
from __future__ import annotations

import argparse
import ast
import csv
import datetime as _dt
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
from collections import Counter, OrderedDict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
import acquisition_ref as acq  # noqa: E402

EXPORT_SCRIPT_VERSION = "1.0.0"
SCHEMA_VERSION = "1.0.0"
APP_RELEASE = "0.1.0"
SOURCE_REPOSITORY_URL = "https://github.com/humbertogn-coder/MOF_3D_Generator"
SLUG_RE = re.compile(r"^[A-Za-z0-9_-]+$")
MAX_CIF_BYTES = 2_000_000

# Iteration 0 has no selection_rules.json in the repository. These settings are taken from
# the project notes (iteration-0 caps 3/2/3, two closed-shell anchors forced, 11 structures)
# and are only accepted if the replay reproduces data/al/iter0/selected_batch.csv exactly.
ITER0_FALLBACK_RULES = {
    "iteration": 0, "n": 11, "exclude_family": [], "exclude_combo": [], "max_atoms": None,
    "max_per_topology": 3, "max_per_metal": 2, "max_per_substituent": 3,
    "kappa": 1.0, "alpha": 0.3, "beta": 0.5, "sigma": "tree",
    "forced": ["pcu__Zn-N16__short-H", "cds__Zn-N153__short-H"], "n_topo_labels": {},
}

REQUIRED_COLUMNS = {
    "passed": ["name", "node_family", "topology", "node_id", "metal", "metal_ox_state", "d_electrons",
               "open_shell", "node_desc", "linker_label", "edge_id", "linker_family", "n_rings",
               "substituent", "linker_desc", "node_rmsd_A", "formula", "n_atoms", "density", "a", "b",
               "c", "min_distance", "n_overlaps", "n_nonbonded_contacts", "n_components", "n_bad_H",
               "n_bad_C", "composition_ok", "passed", "qc_reasons"],
    "catalogue": ["name", "passed"],
    "zeopp": ["name", "LCD_A", "PLD_A", "LCD_along_path_A", "vol_A3"],
    "predictions": ["name", "topology", "metal", "substituent", "node_family", "n_atoms", "density",
                    "PLD_A", "LCD_A", "mu", "sigma_seed", "sigma_tree", "is_ood", "ood_reasons",
                    "iteration"],
    "dft": ["name", "iteration", "gap_eV", "label_ok", "label_reasons", "relax_converged_ionic",
            "relax_converged_electronic", "relax_stopped", "relax_fmax_final",
            "static_converged_electronic", "final_qc_passed", "final_qc_reasons", "topology",
            "spin_solution", "spin_solutions_gap_range_eV", "vol_change_pct", "max_angle_change_deg"],
    "ranking": ["name", "topology", "metal", "substituent", "node_family", "n_atoms", "mu",
                "sigma_seed", "sigma_tree", "is_ood", "ood_reasons", "acquisition_score"],
    "selected": ["name", "selection_rank"],
}


class SchemaError(RuntimeError):
    pass


# ----------------------------------------------------------------------------- parsing
def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def read_csv(path: Path, kind: str) -> Tuple[List[dict], List[str]]:
    if not path.exists():
        raise SchemaError(f"missing source table: {path}")
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames or []
        rows = list(reader)
    missing = [c for c in REQUIRED_COLUMNS.get(kind, []) if c not in header]
    if missing:
        raise SchemaError(f"{path}: missing required column(s) {missing}; found {header}")
    return rows, header


def to_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    s = str(v).strip()
    if s == "" or s.lower() in {"nan", "none", "null", "na"}:
        return None
    try:
        x = float(s)
    except ValueError as e:
        raise SchemaError(f"non-numeric value {v!r}") from e
    return x if math.isfinite(x) else None


def to_int(v: Any) -> Optional[int]:
    x = to_float(v)
    if x is None:
        return None
    if abs(x - round(x)) > 1e-9:
        raise SchemaError(f"expected integer, got {v!r}")
    return int(round(x))


def to_bool(v: Any) -> Optional[bool]:
    if v is None:
        return None
    s = str(v).strip().lower()
    if s in {"true", "1", "yes"}:
        return True
    if s in {"false", "0", "no"}:
        return False
    if s in {"", "nan", "none", "null", "na"}:
        return None
    raise SchemaError(f"non-boolean value {v!r}")


def to_str(v: Any) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    return None if s == "" or s.lower() == "nan" else s


def split_reasons(v: Any) -> List[str]:
    s = to_str(v)
    return [p.strip() for p in s.split(";") if p.strip()] if s else []


def slugify(name: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_-]+", "-", name).strip("-")
    if not slug or not SLUG_RE.match(slug):
        raise SchemaError(f"cannot build a safe slug for {name!r}")
    return slug


def parse_cif_cell(text: str) -> Dict[str, Optional[float]]:
    out: Dict[str, Optional[float]] = {}
    for key, tag in [("a_A", "_cell_length_a"), ("b_A", "_cell_length_b"), ("c_A", "_cell_length_c"),
                     ("alpha_deg", "_cell_angle_alpha"), ("beta_deg", "_cell_angle_beta"),
                     ("gamma_deg", "_cell_angle_gamma")]:
        m = re.search(rf"^\s*{tag}\s+([-+0-9.eE]+)", text, re.M)
        out[key] = float(m.group(1)) if m else None
    return out


def cif_atom_count(text: str) -> int:
    """Count atom-site rows of the (single) _atom_site loop."""
    lines = text.splitlines()
    n, in_loop, header_done, cols = 0, False, False, 0
    for ln in lines:
        s = ln.strip()
        if s.startswith("loop_"):
            if in_loop and header_done:
                break
            in_loop, header_done, cols = True, False, 0
            continue
        if in_loop and s.startswith("_atom_site_"):
            cols += 1
            continue
        if in_loop and cols and s and not s.startswith("_") and not s.startswith("#"):
            header_done = True
            n += 1
        elif in_loop and header_done and (not s or s.startswith("_")):
            break
        elif in_loop and not cols and s.startswith("_"):
            in_loop = False
    return n


def parse_poscar(text: str) -> Dict[str, Any]:
    lines = text.splitlines()
    scale = float(lines[1].split()[0])
    vecs = [[float(x) * scale for x in lines[i].split()[:3]] for i in (2, 3, 4)]
    species = lines[5].split()
    counts = [int(x) for x in lines[6].split()]
    if len(species) != len(counts) or not all(re.match(r"^[A-Z][a-z]?$", s) for s in species):
        raise SchemaError("POSCAR without a valid VASP5 species line")

    def norm(v):
        return math.sqrt(sum(x * x for x in v))

    def ang(u, v):
        return math.degrees(math.acos(sum(x * y for x, y in zip(u, v)) / (norm(u) * norm(v))))
    a, b, c = (norm(v) for v in vecs)
    return {"a_A": a, "b_A": b, "c_A": c, "alpha_deg": ang(vecs[1], vecs[2]),
            "beta_deg": ang(vecs[0], vecs[2]), "gamma_deg": ang(vecs[0], vecs[1]),
            "n_atoms": sum(counts), "species": dict(zip(species, counts))}


def read_acquisition_defaults(path: Path) -> Dict[str, float]:
    """Read KAPPA/ALPHA/BETA and the MAX_PER_* caps from acquisition.py without importing it."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found: Dict[str, Any] = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            t = node.targets[0]
            names = [e.id for e in t.elts] if isinstance(t, ast.Tuple) else [getattr(t, "id", None)]
            vals = node.value.elts if isinstance(node.value, ast.Tuple) else [node.value]
            for n, v in zip(names, vals):
                if n and isinstance(v, ast.Constant):
                    found[n] = v.value
    need = ["KAPPA", "ALPHA", "BETA", "MAX_PER_TOPOLOGY", "MAX_PER_METAL", "MAX_PER_SUBSTITUENT"]
    missing = [k for k in need if k not in found]
    if missing:
        raise SchemaError(f"{path}: could not read constants {missing}")
    return {k.lower(): found[k] for k in need}


def git_info(source: Path) -> Tuple[Optional[str], Optional[str]]:
    if not (source / ".git").exists():
        return None, None
    try:
        sha = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
        date = subprocess.check_output(["git", "-C", str(source), "log", "-1", "--format=%cI"], text=True).strip()
        dirty = subprocess.check_output(["git", "-C", str(source), "status", "--porcelain",
                                         "--untracked-files=no"], text=True).strip()
        return (sha + ("-dirty" if dirty else "")), date
    except (OSError, subprocess.CalledProcessError):
        return None, None


def dft_label_folder(source: Path, name: str, iteration: int, spin_solution: Optional[str]) -> Path:
    """Same rule as label_folder() in scripts/22_structure_figures.py of the source repository:
    the static run whose spin solution provided the accepted label."""
    base = source / f"runs/iter{iteration}" / name
    sol = spin_solution or "fm-start"
    if sol == "fm-start":
        return base / "static"
    if sol == "afmbs-start":
        return base / "static_bs"
    return source / f"runs/iter{iteration}" / f"{name}__{sol.replace('-start', '')}" / "static"


# ----------------------------------------------------------------------------- export
class Exporter:
    def __init__(self, source: Path, out: Path, docs: Optional[Path], iteration: int,
                 source_commit: Optional[str], timestamp: Optional[str]):
        self.source, self.out, self.docs, self.iteration = source, out, docs, iteration
        self.source_commit, self.timestamp = source_commit, timestamp
        self.warnings: List[str] = []
        self.decisions: List[str] = []
        self.checksums: "OrderedDict[str, str]" = OrderedDict()
        self.report: Dict[str, Any] = {}

    def src(self, rel: str) -> Path:
        p = self.source / rel
        if p.exists() and p.is_file():
            self.checksums[rel] = sha256(p)
        return p

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    # ---- load
    def load(self) -> None:
        S = self.src
        self.passed, _ = read_csv(S("data/catalogue/passed.csv"), "passed")
        self.catalogue, _ = read_csv(S("data/catalogue/catalogue.csv"), "catalogue")
        self.zeopp, _ = read_csv(S("data/catalogue/zeopp.csv"), "zeopp")
        self.pred, _ = read_csv(S(f"data/al/iter{self.iteration}/predictions.csv"), "predictions")
        self.dft_raw, _ = read_csv(S("data/dft/dft_results.csv"), "dft")
        p = S("data/dft/spin_solutions.csv")
        self.spin_rows = read_csv(p, "")[0] if p.exists() else []
        p = S("results/final/table_labels.csv")
        self.table_labels = read_csv(p, "")[0] if p.exists() else []
        p = S("results/final/table_excluded.csv")
        self.table_excluded = read_csv(p, "")[0] if p.exists() else []
        p = S("results/qmof_pbe_vs_hse06/by_shell.csv")
        self.hse_by_shell = read_csv(p, "")[0] if p.exists() else []
        self.acq_defaults = read_acquisition_defaults(S("src/mofal/acquisition.py"))
        for rel in ["LICENSE", "README.md", "CITATION.cff", "scripts/06_select_batch.py",
                    "scripts/08_parse_dft.py", "src/mofal/surrogate.py"]:
            S(rel)
        model_info = S(f"data/al/iter{self.iteration}/model_info.json")
        self.model_info = json.loads(model_info.read_text()) if model_info.exists() else {}

    @staticmethod
    def unique_index(rows: List[dict], table: str, warn) -> Dict[str, dict]:
        idx: Dict[str, dict] = {}
        dups = Counter(r["name"] for r in rows)
        for n, c in dups.items():
            if c > 1:
                warn(f"{table}: duplicate key {n!r} appears {c} times")
        for i, r in enumerate(rows):
            r["_row"] = i + 2  # 1-based line number including header
            idx.setdefault(r["name"], r)
        return idx

    # ---- licences
    def licences(self) -> Dict[str, Any]:
        lic = (self.source / "LICENSE").read_text(encoding="utf-8")
        readme = (self.source / "README.md").read_text(encoding="utf-8")
        code_mit = lic.lstrip().startswith("MIT License")
        data_ccby = "CC-BY-4.0" in readme or "CC BY 4.0" in readme
        if not code_mit:
            self.warn("LICENSE does not start with 'MIT License'; check code licence")
        if not data_ccby:
            self.warn("README does not state CC-BY-4.0 for the data; check data licence")
        m = re.search(r"^Copyright \(c\) (.+)$", lic, re.M)
        return OrderedDict([
            ("source_code", "MIT" if code_mit else "UNVERIFIED"),
            ("source_data", "CC-BY-4.0" if data_ccby else "UNVERIFIED"),
            ("copyright", m.group(1).strip() if m else None),
            ("data_statement_source", "README.md, section 'License': 'Code: MIT. Data produced in this work: CC-BY-4.0.'"),
            ("attribution", "C. H. Guerrero Navarro, M. Ghotbi, P. B. Balbuena (Texas A&M University). "
                            "Active learning for low-band-gap 3D metal-organic frameworks (code and data)."),
            ("not_redistributed", ["QMOF database tables/structures (data/external, not in the source repository)",
                                   "VASP POTCAR files", "raw VASP outputs (WAVECAR, OUTCAR, vasprun.xml)",
                                   "trained surrogate models (~1.5 GB each, not distributed upstream)",
                                   "manuscript drafts and figures (publication status unconfirmed)"]),
            ("third_party", ["PORMAKE (structure assembly)", "Zeo++ (pore descriptors)", "scikit-learn ExtraTrees",
                             "QMOF database (training data; Rosen et al., Matter 2021; npj Comput. Mater. 2022)",
                             "VASP 6.3.2 (DFT)", "3Dmol.js (visualization, BSD-3-Clause)"]),
        ])

    # ---- candidates
    def build(self) -> None:
        W = self.warn
        cat_idx = self.unique_index(self.catalogue, "catalogue.csv", W)
        passed_idx = self.unique_index(self.passed, "passed.csv", W)
        zeo_idx = self.unique_index(self.zeopp, "zeopp.csv", W)
        pred_idx = self.unique_index(self.pred, f"iter{self.iteration}/predictions.csv", W)

        n_cat_passed = sum(1 for r in self.catalogue if to_bool(r["passed"]))
        if n_cat_passed != len(self.passed):
            W(f"catalogue.csv has {n_cat_passed} passed rows but passed.csv has {len(self.passed)}")
        not_passed = [r for r in self.passed if to_bool(r["passed"]) is not True]
        if not_passed:
            W(f"{len(not_passed)} rows in passed.csv are not flagged passed=True")

        names = sorted(passed_idx)
        only_pred = sorted(set(pred_idx) - set(passed_idx))
        no_pred = sorted(set(passed_idx) - set(pred_idx))
        no_zeo = sorted(set(passed_idx) - set(zeo_idx))
        if only_pred:
            W(f"{len(only_pred)} prediction rows have no QC-passed catalogue entry and are not exported: {only_pred}")
        if no_pred:
            W(f"{len(no_pred)} QC-passed candidates have no iteration-{self.iteration} prediction (exported with prediction=null)")
        if no_zeo:
            W(f"{len(no_zeo)} QC-passed candidates have no Zeo++ row")

        # --- DFT: split base runs and spin-sensitivity siblings
        self.dft_rows = []
        base_rows: Dict[str, List[dict]] = {}
        variants: Dict[str, List[dict]] = {}
        unmatched = []
        for i, r in enumerate(self.dft_raw):
            r["_row"] = i + 2
            nm = r["name"]
            if nm in passed_idx:
                base_rows.setdefault(nm, []).append(r)
            else:
                base = nm.rsplit("__", 1)[0] if nm.count("__") >= 3 else None
                if base and base in passed_idx and "spin-state sensitivity" in (r.get("label_reasons") or ""):
                    variants.setdefault(base, []).append(r)
                else:
                    unmatched.append(nm)
        if unmatched:
            W(f"{len(unmatched)} DFT rows match no candidate and are not exported: {unmatched}")
        n_variants = sum(len(v) for v in variants.values())
        self.decisions.append(
            f"dft_results.csv: {len(self.dft_raw)} rows = {sum(len(v) for v in base_rows.values())} candidate runs + "
            f"{n_variants} spin-state sensitivity runs (names '<candidate>__afm*', label_reasons 'spin-state sensitivity run'). "
            "Sensitivity runs are attached to their parent candidate as diagnostics and never counted as labels.")
        for nm, rows in base_rows.items():
            if len(rows) > 1:
                W(f"DFT: {len(rows)} candidate runs for {nm}; status set to 'ambiguous' and all runs exported")
        for r in self.dft_raw:
            r["_label_ok"] = to_bool(r["label_ok"])
            r["_iteration"] = to_int(r["iteration"])

        spin_by_name: Dict[str, List[dict]] = {}
        for r in self.spin_rows:
            spin_by_name.setdefault(r["name"], []).append(r)
        labels_by_name = {r["name"]: r for r in self.table_labels}
        excl_by_name = {r["name"]: r for r in self.table_excluded}

        # predictions at selection time (each DFT batch was predicted by the model that selected it)
        pred_by_iter: Dict[int, Dict[str, dict]] = {}
        for k in range(0, self.iteration):
            p = self.src(f"data/al/iter{k}/predictions.csv")
            if p.exists():
                pred_by_iter[k] = {r["name"]: r for r in read_csv(p, "predictions")[0]}

        # AL history per candidate
        history: Dict[str, List[dict]] = {}
        for k in range(0, self.iteration):
            rp, sp = self.src(f"data/al/iter{k}/acquisition_ranking.csv"), self.src(f"data/al/iter{k}/selected_batch.csv")
            if not (rp.exists() and sp.exists()):
                continue
            rank_rows = read_csv(rp, "ranking")[0]
            sel = {r["name"]: to_int(r["selection_rank"]) for r in read_csv(sp, "selected")[0]}
            rj = self.source / f"data/al/iter{k}/selection_rules.json"
            forced = set((json.loads(rj.read_text()) if rj.exists() else ITER0_FALLBACK_RULES if k == 0 else {}).get("forced") or [])
            for i, r in enumerate(rank_rows, 1):
                history.setdefault(r["name"], []).append(OrderedDict([
                    ("iteration", k), ("rank_in_pool", i), ("pool_size", len(rank_rows)),
                    ("acquisition_score", to_float(r["acquisition_score"])),
                    ("selected", r["name"] in sel), ("selection_rank", sel.get(r["name"])),
                    ("forced", r["name"] in forced)]))

        out_struct = self.out / "structures"
        records = []
        cif_missing, dft_geo = [], 0
        slugs = Counter()
        for nm in names:
            c, z, p = passed_idx[nm], zeo_idx.get(nm), pred_idx.get(nm)
            slug = slugify(nm)
            slugs[slug] += 1
            # --- structure files
            cif_src = self.source / "data/catalogue/cifs" / f"{nm}.cif"
            cif_rel, cell = None, {}
            cif_atoms = None
            if cif_src.is_file():
                size = cif_src.stat().st_size
                if size > MAX_CIF_BYTES:
                    W(f"CIF for {nm} is {size} bytes (> {MAX_CIF_BYTES}); not exported")
                else:
                    text = cif_src.read_text(encoding="utf-8", errors="replace")
                    if "_cell_length_a" not in text or "_atom_site_fract_x" not in text:
                        W(f"CIF for {nm} lacks cell or fractional coordinates; not exported")
                    else:
                        cell = parse_cif_cell(text)
                        cif_atoms = cif_atom_count(text)
                        dst = out_struct / "pormake" / f"{slug}.cif"
                        dst.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copyfile(cif_src, dst)
                        cif_rel = f"structures/pormake/{slug}.cif"
            else:
                cif_missing.append(nm)

            n_atoms = to_int(c["n_atoms"])
            if cif_atoms is not None and n_atoms is not None and cif_atoms != n_atoms:
                W(f"{nm}: CIF has {cif_atoms} atom sites but passed.csv n_atoms={n_atoms}")

            # --- DFT block
            runs = base_rows.get(nm, [])
            if not runs:
                dft = OrderedDict([("status", "not_available")])
            else:
                if len(runs) > 1:
                    status = "ambiguous"
                else:
                    lo = runs[0]["_label_ok"]
                    status = "accepted" if lo is True else ("rejected" if lo is False else "ambiguous")
                r = runs[-1]
                accepted = status == "accepted"
                notes = []
                stopped = to_bool(r["relax_stopped"])
                if accepted and stopped:
                    notes.append(f"Relaxation stopped by hand; accepted under the study rule Fmax ≤ 0.25 eV/Å "
                                 f"(final Fmax {to_float(r['relax_fmax_final']):.3f} eV/Å). Not a fully converged relaxation.")
                if accepted and to_bool(r.get("relax_scf_checked_by_static")):
                    notes.append("Last relaxation SCF stopped at NELM just short of EDIFF; accepted because the converged "
                                 "static run on the same geometry gives Fmax ≤ 0.05 eV/Å (relax_scf_checked_by_static).")
                sol = to_str(r.get("spin_solution"))
                if sol:
                    notes.append(f"Label taken from the lowest-energy converged spin solution ({sol}); gap range over "
                                 f"spin solutions: {to_str(r.get('spin_solutions_gap_range_eV'))} eV.")
                unconv = to_str(r.get("spin_solutions_unconverged"))
                if unconv:
                    notes.append(f"Spin solution(s) with unconverged SCF, not compared: {unconv}.")
                tl = labels_by_name.get(nm, {})
                te = excl_by_name.get(nm, {})
                it = r["_iteration"]
                pp = pred_by_iter.get(it, {}).get(nm) if it is not None else None
                dft = OrderedDict([
                    ("status", status),
                    ("method", "VASP 6.3.2, PBE-D3(BJ), spin polarised (study protocol; see hpc/README.md)"),
                    ("gap_eV", to_float(r["gap_eV"]) if accepted else None),
                    ("diagnostic_gap_eV", None if accepted else to_float(r["gap_eV"])),
                    ("iteration", it),
                    ("is_direct", to_bool(r.get("is_direct"))),
                    ("vbm_eV", to_float(r.get("vbm_eV"))), ("cbm_eV", to_float(r.get("cbm_eV"))),
                    ("reasons", split_reasons(r["label_reasons"])),
                    ("acceptance_notes", notes),
                    ("relax_converged_ionic", to_bool(r["relax_converged_ionic"])),
                    ("relax_converged_electronic", to_bool(r["relax_converged_electronic"])),
                    ("relax_stopped", stopped),
                    ("relax_fmax_final_eV_A", to_float(r["relax_fmax_final"])),
                    ("relax_ionic_steps", to_int(r.get("relax_ionic_steps"))),
                    ("static_converged_electronic", to_bool(r["static_converged_electronic"])),
                    ("final_qc_passed", to_bool(r["final_qc_passed"])),
                    ("final_qc_reasons", split_reasons(r["final_qc_reasons"])),
                    ("vol_change_pct", to_float(r["vol_change_pct"])),
                    ("max_angle_change_deg", to_float(r["max_angle_change_deg"])),
                    ("total_magnetization_muB", to_float(r.get("total_magnetization"))),
                    ("spin_solution", sol),
                    ("spin_state", to_str(tl.get("spin_state"))),
                    ("known_mof", to_str(tl.get("known_mof"))),
                    ("outcome", to_str(te.get("outcome"))),
                    ("prediction_at_selection", None if pp is None else OrderedDict([
                        ("iteration", it), ("mu_eV", to_float(pp["mu"])), ("sigma_tree_eV", to_float(pp["sigma_tree"])),
                        ("source_table", f"data/al/iter{it}/predictions.csv")])),
                    ("spin_solutions", [OrderedDict([
                        ("start", s["start"]), ("energy_eV", to_float(s["energy_eV"])), ("gap_eV", to_float(s["gap_eV"])),
                        ("scf_converged", to_bool(s["scf_converged"])),
                        ("mag_sum_abs_metal_muB", to_float(s.get("mag_sum_abs_metal")))])
                        for s in spin_by_name.get(nm, [])]),
                    ("sensitivity_runs", [OrderedDict([
                        ("run", v["name"]), ("gap_eV", to_float(v["gap_eV"])), ("note", to_str(v["label_reasons"]))])
                        for v in variants.get(nm, [])]),
                    ("source_rows", [f"data/dft/dft_results.csv:{x['_row']}" for x in runs]),
                ])

            # --- DFT-relaxed geometry (accepted labels only)
            dft_geometry = None
            if dft["status"] == "accepted":
                folder = dft_label_folder(self.source, nm, dft["iteration"], dft["spin_solution"])
                poscar = folder / "POSCAR"
                if poscar.is_file():
                    try:
                        info = parse_poscar(poscar.read_text(encoding="utf-8"))
                        dst = out_struct / "dft" / f"{slug}.vasp"
                        dst.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copyfile(poscar, dst)
                        rel = str(poscar.relative_to(self.source))
                        self.checksums[rel] = sha256(poscar)
                        dft_geometry = OrderedDict([
                            ("path", f"structures/dft/{slug}.vasp"), ("format", "vasp"),
                            ("geometry_provenance", "dft_relaxed"),
                            ("description", "Input POSCAR of the static run that produced the accepted label "
                                            "(final geometry of the PBE-D3(BJ) relaxation)."),
                            ("source_file", rel),
                            ("cell", OrderedDict((k, info[k]) for k in ["a_A", "b_A", "c_A", "alpha_deg", "beta_deg", "gamma_deg"])),
                            ("n_atoms", info["n_atoms"])])
                        dft_geo += 1
                        if info["n_atoms"] != n_atoms:
                            W(f"{nm}: DFT POSCAR has {info['n_atoms']} atoms vs catalogue {n_atoms}")
                    except (SchemaError, ValueError, IndexError) as e:
                        W(f"{nm}: DFT POSCAR unreadable ({e}); DFT geometry not exported")
                else:
                    W(f"{nm}: accepted label but no POSCAR at {folder.relative_to(self.source)}")

            pld = to_float(p["PLD_A"]) if p else to_float(z["PLD_A"]) if z else None
            lcd = to_float(p["LCD_A"]) if p else to_float(z["LCD_A"]) if z else None
            if p and z:
                for a, b in [("PLD_A", "PLD_A"), ("LCD_A", "LCD_A")]:
                    x, y = to_float(p[a]), to_float(z[b])
                    if x is not None and y is not None and abs(x - y) > 1e-6:
                        W(f"{nm}: {a} differs between predictions ({x}) and zeopp ({y})")
            rec = OrderedDict([
                ("id", nm), ("slug", slug), ("formula", to_str(c["formula"])), ("metal", to_str(c["metal"])),
                ("metal_ox_state", to_int(c["metal_ox_state"])), ("d_electrons", to_int(c["d_electrons"])),
                ("open_shell", to_bool(c["open_shell"])),
                ("node_family", to_str(c["node_family"])), ("node_id", to_str(c["node_id"])),
                ("node_desc", to_str(c["node_desc"])),
                ("linker_label", to_str(c["linker_label"])), ("linker_family", to_str(c["linker_family"])),
                ("linker_desc", to_str(c["linker_desc"])), ("edge_id", to_str(c["edge_id"])),
                ("n_rings", to_int(c["n_rings"])), ("substituent", to_str(c["substituent"])),
                ("topology", to_str(c["topology"])),
                ("structure", OrderedDict([
                    ("n_atoms", n_atoms), ("density_g_cm3", to_float(c["density"])),
                    ("a_A", to_float(c["a"])), ("b_A", to_float(c["b"])), ("c_A", to_float(c["c"])),
                    ("alpha_deg", cell.get("alpha_deg")), ("beta_deg", cell.get("beta_deg")),
                    ("gamma_deg", cell.get("gamma_deg")),
                    ("volume_A3", to_float(z["vol_A3"]) if z else None),
                    ("pld_A", pld), ("lcd_A", lcd),
                    ("lcd_along_path_A", to_float(z["LCD_along_path_A"]) if z else None),
                    ("qc_passed", to_bool(c["passed"])),
                    ("cif_path", cif_rel), ("cif_source_file", f"data/catalogue/cifs/{nm}.cif" if cif_rel else None),
                    ("geometry_provenance", "pormake_generated"),
                ])),
                ("qc", OrderedDict([
                    ("passed", to_bool(c["passed"])), ("reasons", split_reasons(c["qc_reasons"])),
                    ("min_distance_A", to_float(c["min_distance"])), ("n_overlaps", to_int(c["n_overlaps"])),
                    ("n_nonbonded_contacts", to_int(c["n_nonbonded_contacts"])),
                    ("n_components", to_int(c["n_components"])), ("n_bad_H", to_int(c["n_bad_H"])),
                    ("n_bad_C", to_int(c["n_bad_C"])), ("composition_ok", to_bool(c["composition_ok"])),
                    ("node_rmsd_A", to_float(c["node_rmsd_A"])),
                ])),
                ("prediction", None if p is None else OrderedDict([
                    ("target", "PBE_reference_band_gap"), ("mu_eV", to_float(p["mu"])),
                    ("sigma_seed_eV", to_float(p["sigma_seed"])), ("sigma_tree_eV", to_float(p["sigma_tree"])),
                    ("is_ood", to_bool(p["is_ood"])), ("ood_reasons", split_reasons(p["ood_reasons"])),
                    ("iteration", to_int(p["iteration"])),
                ])),
                ("dft", dft),
                ("dft_geometry", dft_geometry),
                ("al_history", history.get(nm, [])),
                ("provenance", OrderedDict([
                    ("catalogue", f"data/catalogue/passed.csv:{c['_row']}"),
                    ("zeopp", f"data/catalogue/zeopp.csv:{z['_row']}" if z else None),
                    ("prediction", f"data/al/iter{self.iteration}/predictions.csv:{p['_row']}" if p else None),
                ])),
            ])
            records.append(rec)
        dup_slugs = [s for s, n in slugs.items() if n > 1]
        if dup_slugs:
            raise SchemaError(f"slug collision(s): {dup_slugs}")
        if cif_missing:
            W(f"{len(cif_missing)} candidates have no CIF file: {cif_missing}")
        self.records = records
        self.report.update(n_catalogue=len(self.catalogue), n_passed=len(self.passed), n_pred=len(self.pred),
                           only_pred=only_pred, no_pred=no_pred, no_zeo=no_zeo, cif_missing=cif_missing,
                           n_dft_rows=len(self.dft_raw), n_variants=n_variants, unmatched_dft=unmatched,
                           n_dft_geometry=dft_geo)
        self.decisions += [
            "Primary key: exact candidate `name`; `slug` is a URL/file-safe copy (identical to `name` for this snapshot).",
            "Join: QC-passed catalogue (passed.csv) LEFT JOIN zeopp.csv, iteration predictions and DFT results on `name`.",
            "DFT status: label_ok=True -> accepted; label_ok=False -> rejected (shown as 'Not accepted / diagnostic'); "
            "no row -> not_available; several candidate runs or missing label_ok -> ambiguous.",
            "Accepted DFT gaps are exported in `dft.gap_eV`. For non-accepted runs any gap is exported only as "
            "`dft.diagnostic_gap_eV` and never displayed as a validated value.",
            "Displayed geometry is the PORMAKE-generated CIF for every candidate. For accepted labels, the DFT-relaxed "
            "geometry (static-run POSCAR chosen with the label_folder() rule of scripts/22_structure_figures.py) is "
            "exported separately and labelled 'DFT-relaxed'.",
            "Missing/NaN/inf values -> null. Booleans normalised from True/False strings.",
            "xTB results are NOT exported (different method; kept out of all PBE columns).",
        ]

    # ---- active learning bundle
    def build_al(self) -> Dict[str, Any]:
        W = self.warn
        dft_rows = [dict(name=r["name"], iteration=r["_iteration"], label_ok=r["_label_ok"], topology=r["topology"])
                    for r in self.dft_raw if r["name"] in {x["id"] for x in self.records}]
        iterations = []
        replay_ok = {}
        for k in range(0, self.iteration):
            rp = self.src(f"data/al/iter{k}/acquisition_ranking.csv")
            sp = self.src(f"data/al/iter{k}/selected_batch.csv")
            pp = self.src(f"data/al/iter{k}/predictions.csv")
            rj = self.src(f"data/al/iter{k}/selection_rules.json")
            if not (rp.exists() and sp.exists() and pp.exists()):
                W(f"iteration {k}: ranking/selection/predictions missing; replay not exported")
                continue
            rank_rows = read_csv(rp, "ranking")[0]
            sel_rows = sorted(read_csv(sp, "selected")[0], key=lambda r: to_int(r["selection_rank"]))
            pred_order = {r["name"]: i for i, r in enumerate(read_csv(pp, "predictions")[0])}
            if rj.exists():
                rules = json.loads(rj.read_text())
                rules_source = f"data/al/iter{k}/selection_rules.json"
            elif k == 0:
                rules = dict(ITER0_FALLBACK_RULES)
                rules_source = ("not recorded in the repository (no selection_rules.json); caps 3/2/3 and the two "
                                "closed-shell anchors are taken from the project notes and verified by exact replay")
                W("iteration 0: selection_rules.json absent; using documented fallback rules (verified by replay)")
            else:
                W(f"iteration {k}: selection_rules.json absent; replay not exported")
                continue
            n_topo = {t: int(v) for t, v in sorted((rules.get("n_topo_labels") or {}).items())}
            n_topo_dft = acq.n_topo_from_dft(dft_rows, before_iteration=k)
            if n_topo != n_topo_dft:
                W(f"iteration {k}: recorded N_topo {n_topo} differs from N_topo recomputed from the final "
                  f"dft_results.csv {n_topo_dft} (a label can be accepted after the selection was made); "
                  "the recorded value is used for the replay")
            pool = []
            for r in rank_rows:
                pool.append(OrderedDict([
                    ("id", r["name"]), ("topology", r["topology"]), ("metal", r["metal"]),
                    ("substituent", r["substituent"]), ("node_family", r["node_family"]),
                    ("n_atoms", to_int(r["n_atoms"])), ("mu", to_float(r["mu"])),
                    ("sigma_tree", to_float(r["sigma_tree"])), ("sigma_seed", to_float(r["sigma_seed"])),
                    ("is_ood", bool(to_bool(r["is_ood"]))), ("ood_reasons", split_reasons(r["ood_reasons"])),
                    ("ref_score", to_float(r["acquisition_score"]))]))
            pool.sort(key=lambda r: pred_order.get(r["id"], 10**9))  # original pool order (tie-break)
            sigma_key = "sigma_" + rules.get("sigma", "tree")
            ranked = acq.rank([dict(x, name=x["id"]) for x in pool], n_topo, rules["kappa"], rules["alpha"],
                              rules["beta"], sigma_key)
            maxdiff = max(abs(x["acquisition_score"] - x["ref_score"]) for x in ranked)
            order_ok = [x["id"] for x in ranked] == [r["name"] for r in rank_rows]
            batch = acq.select_batch(ranked, rules["n"], rules["max_per_topology"], rules["max_per_metal"],
                                     rules["max_per_substituent"], rules.get("forced") or [])
            ref_sel = [r["name"] for r in sel_rows]
            batch_ok = [b["name"] for b in batch] == ref_sel
            ties = acq.count_exact_ties([x["acquisition_score"] for x in ranked])
            replay_ok[k] = dict(max_abs_score_diff=maxdiff, ranking_order_matches=order_ok,
                                batch_matches=batch_ok, exact_ties=ties)
            if maxdiff > 1e-9 or not order_ok or not batch_ok:
                W(f"iteration {k}: replay mismatch (max score diff {maxdiff:.2e}, order {order_ok}, batch {batch_ok})")
            iterations.append(OrderedDict([
                ("iteration", k), ("mode", "replay"),
                ("description", f"Replay of the recorded iteration-{k} selection with the frozen iteration-{k} "
                                f"predictions (model trained before any iteration-{k} DFT result)."),
                ("rules", OrderedDict([
                    ("n", rules["n"]), ("kappa", rules["kappa"]), ("alpha", rules["alpha"]), ("beta", rules["beta"]),
                    ("sigma", sigma_key), ("max_per_topology", rules["max_per_topology"]),
                    ("max_per_metal", rules["max_per_metal"]), ("max_per_substituent", rules["max_per_substituent"]),
                    ("forced", rules.get("forced") or []), ("exclude_family", rules.get("exclude_family") or []),
                    ("exclude_combo", rules.get("exclude_combo") or []), ("max_atoms", rules.get("max_atoms"))])),
                ("rules_source", rules_source),
                ("n_topo", n_topo), ("n_topo_recomputed_from_final_dft", n_topo_dft),
                ("n_not_yet_computed", rules.get("n_not_yet_computed")), ("pool_is_prefiltered", True),
                ("pool", pool),
                ("reference_ranking", [r["name"] for r in rank_rows]),
                ("reference_selection", ref_sel),
                ("reference_sources", [f"data/al/iter{k}/acquisition_ranking.csv", f"data/al/iter{k}/selected_batch.csv"]),
                ("replay_check", replay_ok[k]),
            ]))

        # --- scenario on the frozen final predictions
        done = sorted({r["name"] for r in dft_rows})
        n_topo_final = acq.n_topo_from_dft(dft_rows)
        last_rules = iterations[-1]["rules"] if iterations else {}
        pool = []
        for r in self.pred:
            if r["name"] in done:
                continue
            pool.append(OrderedDict([
                ("id", r["name"]), ("topology", r["topology"]), ("metal", r["metal"]),
                ("substituent", r["substituent"]), ("node_family", r["node_family"]),
                ("n_atoms", to_int(r["n_atoms"])), ("mu", to_float(r["mu"])),
                ("sigma_tree", to_float(r["sigma_tree"])), ("sigma_seed", to_float(r["sigma_seed"])),
                ("is_ood", bool(to_bool(r["is_ood"]))), ("ood_reasons", split_reasons(r["ood_reasons"]))]))
        d = self.acq_defaults
        eligible = acq.apply_eligibility([dict(x, name=x["id"]) for x in pool], last_rules.get("exclude_family", []),
                                         last_rules.get("exclude_combo", []), last_rules.get("max_atoms"))
        ranked = acq.rank(eligible, n_topo_final, d["kappa"], d["alpha"], d["beta"], "sigma_tree")
        n_default = last_rules.get("n", 8)
        batch = acq.select_batch(ranked, n_default, d["max_per_topology"], d["max_per_metal"], d["max_per_substituent"])
        iterations.append(OrderedDict([
            ("iteration", self.iteration), ("mode", "scenario"),
            ("description", f"Scenario on the frozen iteration-{self.iteration} predictions (model trained with all "
                            "accepted labels). No iteration-3 batch was ever selected or computed in the study; "
                            "this is an exploration, not a recorded result."),
            ("rules", OrderedDict([
                ("n", n_default), ("kappa", d["kappa"]), ("alpha", d["alpha"]), ("beta", d["beta"]),
                ("sigma", "sigma_tree"), ("max_per_topology", d["max_per_topology"]),
                ("max_per_metal", d["max_per_metal"]), ("max_per_substituent", d["max_per_substituent"]),
                ("forced", []), ("exclude_family", last_rules.get("exclude_family", [])),
                ("exclude_combo", last_rules.get("exclude_combo", [])), ("max_atoms", last_rules.get("max_atoms"))])),
            ("rules_source", "weights and caps: defaults in src/mofal/acquisition.py; eligibility rules: latest "
                             f"recorded selection_rules.json (iteration {iterations[-1]['iteration'] if iterations else 'n/a'}); "
                             "all candidates already submitted to DFT are excluded, as in scripts/06_select_batch.py"),
            ("n_topo", n_topo_final), ("n_not_yet_computed", len(pool)), ("pool_is_prefiltered", False),
            ("excluded_already_computed", done),
            ("pool", pool),
            ("reference_ranking", [x["name"] for x in ranked]),
            ("reference_selection", [b["name"] for b in batch]),
            ("reference_scores", OrderedDict((x["name"], x["acquisition_score"]) for x in ranked)),
            ("reference_sources", ["computed by scripts/acquisition_ref.py at export time (Python reference)"]),
            ("replay_check", None),
        ]))
        self.report["replay"] = replay_ok
        al = OrderedDict([
            ("schema_version", SCHEMA_VERSION),
            ("equation", "score = mu - kappa*sigma_tree - alpha/max(1, N_topo) + beta*I_ood"),
            ("lower_is_better", True),
            ("code_defaults", OrderedDict(sorted(d.items()))),
            ("code_defaults_source", "src/mofal/acquisition.py (KAPPA, ALPHA, BETA, MAX_PER_*)"),
            ("tie_break", "stable: equal scores keep the original pool order (predictions.csv row order)"),
            ("iterations", iterations),
        ])
        return al

    # ---- write
    def write(self) -> Dict[str, Any]:
        self.out.mkdir(parents=True, exist_ok=True)
        al = self.build_al()
        cand = OrderedDict([("schema_version", SCHEMA_VERSION), ("source_iteration", self.iteration),
                            ("records", self.records)])

        def dump(obj, path: Path, indent=None):
            txt = json.dumps(obj, allow_nan=False, ensure_ascii=False, indent=indent,
                             separators=(",", ":") if indent is None else (",", ": "))
            path.write_text(txt + "\n", encoding="utf-8")
        dump(cand, self.out / "candidates.json")
        dump(al, self.out / "active-learning.json")
        (self.out / "DATA_README.txt").write_text(DATA_README, encoding="utf-8")

        sha, date = git_info(self.source)
        commit = self.source_commit or sha
        if not commit:
            combined = hashlib.sha256("".join(self.checksums.values()).encode()).hexdigest()
            commit = f"snapshot-sha256:{combined[:16]}"
            self.warn("source is not a git checkout; snapshot identified by a hash of the source files")
        recs = self.records
        n_status = Counter(r["dft"]["status"] for r in recs)
        per_iter: Dict[int, Counter] = {}
        for r in recs:
            if r["dft"]["status"] != "not_available":
                per_iter.setdefault(r["dft"]["iteration"], Counter())[r["dft"]["status"]] += 1
        context = []
        for row in self.hse_by_shell:
            if row.get("shell", "").startswith("open-shell"):
                context.append(OrderedDict([
                    ("id", "qmof_pbe_vs_hse06_open_shell"),
                    ("text", "In the repository's analysis of QMOF entries with both PBE and HSE06 gaps, "
                             f"{to_float(row['pct_PBE_lt_1_with_HSE_lt_1']):.1f}% of open-shell 3d (Ti-Cu) MOFs with a PBE gap "
                             f"< 1 eV (n = {to_int(row['n_PBE_lt_1'])}) also have an HSE06 gap < 1 eV; median HSE06 - PBE = "
                             f"{to_float(row['median_HSE06_minus_PBE']):.2f} eV."),
                    ("source", "results/qmof_pbe_vs_hse06/by_shell.csv (summary statistics derived from QMOF; "
                               "QMOF data are not redistributed)")]))
        output_files = sorted(p for p in self.out.rglob("*") if p.is_file() and p.name != "release-manifest.json")
        manifest = OrderedDict([
            ("app_release", APP_RELEASE),
            ("schema_version", SCHEMA_VERSION),
            ("export_script_version", EXPORT_SCRIPT_VERSION),
            ("export_timestamp_utc", self.timestamp or _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")),
            ("source_repository_url", SOURCE_REPOSITORY_URL),
            ("source_commit_hash", commit),
            ("source_commit_date", date),
            ("source_iteration", self.iteration),
            ("model_info", OrderedDict((k, self.model_info.get(k)) for k in
                                       ["n_qmof", "n_dft", "seeds", "et_params", "features", "sklearn"] if k in self.model_info)),
            ("record_count", len(recs)),
            ("catalogue_enumerated", len(self.catalogue)),
            ("records_with_cif", sum(1 for r in recs if r["structure"]["cif_path"])),
            ("records_with_prediction", sum(1 for r in recs if r["prediction"])),
            ("records_with_dft_run", sum(1 for r in recs if r["dft"]["status"] != "not_available")),
            ("records_with_accepted_dft", n_status.get("accepted", 0)),
            ("records_with_rejected_dft", n_status.get("rejected", 0)),
            ("records_with_ambiguous_dft", n_status.get("ambiguous", 0)),
            ("records_with_dft_geometry", sum(1 for r in recs if r["dft_geometry"])),
            ("records_ood", sum(1 for r in recs if r["prediction"] and r["prediction"]["is_ood"])),
            ("dft_rows_in_source", len(self.dft_raw)),
            ("dft_sensitivity_runs", self.report["n_variants"]),
            ("dft_by_iteration", OrderedDict((str(k), OrderedDict(sorted(v.items()))) for k, v in sorted(per_iter.items()))),
            ("active_learning_replay", OrderedDict((str(k), v) for k, v in self.report.get("replay", {}).items())),
            ("context_statistics", context),
            ("licenses_and_attributions", self.licences()),
            ("citation_status", "Research code and data accompanying a manuscript in preparation; publication status "
                                "and DOI to be confirmed. Cite the repository (CITATION.cff) until a DOI exists."),
            ("source_checksums_sha256", OrderedDict(sorted(self.checksums.items()))),
            ("output_checksums_sha256", OrderedDict((str(p.relative_to(self.out)), sha256(p)) for p in output_files)),
            ("decisions", self.decisions),
            ("warnings", self.warnings),
        ])
        dump(manifest, self.out / "release-manifest.json", indent=2)
        if self.docs:
            self.docs.mkdir(parents=True, exist_ok=True)
            (self.docs / "DATA_PROVENANCE.md").write_text(self.provenance_md(manifest, al), encoding="utf-8")
        return manifest

    def provenance_md(self, m: Dict[str, Any], al: Dict[str, Any]) -> str:
        R = self.report
        L = [
            "# Data provenance report",
            "",
            "_Generated by `scripts/export_research_data.py`; do not edit by hand._",
            "",
            "| Item | Value |", "|---|---|",
            f"| Source repository | {m['source_repository_url']} |",
            f"| Source commit | `{m['source_commit_hash']}` ({m['source_commit_date']}) |",
            f"| Prediction iteration | {m['source_iteration']} |",
            f"| Export script version | {m['export_script_version']} |",
            f"| Schema version | {m['schema_version']} |",
            f"| Export timestamp (UTC) | {m['export_timestamp_utc']} |",
            "",
            "## Row counts", "",
            "| Table | Rows |", "|---|---|",
            f"| `data/catalogue/catalogue.csv` (enumerated) | {R['n_catalogue']} |",
            f"| `data/catalogue/passed.csv` (QC-passed, exported) | {R['n_passed']} |",
            f"| `data/al/iter{self.iteration}/predictions.csv` | {R['n_pred']} |",
            f"| `data/dft/dft_results.csv` (all runs) | {R['n_dft_rows']} |",
            f"| of which spin-state sensitivity runs | {R['n_variants']} |",
            "",
            "## Exported records", "",
            "| Count | Value |", "|---|---|",
        ]
        for k in ["record_count", "records_with_cif", "records_with_prediction", "records_with_dft_run",
                  "records_with_accepted_dft", "records_with_rejected_dft", "records_with_ambiguous_dft",
                  "records_with_dft_geometry", "records_ood"]:
            L.append(f"| `{k}` | {m[k]} |")
        L += ["", "DFT runs per iteration (candidate runs only):", "", "| Iteration | accepted | rejected | ambiguous |", "|---|---|---|---|"]
        for k, v in m["dft_by_iteration"].items():
            L.append(f"| {k} | {v.get('accepted', 0)} | {v.get('rejected', 0)} | {v.get('ambiguous', 0)} |")
        L += ["", "## Key reconciliation", "",
              f"- Prediction rows without a QC-passed entry: {R['only_pred'] or 'none'}",
              f"- QC-passed candidates without prediction: {R['no_pred'] or 'none'}",
              f"- QC-passed candidates without Zeo++ row: {R['no_zeo'] or 'none'}",
              f"- Candidates without CIF: {R['cif_missing'] or 'none'}",
              f"- DFT rows matching no candidate: {R['unmatched_dft'] or 'none'}",
              f"- Accepted labels with exported DFT-relaxed geometry: {R['n_dft_geometry']}",
              "", "## Active-learning replay against recorded outputs", "",
              "| Iteration | max abs score diff | ranking order matches | batch matches | exact ties | rules source |",
              "|---|---|---|---|---|---|"]
        for it in al["iterations"]:
            if it["mode"] != "replay":
                continue
            c = it["replay_check"]
            L.append(f"| {it['iteration']} | {c['max_abs_score_diff']:.1e} | {c['ranking_order_matches']} | "
                     f"{c['batch_matches']} | {c['exact_ties']} | {it['rules_source']} |")
        L += ["", "## Processing decisions", ""] + [f"- {d}" for d in m["decisions"]]
        L += ["", "## Warnings", ""] + ([f"- {w}" for w in m["warnings"]] or ["- none"])
        L += ["", "## Source checksums (SHA-256)", "", "| File | SHA-256 |", "|---|---|"]
        L += [f"| `{k}` | `{v[:16]}…` |" for k, v in m["source_checksums_sha256"].items() if not k.startswith("runs/")]
        n_runs = sum(1 for k in m["source_checksums_sha256"] if k.startswith("runs/"))
        L += ["", f"Plus {n_runs} DFT POSCAR files under `runs/` (full hashes in `release-manifest.json`).", ""]
        return "\n".join(L)


DATA_README = """MOF Discovery Studio - data dictionary
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
"""


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", required=True, type=Path, help="path to the MOF_3D_Generator checkout (read-only)")
    ap.add_argument("--out", default=Path("public/data"), type=Path)
    ap.add_argument("--docs", default=Path("docs"), type=Path)
    ap.add_argument("--iteration", default=3, type=int, help="frozen prediction iteration (default 3)")
    ap.add_argument("--source-commit", default=None)
    ap.add_argument("--timestamp", default=os.environ.get("EXPORT_TIMESTAMP"),
                    help="fixed export timestamp for reproducible manifests (or env EXPORT_TIMESTAMP)")
    a = ap.parse_args(argv)
    source = a.source.resolve()
    out = a.out.resolve()
    if out == source or source in out.parents:
        print("refusing to write inside the source repository", file=sys.stderr)
        return 2
    # Clean only what this exporter owns.
    for p in ["structures", "candidates.json", "active-learning.json", "release-manifest.json", "DATA_README.txt"]:
        q = out / p
        if q.is_dir():
            shutil.rmtree(q)
        elif q.exists():
            q.unlink()
    ex = Exporter(source, out, a.docs.resolve() if a.docs else None, a.iteration, a.source_commit, a.timestamp)
    try:
        ex.load()
        ex.build()
        m = ex.write()
    except SchemaError as e:
        print(f"SCHEMA ERROR: {e}", file=sys.stderr)
        return 1
    print(f"exported {m['record_count']} records ({m['records_with_cif']} CIFs, "
          f"{m['records_with_accepted_dft']} accepted DFT labels, {m['records_with_dft_geometry']} DFT geometries) "
          f"from {m['source_commit_hash']}")
    for w in m["warnings"]:
        print("WARNING:", w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
