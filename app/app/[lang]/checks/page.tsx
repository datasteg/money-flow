// The Checks page: every check with its tolerance, the observed value and what it found in this
// release, then the history across releases.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocLinks } from '@/components/Page';
import { Kicker, Status } from '@/components/sn';
import { releases } from '@/lib/data';
import { isLang, t } from '@/lib/i18n';
import { pageMeta } from '@/lib/seo';
import { manifest } from '@/lib/data';
import { load } from '@/lib/page';
import type { Lang } from '@/lib/types';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  const l: Lang = isLang(lang) ? lang : 'en';
  let tag = '';
  try { const m = manifest(null); tag = `${m.tag} (${m.date})`; } catch { tag = ''; }
  const title = l === 'ko' ? '릴리스 통과·경고 점검' : 'Checks: what the release passed, warned and noted';
  const description = (l === 'ko' ? 'money-flow 현재 릴리스의 모든 점검을 허용 범위, 관측값, 발견 사항과 함께 표시하고 릴리스별 이력을 싣습니다.' : 'Every check on the current release of money-flow with its tolerance, the observed value and its findings, and the history across releases.') + (tag ? (l === 'ko' ? ` 현재 릴리스 ${tag}.` : ` Current release ${tag}.`) : '');
  return pageMeta(l, '/checks', { title, description });
}

function Details({ rows }: { rows: unknown[] }) {
  if (!rows.length) return null;
  const objs = rows.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && !Array.isArray(r));
  if (!objs.length) return <ul className="mf-list">{rows.map((r, i) => <li key={i} className="mf-mono">{String(r)}</li>)}</ul>;
  const cols = [...new Set(objs.flatMap((o) => Object.keys(o)))].slice(0, 12);
  return (
    <div className="sn-table-wrap" tabIndex={0}>
      <table className="sn-table sn-table--dense">
        <thead><tr>{cols.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>{objs.map((o, i) => <tr key={i}>{cols.map((c) => <td key={c}>{typeof o[c] === 'object' ? JSON.stringify(o[c]) : String(o[c] ?? '')}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default async function ChecksPage({ params, searchParams }: Props) {
  const { lang: raw } = await params;
  if (!isLang(raw)) notFound();
  const lang: Lang = raw;
  const L = t(lang);
  const { m, checks } = load(await searchParams);
  const hist = releases();
  return (
    <div className="mf-shell">
      <Kicker>{`${L.checksTitle} · ${L.release} ${m.tag}`}</Kicker>
      <h1 className="mf-title">{lang === 'ko'
        ? `점검 ${checks?.results.length ?? 0}개: 통과 ${checks?.summary.pass ?? 0}, 경고 ${checks?.summary.warning ?? 0}, 참고 ${checks?.summary.info ?? 0}`
        : `${checks?.results.length ?? 0} checks: ${checks?.summary.pass ?? 0} pass, ${checks?.summary.warning ?? 0} warn, ${checks?.summary.info ?? 0} for information`}</h1>
      <p className="mf-statusline">{lang === 'ko' ? '차단 등급 점검이 하나라도 실패하면 릴리스가 나가지 않습니다. 그래서 공개된 릴리스에는 통과, 경고, 참고만 있습니다.' : 'A blocking check that fails stops the release, so a published release shows only passes, warnings and information.'}</p>
      <div className="mf-rules" style={{ marginTop: 24 }}>
        {checks?.results.map((r) => (
          <article className="mf-rule" key={r.id} id={r.id}>
            <div className="mf-rule__head"><span className="mf-rule__id">{r.id}</span><span className="mf-rule__name">{r.name[lang] || r.name.en}</span><Status status={r.status} labels={L} />
              <span className="mf-muted">{lang === 'ko' ? '허용 범위' : 'tolerance'} {r.tolerance} · {r.severity}</span></div>
            <p>{r.summary}</p>
            {r.by_economy ? <p className="mf-note">{lang === 'ko' ? '경제별 건수 ' : 'By economy: '}{Object.entries(r.by_economy).slice(0, 30).map(([e, n]) => `${e} ${n}`).join(', ')}{Object.keys(r.by_economy).length > 30 ? ' …' : ''}</p> : null}
            {r.n_details ? <details className="mf-fold"><summary>{lang === 'ko' ? `세부 ${r.n_details}건` : `${r.n_details} details`}{r.n_details > r.details.length ? (lang === 'ko' ? ` (앞 ${r.details.length}건)` : ` (first ${r.details.length})`) : ''}</summary><Details rows={r.details} /></details> : null}
          </article>
        ))}
      </div>
      <h2 className="mf-h2">{lang === 'ko' ? '릴리스별 이력' : 'History across releases'}</h2>
      <div className="sn-table-wrap" tabIndex={0}>
        <table className="sn-table sn-table--dense">
          <thead><tr><th scope="col">{L.release}</th><th scope="col">{lang === 'ko' ? '날짜' : 'Date'}</th><th scope="col" className="is-num">{L.pass}</th><th scope="col" className="is-num">{L.warning}</th><th scope="col" className="is-num">{L.info}</th><th scope="col" className="is-num">{L.fail}</th></tr></thead>
          <tbody>{hist.map((h) => <tr key={h.tag}><th scope="row"><a className="sn-link" href={`/${lang}/checks?r=${h.tag}`}>{h.tag}</a></th><td>{h.date}</td><td className="is-num">{h.checks.pass}</td><td className="is-num">{h.checks.warning}</td><td className="is-num">{h.checks.info}</td><td className="is-num">{h.checks.fail}</td></tr>)}</tbody>
        </table>
      </div>
      <DocLinks lang={lang} />
    </div>
  );
}
