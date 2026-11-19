"""No console errors on any page type, in both languages: React's key and style warnings included. React prints those
only in development, so point MF_BASE_URL at a dev server (`pnpm dev`, port 3007) for the full check; against the
live site it still catches runtime errors.

    MF_BASE_URL=http://localhost:3007 uv run --with pytest --with playwright==1.62.0 -m pytest tests/test_console_clean.py"""
from __future__ import annotations

import os

import pytest

BASE = os.environ.get("MF_BASE_URL")
pw = pytest.importorskip("playwright.sync_api") if BASE else None
PAGES = ["/en/world", "/ko/world", "/en/world?bf=KOR,TUR&bq=2008-12-31", "/en/e/KOR", "/ko/e/KOR", "/en/e/USA?dir=out", "/en/m/equity",
         "/ko/m/bonds", "/en/m/bank", "/en/m/fdi", "/ko/m/fdi", "/en/method", "/ko/sources", "/en/checks", "/en/releases"]


@pytest.mark.skipif(not BASE, reason="MF_BASE_URL not set")
def test_no_console_errors():
    bad = []
    with pw.sync_playwright() as p:
        for path in PAGES:                                   # a fresh browser per page: React prints a warning once per page
            b = p.chromium.launch()
            pg = b.new_page(viewport={"width": 1440, "height": 1000})
            errs = []
            # the visitor counter (stats.datasteg.com) answers 400 to a headless browser, a bot: not a site error
            pg.on("console", lambda m: errs.append(m.text[:200]) if m.type == "error" and not (
                m.text.startswith("Failed to load resource") and "stats.datasteg.com" in (m.location or {}).get("url", "")) else None)
            pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
            pg.goto(f"{BASE}{path}", wait_until="networkidle")
            pg.wait_for_timeout(500)
            bad += [(path, e) for e in errs]
            b.close()
    assert not bad, bad
