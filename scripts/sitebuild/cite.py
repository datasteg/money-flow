"""Dataset and method citations, as plain text, BibTeX (@misc, for natbib, the AEA templates and biblatex alike) and
RIS, in English and Korean, all from the registries. View citations are made in the app from the
release manifest, with the same shapes (app/lib/citation.ts); the two are tested against fixed strings.

The author is always the organisation: the dataset's publisher, or "datasteg" for views and the method. No personal
name appears.
"""
from __future__ import annotations

import datetime as dt

from .registry import METHOD, SOURCES

SITE = "https://money-flow.datasteg.com"
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def long_date(iso: str, lang: str) -> str:
    d = dt.date.fromisoformat(iso)
    return f"{d.year}년 {d.month}월 {d.day}일" if lang == "ko" else f"{d.day} {MONTHS[d.month - 1]} {d.year}"


def tex(s: str) -> str:
    return s.replace("\\", "").replace("{", "").replace("}", "").replace("&", r"\&").replace("%", r"\%").replace("_", r"\_").replace("#", r"\#")


def bibtex(key: str, fields: list[tuple[str, str]]) -> str:
    return "@misc{" + key + ",\n" + ",\n".join(f"  {k.ljust(12)} = {{{v}}}" for k, v in fields) + "\n}"


def ris(fields: list[tuple[str, str]]) -> str:
    return "\n".join(f"{k}  - {v}" for k, v in [("TY", "DATA")] + fields + [("ER", "")])


def dataset(ds: str, vintage: str, lang: str) -> dict:
    """The citation of one dataset as retrieved on its vintage date."""
    e = SOURCES["datasets"][ds]
    pub = SOURCES["publishers"][e["publisher"]]
    name, title = pub[lang], e[lang]
    year = vintage[:4]
    if lang == "ko":
        text = f"{name} ({year}), 「{title}」, {long_date(vintage, 'ko')} 수집, {e['landing']}."
    else:
        text = f"{name} ({year}), {title}, retrieved {long_date(vintage, 'en')}, {e['landing']}."
    if ds == "fred.observations":
        text = text[:-1] + (", FRED 경유." if lang == "ko" else ", via FRED, Federal Reserve Bank of St. Louis.")
    key = "src:" + ds.replace(".", "-") + ":" + vintage.replace("-", "")
    b = bibtex(key, [("author", "{" + tex(pub["en"] if lang == "en" else name) + "}"), ("title", tex(title)), ("year", year),
                     ("howpublished", tex(e["landing"])), ("urldate", vintage), ("note", tex(("retrieved " if lang == "en" else "수집 ") + long_date(vintage, lang)))])
    r = ris([("AU", pub["en"] if lang == "en" else name), ("TI", title), ("PY", year), ("UR", e["landing"]), ("Y2", vintage)])
    return {"text": text, "bibtex": b, "ris": r, "credit": credit(ds, lang)}


def credit(ds: str, lang: str) -> str:
    """The short source line a publisher asks for ("Source: BIS", "출처: 한국은행 ECOS")."""
    e = SOURCES["datasets"][ds]
    pub = SOURCES["publishers"][e["publisher"]]
    short = e["short"] if lang == "en" else (e["ko"] if e["publisher"] == "bok" else e["short"])
    return short if lang == "en" else short


def method(lang: str, date: str | None = None) -> dict:
    v, d = METHOD["version"], date or str(METHOD["date"])
    title = "Money-flow methodology" if lang == "en" else "money-flow 방법론"
    url = f"{SITE}/{lang}/method?v={v}"
    if lang == "ko":
        text = f"datasteg ({d[:4]}), 「{title}」, 버전 {v}, datasteg money-flow, {long_date(d, 'ko')}, {url}."
    else:
        text = f"datasteg ({d[:4]}), “{title}”, version {v}, datasteg money-flow, {long_date(d, 'en')}, {url}."
    b = bibtex(f"datasteg:mf:method:{v}", [("author", "{datasteg}"), ("title", title), ("howpublished", f"datasteg money-flow, version {v}"),
                                           ("year", d[:4]), ("date", d), ("url", url), ("urldate", d)])
    r = ris([("AU", "datasteg"), ("TI", title), ("PY", d[:4]), ("ET", v), ("PB", "datasteg money-flow"), ("UR", url), ("Y2", d)])
    return {"text": text, "bibtex": b, "ris": r}


def citations(vintages: dict[str, str]) -> dict:
    """All dataset citations for the vintages of a release, and the method's, in both languages."""
    out = {"datasets": {}, "method": {lang: method(lang) for lang in ("en", "ko")}}
    for ds, e in SOURCES["datasets"].items():
        if e.get("planned"):
            continue
        v = vintages.get(ds) or next((vv for d, vv in sorted(vintages.items()) if d.startswith(ds + ".")), None)
        if v:
            out["datasets"][ds] = {lang: dataset(ds, v, lang) for lang in ("en", "ko")}
    return out
