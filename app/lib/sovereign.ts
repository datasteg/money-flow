// The Sovereign section (/[lang]/sovereign): the shape of the release file
// `sovereign/global` (scripts/sitebuild/sovereign.py, rules R22–R28, checks V24–V26), the view settings and their URL
// form, and the counting and validation the page recomputes in the browser. The arithmetic mirrors the build's
// count and validate functions (ported one-to-one from global-network's components/warning/model.ts on 2 Nov 2026);
// the release prints the default result in check V24, and the page must show the same numbers with the defaults.
import type { Lang } from './types';

export type RuleId = 'r1' | 'r2' | 'r3' | 'r4' | 'r5' | 'r6' | 'r7';
export const RULES: RuleId[] = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'];
/** The page's short rule ids against the method registry's (config/method.yaml, `sovereign.id`). */
export const REG: Record<RuleId, string> = { r1: 'R22', r2: 'R23', r3: 'R24', r4: 'R25', r5: 'R26', r6: 'R27', r7: 'R28' };
export const REG_RANGE = 'R22–R28';
export const CHECK_IDS = ['V24', 'V25', 'V26'];
export const DEFAULT_ECONOMY = 'KOR';

export interface RuleCfg { group: 'fiscal' | 'external' | 'market'; default: number; dir: 'ge' | 'le'; min: number; max: number; step: number; unit: 'pct_gdp' | 'pct' | 'pp'; source: string }
export interface NowVal { v: number | null; p: string | number | null; kind: 'year' | '12m' }
export interface SEcon {
  v: Record<RuleId, (number | null)[]>;
  na: Record<RuleId, boolean[]>;
  src: { r4: (string | null)[]; r5: (string | null)[] };
  x: { ca: (number | null)[]; i: (number | null)[]; g: (number | null)[]; pbstar: (number | null)[]; pb: (number | null)[]; interest: (number | null)[]; r7n: number[] };
  bench: string; eu: boolean; a2_na: boolean; r7_bench_self: boolean;
  spread: { t0: string | null; t1?: string; v: (number | null)[] };
  r7_id: string | null; r7_bench_id: string | null;
  now: Record<RuleId, NowVal | null>;
  counts: [number, number][];
  weo_update?: string | null;
}
export interface Episode { id: string; eco: string; type: 'imf' | 'eu' | 'default' | 'precautionary'; facility: string | null; start: string; end: string | null; end_kind: string | null; precision: string; en: string | null; ko: string | null; source: string | null; source2: string | null; note: string | null; creditor: string | null; before_sample: boolean }
export interface Spell { eco: string; start: string; end: string; y0: number; y1: number; ids: string[]; before_sample: boolean }
export interface ValidCfg { pre: [number, number]; calm_gap: number; global_years: number[]; merge_years: number }

/** A glossary card (config/sovereign_glossary.yaml, filled by the build): what, why, how it is calculated, the default
 *  threshold, an example from this release's data, and its sources as registry link ids (config/sources.yaml `links`). */
export interface Gloss { term: string; what: string; why?: string; read?: string; calc?: string; thr?: string; formula?: string; ex?: string; src: { src: string; series?: string[]; period?: string }[] }

/** What the browser needs to recount. */
export interface SovereignClient {
  years: number[]; proj0: number; last_actual: number;
  rules: Record<RuleId, RuleCfg>; K: { default: number; min: number; max: number };
  validation_cfg: ValidCfg; econ: Record<string, SEcon>; episodes: Episode[]; spells: Spell[];
  economies: string[]; names: Record<string, { en: string; ko: string }>;
  meta: { vintage: string; published: string; read: string };
}
/** The whole release file. */
export interface Sovereign extends SovereignClient {
  order: RuleId[];
  coverage: Record<string, Record<RuleId, { first?: number | null; last?: number | null; gaps?: number[][]; na?: boolean }>>;
  valid: Validation & { per: PerSpell[] };
  checks: { id: string; eco: string; en: string; ko: string; years: number[]; ok: boolean; rows: { y: number; k: number; n: number; on: RuleId[]; ok: boolean; rule_value?: number | null; rule_na?: boolean }[] }[];
  gloss: { en: Record<string, Gloss>; ko: Record<string, Gloss>; _long: [string, number][]; _missing: string[] };
  meta: SovereignClient['meta'] & { mode: string; weo_url: string; iip_updated: string };
}

/** The client's share of the file: no coverage report, checks or glossary (those render on the server). */
export function clientPart(d: Sovereign): SovereignClient {
  const { years, proj0, last_actual, rules, K, validation_cfg, econ, episodes, spells, economies, names, meta } = d;
  return { years, proj0, last_actual, rules, K, validation_cfg, econ, episodes, spells, economies, names, meta: { vintage: meta.vintage, published: meta.published, read: meta.read } };
}

// ---------------------------------------------------------------- settings and the URL
export interface Settings { e: string; thr: Record<RuleId, number>; off: RuleId[]; K: number }
/** The query keys the page writes; every other key (r = release, d = day) is carried through untouched. */
export const OWN_KEYS = ['e', ...RULES, 'off', 'k', 'y'];

export function defaults(d: SovereignClient, e = DEFAULT_ECONOMY): Settings {
  return { e, thr: Object.fromEntries(RULES.map((r) => [r, d.rules[r].default])) as Record<RuleId, number>, off: [], K: d.K.default };
}

/** e, r1..r7, off, k: the parameters global-network's /fiscal-stress carried (its 301 keeps the query). */
export function fromUrl(d: SovereignClient, search: string | URLSearchParams): Settings {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const s = defaults(d);
  const e = q.get('e')?.toUpperCase();
  if (e && d.econ[e]) s.e = e;
  for (const r of RULES) {
    const v = Number(q.get(r));
    const c = d.rules[r];
    if (q.has(r) && Number.isFinite(v)) s.thr[r] = Math.min(c.max, Math.max(c.min, v));
  }
  const off = (q.get('off') ?? '').split(',').filter((x): x is RuleId => (RULES as string[]).includes(x));
  s.off = off;
  const k = Number(q.get('k'));
  if (q.has('k') && Number.isInteger(k)) s.K = Math.min(d.K.max, Math.max(d.K.min, k));
  return s;
}

export function readYear(d: SovereignClient, search: string | URLSearchParams): number | null {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const v = Number(q.get('y'));
  return Number.isInteger(v) && d.years.includes(v) ? v : null;
}

/** Only what differs from the defaults goes into the URL (the economy whenever it is not the default). */
export function ownQuery(d: SovereignClient, s: Settings, y: number | null = null): URLSearchParams {
  const q = new URLSearchParams();
  if (s.e !== DEFAULT_ECONOMY) q.set('e', s.e);
  for (const r of RULES) if (s.thr[r] !== d.rules[r].default) q.set(r, String(s.thr[r]));
  if (s.off.length) q.set('off', s.off.join(','));
  if (s.K !== d.K.default) q.set('k', String(s.K));
  if (y != null) q.set('y', String(y));
  return q;
}

/** The page's query merged into the current one: the release (?r=) and anything else a reader arrived with stay. */
export function mergedSearch(d: SovereignClient, s: Settings, y: number | null, current: string): string {
  const q = new URLSearchParams(current);
  for (const k of OWN_KEYS) q.delete(k);
  for (const [k, v] of ownQuery(d, s, y)) q.set(k, v);
  const t = q.toString();
  return t ? `?${t}` : '';
}

// ---------------------------------------------------------------- counting
export type State = 'on' | 'off' | 'missing' | 'na' | 'disabled';

export function isOn(v: number, thr: number, dir: 'ge' | 'le'): boolean {
  return dir === 'ge' ? v >= thr : v <= thr;
}

export function stateAt(d: SovereignClient, e: SEcon, r: RuleId, j: number, s: Settings): State {
  if (s.off.includes(r)) return 'disabled';
  if (e.na[r][j]) return 'na';
  const v = e.v[r][j];
  if (v == null) return 'missing';
  return isOn(v, s.thr[r], d.rules[r].dir) ? 'on' : 'off';
}

export function countAt(d: SovereignClient, e: SEcon, j: number, s: Settings): { k: number; n: number; on: RuleId[] } {
  const on: RuleId[] = [];
  let n = 0;
  for (const r of RULES) {
    const st = stateAt(d, e, r, j, s);
    if (st === 'on' || st === 'off') n += 1;
    if (st === 'on') on.push(r);
  }
  return { k: on.length, n, on };
}

export function nowState(d: SovereignClient, e: SEcon, r: RuleId, s: Settings): State {
  if (s.off.includes(r)) return 'disabled';
  if (r === 'r6' && e.a2_na) return 'na';
  if (r === 'r7' && e.r7_bench_self) return 'na';
  const nv = e.now[r];
  if (!nv || nv.v == null) return 'missing';
  return isOn(nv.v, s.thr[r], d.rules[r].dir) ? 'on' : 'off';
}

export function nowCount(d: SovereignClient, e: SEcon, s: Settings): { k: number; n: number; on: RuleId[] } {
  const on: RuleId[] = [];
  let n = 0;
  for (const r of RULES) {
    const st = nowState(d, e, r, s);
    if (st === 'on' || st === 'off') n += 1;
    if (st === 'on') on.push(r);
  }
  return { k: on.length, n, on };
}

// ---------------------------------------------------------------- validation (mirrors the build's validate; check V24–V25)
export interface Validation { episodes: number; scored: number; hits: number; hit_rate: number | null; calm: number; alarms: number; false_rate: number | null; pos_years: number; auroc: number | null }
export interface PerSpell { eco: string; start: string; data: boolean; hit?: boolean; max?: number }

export function auroc(pos: number[], neg: number[]): number | null {
  if (!pos.length || !neg.length) return null;
  // counts are small integers: tally instead of comparing every pair
  const hn = new Map<number, number>();
  for (const x of neg) hn.set(x, (hn.get(x) ?? 0) + 1);
  const keys = [...hn.keys()].sort((a, b) => a - b);
  let gt = 0, eq = 0;
  for (const p of pos) for (const k of keys) { const c = hn.get(k)!; if (p > k) gt += c; else if (p === k) eq += c; }
  return (gt + 0.5 * eq) / (pos.length * neg.length);
}

export function validate(d: SovereignClient, s: Settings): Validation & { per: PerSpell[] } {
  const v = d.validation_cfg;
  const [a, b] = v.pre;
  const gy = new Set(v.global_years);
  const yi = new Map(d.years.map((y, j) => [y, j]));
  const cache = new Map<string, { k: number; n: number }[]>();
  const counts = (eco: string) => {
    let c = cache.get(eco);
    if (!c) { const e = d.econ[eco]; c = d.years.map((_, j) => countAt(d, e, j, s)); cache.set(eco, c); }
    return c;
  };
  let hits = 0, scored = 0, alarms = 0;
  const pos: number[] = [], neg: number[] = [], per: PerSpell[] = [];
  for (const sp of d.spells) {
    if (sp.before_sample || !d.econ[sp.eco]) continue;
    const c = counts(sp.eco);
    const have: number[] = [];
    for (let y = sp.y0 - b; y <= sp.y0 - a; y++) {
      if (y < d.years[0] || y > d.last_actual) continue;
      if (c[yi.get(y)!].n > 0) have.push(y);
    }
    if (!have.length) { per.push({ eco: sp.eco, start: sp.start, data: false }); continue; }
    scored += 1;
    const ks = have.map((y) => c[yi.get(y)!].k);
    const hit = ks.some((k) => k >= s.K);
    hits += hit ? 1 : 0;
    pos.push(...ks);
    per.push({ eco: sp.eco, start: sp.start, data: true, hit, max: Math.max(...ks) });
  }
  let calm = 0;
  for (const eco of Object.keys(d.econ)) {
    const own = d.spells.filter((x) => x.eco === eco);
    const c = counts(eco);
    d.years.forEach((y, j) => {
      if (y > d.last_actual || gy.has(y) || c[j].n === 0) return;
      if (own.some((x) => x.y0 - v.calm_gap <= y && y <= x.y1 + v.calm_gap)) return;
      calm += 1;
      neg.push(c[j].k);
      if (c[j].k >= s.K) alarms += 1;
    });
  }
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const au = auroc(pos, neg);
  return { episodes: d.spells.filter((x) => !x.before_sample).length, scored, hits, hit_rate: scored ? r1((100 * hits) / scored) : null,
    calm, alarms, false_rate: calm ? r1((100 * alarms) / calm) : null, pos_years: pos.length, auroc: au == null ? null : Math.round(au * 1000) / 1000, per };
}

// ---------------------------------------------------------------- dates for the bands
/** A date "2010-05-09" as a fractional year (2010.35). */
export function fy(iso: string): number {
  const [y, m = 1, dd = 1] = iso.split('-').map(Number);
  return y + (m - 1) / 12 + (dd - 1) / 365;
}

/** "IMF WEO, October 2026" / "IMF WEO 2026년 10월" from the vintage "2026-10". */
export function vintageLabel(vintage: string, lang: Lang): string {
  const [y, m] = vintage.split('-').map(Number);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return lang === 'ko' ? `IMF WEO ${y}년 ${m}월` : `IMF WEO, ${MONTHS[m - 1]} ${y}`;
}
