# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb==1.5.6", "pyarrow==21.0.0", "pyyaml==6.0.3", "brotli==1.1.0"]
# ///
"""The site's data, from the tables to a release.

    uv run scripts/build_site_data.py              # tables -> marks -> views -> gate -> verify -> release
    uv run scripts/build_site_data.py --only KOR   # one economy and the shared files, written to a scratch store
    uv run scripts/build_site_data.py --dry        # everything but the release (prints the checks)
    uv run scripts/build_site_data.py --volume     # only the volume manifest ($MONEY_FLOW_DATA_ROOT/site/volume.json)

Steps: the registries are checked against the code (a rule without a function or a test stops the build); the table
rules are applied (marks.py); the pre-checks V5, V6 and V13 run; the views are built (views.py: economies, markets, the
world, and since method 1.5 the export surface's earn/global, changes/global, episodes/global and sovereign/global, with
the lender cut on mkt/bank) and passed through the licence gate (gate.py); the remaining checks run on the finished files
(verify.py); if no blocking check failed, the files are stored by content hash and, when anything changed, a release is
cut (release.py) and $MONEY_FLOW_DATA_ROOT/site/surface.json rewritten (the surface contract). The checks are also written to
$MONEY_FLOW_DATA_ROOT/checks/site-checks.json whatever happens. Exit 1 on a blocking failure. A build that passes its checks
also measures the tables (volume.py: rows per dataset, bytes of raw files, for the www portal), rewrites
$MONEY_FLOW_DATA_ROOT/site/volume.json and puts the same block in the release manifest (`volume`, and `rows` and `bytes` in
`datasets`); a failed measurement is logged and never stops the build.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import duckdb  # noqa: E402

from sitebuild import cite, gate, marks, registry, release, rules, sovereign, verify, views, volume  # noqa: E402,F401  (sovereign registers R22–R28)

ROOT = Path(os.environ.get("MONEY_FLOW_DATA_ROOT", "data"))
KST = dt.timezone(dt.timedelta(hours=9))
QEND = {"1": "03-31", "2": "06-30", "3": "09-30", "4": "12-31"}
FINANCIAL_CENTRES, FUND_DOMICILES = views.FINANCIAL_CENTRES, views.FUND_DOMICILES   # the market view's pass-through shares use them too


def log(msg: str) -> None:
    print(f"{dt.datetime.now().strftime('%H:%M:%S')} {msg}", flush=True)


def newest_periods(con) -> dict[str, tuple[str, str]]:
    out = {}
    for t in ("stocks_m", "links_m", "totals_m", "flows_m", "signals_m"):
        for ds, p, fr in con.execute(f"SELECT dataset, max(period), mode(freq) FROM {t} GROUP BY 1").fetchall():
            if ds not in out or str(p) > out[ds][0]:
                out[ds] = (str(p), fr)
    return out


def measure_volume(write: bool) -> dict | None:
    """The volume block (sitebuild/volume.py), written to the store when `write`; None, logged, if it cannot be measured."""
    try:
        vol = volume.measure()
        where = f"-> {volume.write(vol)}" if write else "(not written)"
        log(f"volume: {vol['rows']:,} rows, {vol['bytes']:,} bytes in {len(vol['tables'])} tables and {len(vol['files'])} files; "
            f"{len(vol['missing'])} sources without a count, {len(vol['unlisted'])} tables unlisted {where}")
        return vol
    except Exception as e:                                          # the portal's numbers never stop the site's release
        log(f"VOLUME: not measured ({type(e).__name__}: {e}); the build goes on without it")
        return None


def build(only: list[str] | None = None) -> tuple[dict[str, object], list, dict]:
    con = duckdb.connect()
    con.execute("SET threads=1")                     # one thread: sums of doubles add in the same order every run (V10)
    t0 = time.time()
    state = marks.load(con)
    log(f"rules applied to the tables ({time.time() - t0:.0f} s)")
    day = dt.datetime.now(KST).date()
    vintages = state["vintages"]
    ctx = views.Ctx(con, day, vintages)
    pre = [verify.v5_sources_agree(con), verify.v6_mirrors(con, ctx.flags), verify.v13_size_of_change(con, ctx.flags)]
    log("pre-checks V5, V6, V13 done")

    have = {r[0] for r in con.execute("SELECT DISTINCT economy FROM totals_m WHERE dataset = 'imf.IIP'").fetchall()} - ctx.agg   # every economy with an IIP (M9)
    economies = sorted(have if not only else set(only))
    files: dict[str, object] = {}
    for i, x in enumerate(economies):
        v = views.economy(ctx, x)
        if v:
            files[f"econ/{x}"] = v
        if i % 40 == 0:
            log(f"  economies {i + 1}/{len(economies)}")
    log(f"economy views: {sum(k.startswith('econ/') for k in files)}")
    for m in views.MARKETS:
        files[f"mkt/{m}"] = views.market(ctx, m)
    w = views.world(ctx, sorted(have))
    w["ticker"] = views.ticker(ctx)
    w["board"] = views.board(ctx)
    w["pulse"] = views.pulse(ctx)
    files["world/global"] = w
    log("market and world views done")
    # the export surface (method 1.5, the surface contract): the fetchers' files as views, the change feed and the validation
    # set from the board, the sovereign section, the lender cut on the bank market; their read dates join the vintages
    newest = newest_periods(con)
    earn, ext = views.earn()
    files["earn/global"] = earn
    files["changes/global"] = views.changes(w["board"])
    files["episodes/global"] = views.episodes()
    sov, sv = views.sovereign(ctx, w["board"])
    files["sovereign/global"] = sov
    files["mkt/bank"]["lender_cut"] = views.lender_cut(ctx, w["board"])
    vintages.update(ext | sv)
    newest["wb.WDI"] = (f"{max(int(y) for v in earn['wdi']['series']['gdp'].values() for y in v)}-12-31", "A")
    qmax = max(p for v in earn["quarterly"]["gdp"].values() for s in v.values() for p in s["obs"])
    newest["imf.QNEA"] = (f"{qmax[:4]}-{QEND[qmax[-1]]}", "Q")
    newest["imf.WEO"] = (f"{sov['last_actual']}-12-31", "A")
    log(f"surface views done: earn (WDI {ext['wb.WDI']}, quarterly {ext['imf.QNEA']}), changes ({len(files['changes/global']['items'])} items), "
        f"episodes, sovereign (WEO {sov['meta']['vintage']}), lender cut ({len(files['mkt/bank']['lender_cut']['debtors'])} debtors)")

    pages = sorted(k.split("/")[1] for k in files if k.startswith("econ/"))
    used = sorted({ds for ds in vintages if registry.dataset(ds)})
    files["meta"] = {
        "method": registry.METHOD["version"],
        "day": day.isoformat(),
        "asof": [views.iso(a) for a in ctx.asof],
        "economies": {c: {"en": e["en"], "ko": e["ko"] or e["en"], "region": e["region"], "subregion": e["subregion"], "lat": e["lat"], "lon": e["lon"],
                          "agg": bool(e["agg"]), "page": c in pages, "fc": c in FINANCIAL_CENTRES, "fd": c in FUND_DOMICILES}
                      for c, e in sorted(ctx.econ.items()) if c in pages or not e["agg"] or c in ("BIS:5A", "BIS:5J", "TIC:TOTAL", "WLD")},
        "markets": list(views.MARKETS),
        "datasets": {ds: {"vintage": vintages[ds], "newest": newest.get(ds, (None, None))[0], "freq": newest.get(ds, (None, None))[1],
                          "class": registry.licence(ds)} for ds in used if registry.shown(registry.licence(ds))},
    }
    files["registry/sources"] = {"classes": registry.SOURCES["classes"], "publishers": registry.SOURCES["publishers"],
                                 "links": registry.SOURCES.get("links") or {}, "panels": registry.SOURCES.get("panels") or {},
                                 "datasets": {k: {f: v for f, v in e.items() if f != "keys"} | {"keys": {kk: {f: vv for f, vv in o.items()} for kk, o in (e.get("keys") or {}).items()}}
                                              for k, e in registry.SOURCES["datasets"].items()}}
    files["registry/citations"] = cite.citations({ds: vintages[ds] for ds in used if registry.shown(registry.licence(ds))})
    return files, pre, {"con": con, "ctx": ctx, "state": state, "vintages": vintages, "newest": newest, "day": day}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="comma list of economies (writes to a scratch store, never a release)")
    ap.add_argument("--dry", action="store_true", help="no release; print the checks")
    ap.add_argument("--force", action="store_true", help="cut a release even if no file changed")
    ap.add_argument("--volume", action="store_true", help="only measure the tables and write volume.json (no views, no checks, no release)")
    a = ap.parse_args()
    if a.volume:
        return 0 if measure_volume(write=True) else 1
    only = a.only.split(",") if a.only else None

    files, pre, env = build(only)
    con, ctx = env["con"], env["ctx"]
    dropped: list[str] = []
    try:
        public = {p: gate.gate(o, p, dropped=dropped) for p, o in files.items()}
    except gate.LicenceError as e:
        log(f"LICENCE GATE: {e}")
        return 1
    if dropped:
        from collections import Counter
        log("gate dropped fields: " + ", ".join(f"{k} {n}" for k, n in Counter(d.rsplit("/", 1)[-1] for d in dropped).most_common(12)))
    # V9: the same views again, byte for byte
    det = [k for k in ("econ/KOR", "econ/USA") if k in files]
    first = b"".join(release.dumps(public[k]) for k in det)
    second = b"".join(release.dumps(gate.gate(views.economy(ctx, k.split("/")[1]), k)) for k in det)
    results = pre + [verify.v9_determinism(first, second)]
    # method registry with this build's rule effects, then the checks
    public["registry/method"] = {**registry.METHOD, "date": str(registry.METHOD["date"]), "effects": registry.EFFECTS,
                                 "board_set": files["world/global"]["board"]["set"]}   # the Signal Board's economies, for the Method page
    blobs = {p: release.dumps(o) for p, o in public.items()}
    hashes = {p: release.sha(b) for p, b in blobs.items()}
    prev = release.latest()
    prev_excess = None                                              # V14: the excesses the previous release already knew
    if prev:
        try:
            pc = json.loads(release.get(prev["files"]["checks"]))
            v14 = [r for r in pc["results"] if r["id"] == "V14"]
            if v14:                                                 # a release under method 1.0 had no V14: nothing is "new" yet
                prev_excess = {(d["economy"], {"total": "portfolio", "equity": "portfolio_equity", "debt": "portfolio_debt"}[d["instrument"]]) for r in v14 for d in r["details"]}
        except (KeyError, OSError, ValueError):
            prev_excess = None
    results += [
        verify.v14_cpis_within_iip(con, prev_excess),
        verify.v15_lbs_within_iip_other(con),
        verify.v16_publisher_identities(con),
        verify.v1_unique_keys(env["state"]["conflicts"], {"rank": sum(len(l["rank"]) != len(set(l["rank"])) for v in public.values() if isinstance(v, dict)
                                                                    for d in (v.get("ladders") or {}).values() for l in d)}),
        verify.v2_one_row_per_ribbon(ctx.v2_duplicates),
        verify.v3_adds_up(ctx.v3),
        verify.v4_coverage(ctx.cov_flags),
        verify.v7_publisher_totals(con),
        verify.v8_golden(con, env["vintages"]),
        verify.v10_explained(prev, hashes, env["vintages"], registry.code_hash(), registry.METHOD["version"]),
        verify.v11_licence({p: b for p, b in blobs.items() if not p.startswith("registry/")}, dropped),
        verify.v12_freshness(env["newest"], env["day"]),
        verify.v17_source_links(),
        verify.v18_board_complete(files["world/global"]["board"]),
        verify.v19_adjusted_flows(con),
        verify.v20_disjoint(registry.DATASETS["signals"]),
        verify.v21_pulse_fresh(files["world/global"]["pulse"], env["day"]),
        verify.v22_no_extremes_from_tiny_moves(files["world/global"]["board"]),
        verify.v23_wdi_vs_qnea(files["earn/global"]),
        verify.v24_sovereign_rates(files["sovereign/global"]),
        verify.v25_sovereign_auroc(files["sovereign/global"]),
        verify.v26_sovereign_expectations(files["sovereign/global"]),
        verify.v27_net_reserves(files["world/global"]["board"], files["mkt/bank"].get("lender_cut")),
    ]
    problems = registry.completeness()
    results.sort(key=lambda r: int(r.id[1:]))
    checks = {"results": [r.out() for r in results], "summary": verify.summary(results), "registry": problems}
    (ROOT / "checks").mkdir(parents=True, exist_ok=True)
    (ROOT / "checks" / "site-checks.json").write_text(json.dumps(checks, indent=1, default=str), encoding="utf-8")
    for r in results:
        log(f"{r.id} {r.status:<7} {r.summary}")
    for p in problems:
        log(f"REGISTRY: {p}")
    block = verify.blocking(results)
    if block or problems:
        log(f"STOPPED: {len(block)} blocking check(s) failed, {len(problems)} registry problem(s); no release")
        return 1
    public["checks"] = checks
    blobs["checks"] = release.dumps(checks)
    size = sum(len(b) for b in blobs.values())
    log(f"{len(blobs)} files, {size / 1e6:.1f} MB of JSON")
    vol = None if only else measure_volume(write=not a.dry)          # the tables passed the checks: the portal's volume.json
    if a.dry or only:
        return 0
    meta = {"method": registry.METHOD["version"], "code": registry.code_hash(), "vintages": env["vintages"],
            "hashes": env["state"]["hashes"], "checks": checks["summary"], "size_json": size,
            "datasets": volume.with_counts(public["meta"]["datasets"], vol), **({"volume": vol} if vol else {})}
    # the export surface (the surface contract): the same object inside the release (file key `surface`) and at the store root
    now = dt.datetime.now(KST)
    surf = release.surface(release.next_tag(now), now.isoformat(timespec="seconds"), registry.METHOD["version"])
    blobs["surface"] = release.dumps(surf)
    m, new = release.cut(blobs, meta, force=a.force, now=now)
    if not new:                                                     # nothing changed: the surface names the release that stays latest
        surf = release.surface(m["tag"], m["built"], m["method"])
    release.write_surface(surf)
    log(f"release {m['tag']} ({'new' if new else 'unchanged, no release cut'}); {len(m.get('changed', []))} files changed; surface {surf['surface']} written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
