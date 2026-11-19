// The economy view: the money ladder of one economy, inflows ("who holds X") or outflows ("what X
// holds"), with everything a paper needs on the first screen: periods, coverage, sources, rules, checks and Cite.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CiteBlock } from '@/components/CiteBlock';
import { FilterRow, RememberEconomy } from '@/components/Controls';
import { Rail, TitleBlock } from '@/components/Dash';
import { EconChart } from '@/components/EconChart';
import { CheckList, CoverageList, DocLinks, ReleaseNotice, RuleChips, SourceList, Updated } from '@/components/Page';
import { DsLink, SrcTail } from '@/components/Src';
import { Hint } from '@/components/Hint';
import { Kicker, Sparkline, StatTile } from '@/components/sn';
import { economyOptions } from '@/lib/page';
import { latestTag, manifest, meta as readMeta, read } from '@/lib/data';
import { amt, day, money, period, unit } from '@/lib/format';
import { isLang, name, t } from '@/lib/i18n';
import { apexBars, build, newestPeriod, params, query } from '@/lib/model';
import { pageMeta } from '@/lib/seo';
import type { Checks, Citations, Econ, Lang, MethodRegistry, SourcesRegistry, World } from '@/lib/types';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ lang: string; iso3: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params: pp }: Props): Promise<Metadata> {
  const { lang, iso3 } = await pp;
  const l: Lang = isLang(lang) ? lang : 'en';
  const X = iso3.toUpperCase();
  const m = manifest(null);
  const meta = readMeta(m);
  const n = name(meta.economies, X, l);
  const econ = read<Econ>(m, `econ/${X}`);
  const np = econ ? newestPeriod(econ) : null;
  const per = np ? period(np, 'Q', l) : '';
  const title = l === 'ko' ? `${n}의 자금 공급자와 용처` : `${n}: who funds it, where its money goes`;
  const description = l === 'ko'
    ? `${n}에 누가 어떤 경로(채권, 은행, 직접투자, 주식)로 자금을 공급하고 ${n}의 자금은 어디로 가는지 설명합니다. BIS·IMF 통계의 국경 간 잔액과 흐름을 다루며, 자료 출처·방법·점검을 포함합니다.${per ? ` 최신 ${per}.` : ''}`
    : `Who puts money into ${n}, through which instruments (debt, banks, direct investment, equity), and where its own money goes: cross-border positions and flows from BIS and IMF statistics, with sources, method and checks.${per ? ` Newest period ${per}.` : ''}`;
  return pageMeta(l, `/e/${X}`, { title, description });
}

export default async function EconomyPage({ params: pp, searchParams }: Props) {
  const { lang: raw, iso3 } = await pp;
  if (!isLang(raw)) notFound();
  const lang: Lang = raw;
  const L = t(lang);
  const sp = await searchParams;
  const r = typeof sp.r === 'string' ? sp.r : null;
  const m = manifest(r);
  const latest = latestTag();
  const meta = readMeta(m);
  const X = iso3.toUpperCase();
  const econ = read<Econ>(m, `econ/${X}`);
  if (!econ) notFound();
  const reg = read<SourcesRegistry>(m, 'registry/sources')!;
  const checks = read<Checks>(m, 'checks');
  const cites = read<Citations>(m, 'registry/citations')!;
  const method = read<MethodRegistry>(m, 'registry/method')!;
  const world = read<World>(m, 'world/global')!;
  const p = params(sp, meta);
  const v = build(econ, meta, reg, checks, p, lang, m.tag);
  if (!v) notFound();
  const base = `/${lang}/e/${X}`;
  const href = (changes: Partial<typeof p>) => `${base}${query({ ...p, ...changes }, meta, r && r !== latest ? r : undefined)}`;
  const xName = v.econName;
  const dirWord = p.dir === 'in' ? L.inflows : L.outflows;
  const title = `${L.ladder}, ${xName}, ${dirWord.toLowerCase()}, ${unit(lang)}`;
  const subtitle = lang === 'ko'
    ? `${p.mode === 'aligned' ? '모든 경로를 공통 최신 기간에 맞춘 잔액' : '경로별 최신 기간의 잔액'} · ${p.width === 'flow' ? '최근 기간 흐름' : '잔액'} · ${p.basis === 'nat' ? '은행은 국적 기준' : '거주성 기준'}`
    : `${p.mode === 'aligned' ? 'Positions at the newest period all channels share' : "Positions at each channel's newest period"} · ${p.width === 'flow' ? 'width is the latest flow' : 'width is the position'} · ${p.basis === 'nat' ? 'banks by nationality' : 'residence basis'}`;
  const cq = new URLSearchParams(query(p, meta).replace(/^\?/, ''));
  if (!cq.get('d')) cq.set('d', v.asof);
  if (p.dir === 'in') cq.set('dir', 'in');
  const datasetsShort = v.sources.map((s) => reg.datasets[s.ds]?.short ?? s.ds);
  const cite = {
    lang, title: lang === 'ko' ? `돈의 사다리: ${xName}, ${dirWord}` : `Money ladder: ${xName}, ${dirWord.toLowerCase()}`,
    key: `${X}-${p.dir}`, release: m.tag, method: meta.method, date: m.date, path: base, query: cq.toString(), datasets: datasetsShort,
  };
  const figure = {
    title: cite.title, subtitle: `${v.status}`, source: `${L.source}${v.sourceLine}`,
    note: (lang === 'ko' ? '자료: ' : 'Source: ') + `datasteg money-flow (${lang === 'ko' ? '릴리스' : 'release'} ${m.tag}, ${lang === 'ko' ? '방법론' : 'method'} ${meta.method})`,
    citation: '', filename: `money-flow-${X}-${p.dir}-${v.asof}`,
  };
  const { citationText } = await import('@/lib/citation');
  figure.citation = citationText(cite as never);
  const datasets = v.sources.map((s) => ({ name: s.ds, text: cites.datasets[s.ds]?.[lang]?.text ?? s.label, bibtex: cites.datasets[s.ds]?.[lang]?.bibtex ?? '' })).filter((d) => d.text);

  const chartLabels = {
              chart: L.chart, table: L.table, source: L.source, updated: L.updated, png: L.png, svg: L.svg, csv: L.csv,
              rungs: L.rung, made: L.made, border: `${L.border}, ${p.dir === 'in' ? (lang === 'ko' ? '부채' : 'liabilities') : (lang === 'ko' ? '자산' : 'assets')}, ${period(v.border.period, 'Q', lang)}`,
              apex: lang === 'ko' ? '발권 중앙은행 자산(자체 척도)' : 'Issuing central banks, total assets (own scale)',
              channel: L.channel, unit: unit(lang),
              tip: { period: L.periodCol, source: L.sourceCol, rules: L.rulesCol, reported: L.reportedCol, share: lang === 'ko' ? '총계 대비' : 'of the total', flow: L.flowCol, total: lang === 'ko' ? '이 사다리에 그려진 합' : 'drawn on this ladder',
                     published: lang === 'ko' ? '발표된 흐름' : 'published', derived: lang === 'ko' ? '잔액 차이, 평가 변동 포함' : 'from two positions, includes valuation' },
              cols: { holder: p.dir === 'in' ? L.holder : L.destination, channel: L.channelCol, position: `${L.positionCol} (${unit(lang)})`, flow: `${L.flowCol} (${unit(lang)})`, period: L.periodCol, source: L.sourceCol, rules: L.rulesCol, reported: L.reportedCol },
              caption: L.numbers, note: L.numbersNote, legend: lang === 'ko' ? '경로' : 'Channels', off: p.off,
            };

  // the source line with each dataset linked (the figure's printed line stays text: figure.source)
  const cut = v.sourceLine.indexOf(`. ${L.calculations}`);
  const sourceNode = cut > 0 ? (
    <>{v.sourceLine.slice(0, cut).split('; ').map((sg, i) => {
      const s = v.sources.find((x) => sg.startsWith(x.label));
      return <span key={i}>{i ? '; ' : ''}{s ? <><DsLink reg={reg} ds={s.ds} lang={lang}>{s.label}</DsLink>{sg.slice(s.label.length)}</> : sg}</span>;
    })}{v.sourceLine.slice(cut)}</>
  ) : v.sourceLine;
  const apex = apexBars(world, meta, p.d, lang);
  const dsLinks = (dss: string[]) => <>{[...new Set(dss)].filter((ds) => reg.datasets[ds]).map((ds, i) => <span key={ds}>{i ? '; ' : ''}<DsLink reg={reg} ds={ds} lang={lang}>{reg.datasets[ds].short}</DsLink></span>)}</>;
  const rungSrc = { apex: apex.length ? dsLinks(apex.map((a) => a.ds)) : null, border: dsLinks(['imf.IIP']), made: v.made.length ? dsLinks(v.made.map((b) => b.ds)) : null };

  const flowsTab = (
    <>
      <h3 className="mf-h3" style={{ marginTop: 0 }}>{lang === 'ko' ? '국경 거래(BOP, 발표된 흐름)' : 'Border transactions (BOP, published flows)'}</h3>
      <ul className="mf-context">
        {['portfolio', 'direct', 'other', 'reserves'].map((item) => {
          const pts = econ.border[p.dir]?.bop[item];
          const last = pts?.filter((x) => x[0] <= p.d).slice(-1)[0];
          return last ? <li key={item}><span>{L.iip[item]}<br /><span className="mf-note"><SrcTail reg={reg} text={`${period(last[0], 'Q', lang)} · IMF BOP`} lang={lang} ds="imf.BOP" /></span></span><b>{money(last[1], lang, true)}</b></li> : null;
        })}
      </ul>
      <p className="mf-note" style={{ marginTop: 6 }}>{lang === 'ko' ? '평가 변동을 포함하지 않는 거래액입니다(R8). 잔액과 더하지 않습니다.' : 'Transactions, with no valuation change (R8); never added to positions.'}</p>
      <h3 className="mf-h3">{lang === 'ko' ? '시장 규모(참고)' : 'Market context'}</h3>
      <ul className="mf-context">{v.context.map((c) => <li key={c.label}><span>{c.label}<br /><span className="mf-note"><SrcTail reg={reg} text={c.note} lang={lang} /></span></span><b>{c.value}</b></li>)}</ul>
      <p className="mf-note" style={{ marginTop: 6 }}>{lang === 'ko' ? '국내 시장 규모는 참고로만 표시하며, 외국인 비중은 계산하지 않습니다(M5).' : 'Domestic sizes are context only; no foreign share is computed (M5).'}</p>
    </>
  );
  const notesTab = (
    <ul className="mf-notes">
      {(['position', 'flow', 'residence', 'nationality', 'coverage', 'financial_centre'] as const).map((k) => (
        <li key={k}><b>{({ position: L.position, flow: L.flow, residence: L.residence, nationality: L.nationality, coverage: L.coverage, financial_centre: lang === 'ko' ? '금융중심지(FC)' : 'Financial centre (FC)' } as Record<string, string>)[k]}.</b> {method.definitions[k]?.[lang]}</li>
      ))}
    </ul>
  );

  return (
    <div className="mf-dash mf-dash--econ" data-dir={p.dir}>
      <TitleBlock lang={lang} kicker={<Kicker>{v.kicker}</Kicker>} title={v.headline} status={<>{L.ask.econ} · {v.status} · <Updated m={m} lang={lang} /></>} />
      <RememberEconomy code={X} />
      <ReleaseNotice m={m} latest={latest} lang={lang} href={`${base}${query(p, meta)}`} />
      <FilterRow lang={lang} economy={X} economies={economyOptions(meta, lang)} economyLabel={L.economy}
        controls={[
          { key: 'dir', label: L.direction, value: p.dir, def: 'in', options: [{ value: 'in', label: L.inflows }, { value: 'out', label: L.outflows }] },
          { key: 'w', label: L.width, value: p.width, def: 'pos', options: [{ value: 'pos', label: L.position }, { value: 'flow', label: L.flow }] },
          { key: 'b', label: L.basis, value: p.basis, def: 'res', options: [{ value: 'res', label: L.residence }, { value: 'nat', label: L.nationality }] },
          { key: 'al', label: L.periods, value: p.mode === 'aligned' ? '1' : '0', def: '1', options: [{ value: '1', label: L.aligned }, { value: '0', label: L.newest }] },
          { key: 'k', label: L.holders, value: String(p.k), def: '10', options: [{ value: '5', label: '5' }, { value: '10', label: '10' }, { value: '20', label: '20' }] },
        ]}
        day={{ d: p.d, min: '2000-01-01', max: meta.day, label: L.day_, play: L.play, pause: L.pause }} />
      <div className="mf-dash__main">
        <div className="mf-dash__left">
          <ul className="mf-kpis mf-kpis--strip">{v.kpis.map((k) => (
            <li key={k.label} className={`mf-kpi${k.wrap ? ' mf-kpi--wrap' : ''}${k.tone ? ` mf-kpi--${k.tone}` : ''}`}>
              <StatTile label={k.label} value={k.value} unit={k.unit} sub={<><SrcTail reg={reg} text={k.sub} lang={lang} ds={k.ds} />{k.hint ? <Hint text={k.hint} label={lang === 'ko' ? `${k.label}: 설명` : `${k.label}: about this number`} /> : null}</>} />
            </li>))}</ul>
          <EconChart lang={lang} title={title} subtitle={subtitle} source={sourceNode} rungSrc={rungSrc} updated={day(m.date, lang)}
            holders={v.holders} pools={v.pools} ribbons={v.ribbons} apex={apex} made={v.made} flow={p.width === 'flow'} dir={p.dir} econ={xName}
            borderItems={v.border.items.filter((b) => b.value != null).map((b) => ({ label: L.iip[b.item], value: amt(b.value, lang) }))}
            table={v.table} figure={figure} aria={v.headline}
            legendHrefs={Object.fromEntries(['debt', 'bank', 'fdi', 'equity', 'unsplit', 'reserves'].map((g) => [g, href({ off: p.off.includes(g) ? p.off.filter((x) => x !== g) : [...p.off, g] })]))}
            labels={chartLabels} />
        </div>
        <Rail lang={lang} label={L.thisView} foot={<DocLinks lang={lang} />} sections={[
          { id: 'coverage', icon: 'gauge', label: L.coverage, open: true, content: <CoverageList lang={lang} coverage={v.coverage} /> },
          { id: 'sources', icon: 'database', label: L.sources, wideOpen: true, content: <SourceList sources={v.sources} reg={reg} lang={lang} /> },
          { id: 'rules', icon: 'rules', label: L.rulesApplied, wideOpen: true, content: <RuleChips rules={v.rules} methodHref={`/${lang}/method`} /> },
          { id: 'checks', icon: 'checks', label: L.checks, content: <CheckList lang={lang} checks={v.checks} /> },
          { id: 'flows', icon: 'flows', label: lang === 'ko' ? '흐름·참고' : 'Flows', content: flowsTab },
          { id: 'cite', icon: 'quote', label: L.cite, content: <CiteBlock cite={cite as never} labels={{ title: L.citeView, copy: L.copy, copied: L.copied, note: L.figureNote, bibtex: L.bibtex, ris: L.ris, datasets: L.datasetsCite, method: L.methodCite }} datasets={datasets} method={cites.method[lang]} /> },
          { id: 'notes', icon: 'book', label: L.notes, content: notesTab },
        ]} />
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        '@context': 'https://schema.org', '@type': 'Dataset', name: cite.title, creator: { '@type': 'Organization', name: 'datasteg' },
        version: m.tag, url: `https://money-flow.datasteg.com${base}?r=${m.tag}`, citation: figure.citation, license: 'https://money-flow.datasteg.com/en/sources#licences',
        isBasedOn: v.sources.map((s) => reg.datasets[s.ds]?.landing).filter(Boolean), dateModified: m.date,
      }) }} />
    </div>
  );
}
