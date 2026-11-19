// The landing page is the Economy tab: the economy last viewed in this browser (the mf_econ cookie, written by the
// economy page), else Korea on /ko and the United States on /en. The day and release in the query are kept.
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { manifest, meta as readMeta } from '@/lib/data';
import { isLang } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Landing({ params, searchParams }: Props) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const sp = await searchParams;
  const meta = readMeta(manifest(null));
  const saved = (await cookies()).get('mf_econ')?.value?.toUpperCase();
  const code = saved && meta.economies[saved]?.page ? saved : lang === 'ko' ? 'KOR' : 'USA';
  const q = new URLSearchParams();
  for (const k of ['d', 'r', 'dir']) { const v = sp[k]; if (typeof v === 'string' && v) q.set(k, v); }
  redirect(`/${lang}/e/${code}${q.size ? `?${q}` : ''}`);
}
