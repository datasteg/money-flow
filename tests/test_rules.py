"""One test per rule (config/method.yaml lists them), each on a small synthetic table that holds the trap the rule exists
for. Run: uv run --with pytest --with duckdb==1.5.6 --with pyyaml==6.0.3 --with brotli==1.1.0 -m pytest tests"""
from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

import duckdb
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from sitebuild import gate, registry, release, rules, views  # noqa: E402

D = dt.date
LINK_COLS = "period DATE, freq VARCHAR, creditor VARCHAR, debtor VARCHAR, channel VARCHAR, basis VARCHAR, sector_debtor VARCHAR, currency VARCHAR, " \
            "position_usd DOUBLE, flow_usd DOUBLE, flow_kind VARCHAR, reported_by VARCHAR, source VARCHAR, dataset VARCHAR, vintage VARCHAR, raw VARCHAR"


def links(con, rows):
    con.execute(f"CREATE OR REPLACE TABLE t ({LINK_COLS})")
    con.executemany("INSERT INTO t VALUES (" + ",".join("?" * 16) + ")", rows)


def row(period=D(2025, 12, 31), freq="S", cred="USA", debt="KOR", ch="portfolio_equity", basis="residence", sec="all", ccy="all", pos=1.0,
        flow=None, fk=None, rep="creditor", ds="imf.PIP"):
    return (period, freq, cred, debt, ch, basis, sec, ccy, pos, flow, fk, rep, ds.split(".")[0], ds, "2026-10-27", "x")


@pytest.fixture
def con():
    c = duckdb.connect()
    c.execute("CREATE TABLE economies AS SELECT * FROM (VALUES ('USA', false), ('KOR', false), ('JPN', false), ('BIS:5A', true), ('BIS:5J', true)) e(code, is_aggregate)")
    return c


def test_r1_stock_at_period_end_average_at_average(con):
    con.execute("CREATE TABLE s (economy VARCHAR, period DATE, dataset VARCHAR, currency VARCHAR, value_usd DOUBLE, value_lcu DOUBLE, detail VARCHAR)")
    con.execute("INSERT INTO s VALUES ('KOR', DATE '2026-09-30', 'ecos.StatisticSearch', 'KRW', 100, 140000, 'monthly average'), ('KOR', DATE '2026-09-30', 'ecos.StatisticSearch', 'KRW', 200, 280000, 'end of month'), ('KOR', DATE '2026-09-30', 'ecos.StatisticSearch', 'KRW', NULL, 5, 'end of month')")
    rules.r1_units(con, "s", "s1")
    assert con.execute("SELECT count(*) FROM s1").fetchone()[0] == 2           # no rate: left out, never filled in
    eff = registry.EFFECTS["R1"]
    assert eff["converted at a period-average rate"] >= 1 and eff["converted at a period-end rate"] >= 1
    # build_tables.FX picks the average table for averages
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    import build_tables as bt
    fx = bt.FX.__new__(bt.FX)
    fx.rate, fx.avg, fx.ccy = {("KR", "2026-09"): 1400.0}, {("KR", "2026-09"): 1390.0}, {"KR": "KRW"}
    assert fx.by_currency("KRW", D(2026, 9, 30)) == 1400.0
    assert fx.by_currency("KRW", D(2026, 9, 30), average=True) == 1390.0


def test_r2_takes_total_not_breakdowns(con):
    links(con, [row(pos=705.2), row(sec="banks", pos=300.0), row(ccy="USD", pos=200.0)])
    rules.r2_totals_only(con, "t", "t2")
    assert con.execute("SELECT sum(position_usd) FROM t2").fetchone()[0] == pytest.approx(705.2)


def test_r3_prefers_half_yearly(con):
    links(con, [row(freq="S", pos=10.0), row(freq="A", pos=10.0), row(period=D(2024, 12, 31), freq="A", pos=9.0)])
    rules.r3_one_frequency(con, "t", "t3")
    got = con.execute("SELECT period, freq FROM t3 ORDER BY period").fetchall()
    assert got == [(D(2024, 12, 31), "A"), (D(2025, 12, 31), "S")]             # the A row stays where no S row exists


def test_r4_takes_host_report(con):
    links(con, [row(ch="fdi", ds="imf.DIP", rep="mirror_debtor", pos=402.9, freq="A"), row(ch="fdi", ds="imf.DIP", rep="debtor", pos=255.2, freq="A"),
                row(ch="fdi", ds="imf.DIP", rep="creditor", pos=147.7, freq="A")])
    rules.r4_one_report_per_pair(con, "t", "t4")
    assert con.execute("SELECT reported_by, position_usd FROM t4").fetchall() == [("debtor", 255.2)]


def test_r5_bank_channel_is_loans_and_deposits(con):
    links(con, [row(ch="bank", ds="bis.LBS", pos=375.2, freq="Q"), row(ch="bank_loans", ds="bis.LBS", pos=158.5, freq="Q"),
                row(ch="bank", ds="bis.CBS", basis="nationality", pos=394.2, freq="Q")])
    rules.r5_bank_loans_and_deposits(con, "t", "t5")
    got = dict(con.execute("SELECT dataset || ':' || channel, position_usd FROM t5").fetchall())
    assert got == {"bis.LBS:bank_all": 375.2, "bis.LBS:bank": 158.5, "bis.CBS:bank": 394.2}


def test_r6_gap_and_excess():
    g = rules.r6_gap_to_total(1364.6, [973.2, 21.2])
    assert g["gap"] == pytest.approx(370.2) and g["coverage"] == pytest.approx(994.4 / 1364.6) and not g["excess"]
    g = rules.r6_gap_to_total(100.0, [80.0, 30.0])
    assert g["gap"] == pytest.approx(-10.0) and g["excess"]                   # shown and flagged, never clipped


def test_r7_aligned_shares_one_period():
    av = {"portfolio": [D(2025, 6, 30), D(2025, 12, 31)], "bank": [D(2025, 9, 30), D(2025, 12, 31), D(2026, 3, 31)], "iip": [D(2025, 12, 31), D(2026, 3, 31)]}
    got = rules.r7_periods(av, ["portfolio", "bank", "iip"], D(2026, 10, 29))
    assert got["_aligned"] == D(2025, 12, 31)
    assert rules.newest_at(av["bank"], D(2026, 10, 29)) == D(2026, 3, 31)


def test_r8_never_adds_published_and_derived():
    assert rules.r8_flow_kinds([(1.0, "published"), (2.0, "derived"), (3.0, "published"), (None, "derived")]) == {"published": 4.0, "derived": 2.0}


def test_r9_layers_not_added():
    by = rules.r9_layers({"monetary_base": 1, "broad_money": 2, "l": 3})
    assert by == {0: ["monetary_base"], 1: ["broad_money"], 2: ["l"]}


def test_r10_nationality_only_bank(con):
    links(con, [row(ch="bank", ds="bis.CBS", basis="nationality"), row(ch="bank", ds="bis.CBS", basis="ultimate_risk"), row(ch="portfolio_equity")])
    rules.r10_basis(con, "t", "t10")
    assert sorted(r[0] for r in con.execute("SELECT basis FROM t10").fetchall()) == ["nationality", "residence"]


def test_r11_aggregate_not_a_holder(con):
    links(con, [row(cred="BIS:5A", ch="bank", ds="bis.LBS", pos=375.2), row(cred="USA", ch="bank", ds="bis.LBS", pos=50.0)])
    rules.r11_aggregates(con, "t", "t11")
    assert con.execute("SELECT creditor FROM t11 WHERE agg_creditor").fetchall() == [("BIS:5A",)]


def test_r12_exact_repeat_dropped_conflict_stops(con):
    links(con, [row(pos=1.0), row(pos=2.0)])
    assert rules.r12_duplicates(con, "t", "t12", ["period", "creditor", "debtor", "channel"], "position_usd") == 1


def test_r13_totals_before_rounding():
    parts = [0.04, 0.04, 0.04]
    total = sum(parts)
    assert rules.r13_precision(total) == 0.1 and sum(rules.r13_precision(p) for p in parts) == 0.0
    assert rules.r13_precision(-0.01) == 0.0                                 # no "-0.0"


def test_r14_no_commercial_data():
    assert rules.r14_no_commercial_data(registry.SOURCES["classes"], {"econ/KOR": b'{"tic": null, "usd_bank": null}'}) == []
    bad = rules.r14_no_commercial_data({"licensed_shown": {"shown": True}}, {"econ/KOR": b'{"funds": {"epfr": {"equity": []}}}'})
    assert len(bad) == 3 and "licensed_shown" in bad[0] and "epfr" in bad[1]
    assert not any(c.startswith("licensed") and v.get("shown") for c, v in registry.SOURCES["classes"].items())
    assert not any(p in ("epfr", "lipper") for p in registry.SOURCES["publishers"])
    assert not any(ds.startswith(("epfr.", "lipper.")) for ds in registry.SOURCES["datasets"])


def test_r15_change_needs_new_vintage():
    assert rules.r15_revisions({"bis.LBS": "2026-10-27"}, {"bis.LBS": "2026-10-27", "imf.PIP": "2026-10-30"}) == {"imf.PIP": (None, "2026-10-30")}


# ---------------------------------------------------------------------- licence, registry, series
def test_gate_blocks_unshown_and_licensed_outside_funds():
    with pytest.raises(gate.LicenceError):
        gate.gate({"x": {"ds": "llama.stablecoins", "pts": []}})
    with pytest.raises(gate.LicenceError):
        gate.gate({"x": {"ds": "fred.observations", "key": "JPNASSETS", "pts": []}})
    with pytest.raises(gate.LicenceError):
        gate.gate({"made": {"ds": "epfr.fund_flows", "pts": []}})       # unregistered: no vendor dataset is in the registry
    with pytest.raises(gate.LicenceError):
        gate.gate({"funds": {"epfr": {"equity": {"recent": [["2026-10-21", 6.44]], "sum": [], "window": 52}}}})   # vendor block (R14)
    with pytest.raises(gate.LicenceError):
        gate.gate({"x": {"lipper": {"equity": []}}})


def test_registry_complete():
    import sitebuild.verify  # noqa: F401  (registers the checks)
    assert registry.completeness() == []


def test_v17_source_links(monkeypatch):
    from sitebuild import verify
    assert verify.v17_source_links().status == "pass"
    broken = dict(registry.SOURCES, panels={"world.x": {"en": "x", "ko": "x", "links": ["no.such"]}},
                  links={"a": {"label": {"en": "A", "ko": "A"}, "name": {"en": "A", "ko": "A"}, "url": ""}})
    monkeypatch.setattr(verify, "SOURCES", broken)
    r = verify.v17_source_links()
    assert r.status == "fail" and {d.get("problem") for d in r.details} == {"no https URL", "link no.such is not in the registry"}


def test_market_focus_sums_every_pair(con):
    """The country focus counts every pair, not only the drawn top k, and its pass-through part is the FC/FD side."""
    links(con, [row(cred="CYM", debt="USA", pos=30.0), row(cred="JPN", debt="USA", pos=10.0), row(cred="BMU", debt="USA", pos=5.0),
                row(cred="USA", debt="CYM", pos=20.0), row(cred="USA", debt="JPN", pos=1.0)])
    con.execute("CREATE OR REPLACE VIEW links_m AS SELECT *, false AS agg_creditor, false AS agg_debtor FROM t")

    class C:
        v2_duplicates = 0
        v3: list = []
        def q(self, sql, params):
            return con.execute(sql, params).fetchall()
    out = views.market(C(), "equity", k=2, fk=2)["periods"][-1]
    f = out["focus"]["USA"]
    assert f["in"] == 45.0 and f["in_pass"] == 35.0 and f["out"] == 21.0 and f["out_pass"] == 20.0
    assert f["in_top"] == [["CYM", 30.0], ["JPN", 10.0]]
    assert "BMU" not in out["holders"] and out["holders_other"] == 15.0          # JPN 10 and BMU 5 fold into Other


def test_points_keep_only_recent_native_observations():
    obs = [(D(2020, 1, 1) + dt.timedelta(days=7 * i), float(i)) for i in range(300)]
    pts = views.points(obs, "W", views.quarter_ends(D(2026, 10, 29)))
    from sitebuild import verify
    assert not verify._long_runs({"f": "W", "pts": pts})
    assert pts[-1] == [obs[-1][0].isoformat(), 299.0]


def test_unchanged_build_stores_no_object(tmp_path):
    m, new = release.cut({"econ/KOR": b"{}", "checks": b"{\"a\":1}"}, {}, root=tmp_path)
    assert new and len(list((tmp_path / "objects").iterdir())) == 2
    m, new = release.cut({"econ/KOR": b"{}", "checks": b"{\"a\":2}"}, {}, root=tmp_path)   # only the checks differ
    assert not new and len(list((tmp_path / "objects").iterdir())) == 2


# ---------------------------------------------------------------------- method 1.1 (after the audit of 29 Oct 2026)
def test_r1_dollarised_economy_converts_at_one():
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    import build_tables as bt
    fx = bt.FX.__new__(bt.FX)
    fx.rate, fx.avg, fx.ccy = {("XM", "2026-09"): 0.85, ("BJ", "2026-09"): 560.0}, {}, {"XM": "EUR", "BJ": "XOF"}
    assert fx.by_currency("USD", D(2026, 9, 30)) == 1.0                      # Ecuador, El Salvador, Timor-Leste, Panama
    assert fx.by_currency("EUR", D(2026, 9, 30)) == 0.85                     # Kosovo, Andorra, Montenegro
    assert fx.by_currency("XOF", D(2026, 9, 30)) == 560.0                    # Guinea-Bissau through an area that uses the franc
    import yaml
    cfg = yaml.safe_load((Path(__file__).resolve().parents[1] / "config" / "datasets.yaml").read_text(encoding="utf-8"))
    assert cfg["currencies"]["ECU"] == "USD" and cfg["currencies"]["XKX"] == "EUR" and cfg["currencies"]["GNB"] == "XOF"


def test_r4_one_reporter_per_series(con):
    # the host reports 2022 and 2023, the investor 2022–2024: the investor has the longer span, so every year is drawn from it,
    # with the host's figure kept as alt where it exists; the mirror (a copy) never wins
    rows = [row(period=D(y, 12, 31), freq="A", ch="fdi", ds="imf.DIP", rep="creditor", pos=v) for y, v in ((2022, 200.0), (2023, 210.0), (2024, 229.7))]
    rows += [row(period=D(y, 12, 31), freq="A", ch="fdi", ds="imf.DIP", rep="debtor", pos=v) for y, v in ((2022, 90.0), (2023, 92.1))]
    rows += [row(period=D(y, 12, 31), freq="A", ch="fdi", ds="imf.DIP", rep="mirror_debtor", pos=v) for y, v in ((2022, 90.0), (2023, 92.1), (2024, 95.0))]
    links(con, rows)
    rules.r4_one_report_per_pair(con, "t", "t4")
    got = con.execute("SELECT period, reported_by, position_usd, alt_usd FROM t4 ORDER BY period").fetchall()
    assert [g[1] for g in got] == ["creditor"] * 3
    assert [g[2] for g in got] == [200.0, 210.0, 229.7] and [g[3] for g in got] == [90.0, 92.1, 95.0]
    # equal spans: the host first
    links(con, [row(freq="A", ch="fdi", ds="imf.DIP", rep="creditor", pos=147.7), row(freq="A", ch="fdi", ds="imf.DIP", rep="debtor", pos=255.2)])
    rules.r4_one_report_per_pair(con, "t", "t4")
    assert con.execute("SELECT reported_by, position_usd, alt_usd FROM t4").fetchall() == [("debtor", 255.2, 147.7)]


def test_r5_three_way_split(con):
    links(con, [row(ch="bank", ds="bis.LBS", pos=375.3, freq="Q"), row(ch="bank_loans", ds="bis.LBS", pos=158.5, freq="Q"),
                row(ch="bank_debt", ds="bis.LBS", pos=156.4, freq="Q"), row(ch="bank_other", ds="bis.LBS", pos=60.4, freq="Q")])
    rules.r5_bank_loans_and_deposits(con, "t", "t5")
    got = dict(con.execute("SELECT channel, position_usd FROM t5").fetchall())
    assert got == {"bank_all": 375.3, "bank": 158.5, "bank_debt": 156.4, "bank_other": 60.4}
    assert got["bank_all"] == pytest.approx(got["bank"] + got["bank_debt"] + got["bank_other"], abs=0.05)   # A = G + D + I (+ U)
    # only the loans-and-deposits channel is a ladder ribbon; the others keep their own channel names
    assert "bank_loans" not in got


def test_r6_reserves_group_and_cap():
    g = rules.r6_gap_to_total(1364.6, [705.2, 268.0, 21.2], unranked=[69.6])
    assert g["identified"] == pytest.approx(1064.0) and g["gap"] == pytest.approx(300.6) and g["coverage"] == pytest.approx(1064.0 / 1364.6)
    g = rules.r6_gap_to_total(5459.8, [6230.8])
    assert g["excess"] and g["coverage"] == 1.0 and g["excess_by"] == pytest.approx(771.0) and g["gap"] == pytest.approx(-771.0)   # shown, flagged, capped, never clipped


def test_r7_fdi_own_period():
    dip = [D(2022, 12, 31), D(2023, 12, 31), D(2024, 12, 31)]
    assert rules.r7_own_period(dip, D(2025, 12, 31)) == D(2024, 12, 31)     # the aligned quarter is 2025-12: DIP sits at its own 2024
    assert rules.r7_own_period(dip, D(2024, 12, 31)) == D(2024, 12, 31)
    assert rules.r7_own_period(dip, D(2022, 6, 30)) is None
    assert rules.r7_own_period(dip, None) is None


def _stocks(con, rows):
    con.execute("CREATE OR REPLACE TABLE s (economy VARCHAR, measure VARCHAR, dataset VARCHAR, freq VARCHAR, detail VARCHAR, currency VARCHAR, period DATE, value_usd DOUBLE, value_lcu DOUBLE, \"primary\" BOOLEAN)")
    con.executemany("INSERT INTO s VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, true)", rows)
    con.execute("CREATE OR REPLACE TABLE tot (economy VARCHAR, side VARCHAR, item VARCHAR, period DATE, position_usd DOUBLE)")
    con.execute("INSERT INTO tot VALUES ('CHE', 'liabilities', 'total', DATE '2024-06-30', 4500.0)")


def test_r16_quarantine_spike_unit_and_bound(con):
    m = lambda y, mo: D(y, mo, 28)
    rows = []
    # ARG monetary base: a spike of x10 that reverts the next month
    for i, v in enumerate([48.0, 48.2, 495.3, 49.3, 50.5]):
        rows.append(("ARG", "monetary_base", "imf.MFS_MA", "M", "", "ARS", m(2017, 7 + i), v, v * 17.4))
    # URY monetary base: a persistent x1000 unit error: the series stops there
    for i, v in enumerate([3.0, 3.0, 3006.1, 3060.0, 3565.6]):
        rows.append(("URY", "monetary_base", "imf.MFS_MA", "M", "", "UYU", m(2018, 8 + i), v, v * 33.0))
    # CHE central bank liabilities to non-residents: x218, not a power of ten, above the IIP liabilities total they are part of: impossible
    for i, v in enumerate([50.0, 52.7, 11920.6, 12027.2]):
        rows.append(("CHE", "cb_liabilities_nonres", "imf.MFS_CBS", "M", "", "CHF", m(2024, 6 + i), v, v * 0.85))
    _stocks(con, rows)
    rules.r16_quarantine(con, "s", "s16", totals="tot")
    kept = {(e, str(p)) for e, p in con.execute("SELECT economy, period FROM s16").fetchall()}
    assert ("ARG", "2017-09-28") not in kept and ("ARG", "2017-10-28") in kept
    assert ("URY", "2018-09-28") in kept and all(("URY", f"2018-{mo}-28") in kept for mo in ("10", "11", "12"))   # rescaled, not dropped (method 1.4)
    assert ("CHE", "2024-07-28") in kept and ("CHE", "2024-08-28") not in kept and ("CHE", "2024-09-28") not in kept
    reasons = {q["economy"]: q["reason"] for q in rules.QUARANTINED}
    assert reasons["ARG"].startswith("spike") and reasons["URY"].startswith("unit error") and reasons["CHE"].startswith("implausible")
    assert registry.EFFECTS["R16"]["observations quarantined as source errors (spikes, implausible levels)"] >= 3
    assert registry.EFFECTS["R16"]["observations rescaled by a power of ten (unit errors in the source)"] >= 3


def test_r16_unit_error_rescaled_not_dropped(con):
    """A thousandfold unit change in the source (Uruguay's monetary base from 2018-10) is rescaled to the earlier level and
    the series goes on; a value that returns to the old level after one wrong month (Portugal 2025-04) is rescaled alone."""
    m = lambda y, mo: D(y, mo, 28)
    rows = [("URY", "monetary_base", "imf.MFS_MA", "M", "", "UYU", m(2018, 8 + i), v / 33.0, v) for i, v in enumerate([98.9, 98.9, 98682.0, 98473.0, 115489.0])]
    rows += [("PRT", "cb_claims_nonres", "imf.MFS_CBS", "M", "", "EUR", m(2025, 2 + i), v, v * 0.92) for i, v in enumerate([60.9, 58.8, 58452534.0, 4.0, 4.1])]
    _stocks(con, rows)
    rules.r16_quarantine(con, "s", "s16", totals="tot")
    got = {(e, str(p)): (lcu, usd) for e, p, lcu, usd in con.execute("SELECT economy, period, value_lcu, value_usd FROM s16 ORDER BY 1, 2").fetchall()}
    assert got[("URY", "2018-10-28")][0] == pytest.approx(98.682) and got[("URY", "2018-12-28")][0] == pytest.approx(115.489)   # ÷ 1000, the series continues
    assert got[("URY", "2018-10-28")][1] == pytest.approx(98.682 / 33.0)                                                         # the dollar value too
    assert got[("PRT", "2025-04-28")][1] == pytest.approx(58.452534) and got[("PRT", "2025-05-28")][1] == pytest.approx(4.0)     # one month rescaled, the next untouched
    q = {x["economy"]: x for x in rules.QUARANTINED}
    assert q["URY"]["action"] == "rescaled" and q["URY"]["factor"] == pytest.approx(1e-3) and q["URY"]["n"] == 3
    assert q["PRT"]["action"] == "rescaled" and q["PRT"]["n"] == 1


def test_r16_redenomination_guard(con):
    """config/redenominations.csv lists the dates; V13 marks any R16 segment that starts within a month of one (the IMF
    files are back-converted, so none does today, and the guard would show a source that stops being so)."""
    from sitebuild import verify
    red = verify._redenominations()
    assert red["TUR"][0][0] == D(2005, 1, 1) and red["TUR"][0][1] == 1e6 and "VEN" in red and "ZWE" in red
    con.execute('CREATE OR REPLACE TABLE stocks_m (economy VARCHAR, measure VARCHAR, dataset VARCHAR, freq VARCHAR, detail VARCHAR, currency VARCHAR, period DATE, value_lcu DOUBLE, value_usd DOUBLE, "primary" BOOLEAN)')
    rules.QUARANTINED[:] = [{"economy": "TUR", "measure": "broad_money", "dataset": "imf.MFS_MA", "freq": "M", "from": "2005-01-31", "to": "2026-06-30", "n": 258,
                             "previous": 143.6, "value": 0.14, "ratio": 0.0, "reason": "unit error: the ratio 1e-06 is a power of ten; rescaled by 10^6 to the earlier level",
                             "action": "rescaled", "factor": 1e6}]
    r = verify.v13_size_of_change(con, {})
    assert r.status == "warning" and any(d["kind"].startswith("coincides with a redenomination") and d["economy"] == "TUR" for d in r.details)
    rules.QUARANTINED[:] = [{**rules.QUARANTINED[0], "from": "2012-03-31"}]
    assert not any(d["kind"].startswith("coincides") for d in verify.v13_size_of_change(con, {}).details)
    rules.QUARANTINED.clear()


def test_r16_keeps_real_moves(con):
    m = lambda y, mo: D(y, mo, 28)
    rows = []
    # ISL banks' claims after the 2008 collapse: a fall of 9.1x in krona (under tenfold), 10.7x in dollars: real, stays
    for i, (lcu, usd) in enumerate([(7389.5, 72.8), (813.1, 6.8), (827.6, 5.8)]):
        rows.append(("ISL", "banks_claims_nonres", "imf.MFS_ODC", "M", "", "ISK", m(2008, 9 + i), usd, lcu))
    # MMR exchange-rate unification: local values move 5%, dollar values fall 140x (R1, not the source): stays
    for i, (lcu, usd) in enumerate([(12573.4, 2260.8), (13262.2, 16.1), (13354.7, 15.9)]):
        rows.append(("MMR", "broad_money", "imf.MFS_MA", "M", "", "MMK", m(2012, 3 + i), usd, lcu))
    # SVK euro adoption: reserves fall 15x in dollars (no local currency), persistent and plausible: stays
    for i, v in enumerate([18.8, 1.2, 1.2, 1.2]):
        rows.append(("SVK", "fx_reserves", "imf.IRFCL", "M", "", "USD", m(2008, 12) if i == 0 else m(2009, i), v, None))
    _stocks(con, rows)
    rules.r16_quarantine(con, "s", "s16", totals="tot")
    assert con.execute("SELECT count(*) FROM s16").fetchone()[0] == len(rows) and rules.QUARANTINED == []


def test_v7_negative_derivatives_and_v14_v16_logic(con):
    """V7: four items above the total only because derivatives are negative is not a failure; V14 flags an excess and only a new
    one fails; V16's identity holds when holders + the reserves group equal the IMF's derived figure."""
    from sitebuild import verify
    con.execute("""CREATE OR REPLACE TABLE totals_m AS SELECT * FROM (VALUES
        ('ISR', DATE '2022-06-30', 'Q', 'assets', 'direct', 95.6, 'imf.IIP'), ('ISR', DATE '2022-06-30', 'Q', 'assets', 'portfolio', 202.9, 'imf.IIP'),
        ('ISR', DATE '2022-06-30', 'Q', 'assets', 'other', 132.8, 'imf.IIP'), ('ISR', DATE '2022-06-30', 'Q', 'assets', 'reserves', 193.8, 'imf.IIP'),
        ('ISR', DATE '2022-06-30', 'Q', 'assets', 'derivatives', -3.3, 'imf.IIP'), ('ISR', DATE '2022-06-30', 'Q', 'assets', 'total', 621.8, 'imf.IIP'),
        ('KOR', DATE '2025-12-31', 'Q', 'liabilities', 'portfolio', 1364.6, 'imf.IIP'), ('KOR', DATE '2025-12-31', 'S', 'liabilities', 'portfolio_derived', 1064.0, 'imf.PIP'),
        ('GBR', DATE '2025-12-31', 'Q', 'liabilities', 'portfolio', 5459.8, 'imf.IIP')) t(economy, period, freq, side, item, position_usd, dataset)""")
    con.execute("""CREATE OR REPLACE TABLE stocks_m AS SELECT * FROM (VALUES ('x', 'bis.GLI', 'USD', DATE '2025-12-31', 'total', 1.0)) t(economy, dataset, currency, period, detail, value_usd) WHERE false""")
    con.execute("""CREATE OR REPLACE TABLE links_m AS SELECT * FROM (VALUES
        ('imf.PIP', 'portfolio', 'residence', 'USA', 'KOR', DATE '2025-12-31', 994.4, false, false), ('imf.PIP', 'portfolio', 'residence', 'IMF:TX093', 'KOR', DATE '2025-12-31', 69.6, true, false),
        ('imf.PIP', 'portfolio', 'residence', 'USA', 'GBR', DATE '2025-12-31', 6230.8, false, false),
        ('bis.LBS', 'bank_all', 'residence', 'USA', 'KOR', DATE '2025-12-31', 1.0, false, false)) t(dataset, channel, basis, creditor, debtor, period, position_usd, agg_creditor, agg_debtor)""")
    con.execute("CREATE OR REPLACE TABLE economies AS SELECT * FROM (VALUES ('USA', false), ('KOR', false), ('GBR', false), ('IMF:TX093', true)) e(code, is_aggregate)")
    v7 = verify.v7_publisher_totals(con)
    assert v7.status == "pass" and not [i for i in v7.details if i["test"].startswith("IIP")]
    v14 = verify.v14_cpis_within_iip(con, prev_excess={("GBR", "portfolio")})
    assert v14.status == "warning" and v14.details[0]["economy"] == "GBR" and v14.details[0]["excess"] == pytest.approx(771.0)
    assert verify.v14_cpis_within_iip(con, prev_excess=set()).status == "fail"      # the same excess, seen for the first time
    assert verify.v16_publisher_identities(con).status == "pass"


# ---------------------------------------------------------------------- the Signal Board (method 1.2)
def _board_c(**kw):
    c = {"fx_loans": {"USD": 20.0, "EUR": 5.0, "JPY": 1.0}, "fx_bonds": {"USD": {"all": 150.0, "private_banks": 30.0, "public_banks": 20.0}},
         "fx_bonds_res": {"USD": {"all": 90.0, "private_banks": 25.0, "public_banks": 15.0}},
         "gdp": 1000.0, "st": 100.0, "res": 400.0, "ids": 300.0, "loans": 100.0, "loans_flow": -10.0, "ids_net": 2.0,
         "niip": -200.0, "debt_liab": 500.0, "debt_assets": 600.0, "ca4": 30.0}
    c.update(kw)
    return c


def test_r17_indicators_and_drop_reason():
    prev = {"ids": 300.0, "loans": 100.0}
    ind, why = rules.r17_indicators(_board_c(), prev, set())
    assert why is None
    assert ind["size"] == pytest.approx(26 + 50)                     # FX loans to non-banks + FX bonds of resident non-banks (banks left out)
    assert ind["a1"] == pytest.approx(7.6) and ind["a1n"] == pytest.approx(12.6)   # residence scored, nationality shown
    assert ind["a2"] == pytest.approx(25.0) and ind["a3"] == pytest.approx(75.0)
    assert ind["flow"] == pytest.approx(400 * (-10 + 2) / 400)       # (B1 + B2) / previous stock x 4: a net outflow, -8% a year
    for k, reason in (("res", "no reserves"), ("st", "no short-term bank claims")):
        assert rules.r17_indicators(_board_c(**{k: None}), prev, set())[1] == reason     # dropped with its reason, never zero
    for k, reason in (("ids_net", "no net issues"), ("loans_flow", "no adjusted bank flow")):   # method 1.6: an unscored flow is marked, the row stays
        ind, why = rules.r17_indicators(_board_c(**{k: None}), prev, set())
        assert why is None and ind["flow"] is None and ind["flow_missing"] == reason
    ind, why = rules.r17_indicators(_board_c(), None, set())
    assert why is None and ind["flow_missing"] == "no previous quarter"
    ind, why = rules.r17_indicators(_board_c(res=None), prev, set())
    assert ind["a1"] is not None and ind["a2"] is None                 # what the components allow is still computed (for the history)


def test_r17_own_currency_not_foreign():
    prev = {"ids": 300.0, "loans": 100.0}
    c = _board_c(fx_bonds_res={"USD": {"all": 100.0}, "EUR": {"all": 50.0}})
    ind_jp, _ = rules.r17_indicators(c, prev, {"JPY"})
    ind_eu, _ = rules.r17_indicators(c, prev, {"EUR"})
    assert ind_jp["size"] == pytest.approx(25 + 150)                   # the yen loan is Japan's own currency
    assert ind_eu["size"] == pytest.approx(21 + 100)                   # euro loans and euro bonds are a member's own currency


def test_r17_residence_buffers_and_a2_scope():
    prev = {"ids": 300.0, "loans": 100.0}
    ind, _ = rules.r17_indicators(_board_c(), prev, set())
    assert ind["niip"] == pytest.approx(-20.0) and ind["ca"] == pytest.approx(3.0) and ind["ned"] == pytest.approx(-10.0)
    assert rules.a2_scored("KOR", set()) and not rules.a2_scored("ITA", {"EUR"}) and not rules.a2_scored("JPN", {"JPY"})
    assert not rules.a2_scored("GBR", set()) and not rules.a2_scored("CAN", set())
    # where A2 is not scored, missing reserves do not drop the economy; with no buffer at all, it is dropped
    assert rules.r17_indicators(_board_c(res=None), prev, {"EUR"}, scored_a2=False)[1] is None
    assert rules.r17_indicators(_board_c(niip=None, ca4=None), prev, set())[1] == "no external position or current account"
    assert rules.r17_indicators(_board_c(niip=None), prev, set())[1] is None          # one buffer is enough


def test_r18_robust_z_floor():
    flat = [10.0] * 7 + [10.1]                                        # a calm, narrow history (MAD 0)
    z, med, scale = rules.robust_z(flat, 10.3, 1.0)
    assert scale == 1.0 and med == pytest.approx(10.0) and z == pytest.approx(0.3)   # the floor binds: a 0.3-point move is 0.3 floors
    assert rules.own_signal(flat, 10.3, 1.0) == pytest.approx(55.0)   # not 100: a tiny move is not an extreme
    assert rules.own_signal(flat, 13.0, 1.0) == pytest.approx(100.0)  # three floors above the median: the cap
    assert rules.own_signal(flat, 7.0, 1.0) == pytest.approx(0.0)
    wide = [0.0, 10, 20, 30, 40, 50, 60, 70]
    z, med, scale = rules.robust_z(wide, 35.0, 1.0)
    assert med == 35.0 and scale == pytest.approx(1.4826 * 20)        # the floor does not bind when the history is dispersed
    assert rules.robust_z(flat[:7], 10.0, 1.0) is None                # fewer than 8 quarters: no signal


def test_r18_level_signal_pooled():
    pool = sorted(float(i) for i in range(100))
    assert rules.level_signal(pool, 49.0) == pytest.approx(50.0)
    assert rules.level_signal(pool, 1000.0) == 100.0 and rules.level_signal(pool, -1.0) == 0.0
    assert rules.level_signal(pool[:39], 5.0) is None                 # the pool needs 40 observations


def _panel(n_eco=6, n_q=16, bump=None):
    """A synthetic board: n_eco economies over n_q quarters with A1, A2, NIIP and CA; `bump` = (economy, quarter index, A1)."""
    qs = views.quarter_ends(D(2006 + n_q // 4, 12, 31))[24:24 + n_q]             # 2006 Q1 onwards
    out = {}
    for e in range(n_eco):
        rows = []
        for i, q in enumerate(qs):
            a1 = 5.0 + e + 0.1 * i
            if bump and bump[0] == e and bump[1] == i:
                a1 = bump[2]
            rows.append((q, {"a1": a1, "a1n": a1, "a2": 20.0 + 5 * e + i, "a3": 50.0, "a2_scored": e != 0, "niip": -10.0 * e, "ca": 1.0 - e}))
        out[f"E{e}"] = rows
    return out, qs


def test_r18_score_arithmetic():
    panel, qs = _panel()
    sig = rules.r18_signals(panel, qs[0])
    s = sig[("E3", qs[-1])]
    assert s["s1"] == pytest.approx(0.5 * s["l1"] + 0.5 * s["o1"]) and s["s2"] == pytest.approx(0.5 * s["l2"] + 0.5 * s["o2"])
    assert s["exp"] == pytest.approx((s["s1"] + s["s2"]) / 2)
    assert s["buf"] == pytest.approx((s["wn"] + s["wc"]) / 2)
    assert s["v"] == pytest.approx(0.5 * s["exp"] + 0.5 * s["buf"])
    e0 = sig[("E0", qs[-1])]
    assert "s2" not in e0 and e0["exp"] == pytest.approx(e0["s1"])    # A2 not scored: exposure is A1 alone
    assert 0 <= s["v"] <= 100 and "v12" not in s and "p1" not in s     # method 1.6: method 1.2's context score is gone


def test_r18_no_look_ahead():
    """The replay uses only data available at each date: a quarter's signals are the same whether or not later quarters
    exist, and a shock in a later quarter changes nothing before it."""
    panel, qs = _panel()
    full = rules.r18_signals(panel, qs[0])
    for cut in (9, 12):
        part = rules.r18_signals({e: rows[:cut] for e, rows in panel.items()}, qs[0])
        for k, v in part.items():
            assert full[k] == v, k
    shocked, _ = _panel(bump=(2, 14, 50.0))
    sh = rules.r18_signals(shocked, qs[0])
    assert all(sh[(e, q)] == full[(e, q)] for e in panel for q in qs[:14])
    assert sh[("E2", qs[14])]["v"] != full[("E2", qs[14])]["v"]


def test_v22_floor_check():
    from sitebuild import verify
    cols = list(views.BOARD_COLS)
    row = dict.fromkeys(cols)
    row.update(eco="KOR", v=50.0, o1=100.0, m1=6.0, sc1=1.0, a1=9.5, o2=None)
    board = {"cols": cols, "q": {"2026-06-30": {"rows": [[row[c] for c in cols]]}}}
    assert verify.v22_no_extremes_from_tiny_moves(board).status == "pass"      # 3.5 floors from the median: a real move
    row.update(a1=7.0)                                                          # capped from a one-floor move: impossible under R18
    board["q"]["2026-06-30"]["rows"] = [[row[c] for c in cols]]
    assert verify.v22_no_extremes_from_tiny_moves(board).status == "fail"
    row.update(a1=9.5, sc1=0.5)                                                 # a scale below the floor
    board["q"]["2026-06-30"]["rows"] = [[row[c] for c in cols]]
    assert verify.v22_no_extremes_from_tiny_moves(board).status == "fail"


SNAPSHOT = Path(__file__).resolve().parent / "fixtures" / "board-2026q2.json"


def test_r18_snapshot_2026q2():
    """Regression on the 2026 Q2 board as released with method 1.3: the 36 economies' scores, rebuilt from the tables.
    It runs only while the mirror holds the same vintages of the board's datasets (a new vintage changes the numbers
    legitimately; refresh the fixture with scripts/validation/vulnerability_v13.py --fixture)."""
    import json
    from sitebuild import marks
    if not SNAPSHOT.exists() or not (marks.TABLES / "signals.parquet").exists():
        pytest.skip("no fixture or no tables")
    fx = json.loads(SNAPSHOT.read_text())
    c = duckdb.connect()
    st = marks.load(c)
    have = {d: st["vintages"].get(d) for d in fx["vintages"]}
    if have != fx["vintages"]:
        pytest.skip(f"vintages moved: {have} vs {fx['vintages']}")
    ctx = views.Ctx(c, D.today(), {})
    b = views.board(ctx)
    cols = b["cols"]
    got = {r[0]: dict(zip(cols, r)) for r in b["q"][fx["quarter"]]["rows"]}
    assert sorted(got) == sorted(fx["scores"])
    for e, want in fx["scores"].items():
        for k, v in want.items():
            assert got[e][k] == pytest.approx(v, abs=0.011), (e, k)
    # and no look-ahead on the real panel: the board's 2010 Q4 scores are the same when built only from data up to then
    bc = views.board_components(ctx)
    cut = D(2010, 12, 31)
    panel_full, panel_cut = {}, {}
    for eco in bc["keep"]:
        rows, prev = [], None
        for q, comp in bc["series"][eco]:
            ind, _ = rules.r17_indicators(comp, prev, comp["own"], rules.a2_scored(eco, comp["own"]))
            rows.append((q, ind))
            prev = comp
        panel_full[eco], panel_cut[eco] = rows, [r for r in rows if r[0] <= cut]
    full, part = rules.r18_signals(panel_full, views.BOARD_FROM), rules.r18_signals(panel_cut, views.BOARD_FROM)
    assert {k: v for k, v in full.items() if k[1] <= cut} == part


def test_r19_exclusions():
    keep, out = rules.r19_economy_set({"KOR", "USA", "HKG", "SGP", "LUX", "IRL", "NLD", "CHE", "EMU", "TUR", "DEU"}, {"EMU"})
    assert keep == ["DEU", "KOR", "TUR"]
    assert dict(out) == {"USA": "hub", "HKG": "offshore_centre", "SGP": "offshore_centre", "LUX": "fund_domicile", "IRL": "fund_domicile",
                         "NLD": "fund_domicile", "CHE": "fund_domicile", "EMU": "aggregate"}


# ---------------------------------------------------------------------- method 1.4 (the verification brief of 31 Oct 2026)
def test_r17_a2_uses_net_reserves():
    """A2 divides by net reserves, IRFCL Section I plus Section II (predetermined net drains, negative): an economy with
    Section I = 100 and Section II = -60 gets A2 2.5 times the gross figure; the denominator never falls below a tenth of
    gross reserves (Turkey 2023 Q2: net reserves below zero); without Section II the gross figure is used and labelled."""
    prev = {"ids": 300.0, "loans": 100.0}
    gross, _ = rules.r17_indicators(_board_c(res=100.0, res_drains=None), prev, set())
    net, _ = rules.r17_indicators(_board_c(res=100.0, res_drains=-60.0), prev, set())
    assert gross["a2"] == pytest.approx(100.0) and gross["a2_basis"] == "gross" and gross["a2g"] == pytest.approx(100.0)
    assert net["a2"] == pytest.approx(250.0) and net["a2g"] == pytest.approx(100.0) and net["res_net"] == pytest.approx(40.0) and net["a2_basis"] == "net"
    floored, _ = rules.r17_indicators(_board_c(res=100.0, res_drains=-105.0), prev, set())
    assert floored["a2_floored"] == 1 and floored["res_net"] == pytest.approx(10.0) and floored["a2"] == pytest.approx(1000.0)
    assert net["a2_floored"] == 0 and rules.net_reserves(100.0, 12.0) == (112.0, False, "net")      # predetermined inflows raise it


def test_r17_net_reserves_raw():
    """Net reserves are published without the floor: Argentina 2026 Q2, Section I 44.87 and
    Section II -68.43, has res_net_raw -23.56 while A2's reserve base stays at the floor 4.487, flagged; without Section II
    there is no net figure (the A2 base falls back to gross, labelled)."""
    prev = {"ids": 300.0, "loans": 100.0}
    ar, _ = rules.r17_indicators(_board_c(res=44.87, res_drains=-68.43), prev, set())
    assert ar["res_net_raw"] == pytest.approx(-23.56) and ar["res_net"] == pytest.approx(4.487) and ar["a2_floored"] == 1
    assert ar["res_net_raw"] < ar["res_net"]
    ok, _ = rules.r17_indicators(_board_c(res=100.0, res_drains=-60.0), prev, set())
    assert ok["res_net_raw"] == pytest.approx(ok["res_net"]) == pytest.approx(40.0) and ok["a2_floored"] == 0
    gross, _ = rules.r17_indicators(_board_c(res=100.0, res_drains=None), prev, set())
    assert gross["res_net_raw"] is None and gross["res_net"] == pytest.approx(100.0) and gross["a2_basis"] == "gross"
    from sitebuild import verify
    cols = list(views.BOARD_COLS)
    row = dict.fromkeys(cols)
    row.update(eco="ARG", res=44.87, res_drains=-68.43, res_net_raw=-23.56, res_net=4.49, a2_floored=1, a2_basis="net")
    board = {"cols": cols, "q": {"2026-06-30": {"rows": [[row[c] for c in cols]]}}}
    assert verify.v27_net_reserves(board).status == "pass"
    row.update(a2_floored=0)                                             # a floored base without its flag fails
    board["q"]["2026-06-30"]["rows"] = [[row[c] for c in cols]]
    assert verify.v27_net_reserves(board).status == "fail"
    row.update(a2_floored=1, res_net_raw=4.49)                           # the floored base published as net reserves fails
    board["q"]["2026-06-30"]["rows"] = [[row[c] for c in cols]]
    assert verify.v27_net_reserves(board).status == "fail"


def test_r17_missing_flow_keeps_row():
    """a missing unscored component (net issues, the adjusted bank flow, A3's stocks) no longer drops
    the row; A1, A2 and the buffers are still computed and the row is scored. A missing scored component still drops it."""
    prev = {"ids": 300.0, "loans": 100.0}
    ind, why = rules.r17_indicators(_board_c(ids_net=None, ids=None), prev, set())
    assert why is None and ind["a3"] is None and ind["flow"] is None and ind["a1"] is not None and ind["a2"] is not None
    assert rules.r17_indicators(_board_c(fx_loans={}, fx_bonds_res={}), prev, set())[1] == "no FX credit"
    assert rules.r17_indicators(_board_c(niip=None, ca4=None), prev, set())[1] == "no external position or current account"


def test_r18_a1_own_history_same_composition():
    """an economy whose A1 composition changes (Malaysia 2024 Q1: 16.6 -> 9.9 when the local
    part stops) does not read the switch as a move: from its first change it reads the cross-border-only A1 (a1x), value
    and history alike, so the own-history signal is continuous across the break; point in time."""
    qs = views.quarter_ends(D(2012, 12, 31))[24:24 + 20]
    panel = {}
    for e in range(6):
        rows = []
        for i, q in enumerate(qs):
            a1x = 5.0 + e + 0.05 * i
            local = (e == 0 and 4 <= i < 14) or (e == 1 and i >= 4)          # E0 reports the local part in quarters 4-13, E1 from 4 on
            rows.append((q, {"a1": a1x + (6.0 if local else 0.0), "a1x": a1x, "a1_local": 1 if local else 0, "a2": 20.0 + e, "a2_scored": True,
                             "niip": -10.0 * e, "ca": 1.0 - e}))
        panel[f"E{e}"] = rows
    sig = rules.r18_signals(panel, qs[0])
    o = [sig[("E0", q)].get("o1") for q in qs]
    assert all(sig[("E0", q)]["o1x"] == 1 for q in qs[8:])                # mixed from quarter 4: a1x, value and history
    assert max(abs(o[i] - o[i - 1]) for i in range(9, 20)) < 15           # no step at the stop in quarter 14 (a 6-point A1 drop)
    for i in range(8, 20):                                                 # the z is a1x against the a1x history so far
        h = [r[1]["a1x"] for r in panel["E0"][:i + 1]]
        med = rules.median(h)
        sc = max(rules.MAD_K * rules.median([abs(x - med) for x in h]), 1.0)
        assert o[i] == pytest.approx(50 + 50 * max(-3, min(3, (h[-1] - med) / sc)) / 3)
    assert sig[("E1", qs[19])]["o1x"] == 1 and sig[("E3", qs[19])]["o1x"] == 0   # a change at any time; never for a steady economy
    full = rules.r18_signals(panel, qs[0])
    part = rules.r18_signals({e: rows[:10] for e, rows in panel.items()}, qs[0])
    assert all(full[k] == v for k, v in part.items())                     # point in time
    assert "v12" not in sig[("E3", qs[19])]


def test_r17_a1_includes_local_fx_credit():
    """An economy with cross-border FX loans 10, local FX claims on non-banks 15 and FX bonds 5 gets numerator 30, not 15; an
    economy that does not report local positions keeps 15 and is marked, and the cross-border-only A1 stays beside it."""
    prev = {"ids": 300.0, "loans": 100.0}
    c = _board_c(fx_loans={"USD": 10.0}, fx_bonds_res={"USD": {"all": 5.0}}, local_fx=15.0)
    ind, _ = rules.r17_indicators(c, prev, set())
    assert ind["size"] == pytest.approx(30.0) and ind["a1"] == pytest.approx(3.0) and ind["a1x"] == pytest.approx(1.5) and ind["a1_local"] == 1 and ind["local_fx"] == 15.0
    ind, _ = rules.r17_indicators(_board_c(fx_loans={"USD": 10.0}, fx_bonds_res={"USD": {"all": 5.0}}), prev, set())
    assert ind["size"] == pytest.approx(15.0) and ind["a1"] == pytest.approx(1.5) and ind["a1_local"] == 0 and ind["local_fx"] is None


def test_r17_flow_components_share_basis():
    """B1 and S1 come from one LBS key (stock S and adjusted change F of the same slice: all sectors, all currencies); B2 and
    S2 from one DSS nationality key (amounts I and net issues G)."""
    sg = registry.DATASETS["signals"]
    loans = sg["bis.LBS"]["slices"]["lbs_loans"]
    assert loans["L_MEASURE"] == ["S", "F"] and loans["L_CP_SECTOR"] == "A" and loans["L_DENOM"] == "TO1"       # B1 is every sector and currency
    ids = sg["bis.DSS"]["slices"]["ids_nat"]
    assert ids["MEASURE"] == ["I", "G"] and sg["bis.DSS"]["filter"]["ISSUER_RES"] == "3P"                        # nationality: residence = all countries
    assert sg["bis.LBS@local"]["filter"]["L_POS_TYPE"] == "R" and sg["bis.LBS@local"]["filter"]["L_CURR_TYPE"] == "F"   # the local FX cell of A1


def test_r17_offshore_gap_flag():
    """Nationality A1 6 points of GDP above the cross-border residence A1 sets the flag, 4 points does not; a small-A1 economy
    whose nationality figure is twice its residence figure (China 2021 Q3: 5.4 against 1.7) is flagged too."""
    assert rules.offshore_flag(16.0, 10.0) and not rules.offshore_flag(14.0, 10.0)
    assert rules.offshore_flag(5.4, 1.7) and not rules.offshore_flag(1.5, 0.9) and not rules.offshore_flag(None, 10.0)
    prev = {"ids": 300.0, "loans": 100.0}
    ind, _ = rules.r17_indicators(_board_c(fx_bonds={"USD": {"all": 150.0}}, fx_bonds_res={"USD": {"all": 90.0}}), prev, set())
    assert ind["a1n"] == pytest.approx(17.6) and ind["a1x"] == pytest.approx(11.6) and ind["offshore"] == 1


def test_r5_no_split_reporters_disclosed():
    """The coverage panel shows the share of an economy's all-reporter bank claims that come from reporters without an
    instrument split: 30% when they hold 30 of 100."""
    assert rules.r5_nosplit_share({"JPN": 20.0, "DEU": 10.0}, 100.0) == pytest.approx(30.0)
    assert rules.r5_nosplit_share({}, 100.0) is None and rules.r5_nosplit_share({"JPN": 1.0}, None) is None


def test_r9_layers_not_summed_anywhere():
    """No output adds layer 0 to layer 1: the rule groups measures into disjoint layers, the views build the made-here column
    one measure at a time, and no view or rule references the layer table in a sum."""
    import inspect
    by = rules.r9_layers({m: 1.0 for m in rules.LAYERS})
    assert set(sum(by.values(), [])) == set(rules.LAYERS) and sum(len(v) for v in by.values()) == len(rules.LAYERS)
    src = inspect.getsource(views)
    assert "LAYERS" not in src and "layer0" not in src and "layer_0" not in src
    assert all(m != "money_total" for m in views.MEASURES)


def test_r18_buffer_uses_configured_measure():
    """The buffers are a parameter: with net external debt in place of net IIP the weakness column changes and the score follows."""
    panel, qs = _panel()
    for rows in panel.values():
        for q, ind in rows:
            ind["ned"] = -ind["niip"]
    default = rules.r18_signals(panel, qs[0])
    alt = rules.r18_signals(panel, qs[0], buffers=("ned", "ca"))
    s, t = default[("E3", qs[-1])], alt[("E3", qs[-1])]
    assert "wn" in s and "wd" not in s and "wd" in t and "wn" not in t
    assert t["buf"] == pytest.approx((t["wd"] + t["wc"]) / 2) and t["v"] != s["v"]


def test_r18_pool_excludes_unscored_a2():
    """An economy whose A2 is not scored (a euro member, a reserve issuer) never enters the A2 level pool: making its A2 a
    thousand times larger changes nobody else's A2 level."""
    panel, qs = _panel()
    base = rules.r18_signals(panel, qs[0])
    for q, ind in panel["E0"]:                                       # E0 is the unscored one in _panel
        ind["a2"] = ind["a2"] * 1000
    moved = rules.r18_signals(panel, qs[0])
    assert all(moved[("E3", q)]["l2"] == base[("E3", q)]["l2"] for q in qs if ("E3", q) in base)


def test_r1_dated_currency_regime():
    """Zimbabwe used the US dollar from 2009-02 to 2019-06 and its own currency outside those dates; West Bank and Gaza uses
    the shekel throughout (config/datasets.yaml currencies and currency_regimes)."""
    import build_tables
    cfg = registry.DATASETS
    own = lambda eco, day: build_tables.own_currency(cfg["currencies"], cfg["currency_regimes"], eco, day)
    assert own("ZWE", D(2010, 6, 30)) == "USD" and own("ZWE", D(2019, 6, 30)) == "USD"
    assert own("ZWE", D(2008, 12, 31)) is None and own("ZWE", D(2020, 1, 31)) is None
    assert own("PSE", D(2015, 1, 31)) == "ILS" and own("ECU", D(2001, 1, 31)) == "USD" and own("KOR", D(2026, 1, 31)) is None
    corr = cfg["unit_corrections"][0]
    assert corr["economy"] == "SLE" and corr["until"] == D(2014, 12, 31) and corr["factor"] == pytest.approx(1e-3)


def test_r19_euro_adoption_dates():
    """config/economies.csv carries every euro adoption date the board may need, Croatia 2023 and Bulgaria 2026 included,
    and the own-currency set switches on the first day of adoption."""
    import csv
    rows = {r["code"]: r for r in csv.DictReader(open(registry.CONFIG / "economies.csv", encoding="utf-8"))}
    assert rows["HRV"]["euro_area_from"] == "2023-01-01" and rows["BGR"]["euro_area_from"] == "2026-01-01" and rows["DEU"]["euro_area_from"] == "1999-01-01"
    assert rows["IMF:G309"]["is_aggregate"] == "1" and rows["PSE"]["imf"] == "WBG"
    euro = {c: r["euro_area_from"] for c, r in rows.items() if r["euro_area_from"]}
    assert rules.own_currencies("HRV", D(2022, 12, 31), euro) == set() and rules.own_currencies("HRV", D(2023, 3, 31), euro) == {"EUR"}
    assert rules.own_currencies("BGR", D(2026, 3, 31), euro) == {"EUR"} and rules.own_currencies("JPN", D(2026, 3, 31), euro) == {"JPY"}


def test_r17_a1_break_marker_on_adoption():
    """At adoption the euro stops being foreign currency: the same components give a lower A1 from the adoption quarter, and
    the board file names the adoption date so the page can mark the break."""
    prev = {"ids": 300.0, "loans": 100.0}
    euro = {"HRV": "2023-01-01"}
    c = _board_c(fx_loans={"USD": 10.0, "EUR": 40.0}, fx_bonds_res={"EUR": {"all": 20.0}})
    before, _ = rules.r17_indicators(c, prev, rules.own_currencies("HRV", D(2022, 12, 31), euro))
    after, _ = rules.r17_indicators(c, prev, rules.own_currencies("HRV", D(2023, 3, 31), euro))
    assert before["size"] == pytest.approx(70.0) and after["size"] == pytest.approx(10.0)
    import inspect
    assert '"euro"' in inspect.getsource(views.board)                # the set block carries {economy: adoption date}


def test_r7_iip_border_period():
    """The IIP is a required channel of the alignment: an annual-only IIP pulls the aligned period to its year-end, so the
    border total is always read at the aligned period itself."""
    avail = {"portfolio": [D(2024, 6, 30), D(2024, 12, 31), D(2025, 6, 30)], "bank": [D(2025, 3, 31), D(2025, 6, 30), D(2024, 12, 31), D(2024, 6, 30)],
             "iip": [D(2023, 12, 31), D(2024, 12, 31)]}
    per = rules.r7_periods(avail, ["portfolio", "bank", "iip"], D(2025, 6, 30))
    assert per["_aligned"] == D(2024, 12, 31) and per["iip"] == D(2024, 12, 31) and per["portfolio"] == D(2024, 12, 31)
    quarterly = dict(avail, iip=[D(2024, 12, 31), D(2025, 6, 30)])
    assert rules.r7_periods(quarterly, ["portfolio", "bank", "iip"], D(2025, 6, 30))["_aligned"] == D(2025, 6, 30)


def test_r4_negative_position_handling(con):
    """A negative direct-investment position (reverse investment or netted intercompany debt) passes through R4 as it is
    reported, never floored or dropped, so the ladder shows it as a negative part."""
    links(con, [row(ch="fdi", ds="imf.DIP", rep="debtor", pos=-59.8, freq="A", cred="RUS", debt="LUX"),
                row(ch="fdi", ds="imf.DIP", rep="mirror_debtor", pos=-59.8, freq="A", cred="RUS", debt="LUX")])
    rules.r4_one_report_per_pair(con, "t", "t4")
    assert con.execute("SELECT reported_by, position_usd FROM t4").fetchall() == [("debtor", -59.8)]
