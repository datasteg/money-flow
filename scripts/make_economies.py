# /// script
# requires-python = ">=3.11"
# dependencies = ["pycountry==24.6.1", "brotli==1.1.0"]
# ///
"""config/economies.csv: the concordance of economy codes money-flow uses (table `economies`).

    uv run scripts/make_economies.py            # rewrites config/economies.csv

One row per economy: the key `code` (ISO 3166 alpha-3), the codes each source uses (ISO alpha-2 for BIS, alpha-3 for the
IMF, M49 for Comtrade and trade-flow), the English and Korean short names, region and subregion and coordinates
as trade-flow has them (its data/meta.json, built from its config/names.yaml), and the date an economy joined the
euro area. The euro area itself is one more row, `EMU` (BIS XM and 5C, ECB U2, IMF G163), because it has one central
bank and one money. BIS and IMF aggregates (all countries, emerging markets, offshore centres) are not listed here:
build_tables.py adds them from the data with the source's own label and is_aggregate set.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

import brotli
import pycountry

HERE = Path(__file__).resolve().parent.parent
TF_META = HERE.parent / "trade-flow" / "data" / "meta.json.br"
OUT = HERE / "config" / "economies.csv"

# euro adoption (the euro area's membership), from the ECB's list of euro area countries
EURO_FROM = {"AUT": "1999-01-01", "BEL": "1999-01-01", "DEU": "1999-01-01", "ESP": "1999-01-01", "FIN": "1999-01-01", "FRA": "1999-01-01",
             "IRL": "1999-01-01", "ITA": "1999-01-01", "LUX": "1999-01-01", "NLD": "1999-01-01", "PRT": "1999-01-01", "GRC": "2001-01-01",
             "SVN": "2007-01-01", "CYP": "2008-01-01", "MLT": "2008-01-01", "SVK": "2009-01-01", "EST": "2011-01-01", "LVA": "2014-01-01",
             "LTU": "2015-01-01", "HRV": "2023-01-01", "BGR": "2026-01-01"}
IMF_CODE = {"PSE": "WBG"}                                       # the IMF's own code where it is not the ISO alpha-3 (West Bank and Gaza)
# IMF currency-union aggregates that report monetary statistics as one economy (IMF codelist CL_COUNTRY 1.6.0): listed so
# that they carry a name and the aggregate flag from the start, never a currency (R1, R11)
IMF_AGGREGATES = [("IMF:G309", "G309", "Eastern Caribbean Currency Union", "동카리브 통화동맹", "Americas", "Caribbean"),
                  ("IMF:G759", "G759", "West African Economic and Monetary Union", "서아프리카 경제통화동맹", "Africa", "Western Africa")]
COLUMNS =("code", "iso2", "m49", "imf", "bis", "name_en", "name_ko", "region", "subregion", "lat", "lon", "is_aggregate", "euro_area_from")


def main() -> None:
    gn = {n["id"]: n for n in json.loads(brotli.decompress(TF_META.read_bytes()))["nodes"]} if TF_META.exists() else {}
    rows = []
    for c in sorted(pycountry.countries, key=lambda c: c.alpha_3):
        n = gn.get(c.alpha_3, {})
        rows.append({"code": c.alpha_3, "iso2": c.alpha_2, "m49": c.numeric, "imf": IMF_CODE.get(c.alpha_3, c.alpha_3), "bis": c.alpha_2,
                     "name_en": n.get("en") or getattr(c, "common_name", None) or c.name, "name_ko": n.get("ko") or "",
                     "region": n.get("region") or "", "subregion": n.get("subregion") or "",
                     "lat": n.get("lat") if n.get("lat") is not None else "", "lon": n.get("lon") if n.get("lon") is not None else "",
                     "is_aggregate": 0, "euro_area_from": EURO_FROM.get(c.alpha_3, "")})
    rows.append({"code": "XKX", "iso2": "XK", "m49": "", "imf": "KOS", "bis": "XK", "name_en": "Kosovo", "name_ko": "코소보",
                 "region": "Europe", "subregion": "Southern Europe", "lat": 42.6, "lon": 20.9, "is_aggregate": 0, "euro_area_from": ""})
    rows.append({"code": "EMU", "iso2": "XM", "m49": "", "imf": "G163", "bis": "XM", "name_en": "Euro area", "name_ko": "유로 지역",
                 "region": "Europe", "subregion": "", "lat": 50.1, "lon": 8.7, "is_aggregate": 0, "euro_area_from": ""})
    for code, imf, en, ko, region, sub in IMF_AGGREGATES:
        rows.append({"code": code, "iso2": "", "m49": "", "imf": imf, "bis": "", "name_en": en, "name_ko": ko, "region": region, "subregion": sub,
                     "lat": "", "lon": "", "is_aggregate": 1, "euro_area_from": ""})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)
    named = sum(1 for r in rows if r["name_ko"])
    print(f"{OUT}: {len(rows)} economies, {named} with trade-flow's names and regions")


if __name__ == "__main__":
    main()
