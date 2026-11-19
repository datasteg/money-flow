// The World tab (the method version comes from the release's registry): where cross-border money is moving and who is exposed. On top, the
// World pulse (weekly and daily Fed series, monthly TIC), then the Signal Board (R17–R19: vulnerability against flow
// for each borrowing economy, quarterly), then "Structure": the stock panels the flows have built (dollar credit
// outside the US, the issuing central banks, the largest external balance sheets, flows through the hubs, the currency
// of reserves). A country name opens that economy in the Economy tab.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { CiteBlock } from '@/components/CiteBlock';
import { FilterRow } from '@/components/Controls';
import { BarList } from '@/components/Tip';
import { GliChart } from '@/components/WorldCharts';
import { SignalBoard } from '@/components/SignalBoard';
import { DocLinks, ReleaseNotice, Updated } from '@/components/Page';
import { PanelSrc, SrcLink, linkFor } from '@/components/Src';
import { Delta, Kicker, Sparkline } from '@/components/sn';
import { amt, at, day, money, num, period, pct, tn, unit, usdBn } from '@/lib/format';
import { isLang, name, t, withFallback } from '@/lib/i18n';
import { familyTemplate } from '@/lib/family';
import { dayParam, load } from '@/lib/page';
import { pageMeta } from '@/lib/seo';
import { manifest, read } from '@/lib/data';
import type { Lang, Pt, PulseSeries, SourcesRegistry, World } from '@/lib/types';

// The Signal Board's caption (method 1.6: A2 named as the measures registry names it). A Korean
// string still waiting for its draft ('') shows its English.
const BOARD_SUB = {
  en: 'Quarterly. Across: vulnerability, half exposure (A1, FX credit / GDP, and A2, BIS banks\' claims due within a year ÷ reserve base, each against the other economies’ levels and the economy’s own past), half buffer weakness (net IIP and current account, to GDP). Up and down: bank and bond flows over the previous stock, a year. The lower right is the risk zone. Pick a quarter for its snapshot, filter by group or region, and follow up to six economies to play their paths; the axes are fixed. Flows arrive two to four months after the quarter; an economy without a flow that quarter is scored and listed under the chart. How the score is computed is under the chart.',
  ko: '분기 자료입니다. 가로축은 취약성입니다. 절반은 노출도이고 나머지 절반은 완충력 약화입니다. 노출도는 A1(외화 신용/GDP)과 A2(BIS 보고은행이 보유한 잔존만기 1년 이내 채권 ÷ 외환보유액 기준)로 보며, 각각 다른 경제의 수준 및 해당 경제의 과거와 비교합니다. 완충력 약화는 순대외금융자산과 경상수지를 GDP 대비로 봅니다. 세로축은 은행·채권 자금 흐름을 직전 잔액으로 나눈 값으로, 1년 기준입니다. 오른쪽 아래가 위험 구간입니다. 분기를 고르면 그 시점의 스냅숏을 볼 수 있습니다. 그룹이나 지역으로 거르고, 최대 여섯 경제를 따라가며 경로를 재생할 수 있습니다. 축은 고정되어 있습니다. 자금 흐름 자료는 분기가 끝나고 2~4개월 뒤에 들어옵니다. 그 분기에 흐름 자료가 없는 경제도 점수를 매기며, 차트 아래에 따로 표시합니다. 점수 산출 방법은 차트 아래에 있습니다.',
};
// The board's footer: the method and its checks, V27 (net reserves and A2's reserve base) since method 1.6.
const BOARD_FOOT = { en: '. Method {version}: R17–R19, checks V18–V22 and V27', ko: '. 방법론 {version}: R17–R19, 점검 V18–V22·V27' };

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  const l: Lang = isLang(lang) ? lang : 'en';
  let q = '';
  try { const w = read<World>(manifest(null), 'world/global'); const bq = w?.board.quarters.slice(-1)[0]; q = bq ? period(bq, 'Q', l) : ''; } catch { q = ''; }
  const title = l === 'ko' ? '세계에서 자금이 움직이는 곳과 취약한 경제' : 'World: where money is moving, and who is exposed';
  const description = l === 'ko'
    ? `주간 세계 맥박(연준 통화스왑, 외국 공공부문 보관 국채, 달러지수), 분기별 신호판(차입 경제별 취약성과 자금흐름), 그리고 세계 자금 구조.${q ? ` 신호판 최신 ${q}.` : ''}`
    : `The weekly world pulse (Fed swaps, Treasuries in custody, the dollar), the quarterly Signal Board (vulnerability against funding flows for each borrowing economy) and the structure of global funding.${q ? ` Board newest ${q}.` : ''}`;
  return pageMeta(l, '/world', { title, description });
}

function Card({ title, sub, source, children, className }: { title: string; sub?: string; source: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mf-dcard ${className ?? ''}`} aria-label={title}>
      <div className="mf-dcard__head"><div><h2 className="mf-dcard__title">{title}</h2>{sub ? <p className="mf-dcard__sub">{sub}</p> : null}</div></div>
      <div className="mf-dcard__body" style={{ overflow: 'auto' }}>{children}</div>
      <p className="mf-dcard__foot">{source}</p>
    </section>
  );
}

/** The BIS estimate of the dollar debt in FX swaps and forwards (registry `paper.borio2022`): one value at one date,
 *  not a series, so it stands beside the chart and is added to nothing. The comparison is with the measured
 *  on-balance-sheet figure (BIS GLI) at the same date. */
function SwapsNote({ reg, total, lang }: { reg: SourcesRegistry; total: Pt[]; lang: Lang }) {
  const e = reg.links?.['paper.borio2022']?.estimate;
  if (!e) return null;
  const on = at(total, e.as_of);
  const ratio = on?.[1] && on[0] === e.as_of ? e.usd_bn / on[1] : null;
  const ko = lang === 'ko';
  const [yy, mm] = e.as_of.split('-').map(Number);
  const when = ko ? `${yy}년 ${mm}월 말` : `end-${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][mm - 1]} ${yy}`;
  return (
    <aside className="mf-swaps" aria-label={ko ? '외환스왑·선물환 속 달러 채무(추정)' : 'Dollar debt in FX swaps and forwards (estimate)'}>
      <p className="mf-swaps__kicker"><span className="mf-swaps__swatch" aria-hidden />{ko ? '추정치 · 측정 자료 아님' : 'Estimate · not measured data'}</p>
      <p className="mf-swaps__title">{ko ? '외환스왑·선물환 속 달러 채무' : 'Dollar debt in FX swaps and forwards'}</p>
      <p className="mf-swaps__value">{e.up_to ? (ko ? '최대 ' : 'up to ') : ''}{tn(e.usd_bn, lang)}</p>
      <p className="mf-swaps__text">{ko
        ? `${when}, 미국 밖 비은행이 외환스왑·선물환·통화스왑으로 부담한 달러 지급 의무입니다. 대차대조표 밖 항목이어서 부채 통계에 포함되지 않습니다.`
        : `${when}: non-banks outside the US, dollar obligations in FX swaps, forwards and currency swaps. Off balance sheet, so debt statistics miss it.`}
        {ratio ? (ko ? ` 같은 때 대차대조표상 달러 부채(${tn(on![1], 'ko')}, 차트의 ${on![0].slice(0, 4)}년 2분기)의 ${num(ratio, 'ko')}배, 대략 두 배입니다.`
          : ` About ${num(ratio, 'en')} times the on-balance-sheet dollar debt then (${tn(on![1], 'en')}, the chart's Q2 ${on![0].slice(0, 4)}): roughly double.`) : null}</p>
      <p className="mf-swaps__text"><b>{ko ? '어떤 막대나 합계에도 더하지 않습니다.' : 'Not added to any bar or total.'}</b></p>
      <p className="mf-swaps__src">{ko ? '자료: ' : 'Source: '}<SrcLink reg={reg} id="paper.borio2022" lang={lang} />{ko ? ', BIS 분기보고서' : ', BIS QR'}</p>
    </aside>
  );
}

/** One World pulse tile: the newest value with its date (prominent: the only current-week number on the page), the
 *  change over four weeks, a year of Wednesdays as a sparkline, the source, and a warning when it is older than ten
 *  days or not collected yet (V21). */
function PulseTile({ label, s, value, change, panel, reg, lang }: { label: string; s: PulseSeries; value: string; change: string | null; panel: string; reg: SourcesRegistry; lang: Lang }) {
  const ko = lang === 'ko';
  const up = (s.chg ?? 0) > 0, down = (s.chg ?? 0) < 0;
  return (
    <li className={`mf-pulse__tile${s.stale || s.missing ? ' is-stale' : ''}`}>
      <p className="mf-pulse__label">{label}</p>
      {s.missing ? (
        <p className="mf-pulse__missing">{ko ? '아직 수집하지 않았습니다. datahub에 계열을 더하면 다음 빌드부터 나타납니다.' : 'Not collected yet: it appears from the first build after the series is added to datahub'}</p>
      ) : (
        <>
          <p className="mf-pulse__asof">{ko ? '기준 ' : 'As of '}{day(s.latest?.[0], lang)}</p>
          <p className="mf-pulse__value">{value}</p>
          <p className="mf-pulse__chg">{change ? <Delta value={change} direction={up ? 'up' : down ? 'down' : 'flat'} /> : '–'} <span className="mf-muted">{ko ? '4주 변화' : '4-week change'}</span></p>
          <Sparkline data={(s.pts ?? []).map((p) => p[1])} width={150} height={30} label={ko ? `${label}, 52주` : `${label}, 52 weeks`} />
          {s.stale ? <p className="mf-pulse__warn">{ko ? `${s.age}일 전 값입니다(10일 초과)` : `${s.age} days old (more than 10)`}</p> : null}
        </>
      )}
      <p className="mf-pulse__src">{ko ? '자료: ' : 'Source: '}<PanelSrc reg={reg} panel={panel} lang={lang} /></p>
    </li>
  );
}

function Pulse({ pulse, reg, lang }: { pulse: World['pulse']; reg: SourcesRegistry; lang: Lang }) {
  const ko = lang === 'ko';
  const sw = pulse.swap_lines, cu = pulse.custody_treasuries, dx = pulse.dollar_index, tic = pulse.tic;
  const ticLast = tic?.official.slice(-1)[0], ticPriv = tic?.private.slice(-1)[0];
  const sum3 = (pts?: Pt[]) => (pts && pts.length >= 3 ? pts.slice(-3).reduce((a, p) => a + (p[1] ?? 0), 0) : null);
  return (
    <section className="mf-pulse" aria-label={ko ? '세계 맥박' : 'World pulse'}>
      <h2 className="mf-pulse__h">{ko ? '세계 맥박(주간)' : 'World pulse (weekly)'} <span className="mf-muted">{ko ? '· 이 화면에서 이번 주 숫자는 여기뿐입니다. 날짜 이동과 상관없이 최신 값입니다' : '· the only current-week numbers on this page; always the newest, whatever day is selected'}</span></h2>
      <ul className="mf-pulse__row">
        <PulseTile label={ko ? '연준 통화스왑 잔액' : 'Fed central bank liquidity swaps'} s={sw} value={money(sw.latest?.[1], lang)} change={sw.chg == null ? null : money(sw.chg, lang, true)} panel="world.pulse_swaps" reg={reg} lang={lang} />
        <PulseTile label={ko ? '외국 공공부문 보관 미 국채' : 'Treasuries held for foreign official accounts'} s={cu} value={money(cu.latest?.[1], lang)} change={cu.chg == null ? null : money(cu.chg, lang, true)} panel="world.pulse_custody" reg={reg} lang={lang} />
        <PulseTile label={ko ? '광의 달러지수(2006년 1월=100)' : 'Broad dollar index (Jan 2006 = 100)'} s={dx} value={num(dx.latest?.[1], lang, 2)} change={dx.chg == null ? null : `${num(dx.chg, lang, 1, true)}%`} panel="world.pulse_dollar" reg={reg} lang={lang} />
        {tic ? (
          <li className="mf-pulse__tile">
            <p className="mf-pulse__label">{ko ? '외국인의 미국 장기증권 순매수(월간)' : 'Net foreign purchases of US long-term securities (monthly)'}</p>
            <p className="mf-pulse__asof">{period(tic.latest, 'M', lang)}</p>
            <p className="mf-pulse__value mf-pulse__value--two"><span>{ko ? '공공 ' : 'Official '}{money(ticLast?.[1], lang, true)}</span><span>{ko ? '민간 ' : 'Private '}{money(ticPriv?.[1], lang, true)}</span></p>
            <p className="mf-pulse__chg"><span className="mf-muted">{ko ? `3개월 합계: 공공 ${money(sum3(tic.official), 'ko', true)}, 민간 ${money(sum3(tic.private), 'ko', true)}` : `3 months: official ${money(sum3(tic.official), 'en', true)}, private ${money(sum3(tic.private), 'en', true)}`}</span></p>
            <Sparkline data={tic.official.map((p) => p[1])} width={150} height={30} label={ko ? '공공 순매수, 13개월' : 'Official net purchases, 13 months'} />
            <p className="mf-pulse__src">{ko ? '자료: ' : 'Source: '}<PanelSrc reg={reg} panel="world.pulse_tic" lang={lang} /></p>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function WorldPage({ params, searchParams }: Props) {
  const { lang: raw } = await params;
  if (!isLang(raw)) notFound();
  const lang: Lang = raw;
  const ko = lang === 'ko';
  const L = t(lang);
  const sp = await searchParams;
  const { m, latest, meta, world, cites, reg, method } = load(sp);
  const d = dayParam(sp, meta);
  const gnTemplate = familyTemplate('global-network', 'economy_funding', lang);
  const usd = world.gli.USD;
  const cofT = at(world.cofer.total, d), cofU = at(world.cofer.USD, d);
  // the board's quarter: the newest at or before the day (each figure states its own period)
  const board = world.board;
  const bq = board.quarters.filter((q) => q <= d).slice(-1)[0] ?? board.quarters[0];
  const bd = board.q[bq];
  const nmT = (c: string) => name(meta.economies, c, lang);
  const w0 = bd?.top[0];
  const qL = period(bq, 'Q', lang);
  const headline = !bd ? '' : ko
    ? (bd.n_out ? `${qL} 차입 경제 ${bd.n}개 중 ${bd.n_out}개 경제에서 자금이 유출됐습니다. 유출 규모가 가장 큰 경제는 ${nmT(w0![0])}(${money(w0![1], 'ko', true)})입니다`
      : `${qL} 차입 경제 ${bd.n}개 모두에 자금이 유입됐습니다`)
    : (bd.n_out ? `In ${qL}, funding left ${bd.n_out} of ${bd.n} borrowing economies; the largest withdrawal was from ${nmT(w0![0])} (${usdBn(w0![1], 'en', true)})`
      : `In ${qL}, funding reached all ${bd.n} borrowing economies`);
  const econ = Object.entries(world.economies).map(([c, e]) => ({ c, a: at(e.assets, d), l: at(e.liabilities, d) })).filter((x) => x.l)
    .sort((x, y) => (y.l?.[1] ?? 0) - (x.l?.[1] ?? 0)).slice(0, 12);
  const lastKey = (o: Record<string, unknown> | undefined) => Object.keys(o ?? {}).filter((p) => p <= d).sort().slice(-1)[0];
  const py = lastKey(world.pairs.portfolio), by = lastKey(world.pairs.bank);
  const pairs = (world.pairs.portfolio?.[py] ?? []).slice(0, 7);
  const bpairs = (world.pairs.bank?.[by] ?? []).slice(0, 5);
  const cofer = ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'CAD', 'AUD', 'CHF', 'OTHC'].map((c) => ({ c, v: at(world.cofer[c], d) })).filter((x) => x.v);
  const apex = Object.entries(world.apex).map(([c, s]) => ({ c, v: at(s.pts, d), ds: s.ds, key: s.key }));
  const cite = { lang, title: ko ? '돈의 사다리: 세계' : 'Money ladder: world', key: 'world', release: m.tag, method: meta.method, date: m.date, path: `/${lang}/world`, query: `d=${d}`,
    datasets: ['BIS LBS', 'BIS DSS', 'BIS CBS', 'IMF IRFCL', 'BIS TC', 'Fed H.4.1', 'Fed H.10', 'US Treasury TIC', 'BIS GLI', 'BIS CBTA', 'IMF COFER', 'IMF IIP', 'IMF PIP (CPIS)'] };
  const dsCites = ['bis.LBS', 'bis.DSS', 'bis.CBS', 'imf.IRFCL', 'bis.TC', 'fred.observations', 'tic.files', 'bis.GLI', 'bis.CBTA', 'imf.COFER', 'imf.IIP', 'imf.PIP', 'ecb.ILM'].map((ds) => ({ name: ds, text: cites.datasets[ds]?.[lang]?.text ?? '', bibtex: cites.datasets[ds]?.[lang]?.bibtex ?? '' })).filter((x) => x.text);
  const href = (c: string) => (meta.economies[c]?.page ? `/${lang}/e/${c}${d !== meta.day ? `?d=${d}` : ''}` : undefined);
  const nm = (c: string) => { const h = href(c); return h ? <a href={h}>{name(meta.economies, c, lang)}</a> : name(meta.economies, c, lang); };
  const row = (key: string, label: ReactNode, nameText: string, v: number | null, note?: ReactNode, color?: string) => ({ key, label, name: nameText, value: v, shown: amt(v, lang), full: money(v, lang), note, color });
  const src = (panel: string, tail?: string) => <>{L.source}<PanelSrc reg={reg} panel={panel} lang={lang} />{tail ?? ''}</>;
  const kSrc = (p: string, id: string) => <>{p} · <SrcLink reg={reg} id={id} lang={lang} /></>;
  const bset = [...board.set.in, ...board.set.out.map(([c]) => c)];
  const names = Object.fromEntries(bset.map((c) => [c, nmT(c)]));
  const pages = Object.fromEntries(bset.map((c) => [c, href(c)]));
  return (
    <div className="mf-dash mf-dash--free">
      <div className="mf-dash__title">
        <Kicker>{ko ? '세계 · 자금이 움직이는 곳' : 'World · where money is moving'}</Kicker>
        <h1 className="mf-dash__h1">{headline}</h1>
        <details className="mf-citepop">
          <summary className="sn-btn sn-btn--secondary sn-btn--sm">{L.cite}</summary>
          <div>
          <CiteBlock cite={cite as never} labels={{ title: L.citeView, copy: L.copy, copied: L.copied, note: L.figureNote, bibtex: L.bibtex, ris: L.ris, datasets: L.datasetsCite, method: L.methodCite }}
            datasets={dsCites} method={cites.method[lang]} />
          </div>
        </details>
        <p className="mf-dash__status">{L.ask.world} · {L.release} {m.tag} · {L.method} {meta.method} · <Updated m={m} lang={lang} /> · {ko
          ? '신호판은 차입국 쪽에서 봅니다. 채권은 발행자 국적 기준이고, 아래 구조 패널은 거주성 기준입니다.'
          : 'The board looks from the borrower’s side, with debt securities by nationality of issuer; the structure panels below are on residence.'} <a href={`/${lang}/method#signal-board`}>{ko ? '이 화면에 포함되지 않는 것' : 'What this page cannot see'}</a></p>
      </div>
      <ReleaseNotice m={m} latest={latest} lang={lang} href={`/${lang}/world`} />
      <Pulse pulse={world.pulse} reg={reg} lang={lang} />
      <FilterRow lang={lang} controls={[]}
        day={{ d, min: '2000-01-01', max: meta.day, label: L.dayView, play: L.play, pause: L.pause, note: L.dayNote }} />
      <section className="mf-dcard mf-board-card" aria-label={ko ? '신호판' : 'Signal Board'}>
        <div className="mf-dcard__head"><div>
          <h2 className="mf-dcard__title">{ko ? '신호판: 어느 경제가 취약하고, 어디서 자금이 유출되는가' : 'Signal Board: which economies are vulnerable, and where funding is leaving'}</h2>
          <p className="mf-dcard__sub">{withFallback(BOARD_SUB.en, BOARD_SUB[lang])}</p>
        </div></div>
        <SignalBoard board={board} start={bq} lang={lang} names={names} pages={pages} reg={reg} version={method.version} gnTemplate={gnTemplate}
          regions={Object.fromEntries(bset.map((c) => [c, meta.economies[c]?.region ?? null]))}
          init={{ q: str(sp.bq), follow: str(sp.bf)?.split(',').filter(Boolean), group: str(sp.bg), region: str(sp.br), show: str(sp.bs), only: str(sp.bo) === '1' }} />
        <p className="mf-dcard__foot">{src('world.board', withFallback(BOARD_FOOT.en, BOARD_FOOT[lang]).replace('{version}', method.version))}</p>
      </section>

      <h2 className="mf-h2 mf-structure__h">{ko ? '구조 — 흐름이 쌓아 올린 지형' : 'Structure: what the flows have built'}</h2>
      <p className="mf-note">{ko ? '잔액(금액) 패널입니다. 거주성 기준이며 날짜 이동을 따릅니다.' : 'Stocks (amounts outstanding), on the residence basis; they follow the selected day.'} {L.basisNote}</p>
      <div className="mf-grid-dash mf-structure">
        <Card className="mf-span2" title={`${ko ? '미국 밖 비은행의 달러 부채: 채권(강조)과 대출' : 'Dollar credit to non-banks outside the US: debt securities (emphasis) and loans'}, ${unit(lang)}`}
          sub={ko ? '측정 자료만 그립니다. 기준시점은 연말이며, 마지막 막대는 최신 분기입니다. 대출은 총액에서 채권을 뺀 값입니다. 막대에 올리거나 누르면 값이 표시됩니다. 외환스왑 속 달러 채무 추정치는 차트 옆 상자에 따로 둡니다' : 'Measured data only. Year ends; the last bar is the newest quarter. Loans are the total less debt securities. Hover or tap a bar for its values. The estimate of dollar debt in FX swaps sits in the box beside the chart'}
          source={src('world.gli')}>
          <div className="mf-gli"><div className="mf-gli__chart"><GliChart total={usd.total} sec={usd.securities} loans={usd.loans} d={d} lang={lang} /></div>
            <SwapsNote reg={reg} total={usd.total} lang={lang} /></div>
        </Card>
        <Card title={ko ? '최상층: 발권 중앙은행 총자산' : 'The apex: issuing central banks, assets'} sub={ko ? '억 달러, 출처별 최신 값' : "USD bn, each source's newest value"}
          source={src('world.apex', ko ? '. 일본은행은 BIS 자료(FRED의 일본은행 계열은 일본은행 저작권)' : '. The BoJ from BIS (its FRED series is BoJ copyright)')}>
          <BarList rows={apex.map((a) => { const id = linkFor(reg, a.ds, a.key); const p = period(a.v?.[0], a.ds === 'bis.CBTA' ? 'M' : 'D', lang);
            return { ...row(a.c, nmT(a.c), nmT(a.c), a.v?.[1] ?? null, id ? kSrc(p, id) : p), tipNote: `${p} · ${id ? reg.links[id]?.label[lang] : a.ds}` }; })} />
        </Card>
        <Card title={ko ? '국가: 대외금융부채(총액·지분 포함) 상위 12개 경제' : 'Countries: the 12 largest gross external liabilities (incl. equity)'}
          sub={ko ? '억 달러. 주식·직접투자 지분을 포함한 총액이며 시가 기준이어서 주가를 따라 움직입니다. 순액은 자산−부채입니다. 이름을 누르면 경제 탭에서 그 경제가 열립니다.'
            : 'USD bn. Gross, equity and direct investment included, at market value, so they move with stock prices; net = assets − liabilities. A name opens that economy in the Economy tab'} source={src('world.countries')}>
          <BarList rows={econ.map((x) => {
            const net = x.a && x.l && x.a[0] === x.l[0] && x.a[1] != null && x.l[1] != null ? x.a[1] - x.l[1] : null;
            return { ...row(x.c, nm(x.c), nmT(x.c), x.l?.[1] ?? null, `${period(x.l?.[0], 'Q', lang)} · ${ko ? '자산' : 'assets'} ${amt(x.a?.[1] ?? null, lang)} · ${ko ? '순' : 'net'} ${amt(net, lang, true)}`),
              tipNote: `${ko ? '대외금융부채(총액·지분 포함)' : 'gross external liabilities (incl. equity)'}, ${period(x.l?.[0], 'Q', lang)} · ${ko ? '대외금융자산' : 'assets'} ${money(x.a?.[1] ?? null, lang)} · ${ko ? '순대외금융자산' : 'net IIP'} ${money(net, lang, true)}` };
          })} />
        </Card>
        <Card title={ko ? '허브를 거친 자금' : 'Flows through the hubs'} sub={ko
          ? `거주성 기준 잔액이므로 역외금융센터는 최종 소유자가 아니라 통로로 나타납니다. 증권 ${period(py, 'S', lang)} · 은행 대출·예금 ${period(by, 'Q', lang)}`
          : `Residence-based positions, so offshore centres appear as conduits, not final owners. Portfolio ${period(py, 'S', lang)} · bank loans and deposits ${period(by, 'Q', lang)}`}
          source={src('world.pairs')}>
          <BarList rows={[...pairs.map(([c, dd, v]) => ({ ...row(`p${c}${dd}`, <>{nmT(c)} → {nm(dd)}</>, `${nmT(c)} → ${nmT(dd)}`, v, ko ? '증권' : 'portfolio', 'var(--viz-7)'), tipNote: `${ko ? '증권투자' : 'portfolio'}, ${period(py, 'S', lang)}` })),
            ...bpairs.map(([c, dd, v]) => ({ ...row(`b${c}${dd}`, <>{nmT(c)} → {nm(dd)}</>, `${nmT(c)} → ${nmT(dd)}`, v, ko ? '은행' : 'bank', 'var(--viz-1)'), tipNote: `${ko ? '은행 대출·예금' : 'bank loans and deposits'}, ${period(by, 'Q', lang)}` }))]} />
        </Card>
        <Card title={ko ? '세계 외환보유액의 통화' : 'The currency of the world’s reserves'} sub={`${period(cofU?.[0], 'Q', lang)} · ${ko ? '억 달러, 통화 구성 확인분' : 'USD bn, allocated reserves'}`} source={src('world.cofer')}>
          <BarList rows={cofer.map((x) => { const lb = x.c === 'OTHC' ? (ko ? '기타 통화' : 'Other currencies') : x.c; return { ...row(x.c, lb, lb, x.v?.[1] ?? null, undefined, x.c === 'USD' ? 'var(--viz-focus)' : 'var(--viz-context)'),
            tipNote: `${pct(cofT?.[1] && x.v?.[1] != null ? (100 * x.v[1]) / cofT[1] : null, lang)} ${ko ? '(확인분 대비)' : 'of allocated'} · ${period(x.v?.[0], 'Q', lang)}` }; })} />
        </Card>
      </div>
      <DocLinks lang={lang} />
    </div>
  );
}
