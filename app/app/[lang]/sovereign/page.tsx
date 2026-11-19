// The Sovereign tab (money-flow's fourth dashboard; method 1.5, rules R22–R28,
// checks V24–V26): seven threshold rules on debt, deficits, the external accounts and bond spreads, counted for each
// of 36 economies and each year since 1990 beside past IMF arrangements, euro-area and EU programmes and defaults. A
// count of signals, not a forecast. The release file sovereign/global carries everything (the build's defaults in
// check V24); the browser recounts when a threshold, a rule or K changes (lib/sovereign.ts). The server renders the
// title's fixed parts, the source lines through the registry (V17), the past-crises checks and the method tab;
// components/sovereign/SovereignApp.tsx the rest. Ported from global-network's /fiscal-stress on 2 Nov 2026, whose
// 301 keeps the query (e, r1..r7, off, k, y).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { CheckList, DocLinks, ReleaseNotice, Updated } from '@/components/Page';
import { PanelSrc, SrcLink } from '@/components/Src';
import { Kicker, Notice } from '@/components/sn';
import { SovereignApp } from '@/components/sovereign/SovereignApp';
import { GlossBody, GlossProvider, type SrcRef } from '@/components/sovereign/Term';
import { plain, rich } from '@/components/sovereign/rich';
import { manifest, read } from '@/lib/data';
import { day } from '@/lib/format';
import { isLang, t } from '@/lib/i18n';
import { load } from '@/lib/page';
import { pageMeta } from '@/lib/seo';
import { CHECK_IDS, OWN_KEYS, REG, RULES, clientPart, vintageLabel, type RuleId, type Sovereign } from '@/lib/sovereign';
import { sovereign as strings } from '@/lib/strings/sovereign';
import type { Lang } from '@/lib/types';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const PANELS = ['sovereign.fiscal', 'sovereign.external', 'sovereign.market'] as const;
const DATASETS = ['imf.WEO', 'imf.BOP', 'imf.IIP', 'bis.CBS', 'imf.IRFCL', 'fred.observations'];

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  const l: Lang = isLang(lang) ? lang : 'en';
  const S = strings(l);
  let vintage = '', n = 36, span = '';
  try {
    const d = read<Sovereign>(manifest(null), 'sovereign/global');
    if (d) { vintage = vintageLabel(d.meta.vintage, l); n = d.economies.length; span = S.period(d.years[0], d.last_actual, d.proj0, d.years[d.years.length - 1]); }
  } catch { vintage = ''; }
  const title = l === 'ko'
    ? `규칙 일곱 개로 보는 국가 재정 스트레스 신호, ${n}개 경제${vintage ? `(${vintage})` : ''}`
    : `Sovereign stress signals: seven rules, ${n} economies${vintage ? ` (${vintage})` : ''}`;
  const description = `${plain(S.lede)}${vintage ? (l === 'ko' ? ` 자료는 ${vintage} 판입니다.` : ` Data: ${vintage}.`) : ''}${span ? ` ${span}.` : ''}`;
  return pageMeta(l, '/sovereign', { title, description });
}

/** A rule's coverage across the economies: how many have it, the earliest first year, how many it does not apply to, how many have gaps. */
function coverageRows(d: Sovereign) {
  return RULES.map((r) => {
    const rows = d.economies.map((c) => d.coverage[c]?.[r]).filter(Boolean);
    const have = rows.filter((x) => x.first != null && !x.na);
    return { r, have: have.length, first: have.length ? Math.min(...have.map((x) => x.first!)) : null, na: rows.filter((x) => x.na).length, gaps: have.filter((x) => (x.gaps?.length ?? 0) > 0).length };
  });
}

export default async function SovereignPage({ params, searchParams }: Props) {
  const { lang: raw } = await params;
  if (!isLang(raw)) notFound();
  const lang: Lang = raw;
  const ko = lang === 'ko';
  const L = t(lang);
  const S = strings(lang);
  const sp = await searchParams;
  const { m, latest, meta, cites, reg, method, checks } = load(sp);
  const d = read<Sovereign>(m, 'sovereign/global');
  // a release before method 1.5 has no Sovereign section: say so and point at the latest, rather than a 404
  if (!d) {
    return (
      <div className="mf-dash mf-dash--free">
        <div className="mf-dash__title"><Kicker>{S.kicker}</Kicker><h1 className="mf-dash__h1">{S.name}</h1></div>
        <div style={{ marginTop: 16 }}>
          <Notice tone="info" title={ko ? `릴리스 ${m.tag}(${m.date}, 방법론 ${m.method})에는 정부부채 통계가 없습니다. 정부부채 통계는 방법론 1.5부터 포함됩니다.` : `Release ${m.tag} (${m.date}, method ${m.method}) has no Sovereign section; it starts with method 1.5.`}
            action={<a className="sn-link" href={`/${lang}/sovereign`}>{L.viewLatest}</a>} />
        </div>
        <DocLinks lang={lang} />
      </div>
    );
  }
  const g = d.gloss[lang];
  const nm = (c: string) => d.names[c]?.[lang] ?? c;
  const vintage = vintageLabel(d.meta.vintage, lang);
  const span = S.period(d.years[0], d.last_actual, d.proj0, d.years[d.years.length - 1]);
  // the query the app starts from (own keys only; the release is read here, by load)
  const q = new URLSearchParams();
  for (const k of OWN_KEYS) { const v = sp[k]; if (typeof v === 'string' && v) q.set(k, v); }

  // every source a glossary card names, as the client needs it (registry links; V17 makes sure each exists)
  const srcs: Record<string, SrcRef> = {};
  for (const l of ['en', 'ko'] as const) for (const x of Object.values(d.gloss[l])) for (const sref of x.src) {
    const e = reg.links?.[sref.src];
    if (e?.url && !srcs[sref.src]) srcs[sref.src] = { label: e.label[lang], name: e.name[lang], url: e.url };
  }

  const chips = (
    <>{RULES.map((r, i) => <span key={r}>{i ? ' ' : ''}<a className="mf-chip" href={`/${lang}/method#${REG[r]}`}>{REG[r]}</a></span>)}</>
  );
  const checkLinks = <>{CHECK_IDS.map((c, i) => <span key={c}>{i ? ', ' : ''}<a className="mf-chip" href={`/${lang}/checks#${c}`}>{c}</a></span>)}</>;
  // the three rule panels' links, each source once (IMF WEO serves the fiscal and the external rules); V17 checks the panels
  const ruleSrcIds = [...new Set(PANELS.flatMap((p) => reg.panels?.[p]?.links ?? []))];
  const footRules = (
    <>{L.source}{ruleSrcIds.length ? ruleSrcIds.map((id, i) => <span key={id}>{i ? '; ' : ''}<SrcLink reg={reg} id={id} lang={lang} /></span>) : <PanelSrc reg={reg} panel={PANELS[0]} lang={lang} />}. {L.calculations}, {L.method} {meta.method}: {ko ? '규칙' : 'rules'} {chips}, {ko ? '점검' : 'checks'} {checkLinks}.</>
  );
  const footEpisodes = <>{L.source}<PanelSrc reg={reg} panel="sovereign.episodes" lang={lang} />. {ko ? '사례는 config/sovereign_episodes.yaml에 손으로 확인해 적었습니다. 사례마다 출처가 하나씩 있습니다.' : 'Episodes are hand-checked in config/sovereign_episodes.yaml, one source each.'}</>;

  // the release's own checks on this section (V24 hit and false-signal rates, V25 AUROC, V26 expectations)
  const relChecks = (checks?.results ?? []).filter((r) => CHECK_IDS.includes(r.id)).map((r) => ({ status: r.status, label: r.id, text: `${r.name[lang]}. ${r.summary}` }));

  const steps = (
    <ol className="mf-sov-steps">
      {S.steps.map((st) => (<li key={st.h}><h4 className="mf-sov-h3">{st.h}</h4><p>{rich(st.p)}</p><p className="mf-note">{rich(st.rules)}</p></li>))}
    </ol>
  );
  const cannot = (
    <Notice tone="info" title={S.cannotTitle}>
      <ul className="mf-sov-cannot">{S.cannot.map((c, i) => (<li key={i}>{rich(c)}</li>))}</ul>
      <p className="mf-note" style={{ margin: '6px 0 0' }}>{rich(S.vintageNote)}</p>
    </Notice>
  );
  const help = (
    <details className="mf-howto mf-sov-help">
      <summary>{S.helpBtn}</summary>
      <h3 className="mf-sov-h">{S.stepsTitle}</h3>
      {steps}
      {cannot}
      <p className="mf-note" style={{ margin: '8px 0 0' }}>{rich(S.howToRead)}</p>
    </details>
  );

  const backtest = (
    <>
      <h3 className="mf-sov-h">{S.checksTitle}</h3>
      <p className="mf-note">{S.checksLede}</p>
      <div className="sn-table-wrap" tabIndex={0}>
        <table className="sn-table sn-table--dense">
          <tbody>
            {d.checks.map((c) => (
              <tr key={c.id}>
                <th scope="row">{lang === 'ko' ? c.ko : c.en}{c.id === 'kor-1996' && !c.ok && <p className="mf-note" style={{ margin: '4px 0 0', fontWeight: 400 }}>{S.kor1996}</p>}</th>
                <td className="mf-mono">{c.rows.map((r) => `${r.y}: ${r.k}/${r.n}${r.on.length ? ` (${r.on.map((x) => x.toUpperCase()).join(', ')})` : ''}`).join(' · ')}</td>
                <td><span className={`mf-sov-pill mf-sov-pill--${c.ok ? 'good' : 'warn'}`}>{c.ok ? S.pass : S.fail}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="mf-sov-h">{S.releaseChecks}</h3>
      <CheckList lang={lang} checks={relChecks} />
    </>
  );

  const cov = coverageRows(d);
  const regRule = (r: RuleId) => method.rules[REG[r]];
  const sources = (
    <ul className="mf-sov-srcs">
      {(['fiscal', 'external', 'market'] as const).map((grp) => <li key={grp}><b>{S.sourceGroups[grp]}</b><span><PanelSrc reg={reg} panel={`sovereign.${grp}`} lang={lang} /></span></li>)}
      <li><b>{S.sourceGroups.episodes}</b><span><PanelSrc reg={reg} panel="sovereign.episodes" lang={lang} /></span></li>
    </ul>
  );
  const methodTab = (
    <>
      <h2 className="mf-sov-h2">{S.stepsTitle}</h2>
      {steps}
      {cannot}
      <h2 className="mf-sov-h2">{S.ruleDefsTitle}</h2>
      <p className="mf-note">{S.ruleDefsLede} {rich(S.howToRead)}</p>
      <div className="sn-table-wrap" tabIndex={0}>
        <table className="sn-table sn-table--dense mf-sov-defs">
          <thead><tr><th scope="col">{S.ruleDefCols.rule}</th><th scope="col">{S.ruleDefCols.what}</th><th scope="col">{S.ruleDefCols.calc}</th><th scope="col">{S.ruleDefCols.thr}</th><th scope="col">{S.ruleDefCols.registry}</th></tr></thead>
          <tbody>
            {RULES.map((r) => {
              const x = g[`w_${r}`];
              const rr = regRule(r);
              return (
                <tr key={r}>
                  <th scope="row"><span className="mf-sov-defs__name">{`${r.toUpperCase()} ${S.ruleShort[r]}`}</span><div className="mf-note" style={{ margin: 0, fontWeight: 400 }}>{S.groups[d.rules[r].group]} · {S.unitPlain[d.rules[r].unit]}</div></th>
                  <td>{x?.what}{x?.why && <div className="mf-note" style={{ margin: '4px 0 0' }}>{x.why}</div>}</td>
                  <td>{x?.calc}{x?.formula && <code className="mf-sov-gloss__formula">{x.formula}</code>}</td>
                  <td>{x?.thr}</td>
                  <td><a className="mf-chip" href={`/${lang}/method#${REG[r]}`}>{REG[r]}</a>{rr ? <div className="mf-note" style={{ margin: '4px 0 0' }}>{rr.name[lang]}</div> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h2 className="mf-sov-h2">{S.registryTitle} · {L.method} {method.version}</h2>
      <dl className="mf-sov-reg">
        {RULES.map((r) => { const rr = regRule(r); return rr ? <div key={r}><dt><a className="mf-chip" href={`/${lang}/method#${REG[r]}`}>{REG[r]}</a> {rr.name[lang]}</dt><dd>{rr[lang]}</dd></div> : null; })}
      </dl>
      <p className="mf-note">{S.boardNote}</p>
      <h2 className="mf-sov-h2">{L.checks}</h2>
      <CheckList lang={lang} checks={relChecks} />
      <h2 className="mf-sov-h2">{S.coverageTitle}</h2>
      <p className="mf-note">{S.coverageLede} {S.gaps(nm('KOR'))}</p>
      <div className="sn-table-wrap" tabIndex={0}>
        <table className="sn-table sn-table--dense">
          <thead><tr><th scope="col">{S.covCols.rule}</th><th scope="col" className="is-num">{S.covCols.have}</th><th scope="col" className="is-num">{S.covCols.first}</th><th scope="col" className="is-num">{S.covCols.na}</th><th scope="col" className="is-num">{S.covCols.gaps}</th></tr></thead>
          <tbody>{cov.map((c) => <tr key={c.r}><th scope="row">{c.r.toUpperCase()} {S.ruleShort[c.r]}</th><td className="is-num">{c.have} / {d.economies.length}</td><td className="is-num">{c.first ?? '–'}</td><td className="is-num">{c.na}</td><td className="is-num">{c.gaps}</td></tr>)}</tbody>
        </table>
      </div>
      <h2 className="mf-sov-h2">{S.sourcesTitle}</h2>
      {sources}
      <p className="mf-note">{span}; {S.published(day(d.meta.published, lang))}. {S.calc}</p>
      <h2 className="mf-sov-h2">{S.glossTitle}</h2>
      <p className="mf-note">{S.glossLede}</p>
      <div className="mf-sov-glosslist">
        {Object.entries(g).map(([id, x]) => (
          <article key={id} id={`gloss-${id}`} className="mf-sov-glosscard"><h3 className="mf-sov-h3">{x.term}</h3><GlossBody g={x} lang={lang} srcs={srcs} /></article>
        ))}
      </div>
      <DocLinks lang={lang} />
    </>
  );

  const dsCites = DATASETS.map((ds) => ({ name: ds, text: cites.datasets[ds]?.[lang]?.text ?? '', bibtex: cites.datasets[ds]?.[lang]?.bibtex ?? '' })).filter((x) => x.text);
  const dsNames = DATASETS.map((ds) => (ds === 'fred.observations' ? (ko ? 'OECD 장기금리(FRED)' : 'OECD long-term rates via FRED') : reg.datasets[ds]?.short ?? ds));
  const updated: ReactNode = <Updated m={m} lang={lang} />;
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Dataset', name: ko ? '국가 재정 스트레스 신호' : 'Sovereign stress signals', creator: { '@type': 'Organization', name: 'datasteg' },
    version: m.tag, url: `https://money-flow.datasteg.com/${lang}/sovereign?r=${m.tag}`, dateModified: m.date, license: `https://money-flow.datasteg.com/${lang}/sources#licences`,
    isBasedOn: DATASETS.map((ds) => reg.datasets[ds]?.landing).filter(Boolean),
  };
  return (
    <GlossProvider lang={lang} gloss={g} srcs={srcs}>
      <SovereignApp data={clientPart(d)} lang={lang} search={q.toString()} vintage={vintage} updated={updated}
        release={{ tag: m.tag, date: m.date, method: meta.method, label: L.release, methodLabel: L.method }}
        cite={{ labels: { title: L.citeView, copy: L.copy, copied: L.copied, note: L.figureNote, bibtex: L.bibtex, ris: L.ris, datasets: L.datasetsCite, method: L.methodCite }, datasets: dsCites, method: cites.method[lang], names: dsNames, button: L.cite }}
        notice={<ReleaseNotice m={m} latest={latest} lang={lang} href={`/${lang}/sovereign`} />}
        help={help} footRules={footRules} footEpisodes={footEpisodes} backtest={backtest} method={methodTab} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </GlossProvider>
  );
}
