# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb==1.5.6", "pyarrow==21.0.0", "pyyaml==6.0.3"]
# ///
"""The five tables of money-flow, from the local mirror of the collector's statistics files.

    uv run scripts/build_tables.py               # $MONEY_FLOW_DATA_ROOT/tables/{economies,stocks,links,totals,provenance}.parquet
    uv run scripts/build_tables.py --only stocks # one table (economies is always rebuilt: the others need it)

The tables: economies, stocks, links, totals, border_flows (IMF BOP financial account transactions), signals (the
borrower-side slices of the World page's Signal Board, method 1.2) and provenance.

Reads, for every dataset key, its newest vintage as the collector's ledger names it (a line with a path and `changed`), and
nothing else; config/datasets.yaml says which slices of each file are taken and what each becomes. Every row carries
the dataset, the vintage date and the raw file it came from, and `provenance` lists every raw file used with its
sha256. IMF observations are in units whatever their SCALE attribute says (checked against Korea's reserves and M2).
Values are in USD billions (`value_usd`, `position_usd`, `flow_usd`); `value_lcu` keeps the source's own
currency, in billions. Conversion uses BIS US dollar exchange rates (bis.XRU): the end-of-period rate for a stock at a
date, the period-average rate for a series that is itself a period average (R1). The tables are rebuilt in
full each time: the same mirror gives the same tables. Rows that repeat exactly (the same key and value from the same
file) are written once (R12); how many were dropped is written to tables/effects.json.

BIS bulk files are unzipped once per file into the work folder ($MONEY_FLOW_DATA_ROOT/work/bis/<sha8>/, LBS is about
18 GB of CSV) and read with DuckDB; --clean removes the unzipped copies after the build.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import json
import os
import re
import shutil
import time
import zipfile
from collections import defaultdict
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import yaml

HERE = Path(__file__).resolve().parent.parent
ROOT = Path(os.environ.get("MONEY_FLOW_DATA_ROOT", "data"))
HUB, TABLES, WORK = ROOT / "hub", ROOT / "tables", ROOT / "work"
LEDGERS = ("bis", "imf", "fred", "ecb", "ecos", "tic", "crypto")
EFFECTS: dict[str, dict] = {}                                   # rule id -> what it did in this build (the Method page shows it)
SOURCE_RANK = {"fred": 0, "ecb": 0, "ecos": 0, "bis": 1, "imf": 2, "llama": 3}   # national source for its own economy first


def log(msg: str) -> None:
    print(f"{dt.datetime.now().strftime('%H:%M:%S')} {msg}", flush=True)


# ---------------------------------------------------------------------- the newest vintage of every key
def newest_vintages() -> dict[tuple[str, str], dict]:
    """(dataset, key) -> the ledger line of its newest stored vintage (the last line with a path for which the content
    changed). A key whose last answers were duplicates keeps the vintage those answers matched."""
    out: dict[tuple[str, str], dict] = {}
    for src in LEDGERS:
        for f in sorted((HUB / "_ledger" / src).glob("*.jsonl")):
            for line in f.open(encoding="utf-8"):
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                if r.get("dataset") and r.get("key") and r.get("path") and r.get("changed"):
                    k = (r["dataset"], r["key"])
                    if k not in out or r["ts"] >= out[k]["ts"]:
                        out[k] = r
    return out


def raw_path(rec: dict) -> Path:
    return HUB / rec["path"]


def read_raw(rec: dict) -> bytes:
    p = raw_path(rec)
    b = p.read_bytes()
    return gzip.decompress(b) if p.suffix == ".gz" else b


# ---------------------------------------------------------------------- economies
class Economies:
    """The concordance (config/economies.csv) plus the aggregates found in the data, with the source's label."""

    def __init__(self):
        self.rows: dict[str, dict] = {}
        self.by_bis: dict[str, str] = {}
        self.by_imf: dict[str, str] = {}
        with open(HERE / "config" / "economies.csv", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                self.rows[r["code"]] = r
                if r["bis"]:
                    self.by_bis[r["bis"]] = r["code"]
                if r["imf"]:
                    self.by_imf[r["imf"]] = r["code"]
        for alias in ("5C", "U2"):                         # the euro area in GLI's borrowers and in ECB keys
            self.by_bis[alias] = "EMU"
        self.by_imf["U2"] = "EMU"

    def _aggregate(self, code: str, label: str) -> str:
        if code not in self.rows:
            self.rows[code] = {"code": code, "iso2": "", "m49": "", "imf": code[4:] if code.startswith("IMF:") else "",
                               "bis": code[4:] if code.startswith("BIS:") else "", "name_en": label or code, "name_ko": "",
                               "region": "", "subregion": "", "lat": "", "lon": "", "is_aggregate": "1", "euro_area_from": ""}
        return code

    def bis(self, cell: str | None) -> str | None:
        """'KR: Korea' -> KOR; an aggregate ('5J: All countries') -> BIS:5J, kept with its label."""
        if not cell:
            return None
        code, _, label = cell.partition(": ")
        return self.by_bis.get(code) or self._aggregate(f"BIS:{code}", label)

    def imf(self, code: str | None) -> str | None:
        if not code:
            return None
        return self.by_imf.get(code) or self._aggregate(f"IMF:{code}", code)

    def table(self) -> pa.Table:
        cols = ("code", "iso2", "m49", "imf", "bis", "name_en", "name_ko", "region", "subregion", "lat", "lon", "is_aggregate", "euro_area_from")
        rows = sorted(self.rows.values(), key=lambda r: (r["is_aggregate"], r["code"]))
        data = {c: [r[c] or None for r in rows] for c in cols}
        data["lat"] = [float(x) if x else None for x in data["lat"]]
        data["lon"] = [float(x) if x else None for x in data["lon"]]
        data["is_aggregate"] = [x == "1" for x in data["is_aggregate"]]
        return pa.table(data)


# ---------------------------------------------------------------------- BIS bulk files through DuckDB
def bis_csv(rec: dict) -> Path:
    """The CSV inside a BIS bulk zip, unzipped once into work/bis/<sha8>/."""
    d = WORK / "bis" / rec["sha256"][:8]
    with zipfile.ZipFile(raw_path(rec)) as z:
        name = [n for n in z.namelist() if n.endswith(".csv")][0]
        out = d / name
        if not out.exists() or out.stat().st_size != z.getinfo(name).file_size:
            d.mkdir(parents=True, exist_ok=True)
            log(f"  unzipping {rec['path']} ({z.getinfo(name).file_size / 1e9:.1f} GB)")
            tmp = d / (name + ".part")
            with z.open(name) as src, open(tmp, "wb") as dst:
                shutil.copyfileobj(src, dst, 1 << 24)
            tmp.rename(out)
    return out


def code(col: str) -> str:
    """SQL for the code part of a BIS 'CODE: Label' cell."""
    return f"split_part(\"{col}\", ': ', 1)"


def where(cols: list[str], filters: dict) -> str:
    """A WHERE clause from config/datasets.yaml filters: {DIM: value or [values]} on the code part of each column."""
    parts = []
    for dim, val in filters.items():
        col = next(c for c in cols if c.split(":")[0] == dim)
        vals = val if isinstance(val, list) else [val]
        parts.append(f"{code(col)} IN ({', '.join(repr(str(v)) for v in vals)})")
    return " AND ".join(parts) or "TRUE"


def period_end(p: str, freq: str) -> dt.date | None:
    """2026-Q1 -> 2026-03-31, 2026-09 -> 2026-09-30, 2026 -> 2026-12-31, 2026-S1 -> 2026-06-30, 2026-W42 -> the Sunday of
    ISO week 42; a date is itself for daily and weekly series, and the end of its month, quarter or year otherwise (FRED
    dates a monthly observation by the month's first day)."""
    if not p:
        return None
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", p):
            d = dt.date.fromisoformat(p)
            if freq in ("M", "Q", "A"):
                return period_end(f"{d.year}" if freq == "A" else f"{d.year}-Q{(d.month - 1) // 3 + 1}" if freq == "Q" else p[:7], freq)
            return d
        m = re.fullmatch(r"(\d{4})(?:-?([QSMW])?(\d{1,2}))?", p)
        if not m:
            return None
        y, kind, n = int(m.group(1)), m.group(2), m.group(3)
        if kind == "W":
            return dt.date.fromisocalendar(y, int(n), 7)
        if n is None:
            month = 12
        else:
            month = {"Q": 3 * int(n), "S": 6 * int(n)}.get(kind or "", int(n))
        nxt = dt.date(y + (month == 12), 1 if month == 12 else month + 1, 1)
        return nxt - dt.timedelta(days=1)
    except ValueError:
        return None


# ---------------------------------------------------------------------- exchange rates
class FX:
    """Currency units per US dollar by BIS reference area and month (bis.XRU): end-of-period observations (collection E)
    and period averages (collection A), and the currency of each area. A date past the newest rate (this month, before
    its end) takes the newest rate of the two months before it; older gaps give None, never a guess."""

    def __init__(self, con: duckdb.DuckDBPyConnection, rec: dict | None):
        self.rate: dict[tuple[str, str], float] = {}
        self.avg: dict[tuple[str, str], float] = {}
        self.ccy: dict[str, str] = {}
        if not rec:
            return
        f = bis_csv(rec)
        cols = [c[0] for c in con.execute(f"DESCRIBE SELECT * FROM read_csv('{f}', all_varchar=true)").fetchall()]
        area, ccy, freq, coll = (next(c for c in cols if c.startswith(p)) for p in ("REF_AREA", "CURRENCY", "FREQ", "COLLECTION"))
        q = (f"SELECT {code(area)}, {code(ccy)}, {code(freq)}, \"TIME_PERIOD:Time period or range\", TRY_CAST(\"OBS_VALUE:Observation Value\" AS DOUBLE) "
             f", {code(coll)} FROM read_csv('{f}', all_varchar=true) WHERE {code(coll)} IN ('E', 'A') AND {code(freq)} IN ('M', 'Q') "
             f"ORDER BY {code(freq)}")                              # monthly before quarterly: setdefault keeps the monthly rate
        for a, c, fr, p, v, kind in con.execute(q).fetchall():
            if v:
                end = period_end(p, fr)
                if end:
                    (self.rate if kind == "E" else self.avg).setdefault((a, end.strftime("%Y-%m")), v)
                    self.ccy[a] = c

    def per_usd(self, area_iso2: str, day: dt.date, average: bool = False) -> float | None:
        table = self.avg if average else self.rate
        for back in range(3):
            first = (day.replace(day=1) - dt.timedelta(days=28 * back)).replace(day=1) if back else day
            r = table.get((area_iso2, first.strftime("%Y-%m")))
            if r:
                return r
        return None

    def by_currency(self, ccy: str, day: dt.date, average: bool = False) -> float | None:
        if ccy == "USD":
            return 1.0
        area = {"EUR": "XM", "JPY": "JP", "GBP": "GB", "CHF": "CH", "KRW": "KR", "CNY": "CN", "USD": "US"}.get(ccy)
        if not area:                                                # any other currency: an area that uses it
            area = next((a for a, c in sorted(self.ccy.items()) if c == ccy), None)
        return self.per_usd(area, day, average) if area else None


def own_currency(currencies: dict[str, str], regimes: dict[str, list], eco: str, day: dt.date) -> str | None:
    """R1: the other economy's currency `eco` uses on `day`: for good (config `currencies`) or within a dated regime
    (config `currency_regimes`, e.g. Zimbabwe's dollar years 2009-02 to 2019-06); None where it uses its own."""
    if eco in currencies:
        return currencies[eco]
    for r in regimes.get(eco) or []:
        lo, hi = r.get("from"), r.get("to")
        if (lo is None or day >= lo) and (hi is None or day <= hi):
            return r["ccy"]
    return None


# ---------------------------------------------------------------------- IMF SDMX structure-specific XML
SERIES = re.compile(rb"<Series ([^>]*)>(.*?)</Series>", re.S)
ATTR = re.compile(rb'(\w+)="([^"]*)"')
OBS = re.compile(rb"<Obs ([^>]*)/>")


PUBLISHED = re.compile(rb'PUBLICATION_DATE="(\d{4}-\d{2}-\d{2})')


def imf_published(rec: dict, body: bytes) -> bytes:
    """Note the IMF's own publication date of the dataset (the SDMX header's PUBLICATION_DATE) on the ledger record, so
    provenance carries the publisher's release date beside the day the mirror read the file."""
    m = PUBLISHED.search(body[:4000])
    if m:
        rec["published"] = m.group(1).decode()
    return body


def imf_series(body: bytes, want):
    """(series attributes, [(period, value)]) for each series whose attributes pass want(attrs)."""
    for m in SERIES.finditer(body):
        a = {k.decode(): v.decode() for k, v in ATTR.findall(m.group(1))}
        if not want(a):
            continue
        obs = []
        for o in OBS.finditer(m.group(2)):
            oa = dict(ATTR.findall(o.group(1)))
            try:
                v = float(oa[b"OBS_VALUE"])
            except (KeyError, ValueError):
                continue
            if v == v:                                                  # not NaN
                obs.append((oa[b"TIME_PERIOD"].decode(), v))
        yield a, obs


# ---------------------------------------------------------------------- the tables
STOCK_COLS = ("economy", "period", "freq", "layer", "measure", "detail", "currency", "value_lcu", "value_usd", "source", "dataset", "vintage", "raw")
LINK_COLS = ("period", "freq", "creditor", "debtor", "channel", "basis", "sector_debtor", "currency", "position_usd", "flow_usd", "flow_kind",
             "reported_by", "source", "dataset", "vintage", "raw")
TOTAL_COLS = ("economy", "period", "freq", "side", "item", "position_usd", "source", "dataset", "vintage", "raw")
FLOW_COLS = ("economy", "period", "freq", "side", "item", "flow_usd", "source", "dataset", "vintage", "raw")
SIGNAL_COLS = ("economy", "period", "freq", "measure", "detail", "currency", "value_usd", "source", "dataset", "vintage", "raw")


class Builder:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.con = duckdb.connect()
        self.con.execute(f"SET threads={os.cpu_count() or 4}")
        self.econ = Economies()
        self.vint = newest_vintages()
        self.used: dict[tuple[str, str, str], dict] = {}           # (table, dataset, key) -> ledger line
        self.fx = FX(self.con, self.rec("bis.XRU", "-", "stocks"))
        self.currencies: dict[str, str] = cfg.get("currencies") or {}
        self.regimes: dict[str, list] = cfg.get("currency_regimes") or {}
        self.corrections: list[dict] = cfg.get("unit_corrections") or []
        self.effects: dict[str, dict[str, int]] = {}

    def own_currency(self, eco: str, day: dt.date) -> str | None:
        """R1: another economy's currency this economy uses, for good (currencies) or in a dated regime (currency_regimes)."""
        return own_currency(self.currencies, self.regimes, eco, day)

    def unit_factor(self, eco: str, dataset: str, measure: str, day: dt.date) -> float:
        """R1: a listed source unit correction for this observation (1 where none applies)."""
        for c in self.corrections:
            if c["economy"] == eco and c["dataset"] == dataset and measure in c["measures"] and day <= c["until"]:
                self.effects.setdefault("R1", {})
                self.effects["R1"]["source unit corrections applied (config/datasets.yaml unit_corrections)"] = \
                    self.effects["R1"].get("source unit corrections applied (config/datasets.yaml unit_corrections)", 0) + 1
                return float(c["factor"])
        return 1.0

    def rec(self, dataset: str, key: str, table: str) -> dict | None:
        r = self.vint.get((dataset, key))
        if r:
            self.used[(table, dataset, key)] = r
        return r

    def keys(self, dataset: str) -> list[str]:
        return sorted(k for d, k in self.vint if d == dataset)

    # ------------------------------------------------------------------ stocks
    def stocks(self) -> pa.Table:
        rows: list[tuple] = []
        add = rows.append
        c = self.cfg["stocks"]
        # BIS: central bank assets, credit to the private sector, global liquidity (amounts already in USD or converted)
        for name in ("bis.CBTA", "bis.TC", "bis.GLI", "bis.DSS"):
            spec = c[name]
            rec = self.rec(name, "-", "stocks")
            if not rec:
                log(f"  {name}: no vintage in the mirror")
                continue
            f = bis_csv(rec)
            cols = [x[0] for x in self.con.execute(f"DESCRIBE SELECT * FROM read_csv('{f}', all_varchar=true)").fetchall()]
            area = next(x for x in cols if x.split(":")[0] in ("REF_AREA", "BORROWERS_CTY", "ISSUER_RES"))
            freq = next(x for x in cols if x.startswith("FREQ"))
            mult = next(x for x in cols if x.upper().startswith("UNIT_MULT"))
            unit = next(x for x in cols if x.split(":")[0] in ("UNIT_MEASURE", "UNIT_TYPE"))
            extra = [x for x in cols if x.split(":")[0] in (("ISSUER_BUS_IMM", "MEASURE") if name == "bis.DSS" else ("CURR_DENOM", "L_INSTR"))]
            sel = ", ".join([f'"{area}"', code(freq), '"TIME_PERIOD:Time period or range"', 'TRY_CAST("OBS_VALUE:Observation Value" AS DOUBLE)',
                             code(mult), code(unit)] + [code(x) for x in extra])
            q = f"SELECT {sel} FROM read_csv('{f}', all_varchar=true) WHERE {where(cols, spec['filter'])}"
            n0 = len(rows)
            for r in self.con.execute(q).fetchall():
                cell, fr, p, v, m, u = r[:6]
                if v is None or v != v or not fr:                     # BIS writes a missing value as NaN
                    continue
                end = period_end(p, fr)
                if not end:
                    continue
                v = v * 10 ** int(m or 0) / 1e9                       # billions of the unit
                eco = self.econ.bis(cell)
                detail, ccy = spec.get("detail", ""), None
                if name == "bis.GLI":
                    ccy, instr = r[6], r[7]
                    detail = spec["instruments"].get(instr, instr)
                    rate = self.fx.by_currency(ccy, end)
                    usd = v / rate if rate else None
                    add((eco, end, fr, spec["layer"], spec["measure"], detail, ccy, v, usd, "bis", name, rec["ts"][:10], rec["path"]))
                elif name == "bis.DSS":                                # amounts outstanding (I) and net issues (G), by issuer sector
                    sector, kind = r[6], r[7]
                    add((eco, end, fr, spec["layer"], spec["measure"] if kind == "I" else "ids_net_issues", spec["sectors"].get(sector, sector),
                         "USD", None, v, "bis", name, rec["ts"][:10], rec["path"]))
                else:
                    add((eco, end, fr, spec["layer"], spec["measure"], detail, "USD", None if u == "USD" else v, v if u == "USD" else None,
                         "bis", name, rec["ts"][:10], rec["path"]))
            log(f"  {name}: {len(rows) - n0:,} rows")
        # IMF: monetary aggregates (local currency, converted) and reserves (USD), one file per economy
        for name in ("imf.MFS_MA", "imf.IRFCL", "imf.MFS_CBS", "imf.MFS_ODC"):
            spec = c[name]
            n0 = len(rows)
            ind = spec["indicators"]
            for key in self.keys(name):
                rec = self.rec(name, key, "stocks")
                body = read_raw(rec)
                for a, obs in imf_series(body, lambda a: a.get("INDICATOR") in ind and a.get("FREQUENCY") in spec["freq"]
                                         and (not spec.get("sector") or a.get("SECTOR") == spec["sector"])):
                    eco = self.econ.imf(a.get("COUNTRY"))
                    measure, layer = ind[a["INDICATOR"]]
                    scale = 1e-9                                       # IMF values are in units; SCALE only says how to display them
                    iso2 = self.econ.rows.get(eco, {}).get("iso2")
                    usd_unit = a.get("UNIT") == "USD" or a["INDICATOR"].endswith("_USD")
                    for p, v in obs:
                        end = period_end(p, a["FREQUENCY"])
                        if not end:
                            continue
                        v *= scale * self.unit_factor(eco, name, measure, end)
                        if usd_unit:
                            add((eco, end, a["FREQUENCY"], layer, measure, "", "USD", None, v, "imf", name, rec["ts"][:10], rec["path"]))
                        else:
                            own = self.own_currency(eco, end)                  # R1 v2/v3: a dollarised or euroised economy's unit is another's currency
                            rate = self.fx.by_currency(own, end) if own else (self.fx.per_usd(iso2, end) if iso2 else None)
                            add((eco, end, a["FREQUENCY"], layer, measure, "", own or self.fx.ccy.get(iso2), None if own == "USD" else v, v / rate if rate else None,
                                 "imf", name, rec["ts"][:10], rec["path"]))
            log(f"  {name}: {len(rows) - n0:,} rows")
        # FRED, ECB, ECOS: the national sources, one series each (config/datasets.yaml says which measure each is)
        for name, src in (("fred.observations", "fred"), ("ecb.BSI", "ecb"), ("ecb.ILM", "ecb"), ("ecos.StatisticSearch", "ecos")):
            n0 = len(rows)
            for key, spec in c[name].items():
                rec = self.rec(name, key, "stocks")
                if not rec:
                    continue
                for p, v in national_obs(src, read_raw(rec)):
                    end = period_end(p, spec["freq"])
                    if not end or v is None:
                        continue
                    v *= spec["scale"] / 1e9
                    ccy = spec["currency"]
                    rate = self.fx.by_currency(ccy, end, average="average" in spec.get("detail", ""))   # R1: an average at the average rate
                    add((spec["economy"], end, spec["freq"], spec["layer"], spec["measure"], spec.get("detail", ""), ccy,
                         None if ccy == "USD" else v, v if ccy == "USD" else (v / rate if rate else None), src, name, rec["ts"][:10], rec["path"]))
            log(f"  {name}: {len(rows) - n0:,} rows")
        rec = self.rec("llama.stablecoins", "all", "stocks")
        if rec:
            n0 = len(rows)
            for r in json.loads(read_raw(rec)):
                day = dt.datetime.fromtimestamp(int(r["date"]), dt.timezone.utc).date()
                v = (r.get("totalCirculatingUSD") or {}).get("peggedUSD")
                if v is not None:
                    add((self.econ._aggregate("WLD", "World"), day, "D", 2, "stablecoins", "USD-pegged", "USD", None, v / 1e9, "llama",
                         "llama.stablecoins", rec["ts"][:10], rec["path"]))
            log(f"  llama.stablecoins: {len(rows) - n0:,} rows")
        spec = c["imf.COFER"]
        rec = self.rec("imf.COFER", "_all", "stocks")
        if rec:
            n0 = len(rows)
            for a, obs in imf_series(read_raw(rec), lambda a: a.get("INDICATOR") in (spec["indicator"], "TFXRA", "UFXRA") and a.get("FREQUENCY") in spec["freq"]
                                     and a.get("TYPE_OF_TRANSFORMATION") == "NV_USD" and a.get("COUNTRY") == "G001"):
                detail = {"TFXRA": "total", "UFXRA": "unallocated"}.get(a["INDICATOR"]) or a.get("FXR_CURRENCY", "").removeprefix("CI_")
                for p, v in obs:
                    end = period_end(p, a["FREQUENCY"])
                    if end:
                        add((self.econ._aggregate("WLD", "World"), end, a["FREQUENCY"], spec["layer"], spec["measure"], detail, "USD", None, v * 1e-9,
                             "imf", "imf.COFER", rec["ts"][:10], rec["path"]))
            log(f"  imf.COFER: {len(rows) - n0:,} rows")
        t = pa.table({col: [r[i] for r in rows] for i, col in enumerate(STOCK_COLS)})
        return self.mark_primary(t)

    def mark_primary(self, t: pa.Table) -> pa.Table:
        """primary = the best-ranked source (national first, then BIS, then the IMF) for each economy and measure."""
        self.con.register("s", t)
        return self.con.execute(f"""
            SELECT s.*, (rank = 1) AS "primary" FROM (
              SELECT *, dense_rank() OVER (PARTITION BY economy, measure ORDER BY CASE source {' '.join(f"WHEN '{k}' THEN {v}" for k, v in SOURCE_RANK.items())} END,
                                           CASE freq WHEN 'M' THEN 0 WHEN 'W' THEN 1 WHEN 'Q' THEN 2 ELSE 3 END) AS rank FROM s) s
            ORDER BY economy, measure, period""").to_arrow_table().drop(["rank"])

    # ------------------------------------------------------------------ links
    def links(self) -> pa.Table:
        parts = []
        c = self.cfg["links"]
        for name in ("bis.LBS", "bis.CBS"):
            spec = c[name]
            rec = self.rec(name, "-", "links")
            if not rec:
                log(f"  {name}: no vintage in the mirror")
                continue
            f = bis_csv(rec)
            cols = [x[0] for x in self.con.execute(f"DESCRIBE SELECT * FROM read_csv('{f}', all_varchar=true)").fetchall()]
            col = lambda d: next(x for x in cols if x.split(":")[0] == d)
            basis = spec["basis"]
            basis_sql = f"CASE {code(col('CBS_BASIS'))} {' '.join(f'WHEN {k!r} THEN {v!r}' for k, v in basis.items())} END" if isinstance(basis, dict) else repr(basis)
            sector = f"CASE {code(col('L_CP_SECTOR'))} {' '.join(f'WHEN {k!r} THEN {v!r}' for k, v in spec['sectors'].items())} END"
            ccy = f"CASE {code(col(spec['currency_dim']))} WHEN 'TO1' THEN 'all' ELSE {code(col(spec['currency_dim']))} END"
            instr = spec.get("instruments")
            chan = f"CASE {code(col('L_INSTR'))} {' '.join(f'WHEN {k!r} THEN {v!r}' for k, v in instr.items())} END" if instr else "'bank'"
            q = f"""SELECT "{col('L_REP_CTY')}" AS rep, "{col('L_CP_COUNTRY')}" AS cp, "TIME_PERIOD:Time period or range" AS p, {basis_sql} AS basis, {chan} AS channel,
                           {sector} AS sector_debtor, {ccy} AS currency, {code(col('L_MEASURE'))} AS m,
                           TRY_CAST("OBS_VALUE:Observation Value" AS DOUBLE) * pow(10, TRY_CAST({code(col('UNIT_MULT'))} AS INT)) / 1e9 AS v
                    FROM read_csv('{f}', all_varchar=true) WHERE {where(cols, spec['filter'])}"""
            t0 = time.time()
            got = self.con.execute(f"""SELECT rep, cp, p, basis, channel, sector_debtor, currency,
                                              max(v) FILTER (WHERE m = 'S' AND isfinite(v)) AS position_usd, max(v) FILTER (WHERE m = 'F' AND isfinite(v)) AS flow_usd
                                       FROM ({q}) GROUP BY ALL HAVING position_usd IS NOT NULL OR flow_usd IS NOT NULL""").fetchall()
            rows = []
            for rep, cp, p, b, ch, sec, cur, pos, flow in got:
                end = period_end(p, "Q")
                if end and (pos is not None or flow is not None):
                    rows.append((end, "Q", self.econ.bis(rep), self.econ.bis(cp), ch, b, sec, cur, pos, flow,
                                 "published" if flow is not None else None, "creditor", "bis", name, rec["ts"][:10], rec["path"]))
            log(f"  {name}: {len(rows):,} rows ({time.time() - t0:.0f} s)")
            parts.append(rows)
        # IMF portfolio (holder reports what it holds) and direct investment (outward from the investor, inward from the host)
        for name in ("imf.PIP", "imf.DIP"):
            spec = c[name]
            rows = []
            for key in self.keys(name):
                rec = self.rec(name, key, "links")
                body = read_raw(rec)
                for a, obs in imf_series(body, lambda a: a.get("INDICATOR") in spec["indicators"] and all(a.get(k) == v for k, v in spec.get("match", {}).items())):
                    channel, direction = spec["indicators"][a["INDICATOR"]]
                    rep, cp = self.econ.imf(a.get("COUNTRY")), self.econ.imf(a.get("COUNTERPART_COUNTRY"))
                    creditor, debtor = (rep, cp) if direction == "out" else (cp, rep)
                    # DV_TYPE O: the file's own economy reported it. Otherwise it is derived from the counterpart's report: in an
                    # outward file that is the host's (debtor's) report, in an inward file the investor's (creditor's) (R4)
                    own = a.get("DV_TYPE", "O") == "O"
                    reported = ("creditor" if direction == "out" else "debtor") if own else ("mirror_debtor" if direction == "out" else "mirror_creditor")
                    scale = 1e-9                                       # IMF values are in units; SCALE only says how to display them
                    fr = a.get("FREQUENCY")
                    for p, v in obs:
                        end = period_end(p, fr)
                        if end:
                            rows.append((end, fr, creditor, debtor, channel, "residence", "all", "all", v * scale, None, None, reported,
                                         "imf", name, rec["ts"][:10], rec["path"]))
            log(f"  {name}: {len(rows):,} rows")
            parts.append(rows)
        parts.append(self.tic_links(c["tic.files"]["slt_table1.txt"]))
        rows = [r for p in parts for r in p]
        t = pa.table({col: [r[i] for r in rows] for i, col in enumerate(LINK_COLS)})
        # IMF flows are not published by pair: the change of the position, flagged as derived (valuation is mixed in)
        self.con.register("l", t)
        return self.con.execute("""
            SELECT * REPLACE (
                CASE WHEN source = 'imf' THEN position_usd - lag(position_usd) OVER w ELSE flow_usd END AS flow_usd,
                CASE WHEN source = 'imf' AND lag(position_usd) OVER w IS NOT NULL THEN 'derived' ELSE flow_kind END AS flow_kind)
            FROM l WINDOW w AS (PARTITION BY creditor, debtor, channel, basis, sector_debtor, currency, freq, reported_by, source ORDER BY period)
            ORDER BY channel, period, creditor, debtor""").to_arrow_table()

    def tic_links(self, spec: dict) -> list[tuple]:
        """TIC SLT table 1: what residents of each economy hold of US long-term securities, as the US reports it (the host's
        report, by the residence of the custodian), monthly, with the net purchases as published flows (millions of dollars)."""
        rec = self.rec("tic.files", "slt_table1.txt", "links")
        if not rec:
            return []
        names = {r["name_en"].lower(): code for code, r in self.econ.rows.items() if r.get("name_en")}
        rows, missing = [], set()
        lines = read_raw(rec).decode("utf-8", "replace").splitlines()
        head = next(i for i, l in enumerate(lines) if l.startswith("country\t"))
        cols = lines[head].split("\t")
        for l in lines[head + 1:]:
            f = l.split("\t")
            if len(f) < len(cols) or not re.fullmatch(r"\d{4}-\d{2}", f[2] or ""):
                continue
            r = dict(zip(cols, f))
            name = r["country"].strip()
            if name == spec["total"]:
                cred = self.econ._aggregate("TIC:TOTAL", "All foreign holders (TIC)")
            else:
                cred = spec["aliases"].get(name) or names.get(name.lower())
            if not cred:
                missing.add(name)
                continue
            end = period_end(r["date"], "M")
            num = lambda k: float(r[k]) / 1e3 if r.get(k) not in (None, "", "n.a.") else None
            parts = {"portfolio_equity": ("for_lt_eqty",), "portfolio_debt": tuple(spec["debt"]), "portfolio": ("for_lt_eqty", *spec["debt"])}
            for channel, ks in parts.items():
                pos = [num(k + "_pos") for k in ks]
                flow = [num(k + "_net") for k in ks]
                if any(v is None for v in pos):
                    continue
                rows.append((end, "M", cred, spec["debtor"], channel, "residence", "all", "all", sum(pos), None if any(v is None for v in flow) else sum(flow),
                             "published", "debtor", "tic", "tic.files", rec["ts"][:10], rec["path"]))
        log(f"  tic.files: {len(rows):,} rows; not matched (groups and memo lines): {len(missing)}")
        return rows

    # ------------------------------------------------------------------ signals (the World page's Signal Board, R17)
    def signals(self) -> pa.Table:
        """The borrower-side slices of config/datasets.yaml `signals`: BIS LBS loans and deposits (stocks and FX- and
        break-adjusted changes), CBS short-term international claims, DSS by nationality of issuer, the GDP implied by
        BIS total credit, and TIC net purchases by all and by official holders. One scan per bulk file; each row keeps
        its slice as `measure`."""
        rows: list[tuple] = []
        spec = self.cfg["signals"]
        country = {"bis.LBS": "L_CP_COUNTRY", "bis.LBS@local": "L_REP_CTY", "bis.CBS": "L_CP_COUNTRY", "bis.DSS": "ISSUER_NAT", "bis.DSS@res": "ISSUER_RES",
                   "bis.TC": "BORROWERS_CTY"}
        for variant in ("bis.LBS", "bis.LBS@local", "bis.CBS", "bis.DSS", "bis.DSS@res", "bis.TC"):
            s, name = spec[variant], variant.split("@")[0]       # bis.DSS@res: the DSS file again, by residence of issuer; bis.LBS@local: local positions by reporter
            rec = self.rec(name, "-", "signals")
            if not rec:
                log(f"  {name}: no vintage in the mirror")
                continue
            f = bis_csv(rec)
            cols = [x[0] for x in self.con.execute(f"DESCRIBE SELECT * FROM read_csv('{f}', all_varchar=true)").fetchall()]
            col = lambda d: next(x for x in cols if x.split(":")[0] == d)
            slices = s.get("slices") or {"tc": {}}
            case = "CASE " + " ".join(f"WHEN {where(cols, flt)} THEN {k!r}" for k, flt in slices.items()) + " END"
            dims = {"bis.LBS": ("L_MEASURE", "L_DENOM"), "bis.CBS": ("L_MEASURE", "CURR_TYPE_BOOK"), "bis.DSS": ("MEASURE", "ISSUE_CUR"),
                    "bis.TC": ("UNIT_TYPE", "UNIT_TYPE")}[name]
            det = code(col("ISSUER_BUS_IMM" if variant == "bis.DSS@res" else "ISSUER_BUS_ULT")) if name == "bis.DSS" else "''"
            mult = next(x for x in cols if x.upper().startswith("UNIT_MULT"))
            q = f"""SELECT {case} AS slice, "{col(country[variant])}" AS cp, "TIME_PERIOD:Time period or range" AS p, {code(col(dims[0]))} AS m,
                           {code(col(dims[1]))} AS ccy, {det} AS det, TRY_CAST("OBS_VALUE:Observation Value" AS DOUBLE) AS v, TRY_CAST({code(mult)} AS INT) AS mult
                    FROM read_csv('{f}', all_varchar=true) WHERE {where(cols, s['filter'])} AND ({' OR '.join(f'({where(cols, flt)})' for flt in slices.values())})"""
            t0 = time.time()
            got = self.con.execute(f"SELECT * FROM ({q}) WHERE v IS NOT NULL AND isfinite(v)").fetchall()
            n0 = len(rows)
            tc: dict[tuple, dict] = defaultdict(dict)
            for sl, cp, p, m, ccy, d, v, mu in got:
                end = period_end(p, "Q")
                if not end:
                    continue
                eco = self.econ.bis(cp)
                if name == "bis.TC":                                  # USD in billions; 770 = per cent of GDP
                    tc[(eco, end)][m] = v * 10 ** (mu or 0) / 1e9 if m == "USD" else v
                    continue
                v = v * 10 ** (mu or 0) / 1e9
                measure = {("lbs_loans", "F"): "lbs_loans_flow", ("ids_nat", "G"): "ids_nat_net"}.get((sl, m), sl)
                detail = {"1": "all", "E": "private_banks", "I": "public_banks"}.get(d, d or "")
                rows.append((eco, end, "Q", measure, detail, "all" if ccy == "TO1" else ccy, v, "bis", name, rec["ts"][:10], rec["path"]))
            for (eco, end), u in sorted(tc.items()):
                if u.get("USD") and u.get("770"):
                    rows.append((eco, end, "Q", "gdp_implied", "four-quarter GDP from BIS TC", "USD", u["USD"] * 100 / u["770"], "bis", name, rec["ts"][:10], rec["path"]))
            log(f"  {variant}: {len(rows) - n0:,} rows ({time.time() - t0:.0f} s)")
        n0 = len(rows)
        for key, f in spec["fred.observations"].items():
            rec = self.rec("fred.observations", key, "signals")
            if not rec:
                log(f"  fred.observations {key}: not collected")
                continue
            for p, v in national_obs("fred", read_raw(rec)):
                end = period_end(p, f["freq"])
                if end and v is not None:
                    rows.append(("USA", end, f["freq"], f["measure"], key, "index" if f["measure"] == "dollar_index" else "USD", v * f["scale"],
                                 "fred", "fred.observations", rec["ts"][:10], rec["path"]))
        log(f"  fred.observations: {len(rows) - n0:,} rows")
        rec = self.rec("tic.files", "slt_table1.txt", "signals")
        if rec:
            n0 = len(rows)
            want = {v: k for k, v in spec["tic.files"]["slt_table1.txt"].items()}
            lines = read_raw(rec).decode("utf-8", "replace").splitlines()
            head = next(i for i, l in enumerate(lines) if l.startswith("country\t"))
            cols = lines[head].split("\t")
            for l in lines[head + 1:]:
                r = dict(zip(cols, l.split("\t")))
                who = want.get((r.get("country_code") or "").strip())
                if not who or not re.fullmatch(r"\d{4}-\d{2}", r.get("date") or ""):
                    continue
                end = period_end(r["date"], "M")
                for k, det in (("for_lt_total_net", "all long-term"), ("for_lt_treas_net", "treasuries")):
                    if r.get(k) not in (None, "", "n.a."):
                        rows.append(("USA", end, "M", f"tic_net_{who}", det, "USD", float(r[k]) / 1e3, "tic", "tic.files", rec["ts"][:10], rec["path"]))
            log(f"  tic.files: {len(rows) - n0:,} rows")
        return pa.table({c: [r[i] for r in rows] for i, c in enumerate(SIGNAL_COLS)})

    # ------------------------------------------------------------------ totals
    def totals(self) -> pa.Table:
        spec = self.cfg["totals"]["imf.IIP"]
        rows = []
        for key in self.keys("imf.IIP"):
            rec = self.rec("imf.IIP", key, "totals")
            for a, obs in imf_series(imf_published(rec, read_raw(rec)), lambda a: a.get("INDICATOR") in spec["items"] and a.get("BOP_ACCOUNTING_ENTRY") in spec["sides"]
                                     and a.get("UNIT") == "USD" and a.get("FREQUENCY") in ("Q", "A")):
                scale = 1e-9                                       # IMF values are in units; SCALE only says how to display them
                for p, v in obs:
                    end = period_end(p, a["FREQUENCY"])
                    if end:
                        rows.append((self.econ.imf(a["COUNTRY"]), end, a["FREQUENCY"], spec["sides"][a["BOP_ACCOUNTING_ENTRY"]],
                                     spec["items"][a["INDICATOR"]], v * scale, "imf", "imf.IIP", rec["ts"][:10], rec["path"]))
        log(f"  imf.IIP: {len(rows):,} rows")
        # the IMF's own derived portfolio liabilities (PIP, ACCOUNTING_ENTRY L, counterpart world): the publisher's total of what
        # every reporting holder, SEFER and SSIO hold of each economy's securities (check V16)
        spec = self.cfg["totals"]["imf.PIP"]
        n0 = len(rows)
        for key in self.keys("imf.PIP"):
            rec = self.rec("imf.PIP", key, "totals")
            for a, obs in imf_series(read_raw(rec), lambda a: a.get("INDICATOR") in spec["items"] and all(a.get(k) == v for k, v in spec["match"].items())
                                     and a.get("FREQUENCY") in ("S", "A")):
                for p, v in obs:
                    end = period_end(p, a["FREQUENCY"])
                    if end:
                        rows.append((self.econ.imf(a["COUNTRY"]), end, a["FREQUENCY"], "liabilities", spec["items"][a["INDICATOR"]], v * 1e-9,
                                     "imf", "imf.PIP", rec["ts"][:10], rec["path"]))
        log(f"  imf.PIP derived liabilities: {len(rows) - n0:,} rows")
        return pa.table({col: [r[i] for r in rows] for i, col in enumerate(TOTAL_COLS)})

    def border_flows(self) -> pa.Table:
        """IMF BOP financial account: each economy's net acquisition of foreign assets and net incurrence of liabilities to
        non-residents, by functional category. These are transactions, published as such: no valuation change is mixed in (R8)."""
        spec = self.cfg["border_flows"]["imf.BOP"]
        rows = []
        for key in self.keys("imf.BOP"):
            rec = self.rec("imf.BOP", key, "border_flows")
            for a, obs in imf_series(imf_published(rec, read_raw(rec)), lambda a: a.get("INDICATOR") in spec["items"] and a.get("BOP_ACCOUNTING_ENTRY") in spec["sides"]
                                     and a.get("UNIT") == "USD" and a.get("FREQUENCY") in ("Q", "A")):
                if a["INDICATOR"] == "R_F" and a["BOP_ACCOUNTING_ENTRY"] != "A_T":
                    continue
                for p, v in obs:
                    end = period_end(p, a["FREQUENCY"])
                    if end:
                        rows.append((self.econ.imf(a["COUNTRY"]), end, a["FREQUENCY"], spec["sides"][a["BOP_ACCOUNTING_ENTRY"]],
                                     spec["items"][a["INDICATOR"]], v * 1e-9, "imf", "imf.BOP", rec["ts"][:10], rec["path"]))
        log(f"  imf.BOP: {len(rows):,} rows")
        return pa.table({col: [r[i] for r in rows] for i, col in enumerate(FLOW_COLS)})

    def provenance(self) -> pa.Table:
        rows = sorted(self.used.items())
        return pa.table({"table": [k[0] for k, _ in rows], "dataset": [k[1] for k, _ in rows], "key": [k[2] for k, _ in rows],
                         "path": [r["path"] for _, r in rows], "sha256": [r["sha256"] for _, r in rows], "vintage": [r["ts"][:10] for _, r in rows],
                         "newest_period": pa.array([r.get("newest") for _, r in rows], pa.string()),
                         "published": pa.array([r.get("published") for _, r in rows], pa.string()),   # the publisher's own date, where the file states one
                         "built": [dt.datetime.now().isoformat(timespec="seconds")] * len(rows)})


def national_obs(src: str, body: bytes):
    """(period, value) from a FRED observations answer, an ECB csvdata answer or an ECOS StatisticSearch answer."""
    if src == "fred":
        for o in json.loads(body).get("observations") or []:
            try:
                yield o["date"], float(o["value"])
            except (KeyError, ValueError):
                continue
    elif src == "ecb":
        lines = body.decode("utf-8").splitlines()
        rd = csv.DictReader(lines)
        for r in rd:
            try:
                yield r["TIME_PERIOD"], float(r["OBS_VALUE"])
            except (KeyError, ValueError, TypeError):
                continue
    elif src == "ecos":
        for r in (json.loads(body).get("StatisticSearch") or {}).get("row") or []:
            t = r.get("TIME", "")
            p = f"{t[:4]}-{t[4:]}" if len(t) == 6 and t[4:].isdigit() else (f"{t[:4]}-{t[4:]}" if "Q" in t else t)
            try:
                yield p, float(r["DATA_VALUE"])
            except (KeyError, ValueError, TypeError):
                continue


def dedupe(t: pa.Table, name: str) -> pa.Table:
    """R12: a row that repeats exactly (same key, same value, same file) is kept once. Same key with different values is
    left for check V1, which stops the release."""
    con = duckdb.connect()
    con.register("t", t)
    out = con.execute(f"SELECT DISTINCT * FROM t ORDER BY ALL").to_arrow_table()
    EFFECTS.setdefault("R12", {})[name] = t.num_rows - out.num_rows
    if t.num_rows != out.num_rows:
        log(f"  {name}: {t.num_rows - out.num_rows:,} exact repeats dropped (R12)")
    return out


def write(t: pa.Table, name: str) -> None:
    TABLES.mkdir(parents=True, exist_ok=True)
    if name in ("stocks", "links", "totals", "border_flows", "signals"):
        t = dedupe(t, name)
    tmp = TABLES / f".{name}.parquet.tmp"
    pq.write_table(t, tmp, compression="zstd")
    tmp.rename(TABLES / f"{name}.parquet")
    log(f"{name}: {t.num_rows:,} rows -> {TABLES / name}.parquet")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="comma list of stocks, links, totals, border_flows, signals")
    ap.add_argument("--clean", action="store_true", help="remove the unzipped BIS CSVs afterwards")
    a = ap.parse_args()
    cfg = yaml.safe_load((HERE / "config" / "datasets.yaml").read_text(encoding="utf-8"))
    full = {"stocks", "links", "totals", "border_flows", "signals"}
    only = set(a.only.split(",")) if a.only else full
    b = Builder(cfg)
    log(f"mirror {HUB}: {len(b.vint)} dataset keys with a stored vintage")
    for name in ("stocks", "links", "totals", "border_flows", "signals"):
        if name in only:
            log(f"{name}:")
            t = getattr(b, name)()
            write(t, name)
    econ, prov = b.econ.table(), b.provenance()
    if only != full:                    # a partial build keeps the other tables' aggregates and provenance rows
        if (TABLES / "economies.parquet").exists():
            old = pq.read_table(TABLES / "economies.parquet")
            have = set(econ.column("code").to_pylist())
            keep = old.filter(pa.array([c not in have for c in old.column("code").to_pylist()]))
            econ = pa.concat_tables([econ, keep.select(econ.column_names).cast(econ.schema)])
        if (TABLES / "provenance.parquet").exists():
            old = pq.read_table(TABLES / "provenance.parquet")
            keep = old.filter(pa.array([t not in only for t in old.column("table").to_pylist()]))
            for c in prov.column_names:                     # a column added since the old file was written arrives empty
                if c not in keep.column_names:
                    keep = keep.append_column(c, pa.nulls(keep.num_rows, prov.schema.field(c).type))
            prov = pa.concat_tables([prov, keep.select(prov.column_names).cast(prov.schema)])
    write(econ, "economies")
    write(prov, "provenance")
    eff = TABLES / "effects.json"
    old = json.loads(eff.read_text()) if eff.exists() and only != full else {}
    for k, v in list(EFFECTS.items()) + list(b.effects.items()):
        old.setdefault(k, {}).update(v)
    eff.write_text(json.dumps(old, indent=1, sort_keys=True), encoding="utf-8")
    if a.clean:
        shutil.rmtree(WORK / "bis", ignore_errors=True)
    elif only == full:                    # a full build: unzipped copies of replaced vintages go
        keep = {r["sha256"][:8] for (_, d, _), r in b.used.items() if d.startswith("bis.")}
        for d in (WORK / "bis").glob("*"):
            if d.name not in keep:
                shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    main()
