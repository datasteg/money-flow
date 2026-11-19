"""The Sovereign section (view sovereign/global): seven threshold rules over long history, counted, beside past bailouts
and defaults. Rules R22–R28 of config/method.yaml, one function each; ported on 2 Nov 2026 from global-network's
scripts/warning.py with the output object unchanged, so the page could follow.

Reads
  config/sovereign.yaml            economies, rule defaults and slider ranges, benchmark, validation windows, expectations
  config/sovereign_episodes.yaml   the hand-checked episodes (IMF arrangements, euro-area and EU programmes, defaults,
                                   precautionary lines), one source URL each
  config/sovereign_glossary.yaml   every tooltip of the page, English and Korean, with example placeholders filled here
  $MONEY_FLOW_DATA_ROOT/external/warning/<date>.json   the newest fetch (scripts/fetch_warning.py): WEO, IMF IIP, FRED yields
  the Signal Board's history (views.board_series): A2, the current account and net IIP as the release publishes them

Simple arithmetic only: ratios, differences, threshold comparisons; no fitted model. Nothing here enters the board's
score or flow (R17, R18). The validation (hit rate, false-signal rate, AUROC, the pre-written expectations) is
reported by checks V24–V26 and never blocks a release.

    uv run -q --with brotli==1.1.0 --with duckdb==1.5.6 --with pyyaml==6.0.3 --with pyarrow==21.0.0 scripts/sitebuild/sovereign.py
                                                           # the coverage report and the expectations, from the latest release
"""
from __future__ import annotations

import datetime as dt
import json
import math
import os
import re
import sys
from pathlib import Path

import yaml

from .josa import josa
from .registry import CONFIG, effect, rule

ROOT = Path(os.environ.get("MONEY_FLOW_DATA_ROOT", "data"))
EXTERNAL = ROOT / "external" / "warning"
CFG_PATH = CONFIG / "sovereign.yaml"
EPISODES_PATH = CONFIG / "sovereign_episodes.yaml"
GLOSSARY_PATH = CONFIG / "sovereign_glossary.yaml"
RULES = ["r1", "r2", "r3", "r4", "r5", "r6", "r7"]           # the page's ids; R22..R28 in the method registry
METHOD_IDS = dict(zip(RULES, ("R22", "R23", "R24", "R25", "R26", "R27", "R28")))
RULES_FN = dict(zip(RULES, ("r22_debt_level", "r23_deficit", "r24_debt_snowball", "r25_current_account", "r26_net_iip", "r27_liquidity", "r28_spread")))
MIN_MONTHS = 6                                                # months a year needs for an annual spread (R28)
FRESH_MONTHS = 2                                              # a spread ending more than this many months before the newest one is not "now"


def R(x, n=2):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(x, n)


def config() -> dict:
    return yaml.safe_load(CFG_PATH.read_text(encoding="utf-8"))


def newest_file(folder: Path = EXTERNAL) -> Path | None:
    files = sorted(folder.glob("*.json"))
    return files[-1] if files else None


# ---------------------------------------------------------------- the rules, one function each (R22–R28)
def rule_on(v, thr: float, dirn: str):
    """Whether a value turns a rule on (`dir` ge or le); None when the value is missing."""
    if v is None:
        return None
    return v >= thr if dirn == "ge" else v <= thr


@rule("R22")
def r22_debt_level(debt_pct_gdp: float | None) -> float | None:
    """Sovereign rule 1: general government gross debt / GDP (WEO GGXWDG_NGDP), as published, two decimals."""
    return R(debt_pct_gdp, 2)


@rule("R23")
def r23_deficit(balance_pct_gdp: float | None) -> float | None:
    """Sovereign rule 2: general government net lending (+) / borrowing (−) / GDP (WEO GGXCNL_NGDP), two decimals."""
    return R(balance_pct_gdp, 2)


@rule("R24")
def r24_debt_snowball(d_prev, pb, ob, ngdp, ngdp_prev) -> dict | None:
    """Sovereign rule 3: the debt-stabilising primary balance and the gap, all in % of GDP, from WEO ratios and GDP in
    levels. d_prev: gross debt / GDP the year before (%); pb, ob: primary and overall balance / GDP (%); ngdp, ngdp_prev:
    nominal GDP in national currency. Returns dict(i, g, pbstar, gap, interest) or None when an input is missing."""
    if None in (d_prev, pb, ob, ngdp, ngdp_prev) or not ngdp_prev or not d_prev:
        return None
    interest = (pb - ob) / 100 * ngdp                # interest paid, national currency
    debt_prev = d_prev / 100 * ngdp_prev             # debt at the end of last year, national currency
    i = interest / debt_prev                         # effective interest rate on last year's debt
    g = ngdp / ngdp_prev - 1                         # nominal GDP growth
    pbstar = d_prev * (i - g) / (1 + g)              # % of GDP: the primary balance that holds the debt ratio steady
    return {"i": 100 * i, "g": 100 * g, "pbstar": pbstar, "gap": pbstar - pb, "interest": pb - ob}


@rule("R25")
def r25_current_account(three: list[tuple[float | None, str | None]]) -> tuple[float | None, str | None]:
    """Sovereign rule 4: the three-year average of the current account / GDP from three (value, source) pairs, oldest
    first; the source is 'mf' when all three come from the Signal Board, 'weo' when all three exist but not all from
    the board, None when a year is missing (then the average is missing too)."""
    if len(three) != 3 or any(x[0] is None for x in three):
        return None, None
    src = "mf" if all(x[1] == "mf" for x in three) else ("weo" if all(x[1] for x in three) else None)
    return R(sum(x[0] for x in three) / 3, 2), src


@rule("R26")
def r26_net_iip(niip_board: float | None, iip: list | tuple | None, gdp_usd: float | None, projection: bool = False) -> tuple[float | None, str | None]:
    """Sovereign rule 5: net IIP / GDP at the year end. The Signal Board's figure (already % of GDP) where it has the
    year, else IMF IIP (assets, liabilities; USD bn) less each other over the WEO's dollar GDP (USD units). Projection
    years have no value. Returns (value, source: 'mf' | 'iip' | None)."""
    if projection:
        return None, None
    if niip_board is not None:
        return R(niip_board, 1), "mf"
    if iip and None not in iip and gdp_usd:
        return R(100 * (iip[0] - iip[1]) / (gdp_usd / 1e9), 1), "iip"
    return None, None


@rule("R27")
def r27_liquidity(a2: float | None, scored, projection: bool = False) -> tuple[float | None, bool]:
    """Sovereign rule 6: the board's A2 at the fourth quarter (short-term claims / net reserves, method 1.4), in per
    cent; (value, not applicable). Not applicable where the board does not score A2 (a2_scored == 0); missing in a
    projection year or where the board has no row."""
    na = scored == 0
    if projection or a2 is None:
        return None, na
    return R(a2, 1), na


def spread_months(own: dict[str, float] | None, bench: dict[str, float] | None) -> dict[str, float] | None:
    """Monthly spreads (own − benchmark, three decimals) for the months both series have; None without both."""
    if not own or not bench:
        return None
    ks = sorted(k for k in own if k in bench)
    return {k: round(own[k] - bench[k], 3) for k in ks}


@rule("R28")
def r28_spread(sm: dict[str, float] | None, year: int, min_months: int = MIN_MONTHS) -> tuple[float | None, int]:
    """Sovereign rule 7: the annual spread of `year`, the average of its monthly spreads (spread_months) over the months
    both series have, at least `min_months`; (value, number of months)."""
    ms = [sm[f"{year}-{m:02d}"] for m in range(1, 13) if sm and f"{year}-{m:02d}" in sm]
    return (R(sum(ms) / len(ms), 2) if len(ms) >= min_months else None), len(ms)


# ---------------------------------------------------------------- inputs
def year_end_index(qs: list[str], y: int):
    for k in range(len(qs) - 1, -1, -1):
        if qs[k] == f"{y}-12-31":
            return k
    return None


def runs(years: list[int]) -> list[list[int]]:
    """Consecutive runs of years, as [first, last] pairs."""
    out: list[list[int]] = []
    for y in years:
        if out and y == out[-1][1] + 1:
            out[-1][1] = y
        else:
            out.append([y, y])
    return out


def load_episodes(cfg: dict, econs: list[str], path: Path = EPISODES_PATH, today: str | None = None) -> tuple[list[dict], list[dict]]:
    """(episodes for shading, distress spells for validation). Precautionary lines are shaded but never validated."""
    if not path.exists():
        print("  sovereign: no config/sovereign_episodes.yaml: no episodes shaded or validated", file=sys.stderr)
        return [], []
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    eps = []
    for e in raw:
        if e.get("eco") not in econs:
            continue
        s = str(e["start"])
        en = str(e["end"]) if e.get("end") else None
        eps.append({"id": e["id"], "eco": e["eco"], "type": e["type"], "facility": e.get("facility"), "start": s[:10], "end": en[:10] if en else None,
                    "end_kind": e.get("end_kind"), "precision": e.get("precision", "day"), "en": e.get("en"), "ko": e.get("ko"),
                    "source": e.get("source"), "source2": e.get("source2"), "note": e.get("note"), "creditor": e.get("creditor"),
                    "before_sample": bool(e.get("before_sample")), "agreed": e.get("agreed"), "drawn": e.get("drawn")})
    eps.sort(key=lambda e: (e["eco"], e["start"]))
    # distress spells: merge an entry that starts while another runs, or within merge_years of its end
    merge = cfg["validation"]["merge_years"]
    today = today or dt.date.today().isoformat()
    spells: list[dict] = []
    for e in eps:
        if e["type"] == "precautionary":
            continue
        end = e["end"] or today
        last = next((s for s in reversed(spells) if s["eco"] == e["eco"]), None)
        if last and int(e["start"][:4]) <= int(last["end"][:4]) + merge and e["start"] >= last["start"]:
            last["end"] = max(last["end"], end)
            last["ids"].append(e["id"])
            continue
        spells.append({"eco": e["eco"], "start": e["start"], "end": end, "ids": [e["id"]], "before_sample": e["before_sample"]})
    for s in spells:
        s["y0"], s["y1"] = int(s["start"][:4]), int(s["end"][:4])
    return eps, spells


# ---------------------------------------------------------------- counting (the page's model.ts mirrors this)
def counts(econ: dict, years: list[int], rules: dict, thr: dict | None = None, enabled: list[str] | None = None):
    """Per year: (k on, n available, on-rule ids). A rule not applicable, missing or switched off is not available."""
    thr = thr or {r: rules[r]["default"] for r in RULES}
    enabled = enabled or RULES
    out = []
    for j, _ in enumerate(years):
        on, n = [], 0
        for r in enabled:
            if econ["na"][r][j]:
                continue
            o = rule_on(econ["v"][r][j], thr[r], rules[r]["dir"])
            if o is None:
                continue
            n += 1
            if o:
                on.append(r)
        out.append((len(on), n, on))
    return out


def auroc(pos: list[float], neg: list[float]):
    if not pos or not neg:
        return None
    gt = eq = 0
    for p in pos:
        for q in neg:
            gt += p > q
            eq += p == q
    return (gt + 0.5 * eq) / (len(pos) * len(neg))


def validate(econs_d: dict, years: list[int], last_actual: int, spells: list[dict], cfg: dict, rules: dict, K: int):
    """Hit rate (spells with an alert in the 1-3 years before the start), false-alarm rate (calm years with an alert) and
    the AUROC of the count (pre-window years against calm years). Projections and years with no rule available are
    left out."""
    v = cfg["validation"]
    a, b = v["pre"]
    gy = set(v["global_years"])
    yi = {y: j for j, y in enumerate(years)}
    hits, scored, pos_scores, neg_scores, alarms = 0, 0, [], [], 0
    per = []
    for s in spells:
        if s["before_sample"] or s["eco"] not in econs_d:
            continue
        c = econs_d[s["eco"]]["_counts"]
        win = [y for y in range(s["y0"] - b, s["y0"] - a + 1) if years[0] <= y <= last_actual]
        have = [y for y in win if c[yi[y]][1] > 0]
        if not have:
            per.append({"eco": s["eco"], "start": s["start"], "data": False})
            continue
        scored += 1
        hit = any(c[yi[y]][0] >= K for y in have)
        hits += hit
        pos_scores += [c[yi[y]][0] for y in have]
        per.append({"eco": s["eco"], "start": s["start"], "data": True, "hit": hit, "max": max(c[yi[y]][0] for y in have)})
    calm_n = 0
    for e, d in econs_d.items():
        own = [s for s in spells if s["eco"] == e]
        c = d["_counts"]
        for y in years:
            if y > last_actual or y in gy or c[yi[y]][1] == 0:
                continue
            if any(s["y0"] - v["calm_gap"] <= y <= s["y1"] + v["calm_gap"] for s in own):
                continue
            calm_n += 1
            neg_scores.append(c[yi[y]][0])
            alarms += c[yi[y]][0] >= K
    return {"episodes": sum(1 for s in spells if not s["before_sample"]), "scored": scored, "hits": hits,
            "hit_rate": R(100 * hits / scored, 1) if scored else None, "calm": calm_n, "alarms": alarms,
            "false_rate": R(100 * alarms / calm_n, 1) if calm_n else None, "pos_years": len(pos_scores),
            "auroc": R(auroc(pos_scores, neg_scores), 3), "per": per}


# ---------------------------------------------------------------- the build
def build(board: dict, names: dict, source: Path | None = None, quiet: bool = False) -> dict:
    """The sovereign/global object. board: views.board_series(...)[1] (per economy: q, a2, a2_scored, niip, ca, ...);
    names: {ISO3: {en, ko, ...}}; source: the warning file (default: the newest in EXTERNAL)."""
    cfg = config()
    rules = cfg["rules"]
    econs = cfg["economies"]
    f = source or newest_file()
    if not f:
        sys.exit(f"no warning file in {EXTERNAL}: run scripts/fetch_warning.py first")
    w = json.loads(f.read_text(encoding="utf-8"))
    W = w["weo"]["series"]
    this_year = int(w["weo"]["published"][:4]) if w["weo"].get("published") else dt.date.today().year
    proj0 = this_year                                   # WEO projections: the publication year and after
    last_actual = proj0 - 1
    y_end = proj0 + cfg["projection_years"] - 1
    years = list(range(cfg["from"], y_end + 1))
    eu = set(cfg["eu_members"])
    say = (lambda *a, **k: None) if quiet else print

    def weo(ind: str, e: str, y: int):
        return W.get(ind, {}).get(e, {}).get(str(y))

    fred = w["fred"]

    def spread_m(e: str):
        bench = cfg["benchmark"]["eu"] if e in eu else cfg["benchmark"]["other"]
        if e == bench or e not in fred or bench not in fred:
            return bench, None
        return bench, spread_months(fred[e]["obs"], fred[bench]["obs"])

    out_e: dict[str, dict] = {}
    gaps_ca, gaps_niip = [], []
    n_snow = n_r4_mf = n_r5_mf = n_r6_na = 0
    for e in econs:
        b = board.get(e)
        v = {r: [] for r in RULES}
        na = {r: [] for r in RULES}
        src = {"r4": [], "r5": []}
        extra = {"ca": [], "i": [], "g": [], "pbstar": [], "pb": [], "interest": [], "r7n": []}
        bench, sm = spread_m(e)
        ca1 = {}
        for y in range(cfg["from"] - 3, y_end + 1):  # annual current account / GDP: the board's Q4, else WEO
            k = year_end_index(b["q"], y) if b else None
            mfv = b["ca"][k] if k is not None else None
            wv = weo("BCA_NGDPD", e, y)
            if mfv is not None and wv is not None:
                gaps_ca.append((abs(mfv - wv), e, y))
            ca1[y] = (mfv, "mf") if mfv is not None else ((wv, "weo") if wv is not None else (None, None))
        for y in years:
            d, ob, pb = weo("GGXWDG_NGDP", e, y), weo("GGXCNL_NGDP", e, y), weo("GGXONLB_NGDP", e, y)
            v["r1"].append(r22_debt_level(d))
            v["r2"].append(r23_deficit(ob))
            sb = r24_debt_snowball(weo("GGXWDG_NGDP", e, y - 1), pb, ob, weo("NGDP", e, y), weo("NGDP", e, y - 1))
            n_snow += sb is not None
            v["r3"].append(R(sb["gap"], 2) if sb else None)
            for kk in ("i", "g", "pbstar", "interest"):
                extra[kk].append(R(sb[kk], 2) if sb else None)
            extra["pb"].append(R(pb, 2))
            # R25: 3-year average
            val, s4 = r25_current_account([ca1.get(yy, (None, None)) for yy in (y - 2, y - 1, y)])
            v["r4"].append(val)
            src["r4"].append(s4)
            n_r4_mf += s4 == "mf"
            extra["ca"].append(R(ca1.get(y, (None, None))[0], 2))
            # R26: board net IIP at Q4, else IMF IIP over WEO GDP in US dollars
            k = year_end_index(b["q"], y) if b else None
            n_mf = b["niip"][k] if k is not None else None
            iip = w["iip"]["A"].get(e, {}).get(str(y)) or w["iip"]["Q"].get(e, {}).get(f"{y}-Q4")
            gd = weo("NGDPD", e, y)
            n_iip = 100 * (iip[0] - iip[1]) / (gd / 1e9) if iip and None not in iip and gd else None  # IIP in USD bn, NGDPD in USD
            if n_mf is not None and n_iip is not None:
                gaps_niip.append((abs(n_mf - n_iip), e, y))
            val, s5 = r26_net_iip(n_mf, iip, gd, projection=y > last_actual)
            v["r5"].append(val)
            src["r5"].append(s5)
            n_r5_mf += s5 == "mf"
            # R27: A2 at Q4; not applicable where the board does not score it
            a2 = b["a2"][k] if k is not None else None
            scored = b["a2_scored"][k] if k is not None else None
            val, na6 = r27_liquidity(a2, scored, projection=y > last_actual)
            v["r6"].append(val)
            na["r6"].append(na6)
            # R28: annual average spread
            val, nm = r28_spread(sm, y)
            v["r7"].append(val)
            extra["r7n"].append(nm)
            for r in ("r1", "r2", "r3", "r4", "r5", "r7"):
                na[r].append(r == "r7" and sm is None and e == bench)
        # an economy the board never scores A2 for (the latest quarter) is greyed throughout
        a2_na_now = bool(b and b["a2_scored"] and b["a2_scored"][-1] == 0)
        if a2_na_now:
            na["r6"] = [True] * len(years)
            n_r6_na += 1
        out_e[e] = {"v": v, "na": na, "src": src, "x": extra, "bench": bench, "eu": e in eu, "a2_na": a2_na_now,
                    "r7_bench_self": e == bench,
                    "spread": {"t0": min(sm) if sm else None, "v": [sm[k] for k in sorted(sm)] if sm else []},
                    "r7_id": fred.get(e, {}).get("id"), "r7_bench_id": fred.get(bench, {}).get("id"),
                    "weo_update": w["weo"].get("country_update", {}).get(e)}
        # monthly spreads may skip months: store as a dense array from t0 with nulls
        if sm:
            ks = sorted(sm)
            y0, m0 = int(ks[0][:4]), int(ks[0][5:7])
            y1, m1 = int(ks[-1][:4]), int(ks[-1][5:7])
            dense = []
            yy, mm = y0, m0
            while (yy, mm) <= (y1, m1):
                dense.append(sm.get(f"{yy}-{mm:02d}"))
                mm += 1
                if mm > 12:
                    yy, mm = yy + 1, 1
            out_e[e]["spread"] = {"t0": ks[0], "t1": ks[-1], "v": dense}
    effect("R24", "economy-years with a debt-stabilising gap", n_snow)
    effect("R25", "economy-years read from the Signal Board's current account", n_r4_mf)
    effect("R26", "economy-years read from the Signal Board's net IIP", n_r5_mf)
    effect("R27", "economies with A2 not applicable (unscored on the board)", n_r6_na)
    effect("R28", "economies with a yield spread", sum(1 for d in out_e.values() if d["spread"]["v"]))

    # ---- the "now" values: each rule's latest actual figure, with its own period. A figure older than the year before
    # the last actual year, or a spread that ends more than two months before the newest one (Russia's stops in 2018),
    # is not "now": it is missing.
    t1s = [d["spread"]["t1"] for d in out_e.values() if d["spread"].get("t1")]
    newest_m = max(t1s) if t1s else None

    def mnum(t: str) -> int:
        return int(t[:4]) * 12 + int(t[5:7])

    for e, d in out_e.items():
        now = {}
        for r in RULES:
            if r == "r7":
                sp = d["spread"]
                vals = [x for x in sp["v"][-12:] if x is not None] if sp["v"] else []
                fresh = bool(sp.get("t1")) and newest_m is not None and mnum(sp["t1"]) >= mnum(newest_m) - FRESH_MONTHS
                now[r] = {"v": R(sum(vals) / len(vals), 2), "p": sp.get("t1"), "kind": "12m"} if len(vals) >= MIN_MONTHS and fresh else None
                continue
            ks = [j for j, y in enumerate(years) if y <= last_actual and d["v"][r][j] is not None]
            now[r] = {"v": d["v"][r][ks[-1]], "p": years[ks[-1]], "kind": "year"} if ks and years[ks[-1]] >= last_actual - 1 else None
        d["now"] = now

    # ---- default counts, coverage, episodes, validation, expectations
    for e, d in out_e.items():
        d["_counts"] = counts(d, years, rules)
    eps, spells = load_episodes(cfg, econs, today=w["read"])
    K = cfg["K"]["default"]
    val = validate(out_e, years, last_actual, spells, cfg, rules, K)

    coverage = {}
    for e, d in out_e.items():
        coverage[e] = {}
        for r in RULES:
            ys = [y for j, y in enumerate(years) if d["v"][r][j] is not None and y <= last_actual]
            if d["na"][r][-1] and all(d["na"][r]):
                coverage[e][r] = {"na": True}
                continue
            if not ys:
                coverage[e][r] = {"first": None, "last": None, "gaps": []}
                continue
            have = set(ys)
            miss = [y for y in range(ys[0], ys[-1] + 1) if y not in have]
            coverage[e][r] = {"first": ys[0], "last": ys[-1], "gaps": runs(miss)}

    yi = {y: j for j, y in enumerate(years)}
    checks = []
    for x in cfg["expectations"]:
        d = out_e.get(x["eco"])
        res = {"id": x["id"], "eco": x["eco"], "en": x["en"], "ko": x["ko"], "years": x["years"], "rows": []}
        ok = True
        for y in x["years"]:
            k, n, on = d["_counts"][yi[y]]
            row = {"y": y, "k": k, "n": n, "on": on}
            if x["test"] == "count_ge":
                good = k >= x["k"]
            elif x["test"] == "flagged_by":
                good = k >= K and x["rule"] in on
                row["rule_value"] = d["v"][x["rule"]][yi[y]]
                row["rule_na"] = d["na"][x["rule"]][yi[y]]
            else:
                good = all(r in on for r in x["on"]) and all(r not in on and d["v"][r][yi[y]] is not None for r in x["off"])
            row["ok"] = bool(good)
            ok = ok and good
            res["rows"].append(row)
        res["ok"] = ok
        checks.append(res)

    # ---- the build log: overlaps, validation, expectations (the coverage table is in the view)
    say(f"  sovereign: WEO vintage {w['weo']['vintage']} (published {w['weo']['published']}), read {w['read']}; years {years[0]}-{years[-1]}, "
        f"projections from {proj0}; {len(econs)} economies; {len(eps)} episodes ({len(spells)} distress spells)")
    if gaps_ca:
        g = max(gaps_ca)
        say(f"  sovereign R25 overlap: board current account vs WEO, max |diff| {g[0]:.1f} pt ({g[1]} {g[2]}), median {sorted(x[0] for x in gaps_ca)[len(gaps_ca) // 2]:.2f}")
    if gaps_niip:
        g = max(gaps_niip)
        say(f"  sovereign R26 overlap: board net IIP vs IMF IIP / WEO GDP, max |diff| {g[0]:.1f} pt ({g[1]} {g[2]}), median {sorted(x[0] for x in gaps_niip)[len(gaps_niip) // 2]:.2f}")
    say(f"  sovereign validation (defaults, K={K}): hits {val['hits']} of {val['scored']} spells with data ({val['episodes']} spells), "
        f"false alarms {val['alarms']} of {val['calm']} calm years, AUROC {val['auroc']} on {val['pos_years']} pre-window years")
    for c in checks:
        rows = "; ".join(f"{r['y']}: {r['k']} of {r['n']} on [{' '.join(r['on'])}]" for r in c["rows"])
        say(f"  sovereign expectation {c['id']}: {'PASS' if c['ok'] else 'FAIL'} ({rows})")

    for d in out_e.values():
        d["counts"] = [[k, n] for k, n, _ in d.pop("_counts")]
    meta = {"vintage": w["weo"]["vintage"], "published": w["weo"]["published"], "read": w["read"], "mode": cfg["vintage"],
            "weo_url": w["weo"]["url"], "iip_updated": w["iip"].get("updated")}
    out = {"years": years, "proj0": proj0, "last_actual": last_actual, "rules": rules, "K": cfg["K"], "order": RULES,
           "validation_cfg": cfg["validation"], "econ": out_e, "episodes": eps,
           "spells": [{k: s[k] for k in ("eco", "start", "end", "y0", "y1", "ids", "before_sample")} for s in spells],
           "coverage": coverage, "valid": val, "checks": checks, "meta": meta, "economies": econs,
           "names": {e: names[e] for e in econs if e in names}}
    out["gloss"] = glossary(out, quiet=quiet)
    return out


# ---------------------------------------------------------------- the glossary: config/sovereign_glossary.yaml with examples filled
PH = re.compile(r"\{([A-Za-z0-9_.:\-]+)(?:\|([^}]+))?\}")  # {key} or {key|을}: a particle qkr placed after it


def fmt_num(v: float, lang: str, d: int = 1, signed: bool = False) -> str:
    s = f"{v:+,.{d}f}" if signed else f"{v:,.{d}f}"
    return s.replace("-", "−")


def fill(s: str, data: dict, lang: str, missing: list) -> str:
    """Placeholders: {ECO.YEAR.KEY[:fmt]} with KEY r1..r7, ca, i, g, pbstar, pb, interest, count; {val.KEY};
    {ECO.name}; {ep.N}; {last}. fmt: pct (default), pp, num, int."""
    yi = {y: j for j, y in enumerate(data["years"])}

    def one(m):
        out = one_value(m)
        return josa(out, m.group(2)) if m.group(2) and out != "–" else out

    def one_value(m):
        key = m.group(1)
        spec = "pct"
        if ":" in key:
            key, spec = key.split(":", 1)
        parts = key.split(".")
        val = None
        try:
            if parts[0] == "ep":
                return str(sum(1 for x in data["episodes"] if x["type"] == parts[1]))
            if parts[0] == "val":
                val = data["valid"][parts[1]]
            elif parts[0] == "last":
                return str(data["last_actual"])
            elif parts[0] == "n":
                return str(len(data["economies"]))
            elif len(parts) == 2 and parts[1] == "name":
                return data["names"][parts[0]][lang]
            else:
                e, y, k = parts[0], int(parts[1]), parts[2]
                d = data["econ"][e]
                j = yi[y]
                if k == "count":
                    c = d["counts"][j]
                    return f"{c[0]} of {c[1]}" if lang == "en" else f"{c[1]}개 중 {c[0]}개"
                val = d["v"][k][j] if k in d["v"] else d["x"][k][j]
        except (KeyError, IndexError, ValueError):
            val = None
        if val is None:
            missing.append(m.group(1))
            return "–"
        if spec == "pp":
            return f"{fmt_num(val, lang, 1)} pp" if lang == "en" else f"{fmt_num(val, lang, 1)}%p"
        if spec == "num":
            return fmt_num(val, lang, 3 if abs(val) < 2 else 1)
        if spec == "int":
            return fmt_num(val, lang, 0)
        if spec == "pct0":
            return f"{fmt_num(val, lang, 0)}%"
        return f"{fmt_num(val, lang, 1)}%"

    return PH.sub(one, s)


FIELDS = ["term", "what", "why", "calc", "formula", "thr", "ex"]


def glossary(data: dict, path: Path = GLOSSARY_PATH, quiet: bool = False) -> dict:
    if not path.exists():
        return {"en": {}, "ko": {}}
    g = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    out = {"en": {}, "ko": {}}
    missing: list[str] = []
    long_terms = []
    for tid, t in g.items():
        for lang in ("en", "ko"):
            src = t.get(lang) or {}
            en = t.get("en") or {}
            # a Korean field still waiting for its draft ('' in the yaml) shows the English one (method 1.6)
            ent = {k: fill(str(src[k]), data, lang, missing) if src.get(k) else fill(str(en[k]), data, "en", missing)
                   for k in FIELDS if src.get(k) or (lang == "ko" and k in src and en.get(k))}
            ent["src"] = t.get("src", [])
            out[lang][tid] = ent
        words = sum(len(out["en"][tid].get(k, "").split()) for k in ("what", "why", "calc", "thr", "ex"))
        if words > 60:
            long_terms.append((tid, words))
    if not quiet:
        print(f"  sovereign glossary: {len(g)} terms; placeholders unresolved: {sorted(set(missing)) or 'none'}")
        if long_terms:
            print(f"  sovereign glossary over 60 words (EN): {', '.join(f'{t} {n}' for t, n in long_terms)}")
    out["_long"] = long_terms
    out["_missing"] = sorted(set(missing))
    return out


if __name__ == "__main__":                                        # the coverage report from the latest release's board
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from sitebuild import release as _rel, views as _views      # noqa: E402

    man = _rel.latest()
    if not man:
        sys.exit("no release yet: run scripts/build_site_data.py first")
    world = json.loads(_rel.get(man["files"]["world/global"]))
    meta = json.loads(_rel.get(man["files"]["meta"]))
    _, bs = _views.board_series(world["board"])
    names = {e: {"en": v["en"], "ko": v["ko"]} for e, v in meta["economies"].items()}
    o = build(bs, names)
    print("  coverage (first-last, gaps; na = not applicable; - = none):")
    for e in o["economies"]:
        cells = []
        for r in RULES:
            c = o["coverage"][e][r]
            if c.get("na"):
                cells.append(f"{r} na")
            elif c["first"] is None:
                cells.append(f"{r} -")
            else:
                gp = ",".join(f"{a}" if a == b2 else f"{a}-{b2}" for a, b2 in c["gaps"])
                cells.append(f"{r} {c['first']}-{c['last']}{' gaps ' + gp if gp else ''}")
        print(f"    {e}: " + "; ".join(cells))
