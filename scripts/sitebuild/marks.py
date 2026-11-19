"""From the tables to rule-applied relations (table row -> mark).

load() opens the tables and applies the table rules in the method's order, R12 -> R2 -> R3 -> R4 -> R5 -> R1 -> R16 -> R11 ->
R10, so that `links_m` (pair positions), `stocks_m` (economy measures), `totals_m` (IIP) and `flows_m` (BOP) hold only
rows a ladder may draw. The ladder rules (R7, R6, R8, R13) are applied in views.py, mark by mark.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import duckdb

from . import rules
from .registry import effect, licence

ROOT = Path(os.environ.get("MONEY_FLOW_DATA_ROOT", "data"))
TABLES = ROOT / "tables"

LINK_KEY = ["period", "freq", "creditor", "debtor", "channel", "basis", "sector_debtor", "currency", "reported_by", "dataset", "flow_kind"]
STOCK_KEY = ["economy", "period", "freq", "measure", "detail", "currency", "dataset", "raw"]
TOTAL_KEY = ["economy", "period", "freq", "side", "item", "dataset"]
SIGNAL_KEY = ["economy", "period", "freq", "measure", "detail", "currency", "dataset"]


def load(con: duckdb.DuckDBPyConnection, tables: Path = TABLES) -> dict:
    """Create the rule-applied views; return the R12 counts and the vintages used."""
    for t in ("economies", "stocks", "links", "totals", "border_flows", "provenance"):   # signals below (optional until its first build)
        con.execute(f"CREATE OR REPLACE VIEW {t} AS SELECT * FROM '{tables / t}.parquet'")
    eff = tables / "effects.json"
    if eff.exists():                                             # exact repeats dropped by build_tables.py
        for t, k in (json.loads(eff.read_text()).get("R12") or {}).items():
            effect("R12", f"{t}: exact repeats written once", k)

    # links: only the pair channels the ladder draws
    con.execute("CREATE OR REPLACE VIEW links_0 AS SELECT * FROM links WHERE dataset IN ('bis.LBS', 'bis.CBS', 'imf.PIP', 'imf.DIP', 'tic.files')")
    conflicts = {"links": rules.r12_duplicates(con, "links_0", "links_12", LINK_KEY, "position_usd")}
    rules.r2_totals_only(con, "links_12", "links_2")
    rules.r3_one_frequency(con, "links_2", "links_3")
    rules.r4_one_report_per_pair(con, "links_3", "links_4")
    rules.r5_bank_loans_and_deposits(con, "links_4", "links_5")
    rules.r11_aggregates(con, "links_5", "links_11")
    rules.r10_basis(con, "links_11", "links_10")
    con.execute("CREATE OR REPLACE TABLE links_m AS SELECT * FROM links_10 WHERE position_usd IS NOT NULL OR flow_usd IS NOT NULL")

    # IIP totals: one frequency per period (the quarterly row where a December has both, R3); the PIP derived liabilities
    # (dataset imf.PIP, items *_derived) sit beside them for V16
    conflicts["totals"] = rules.r12_duplicates(con, "totals", "totals_12", TOTAL_KEY, "position_usd")
    con.execute("""CREATE OR REPLACE TABLE totals_m AS SELECT * EXCLUDE (rk) FROM (
        SELECT *, row_number() OVER (PARTITION BY economy, period, side, item ORDER BY CASE freq WHEN 'Q' THEN 0 WHEN 'S' THEN 0 ELSE 1 END) rk FROM totals_12) WHERE rk = 1""")

    conflicts["stocks"] = rules.r12_duplicates(con, "stocks", "stocks_12", STOCK_KEY, "coalesce(value_usd, value_lcu)")
    rules.r1_units(con, "stocks_12", "stocks_1")
    rules.r16_quarantine(con, "stocks_1", "stocks_16", totals="totals_m")
    con.execute("CREATE OR REPLACE TABLE stocks_m AS SELECT * FROM stocks_16")
    conflicts["border_flows"] = rules.r12_duplicates(con, "border_flows", "flows_12", TOTAL_KEY, "flow_usd")
    con.execute("""CREATE OR REPLACE TABLE flows_m AS SELECT * EXCLUDE (rk) FROM (
        SELECT *, row_number() OVER (PARTITION BY economy, period, side, item ORDER BY CASE freq WHEN 'Q' THEN 0 ELSE 1 END) rk FROM flows_12) WHERE rk = 1""")
    # the Signal Board's borrower-side slices (method 1.2, R17): no table rule applies beyond R12; the board's rules
    # R17–R19 work per economy-quarter in views.board
    sg = tables / "signals.parquet"
    con.execute(f"CREATE OR REPLACE VIEW signals AS SELECT * FROM '{sg}'" if sg.exists() else
                "CREATE OR REPLACE VIEW signals AS SELECT NULL economy, NULL::DATE period, NULL freq, NULL measure, NULL detail, NULL currency, "
                "NULL::DOUBLE value_usd, NULL source, NULL dataset, NULL vintage, NULL raw WHERE FALSE")
    conflicts["signals"] = rules.r12_duplicates(con, "signals", "signals_12", SIGNAL_KEY, "value_usd")
    con.execute("CREATE OR REPLACE TABLE signals_m AS SELECT * FROM signals_12")
    vint = {d: v for d, v in con.execute("SELECT dataset, max(vintage) FROM provenance GROUP BY 1 ORDER BY 1").fetchall()}
    hashes = {d: h for d, h in con.execute("SELECT dataset, sha256(string_agg(sha256, ',' ORDER BY key)) FROM provenance GROUP BY 1").fetchall()}
    return {"conflicts": conflicts, "vintages": vint, "hashes": hashes}


def class_of(ds: str, key: str | None = None) -> str:
    return licence(ds, key)
