// The Releases page: every release kept for good, with its method, the vintages that changed and
// its checks. A permalink with ?r=<tag> shows a release's own numbers.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocLinks } from '@/components/Page';
import { Kicker } from '@/components/sn';
import { releases } from '@/lib/data';
import { kst } from '@/lib/format';
import { isLang, t } from '@/lib/i18n';
import { pageMeta } from '@/lib/seo';
import { manifest } from '@/lib/data';
import type { Lang } from '@/lib/types';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ lang: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  const l: Lang = isLang(lang) ? lang : 'en';
  let tag = '';
  try { const m = manifest(null); tag = `${m.tag} (${m.date})`; } catch { tag = ''; }
  const title = l === 'ko' ? '릴리스: 모든 빌드, 영구 주소' : 'Releases: every build of the data, at a permanent address';
  const description = (l === 'ko' ? 'money-flow 자료의 모든 릴리스를 방법론 버전, 바뀐 판, 점검 요약과 함께 싣습니다. 릴리스마다 태그로 인용할 수 있습니다.' : "Every release of money-flow's data with its method version, the vintages that changed and its check summary; each stays citable by tag.") + (tag ? (l === 'ko' ? ` 현재 릴리스 ${tag}.` : ` Current release ${tag}.`) : '');
  return pageMeta(l, '/releases', { title, description });
}

export default async function ReleasesPage({ params }: Props) {
  const { lang: raw } = await params;
  if (!isLang(raw)) notFound();
  const lang: Lang = raw;
  const L = t(lang);
  const rows = releases();
  return (
    <div className="mf-shell">
      <Kicker>{L.releasesTitle}</Kicker>
      <h1 className="mf-title">{lang === 'ko' ? `릴리스 ${rows.length}개, 모두 영구 주소로 남습니다` : `${rows.length} releases, each at a permanent address`}</h1>
      <div className="mf-prose" style={{ marginTop: 12 }}>
        <p>{lang === 'ko'
          ? '자료가 바뀐 판본은 모두 릴리스가 됩니다. 릴리스에는 방법론 버전, 원자료마다 쓴 판과 파일 해시, 점검 요약, 사이트 파일 해시가 담깁니다. 파일은 내용 해시로 저장되므로 바뀌지 않은 파일은 추가 공간을 쓰지 않습니다. 릴리스는 지우지 않습니다.'
          : 'Every build whose data changed is a release. Its manifest records the method version, each dataset’s vintage and file hash, the check summary and the hash of every site file. Files are stored by content hash, so an unchanged file costs nothing. Releases are never deleted.'}</p>
      </div>
      <div className="sn-table-wrap" tabIndex={0} style={{ marginTop: 16 }}>
        <table className="sn-table sn-table--dense">
          <thead><tr><th scope="col">{L.release}</th><th scope="col">{lang === 'ko' ? '빌드' : 'Built'}</th><th scope="col">{L.method}</th><th scope="col">{lang === 'ko' ? '코드' : 'Code'}</th><th scope="col" className="is-num">{lang === 'ko' ? '바뀐 파일' : 'Files changed'}</th><th scope="col">{L.checks}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.tag} id={r.tag}>
              <th scope="row"><a className="sn-link" href={`/${lang}?r=${r.tag}`}>{r.tag}</a></th>
              <td>{kst(r.built, lang)}</td><td>{r.method}</td><td className="mf-mono">{r.code}</td><td className="is-num">{r.changed.length}</td>
              <td>{L.pass} {r.checks.pass} · {L.warning} {r.checks.warning} · {L.info} {r.checks.info}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <DocLinks lang={lang} />
    </div>
  );
}
