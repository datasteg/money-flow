// The internal views for the datasteg API and MCP service (the API service contract; route handlers in app/svc/v1).
// Page parity: every view returns only what a money-flow page draws, built with the readers the pages use (lib/data.ts,
// lib/model.ts, lib/lendercut.ts, lib/sovereign.ts) from the release the page would serve (?release= here, ?r= there).
// The short keys of the release files (f, ds, pts, g, ...) become the documented field names below; amounts are USD bn.
// Licence (V11, R14): sources only of a class that may be shown; no daily, weekly or monthly run longer than 13
// observations (the World pulse's open weekly series: 53); nothing from a vendor. tests/test_svc_v11.py checks every view.
// Korean: none is written here. Economy names come from the release (meta.economies[*].ko); every other text is English.
import { latestTag, manifest, meta as readMeta, read, releases } from './data';
import { at, period } from './format';
import { t } from './i18n';
import { allInstrument, clampCut, cutByDebtor, cutByLender, debtors as cutDebtors, netReserves, type CutRow } from './lendercut';
import { build, ladderAt, newestPeriod, params as pageParams, type ViewModel } from './model';
import measures from './measures.json';
import { SITE } from './seo';
import { RULES, REG, countAt, defaults as sovDefaults, nowCount, nowState, vintageLabel, type RuleId, type Sovereign } from './sovereign';
import { SvcFail } from './svc';
import type { Board, Checks, Econ, Lang, LenderCut, Manifest, Market, Meta, Pt, SourcesRegistry, World } from './types';

const EN = t('en');
// Names from the measures registry (lib/measures.json, the copy of the registry the
// datasteg sites share; standing rule C1): the API calls each measure by its registry name.
const REGISTRY = (measures as { measures: Record<string, { name: { en: string } }> }).measures;
const mName = (id: string) => REGISTRY[id]?.name.en ?? id;
const M = Object.fromEntries(['a2', 'bank_claims_short_term', 'net_reserves', 'a2_reserve_base', 'bank_loans_lbs', 'bank_claims_foreign_ur', 'gdp_bis', 'gdp_weo']
  .map((id) => [id, mName(id)])) as Record<'a2' | 'bank_claims_short_term' | 'net_reserves' | 'a2_reserve_base' | 'bank_loans_lbs' | 'bank_claims_foreign_ur' | 'gdp_bis' | 'gdp_weo', string>;
const TAG = /^\d{8}\.\d+$/;
const ISO3 = /^[A-Z]{3}$/;

// ---------------------------------------------------------------- the call: language, release, envelope

export interface Ctx { url: URL; lang: Lang; m: Manifest; latest: string; meta: Meta; reg: SourcesRegistry }

export function context(req: Request): Ctx {
  const url = new URL(req.url);
  const lang: Lang = url.searchParams.get('lang') === 'ko' ? 'ko' : 'en';
  const want = (url.searchParams.get('release') ?? '').trim();
  if (want && !TAG.test(want)) throw bad('release', `"${cut(want)}" is not a release tag. Tags look like 20261109.1; GET /v1/money-flow/releases lists them, and leaving release out gives the latest.`);
  const m = manifest(want || null);
  if (want && m.tag !== want) throw new SvcFail(404, 'unknown-release', 'Unknown release', `Release ${want} is not kept. GET /v1/money-flow/releases lists the kept releases; leave release out for the latest.`);
  const reg = read<SourcesRegistry>(m, 'registry/sources');
  if (!reg) throw new Error(`release ${m.tag} has no source registry`);
  return { url, lang, m, latest: latestTag(), meta: readMeta(m), reg };
}

const cut = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function bad(param: string, detail: string): SvcFail {
  return new SvcFail(400, 'bad-parameter', `Bad parameter: ${param}`, detail);
}

function notInRelease(c: Ctx, what: string): SvcFail {
  return new SvcFail(404, 'not-in-release', 'Not in this release', `Release ${c.m.tag} (method ${c.m.method}) has no ${what}. Leave release out for the latest, or pick a newer tag from GET /v1/money-flow/releases.`);
}

function q(c: Ctx, k: string): string | null {
  const v = c.url.searchParams.get(k);
  return v == null || v.trim() === '' ? null : v.trim();
}

function intParam(c: Ctx, k: string, def: number, min: number, max: number): number {
  const v = q(c, k);
  if (v == null) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(k, `${k} must be a whole number from ${min} to ${max} (got "${cut(v)}").`);
  return n;
}

/** The page's path in the asked language, with ?r= when the release is not the latest (the pages read ?r=). */
function pagePath(c: Ctx, path: string, query: Record<string, string | null | undefined> = {}): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v != null && v !== '') s.set(k, v);
  if (c.m.tag !== c.latest) s.set('r', c.m.tag);
  const qs = s.toString();
  return `/${c.lang}${path}${qs ? `?${qs}` : ''}`;
}

export interface Source { publisher: string; dataset: string; key: string | null; vintage: string | null; licence: string; terms: string; url: string }
interface Column { id: string; label: string; unit?: string }
export interface Table { columns: Column[]; rows: (string | number | null)[][] }
interface Period { freq: string; shown: string | null; newest: string | null }
interface Env { view: string; page: string; period?: Period; sources: Source[]; summary: string; data: unknown; table?: Table; notes?: string[]; cursor?: string }

/** At most 600 characters, cut at a sentence. */
function clip(s: string): string {
  if (s.length <= 600) return s;
  const i = s.lastIndexOf('. ', 596);
  return i > 200 ? s.slice(0, i + 1) : `${s.slice(0, 597)}...`;
}

function envelope(c: Ctx, e: Env) {
  return {
    app: 'money-flow', view: e.view, release: c.m.tag, built: c.m.built, method: c.m.method,
    ...(e.period ? { period: e.period } : {}),
    page: e.page, sources: e.sources, summary: clip(e.summary), data: e.data,
    ...(e.table ? { table: e.table } : {}),
    ...(e.notes?.length ? { notes: e.notes } : {}),
    ...(e.cursor ? { cursor: e.cursor } : {}),
  };
}

// ---------------------------------------------------------------- names, numbers, sources

const SPECIAL: Record<string, string> = {
  _other: EN.other, _ni: EN.notIdentified, _rio: EN.reservesIO, _oi: EN.otherInstr, _fdi: EN.directInvestors, _res: 'Reserve assets (holders not published)',
};

/** An economy's name in the asked language, from the release (meta.economies); the ladder's pseudo-holders in English. */
export function econName(meta: Meta, code: string, lang: Lang): string {
  if (SPECIAL[code]) return SPECIAL[code];
  const e = meta.economies[code];
  if (!e) return code;
  return lang === 'ko' ? e.ko || e.en : e.en;
}
const enName = (meta: Meta, code: string) => econName(meta, code, 'en');

function n1(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return 'n/a';
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
const usd = (v: number | null | undefined, d = 1) => (v == null ? 'n/a' : `USD ${n1(v, d)} bn`);
const r1 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const label = (iso: string | null | undefined, freq: string) => period(iso, freq, 'en');

const shown = (c: Ctx, cls: string | undefined) => !!(cls && c.reg.classes?.[cls]?.shown);

/** The sources a page names, by registry link id (config/sources.yaml `links`; V17): only links to a dataset of a class
 *  that may be shown (a key-level class overrides the dataset's, as for FRED's re-hosted series). */
function linkSources(c: Ctx, ids: string[]): Source[] {
  const out: Source[] = [];
  for (const id of [...new Set(ids)]) {
    const l = c.reg.links?.[id];
    if (!l?.dataset) continue;
    const e = c.reg.datasets[l.dataset];
    if (!e) continue;
    const k = l.code ? e.keys?.[l.code] : undefined;
    const cls = k?.class ?? e.class;
    if (!shown(c, cls)) continue;
    const pub = c.reg.publishers[k?.publisher ?? l.publisher ?? e.publisher];
    out.push({ publisher: pub?.en ?? e.publisher, dataset: l.label.en, key: l.code ?? null, vintage: c.meta.datasets[l.dataset]?.vintage ?? c.m.vintages?.[l.dataset] ?? null,
      licence: cls, terms: pub?.terms_note ?? '', url: l.url });
  }
  return out;
}

function panelSources(c: Ctx, panels: string[]): Source[] {
  return linkSources(c, panels.flatMap((p) => c.reg.panels?.[p]?.links ?? []));
}

/** Dataset-level sources (the economy page names datasets, not links). */
function datasetSources(c: Ctx, dss: string[]): Source[] {
  const out: Source[] = [];
  for (const ds of [...new Set(dss)]) {
    const e = c.reg.datasets[ds];
    if (!e || !shown(c, e.class)) continue;
    const pub = c.reg.publishers[e.publisher];
    out.push({ publisher: pub?.en ?? e.publisher, dataset: e.short, key: null, vintage: c.meta.datasets[ds]?.vintage ?? c.m.vintages?.[ds] ?? null,
      licence: e.class, terms: pub?.terms_note ?? '', url: e.landing });
  }
  return out;
}

const dsShort = (c: Ctx, ds: string) => c.reg.datasets[ds]?.short ?? ds;
const sourceNames = (s: Source[]) => [...new Set(s.map((x) => x.dataset))].join(', ');

// ---------------------------------------------------------------- V11: no daily, weekly or monthly run longer than 13

const STEP: Record<string, number> = { D: 1, W: 7, M: 31 };

/** The points of a native D/W/M series with every consecutive run cut to `cap` (the build's run test: a gap of more
 *  than 1.6 steps ends a run). The earliest points of a long run go; quarterly history points stay. */
export function v11Points(pts: Pt[], f: string, cap = 13): Pt[] {
  const step = STEP[f];
  if (!step) return pts;
  const runs: Pt[][] = [];
  let prev: number | null = null;
  for (const p of pts) {
    const d = Date.parse(p[0]);
    if (prev != null && (d - prev) / 86400000 <= step * 1.6) runs[runs.length - 1].push(p);
    else runs.push([p]);
    prev = d;
  }
  return runs.flatMap((r) => (r.length > cap ? r.slice(r.length - cap) : r));
}

const points = (pts: Pt[]) => pts.map(([p, v]) => ({ period: p, value: v }));

// ---------------------------------------------------------------- economies

function pageEconomy(c: Ctx, raw: string | null | undefined): string {
  const X = (raw ?? '').toUpperCase();
  if (!ISO3.test(X) || !c.meta.economies[X]?.page) {
    throw new SvcFail(404, 'unknown-economy', 'Unknown economy code', `${cut(raw ?? '')} is not an economy code money-flow has a page for. Use an ISO 3166-1 alpha-3 code such as KOR (EMU for the euro area); GET /v1/money-flow/economies lists them.`);
  }
  return X;
}

function econFile(c: Ctx, X: string): Econ {
  const e = read<Econ>(c.m, `econ/${X}`);
  if (!e) throw new SvcFail(404, 'unknown-economy', 'Unknown economy code', `Release ${c.m.tag} has no page for ${X}. GET /v1/money-flow/economies lists the economies with a page.`);
  return e;
}

export function economiesView(c: Ctx) {
  const list = Object.entries(c.meta.economies).filter(([, e]) => e.page).sort(([a], [b]) => a.localeCompare(b))
    .map(([code, e]) => ({ code, name: econName(c.meta, code, c.lang), region: e.region, page: pagePath(c, `/e/${code}`) }));
  return envelope(c, {
    view: 'economies', page: pagePath(c, '/economies'), sources: [],
    summary: `money-flow has an economy page for ${list.length} economies (release ${c.m.tag}, method ${c.m.method}): who funds each one and where its money goes, from BIS, IMF and central-bank statistics. Codes are ISO 3166-1 alpha-3; EMU is the euro area.`,
    data: { economies: list },
  });
}

interface Tile { id: string; label: string; value: number | null; unit: string; scale: string; period: string | null; freq: string; source: string; note: string | null }

/** The economy page's KPI row, as numbers (lib/model.ts build() prints the same values as text). */
function econTiles(c: Ctx, e: Econ, dir: 'in' | 'out'): Tile[] {
  const hit = ladderAt(e, dir, 'aligned', c.meta.day);
  if (!hit) return [];
  const { ladder } = hit;
  const per = ladder.per;
  const X = e.code, xName = enName(c.meta, X);
  const pg = ladder.g.portfolio ?? {};
  const bankPer = per.bank ?? null;
  const bp = per.portfolio ?? per.bank ?? hit.asof;
  const iipAt = (s: 'in' | 'out', item: string) => (e.border[s]?.iip[item] ?? []).find((x) => x[0] === bp)?.[1] ?? null;
  const sumOf = (xs: (number | null)[]) => (xs.some((x) => x == null) ? null : xs.reduce<number>((a, x) => a + (x as number), 0));
  const debt = sumOf(['portfolio_debt', 'other', 'direct_debt'].map((i) => iipAt(dir, i)));
  const eq = sumOf(['portfolio_equity', 'direct_equity'].map((i) => iipAt(dir, i)));
  const assets = iipAt('out', 'total'), liab = iipAt('in', 'total');
  const net = (e.border.net ?? []).find((x) => x[0] === bp)?.[1] ?? (assets != null && liab != null ? assets - liab : null);
  const res = e.made.fx_reserves ? at(e.made.fx_reserves.pts, c.meta.day) : null;
  const usdBank = e.usd_bank && bankPer ? at(e.usd_bank.pts, bankPer) : null;
  const tiles: Tile[] = [
    { id: dir === 'in' ? 'securities_held_abroad' : 'foreign_securities_held', label: dir === 'in' ? EN.kpi.portIn : EN.kpi.portOut, value: r1(pg.ident ?? null), unit: 'USD', scale: 'bn',
      period: per.portfolio ?? null, freq: 'S', source: 'IMF PIP (CPIS)', note: `${pg.n ?? 0} ${dir === 'in' ? 'holders' : 'destinations'} identified` },
    { id: 'bank_claims', label: dir === 'in' ? `${M.bank_loans_lbs}, ${xName}` : EN.kpi.bankOut, value: r1(ladder.g.bank?.total ?? null), unit: 'USD', scale: 'bn', period: bankPer, freq: 'Q', source: 'BIS LBS',
      note: dir === 'in' && usdBank && usdBank[0] === bankPer ? `${usd(usdBank[1])} of it in US dollars` : 'loans and deposits, residence basis' },
    { id: dir === 'in' ? 'gross_external_liabilities' : 'gross_external_assets', label: dir === 'in' ? EN.kpi.iipIn : EN.kpi.iipOut, value: r1(iipAt(dir, 'total')), unit: 'USD', scale: 'bn', period: bp, freq: 'Q', source: 'IMF IIP',
      note: debt != null && eq != null ? `debt ${usd(debt)}, equity ${usd(eq)}${iipAt(dir, 'derivatives') ? `, derivatives ${usd(iipAt(dir, 'derivatives'))}` : ''}` : null },
    { id: 'net_iip', label: EN.kpi.niip, value: r1(net), unit: 'USD', scale: 'bn', period: bp, freq: 'Q', source: 'IMF IIP', note: `assets ${usd(assets)} less liabilities ${usd(liab)}` },
    { id: 'fx_reserves', label: EN.kpi.reserves, value: r1(res?.[1] ?? null), unit: 'USD', scale: 'bn', period: res?.[0] ?? null, freq: e.made.fx_reserves?.f ?? 'M',
      source: e.made.fx_reserves ? dsShort(c, e.made.fx_reserves.ds) : 'n/a', note: null },
  ];
  return tiles;
}

/** One economy's row on the Signal Board at the World page's default quarter, or null when the board does not draw it. */
function boardMark(c: Ctx, X: string): { quarter: string; vulnerability: number | null; flow_pct: number | null; exposure: number | null; buffer_weakness: number | null; a1_pct: number | null; a2_pct: number | null;
  net_reserves_usd_bn: number | null; a2_reserve_base_usd_bn: number | null; a2_floored: boolean; page: string } | null {
  const w = read<World>(c.m, 'world/global');
  const b = w?.board;
  if (!b?.quarters?.length) return null;
  const qd = defaultQuarter(b, c.meta);
  const row = boardRows(b, qd).find((r) => r.eco === X);
  if (!row) return null;
  return { quarter: qd, vulnerability: num(row.v), flow_pct: num(row.flow), exposure: num(row.exp), buffer_weakness: num(row.buf), a1_pct: num(row.a1), a2_pct: num(row.a2),
    net_reserves_usd_bn: num(row.res_net_raw), a2_reserve_base_usd_bn: num(row.res_net), a2_floored: !!row.a2_floored, page: pagePath(c, '/world', { bf: X }) };
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function sovNow(c: Ctx, X: string): { count: number; of: number; signals: string[]; alarm_at: number; year: number; vintage: string; page: string } | null {
  const d = read<Sovereign>(c.m, 'sovereign/global');
  const e = d?.econ[X];
  if (!d || !e) return null;
  const s = sovDefaults(d, X);
  const k = nowCount(d, e, s);
  return { count: k.k, of: k.n, signals: k.on.map((r) => REG[r]), alarm_at: d.K.default, year: d.last_actual, vintage: vintageLabel(d.meta.vintage, 'en'), page: pagePath(c, '/sovereign', { e: X === 'KOR' ? null : X }) };
}

const PARTS = ['summary', 'ladder', 'indicators', 'checks'] as const;
type Part = (typeof PARTS)[number];

function econModel(c: Ctx, e: Econ, dir: 'in' | 'out'): ViewModel | null {
  const checks = read<Checks>(c.m, 'checks');
  return build(e, c.meta, c.reg, checks, pageParams(dir === 'out' ? { dir: 'out' } : {}, c.meta), 'en', c.m.tag);
}

export function economyView(c: Ctx, iso3: string) {
  const X = pageEconomy(c, iso3);
  const e = econFile(c, X);
  const part = (q(c, 'part') ?? 'summary') as Part;
  if (!(PARTS as readonly string[]).includes(part)) throw bad('part', `part must be one of ${PARTS.join(', ')} (got "${cut(String(part))}").`);
  const name = econName(c.meta, X, c.lang), en = enName(c.meta, X);
  const vin = econModel(c, e, 'in');
  const np = newestPeriod(e);
  const page = pagePath(c, `/e/${X}`);
  const base = { economy: X, name, region: c.meta.economies[X]?.region ?? null };
  const periodQ: Period = { freq: 'Q', shown: vin?.per.bank ?? null, newest: np };

  if (part === 'summary') {
    const tiles = econTiles(c, e, 'in');
    const board = boardMark(c, X);
    const sov = sovNow(c, X);
    const t = (id: string) => tiles.find((x) => x.id === id);
    const res = t('fx_reserves'), net = t('net_iip'), liab = t('gross_external_liabilities'), port = t('securities_held_abroad');
    const bits = [
      res?.value != null ? `foreign exchange reserves ${usd(res.value)} (${label(res.period, res.freq)})` : null,
      net?.value != null ? `net international investment position ${usd(net.value)} and gross external liabilities ${usd(liab?.value)} (${label(net.period, 'Q')}, IMF IIP)` : null,
      port?.value ? `${usd(port.value)} of its securities held abroad by identified holders (${label(port.period, 'S')}, IMF PIP)` : null,
    ].filter(Boolean);
    const summary = `${en}: ${bits.join('; ')}.${board ? ` Signal Board ${label(board.quarter, 'Q')}: vulnerability ${n1(board.vulnerability, 0)} of 100, funding flow ${n1(board.flow_pct)}% a year.` : ''}${sov ? ` Sovereign stress signals: ${sov.count} of ${sov.of} rules on the latest values (year ${sov.year}, ${sov.vintage}).` : ''} money-flow release ${c.m.tag}.`;
    return envelope(c, {
      view: 'economy', page, period: periodQ,
      sources: datasetSources(c, ['imf.PIP', 'bis.LBS', 'imf.IIP', ...(e.made.fx_reserves ? [e.made.fx_reserves.ds] : [])]),
      summary,
      data: { ...base, part, newest_period: np, headline: vin?.headline ?? null, tiles, board, sovereign: sov, parts: [...PARTS] },
      notes: [board ? `The board mark is the World page's Signal Board row for this economy (method rules R17–R19), at ${board.quarter}. net_reserves_usd_bn is IMF IRFCL section I + section II without a floor (it can be negative); a2_reserve_base_usd_bn is A2's denominator, net reserves floored at a tenth of gross reserves (a2_floored says when the floor binds).` : 'This economy is not drawn on the Signal Board (the board covers 36 borrowing economies).',
        ...(sov ? [`The sovereign count is for the year ${sov.year} (the newest actual year of the ${sov.vintage}); the board mark is for a quarter.`] : [])],
    });
  }

  if (part === 'ladder') {
    const dirs = (['in', 'out'] as const).map((dir) => {
      const v = dir === 'in' ? vin : econModel(c, e, 'out');
      if (!v) return null;
      const dsOf = new Map<string, string>();
      for (const r of v.ribbons) if (!dsOf.has(r.group)) dsOf.set(r.group, r.ds);
      const POOL_GROUP: Record<string, string> = { portfolio_ns: 'unsplit' };
      return {
        direction: dir, label: dir === 'in' ? `Inflows: who holds claims on ${en}` : `Outflows: what ${en}'s residents hold abroad`, headline: v.headline,
        as_of_day: v.asof, unit: 'USD', scale: 'bn', holders_shown: v.p.k,
        periods: Object.entries(v.per).filter(([ch, p]) => p && ['portfolio', 'bank', 'fdi', 'reserves'].includes(ch)).map(([ch, p]) => ({ channel: ch, period: p, freq: ({ portfolio: 'S', fdi: 'A', fdi_parts: 'A' } as Record<string, string>)[ch] ?? 'Q' })),
        channels: v.pools.map((p) => ({ channel: p.id, label: p.label, total: r1(p.total), period: p.period || null, freq: p.freq,
          source: dsOf.has(POOL_GROUP[p.id] ?? p.id) ? dsShort(c, dsOf.get(POOL_GROUP[p.id] ?? p.id)!) : null })),
        ribbons: v.ribbons.map((r) => ({ holder: r.holder, name: econName(c.meta, r.holder, c.lang), channel: r.group, value: r1(r.value), flow: r1(r.flow), flow_kind: r.flow == null ? null : r.kind, period: r.period || null })),
        coverage: v.coverage.map((x) => ({ label: x.label, coverage_pct: r1(x.cov), text: x.text })),
      };
    }).filter(Boolean);
    const vi = dirs[0];
    const top = vi?.ribbons.filter((r) => !r.holder.startsWith('_')).slice().sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
    return envelope(c, {
      view: 'economy', page, period: periodQ, sources: datasetSources(c, [...new Set([...(vin?.sources ?? []).map((s) => s.ds)])]),
      summary: `${en}'s money ladder (money-flow release ${c.m.tag}, method ${c.m.method}): ${vin?.headline ?? 'no inflow ladder'}. Positions at the newest period all channels share (portfolio ${label(vin?.per.portfolio, 'S')}, bank claims ${label(vin?.per.bank, 'Q')}, direct investment ${label(vin?.per.fdi, 'A')}), the ten largest holders each way${top ? `; the largest single mark is ${enName(c.meta, top.holder)} in ${top.channel} (${usd(top.value)})` : ''}. Sources: IMF PIP, BIS LBS, IMF DIP, IMF IIP.`,
      data: { ...base, part, directions: dirs },
      notes: ['Ribbons are the marks the ladder draws: positions in USD bn; flow is the latest flow where the page has one (R8): flow_kind published is the publisher\'s flow, derived the change of two positions, valuation included. Holders _other, _ni, _rio, _oi, _fdi and _res are the ladder\'s groups, not economies.'],
    });
  }

  if (part === 'indicators') {
    const defs = indicatorDefs(e);
    const list = defs.map((d) => {
      const pts = v11Points(d.pts, d.f);
      const last = at(pts, c.meta.day);
      return { id: d.id, label: d.label, value: r1(last?.[1] ?? null), unit: 'USD', scale: 'bn', period: last?.[0] ?? null, freq: d.f, source: dsShort(c, d.ds),
        path: `/economies/${X}/indicators/${d.id}` };
    });
    const res = list.find((x) => x.id === 'fx_reserves');
    return envelope(c, {
      view: 'economy', page, period: periodQ, sources: datasetSources(c, defs.map((d) => d.ds)),
      summary: `${en}: ${list.length} indicators the economy page draws, each with its newest value at or before ${c.meta.day} (money-flow release ${c.m.tag})${res?.value != null ? `, among them foreign exchange reserves ${usd(res.value)} (${label(res.period, res.freq)})` : ''}. Money made at home, the IMF IIP positions and BOP flows, bank claims in US dollars and context series; all in USD bn.`,
      data: { ...base, part, indicators: list },
      notes: ['GET /v1/money-flow/economies/{iso3}/indicators/{id} gives one indicator\'s points.'],
    });
  }

  // checks
  const rows: { check: string; status: string; direction: string; text: string }[] = [];
  for (const dir of ['in', 'out'] as const) {
    const v = dir === 'in' ? vin : econModel(c, e, 'out');
    for (const x of v?.checks ?? []) {
      const hit = rows.find((r) => r.check === x.label && r.text === x.text);
      if (hit) hit.direction = 'both';
      else rows.push({ check: x.label, status: x.status, direction: dir, text: x.text });
    }
  }
  const warn = rows.filter((r) => r.status === 'warning').length;
  return envelope(c, {
    view: 'economy', page, period: periodQ, sources: [],
    summary: `${en}: ${rows.length} data checks touch the economy page in release ${c.m.tag} (${warn} warnings). Checks V1–V26 are defined in the method registry (method ${c.m.method}); a warning marks a known difference between sources or a coverage gap, never a blocked release.`,
    data: { ...base, part, checks: rows, release_checks: c.m.checks ?? {}, checks_page: pagePath(c, '/checks') },
  });
}

// ---------------------------------------------------------------- one indicator

interface IndDef { id: string; label: string; ds: string; key: string | null; f: string; detail: string | null; pts: Pt[] }

const IIP_ITEM: Record<string, string> = {
  total: 'total', portfolio: 'portfolio investment', direct: 'direct investment', other: 'other investment', reserves: 'reserve assets', derivatives: 'financial derivatives',
  portfolio_debt: 'portfolio debt', portfolio_equity: 'portfolio equity', direct_debt: 'direct investment debt', direct_equity: 'direct investment equity',
};

/** The series the economy page draws (made-here bars, market context, KPI tiles, border items, the Flows tab). */
function indicatorDefs(e: Econ): IndDef[] {
  const out: IndDef[] = [];
  const s = (id: string, lbl: string, x: { ds: string; key?: string | null; f: string; det?: string; pts: Pt[] } | null | undefined) => {
    if (x?.pts?.length) out.push({ id, label: lbl, ds: x.ds, key: x.key ?? null, f: x.f, detail: x.det || null, pts: x.pts });
  };
  for (const k of ['cb_assets', 'monetary_base', 'm1', 'broad_money', 'm3', 'lf', 'l', 'fx_reserves']) s(k, EN.measure[k] ?? k, e.made[k]);
  for (const k of ['credit_private', 'ids_outstanding']) s(k, EN.measure[k] ?? k, e.context[k]);
  if (e.tic?.portfolio) s('tic_portfolio', 'US long-term securities held (TIC)', { ds: e.tic.portfolio.ds, key: e.tic.portfolio.key, f: e.tic.portfolio.f, pts: e.tic.portfolio.pts });
  if (e.usd_bank) s('bank_claims_usd', 'Bank claims in US dollars (BIS LBS, loans and deposits)', e.usd_bank);
  for (const side of ['in', 'out'] as const) {
    const word = side === 'in' ? 'liabilities' : 'assets';
    for (const item of Object.keys(IIP_ITEM)) {
      const pts = e.border[side]?.iip[item];
      if (pts?.length) s(`iip_${word}_${item}`, `IIP ${word}: ${IIP_ITEM[item]}`, { ds: 'imf.IIP', f: 'Q', pts });
    }
  }
  if (e.border.net?.length) s('iip_net', EN.kpi.niip, { ds: 'imf.IIP', f: 'Q', pts: e.border.net });
  for (const side of ['in', 'out'] as const) {
    const word = side === 'in' ? 'liabilities' : 'assets';
    for (const item of side === 'in' ? ['portfolio', 'direct', 'other'] : ['portfolio', 'direct', 'other', 'reserves']) {
      const pts = e.border[side]?.bop[item];
      if (pts?.length) s(`bop_${word}_${item}`, `BOP net ${side === 'in' ? 'incurrence of liabilities' : 'acquisition of assets'}: ${IIP_ITEM[item]}`, { ds: 'imf.BOP', f: 'Q', pts });
    }
  }
  return out;
}

export function indicatorView(c: Ctx, iso3: string, id: string) {
  const X = pageEconomy(c, iso3);
  const e = econFile(c, X);
  const defs = indicatorDefs(e);
  const d = defs.find((x) => x.id === id);
  if (!d) throw new SvcFail(404, 'unknown-indicator', 'Unknown indicator', `${cut(id)} is not an indicator of ${X}'s page. Ids: ${defs.map((x) => x.id).join(', ')}. GET /v1/money-flow/economies/${X}?part=indicators lists them with their newest values.`);
  const last = intParam(c, 'last', 40, 1, 400);
  const all = v11Points(d.pts, d.f).filter((p) => p[0] <= c.meta.day);
  const pts = all.slice(-last);
  const newest = pts[pts.length - 1];
  const en = enName(c.meta, X);
  const notes = [];
  if (STEP[d.f]) notes.push(`A ${d.f === 'M' ? 'monthly' : d.f === 'W' ? 'weekly' : 'daily'} series: the release keeps quarter ends for the history and at most 13 consecutive native observations (check V11).`);
  if (all.length > pts.length) notes.push(`The last ${pts.length} of ${all.length} points; last= takes up to 400.`);
  return envelope(c, {
    view: 'indicator', page: pagePath(c, `/e/${X}`), period: { freq: d.f, shown: newest?.[0] ?? null, newest: newest?.[0] ?? null },
    sources: datasetSources(c, [d.ds]),
    summary: `${en}, ${d.label}: ${usd(newest?.[1] ?? null)} at ${label(newest?.[0], d.f)} (${dsShort(c, d.ds)}; money-flow release ${c.m.tag}). ${pts.length} points from ${label(pts[0]?.[0], d.f)}.`,
    data: { economy: X, name: econName(c.meta, X, c.lang), indicator: d.id, label: d.label, unit: 'USD', scale: 'bn', freq: d.f, source: dsShort(c, d.ds),
      key: d.key, detail: d.detail, points_total: all.length, points: points(pts) },
    table: { columns: [{ id: 'period', label: 'Period' }, { id: 'value', label: d.label, unit: 'USD bn' }], rows: pts.map(([p, v]) => [p, v]) },
    notes,
  });
}

// ---------------------------------------------------------------- the Signal Board

const BOARD_COLS: [string, string, string][] = [
  ['eco', 'economy', 'Economy'], ['name', 'name', 'Name'], ['quarter', 'quarter', 'Quarter'], ['v', 'vulnerability', 'Vulnerability (0–100)'],
  ['flow', 'flow_pct', 'Flow (% a year)'], ['exp', 'exposure', 'Exposure'], ['buf', 'buffer_weakness', 'Buffer weakness'], ['a1', 'a1_pct', 'A1 FX credit / GDP (%)'], ['l1', 'a1_level', 'A1 level'],
  ['o1', 'a1_own_history', 'A1 own history'], ['s1', 'a1_signal', 'A1 signal'], ['a2', 'a2_pct', `${M.a2} (%)`], ['a2_scored', 'a2_scored', 'A2 scored'], ['l2', 'a2_level', 'A2 level'],
  ['o2', 'a2_own_history', 'A2 own history'], ['s2', 'a2_signal', 'A2 signal'], ['niip', 'niip_gdp_pct', 'Net IIP / GDP (%)'], ['ca', 'ca_gdp_pct', 'Current account / GDP (%)'], ['wn', 'weakness_niip', 'Buffer weakness: NIIP'],
  ['wc', 'weakness_ca', 'Buffer weakness: current account'], ['a3', 'a3_pct', 'A3 bond dependence (%)'], ['ned', 'net_external_debt_gdp_pct', 'Net external debt / GDP (%)'], ['a1n', 'a1_nationality_pct', 'A1 by nationality (%)'],
  ['b1', 'b1_usd_bn', 'B1 bank flow (USD bn)'], ['b2', 'b2_usd_bn', 'B2 bond net issues (USD bn)'], ['a1x', 'a1_cross_border_pct', 'A1 cross-border only (%)'], ['a1_local', 'a1_local', 'A1 includes local FX claims'],
  ['local_fx', 'local_fx_usd_bn', 'Local FX claims on non-banks (USD bn)'], ['offshore', 'offshore_flag', 'Offshore issuance flag'], ['a2g', 'a2_gross_pct', 'A2 on gross reserves (%)'],
  ['res_net_raw', 'net_reserves_usd_bn', `${M.net_reserves}, IMF IRFCL section I + II, no floor (USD bn)`], ['res_net', 'a2_reserve_base_usd_bn', `${M.a2_reserve_base}: net reserves floored at a tenth of gross (USD bn)`],
  ['a2_floored', 'a2_floored', 'A2 floored'], ['st', 'bank_claims_short_term_usd_bn', `${M.bank_claims_short_term} (USD bn)`], ['o1x', 'a1_own_history_cross_border', 'A1 own history read on the cross-border part'],
  ['flow_missing', 'flow_missing', 'Why the flow is missing'],
];

function boardOf(c: Ctx): Board {
  const w = read<World>(c.m, 'world/global');
  if (!w?.board?.quarters?.length) throw notInRelease(c, 'Signal Board');
  return w.board;
}

/** The World page's quarter: the newest at or before the day it shows (meta.day). */
function defaultQuarter(b: Board, meta: Meta): string {
  return b.quarters.filter((x) => x <= meta.day).slice(-1)[0] ?? b.quarters[0];
}

function boardRows(b: Board, qd: string): Record<string, string | number | null>[] {
  return (b.q[qd]?.rows ?? []).map((r) => Object.fromEntries(b.cols.map((k, i) => [k, r[i] as string | number | null])));
}

function quarterParam(c: Ctx, b: Board): string {
  const raw = q(c, 'quarter');
  if (!raw) return defaultQuarter(b, c.meta);
  let iso = raw;
  const m = /^(\d{4})-?Q([1-4])$/i.exec(raw);
  if (m) iso = `${m[1]}-${['03-31', '06-30', '09-30', '12-31'][Number(m[2]) - 1]}`;
  if (!b.quarters.includes(iso)) throw bad('quarter', `quarter must be a board quarter from ${b.quarters[0]} to ${b.quarters[b.quarters.length - 1]}, as 2026-06-30 or 2026-Q2 (got "${cut(raw)}").`);
  return iso;
}

export function boardView(c: Ctx) {
  const b = boardOf(c);
  const qd = quarterParam(c, b);
  const bd = b.q[qd];
  const rows = boardRows(b, qd);
  const def = defaultQuarter(b, c.meta);
  const cols = BOARD_COLS.filter(([k]) => k === 'name' || k === 'quarter' || b.cols.includes(k));
  const marks = rows.map((r) => ({
    economy: r.eco as string, name: econName(c.meta, r.eco as string, c.lang), vulnerability: num(r.v), flow_pct: num(r.flow), exposure: num(r.exp), buffer_weakness: num(r.buf),
    a1_pct: num(r.a1), a2_pct: num(r.a2), net_reserves_usd_bn: num(r.res_net_raw), a2_floored: !!r.a2_floored, page: c.meta.economies[r.eco as string]?.page ? pagePath(c, `/e/${r.eco}`) : null,
  })).sort((x, y) => (y.vulnerability ?? -1) - (x.vulnerability ?? -1));
  const top = (bd?.top ?? []).map(([eco, total, b1, b2]) => ({ economy: eco, name: econName(c.meta, eco, c.lang), flow_usd_bn: total, b1_usd_bn: b1, b2_usd_bn: b2 }));
  const qL = label(qd, 'Q');
  const sources = panelSources(c, ['world.board']);
  const w0 = top[0];
  const hi = marks.slice(0, 3).map((x) => `${enName(c.meta, x.economy)} (${n1(x.vulnerability, 0)})`).join(', ');
  const noFlow = (bd?.no_flow ?? []).map(([eco, why]) => ({ economy: eco, name: econName(c.meta, eco, c.lang), reason: why }));
  const summary = `Signal Board, ${qL} (money-flow release ${c.m.tag}, method ${c.m.method}): ${bd?.n ?? 0} borrowing economies drawn; ${bd?.n_out ? `funding left ${bd.n_out} of them, most from ${enName(c.meta, w0!.economy)} (${usd(w0!.flow_usd_bn, 1)} of bank and bond flows)` : 'funding reached all of them'}. Highest vulnerability: ${hi}. Vulnerability is 0–100: half exposure (A1 FX credit to GDP; ${M.a2}), half buffer weakness (net IIP, current account). Sources: BIS LBS, DSS, CBS and TC, IMF IRFCL, IIP and BOP.`;
  return envelope(c, {
    view: 'board', page: pagePath(c, '/world', { bq: qd === def ? null : qd }), period: { freq: 'Q', shown: qd, newest: b.quarters[b.quarters.length - 1] },
    sources, summary,
    data: { quarter: qd, quarter_label: qL, economies_drawn: bd?.n ?? 0, net_outflow: bd?.n_out ?? 0, marks, largest_withdrawals: top,
      not_drawn: (bd?.drop ?? []).map(([eco, why]) => ({ economy: eco, name: econName(c.meta, eco, c.lang), reason: why })),
      drawn_without_flow: noFlow,
      left_out: b.set.out.map(([eco, why]) => ({ economy: eco, name: econName(c.meta, eco, c.lang), reason: why })),
      advanced: b.groups?.advanced ?? [], quarters_from: b.quarters[0], quarters_to: b.quarters[b.quarters.length - 1] },
    table: {
      columns: cols.map(([, id, lbl]) => ({ id, label: lbl, ...(id.endsWith('_usd_bn') ? { unit: 'USD bn' } : id.endsWith('_pct') ? { unit: '%' } : {}) })),
      rows: rows.map((r) => cols.map(([k]) => (k === 'name' ? enName(c.meta, r.eco as string) : k === 'quarter' ? qd : (r[k] ?? null)))),
    },
    notes: ['Rows are the page\'s CSV of the board (World page, Signal Board, CSV button). Flow: (B1 + B2) / (LBS loans and deposits + international debt securities, both a quarter before) × 4, one ratio of the summed flows over the summed stocks; B1 is the BIS FX- and break-adjusted bank flow, B2 net issues by nationality. An economy without a flow is scored and listed in drawn_without_flow. Method rules R17–R19, checks V18–V22 and V27.',
      `A2 = ${M.bank_claims_short_term} (BIS CBS international claims, remaining maturity up to one year, immediate counterparty, bank type 4O, all currencies) ÷ ${M.a2_reserve_base} (net reserves floored at a tenth of gross reserves). It is not the economy's short-term external debt. net_reserves_usd_bn is IRFCL section I + section II without the floor and can be negative; a2_reserve_base_usd_bn is the floored value A2 divides by.`],
  });
}

// ---------------------------------------------------------------- the World pulse

const PULSE: { id: 'swap_lines' | 'custody_treasuries' | 'dollar_index'; label: string; unit: string; scale: string | null; panel: string }[] = [
  { id: 'swap_lines', label: 'Fed central bank liquidity swaps', unit: 'USD', scale: 'bn', panel: 'world.pulse_swaps' },
  { id: 'custody_treasuries', label: 'Treasuries held for foreign official accounts', unit: 'USD', scale: 'bn', panel: 'world.pulse_custody' },
  { id: 'dollar_index', label: 'Broad dollar index (Jan 2006 = 100)', unit: 'index', scale: null, panel: 'world.pulse_dollar' },
];

export function pulseView(c: Ctx) {
  const w = read<World>(c.m, 'world/global');
  const p = w?.pulse;
  if (!p) throw notInRelease(c, 'World pulse');
  const tiles = PULSE.filter((x) => p[x.id]).flatMap((x) => {
    const s = p[x.id];
    const e = c.reg.datasets[s.ds];
    const cls = e?.keys?.[s.key]?.class ?? e?.class;
    if (!shown(c, cls)) return [];
    return [{ id: x.id, label: x.label, unit: x.unit, scale: x.scale, freq: s.f, as_of: s.latest?.[0] ?? null, value: s.latest?.[1] ?? null,
      change_4w: s.chg ?? null, change_unit: s.kind === 'pct' ? '%' : x.scale ? `${x.unit} ${x.scale}` : x.unit, age_days: s.age ?? null, stale: !!s.stale, missing: !!s.missing,
      points: points(v11Points(s.pts ?? [], s.f, 53)) }];
  });
  const tic = p.tic && shown(c, c.reg.datasets[p.tic.ds]?.class) ? (() => {
    const t3 = (pts: Pt[]) => (pts.length >= 3 ? r1(pts.slice(-3).reduce((a, x) => a + (x[1] ?? 0), 0)) : null);
    const one = (id: 'official' | 'private', lbl: string) => {
      const pts = v11Points(p.tic![id], p.tic!.f);
      return { id, label: lbl, freq: p.tic!.f, latest: pts[pts.length - 1]?.[1] ?? null, sum_3m: t3(pts), points: points(pts) };
    };
    return { label: 'Net foreign purchases of US long-term securities (monthly)', unit: 'USD', scale: 'bn', as_of: p.tic.latest, age_days: p.tic.age,
      series: [one('official', 'Foreign official'), one('private', 'Foreign private')] };
  })() : null;
  const sw = tiles.find((x) => x.id === 'swap_lines'), cu = tiles.find((x) => x.id === 'custody_treasuries'), dx = tiles.find((x) => x.id === 'dollar_index');
  const summary = `World pulse (money-flow release ${c.m.tag}): ${cu ? `Treasuries held at the Fed for foreign official accounts ${usd(cu.value)} on ${cu.as_of} (4-week change ${n1(cu.change_4w)} bn)` : ''}${sw ? `; Fed liquidity swaps ${usd(sw.value, 2)} on ${sw.as_of}` : ''}${dx ? `; broad dollar index ${n1(dx.value, 2)} on ${dx.as_of} (${n1(dx.change_4w)}% over 4 weeks)` : ''}${tic ? `; TIC net foreign purchases of US long-term securities in ${label(tic.as_of, 'M')}: official ${usd(tic.series[0].latest)}, private ${usd(tic.series[1].latest)}` : ''}. Sources: Fed H.4.1 and H.10 via FRED, US Treasury TIC.`;
  return envelope(c, {
    view: 'pulse', page: pagePath(c, '/world'), period: { freq: 'W', shown: cu?.as_of ?? sw?.as_of ?? null, newest: cu?.as_of ?? null },
    sources: panelSources(c, [...PULSE.map((x) => x.panel), 'world.pulse_tic']), summary,
    data: { tiles, tic },
    table: {
      columns: [{ id: 'tile', label: 'Tile' }, { id: 'as_of', label: 'As of' }, { id: 'value', label: 'Value' }, { id: 'change_4w', label: '4-week change' }, { id: 'unit', label: 'Unit' }],
      rows: [...tiles.map((x) => [x.label, x.as_of, x.value, x.change_4w, x.scale ? `${x.unit} ${x.scale}` : x.unit] as (string | number | null)[]),
        ...(tic ? tic.series.map((s) => [`${tic.label}: ${s.label.toLowerCase()}`, tic.as_of, s.latest, null, 'USD bn'] as (string | number | null)[]) : [])],
    },
    notes: ['Published once at release (rule R20). The weekly sparklines carry a year of Wednesdays (53 points, the V11 exception for the pulse\'s open series); TIC 13 months.'],
  });
}

// ---------------------------------------------------------------- Markets

const MARKETS = ['equity', 'bonds', 'bank', 'fdi'];
const ALIAS: Record<string, string> = { debt: 'bonds', banking: 'bank' };
const MFREQ: Record<string, string> = { equity: 'S', bonds: 'S', bank: 'Q', fdi: 'A' };
const HOLDERS_OF: Record<string, string> = { equity: 'the largest holders of {b}\'s equity are', bonds: 'the largest holders of {b}\'s debt securities are', bank: 'the largest bank lenders to {b} are banks located in', fdi: 'the largest direct investors in {b} are' };
const HELD_BY: Record<string, string> = { equity: '{a}\'s largest equity holdings are in', bonds: '{a}\'s largest debt securities holdings are in', bank: 'banks located in {a} lend most to', fdi: '{a}\'s largest direct investment is in' };
const SENTENCE: Record<string, string> = {
  equity: '{a} residents hold {v} of equity issued by {b} residents',
  bonds: '{a} residents hold {v} of debt securities issued by {b} residents',
  bank: 'Banks located in {a} hold {v} of loan and deposit claims on {b} residents',
  fdi: 'Direct investors in {a} hold {v} of direct investment in {b}',
};

function marketOf(c: Ctx, raw: string): { key: string; mk: Market } {
  const key = ALIAS[raw] ?? raw;
  if (!MARKETS.includes(key)) throw new SvcFail(404, 'unknown-market', 'Unknown market', `${cut(raw)} is not a money-flow market. Markets: equity, bonds, bank, fdi.`);
  const mk = read<Market>(c.m, `mkt/${key}`);
  if (!mk?.periods?.length) throw notInRelease(c, `${key} market matrix`);
  return { key, mk };
}

function knownEconomy(c: Ctx, raw: string | null, param: string): string | null {
  if (!raw) return null;
  const X = raw.toUpperCase();
  if (!ISO3.test(X) || !c.meta.economies[X]) throw new SvcFail(404, 'unknown-economy', 'Unknown economy code', `${param}=${cut(raw)} is not an economy code money-flow knows. Use an ISO 3166-1 alpha-3 code such as KOR; GET /v1/money-flow/economies lists the economies with a page.`);
  return X;
}

export function marketView(c: Ctx, raw: string) {
  const { key, mk } = marketOf(c, raw);
  const creditor = knownEconomy(c, q(c, 'creditor'), 'creditor');
  const debtor = knownEconomy(c, q(c, 'debtor'), 'debtor');
  const limit = intParam(c, 'limit', 10, 1, 25);
  const ps = mk.periods.filter((p) => p.p <= c.meta.day);
  const cur = ps[ps.length - 1] ?? mk.periods[0];
  const f = MFREQ[key];
  const L = EN.market_[key];
  const named = cur.pairs.filter(([a, b]) => a !== '_other' && b !== '_other');
  const focus = cur.focus ?? {};
  const row = (a: string, b: string, v: number | null) => ({ creditor: a, creditor_name: econName(c.meta, a, c.lang), debtor: b, debtor_name: econName(c.meta, b, c.lang), value: v });
  const byV = (o: Record<string, number>) => Object.entries(o).sort((x, y) => y[1] - x[1]);
  let kind: string;
  let rows: ReturnType<typeof row>[] = [];
  const notes: string[] = [];
  let lead: string;
  if (creditor && debtor) {
    kind = 'cell';
    const v = named.find(([a, b]) => a === creditor && b === debtor)?.[2]
      ?? focus[debtor]?.in_top.find(([h]) => h === creditor)?.[1] ?? focus[creditor]?.out_top.find(([d]) => d === debtor)?.[1] ?? null;
    rows = [row(creditor, debtor, v)];
    if (v == null) notes.push('The page does not draw this pair: it is outside the matrix (the 30 largest holders and destinations) and outside both economies\' ten largest counterparties.');
    lead = v == null ? `${enName(c.meta, creditor)} → ${enName(c.meta, debtor)}: not drawn on the page` : `${SENTENCE[key].replace('{a}', enName(c.meta, creditor)).replace('{b}', enName(c.meta, debtor)).replace('{v}', usd(v))}`;
  } else if (debtor) {
    kind = 'holders_of_debtor';
    const inMatrix = named.filter(([, b]) => b === debtor);
    rows = (inMatrix.length ? inMatrix.map(([a, b, v]) => row(a, b, v)) : (focus[debtor]?.in_top ?? []).map(([h, v]) => row(h, debtor, v)))
      .sort((x, y) => (y.value ?? 0) - (x.value ?? 0)).slice(0, limit);
    if (!rows.length) notes.push(`The page draws no holders of ${debtor} in this market: it is not among the 30 largest destinations or the economies with a focus panel.`);
    else if (!inMatrix.length) notes.push('From the economy\'s focus panel: its ten largest counterparties.');
    lead = rows.length ? `${HOLDERS_OF[key].replace('{b}', enName(c.meta, debtor))} ${rows.slice(0, 3).map((r) => `${enName(c.meta, r.creditor)} (${usd(r.value)})`).join(', ')}` : `no holders of ${enName(c.meta, debtor)} drawn`;
  } else if (creditor) {
    kind = 'exposures_of_creditor';
    const inMatrix = named.filter(([a]) => a === creditor);
    rows = (inMatrix.length ? inMatrix.map(([a, b, v]) => row(a, b, v)) : (focus[creditor]?.out_top ?? []).map(([d, v]) => row(creditor, d, v)))
      .sort((x, y) => (y.value ?? 0) - (x.value ?? 0)).slice(0, limit);
    if (!rows.length) notes.push(`The page draws no holdings of ${creditor} in this market: it is not among the 30 largest holders or the economies with a focus panel.`);
    else if (!inMatrix.length) notes.push('From the economy\'s focus panel: its ten largest counterparties.');
    lead = rows.length ? `${HELD_BY[key].replace('{a}', enName(c.meta, creditor))} ${rows.slice(0, 3).map((r) => `${enName(c.meta, r.debtor)} (${usd(r.value)})`).join(', ')}` : `no holdings of ${enName(c.meta, creditor)} drawn`;
  } else {
    kind = 'largest_pairs';
    rows = named.slice().sort((x, y) => y[2] - x[2]).slice(0, limit).map(([a, b, v]) => row(a, b, v));
    lead = rows[0] ? `the largest pair is ${enName(c.meta, rows[0].creditor)} → ${enName(c.meta, rows[0].debtor)} (${usd(rows[0].value)})` : 'no pairs';
  }
  const fx = (code: string | null) => {
    const x = code ? focus[code] : null;
    return code && x ? { economy: code, name: econName(c.meta, code, c.lang), held_abroad: x.out, held_abroad_via_pass_through: x.out_pass, foreign_held: x.in, foreign_held_via_pass_through: x.in_pass } : null;
  };
  const per = label(cur.p, f);
  const sources = panelSources(c, [`market.${key}`]);
  return envelope(c, {
    view: 'market', page: pagePath(c, `/m/${key}`, creditor && debtor ? { h: creditor, d: debtor } : {}), period: { freq: f, shown: cur.p, newest: mk.periods[mk.periods.length - 1].p },
    sources,
    summary: `${L}, ${per} positions (money-flow release ${c.m.tag}): ${usd(cur.total)} of cross-border holdings identified by pair; ${lead}. Rows hold, columns issued; residence basis, end-of-period stocks. Source: ${sourceNames(sources) || mk.ds}.`,
    data: {
      market: key, label: L, period: cur.p, freq: f, unit: 'USD', scale: 'bn', total_identified: cur.total, holders_count: cur.n_holders, destinations_count: cur.n_dests,
      kind, rows,
      creditor_totals: fx(creditor), debtor_totals: fx(debtor),
      largest_holders: kind === 'largest_pairs' ? byV(cur.holders).slice(0, limit).map(([e, v]) => ({ economy: e, name: econName(c.meta, e, c.lang), value: v })) : [],
      largest_destinations: kind === 'largest_pairs' ? byV(cur.dests).slice(0, limit).map(([e, v]) => ({ economy: e, name: econName(c.meta, e, c.lang), value: v })) : [],
    },
    table: { columns: [{ id: 'creditor', label: 'Holder (row)' }, { id: 'creditor_name', label: 'Holder name' }, { id: 'debtor', label: 'Destination (column)' }, { id: 'debtor_name', label: 'Destination name' }, { id: 'value', label: 'Position', unit: 'USD bn' }],
      rows: rows.map((r) => [r.creditor, enName(c.meta, r.creditor), r.debtor, enName(c.meta, r.debtor), r.value]) },
    notes,
  });
}

// ---------------------------------------------------------------- Cut a lender (R21)

function lenderCutOf(c: Ctx): LenderCut {
  const mk = read<Market>(c.m, 'mkt/bank');
  if (!mk?.lender_cut?.debtors) throw notInRelease(c, '"Cut a lender" data (rule R21, method 1.5)');
  return mk.lender_cut;
}

export function lenderCutView(c: Ctx, market: string) {
  if ((ALIAS[market] ?? market) !== 'bank') throw new SvcFail(404, 'unknown-market', 'Unknown market', `The lender cut is on the bank market only: GET /v1/money-flow/markets/bank/lender-cut (got ${cut(market)}).`);
  const lc = lenderCutOf(c);
  const ds = cutDebtors(lc);
  const rawDebtor = q(c, 'debtor');
  const lender = knownEconomy(c, q(c, 'lender'), 'lender');
  let debtor: string | null = null;
  if (rawDebtor) {
    const X = rawDebtor.toUpperCase();
    if (!lc.debtors[X]) throw new SvcFail(404, 'unknown-debtor', 'Not a lender-cut debtor', `debtor=${cut(rawDebtor)} is not one of the ${ds.length} Signal Board economies the lender cut covers: ${ds.join(', ')}.`);
    debtor = X;
  } else if (!lender) debtor = ds[0];                       // the page's default: by debtor, the largest claims first
  const rawPct = q(c, 'cut_pct');
  if (rawPct != null && !Number.isFinite(Number(rawPct))) throw bad('cut_pct', `cut_pct must be a number from 10 to 50, in steps of 5 (got "${cut(rawPct)}").`);
  const pct = clampCut(rawPct ?? undefined);
  const mode = debtor && lender ? 'pair' : debtor ? 'debtor' : 'lender';
  let cutRows: CutRow[] = mode === 'lender' ? cutByLender(lc, lender!, pct) : cutByDebtor(lc, debtor!, pct);
  if (mode === 'pair') cutRows = cutRows.filter((r) => r.eco === lender);
  cutRows = cutRows.slice(0, 15);
  const rows = cutRows.map((r) => {
    const l = mode === 'lender' ? lender! : r.eco, d = mode === 'lender' ? r.eco : debtor!;
    return { lender: l, lender_name: econName(c.meta, l, c.lang), debtor: d, debtor_name: econName(c.meta, d, c.lang), share_pct: r.share, claims_usd_bn: r.claims,
      loss_usd_bn: r2(r.loss), net_reserves_usd_bn: r.res_net, loss_pct_of_net_reserves: r2(r.of_res) };
  });
  // reporters without a loans-and-deposits split (R5): listed apart with their all-instrument amount, never a share
  const apartOf = (d: string) => allInstrument(lc, d).map(([l, v]) => ({ lender: l, lender_name: econName(c.meta, l, c.lang), debtor: d, debtor_name: econName(c.meta, d, c.lang), all_instruments_usd_bn: v }));
  const apart = mode === 'lender' ? ds.flatMap((d) => apartOf(d).filter((x) => x.lender === lender)) : apartOf(debtor!).filter((x) => mode !== 'pair' || x.lender === lender);
  const notes: string[] = [];
  const apartL = lender ? apart.filter((x) => x.lender === lender) : [];
  if (!rows.length) {
    if (apartL.length) notes.push(mode === 'lender'
      ? `Banks located in ${enName(c.meta, lender!)} report all instruments only, with no loans-and-deposits split, for ${apartL.length} of the covered economies; their loans and deposits are not reported, so they have no share. Their all-instrument amounts are in all_instrument_reporters.`
      : `Banks located in ${enName(c.meta, lender!)} report ${enName(c.meta, debtor!)} for all instruments only (${usd(apartL[0].all_instruments_usd_bn)}): their loans and deposits are not reported, so they have no share.`);
    else notes.push(mode === 'lender' ? `${lender} has no share of any covered debtor's bank loans and deposits.` : `${lender} has no share of ${debtor}'s bank loans and deposits (reporters under USD 0.05 bn are left out).`);
  }
  if (apart.length && mode === 'debtor') notes.push(`Reported for all instruments only (no loans-and-deposits split, so no share): ${apart.map((x) => `${enName(c.meta, x.lender)} ${usd(x.all_instruments_usd_bn)}`).join(', ')}. Their loans and deposits are not reported, which is not the same as none.`);
  if (rawPct != null && Number(rawPct) !== pct) notes.push(`cut_pct ${rawPct} was set to ${pct}, the page's slider (10–50, steps of 5).`);
  const top = rows[0];
  const dd = debtor ? lc.debtors[debtor] : null;
  const qL = label(lc.q, 'Q');
  const lead = !top ? (apartL.length ? (mode === 'lender' ? `loans and deposits of banks located in ${enName(c.meta, lender!)} are not reported for the economies covered (all instruments only, listed apart)` : `loans and deposits of banks located in ${enName(c.meta, lender!)} to ${enName(c.meta, debtor!)} are not reported (all instruments only: ${usd(apartL[0].all_instruments_usd_bn)})`)
      : mode === 'lender' ? `banks located in ${enName(c.meta, lender!)} have no share of the bank loans and deposits on any of the ${ds.length} economies covered` : `banks located in ${enName(c.meta, lender!)} have no share of the bank loans and deposits on ${enName(c.meta, debtor!)} (reporters under USD 0.05 bn are left out)`) : mode === 'lender'
    ? `if banks located in ${enName(c.meta, lender!)} cut their loans and deposits by ${pct}%, the hardest hit against its own net reserves is ${enName(c.meta, top.debtor)}: ${usd(top.loss_usd_bn, 2)}${top.loss_pct_of_net_reserves != null ? `, ${n1(top.loss_pct_of_net_reserves)}% of its net reserves` : ''}`
    : `if banks located in ${enName(c.meta, top.lender)} cut their loans and deposits to ${enName(c.meta, debtor!)} by ${pct}%, ${enName(c.meta, debtor!)} would lose ${usd(top.loss_usd_bn, 2)}${top.loss_pct_of_net_reserves != null ? `, ${n1(top.loss_pct_of_net_reserves)}% of its net reserves (${usd(dd ? netReserves(dd) : null)})` : ''}; they hold ${n1(top.share_pct)}% of all reporters' loans and deposits on it (${usd(dd?.claims_usd ?? null)})`;
  return envelope(c, {
    view: 'lender_cut', page: pagePath(c, '/m/bank', { cut: '1', by: mode === 'lender' ? 'lender' : 'debtor', e: mode === 'lender' ? lender : debtor, pct: String(pct) }),
    period: { freq: 'Q', shown: lc.q, newest: lc.q },
    sources: panelSources(c, ['market.bank_cut']),
    summary: `Cut a lender, ${qL} BIS LBS positions (money-flow release ${c.m.tag}, rule R21): ${lead}. First-round arithmetic on published figures, loss = cut × share × claims (${M.bank_loans_lbs}); net reserves are IMF IRFCL section I + II from the Signal Board, without A2's floor (no ratio where they are zero or below).`,
    data: {
      quarter: lc.q, cut_pct: pct, mode, formula: 'loss_usd_bn = cut_pct / 100 × share_pct / 100 × claims_usd_bn',
      debtor: debtor && dd ? { economy: debtor, name: econName(c.meta, debtor, c.lang), claims_usd_bn: dd.claims_usd, net_reserves_usd_bn: netReserves(dd), a2_reserve_base_usd_bn: dd.res_net } : null,
      lender: lender ? { economy: lender, name: econName(c.meta, lender, c.lang) } : null,
      rows, all_instrument_reporters: apart, debtors: ds,
    },
    table: {
      columns: [{ id: 'lender', label: 'Lender' }, { id: 'debtor', label: 'Debtor' }, { id: 'share_pct', label: 'Lender share of the debtor\'s bank loans and deposits', unit: '%' }, { id: 'claims_usd_bn', label: `Debtor's ${M.bank_loans_lbs}, all reporters`, unit: 'USD bn' },
        { id: 'loss_usd_bn', label: `Loss at a ${pct}% cut`, unit: 'USD bn' }, { id: 'net_reserves_usd_bn', label: 'Debtor\'s net reserves (IRFCL section I + II, no floor)', unit: 'USD bn' }, { id: 'loss_pct_of_net_reserves', label: 'Loss / net reserves', unit: '%' }],
      rows: rows.map((r) => [r.lender, r.debtor, r.share_pct, r.claims_usd_bn, r.loss_usd_bn, r.net_reserves_usd_bn, r.loss_pct_of_net_reserves]),
    },
    notes,
  });
}

// ---------------------------------------------------------------- Sovereign (R22–R28)

const SHORT: Record<RuleId, string> = { r1: 'Debt level', r2: 'Deficit', r3: 'Debt snowball', r4: 'Current account', r5: 'Net IIP', r6: 'Liquidity', r7: 'Spread' };
const UNIT: Record<string, string> = { pct_gdp: '% of GDP', pct: '% of A2\'s reserve base', pp: 'percentage points' };
// The source of a year's value (econ[*].src, R25 and R26): the Signal Board's quarterly figure at Q4, else the annual one.
const SRC: Record<string, Record<string, string>> = {
  r4: { mf: 'signal_board', weo: 'imf_weo' },
  r5: { mf: 'signal_board', iip: 'imf_iip_over_weo_gdp' },
};
const srcOf = (e: { src?: Record<string, (string | null)[]> }, r: RuleId, j: number): string | null => {
  if (r === 'r6') return e.src ? 'signal_board' : null;
  const x = e.src?.[r]?.[j];
  return x ? SRC[r]?.[x] ?? x : null;
};

function sovereignOf(c: Ctx): Sovereign {
  const d = read<Sovereign>(c.m, 'sovereign/global');
  if (!d) throw notInRelease(c, 'Sovereign section (it starts with method 1.5)');
  return d;
}

const sovName = (c: Ctx, d: Sovereign, X: string, lang: Lang) => d.names[X]?.[lang] || econName(c.meta, X, lang);

export function sovereignView(c: Ctx) {
  const d = sovereignOf(c);
  const raw = q(c, 'economy');
  const vintage = d.meta.vintage;
  const vl = vintageLabel(vintage, 'en');
  const sources = panelSources(c, ['sovereign.fiscal', 'sovereign.external', 'sovereign.market']);
  const proj = (y: number) => y >= d.proj0;
  const ruleDef = (r: RuleId) => ({ rule: REG[r], id: r, name: SHORT[r], group: d.rules[r].group, unit: UNIT[d.rules[r].unit] ?? d.rules[r].unit,
    direction: d.rules[r].dir === 'ge' ? 'at or above' : 'at or below', threshold: d.rules[r].default });
  if (raw) {
    const X = raw.toUpperCase();
    const e = d.econ[X];
    if (!ISO3.test(X) || !e) throw new SvcFail(404, 'unknown-economy', 'Not a Sovereign economy', `economy=${cut(raw)} is not one of the ${d.economies.length} economies the Sovereign page counts: ${d.economies.join(', ')}.`);
    const s = sovDefaults(d, X);
    const now = nowCount(d, e, s);
    const rules = RULES.map((r) => {
      const jj = e.now[r]?.kind === 'year' ? d.years.indexOf(Number(e.now[r]!.p)) : -1;
      return { ...ruleDef(r), latest_value: e.now[r]?.v ?? null, latest_period: e.now[r]?.p != null ? String(e.now[r]!.p) : null,
        latest_kind: e.now[r]?.kind ?? null, latest_source: jj >= 0 && e.now[r]?.v != null ? srcOf(e, r, jj) : null, state: nowState(d, e, r, s) };
    });
    const years = d.years.map((y, j) => ({ y, j, c: countAt(d, e, j, s) }));
    const sp = e.spread?.v ?? [];
    const t0 = e.spread?.t0;
    const spreadPts: Pt[] = [];
    if (t0 && sp.length) {
      const [y0, m0] = t0.split('-').map(Number);
      sp.forEach((v, i) => { const mm = m0 - 1 + i; const yy = y0 + Math.floor(mm / 12); const mo = (mm % 12) + 1; spreadPts.push([`${yy}-${String(mo).padStart(2, '0')}-01`, v]); });
    }
    const spreadLast = spreadPts.slice(-12).map(([p, v]) => ({ period: p.slice(0, 7), value: v }));
    const eps = d.episodes.filter((x) => x.eco === X).map((x) => ({ start: x.start, end: x.end, type: x.type, facility: x.facility, description: x.en, source: x.source }));
    const en = sovName(c, d, X, 'en');
    const lastRow = (r: RuleId) => rules.find((x) => x.id === r)!;
    const say = (r: RuleId, w: string) => { const x = lastRow(r); return x.latest_value == null ? null : `${w} ${n1(x.latest_value)}${x.unit === '% of GDP' ? '% of GDP' : x.unit.startsWith('%') ? '%' : ' pp'} (${x.latest_period})`; };
    return envelope(c, {
      view: 'sovereign', page: pagePath(c, '/sovereign', { e: X === 'KOR' ? null : X }), period: { freq: 'A', shown: String(d.last_actual), newest: String(d.years[d.years.length - 1]) },
      sources,
      summary: `${en}, sovereign stress signals (${vl}; money-flow release ${c.m.tag}, rules R22–R28): ${now.k} of ${now.n} rules signal on the latest values${now.on.length ? ` (${now.on.map((r) => REG[r]).join(', ')})` : ''}; the page's alarm is ${d.K.default} or more. ${[say('r1', 'Government debt'), say('r2', 'government balance'), say('r4', 'current account'), say('r7', 'bond spread')].filter(Boolean).join(', ')}. Years from ${d.proj0} are IMF projections. A count of signals, not a forecast.`,
      data: {
        economy: X, name: sovName(c, d, X, c.lang), vintage, published: d.meta.published, last_actual: d.last_actual, projections_from: d.proj0,
        signals_now: { count: now.k, of: now.n, signals: now.on.map((r) => REG[r]), alarm_at: d.K.default },
        rules, benchmark: e.bench, euro_member: e.eu,
        spread: { label: `10-year government bond yield spread over ${enName(c.meta, e.bench)}`, unit: 'percentage points', freq: 'M', points: spreadLast },
        years: years.map(({ y, j, c: k }) => ({ year: y, projection: proj(y), count: k.k, of: k.n, signals: k.on.map((r) => REG[r]),
          sources: { R25: e.v.r4[j] != null ? srcOf(e, 'r4', j) : null, R26: e.v.r5[j] != null ? srcOf(e, 'r5', j) : null, R27: e.v.r6[j] != null ? 'signal_board' : null } })),
        episodes: eps,
      },
      table: {
        columns: [{ id: 'year', label: 'Year' }, { id: 'projection', label: 'IMF projection (1 = yes)' }, ...RULES.map((r) => ({ id: r, label: `${REG[r]} ${SHORT[r]}`, unit: UNIT[d.rules[r].unit] })),
          { id: 'count', label: 'Signals' }, { id: 'of', label: 'Rules with data' },
          { id: 'r4_source', label: `${REG.r4} source (signal_board: the board's Q4 current account over ${M.gdp_bis}; imf_weo: WEO, ${M.gdp_weo})` },
          { id: 'r5_source', label: `${REG.r5} source (signal_board: the board's Q4 net IIP over ${M.gdp_bis}; imf_iip_over_weo_gdp: IMF IIP over ${M.gdp_weo})` }],
        rows: years.map(({ y, j, c: k }) => [y, proj(y) ? 1 : 0, ...RULES.map((r) => e.v[r][j] ?? null), k.k, k.n,
          e.v.r4[j] != null ? srcOf(e, 'r4', j) : null, e.v.r5[j] != null ? srcOf(e, 'r5', j) : null]),
      },
      notes: ['The latest values use the newest actual year (the spread: the 12-month average). Thresholds are the page\'s defaults; the page lets a reader move them.', 'The monthly spread lists its last 12 months; it is a difference of two OECD yields re-hosted on FRED, never a yield series.',
        `Each year's source: R25 and R26 take the Signal Board's fourth-quarter value (over ${M.gdp_bis}) where the board has the year, else the IMF WEO and IIP (over ${M.gdp_weo}); the two can differ by several points of GDP. R27 is the board's A2 (${M.a2}).`],
    });
  }
  const list = d.economies.filter((X) => d.econ[X]).map((X) => {
    const e = d.econ[X];
    const s = sovDefaults(d, X);
    const k = nowCount(d, e, s);
    return { economy: X, name: sovName(c, d, X, c.lang), count: k.k, of: k.n, signals: k.on.map((r) => REG[r]), alarm: k.k >= d.K.default, values: RULES.map((r) => e.now[r]?.v ?? null) };
  }).sort((a, b) => b.count - a.count || a.economy.localeCompare(b.economy));
  const v = d.valid;
  const alarms = list.filter((x) => x.alarm);
  return envelope(c, {
    view: 'sovereign', page: pagePath(c, '/sovereign'), period: { freq: 'A', shown: String(d.last_actual), newest: String(d.years[d.years.length - 1]) },
    sources,
    summary: `Sovereign stress signals for ${list.length} economies (${vl}; money-flow release ${c.m.tag}, rules R22–R28): ${alarms.length ? `${alarms.length} reach` : 'none reaches'} the page's alarm of ${d.K.default} or more of seven rules on the latest values${alarms.length ? ` (${alarms.slice(0, 6).map((x) => `${enName(c.meta, x.economy)} ${x.count}`).join(', ')})` : ''}; the most, ${list[0]?.count ?? 0}, for ${list.filter((x) => x.count === list[0]?.count).map((x) => enName(c.meta, x.economy)).join(', ')}. Against past crises the default count hit ${v.hits} of ${v.scored} episodes with a ${v.false_rate}% false-signal rate (AUROC ${v.auroc}). A count of signals, not a forecast.`,
    data: {
      vintage, published: d.meta.published, last_actual: d.last_actual, projections_from: d.proj0, alarm_at: d.K.default,
      rules: RULES.map(ruleDef),
      economies: list.map(({ values, ...x }) => x),
      validation: { episodes: v.episodes, scored: v.scored, hits: v.hits, hit_rate_pct: v.hit_rate, calm_years: v.calm, false_alarms: v.alarms, false_alarm_rate_pct: v.false_rate, auroc: v.auroc },
    },
    table: {
      columns: [{ id: 'economy', label: 'Economy' }, { id: 'name', label: 'Name' }, { id: 'count', label: 'Signals' }, { id: 'of', label: 'Rules with data' },
        ...RULES.map((r) => ({ id: r, label: `${REG[r]} ${SHORT[r]}, latest`, unit: UNIT[d.rules[r].unit] }))],
      rows: list.map((x) => [x.economy, enName(c.meta, x.economy), x.count, x.of, ...x.values]),
    },
    notes: ['Latest values: the newest actual year for R22–R27, the 12-month average for the spread (R28). The validation is the page\'s past-crises check with the defaults (checks V24–V25).'],
  });
}

// ---------------------------------------------------------------- Releases

const releaseChecks = (x: Record<string, number> | undefined) => ({ pass: x?.pass ?? 0, warning: x?.warning ?? 0, info: x?.info ?? 0, fail: x?.fail ?? 0 });

export function releasesView(c: Ctx) {
  const all = releases();
  const limit = intParam(c, 'limit', 25, 1, 100);
  const from = q(c, 'cursor');
  const start = from ? all.findIndex((r) => r.tag === from) + 1 : 0;
  if (from && start === 0) throw bad('cursor', `cursor ${cut(from)} is not a release tag of this list; use the cursor a previous answer gave.`);
  const page = all.slice(start, start + limit);
  const list = page.map((r) => ({ tag: r.tag, date: r.date, built: r.built, previous: manifest(r.tag).previous, method: r.method, checks: releaseChecks(r.checks), files_changed: r.changed.length }));
  const latest = all[0];
  return envelope(c, {
    view: 'releases', page: `/${c.lang}/releases`, sources: [],
    summary: `money-flow keeps ${all.length} releases, each citable by tag and never deleted; the latest is ${latest?.tag} of ${latest?.date} (method ${latest?.method}; checks: ${latest?.checks.pass ?? 0} pass, ${latest?.checks.warning ?? 0} warnings, ${latest?.checks.info ?? 0} for information, ${latest?.checks.fail ?? 0} failed).`,
    data: { latest: c.latest, count: all.length, releases: list },
    table: { columns: [{ id: 'tag', label: 'Release' }, { id: 'date', label: 'Date' }, { id: 'method', label: 'Method' }, { id: 'pass', label: 'Checks passed' }, { id: 'warning', label: 'Warnings' },
      { id: 'info', label: 'Information' }, { id: 'fail', label: 'Failed' }, { id: 'files_changed', label: 'Files changed' }],
      rows: list.map((r) => [r.tag, r.date, r.method, r.checks.pass, r.checks.warning, r.checks.info, r.checks.fail, r.files_changed]) },
    cursor: start + limit < all.length ? page[page.length - 1]?.tag : undefined,
  });
}

export function releaseView(c: Ctx, tag: string) {
  if (!TAG.test(tag)) throw new SvcFail(404, 'unknown-release', 'Unknown release', `${cut(tag)} is not a release tag. Tags look like 20261109.1; GET /v1/money-flow/releases lists them.`);
  const m = manifest(tag);
  if (m.tag !== tag) throw new SvcFail(404, 'unknown-release', 'Unknown release', `Release ${tag} is not kept. GET /v1/money-flow/releases lists the kept releases.`);
  const rc: Ctx = { ...c, m, meta: readMeta(m), reg: read<SourcesRegistry>(m, 'registry/sources') ?? c.reg };
  const datasets = Object.entries(m.vintages ?? {}).sort(([a], [b]) => a.localeCompare(b)).flatMap(([ds, vintage]) => {
    const e = rc.reg.datasets[ds];
    const cls = m.datasets?.[ds]?.class ?? e?.class;
    if (!e || !shown(rc, e.class) || !shown(rc, cls)) return [];
    return [{ dataset: ds, name: e.short, publisher: rc.reg.publishers[e.publisher]?.en ?? e.publisher, vintage, newest: m.datasets?.[ds]?.newest ?? null, freq: m.datasets?.[ds]?.freq ?? null, licence: e.class }];
  });
  const ch = releaseChecks(m.checks);
  return envelope(rc, {
    view: 'release', page: `/${c.lang}/releases#${m.tag}`, sources: datasetSources(rc, datasets.map((x) => x.dataset)),
    summary: `money-flow release ${m.tag} of ${m.date} (method ${m.method}, built ${m.built}${m.previous ? `, after ${m.previous}` : ''}): ${(m.changed ?? []).length} files changed; checks ${ch.pass} pass, ${ch.warning} warnings, ${ch.info} for information, ${ch.fail} failed; ${datasets.length} source datasets with their vintages.`,
    data: { tag: m.tag, date: m.date, built: m.built, previous: m.previous, method: m.method, code: m.code, latest: m.tag === c.latest, checks: ch, datasets, changed: m.changed ?? [] },
    table: { columns: [{ id: 'dataset', label: 'Dataset' }, { id: 'name', label: 'Name' }, { id: 'publisher', label: 'Publisher' }, { id: 'vintage', label: 'Vintage' }, { id: 'newest', label: 'Newest period' }, { id: 'freq', label: 'Frequency' }],
      rows: datasets.map((x) => [x.dataset, x.name, x.publisher, x.vintage, x.newest, x.freq]) },
  });
}

// ---------------------------------------------------------------- hooks: manifest, economy profile, search, item

export const VIEW_IDS = ['board', 'economies', 'economy', 'indicator', 'market', 'lender_cut', 'sovereign', 'pulse', 'releases', 'release'];

export function manifestView() {
  const m = manifest(null);
  return { app: 'money-flow', surface: '1.0', release: m.tag, built: m.built, method: m.method, views: VIEW_IDS };
}

export function profileView(c: Ctx, raw: string) {
  const X = (raw ?? '').toUpperCase();
  if (!ISO3.test(X)) throw bad('iso3', `${cut(raw ?? '')} is not an ISO 3166-1 alpha-3 code such as KOR.`);
  const covered = !!c.meta.economies[X]?.page && !!read<Econ>(c.m, `econ/${X}`);
  if (!covered) {
    return envelope(c, {
      view: 'profile', page: pagePath(c, '/economies'), sources: [],
      summary: `money-flow has no economy page for ${X} in release ${c.m.tag}; it covers ${Object.values(c.meta.economies).filter((e) => e.page).length} economies (GET /v1/money-flow/economies).`,
      data: { covered: false, code: X, name: c.meta.economies[X] ? econName(c.meta, X, c.lang) : null, headline: [], links: [{ label: 'Economies with a page', page: pagePath(c, '/economies') }] },
    });
  }
  const e = read<Econ>(c.m, `econ/${X}`)!;
  const tin = econTiles(c, e, 'in'), tout = econTiles(c, e, 'out');
  const pick = (ts: Tile[], id: string) => ts.find((x) => x.id === id);
  const h = (x: Tile | undefined, lbl?: string) => (x && x.value != null ? { label: lbl ?? x.label, value: x.value, unit: 'USD bn', period: x.period } : null);
  const board = boardMark(c, X);
  const sov = sovNow(c, X);
  const headline = [
    h(pick(tin, 'fx_reserves')),
    h(pick(tin, 'net_iip')),
    h(pick(tin, 'gross_external_liabilities')),
    h(pick(tin, 'securities_held_abroad'), 'Securities held abroad (ladder, identified holders)'),
    h(pick(tin, 'bank_claims'), `${M.bank_loans_lbs} (ladder)`),
    h(pick(tout, 'foreign_securities_held'), 'Foreign securities held (ladder)'),
    board?.vulnerability != null ? { label: 'Signal Board vulnerability (0–100)', value: board.vulnerability, unit: 'score', period: board.quarter } : null,
    sov ? { label: `Sovereign stress signals in ${sov.year} (of ${sov.of} rules with data)`, value: sov.count, unit: 'signals', period: String(sov.year) } : null,
  ].filter((x): x is NonNullable<typeof x> => !!x).slice(0, 8);
  const en = enName(c.meta, X);
  const links = [
    { label: 'Economy page: funding ladder, reserves, checks', page: pagePath(c, `/e/${X}`) },
    ...(board ? [{ label: 'Signal Board', page: board.page }] : []),
    ...(sov ? [{ label: 'Sovereign stress signals', page: sov.page }] : []),
    ...(read<Market>(c.m, 'mkt/bank')?.lender_cut?.debtors?.[X] ? [{ label: 'Cut a lender (bank market)', page: pagePath(c, '/m/bank', { cut: '1', by: 'debtor', e: X }) }] : []),
  ];
  const res = pick(tin, 'fx_reserves'), net = pick(tin, 'net_iip');
  return envelope(c, {
    view: 'profile', page: pagePath(c, `/e/${X}`), sources: datasetSources(c, ['imf.IIP', 'imf.PIP', 'bis.LBS', ...(e.made.fx_reserves ? [e.made.fx_reserves.ds] : [])]),
    summary: `${en} on money-flow (release ${c.m.tag}): foreign exchange reserves ${usd(res?.value)} (${label(res?.period, res?.freq ?? 'M')}), net international investment position ${usd(net?.value)} (${label(net?.period, 'Q')}, IMF IIP)${board ? `, Signal Board vulnerability ${n1(board.vulnerability, 0)} of 100 in ${label(board.quarter, 'Q')}` : ''}${sov ? `, ${sov.count} of ${sov.of} sovereign stress rules signalling in ${sov.year}` : ''}.`,
    data: { covered: true, code: X, name: econName(c.meta, X, c.lang), headline, links },
  });
}

interface Hit { id: string; kind: string; title: string; snippet: string; page: string; score: number }

const KEYWORDS: { id: string; kind: string; words: string[]; title: string; snippet: string; path: string }[] = [
  { id: 'board:latest', kind: 'board', words: ['signal board', 'board', 'vulnerability', 'vulnerable', 'outflow', 'outflows', 'withdrawal', 'funding', 'world', 'pulse'], title: 'Signal Board: funding vulnerability of 36 economies',
    snippet: 'Quarterly vulnerability (exposure and buffer weakness) against bank and bond funding flows for 36 borrowing economies.', path: '/world' },
  { id: 'sovereign:all', kind: 'sovereign', words: ['sovereign', 'fiscal', 'fiscal stress', 'government debt', 'debt', 'deficit', 'spread', 'stress', 'default', 'imf programme'], title: 'Sovereign stress signals: seven rules, 36 economies',
    snippet: 'Seven threshold rules on debt, deficits, the external accounts and bond spreads, counted for each economy and year beside past crises.', path: '/sovereign' },
  { id: 'market:equity', kind: 'market', words: ['equity', 'equities', 'stocks', 'shares', 'portfolio equity'], title: 'Portfolio equity: who holds whose shares', snippet: 'Cross-border equity positions as a holder × issuer matrix (IMF PIP).', path: '/m/equity' },
  { id: 'market:bonds', kind: 'market', words: ['bonds', 'bond', 'debt securities', 'portfolio debt', 'securities'], title: 'Portfolio debt: who holds whose bonds', snippet: 'Cross-border debt securities positions as a holder × issuer matrix (IMF PIP).', path: '/m/bonds' },
  { id: 'market:bank', kind: 'market', words: ['bank', 'banks', 'banking', 'loans', 'deposits', 'lender', 'lenders', 'cut a lender', 'bank claims'], title: 'Bank loans and deposits: who lends to whom', snippet: 'Cross-border bank claims as a lender × borrower matrix (BIS LBS), with the cut-a-lender scenario.', path: '/m/bank' },
  { id: 'market:fdi', kind: 'market', words: ['fdi', 'direct investment', 'foreign direct investment'], title: 'Direct investment: who invests where', snippet: 'Direct investment positions as an investor × host matrix (IMF DIP).', path: '/m/fdi' },
];

export function searchView(c: Ctx) {
  const raw = (q(c, 'q') ?? '').slice(0, 100);
  if (!raw) throw bad('q', 'q is required: an economy name or code (Korea, KOR), or a topic such as bank, bonds, Signal Board or sovereign.');
  const limit = intParam(c, 'limit', 10, 1, 20);
  const s = raw.toLowerCase();
  const hits: Hit[] = [];
  const sov = read<Sovereign>(c.m, 'sovereign/global');
  const w = read<World>(c.m, 'world/global');
  const onBoard = new Set(w?.board?.set.in ?? []);
  for (const [code, e] of Object.entries(c.meta.economies)) {
    if (!e.page) continue;
    const names = [e.en.toLowerCase(), (e.ko || '').toLowerCase()].filter(Boolean);
    let sc = 0;
    if (code.toLowerCase() === s || names.includes(s)) sc = 1;
    else if (names.some((n) => n.startsWith(s))) sc = 0.85;
    else if (s.length >= 3 && names.some((n) => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(n))) sc = 0.7;
    else if (s.length >= 2 && names.some((n) => n.includes(s))) sc = 0.5;
    if (!sc) continue;
    const nm = econName(c.meta, code, c.lang);
    hits.push({ id: `economy:${code}`, kind: 'economy', title: nm, snippet: `Who funds ${e.en} and where its money goes: funding ladder, reserves, external position, checks${onBoard.has(code) ? ', Signal Board mark' : ''}.`, page: pagePath(c, `/e/${code}`), score: sc });
    if (sov?.econ[code]) hits.push({ id: `sovereign:${code}`, kind: 'sovereign', title: `${nm}: sovereign stress signals`, snippet: `Seven threshold rules (R22–R28) counted for ${e.en} each year since 1990, with IMF projections.`, page: pagePath(c, '/sovereign', { e: code === 'KOR' ? null : code }), score: Math.round(sc * 60) / 100 });
  }
  for (const k of KEYWORDS) {
    if (k.kind === 'sovereign' && !sov) continue;
    const sc = k.words.includes(s) ? 1 : k.words.some((x) => (s.length >= 3 && x.includes(s)) || s.includes(x)) ? 0.7 : 0;
    if (sc) hits.push({ id: k.id, kind: k.kind, title: k.title, snippet: k.snippet, page: pagePath(c, k.path), score: sc });
  }
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return { items: hits.slice(0, limit) };
}

/** item: readable Markdown of what the page shows for one item (economy, market, board, sovereign). */
export function itemView(c: Ctx) {
  const id = q(c, 'id') ?? '';
  const m = /^(economy|market|board|sovereign):([A-Za-z0-9-]+)$/.exec(id);
  if (!m) throw new SvcFail(404, 'unknown-item', 'Unknown item', `${cut(id, 40)} is not an item id. Ids are <kind>:<key> with kinds economy (economy:KOR), market (market:bank), board (board:latest or board:2026-06-30) and sovereign (sovereign:KOR or sovereign:all); GET /v1/money-flow/search finds them.`);
  const [, kind, key] = m;
  const url = (p: string) => `${SITE}${p}`;
  const src = (s: Source[]) => s.map((x) => `- ${x.publisher}, ${x.dataset}${x.key ? ` (${x.key})` : ''}, vintage ${x.vintage ?? 'n/a'}, licence ${x.licence}: ${x.url}`).join('\n');
  let title: string, text: string, env: ReturnType<typeof envelope>;
  if (kind === 'economy') {
    const X = pageEconomy(c, key);
    env = economyView({ ...c, url: withParams(c.url, { part: 'summary' }) }, X);
    const s = env.data as { name: string; headline: string | null; tiles: Tile[]; board: ReturnType<typeof boardMark>; sovereign: ReturnType<typeof sovNow> };
    const lad = economyView({ ...c, url: withParams(c.url, { part: 'ladder' }) }, X).data as { directions: { direction: string; label: string; channels: { channel: string; label: string; total: number | null; period: string | null }[]; ribbons: { holder: string; name: string; channel: string; value: number | null }[] }[] };
    const chk = economyView({ ...c, url: withParams(c.url, { part: 'checks' }) }, X).data as { checks: { check: string; status: string; text: string }[] };
    title = `${s.name}: who funds it, where its money goes`;
    const ladderMd = lad.directions.map((d) => {
      const by = new Map<string, string[]>();
      for (const r of d.ribbons.slice().sort((a, b) => Number(a.holder.startsWith('_')) - Number(b.holder.startsWith('_')) || (b.value ?? 0) - (a.value ?? 0))) { const l = by.get(r.channel) ?? []; l.push(`${r.name} ${n1(r.value)}`); by.set(r.channel, l); }
      return `### ${d.label} (USD bn)\n${d.channels.filter((ch) => ch.total != null || by.has(ch.channel === 'portfolio_ns' ? 'unsplit' : ch.channel)).map((ch) => `- **${ch.label}** (${ch.period ?? 'n/a'}): total ${n1(ch.total)}${by.get(ch.channel === 'portfolio_ns' ? 'unsplit' : ch.channel)?.length ? `; ${by.get(ch.channel === 'portfolio_ns' ? 'unsplit' : ch.channel)!.join(', ')}` : ''}`).join('\n')}`;
    }).join('\n\n');
    text = `# ${title}\n\nmoney-flow release ${c.m.tag}, method ${c.m.method}. Page: ${url(env.page)}\n\n${s.headline ?? ''}\n\n## Headline figures\n${s.tiles.map((x) => `- ${x.label}: ${usd(x.value)} (${x.period ?? 'n/a'}; ${x.source}${x.note ? `; ${x.note}` : ''})`).join('\n')}\n`
      + (s.board ? `\n## Signal Board, ${label(s.board.quarter, 'Q')}\n- Vulnerability ${n1(s.board.vulnerability)} of 100; exposure ${n1(s.board.exposure)}, buffer weakness ${n1(s.board.buffer_weakness)}\n- A1 FX credit / GDP ${n1(s.board.a1_pct)}%; ${M.a2} ${n1(s.board.a2_pct)}%\n- Funding flow ${n1(s.board.flow_pct)}% a year of the previous stock\n` : '')
      + (s.sovereign ? `\n## Sovereign stress signals\n- ${s.sovereign.count} of ${s.sovereign.of} rules signal on the latest values, year ${s.sovereign.year}${s.sovereign.signals.length ? ` (${s.sovereign.signals.join(', ')})` : ''}; the page's alarm is ${s.sovereign.alarm_at} or more (${s.sovereign.vintage})\n` : '')
      + `\n## The money ladder\n${ladderMd}\n\n## Checks\n${chk.checks.map((x) => `- [${x.status}] ${x.check}: ${x.text}`).join('\n') || '- none'}\n\n## Sources\n${src(env.sources)}\n`;
  } else if (kind === 'market') {
    env = marketView({ ...c, url: withParams(c.url, { limit: '25' }) }, key);
    const d = env.data as { label: string; period: string; freq: string; total_identified: number; holders_count: number; destinations_count: number; rows: { creditor_name: string; debtor_name: string; value: number | null }[]; largest_holders: { name: string; value: number }[]; largest_destinations: { name: string; value: number }[] };
    title = `${d.label}: who holds whose assets`;
    text = `# ${title}\n\nmoney-flow release ${c.m.tag}, ${label(d.period, d.freq)} positions. Page: ${url(env.page)}\n\n${env.summary}\n\n- Cross-border positions identified by pair: ${usd(d.total_identified)}\n- Holders / destinations with pair data: ${d.holders_count} / ${d.destinations_count}\n\n## Largest holders (USD bn)\n${d.largest_holders.map((x) => `- ${x.name}: ${n1(x.value)}`).join('\n')}\n\n## Largest destinations (USD bn)\n${d.largest_destinations.map((x) => `- ${x.name}: ${n1(x.value)}`).join('\n')}\n\n## Largest pairs (holder → destination, USD bn)\n${d.rows.map((x) => `- ${x.creditor_name} → ${x.debtor_name}: ${n1(x.value)}`).join('\n')}\n\n## Sources\n${src(env.sources)}\n`;
  } else if (kind === 'board') {
    env = boardView({ ...c, url: withParams(c.url, { quarter: key === 'latest' ? null : key }) });
    const d = env.data as { quarter_label: string; economies_drawn: number; net_outflow: number; marks: { name: string; vulnerability: number | null; flow_pct: number | null; exposure: number | null; buffer_weakness: number | null; a1_pct: number | null; a2_pct: number | null }[]; largest_withdrawals: { name: string; flow_usd_bn: number }[] };
    title = `Signal Board, ${d.quarter_label}`;
    text = `# ${title}\n\nmoney-flow release ${c.m.tag}, method ${c.m.method}. Page: ${url(env.page)}\n\n${env.summary}\n\n## Largest withdrawals (bank and bond flows, USD bn)\n${d.largest_withdrawals.map((x) => `- ${x.name}: ${n1(x.flow_usd_bn)}`).join('\n') || '- none'}\n\n## Marks, most vulnerable first\n\n| Economy | Vulnerability | Flow (% a year) | Exposure | Buffer weakness | A1 FX credit / GDP (%) | ${M.a2} (%) |\n|---|---|---|---|---|---|---|\n${d.marks.map((x) => `| ${x.name} | ${n1(x.vulnerability)} | ${n1(x.flow_pct)} | ${n1(x.exposure)} | ${n1(x.buffer_weakness)} | ${n1(x.a1_pct)} | ${n1(x.a2_pct)} |`).join('\n')}\n\n## Sources\n${src(env.sources)}\n`;
  } else {
    env = sovereignView({ ...c, url: withParams(c.url, { economy: key === 'all' ? null : key }) });
    if (key === 'all') {
      const d = env.data as { economies: { name: string; count: number; of: number; signals: string[] }[]; alarm_at: number };
      title = 'Sovereign stress signals: seven rules, 36 economies';
      text = `# ${title}\n\nmoney-flow release ${c.m.tag}. Page: ${url(env.page)}\n\n${env.summary}\n\n## Signals on the latest values (alarm at ${d.alarm_at} or more)\n${d.economies.map((x) => `- ${x.name}: ${x.count} of ${x.of}${x.signals.length ? ` (${x.signals.join(', ')})` : ''}`).join('\n')}\n\n## Sources\n${src(env.sources)}\n`;
    } else {
      const d = env.data as { name: string; rules: { rule: string; name: string; unit: string; direction: string; threshold: number; latest_value: number | null; latest_period: string | null; state: string }[]; signals_now: { count: number; of: number }; episodes: { start: string; end: string | null; description: string | null }[] };
      title = `${d.name}: sovereign stress signals`;
      text = `# ${title}\n\nmoney-flow release ${c.m.tag}. Page: ${url(env.page)}\n\n${env.summary}\n\n## The seven rules on the latest values\n${d.rules.map((r) => `- ${r.rule} ${r.name}: ${n1(r.latest_value, 2)} ${r.unit} (${r.latest_period ?? 'n/a'}); signals ${r.direction} ${r.threshold}: ${r.state}`).join('\n')}\n\n## Past episodes\n${d.episodes.map((x) => `- ${x.start}${x.end ? ` to ${x.end}` : ''}: ${x.description ?? ''}`).join('\n') || '- none since 1990'}\n\n## Sources\n${src(env.sources)}\n`;
    }
  }
  return envelope(c, {
    view: 'item', page: env.page, period: (env as { period?: Period }).period, sources: env.sources, summary: env.summary,
    data: { id: `${kind}:${key}`, title, text: text.length > 20000 ? `${text.slice(0, 19990)}\n\n…` : text, metadata: { kind, key, release: c.m.tag, method: c.m.method, url: url(env.page) } },
  });
}

function withParams(u: URL, p: Record<string, string | null>): URL {
  const x = new URL(u.toString());
  for (const [k, v] of Object.entries(p)) { if (v == null) x.searchParams.delete(k); else x.searchParams.set(k, v); }
  return x;
}
