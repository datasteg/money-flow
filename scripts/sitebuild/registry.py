"""The two registries (config/sources.yaml, config/method.yaml) and the decorators that tie code to them.

    @rule("R4")   a function that applies rule R4; it records what it did with effect(...)
    @check("V3")  a function that runs check V3 and returns a Result

completeness() lists every mismatch between the registries and the code (a rule or check without a function, a function
for an id that is not registered, a rule whose tests do not exist); the build stops on any of them.
"""
from __future__ import annotations

import functools
import hashlib
import re
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parents[2]
CONFIG = HERE / "config"
SITE_CODE = Path(__file__).resolve().parent

SOURCES = yaml.safe_load((CONFIG / "sources.yaml").read_text(encoding="utf-8"))
METHOD = yaml.safe_load((CONFIG / "method.yaml").read_text(encoding="utf-8"))
DATASETS = yaml.safe_load((CONFIG / "datasets.yaml").read_text(encoding="utf-8"))

RULES: dict[str, callable] = {}
CHECKS: dict[str, callable] = {}
EFFECTS: dict[str, dict] = {}


def rule(rid: str):
    def deco(fn):
        RULES[rid] = fn
        fn.rule_id = rid

        @functools.wraps(fn)
        def run(*a, **k):
            return fn(*a, **k)
        run.rule_id = rid
        return run
    return deco


def check(cid: str):
    def deco(fn):
        CHECKS[cid] = fn
        fn.check_id = cid
        return fn
    return deco


def effect(rid: str, what: str, n: int | float) -> None:
    """Record what a rule did in this build ("R4", "pair reports dropped", 12345); the Method page prints these."""
    EFFECTS.setdefault(rid, {})
    EFFECTS[rid][what] = EFFECTS[rid].get(what, 0) + n


def dataset(ds: str) -> dict:
    """The registry entry of a dataset id; an id below a registered one (imf.IIP.x) falls back to that family."""
    d = SOURCES["datasets"]
    while ds not in d and "." in ds:
        ds = ds.rsplit(".", 1)[0]
    return d.get(ds) or {}


def licence(ds: str, key: str | None = None) -> str:
    """The licence class of one series: the dataset's, unless the registry overrides that key (FRED's re-hosted series)."""
    e = dataset(ds)
    if not e:
        return "unregistered"
    k = (e.get("keys") or {}).get(key or "", {})
    return k.get("class") or e.get("class", "unregistered")


def publisher(ds: str, key: str | None = None) -> dict:
    e = dataset(ds)
    k = (e.get("keys") or {}).get(key or "", {})
    return SOURCES["publishers"].get(k.get("publisher") or e.get("publisher"), {})


def shown(cls: str) -> bool:
    return bool(SOURCES["classes"].get(cls, {}).get("shown"))


def code_hash() -> str:
    """The hash of the site build's code and registries; a release records it so V10 can tell a code change from an
    unexplained one."""
    h = hashlib.sha256()
    for p in sorted(SITE_CODE.glob("*.py")) + [CONFIG / "sources.yaml", CONFIG / "method.yaml", CONFIG / "datasets.yaml",
                                                CONFIG / "sovereign.yaml", CONFIG / "sovereign_episodes.yaml", CONFIG / "sovereign_glossary.yaml",
                                                HERE / "scripts" / "build_site_data.py"]:
        h.update(p.name.encode())
        h.update(p.read_bytes())
    return h.hexdigest()[:16]


def completeness() -> list[str]:
    """Every gap between method.yaml, the registered functions and the tests."""
    problems = []
    tests = "\n".join(p.read_text(encoding="utf-8") for p in (HERE / "tests").glob("test_*.py"))
    for rid, r in METHOD["rules"].items():
        if rid not in RULES:
            problems.append(f"{rid} has no @rule function")
        for t in r.get("tests") or []:
            if not re.search(rf"def {re.escape(t)}\(", tests):
                problems.append(f"{rid}: test {t} does not exist")
        if not r.get("tests"):
            problems.append(f"{rid} lists no test")
    for rid in RULES:
        if rid not in METHOD["rules"]:
            problems.append(f"@rule({rid}) is not in method.yaml")
    for cid in METHOD["checks"]:
        if cid not in CHECKS:
            problems.append(f"{cid} has no @check function")
    for cid in CHECKS:
        if cid not in METHOD["checks"]:
            problems.append(f"@check({cid}) is not in method.yaml")
    for ds, e in SOURCES["datasets"].items():
        if e.get("planned"):
            continue
        for f in ("publisher", "class", "short", "en", "ko", "landing", "cadence", "lag_days"):
            if not e.get(f):
                problems.append(f"sources.yaml {ds}: no {f}")
    return problems
