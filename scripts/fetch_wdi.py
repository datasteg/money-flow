#!/usr/bin/env python3
"""Fetch the World Bank WDI series behind the earnings view (earn/global) into a dated file in money-flow's external store.

    python3 scripts/fetch_wdi.py            # writes $MONEY_FLOW_DATA_ROOT/external/wdi/<YYYY-MM-DD>.json

Moved from global-network on 2 Nov 2026 (global-network collects nothing, rule G18); the file's
shape is unchanged, so the earn/global view carries it as it is and global-network reads it from the release.

Series (World Development Indicators, licence CC BY 4.0; the two balance-of-payments lines are the IMF's Balance of
Payments statistics as the World Bank republishes them):
  BN.GSR.GNFS.CD  Net trade in goods and services (BoP, current US$)
  BN.GSR.FCTY.CD  Net primary income (BoP, current US$)
  NY.GDP.MKTP.CD  GDP (current US$)
  NY.GDP.PCAP.CD  GDP per capita (current US$)
  BX.GSR.GNFS.CD  Exports of goods and services (BoP, current US$)   the Trade scale lens and the side panel's scale block
  BM.GSR.GNFS.CD  Imports of goods and services (BoP, current US$)   (on the same BoP basis as BN.GSR.GNFS.CD, so x - m = net)
  NE.EXP.GNFS.ZS  Exports of goods and services (% of GDP)           national-accounts basis: a cross-check only, printed by
  NE.IMP.GNFS.ZS  Imports of goods and services (% of GDP)           build.py, never drawn

The site build (scripts/build_site_data.py, views.earn) reads the newest file here and never calls the API, so a build
works offline; the registry entry is config/datasets.yaml `external.wdi` and config/sources.yaml `wb.WDI` (CC BY 4.0).
Economies: money-flow's 36 Signal Board economies (R19; config/sovereign.yaml `economies`) and the US hub. Years 2000 to
the current year (WDI simply has no value for the newest ones). Only the standard library is used.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(os.environ.get("MONEY_FLOW_DATA_ROOT", "data"))
STORE = ROOT / "external" / "wdi"
SERIES = {
    "BN.GSR.GNFS.CD": "gs",
    "BN.GSR.FCTY.CD": "pi",
    "NY.GDP.MKTP.CD": "gdp",
    "NY.GDP.PCAP.CD": "gdp_pc",
    "BX.GSR.GNFS.CD": "x",
    "BM.GSR.GNFS.CD": "m",
    "NE.EXP.GNFS.ZS": "ne_x",
    "NE.IMP.GNFS.ZS": "ne_m",
}
ECONOMIES = ["ARG", "AUS", "AUT", "BEL", "BRA", "CAN", "CHL", "CHN", "COL", "CZE", "DEU", "DNK", "ESP", "FIN", "FRA", "GBR",
             "GRC", "HUN", "IDN", "IND", "ISR", "ITA", "JPN", "KOR", "MEX", "MYS", "NOR", "NZL", "POL", "PRT", "RUS", "SAU",
             "SWE", "THA", "TUR", "ZAF", "USA"]
API = "https://api.worldbank.org/v2/country/{c}/indicator/{i}?format=json&date={a}:{b}&per_page=5000"


def get(url: str, tries: int = 4) -> list:
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "datasteg-money-flow"}), timeout=90) as r:
                body = json.loads(r.read())
            if not isinstance(body, list) or len(body) < 2:
                raise ValueError(f"unexpected reply: {str(body)[:200]}")
            return body
        except Exception as e:  # network or a WDI hiccup: back off and retry
            if k == tries - 1:
                raise
            print(f"  retry {k + 1} after {e}", file=sys.stderr)
            time.sleep(5 * (k + 1))
    return []


def main() -> None:
    today = dt.date.today()
    out = {"read": today.isoformat(), "source": "World Bank, World Development Indicators (api.worldbank.org v2)",
           "licence": "CC BY 4.0", "series": {}, "meta": {}}
    for ind, key in SERIES.items():
        body = get(API.format(c=";".join(ECONOMIES), i=ind, a=2000, b=today.year))
        head, rows = body[0], body[1] or []
        vals: dict[str, dict[str, float]] = {}
        for r in rows:
            if r.get("value") is None:
                continue
            vals.setdefault(r["countryiso3code"], {})[r["date"]] = r["value"]
        out["series"][key] = vals
        out["meta"][key] = {"id": ind, "name": rows[0]["indicator"]["value"] if rows else ind, "lastupdated": head.get("lastupdated")}
        n = sum(len(v) for v in vals.values())
        print(f"  {ind}: {len(vals)} economies, {n} values, WDI updated {head.get('lastupdated')}")
        missing = [e for e in ECONOMIES if e not in vals]
        if missing:
            print(f"  {ind}: no values for {missing}", file=sys.stderr)
    STORE.mkdir(parents=True, exist_ok=True)
    path = STORE / f"{today.isoformat()}.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
