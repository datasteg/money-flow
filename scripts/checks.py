# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb==1.5.6"]
# ///
"""Checks on the five tables: units, cross-source agreement, coverage of the links.

    uv run scripts/checks.py          # $MONEY_FLOW_DATA_ROOT/checks/checks.json and checks.md; exit 1 if a check fails

1. Units: the same quantity from two sources agrees (Bank of Japan assets: FRED vs BIS; euro area: ECB vs FRED;
   Korea's reserves: ECOS vs IMF), within a tolerance, at the latest period both have; Korea's broad money (ECOS M2 vs
   the IMF's broad money) is shown for information only, because the definitions differ.
2. Coverage: what share of an economy's IIP total its bilateral links account for (portfolio holdings vs IIP portfolio
   assets, outward FDI vs IIP direct investment assets), and what share of a BIS reporter's claims on all countries
   its claims on single countries account for.
3. Counts: rows, economies and the newest period per dataset, so a quiet failure shows as a missing or old period.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import duckdb

ROOT = Path(os.environ.get("MONEY_FLOW_DATA_ROOT", "data"))
T, OUT = ROOT / "tables", ROOT / "checks"


def main() -> int:
    con = duckdb.connect()
    for t in ("stocks", "links", "totals", "economies"):
        con.execute(f"CREATE VIEW {t} AS SELECT * FROM '{T / t}.parquet'")
    res = {"agreement": [], "coverage": {}, "counts": []}
    ok = True

    # 1. the same quantity from two sources, latest common period (monthly or weekly values aligned on the month)
    pairs = [("JPN", "cb_assets", "fred.observations", "bis.CBTA", 0.03),         # BIS CBTA has no United States
             ("EMU", "cb_assets", "ecb.ILM", "fred.observations", 0.03),
             ("KOR", "broad_money", "ecos.StatisticSearch", "imf.MFS_MA", None),   # informational: BoK M2 vs the IMF's broader harmonised money (about 10% apart in won)
             ("KOR", "fx_reserves", "ecos.StatisticSearch", "imf.IRFCL", 0.03)]
    for eco, measure, a, b, tol in pairs:
        row = con.execute("""
            WITH x AS (SELECT dataset, strftime(period, '%Y-%m') m, last(coalesce(value_usd, value_lcu) ORDER BY period) v
                       FROM stocks WHERE economy = ? AND measure = ? AND dataset IN (?, ?) AND (detail IS NULL OR detail NOT LIKE '%average%')
                       GROUP BY ALL)
            SELECT a.m, a.v, b.v FROM x a JOIN x b USING (m) WHERE a.dataset = ? AND b.dataset = ? ORDER BY a.m DESC LIMIT 1""",
                          [eco, measure, a, b, a, b]).fetchone()
        if row:
            diff = abs(row[1] / row[2] - 1) if row[2] else None
            passed = None if tol is None else (diff is not None and diff <= tol)
            ok &= passed is not False
            res["agreement"].append({"economy": eco, "measure": measure, "month": row[0], a: round(row[1], 1), b: round(row[2], 1),
                                     "diff": round(diff, 4) if diff is not None else None, "tolerance": tol, "pass": passed})
        else:
            res["agreement"].append({"economy": eco, "measure": measure, "a": a, "b": b, "pass": None, "note": "no common period"})

    # 2. coverage of the bilateral links against IIP totals, latest year-end both have
    agg = "SELECT code FROM economies WHERE is_aggregate"
    for channel, item, dataset in (("portfolio", "portfolio", "imf.PIP"), ("fdi", "direct", "imf.DIP")):
        rows = con.execute(f"""
            WITH l AS (SELECT creditor e, period, sum(position_usd) v FROM links
                       WHERE channel = ? AND dataset = ? AND freq = 'A' AND reported_by = 'creditor' AND debtor NOT IN ({agg}) GROUP BY ALL),
                 t AS (SELECT economy e, period, max(position_usd) v FROM totals WHERE side = 'assets' AND item = ? AND month(period) = 12 GROUP BY ALL),   -- annual, or the year-end quarter
                 j AS (SELECT e, period, l.v lv, t.v tv, row_number() OVER (PARTITION BY e ORDER BY period DESC) r FROM l JOIN t USING (e, period) WHERE t.v > 0)
            SELECT e, period, round(lv, 1), round(tv, 1), round(lv / tv, 3) FROM j WHERE r = 1 ORDER BY tv DESC LIMIT 25""", [channel, dataset, item]).fetchall()
        res["coverage"][f"{channel} links / IIP {item} assets"] = [dict(zip(("economy", "period", "links_usd_bn", "iip_usd_bn", "share"), (r[0], str(r[1]), *r[2:]))) for r in rows]
    rows = con.execute(f"""
        WITH s AS (SELECT creditor e, period, sum(position_usd) FILTER (WHERE debtor NOT IN ({agg})) single, max(position_usd) FILTER (WHERE debtor = 'BIS:5J') world
                   FROM links WHERE dataset = 'bis.LBS' AND sector_debtor = 'all' AND currency = 'all' GROUP BY ALL),
             j AS (SELECT *, row_number() OVER (PARTITION BY e ORDER BY period DESC) r FROM s WHERE world > 0)
        SELECT e, period, round(single, 1), round(world, 1), round(single / world, 3) FROM j WHERE r = 1 AND e NOT IN ({agg}) ORDER BY world DESC LIMIT 25""").fetchall()
    res["coverage"]["BIS LBS claims on single countries / on all countries"] = [dict(zip(("reporter", "period", "single_usd_bn", "all_usd_bn", "share"), (r[0], str(r[1]), *r[2:]))) for r in rows]


    # 3. counts and the newest period per dataset
    for t in ("stocks", "links", "totals"):
        for r in con.execute(f"SELECT dataset, count(*), count(DISTINCT {'economy' if t != 'links' else 'creditor'}), max(period) FROM {t} GROUP BY 1 ORDER BY 1").fetchall():
            res["counts"].append({"table": t, "dataset": r[0], "rows": r[1], "economies": r[2], "newest": str(r[3])})

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "checks.json").write_text(json.dumps(res, indent=1, default=str), encoding="utf-8")
    md = ["# money-flow checks", "", "## Agreement between sources", "", "| Economy | Measure | Month | Values (USD bn or local bn) | Diff | Pass |", "|---|---|---|---|---|---|"]
    for a in res["agreement"]:
        vals = ", ".join(f"{k} {v}" for k, v in a.items() if "." in k)
        md.append(f"| {a['economy']} | {a['measure']} | {a.get('month', '-')} | {vals or a.get('note', '')} | {a.get('diff')} | {a['pass']} |")
    for name, rows in res["coverage"].items():
        md += ["", f"## Coverage: {name}", "", "| " + " | ".join(rows[0].keys()) + " |" if rows else "(none)", "|" + "---|" * len(rows[0]) if rows else ""]
        md += ["| " + " | ".join(str(v) for v in r.values()) + " |" for r in rows]
    md += ["", "## Counts", "", "| Table | Dataset | Rows | Economies | Newest |", "|---|---|---|---|---|"]
    md += [f"| {c['table']} | {c['dataset']} | {c['rows']:,} | {c['economies']} | {c['newest']} |" for c in res["counts"]]
    (OUT / "checks.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
