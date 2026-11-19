// Per-page metadata for search engines. Every route's generateMetadata builds its title,
// description, canonical and language alternates here from the route's own path, so a crawler sees each page as
// itself and not as a copy of the home page: canonical without query, en and ko alternates, x-default on the English
// page (never "/", which redirects by cookie and a crawler has none).
import type { Metadata } from 'next';
import { SITE_URL } from './family';
import type { Lang } from './types';

export const SITE = SITE_URL;

/** `path` is the route after the language, starting with "/" ("" for the home page), without query. */
export function pageMeta(lang: Lang, path: string, { title, description, ogImage }: { title: string; description: string; ogImage?: string }): Metadata {
  const here = `/${lang}${path}`;
  return {
    title,
    description,
    alternates: {
      canonical: here,
      languages: { en: `/en${path}`, ko: `/ko${path}`, 'x-default': `/en${path}` },
      types: { 'application/rss+xml': `${SITE}/feed` },
    },
    openGraph: {
      title, description, url: here, type: 'website', siteName: 'datasteg money-flow', locale: lang === 'ko' ? 'ko_KR' : 'en_GB',
      alternateLocale: lang === 'ko' ? 'en_GB' : 'ko_KR', ...(ogImage ? { images: [ogImage] } : {}),
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}
