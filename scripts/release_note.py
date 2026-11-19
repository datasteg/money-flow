# /// script
# requires-python = ">=3.11"
# dependencies = ["brotli==1.1.0", "pyyaml==6.0.3"]
# ///
"""The release note: every published number that changed between two releases, old against new, with the rule behind it.

    uv run scripts/release_note.py 20261029.7 20261030.1          # -> docs/releases/20261030.1.md and .csv

Compares, for every economy file, the aligned and newest ladders at the build day in both directions (every group's
total, identified, not identified, coverage, the top holder and share, every drawn part), the made-here and context
series' newest points, and the market totals. A field is attributed to the rule of method 1.1 that changed it.
"""
from __future__ import annotations

import csv
import json
import sys
from collections import Counter
from pathlib import Path

import brotli

HERE = Path(__file__).resolve().parents[1]
SITE = Path("data/site")
RULE_OF = {"rio": "R6", "ni": "R6", "cov": "R6", "ident": "R6", "total": "R6", "excess_by": "R6", "top_share": "R6", "top_v": "R6", "top": "R6",
           "dip_total": "R6", "iip_total": "R6", "fdi_parts": "R7", "fdi": "R7", "split": "R7", "alt": "R4", "rep": "R4",
           "all_instr": "R5", "debt_sec": "R5", "other_instr": "R5", "nosplit": "R5", "bank_other": "R5", "iip_loans": "R5", "iip_deposits": "R5", "iip_deriv": "R5",
           "derived": "V16", "made": "R1/R16", "context": "R1/R16", "parts": "R4/R6/R7", "other": "R4/R6/R7", "n": "R4/R7"}


def load(tag: str) -> tuple[dict, dict]:
    m = json.loads((SITE / "releases" / f"{tag}.json").read_text())
    return m, {p: json.loads(brotli.decompress((SITE / "objects" / f"{h}.json.br").read_bytes())) for p, h in m["files"].items() if p.startswith(("econ/", "mkt/"))}


def flat(e: dict, day: str) -> dict[str, object]:
    """The published numbers of one economy file at the build day, as {label: value}."""
    out: dict[str, object] = {}
    for d in ("in", "out"):
        for mode in ("aligned", "newest"):
            idx = (e.get("index", {}).get(d) or {}).get(mode) or {}
            if not idx:
                continue
            key = max(k for k in idx if k <= day)
            lad = e["ladders"][d][idx[key]]
            for g, rec in lad["g"].items():
                for f, v in rec.items():
                    if isinstance(v, dict):
                        for h, x in v.items():
                            if not isinstance(x, (dict, list)):
                                out[f"{d}/{mode}/{g}/{f}/{h}"] = x
                    elif not isinstance(v, list):
                        out[f"{d}/{mode}/{g}/{f}"] = v
            for f, v in lad["per"].items():
                out[f"{d}/{mode}/per/{f}"] = v
    for blk in ("made", "context"):
        for m, s in (e.get(blk) or {}).items():
            pts = [p for p in s.get("pts", []) if p[0] <= day]
            if pts:
                out[f"{blk}/{m}/newest"] = f"{pts[-1][0]} {pts[-1][1]}"
    return out


def main() -> None:
    old_tag, new_tag = sys.argv[1], sys.argv[2]
    mo, fo = load(old_tag)
    mn, fn = load(new_tag)
    day = mn["date"]
    rows: list[dict] = []
    for path in sorted(set(fo) | set(fn)):
        if path.startswith("mkt/"):
            a, b = fo.get(path, {}).get("periods", []), fn.get(path, {}).get("periods", [])
            la, lb = (a[-1] if a else {}), (b[-1] if b else {})
            for f in ("total", "n_holders", "n_dests"):
                if la.get(f) != lb.get(f):
                    rows.append({"file": path, "field": f"{la.get('p')}/{f}", "old": la.get(f), "new": lb.get(f), "rule": "R4/R5/R6"})
            continue
        a, b = flat(fo.get(path, {}), day) if path in fo else {}, flat(fn.get(path, {}), day) if path in fn else {}
        for k in sorted(set(a) | set(b)):
            if a.get(k) != b.get(k):
                field = k.split("/")[-2] if k.count("/") >= 3 and k.split("/")[2] in ("debt", "bank", "fdi", "equity", "unsplit", "portfolio", "bank_other", "reserves") else k.split("/")[-1]
                top = k.split("/")[0]
                rule = RULE_OF.get(top, RULE_OF.get(field, RULE_OF.get(k.split("/")[-1], "")))
                if "/per/" in k:
                    rule = "R7"
                rows.append({"file": path, "field": k, "old": a.get(k), "new": b.get(k), "rule": rule})
    out = HERE / "docs" / "releases"
    out.mkdir(parents=True, exist_ok=True)
    with (out / f"{new_tag}.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["file", "field", "old", "new", "rule"])
        w.writeheader()
        w.writerows(rows)
    by_rule = Counter(r["rule"] for r in rows)
    by_file = Counter(r["file"] for r in rows)
    lines = [f"# Release {new_tag}: what changed against {old_tag}", "",
             f"Method {mo.get('method')} → {mn.get('method')} · {len(rows):,} published numbers changed in {len(by_file)} files · the full list, old against new with the rule, is `{new_tag}.csv` beside this note.", "",
             "| rule | numbers changed |", "|---|---|"] + [f"| {r or '(other)'} | {n:,} |" for r, n in by_rule.most_common()]
    lines += ["", "## Checks", "", f"Old: {json.dumps(mo.get('checks'))} · new: {json.dumps(mn.get('checks'))}", "", "## Korea, inflows, aligned, at the build day", "", "| field | old | new | rule |", "|---|---|---|---|"]
    for r in rows:
        if r["file"] == "econ/KOR" and r["field"].startswith("in/aligned/") and "/parts/" not in r["field"] and "/other/" not in r["field"]:
            lines.append(f"| {r['field'].removeprefix('in/aligned/')} | {r['old']} | {r['new']} | {r['rule']} |")
    lines += ["", "## Files with the most changes", "", "| file | numbers |", "|---|---|"] + [f"| {p} | {n:,} |" for p, n in by_file.most_common(25)]
    (out / f"{new_tag}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(rows):,} changed numbers -> {out / new_tag}.md / .csv")


if __name__ == "__main__":
    main()
