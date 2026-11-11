"""Dependency-free re-implementation of ``src/mofal/acquisition.py`` (MOF_3D_Generator).

This module is the Python reference used by the exporter and by the regression tests.
It mirrors the original pandas implementation line by line:

    score(x) = mu(x) - kappa*sigma(x) - alpha / max(1, N_topo(x)) + beta * I_ood(x)

Lower is better. ``N_topo`` counts accepted DFT labels in the topology of x.
``select_batch`` walks the ranking (ascending score) and enforces per-batch caps on
topology, metal and substituent; ``forced`` names are taken first (if present in the
pool) and count toward the caps without being checked against them.

Intentional, documented difference: the original uses ``DataFrame.sort_values`` with the
default (non-stable) quicksort. Here ties are broken by the original pool row order
(stable sort). The exporter reports whether exact score ties exist in the data; for the
frozen snapshot there are none, so the two orderings are identical.
"""
from __future__ import annotations

from collections import Counter
from typing import Dict, Iterable, List, Mapping, Optional, Sequence


def novelty(topology: str, n_topo: Mapping[str, int]) -> float:
    return 1.0 / max(1, int(n_topo.get(topology, 0)))


def acquisition_score(row: Mapping, n_topo: Mapping[str, int], kappa: float, alpha: float,
                      beta: float, sigma_key: str = "sigma_tree") -> float:
    # Same operation order as the pandas expression in the original module.
    return (row["mu"] - kappa * row[sigma_key] - alpha * novelty(row["topology"], n_topo)
            + beta * (1.0 if row["is_ood"] else 0.0))


def rank(pool: Sequence[Mapping], n_topo: Mapping[str, int], kappa: float, alpha: float,
         beta: float, sigma_key: str = "sigma_tree") -> List[dict]:
    scored = []
    for i, r in enumerate(pool):
        d = dict(r)
        d["acquisition_score"] = acquisition_score(r, n_topo, kappa, alpha, beta, sigma_key)
        d["_order"] = i
        scored.append(d)
    scored.sort(key=lambda d: (d["acquisition_score"], d["_order"]))
    return scored


def select_batch(ranked: Sequence[Mapping], n: int, max_per_topology: int, max_per_metal: int,
                 max_per_substituent: int, forced: Optional[Iterable[str]] = None,
                 key: str = "name") -> List[dict]:
    picked: List[dict] = []
    picked_names = set()
    topo_c, metal_c, sub_c = Counter(), Counter(), Counter()
    by_name = {}
    for r in ranked:
        by_name.setdefault(r[key], r)
    for name in (forced or []):
        r = by_name.get(name)
        if r is None:
            continue
        picked.append(dict(r, forced=True))
        picked_names.add(name)
        topo_c[r["topology"]] += 1
        metal_c[r["metal"]] += 1
        sub_c[r["substituent"]] += 1
    for r in ranked:
        if len(picked) >= n:
            break
        if r[key] in picked_names:
            continue
        if topo_c[r["topology"]] >= max_per_topology or metal_c[r["metal"]] >= max_per_metal:
            continue
        if sub_c[r["substituent"]] >= max_per_substituent:
            continue
        picked.append(dict(r, forced=False))
        picked_names.add(r[key])
        topo_c[r["topology"]] += 1
        metal_c[r["metal"]] += 1
        sub_c[r["substituent"]] += 1
    for i, r in enumerate(picked, 1):
        r["selection_rank"] = i
    return picked


def count_exact_ties(values: Sequence[float]) -> int:
    c = Counter(values)
    return sum(v - 1 for v in c.values() if v > 1)


def apply_eligibility(pool: Sequence[Mapping], exclude_family: Sequence[str] = (),
                      exclude_combo: Sequence[str] = (), max_atoms: Optional[int] = None) -> List[dict]:
    """Same filters as scripts/06_select_batch.py (family, family:topology:metal, max atoms)."""
    out = []
    combos = [tuple(c.split(":")) for c in exclude_combo]
    for r in pool:
        if r["node_family"] in exclude_family:
            continue
        if any(r["node_family"] == f and r["topology"] == t and r["metal"] == m for f, t, m in combos):
            continue
        if max_atoms is not None and r["n_atoms"] > max_atoms:
            continue
        out.append(dict(r))
    return out


def n_topo_from_dft(rows: Iterable[Mapping], before_iteration: Optional[int] = None) -> Dict[str, int]:
    c: Counter = Counter()
    for r in rows:
        if r.get("label_ok") is True and (before_iteration is None or r["iteration"] < before_iteration):
            c[r["topology"]] += 1
    return dict(sorted(c.items()))
