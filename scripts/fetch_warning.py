#!/usr/bin/env python3
"""Fetch the series behind the Sovereign section (sovereign/global, rules R22–R28) into a dated file in money-flow's
external store.

    uv run -q --with pyyaml==6.0.3 scripts/fetch_warning.py      # writes $MONEY_FLOW_DATA_ROOT/external/warning/<YYYY-MM-DD>.json

Moved from global-network on 2 Nov 2026; the file's shape is unchanged.
Series (all open; no commercial data, R14):
  IMF World Economic Outlook (WEO), SDMX 2.1 API (api.imf.org, flow IMF.RES,WEO), annual, latest vintage:
    GGXWDG_NGDP   general government gross debt, % of GDP                         R22, R24
    GGXCNL_NGDP   general government net lending (+) / borrowing (-), % of GDP     R23, R24
    GGXONLB_NGDP  general government primary net lending / borrowing, % of GDP     R24
    NGDP          GDP, current prices, national currency                           R24 (growth, interest in levels)
    NGDPD         GDP, current prices, US dollars                                  R26 before the Signal Board's history
    BCA_NGDPD     current account balance, % of GDP                                R25 before the Signal Board's history, projections
  IMF International Investment Position (IIP), flow IMF.STA,IIP: total assets and liabilities (A_P, L_P), US dollars,
    annual and quarterly. R26 for the years before the Signal Board starts (2005-06); the board's own net IIP is used
    where it exists (scripts/sitebuild/sovereign.py).
  OECD long-term interest rates (10-year government bond yields, monthly averages) via FRED: IRLTLT01{iso2}M156N,
    fredgraph.csv (no key, fetched with curl). R28. Public domain, citation requested.

Economies and two-letter codes come from config/sovereign.yaml. The site build (scripts/sitebuild/sovereign.py, called
by build_site_data.py) reads the newest file here and never calls an API, so a build works offline. Run it when the WEO
updates (April and October) or monthly for the yields. Version 2 will add
archived WEO vintages beside `weo` (see `vintage` in the config). Registry: config/datasets.yaml `external.warning`,
config/sources.yaml `imf.WEO`, `imf.IIP`, `fred.observations` (key IRLTLT01). Standard library plus PyYAML.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import os
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent.parent
ROOT = Path(os.environ.get("MONEY_FLOW_DATA_ROOT", "data"))
STORE = ROOT / "external" / "warning"
CFG = yaml.safe_load((HERE / "config" / "sovereign.yaml").read_text(encoding="utf-8"))
WEO_IND = ["GGXWDG_NGDP", "GGXCNL_NGDP", "GGXONLB_NGDP", "NGDP", "NGDPD", "BCA_NGDPD"]
IMF = "https://api.imf.org/external/sdmx/2.1/data/{flow}/{key}?startPeriod={start}"
FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={id}"
UA = {"User-Agent": "datasteg-money-flow"}


def get(url: str, accept: str = "application/xml", tries: int = 4, check=None, timeout: int = 180) -> bytes:
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={**UA, "Accept": accept}), timeout=timeout) as r:
                body = r.read()
            if check and not check(body):
                raise ValueError(f"unexpected reply: {body[:200]!r}")
            return body
        except Exception as e:  # network or an API hiccup: back off and retry
            if k == tries - 1:
                raise
            print(f"  retry {k + 1} after {e}", file=sys.stderr)
            time.sleep(5 * (k + 1))
    return b""


def sdmx(body: bytes) -> tuple[dict, list[dict]]:
    """(dataset attributes, [{attrs, obs}]) from an SDMX 2.1 structure-specific data message."""
    root = ET.fromstring(body)
    head: dict = {}
    series = []
    for el in root.iter():
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "DataSet":
            for k in ("UPDATE_DATE", "PUBLICATION_DATE", "SUGGESTED_CITATION", "LICENSE"):
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


def is_sdmx(b: bytes) -> bool:
    return b"StructureSpecificData" in b[:2000]


def fetch_weo(codes: list[str], start: int) -> dict:
    head, series = {}, []
    for ind in WEO_IND:  # one request per indicator: the batch of all six times out
        url = IMF.format(flow="IMF.RES,WEO", key=f"{'+'.join(codes)}.{ind}.A", start=start)
        h, s = sdmx(get(url, check=is_sdmx))
        head = head or h
        series += s
        print(f"  WEO {ind}: {len(s)} series", flush=True)
    url = IMF.format(flow="IMF.RES,WEO", key=f"{'+'.join(codes)}.{{indicator}}.A", start=start)
    out: dict[str, dict[str, dict[str, float]]] = {i: {} for i in WEO_IND}
    upd: dict[str, str] = {}
    for s in series:
        a = s["attrs"]
        out[a["INDICATOR"]][a["COUNTRY"]] = {p: round(v, 6) if a["INDICATOR"] not in ("NGDP", "NGDPD") else v for p, v in s["obs"].items()}
        if a.get("COUNTRY_UPDATE_DATE"):
            upd[a["COUNTRY"]] = a["COUNTRY_UPDATE_DATE"]
    for i in WEO_IND:
        miss = [c for c in codes if c not in out[i]]
        print(f"  WEO {i}: {len(out[i])} economies{', none for ' + ' '.join(miss) if miss else ''}")
    pub = head.get("publication_date", "")[:10]
    return {"flow": "IMF.RES:WEO", "url": url, "published": pub, "updated": head.get("update_date", "")[:10],
            "vintage": pub[:7], "citation": head.get("suggested_citation"), "country_update": upd, "series": out}


def fetch_iip(codes: list[str], start: int) -> dict:
    url = IMF.format(flow="IMF.STA,IIP", key=f"{'+'.join(codes)}.A_P+L_P.IIP.USD.A+Q", start=start)
    head, series = sdmx(get(url, check=is_sdmx))
    out: dict[str, dict] = {"A": {}, "Q": {}}
    for s in series:
        a = s["attrs"]
        side = 0 if a["BOP_ACCOUNTING_ENTRY"] == "A_P" else 1
        d = out[a["FREQUENCY"]].setdefault(a["COUNTRY"], {})
        for p, v in s["obs"].items():
            d.setdefault(p, [None, None])[side] = round(v / 1e9, 3)
    have = sorted(set(out["A"]) | set(out["Q"]))
    print(f"  IIP: {len(have)} economies (annual {len(out['A'])}, quarterly {len(out['Q'])})")
    return {"flow": "IMF.STA:IIP", "url": url, "updated": head.get("update_date", "")[:10], "unit": "USD bn", **out}


def fetch_fred(iso2: dict[str, str]) -> dict:
    out = {}
    for eco, c in iso2.items():
        sid = f"IRLTLT01{c}M156N"
        try:  # curl with a wall-clock limit: urllib's socket timeout never fires when FRED trickles a reply
            body = b""
            for k in range(4):
                r = subprocess.run(["curl", "-sS", "-L", "--http1.1", "--max-time", "40", FRED.format(id=sid)], capture_output=True)
                if r.returncode == 0:
                    body = r.stdout
                    break
                print(f"  FRED {sid}: retry {k + 1} ({r.stderr.decode().strip()[:80]})", file=sys.stderr)
                time.sleep(5 * (k + 1))
            else:
                raise RuntimeError("no reply")
        except Exception as e:
            print(f"  FRED {sid}: {e}", file=sys.stderr)
            continue
        txt = body.decode("utf-8", "replace")
        if not txt.startswith("observation_date") and not txt.startswith("DATE"):
            print(f"  FRED {sid}: no series")
            continue
        obs = {}
        for row in list(csv.reader(io.StringIO(txt)))[1:]:
            if len(row) == 2 and row[1] not in ("", "."):
                obs[row[0][:7]] = round(float(row[1]), 4)
        if obs:
            ks = sorted(obs)
            out[eco] = {"id": sid, "obs": obs}
            print(f"  FRED {sid}: {ks[0]} to {ks[-1]}, {len(ks)} months")
        time.sleep(0.5)
    return out


def main() -> None:
    today = dt.date.today()
    codes = list(dict.fromkeys(CFG["economies"] + [CFG["benchmark"]["eu"], CFG["benchmark"]["other"]]))
    start = CFG["from"] - 4  # R3 and R4 need earlier years (debt the year before, a 3-year average)
    iso2 = {e: CFG["fred_iso2"][e] for e in codes if e in CFG["fred_iso2"]}
    out = {"read": today.isoformat(), "economies": codes,
           "weo": fetch_weo(codes, start), "iip": fetch_iip(codes, start), "fred": fetch_fred(iso2),
           "licences": {"weo": "IMF terms of use (open, with attribution)", "iip": "IMF terms of use (open, with attribution)",
                        "fred": "OECD Main Economic Indicators via FRED: public domain, citation requested"}}
    STORE.mkdir(parents=True, exist_ok=True)
    path = STORE / f"{today.isoformat()}.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {path} (WEO vintage {out['weo']['vintage']}, published {out['weo']['published']})")


if __name__ == "__main__":
    main()
