"""The export surface (method 1.5, the surface contract): R20 the change feed, R21 the lender cut, the
episodes view, V23 the quarterly frame against WDI, the gate on the surface views, the fetchers against the registry, and
the surface manifest. Run with the suite (see tests/test_rules.py)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from sitebuild import gate, registry, release, rules, verify, views  # noqa: E402

HERE = Path(__file__).resolve().parents[1]


# ---------------------------------------------------------------- R20: the change feed
def _series():
    qs = ["2026-03-31", "2026-06-30"]
    mk = lambda v, f, a2, b1=1.0, b2=1.0, basis="net": {"q": qs, "v": v, "flow": f, "a2": a2, "b1": [b1, b1], "b2": [b2, b2], "a2_basis": [basis, basis]}
    return {"GRC": mk([59.53, 60.01], [10.13, -2.73], [98.51, 100.55], -4.5, 3.17),        # enters the at-risk corner, flow turns, A2 crosses 100
            "NZL": mk([62.32, 63.74], [-3.98, 8.88], [85.79, 103.31], 0.43, 0.94),         # leaves it (flow turns positive), A2 crosses 100
            "TUR": mk([70.0, 81.0], [-1.0, -2.0], [96.77, 102.0]),                          # a jump of 11 points, A2 crosses, no sign change
            "KOR": mk([30.0, 31.0], [2.0, 3.0], [44.0, 45.0]),                              # nothing
            "ARG": mk([50.0, None], [1.0, -1.0], [None, 120.0])}, qs                        # a missing value is never a change


def test_r20_changes_kinds():
    series, qs = _series()
    out = rules.r20_changes(series, qs)
    assert out["q"] == "2026-06-30" and out["prev"] == "2026-03-31"
    kinds = sorted((i["eco"], i["kind"]) for i in out["items"])
    assert kinds == [("ARG", "flow_sign"), ("GRC", "a2_100"), ("GRC", "at_risk_in"), ("GRC", "flow_sign"), ("NZL", "a2_100"), ("NZL", "at_risk_out"),
                     ("NZL", "flow_sign"), ("TUR", "a2_100"), ("TUR", "v_jump")]
    grc = {i["kind"]: i for i in out["items"] if i["eco"] == "GRC"}
    assert grc["at_risk_in"] == {"eco": "GRC", "side": "money", "kind": "at_risk_in", "q": "2026-06-30", "v": [59.53, 60.01], "flow": [10.13, -2.73]}
    assert grc["flow_sign"] == {"eco": "GRC", "side": "money", "kind": "flow_sign", "q": "2026-06-30", "flow": [10.13, -2.73], "b1": -4.5, "b2": 3.17}
    assert grc["a2_100"] == {"eco": "GRC", "side": "money", "kind": "a2_100", "q": "2026-06-30", "a2": [98.51, 100.55], "basis": "net"}
    assert [i for i in out["items"] if i["kind"] == "v_jump"] == [{"eco": "TUR", "side": "money", "kind": "v_jump", "q": "2026-06-30", "v": [70.0, 81.0]}]
    assert rules.r20_changes(series, qs[:1]) == {"q": "2026-03-31", "prev": None, "items": []}


def test_r20_changes_published_once():
    """The feed is a released file built from the released board, deterministic, and the threshold is the one the
    episodes view publishes; the build releases it under changes/global and no view recomputes it from raw tables."""
    series, qs = _series()
    assert rules.r20_changes(series, qs) == rules.r20_changes(series, qs)
    assert views.episodes()["threshold"] == rules.AT_RISK == 60.0
    src = (HERE / "scripts" / "build_site_data.py").read_text(encoding="utf-8")
    assert 'files["changes/global"] = views.changes(w["board"])' in src and 'files["episodes/global"] = views.episodes()' in src
    board = {"cols": ["eco", "v", "flow", "a2", "b1", "b2", "a2_basis"] + [c for c in views.BOARD_TRAIL if c not in ("v", "flow", "a2", "b1", "b2", "a2_basis")],
             "quarters": qs, "set": {"in": ["KOR", "GRC"]},
             "q": {q: {"rows": [["KOR", 30.0 + k, 2.0, 44.0, 1.0, 1.0, "net"] + [None] * (len(views.BOARD_TRAIL) - 6),
                                ["GRC", 59.53 + 0.48 * k, 10.13 - 12.86 * k, 98.51 + 2.04 * k, -4.5, 3.17, "net"] + [None] * (len(views.BOARD_TRAIL) - 6)]} for k, q in enumerate(qs)}}
    out = views.changes(board)
    assert {i["kind"] for i in out["items"] if i["eco"] == "GRC"} == {"at_risk_in", "flow_sign", "a2_100"} and not [i for i in out["items"] if i["eco"] == "KOR"]
    assert "surface" in release.VOLATILE and "checks" in release.VOLATILE


# ---------------------------------------------------------------- R21: the lender cut
def test_r21_lender_cut_shares_and_loss():
    rec = rules.r21_lender_cut(100.0, {"GBR": 44.7, "USA": 10.7, "HKG": 20.0, "LUX": 0.04, "FRA": None}, 45.6)
    assert rec == {"claims_usd": 100.0, "res_net": 45.6, "res_net_raw": None, "lenders": {"GBR": 44.7, "HKG": 20.0, "USA": 10.7}, "all_instr": {}}   # under 0.05 bn and None left out
    assert sum(rec["lenders"].values()) <= 100.0
    # the browser's arithmetic: a 20% cut by the UK = 0.2 x 0.447 x 100 = 8.94 bn, 19.6% of net reserves
    loss = rules.lender_loss(20, rec["lenders"]["GBR"], rec["claims_usd"])
    assert loss == pytest.approx(8.94) and 100 * loss / rec["res_net"] == pytest.approx(19.605, abs=1e-3)
    assert rules.r21_lender_cut(None, {"GBR": 1.0}, 10.0) is None and rules.r21_lender_cut(0.0, {"GBR": 1.0}, 10.0) is None
    assert rules.r21_lender_cut(50.0, {"GBR": 10.0}, None)["res_net"] is None                      # no board reserves: shown empty, shares still there
    # the shape global-network's lender tool reads, inside mkt/bank, passes the gate unchanged
    obj = {"market": "bank", "ds": "bis.LBS", "periods": [], "lender_cut": {"q": "2026-06-30", "debtors": {"TUR": rec}}}
    dropped: list = []
    assert gate.gate(obj, "mkt/bank", dropped=dropped) == obj and dropped == []


def test_r21_all_instrument_reporters_apart():
    """a reporter that publishes all instruments only for a borrower (Japan for Korea) is listed
    apart with its all-instrument amount and never gets a share; a reporter with a loans-and-deposits position keeps its
    share and is not repeated apart; the loss is set against net reserves without the floor (res_net_raw)."""
    rec = rules.r21_lender_cut(162.5, {"USA": 37.8, "GBR": 20.0}, 4.49, {"JPN": 38.84, "DEU": 9.0, "USA": 50.0, "CHE": 0.01}, -23.56)
    assert rec["lenders"] == {"GBR": 12.3, "USA": 23.3}
    assert rec["all_instr"] == {"DEU": 9.0, "JPN": 38.8}                 # apart, with amounts; the tiny one and the split reporter left out
    assert "JPN" not in rec["lenders"] and rec["res_net_raw"] == -23.6 and rec["res_net"] == 4.5
    import inspect
    src = inspect.getsource(views.lender_cut)
    assert "bank_all" in src and "res_net_raw" in src                    # the view reads the all-instrument rows and the raw reserves


# ---------------------------------------------------------------- the episodes view and the audit's constants agree
def test_episodes_view_matches_validation_set():
    import importlib.util
    spec = importlib.util.spec_from_file_location("v13", HERE / "scripts" / "audit" / "vulnerability_v13.py")
    src = (HERE / "scripts" / "audit" / "vulnerability_v13.py").read_text(encoding="utf-8")
    ns: dict = {}
    for name in ("EPISODES", "OUT_OF_SCOPE", "GLOBAL", "PRE", "THRESHOLD"):      # the constants alone, without importing duckdb
        start = src.index(f"\n{name} = ")
        end = src.index("\n", start + 1)
        while src[end + 1:end + 2] in (" ", "}", ")"):
            end = src.index("\n", end + 1)
        exec(src[start:end], ns)
    e = views.episodes()
    assert spec is not None
    assert [[v["q"], v["eco"]] for v in e["episodes"].values()] == [list(x) for x in ns["EPISODES"].values()]
    assert e["global_windows"] == [list(w) for w in ns["GLOBAL"]] and e["out_of_scope"] == {k: list(v) for k, v in ns["OUT_OF_SCOPE"].items()}
    assert e["pre"] == ns["PRE"] == 4 and e["threshold"] == ns["THRESHOLD"] == 60.0
    assert set(e["episodes"]) == {"gfc-2008", "taper-2013", "russia-2014", "china-2015", "argentina-2018", "turkey-2018", "argentina-2019", "covid-2020", "turkey-2021"}
    dropped: list = []
    assert gate.gate(e, "episodes/global", dropped=dropped) == e and dropped == []


# ---------------------------------------------------------------- V23: the quarterly frame against WDI
def _earn(gdp_scale=1.0, unit="XDC"):
    qs = [f"{y}-Q{q}" for y in (2022, 2023, 2024) for q in (1, 2, 3, 4)]
    fx = {p: 1300.0 for p in qs}
    wdi = {"read": "2026-11-01", "source": "World Bank", "licence": "CC BY 4.0", "meta": {},
           "series": {"gdp": {"KOR": {"2022": 400e9, "2023": 400e9, "2024": 400e9}}, "x": {"KOR": {"2023": 200e9}}, "m": {"KOR": {"2023": 180e9}}, "pi": {"KOR": {"2023": 20e9}}}}
    q = {"read": "2026-11-01", "from": "2004-Q1", "economies": ["KOR"], "sources": {}, "empty": {}, "last": {}, "missing": {},
         "bop": {"KOR": {"GS.CD_T.USD": {"indicator": "GS", "entry": "CD_T", "unit": "USD", "scale": "6", "obs": {p: 50e9 for p in qs}},
                         "GS.DB_T.USD": {"indicator": "GS", "entry": "DB_T", "unit": "USD", "scale": "6", "obs": {p: 45e9 for p in qs}},
                         "IN1.CD_T.USD": {"indicator": "IN1", "entry": "CD_T", "unit": "USD", "scale": "6", "obs": {p: 10e9 for p in qs}},
                         "IN1.DB_T.USD": {"indicator": "IN1", "entry": "DB_T", "unit": "USD", "scale": "6", "obs": {p: 5e9 for p in qs}}}},
         "gdp": {"KOR": {unit: {"label": unit, "scale": "0", "obs": {p: gdp_scale * 100e9 * (1300.0 if unit == "XDC" else 1.0) for p in qs}}}},
         "fx": {"KOR": {"KRW": {"ref_area": "KR", "currency": "KRW", "unit_mult": "0", "obs": fx}}}}
    return {"wdi": wdi, "quarterly": q}


def test_v23_frame_within_three_percent_else_withheld():
    r = verify.v23_wdi_vs_qnea(_earn())
    assert r.status == "pass" and all(d["ok"] for d in r.details) and {d["series"] for d in r.details} == {"xu", "mu", "pi", "gdp"}
    assert next(d for d in r.details if d["series"] == "gdp")["unit_used"] == "XDC" and next(d for d in r.details if d["series"] == "gdp")["median_ratio"] == 1.0
    r = verify.v23_wdi_vs_qnea(_earn(gdp_scale=1.2))                 # India's case: fiscal-year quarters do not sum to the calendar year
    assert r.status == "warning" and registry.METHOD["checks"]["V23"]["severity"] == "warn"
    bad = [d for d in r.details if not d["ok"]]
    assert [(d["economy"], d["series"]) for d in bad] == [("KOR", "gdp")] and "withheld" in bad[0]["note"] and bad[0]["median_ratio"] == 1.2
    assert verify.v23_wdi_vs_qnea(_earn(gdp_scale=1.029)).status == "pass"
    assert not verify.blocking([r])


# ---------------------------------------------------------------- the gate on the surface views and the registry
def test_surface_views_pass_the_gate_and_registry():
    e = _earn()
    dropped: list = []
    assert gate.gate(e, "earn/global", dropped=dropped) == e and dropped == []
    for ds in ("wb.WDI", "imf.QNEA", "imf.WEO", "imf.BOP", "bis.XRU", "imf.IIP"):
        assert registry.shown(registry.licence(ds)), ds
    assert registry.licence("fred.observations", "IRLTLT01") == "open"
    broken = {**gate.VIEW_DATASETS, "earn/global": ["llama.stablecoins"]}
    import unittest.mock as um
    with um.patch.object(gate, "VIEW_DATASETS", broken), pytest.raises(gate.LicenceError):
        gate.gate(e, "earn/global")
    for pid in ("earn.annual", "earn.quarterly", "sovereign.fiscal", "sovereign.external", "sovereign.market", "sovereign.episodes", "market.bank_cut", "world.changes"):
        assert pid in registry.SOURCES["panels"], pid
    assert verify.v17_source_links().status == "pass"
    # the sovereign object's keys all belong to its schema (an object with warning.py's shape)
    obj = {"years": [1990], "rules": {"r1": {"group": "fiscal", "default": 90, "dir": "ge"}}, "econ": {"KOR": {"v": {"r1": [1.0]}, "spread": {"t0": "2000-10", "v": [0.1]}}},
           "gloss": {"en": {"w_r1": {"term": "T", "src": [{"src": "imf.weo", "series": ["GGXWDG_NGDP"]}]}}, "_long": [], "_missing": []},
           "episodes": [{"id": "arg-default-default-1982", "eco": "ARG", "before_sample": True}], "meta": {"vintage": "2026-10"}}
    dropped = []
    assert gate.gate(obj, "sovereign/global", dropped=dropped) == obj and dropped == []


def test_fetchers_match_registry():
    """The fetchers' constants equal config/datasets.yaml `external`, and they write under money-flow's own root."""
    import fetch_quarterly, fetch_warning, fetch_wdi  # noqa: E401
    ext = registry.DATASETS["external"]
    assert fetch_wdi.SERIES == ext["wdi"]["series"]
    assert fetch_quarterly.BOP_KEY == ext["quarterly"]["bop_key"] and fetch_quarterly.QNEA_KEY == ext["quarterly"]["qnea_key"] and fetch_quarterly.START == ext["quarterly"]["from"]
    assert fetch_warning.WEO_IND == ext["warning"]["weo_indicators"]
    assert ext["warning"]["config"] == "sovereign.yaml" and fetch_warning.CFG["economies"][0] == "KOR"
    for mod, name in ((fetch_wdi, "wdi"), (fetch_quarterly, "quarterly"), (fetch_warning, "warning")):
        assert mod.STORE == mod.ROOT / "external" / name and "global-network" not in str(mod.STORE)
    assert fetch_quarterly.XRU_DIR == fetch_quarterly.ROOT / "hub" / "bis" / "bulk" / "WS_XRU"
    for ds in ("wb.WDI", "imf.QNEA", "imf.WEO"):
        assert ds in registry.SOURCES["datasets"] and registry.SOURCES["datasets"][ds]["class"] == "open"


# ---------------------------------------------------------------- the surface manifest
def test_surface_manifest_shape(tmp_path):
    s = release.surface("20261103.1", "2026-11-03T07:45:00+09:00", "1.5")
    assert s == {"surface": "1.0", "release": "20261103.1", "method": "1.5", "built": "2026-11-03T07:45:00+09:00",
                 "files": ["world/global", "econ/*", "mkt/*", "earn/global", "changes/global", "episodes/global", "sovereign/global", "registry/*", "checks", "meta"]}
    p = release.write_surface(s, root=tmp_path)
    assert json.loads(p.read_text()) == s and p.name == "surface.json"
    # the surface and the checks alone never cut a release; a data change does
    m, new = release.cut({"econ/KOR": b"{}", "checks": b"{}", "surface": b'{"release":"a"}'}, {}, root=tmp_path)
    assert new
    m, new = release.cut({"econ/KOR": b"{}", "checks": b'{"x":1}', "surface": b'{"release":"b"}'}, {}, root=tmp_path)
    assert not new
    m, new = release.cut({"econ/KOR": b"{1}", "checks": b"{}", "surface": b'{"release":"c"}'}, {}, root=tmp_path)
    assert new and "surface" in m["files"]
