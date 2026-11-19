"""V11 and R14 on the internal views for the datasteg API service (/svc/v1, the API service contract; money-flow/api.yaml).

Every example in api.yaml, in both languages, and a wide set of variants (every part of an economy page, every indicator of
several economies at 400 points, every market and lender-cut mode, all 36 Sovereign economies, every kept release, an old
release, the hooks) are fetched from a running app and scanned, as check V11 and rule R14 scan the release files:

- no dataset or series key of a class that may not be shown (config/sources.yaml: llama.stablecoins, FRED JPNASSETS and
  BAMLEMCBPIOAS), no publisher that only such sources have, and every `sources` entry of a class that may be shown;
- no commercial vendor name and no fund-level field (rules.VENDORS, rules.FUND_FIELDS, plus the gateway checker's list);
- no daily, weekly or monthly run longer than 13 observations in any `points` list or dated table (the World pulse's open
  weekly series: 53);
- no field outside the views' documented schema (ALLOWED below; the release files' short keys never leave);
- Korean only in names and item text, never in a summary.

    MF_SVC_BASE=http://127.0.0.1:3511 uv run --with pytest --with pyyaml==6.0.3 -m pytest tests/test_svc_v11.py

Skipped when MF_SVC_BASE is not set (build and start the app first)."""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pytest
import yaml

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / "scripts"))
from sitebuild import registry, rules  # noqa: E402

BASE = os.environ.get("MF_SVC_BASE")
pytestmark = pytest.mark.skipif(not BASE, reason="MF_SVC_BASE not set")

GATEWAY_VENDORS = re.compile(r"\b(EPFR|Lipper|LSEG|Refinitiv|Capital IQ|S&P Capital|Bloomberg L\.P\.|FactSet)\b", re.I)
HANGUL = re.compile(r"[\uac00-\ud7a3]")
KOREAN_OK = {"name", "creditor_name", "debtor_name", "lender_name", "title", "text"}
RUN_CAP, PULSE_CAP = 13, 53
STEP = {"D": 1, "W": 7, "M": 31}

# The documented field names of every view (envelope, sources, table, data). A key outside this set fails the test.
ALLOWED = {
    # envelope, error, period, table
    "app", "view", "release", "built", "method", "period", "page", "sources", "summary", "data", "table", "notes", "cursor",
    "freq", "shown", "newest", "columns", "rows", "id", "label", "unit",
    "publisher", "dataset", "key", "vintage", "licence", "terms", "url",
    # manifest, search, item, profile, economies
    "surface", "views", "items", "kind", "title", "snippet", "score", "text", "metadata",
    "covered", "code", "name", "headline", "links", "value", "economies", "region",
    # economy
    "economy", "part", "newest_period", "tiles", "scale", "source", "note", "board", "sovereign", "parts",
    "quarter", "vulnerability", "flow_pct", "exposure", "buffer_weakness", "a1_pct", "a2_pct",
    "count", "of", "signals", "alarm_at", "year",
    "directions", "direction", "as_of_day", "holders_shown", "periods", "channel", "channels", "total", "ribbons", "holder", "flow", "flow_kind",
    "coverage", "coverage_pct", "indicators", "path", "checks", "check", "status", "release_checks", "checks_page",
    "pass", "warning", "info", "fail",
    # indicator
    "indicator", "detail", "points_total", "points",
    # board
    "quarter_label", "economies_drawn", "net_outflow", "marks", "largest_withdrawals", "flow_usd_bn", "b1_usd_bn", "b2_usd_bn",
    "not_drawn", "left_out", "reason", "advanced", "quarters_from", "quarters_to",
    # method 1.6: net reserves without the floor beside A2's reserve base, rows without a flow,
    # all-instrument reporters apart in the lender cut, the Sovereign source per year
    "a2_reserve_base_usd_bn", "a2_floored", "drawn_without_flow", "all_instrument_reporters", "all_instruments_usd_bn",
    "latest_source", "sources", "R25", "R26", "R27",
    # pulse
    "as_of", "change_4w", "change_unit", "age_days", "stale", "missing", "tic", "series", "latest", "sum_3m",
    # market
    "market", "total_identified", "holders_count", "destinations_count", "creditor", "creditor_name", "debtor", "debtor_name",
    "creditor_totals", "debtor_totals", "held_abroad", "held_abroad_via_pass_through", "foreign_held", "foreign_held_via_pass_through",
    "largest_holders", "largest_destinations",
    # lender cut
    "cut_pct", "mode", "formula", "lender", "lender_name", "share_pct", "claims_usd_bn", "loss_usd_bn", "net_reserves_usd_bn",
    "loss_pct_of_net_reserves", "debtors",
    # sovereign
    "published", "last_actual", "projections_from", "signals_now", "rules", "rule", "group", "threshold", "latest_value",
    "latest_period", "latest_kind", "state", "benchmark", "euro_member", "spread", "years", "projection", "episodes", "start", "end",
    "type", "facility", "description", "alarm", "validation", "scored", "hits", "hit_rate_pct", "calm_years", "false_alarms",
    "false_alarm_rate_pct", "auroc",
    # releases
    "releases", "tag", "date", "previous", "files_changed", "datasets", "changed",
}


def _banned():
    src = registry.SOURCES
    ds = sorted(d for d, e in src["datasets"].items() if not registry.shown(e["class"]))
    keys = sorted(k for d, e in src["datasets"].items() for k, o in (e.get("keys") or {}).items() if not registry.shown(o.get("class", e["class"])))
    used = {e["publisher"] for e in src["datasets"].values() if registry.shown(e["class"])} | {
        o.get("publisher") for e in src["datasets"].values() for o in (e.get("keys") or {}).values() if registry.shown(o.get("class", e["class"]))}
    used |= {l.get("publisher") for l in (src.get("links") or {}).values()}
    pubs = sorted(src["publishers"][p]["en"] for p in src["publishers"] if p not in used)
    return ds, keys, pubs


BANNED_DS, BANNED_KEYS, BANNED_PUBLISHERS = _banned()


def get(path: str, lang: str = "en") -> tuple[int, bytes]:
    sep = "&" if "?" in path else "?"
    req = urllib.request.Request(f"{BASE.rstrip('/')}/svc/v1{path}{sep}lang={lang}", headers={"Host": "money-flow", "X-Datasteg-Gateway": "check"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _date(p: str) -> dt.date:
    return dt.date.fromisoformat(p if len(p) == 10 else f"{p}-01")


def _run(periods: list[str], f: str) -> int:
    best = run = 1 if periods else 0
    prev = None
    for p in periods:
        d = _date(p)
        if prev and (d - prev).days <= STEP[f] * 1.6:
            run += 1
            best = max(best, run)
        else:
            run = 1
        prev = d
    return best


def _walk(obj, view: str, path: str, freq: str | None, bad: list[str], keys: set[str]):
    if isinstance(obj, dict):
        f = obj.get("freq") if isinstance(obj.get("freq"), str) else freq
        for k, v in obj.items():
            keys.add(k)
            if k == "points" and isinstance(v, list) and f in STEP:
                n = _run([x["period"] if isinstance(x, dict) else x[0] for x in v], f)
                cap = PULSE_CAP if view == "pulse" and f == "W" else RUN_CAP
                if n > cap:
                    bad.append(f"{path}/points: {n} consecutive {f} observations (cap {cap})")
            if isinstance(v, str) and HANGUL.search(v) and k not in KOREAN_OK:
                bad.append(f"{path}/{k}: Korean outside a name or item text")
            _walk(v, view, f"{path}/{k}", f, bad, keys)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            _walk(v, view, f"{path}[{i}]", freq, bad, keys)


def scan(label: str, body: bytes) -> list[str]:
    s = body.decode("utf-8")
    bad = []
    for d in BANNED_DS:
        if d in s:
            bad.append(f"names {d}")
    for k in BANNED_KEYS:
        if k in s:
            bad.append(f"carries {k}")
    for p in BANNED_PUBLISHERS:
        if p in s:
            bad.append(f"names publisher {p}")
    for rx in (rules.VENDORS, GATEWAY_VENDORS):
        if m := rx.search(s):
            bad.append(f"names vendor {m.group(0)}")
    if m := rules.FUND_FIELDS.search(s):
        bad.append(f"fund-level field {m.group(0)}")
    obj = json.loads(s)
    view = obj.get("view", "")
    for src in obj.get("sources") or []:
        if not registry.shown(src.get("licence", "")):
            bad.append(f"source of class {src.get('licence')}: {src.get('dataset')}")
    if HANGUL.search(obj.get("summary", "")):
        bad.append("Korean in the summary")
    keys: set[str] = set()
    _walk(obj, view, "", None, bad, keys)
    t = obj.get("table") or {}
    cols = [c["id"] for c in t.get("columns") or []]
    f = (obj.get("period") or {}).get("freq")
    if "period" in cols and f in STEP:
        i = cols.index("period")
        n = _run([r[i] for r in t.get("rows") or [] if r[i]], f)
        if n > RUN_CAP:
            bad.append(f"table: {n} consecutive {f} rows")
    outside = sorted(k for k in keys if k not in ALLOWED)
    if outside:
        bad.append(f"fields outside the schema: {', '.join(outside[:12])}")
    return [f"{label}: {b}" for b in bad]


def _paths() -> list[str]:
    m = yaml.safe_load((HERE / "api.yaml").read_text(encoding="utf-8"))
    out = []
    for v in m["views"]:
        ex = dict(v.get("example") or {})
        p = re.sub(r"\{(\w+)\}", lambda g: urllib.parse.quote(str(ex.pop(g.group(1))), safe=""), v["path"])
        out.append(p + (f"?{urllib.parse.urlencode(ex)}" if ex else ""))
    econs = ["KOR", "USA", "EMU", "JPN", "GBR", "CHN", "TUR", "BRA"]
    for e in econs:
        out += [f"/economies/{e}?part={p}" for p in ("summary", "ladder", "indicators", "checks")]
        out += [f"/economy/{e}", f"/item?id=economy:{e}"]
    for e in econs[:5]:
        s, b = get(f"/economies/{e}?part=indicators")
        assert s == 200, (e, s)
        out += [f"{x['path']}?last=400" for x in json.loads(b)["data"]["indicators"]]
    for mk in ("equity", "bonds", "bank", "fdi"):
        out += [f"/markets/{mk}?limit=25", f"/markets/{mk}?debtor=KOR&limit=25", f"/markets/{mk}?creditor=USA&limit=25", f"/markets/{mk}?creditor=USA&debtor=KOR",
                f"/markets/{mk}?debtor=VNM", f"/item?id=market:{mk}"]
    out += ["/markets/bank/lender-cut", "/markets/bank/lender-cut?debtor=TUR&cut_pct=50", "/markets/bank/lender-cut?lender=USA", "/markets/bank/lender-cut?lender=GBR&debtor=KOR"]
    s, b = get("/sovereign")
    assert s == 200
    out += ["/sovereign", "/item?id=sovereign:all"] + [f"/sovereign?economy={x['economy']}" for x in json.loads(b)["data"]["economies"]]
    out += ["/board", "/board?quarter=2008-Q4", "/item?id=board:latest", "/item?id=board:2020-06-30", "/pulse", "/releases?limit=100"]
    s, b = get("/releases?limit=100")
    assert s == 200
    tags = [r["tag"] for r in json.loads(b)["data"]["releases"]]
    out += [f"/releases/{t}" for t in tags]
    old = tags[-1]
    out += [f"/board?release={old}", f"/economies/KOR?release={old}", f"/economies/KOR?part=ladder&release={old}", f"/markets/bank?debtor=KOR&release={old}", f"/pulse?release={old}"]
    out += ["/manifest", "/economies", "/economy/ZZZ", "/search?q=korea", "/search?q=bank", "/search?q=sovereign"]
    return list(dict.fromkeys(out))


def test_every_view_passes_v11():
    bad, n = [], 0
    for p in _paths():
        for lang in ("en", "ko"):
            s, b = get(p, lang)
            if s == 404 and "not-in-release" in b.decode("utf-8", "replace"):
                continue                                     # an old release without that section: an error, no data
            assert s == 200, (p, lang, s, b[:300])
            bad += scan(f"{p} [{lang}]", b)
            n += 1
    assert n > 300, n
    assert not bad, "\n".join(bad[:40])


def test_errors_carry_no_data():
    for p in ("/economies/ZZZZZZZZ", "/economies/KOR/indicators/nope", "/markets/gold", "/releases/20000101.1", "/board?quarter=1990-Q1",
              "/markets/bank/lender-cut?debtor=ZZZ", "/sovereign?economy=ZZZ", "/item?id=nosuchkind:zzz", "/board?release=nonsense"):
        s, b = get(p)
        assert s in (400, 404), (p, s)
        e = json.loads(b)["error"]
        assert e["detail"] and set(e) == {"status", "type", "title", "detail"}, (p, e)


def test_public_host_is_refused():
    req = urllib.request.Request(f"{BASE.rstrip('/')}/svc/v1/board", headers={"Host": "money-flow.datasteg.com"})
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(req, timeout=30)
    assert e.value.code == 404


def test_consistency_fields():
    """Method 1.6: net reserves are the value without A2's floor and the floored base
    has its own name; method 1.2's score is gone; the lender cut lists all-instrument reporters apart; the Sovereign view
    names each year's source; the economy summary names the sovereign count's year."""
    st, b = get("/board")
    assert st == 200
    j = json.loads(b)
    cols = [c["id"] for c in j["table"]["columns"]]
    assert "vulnerability_v12" not in cols and "net_reserves_usd_bn" in cols and "a2_reserve_base_usd_bn" in cols
    rows = {r[0]: dict(zip(cols, r)) for r in j["table"]["rows"]}
    ar = rows.get("ARG")
    if ar and ar["a2_floored"]:
        assert ar["net_reserves_usd_bn"] < ar["a2_reserve_base_usd_bn"]          # the floor is A2's alone
    st, b = get("/markets/bank/lender-cut?debtor=KOR")
    d = json.loads(b)["data"]
    assert st == 200 and all(x["lender"] not in {r["lender"] for r in d["rows"]} for x in d["all_instrument_reporters"])
    st, b = get("/sovereign?economy=KOR")
    years = json.loads(b)["data"]["years"]
    assert any(y["sources"]["R25"] for y in years)
    st, b = get("/economies/KOR")
    s = json.loads(b)
    if s["data"]["sovereign"]:
        assert f"(year {s['data']['sovereign']['year']}" in s["summary"]
