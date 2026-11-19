// Markets (market mode): one market across all economies, as a holder x destination matrix. The Ladder
// follows one economy through every channel; this page follows one channel through every economy: who holds whose
// equity, bonds, bank loans or direct investment. Redesigned 30 Oct 2026 so that a reader can see the direction (row
// holds, column issued), that cells are end-of-period stocks, which holders are pass-throughs (FC, FD; SPE on FDI)
// and what is gross and what is net. Every number here is computed from the release at request time; nothing is
// written down by hand. Aggregates are totals, never holders (R11).
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { CiteBlock } from '@/components/CiteBlock';
import { FilterRow } from '@/components/Controls';
import { LenderCutPanel } from '@/components/LenderCut';
import { MarketView, type EconInfo, type Insight, type RoundTrip, type TagKind } from '@/components/MarketView';
import { DocLinks, ReleaseNotice, Updated } from '@/components/Page';
import { PanelSrc, SrcLink, SrcTail } from '@/components/Src';
import { Kicker, StatTile } from '@/components/sn';
import { readFileSync } from 'node:fs';
import { manifest, read } from '@/lib/data';
import { familyTemplate } from '@/lib/family';
import { num, period, tnTile, usdBn, usdTn } from '@/lib/format';
import { josa } from '@/lib/josa';
import { isLang, name, t } from '@/lib/i18n';
import { dayParam, load } from '@/lib/page';
import { pageMeta } from '@/lib/seo';
import type { Lang, LenderCut, Market } from '@/lib/types';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ lang: string; market: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const MARKETS = ['equity', 'bonds', 'bank', 'fdi'];
const FREQ: Record<string, string> = { equity: 'S', bonds: 'S', bank: 'Q', fdi: 'A' };
const STEP: Record<string, number> = { S: 182, Q: 91, A: 365 };
const ALIAS: Record<string, string> = { debt: 'bonds', banking: 'bank' };   // the names readers use for two routes
// Round trips (documented in the panel): both directions at least RT_MIN of the market's identified total, the smaller
// at least RT_RATIO of the larger, one side an offshore centre, fund domicile or SPE hub; pairs among the top 30.
const RT_MIN = 0.0025, RT_RATIO = 0.15;

// What a cell says, per market ({a} row, {b} column, {v} value), and how the publisher values the position.
const WORDS: Record<string, Record<Lang, { sentence: string; valuation: string; rowTitle: string; colTitle: string; noun: string }>> = {
  equity: {
    ko: { sentence: '{a} 거주자가 {b} 발행 주식을 {v} 보유', valuation: '시가', rowTitle: '보유국(보유하는 경제)', colTitle: '투자 대상국(발행한 경제)', noun: '주식' },
    en: { sentence: '{a} residents hold {v} of equity issued by {b} residents', valuation: 'market value', rowTitle: 'Holder — who holds it', colTitle: 'Issuer / destination — who issued it', noun: 'equity' },
  },
  bonds: {
    ko: { sentence: '{a} 거주자가 {b} 발행 채권을 {v} 보유', valuation: '시가', rowTitle: '보유국(보유하는 경제)', colTitle: '투자 대상국(발행한 경제)', noun: '채권' },
    en: { sentence: '{a} residents hold {v} of debt securities issued by {b} residents', valuation: 'market value', rowTitle: 'Holder — who holds it', colTitle: 'Issuer / destination — who issued it', noun: 'debt securities' },
  },
  bank: {
    ko: { sentence: '{a} 소재 은행이 {b} 거주자에 대한 대출·예금 청구권을 {v} 보유', valuation: '', rowTitle: '은행 소재지와 대출한 은행', colTitle: '상대국(차입한 경제)', noun: '대출·예금 채무' },
    en: { sentence: 'Banks located in {a} hold {v} of loan and deposit claims on {b} residents', valuation: '', rowTitle: 'Bank location — who lends', colTitle: 'Counterparty — who borrows', noun: 'loans and deposits' },
  },
  fdi: {
    ko: { sentence: '{a} 직접투자자가 {b}에 {v}의 직접투자 잔액 보유', valuation: '보고국 평가', rowTitle: '투자국(투자한 경제)', colTitle: '투자 대상국(투자한 경제)', noun: '직접투자' },
    en: { sentence: 'Direct investors in {a} hold {v} of direct investment in {b}', valuation: 'as the reporter values it', rowTitle: 'Investor — who invested', colTitle: 'Host — where it is invested', noun: 'direct investment' },
  },
};

const TAGS: Record<TagKind, Record<Lang, string> & { desc: Record<Lang, string> }> = {
  FC: { ko: '역외금융센터', en: 'Offshore financial centre', desc: {
    ko: 'BIS가 역외금융센터로 분류하는 경제입니다. 페이퍼컴퍼니, 특수목적기구(SPV), 헤지펀드, 외국 기업의 지주회사가 많습니다(예: 케이맨 제도에 설립된 중국 기업). 이곳의 보유자는 대개 경유지이고 최종투자자가 아닙니다.',
    en: 'An offshore centre in the BIS grouping: shell companies, special purpose vehicles, hedge funds and holding companies of foreign firms (e.g. Chinese firms incorporated in the Cayman Islands). A holder here is usually a pass-through, not the final investor.' } },
  FD: { ko: '펀드 소재지', en: 'Fund domicile', desc: {
    ko: '투자펀드가 법적으로 설립된 곳입니다(룩셈부르크, 아일랜드, 네덜란드, 스위스). 이곳에 계상된 보유분은 대개 다른 나라 투자자가 매입한 펀드의 자산입니다.',
    en: 'Where investment funds are legally domiciled (Luxembourg, Ireland, the Netherlands, Switzerland). Holdings booked here are mostly the assets of funds that investors elsewhere bought.' } },
  SPE: { ko: '특수목적법인 경유지', en: 'SPE and holding-company hub', desc: {
    ko: '직접투자가 특수목적법인(SPE)과 지주회사를 거쳐 계상되는 나라(룩셈부르크, 아일랜드, 네덜란드, 스위스)입니다. 직접투자에서 이 나라들의 몫은 펀드가 아니라 이런 법인이 대부분이어서 FD 대신 SPE로 표시합니다. 이곳 투자자는 최종 모회사가 아닌 경우가 많습니다.',
    en: 'Where direct investment is booked through special purpose entities and holding companies (Luxembourg, Ireland, the Netherlands, Switzerland). In direct investment their positions are mostly such entities, not funds, so this page marks them SPE rather than FD. The investor here is often not the ultimate parent.' } },
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, market } = await params;
  const l: Lang = isLang(lang) ? lang : 'en';
  const L = t(l);
  const mkName = L.market_[ALIAS[market] ?? market] ?? market;
  let per = '';
  try { const mk = read<Market>(manifest(null), `mkt/${ALIAS[market] ?? market}`); const last = mk?.periods[mk.periods.length - 1]?.p; per = last ? period(last, FREQ[ALIAS[market] ?? market] ?? 'Q', l) : ''; } catch { per = ''; }
  const title = l === 'ko' ? `${mkName}, 누가 어느 나라의 자산을 보유하나` : `${mkName}: who holds whose assets`;
  const description = l === 'ko'
    ? `${mkName}의 국경 간 잔액을 보유국 × 투자 대상국 행렬로 나타냅니다. 짝 자료로 확인된 잔액만 합산하며, 역외금융센터와 펀드 소재지를 표시합니다.${per ? ` 최신 ${per}.` : ''}`
    : `Cross-border ${mkName.toLowerCase()} positions as a holder × destination matrix, from pair data only, with offshore centres and fund domiciles marked.${per ? ` Newest period ${per}.` : ''}`;
  return pageMeta(l, `/m/${market}`, { title, description });
}

/** mkt/bank.lender_cut from the release; until the data side ships it, a hand-made object can be injected for a local
 *  check with MF_LENDER_CUT_FIXTURE=<path to a JSON file in the surface contract shape> (never set in the image). */
function lenderCutOf(mk: Market): LenderCut | null {
  if (mk.lender_cut?.debtors) return mk.lender_cut;
  const f = process.env.MF_LENDER_CUT_FIXTURE;
  if (!f) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')) as LenderCut; } catch { return null; }
}

export default async function MarketPage({ params, searchParams }: Props) {
  const { lang: raw, market } = await params;
  if (isLang(raw) && ALIAS[market]) permanentRedirect(`/${raw}/m/${ALIAS[market]}`);
  if (!isLang(raw) || !MARKETS.includes(market)) notFound();
  const lang: Lang = raw;
  const ko = lang === 'ko';
  const L = t(lang);
  const sp = await searchParams;
  const { m, latest, meta, cites, reg } = load(sp);
  const d = dayParam(sp, meta);
  const mk = read<Market>(m, `mkt/${market}`);
  if (!mk) notFound();
  const ps = mk.periods.filter((p) => p.p <= d);
  const cur = ps[ps.length - 1] ?? mk.periods[0];
  const newest = mk.periods[mk.periods.length - 1];
  const f = FREQ[market];
  const per = period(cur.p, f, lang);
  const W = WORDS[market][lang];
  const pass: TagKind = market === 'fdi' ? 'SPE' : 'FD';
  const nm = (c: string) => name(meta.economies, c, lang);
  const tagOf = (c: string): TagKind | null => (meta.economies[c]?.fc ? 'FC' : meta.economies[c]?.fd ? pass : null);
  const isPass = (c: string) => tagOf(c) != null;

  // Top-N takes this period's N largest; each step's additions are ordered by the newest period's ranking, so the
  // slider and the Top-N switch keep the rows in place where the set allows
  const byV = (o: Record<string, number>) => Object.keys(o).sort((a, b) => o[b] - o[a]);
  const stable = (o: Record<string, number>, ref: Record<string, number>) => {
    const rk = new Map(byV(ref).map((c, i) => [c, i])), all = byV(o), out: string[] = [];
    for (const k of [12, 20, 30]) out.push(...all.slice(out.length, k).sort((a, b) => (rk.get(a) ?? 1000 + all.indexOf(a)) - (rk.get(b) ?? 1000 + all.indexOf(b))));
    return out;
  };
  const rows = stable(cur.holders, newest.holders), cols = stable(cur.dests, newest.dests);
  const pairs: Record<string, number> = {};
  for (const [a, b, v] of cur.pairs) if (a !== '_other' && b !== '_other') pairs[`${a}|${b}`] = v;
  const named = cur.pairs.filter(([a, b]) => a !== '_other' && b !== '_other');
  const focus = cur.focus ?? {};
  const codes = new Set([...rows, ...cols, ...Object.values(focus).flatMap((x) => [...x.out_top, ...x.in_top].map((y) => y[0]))]);
  const econ: Record<string, EconInfo> = Object.fromEntries([...codes].map((c) => [c, { n: nm(c), tag: tagOf(c), href: meta.economies[c]?.page ? `/${lang}/e/${c}` : null }]));

  // round trips among the drawn pairs (rule above)
  const rts: RoundTrip[] = [];
  for (const [a, b, ab] of named) {
    const ba = pairs[`${b}|${a}`];
    if (ba == null) continue;
    if (rts.some((r) => r.a === b && r.b === a)) continue;
    if (ab >= RT_MIN * cur.total && ba >= RT_MIN * cur.total && Math.min(ab, ba) / Math.max(ab, ba) >= RT_RATIO && (isPass(a) || isPass(b))) rts.push({ a, b, ab, ba });
  }
  rts.sort((x, y) => Math.min(y.ab, y.ba) - Math.min(x.ab, x.ba));
  const rtRule = ko
    ? `규칙: 두 방향이 모두 이 시장 확인 잔액(${usdTn(cur.total, 'ko')})의 ${num(RT_MIN * 100, 'ko', 2)}%(${usdBn(RT_MIN * cur.total, 'ko')}) 이상이고, 작은 쪽이 큰 쪽의 ${num(RT_RATIO * 100, 'ko', 0)}% 이상이며, 한쪽이 FC·${pass}인 짝입니다. 상위 30개 경제 사이의 짝만 봅니다. 같은 돈이 양쪽에 잡힐 수 있습니다(경유·왕복 투자).`
    : `Rule: both directions at least ${num(RT_MIN * 100, 'en', 2)}% of this market's identified total (${usdTn(cur.total, 'en')}, so ${usdBn(RT_MIN * cur.total, 'en')}), the smaller at least ${num(RT_RATIO * 100, 'en', 0)}% of the larger, and one side FC or ${pass}; pairs among the top 30 only. The same money may appear on both sides (pass-through, round-tripping).`;

  // the insight strip: four sentences, each from an explicit rule, each opening the cell or focus that proves it
  const insights: Insight[] = [];
  const top = named[0];
  if (top) insights.push({ target: { cell: [top[0], top[1]] }, text: ko
    ? `가장 큰 짝은 ${nm(top[0])} → ${nm(top[1])}, ${usdBn(top[2], 'ko')}입니다(${per} 잔액).`
    : `The largest pair is ${nm(top[0])} → ${nm(top[1])}: ${usdBn(top[2], 'en')} (${per} position).` });
  const nets = Object.entries(focus).map(([c, x]) => ({ c, v: x.out - x.in })).sort((a, b) => b.v - a.v);
  if (nets.length > 1) {
    const hi = nets[0], lo = nets[nets.length - 1];
    insights.push({ target: { econ: hi.c }, text: ko
      ? `해외 보유가 외국인 보유보다 가장 많은 곳(순보유국)은 ${nm(hi.c)}(${usdTn(hi.v, 'ko', true)}), 가장 적은 곳(순차입국)은 ${nm(lo.c)}(${usdTn(lo.v, 'ko', true)})입니다. 짝 자료로 확인된 잔액 기준입니다.`
      : `The largest net holder (holdings abroad less foreign holdings) is ${nm(hi.c)} (${usdTn(hi.v, 'en', true)}); the largest net issuer is ${nm(lo.c)} (${usdTn(lo.v, 'en', true)}), on identified pairs.` });
  }
  const topD = byV(cur.dests)[0];
  const fD = focus[topD];
  if (fD?.in) insights.push({ target: { econ: topD }, text: ko
    ? `${nm(topD)} ${W.noun}의 외국인 보유분 중 ${num((100 * fD.in_pass) / fD.in, 'ko', 0)}%(${usdTn(fD.in_pass, 'ko')})는 역외금융센터(FC)·${pass === 'SPE' ? '특수목적법인 경유지(SPE)' : '펀드 소재지(FD)'}에 계상된 보유자의 몫입니다.`
    : `${num((100 * fD.in_pass) / fD.in, 'en', 0)}% (${usdTn(fD.in_pass, 'en')}) of the foreign holdings of ${nm(topD)} ${W.noun} are booked by holders in offshore centres (FC) or ${pass === 'SPE' ? 'SPE hubs' : 'fund domiciles (FD)'}.` });
  const rt = rts[0];
  if (rt) insights.push({ target: { cell: [rt.a, rt.b] }, text: ko
    ? `왕복 짝: ${nm(rt.a)} → ${nm(rt.b)} ${usdBn(rt.ab, 'ko')}, ${nm(rt.b)} → ${nm(rt.a)} ${usdBn(rt.ba, 'ko')}. 같은 돈이 두 번 집계되었을 수 있습니다.`
    : `Round trip: ${nm(rt.a)} → ${nm(rt.b)} ${usdBn(rt.ab, 'en')} and ${nm(rt.b)} → ${nm(rt.a)} ${usdBn(rt.ba, 'en')}; the same money may be counted twice.` });

  // the explainer's examples, from this period's data: the pass-through chain with the largest smaller leg
  let chain: { a: string; f: string; b: string; v1: number; v2: number } | null = null;
  for (const [c, x] of Object.entries(focus)) {
    if (!isPass(c)) continue;
    const a = x.in_top.find(([h]) => !isPass(h)), b = x.out_top.find(([dd]) => !isPass(dd) && dd !== a?.[0]);
    if (a && b && (!chain || Math.min(a[1], b[1]) > Math.min(chain.v1, chain.v2))) chain = { a: a[0], f: c, b: b[0], v1: a[1], v2: b[1] };
  }
  const topH = byV(cur.holders)[0];
  const both = topH === topD ? focus[topH] : null;
  const usIrl = pairs['USA|IRL'];
  const explainer = (
    <details className="mf-howto">
      <summary>{ko ? '이 표를 읽는 법' : 'How to read this'}</summary>
      <ul>
        <li><b>{ko ? '방향.' : 'Direction.'}</b> {ko ? `행은 보유국, 열은 발행국(투자 대상국)입니다. 칸 하나는 "${W.sentence.replace('{a}', '행').replace('{b}', '열').replace('{v}', '그 값')}"를 나타냅니다.`
          : `Rows hold, columns issued. One cell reads: “${W.sentence.replace('{a}', 'row').replace('{b}', 'column').replace('{v}', 'the value')}”.`}</li>
        <li><b>{ko ? '잔액이지 흐름이 아닙니다.' : 'A stock, not a flow.'}</b> {ko ? `값은 ${per} 잔액${W.valuation ? `(${W.valuation})` : ''}입니다. 그해 새로 투자한 금액이 아니며, 거래가 없어도 가격이 오르면 커집니다.` : `Values are ${per} positions${W.valuation ? ` at ${W.valuation}` : ''}, not what was invested that year; they grow with prices even without transactions.`}</li>
        <li><b>{ko ? '거주성 기준.' : 'Residence basis.'}</b> {ko ? '보유국은 잔액이 계상된 경제입니다. FC·FD에 있는 보유자는 최종투자자가 아닌 경우가 많습니다.' : 'A holder is where the position is booked. A holder in an FC or FD economy is often not the final investor.'}</li>
        <li><b>FC · {pass}.</b> {ko ? `FC는 역외금융센터입니다. ${TAGS.FC.desc.ko} ${pass}는 ${TAGS[pass].ko}(${TAGS[pass].en})입니다. ${TAGS[pass].desc.ko}` : `FC is an offshore financial centre: ${TAGS.FC.desc.en} ${pass} is a ${TAGS[pass].en.toLowerCase()}: ${TAGS[pass].desc.en}`}</li>
        <li><b>{ko ? '총액에는 중복 계상이 있습니다.' : 'Gross totals double count.'}</b> {chain ? (ko
          ? `같은 돈이 두 번 나타납니다. ${nm(chain.a)} 투자자가 ${nm(chain.f)}에 ${josa(usdBn(chain.v1, 'ko'), '을')} 두고(${nm(chain.a)} 행 × ${nm(chain.f)} 열), ${nm(chain.f)}는 ${nm(chain.b)}에 ${josa(usdBn(chain.v2, 'ko'), '을')} 보유합니다(${nm(chain.f)} 행 × ${nm(chain.b)} 열).`
          : `The same money can appear twice: ${nm(chain.a)} investors hold ${usdBn(chain.v1, 'en')} in ${nm(chain.f)} (${nm(chain.a)} row × ${nm(chain.f)} column), and ${nm(chain.f)} holds ${usdBn(chain.v2, 'en')} in ${nm(chain.b)} (${nm(chain.f)} row × ${nm(chain.b)} column).`) : null}
          {rt ? (ko ? ` ${nm(rt.a)} ⇄ ${nm(rt.b)}처럼 한 나라의 돈이 경유지를 거쳐 제 나라 자산으로 돌아오기도 합니다(왕복 투자).` : ` Money can also return home through a pass-through, as in ${nm(rt.a)} ⇄ ${nm(rt.b)} (round-tripping).`) : null}
          {market === 'equity' && usIrl ? (ko ? ` 본사를 아일랜드로 옮긴 미국 기업의 주식은 미국 → 아일랜드(${usdBn(usIrl, 'ko')})로 집계합니다(인버전).` : ` Shares of US firms redomiciled to Ireland show up as US → Ireland (${usdBn(usIrl, 'en')}; inversions).`) : null}</li>
        <li><b>{ko ? '큰 시장은 양쪽이 모두 큽니다.' : 'Big markets are big on both sides.'}</b> {both ? (ko
          ? `${nm(topH)}은 최대 보유국이자 최대 투자 대상국입니다. 시장이 크고 분산 투자를 많이 하기 때문입니다. 총액 자료이므로 순액도 함께 살펴주시십시오. 순액은 외국인 보유 ${usdTn(both.in, 'ko')} − 해외 보유 ${usdTn(both.out, 'ko')} = 순 외국인 보유 ${usdTn(both.in - both.out, 'ko')}입니다.`
          : `${nm(topH)} is both the largest holder and the largest destination: a large market that also diversifies abroad. This is gross data, so look at the net: foreign holdings ${usdTn(both.in, 'en')} less holdings abroad ${usdTn(both.out, 'en')} = net foreign holdings ${usdTn(both.in - both.out, 'en')}.`)
          : (ko ? '총액 자료이므로 큰 시장은 보유국으로도, 투자 대상국으로도 큽니다. 차이를 보려면 순액 보기로 전환하세요.' : 'This is gross data, so large markets are large as holders and as destinations; switch to Net to see the difference.')}</li>
      </ul>
      <p className="mf-note">{ko ? '사다리와 이 표의 차이는 오른쪽 패널의 ' : 'How this differs from the Ladder: the panel tab '}<b>{ko ? '사다리와의 차이' : 'Ladder vs Markets'}</b>{ko ? ' 보유국을 국적(최종투자자) 기준으로 다시 그린 연구가 있습니다. 참고 연구: ' : '. For holdings restated by nationality (the final investor): '}<SrcLink reg={reg} id="paper.cmns2021" lang={lang} />.</p>
    </details>
  );

  const headline = ko
    ? `${L.market_[market]}, ${per} 잔액: 짝 자료로 확인된 국경 간 보유 ${usdTn(cur.total, 'ko')}. 가장 큰 짝은 ${nm(top?.[0] ?? '')} → ${nm(top?.[1] ?? '')}(${usdBn(top?.[2], 'ko')})`
    : `${L.market_[market]}, ${per} positions: ${usdTn(cur.total, 'en')} of cross-border holdings identified by pair; the largest is ${nm(top?.[0] ?? '')} → ${nm(top?.[1] ?? '')} (${usdBn(top?.[2], 'en')})`;
  const cite = { lang, title: ko ? `시장 행렬 ${L.market_[market]}` : `Market matrix: ${L.market_[market].toLowerCase()}`, key: `mkt-${market}`, release: m.tag, method: meta.method, date: m.date,
    path: `/${lang}/m/${market}`, query: `d=${d}`, datasets: [reg.datasets[mk.ds]?.short ?? mk.ds] };
  const rules = `R1, R2${mk.ds === 'imf.PIP' ? ', R3' : ''}${mk.ds === 'imf.DIP' ? ', R4' : ''}${mk.ds === 'bis.LBS' ? ', R5' : ''}, R11`;
  const source = <>{L.source}<PanelSrc reg={reg} panel={`market.${market}`} lang={lang} only={[{ 'imf.PIP': 'imf.pip', 'imf.DIP': 'imf.dip', 'bis.LBS': 'bis.lbs' }[mk.ds] ?? '']} /> ({per}). {L.calculations}, {L.method} {meta.method}, {ko ? '규칙' : 'rules'} {rules}.</>;
  const about = (
    <div className="mf-prose" style={{ fontSize: 14, lineHeight: '22px' }}>
      <p>{ko
        ? '사다리는 한 경제를 모든 경로(증권, 은행, 직접투자)로 따라갑니다. 이 쪽은 한 경로를 모든 경제에 걸쳐 살펴봅니다. 행은 보유국, 열은 투자 대상국입니다.'
        : 'The Ladder follows one economy through every channel (portfolio, banks, direct investment). This page follows one channel across every economy: rows are holders, columns the economies whose assets they hold.'}</p>
      <p>{ko
        ? '짝 자료로 확인된 잔액만 더합니다. 보고하지 않는 보유국의 몫은 여기에 포함되지 않고, 각 경제의 사다리에 미확인으로 표시합니다.'
        : 'Only positions identified by pair data are summed. What non-reporting holders hold is not here; it shows on each economy’s ladder as not identified.'}</p>
      <p>{ko ? '보유국을 거주성 기준이 아니라 국적(최종투자자) 기준으로 다시 그리면 FC·FD의 몫이 상당 부분 본국으로 돌아갑니다. 참고 연구: ' : 'Restated by nationality (the final investor) rather than residence, much of what FC and FD economies hold moves back to the investors’ home countries: '}<SrcLink reg={reg} id="paper.cmns2021" lang={lang} />.</p>
    </div>
  );
  const fH = focus[topH];
  const n0 = typeof sp.n === 'string' && ['12', '20', '30'].includes(sp.n) ? Number(sp.n) : 12;
  const mode0 = sp.mode === 'net' ? 'net' : 'gross', enc0 = sp.enc === 'color' ? 'color' : 'size';
  // ?h=A&d=B focuses the cell (holder A, destination B): global-network's pair page links here (the surface contract). `d` is
  // also the day parameter; a three-letter value is a code, not a date, so the two never collide.
  const iso = (v: unknown) => (typeof v === 'string' && /^[A-Za-z]{3}$/.test(v) ? v.toUpperCase() : null);
  const h0 = iso(sp.h), d0 = iso(sp.d);
  const cell0: [string, string] | undefined = h0 && d0 ? [h0, d0] : undefined;
  const pairTemplate = familyTemplate('global-network', 'pair', lang);
  // "Cut a lender" (WP4 S4, R21): on the bank matrix only, and only when the release carries the field
  const lc = market === 'bank' ? lenderCutOf(mk) : null;
  const lcCodes = lc ? [...new Set(Object.entries(lc.debtors).flatMap(([c, x]) => [c, ...Object.keys(x.lenders)]))] : [];
  const lcNames = Object.fromEntries(lcCodes.map((c) => [c, nm(c)]));
  const lcHrefs = Object.fromEntries(lcCodes.map((c) => [c, meta.economies[c]?.page ? `/${lang}/e/${c}` : undefined]));
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const kpiSub = (s: string) => `${per} ${ko ? '잔액' : 'position'} · ${s}`;
  return (
    <div className="mf-dash mf-dash--free">
      <div className="mf-dash__title">
        <Kicker>{`${L.page.market} · ${L.market_[market]}`}</Kicker>
        <h1 className="mf-dash__h1">{headline}</h1>
        <details className="mf-citepop">
          <summary className="sn-btn sn-btn--secondary sn-btn--sm">{L.cite}</summary>
          <div><CiteBlock cite={cite as never} labels={{ title: L.citeView, copy: L.copy, copied: L.copied, note: L.figureNote, bibtex: L.bibtex, ris: L.ris, datasets: L.datasetsCite, method: L.methodCite }}
            datasets={[{ name: mk.ds, text: cites.datasets[mk.ds]?.[lang]?.text ?? '', bibtex: cites.datasets[mk.ds]?.[lang]?.bibtex ?? '' }]} method={cites.method[lang]} /></div>
        </details>
        <p className="mf-dash__status">{L.ask.market} · {ko ? `자료 기준 ${per} 잔액` : `data: ${per} positions`} · {L.release} {m.tag} · {L.method} {meta.method} · <Updated m={m} lang={lang} /></p>
      </div>
      <ReleaseNotice m={m} latest={latest} lang={lang} href={`/${lang}/m/${market}`} />
      <FilterRow lang={lang} controls={[]}
        links={{ label: ko ? '시장' : 'Market', value: market, options: MARKETS.map((x) => ({ value: x, label: L.market_[x], href: `/${lang}/m/${x}` })) }}
        day={{ d, min: '2001-01-01', max: meta.day, label: L.dayView, play: L.play, pause: L.pause, step: STEP[f],
          note: ko ? `→ 이날까지 나온 최신 자료: ${per} 잔액` : `→ newest data by this day: ${per} positions` }} />
      <ul className="mf-kpis mf-kpis--sm">
        {[{ label: ko ? '확인된 국경 간 잔액' : 'Cross-border positions identified', ...tnTile(cur.total, lang), sub: kpiSub(reg.datasets[mk.ds]?.short ?? mk.ds) },
          { label: ko ? '보유국 / 대상국' : 'Holders / destinations', value: `${cur.n_holders} / ${cur.n_dests}`, unit: '', sub: kpiSub(ko ? '짝 자료가 있는 경제' : 'economies with pair data') },
          { label: ko ? `최대 보유국: ${nm(topH)}` : `Largest holder: ${nm(topH)}`, ...tnTile(cur.holders[topH], lang), sub: kpiSub(fH ? (ko ? `순 ${usdTn(fH.out - fH.in, 'ko', true)}` : `net ${usdTn(fH.out - fH.in, 'en', true)}`) : '') },
          { label: ko ? `최대 투자 대상국: ${nm(topD)}` : `Largest destination: ${nm(topD)}`, ...tnTile(cur.dests[topD], lang), sub: kpiSub(fD?.in ? (ko ? `FC·${pass} 보유 ${num((100 * fD.in_pass) / fD.in, 'ko', 0)}%` : `${num((100 * fD.in_pass) / fD.in, 'en', 0)}% held via FC/${pass}`) : '') },
        ].map((k, i) => <li key={k.label}><StatTile label={k.label} value={k.value} unit={k.unit} sub={i === 0 ? <SrcTail reg={reg} text={k.sub} lang={lang} ds={mk.ds} /> : k.sub} /></li>)}
      </ul>
      <MarketView lang={lang} market={market} periodText={per} econ={econ} rows={rows} cols={cols} hTot={cur.holders} dTot={cur.dests}
        holdersOther={cur.holders_other} destsOther={cur.dests_other} total={cur.total} pairs={pairs} focus={focus}
        insights={insights} roundTrips={rts.slice(0, 12)} rtRule={rtRule}
        text={{ sentence: W.sentence, valuation: W.valuation, rowTitle: W.rowTitle, colTitle: W.colTitle,
          title: `${L.market_[market]}, ${per} ${ko ? '잔액' : 'positions'} · ${ko ? '칸: 억 달러' : 'cells: $bn'}` }}
        tags={Object.fromEntries((Object.keys(TAGS) as TagKind[]).map((k) => [k, { ko: TAGS[k].ko, en: TAGS[k].en, desc: TAGS[k].desc[lang] }])) as never}
        explainer={explainer} about={about} source={source} docLinks={<DocLinks lang={lang} />} init={{ n: n0, mode: mode0, enc: enc0, cell: cell0 }} pairTemplate={pairTemplate} />
      {lc ? (
        <LenderCutPanel lang={lang} data={lc} names={lcNames} hrefs={lcHrefs} methodHref={`/${lang}/method`}
          init={{ open: sp.cut === '1', by: str(sp.by), e: str(sp.e), pct: str(sp.pct) }}
          source={<>{L.source}<PanelSrc reg={reg} panel="market.bank" lang={lang} only={['bis.lbs']} />; {ko ? '순준비자산은 신호판(IMF IRFCL)' : 'net reserves from the Signal Board (IMF IRFCL)'}</>} />
      ) : null}
    </div>
  );
}
