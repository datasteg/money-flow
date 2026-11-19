import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MethodBody } from '@/components/MethodBody';
import { DocLinks } from '@/components/Page';
import { Kicker } from '@/components/sn';
import { CopyButton, DownloadText } from '@/components/sn/client';
import { read } from '@/lib/data';
import { isLang, name, t } from '@/lib/i18n';
import { pageMeta } from '@/lib/seo';
import { manifest } from '@/lib/data';
import { load } from '@/lib/page';
import type { Econ, Lang } from '@/lib/types';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params;
  const l: Lang = isLang(lang) ? lang : 'en';
  let tag = '';
  try { const m = manifest(null); tag = `${m.tag} (${m.date})`; } catch { tag = ''; }
  const title = l === 'ko' ? '수치를 만드는 규칙(방법론)' : 'Method: the rules that make every number';
  const description = (l === 'ko' ? 'datasteg money-flow의 모든 규칙과 점검을 한 등록부에 모아 나타냅니다. 근거 논문과 현재 릴리스에서 규칙별 효과를 함께 적습니다.' : 'Every rule and check of datasteg money-flow, from one registry, with the papers behind them and the effect of each rule in the current release.') + (tag ? (l === 'ko' ? ` 현재 릴리스 ${tag}.` : ` Current release ${tag}.`) : '');
  return pageMeta(l, '/method', { title, description });
}

const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen', 'Twenty', 'Twenty-one', 'Twenty-two', 'Twenty-three', 'Twenty-four', 'Twenty-five'];
const words = (n: number) => WORDS[n] ?? String(n);

export default async function MethodPage({ params, searchParams }: Props) {
  const { lang: raw } = await params;
  if (!isLang(raw)) notFound();
  const lang: Lang = raw;
  const L = t(lang);
  const { m, method, cites, reg, meta } = load(await searchParams);
  const korea = read<Econ>(m, 'econ/KOR');
  const nRules = Object.keys(method.rules).length, nChecks = Object.keys(method.checks).length;
  const c = cites.method[lang];
  return (
    <div className="mf-shell">
      <Kicker>{`${L.methodTitle} · ${lang === 'ko' ? '버전' : 'version'} ${method.version}`}</Kicker>
      <h1 className="mf-title">{lang === 'ko' ? `수치를 만드는 규칙 ${nRules}개와 점검 ${nChecks}개` : `${words(nRules)} rules make every number; ${words(nChecks).toLowerCase()} checks test them`}</h1>
      <p className="mf-statusline">{lang === 'ko' ? `방법론 ${method.version}, ${method.date} · 이 쪽의 규칙별 효과는 릴리스 ${m.tag}에서 코드가 기록한 값입니다` : `Method ${method.version}, ${method.date} · the effect counts below were written by the code for release ${m.tag}`}</p>
      <div className="mf-prose" style={{ marginTop: 16 }}>
        <p>{lang === 'ko'
          ? '규칙 문장과 코드는 한 레지스트리(config/method.yaml)에서 나옵니다. 규칙에 구현 함수나 테스트가 없거나, 함수가 등록되지 않은 규칙을 가리키면 빌드가 멈춥니다. 규칙이 바뀌면 방법론 버전이 오르고, 모든 릴리스와 인용이 그 버전을 기록합니다.'
          : 'The rule text and the code come from one registry, config/method.yaml. The build stops when a rule has no implementing function or no test, or a function names a rule that is not registered. Changing a rule raises the method version, and every release and citation records it.'}</p>
      </div>
      <section className="mf-cite" id="cite">
        <h2 className="mf-h2">{L.methodCite}</h2>
        <p className="mf-cite__text">{c.text}</p>
        <div className="mf-cite__tools">
          <CopyButton text={c.text} label={L.copy} done={L.copied} />
          <DownloadText text={c.bibtex} filename={`datasteg-mf-method-${method.version}.bib`} label="BibTeX" />
          <DownloadText text={c.ris} filename={`datasteg-mf-method-${method.version}.ris`} label="RIS" />
          <a className="sn-btn sn-btn--secondary sn-btn--sm" href={`/method/money-flow-method-${method.version}-${lang}.pdf`}>PDF</a>
          <a className="sn-btn sn-btn--quiet sn-btn--sm" href={`/${lang}/method/print`}>{lang === 'ko' ? '인쇄판' : 'Print edition'}</a>
        </div>
      </section>
      <MethodBody method={method} lang={lang} korea={korea} release={m.tag} reg={reg} names={(c) => name(meta.economies, c, lang)} />
      <DocLinks lang={lang} />
    </div>
  );
}
