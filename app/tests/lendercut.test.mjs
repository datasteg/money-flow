// "Cut a lender" (R21) on a hand-made lender_cut object in the shape the surface contract gives for mkt/bank.lender_cut.
// Run: node --test tests/ (Node strips the TypeScript types).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampCut, cutByDebtor, cutByLender, debtors, lenders } from '../lib/lendercut.ts';

const lc = {
  q: '2026-06-30',
  debtors: {
    TUR: { claims_usd: 123.4, res_net: 45.6, lenders: { GBR: 44.7, USA: 10.7, DEU: 8.1 } },
    ARG: { claims_usd: 30, res_net: null, lenders: { USA: 50, ESP: 25 } },
    KOR: { claims_usd: 200, res_net: 400, lenders: { USA: 30, GBR: 20, JPN: 15 } },
    EMPTY: { claims_usd: 0, res_net: 10, lenders: {} },
  },
};

test('loss = cut × share × claims, against the debtor’s net reserves', () => {
  const rows = cutByDebtor(lc, 'TUR', 30);
  assert.deepEqual(rows.map((r) => r.eco), ['GBR', 'USA', 'DEU']);
  const gbr = rows[0];
  assert.ok(Math.abs(gbr.loss - 0.3 * 0.447 * 123.4) < 1e-9);            // 16.55 bn
  assert.ok(Math.abs(gbr.of_res - (100 * gbr.loss) / 45.6) < 1e-9);       // 36.3% of net reserves
  assert.equal(gbr.res_net, 45.6);
});

test('by lender: every debtor it lends to, largest share of reserves first, no-reserve debtors last', () => {
  const rows = cutByLender(lc, 'USA', 50);
  assert.deepEqual(rows.map((r) => r.eco), ['TUR', 'KOR', 'ARG']);       // TUR 14.5% > KOR 7.5% > ARG (null)
  assert.equal(rows[2].of_res, null);
  assert.ok(Math.abs(rows[2].loss - 0.5 * 0.5 * 30) < 1e-9);
  assert.deepEqual(cutByLender(lc, 'NOBODY', 30), []);
});

test('selectors leave out empty debtors and rank lenders by what they would cut', () => {
  assert.deepEqual(debtors(lc), ['KOR', 'TUR', 'ARG']);
  assert.deepEqual(lenders(lc).slice(0, 2), ['GBR', 'USA']);              // GBR 55.2+40 = 95.2 > USA 13.2+15+60 = 88.2
  assert.equal(cutByDebtor(lc, 'XXX', 30).length, 0);
});

test('the cut stays on the slider’s 10–50% grid', () => {
  assert.equal(clampCut('30'), 30);
  assert.equal(clampCut('7'), 10);
  assert.equal(clampCut('99'), 50);
  assert.equal(clampCut('33'), 35);
  assert.equal(clampCut('abc'), 30);
  assert.equal(clampCut(undefined), 30);
});

test('method 1.6: losses against net reserves without the floor; all-instrument reporters apart, no share', async () => {
  const { allInstrument, netReserves } = await import('../lib/lendercut.ts');
  const v16 = { q: '2026-06-30', debtors: {
    ARG: { claims_usd: 30, res_net: 4.5, res_net_raw: -23.6, lenders: { USA: 50 }, all_instr: {} },
    KOR: { claims_usd: 162.5, res_net: 400, res_net_raw: 400, lenders: { USA: 23.3 }, all_instr: { JPN: 38.8, DEU: 9.0 } },
  } };
  assert.equal(netReserves(v16.debtors.ARG), -23.6);
  assert.equal(cutByDebtor(v16, 'ARG', 30)[0].of_res, null);              // negative net reserves: no ratio, never the floored base
  assert.deepEqual(allInstrument(v16, 'KOR'), [['JPN', 38.8], ['DEU', 9.0]]);
  assert.ok(!cutByDebtor(v16, 'KOR', 30).some((r) => r.eco === 'JPN'));   // listed apart, never cut as a share
  assert.equal(netReserves(lc.debtors.TUR), 45.6);                         // an older release: its only figure
});
