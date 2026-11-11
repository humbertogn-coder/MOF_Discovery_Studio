#!/usr/bin/env python3
"""Validate a MOF Discovery Studio data bundle (public/data) without the source repository.

    python scripts/validate_export.py [public/data]

Exit code 0 if valid, 1 otherwise. Standard library only.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

SLUG_RE = re.compile(r"^[A-Za-z0-9_-]+$")
DFT_STATUS = {"accepted", "rejected", "not_available", "ambiguous"}
FORBIDDEN = re.compile(r"(POTCAR|WAVECAR|CHGCAR|OUTCAR|vasprun|qmof|\.pkl$|\.joblib$|\.docx$)", re.I)


def strict_load(path: Path):
    def bad_constant(c):
        raise ValueError(f"{path}: non-standard JSON constant {c}")
    return json.loads(path.read_text(encoding="utf-8"), parse_constant=bad_constant)


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def validate(root: Path) -> list:
    errors = []
    E = errors.append
    for f in ["release-manifest.json", "candidates.json", "active-learning.json", "DATA_README.txt"]:
        if not (root / f).is_file():
            E(f"missing {f}")
    if errors:
        return errors
    m = strict_load(root / "release-manifest.json")
    c = strict_load(root / "candidates.json")
    al = strict_load(root / "active-learning.json")
    recs = c["records"]

    for p in root.rglob("*"):
        if p.is_file() and FORBIDDEN.search(p.name):
            E(f"forbidden/restricted file in bundle: {p.relative_to(root)}")

    ids = [r["id"] for r in recs]
    if len(set(ids)) != len(ids):
        E("duplicate candidate ids")
    slugs = [r["slug"] for r in recs]
    if len(set(slugs)) != len(slugs):
        E("duplicate slugs")
    for r in recs:
        rid = r["id"]
        if not SLUG_RE.match(r["slug"]):
            E(f"{rid}: unsafe slug {r['slug']!r}")
        s = r["structure"]
        for key in ["cif_path"]:
            v = s.get(key)
            if v is not None:
                if ".." in v or v.startswith("/") or not v.startswith("structures/"):
                    E(f"{rid}: unsafe path {v!r}")
                elif not (root / v).is_file():
                    E(f"{rid}: referenced file missing {v}")
                else:
                    txt = (root / v).read_text(encoding="utf-8", errors="replace")
                    if "_cell_length_a" not in txt or "_atom_site_fract_x" not in txt:
                        E(f"{rid}: CIF lacks cell or fractional coordinates")
        if s.get("geometry_provenance") != "pormake_generated":
            E(f"{rid}: CIF geometry provenance must be pormake_generated")
        g = r.get("dft_geometry")
        if g:
            if g.get("geometry_provenance") != "dft_relaxed" or not (root / g["path"]).is_file():
                E(f"{rid}: invalid dft_geometry")
            if r["dft"]["status"] != "accepted":
                E(f"{rid}: DFT-relaxed geometry exported for a non-accepted label")
        for num_key in ["density_g_cm3", "pld_A", "lcd_A", "a_A", "b_A", "c_A"]:
            v = s.get(num_key)
            if v is not None and not isinstance(v, (int, float)):
                E(f"{rid}: {num_key} not numeric")
            if v is not None and v <= 0:
                E(f"{rid}: {num_key} must be positive (got {v}); missing values must be null")
        d = r["dft"]
        if d["status"] not in DFT_STATUS:
            E(f"{rid}: invalid dft.status {d['status']}")
        if d["status"] == "accepted" and d.get("gap_eV") is None:
            E(f"{rid}: accepted DFT label without gap")
        if d["status"] != "accepted" and d.get("gap_eV") is not None:
            E(f"{rid}: non-accepted DFT run exposes gap_eV (must use diagnostic_gap_eV)")
        p = r.get("prediction")
        if p:
            if p["target"] != "PBE_reference_band_gap":
                E(f"{rid}: unexpected prediction target")
            for k in ["mu_eV", "sigma_tree_eV", "sigma_seed_eV"]:
                if p[k] is not None and not isinstance(p[k], (int, float)):
                    E(f"{rid}: {k} not numeric")
            if p["is_ood"] and not p["ood_reasons"]:
                E(f"{rid}: OOD flag without reasons")

    # manifest consistency
    checks = {
        "record_count": len(recs),
        "records_with_cif": sum(1 for r in recs if r["structure"]["cif_path"]),
        "records_with_prediction": sum(1 for r in recs if r["prediction"]),
        "records_with_accepted_dft": sum(1 for r in recs if r["dft"]["status"] == "accepted"),
        "records_with_dft_geometry": sum(1 for r in recs if r["dft_geometry"]),
    }
    for k, v in checks.items():
        if m.get(k) != v:
            E(f"manifest {k}={m.get(k)} but data gives {v}")
    for rel, h in m.get("output_checksums_sha256", {}).items():
        p = root / rel
        if not p.is_file():
            E(f"manifest lists missing output {rel}")
        elif sha256(p) != h:
            E(f"checksum mismatch for {rel}")
    for f in ["source_commit_hash", "source_repository_url", "export_script_version", "schema_version",
              "licenses_and_attributions", "export_timestamp_utc"]:
        if not m.get(f):
            E(f"manifest field {f} empty")

    # AL bundle
    id_set = set(ids)
    for it in al["iterations"]:
        for row in it["pool"]:
            if row["id"] not in id_set:
                E(f"AL iteration {it['iteration']}: pool id {row['id']} not in candidates")
            for k in ["mu", "sigma_tree"]:
                if not isinstance(row[k], (int, float)):
                    E(f"AL iteration {it['iteration']}: {row['id']} {k} missing")
        if it["mode"] == "replay":
            chk = it["replay_check"]
            if not (chk["batch_matches"] and chk["ranking_order_matches"] and chk["max_abs_score_diff"] < 1e-9):
                E(f"AL iteration {it['iteration']}: replay does not reproduce the recorded outputs")
    return errors


def main(argv=None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    root = Path(argv[0] if argv else "public/data")
    errs = validate(root)
    if errs:
        for e in errs:
            print("ERROR:", e)
        print(f"{len(errs)} error(s)")
        return 1
    m = json.loads((root / "release-manifest.json").read_text())
    print(f"OK: {m['record_count']} records, schema {m['schema_version']}, source {m['source_commit_hash'][:12]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
