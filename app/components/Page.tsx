// Pieces every data page shares: the title block, the notice for a release that is not the latest, and the "This view" panel.
import { Notice, Status, StatTile } from './sn';
import { kst, pct } from '@/lib/format';
import { name, t } from '@/lib/i18n';
import { DsLink } from './Src';
import type { Lang, Manifest, SourcesRegistry } from '@/lib/types';

export function ReleaseNotice({ m, latest, lang, href }: { m: Manifest; latest: string; lang: Lang; href: string }) {
  if (m.tag === latest) return null;
  const L = t(lang);
  return (
    <div style={{ marginTop: 16 }}>
      <Notice tone="info" title={L.notLatest(m.tag, m.date, latest)} action={<a className="sn-link" href={href}>{L.viewLatest}</a>} />
    </div>
  );
}

export function Updated({ m, lang }: { m: Manifest; lang: Lang }) {
  return <>{lang === 'ko' ? '갱신' : 'Updated'} {kst(m.built, lang)}</>;
}

export function Kpis({ items }: { items: { label: string; value: string; unit: string; sub: string }[] }) {
  return <ul className="mf-kpis">{items.map((k) => <li key={k.label}><StatTile label={k.label} value={k.value} unit={k.unit} sub={k.sub} /></li>)}</ul>;
}

type Cov = { label: string; cov: number | null; text: string };
type Src = { ds: string; label: string; freq: string; newest: string };
type Chk = { status: string; label: string; text: string };

/** The pieces of "This view", one per rail section on the dashboards. */
export function CoverageList({ lang, coverage }: { lang: Lang; coverage: Cov[] }) {
  return <>{coverage.map((c) => (
    <div className="mf-cov" key={c.label}>
      <div className="mf-cov__head"><span>{c.label}</span><span className="mf-cov__value">{c.cov == null ? '–' : pct(c.cov, lang)}</span></div>
      <div className="mf-cov__bar" aria-hidden><span style={{ width: `${Math.min(100, Math.max(0, c.cov ?? 0))}%` }} /></div>
      <p className="mf-note" style={{ margin: '2px 0 0' }}>{c.text}</p>
    </div>
  ))}</>;
}

export function SourceList({ sources, reg, lang }: { sources: Src[]; reg?: SourcesRegistry; lang?: Lang }) {
  return (
    <ul className="mf-src">
      {sources.map((s) => <li key={s.ds} style={{ display: 'contents' }}><b>{s.freq}</b><span>{reg && lang ? <DsLink reg={reg} ds={s.ds} lang={lang}>{s.label}</DsLink> : s.label}</span><time>{s.newest?.slice(0, 7)}</time></li>)}
    </ul>
  );
}

export function RuleChips({ rules, methodHref }: { rules: string[]; methodHref: string }) {
  return <ul className="mf-chips" data-chiprow>{rules.map((r) => <li key={r}><a className="mf-chip" href={`${methodHref}#${r}`}>{r}</a></li>)}</ul>;
}

export function CheckList({ lang, checks }: { lang: Lang; checks: Chk[] }) {
  const L = t(lang);
  return (
    <ul className="mf-checks">
      {checks.map((c, i) => <li key={i}><Status status={c.status} labels={L} /><span className="mf-mono">{c.label}</span><span>{c.text}</span></li>)}
    </ul>
  );
}

export function ThisView({ lang, coverage, sources, rules, checks, methodHref }: {
  lang: Lang; coverage: Cov[]; sources: Src[]; rules: string[]; checks: Chk[]; methodHref: string;
}) {
  const L = t(lang);
  return (
    <div className="mf-thisview">
      <h3>{L.coverage}</h3>
      <CoverageList lang={lang} coverage={coverage} />
      <h3>{L.sources}</h3>
      <SourceList sources={sources} />
      <h3>{L.rulesApplied}</h3>
      <RuleChips rules={rules} methodHref={methodHref} />
      <h3>{L.checks}</h3>
      <CheckList lang={lang} checks={checks} />
    </div>
  );
}

export { name };

/** One line of links to the reference pages: on the dashboards it sits under the panel, on the reference pages at the end. */
export function DocLinks({ lang }: { lang: Lang }) {
  const L = t(lang);
  return (
    <nav className="mf-doclinks" aria-label={lang === 'ko' ? '자료와 방법' : 'About the data'}>
      <a href={`/${lang}/method`}>{L.nav.method}</a><a href={`/${lang}/sources`}>{L.nav.sources}</a>
      <a href={`/${lang}/checks`}>{L.nav.checks}</a><a href={`/${lang}/releases`}>{L.nav.releases}</a>
      <span className="mf-muted">money-flow.datasteg.com · datasteg</span>
    </nav>
  );
}
