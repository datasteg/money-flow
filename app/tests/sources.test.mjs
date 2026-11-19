// Source links (check V17 on the page side): every source an Economy, World, Markets or Sovereign page names is a registry link that opens
// the publisher's page in a new tab, and no page renders an id the registry lacks (data-src-missing). The markets
// formatter is pinned too. The live checks run when MF_BASE_URL points at a running site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usdBn, usdTn, tnTile } from '../lib/format.ts';

test('markets: 억/조 in Korean, $bn/$tn in English, the same on every market', () => {
  assert.equal(usdBn(269.2, 'ko'), '2,692억 달러');
  assert.equal(usdBn(269.2, 'en'), '$269bn');
  assert.equal(usdBn(-1160.7, 'en', true), '−$1,161bn');
  assert.equal(usdTn(15045.4, 'ko'), '15.0조 달러');
  assert.equal(usdTn(15045.4, 'en'), '$15.0tn');
  assert.equal(usdTn(-2669.8, 'en', true), '−$2.7tn');
  assert.deepEqual(tnTile(17715.2, 'ko'), { value: '17.7', unit: '조 달러' });
});

const BASE = process.env.MF_BASE_URL;
const PAGES = ['/en/e/KOR', '/ko/e/KOR', '/en/e/USA', '/ko/e/DEU', '/en/world', '/ko/world', '/en/sovereign?e=KOR&k=4', '/ko/sovereign', '/en/m/equity', '/ko/m/equity', '/en/m/bonds', '/ko/m/bank', '/en/m/fdi', '/ko/m/fdi', '/en/sources', '/ko/sources'];
test('rendered pages: every source label is a registry link with a URL', { skip: !BASE }, async () => {
  for (const path of PAGES) {
    const html = await (await fetch(`${BASE}${path}`)).text();
    assert.doesNotMatch(html, /data-src-missing/, `${path}: a source id the registry lacks`);
    const links = [...html.matchAll(/<a [^>]*class="mf-srcl"[^>]*>/g)].map((m) => m[0]);
    assert.ok(links.length > 0, `${path}: no source links`);
    for (const a of links) {
      assert.match(a, /href="https:\/\/[^"]+"/, `${path}: ${a}`);
      assert.match(a, /target="_blank"/, `${path}: ${a}`);
      assert.match(a, /rel="noopener noreferrer"/, `${path}: ${a}`);
      assert.match(a, /aria-label="[^"]+ — (opens in new tab|새 탭에서 열림)"/, `${path}: ${a}`);
    }
    // a "Source:" / "자료:" footer is always followed by a link, never by plain text
    const text = html.replace(/<!--.*?-->/g, '');
    for (const m of text.matchAll(/(Source: |자료: |출처: )([^<]{0,3})</g)) assert.equal(m[2], '', `${path}: plain-text source after "${m[1]}"`);
  }
});
