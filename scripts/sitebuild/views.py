"""The site's views: economy ladders, market ladders, the world view and the global rung.

Every total, share, coverage and "Other" is computed here at full precision and rounded once at the end (R13), so the
browser only draws and picks: for a day it takes the newest point at or before it. A ladder is computed for each
quarter end since 2000 and for the build day, in both period settings (R7: aligned, newest); identical ladders are
stored once and the quarter ends point to them.

Series are shipped as points: the value at each quarter end, plus the last RECENT native observations of a daily,
weekly or monthly series, so no file carries a source's high-frequency history (check V11).
"""
from __future__ import annotations

import datetime as dt
import json
import math
import os
from collections import defaultdict
from pathlib import Path

from . import rules
from .registry import effect, licence, shown

ROOT = Path(os.environ.get("MONEY_FLOW_DATA_ROOT", "data"))
EXTERNAL = ROOT / "external"                                      # scripts/fetch_wdi.py, fetch_quarterly.py, fetch_warning.py write here
START = dt.date(2000, 3, 31)
RECENT = 13                                                       # native observations of a D/W/M series (V11 allows 13)
TOPK = (5, 10, 20)
GROUPS_IN = ("debt", "bank", "fdi", "equity", "unsplit")         # stack order; unsplit = portfolio by holder only
MEASURES = ("cb_assets", "monetary_base", "currency", "reserves_banks", "m1", "broad_money", "m3", "lf", "l",
            "credit_private", "fx_reserves", "mmf_retail")
R = rules.r13_precision


def iso(d) -> str:
    return d.isoformat() if hasattr(d, "isoformat") else str(d)


def quarter_ends(until: dt.date) -> list[dt.date]:
    out, y, q = [], START.year, 1
    while True:
        m = 3 * q
        d = dt.date(y + (m == 12), 1 if m == 12 else m + 1, 1) - dt.timedelta(days=1)
        if d > until:
            break
        out.append(d)
        q = q % 4 + 1
        y += q == 1
    return out


def key_of(raw: str | None) -> str | None:
    """The series key inside a raw path (fred/observations/WALCL/2026-10-27.json.gz -> WALCL)."""
    if not raw:
        return None
    p = raw.split("/")
    return p[2] if len(p) > 3 and p[0] in ("fred", "ecos", "ecb") else None


def points(obs: list[tuple[dt.date, float]], freq: str, grid: list[dt.date]) -> list[list]:
    """A series as points: its value at each grid date (the newest observation at or before it) and, for a daily,
    weekly or monthly series, its last RECENT observations. Quarterly and slower series keep every observation."""
    obs = sorted((p, v) for p, v in obs if v is not None and math.isfinite(v))
    if not obs:
        return []
    if freq not in ("D", "W", "M"):
        keep = {p: v for p, v in obs}
    else:
        keep = dict(obs[-RECENT:])
        i = 0
        for g in grid:
            while i + 1 < len(obs) and obs[i + 1][0] <= g:
                i += 1
            if obs[i][0] <= g:
                keep[obs[i][0]] = obs[i][1]
    return [[iso(p), R(v)] for p, v in sorted(keep.items())]


class Ctx:
    """The build's shared state: the DuckDB connection with the rule-applied relations, the economies, the day."""

    def __init__(self, con, day: dt.date, vintages: dict[str, str]):
        self.con, self.day, self.vintages = con, day, vintages
        self.grid = quarter_ends(day)
        self.asof = self.grid + ([day] if not self.grid or self.grid[-1] != day else [])
        rows = con.execute("SELECT code, name_en, name_ko, region, subregion, lat, lon, is_aggregate, iso2, m49 FROM economies").fetchall()
        self.econ = {r[0]: dict(zip(("code", "en", "ko", "region", "subregion", "lat", "lon", "agg", "iso2", "m49"), r)) for r in rows}
        self.agg = {c for c, e in self.econ.items() if e["agg"]}
        self.flags: dict[str, list] = defaultdict(list)          # pre-checks' findings per economy (V6, V13)
        self.cov_flags: dict[tuple, list] = {}                    # V4 and excess findings per economy and direction
        self.v2_duplicates = 0
        self.v3: list[float] = []                                 # every adds-up residual (bn), for V3

    def q(self, sql: str, params=None) -> list[tuple]:
        return self.con.execute(sql, params or []).fetchall()

    # ------------------------------------------------------------------ economy measures (the "made here" column)
    def series(self, economy: str, measure: str, detail: str | None = None) -> dict | None:
        """The primary shown source of a measure for an economy, as points: national first, then BIS, then the IMF
        (build_tables.py ranks them); a source whose class may not be shown is skipped (the licence gate)."""
        rows = self.q("""SELECT dataset, freq, raw, period, value_usd, detail FROM stocks_m WHERE economy = ? AND measure = ?
                         AND (? IS NULL OR detail = ?) ORDER BY dataset, period""", [economy, measure, detail, detail])
        by: dict[tuple, list] = defaultdict(list)
        for ds, fr, raw, p, v, det in rows:
            by[(ds, fr, key_of(raw), det)].append((p, v))
        rank = {"fred": 0, "ecb": 0, "ecos": 0, "bis": 1, "imf": 2}
        cands = []
        for (ds, fr, key, det), obs in by.items():
            cls = licence(ds, key)
            if not shown(cls):
                continue
            freq_rank = {"D": 0, "W": 1, "M": 2, "Q": 3}.get(fr, 4)
            cands.append(((rank.get(ds.split(".")[0], 3), freq_rank, -max(p for p, _ in obs).toordinal()), ds, fr, key, det, obs))
        if not cands:
            return None
        _, ds, fr, key, det, obs = min(cands, key=lambda c: c[0])
        return {"ds": ds, "key": key, "f": fr, "det": det or "", "pts": points(obs, fr, self.grid)}


# ---------------------------------------------------------------------- economy ladders
RESERVES_IO = "IMF:TX093"                                         # the IMF's confidential SEFER + SSIO holder group (R6)
DIP_WORLD = "IMF:G001"                                            # the DIP's all-investor counterpart: the FDI total (R6)


def _pairs(ctx: Ctx, x: str, direction: str) -> dict:
    """Pair rows of economy x: {group: {period: {holder: (position, flow, flow_kind, reported_by, alt)}}}, the totals
    {group: {period: value}} and the reserves-and-international-organisations holdings {group: {period: value}}."""
    me, other = ("debtor", "creditor") if direction == "in" else ("creditor", "debtor")
    rows = ctx.q(f"""SELECT dataset, channel, basis, period, freq, {other}, position_usd, flow_usd, flow_kind, reported_by, agg_{other}, alt_usd
                     FROM links_m WHERE {me} = ? AND period >= ? AND dataset IN ('bis.LBS', 'bis.CBS', 'imf.PIP', 'imf.DIP')""", [x, START])
    parts: dict[str, dict] = defaultdict(lambda: defaultdict(dict))
    tot: dict[str, dict] = defaultdict(dict)
    rio: dict[str, dict] = defaultdict(dict)
    world = rules.ALL_REPORTERS if direction == "in" else rules.ALL_COUNTERPARTIES
    for ds, ch, basis, p, fr, h, pos, flow, fk, rep, is_agg, alt in rows:
        g = {"portfolio_debt": "debt", "portfolio_equity": "equity", "portfolio": "ptotal", "fdi": "fdi", "bank_all": "bank_all",
             "bank_debt": "bank_debt", "bank_other": "bank_other"}.get(ch)
        if ch == "bank":
            g = "bank" if basis == "residence" else "bank_nat"
        if g is None or h == x:
            continue
        if is_agg:
            if h == world and g in ("bank", "bank_nat", "bank_all", "bank_debt", "bank_other"):
                tot[g][p] = pos
            elif h == RESERVES_IO and g in ("debt", "equity", "ptotal") and pos is not None and direction == "in":
                rio[g][p] = pos
            elif h == DIP_WORLD and g == "fdi" and pos is not None:
                tot["fdi_dip"][p] = pos
            continue
        if pos is None:
            continue
        if h in parts[g][p]:
            ctx.v2_duplicates += 1                                 # V2: a second row for one ribbon
        parts[g][p][h] = (pos, flow, fk, rep, alt)
    side = "liabilities" if direction == "in" else "assets"
    for item, p, v in ctx.q("SELECT item, period, position_usd FROM totals_m WHERE economy = ? AND side = ? AND period >= ?", [x, side, START]):
        g = {"portfolio": "portfolio", "direct": "fdi", "reserves": "reserves", "total": "iip_total", "other": "iip_other",
             "portfolio_equity": "iip_equity", "portfolio_debt": "iip_debt", "derivatives": "iip_deriv", "other_loans": "iip_loans",
             "other_deposits": "iip_deposits", "portfolio_derived": "derived"}.get(item)
        if g:
            tot[g][p] = v
    # portfolio by holder only: a holder's total minus its equity and debt, where it reports no split
    for p, hs in parts.get("ptotal", {}).items():
        for h, (pos, flow, fk, rep, alt) in hs.items():
            e = parts["equity"].get(p, {}).get(h, (0.0,))[0]
            d = parts["debt"].get(p, {}).get(h, (0.0,))[0]
            rest = pos - e - d
            if rest > 0.05:
                parts["unsplit"][p][h] = (rest, None, None, rep, None)
    for p, v in rio.get("ptotal", {}).items():
        rest = v - rio["equity"].get(p, 0.0) - rio["debt"].get(p, 0.0)
        if rest > 0.05:
            rio["unsplit"][p] = rest
    return {"parts": parts, "tot": tot, "rio": rio}


def _ladder(ctx: Ctx, data: dict, per: dict[str, dt.date | None], direction: str) -> dict:
    parts, tot, rio = data["parts"], data["tot"], data.get("rio", {})
    g_of = {"debt": "portfolio", "equity": "portfolio", "unsplit": "portfolio", "bank": "bank", "fdi": "fdi"}
    cur = {g: parts.get(g, {}).get(per.get(g_of[g])) or {} for g in GROUPS_IN}
    rio_cur = {g: rio.get(g, {}).get(per.get("portfolio")) for g in ("debt", "equity", "unsplit")}
    score: dict[str, float] = defaultdict(float)
    for g in GROUPS_IN:
        for h, (v, *_r) in cur[g].items():
            score[h] += v
    rank = [h for h, _ in sorted(score.items(), key=lambda kv: (-kv[1], kv[0]))]
    out: dict = {"per": {k: iso(v) if v else None for k, v in per.items()}, "rank": rank[:max(TOPK)], "g": {}}
    for g in GROUPS_IN:
        hs = cur[g]
        ident = math.fsum(v for v, *_ in hs.values())
        rec = {"parts": {h: R(hs[h][0]) for h in rank[:max(TOPK)] if h in hs}, "n": len(hs), "ident": R(ident)}
        rec["other"] = {str(k): R(ident - math.fsum(hs[h][0] for h in rank[:k] if h in hs)) for k in TOPK}
        fl = {h: [R(hs[h][1]), hs[h][2]] for h in rank[:max(TOPK)] if h in hs and hs[h][1] is not None}
        if fl:
            rec["flow"] = fl
            rec["other_flow"] = {str(k): {kind: R(v) for kind, v in rules.r8_flow_kinds([(hs[h][1], hs[h][2]) for h in hs if h not in rank[:k]]).items()} for k in TOPK}
        if g == "fdi":
            rec["rep"] = {h: hs[h][3] for h in rank[:max(TOPK)] if h in hs}
            alt = {h: R(hs[h][4]) for h in rank[:max(TOPK)] if h in hs and hs[h][4] is not None}
            if alt:
                rec["alt"] = alt                                  # R4: the other reporter's figure, for the tooltip
        if rio_cur.get(g) is not None and rio_cur[g] > 0.05:
            rec["rio"] = R(rio_cur[g])                            # R6: reserve managers and international organisations (identified, unranked)
        for k in TOPK:                                            # V3 at full precision: top k + Other = identified
            ctx.v3.append(abs(math.fsum(hs[h][0] for h in rank[:k] if h in hs) + (ident - math.fsum(hs[h][0] for h in rank[:k] if h in hs)) - ident))
        out["g"][g] = rec
    # group totals, gaps and coverage (R6)
    for grp, members, tkey in (("portfolio", ("debt", "equity", "unsplit"), "portfolio"), ("bank", ("bank",), "bank"), ("fdi", ("fdi",), "fdi")):
        p = per.get(grp)
        total = tot.get(tkey, {}).get(p) if p else None
        unranked = [rio_cur[m] for m in members if grp == "portfolio" and rio_cur.get(m)]
        rec = out["g"].setdefault(grp, {})
        if grp == "fdi":
            pp = per.get("fdi_parts")
            dip = tot.get("fdi_dip", {}).get(pp) if pp else None
            rec["iip_total"] = R(total)
            if cur["fdi"] and dip is not None:
                rec["dip_total"] = R(dip)
                total = dip                                       # R6: parts and total on the DIP's own basis
        gap = rules.r6_gap_to_total(total, [v for m in members for v, *_ in cur[m].values()], unranked)
        if gap["total"] is not None:
            ctx.v3.append(abs(gap["identified"] + gap["gap"] - gap["total"]))
        cov = R(100 * gap["coverage"], 1) if gap["coverage"] is not None else None
        if grp == "fdi" and not cur["fdi"]:
            cov = None                                            # no pair data at this period (DIP is annual): unsplit, not 0% covered
        rec.update({"total": R(total), "ni": R(gap["gap"]), "cov": cov, "excess": gap["excess"]})
        if gap["excess_by"] is not None:
            rec["excess_by"] = R(gap["excess_by"])
    # the portfolio group as a whole: identified sum (ranked holders and the reserves group), holders, and the largest
    # holder with its share of the identified total (the headline)
    port: dict[str, float] = defaultdict(float)
    for m in ("debt", "equity", "unsplit"):
        for h, (v, *_r) in cur[m].items():
            port[h] += v
    rsum = math.fsum(v for v in rio_cur.values() if v)
    pid = math.fsum(port.values()) + rsum
    out["g"]["portfolio"].update({"ident": R(pid), "n": len(port)})
    if rsum > 0.05:
        out["g"]["portfolio"]["rio"] = R(rsum)
    pp = per.get("portfolio")
    if pp and tot.get("derived", {}).get(pp) is not None:
        out["g"]["portfolio"]["derived"] = R(tot["derived"][pp])   # the IMF's own derived liabilities (V16)
    if port and pid > 0:
        top = min(port.items(), key=lambda kv: (-kv[1], kv[0]))
        out["g"]["portfolio"].update({"top": top[0], "top_v": R(top[1]), "top_share": R(100 * top[1] / pid, 1)})
    if cur["bank"]:
        top = min(((h, v) for h, (v, *_r) in cur["bank"].items()), key=lambda kv: (-kv[1], kv[0]))
        bid = math.fsum(v for v, *_ in cur["bank"].values())
        out["g"]["bank"].update({"top": top[0], "top_v": R(top[1]), "top_share": R(100 * top[1] / bid, 1) if bid > 0 else None})
    bp = per.get("bank")
    out["g"]["bank"]["all_instr"] = R(tot.get("bank_all", {}).get(bp))
    for key, tk in (("debt_sec", "bank_debt"), ("other_instr", "bank_other"), ("iip_loans", "iip_loans"), ("iip_deposits", "iip_deposits")):
        v = tot.get(tk, {}).get(bp) if bp else None
        if v is not None:
            out["g"]["bank"][key] = R(v)
    # reporters that publish all instruments but no loans-and-deposits split (Japan, Germany): named in the tooltip of
    # the not-identified node, never summed (R5)
    nosplit = {h: v for h, (v, *_r) in (parts.get("bank_all", {}).get(bp) or {}).items() if h not in cur["bank"] and v and v > 0.05}
    if nosplit:
        out["g"]["bank"]["nosplit"] = {h: R(v) for h, v in sorted(nosplit.items(), key=lambda kv: -kv[1])[:5]}
        share = rules.r5_nosplit_share(nosplit, tot.get("bank_all", {}).get(bp))
        if share is not None:
            out["g"]["bank"]["nosplit_share"] = R(share, 1)       # their share of the all-reporter all-instrument total (coverage panel, R5)
    # derivatives and other instruments of banks abroad: a pool of its own, shown as context with its own total only (R5).
    # It is not set against the IIP derivatives item: the LBS "other instruments" cover more than derivatives, so the IIP
    # item is not its border total (method 1.6).
    oi = tot.get("bank_other", {}).get(bp) if bp else None
    if oi is not None:
        out["g"]["bank_other"] = {"total": R(oi)}
    out["g"]["fdi"]["split"] = bool(cur["fdi"])
    rp = per.get("reserves")
    if direction == "out" and rp:
        out["g"]["reserves"] = {"total": R(tot.get("reserves", {}).get(rp))}
    # nationality basis: the bank group only (R10)
    pn = per.get("bank_nat")
    hs = parts.get("bank_nat", {}).get(pn) or {}
    if hs:
        ident = math.fsum(v for v, *_ in hs.values())
        tn = tot.get("bank_nat", {}).get(pn)
        gap = rules.r6_gap_to_total(tn, [v for v, *_ in hs.values()])
        nrank = [h for h, _ in sorted(hs.items(), key=lambda kv: (-kv[1][0], kv[0]))]
        out["nat"] = {"per": iso(pn), "rank": nrank[:max(TOPK)], "parts": {h: R(hs[h][0]) for h in nrank[:max(TOPK)]}, "ident": R(ident),
                      "other": {str(k): R(ident - math.fsum(hs[h][0] for h in nrank[:k])) for k in TOPK},
                      "total": R(tn), "ni": R(gap["gap"]), "cov": R(100 * gap["coverage"], 1) if gap["coverage"] is not None else None, "excess": gap["excess"]}
    return out


def economy(ctx: Ctx, x: str) -> dict | None:
    """The economy file econ/<x>: ladders in both directions and both period settings for every as-of date, the made-here
    column, the border, the pools' context and the checks that touch it."""
    view: dict = {"code": x, "ladders": {}, "index": {}}
    for direction in ("in", "out"):
        data = _pairs(ctx, x, direction)
        parts, tot = data["parts"], data["tot"]
        # a channel joins the alignment only through its pair data: Japan's banks, for one, give no loans-and-deposits
        # split by counterparty, and waiting for one would hold the whole ladder at an old period
        avail = {"portfolio": sorted(set(parts.get("debt", {})) | set(parts.get("equity", {})) | set(parts.get("ptotal", {}))),
                 "bank": sorted(set(parts.get("bank", {}))),
                 "fdi": sorted(parts.get("fdi", {})),
                 "iip": sorted(tot.get("portfolio", {})),
                 "bank_nat": sorted(parts.get("bank_nat", {}))}
        if not any(avail.values()):
            continue
        required = [c for c in ("portfolio", "bank", "iip") if avail[c]]
        seen: dict[tuple, int] = {}
        ladders, index = [], {"aligned": {}, "newest": {}}
        for a in ctx.asof:
            al = rules.r7_periods({k: avail[k] for k in ("portfolio", "bank", "iip")}, required, a)["_aligned"]
            fdi_al = rules.r7_own_period(avail["fdi"], al)        # R7: annual DIP sits at its own newest year at or before the aligned period
            per_al = {"portfolio": al if avail["portfolio"] or avail["iip"] else None, "bank": al,
                      "fdi": fdi_al or al, "fdi_parts": fdi_al, "reserves": al, "bank_nat": al if al in set(avail["bank_nat"]) else rules.newest_at(avail["bank_nat"], al) if al else None}
            newest = {c: rules.newest_at(avail[c], a) for c in avail}
            per_nw = {"portfolio": newest["portfolio"] or newest["iip"], "bank": newest["bank"] or rules.newest_at(sorted(tot.get("bank", {})), a), "fdi": newest["fdi"] or newest["iip"],
                      "fdi_parts": newest["fdi"], "reserves": newest["iip"], "bank_nat": newest["bank_nat"]}
            for mode, per in (("aligned", per_al), ("newest", per_nw)):
                if not any(per.values()):
                    continue
                sig = tuple(sorted((k, v) for k, v in per.items()))
                if sig not in seen:
                    lp = dict(per)
                    lad = _ladder(ctx, _fdi_view(data, lp), lp, direction)
                    seen[sig] = len(ladders)
                    ladders.append(lad)
                index[mode][iso(a)] = seen[sig]
        view["ladders"][direction] = ladders
        view["index"][direction] = index
        # the border: IIP items and BOP transactions for this side
        side = "liabilities" if direction == "in" else "assets"
        iip = defaultdict(list)
        for item, p, v in ctx.q("SELECT item, period, position_usd FROM totals_m WHERE economy = ? AND side = ? AND period >= ? AND dataset = 'imf.IIP'", [x, side, START]):
            iip[item].append((p, v))
        bop = defaultdict(list)
        for item, p, v, fr in ctx.q("SELECT item, period, flow_usd, freq FROM flows_m WHERE economy = ? AND side = ? AND period >= ?", [x, side, START]):
            bop[item].append((p, v))
        view.setdefault("border", {})[direction] = {"iip": {k: points(v, "Q", ctx.grid) for k, v in sorted(iip.items())},
                                                    "bop": {k: points(v, "Q", ctx.grid) for k, v in sorted(bop.items())}}
        _coverage_flags(ctx, x, direction, ladders, index)
    if not view["ladders"]:
        return None
    net = defaultdict(list)
    for p, v in ctx.q("SELECT period, position_usd FROM totals_m WHERE economy = ? AND side = 'net' AND item = 'net' AND period >= ?", [x, START]):
        net["net"].append((p, v))
    view.setdefault("border", {})["net"] = points(net["net"], "Q", ctx.grid)
    # the IIP's vintage: the IMF's publication date of the file the mirror holds, and the day the mirror read it
    got = ctx.q("""SELECT p.published, p.vintage FROM provenance p JOIN economies e ON e.imf = p.key
                   WHERE p.dataset = 'imf.IIP' AND p."table" = 'totals' AND e.code = ? ORDER BY p.vintage DESC LIMIT 1""", [x])
    if got:
        view["border"]["vintage"] = {"published": got[0][0], "read": got[0][1]}
    view["made"] = {m: s for m in MEASURES if (s := ctx.series(x, m))}
    ctxt = {}
    if s := ctx.series(x, "credit_private"):
        ctxt["credit_private"] = s
    if s := ctx.series(x, "ids_outstanding", "all"):
        ctxt["ids_outstanding"] = s
    for m in ("banks_claims_nonres", "banks_liabilities_nonres"):
        if s := ctx.series(x, m):
            ctxt[m] = s
    view["context"] = ctxt
    view["tic"] = _tic(ctx, x)
    view["usd_bank"] = _usd_bank(ctx, x)
    view["checks"] = ctx.flags.get(x, []) + ctx.cov_flags.get((x, "in"), []) + ctx.cov_flags.get((x, "out"), [])
    return view


def _fdi_view(data: dict, per: dict) -> dict:
    """FDI pairs are drawn only at a period DIP has (annual); otherwise the FDI ribbon is the IIP total, unsplit."""
    if per.get("fdi_parts") is None:
        parts = dict(data["parts"])
        parts["fdi"] = {}
        return {"parts": parts, "tot": data["tot"]}
    return data


def _coverage_flags(ctx: Ctx, x: str, direction: str, ladders: list, index: dict) -> None:
    """V4: coverage below 50% at the newest aligned ladder; V3/R6: an excess over the total. Recomputed on every call
    (the V9 rebuild must give the same file)."""
    i = index["aligned"].get(iso(ctx.day))
    ctx.cov_flags[(x, direction)] = []
    if i is None:
        return
    lad = ladders[i]
    for grp in ("portfolio", "bank", "fdi"):
        g = lad["g"].get(grp, {})
        cov = g.get("cov")
        if cov is not None and cov < 50:
            ctx.cov_flags[(x, direction)].append({"id": "V4", "status": "warning", "dir": direction, "group": grp, "value": cov, "period": lad["per"].get(grp)})
        if g.get("excess"):
            ctx.cov_flags[(x, direction)].append({"id": "V14", "status": "warning", "dir": direction, "group": grp, "value": g.get("excess_by"), "period": lad["per"].get(grp), "note": "excess"})


def _tic(ctx: Ctx, x: str) -> dict | None:
    """What residents of x hold of US long-term securities (TIC, monthly) and their net purchases."""
    if x == "USA":
        return None
    out = {}
    for ch in ("portfolio", "portfolio_equity", "portfolio_debt"):
        rows = ctx.q("SELECT period, position_usd, flow_usd FROM links_m WHERE dataset = 'tic.files' AND creditor = ? AND channel = ? ORDER BY period", [x, ch])
        if rows:
            out[ch] = {"ds": "tic.files", "f": "M", "pts": points([(p, v) for p, v, _ in rows], "M", ctx.grid),
                       "flow": points([(p, f) for p, _, f in rows], "M", [])}
    return out or None


def _usd_bank(ctx: Ctx, x: str) -> dict | None:
    """Bank claims on x in US dollars (BIS LBS, all reporters, loans and deposits): a breakdown shown beside the total."""
    rows = ctx.q("""SELECT period, position_usd FROM links WHERE dataset = 'bis.LBS' AND creditor = ? AND debtor = ? AND channel = 'bank_loans'
                    AND currency = 'USD' AND sector_debtor = 'all' AND basis = 'residence' AND period >= ? ORDER BY period""", [rules.ALL_REPORTERS, x, START])
    return {"ds": "bis.LBS", "f": "Q", "pts": points(rows, "Q", ctx.grid)} if rows else None


# ---------------------------------------------------------------------- market ladders
MARKETS = {"equity": ("imf.PIP", "portfolio_equity", "residence"), "bonds": ("imf.PIP", "portfolio_debt", "residence"),
           "bank": ("bis.LBS", "bank", "residence"), "fdi": ("imf.DIP", "fdi", "residence")}
FINANCIAL_CENTRES, FUND_DOMICILES = rules.FINANCIAL_CENTRES, rules.FUND_DOMICILES   # offshore centres (BIS LBS groups); fund domiciles
PASS_THROUGH = set(FINANCIAL_CENTRES) | set(FUND_DOMICILES)


def market(ctx: Ctx, name: str, k: int = 30, fk: int = 10) -> dict:
    """One market across economies: for each period, the top holders, the top destinations and the pairs between
    them, with everything else folded into Other. Aggregates are never parts (R11). `focus` gives each economy in the
    top k either way its gross positions out and in over all pairs, the part of each with an offshore centre or fund
    domicile on the other side, and its fk largest counterparties each way (the page's country focus)."""
    ds, ch, basis = MARKETS[name]
    rows = ctx.q("""SELECT period, creditor, debtor, position_usd FROM links_m WHERE dataset = ? AND channel = ? AND basis = ?
                    AND NOT agg_creditor AND NOT agg_debtor AND creditor <> debtor AND position_usd IS NOT NULL AND period >= ?""", [ds, ch, basis, START])
    by: dict[dt.date, dict] = defaultdict(dict)
    for p, c, d, v in rows:
        if (c, d) in by[p]:
            ctx.v2_duplicates += 1
        by[p][(c, d)] = v
    periods = []
    for p in sorted(by):
        pairs = by[p]
        hold, dest = defaultdict(float), defaultdict(float)
        for (c, d), v in pairs.items():
            hold[c] += v
            dest[d] += v
        th = [c for c, _ in sorted(hold.items(), key=lambda kv: (-kv[1], kv[0]))[:k]]
        td = [d for d, _ in sorted(dest.items(), key=lambda kv: (-kv[1], kv[0]))[:k]]
        cell: dict = defaultdict(float)
        for (c, d), v in pairs.items():
            cell[(c if c in th else "_other", d if d in td else "_other")] += v
        total = math.fsum(pairs.values())
        ctx.v3.append(abs(math.fsum(cell.values()) - total))
        outs, ins = defaultdict(list), defaultdict(list)
        for (c, d), v in pairs.items():
            outs[c].append((v, d))
            ins[d].append((v, c))
        top = lambda l: [[x, R(v)] for v, x in sorted(l, key=lambda t: (-t[0], t[1]))[:fk] if R(v)]
        focus = {x: {"out": R(math.fsum(v for v, _ in outs[x])), "in": R(math.fsum(v for v, _ in ins[x])),
                     "out_pass": R(math.fsum(v for v, d in outs[x] if d in PASS_THROUGH)), "in_pass": R(math.fsum(v for v, c in ins[x] if c in PASS_THROUGH)),
                     "out_top": top(outs[x]), "in_top": top(ins[x])} for x in sorted(set(th) | set(td))}
        periods.append({"p": iso(p), "holders": {c: R(hold[c]) for c in th}, "dests": {d: R(dest[d]) for d in td},
                        "holders_other": R(total - math.fsum(hold[c] for c in th)), "dests_other": R(total - math.fsum(dest[d] for d in td)),
                        "pairs": [[c, d, R(v)] for (c, d), v in sorted(cell.items(), key=lambda kv: (-kv[1], kv[0])) if R(v)],
                        "total": R(total), "n_holders": len(hold), "n_dests": len(dest), "focus": focus})
    return {"market": name, "ds": ds, "periods": periods}


# ---------------------------------------------------------------------- the world and the global rung
APEX = (("USA", "Federal Reserve"), ("EMU", "Eurosystem"), ("JPN", "Bank of Japan"), ("CHN", "People's Bank of China"),
        ("GBR", "Bank of England"), ("CHE", "Swiss National Bank"))
PLUMBING = ("swap_lines", "treasury_account", "reverse_repo", "repo_lending", "reserves_banks", "mmf_retail")


def world(ctx: Ctx, economies: list[str]) -> dict:
    out: dict = {"apex": {}, "plumbing": {}, "gli": {}, "cofer": {}, "ids": None, "economies": {}, "pairs": {}}
    for code, _ in APEX:
        if s := ctx.series(code, "cb_assets"):
            out["apex"][code] = s
    for m in PLUMBING:
        if s := ctx.series("USA", m):
            out["plumbing"][m] = s
    for ccy in ("USD", "EUR", "JPY"):
        rows = ctx.q("SELECT detail, period, value_usd FROM stocks_m WHERE dataset = 'bis.GLI' AND economy = 'BIS:3P' AND currency = ? ORDER BY period", [ccy])
        by = defaultdict(dict)
        for det, p, v in rows:
            by[p][det] = v
        tot = [(p, d["total"]) for p, d in sorted(by.items()) if "total" in d]
        sec = [(p, d["debt_securities"]) for p, d in sorted(by.items()) if "debt_securities" in d]
        loans = [(p, d["total"] - d["debt_securities"]) for p, d in sorted(by.items()) if "total" in d and "debt_securities" in d]
        out["gli"][ccy] = {"ds": "bis.GLI", "f": "Q", "total": points(tot, "Q", ctx.grid), "securities": points(sec, "Q", ctx.grid),
                           "loans": points(loans, "Q", ctx.grid)}
    for det in ("USD", "EUR", "JPY", "GBP", "CNY", "CAD", "AUD", "CHF", "OTHC", "total", "unallocated"):
        rows = ctx.q("SELECT period, value_usd FROM stocks_m WHERE dataset = 'imf.COFER' AND detail = ? AND freq = 'Q' ORDER BY period", [det])
        if rows:
            out["cofer"][det] = points(rows, "Q", ctx.grid)
    rows = ctx.q("SELECT period, value_usd FROM stocks_m WHERE dataset = 'bis.DSS' AND economy = 'BIS:3P' AND measure = 'ids_outstanding' AND detail = 'all' ORDER BY period")
    out["ids"] = {"ds": "bis.DSS", "f": "Q", "pts": points(rows, "Q", ctx.grid)}
    for x in economies:
        e = {}
        for side in ("assets", "liabilities"):
            rows = ctx.q("SELECT period, position_usd FROM totals_m WHERE economy = ? AND side = ? AND item = 'total' AND period >= ? ORDER BY period", [x, side, START])
            if rows:
                e[side] = points(rows, "Q", ctx.grid)
        if e:
            out["economies"][x] = e
    # the largest pairs, portfolio and bank (loans and deposits), at each December both have
    for name, (ds, ch) in {"portfolio": ("imf.PIP", "portfolio"), "bank": ("bis.LBS", "bank")}.items():
        rows = ctx.q("""SELECT period, creditor, debtor, position_usd FROM links_m WHERE dataset = ? AND channel = ? AND basis = 'residence'
                        AND NOT agg_creditor AND NOT agg_debtor AND creditor <> debtor AND month(period) = 12 AND period >= ? AND position_usd > 0""", [ds, ch, START])
        by = defaultdict(list)
        for p, c, d, v in rows:
            by[p].append((v, c, d))
        out["pairs"][name] = {iso(p): [[c, d, R(v)] for v, c, d in sorted(l, reverse=True)[:60]] for p, l in sorted(by.items())}
    return out


TICKER = (("USA", "cb_assets"), ("EMU", "cb_assets"), ("USA", "treasury_account"), ("USA", "reverse_repo"), ("USA", "swap_lines"),
          ("USA", "reserves_banks"), ("USA", "mmf_retail"))


def ticker(ctx: Ctx) -> list[dict]:
    out = []
    for x, m in TICKER:
        s = ctx.series(x, m)
        if s and s["pts"]:
            out.append({"economy": x, "measure": m, **s, "pts": s["pts"][-RECENT:]})
    return out


# ---------------------------------------------------------------------- the Signal Board (method 1.2, R17–R19)
BOARD_FROM = dt.date(2005, 3, 31)                                # the first quarter with full CBS maturity data drawn
BOARD_COLS = ("eco", "v", "flow", "exp", "buf", "s1", "l1", "o1", "m1", "sc1", "s2", "l2", "o2", "m2", "sc2", "a2_scored", "wn", "wc",
              "a1", "a1n", "a2", "a3", "niip", "ned", "ca", "niip_asof", "ca_asof", "b1", "b2", "size", "fx_loans", "fx_bonds", "fx_bonds_nat",
              "gdp", "st", "res", "ids", "loans", "stock_prev", "gli", "ur", "gdp_carried",
              "a1x", "a1_local", "local_fx", "offshore", "a2g", "a2_floored", "a2_basis", "res_net", "res_drains",   # method 1.4
              "res_net_raw", "o1x", "flow_missing")   # method 1.6: net reserves without the floor (res_net is A2's reserve base), A1's own history on a1x, the reason a flow is missing
BOARD_AS_IS = ("gdp_carried", "a2_scored", "niip_asof", "ca_asof", "a1_local", "offshore", "a2_floored", "a2_basis", "o1x", "flow_missing")   # written as they are, not rounded
TOP_WITHDRAWALS = 5


def board_components(ctx: Ctx) -> dict:
    """Every board economy's components by quarter since START (R17's inputs, USD bn), the economies in and out (R19),
    the euro adoption dates and the GLI totals. A component a quarter lacks is absent, never zero. The GDP of the
    newest quarter is carried one quarter forward (flagged `gdp_carried`). Buffers (method 1.3): the IMF IIP net
    position, debt-instrument assets and liabilities, and the current account summed over four quarters.
    Used by board() and by scripts/validation/vulnerability_v13.py, so the release and the decision memo read one set of numbers."""
    comp: dict[str, dict[dt.date, dict]] = defaultdict(lambda: defaultdict(lambda: {"fx_loans": {}, "fx_bonds": {}, "fx_bonds_res": {}}))
    simple = {"cbs_st_intl": "st", "cbs_ur_foreign": "ur", "ids_nat": "ids", "ids_nat_net": "ids_net", "lbs_loans": "loans",
              "lbs_loans_flow": "loans_flow", "gdp_implied": "gdp", "lbs_local_fx_nb": "local_fx"}
    for eco, p, m, det, ccy, v in ctx.q("""SELECT economy, period, measure, detail, currency, value_usd FROM signals_m WHERE freq = 'Q' AND period >= ?
                                           AND measure IN ('cbs_st_intl', 'cbs_ur_foreign', 'ids_nat', 'ids_nat_net', 'lbs_loans', 'lbs_loans_flow',
                                                           'gdp_implied', 'lbs_fx_loans_nb', 'ids_nat_fx', 'ids_res_fx', 'lbs_local_fx_nb')""", [START]):
        if v is None:
            continue
        if m == "lbs_fx_loans_nb":
            comp[eco][p]["fx_loans"][ccy] = v
        elif m in ("ids_nat_fx", "ids_res_fx"):
            comp[eco][p]["fx_bonds" if m == "ids_nat_fx" else "fx_bonds_res"].setdefault(ccy, {})[det] = v
        else:
            comp[eco][p][simple[m]] = v
    for eco, p, m, v in ctx.q("""SELECT economy, period, measure, value_usd FROM stocks_m WHERE dataset = 'imf.IRFCL' AND measure IN ('fx_reserves', 'reserve_drains')
                                 AND month(period) IN (3, 6, 9, 12) AND period >= ?""", [START]):
        if eco in comp and v is not None:
            comp[eco][p]["res" if m == "fx_reserves" else "res_drains"] = v
    # buffers: IIP net position; debt instruments = portfolio debt + other investment + direct investment debt (reserves on
    # the asset side); the current account over four quarters. Quarterly where published, else the newest annual value
    # (dated at its year end) at most four quarters old, so nothing is interpolated and nothing looks ahead.
    buf: dict[str, list] = defaultdict(list)
    for eco, p, fr, niip, dl, da in ctx.q("""SELECT economy, period, freq, max(position_usd) FILTER (WHERE side = 'net' AND item = 'net'),
                                             sum(position_usd) FILTER (WHERE side = 'liabilities' AND item IN ('portfolio_debt', 'other', 'direct_debt')),
                                             sum(position_usd) FILTER (WHERE side = 'assets' AND item IN ('portfolio_debt', 'other', 'direct_debt', 'reserves'))
                                             FROM totals_m WHERE dataset = 'imf.IIP' AND freq IN ('Q', 'A') AND period >= ? GROUP BY 1, 2, 3 ORDER BY 1, 2""",
                                          [START - dt.timedelta(days=366)]):
        buf[eco].append((p, {"niip": niip, "debt_liab": dl, "debt_assets": da, "iip_freq": fr}))
    ca: dict[str, list] = defaultdict(list)
    for eco, p, fr, v in ctx.q("""SELECT economy, period, freq, flow_usd FROM flows_m WHERE side = 'net' AND item = 'current_account' AND freq IN ('Q', 'A')
                                  AND period >= ? ORDER BY 1, 2""", [START - dt.timedelta(days=731)]):
        ca[eco].append((p, fr, v))
    for eco, obs in ca.items():
        qs = [(p, v) for p, fr, v in obs if fr == "Q"]
        sums = []
        for i in range(3, len(qs)):                             # four consecutive quarters, else no sum
            w = qs[i - 3:i + 1]
            if (w[-1][0] - w[0][0]).days < 280 and all(v is not None for _, v in w):
                sums.append((w[-1][0], {"ca4": math.fsum(v for _, v in w), "ca_freq": "Q"}))
        have = {p for p, _ in sums}
        sums += [(p, {"ca4": v, "ca_freq": "A"}) for p, fr, v in obs if fr == "A" and v is not None and p not in have]
        buf[eco] += sorted(sums, key=lambda x: x[0])
    # the BIS GLI context beside A1: credit to non-banks in US dollars, euros and yen, the A1 currencies, summed; the
    # economy's own currency is left out at each date as A1 leaves it out (method 1.6)
    gli_ccy: dict[tuple, dict] = defaultdict(dict)
    for e, p, ccy, v in ctx.q("""SELECT economy, period, currency, value_usd FROM stocks_m WHERE dataset = 'bis.GLI' AND currency IN ('USD', 'EUR', 'JPY')
                                 AND detail = 'total' AND economy NOT LIKE '%:%' AND value_usd IS NOT NULL"""):
        gli_ccy[(e, p)][ccy] = v
    euro = {c: f for c, f in ctx.q("SELECT code, euro_area_from FROM economies WHERE coalesce(euro_area_from, '') <> ''")}
    gli = {}
    for (e, p), by in gli_ccy.items():
        own = rules.own_currencies(e, p, euro)
        keep_c = [c for c in rules.FX_CURRENCIES if c not in own]
        if all(c in by for c in keep_c):                          # all three (less the own currency) or none: never a partial sum
            gli[(e, p)] = math.fsum(by[c] for c in keep_c)
    cands = {e for e, ps in comp.items() if any("gdp" in c for c in ps.values()) and e in ctx.econ and not ctx.econ[e]["agg"]} | \
            {e for e, ps in comp.items() if e == "EMU" and any("gdp" in c for c in ps.values())}
    keep, left = rules.r19_economy_set(cands, ctx.agg)
    last = max((p for e in keep for p, c in comp[e].items() if "loans_flow" in c), default=None)
    quarters = [q for q in ctx.grid if q <= (last or START)]
    series: dict[str, list[tuple[dt.date, dict]]] = {}
    for eco in keep:
        out, prev_gdp = [], None
        for q in quarters:
            c = dict(comp[eco].get(q, {"fx_loans": {}, "fx_bonds": {}, "fx_bonds_res": {}}))
            c["gdp_carried"] = 0
            if c.get("gdp") is None and prev_gdp is not None:     # the newest GDP quarter is carried one quarter forward
                c["gdp"], c["gdp_carried"] = prev_gdp, 1
            c["own"] = rules.own_currencies(eco, q, euro)
            for k in ("niip", "debt_liab", "debt_assets", "ca4"):  # the newest buffer value at or before q, at most four quarters old
                got = next(((p, b) for p, b in reversed(buf.get(eco, [])) if p <= q and b.get(k) is not None), None)
                if got and (q - got[0]).days <= 366:
                    c[k] = got[1][k]
                    c[f"{k}_asof"] = got[0]
            out.append((q, c))
            prev_gdp = (comp[eco].get(q) or {}).get("gdp")
        series[eco] = out
    return {"series": series, "keep": keep, "left": left, "quarters": quarters, "gli": gli, "euro": euro}


def board(ctx: Ctx) -> dict:
    """The Signal Board: for each quarter since BOARD_FROM, every board economy with its scored indicators, buffers and
    flows (R17), its vulnerability score (R18: levels against every board economy so far, the economy's own history
    with a floor, and buffers) and flow score; the economies dropped with their reasons (V18), and those drawn with no
    flow (`no_flow`: scored, but no flow score this quarter, with the reason); the largest withdrawals; the fixed axis
    domains."""
    bc = board_components(ctx)
    keep, left, quarters, gli = bc["keep"], bc["left"], bc["quarters"], bc["gli"]
    panel: dict[str, list] = {}
    why_of: dict[tuple, str | None] = {}
    comp_of: dict[tuple, dict] = {}
    for eco in keep:
        rows, prev_c = [], None
        for q, c in bc["series"][eco]:
            ind, why = rules.r17_indicators(c, prev_c, c["own"], rules.a2_scored(eco, c["own"]))
            rows.append((q, ind))
            why_of[(eco, q)], comp_of[(eco, q)] = why, c
            prev_c = c
        panel[eco] = rows
    sig = rules.r18_signals(panel, BOARD_FROM)
    rows_by_q: dict[dt.date, list] = defaultdict(list)
    drops: dict[dt.date, list] = defaultdict(list)
    for eco in keep:
        for q, ind in panel[eco]:
            if q < BOARD_FROM:
                continue
            why, s, c = why_of[(eco, q)], sig.get((eco, q), {}), comp_of[(eco, q)]
            if why is None and s.get("v") is None:
                why = "short history (fewer than 8 quarters)"
            if why:
                drops[q].append([eco, why])
                continue
            rows_by_q[q].append({"eco": eco, **ind, **s, "gdp": c["gdp"], "st": c.get("st"), "res": c.get("res"), "res_drains": c.get("res_drains"), "ids": c.get("ids"), "loans": c.get("loans"),
                                 "gli": gli.get((eco, q)), "ur": c.get("ur"), "gdp_carried": c["gdp_carried"], "a2_scored": 1 if ind["a2_scored"] else 0,
                                 "niip_asof": iso(c["niip_asof"]) if c.get("niip_asof") and c["niip_asof"] != q else None,
                                 "ca_asof": iso(c["ca4_asof"]) if c.get("ca4_asof") and c["ca4_asof"] != q else None})
    flows = sorted(r["flow"] for rs in rows_by_q.values() for r in rs if r["flow"] is not None)
    lo = flows[int(0.01 * (len(flows) - 1))] if flows else -10.0
    hi = flows[int(0.99 * (len(flows) - 1))] if flows else 10.0
    step = 5 if hi - lo <= 60 else 10
    ylo, yhi = math.floor(min(lo, -step) / step) * step, math.ceil(max(hi, step) / step) * step
    sizes = [r["size"] for rs in rows_by_q.values() for r in rs]
    out_q = {}
    for q in quarters:
        if q < BOARD_FROM or (q not in rows_by_q and q not in drops):
            continue
        rs = sorted(rows_by_q.get(q, []), key=lambda r: r["eco"])
        both = [r for r in rs if r["b1"] is not None and r["b2"] is not None]
        wd = sorted((r for r in both if r["b1"] + r["b2"] < 0), key=lambda r: (r["b1"] + r["b2"], r["eco"]))[:TOP_WITHDRAWALS]
        out_q[iso(q)] = {"rows": [[r["eco"]] + [r.get(k) if k in BOARD_AS_IS else R(r.get(k), 2) for k in BOARD_COLS[1:]] for r in rs],
                         "drop": sorted(drops.get(q, [])), "n": len(rs), "n_out": sum(r["flow"] is not None and r["flow"] < 0 for r in rs),
                         "no_flow": sorted([r["eco"], r["flow_missing"]] for r in rs if r["flow"] is None),
                         "top": [[r["eco"], R(r["b1"] + r["b2"]), R(r["b1"]), R(r["b2"])] for r in wd]}
    lastq = max(out_q) if out_q else None
    if lastq:
        effect("R17", "economies drawn in the newest quarter", out_q[lastq]["n"])
        effect("R17", "economies dropped in the newest quarter (a component missing)", len(out_q[lastq]["drop"]))
        effect("R17", "economies drawn in the newest quarter without a flow (marked, not dropped)", len(out_q[lastq]["no_flow"]))
    return {"cols": list(BOARD_COLS), "quarters": sorted(out_q), "q": out_q, "domain": {"x": [0, 100], "y": [ylo, yhi], "size": [R(min(sizes or [0])), R(max(sizes or [0]))]},
            "set": {"in": keep, "out": [[c, w] for c, w in left], "euro": {c: str(d)[:10] for c, d in bc["euro"].items() if c in keep}}, "y_clip": [R(lo), R(hi)],
            "groups": {"advanced": sorted(rules.ADVANCED & set(keep))},
            "method": {"floor": rules.OWN_FLOOR, "z_cap": rules.Z_CAP, "min_history": rules.MIN_HISTORY, "min_pool": rules.MIN_POOL,
                       "reserve_issuers": sorted(rules.RESERVE_ISSUERS), "standing_swap": sorted(rules.STANDING_SWAP), "from": iso(START),
                       "a2_reserves": rules.A2_RESERVES, "res_floor": rules.RES_FLOOR, "a1_local": rules.A1_LOCAL, "buffers": list(rules.BUFFERS),
                       "offshore_gap": rules.OFFSHORE_GAP, "offshore_ratio": rules.OFFSHORE_RATIO, "a1_own_history": "same_composition",
                       "gli_currencies": list(rules.FX_CURRENCIES)}}


# ---------------------------------------------------------------------- the export surface (method 1.5)
BOARD_TRAIL = ("v", "flow", "exp", "buf", "a1", "a1n", "a2", "a2g", "a2_basis", "a2_floored", "a2_scored", "a3", "niip", "ca",
               "b1", "b2", "size", "gdp", "st", "res", "res_net", "res_drains", "ids", "loans", "stock_prev", "local_fx", "a1_local", "offshore",
               "res_net_raw")


def board_series(board: dict) -> tuple[list[str], dict[str, dict]]:
    """Per board economy, the quarterly trail of the published board as compact arrays keyed by column ({eco: {q: [...],
    v: [...], ...}}), and the board's quarters. The same function global-network's build used; R20, R21 and the
    sovereign rules read it, so every consumer sees the released columns."""
    cols = board["cols"]
    idx = {c: cols.index(c) for c in BOARD_TRAIL}
    ie = cols.index("eco")
    quarters = board["quarters"]
    out = {e: {"q": [], **{k: [] for k in BOARD_TRAIL}} for e in board["set"]["in"]}
    for q in quarters:
        for r in board["q"].get(q, {}).get("rows", []):
            e = r[ie]
            if e not in out:
                continue
            out[e]["q"].append(q)
            for k in BOARD_TRAIL:
                out[e][k].append(r[idx[k]])
    return quarters, out


# The validation set of methods 1.3 and 1.4 (scripts/validation/vulnerability_v13.py), as episodes/global publishes it: named
# external-stress episodes (the quarter of the stress), the global windows no economy is calm in, the euro-area sovereign
# stress out of scope for an FX-funding score, the warning window (quarters before the episode) and the at-risk line.
EPISODES = {
    "gfc-2008": {"en": "Global financial crisis", "ko": "세계 금융위기", "q": "2008-12-31",
                 "eco": ["KOR", "HUN", "POL", "MEX", "BRA", "RUS", "IDN", "TUR", "ZAF", "IND"]},
    "taper-2013": {"en": "Taper tantrum", "ko": "테이퍼 텐트럼", "q": "2013-09-30", "eco": ["IND", "IDN", "BRA", "TUR", "ZAF"]},
    "russia-2014": {"en": "Russia, oil and sanctions", "ko": "러시아 유가·제재 충격", "q": "2014-12-31", "eco": ["RUS"]},
    "china-2015": {"en": "China devaluation", "ko": "중국 위안화 절하", "q": "2015-09-30", "eco": ["CHN"]},
    "argentina-2018": {"en": "Argentina", "ko": "아르헨티나", "q": "2018-06-30", "eco": ["ARG"]},
    "turkey-2018": {"en": "Türkiye", "ko": "튀르키예", "q": "2018-09-30", "eco": ["TUR"]},
    "argentina-2019": {"en": "Argentina", "ko": "아르헨티나", "q": "2019-09-30", "eco": ["ARG"]},
    "covid-2020": {"en": "Covid dash for dollars", "ko": "코로나19 달러 확보 충격", "q": "2020-03-31",
                   "eco": ["BRA", "ZAF", "MEX", "RUS", "COL", "NOR", "IDN", "AUS"]},
    "turkey-2021": {"en": "Türkiye", "ko": "튀르키예", "q": "2021-12-31", "eco": ["TUR"]},
}
GLOBAL_WINDOWS = [["2008-09-30", "2009-06-30"], ["2020-03-31", "2020-06-30"]]
OUT_OF_SCOPE = {e: ["2010-06-30", "2012-12-31"] for e in ("GRC", "ITA", "ESP", "PRT")}
PRE = 4


def episodes() -> dict:
    """episodes/global: the validation set as JSON, unchanged from release to release unless the method changes."""
    return {"episodes": {k: dict(v) for k, v in EPISODES.items()}, "global_windows": [list(w) for w in GLOBAL_WINDOWS],
            "out_of_scope": {k: list(v) for k, v in OUT_OF_SCOPE.items()}, "pre": PRE, "threshold": rules.AT_RISK}


def newest_external(name: str) -> Path | None:
    files = sorted((EXTERNAL / name).glob("*.json"))
    return files[-1] if files else None


def earn() -> tuple[dict, dict[str, str]]:
    """earn/global: the newest WDI file and the newest quarterly file, each as its fetcher wrote it (the contract of
    the surface contract), and the two read dates as the datasets' vintages."""
    out, vint = {}, {}
    for key, name, ds in (("wdi", "wdi", "wb.WDI"), ("quarterly", "quarterly", "imf.QNEA")):
        f = newest_external(name)
        if not f:
            raise FileNotFoundError(f"no {name} file in {EXTERNAL / name}: run scripts/fetch_{name}.py first")
        out[key] = json.loads(f.read_text(encoding="utf-8"))
        vint[ds] = out[key]["read"]
    return out, vint


def changes(board: dict) -> dict:
    """changes/global (R20): the board's newest quarter against the one before, from the published columns."""
    quarters, series = board_series(board)
    return rules.r20_changes(series, quarters)


def sovereign(ctx: Ctx, board: dict) -> tuple[dict, dict[str, str]]:
    """sovereign/global (R22–R28): the seven-rule count over the WEO, IMF IIP and OECD yields of the newest warning
    file, with A2, the current account and net IIP as the board publishes them; and the warning file's read date as
    the WEO's vintage."""
    from . import sovereign as sov
    _, series = board_series(board)
    names = {c: {"en": e["en"], "ko": e["ko"] or e["en"], "region": e["region"], "subregion": e["subregion"]} for c, e in ctx.econ.items()}
    obj = sov.build(series, names)
    return obj, {"imf.WEO": obj["meta"]["read"]}


def lender_cut(ctx: Ctx, board: dict) -> dict:
    """mkt/bank `lender_cut` (R21): for every board economy at the newest LBS quarter, the all-reporter loans and deposits
    on it, each bilateral reporter's share of that total, the reporters that publish all instruments only for it (R5
    "nosplit": listed apart with their all-instrument amount, no share), and the board's net reserves at that quarter (or
    the newest board quarter before it): `res_net_raw` (Section I + II, may be negative) and `res_net` (A2's reserve base)."""
    q = ctx.q("SELECT max(period) FROM links_m WHERE dataset = 'bis.LBS' AND channel = 'bank' AND basis = 'residence' AND creditor = ?", [rules.ALL_REPORTERS])[0][0]
    econs = board["set"]["in"]
    rows = ctx.q("""SELECT debtor, creditor, channel, position_usd, agg_creditor FROM links_m WHERE dataset = 'bis.LBS' AND channel IN ('bank', 'bank_all')
                    AND basis = 'residence' AND period = ? AND position_usd IS NOT NULL AND creditor <> debtor""", [q])
    total: dict[str, float] = {}
    lenders: dict[str, dict[str, float]] = defaultdict(dict)
    allin: dict[str, dict[str, float]] = defaultdict(dict)
    for d, c, ch, pos, agg in rows:
        if d not in econs:
            continue
        if ch == "bank_all":
            if not agg:
                allin[d][c] = pos
        elif c == rules.ALL_REPORTERS:
            total[d] = pos
        elif not agg:                                             # BIS aggregates are totals, never lenders (R11)
            lenders[d][c] = pos
    _, series = board_series(board)
    qs = iso(q)
    out = {}
    for e in econs:
        b = series.get(e)
        res_net = res_raw = None
        if b and b["q"]:
            k = max((i for i, bq in enumerate(b["q"]) if bq <= qs), default=None)
            res_net = b["res_net"][k] if k is not None else None
            res_raw = b["res_net_raw"][k] if k is not None else None
        nosplit = {c: v for c, v in allin.get(e, {}).items() if c not in lenders.get(e, {})}   # the same test as the ladder's `nosplit` (R5)
        rec = rules.r21_lender_cut(total.get(e), lenders.get(e, {}), res_net, nosplit, res_raw)
        if rec:
            out[e] = rec
    return {"q": qs, "debtors": out}


PULSE = (("swap_lines", "SWPT", "W", "abs"), ("custody_treasuries", "WMTSECL1", "W", "abs"), ("dollar_index", "DTWEXBGS", "D", "pct"))
PULSE_WEEKS = 53                                                 # a year of weekly points for the sparkline (V11 v2 allows these)
STALE_DAYS = 10                                                  # a pulse tile older than this at build time says so (V21)


def pulse(ctx: Ctx) -> dict:
    """The World pulse: for each weekly or daily series its newest value and date, the change over four weeks (in USD bn,
    or in per cent for the dollar index), the last 53 Wednesdays for a sparkline, the age in days and a stale flag; TIC
    net purchases by all and by official holders for the last 13 months."""
    out = {}
    for measure, key, f, kind in PULSE:
        obs = [(p, v) for p, v in ctx.q("SELECT period, value_usd FROM signals_m WHERE measure = ? AND detail = ? ORDER BY period", [measure, key]) if v is not None]
        if not obs:
            out[measure] = {"ds": "fred.observations", "key": key, "f": "W", "missing": True}
            continue
        last_d, last_v = obs[-1]
        back = [v for p, v in obs if p <= last_d - dt.timedelta(days=28)]
        chg = None
        if back:
            chg = (100 * (last_v / back[-1] - 1)) if kind == "pct" else last_v - back[-1]
        weds, i = [], 0
        wed = last_d - dt.timedelta(days=(last_d.weekday() - 2) % 7)
        for k in range(PULSE_WEEKS - 1, -1, -1):
            g = wed - dt.timedelta(days=7 * k)
            while i + 1 < len(obs) and obs[i + 1][0] <= g:
                i += 1
            if obs[i][0] <= g:
                weds.append([iso(g), R(obs[i][1], 2)])
        age = (ctx.day - last_d).days
        out[measure] = {"ds": "fred.observations", "key": key, "f": "W", "pts": weds, "latest": [iso(last_d), R(last_v, 2)],
                        "chg": R(chg, 2), "kind": kind, "age": age, "stale": age > STALE_DAYS}
    tic = {}
    for who in ("total", "official"):
        tic[who] = [[iso(p), R(v, 1)] for p, v in ctx.q("""SELECT period, value_usd FROM signals_m WHERE measure = ? AND detail = 'all long-term'
                                                           ORDER BY period""", [f"tic_net_{who}"])][-RECENT:]
    if tic["total"]:
        off = dict(map(tuple, tic["official"]))
        priv = [[p, R(v - off[p], 1) if p in off and v is not None and off[p] is not None else None] for p, v in tic["total"]]
        last = tic["total"][-1][0]
        out["tic"] = {"ds": "tic.files", "f": "M", "official": tic["official"], "private": priv, "latest": last,
                      "age": (ctx.day - dt.date.fromisoformat(last)).days}
    return out
