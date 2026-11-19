"""The method's rules R1–R21 (config/method.yaml), one function each; R22–R28, the sovereign rules, are in sovereign.py.

The table rules (R12, R2, R3, R4, R5, R1, R11, R10) take a DuckDB connection and the name of a relation, and create the
next relation in the chain; marks.py applies them in the order the method fixes. The ladder rules (R7, R6, R8, R13,
R9, R14, R15) work on the numbers of one view; R20 (the change feed) and R21 (the lender cut) work on the released
board and pair figures. Every rule records what it did with registry.effect(), so the Method page can say, for this
release, "R4 dropped n pair reports" from what the code did, not from prose.
"""
from __future__ import annotations

import bisect
import datetime as dt
import math
import re

from .registry import effect, rule

AGG = "SELECT code FROM economies WHERE is_aggregate"
ALL_REPORTERS, ALL_COUNTERPARTIES = "BIS:5A", "BIS:5J"         # BIS aggregates used as totals (R11)


def n(con, sql: str) -> int:
    return con.execute(f"SELECT count(*) FROM ({sql})").fetchone()[0]


# ---------------------------------------------------------------------- table rules
@rule("R12")
def r12_duplicates(con, src: str, dst: str, key: list[str], value: str) -> int:
    """Rows repeated exactly were already written once by build_tables.py (its counts are in tables/effects.json).
    Here: rows with the same key and different values are counted (V1 stops the release on any), and the relation is
    passed on unchanged."""
    k = ", ".join(key)
    conflicts = con.execute(f"SELECT count(*) FROM (SELECT {k} FROM {src} GROUP BY ALL HAVING count(DISTINCT {value}) > 1)").fetchone()[0]
    con.execute(f"CREATE OR REPLACE VIEW {dst} AS SELECT * FROM {src}")
    effect("R12", f"{src}: keys with conflicting values", conflicts)
    return conflicts


@rule("R2")
def r2_totals_only(con, src: str, dst: str) -> None:
    """Keep the total rows only: all sectors and all currencies (the breakdowns stay in the tables for tooltips)."""
    con.execute(f"CREATE OR REPLACE VIEW {dst} AS SELECT * FROM {src} WHERE sector_debtor = 'all' AND currency = 'all'")
    effect("R2", "breakdown rows left out of sums (sector or currency)", n(con, f"SELECT 1 FROM {src} WHERE NOT (sector_debtor = 'all' AND currency = 'all')"))


@rule("R3")
def r3_one_frequency(con, src: str, dst: str) -> None:
    """At a December with a half-yearly and an annual row for the same key (CPIS), keep the half-yearly one; a pair whose
    two values differ by more than 0.1% is counted as flagged."""
    key = "period, creditor, debtor, channel, basis, sector_debtor, currency, reported_by, dataset"
    con.execute(f"""CREATE OR REPLACE VIEW {dst} AS
        SELECT * FROM {src} l WHERE NOT (l.freq = 'A' AND l.dataset = 'imf.PIP' AND EXISTS (
            SELECT 1 FROM {src} s WHERE s.freq = 'S' AND s.dataset = 'imf.PIP' AND (s.period, s.creditor, s.debtor, s.channel, s.basis,
                s.sector_debtor, s.currency, s.reported_by) = (l.period, l.creditor, l.debtor, l.channel, l.basis, l.sector_debtor, l.currency, l.reported_by)))""")
    dropped = n(con, f"SELECT 1 FROM {src} WHERE freq = 'A' AND dataset = 'imf.PIP'") - n(con, f"SELECT 1 FROM {dst} WHERE freq = 'A' AND dataset = 'imf.PIP'")
    differ = con.execute(f"""SELECT count(*) FROM {src} a JOIN {src} s USING ({key})
        WHERE a.freq = 'A' AND s.freq = 'S' AND a.dataset = 'imf.PIP' AND abs(a.position_usd - s.position_usd) > 0.001 * greatest(abs(s.position_usd), 1e-9)""").fetchone()[0]
    effect("R3", "annual rows dropped where a half-yearly row exists", dropped)
    effect("R3", "pairs flagged (annual and half-yearly differ)", differ)


R4_ORDER = "CASE reported_by WHEN 'debtor' THEN 0 WHEN 'creditor' THEN 1 WHEN 'mirror_debtor' THEN 2 WHEN 'mirror_creditor' THEN 3 ELSE 9 END"


@rule("R4")
def r4_one_report_per_pair(con, src: str, dst: str) -> None:
    """Direct investment: one reporter per pair for the whole series, so a pair's history never steps from one report
    to another. The reporter with the most periods is chosen; on a tie the host's own report comes first, then the
    investor's, then a mirror (mirrors are copies of the counterpart's report: the audit of 29 Oct 2026 found 0
    differences in 329,399 pairs). At each period the best other report, where one exists, is kept as `alt_usd` for
    the tooltip and check V6."""
    con.execute(f"""CREATE OR REPLACE VIEW {dst} AS
        WITH d AS (SELECT * FROM {src} WHERE dataset = 'imf.DIP'),
             span AS (SELECT creditor, debtor, channel, reported_by, count(*) n, min({R4_ORDER}) ord FROM d WHERE position_usd IS NOT NULL GROUP BY ALL),
             pick AS (SELECT creditor, debtor, channel, reported_by FROM (
                        SELECT *, row_number() OVER (PARTITION BY creditor, debtor, channel ORDER BY n DESC, ord) rk FROM span) WHERE rk = 1),
             alt AS (SELECT creditor, debtor, channel, period, position_usd alt_usd FROM (
                        SELECT d.*, row_number() OVER (PARTITION BY d.creditor, d.debtor, d.channel, d.period ORDER BY {R4_ORDER.replace('reported_by', 'd.reported_by')}) rk
                        FROM d JOIN pick p USING (creditor, debtor, channel) WHERE d.reported_by <> p.reported_by AND d.position_usd IS NOT NULL) WHERE rk = 1)
        SELECT d.*, alt.alt_usd FROM d JOIN pick p USING (creditor, debtor, channel, reported_by) LEFT JOIN alt USING (creditor, debtor, channel, period)
        UNION ALL
        SELECT *, NULL::DOUBLE alt_usd FROM {src} WHERE dataset <> 'imf.DIP'""")
    effect("R4", "direct investment pair reports dropped (the pair's chosen reporter is another)",
           n(con, f"SELECT 1 FROM {src} WHERE dataset = 'imf.DIP'") - n(con, f"SELECT 1 FROM {dst} WHERE dataset = 'imf.DIP'"))
    effect("R4", "pairs drawn from the investor's report (the host reports fewer years or none)",
           n(con, f"SELECT DISTINCT creditor, debtor FROM {dst} WHERE dataset = 'imf.DIP' AND reported_by = 'creditor'"))
    effect("R4", "pair-periods with a second report kept as context (alt)", n(con, f"SELECT 1 FROM {dst} WHERE dataset = 'imf.DIP' AND alt_usd IS NOT NULL"))


@rule("R5")
def r5_bank_loans_and_deposits(con, src: str, dst: str) -> None:
    """The residence bank channel is LBS loans and deposits (instrument G). The other LBS instruments keep their own
    channel and never enter the bank ribbon: `bank_all` (A, context), `bank_debt` (D, debt securities: they are counted
    in portfolio debt, so context only) and `bank_other` (I, derivatives and other instruments: in no other channel, so
    a pool of its own against the IIP derivatives item, R6). CBS (nationality) has no instrument split; it stays all
    instruments and is labelled."""
    con.execute(f"""CREATE OR REPLACE VIEW {dst} AS
        SELECT * REPLACE (CASE WHEN dataset = 'bis.LBS' AND channel = 'bank' THEN 'bank_all'
                               WHEN dataset = 'bis.LBS' AND channel = 'bank_loans' THEN 'bank' ELSE channel END AS channel)
        FROM {src}""")
    effect("R5", "LBS all-instrument rows kept as context, out of the bank ribbon", n(con, f"SELECT 1 FROM {src} WHERE dataset = 'bis.LBS' AND channel = 'bank'"))
    effect("R5", "LBS debt-securities rows kept as context (counted in portfolio debt)", n(con, f"SELECT 1 FROM {src} WHERE dataset = 'bis.LBS' AND channel = 'bank_debt'"))
    effect("R5", "LBS derivatives-and-other rows drawn as their own pool, never in the bank ribbon", n(con, f"SELECT 1 FROM {src} WHERE dataset = 'bis.LBS' AND channel = 'bank_other'"))


@rule("R1")
def r1_units(con, src: str, dst: str) -> None:
    """Stocks: a national series with no US dollar value (no BIS rate for its month) is dropped, never filled in. Counts
    the conversions made at period-end and at period-average rates (build_tables.py converts; R1 is its contract)."""
    con.execute(f"CREATE OR REPLACE VIEW {dst} AS SELECT * FROM {src} WHERE value_usd IS NOT NULL AND isfinite(value_usd)")
    effect("R1", "stock values without a rate, left out", n(con, f"SELECT 1 FROM {src} WHERE value_usd IS NULL OR NOT isfinite(value_usd)"))
    effect("R1", "of which an IMF currency-union aggregate (ECCU, WAEMU: never drawn)", n(con, f"SELECT 1 FROM {src} WHERE (value_usd IS NULL OR NOT isfinite(value_usd)) AND economy IN ({AGG})"))
    for eco, k, lo, hi in con.execute(f"""SELECT economy, count(*), min(period), max(period) FROM {src} WHERE (value_usd IS NULL OR NOT isfinite(value_usd))
                                          AND economy NOT IN ({AGG}) GROUP BY 1 HAVING count(*) >= 20 ORDER BY 2 DESC""").fetchall():
        effect("R1", f"of which {eco}: no BIS rate for its currency, {lo} to {hi}", k)
    effect("R1", "of which economies with fewer than 20 such values (the newest months, before the BIS rate file reaches them)",
           n(con, f"""SELECT 1 FROM {src} WHERE (value_usd IS NULL OR NOT isfinite(value_usd)) AND economy NOT IN ({AGG})
                      AND economy IN (SELECT economy FROM {src} WHERE value_usd IS NULL OR NOT isfinite(value_usd) GROUP BY 1 HAVING count(*) < 20)"""))
    effect("R1", "converted at one, a dollarised economy or a dollar regime (currency map, dated regimes)", n(con, f"SELECT 1 FROM {dst} WHERE currency = 'USD' AND value_lcu IS NULL AND dataset LIKE 'imf.MFS%'"))
    effect("R1", "converted at a period-average rate", n(con, f"SELECT 1 FROM {dst} WHERE value_lcu IS NOT NULL AND detail LIKE '%average%'"))
    effect("R1", "converted at a period-end rate", n(con, f"SELECT 1 FROM {dst} WHERE value_lcu IS NOT NULL AND (detail IS NULL OR detail NOT LIKE '%average%')"))


@rule("R11")
def r11_aggregates(con, src: str, dst: str) -> None:
    """Flag the rows whose creditor or debtor is a source aggregate: they are totals (R6), never a holder or a destination."""
    con.execute(f"""CREATE OR REPLACE VIEW {dst} AS
        SELECT *, creditor IN ({AGG}) AS agg_creditor, debtor IN ({AGG}) AS agg_debtor FROM {src}""")
    effect("R11", "rows whose counterparty is an aggregate (used as totals, never as parts)",
           n(con, f"SELECT 1 FROM {src} WHERE creditor IN ({AGG}) OR debtor IN ({AGG})"))


@rule("R10")
def r10_basis(con, src: str, dst: str) -> None:
    """Residence rows for every channel; nationality rows (BIS CBS, immediate borrower) only for banks. The
    ultimate-risk basis is not drawn."""
    con.execute(f"CREATE OR REPLACE VIEW {dst} AS SELECT * FROM {src} WHERE basis = 'residence' OR (basis = 'nationality' AND channel = 'bank')")
    effect("R10", "ultimate-risk rows not drawn", n(con, f"SELECT 1 FROM {src} WHERE basis = 'ultimate_risk'"))


# ---------------------------------------------------------------------- ladder rules
@rule("R7")
def r7_periods(available: dict[str, list[dt.date]], required: list[str], day: dt.date) -> dict[str, dt.date | None]:
    """The aligned period: the newest period at or before `day` that every required channel has. Returns, per channel,
    the period it is drawn at (None when the channel has nothing then)."""
    sets = [set(p for p in available.get(c, []) if p <= day) for c in required if available.get(c)]
    common = set.intersection(*sets) if sets else set()
    p = max(common) if common else None
    return {c: (p if p in set(available.get(c, [])) else None) for c in available} | {"_aligned": p}


def newest_at(periods: list[dt.date], day: dt.date) -> dt.date | None:
    ps = [p for p in periods if p <= day]
    return max(ps) if ps else None


def r7_own_period(periods: list[dt.date], aligned: dt.date | None) -> dt.date | None:
    """A channel that is slower than the aligned period (annual DIP against quarterly banks and half-yearly CPIS) sits at
    its own newest period at or before the aligned one, labelled with that period; it is never interpolated and never
    summed with the other channels."""
    return newest_at(periods, aligned) if aligned else None


@rule("R6")
def r6_gap_to_total(total: float | None, parts: list[float], unranked: list[float] = ()) -> dict:
    """not identified = total − the identified parts; coverage = identified / total. `unranked` parts are identified
    holders that are not ranked as a node of their own (the IMF's confidential reserves-and-international-organisations
    group, TX093): they count as identified. An excess (parts above the total) is returned as a negative gap and
    flagged, never clipped; `coverage` is then capped at 1 and `excess_by` says by how much the parts exceed the total.
    The total of the FDI group is the DIP's own all-investor figure where the DIP has the period (views.py), so that
    parts and total are on one valuation basis; the IIP item is the border."""
    ident = math.fsum(parts) + math.fsum(unranked)
    if total is None:
        return {"identified": ident, "total": None, "gap": None, "coverage": None, "excess": False, "excess_by": None}
    gap = total - ident
    cov = ident / total if total else None
    return {"identified": ident, "total": total, "gap": gap, "coverage": min(cov, 1.0) if cov is not None else None,
            "excess": gap < -1e-9, "excess_by": -gap if gap < -1e-9 else None}


@rule("R8")
def r8_flow_kinds(flows: list[tuple[float | None, str | None]]) -> dict:
    """Sum flows by kind; published and derived flows are never added together. Returns {kind: sum}."""
    out: dict[str, float] = {}
    for v, k in flows:
        if v is None or k is None:
            continue
        out[k] = out.get(k, 0.0) + v
    return out


# ---------------------------------------------------------------------- R16 quarantine
QUARANTINED: list[dict] = []                                     # what R16 dropped in this build (V13 reports it)
NONRES = {"cb_claims_nonres": "assets", "cb_liabilities_nonres": "liabilities", "banks_claims_nonres": "assets", "banks_liabilities_nonres": "liabilities"}
BOUND = 1.05                                                     # non-resident claims or liabilities are part of the IIP total on that side: above it is impossible


def _unit_ratio(r: float) -> bool:
    """A move whose ratio is within 3% of a power of ten (10, 100, 1000, ...): a unit or scale error in the source."""
    k = round(math.log10(r))
    return k >= 1 and abs(r / 10 ** k - 1) < 0.03


@rule("R16")
def r16_quarantine(con, src: str, dst: str, totals: str | None = None) -> None:
    """Quarantine source errors in the monthly, quarterly and annual stock series (the primary source of each measure).
    An observation is judged when the series moves more than tenfold against the previous value (in the source's own
    currency where it has one): (a) if it returns within 50% of the old level within two periods it is a spike and is
    dropped; (b) if the ratio is a power of ten it is a unit error, and every value at the new level is RESCALED by that
    power of ten back to the level of the earlier segment (method 1.4: a thousandfold change of unit in the source no
    longer ends the series; the earlier segment is trusted, and a wrong earlier segment is corrected by a listed unit
    correction in config/datasets.yaml before this rule runs); (c) if the new level is implausible, a central bank's or
    the banks' claims on or liabilities to non-residents above the economy's IIP total on that side, the observation
    and every later value at that level are dropped, so a series stops rather than jumps. Real moves (a bank collapse,
    a euro adoption, an exchange-rate unification) do not match (a)–(c) and stay; check V13 lists them as information.
    Daily and weekly series are not touched: V13 tests their monthly averages."""
    rows = con.execute(f"""SELECT economy, measure, dataset, freq, coalesce(detail, ''), coalesce(currency, ''), period, value_usd, value_lcu
                           FROM {src} WHERE "primary" AND freq IN ('M', 'Q', 'A') AND measure NOT LIKE '%net_issues%'
                           ORDER BY economy, measure, dataset, freq, 5, 6, period""").fetchall()
    iip: dict[tuple, list] = {}
    if totals:
        for e, side, p, v in con.execute(f"SELECT economy, side, period, position_usd FROM {totals} WHERE item = 'total' AND side IN ('assets', 'liabilities') ORDER BY period").fetchall():
            iip.setdefault((e, side), []).append((p, v))
    drops: list[tuple] = []
    fixes: list[tuple] = []
    QUARANTINED.clear()
    series: dict[tuple, list] = {}
    for r in rows:
        series.setdefault(r[:6], []).append(r[6:])
    for key, obs in series.items():
        eco, measure, ds, freq = key[:4]
        x = [[p, lcu if lcu is not None else usd, usd] for p, usd, lcu in obs]
        i, base = 1, 0                                            # base: the index of the last trusted value
        while i < len(x):
            p, v, usd = x[i]
            pv, pusd = x[base][1], x[base][2]
            if pv is None or v is None or pv <= 0 or v <= 0 or min(abs(usd or 0), abs(pusd or 0)) <= 0.5:
                base = i; i += 1; continue
            r = v / pv
            if r <= 10 and r >= 0.1:
                base = i; i += 1; continue
            reason, until, factor = None, i, None
            revert = next((j for j in (i + 1, i + 2) if j < len(x) and x[j][1] and abs(x[j][1] / pv - 1) < 0.5), None)
            if revert is not None:
                reason, until = "spike: returns to the old level within two periods", revert - 1
            elif _unit_ratio(r if r > 1 else 1 / r):
                k = round(math.log10(r))
                factor = 10.0 ** (-k)
                reason = f"unit error: the ratio {r:.4g} is a power of ten; rescaled by 10^{-k} to the earlier level"
            elif r > 10:
                if measure in NONRES:
                    hist = iip.get((eco, NONRES[measure]), [])
                    comp = next((t for q, t in reversed(hist) if q <= p), None)
                    if comp is not None and usd is not None and usd > BOUND * comp:
                        reason = f"implausible: {usd:,.1f} bn against the IIP {NONRES[measure]} total {comp:,.1f} bn, of which it is a part"
            if reason is None:
                base = i; i += 1; continue                        # a real or unexplained move: V13 reports it
            if until == i and revert is None:                     # (b), (c): every later value nearer the wrong level than the old one is in the segment
                mid = math.sqrt(r)                                # the geometric midpoint between the old level (1) and the new (r), as a ratio to the old
                j = i + 1
                while j < len(x) and x[j][1] and ((x[j][1] / pv > mid) if r > 1 else (x[j][1] / pv < mid)):
                    j += 1
                until = j - 1
            for j in range(i, until + 1):
                if factor is None:
                    drops.append((*key, x[j][0]))
                else:
                    fixes.append((*key, x[j][0], factor))
                    x[j][1] = x[j][1] * factor if x[j][1] is not None else None     # the rescaled segment is the level later values are judged against
                    x[j][2] = x[j][2] * factor if x[j][2] is not None else None
            QUARANTINED.append({"economy": eco, "measure": measure, "dataset": ds, "freq": freq, "from": str(x[i][0]), "to": str(x[until][0]),
                                "n": until - i + 1, "previous": round(pusd, 1) if pusd is not None else None, "value": round(usd, 1) if usd is not None else None,
                                "ratio": round(r, 1), "reason": reason, "action": "dropped" if factor is None else "rescaled", "factor": factor})
            if factor is None:
                i = until + 1                                     # the base stays: the next value is judged against the last trusted one
            else:
                base, i = until, until + 1                        # the rescaled segment is trusted from here on
    cols = "economy VARCHAR, measure VARCHAR, dataset VARCHAR, freq VARCHAR, detail VARCHAR, currency VARCHAR, period DATE"
    con.execute(f"CREATE OR REPLACE TABLE r16_drops ({cols})")
    con.execute(f"CREATE OR REPLACE TABLE r16_fixes ({cols}, factor DOUBLE)")
    if drops:
        con.executemany("INSERT INTO r16_drops VALUES (?, ?, ?, ?, ?, ?, ?)", drops)
    if fixes:
        con.executemany("INSERT INTO r16_fixes VALUES (?, ?, ?, ?, ?, ?, ?, ?)", fixes)
    on = lambda t: (f"{t}.economy = s.economy AND {t}.measure = s.measure AND {t}.dataset = s.dataset AND {t}.freq = s.freq "
                    f"AND {t}.detail = coalesce(s.detail, '') AND {t}.currency = coalesce(s.currency, '') AND {t}.period = s.period")
    con.execute(f"""CREATE OR REPLACE VIEW {dst} AS
                    SELECT s.* REPLACE (s.value_usd * coalesce(f.factor, 1) AS value_usd, s.value_lcu * coalesce(f.factor, 1) AS value_lcu)
                    FROM {src} s LEFT JOIN r16_drops d ON {on('d')} LEFT JOIN r16_fixes f ON {on('f')}
                    WHERE d.period IS NULL""")
    effect("R16", "observations quarantined as source errors (spikes, implausible levels)", len(drops))
    effect("R16", "observations rescaled by a power of ten (unit errors in the source)", len(fixes))
    effect("R16", "series affected", len(QUARANTINED))


LAYERS = {"monetary_base": 0, "currency": 0, "reserves_banks": 0, "cb_assets": 0, "fx_reserves": 0,
          "m1": 1, "broad_money": 1, "m3": 1, "lf": 1, "credit_private": 1,
          "l": 2, "mmf_retail": 2, "stablecoins": 2}


@rule("R9")
def r9_layers(measures: dict[str, float]) -> dict[int, list[str]]:
    """Group the made-here measures by layer. Nothing is summed across layers: the result is a grouping, and the page
    draws layer 2 as an outline beside layer 1, never stacked on it."""
    by: dict[int, list[str]] = {}
    for m in measures:
        by.setdefault(LAYERS.get(m, 2), []).append(m)
    return by


@rule("R13")
def r13_precision(v: float | None, digits: int = 1) -> float | None:
    """Round for display only: 0.1 bn for amounts (digits=1), 0.1% for shares (pass a percentage). Totals are computed
    before this is called."""
    if v is None or not math.isfinite(v):
        return None
    r = round(v, digits)
    return 0.0 if r == 0 else r                                   # no "-0.0"


VENDORS = re.compile(r"\b(epfr|lipper|lseg|refinitiv)\b", re.I)   # commercial vendors: never on the site (R14)
FUND_FIELDS = re.compile(r'"(domicile|fund_id|fund_name|fund_count|n_funds|funds)"')


@rule("R14")
def r14_no_commercial_data(classes: dict, files: dict[str, bytes]) -> list[str]:
    """No commercial data on the site (1 Nov 2026). No registry class that may be shown is a licensed one, and no public
    file names a vendor or carries a fund-level field. Returns the findings; an empty list is a clean release."""
    bad = [f"class {c} is licensed but marked shown" for c, v in classes.items() if v.get("shown") and c.startswith("licensed")]
    for path, b in files.items():
        s = b.decode("utf-8")
        if m := VENDORS.search(s):
            bad.append(f"{path}: names {m.group(0)}")
        if m := FUND_FIELDS.search(s):
            bad.append(f"{path}: a fund-level field {m.group(0)}")
    effect("R14", "public files scanned", len(files))
    effect("R14", "commercial values found", len(bad))
    return bad


@rule("R15")
def r15_revisions(previous: dict[str, str] | None, current: dict[str, str]) -> dict[str, tuple[str | None, str]]:
    """The datasets whose vintage changed since the previous release: {dataset: (old vintage, new vintage)}."""
    previous = previous or {}
    changed = {d: (previous.get(d), v) for d, v in current.items() if previous.get(d) != v}
    effect("R15", "datasets with a new vintage since the previous release", len(changed))
    return changed


# ---------------------------------------------------------------------- the World page's Signal Board (method 1.2)
FINANCIAL_CENTRES = ["ABW", "BHS", "BHR", "BRB", "BMU", "CYM", "CUW", "GIB", "GGY", "HKG", "IMN", "JEY", "LBN", "MAC", "MUS", "PAN",
                     "WSM", "SGP", "VUT", "VGB"]                 # offshore centres as BIS LBS groups them
FUND_DOMICILES = ["LUX", "IRL", "NLD", "CHE"]                    # fund domiciles: a holder there is rarely the end investor (R10, audit F15)
BOARD_HUB = "USA"                                                # the hub of the dollar system, not a borrower in the board's sense
FX_CURRENCIES = ("USD", "EUR", "JPY")                            # the GLI currencies
MIN_HISTORY = 8                                                  # quarters an indicator needs before its own-history signal is shown (R18)


@rule("R19")
def r19_economy_set(candidates: set[str], aggregates: set[str]) -> tuple[list[str], list[tuple[str, str]]]:
    """The board's economies: every economy with a GDP denominator (BIS total credit), less the hub, the BIS offshore
    centres, the fund domiciles and aggregates (the euro area: its members are shown one by one). Returns the economies
    in and the ones left out with the reason."""
    out = []
    for c in sorted(candidates):
        why = ("hub" if c == BOARD_HUB else "offshore_centre" if c in FINANCIAL_CENTRES else "fund_domicile" if c in FUND_DOMICILES
               else "aggregate" if c in aggregates or c == "EMU" else None)
        if why:
            out.append((c, why))
    left = {c for c, _ in out}
    keep = sorted(c for c in candidates if c not in left)
    effect("R19", "economies on the board", len(keep))
    effect("R19", "economies with a GDP denominator left out (hub, offshore centre, fund domicile, aggregate)", len(out))
    return keep, out


def own_currencies(eco: str, day: dt.date, euro: dict[str, object]) -> set[str]:
    """The economy's own currencies on `day` (R19): the yen for Japan; the euro for a member from its adoption date
    (config/economies.csv euro_area_from: Croatia 2023-01-01, Bulgaria 2026-01-01), so that euro credit stops counting
    as foreign currency in A1 from that quarter. Other economies' own currencies are never in the A1 currencies."""
    own = {"JPY"} if eco == "JPN" else set()
    if eco in euro and day.isoformat() >= str(euro[eco])[:10]:
        own.add("EUR")
    return own


def r5_nosplit_share(nosplit: dict[str, float], total: float | None) -> float | None:
    """The share (per cent) of an economy's all-reporter bank claims that come from reporters publishing no instrument
    split (Japan, Germany): their all-instrument claims over the all-reporter all-instrument total. Shown on the
    coverage panel beside the bank ribbon's coverage (R5); never estimated into the ribbon."""
    if not total or total <= 0 or not nosplit:
        return None
    return 100 * math.fsum(v for v in nosplit.values() if v) / total


RESERVE_ISSUERS = {"JPN", "GBR"}                                # issuers of a reserve currency on the board (the US and Switzerland are out, R19)
STANDING_SWAP = {"CAN"}                                          # a standing, unlimited Fed swap line (the ECB, BoJ, BoE and SNB have one too)
ADVANCED = {"AUS", "AUT", "BEL", "CAN", "CZE", "DEU", "DNK", "ESP", "FIN", "FRA", "GBR", "GRC", "ISR", "ITA", "JPN", "KOR", "NOR", "NZL",
            "PRT", "SWE"}                                        # IMF WEO advanced economies on the board: the page's group filter, never the score


def a2_scored(eco: str, own: set[str]) -> bool:
    """A2 (short-term bank debt over reserves) is scored only where reserves are the economy's last line of foreign-currency
    liquidity: not for a euro member (its short-term claims are largely in its own currency, and the euro area's reserves
    are pooled), not for an issuer of a reserve currency, not for an economy with a standing unlimited Fed swap line."""
    return not ("EUR" in own or eco in RESERVE_ISSUERS or eco in STANDING_SWAP)


def _fx_credit(c: dict, own: set[str], bonds: str) -> tuple[float, float, float] | None:
    fl = {k: v for k, v in (c.get("fx_loans") or {}).items() if k not in own and v is not None}
    if not fl:
        return None
    fb = {k: b for k, b in (c.get(bonds) or {}).items() if k not in own}
    fxb = math.fsum((b.get("all") or 0) - (b.get("private_banks") or 0) - (b.get("public_banks") or 0) for b in fb.values())
    return math.fsum(fl.values()) + fxb, math.fsum(fl.values()), fxb


A2_RESERVES = "net"                                              # method 1.4: A2 over net reserves (IRFCL Section I + Section II); "gross" = Section I
RES_FLOOR = 0.1                                                  # the A2 denominator is never below this share of gross reserves (net can be negative: Turkey 2023)
A1_LOCAL = True                                                  # method 1.4: A1 adds banks' local foreign-currency claims on resident non-banks where the economy reports them
OFFSHORE_GAP, OFFSHORE_RATIO = 5.0, 2.0                           # the offshore-issuance flag: nationality A1 at least 5 points of GDP above the cross-border residence A1, or at least twice it (and 1 point above)


def offshore_flag(a1n: float | None, a1x: float | None) -> bool:
    """Nationality A1 far above the residence A1 built from the same cross-border and bond components: issuance by
    offshore affiliates that the residence basis cannot see (China's developers 2021, Brazil, Saudi Arabia)."""
    if a1n is None or a1x is None:
        return False
    return a1n - a1x >= OFFSHORE_GAP or (a1n >= OFFSHORE_RATIO * a1x and a1n - a1x >= 1.0)


def net_reserves_raw(res: float | None, drains: float | None) -> float | None:
    """Net reserves as the measures registry defines them (family/measures.json `net_reserves`):
    IRFCL Section I official reserve assets plus Section II predetermined short-term net drains (negative for outflows),
    with no floor, so it can be negative (Argentina 2026 Q2: 44.87 − 68.43 = −23.56). None where either section is not
    published for the quarter. This is the value every reader outside A2 uses (`res_net_raw`)."""
    if res is None or drains is None:
        return None
    return res + drains


def net_reserves(res: float | None, drains: float | None) -> tuple[float | None, bool, str]:
    """(A2's reserve base, whether the floor binds, its basis): gross reserves (IRFCL Section I) plus the predetermined
    short-term net drains (Section II, negative for outflows: forwards and swaps falling due, scheduled debt service),
    never below RES_FLOOR × gross; gross alone where Section II is not published for the quarter. The base is used only
    as A2's denominator (`res_net`, registry `a2_reserve_base`); net reserves themselves are net_reserves_raw()."""
    if res is None or res <= 0:
        return None, False, "none"
    if A2_RESERVES != "net" or drains is None:
        return res, False, "gross"
    net = res + drains
    floor = RES_FLOOR * res
    return (floor, True, "net") if net < floor else (net, False, "net")


@rule("R17")
def r17_indicators(c: dict, prev: dict | None, own: set[str], scored_a2: bool = True) -> tuple[dict, str | None]:
    """One economy-quarter of the board from its components (all USD bn): every indicator its components allow, and the
    reason the economy-quarter may not be drawn (None when it may).

    c: fx_loans {ccy: cross-border loans and deposits to non-banks}, local_fx (banks inside the economy: claims in
    foreign currency on resident non-banks, LBS local positions; absent where the economy does not report to the LBS),
    fx_bonds_res and fx_bonds {ccy: {all, private_banks, public_banks}} (international debt securities by residence and
    by nationality of issuer), gdp, st (CBS international claims up to one year), res (IRFCL Section I reserves),
    res_drains (IRFCL Section II, predetermined net drains within a year, negative = outflow), ids (international debt
    securities by nationality), ids_net (their net issues), loans (LBS cross-border loans and deposits, all sectors),
    loans_flow (their FX- and break-adjusted change), niip (IIP net position), debt_liab and debt_assets (IIP debt
    instruments; reserves on the asset side), ca4 (current account, four quarters). prev: the same for the quarter
    before. own: the economy's own currencies at that date. Also returned: `res_net_raw`, net reserves without the floor
    (Section I + Section II, may be negative; None without Section II), and `flow_missing`, the reason the flow is
    missing (None when it exists).

    Scored (method 1.4): A1 = FX credit to non-banks by RESIDENCE / GDP: cross-border loans to resident non-banks,
    plus the local foreign-currency claims of banks inside the economy where reported (`a1_local` says so), plus bonds
    of resident non-banks, so numerator and GDP cover the same economy; A2 = short-term claims / net reserves (Section I
    + Section II, floored at RES_FLOOR of gross; `a2_floored`, `a2_basis` say what was used), where scored (a2_scored);
    buffers NIIP / GDP and current account / GDP. Shown, not scored: A1 by nationality (`offshore` flags a gap to the
    cross-border residence A1 `a1x`), A2 on gross reserves `a2g`, A3 = bond share, net external debt / GDP. Flow: B1 =
    loans_flow, B2 = ids_net, flow = (B1 + B2) / (ids + loans of the quarter before) × 4, in per cent: one ratio of the
    two flows summed over the two stocks summed, not each flow against its own stock; debt securities and loans are
    disjoint (V20). B1 covers every sector and currency (interbank funding included)."""
    out: dict = {"a1": None, "a1x": None, "a1n": None, "a1_local": 0, "local_fx": None, "offshore": 0, "a2": None, "a2g": None, "a2_floored": 0,
                 "a2_basis": "none", "res_net": None, "res_net_raw": net_reserves_raw(c.get("res"), c.get("res_drains")), "a3": None, "b1": c.get("loans_flow"), "b2": c.get("ids_net"), "flow": None, "size": None,
                 "a2_scored": scored_a2, "niip": None, "ned": None, "ca": None}
    gdp = c.get("gdp")
    res_fx, nat_fx = _fx_credit(c, own, "fx_bonds_res"), _fx_credit(c, own, "fx_bonds")
    local = c.get("local_fx") if A1_LOCAL else None
    if res_fx and gdp:
        out.update(fx_loans=res_fx[1], fx_bonds=res_fx[2])
        if gdp > 0:
            out["a1x"] = 100 * res_fx[0] / gdp
            if local is not None:
                out.update(local_fx=local, a1_local=1, size=res_fx[0] + local)
            else:
                out["size"] = res_fx[0]
            out["a1"] = 100 * out["size"] / gdp
    if nat_fx and gdp and gdp > 0:
        out["a1n"], out["fx_bonds_nat"] = 100 * nat_fx[0] / gdp, nat_fx[2]
    out["offshore"] = 1 if offshore_flag(out["a1n"], out["a1x"]) else 0
    if c.get("st") is not None and (c.get("res") or 0) > 0:
        out["a2g"] = 100 * c["st"] / c["res"]
        den, floored, basis = net_reserves(c["res"], c.get("res_drains"))
        out.update(a2=100 * c["st"] / den, res_net=den, a2_floored=1 if floored else 0, a2_basis=basis)
    if c.get("ids") is not None and c.get("loans") is not None and c["ids"] + c["loans"] > 0:
        out["a3"] = 100 * c["ids"] / (c["ids"] + c["loans"])
    if gdp and gdp > 0:
        if c.get("niip") is not None:
            out["niip"] = 100 * c["niip"] / gdp
        if c.get("debt_liab") is not None and c.get("debt_assets") is not None:
            out["ned"] = 100 * (c["debt_liab"] - c["debt_assets"]) / gdp
        if c.get("ca4") is not None:
            out["ca"] = 100 * c["ca4"] / gdp
    stock_prev = (prev["ids"] + prev["loans"]) if prev and prev.get("ids") is not None and prev.get("loans") is not None else None
    if stock_prev and stock_prev > 0 and out["b1"] is not None and out["b2"] is not None:
        out["flow"], out["stock_prev"] = 400 * (out["b1"] + out["b2"]) / stock_prev, stock_prev
    # a row is left out only when a SCORED component is missing (method 1.6): A1, A2 where scored,
    # and a buffer. A missing flow (B1, B2 or the stock a quarter before) or a missing A3 is marked, not a reason to
    # drop the row: the Sovereign section reads A2, the current account and net IIP from these rows, and a dropped row
    # made it switch source for that year (Chile 2008, Colombia 2008, Hungary 2019).
    out["flow_missing"] = (None if out["flow"] is not None else "no adjusted bank flow" if out["b1"] is None
                           else "no net issues" if out["b2"] is None else "no previous quarter")
    why = ("no GDP" if not gdp else "no FX credit" if out["a1"] is None
           else "no reserves" if scored_a2 and not c.get("res") else "no short-term bank claims" if scored_a2 and out["a2"] is None
           else "no external position or current account" if out["niip"] is None and out["ca"] is None else None)
    return out, why


# ---------------------------------------------------------------------- method 1.5: the export surface (R20, R21)
AT_RISK = 60.0                                                   # the board's "elevated" line (method 1.2); episodes/global `threshold`
A2_LINE = 100.0                                                  # short-term claims equal to net reserves
V_JUMP = 10.0                                                    # points of score


@rule("R20")
def r20_changes(series: dict[str, dict], quarters: list[str], threshold: float = AT_RISK) -> dict:
    """The change feed, computed once at release from the board's published columns (views.board_series) and never
    recomputed downstream: the newest board quarter against the one before, economy by economy. Kinds: at_risk_in /
    at_risk_out (score >= threshold with flow < 0, entered or left), flow_sign (the flow score changed sign; B1, B2 of
    the new quarter), a2_100 (A2 crossed 100% of net reserves; its basis), v_jump (the score moved V_JUMP points or
    more). Returns {q, prev, items}; items are in economy order, the same objects global-network's build produced."""
    if len(quarters) < 2:
        return {"q": quarters[-1] if quarters else None, "prev": None, "items": []}
    latest_q, prev_q = quarters[-1], quarters[-2]
    items = []
    for e in sorted(series):
        b = series[e]
        qi = {q: k for k, q in enumerate(b["q"])}
        if latest_q not in qi or prev_q not in qi:
            continue
        k1, k0 = qi[latest_q], qi[prev_q]
        v1, v0, f1, f0 = b["v"][k1], b["v"][k0], b["flow"][k1], b["flow"][k0]
        risk1 = v1 is not None and f1 is not None and v1 >= threshold and f1 < 0
        risk0 = v0 is not None and f0 is not None and v0 >= threshold and f0 < 0
        if risk1 and not risk0:
            items.append({"eco": e, "side": "money", "kind": "at_risk_in", "q": latest_q, "v": [v0, v1], "flow": [f0, f1]})
        if risk0 and not risk1:
            items.append({"eco": e, "side": "money", "kind": "at_risk_out", "q": latest_q, "v": [v0, v1], "flow": [f0, f1]})
        if f1 is not None and f0 is not None and (f1 < 0) != (f0 < 0):
            items.append({"eco": e, "side": "money", "kind": "flow_sign", "q": latest_q, "flow": [f0, f1], "b1": b["b1"][k1], "b2": b["b2"][k1]})
        a21, a20 = b["a2"][k1], b["a2"][k0]
        if a21 is not None and a20 is not None and (a21 >= A2_LINE) != (a20 >= A2_LINE):
            items.append({"eco": e, "side": "money", "kind": "a2_100", "q": latest_q, "a2": [a20, a21], "basis": b["a2_basis"][k1]})
        if v1 is not None and v0 is not None and abs(v1 - v0) >= V_JUMP:
            items.append({"eco": e, "side": "money", "kind": "v_jump", "q": latest_q, "v": [v0, v1]})
    effect("R20", "changes listed (newest board quarter against the one before)", len(items))
    return {"q": latest_q, "prev": prev_q, "items": items}


MIN_LENDER = 0.05                                                # USD bn: a reporter below this is not listed as a lender


@rule("R21")
def r21_lender_cut(claims: float | None, lenders: dict[str, float], res_net: float | None, all_instr: dict[str, float] | None = None,
                   res_net_raw: float | None = None) -> dict | None:
    """One borrowing economy's lender shares: `claims` is the BIS all-reporter loans and deposits on it (USD bn), `lenders`
    each bilateral reporter's loans and deposits (aggregates already excluded, R11), `all_instr` the reporters that publish
    all instruments only, with no loans-and-deposits split for this borrower (R5: Japan, Germany), with their
    all-instrument amount; `res_net` A2's reserve base (floored) and `res_net_raw` net reserves (Section I + II, may be
    negative), both from the board, or None. Shares are per cent of the all-reporter total (not of the bilateral sum),
    rounded to 0.1, loans and deposits only; reporters under MIN_LENDER are left out. An all-instrument reporter is listed
    apart with its amount and has no share: its loans and deposits are not published, which is
    not the same as none. None when there is no all-reporter total."""
    if claims is None or claims <= 0:
        return None
    shares = {c: r13_precision(100 * v / claims, 1) for c, v in sorted(lenders.items()) if v is not None and v > MIN_LENDER}
    apart = {c: r13_precision(v, 1) for c, v in sorted((all_instr or {}).items()) if c not in shares and v is not None and v > MIN_LENDER}
    effect("R21", "borrowing economies with lender shares", 1)
    effect("R21", "lender positions listed", len(shares))
    effect("R21", "reporters listed apart (all instruments only, no loans-and-deposits split)", len(apart))
    return {"claims_usd": r13_precision(claims, 1), "res_net": r13_precision(res_net, 1), "res_net_raw": r13_precision(res_net_raw, 1),
            "lenders": shares, "all_instr": apart}


def lender_loss(cut_pct: float, share_pct: float, claims: float) -> float:
    """The first-round loss when a lender cuts `cut_pct` of its claims: cut share × lender share × bank claims (USD bn).
    The browser does this multiplication; the function states the arithmetic and is what the test checks."""
    return cut_pct / 100 * share_pct / 100 * claims


# ---------------------------------------------------------------------- method 1.3: levels, own-history signals with a floor, buffers
Z_CAP = 3.0                                                      # a robust z beyond ±3 is clipped: 0 and 100 are three robust deviations from the norm
MAD_K = 1.4826                                                   # MAD × 1.4826 = the standard deviation of a normal sample


def median(x: list[float]) -> float:
    s = sorted(x)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def robust_z(history: list[float], value: float, floor: float) -> tuple[float, float, float] | None:
    """(z, median, scale) of `value` against the economy's own history up to and including this quarter: z = (value −
    median) / max(1.4826 × MAD, floor), clipped to ±Z_CAP. The floor is the smallest move, in the indicator's own units,
    that counts as a full deviation: a narrow history cannot turn a tiny move into an extreme score. None with fewer
    than MIN_HISTORY quarters."""
    h = [v for v in history if v is not None and math.isfinite(v)]
    if len(h) < MIN_HISTORY or value is None or not math.isfinite(value):
        return None
    med = median(h)
    scale = max(MAD_K * median([abs(v - med) for v in h]), floor)
    return max(-Z_CAP, min(Z_CAP, (value - med) / scale)), med, scale


def own_signal(history: list[float], value: float, floor: float) -> float | None:
    """The own-history signal on 0–100: 50 = the economy's own median so far, 100 = three robust deviations above it."""
    r = robust_z(history, value, floor)
    return None if r is None else 50 + 50 * r[0] / Z_CAP


MIN_POOL = 40                                                    # economy-quarters the pooled distribution needs before a level is ranked


def level_signal(pool_sorted: list[float], value: float) -> float | None:
    """The level signal on 0–100: the share (per cent) of every board economy-quarter observed up to and including this
    quarter, all economies pooled, at or below this value. It compares the level with peers and with history at once, and
    looks nowhere ahead (the caller passes the pool up to this quarter)."""
    if value is None or not math.isfinite(value) or len(pool_sorted) < MIN_POOL:
        return None
    return 100 * bisect.bisect_right(pool_sorted, value) / len(pool_sorted)


OWN_FLOOR = {"a1": 1.0, "a2": 10.0}                               # per cent of GDP, per cent of reserves: about the 25th percentile of the
                                                                 # board economies' own-history dispersion (docs/methodology/vulnerability-v1.3.md)
BUFFERS = ("niip", "ca")                                          # a low value is the weakness (method 1.3: net IIP led net external debt on both datings)
BUFFER_COLS = {"niip": "wn", "ca": "wc", "ned": "wd"}             # the column each buffer's weakness is written to
LEVELS = ("a1", "a2", "niip", "ca", "ned")


@rule("R18")
def r18_signals(panel: dict[str, list[tuple[dt.date, dict]]], start: dt.date, buffers: tuple[str, ...] = BUFFERS) -> dict[tuple[str, dt.date], dict]:
    """The vulnerability score of every economy-quarter from `start`, point in time: a quarter's signals use only the
    quarters up to and including it, its own and every other board economy's. panel: {economy: [(quarter, R17
    indicators)]}, quarters in order.

    Each scored exposure (A1; A2 where scored) gets a level signal (level_signal: its rank among every board
    economy-quarter so far) and an own-history signal (own_signal: robust z against the economy's own median so far,
    with a dispersion floor), blended half and half. Each buffer (`buffers`: NIIP / GDP and current account / GDP by
    the method's choice) gets a level signal only, turned so that a weak buffer is high: a buffer is a level, and its
    own history carried no information in the validation. The A2 pool holds scored A2 values only: a euro member's or
    a reserve issuer's A2 never ranks anyone. Score = ½ × mean(exposure signals) + ½ × mean(buffer weaknesses
    published that quarter).

    A1's composition (method 1.6): A1 adds the local foreign-currency claims only in quarters
    the economy reports them (`a1_local`), so an economy that starts or stops reporting changes its A1 by composition.
    The own-history z of A1 compares like with like: an economy whose composition has been the same in every quarter
    so far reads its A1; once its composition has changed at least once up to this quarter, it reads the
    cross-border-only A1 (`a1x`), value and history alike, the one composition every quarter has. Point in time: the
    test looks only at quarters up to this one. For a quarter without the local part a1x is A1 itself, so an economy
    that starts reporting moves to a1x without a step; one that stops (Malaysia 2024 Q1) has read a1x since its first
    change. `o1x` = 1 marks a z taken on a1x (then `m1` and `sc1` are in a1x's terms). The level pool mixes economies
    with and without the local part; the page and the method state the mix."""
    hist: dict[tuple, list] = {}
    pool: dict[str, list] = {k: [] for k in LEVELS}
    by_q: dict[dt.date, list] = {}
    for eco, rows in panel.items():
        for q, ind in rows:
            by_q.setdefault(q, []).append((eco, ind))
    out: dict[tuple[str, dt.date], dict] = {}
    hkey = lambda eco, k, ind: (eco, k, int(ind.get("a1_local") or 0)) if k == "a1" else (eco, k)
    for q in sorted(by_q):
        for eco, ind in by_q[q]:                                  # this quarter joins the histories and pools first: "up to and including"
            for k in LEVELS:
                v = ind.get(k)
                if v is None or (k == "a2" and not ind["a2_scored"]):
                    continue
                bisect.insort(pool[k], v)
                if k in OWN_FLOOR:
                    hist.setdefault(hkey(eco, k, ind), []).append(v)
            if ind.get("a1x") is not None:
                hist.setdefault((eco, "a1x"), []).append(ind["a1x"])
        if q < start:
            continue
        for eco, ind in by_q[q]:
            s: dict = {}
            for i, k in (("1", "a1"), ("2", "a2")):
                v = ind.get(k)
                if v is None or (k == "a2" and not ind["a2_scored"]):
                    continue
                z = robust_z(hist.get(hkey(eco, k, ind), []), v, OWN_FLOOR[k])
                if k == "a1":
                    s["o1x"] = 0
                    mixed = bool(hist.get((eco, "a1", 0))) and bool(hist.get((eco, "a1", 1)))   # both compositions up to this quarter
                    if mixed and ind.get("a1x") is not None:
                        z = robust_z(hist.get((eco, "a1x"), []), ind["a1x"], OWN_FLOOR[k])
                        s["o1x"] = 1
                lv = level_signal(pool[k], v)
                s[f"l{i}"] = lv
                if z is not None:
                    s[f"o{i}"], s[f"m{i}"], s[f"sc{i}"] = 50 + 50 * z[0] / Z_CAP, z[1], z[2]
                s[f"s{i}"] = None if lv is None or z is None else 0.5 * lv + 0.5 * s[f"o{i}"]
            for k in buffers:
                lv = level_signal(pool[k], ind.get(k)) if ind.get(k) is not None else None
                s[BUFFER_COLS[k]] = None if lv is None else 100 - lv
            exp = [s.get("s1")] + ([s.get("s2")] if ind["a2_scored"] else [])
            buf = [s[BUFFER_COLS[k]] for k in buffers if s[BUFFER_COLS[k]] is not None]
            s["exp"] = None if any(x is None for x in exp) else math.fsum(exp) / len(exp)
            s["buf"] = math.fsum(buf) / len(buf) if buf else None
            s["v"] = None if s["exp"] is None or s["buf"] is None else 0.5 * s["exp"] + 0.5 * s["buf"]
            out[(eco, q)] = s
    return out


from . import sovereign  # noqa: E402,F401  (registers the sovereign rules R22–R28 beside R1–R21, so the registry is complete wherever rules is imported)
