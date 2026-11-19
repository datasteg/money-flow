// The Sources page: one card per dataset with its publisher, licence class, vintage, newest period,
// the publisher's terms and the citation; then what is not shown and why, and the licence classes.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocLinks } from '@/components/Page';
import { Kicker, PaperCard } from '@/components/sn';
import { DownloadText } from '@/components/sn/client';
import { SrcLink } from '@/components/Src';
import { day } from '@/lib/format';
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
  const title = l === 'ko' ? '원자료와 발표기관, 판' : 'Sources: every dataset, its publisher and vintage';
  const description = (l === 'ko' ? 'money-flow는 money-flow가 쓰는 BIS, IMF, 중앙은행 원자료를 발표기관, 라이선스 등급, 판, 최신 기간, 인용과 함께 싣습니다. 보이지 않는 자료와 그 이유도 적습니다.' : 'The datasets behind money-flow (BIS, IMF, central banks), each with its publisher, licence class, vintage, newest period and citation, and what is not shown and why.') + (tag ? (l === 'ko' ? ` 현재 릴리스 ${tag}.` : ` Current release ${tag}.`) : '');
  return pageMeta(l, '/sources', { title, description });
}

export default async function SourcesPage({ params, searchParams }: Props) {
  const { lang: raw } = await params;
  if (!isLang(raw)) notFound();
  const lang: Lang = raw;
  const L = t(lang);
  const { m, meta, reg, cites } = load(await searchParams);
  const shown = Object.entries(reg.datasets).filter(([ds, e]) => !e.planned && reg.classes[e.class]?.shown && meta.datasets[ds]);
  const hidden = Object.entries(reg.datasets).filter(([, e]) => e.planned || !reg.classes[e.class]?.shown);
  const overrides = Object.entries(reg.datasets).flatMap(([ds, e]) => Object.entries(e.keys ?? {}).filter(([, o]) => o.class && !reg.classes[o.class]?.shown).map(([k, o]) => ({ ds, k, o })));
  const allBib = Object.values(cites.datasets).map((c) => c[lang].bibtex).join('\n\n');
  return (
    <div className="mf-shell">
      <Kicker>{`${L.sourcesTitle} · ${L.release} ${m.tag}`}</Kicker>
      <h1 className="mf-title">{lang === 'ko' ? `원자료 ${shown.length}종, 모두 출처와 판을 밝힙니다` : `${shown.length} datasets, each with its publisher and vintage`}</h1>
      <div className="mf-prose" style={{ marginTop: 12 }}>
        <p>{lang === 'ko'
          ? '이 사이트는 원자료를 재게시하지 않습니다. 방법론의 규칙으로 만든 값만 그리고, 값마다 출처 자료와 판, 발표기관 쪽 주소를 가리킵니다. 계열이 필요하면 발표기관에서 받을 수 있습니다.'
          : 'The site never shows raw data. It draws only marks the method builds, and points each one to its dataset, the vintage used and the publisher’s own page. A reader who needs the series gets it from its publisher.'}</p>
      </div>
      <p><DownloadText text={allBib} filename={`datasteg-mf-sources-${m.tag}.bib`} label={lang === 'ko' ? '모든 원자료 BibTeX' : 'BibTeX for every dataset'} /></p>
      <div className="mf-cards" style={{ marginTop: 16 }}>
        {shown.map(([ds, e]) => {
          const pub = reg.publishers[e.publisher];
          const md = meta.datasets[ds];
          return (
            <PaperCard key={ds} label={`${reg.classes[e.class]?.[lang]} · ${ds}`} title={lang === 'ko' ? e.ko : e.en} href={e.landing} authors={lang === 'ko' ? pub?.ko : pub?.en} journal={e.short} lang={lang}
              facts={[
                { label: lang === 'ko' ? '사용한 판' : 'Vintage used', value: day(md?.vintage, lang) },
                { label: lang === 'ko' ? '최신 기간' : 'Newest period', value: md?.newest ?? '–' },
                { label: lang === 'ko' ? '주기' : 'Cadence', value: e.cadence },
                { label: lang === 'ko' ? '이용 조건' : 'Terms', value: <><a className="sn-link" href={pub?.terms} target="_blank" rel="noopener">{lang === 'ko' ? '발표기관 조건' : "Publisher's terms"}</a>. {pub?.terms_note}</> },
                ...(e.keys ? [{ label: lang === 'ko' ? '계열별 예외' : 'Series exceptions', value: Object.entries(e.keys).map(([k, o]) => `${k}: ${o.note ?? o.class}`).join('; ') }] : []),
                { label: lang === 'ko' ? '인용' : 'Cite', value: cites.datasets[ds]?.[lang]?.text ?? '–' },
              ]} />
          );
        })}
      </div>

      <h2 className="mf-h2" id="links">{lang === 'ko' ? '페이지가 밝히는 출처와 그 링크' : 'Sources named on the pages, with their links'}</h2>
      <p className="mf-note">{lang === 'ko'
        ? '세계와 시장 화면의 출처 표시는 모두 이 등록부(config/sources.yaml)에서 만든 링크입니다. 같은 항목을 여기에 싣고 그 항목을 쓰는 패널을 적습니다. 등록부에 없는 출처를 패널이 쓰면 점검 V17이 릴리스를 막습니다.'
        : 'Every source label on the World and Markets pages is a link built from this registry (config/sources.yaml). The same entries are listed here with the panels that use them. A panel naming a source the registry lacks stops the release (check V17).'}</p>
      <div className="sn-table-wrap" tabIndex={0}>
        <table className="sn-table sn-table--dense mf-linktable">
          <thead><tr>
            <th scope="col">{lang === 'ko' ? '자료' : 'Source'}</th><th scope="col">{lang === 'ko' ? '발표기관 · 코드' : 'Publisher · code'}</th>
            <th scope="col">{lang === 'ko' ? '주기' : 'Frequency'}</th><th scope="col">{lang === 'ko' ? '확인일' : 'Last checked'}</th><th scope="col">{lang === 'ko' ? '쓰는 패널' : 'Used by'}</th>
          </tr></thead>
          <tbody>{Object.entries(reg.links ?? {}).map(([id, e]) => {
            const used = Object.entries(reg.panels ?? {}).filter(([, p]) => p.links.includes(id));
            return (
              <tr key={id} id={`src-${id}`}>
                <th scope="row"><SrcLink reg={reg} id={id} lang={lang}>{e.name[lang]}</SrcLink><br /><span className="mf-muted mf-mono">{id}</span></th>
                <td>{e.publisher ? reg.publishers[e.publisher]?.short ?? e.publisher : '–'}{e.code ? ` · ${e.code}` : ''}</td>
                <td>{e.cadence[lang]}</td><td>{day(e.checked, lang)}</td>
                <td>{used.length ? used.map(([pid, p]) => <span key={pid} className="mf-usedby">{p[lang]}</span>) : '–'}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>

      <h2 className="mf-h2" id="hidden">{lang === 'ko' ? '보이지 않는 자료와 그 이유' : 'What is not shown, and why'}</h2>
      <ul className="mf-notes">
        {hidden.map(([ds, e]) => <li key={ds}><b>{lang === 'ko' ? e.ko : e.en} ({reg.publishers[e.publisher]?.[lang]}).</b> {e.planned ? (lang === 'ko' ? '계획된 일간 자료입니다. 조건은 확인했고 아직 수집하지 않습니다.' : 'A planned daily source; its terms were read, it is not yet collected.') : reg.classes[e.class]?.[lang]}. {reg.publishers[e.publisher]?.terms_note}</li>)}
        {overrides.map(({ ds, k, o }) => <li key={k}><b>{k} ({ds}).</b> {reg.classes[o.class!]?.[lang]}. {o.note}</li>)}
        <li><b>{lang === 'ko' ? '상업 자료(펀드 자금흐름·시장 데이터 공급사).' : 'Commercial data (fund-flow and market-data vendors).'}</b> {reg.classes.licensed[lang]}. {lang === 'ko' ? '집계치로도 공표하지 않습니다(R14).' : 'Not published in any form, not even as aggregates (R14).'}</li>
      </ul>

      <h2 className="mf-h2" id="licences">{lang === 'ko' ? '라이선스 등급' : 'Licence classes'}</h2>
      <ul className="mf-notes">
        {Object.entries(reg.classes).map(([c, v]) => <li key={c}><b>{c}.</b> {v[lang]} · {lang === 'ko' ? '표시' : 'shown'}: {v.shown ? '✓' : '—'} · CSV: {v.csv ? '✓' : '—'}</li>)}
      </ul>
      <div className="mf-prose">
        <p>{lang === 'ko'
          ? '이 사이트의 모든 수치는 공식 통계나 공개 자료에서 나옵니다. 상업 자료는 집계치로도 싣지 않습니다. 검증 V11이 공개 파일마다 공급사 이름과 펀드 단위 필드를 찾습니다(R14).'
          : 'Every figure on this site comes from an official or open source. Commercial data are not published in any form, not even as aggregates; check V11 scans every public file for a vendor name or a fund-level field (R14).'}</p>
      </div>
      <DocLinks lang={lang} />
    </div>
  );
}
