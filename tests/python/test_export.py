"""Tests for the research-data exporter and the Python acquisition reference.

Real-data tests need a checkout of MOF_3D_Generator; set MOF_SOURCE or place it next to this
app (../MOF_3D_Generator). They are skipped otherwise. Synthetic tests always run.
"""
from __future__ import annotations

import csv
import json
import os
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP / "scripts"))
import acquisition_ref as acq  # noqa: E402
import export_research_data as ex  # noqa: E402
import validate_export as val  # noqa: E402

SOURCE = Path(os.environ.get("MOF_SOURCE", APP.parent / "MOF_3D_Generator"))
HAVE_SOURCE = (SOURCE / "data/catalogue/passed.csv").is_file()
real = pytest.mark.skipif(not HAVE_SOURCE, reason="MOF_3D_Generator checkout not available")


# ----------------------------------------------------------------------------- helpers
def test_to_bool():
    assert ex.to_bool("True") is True and ex.to_bool("false") is False
    assert ex.to_bool("") is None and ex.to_bool("nan") is None
    with pytest.raises(ex.SchemaError):
        ex.to_bool("maybe")


def test_to_float_rejects_nonfinite():
    assert ex.to_float("1.5") == 1.5
    for v in ["", "nan", "NaN", "inf", "-inf", None]:
        assert ex.to_float(v) is None
    with pytest.raises(ex.SchemaError):
        ex.to_float("abc")


def test_split_reasons_and_slug():
    assert ex.split_reasons("a; b;;c") == ["a", "b", "c"]
    assert ex.split_reasons(None) == []
    assert ex.slugify("pcu__Zn-N16__short-H") == "pcu__Zn-N16__short-H"
    assert ex.slugify("odd name/(x)") == "odd-name-x"
    with pytest.raises(ex.SchemaError):
        ex.slugify("///")


def test_parse_cif_cell():
    txt = "_cell_length_a 10.0\n_cell_length_b 11\n_cell_length_c 12.5\n_cell_angle_alpha 90\n" \
          "_cell_angle_beta 91.5\n_cell_angle_gamma 120\n"
    c = ex.parse_cif_cell(txt)
    assert c == {"a_A": 10.0, "b_A": 11.0, "c_A": 12.5, "alpha_deg": 90.0, "beta_deg": 91.5, "gamma_deg": 120.0}


# ----------------------------------------------------------------------------- acquisition
POOL = [
    dict(name="A", topology="pcu", metal="Zn", substituent="H", mu=1.0, sigma_tree=0.2, is_ood=False),
    dict(name="B", topology="pcu", metal="Co", substituent="H", mu=0.5, sigma_tree=0.1, is_ood=True),
    dict(name="C", topology="cds", metal="Co", substituent="F4", mu=0.6, sigma_tree=0.3, is_ood=False),
    dict(name="D", topology="cds", metal="Co", substituent="F4", mu=0.7, sigma_tree=0.3, is_ood=False),
    dict(name="E", topology="bcu", metal="Fe", substituent="H", mu=0.6, sigma_tree=0.3, is_ood=False),
]


def test_score_formula():
    r = POOL[1]
    s = acq.acquisition_score(r, {"pcu": 2}, 1.0, 0.3, 0.5)
    assert s == pytest.approx(0.5 - 0.1 - 0.3 / 2 + 0.5)
    # N_topo = 0 -> max(1, 0) = 1
    assert acq.acquisition_score(r, {}, 1.0, 0.3, 0.5) == pytest.approx(0.5 - 0.1 - 0.3 + 0.5)


def test_rank_is_stable_on_ties():
    ranked = acq.rank(POOL, {}, 1.0, 0.3, 0.5)
    # C and E have identical inputs except topology (both novelty 1): tie broken by pool order
    names = [r["name"] for r in ranked]
    assert names.index("C") < names.index("E")


def test_caps_and_forced():
    ranked = acq.rank(POOL, {}, 1.0, 0.3, 0.5)
    b = acq.select_batch(ranked, 5, max_per_topology=1, max_per_metal=1, max_per_substituent=5)
    topos = [r["topology"] for r in b]
    metals = [r["metal"] for r in b]
    assert len(set(topos)) == len(topos) and len(set(metals)) == len(metals)
    # forced candidate is taken first and counts toward caps
    b2 = acq.select_batch(ranked, 2, 1, 2, 5, forced=["A"])
    assert b2[0]["name"] == "A" and b2[0]["forced"] is True
    assert all(r["topology"] != "pcu" for r in b2[1:])
    # unknown forced names are ignored, as in the original implementation
    assert acq.select_batch(ranked, 1, 2, 2, 3, forced=["ZZZ"])[0]["name"] == ranked[0]["name"]


def test_batch_cannot_be_filled():
    ranked = acq.rank(POOL, {}, 1.0, 0.3, 0.5)
    b = acq.select_batch(ranked, 10, 1, 1, 1)
    assert len(b) < 10


def test_eligibility():
    pool = [dict(name="x", node_family="M3(CO2)6", topology="pcu", metal="Mn", n_atoms=50),
            dict(name="y", node_family="P", topology="cds", metal="Zn", n_atoms=50),
            dict(name="z", node_family="P", topology="cds", metal="Co", n_atoms=500)]
    out = acq.apply_eligibility(pool, ["M3(CO2)6"], ["P:cds:Zn"], 160)
    assert out == []


# ----------------------------------------------------------------------------- synthetic source
PASSED_COLS = ex.REQUIRED_COLUMNS["passed"]


def _write_csv(path: Path, header, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=header)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in header})


CIF = """data_x
_cell_length_a 10
_cell_length_b 10
_cell_length_c 10
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Zn1 Zn 0 0 0
O1 O 0.5 0.5 0.5
"""


def make_source(tmp: Path, dft_rows=None, drop_cif=None, pred_override=None):
    names = ["pcu__Zn-N1__short-H", "cds__Co-N2__short-F4", "cds__Cu-N3__long-H"]
    base = dict(node_family="F", node_id="N1", metal="Zn", metal_ox_state="2", d_electrons="10",
                open_shell="False", node_desc="d", linker_label="short-H", edge_id="E1", linker_family="BDC",
                n_rings="1", substituent="H", linker_desc="BDC", node_rmsd_A="0.1", built="True",
                formula="ZnO", n_atoms="2", density="1.0", a="10", b="10", c="10", min_distance="1.1",
                n_overlaps="0", n_nonbonded_contacts="0", n_components="1", n_bad_H="0", n_bad_C="0",
                composition_ok="True", passed="True", qc_reasons="")
    rows = []
    for i, n in enumerate(names):
        r = dict(base, name=n, topology=n.split("__")[0])
        rows.append(r)
    _write_csv(tmp / "data/catalogue/passed.csv", PASSED_COLS, rows)
    _write_csv(tmp / "data/catalogue/catalogue.csv", PASSED_COLS, rows)
    _write_csv(tmp / "data/catalogue/zeopp.csv", ["name", "LCD_A", "PLD_A", "LCD_along_path_A", "vol_A3"],
               [dict(name=n, LCD_A="5", PLD_A="4", LCD_along_path_A="5", vol_A3="1000") for n in names])
    pcols = ex.REQUIRED_COLUMNS["predictions"]
    preds = [dict(name=n, topology=n.split("__")[0], metal="Zn", substituent="H", node_family="F", n_atoms="2",
                  density="1.0", PLD_A="4", LCD_A="5", mu=str(0.5 + i), sigma_seed="0.01", sigma_tree="0.3",
                  is_ood="False", ood_reasons="", iteration="0") for i, n in enumerate(names)]
    if pred_override:
        pred_override(preds)
    _write_csv(tmp / "data/al/iter0/predictions.csv", pcols, preds)
    dcols = ex.REQUIRED_COLUMNS["dft"] + ["relax_scf_checked_by_static", "spin_solutions_unconverged"]
    _write_csv(tmp / "data/dft/dft_results.csv", dcols, dft_rows or [])
    for n in names:
        if n != drop_cif:
            (tmp / "data/catalogue/cifs").mkdir(parents=True, exist_ok=True)
            (tmp / "data/catalogue/cifs" / f"{n}.cif").write_text(CIF)
    (tmp / "src/mofal").mkdir(parents=True, exist_ok=True)
    (tmp / "src/mofal/acquisition.py").write_text(
        "KAPPA, ALPHA, BETA = 1.0, 0.3, 0.5\nMAX_PER_TOPOLOGY, MAX_PER_METAL, MAX_PER_SUBSTITUENT = 2, 2, 3\n")
    (tmp / "LICENSE").write_text("MIT License\n\nCopyright (c) 2026 Test\n")
    (tmp / "README.md").write_text("Code: MIT. Data produced in this work: CC-BY-4.0.\n")
    return names


def run_export(src: Path, out: Path):
    rc = ex.main(["--source", str(src), "--out", str(out), "--docs", str(out.parent / "docs"),
                  "--iteration", "0", "--timestamp", "2026-01-01T00:00:00Z", "--source-commit", "test"])
    return rc


def dft_row(name, **kw):
    r = dict(name=name, iteration="0", gap_eV="0.5", label_ok="True", label_reasons="", relax_converged_ionic="True",
             relax_converged_electronic="True", relax_stopped="False", relax_fmax_final="0.03",
             static_converged_electronic="True", final_qc_passed="True", final_qc_reasons="",
             topology=name.split("__")[0], spin_solution="", spin_solutions_gap_range_eV="",
             vol_change_pct="1", max_angle_change_deg="0.5")
    r.update(kw)
    return r


def test_synthetic_export_statuses(tmp_path):
    src = tmp_path / "src"
    names = make_source(src, dft_rows=[
        dft_row("pcu__Zn-N1__short-H"),
        dft_row("cds__Co-N2__short-F4", label_ok="False", gap_eV="0.02", label_reasons="relaxation not converged"),
        dft_row("cds__Co-N2__short-F4__afm", label_ok="False", gap_eV="0.1",
                label_reasons="spin-state sensitivity run (not a training label)"),
    ], drop_cif="cds__Cu-N3__long-H")
    out = tmp_path / "out"
    assert run_export(src, out) == 0
    data = json.loads((out / "candidates.json").read_text())
    by = {r["id"]: r for r in data["records"]}
    assert set(by) == set(names)
    acc, rej, na = by[names[0]]["dft"], by[names[1]]["dft"], by[names[2]]["dft"]
    assert acc["status"] == "accepted" and acc["gap_eV"] == 0.5
    # label_ok=False is never validated: gap only as diagnostic
    assert rej["status"] == "rejected" and rej["gap_eV"] is None and rej["diagnostic_gap_eV"] == 0.02
    assert rej["sensitivity_runs"][0]["run"] == "cds__Co-N2__short-F4__afm"
    assert na == {"status": "not_available"}
    # missing CIF is reported, not invented
    assert by[names[2]]["structure"]["cif_path"] is None
    m = json.loads((out / "release-manifest.json").read_text())
    assert m["records_with_cif"] == 2 and m["records_with_accepted_dft"] == 1
    assert any("no CIF" in w for w in m["warnings"])
    assert val.validate(out) == []


def test_duplicate_dft_rows_are_ambiguous(tmp_path):
    src = tmp_path / "src"
    names = make_source(src, dft_rows=[dft_row("pcu__Zn-N1__short-H"),
                                       dft_row("pcu__Zn-N1__short-H", iteration="1", gap_eV="0.7")])
    out = tmp_path / "out"
    assert run_export(src, out) == 0
    rec = {r["id"]: r for r in json.loads((out / "candidates.json").read_text())["records"]}[names[0]]
    assert rec["dft"]["status"] == "ambiguous" and rec["dft"]["gap_eV"] is None
    assert len(rec["dft"]["source_rows"]) == 2


def test_inf_and_nan_become_null(tmp_path):
    src = tmp_path / "src"

    def bad(preds):
        preds[0]["sigma_seed"] = "inf"
        preds[1]["PLD_A"] = "nan"
    make_source(src, pred_override=bad)
    out = tmp_path / "out"
    assert run_export(src, out) == 0
    txt = (out / "candidates.json").read_text()
    assert "NaN" not in txt and "Infinity" not in txt
    recs = json.loads(txt)["records"]
    by = {r["id"]: r for r in recs}
    assert by["pcu__Zn-N1__short-H"]["prediction"]["sigma_seed_eV"] is None
    assert by["cds__Co-N2__short-F4"]["structure"]["pld_A"] is None


def test_missing_column_is_schema_error(tmp_path):
    src = tmp_path / "src"
    make_source(src)
    p = src / "data/catalogue/zeopp.csv"
    p.write_text("name,LCD_A\nx,1\n")
    assert run_export(src, tmp_path / "out") == 1


def test_refuses_to_write_inside_source(tmp_path):
    src = tmp_path / "src"
    make_source(src)
    assert ex.main(["--source", str(src), "--out", str(src / "public")]) == 2


# ----------------------------------------------------------------------------- real data
@pytest.fixture(scope="module")
def real_export(tmp_path_factory):
    out = tmp_path_factory.mktemp("real") / "data"
    rc = ex.main(["--source", str(SOURCE), "--out", str(out), "--docs", str(out.parent / "docs"),
                  "--timestamp", "2026-01-01T00:00:00Z"])
    assert rc == 0
    return out


@real
def test_real_export_counts(real_export):
    m = json.loads((real_export / "release-manifest.json").read_text())
    recs = json.loads((real_export / "candidates.json").read_text())["records"]
    # counts come from the data; check internal consistency rather than hard-coded study numbers
    with open(SOURCE / "data/catalogue/passed.csv") as f:
        n_passed = sum(1 for _ in csv.DictReader(f))
    assert m["record_count"] == len(recs) == n_passed
    with open(SOURCE / "data/dft/dft_results.csv") as f:
        accepted = {r["name"] for r in csv.DictReader(f) if r["label_ok"] == "True"}
    assert {r["id"] for r in recs if r["dft"]["status"] == "accepted"} == accepted
    assert val.validate(real_export) == []


@real
def test_real_replay_reproduces_recorded_batches(real_export):
    al = json.loads((real_export / "active-learning.json").read_text())
    replays = [it for it in al["iterations"] if it["mode"] == "replay"]
    assert replays, "no replay iterations exported"
    for it in replays:
        assert it["replay_check"]["batch_matches"], it["iteration"]
        assert it["replay_check"]["ranking_order_matches"], it["iteration"]
        assert it["replay_check"]["max_abs_score_diff"] < 1e-12


@real
def test_real_export_is_deterministic(real_export, tmp_path):
    out2 = tmp_path / "data"
    assert ex.main(["--source", str(SOURCE), "--out", str(out2), "--docs", str(tmp_path / "docs"),
                    "--timestamp", "2026-01-01T00:00:00Z"]) == 0
    for f in ["candidates.json", "active-learning.json", "release-manifest.json"]:
        assert (real_export / f).read_bytes() == (out2 / f).read_bytes(), f


@real
def test_real_matches_original_pandas_implementation(real_export):
    """Cross-check the scenario ranking against the ORIGINAL src/mofal/acquisition.py (read-only import)."""
    pd = pytest.importorskip("pandas")
    sys.path.insert(0, str(SOURCE / "src"))
    try:
        from mofal.acquisition import acquisition_score, select_batch  # type: ignore
    finally:
        sys.path.pop(0)
    al = json.loads((real_export / "active-learning.json").read_text())
    sc = [it for it in al["iterations"] if it["mode"] == "scenario"][0]
    r = sc["rules"]
    df = pd.DataFrame(sc["pool"]).rename(columns={"id": "name"})
    df = df[~df.node_family.isin(r["exclude_family"])]
    for combo in r["exclude_combo"]:
        fam, topo, metal = combo.split(":")
        df = df[~((df.node_family == fam) & (df.topology == topo) & (df.metal == metal))]
    if r["max_atoms"]:
        df = df[df.n_atoms <= r["max_atoms"]]
    df = df.copy()
    df["acquisition_score"] = acquisition_score(df, sc["n_topo"], kappa=r["kappa"], alpha=r["alpha"], beta=r["beta"])
    for name, s in df.set_index("name").acquisition_score.items():
        assert abs(sc["reference_scores"][name] - s) < 1e-12
    b = select_batch(df, r["n"], r["max_per_topology"], r["max_per_metal"],
                     max_per_substituent=r["max_per_substituent"])
    assert list(b.name) == sc["reference_selection"]


@real
def test_source_repository_untouched():
    import subprocess
    if not (SOURCE / ".git").exists():
        pytest.skip("source is not a git checkout")
    out = subprocess.check_output(["git", "-C", str(SOURCE), "status", "--porcelain"], text=True)
    assert out.strip() == "", f"source repository modified:\n{out}"


@real
def test_real_electronic_and_campaign(real_export):
    recs = json.loads((real_export / "candidates.json").read_text())["records"]
    acc = [r for r in recs if r["dft"]["status"] == "accepted"]
    assert all(r["electronic"] is not None for r in acc)
    assert all(r["electronic"] is None for r in recs if r["dft"]["status"] != "accepted")
    for r in acc:
        for side in ("vb", "cb"):
            assert abs(sum(r["electronic"][side].values()) - 1) < 0.02
    assert all(r["dft_last_geometry"] is None for r in acc)
    camp = json.loads((real_export / "campaign.json").read_text())
    assert sum(i["accepted"] for i in camp["iterations"]) == len(acc)
    assert {f["id"] for f in camp["failures"]} == {r["id"] for r in recs if r["dft"]["status"] in ("rejected", "ambiguous")}
    retro = json.loads((real_export / "retro-al.json").read_text())
    labels = [p["labels"] for p in retro["curves"]["paper"]]
    assert labels == sorted(labels) and 27 in labels
