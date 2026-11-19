"""The licence gate: what may reach a public site file, and at what level.

Every object that names a dataset ("ds") must be of a class that may be shown. Commercial vendor data never pass (R14,
1 Nov 2026): a vendor key stops the build. Keys outside the mark schema are dropped and counted. A violation stops the
build: nothing is published with a licensed or third-party value in it.
"""
from __future__ import annotations

import re

from .registry import licence, shown


class LicenceError(RuntimeError):
    pass


SCHEMA = {
    # common
    "code", "ds", "key", "f", "det", "pts", "flow", "per", "rank", "g", "parts", "n", "ident", "other", "other_flow", "rep",
    "total", "ni", "cov", "excess", "all_instr", "split", "nat", "ladders", "index", "aligned", "newest", "in", "out",
    "border", "iip", "bop", "made", "context", "tic", "usd_bank", "checks", "id", "status", "dir", "group",
    "value", "period", "note", "debt", "bank", "fdi", "equity", "unsplit", "portfolio", "reserves", "fdi_parts", "bank_nat", "published", "derived", "top", "top_v", "top_share",
    # economy measures and items
    "cb_assets", "monetary_base", "currency", "reserves_banks", "m1", "broad_money", "m3", "lf", "l", "credit_private",
    "fx_reserves", "mmf_retail", "ids_outstanding", "banks_claims_nonres", "banks_liabilities_nonres", "net", "direct",
    "other_loans", "other_deposits", "portfolio_equity", "portfolio_debt", "iip_total", "iip_other",
    "fx_reserves", "swap_lines", "treasury_account", "reverse_repo", "repo_lending",
    # the audit's additions (method 1.1): the reserves-and-IO group, the other reporter's FDI figure, DIP and IIP totals,
    # the bank instrument split, the derivatives pool, the capped-coverage excess, the IMF derived liabilities
    "rio", "alt", "dip_total", "iip_total", "bank_other", "debt_sec", "other_instr", "nosplit", "iip_loans", "iip_deposits", "iip_deriv",
    "derivatives", "excess_by", "derived", "_rio", "_oi", "bank_debt", "portfolio_derived", "portfolio_equity_derived", "portfolio_debt_derived",
    "quarantined", "reason", "ratio", "previous", "from", "to", "by_economy", "fd", "iip_portfolio",
    "bond", "recent", "sum", "window",
    # market and world
    "market", "periods", "p", "holders", "dests", "holders_other", "dests_other", "pairs", "n_holders", "n_dests",
    "focus", "out_pass", "in_pass", "out_top", "in_top",
    "apex", "plumbing", "gli", "cofer", "ids", "economies", "assets", "liabilities", "securities", "loans", "unallocated",
    "USD", "EUR", "JPY", "GBP", "CNY", "CAD", "AUD", "CHF", "OTHC",
    # the Signal Board and the pulse (method 1.2)
    "board", "cols", "quarters", "q", "rows", "drop", "n_out", "domain", "x", "y", "size", "set", "y_clip",
    "pulse", "custody_treasuries", "dollar_index", "missing", "latest", "chg", "kind", "age", "stale", "official", "private",
    # method 1.3: the board's constants (floors, cap, minimums, the A2 scope), the IIP's debt/equity split and its vintage
    "floor", "a1", "a2", "z_cap", "min_history", "min_pool", "reserve_issuers", "standing_swap", "direct_equity", "direct_debt", "read", "groups", "advanced",
    # method 1.4: net reserves and the local component as method switches, the buffer list, the offshore flag's thresholds,
    # the board's euro-adoption dates, the no-split reporters' share (R5 coverage panel)
    "a2_reserves", "res_floor", "a1_local", "buffers", "offshore_gap", "offshore_ratio", "euro", "nosplit_share",
    # ticker, meta, checks, registries
    "economy", "measure", "items", "ticker",
    # meta
    "en", "ko", "region", "subregion", "lat", "lon", "agg", "page", "fc", "method", "day", "asof", "markets", "datasets", "vintage", "freq", "class",
    # method 1.5: the lender cut on the bank market (R21)
    "lender_cut", "debtors", "claims_usd", "res_net", "lenders",
    # method 1.6: net reserves without the floor, the board's rows without a flow, A1's own-history
    # basis, the GLI currencies (all_instr, the lender cut's all-instrument reporters, is above)
    "res_net_raw", "no_flow", "a1_own_history", "gli_currencies",
}
FREE_KEYS = re.compile(r"^([A-Z]{3}|[A-Z]{2,4}:[A-Z0-9]+|\d{4}-\d{2}-\d{2}|\d+|_other|[a-z]+\.[A-Za-z_.]+)$")   # economy codes, dates, k values, dataset ids
VENDOR_KEYS = {"epfr", "lipper", "lseg", "funds"}   # commercial vendor blocks: never published (R14)

# The views of the export surface (method 1.5, the surface contract) carry the fetchers' files and the sovereign object as
# they are, so each has its own schema beside the mark schema, keyed by the first path segment, and its own free-key
# pattern (quarters, months, IMF series keys, WEO indicators, glossary and episode ids). A key outside both is dropped
# and counted like any other, and V11 fails the build on it.
SCHEMA_VIEW: dict[str, set[str]] = {
    "earn": {  # the WDI file (fetch_wdi.py) and the quarterly file (fetch_quarterly.py), unchanged
        "wdi", "quarterly", "read", "source", "licence", "series", "meta", "gs", "pi", "gdp", "gdp_pc", "x", "m", "ne_x", "ne_m", "id", "name", "lastupdated",
        "from", "economies", "sources", "bop", "fx", "empty", "last", "missing", "structure", "urls", "update_date", "publication_date",
        "suggested_citation", "short_source_citation", "license", "indicator", "entry", "unit", "scale", "obs", "label", "ref_area", "currency",
        "unit_mult", "file", "filter", "member", "qnea", "xru", "vintage"},
    "changes": {"q", "prev", "items", "eco", "side", "kind", "v", "flow", "b1", "b2", "a2", "basis"},
    "episodes": {"episodes", "global_windows", "out_of_scope", "pre", "threshold", "en", "ko", "q", "eco"},
    "sovereign": {  # the object scripts/sitebuild/sovereign.py builds (global-network's warning.json, unchanged)
        "years", "proj0", "last_actual", "rules", "K", "order", "validation_cfg", "econ", "episodes", "spells", "coverage", "valid", "checks", "meta",
        "economies", "names", "gloss", "group", "default", "dir", "min", "max", "step", "unit", "source", "pre", "calm_gap", "global_years", "merge_years",
        "v", "na", "src", "x", "bench", "eu", "a2_na", "r7_bench_self", "spread", "r7_id", "r7_bench_id", "weo_update", "now", "counts",
        "ca", "i", "g", "pbstar", "pb", "interest", "r7n", "t0", "t1", "p", "kind",
        "id", "eco", "type", "facility", "start", "end", "end_kind", "precision", "en", "ko", "source2", "note", "creditor", "before_sample", "agreed", "drawn",
        "y0", "y1", "ids", "first", "last", "gaps", "scored", "hits", "hit_rate", "calm", "alarms", "false_rate", "pos_years", "auroc", "per", "data", "hit",
        "rows", "y", "k", "n", "on", "rule_value", "rule_na", "ok", "test", "rule", "off", "vintage", "published", "read", "mode", "weo_url", "iip_updated",
        "region", "subregion", "term", "what", "why", "calc", "formula", "thr", "ex", "series", "_long", "_missing"},
}
FREE_KEYS_VIEW: dict[str, re.Pattern] = {
    "earn": re.compile(r"^([A-Z]{2,3}|\d{4}|\d{4}-Q[1-4]|[A-Z0-9]+\.[A-Z_]+\.[A-Z]{3}|[A-Z][A-Z0-9_]{2,})$"),   # ISO3 and XM, years, quarters, GS.CD_T.USD, XDC
    "changes": FREE_KEYS,
    "episodes": re.compile(r"^([A-Z]{3}|[a-z]+-\d{4})$"),
    "sovereign": re.compile(r"^([A-Z]{3}|\d{4}|\d{4}-\d{2}|\d{4}-Q[1-4]|r[1-7]|w_[a-z0-9_]+|[a-z]{3}-[a-z0-9-]+|[A-Z][A-Z0-9_]{2,})$"),  # rules, glossary and episode ids, WEO codes
}
# The datasets each view of the surface carries: every class must be one that may be shown (the view objects carry no
# "ds" marker of their own, since their shapes are the fetchers' files).
VIEW_DATASETS = {"earn/global": ["wb.WDI", "imf.BOP", "imf.QNEA", "bis.XRU"], "sovereign/global": ["imf.WEO", "imf.IIP", "fred.observations"],
                 "changes/global": ["bis.LBS", "bis.DSS", "bis.CBS", "imf.IRFCL"], "episodes/global": []}


def gate(obj, path: str = "", in_funds: bool = False, dropped: list | None = None):
    """Return obj with keys outside the schema dropped; raise LicenceError on a value that may not be shown. The
    registries (sources, citations, method) are pointers and text, not data, and pass whole."""
    dropped = [] if dropped is None else dropped
    if path.startswith("registry/") and path.count("/") == 1:
        return obj
    if path in VIEW_DATASETS:
        for ds in VIEW_DATASETS[path]:
            cls = licence(ds)
            if not shown(cls):
                raise LicenceError(f"{path}: {ds} is {cls}, which may not be shown")
    root = path.split("/", 1)[0]
    schema = SCHEMA | SCHEMA_VIEW.get(root, set())
    free = FREE_KEYS_VIEW.get(root, FREE_KEYS)
    if isinstance(obj, dict):
        if "ds" in obj:
            cls = licence(obj["ds"], obj.get("key"))
            if not shown(cls):
                raise LicenceError(f"{path}: {obj['ds']} {obj.get('key') or ''} is {cls}, which may not be shown")
        out = {}
        for k, v in obj.items():
            if k in VENDOR_KEYS:
                raise LicenceError(f"{path}/{k}: commercial vendor data are not published (R14)")
            if k not in schema and not free.match(str(k)):
                gate(v, f"{path}/{k}", in_funds, [])  # a dropped field is still scanned: a licence breach stops the build
                dropped.append(f"{path}/{k}")
                continue
            out[k] = gate(v, f"{path}/{k}", in_funds, dropped)
        return out
    if isinstance(obj, list):
        return [gate(v, f"{path}[]", in_funds, dropped) for v in obj]
    return obj
