// The print edition of the method (M14): the same body, no navigation, for a PDF per method version.
import { notFound } from 'next/navigation';
import { MethodBody } from '@/components/MethodBody';
import { read } from '@/lib/data';
import { isLang, name } from '@/lib/i18n';
import { load } from '@/lib/page';
import type { Econ, Lang } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function MethodPrint({ params, searchParams }: { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { lang: raw } = await params;
  if (!isLang(raw)) notFound();
  const lang: Lang = raw;
  const { m, method, cites, reg, meta } = load(await searchParams);
  return (
    <div className="mf-shell mf-print">
      <p className="sn-kicker">datasteg money-flow</p>
      <h1 className="mf-title">{lang === 'ko' ? `money-flow 방법론, 버전 ${method.version}` : `Money-flow methodology, version ${method.version}`}</h1>
      <p className="mf-statusline">{method.date} · {lang === 'ko' ? '릴리스' : 'release'} {m.tag}</p>
      <p className="mf-cite__text" style={{ marginTop: 12 }}>{cites.method[lang].text}</p>
      <MethodBody method={method} lang={lang} korea={read<Econ>(m, 'econ/KOR')} release={m.tag} reg={reg} names={(c) => name(meta.economies, c, lang)} />
    </div>
  );
}
