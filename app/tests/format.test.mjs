// The amount formatter (lib/format.ts): USD bn in English, 억 달러 in Korean, 조 only in headlines; and the rule that no
// page prints a number followed by "10억 달러". The live check runs when MF_BASE_URL points at a running site
// (e.g. MF_BASE_URL=http://127.0.0.1:3007 node --test tests/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { amt, amtWhole, csvAmt, money, tile, tn, unit } from '../lib/format.ts';

test('Korean: USD bn × 10 as whole 억 달러, thousands separated', () => {
  assert.equal(money(14747.7, 'ko'), '147,477억 달러');
  assert.equal(money(35096.3, 'ko'), '350,963억 달러');
  assert.equal(money(5216.5, 'ko'), '52,165억 달러');
  assert.equal(money(58425.6, 'ko'), '584,256억 달러');
  assert.equal(money(994.4, 'ko'), '9,944억 달러');
  assert.equal(amt(15045.4, 'ko'), '150,454');
  assert.equal(money(-1.23, 'ko', true), '−12억 달러');
  assert.equal(money(0.35, 'ko', true), '+4억 달러');
  assert.equal(money(null, 'ko'), '–');
});

test('Korean: 조 in headline sentences only', () => {
  assert.equal(tn(14747.7, 'ko'), '14.7조 달러');
  assert.equal(tn(35096.3, 'ko'), '35.1조 달러');
});

test('English stays in bn and tn', () => {
  assert.equal(money(14747.7, 'en'), '14,747.7 bn');
  assert.equal(amt(994.4, 'en'), '994.4');
  assert.equal(tn(14747.7, 'en'), '14.7 tn');
  assert.equal(amtWhole(1234.5, 'en'), '1,235');
});

test('units, stat tiles and CSV values agree with what is shown', () => {
  assert.equal(unit('ko'), '억 달러');
  assert.equal(unit('en'), 'USD bn');
  assert.deepEqual(tile(1981.9, 'ko'), { value: '19,819', unit: '억 달러' });
  assert.deepEqual(tile(1981.9, 'en'), { value: '1,981.9', unit: 'bn' });
  assert.equal(csvAmt(1981.94, 'ko'), 19819);
  assert.equal(csvAmt(1981.94, 'en'), 1981.9);
});

test('no source file writes the unit "10억"', () => {
  const root = new URL('..', import.meta.url).pathname;
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|mjs)$/.test(f)) files.push(p); } };
  for (const d of ['app', 'components', 'lib']) walk(join(root, d));
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /10억/, f);
});

const BASE = process.env.MF_BASE_URL;
test('rendered /ko pages: no number followed by the unit "10억 달러"', { skip: !BASE }, async () => {
  for (const path of ['/ko/e/KOR', '/ko/e/KOR?dir=out', '/ko/e/USA?w=flow', '/ko/m/equity', '/ko/m/bank', '/ko/world', '/ko/method']) {
    const html = await (await fetch(`${BASE}${path}`)).text();
    const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, '');
    // "14,747.7 10억 달러", "14,747.710억 달러" (the DOM text of a number and a separate unit), "58,425.6(10억 달러)",
    // and the bare unit in a title ("…, 10억 달러"). Whole 억 amounts such as "410억 달러", or a 1.0 bn position shown as
    // ": 10억 달러", are correct and pass.
    for (const s of [text, html]) {
      assert.doesNotMatch(s, /\d(\s+|\()10억/, path);
      assert.doesNotMatch(s, /\.\d+10억/, path);
      assert.doesNotMatch(s, /[,(]\s*10억\s*달러/, path);
    }
  }
});
