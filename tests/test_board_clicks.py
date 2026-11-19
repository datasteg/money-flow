"""The Signal Board's markers (method 1.3 review, task 3): a click on any marker opens that economy in the detail panel,
whatever is drawn on top of it (markers whose centres coincide: within as many clicks as there are markers there), at phone, tablet and desktop widths, in the newest quarter and in a sample of past ones.
Circles overlap, so the board sends a pointer event to the marker whose centre is nearest; this test clicks every
marker's centre with the mouse, as a reader would, and reads the panel's heading.

Runs only against a live site and with Playwright installed:
    MF_BASE_URL=http://localhost:3007 uv run --with pytest --with playwright==1.62.0 -m pytest tests/test_board_clicks.py"""
from __future__ import annotations

import os

import pytest

BASE = os.environ.get("MF_BASE_URL")
pw = pytest.importorskip("playwright.sync_api") if BASE else None


@pytest.mark.skipif(not BASE, reason="MF_BASE_URL not set")
@pytest.mark.parametrize("width", [390, 1024, 1280, 1440])
def test_every_marker_click_opens_its_economy(width):
    with pw.sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": width, "height": 1000})
        pg.goto(f"{BASE}/en/world", wait_until="networkidle")
        rng = pg.locator("input.mf-board__range")
        last = int(rng.get_attribute("max"))
        wrong = []
        for qi in sorted({last, last - 1, last - 8, last // 2, 12}):
            rng.fill(str(qi))
            circles = pg.locator("g.mf-board__dot circle").all()
            at = {el.get_attribute("data-eco"): (float(el.get_attribute("cx")), float(el.get_attribute("cy"))) for el in circles}
            for el in circles:
                eco = el.get_attribute("data-eco")
                name = el.get_attribute("aria-label").split(":")[0]
                # markers whose centres coincide (within 2 px) are one place: repeat clicks there cycle through them
                twins = [o for o, (x, y) in at.items() if o != eco and abs(x - at[eco][0]) <= 2 and abs(y - at[eco][1]) <= 2]
                el.evaluate("e => e.scrollIntoView({block: 'center'})")          # as a reader would: on screen, clear of the sticky bars
                bb = el.bounding_box()
                for _ in range(1 + len(twins)):
                    pg.mouse.click(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
                    got = pg.locator(".mf-board__detail h3").inner_text()
                    if got == name:
                        break
                if got != name:
                    wrong.append((qi, eco, got, twins))
            # keyboard: Enter on a focused marker selects it too
            first = pg.locator("g.mf-board__dot circle").first
            first.focus()
            pg.keyboard.press("Enter")
            assert pg.locator(".mf-board__detail h3").inner_text() == first.get_attribute("aria-label").split(":")[0]
        b.close()
    assert not wrong, f"{len(wrong)} marker clicks opened another economy: {wrong[:10]}"


@pytest.mark.skipif(not BASE, reason="MF_BASE_URL not set")
def test_snapshot_filters_follow_and_play():
    """The board's controls: a quarter picked in the select is the snapshot drawn and written to the URL; the group and
    region filters hide the other economies; following economies draws their fading tails; Play is off until one is
    followed and then moves the quarter on; a URL with the board's state reproduces it."""
    with pw.sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1440, "height": 1000})
        pg.goto(f"{BASE}/en/world", wait_until="networkidle")
        play = pg.locator(".mf-board__ctl button[aria-pressed]")
        assert play.is_disabled()                                              # nothing followed: no Play
        pg.locator(".mf-board__qsel select").select_option("2013-09-30")
        assert pg.locator(".mf-board__range").get_attribute("aria-valuetext") == "Q3 2013"
        assert "bq=2013-09-30" in pg.url
        pg.get_by_role("button", name="Next quarter").click()
        assert pg.locator(".mf-board__range").get_attribute("aria-valuetext") == "Q4 2013"
        total = pg.locator("g.mf-board__dot").count()
        pg.get_by_role("radio", name="Emerging").click()
        em = {e.get_attribute("data-eco") for e in pg.locator("g.mf-board__dot circle").all()}
        assert 0 < len(em) < total and "DEU" not in em and "BRA" in em
        pg.select_option("#mf-board-region", "Asia")
        asia = {e.get_attribute("data-eco") for e in pg.locator("g.mf-board__dot circle").all()}
        assert asia and asia <= em and "BRA" not in asia
        pg.select_option("#mf-board-region", "all")
        pg.get_by_role("radio", name="All").click()
        for e in ("KOR", "TUR"):
            pg.select_option("#mf-board-follow", e)
        assert pg.locator(".mf-board__chip").count() == 2
        assert pg.locator(".mf-board__tail line").count() > 4                   # tails behind both followed economies
        assert "bf=KOR%2CTUR" in pg.url or "bf=KOR,TUR" in pg.url
        before = pg.locator(".mf-board__range").get_attribute("value")
        assert not play.is_disabled()
        play.click()
        pg.wait_for_timeout(2200)
        play.click()
        assert int(pg.locator(".mf-board__range").get_attribute("value")) > int(before)
        # a shared URL reproduces the snapshot
        pg.goto(f"{BASE}/en/world?bq=2008-12-31&bf=BRA&bg=em&bs=out", wait_until="networkidle")
        assert pg.locator(".mf-board__range").get_attribute("aria-valuetext") == "Q4 2008"
        assert pg.locator(".mf-board__chip").count() == 1
        assert pg.locator(".mf-board__filters [role=radio][aria-checked=true]").inner_text() == "Emerging"
        b.close()
