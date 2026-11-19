// "Cut a lender" (rule R21): from mkt/bank.lender_cut, the loss a debtor would take if one of
// its bank lenders cut its claims by a share, against the debtor's net reserves (IRFCL Section I + II without A2's floor,
// `res_net_raw`, method 1.6; no ratio where they are zero or below). Reporters that publish all instruments only for the
// debtor (no loans-and-deposits split, R5) are listed apart with their amount and have no share (allInstrument()).
//   loss = cut × share × claims        (cut and share in %, claims in USD bn → loss in USD bn)
// The release carries claims, net reserves and lender shares; the browser only scales. Pure functions, tested in
// tests/lendercut.test.mjs with a hand-made object (the live field arrives with the data agent's release).
import type { LenderCut } from './types';

export type CutBy = 'lender' | 'debtor';
export interface CutRow { eco: string; share: number; claims: number; loss: number; res_net: number | null; of_res: number | null }

export const CUT_MIN = 10, CUT_MAX = 50, CUT_STEP = 5, CUT_DEFAULT = 30;

export function clampCut(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return CUT_DEFAULT;
  return Math.min(CUT_MAX, Math.max(CUT_MIN, Math.round(n / CUT_STEP) * CUT_STEP));
}

/** Debtors with claims and at least one lender share, largest claims first. */
export function debtors(lc: LenderCut): string[] {
  return Object.entries(lc.debtors).filter(([, d]) => d.claims_usd > 0 && Object.keys(d.lenders).length).sort((a, b) => b[1].claims_usd - a[1].claims_usd).map(([c]) => c);
}

/** Every lender named for any debtor, by the sum of the claims it would be cutting (share × claims), largest first. */
export function lenders(lc: LenderCut): string[] {
  const tot = new Map<string, number>();
  for (const d of Object.values(lc.debtors)) for (const [l, s] of Object.entries(d.lenders)) tot.set(l, (tot.get(l) ?? 0) + (s / 100) * d.claims_usd);
  return [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/** The debtor's net reserves: `res_net_raw` (method 1.6); a release before it carried only A2's reserve base. */
export const netReserves = (d: LenderCut['debtors'][string]): number | null => (d.res_net_raw !== undefined ? d.res_net_raw : d.res_net);

/** The reporters listed apart for a debtor (all instruments only, USD bn), largest first; none in releases before 1.6. */
export function allInstrument(lc: LenderCut, debtor: string): [string, number][] {
  return Object.entries(lc.debtors[debtor]?.all_instr ?? {}).sort((a, b) => b[1] - a[1]);
}

const row = (eco: string, share: number, claims: number, res_net: number | null, cut: number): CutRow => {
  const loss = (cut / 100) * (share / 100) * claims;
  return { eco, share, claims, loss, res_net, of_res: res_net && res_net > 0 ? (100 * loss) / res_net : null };
};

/** By debtor: each of the debtor's lenders cut by `cut`%, the loss against the debtor's own net reserves. */
export function cutByDebtor(lc: LenderCut, debtor: string, cut: number): CutRow[] {
  const d = lc.debtors[debtor];
  if (!d) return [];
  return Object.entries(d.lenders).map(([l, s]) => row(l, s, d.claims_usd, netReserves(d), cut)).sort((a, b) => b.loss - a.loss);
}

/** By lender: one lender cuts every debtor by `cut`%; each debtor's loss against its own net reserves, the largest
 *  share of reserves first (debtors without net reserves come last, by loss). */
export function cutByLender(lc: LenderCut, lender: string, cut: number): CutRow[] {
  const rows: CutRow[] = [];
  for (const [c, d] of Object.entries(lc.debtors)) { const s = d.lenders[lender]; if (s != null && d.claims_usd > 0) rows.push(row(c, s, d.claims_usd, netReserves(d), cut)); }
  return rows.sort((a, b) => (b.of_res ?? -1) - (a.of_res ?? -1) || b.loss - a.loss);
}
