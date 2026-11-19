"""The sovereign rules R22–R28 (scripts/sitebuild/sovereign.py), each against a case computed by hand, the registry's
`sovereign` fields against config/sovereign.yaml, the counting and validation arithmetic, and the checks V24–V26 on a
small built object. Run with the suite: uv run --with pytest --with duckdb==1.5.6 --with pyyaml==6.0.3 --with brotli==1.1.0 --with pyarrow==21.0.0 -m pytest tests"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from sitebuild import registry, sovereign as sov, verify  # noqa: E402

CONFIG = Path(__file__).resolve().parents[1] / "config"


# ---------------------------------------------------------------- the registry and the config agree
def test_sovereign_rules_match_config():
    """R22–R28 in method.yaml carry the default, the direction and the source of r1–r7 in sovereign.yaml, and the
    economies are the Signal Board's 36 (R19) that the fetchers also use."""
    cfg = yaml.safe_load((CONFIG / "sovereign.yaml").read_text(encoding="utf-8"))
    for rid, pid in sov.METHOD_IDS.items():
        m = registry.METHOD["rules"][pid]["sovereign"]
        c = cfg["rules"][rid]
        assert m["id"] == rid and m["default"] == c["default"] and m["dir"] == c["dir"] and m["unit"] == c["unit"] and m["source"] == c["source"], pid
        assert registry.METHOD["rules"][pid]["fn"] == f"sovereign.{sov.RULES_FN[rid]}"
    assert len(cfg["economies"]) == 36 and cfg["economies"][0] == "KOR"
    import fetch_wdi
    assert set(fetch_wdi.ECONOMIES) == set(cfg["economies"]) | {"USA"}
    assert cfg["K"]["default"] == 4 and cfg["validation"]["pre"] == [1, 3]


# ---------------------------------------------------------------- R22, R23: pass-through with the threshold test
def test_r22_r23_pass_through_and_threshold():
    assert sov.r22_debt_level(110.907306) == 110.91 and sov.r22_debt_level(None) is None
    assert sov.r23_deficit(-15.423608) == -15.42 and sov.r23_deficit(None) is None
    cfg = sov.config()["rules"]
    assert sov.rule_on(sov.r22_debt_level(90.0), cfg["r1"]["default"], cfg["r1"]["dir"]) is True      # 90 is on (ge)
    assert sov.rule_on(sov.r22_debt_level(89.99), cfg["r1"]["default"], cfg["r1"]["dir"]) is False
    assert sov.rule_on(sov.r23_deficit(-5.0), cfg["r2"]["default"], cfg["r2"]["dir"]) is True          # -5 is on (le)
    assert sov.rule_on(sov.r23_deficit(-4.9), cfg["r2"]["default"], cfg["r2"]["dir"]) is False
    assert sov.rule_on(None, 90, "ge") is None                                                            # missing is never off


# ---------------------------------------------------------------- R24: the debt snowball, by hand
def test_r24_snowball_round_numbers():
    # debt 100% of GDP last year, primary balance 0, overall balance -5% (interest 5% of GDP), GDP 100 -> 105.
    # interest = 5% x 105 = 5.25; last year's debt = 100% x 100 = 100; i = 5.25%; g = 5%;
    # pb* = 100 x (0.0525 - 0.05) / 1.05 = 0.2381; gap = 0.2381 - 0 = 0.2381
    r = sov.r24_debt_snowball(100, 0, -5, 105, 100)
    assert r["i"] == pytest.approx(5.25) and r["g"] == pytest.approx(5.0)
    assert r["pbstar"] == pytest.approx(0.238095, abs=1e-6) and r["gap"] == pytest.approx(0.238095, abs=1e-6)


def test_r24_snowball_greece_2009_by_hand():
    # WEO October 2026 vintage: debt 2008 = 110.907306% of GDP; 2009 primary balance -10.314413%, overall -15.423608%;
    # NGDP 2008 = EUR 238.7354 bn, 2009 = EUR 234.3226 bn.
    # interest 2009 = 5.109195% of GDP = 11.97206 bn; debt end-2008 = 264.7750 bn -> i = 4.5216%; g = -1.8484%
    # pb* = 110.907306 x (0.045216 + 0.018484) / 0.981516 = 7.1978% of GDP; gap = 17.512 points: R24 on (>= 1)
    r = sov.r24_debt_snowball(110.907306, -10.314413, -15.423608, 234322600000.0, 238735400000.0)
    assert r["interest"] == pytest.approx(5.109195, abs=1e-6)
    assert r["i"] == pytest.approx(4.5216, abs=1e-3) and r["g"] == pytest.approx(-1.8484, abs=1e-3)
    assert r["pbstar"] == pytest.approx(7.1978, abs=2e-3) and r["gap"] == pytest.approx(17.512, abs=2e-3)
    assert sov.rule_on(r["gap"], sov.config()["rules"]["r3"]["default"], "ge")


def test_r24_snowball_missing_input():
    assert sov.r24_debt_snowball(None, 0, -5, 105, 100) is None
    assert sov.r24_debt_snowball(100, 0, -5, None, 100) is None
    assert sov.r24_debt_snowball(0, 0, -5, 105, 100) is None          # no debt last year: no rate, no gap


# ---------------------------------------------------------------- R25–R28
def test_r25_current_account_three_year_average():
    assert sov.r25_current_account([(-3.0, "mf"), (-4.5, "mf"), (-6.0, "mf")]) == (-4.5, "mf")
    assert sov.r25_current_account([(-3.0, "mf"), (-4.5, "weo"), (-6.0, "mf")]) == (-4.5, "weo")   # one WEO year: the source is WEO
    assert sov.r25_current_account([(-3.0, "mf"), (None, None), (-6.0, "mf")]) == (None, None)     # a missing year: no average
    assert sov.r25_current_account([(1.0, "weo")]) == (None, None)


def test_r26_net_iip_board_first_then_imf():
    assert sov.r26_net_iip(47.83, [2500.0, 1600.0], 1.8e12) == (47.8, "mf")                        # the board's figure wins
    assert sov.r26_net_iip(None, [2500.0, 1600.0], 1.8e12) == (50.0, "iip")                        # (2500-1600) bn / 1800 bn
    assert sov.r26_net_iip(None, [2500.0, None], 1.8e12) == (None, None)
    assert sov.r26_net_iip(47.83, [2500.0, 1600.0], 1.8e12, projection=True) == (None, None)       # projection years are empty


def test_r27_liquidity_not_applicable_where_unscored():
    assert sov.r27_liquidity(44.41, 1) == (44.4, False)
    assert sov.r27_liquidity(44.41, 0) == (44.4, True)                                               # a euro member: shown as not applicable
    assert sov.r27_liquidity(None, None) == (None, False)
    assert sov.r27_liquidity(44.41, 1, projection=True) == (None, False)


def test_r28_spread_needs_six_months_and_benchmark():
    own = {f"2024-{m:02d}": 4.0 + 0.1 * m for m in range(1, 13)}
    bench = {f"2024-{m:02d}": 2.0 for m in range(1, 13)}
    sm = sov.spread_months(own, bench)
    assert len(sm) == 12 and sm["2024-06"] == pytest.approx(2.6)
    v, n = sov.r28_spread(sm, 2024)
    assert n == 12 and v == pytest.approx(2.65)                                                      # mean of 2.1 .. 3.2
    five = {k: v for k, v in sm.items() if k <= "2024-05"}
    assert sov.r28_spread(five, 2024) == (None, 5)                                                   # fewer than six months: missing
    assert sov.spread_months(own, None) is None and sov.r28_spread(None, 2024) == (None, 0)


# ---------------------------------------------------------------- counting, validation and the checks on a small object
def _mini_board(a2_scored=1):
    qs = [f"{y}-{md}" for y in range(2005, 2026) for md in ("03-31", "06-30", "09-30", "12-31")]
    n = len(qs)
    return {"KOR": {"q": qs, "a2": [40.0 + (i % 4) for i in range(n)], "a2_scored": [a2_scored] * n, "niip": [10.0] * n, "ca": [3.0] * n}}


def _warning_file(tmp_path: Path, years=range(1986, 2028)) -> Path:
    weo = {"GGXWDG_NGDP": {"KOR": {str(y): 40.0 + 0.5 * (y - 1990) for y in years}},
           "GGXCNL_NGDP": {"KOR": {str(y): -1.0 for y in years}}, "GGXONLB_NGDP": {"KOR": {str(y): 0.0 for y in years}},
           "NGDP": {"KOR": {str(y): 1000.0 * 1.05 ** (y - 1990) for y in years}}, "NGDPD": {"KOR": {str(y): 1.0e12 for y in years}},
           "BCA_NGDPD": {"KOR": {str(y): 2.0 for y in years}}}
    obj = {"read": "2026-11-02", "economies": ["KOR", "USA"], "weo": {"series": weo, "published": "2026-10-13", "vintage": "2026-10", "url": "x", "country_update": {}},
           "iip": {"A": {"KOR": {str(y): [500.0, 400.0] for y in years}}, "Q": {}, "updated": "2026-10-30"},
           "fred": {"KOR": {"id": "IRLTLT01KRM156N", "obs": {f"{y}-{m:02d}": 4.0 for y in range(2001, 2027) for m in range(1, 13) if (y, m) <= (2026, 9)}},
                    "USA": {"id": "IRLTLT01USM156N", "obs": {f"{y}-{m:02d}": 3.0 for y in range(2001, 2027) for m in range(1, 13) if (y, m) <= (2026, 9)}}}}
    p = tmp_path / "2026-11-02.json"
    p.write_text(json.dumps(obj))
    return p


def test_counts_never_count_missing_as_off_and_validation_arithmetic(tmp_path, monkeypatch):
    """The built object keeps warning.py's shape; a missing or not-applicable rule is not available (n falls, k does
    not); the AUROC counts ties half; the checks V24–V26 report and never block."""
    cfg = sov.config()
    monkeypatch.setattr(sov, "config", lambda: {**cfg, "economies": ["KOR"], "expectations": [
        {"id": "kor-2025", "eco": "KOR", "years": [2025], "test": "rules", "on": [], "off": ["r1", "r2"], "en": "Korea 2025: R1 and R2 off", "ko": "2025년 한국은 R1과 R2가 꺼진다."}]})
    o = sov.build(_mini_board(), {"KOR": {"en": "Korea", "ko": "한국"}}, source=_warning_file(tmp_path), quiet=True)
    assert list(o) == ["years", "proj0", "last_actual", "rules", "K", "order", "validation_cfg", "econ", "episodes", "spells", "coverage", "valid", "checks", "meta",
                       "economies", "names", "gloss"]
    assert o["proj0"] == 2026 and o["last_actual"] == 2025 and o["years"][0] == cfg["from"] and o["years"][-1] == 2027
    k = o["econ"]["KOR"]
    j = o["years"].index(2025)
    assert k["v"]["r1"][j] == 57.5 and k["v"]["r2"][j] == -1.0 and k["v"]["r6"][j] == 43.0 and k["src"]["r5"][j] == "mf" and k["src"]["r4"][j] == "mf"
    assert k["v"]["r7"][j] == 1.0 and k["x"]["r7n"][j] == 12 and k["now"]["r7"]["kind"] == "12m"
    j0 = o["years"].index(1990)
    assert k["v"]["r6"][j0] is None and k["src"]["r5"][j0] == "iip" and k["v"]["r5"][j0] == 10.0        # before the board: IMF IIP over WEO dollars
    assert k["v"]["r7"][j0] is None and k["counts"][j0][1] < k["counts"][j][1]                           # fewer rules available in 1990, none counted as off
    assert all(v is None for v in k["v"]["r5"][-2:]) and all(v is None for v in k["v"]["r6"][-2:])      # projection years empty for R26, R27
    assert sov.auroc([2, 2], [2, 2]) == 0.5 and sov.auroc([3], [1, 2]) == 1.0 and sov.auroc([1], [1, 3]) == 0.25
    # the checks: information or warnings only, never a blocking failure
    for r in (verify.v24_sovereign_rates(o), verify.v25_sovereign_auroc(o), verify.v26_sovereign_expectations(o)):
        assert r.status in ("pass", "info", "warning") and registry.METHOD["checks"][r.id]["severity"] in ("info", "warn")
    assert verify.v26_sovereign_expectations(o).status == "pass" and o["checks"][0]["ok"]
    assert not verify.blocking([verify.v24_sovereign_rates(o), verify.v25_sovereign_auroc(o), verify.v26_sovereign_expectations(o)])
    # a euro member's A2 is not applicable throughout
    o2 = sov.build(_mini_board(a2_scored=0), {"KOR": {"en": "Korea", "ko": "한국"}}, source=_warning_file(tmp_path), quiet=True)
    assert o2["econ"]["KOR"]["a2_na"] and o2["coverage"]["KOR"]["r6"] == {"na": True}


def test_glossary_placeholders_fill_from_the_build(tmp_path, monkeypatch):
    cfg = sov.config()
    monkeypatch.setattr(sov, "config", lambda: {**cfg, "economies": ["KOR"], "expectations": []})
    o = sov.build(_mini_board(), {"KOR": {"en": "Korea", "ko": "한국"}}, source=_warning_file(tmp_path), quiet=True)
    g = (tmp_path / "g.yaml")
    g.write_text("w_t:\n  src: [{src: imf.weo}]\n  en: {term: T, ex: 'Korea {KOR.2025.r1} in 2025; {KOR.2025.count}; {last}; {KOR.name}; {XXX.2025.r1}'}\n"
                 "  ko: {term: T, ex: '2025년 한국 {KOR.2025.r1}, {KOR.2025.count}'}\n", encoding="utf-8")
    out = sov.glossary(o, path=g, quiet=True)
    assert out["en"]["w_t"]["ex"].startswith("Korea 57.5% in 2025; ") and "; 2025; Korea; –" in out["en"]["w_t"]["ex"]
    assert "개 중 " in out["ko"]["w_t"]["ex"] and out["_missing"] == ["XXX.2025.r1"]
