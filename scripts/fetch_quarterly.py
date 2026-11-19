#!/usr/bin/env python3
"""Fetch the quarterly series behind the earnings view (earn/global, quarterly part) into a dated file in money-flow's
external store.

    python3 scripts/fetch_quarterly.py      # writes $MONEY_FLOW_DATA_ROOT/external/quarterly/<YYYY-MM-DD>.json

Moved from global-network on 2 Nov 2026; the file's shape is unchanged.

Series, from 2004 Q1 (a year before the chart's first quarter, so the first rolling four-quarter sum is complete):
  IMF.STA,BOP    Balance of payments, quarterly (IMF SDMX 2.1 API, api.imf.org). Key COUNTRY.BOP_ACCOUNTING_ENTRY.INDICATOR.
                 UNIT.FREQUENCY with entries CD_T (credit) and DB_T (debit), indicators GS (goods and services) and IN1
                 (primary income), every UNIT the IMF publishes (USD, EUR, XDC); all are kept, the build picks one per
                 economy and series by checking it against WDI.
  IMF.STA,QNEA   Quarterly national accounts: B1GQ (GDP), PRICE_TYPE V (current prices), S_ADJUSTMENT NSA, FREQUENCY Q,
                 every TYPE_OF_TRANSFORMATION published. The values are domestic currency (checked against WDI in the build).
  BIS WS_XRU     US dollar exchange rates, quarterly averages (FREQ Q, COLLECTION A), domestic currency per USD, read from
                 the newest BIS bulk file in money-flow's own mirror of the collector's files
                 ($MONEY_FLOW_DATA_ROOT/hub/bis/bulk/WS_XRU/<date>.zip); the zip date is the vintage. Euro members appear under their own REF_AREA with currency EUR.

OBS_VALUE is stored as the API delivers it. The IMF series attribute SCALE (6 on BOP, 0 on QNEA) describes how the
IMF displays the series; the delivered OBS_VALUE is already in units (Korea's 2024 Q1 goods-and-services credit is
200,367,600,000 with SCALE 6, i.e. USD 200 bn), so applying SCALE again would overstate it a million times. The build's
check against WDI's annual dollar series confirms the magnitude for every economy.

The site build (scripts/build_site_data.py, views.earn) reads the newest file here and never calls an API, so a build
works offline; check V23 compares the four-quarter sums with WDI's annual figures. Registry: config/datasets.yaml
`external.quarterly`, config/sources.yaml `imf.BOP`, `imf.QNEA`, `bis.XRU`. Economies: the same 37 as
scripts/fetch_wdi.py (money-flow's 36 Signal Board economies and the US hub). Only the standard library is used.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import os
import sys
import time
import urllib.request
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from fetch_wdi import ECONOMIES

ROOT = Path(os.environ.get("MONEY_FLOW_DATA_ROOT", "data"))
STORE = ROOT / "external" / "quarterly"
XRU_DIR = Path(os.environ.get("XRU_DIR", str(ROOT / "hub" / "bis" / "bulk" / "WS_XRU")))   # money-flow's own mirror of the BIS bulk file
START = "2004-Q1"
API = "https://api.imf.org/external/sdmx/2.1/data/{flow}/{key}?startPeriod={start}"
BOP_KEY = "{c}.CD_T+DB_T.GS+IN1..Q"
QNEA_KEY = "{c}.B1GQ.V.NSA..Q"
ISO2 = {"ARG": "AR", "AUS": "AU", "AUT": "AT", "BEL": "BE", "BRA": "BR", "CAN": "CA", "CHL": "CL", "CHN": "CN", "COL": "CO",
        "CZE": "CZ", "DEU": "DE", "DNK": "DK", "ESP": "ES", "FIN": "FI", "FRA": "FR", "GBR": "GB", "GRC": "GR", "HUN": "HU",
        "IDN": "ID", "IND": "IN", "ISR": "IL", "ITA": "IT", "JPN": "JP", "KOR": "KR", "MEX": "MX", "MYS": "MY", "NOR": "NO",
        "NZL": "NZ", "POL": "PL", "PRT": "PT", "RUS": "RU", "SAU": "SA", "SWE": "SE", "THA": "TH", "TUR": "TR", "ZAF": "ZA",
        "USA": "US", "XM": "XM"}


def get(url: str, tries: int = 4) -> bytes:
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "datasteg-money-flow", "Accept": "application/xml"})
            with urllib.request.urlopen(req, timeout=180) as r:
                body = r.read()
            if b"StructureSpecificData" not in body[:2000]:
                raise ValueError(f"unexpected reply: {body[:200]!r}")
            return body
        except Exception as e:  # network or an API hiccup: back off and retry
            if k == tries - 1:
                raise
            print(f"  retry {k + 1} after {e}", file=sys.stderr)
            time.sleep(5 * (k + 1))
    return b""


def sdmx(body: bytes) -> tuple[dict, list[dict]]:
    """(dataset attributes plus structure ref, [{attrs, obs}]) from an SDMX 2.1 structure-specific data message."""
    root = ET.fromstring(body)
    head: dict = {}
    series = []
    for el in root.iter():
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "Ref" and "id" in el.attrib and "structure" not in head:
            head["structure"] = f"{el.attrib.get('agencyID')}:{el.attrib['id']}({el.attrib.get('version')})"
        elif tag == "DataSet":
            for k in ("UPDATE_DATE", "PUBLICATION_DATE", "SUGGESTED_CITATION", "SHORT_SOURCE_CITATION", "LICENSE"):
                if k in el.attrib:
                    head[k.lower()] = el.attrib[k]
        elif tag == "Series":
            obs = {}
            for o in el:
                p, v = o.attrib.get("TIME_PERIOD"), o.attrib.get("OBS_VALUE")
                if p and v not in (None, "", "NaN"):
                    obs[p] = float(v)
            series.append({"attrs": dict(el.attrib), "obs": obs})
    return head, series


def fetch_flow(flow: str, key: str) -> tuple[dict, list[dict], list[str]]:
    """All economies in one request (the API accepts '+'); one request per economy if the batch fails."""
    url = API.format(flow=flow, key=key.format(c="+".join(ECONOMIES)), start=START)
    try:
        head, series = sdmx(get(url))
        return head, series, [url]
    except Exception as e:
        print(f"  {flow}: batch request failed ({e}); one request per economy", file=sys.stderr)
    head, series, urls = {}, [], []
    for c in ECONOMIES:
        u = API.format(flow=flow, key=key.format(c=c), start=START)
        try:
            h, s = sdmx(get(u))
        except Exception as e2:
            print(f"  {flow} {c}: {e2}", file=sys.stderr)
            continue
        head = head or h
        series += s
        urls.append(u)
    return head, series, urls


def last(obs: dict) -> str | None:
    return max(obs) if obs else None


def read_xru() -> tuple[dict, dict]:
    zips = sorted(XRU_DIR.glob("*.zip"))
    if not zips:
        sys.exit(f"no BIS XRU bulk file in {XRU_DIR}: mirror the collector's files first")
    path = zips[-1]
    want = {v: k for k, v in ISO2.items()}
    fx: dict[str, dict] = {}
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.endswith(".csv"))
        with z.open(name) as raw:
            f = io.TextIOWrapper(raw, encoding="utf-8", newline="")
            header = next(csv.reader([f.readline()]))
            col = {h.split(":", 1)[0]: i for i, h in enumerate(header)}
            iF, iR, iC, iK, iT, iV, iM = (col[k] for k in ("FREQ", "REF_AREA", "CURRENCY", "COLLECTION", "TIME_PERIOD", "OBS_VALUE", "UNIT_MULT"))
            for line in f:
                if ",Q: " not in line[:160]:  # cheap prefilter before the csv parse
                    continue
                r = next(csv.reader([line]))
                if not r[iF].startswith("Q:") or not r[iK].startswith("A:"):
                    continue
                area = r[iR].split(":", 1)[0]
                if area not in want or r[iV] == "" or r[iT] < START:
                    continue
                e = want[area]
                cur = r[iC].split(":", 1)[0]
                s = fx.setdefault(e, {}).setdefault(cur, {"ref_area": area, "currency": cur, "unit_mult": r[iM].split(":", 1)[0], "obs": {}})
                s["obs"][r[iT]] = float(r[iV]) * 10 ** int(s["unit_mult"] or 0)
    meta = {"id": "BIS:WS_XRU(1.0)", "name": "US dollar exchange rates", "file": str(path), "vintage": path.stem,
            "filter": "FREQ=Q, COLLECTION=A (average of period), domestic currency per US dollar", "member": name}
    return fx, meta


def main() -> None:
    today = dt.date.today()
    out = {"read": today.isoformat(), "from": START, "economies": ECONOMIES, "sources": {}, "bop": {}, "gdp": {}, "fx": {},
           "empty": {"bop": {}, "gdp": {}}, "last": {"bop": {}, "gdp": {}, "fx": {}}, "missing": {}}

    head, series, urls = fetch_flow("IMF.STA,BOP", BOP_KEY)
    out["sources"]["bop"] = {"id": "IMF.STA:BOP", "structure": head.get("structure"), "name": "Balance of Payments (BOP)",
                             "urls": urls, **{k: head.get(k) for k in ("update_date", "publication_date", "suggested_citation", "license")}}
    for s in series:
        a = s["attrs"]
        e, k = a["COUNTRY"], f"{a['INDICATOR']}.{a['BOP_ACCOUNTING_ENTRY']}.{a['UNIT']}"
        if not s["obs"]:
            out["empty"]["bop"].setdefault(e, []).append(k)
            continue
        out["bop"].setdefault(e, {})[k] = {"indicator": a["INDICATOR"], "entry": a["BOP_ACCOUNTING_ENTRY"], "unit": a["UNIT"],
                                           "scale": a.get("SCALE"), "obs": s["obs"]}
        out["last"]["bop"].setdefault(e, {})[k] = last(s["obs"])
    n = sum(len(v) for v in out["bop"].values())
    print(f"  IMF BOP: {len(out['bop'])} economies, {n} series with values, "
          f"{sum(len(v) for v in out['empty']['bop'].values())} empty, published {head.get('publication_date')}")

    head, series, urls = fetch_flow("IMF.STA,QNEA", QNEA_KEY)
    out["sources"]["qnea"] = {"id": "IMF.STA:QNEA", "structure": head.get("structure"), "name": "Quarterly National Economic Accounts (QNEA)",
                              "urls": urls, **{k: head.get(k) for k in ("update_date", "publication_date", "suggested_citation", "license")}}
    for s in series:
        a = s["attrs"]
        e, k = a["COUNTRY"], a["TYPE_OF_TRANSFORMATION"]
        if not s["obs"]:
            out["empty"]["gdp"].setdefault(e, []).append(k)
            continue
        out["gdp"].setdefault(e, {})[k] = {"label": k, "scale": a.get("SCALE"), "obs": s["obs"]}
        out["last"]["gdp"].setdefault(e, {})[k] = last(s["obs"])
    print(f"  IMF QNEA: {len(out['gdp'])} economies with values, labels {sorted({k for v in out['gdp'].values() for k in v})}, "
          f"published {head.get('publication_date')}")

    fx, meta = read_xru()
    out["sources"]["xru"] = meta
    for e, curs in fx.items():
        if len(curs) > 1:
            print(f"  XRU {e}: several currencies {sorted(curs)}", file=sys.stderr)
        out["fx"][e] = curs
        out["last"]["fx"][e] = {c: last(v["obs"]) for c, v in curs.items()}
    print(f"  BIS XRU {meta['vintage']}: {len(fx)} areas, currencies "
          f"{', '.join(f'{e}:{c}' for e in sorted(fx) for c in fx[e])}")

    out["missing"] = {"bop": [e for e in ECONOMIES if e not in out["bop"]], "gdp": [e for e in ECONOMIES if e not in out["gdp"]],
                      "fx": [e for e in ECONOMIES if e not in out["fx"]]}
    for k, v in out["missing"].items():
        if v:
            print(f"  no {k} values for {v}", file=sys.stderr)
    STORE.mkdir(parents=True, exist_ok=True)
    path = STORE / f"{today.isoformat()}.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {path} ({path.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
