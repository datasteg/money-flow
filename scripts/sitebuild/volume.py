"""The volume manifest for the www portal's Data chart: how many
observations each publisher's data puts in money-flow's tables, and how many bytes of raw files they come from.

    $MONEY_FLOW_DATA_ROOT/site/volume.json       rewritten by every daily build (build_site_data.py), or alone by
                                            uv run scripts/build_site_data.py --volume   (no views, no checks, no release)

The release manifest carries the same block as `volume`, and its `datasets[<table id>]` gain `rows` and `bytes`.

Rows are the observations in the five tables (stocks, links, totals, border_flows, signals), counted per dataset id
before any publication rule (marks.py, views.py) applies. Bytes are the sizes on disk of the raw files each table was
built from (provenance.parquet: the newest vintage of every key), compressed as the hub stores them (.zip, .gz). The
hub's ledger cannot give them: its `bytes` is the answer's size before the hub gzips it (imf/BOP/ABW/2026-10-27.xml.gz:
8,965,324 in the ledger, 450,954 stored under the ledger's sha256), so the stored file is measured instead.

Every row of the Sources page's link table (config/sources.yaml `links`; the three papers are publications, not data,
and are left out) appears exactly once: in `tables[].sources` under the table of its dataset, in `files` when its
observations are read from an external fetch file (FILES: the observations under one member of the newest file, and
that member's bytes as the file stores it), or in `missing` with the reason. Dataset ids with rows but no link row are
`unlisted` and stay out of the totals.

Licensed vendor data are never counted: only dataset ids in the registry (sources.yaml `datasets`, which lists no vendor
feed, R14) are counted, and ids that look like a vendor's are refused besides. The finished block is checked to name no
vendor.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
from pathlib import Path

import duckdb

from .registry import DATASETS, SOURCES

ROOT = Path(os.environ.get("MONEY_FLOW_DATA_ROOT", "data"))
TABLES = ("stocks", "links", "totals", "border_flows", "signals")       # the observation tables (economies, provenance are not)
VENDOR = re.compile(r"epfr|lipper|lseg|refinitiv|capiq|capital.?iq", re.I)
ROW_IS = "observation in the tables, before the publication rules"
BYTES_ARE = "compressed raw files of the newest vintage, as stored"

# Link rows whose observations come from an external fetch file (config/datasets.yaml `external`), not from the tables:
# link id -> (external folder, the member that holds them). Every value of an `obs` mapping under the member is one
# observation; where a mapping has no `obs`, every number at its leaves is (WDI and WEO: indicator -> economy -> year).
FILES = {
    "wb.wdi": ("wdi", ("series",)),
    "imf.bop_q": ("quarterly", ("bop",)),           # economy -> indicator.entry.unit -> {obs: quarter -> value}
    "imf.qnea": ("quarterly", ("gdp",)),            # economy -> transformation -> {obs}
    "bis.xru": ("quarterly", ("fx",)),              # economy -> currency -> {obs}
    "imf.weo": ("warning", ("weo", "series")),
    "oecd.ltr": ("warning", ("fred",)),             # economy -> {id, obs: month -> value}
}
# Link rows with neither a table nor a file of observations.
REASONS = {
    "imf.lending": "Arrangements are copied by hand into config/sovereign_episodes.yaml; no raw file of observations is stored.",
    "eu.esm": "Programmes are copied by hand into config/sovereign_episodes.yaml; no raw file of observations is stored.",
    "boc.boe": "Default spells are coded by hand into config/sovereign_episodes.yaml; the database's CSV is not stored.",
    "eu.mip": "The scoreboard gives rules R25 and R26 their thresholds; no data are read from it.",
}


def allowed(sources: dict = SOURCES) -> list[str]:
    """The dataset ids that may be counted: the registry's, never a licensed class, never a vendor's id."""
    ids = sorted(ds for ds, e in sources["datasets"].items() if e.get("class") != "licensed" and not VENDOR.search(ds))
    bad = [ds for ds in ids if not re.fullmatch(r"[A-Za-z0-9_.\-]+", ds)]
    if bad:
        raise ValueError(f"dataset ids unfit for a query: {bad}")
    return ids


def _in(ids: list[str]) -> str:
    return ", ".join(f"'{d}'" for d in ids)


def table_rows(con, tables: Path, ids: list[str]) -> dict[str, int]:
    """Dataset id -> observations, summed over the five tables."""
    out: dict[str, int] = {}
    for t in TABLES:
        p = tables / f"{t}.parquet"
        if not p.exists():
            continue
        for ds, n in con.execute(f"SELECT dataset, count(*) FROM read_parquet('{p}') WHERE dataset IN ({_in(ids)}) GROUP BY 1").fetchall():
            out[ds] = out.get(ds, 0) + n
    return out


def raw_files(con, tables: Path, hub: Path, ids: list[str]) -> dict[str, list[tuple[str, int | None, str]]]:
    """Dataset id -> [(raw path, stored bytes or None when the file is gone, vintage)], one line per file however many
    tables read it."""
    out: dict[str, list] = {}
    p = tables / "provenance.parquet"
    if not p.exists():
        return out
    for ds, path, vint in con.execute(f"SELECT dataset, path, max(vintage) FROM read_parquet('{p}') WHERE dataset IN ({_in(ids)}) GROUP BY 1, 2 ORDER BY 1, 2").fetchall():
        f = hub / path
        out.setdefault(ds, []).append((path, f.stat().st_size if f.is_file() else None, str(vint) if vint else None))
    return out


def count_obs(node) -> int:
    if isinstance(node, dict):
        if isinstance(node.get("obs"), dict):
            return sum(1 for v in node["obs"].values() if _num(v))
        return sum(count_obs(v) for v in node.values())
    if isinstance(node, list):
        return sum(count_obs(v) for v in node)
    return 1 if _num(node) else 0


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def newest(folder: Path) -> Path | None:
    """The newest fetch file of a folder, by the same rule as views.newest_external and sovereign.newest_file."""
    files = sorted(folder.glob("*.json"))
    return files[-1] if files else None


def file_entry(lid: str, external: Path) -> tuple[dict | None, str | None]:
    """(the observations of one link row in its fetch file, None) or (None, why there is no count)."""
    folder, member = FILES[lid]
    f = newest(external / folder)
    if not f:
        return None, f"No fetch file in {external / folder}."
    raw = f.read_bytes()
    obj = json.loads(raw)
    node = obj
    for k in member:
        if not isinstance(node, dict) or k not in node:
            return None, f"The newest fetch file {f.name} has no member {'.'.join(member)}."
        node = node[k]
    n = count_obs(node)
    if not n:
        return None, f"The newest fetch file {f.name} has no observations under {'.'.join(member)}."
    blob = json.dumps(node, separators=(",", ":")).encode("utf-8")      # the fetchers write compact JSON, so the member is in the file verbatim
    return {"rows": n, "bytes": len(blob) if blob in raw else None, "vintage": obj.get("read"),
            "read_from": f"{f}#{'.'.join(member)}"}, None


def measure(root: Path = ROOT, sources: dict = SOURCES, now: dt.datetime | None = None) -> dict:
    """The volume block (the module docstring says what each field is)."""
    tables_dir, hub, external = root / "tables", root / "hub", root / "external"
    for lid, (folder, _) in FILES.items():             # the file map agrees with the registry of external fetches
        if folder not in DATASETS["external"]:
            raise ValueError(f"FILES {lid}: {folder} is not in config/datasets.yaml external")
    con = duckdb.connect()
    ids = allowed(sources)
    rows = table_rows(con, tables_dir, ids)
    raw = raw_files(con, tables_dir, hub, ids)
    con.close()
    pubs = sources["publishers"]
    short = lambda p: (pubs.get(p) or {}).get("short") if p else None
    links = {k: e for k, e in (sources.get("links") or {}).items() if not e.get("paper")}

    feeds: dict[str, list[str]] = {}
    files, missing = [], []
    for lid, e in links.items():
        if lid in FILES:
            ent, why = file_entry(lid, external)
            if ent:
                files.append({"source": lid, "publisher": short(e.get("publisher")), **ent})
            else:
                missing.append({"source": lid, "publisher": short(e.get("publisher")), "reason": why})
        elif e.get("dataset") in rows:
            feeds.setdefault(e["dataset"], []).append(lid)
        else:
            why = REASONS.get(lid) or (f"Its dataset {e['dataset']} has no rows in the tables." if e.get("dataset") else "No table or stored file of observations.")
            missing.append({"source": lid, "publisher": short(e.get("publisher")), "reason": why})

    tables, known = [], {}
    for ds in sorted(feeds):
        fs = raw.get(ds, [])
        b = sum(s for _, s, _ in fs) if fs and all(s is not None for _, s, _ in fs) else None
        if b is not None:
            known.update({p: s for p, s, _ in fs})
        who = {links[lid].get("publisher") for lid in feeds[ds]}
        tables.append({"id": ds, "publisher": short(who.pop() if len(who) == 1 else sources["datasets"][ds].get("publisher")),
                       "sources": sorted(feeds[ds]), "rows": rows[ds], "bytes": b, "vintage": max((v for _, _, v in fs if v), default=None)})
    files.sort(key=lambda x: x["source"])
    missing.sort(key=lambda x: x["source"])
    now = now or dt.datetime.now(dt.timezone.utc)
    vol = {"schema": 1, "app": "money-flow", "measured_at": now.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "row_is": ROW_IS, "bytes_are": BYTES_ARE, "tables": tables, "files": files, "missing": missing,
           "unlisted": sorted(ds for ds in rows if ds not in feeds),
           "rows": sum(t["rows"] for t in tables) + sum(f["rows"] for f in files),
           "bytes": sum(known.values()) + sum(f["bytes"] for f in files if f["bytes"] is not None)}
    check(vol, links)
    return vol


def check(vol: dict, links: dict) -> None:
    """Every link row exactly once, every row with a publisher, and no vendor named anywhere."""
    seen = [s for t in vol["tables"] for s in t["sources"]] + [f["source"] for f in vol["files"]] + [m["source"] for m in vol["missing"]]
    if sorted(seen) != sorted(links):
        extra = sorted({s for s in seen if seen.count(s) > 1} | (set(seen) - set(links)))
        raise ValueError(f"volume: the link rows do not appear exactly once (repeated or unknown {extra}, absent {sorted(set(links) - set(seen))})")
    nopub = [x.get("id") or x.get("source") for x in vol["tables"] + vol["files"] + vol["missing"] if not x.get("publisher")]
    if nopub:
        raise ValueError(f"volume: no publisher for {nopub}")
    if m := VENDOR.search(json.dumps(vol)):
        raise ValueError(f"volume: names a vendor ({m.group(0)})")


def with_counts(datasets: dict, vol: dict | None) -> dict:
    """The release manifest's `datasets`, each table's entry with its rows and bytes added. A copy: the public `meta`
    file the same entries come from is left as it is."""
    by = {t["id"]: t for t in (vol or {}).get("tables", [])}
    return {ds: ({**e, "rows": by[ds]["rows"], "bytes": by[ds]["bytes"]} if ds in by else dict(e)) for ds, e in datasets.items()}


def write(vol: dict, root: Path = ROOT) -> Path:
    p = root / "site" / "volume.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(".volume.json.tmp")
    tmp.write_text(json.dumps(vol, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.rename(p)
    return p
