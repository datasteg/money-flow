"""The checks V1–V27 (config/method.yaml). Each @check function returns a Result. A blocking check that
fails stops the release, so the live site shows only passes, warnings and information.

The pre-checks (V5, V6, V13) run before the views are built, because their findings go into the economy files; the
others run on the finished files. checks.json in the release holds every result; values from a source that may not be
shown (BoJ data on FRED) are reported as a difference only.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import re
from collections import defaultdict
from dataclasses import dataclass, field

from .registry import METHOD, SOURCES, check, dataset, licence, shown
from . import rules

STEP = {"D": 1, "W": 7, "M": 31, "Q": 92, "S": 183, "A": 366}
DETAILS = 400                                                      # details kept per check in the release file
PULSE_CAP = 53                                                     # V11 v2: the World pulse's open weekly series may carry a year of points


@dataclass
class Result:
    id: str
    status: str                      # pass | warning | info | fail
    summary: str
    details: list = field(default_factory=list)
    observed: float | str | None = None

    def out(self) -> dict:
        c = METHOD["checks"][self.id]
        out = {"id": self.id, "name": c["name"], "severity": c["severity"], "tolerance": c["tolerance"], "status": self.status,
               "summary": self.summary, "observed": self.observed, "details": self.details[:DETAILS], "n_details": len(self.details)}
        by = {}
        for d in self.details:                                   # a count per economy, so the page can say where the findings are
            if isinstance(d, dict):
                for k in ("economy", "reporter", "debtor"):
                    if d.get(k):
                        by[d[k]] = by.get(d[k], 0) + 1
                        break
        if by and len(self.details) > DETAILS:
            out["by_economy"] = dict(sorted(by.items(), key=lambda kv: (-kv[1], kv[0])))
        return out


def blocking(results: list[Result]) -> list[Result]:
    return [r for r in results if r.status == "fail" and METHOD["checks"][r.id]["severity"] == "block"]


# ---------------------------------------------------------------------- on the tables
@check("V1")
def v1_unique_keys(conflicts: dict[str, int], site_ids: dict[str, int]) -> Result:
    bad = {k: v for k, v in conflicts.items() if v} | {f"site:{k}": v for k, v in site_ids.items() if v}
    if bad:
        return Result("V1", "fail", "Keys with more than one value: " + ", ".join(f"{k} {v:,}" for k, v in bad.items()), [bad])
    return Result("V1", "pass", "No key repeats with a different value in the tables, and no mark repeats in the site files.", observed=0)


@check("V2")
def v2_one_row_per_ribbon(duplicates: int) -> Result:
    if duplicates:
        return Result("V2", "fail", f"{duplicates:,} ribbons had a second source row after the rules.", observed=duplicates)
    return Result("V2", "pass", "Every ribbon comes from exactly one row.", observed=0)


@check("V3")
def v3_adds_up(residuals: list[float]) -> Result:
    worst = max(residuals) if residuals else 0.0
    if worst > 1e-6:
        return Result("V3", "fail", f"A node does not add up: largest residual {worst:.2e} bn.", observed=worst)
    return Result("V3", "pass", f"{len(residuals):,} nodes add up to their totals (largest residual {worst:.1e} bn).", observed=worst)


@check("V4")
def v4_coverage(flags: dict[tuple, list]) -> Result:
    low = [{"economy": e, **f} for (e, _), fs in sorted(flags.items()) for f in fs if f["id"] == "V4"]
    if low:
        return Result("V4", "warning", f"{len(low)} economy ladders identify less than half of their total; the views say so.", low, len(low))
    return Result("V4", "pass", "Every ladder identifies at least half of its total.", observed=0)


def _common_month(con, eco: str, measure: str, a: str, b: str):
    return con.execute("""
        WITH x AS (SELECT dataset, strftime(period, '%Y-%m') m, last(coalesce(value_usd, value_lcu) ORDER BY period) v, any_value(raw) raw
                   FROM stocks_m WHERE economy = ? AND measure = ? AND dataset IN (?, ?) AND (detail IS NULL OR detail NOT LIKE '%average%') GROUP BY ALL)
        SELECT a.m, a.v, b.v, a.raw, b.raw FROM x a JOIN x b USING (m) WHERE a.dataset = ? AND b.dataset = ? ORDER BY a.m DESC LIMIT 1""",
                       [eco, measure, a, b, a, b]).fetchone()


V5_PAIRS = [("JPN", "cb_assets", "bis.CBTA", "fred.observations", 0.03), ("EMU", "cb_assets", "ecb.ILM", "fred.observations", 0.03),
            ("KOR", "fx_reserves", "ecos.StatisticSearch", "imf.IRFCL", 0.03), ("KOR", "broad_money", "ecos.StatisticSearch", "imf.MFS_MA", None),
            ("KOR", "monetary_base", "ecos.StatisticSearch", "imf.MFS_MA", None)]
# Definitional exemptions of the reserves row (IIP reserves vs IRFCL official reserve assets): the two are not the same
# quantity for these economies, so they are reported as information, never as a failure (audit of 29 Oct 2026, F13).
V5_RESERVES_EXEMPT = {"USA": "the US reserves template values gold at the statutory price; the IIP at market", "GBR": "scope of the UK template differs from the IIP",
                      "SYC": "IRFCL reports a figure the IIP does not"}


@check("V5")
def v5_sources_agree(con) -> Result:
    """The same quantity from two publishers. Pairs: the national series against BIS or IMF (as before); official
    reserves in the IIP against IRFCL for every economy at every quarter end since 2015 (block at 3%, with listed
    definitional exemptions); Korea's IIP portfolio liabilities and assets from ECOS against the IMF IIP (block at
    0.1%: the same compiler); CPIS holder totals against IIP portfolio assets (warn at 10%); the DIP all-investor total
    against IIP direct liabilities and TIC against CPIS (information: different valuation or custodial basis)."""
    from .views import key_of
    rows, fails, warns = [], 0, 0
    for eco, measure, a, b, tol in V5_PAIRS:
        r = _common_month(con, eco, measure, a, b)
        if not r:
            rows.append({"economy": eco, "measure": measure, "a": a, "b": b, "status": "info", "note": "no common month"})
            continue
        m, va, vb, ra, rb = r
        diff = abs(va / vb - 1) if vb else None
        st = "info" if tol is None else ("pass" if diff is not None and diff <= tol else "fail")
        fails += st == "fail"
        row = {"economy": eco, "measure": measure, "month": m, "a": a, "b": b, "diff_pct": round(100 * diff, 1) if diff is not None else None,
               "tolerance_pct": None if tol is None else 100 * tol, "status": st}
        if shown(licence(a, key_of(ra))):
            row["a_value"] = round(va, 1)
        if shown(licence(b, key_of(rb))):
            row["b_value"] = round(vb, 1)
        rows.append(row)
    # reserves: IIP vs IRFCL, every economy, newest common quarter end, block at 3%
    for eco, p, iip, irf in con.execute("""
            WITH x AS (SELECT t.economy, t.period, t.position_usd iip, s.value_usd irf, row_number() OVER (PARTITION BY t.economy ORDER BY t.period DESC) r
                       FROM totals_m t JOIN stocks_m s ON s.economy = t.economy AND s.period = t.period AND s.dataset = 'imf.IRFCL' AND s.measure = 'fx_reserves'
                       WHERE t.dataset = 'imf.IIP' AND t.side = 'assets' AND t.item = 'reserves' AND t.period >= '2015-01-01' AND s.value_usd > 1)
            SELECT economy, period, iip, irf FROM x WHERE r = 1 ORDER BY 1""").fetchall():
        diff = abs(iip / irf - 1)
        if eco in V5_RESERVES_EXEMPT:
            st = "info"
        else:
            st = "pass" if diff <= 0.03 else ("warning" if diff <= 0.10 else "fail")   # the IIP and IRFCL are revised on different dates
        fails += st == "fail"
        warns += st == "warning"
        rows.append({"economy": eco, "measure": "fx_reserves", "month": str(p)[:7], "a": "imf.IIP", "b": "imf.IRFCL", "a_value": round(iip, 1), "b_value": round(irf, 1),
                     "diff_pct": round(100 * diff, 1), "tolerance_pct": 3, "status": st, **({"note": V5_RESERVES_EXEMPT[eco]} if eco in V5_RESERVES_EXEMPT else {})})
    # Korea: ECOS IIP portfolio vs IMF IIP portfolio, block at 0.1% (the same compiler; a replication benchmark)
    for side in ("assets", "liabilities"):
        r = con.execute("""SELECT t.period, t.position_usd, s.value_usd FROM totals_m t JOIN stocks_m s ON s.economy = 'KOR' AND s.period = t.period
                           AND s.dataset = 'ecos.StatisticSearch' AND s.measure = 'iip_portfolio' AND s.detail = ? WHERE t.economy = 'KOR' AND t.dataset = 'imf.IIP'
                           AND t.side = ? AND t.item = 'portfolio' ORDER BY t.period DESC LIMIT 1""", [side, side]).fetchone()
        if r:
            p, imf, ecos = r
            diff = abs(ecos / imf - 1)
            st = "pass" if diff <= 0.001 else "fail"
            fails += st == "fail"
            rows.append({"economy": "KOR", "measure": f"iip_portfolio_{side}", "month": str(p)[:7], "a": "ecos.StatisticSearch", "b": "imf.IIP", "a_value": round(ecos, 1), "b_value": round(imf, 1),
                         "diff_pct": round(100 * diff, 2), "tolerance_pct": 0.1, "status": st})
    # CPIS holder totals vs IIP portfolio assets, newest December, warn at 10%
    for eco, p, cpis, iip in con.execute("""
            WITH c AS (SELECT creditor economy, period, sum(position_usd) cpis FROM links_m WHERE dataset = 'imf.PIP' AND channel = 'portfolio' AND NOT agg_debtor AND NOT agg_creditor
                       AND creditor <> debtor AND month(period) = 12 GROUP BY ALL),
                 x AS (SELECT c.economy, c.period, c.cpis, t.position_usd iip, row_number() OVER (PARTITION BY c.economy ORDER BY c.period DESC) r FROM c
                       JOIN totals_m t ON t.economy = c.economy AND t.period = c.period AND t.dataset = 'imf.IIP' AND t.side = 'assets' AND t.item = 'portfolio' WHERE t.position_usd > 1)
            SELECT economy, period, cpis, iip FROM x WHERE r = 1 ORDER BY 1""").fetchall():
        diff = abs(cpis / iip - 1)
        st = "pass" if diff <= 0.10 else "warning"
        warns += st == "warning"
        rows.append({"economy": eco, "measure": "portfolio_assets", "month": str(p)[:7], "a": "imf.PIP", "b": "imf.IIP", "a_value": round(cpis, 1), "b_value": round(iip, 1),
                     "diff_pct": round(100 * diff, 1), "tolerance_pct": 10, "status": st})
    # DIP all-investor total vs IIP direct liabilities (information: book against market value); TIC vs CPIS (information: custodial basis)
    for eco, p, dip, iip in con.execute("""
            WITH d AS (SELECT debtor economy, period, position_usd dip FROM links_m WHERE dataset = 'imf.DIP' AND creditor = 'IMF:G001' AND channel = 'fdi'),
                 x AS (SELECT d.economy, d.period, d.dip, t.position_usd iip, row_number() OVER (PARTITION BY d.economy ORDER BY d.period DESC) r FROM d
                       JOIN totals_m t ON t.economy = d.economy AND t.period = d.period AND t.dataset = 'imf.IIP' AND t.side = 'liabilities' AND t.item = 'direct' WHERE t.position_usd > 1 AND d.dip > 0)
            SELECT economy, period, dip, iip FROM x WHERE r = 1 ORDER BY 1""").fetchall():
        rows.append({"economy": eco, "measure": "fdi_liabilities", "month": str(p)[:7], "a": "imf.DIP", "b": "imf.IIP", "a_value": round(dip, 1), "b_value": round(iip, 1),
                     "diff_pct": round(100 * abs(dip / iip - 1), 1), "tolerance_pct": None, "status": "info", "note": "DIP positions are at the host's valuation (book value for the largest hosts); the IIP item is at market value"})
    for eco, p, tic, cpis in con.execute("""
            SELECT t.creditor, t.period, t.position_usd, c.position_usd FROM links_m t JOIN links_m c ON c.dataset = 'imf.PIP' AND c.channel = 'portfolio' AND c.debtor = 'USA'
            AND c.creditor = t.creditor AND c.period = t.period WHERE t.dataset = 'tic.files' AND t.channel = 'portfolio' AND NOT t.agg_creditor
            AND t.period = (SELECT max(period) FROM links_m WHERE dataset = 'tic.files' AND month(period) = 12) ORDER BY abs(t.position_usd - c.position_usd) DESC LIMIT 20""").fetchall():
        rows.append({"economy": eco, "measure": "us_securities", "month": str(p)[:7], "a": "tic.files", "b": "imf.PIP", "a_value": round(tic, 1), "b_value": round(cpis, 1),
                     "diff_pct": round(100 * abs(tic / cpis - 1), 1) if cpis else None, "tolerance_pct": None, "status": "info", "note": "TIC records the custodian's country; CPIS the holder's"})
    n_pass, n_info = sum(r["status"] == "pass" for r in rows), sum(r["status"] == "info" for r in rows)
    if fails:
        return Result("V5", "fail", f"{fails} pair(s) of sources disagree beyond their tolerance.", rows, fails)
    if warns:
        return Result("V5", "warning", f"{n_pass} pairs agree within tolerance; {warns} rows are in the warning band (reserves 3–10% apart, CPIS holder totals more than 10% from the IIP); {n_info} rows differ by definition (information).", rows, warns)
    return Result("V5", "pass", f"{n_pass} pairs agree within tolerance; {n_info} differ by definition (information).", rows, 0)


@check("V6")
def v6_mirrors(con, flags: dict) -> Result:
    """Direct investment: the host's and the investor's own reports of a pair, at the newest year both have."""
    rows = con.execute("""
        WITH d AS (SELECT period, creditor, debtor, max(position_usd) FILTER (WHERE reported_by = 'debtor') host,
                          max(position_usd) FILTER (WHERE reported_by = 'creditor') inv
                   FROM links_3 WHERE dataset = 'imf.DIP' AND creditor NOT IN (SELECT code FROM economies WHERE is_aggregate)
                   AND debtor NOT IN (SELECT code FROM economies WHERE is_aggregate) GROUP BY ALL),
             j AS (SELECT *, row_number() OVER (PARTITION BY creditor, debtor ORDER BY period DESC) r FROM d WHERE host IS NOT NULL AND inv IS NOT NULL)
        SELECT period, creditor, debtor, host, inv FROM j WHERE r = 1 AND greatest(abs(host), abs(inv)) >= 1 ORDER BY creditor, debtor""").fetchall()
    bad = []
    for p, c, d, h, i in rows:
        if abs(h - i) / max(abs(h), abs(i)) > 0.5:
            bad.append({"period": str(p), "creditor": c, "debtor": d, "host": round(h, 1), "investor": round(i, 1)})
            for e in (c, d):
                flags.setdefault(e, []).append({"id": "V6", "status": "info", "group": "fdi", "period": str(p), "note": f"{c}>{d}",
                                                "value": round(100 * abs(h - i) / max(abs(h), abs(i)), 1)})
    bad.sort(key=lambda r: -abs(r["host"] - r["investor"]))
    return Result("V6", "info" if bad else "pass", f"{len(bad):,} of {len(rows):,} direct investment pairs (1 bn or more) have reports more than 50% apart; "
                                                   "the pair's chosen reporter is drawn (R4, one reporter for the whole series), the other figure is in the tooltip, and the pair is flagged.", bad, len(bad))


@check("V7")
def v7_publisher_totals(con) -> Result:
    issues = []
    for ccy, p, tot, sec in con.execute("""SELECT currency, period, max(value_usd) FILTER (WHERE detail = 'total'), max(value_usd) FILTER (WHERE detail = 'debt_securities')
                                         FROM stocks_m WHERE dataset = 'bis.GLI' GROUP BY ALL ORDER BY 1, 2""").fetchall():
        if tot is not None and sec is not None and sec > tot * 1.005:
            issues.append({"test": "GLI securities <= total", "currency": ccy, "period": str(p)})
    for rep, p, single, world in con.execute("""
            SELECT creditor, period, sum(position_usd) FILTER (WHERE NOT agg_debtor), max(position_usd) FILTER (WHERE debtor = 'BIS:5J')
            FROM links_m WHERE dataset = 'bis.LBS' AND channel = 'bank_all' AND basis = 'residence' AND NOT agg_creditor AND period >= '2015-01-01' GROUP BY ALL ORDER BY 1, 2""").fetchall():
        if single is not None and world and single > world * 1.005:
            issues.append({"test": "LBS single counterparties <= all countries", "reporter": rep, "period": str(p), "single": round(single, 1), "all": round(world, 1)})
    # IIP: the five items (direct, portfolio, derivatives, other, reserves) add up to the total; derivatives can be negative, so the
    # test is on the sum with sign, both ways (an under-sum means a missing item)
    under = []
    for e, p, side, four, deriv, total in con.execute("""
            SELECT economy, period, side, sum(position_usd) FILTER (WHERE item IN ('direct', 'portfolio', 'other', 'reserves')),
                   max(position_usd) FILTER (WHERE item = 'derivatives'), max(position_usd) FILTER (WHERE item = 'total')
            FROM totals_m WHERE dataset = 'imf.IIP' AND side IN ('assets', 'liabilities') AND period >= '2015-01-01' GROUP BY ALL ORDER BY 1, 2, 3""").fetchall():
        if four is None or not total:
            continue
        four, deriv, total = float(four), float(deriv) if deriv is not None else None, float(total)
        five = four + (deriv or 0.0)
        if abs(five - total) > abs(total) * 0.005 + 0.1:
            row = {"test": "IIP items = total", "economy": e, "period": str(p), "side": side, "items": round(four, 1), "derivatives": round(deriv, 1) if deriv is not None else None,
                   "total": round(total, 1), "residual": round(five - total, 1)}
            (issues if five > total else under).append(row)
    lbs = [i for i in issues if i["test"].startswith("LBS")]
    other = [i for i in issues if not i["test"].startswith("LBS")]
    st = "fail" if [i for i in other if i["test"].startswith("GLI")] or [i for i in other if i["test"].startswith("IIP")] else ("warning" if lbs else ("info" if under else "pass"))
    return Result("V7", st, f"GLI: securities within totals. LBS: {len(lbs)} reporter-quarters where single counterparties exceed all countries. "
                            f"IIP: {sum(i['test'].startswith('IIP') for i in other)} economy-periods whose five items (with derivatives) exceed the total; "
                            f"{len(under)} fall short of it (a missing item, information).", issues + under, len(issues) + len(under))


GOLDEN = {  # V8: Korea, as of the 27 Oct 2026 vintages. These are regression figures: numbers we wrote down ourselves
            # from the same tables, so they catch a change of the build, not an error of the source (audit of 29 Oct 2026). The
            # independent validation of the same quantities is in V5 (ECOS vs IMF IIP) and V16 (the publishers' own identities).
    "equity held abroad, end-2025": ("SELECT sum(position_usd) FROM links_m WHERE dataset = 'imf.PIP' AND channel = 'portfolio_equity' AND debtor = 'KOR' AND period = '2025-12-31' AND NOT agg_creditor AND creditor <> 'KOR'", 705.2),
    "debt securities held abroad, end-2025": ("SELECT sum(position_usd) FROM links_m WHERE dataset = 'imf.PIP' AND channel = 'portfolio_debt' AND debtor = 'KOR' AND period = '2025-12-31' AND NOT agg_creditor AND creditor <> 'KOR'", 268.0),
    "portfolio identified by holder, end-2025": ("SELECT sum(position_usd) FROM links_m WHERE dataset = 'imf.PIP' AND channel = 'portfolio' AND debtor = 'KOR' AND period = '2025-12-31' AND NOT agg_creditor AND creditor <> 'KOR'", 994.4),
    "IIP portfolio liabilities, end-2025": ("SELECT position_usd FROM totals_m WHERE economy = 'KOR' AND side = 'liabilities' AND item = 'portfolio' AND period = '2025-12-31'", 1364.6),
    "bank claims, all reporters, all instruments, Q1 2026": ("SELECT position_usd FROM links_m WHERE dataset = 'bis.LBS' AND channel = 'bank_all' AND basis = 'residence' AND creditor = 'BIS:5A' AND debtor = 'KOR' AND period = '2026-03-31'", 375.2),
    "bank claims, bilateral reporters, all instruments, Q1 2026": ("SELECT sum(position_usd) FROM links_m WHERE dataset = 'bis.LBS' AND channel = 'bank_all' AND basis = 'residence' AND NOT agg_creditor AND debtor = 'KOR' AND period = '2026-03-31'", 286.8),
}
GOLDEN_VINTAGE = {"imf.PIP": "2026-10-27", "imf.IIP": "2026-10-27", "bis.LBS": "2026-10-27"}


@check("V8")
def v8_golden(con, vintages: dict[str, str]) -> Result:
    moved = {d: vintages.get(d) for d, v in GOLDEN_VINTAGE.items() if vintages.get(d) != v}
    rows, bad = [], 0
    for name, (sql, want) in GOLDEN.items():
        got = con.execute(sql).fetchone()[0]
        ok = got is not None and round(got, 1) == want
        bad += not ok
        rows.append({"figure": name, "expected": want, "got": None if got is None else round(got, 1), "pass": ok})
    if moved:
        return Result("V8", "info", "A golden dataset has a newer vintage, so the figures may move with the publisher's revisions: "
                                    + ", ".join(f"{d} {v}" for d, v in moved.items()) + ".", rows, bad)
    if bad:
        return Result("V8", "fail", f"{bad} of {len(rows)} golden figures differ.", rows, bad)
    return Result("V8", "pass", f"All {len(rows)} golden figures of the plan are rebuilt exactly (a regression test of the build; validation against independent figures is V5 and V16).", rows, 0)


@check("V9")
def v9_determinism(first: bytes, second: bytes) -> Result:
    if first != second:
        return Result("V9", "fail", "Two builds of the same view differ.", observed="differ")
    return Result("V9", "pass", "Two builds of the Korea and United States views are byte-identical.", observed="identical")


@check("V10")
def v10_explained(prev: dict | None, files: dict[str, str], vintages: dict[str, str], code: str, method: str) -> Result:
    if not prev:
        return Result("V10", "pass", "First release: nothing to compare.", observed=0)
    changed = [p for p, h in files.items() if prev["files"].get(p) != h]
    if not changed:
        return Result("V10", "pass", "No file changed.", observed=0)
    newv = [d for d, v in vintages.items() if (prev.get("vintages") or {}).get(d) != v]
    if newv or prev.get("code") != code or prev.get("method") != method:
        why = (f"new vintages of {', '.join(newv)}" if newv else "") + ("; " if newv and prev.get("code") != code else "") + \
              ("a change of the build code" if prev.get("code") != code else "") + (f"; method {prev.get('method')} -> {method}" if prev.get("method") != method else "")
        return Result("V10", "pass", f"{len(changed)} files changed, explained by {why}.", changed, len(changed))
    return Result("V10", "fail", f"{len(changed)} files changed with no new vintage, code or method behind them.", changed, len(changed))


# ---------------------------------------------------------------------- on the site files
@check("V11")
def v11_licence(files: dict[str, bytes], dropped: list[str]) -> Result:
    bad = []
    banned = sorted(ds for ds, e in SOURCES["datasets"].items() if not shown(e["class"]))
    banned_keys = sorted(k for ds, e in SOURCES["datasets"].items() for k, o in (e.get("keys") or {}).items() if not shown(o.get("class", e["class"])))
    for path, b in files.items():
        s = b.decode("utf-8")
        for ds in banned:
            if f'"{ds}"' in s:
                bad.append(f"{path}: names {ds}")
        for k in banned_keys:
            if f'"key":"{k}"' in s:
                bad.append(f"{path}: carries {k}")
        obj = json.loads(s)
        bad += [f"{path}: {m}" for m in _long_runs(obj)]
    bad += rules.r14_no_commercial_data(SOURCES["classes"], files)   # R14: no vendor name, no fund-level field, anywhere
    if dropped:
        bad.append(f"{len(dropped)} fields outside the schema were dropped by the gate (first: {dropped[0]})")
    if bad:
        return Result("V11", "fail", f"{len(bad)} licence findings in the public files.", bad, len(bad))
    return Result("V11", "pass", f"{len(files)} public files: only shown classes, only schema fields, no commercial vendor or fund-level value (R14), "
                                 "no daily, weekly or monthly series longer than 13 native observations (the World pulse's open series: a year of weekly points).", observed=0)


def _long_runs(obj, path="") -> list[str]:
    out = []
    if isinstance(obj, dict):
        f = obj.get("f")
        if f in ("D", "W", "M") and isinstance(obj.get("pts"), list):
            run, best, prev = 1, 1, None
            for p, _ in obj["pts"]:
                d = dt.date.fromisoformat(p)
                if prev and (d - prev).days <= STEP[f] * 1.6:
                    run += 1
                    best = max(best, run)
                else:
                    run = 1
                prev = d
            cap = PULSE_CAP if path.startswith("/pulse/") and licence(obj.get("ds", ""), obj.get("key")) == "open" else 16
            if best > cap:
                out.append(f"{path}: {best} consecutive {f} observations")
        for k, v in obj.items():
            out += _long_runs(v, f"{path}/{k}")
    elif isinstance(obj, list):
        for v in obj:
            out += _long_runs(v, path)
    return out


@check("V12")
def v12_freshness(newest: dict[str, tuple[str, str]], day: dt.date) -> Result:
    late = []
    for ds, (period, freq) in sorted(newest.items()):
        e = dataset(ds)
        if not e or not shown(e.get("class", "")):
            continue
        lag = (e.get("lag_days") or {}).get(freq) or max((e.get("lag_days") or {"x": 120}).values())
        p = dt.date.fromisoformat(period)
        if (day - p).days > lag + STEP.get(freq, 92):
            late.append({"dataset": ds, "newest": period, "freq": freq, "allowed_days": lag + STEP.get(freq, 92)})
    if late:
        return Result("V12", "warning", f"{len(late)} dataset(s) older than their cadence and usual lag; their marks age on the page.", late, len(late))
    return Result("V12", "pass", "Every dataset's newest period is within its cadence and usual lag.", observed=0)


def _redenominations() -> dict[str, list[tuple[dt.date, float, str]]]:
    """config/redenominations.csv: currency redenominations by economy and date. A source that has not back-converted
    its series jumps by the factor at that date in its own currency; R16 would read that as a unit error, so V13 marks
    any quarantined or rescaled segment that starts within a month of a listed date (none did in release 20261031.3:
    the IMF MFS files are back-converted)."""
    import csv
    from .registry import CONFIG
    f = CONFIG / "redenominations.csv"
    out: dict[str, list] = {}
    if f.exists():
        with open(f, encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                out.setdefault(r["economy"], []).append((dt.date.fromisoformat(r["date"]), float(r["factor"]), r.get("note") or ""))
    return out


@check("V13")
def v13_size_of_change(con, flags: dict) -> Result:
    """Tenfold moves after the R16 quarantine. A quarantined observation (a source error) is a warning with its raw
    values; a tenfold move that R16 let through (a real or unexplained move: it neither reverts, nor is a power of ten,
    nor exceeds the plausibility bound) is information; the check fails, and blocks, when a quarantined observation is
    still in the drawn series or when the ratio test finds a unit-error pattern R16 should have caught. Monthly,
    quarterly and annual series are tested in the source's own currency where it has one; daily and weekly series on
    their monthly averages."""
    from . import rules
    rows = con.execute("""
        WITH m AS (SELECT economy, measure, dataset, freq, detail, currency,
                          CASE WHEN freq IN ('D', 'W') THEN date_trunc('month', period) + INTERVAL 1 MONTH - INTERVAL 1 DAY ELSE period END period,
                          avg(coalesce(value_lcu, value_usd)) v, avg(value_usd) usd
                   FROM stocks_m WHERE "primary" AND period >= '2000-01-01' AND measure NOT LIKE '%net_issues%' GROUP BY ALL),
             s AS (SELECT *, lag(v) OVER w pv, lag(usd) OVER w pusd FROM m WINDOW w AS (PARTITION BY economy, measure, dataset, freq, detail, currency ORDER BY period))
        SELECT economy, measure, dataset, freq, period, pusd, usd, v / pv ratio FROM s
        WHERE pv IS NOT NULL AND pv > 0 AND v > 0 AND least(abs(usd), abs(pusd)) > 0.5 AND greatest(v, pv) / least(v, pv) > 10 ORDER BY 1, 2, 3, 5""").fetchall()
    out, bad = [], 0
    redenominations = _redenominations()
    coincide = 0
    for q in rules.QUARANTINED:
        kind = "rescaled (R16)" if q.get("action") == "rescaled" else "quarantined (R16)"
        out.append({"status": "warning", "kind": kind, **q})
        flags.setdefault(q["economy"], []).append({"id": "V13", "status": "warning", "group": q["measure"], "period": q["from"], "value": q["ratio"], "note": q["reason"]})
        start = dt.date.fromisoformat(q["from"][:10])
        for d, factor, note in redenominations.get(q["economy"], []):
            if abs((start.year * 12 + start.month) - (d.year * 12 + d.month)) <= 1:     # the same month or the one beside it
                coincide += 1
                out.append({"status": "warning", "kind": "coincides with a redenomination: check that the source back-converted the series",
                            "economy": q["economy"], "measure": q["measure"], "dataset": q["dataset"], "period": q["from"], "redenomination": str(d), "factor": factor, "note": note})
    for e, m, ds, fr, p, pusd, usd, ratio in rows:
        r = ratio if ratio > 1 else 1 / ratio
        unit = rules._unit_ratio(r)
        kind = "unit-error pattern left in the series" if unit and fr in ("M", "Q", "A") else ("monthly average of a daily or weekly series" if fr in ("D", "W") else "real or unexplained move (not a spike, not a power of ten, within the plausibility bound)")
        st = "fail" if unit and fr in ("M", "Q", "A") else "info"
        bad += st == "fail"
        out.append({"status": st, "kind": kind, "economy": e, "measure": m, "dataset": ds, "freq": fr, "period": str(p), "previous": round(pusd, 1), "value": round(usd, 1), "ratio": round(ratio, 1)})
        if st == "info" and fr in ("M", "Q", "A"):
            flags.setdefault(e, []).append({"id": "V13", "status": "info", "group": m, "period": str(p), "value": round(ratio, 1)})
    nq, ni = len(rules.QUARANTINED), sum(r["status"] == "info" for r in out)
    nr = sum(q.get("action") == "rescaled" for q in rules.QUARANTINED)
    if bad:
        return Result("V13", "fail", f"{bad} tenfold move(s) with a unit-error pattern are still in a drawn series.", out, bad)
    if nq:
        return Result("V13", "warning", f"R16 found {nq} source-error segment(s): {nr} rescaled by a power of ten, {nq - nr} dropped (listed with their raw values); "
                                        f"{coincide} coincide with a listed redenomination; {ni} other tenfold moves are real or unexplained and stay (information).", out, nq)
    if ni:
        return Result("V13", "info", f"No source error; {ni} tenfold moves are real or unexplained and stay (information).", out, 0)
    return Result("V13", "pass", "No measure moved more than tenfold in one period.", observed=0)


# ---------------------------------------------------------------------- the audit's checks (method 1.1)
@check("V14")
def v14_cpis_within_iip(con, prev_excess: set | None = None) -> Result:
    """CPIS holders identified on an economy (plus the reserves-and-IO group) do not exceed its IIP portfolio liabilities,
    by instrument, at the newest December both have; tolerance 5%. A warning, because some economies' IIP and the CPIS
    holders are on different valuation or coverage bases for good (India, Bermuda, the UK); a failure, which blocks, when an
    economy exceeds for the first time (it passed in the previous release)."""
    rows = con.execute("""
        WITH c AS (SELECT debtor economy, period, channel, sum(position_usd) ident FROM links_m WHERE dataset = 'imf.PIP' AND (NOT agg_creditor OR creditor = 'IMF:TX093')
                   AND creditor <> debtor AND month(period) = 12 AND channel IN ('portfolio', 'portfolio_equity', 'portfolio_debt') GROUP BY ALL),
             x AS (SELECT c.economy, c.period, c.channel, c.ident, t.position_usd iip, row_number() OVER (PARTITION BY c.economy, c.channel ORDER BY c.period DESC) r
                   FROM c JOIN totals_m t ON t.economy = c.economy AND t.period = c.period AND t.dataset = 'imf.IIP' AND t.side = 'liabilities'
                   AND t.item = CASE c.channel WHEN 'portfolio' THEN 'portfolio' WHEN 'portfolio_equity' THEN 'portfolio_equity' ELSE 'portfolio_debt' END
                   WHERE c.economy NOT IN (SELECT code FROM economies WHERE is_aggregate))
        SELECT economy, period, channel, ident, iip FROM x WHERE r = 1 ORDER BY ident - iip DESC""").fetchall()
    bad, new = [], []
    for e, p, ch, ident, iip in rows:
        ident, iip = float(ident), float(iip)
        if ident > iip * 1.05 + 0.1:
            row = {"economy": e, "period": str(p), "instrument": ch.replace("portfolio_", "") if "_" in ch else "total", "cpis": round(ident, 1), "iip": round(iip, 1),
                   "excess": round(ident - iip, 1), "pct": round(100 * (ident / iip - 1), 1) if iip else None}
            bad.append(row)
            if prev_excess is not None and (e, ch) not in prev_excess:
                new.append(row)
    n = len(rows)
    if new:
        return Result("V14", "fail", f"{len(new)} economy-instrument(s) exceed their IIP total for the first time: " + ", ".join(f"{r['economy']} {r['instrument']}" for r in new[:8]) + ".", bad, len(bad))
    if bad:
        return Result("V14", "warning", f"{len(bad)} of {n} economy-instruments have CPIS holders above the IIP total by more than 5% (coverage is capped at 100% and the excess shown); none is new.", bad, len(bad))
    return Result("V14", "pass", f"CPIS holders stay within the IIP portfolio liabilities in all {n} economy-instruments.", observed=0)


@check("V15")
def v15_lbs_within_iip_other(con) -> Result:
    """BIS all-reporter loans and deposits on an economy do not exceed its IIP other-investment loans plus deposits
    liabilities (tolerance 0.5% + 0.1 bn), at the newest common quarter. A warning: the exceptions are scope (Bermuda,
    Liberia, Samoa: the IIP does not cover the borrowers) and the euro-area aggregate (intra-area claims)."""
    rows = con.execute("""
        WITH l AS (SELECT debtor economy, period, position_usd lbs FROM links_m WHERE dataset = 'bis.LBS' AND channel = 'bank' AND basis = 'residence' AND creditor = 'BIS:5A' AND NOT agg_debtor),
             i AS (SELECT economy, period, sum(position_usd) FILTER (WHERE item = 'other_loans') loans, sum(position_usd) FILTER (WHERE item = 'other_deposits') deposits
                   FROM totals_m WHERE dataset = 'imf.IIP' AND side = 'liabilities' GROUP BY ALL),
             x AS (SELECT l.economy, l.period, l.lbs, i.loans, i.deposits, row_number() OVER (PARTITION BY l.economy ORDER BY l.period DESC) r FROM l JOIN i USING (economy, period)
                   WHERE i.loans IS NOT NULL AND i.deposits IS NOT NULL AND l.period >= '2015-01-01')
        SELECT economy, period, lbs, loans, deposits FROM x WHERE r = 1 ORDER BY lbs - loans - deposits DESC""").fetchall()
    bad = [{"economy": e, "period": str(p), "lbs_loans_deposits": round(lbs, 1), "iip_loans": round(lo, 1), "iip_deposits": round(de, 1), "excess": round(lbs - lo - de, 1)}
           for e, p, lbs, lo, de in rows if lbs > (lo + de) * 1.005 + 0.1]
    if bad:
        return Result("V15", "warning", f"{len(bad)} of {len(rows)} economies have more BIS loans and deposits on them than IIP loans plus deposits (scope differences; the bank tooltip shows both).", bad, len(bad))
    return Result("V15", "pass", f"BIS loans and deposits stay within IIP loans plus deposits for all {len(rows)} economies.", observed=0)


@check("V16")
def v16_publisher_identities(con) -> Result:
    """Identities on the publishers' own data, exact to 0.1 bn: the BIS all-reporter figure is never below the sum of its
    bilateral reporters (loans and deposits, every debtor-quarter); the IMF's own derived portfolio liability of an
    economy (PIP, entry L, counterpart world) equals the sum of what reporting holders say they hold plus the
    reserves-and-IO group (every debtor at the newest December). These are independent of anything we wrote down."""
    bad = []
    for e, p, bil, all_ in con.execute("""
        WITH b AS (SELECT debtor, period, sum(position_usd) bil FROM links_m WHERE dataset = 'bis.LBS' AND channel = 'bank' AND basis = 'residence' AND NOT agg_creditor AND NOT agg_debtor GROUP BY ALL)
        SELECT b.debtor, b.period, b.bil, a.position_usd FROM b JOIN links_m a ON a.dataset = 'bis.LBS' AND a.channel = 'bank' AND a.basis = 'residence' AND a.creditor = 'BIS:5A' AND a.debtor = b.debtor AND a.period = b.period
        WHERE b.period >= '2015-01-01' AND b.bil > a.position_usd + 0.1 ORDER BY b.bil - a.position_usd DESC""").fetchall():
        bad.append({"test": "LBS bilateral sum <= all reporters", "economy": e, "period": str(p), "bilateral": round(bil, 1), "all_reporters": round(all_, 1)})
    n_lbs = con.execute("SELECT count(*) FROM links_m WHERE dataset = 'bis.LBS' AND channel = 'bank' AND basis = 'residence' AND creditor = 'BIS:5A' AND NOT agg_debtor AND period >= '2015-01-01'").fetchone()[0]
    rows = con.execute("""
        WITH c AS (SELECT debtor economy, period, sum(position_usd) ours FROM links_m WHERE dataset = 'imf.PIP' AND channel = 'portfolio' AND (NOT agg_creditor OR creditor = 'IMF:TX093')
                   AND creditor <> debtor GROUP BY ALL),
             x AS (SELECT c.economy, c.period, c.ours, t.position_usd imf, row_number() OVER (PARTITION BY c.economy ORDER BY c.period DESC) r FROM c
                   JOIN totals_m t ON t.economy = c.economy AND t.period = c.period AND t.dataset = 'imf.PIP' AND t.item = 'portfolio_derived'
                   WHERE c.economy NOT IN (SELECT code FROM economies WHERE is_aggregate))
        SELECT economy, period, ours, imf FROM x WHERE r = 1""").fetchall()
    for e, p, ours, imf in rows:
        ours, imf = float(ours), float(imf)
        if abs(ours - imf) > 0.1:
            bad.append({"test": "CPIS derived liability = holders + reserves/IO group", "economy": e, "period": str(p), "ours": round(ours, 1), "imf": round(imf, 1), "diff": round(ours - imf, 1)})
    if bad:
        return Result("V16", "fail", f"{len(bad)} identity failure(s) on the publishers' own data.", bad, len(bad))
    return Result("V16", "pass", f"Both identities hold: BIS all-reporter >= bilateral sum in {n_lbs:,} debtor-quarters; the IMF derived liability equals holders plus the reserves/IO group for {len(rows)} economies.", observed=0)


def summary(results: list[Result]) -> dict:
    return {"pass": sum(r.status == "pass" for r in results), "warning": sum(r.status == "warning" for r in results),
            "info": sum(r.status == "info" for r in results), "fail": sum(r.status == "fail" for r in results)}


def finite(x) -> bool:
    return isinstance(x, (int, float)) and math.isfinite(x)


@check("V17")
def v17_source_links() -> Result:
    """Every panel's source links resolve in the registry (config/sources.yaml `links`, `panels`), and every entry has
    both labels, both names and an https URL. The pages render source labels only from these entries."""
    links, panels = SOURCES.get("links") or {}, SOURCES.get("panels") or {}
    bad = []
    for lid, e in sorted(links.items()):
        for f in ("label", "name"):
            if not all((e.get(f) or {}).get(l) for l in ("en", "ko")):
                bad.append({"link": lid, "problem": f"no {f} in both languages"})
        if not str(e.get("url") or "").startswith("https://"):
            bad.append({"link": lid, "problem": "no https URL"})
        if e.get("dataset") and e["dataset"] not in SOURCES["datasets"]:
            bad.append({"link": lid, "problem": f"dataset {e['dataset']} is not in the registry"})
    for pid, p in sorted(panels.items()):
        if not p.get("links"):
            bad.append({"panel": pid, "problem": "names no source"})
        for lid in p.get("links") or []:
            if lid not in links:
                bad.append({"panel": pid, "problem": f"link {lid} is not in the registry"})
    if bad:
        return Result("V17", "fail", f"{len(bad)} source-link findings.", bad, len(bad))
    return Result("V17", "pass", f"{len(panels)} panels name {len({l for p in panels.values() for l in p['links']})} of {len(links)} registry links; "
                  "every entry has labels, names and a URL.", observed=0)


# ---------------------------------------------------------------------- the Signal Board (method 1.2)
@check("V18")
def v18_board_complete(board: dict) -> Result:
    """Every economy drawn in a quarter has its scored indicators (A1; A2 where scored), at least one buffer and its
    score; a row without a flow score is drawn as scored and listed in `no_flow` with its reason (method 1.6: a missing
    unscored component no longer drops the row), and a row with a flow has B1 and B2. The ones left out are listed with
    their reason for the newest quarter, never drawn with zeros."""
    cols = board.get("cols") or []
    ix = {k: cols.index(k) for k in cols}
    need = ("v", "exp", "buf", "s1", "a1", "size")
    bad = []
    for q, x in sorted((board.get("q") or {}).items()):
        for r in x["rows"]:
            miss = [k for k in need if r[ix[k]] is None]
            if r[ix["a2_scored"]] and (r[ix["s2"]] is None or r[ix["a2"]] is None):
                miss.append("A2")
            if r[ix["wn"]] is None and r[ix["wc"]] is None:
                miss.append("buffers")
            if r[ix["flow"]] is not None and (r[ix["b1"]] is None or r[ix["b2"]] is None):
                miss.append("B1 or B2 behind a flow")
            if r[ix["flow"]] is None and not any(e == r[0] for e, _ in x.get("no_flow", [])):
                miss.append("flow (not listed in no_flow)")
            if miss:
                bad.append({"quarter": q, "economy": r[0], "missing": miss})
    if bad:
        return Result("V18", "fail", f"{len(bad)} economy-quarters drawn with a missing component.", bad, len(bad))
    last = max(board["q"]) if board.get("q") else None
    drops = [{"economy": e, "reason": why, "quarter": last} for e, why in (board["q"][last]["drop"] if last else [])]
    n = board["q"][last]["n"] if last else 0
    nf = [{"economy": e, "reason": why, "quarter": last, "drawn": "without a flow"} for e, why in (board["q"][last].get("no_flow", []) if last else [])]
    if drops or nf:
        return Result("V18", "info", f"{n} economies drawn in {last}; {len(drops)} left out with a logged reason (a scored component missing); "
                                     f"{len(nf)} drawn without a flow score, marked.", drops + nf, len(drops) + len(nf))
    return Result("V18", "pass", f"{n} economies drawn in {last}, each with its scored indicators, a buffer and both flows.", observed=0)


@check("V19")
def v19_adjusted_flows(con) -> Result:
    """B1 is the BIS FX- and break-adjusted change, not a difference of positions: the stored reading from the BIS
    (config/method.yaml, V19 `reference`) equals our value, and differs from the change of the positions."""
    ref = METHOD["checks"]["V19"]["reference"]
    got = con.execute("""SELECT max(value_usd) FILTER (WHERE measure = 'lbs_loans_flow' AND period = ?), max(value_usd) FILTER (WHERE measure = 'lbs_loans' AND period = ?),
                                max(value_usd) FILTER (WHERE measure = 'lbs_loans' AND period = ?)
                         FROM signals_m WHERE economy = ? AND currency = 'all'""", [ref["period"], ref["period"], ref["previous"], ref["economy"]]).fetchone()
    flow, pos, prev = got
    d = {"economy": ref["economy"], "period": str(ref["period"]), "bis_mn": ref["value_mn"], "ours_mn": None if flow is None else round(flow * 1e3, 3),
         "position_change_mn": None if pos is None or prev is None else round((pos - prev) * 1e3, 3), "read": str(ref["read"]), "url": ref["url"]}
    if flow is None:
        return Result("V19", "fail", f"No adjusted change for {ref['economy']} {ref['period']} in the tables.", [d])
    rel = abs(flow * 1e3 - ref["value_mn"]) / max(abs(ref["value_mn"]), 1e-9)
    if rel > 0.005:
        return Result("V19", "fail", f"{ref['economy']} {ref['period']}: ours {flow * 1e3:,.3f} mn against the BIS's {ref['value_mn']:,.3f} mn "
                                     f"(read {ref['read']}); a BIS revision means a new reading.", [d], round(rel * 100, 3))
    return Result("V19", "pass", f"{ref['economy']} {ref['period']}: {flow * 1e3:,.3f} mn, as the BIS publishes it (read {ref['read']}); the change of "
                                 f"the positions would be {d['position_change_mn']:,.3f} mn.", [d], round(rel * 100, 4))


@check("V20")
def v20_disjoint(spec: dict) -> Result:
    """No series is used on both sides of A3, or in both B1 and B2: debt securities (BIS DSS) and loans and deposits
    (BIS LBS instrument G) are disjoint instruments. Read from config/datasets.yaml `signals`."""
    lbs = spec["bis.LBS"]["filter"].get("L_INSTR")
    dss = spec["bis.DSS"]["slices"]["ids_nat"]
    a3_num, a3_den_extra = {("bis.DSS", "ids_nat")}, {("bis.LBS", f"L_INSTR={lbs}")}
    b1, b2 = {("bis.LBS", f"L_INSTR={lbs}")}, {("bis.DSS", "ids_nat")}
    bad = []
    if lbs != "G":
        bad.append(f"LBS instrument is {lbs}, not G (loans and deposits): all instruments include banks' holdings of debt securities")
    if a3_num & a3_den_extra:
        bad.append("A3 numerator and denominator share a series")
    if b1 & b2:
        bad.append("B1 and B2 share a series")
    if "G" not in (dss.get("MEASURE") or []):
        bad.append("B2 is not the DSS net issues")
    if bad:
        return Result("V20", "fail", "; ".join(bad), bad, len(bad))
    return Result("V20", "pass", "A3 and the flow score add BIS DSS debt securities to BIS LBS loans and deposits (instrument G): disjoint instruments, no series on both sides.", observed=0)


@check("V21")
def v21_pulse_fresh(pulse: dict, day: dt.date) -> Result:
    """Each weekly or daily pulse tile's newest value is at most 10 days old at build time; an older one carries a stale
    warning on its tile. A series not yet collected is listed."""
    late = [{"series": k, "key": v.get("key"), "latest": (v.get("latest") or [None])[0], "age_days": v.get("age"), "missing": bool(v.get("missing"))}
            for k, v in sorted(pulse.items()) if k != "tic" and (v.get("missing") or v.get("stale"))]
    if late:
        return Result("V21", "warning", f"{len(late)} pulse tile(s) older than 10 days or not collected; the tiles say so.", late, len(late))
    return Result("V21", "pass", f"Every weekly and daily pulse tile is at most 10 days old on {day}.", observed=0)


@check("V22")
def v22_no_extremes_from_tiny_moves(board: dict) -> Result:
    """The score cannot reach 0 or 100 from a tiny move in a narrow history (method 1.3, R18): for every drawn
    economy-quarter and every own-history signal, the scale is at least the indicator's floor, and a signal at its cap
    (0 or 100) sits at least Z_CAP floors from the economy's own median. Recomputed from the shipped columns."""
    from .rules import OWN_FLOOR, Z_CAP
    cols = board.get("cols") or []
    ix = {k: cols.index(k) for k in cols}
    bad, capped, n = [], 0, 0
    for q, x in sorted((board.get("q") or {}).items()):
        for r in x["rows"]:
            for i, k in (("1", "a1"), ("2", "a2")):
                o, m, sc, v = r[ix[f"o{i}"]], r[ix[f"m{i}"]], r[ix[f"sc{i}"]], r[ix[k]]
                if k == "a1" and "o1x" in ix and r[ix["o1x"]]:
                    v = r[ix["a1x"]]                               # method 1.6: A1's own history on the cross-border-only A1
                if o is None:
                    continue
                n += 1
                if sc is None or sc < OWN_FLOOR[k] - 0.005:
                    bad.append({"quarter": q, "economy": r[0], "indicator": k, "scale": sc, "floor": OWN_FLOOR[k]})
                elif o <= 0.005 or o >= 99.995:
                    capped += 1
                    if abs(v - m) < Z_CAP * OWN_FLOOR[k] - 0.02:
                        bad.append({"quarter": q, "economy": r[0], "indicator": k, "value": v, "median": m, "signal": o, "floor": OWN_FLOOR[k]})
            if not 0 <= (r[ix["v"]] or 0) <= 100:
                bad.append({"quarter": q, "economy": r[0], "score": r[ix["v"]]})
    if bad:
        return Result("V22", "fail", f"{len(bad)} own-history signals below their floor or at a cap from a small move.", bad[:50], len(bad))
    return Result("V22", "pass", f"{n} own-history signals, each with a scale at or above its floor ({', '.join(f'{k} {v:g}' for k, v in OWN_FLOOR.items())}); "
                                 f"{capped} at a cap, each at least {Z_CAP:g} floors from its own median.", observed=0)


@check("V27")
def v27_net_reserves(board: dict, lender_cut: dict | None = None) -> Result:
    """Net reserves and A2's reserve base (method 1.6): on every board row, `res_net_raw` is IRFCL
    Section I plus Section II (`res` + `res_drains`, empty where Section II is not published); A2's base `res_net` equals
    it unless the floor binds, in which case `a2_floored` is 1 and the base is RES_FLOOR × gross reserves, above the raw
    value; no row is floored without its flag. The lender cut carries the same raw value as the board."""
    cols = board.get("cols") or []
    ix = {k: cols.index(k) for k in cols}
    bad, n, floored = [], 0, 0
    tol = 0.011                                                    # the published columns are rounded to 0.01
    for q, x in sorted((board.get("q") or {}).items()):
        for r in x["rows"]:
            res, dr, raw, base, fl, basis = (r[ix[k]] for k in ("res", "res_drains", "res_net_raw", "res_net", "a2_floored", "a2_basis"))
            if res is None:
                continue
            n += 1
            want = None if dr is None else res + dr
            if (want is None) != (raw is None) or (want is not None and abs(want - raw) > tol):
                bad.append({"quarter": q, "economy": r[0], "problem": "res_net_raw is not Section I + Section II", "res": res, "drains": dr, "res_net_raw": raw})
                continue
            if base is None:
                continue
            if fl:
                floored += 1
                if abs(base - rules.RES_FLOOR * res) > tol or (raw is not None and raw > base + tol):
                    bad.append({"quarter": q, "economy": r[0], "problem": "floored base is not a tenth of gross reserves above net", "res": res, "res_net": base, "res_net_raw": raw})
            elif basis == "net" and abs(base - raw) > tol:
                bad.append({"quarter": q, "economy": r[0], "problem": "A2's base differs from net reserves without the floor flag", "res_net": base, "res_net_raw": raw})
            elif basis == "net" and raw < rules.RES_FLOOR * res - tol:
                bad.append({"quarter": q, "economy": r[0], "problem": "net reserves below the floor but A2 not flagged", "res": res, "res_net_raw": raw})
    if lender_cut:
        last = {}
        for q in sorted(board.get("q") or {}):
            if q <= lender_cut.get("q", ""):
                for r in board["q"][q]["rows"]:
                    last[r[0]] = r[ix["res_net_raw"]]
        for e, d in (lender_cut.get("debtors") or {}).items():
            want = last.get(e)
            got = d.get("res_net_raw")
            if (want is None) != (got is None) or (want is not None and abs(want - got) > 0.051):
                bad.append({"economy": e, "problem": "lender cut's res_net_raw differs from the board", "board": want, "lender_cut": got})
    if bad:
        return Result("V27", "fail", f"{len(bad)} net-reserve values break the rule (Section I + II, floor only in A2 and flagged).", bad[:50], len(bad))
    return Result("V27", "pass", f"{n} board rows with reserves: res_net_raw = Section I + Section II wherever both are published; "
                                 f"{floored} floored A2 bases, each flagged and above net reserves.", observed=floored)


# ---------------------------------------------------------------------- method 1.5: the earnings frame and the sovereign validation
Q_TOL = 0.03                                                       # V23: a quarterly series matches WDI when the median ratio of its calendar-year sums is within ±3%
Q_WDI = {"xu": ("x", "BX.GSR.GNFS.CD"), "mu": ("m", "BM.GSR.GNFS.CD"), "pi": ("pi", "BN.GSR.FCTY.CD"), "gdp": ("gdp", "NY.GDP.MKTP.CD")}


def _q_index(p: str) -> int:
    return int(p[:4]) * 4 + int(p[-1]) - 1


def v23_frame(earn: dict) -> list[dict]:
    """The quarterly frame against WDI, one row per economy and series (global-network's build_earn_q check, ported):
    for every candidate unit, the IMF quarterly series converted to dollars at the BIS quarterly average rate, summed over
    the four quarters of each calendar year, over the WDI annual figure; the unit whose median ratio is nearest one is
    chosen and passes when within Q_TOL."""
    qf, S = earn["quarterly"], earn["wdi"]["series"]
    fx_all = qf["fx"]
    eur = fx_all.get("XM", {}).get("EUR", {}).get("obs", {})

    def fx_of(e: str, unit: str):
        if unit == "USD":
            return None
        own = fx_all.get(e, {})
        if unit == "EUR":
            return own["EUR"]["obs"] if "EUR" in own else eur
        return next(iter(own.values()))["obs"] if len(own) == 1 else {}

    def to_usd(e: str, unit: str, obs: dict) -> dict[int, float]:
        f = fx_of(e, unit)
        if f is None:
            return {_q_index(p): v for p, v in obs.items()}
        return {_q_index(p): v / f[p] for p, v in obs.items() if f.get(p)}

    def sum4(s, i: int):
        if not s:
            return None
        xs = [s.get(i - k) for k in range(4)]
        return None if any(x is None for x in xs) else sum(xs)

    def one(e: str, key: str, cands: dict[str, dict[int, float]]) -> dict:
        wk, wid = Q_WDI[key]
        ref = S[wk].get(e, {})
        best = None
        for unit, s in cands.items():
            rs = sorted(a / v for y, v in ref.items() if v and (a := sum4(s, int(y) * 4 + 3)) is not None)
            if not rs:
                continue
            h = len(rs) // 2
            m = rs[h] if len(rs) % 2 else (rs[h - 1] + rs[h]) / 2
            if best is None or abs(m - 1) < abs(best[1] - 1):
                best = (unit, m, len(rs))
        if best is None:
            return {"economy": e, "series": key, "median_ratio": None, "unit_used": None, "ok": False,
                    "note": f"no year overlaps {wid}" if cands else "no IMF series with values"}
        unit, m, n = best
        ok = abs(m - 1) <= Q_TOL
        return {"economy": e, "series": key, "median_ratio": round(m, 4), "unit_used": unit, "ok": ok,
                "note": f"{n} years vs {wid}" + ("" if ok else f"; outside ±{Q_TOL:.0%}, series withheld")}

    rows = []
    for e in qf["economies"]:
        by: dict = defaultdict(dict)
        for s in qf["bop"].get(e, {}).values():
            by[(s["indicator"], s["entry"])][s["unit"]] = to_usd(e, s["unit"], s["obs"])
        cr, db = by[("IN1", "CD_T")], by[("IN1", "DB_T")]
        net = {u: {i: cr[u][i] - db[u][i] for i in cr[u] if i in db[u]} for u in cr if u in db}
        gdp_c = {k: to_usd(e, k, g["obs"]) for k, g in qf["gdp"].get(e, {}).items()}
        for key, cands in (("xu", by[("GS", "CD_T")]), ("mu", by[("GS", "DB_T")]), ("pi", net), ("gdp", gdp_c)):
            rows.append(one(e, key, cands))
    return rows


@check("V23")
def v23_wdi_vs_qnea(earn: dict) -> Result:
    """The IMF quarterly series of earn/global (BOP credits and debits, net primary income, QNEA GDP) against the World
    Bank WDI annual figures, calendar-year sums at the BIS quarterly average rate, within 3% on the median ratio; an
    economy-series outside it is listed as withheld (India's QNEA GDP: fiscal-year quarters)."""
    rows = v23_frame(earn)
    bad = [r for r in rows if not r["ok"]]
    held = sorted(f"{r['economy']} {r['series']}" for r in bad)
    if bad:
        return Result("V23", "warning", f"{len(rows) - len(bad)} of {len(rows)} economy-series match WDI within {Q_TOL:.0%}; {len(bad)} withheld: {', '.join(held[:12])}"
                                        f"{'…' if len(held) > 12 else ''}.", rows, len(bad))
    return Result("V23", "pass", f"All {len(rows)} economy-series of the quarterly frame match WDI within {Q_TOL:.0%} on the median ratio.", rows, 0)


@check("V24")
def v24_sovereign_rates(sov: dict) -> Result:
    """The sovereign count's hit rate and false-signal rate with the default thresholds (information)."""
    v, K = sov["valid"], sov["K"]["default"]
    d = {k: v.get(k) for k in ("episodes", "scored", "hits", "hit_rate", "calm", "alarms", "false_rate", "pos_years")}
    per = [p for p in v.get("per", []) if p.get("data")]
    return Result("V24", "info", f"K = {K} rules on: {v['hits']} of {v['scored']} distress spells with data had an alert one to three years before "
                                 f"(hit rate {v['hit_rate']}%); {v['alarms']} of {v['calm']} calm years had one (false-signal rate {v['false_rate']}%). "
                                 f"{v['episodes']} spells since {sov['years'][0]}, WEO vintage {sov['meta']['vintage']}.", [d] + per, v.get("hit_rate"))


@check("V25")
def v25_sovereign_auroc(sov: dict) -> Result:
    """The AUROC of the sovereign count, pre-episode years against calm years; a warning below 0.5, never blocking."""
    v = sov["valid"]
    a = v.get("auroc")
    d = {"auroc": a, "pos_years": v.get("pos_years"), "calm_years": v.get("calm"), "K": sov["K"]["default"]}
    if a is None:
        return Result("V25", "warning", "No AUROC: no pre-episode or no calm years with data.", [d], None)
    if a < 0.5:
        return Result("V25", "warning", f"AUROC {a:.3f} on {v['pos_years']} pre-episode years against {v['calm']} calm years: the count separates them no better than "
                                        "chance; the page says so.", [d], a)
    return Result("V25", "info", f"AUROC {a:.3f} on {v['pos_years']} pre-episode years against {v['calm']} calm years (0.5 = chance).", [d], a)


@check("V26")
def v26_sovereign_expectations(sov: dict) -> Result:
    """The expectations written before the Sovereign section was built, recomputed: each passes or fails; a failure warns."""
    rows = [{"id": c["id"], "economy": c["eco"], "ok": c["ok"], "en": c["en"], "years": c["years"],
             "rows": [{"y": r["y"], "k": r["k"], "n": r["n"], "on": r["on"], "ok": r["ok"]} for r in c["rows"]]} for c in sov["checks"]]
    failed = [r["id"] for r in rows if not r["ok"]]
    if failed:
        return Result("V26", "warning", f"{len(failed)} of {len(rows)} pre-written expectations fail with the default thresholds: {', '.join(failed)}; the page prints each.", rows, len(failed))
    return Result("V26", "pass", f"All {len(rows)} pre-written expectations hold with the default thresholds.", rows, 0)
