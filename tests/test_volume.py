"""The volume manifest (scripts/sitebuild/volume.py) for the www portal's Data chart: rows per table and per fetch file,
stored bytes, every Sources link row exactly once, no vendor data counted or named. Run with the suite (see
tests/test_rules.py)."""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from sitebuild import registry, volume  # noqa: E402

HERE = Path(__file__).resolve().parents[1]
LINKS = {k for k, e in registry.SOURCES["links"].items() if not e.get("paper")}


def _store(root: Path) -> None:
    """A small store: two tables with a vendor row in links, provenance pointing at hub files of known sizes, and one
    fetch file per external folder in the fetchers' compact JSON."""
    (root / "tables").mkdir(parents=True)
    for p, n in (("bis/bulk/WS_LBS_D_PUB/2026-10-29.zip", 1000), ("imf/BOP/KOR/2026-10-27.xml.gz", 70), ("imf/BOP/USA/2026-10-27.xml.gz", 30),
                 ("ecb/BSI/x.csv.gz", 5)):
        f = root / "hub" / p
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"x" * n)
    con = duckdb.connect()
    t = root / "tables"
    con.execute(f"COPY (SELECT * FROM (VALUES ('bis.LBS'), ('bis.LBS'), ('epfr.fund_flows.equity'), ('epfr.fund_flows.bond'), ('imf.PIP')) v(dataset)) TO '{t / 'links.parquet'}' (FORMAT parquet)")
    con.execute(f"COPY (SELECT * FROM (VALUES ('bis.LBS'), ('ecb.BSI'), ('ecb.BSI')) v(dataset)) TO '{t / 'signals.parquet'}' (FORMAT parquet)")
    con.execute(f"COPY (SELECT * FROM (VALUES ('imf.BOP'), ('imf.BOP'), ('imf.BOP')) v(dataset)) TO '{t / 'border_flows.parquet'}' (FORMAT parquet)")
    con.execute(f"""COPY (SELECT * FROM (VALUES
        ('links', 'bis.LBS', '-', 'bis/bulk/WS_LBS_D_PUB/2026-10-29.zip', '2026-10-30'),
        ('signals', 'bis.LBS', '-', 'bis/bulk/WS_LBS_D_PUB/2026-10-29.zip', '2026-10-30'),
        ('border_flows', 'imf.BOP', 'KOR', 'imf/BOP/KOR/2026-10-27.xml.gz', '2026-10-27'),
        ('border_flows', 'imf.BOP', 'USA', 'imf/BOP/USA/2026-10-27.xml.gz', '2026-10-26'),
        ('links', 'imf.PIP', 'KOR', 'imf/PIP/KOR/gone.xml.gz', '2026-10-27'),
        ('stocks', 'ecb.BSI', 'k', 'ecb/BSI/x.csv.gz', '2026-10-28')) v("table", dataset, key, path, vintage)) TO '{t / 'provenance.parquet'}' (FORMAT parquet)""")
    ext = {"wdi": {"read": "2026-11-01", "series": {"gdp": {"KOR": {"2024": 1.5, "2025": 2.5}, "USA": {"2025": 3.0}}}, "meta": {"gdp": {"id": "NY.GDP.MKTP.CD"}}},
           "quarterly": {"read": "2026-11-01", "bop": {"KOR": {"GS.CD_T.USD": {"indicator": "GS", "scale": "6", "obs": {"2024-Q1": 1.0, "2024-Q2": 2.0}}}},
                         "gdp": {"KOR": {"XDC": {"label": "XDC", "scale": "0", "obs": {"2024-Q1": 9.0}}}},
                         "fx": {"KOR": {"KRW": {"ref_area": "KR", "unit_mult": "0", "obs": {"2024-Q1": 1300.0, "2024-Q2": 1350.0, "2024-Q3": 1340.0}}}}},
           "warning": {"read": "2026-11-02", "weo": {"vintage": "2026-10", "series": {"NGDP": {"KOR": {"2024": 1.0}}}}, "fred": {"KOR": {"id": "IRLTLT01KRM156N", "obs": {"2025-01": 2.9}}}}}
    for name, obj in ext.items():
        d = root / "external" / name
        d.mkdir(parents=True)
        (d / "2026-10-01.json").write_text(json.dumps({"read": "2026-10-01"}, separators=(",", ":")))   # an older file is never read
        (d / "2026-11-01.json").write_text(json.dumps(obj, separators=(",", ":")))


def test_volume_counts_bytes_and_coverage(tmp_path):
    _store(tmp_path)
    vol = volume.measure(tmp_path, now=dt.datetime(2026, 11, 8, 6, 30, tzinfo=dt.timezone.utc))
    assert vol["schema"] == 1 and vol["app"] == "money-flow" and vol["measured_at"] == "2026-11-08T06:30:00Z"
    assert vol["row_is"] == volume.ROW_IS and vol["bytes_are"] == volume.BYTES_ARE
    by = {t["id"]: t for t in vol["tables"]}
    # one entry per table id, rows summed over the tables, a file read by two tables counted once, the newest vintage
    assert by["bis.LBS"] == {"id": "bis.LBS", "publisher": "BIS", "sources": ["bis.lbs", "bis.lbs_adj"], "rows": 3, "bytes": 1000, "vintage": "2026-10-30"}
    assert by["imf.BOP"] == {"id": "imf.BOP", "publisher": "IMF", "sources": ["imf.bop"], "rows": 3, "bytes": 100, "vintage": "2026-10-27"}
    assert by["imf.PIP"]["rows"] == 1 and by["imf.PIP"]["bytes"] is None              # a raw file gone from the hub: unrecorded, not guessed
    assert vol["unlisted"] == ["ecb.BSI"]                                             # rows but no Sources row: out of the totals
    files = {f["source"]: f for f in vol["files"]}
    assert set(files) == set(volume.FILES)
    assert files["wb.wdi"]["rows"] == 3 and files["wb.wdi"]["publisher"] == "World Bank" and files["wb.wdi"]["vintage"] == "2026-11-01"
    assert files["wb.wdi"]["read_from"] == f"{tmp_path}/external/wdi/2026-11-01.json#series"
    assert (files["imf.bop_q"]["rows"], files["imf.qnea"]["rows"], files["bis.xru"]["rows"], files["imf.weo"]["rows"], files["oecd.ltr"]["rows"]) == (2, 1, 3, 1, 1)
    q = (tmp_path / "external" / "quarterly" / "2026-11-01.json").read_bytes()
    assert files["bis.xru"]["bytes"] == len(json.dumps(json.loads(q)["fx"], separators=(",", ":"))) and files["oecd.ltr"]["publisher"] == "OECD"
    miss = {m["source"]: m for m in vol["missing"]}
    assert miss["eu.mip"]["publisher"] == "European Commission" and miss["boc.boe"]["publisher"] == "BoC–BoE"
    assert miss["bis.cbs"]["reason"] == "Its dataset bis.CBS has no rows in the tables."
    assert all(m["reason"] for m in vol["missing"])
    # every Sources link row exactly once (the papers are publications, not data, and are left out)
    seen = [s for t in vol["tables"] for s in t["sources"]] + list(files) + list(miss)
    assert sorted(seen) == sorted(LINKS) and not any(s.startswith("paper.") for s in seen)
    # totals over tables and files only, known bytes only
    assert vol["rows"] == 3 + 3 + 1 + sum(f["rows"] for f in vol["files"])
    assert vol["bytes"] == 1000 + 100 + sum(f["bytes"] for f in vol["files"])
    # the vendor rows in links.parquet are neither counted nor named
    assert "epfr" not in json.dumps(vol).lower() and not volume.VENDOR.search(json.dumps(vol))
    p = volume.write(vol, tmp_path)
    assert p == tmp_path / "site" / "volume.json" and json.loads(p.read_text(encoding="utf-8")) == vol


def test_volume_never_counts_a_vendor_id():
    src = {**registry.SOURCES, "datasets": {**registry.SOURCES["datasets"], "epfr.fund_flows": {"class": "open"}, "x.lseg": {"class": "open"},
                                             "vendor.feed": {"class": "licensed"}}}
    ids = volume.allowed(src)
    assert "bis.LBS" in ids and not [d for d in ids if d in ("epfr.fund_flows", "x.lseg", "vendor.feed")]


def test_volume_check_refuses_gaps_and_vendors():
    links = {"a.x": {}, "b.y": {}}
    ok = {"tables": [{"id": "A", "publisher": "BIS", "sources": ["a.x"]}], "files": [], "missing": [{"source": "b.y", "publisher": "IMF", "reason": "r"}]}
    volume.check(ok, links)
    for bad in ({**ok, "missing": []}, {**ok, "files": [{"source": "a.x", "publisher": "BIS"}]}, {**ok, "unlisted": ["lipper.flows"]},
                {**ok, "tables": [{"id": "A", "publisher": None, "sources": ["a.x"]}]}):
        try:
            volume.check(bad, links)
        except ValueError:
            continue
        raise AssertionError(f"not refused: {bad}")


def test_volume_registry_agrees():
    """FILES names link rows read from the external fetches of config/datasets.yaml, with that fetch's dataset; the
    reasons are for link rows that exist and have no dataset."""
    ext = registry.DATASETS["external"]
    for lid, (folder, _) in volume.FILES.items():
        e = registry.SOURCES["links"][lid]
        assert e["dataset"] in ([ext[folder]["dataset"]] if "dataset" in ext[folder] else ext[folder]["datasets"]), lid
    for lid in volume.REASONS:
        assert lid in LINKS and not registry.SOURCES["links"][lid].get("dataset"), lid


def test_volume_in_the_release_manifest_only():
    """The manifest's datasets gain rows and bytes; the public meta entries they are copied from do not change."""
    meta = {"bis.LBS": {"vintage": "2026-10-30", "newest": "2026-06-30", "freq": "Q", "class": "open"}, "bis.XRU": {"vintage": "2026-11-06"}}
    vol = {"tables": [{"id": "bis.LBS", "rows": 3, "bytes": 1000}]}
    out = volume.with_counts(meta, vol)
    assert out["bis.LBS"] == {**meta["bis.LBS"], "rows": 3, "bytes": 1000} and out["bis.XRU"] == {"vintage": "2026-11-06"}
    assert "rows" not in meta["bis.LBS"] and volume.with_counts(meta, None) == meta
    src = (HERE / "scripts" / "build_site_data.py").read_text(encoding="utf-8")
    assert '"datasets": volume.with_counts(public["meta"]["datasets"], vol)' in src and '**({"volume": vol} if vol else {})' in src
