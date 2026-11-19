// From a release's economy file to what one view draws. Runs on the server: it picks the ladder for
// the day and settings, and turns every mark into a ribbon with its provenance text. It never sums a reported total:
// totals, Other, coverage and shares all come from the build (R13); the only additions here are layout widths.
import { amt, at, bn, day, money, num, period, pct, tile } from './format';
import { josa } from './josa';
import { name, t } from './i18n';
import type { Checks, DatasetEntry, Econ, Group, Lang, Ladder, Meta, SourcesRegistry } from './types';

// bank_nat (method 1.6): in the nationality view the BIS CBS foreign claims are an overlay beside the
// IIP, in a pool of their own drawn last, never in the IIP liabilities' stack and never in the headline's sum.
export const GROUPS = ['debt', 'bank', 'bank_other', 'fdi', 'equity', 'unsplit', 'reserves', 'bank_nat'] as const;
export const POOL_OF: Record<string, string> = { debt: 'debt', bank: 'bank', bank_other: 'bank_other', fdi: 'fdi', equity: 'equity', unsplit: 'portfolio_ns', reserves: 'reserves', bank_nat: 'bank_nat' };
const DS_OF: Record<string, string> = { debt: 'imf.PIP', equity: 'imf.PIP', unsplit: 'imf.PIP', bank: 'bis.LBS', bank_other: 'bis.LBS', fdi: 'imf.DIP', reserves: 'imf.IIP', bank_nat: 'bis.CBS' };
const FREQ_OF: Record<string, string> = { debt: 'S', equity: 'S', unsplit: 'S', bank: 'Q', bank_other: 'Q', fdi: 'A', reserves: 'Q', portfolio: 'S', bank_nat: 'Q' };

export interface Params { dir: 'in' | 'out'; mode: 'aligned' | 'newest'; basis: 'res' | 'nat'; width: 'pos' | 'flow'; k: 5 | 10 | 20; d: string; off: string[] }

export function params(sp: Record<string, string | string[] | undefined>, meta: Meta): Params {
  const g = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) as string | undefined;
  const k = Number(g('k'));
  const d = g('d');
  return {
    dir: g('dir') === 'out' ? 'out' : 'in',
    mode: g('al') === '0' ? 'newest' : 'aligned',
    basis: g('b') === 'nat' ? 'nat' : 'res',
    width: g('w') === 'flow' ? 'flow' : 'pos',
    k: (k === 5 || k === 20 ? k : 10) as 5 | 10 | 20,
    d: d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= '2000-01-01' && d <= meta.day ? d : meta.day,
    off: (g('ch') ?? '').split(',').filter((x) => (GROUPS as readonly string[]).includes(x)),
  };
}

export function query(p: Params, meta: Meta, r?: string): string {
  const q = new URLSearchParams();
  if (p.d !== meta.day) q.set('d', p.d);
  if (p.dir !== 'in') q.set('dir', p.dir);
  if (p.width !== 'pos') q.set('w', p.width);
  if (p.basis !== 'res') q.set('b', p.basis);
  if (p.mode !== 'aligned') q.set('al', '0');
  if (p.k !== 10) q.set('k', String(p.k));
  if (p.off.length) q.set('ch', p.off.join(','));
  if (r) q.set('r', r);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function ladderAt(e: Econ, dir: 'in' | 'out', mode: 'aligned' | 'newest', d: string): { ladder: Ladder; asof: string } | null {
  const idx = e.index[dir]?.[mode];
  if (!idx) return null;
  const dates = Object.keys(idx).sort();
  let pick = dates[0];
  for (const x of dates) { if (x <= d) pick = x; else break; }
  return pick ? { ladder: e.ladders[dir][idx[pick]], asof: pick } : null;
}

export interface Rib { id: string; holder: string; group: string; pool?: string; value: number; flow: number | null; kind: string | null; period: string; freq: string; ds: string; rules: string[]; rep: string | null; share: number | null; desc: string; label: string }
export interface NodeM { code: string; label: string; fc: boolean; fd?: boolean; kind: 'holder' | 'other' | 'ni' | 'whole' }
export interface PoolM { id: string; label: string; total: number | null; period: string; freq: string; note: string }
export interface Bar { id: string; label: string; value: number | null; period: string; freq: string; ds: string; layer?: number; dashed?: boolean }

export interface ViewModel {
  econ: string; econName: string; p: Params; asof: string;
  per: Record<string, string | null>;
  holders: NodeM[]; pools: PoolM[]; ribbons: Rib[];
  apex: Bar[]; made: Bar[];
  border: { side: string; items: { item: string; value: number | null }[]; period: string };
  headline: string; kicker: string; status: string;
  kpis: { label: string; value: string; unit: string; sub: string; ds: string | null; hint?: string; tone?: 'pos' | 'neg'; wrap?: boolean }[];
  coverage: { label: string; cov: number | null; text: string }[];
  sources: { ds: string; label: string; freq: string; newest: string }[];
  rules: string[];
  sourceLine: string;
  checks: { status: string; label: string; text: string }[];
  table: { holder: string; channel: string; value: number; flow: number | null; period: string; source: string; rules: string; rep: string }[];
  context: { label: string; value: string; note: string }[];
  notes: string[];
}

function lbl(meta: Meta, code: string, lang: Lang): string {
  if (code === '_fdi') return t(lang).directInvestors;
  if (code === '_res') return lang === 'ko' ? '준비자산(보유처 미공개)' : 'Reserve assets (holders not published)';
  return name(meta.economies, code, lang);
}

export function dsLabel(reg: SourcesRegistry, ds: string, lang: Lang): string {
  const e: DatasetEntry | undefined = reg.datasets[ds];
  if (!e) return ds;
  const pub = reg.publishers[e.publisher];
  return lang === 'ko' ? `${pub?.ko ?? ''} ${e.ko}`.trim() : `${pub?.short ?? ''} ${e.en.charAt(0).toLowerCase() + e.en.slice(1)}`.trim();
}

/** The series a ribbon stands for, as a pointer (sources.yaml templates): publisher, dataset and dimensions. */
function describe(reg: SourcesRegistry, ds: string, vars: Record<string, string>, lang: Lang): string {
  const tpl = reg.datasets[ds]?.series?.[lang] ?? ds;
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

export function build(e: Econ, meta: Meta, reg: SourcesRegistry, checks: Checks | null, p: Params, lang: Lang, release: string): ViewModel | null {
  const L = t(lang);
  const hit = ladderAt(e, p.dir, p.mode, p.d);
  if (!hit) return null;
  const { ladder, asof } = hit;
  const X = e.code, xName = lbl(meta, X, lang);
  const per = ladder.per;
  const ribbons: Rib[] = [];
  const keepHolders = new Set<string>();
  const top = ladder.rank.slice(0, p.k);
  const groupPer = (g: string) => ((g === 'bank' && p.basis === 'nat') || g === 'bank_nat' ? ladder.nat?.per ?? null : per[g === 'debt' || g === 'equity' || g === 'unsplit' ? 'portfolio' : g === 'bank_other' ? 'bank' : g]) ?? '';
  const instrument: Record<string, Record<Lang, string>> = {
    debt: { en: 'debt securities', ko: '채권' }, equity: { en: 'equity', ko: '주식' }, unsplit: { en: 'securities (type not reported)', ko: '증권(유형 미보고)' },
    bank: { en: 'loans and deposits', ko: '대출과 예금' }, bank_other: { en: 'derivatives and other instruments', ko: '파생금융상품과 기타 상품' },
    bank_nat: { en: 'all instruments', ko: '전체 상품' },
  };
  const totalOf = (g: string): number | null => {
    if (g === 'debt' || g === 'equity' || g === 'unsplit') return ladder.g.portfolio?.total ?? null;
    if (g === 'bank_nat' || (g === 'bank' && p.basis === 'nat')) return ladder.nat?.total ?? null;
    if (g === 'bank_other') return ladder.g.bank_other?.total ?? null;   // its own total: the IIP derivatives item is not its border (J6)
    return ladder.g[g]?.total ?? null;
  };
  const rulesFor = (g: string, holder: string): string[] => {
    const r = ['R1', 'R2'];
    if (g === 'debt' || g === 'equity' || g === 'unsplit') r.push('R3');
    if (g === 'fdi') r.push('R4');
    if (g === 'bank_nat') r.push('R10');
    else if (g === 'bank' || g === 'bank_other') r.push('R5');
    if (holder === '_ni' || holder === '_fdi' || holder === '_other' || holder === '_rio' || holder === '_oi' || g === 'bank_other') r.push('R6');
    r.push('R7', 'R11');
    if (p.width === 'flow') r.push('R8');
    return r;
  };
  const add = (g: string, holder: string, value: number | null | undefined, flow: [number | null, string] | null, rep: string | null, ds: string, note?: string) => {
    if (p.off.includes(g)) return;
    const v = p.width === 'flow' ? (flow?.[0] ?? null) : value;
    if (v == null || !Number.isFinite(v) || Math.abs(v) < 0.05) return;
    if (p.width === 'pos' && v < 0) return;                       // an excess over the total is flagged, never drawn as width
    const prd = groupPer(g);
    const tot = totalOf(g);
    const vars = {
      creditor: p.dir === 'in' ? lbl(meta, holder, lang) : xName, debtor: p.dir === 'in' ? xName : lbl(meta, holder, lang),
      instrument: instrument[g]?.[lang] ?? '', sector: lang === 'ko' ? '전 부문' : 'all sectors',
      basis: lang === 'ko' ? '직접 차주' : 'immediate borrower', reported_by: rep ? (L.reportedBy[rep] ?? rep) : '', economy: xName,
      side: p.dir === 'in' ? (lang === 'ko' ? '부채' : 'liabilities') : (lang === 'ko' ? '자산' : 'assets'), item: L.iip[g === 'fdi' ? 'direct' : g === 'reserves' ? 'reserves' : 'portfolio'],
    };
    let desc = describe(reg, ds, vars, lang);
    if (holder === '_ni') {
      const totDs = g === 'bank_nat' ? 'bis.CBS' : g === 'bank' ? 'bis.LBS' : g === 'fdi' && ladder.g.fdi?.dip_total != null ? 'imf.DIP' : 'imf.IIP';
      desc = lang === 'ko' ? `총계(${dsLabel(reg, totDs, lang)})에서 확인된 짝 자료를 뺀 나머지` : `The total (${dsLabel(reg, totDs, lang)}) less the parts that pair data identify`;
      if (g === 'unsplit') desc += lang === 'ko' ? '어느 보고 보유국도, 준비자산 운용기관·국제기구 집단도 보고하지 않은 부분입니다. 보고하지 않는 보유국, 비공개 칸, 평가 차이가 섞여 있습니다.' : '. Reported by no holder and not in the reserves-and-IO group: non-reporting holders, confidential cells and valuation differences';
      if (g === 'bank' && ladder.g.bank?.nosplit) desc += (lang === 'ko' ? '. 그중 상품 구분을 내지 않는 보고국(전 상품 기준): ' : '. Of which reporters that publish no instrument split (all instruments): ') + Object.entries(ladder.g.bank.nosplit).map(([h, v]) => `${lbl(meta, h, lang)} ${money(v, lang)}`).join(', ');
    }
    if (holder === '_rio') desc = lang === 'ko' ? `IMF PIP: ${xName} 증권 가운데 준비자산(SEFER)으로, 또 국제기구(SSIO)가 보유한 부분. IMF가 비공개 집단 하나로만 발표하므로 보유국 순위에 넣지 않습니다` : `IMF PIP: ${xName}'s securities held as reserve assets (SEFER) and by international organisations (SSIO). The IMF publishes them as one confidential group, so they are identified but not ranked`;
    if (holder === '_oi') desc = L.oiDesc.replace('{economy}', xName);
    if (note) desc += `. ${note}`;
    if (holder === '_other') desc = lang === 'ko' ? `상위 ${p.k}개 밖의 모든 ${p.dir === 'in' ? '보유국' : '대상국'}` : `Every ${p.dir === 'in' ? 'holder' : 'destination'} outside the top ${p.k}`;
    if (holder === '_fdi') desc = lang === 'ko' ? `IMF IIP 직접투자 ${vars.side} 총계입니다. DIP(연간)에는 이 기간 짝 자료가 없습니다.` : `IMF IIP direct investment ${vars.side}, total. DIP (annual) has no pair data for this period`;
    ribbons.push({
      id: `${g}:${holder}`, holder, group: g, value: Math.abs(v), flow: flow?.[0] ?? null, kind: flow?.[1] ?? null, period: prd, freq: FREQ_OF[g] ?? 'Q', ds,
      rules: rulesFor(g, holder), rep: rep ? (L.reportedBy[rep] ?? rep) : null, share: tot && v != null && p.width === 'pos' ? (100 * v) / tot : null, desc, label: lbl(meta, holder, lang),
    });
    keepHolders.add(holder);
  };
  const addGroup = (g: string, grp: Group | undefined, rank: string[], ds: string) => {
    if (!grp) return;
    for (const h of rank) if (grp.parts?.[h] != null) add(g, h, grp.parts[h], grp.flow?.[h] ?? null, grp.rep?.[h] ?? null, ds,
      grp.alt?.[h] != null ? (lang === 'ko' ? `다른 쪽 보고(${grp.rep?.[h] === 'debtor' ? '투자국' : '투자 대상국'}): ${money(grp.alt[h], 'ko')}` : `The other report (${grp.rep?.[h] === 'debtor' ? 'investor' : 'host'}): ${money(grp.alt[h], 'en')}`) : undefined);
    if (grp.rio != null && p.width === 'pos') add(g, '_rio', grp.rio, null, null, ds);
    const of = grp.other_flow?.[String(p.k)];
    const ofKind = of ? Object.keys(of)[0] : null;
    add(g, '_other', grp.other?.[String(p.k)], ofKind && of ? [of[ofKind], ofKind] : null, null, ds);
  };
  addGroup('debt', ladder.g.debt, top, 'imf.PIP');
  addGroup('equity', ladder.g.equity, top, 'imf.PIP');
  addGroup('unsplit', ladder.g.unsplit, top, 'imf.PIP');
  if (p.width === 'pos') add('unsplit', '_ni', ladder.g.portfolio?.ni, null, null, 'imf.IIP');
  if (p.basis === 'nat' && ladder.nat) {
    const n = ladder.nat;
    const nrank = n.rank.slice(0, p.k);
    for (const h of nrank) add('bank_nat', h, n.parts[h], null, null, 'bis.CBS');
    add('bank_nat', '_other', n.other[String(p.k)], null, null, 'bis.CBS');
    if (p.width === 'pos') add('bank_nat', '_ni', n.ni, null, null, 'bis.CBS');
  } else {
    addGroup('bank', ladder.g.bank, top, 'bis.LBS');
    if (p.width === 'pos') add('bank', '_ni', ladder.g.bank?.ni, null, null, 'bis.LBS');
    if (p.width === 'pos' && ladder.g.bank_other?.total != null) add('bank_other', '_oi', ladder.g.bank_other.total, null, null, 'bis.LBS');
  }
  if (ladder.g.fdi?.split) {
    addGroup('fdi', ladder.g.fdi, top, 'imf.DIP');
    if (p.width === 'pos') add('fdi', '_ni', ladder.g.fdi?.ni, null, null, 'imf.IIP');
  } else if (p.width === 'pos') {
    add('fdi', '_fdi', ladder.g.fdi?.total, null, null, 'imf.IIP');
  }
  if (p.dir === 'out' && p.width === 'pos') add('reserves', '_res', ladder.g.reserves?.total, null, null, 'imf.IIP');

  // holders, west to east (stretched longitude order), then Other, the unsplit totals, Not identified
  const lon = (c: string) => meta.economies[c]?.lon ?? 999;
  const order = [...keepHolders].filter((h) => !h.startsWith('_')).sort((a, b) => lon(a) - lon(b) || a.localeCompare(b));
  for (const s of ['_rio', '_other', '_fdi', '_oi', '_res', '_ni']) if (keepHolders.has(s)) order.push(s);
  const holders: NodeM[] = order.map((c) => ({ code: c, label: lbl(meta, c, lang), fc: !!meta.economies[c]?.fc, fd: !!meta.economies[c]?.fd, kind: c === '_other' ? 'other' : c === '_ni' ? 'ni' : c.startsWith('_') ? 'whole' : 'holder' }));
  ribbons.sort((a, b) => order.indexOf(a.holder) - order.indexOf(b.holder) || GROUPS.indexOf(a.group as never) - GROUPS.indexOf(b.group as never));

  const pp = per.portfolio ?? '';
  const poolNote = (g: string) => {
    const pr = groupPer(g);
    return `${period(pr, FREQ_OF[g], lang)} · ${({ S: lang === 'ko' ? '반기' : 'half-yearly', Q: lang === 'ko' ? '분기' : 'quarterly', A: lang === 'ko' ? '연간' : 'annual' } as Record<string, string>)[FREQ_OF[g]] ?? ''}`;
  };
  const pools: PoolM[] = [
    { id: 'debt', label: L.channel.debt, total: ladder.g.debt?.ident ?? null, period: pp, freq: 'S', note: poolNote('debt') },
    { id: 'bank', label: L.channel.bank, total: ladder.g.bank?.total ?? null, period: groupPer('bank'), freq: 'Q', note: poolNote('bank') + (p.basis === 'res' && ladder.g.bank?.debt_sec != null ? (lang === 'ko' ? ` · 채권 ${money(ladder.g.bank.debt_sec, 'ko')}은 증권투자(채권)에` : ` · debt securities ${money(ladder.g.bank.debt_sec, 'en')} are in portfolio debt`) : '') },
    { id: 'bank_other', label: L.channel.bank_other, total: ladder.g.bank_other?.total ?? null, period: groupPer('bank'), freq: 'Q', note: poolNote('bank') },
    { id: 'fdi', label: L.channel.fdi, total: ladder.g.fdi?.total ?? null, period: per.fdi ?? '', freq: 'A', note: `${poolNote('fdi')}${ladder.g.fdi?.dip_total != null ? ` · ${lang === 'ko' ? 'DIP 총계' : 'DIP total'}${ladder.g.fdi?.iip_total != null ? ` · IIP ${money(ladder.g.fdi.iip_total, lang)}` : ''}` : ''}` },
    { id: 'equity', label: L.channel.equity, total: ladder.g.equity?.ident ?? null, period: pp, freq: 'S', note: poolNote('equity') },
    { id: 'portfolio_ns', label: lang === 'ko' ? '증권투자, 유형·보유국 미확인' : 'Portfolio, type or holder not identified', total: null, period: pp, freq: 'S', note: poolNote('unsplit') },
  ];
  if (p.dir === 'out') pools.push({ id: 'reserves', label: L.channel.reserves, total: ladder.g.reserves?.total ?? null, period: per.reserves ?? '', freq: 'Q', note: period(per.reserves, 'Q', lang) });
  if (p.basis === 'nat') pools.push({ id: 'bank_nat', label: L.channel.bank_nat, total: ladder.nat?.total ?? null, period: groupPer('bank_nat'), freq: 'Q', note: `${poolNote('bank_nat')} · ${L.natPoolNote}` });

  // apex strip and the made-here column: the newest value at or before the day
  const apex: Bar[] = [];
  const made: Bar[] = [];
  const mk = (id: string, s: { ds: string; f: string; pts: [string, number | null][] } | undefined, label: string, layer?: number): Bar | null => {
    const v = s ? at(s.pts, p.d) : null;
    return v ? { id, label, value: v[1], period: v[0], freq: s!.f, ds: s!.ds, layer, dashed: layer === 2 } : null;
  };
  const LAYER: Record<string, number> = { cb_assets: 0, monetary_base: 0, currency: 0, reserves_banks: 0, m1: 1, broad_money: 1, m3: 1, lf: 1, l: 2, fx_reserves: 0 };
  for (const m of ['cb_assets', 'monetary_base', 'm1', 'broad_money', 'm3', 'lf', 'l', 'fx_reserves']) {
    const b = mk(m, e.made[m], L.measure[m] ?? m, LAYER[m]);
    if (b) made.push(b);
  }

  const side = p.dir === 'in' ? 'in' : 'out';
  const bp = per.portfolio ?? per.bank ?? asof;
  const border = { side, period: bp, items: ['total', 'portfolio', 'direct', 'other', 'reserves'].filter((i) => !(side === 'in' && i === 'reserves')).map((i) => ({ item: i, value: (e.border[side]?.iip[i] ?? []).find((x) => x[0] === bp)?.[1] ?? null })) };

  // headline (generated from the marks with a fixed template)
  // headline (generated from the drawn marks with a fixed template): it states the node the chart draws for the largest
  // holder, channel by channel, and then the portfolio share of the identified total. A node that mixes channels is never
  // described with a portfolio-only denominator (audit of 29 Oct 2026, F2).
  const pg = ladder.g.portfolio ?? {};
  const topCode = pg.top as string | undefined;
  const topName = topCode ? lbl(meta, topCode, lang) : '';
  const share = (pg as { top_share?: number }).top_share;
  let headline: string;
  let shareLine = '';
  if (pg.ident && topCode && topName && share != null) {
    const drawnOf = (g: string) => ribbons.filter((r) => r.holder === topCode && r.group === g).reduce((a, r) => a + r.value, 0);
    const port = drawnOf('debt') + drawnOf('equity') + drawnOf('unsplit');
    const bank = drawnOf('bank'), fdi = drawnOf('fdi');
    const node = port + bank + fdi;
    const parts: string[] = [];
    if (port > 0) parts.push(lang === 'ko' ? `증권 ${bn(port, 'ko')}` : `${bn(port, 'en')} in securities`);
    if (bank > 0) parts.push(lang === 'ko' ? `${p.basis === 'nat' ? '은행 대외채권(국적)' : '은행 대출·예금'} ${bn(bank, 'ko')}` : `${bn(bank, 'en')} in bank ${p.basis === 'nat' ? 'claims (nationality)' : 'loans and deposits'}`);
    if (fdi > 0) parts.push(lang === 'ko' ? `직접투자 ${bn(fdi, 'ko')}` : `${bn(fdi, 'en')} in direct investment`);
    if (parts.length > 1) {
      headline = p.dir === 'in'
        ? (lang === 'ko' ? `${topName}은 ${xName}에 ${bn(node, 'ko')}의 청구권을 가진다: ${parts.join(', ')}` : `${topName} holds ${bn(node, 'en')} of claims on ${xName}: ${parts.join(', ')}`)
        : (lang === 'ko' ? `${xName} 거주자는 ${topName}에 ${bn(node, 'ko')}의 청구권을 가진다: ${parts.join(', ')}` : `${xName}'s residents hold ${bn(node, 'en')} of claims on ${topName}: ${parts.join(', ')}`);
    } else {
      headline = p.dir === 'in'
        ? (lang === 'ko' ? `${xName} 증권 해외 보유분(확인분 ${bn(pg.ident, 'ko')}) 중 ${josa(pct(share, 'ko'), '이')} ${topName} 몫입니다` : `${topName} holds ${pct(share, 'en')} of the ${bn(pg.ident, 'en')} of ${xName}'s securities identified by holder`)
        : (lang === 'ko' ? `${xName} 거주자의 해외 증권 ${bn(pg.ident, 'ko')} 중 ${josa(pct(share, 'ko'), '이')} ${topName} 증권입니다` : `${pct(share, 'en')} of the ${bn(pg.ident, 'en')} of foreign securities held in ${xName} are ${topName}'s`);
    }
    shareLine = p.dir === 'in'
      ? (lang === 'ko' ? `보유국이 확인된 증권 ${bn(pg.ident, 'ko')}(준비자산 운용기관·국제기구 ${bn((pg as { rio?: number }).rio ?? 0, 'ko')} 포함) 중 ${topName} ${pct(share, 'ko')}` : `${topName} holds ${pct(share, 'en')} of the ${bn(pg.ident, 'en')} of securities identified by holder (including ${bn((pg as { rio?: number }).rio ?? 0, 'en')} held by reserve managers and international organisations)`)
      : (lang === 'ko' ? `보유 해외 증권 ${bn(pg.ident, 'ko')} 중 ${topName} 증권 ${pct(share, 'ko')}` : `${topName}'s securities are ${pct(share, 'en')} of the ${bn(pg.ident, 'en')} of foreign securities identified by issuer`);
  } else {
    headline = lang === 'ko' ? `${xName}의 돈의 사다리` : `The money ladder of ${xName}`;
  }
  const kicker = `${L.page.econ} · ${xName} · ${p.dir === 'in' ? L.inflows : L.outflows}`;
  const freqWord = (f: string) => ({ S: lang === 'ko' ? '반기' : 'half-yearly', Q: lang === 'ko' ? '분기' : 'quarterly', A: lang === 'ko' ? '연간' : 'annual' } as Record<string, string>)[f];
  const status = lang === 'ko'
    ? `증권 ${period(per.portfolio, 'S', 'ko')}(${freqWord('S')}) · 은행 ${period(groupPer('bank'), 'Q', 'ko')}(${freqWord('Q')}) · 직접투자 ${period(per.fdi, 'A', 'ko')} · 릴리스 ${release} · 방법론 ${meta.method}`
    : `Portfolio ${period(per.portfolio, 'S', 'en')} (${freqWord('S')}) · bank claims ${period(groupPer('bank'), 'Q', 'en')} (${freqWord('Q')}) · direct investment ${period(per.fdi, 'A', 'en')} · release ${release} · method ${meta.method}`;
  const statusFull = shareLine ? `${shareLine} · ${status}` : status;

  // KPI row
  const iipTot = border.items.find((i) => i.item === 'total')?.value ?? null;
  const res = mk('fx_reserves', e.made.fx_reserves, L.measure.fx_reserves);
  const bankTot = p.basis === 'nat' ? ladder.nat?.total : ladder.g.bank?.total;
  const usd = e.usd_bank ? at(e.usd_bank.pts, groupPer('bank') || p.d) : null;
  // the IIP tiles (method 1.3 review): the gross total names what it holds (equity included), split into debt and
  // equity-like instruments, beside the assets and the net position with its sign. Equity liabilities are marked to market.
  const iipAt = (s: 'in' | 'out', item: string) => (e.border[s]?.iip[item] ?? []).find((x) => x[0] === bp)?.[1] ?? null;
  const sumOf = (xs: (number | null)[]) => (xs.some((x) => x == null) ? null : xs.reduce<number>((a, x) => a + (x as number), 0));
  const debtPart = sumOf(['portfolio_debt', 'other', 'direct_debt'].map((i) => iipAt(side, i)));
  const eqPart = sumOf(['portfolio_equity', 'direct_equity'].map((i) => iipAt(side, i)));
  const assetsTot = iipAt('out', 'total'), liabTot = iipAt('in', 'total');
  const netV = (e.border.net ?? []).find((x) => x[0] === bp)?.[1] ?? (assetsTot != null && liabTot != null ? assetsTot - liabTot : null);
  const vint = e.border.vintage;
  const vintTxt = vint?.published ? L.kpi.vintage(day(vint.published, lang), day(vint.read, lang)) : '';
  const deriv = iipAt(side, 'derivatives');
  const split = debtPart != null && eqPart != null ? L.kpi.split(money(debtPart, lang), money(eqPart, lang), deriv ? money(deriv, lang) : null) : (p.dir === 'in' ? L.kpi.withEquity : '');
  const iipTile = { label: p.dir === 'in' ? L.kpi.iipIn : L.kpi.iipOut, ...tile(iipTot, lang), wrap: true, ds: 'imf.IIP',
    sub: `${split ? `${split} · ` : ''}${period(bp, 'Q', lang)} · IMF IIP`,
    hint: `${p.dir === 'in' ? L.kpi.equityHint : L.kpi.assetsHint} ${vintTxt}`.trim() };
  const netTile = { label: L.kpi.niip, value: amt(netV, lang, true), unit: lang === 'ko' ? '억 달러' : 'bn', wrap: true, ds: 'imf.IIP',
    tone: netV == null ? undefined : netV >= 0 ? 'pos' as const : 'neg' as const,
    sub: `${L.kpi.netOf(money(assetsTot, lang), money(liabTot, lang))} · ${period(bp, 'Q', lang)} · IMF IIP`,
    hint: `${L.kpi.netHint} ${vintTxt}`.trim() };
  const kpis = [
    { label: p.dir === 'in' ? L.kpi.portIn : L.kpi.portOut, ...tile(pg.ident ?? null, lang), ds: 'imf.PIP',
      sub: `${period(per.portfolio, 'S', lang)} · ${(p.dir === 'in' ? L.holdersCount : L.destsCount)(pg.n ?? 0)} · IMF PIP` },
    { label: p.basis === 'nat' ? L.kpi.bankNat : p.dir === 'in' ? L.kpi.bankLbs : L.kpi.bankOut, ...tile(bankTot ?? null, lang),
      sub: `${period(groupPer('bank'), 'Q', lang)}${usd && p.dir === 'in' && p.basis === 'res' && usd[0] === groupPer('bank') ? ` · ${L.inUsd(money(usd[1], lang))}` : ''} · ${p.basis === 'nat' ? 'BIS CBS' : 'BIS LBS'}`,
      ds: p.basis === 'nat' ? 'bis.CBS' : 'bis.LBS' },
    iipTile,
    netTile,
    { label: L.kpi.reserves, ...tile(res?.value ?? null, lang), sub: res ? `${period(res.period, res.freq, lang)} · ${dsLabel(reg, res.ds, lang).split(' ').slice(0, 3).join(' ')}` : '–', ds: res?.ds ?? null },
  ];

  const exceeds = (g: Group | undefined) => (g?.excess_by != null ? (lang === 'ko' ? ` · 총계 초과 ${money(g.excess_by, 'ko')}(포괄률 100%에서 자름)` : ` · exceeds the total by ${money(g.excess_by, 'en')} (coverage capped at 100%)`) : '');
  const coverage = [
    { label: lang === 'ko' ? '증권투자, 보유국 확인' : 'Portfolio identified by holder', cov: pg.cov ?? null,
      text: `${amt(pg.ident ?? null, lang)} / ${money(pg.total ?? null, lang)}${(pg as { rio?: number }).rio != null ? (lang === 'ko' ? ` · 그중 준비자산 운용기관·국제기구 ${money((pg as { rio?: number }).rio, 'ko')}` : ` · of which reserve managers and international organisations ${money((pg as { rio?: number }).rio, 'en')}`) : ''}${exceeds(pg)}` },
    p.basis === 'nat'
      ? { label: lang === 'ko' ? '은행 대외채권(국적), 보고국 확인' : 'Bank claims (nationality) identified', cov: ladder.nat?.cov ?? null, text: `${amt(ladder.nat?.ident ?? null, lang)} / ${money(ladder.nat?.total ?? null, lang)}` }
      : { label: lang === 'ko' ? '은행 대출·예금, 보고국 확인' : 'Bank loans and deposits identified', cov: ladder.g.bank?.cov ?? null, text: `${amt(ladder.g.bank?.ident ?? null, lang)} / ${money(ladder.g.bank?.total ?? null, lang)}` },
    { label: lang === 'ko' ? '직접투자, 투자국 확인' : 'Direct investment identified', cov: ladder.g.fdi?.cov ?? null,
      text: ladder.g.fdi?.split ? `${amt(ladder.g.fdi?.ident ?? null, lang)} / ${money(ladder.g.fdi?.total ?? null, lang)}${ladder.g.fdi?.dip_total != null ? (lang === 'ko' ? ` (DIP, 투자 대상국 평가 기준) · IIP ${money(ladder.g.fdi?.iip_total, 'ko')}(시장가치)` : ` (DIP, the host's valuation) · IIP ${money(ladder.g.fdi?.iip_total, 'en')} (market value)`) : ''}${exceeds(ladder.g.fdi)}` : (lang === 'ko' ? '이 기간 짝 자료 없음(DIP 연간)' : 'no pair data for this period (DIP is annual)') },
  ];
  if (p.basis === 'res') coverage[1].text += exceeds(ladder.g.bank) + (ladder.g.bank?.iip_loans != null ? (lang === 'ko' ? ` · IIP 대출 ${money(ladder.g.bank.iip_loans, 'ko')}, 예금 ${money(ladder.g.bank.iip_deposits, 'ko')}` : ` · IIP loans ${money(ladder.g.bank.iip_loans, 'en')}, deposits ${money(ladder.g.bank.iip_deposits, 'en')}`) : '')
    + (ladder.g.bank?.nosplit_share != null ? (lang === 'ko' ? ` · 전체 보고국 청구권의 ${josa(pct(ladder.g.bank.nosplit_share, 'ko'), '은')} 상품 구분을 하지 않는 보고국(${Object.keys(ladder.g.bank.nosplit ?? {}).map((h) => lbl(meta, h, lang)).join(', ')}) 몫이라 리본 밖에 있습니다(R5)` : ` · ${pct(ladder.g.bank.nosplit_share, 'en')} of all reporters' claims come from reporters with no instrument split (${Object.keys(ladder.g.bank.nosplit ?? {}).map((h) => lbl(meta, h, lang)).join(', ')}) and stay outside the ribbon (R5)`) : '');

  // sources actually drawn, rules applied, the source line
  const drawn = new Set(ribbons.map((r) => r.ds));
  if (border.items.some((i) => i.value != null)) drawn.add('imf.IIP');
  for (const b of made) drawn.add(b.ds);
  const sources = [...drawn].filter((ds) => reg.datasets[ds]).sort().map((ds) => ({ ds, label: dsLabel(reg, ds, lang), freq: meta.datasets[ds]?.freq ?? reg.datasets[ds].cadence, newest: meta.datasets[ds]?.newest ?? '' }));
  const rules = [...new Set(ribbons.flatMap((r) => r.rules).concat(made.length ? ['R9'] : []).concat(['R12', 'R13']))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const used = (ds: string) => {
    const pr = ds === 'imf.PIP' ? period(per.portfolio, 'S', lang) : ds === 'bis.LBS' || ds === 'bis.CBS' ? period(groupPer('bank'), 'Q', lang) : ds === 'imf.DIP' ? period(per.fdi, 'A', lang) : ds === 'imf.IIP' ? period(bp, 'Q', lang) : '';
    return `${dsLabel(reg, ds, lang)}${pr ? ` (${pr})` : ''}`;
  };
  const rr = rules.filter((r) => ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R10'].includes(r));
  const sourceLine = `${[...drawn].filter((ds) => reg.datasets[ds]).sort().map(used).join('; ')}. ${L.calculations}, ${lang === 'ko' ? '방법론' : 'method'} ${meta.method}, ${lang === 'ko' ? '규칙' : 'rules'} ${rr.join(', ')}.`;

  // checks touching this view
  const cr = (id: string) => checks?.results.find((r) => r.id === id);
  const chk: ViewModel['checks'] = [];
  const v3 = cr('V3');
  if (v3) chk.push({ status: v3.status, label: 'V3', text: lang === 'ko' ? '모든 노드가 총계와 맞습니다' : 'Every node adds up to its total' });
  for (const f of e.checks.filter((f) => f.id === 'V4' && f.dir === p.dir)) chk.push({ status: 'warning', label: 'V4', text: `${L.channel[f.group ?? ''] ?? f.group}: ${lang === 'ko' ? '포괄률' : 'coverage'} ${pct(f.value ?? null, lang)}` });
  const v5 = cr('V5');
  for (const row of ((v5?.details ?? []) as { economy: string; measure: string; status: string; diff_pct: number | null; a_value?: number; b_value?: number; month?: string }[]).filter((r) => r.economy === X)) {
    if (row.diff_pct == null) { chk.push({ status: 'info', label: 'V5', text: `${L.measure[row.measure] ?? row.measure}: ${lang === 'ko' ? '두 출처의 공통 월이 없습니다' : 'no month both sources have'}` }); continue; }
    chk.push({ status: row.status, label: 'V5', text: `${L.measure[row.measure] ?? row.measure}: ${row.a_value != null && row.b_value != null ? `${money(row.a_value, lang)} ${lang === 'ko' ? '대' : 'vs'} ${money(row.b_value, lang)} ` : ''}(${num(row.diff_pct, lang)}% ${lang === 'ko' ? '차이' : 'apart'}, ${row.month})` });
  }
  const v6 = e.checks.filter((f) => f.id === 'V6');
  if (v6.length) chk.push({ status: 'info', label: 'V6', text: lang === 'ko' ? `직접투자 짝 ${v6.length}개는 두 나라 보고가 50% 넘게 다릅니다.` : `${v6.length} direct investment pairs: the two reports differ by more than 50%` });
  if (p.basis === 'res' && ladder.g.bank?.all_instr != null) {
    const b = ladder.g.bank;
    chk.push({ status: 'info', label: 'R5', text: lang === 'ko'
      ? `은행 리본은 대출·예금 ${money(b.total, 'ko')}만 표시합니다. 전 상품 기준 ${money(b.all_instr, 'ko')} = 대출·예금 + 채권 ${money(b.debt_sec, 'ko')}(증권투자에 계상) + 파생상품·기타 ${money(b.other_instr, 'ko')}(별도 풀)`
      : `Bank ribbon: loans and deposits ${money(b.total, 'en')} only. All instruments ${money(b.all_instr, 'en')} = loans and deposits + debt securities ${money(b.debt_sec, 'en')} (counted in portfolio debt) + derivatives and other ${money(b.other_instr, 'en')} (a pool of its own)` });
  }
  for (const f of e.checks.filter((f) => f.id === 'V14' && f.dir === p.dir)) chk.push({ status: 'warning', label: 'V14', text: `${L.channel[f.group ?? ''] ?? f.group}: ${lang === 'ko' ? `짝 자료가 IIP 총계를 ${money(f.value ?? null, 'ko')} 넘습니다(포괄률은 100%를 넘지 않습니다).` : `pair data exceed the IIP total by ${money(f.value ?? null, 'en')} (coverage capped at 100%)`}` });
  if (p.basis === 'nat') chk.push({ status: 'info', label: 'R10', text: L.natCheck });
  const v13q = e.checks.filter((f) => f.id === 'V13' && f.status === 'warning');
  if (v13q.length) chk.push({ status: 'warning', label: 'R16', text: lang === 'ko' ? `원자료 오류로 격리한 구간 ${v13q.length}개: ${v13q.map((f) => `${L.measure[f.group ?? ''] ?? f.group} ${f.period}`).join(', ')}` : `${v13q.length} series segment(s) quarantined as source errors: ${v13q.map((f) => `${L.measure[f.group ?? ''] ?? f.group} from ${f.period}`).join(', ')}` });
  const v13i = e.checks.filter((f) => f.id === 'V13' && f.status === 'info');
  if (v13i.length) chk.push({ status: 'info', label: 'V13', text: lang === 'ko' ? `측정치 ${v13i.length}건이 한 기간에 10배 넘게 움직였습니다(실제 또는 설명되지 않은 변동).` : `${v13i.length} measure values moved tenfold in one period (real or unexplained moves)` });
  if (X === 'KOR') { const v8 = cr('V8'); if (v8) chk.push({ status: v8.status, label: 'V8', text: lang === 'ko' ? '계획서의 한국 기준 수치를 재현합니다.' : "The plan's Korea figures are rebuilt" }); }
  for (const g of ['portfolio', 'bank', 'fdi']) if (ladder.g[g]?.excess && !e.checks.some((f) => f.id === 'V14' && f.group === g && f.dir === p.dir)) chk.push({ status: 'warning', label: 'R6', text: lang === 'ko' ? `${L.channel[g]}: 짝 자료가 총계를 ${money(ladder.g[g]?.excess_by ?? null, 'ko')} 넘습니다(포괄률은 100%에서 자름).` : `${L.channel[g]}: pair data exceed the total by ${money(ladder.g[g]?.excess_by ?? null, 'en')} (coverage capped at 100%)` });

  const table = ribbons.map((r) => ({
    holder: r.label, channel: L.channel[r.group] ?? r.group, value: Math.round(r.value * 10) / 10, flow: r.flow, period: period(r.period, r.freq, lang),
    source: dsLabel(reg, r.ds, lang), rules: r.rules.join(' '), rep: r.rep ?? (r.holder.startsWith('_') ? '—' : r.ds === 'bis.LBS' || r.ds === 'bis.CBS' ? (lang === 'ko' ? '보고 은행' : 'reporting banks') : L.reportedBy.creditor),
  }));

  const context: ViewModel['context'] = [];
  const cp = e.context.credit_private ? at(e.context.credit_private.pts, p.d) : null;
  if (cp) context.push({ label: L.measure.credit_private, value: money(cp[1], lang), note: `${period(cp[0], 'Q', lang)} · BIS TC` });
  const ids = e.context.ids_outstanding ? at(e.context.ids_outstanding.pts, p.d) : null;
  if (ids) context.push({ label: L.measure.ids_outstanding, value: money(ids[1], lang), note: `${period(ids[0], 'Q', lang)} · BIS DSS` });
  if (p.dir === 'out' && e.tic?.portfolio) {
    const tp = at(e.tic.portfolio.pts, p.d);
    if (tp) context.push({ label: lang === 'ko' ? '미국 장기증권 보유(TIC)' : 'US long-term securities held (TIC)', value: money(tp[1], lang), note: `${period(tp[0], 'M', lang)} · US Treasury TIC` });
  }

  const notes = (['position', 'flow', 'residence', 'nationality', 'coverage'] as const).map((k) => k);
  return { econ: X, econName: xName, p, asof, per, holders, pools, ribbons, apex, made, border, headline, kicker, status: statusFull, kpis, coverage, sources, rules, sourceLine, checks: chk, table, context, notes };
}

export function apexBars(w: { apex: Record<string, { ds: string; f: string; pts: [string, number | null][] }> }, meta: Meta, d: string, lang: Lang): Bar[] {
  const out: Bar[] = [];
  for (const [code, s] of Object.entries(w.apex)) {
    const v = at(s.pts, d);
    if (v) out.push({ id: code, label: name(meta.economies, code, lang), value: v[1], period: v[0], freq: s.f, ds: s.ds });
  }
  return out;
}

export { day };

/** The newest period on an economy's inflow ladder (the latest `per` over its channels), for page titles, descriptions
 *  and the Open Graph card; null when the ladder is empty. */
export function newestPeriod(e: Econ): string | null {
  const per = e.ladders.in.slice(-1)[0]?.per ?? {};
  const ps = Object.values(per).filter((x): x is string => !!x).sort();
  return ps.length ? ps[ps.length - 1] : null;
}
