import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
// Order matters: Sinho's tokens, Sinho's component styles, the site's own layout, then the datasteg type (www's fonts,
// family/fonts.ts), which points Sinho's font tokens at Newsreader, Libre Franklin and JetBrains Mono.
import '../../../design/tokens.css';
import '../../../design/sinho.css';
import '../site.css';
import '@/lib/ds-fonts';
import { DatastegBar } from '@/components/DatastegBar';
import { FamilyStrip } from '@/components/Family';
import { PageCount } from '@/components/PageCount';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteMasthead } from '@/components/SiteMasthead';
import { isLang, LANGS, t } from '@/lib/i18n';
import { economyNames, releaseLine } from '@/lib/page';
import { pageMeta, SITE } from '@/lib/seo';
import type { Lang } from '@/lib/types';

export const dynamicParams = false;
export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  const l: Lang = isLang(lang) ? lang : 'en';
  const google = process.env.GOOGLE_SITE_VERIFICATION, naver = process.env.NAVER_SITE_VERIFICATION;
  return {
    metadataBase: new URL(SITE),
    // Open to search engines since the refurbish of 2 Nov 2026; robots.ts allows everything but
    // /health and old releases (?r=). Each route's generateMetadata replaces title, description and alternates.
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 } },
    ...(google || naver ? { verification: { ...(google ? { google } : {}), ...(naver ? { other: { 'naver-site-verification': naver } } : {}) } } : {}),
    ...pageMeta(l, '', { title: `${t(l).ladder} · ${t(l).siteName}`, description: t(l).description }),
    title: { default: `${t(l).ladder} · ${t(l).siteName}`, template: `%s — ${t(l).ladder} · ${t(l).siteName}` },
  };
}

// Before the first paint: the saved theme, else the system setting (Sinho Implementation, Theming).
const THEME = `try{var t=localStorage.getItem('sinho-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}`;

export default async function LangLayout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  if (!isLang(raw)) notFound();
  const lang: Lang = raw;
  const L = t(lang);
  const names = economyNames(lang);
  const site = {
    '@context': 'https://schema.org', '@type': 'WebSite', name: 'money-flow', alternateName: 'datasteg money-flow', url: `${SITE}/${lang}`,
    inLanguage: lang, description: L.description, publisher: { '@type': 'Organization', name: 'datasteg', url: 'https://datasteg.com' },
  };
  return (
    <html lang={lang} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME }} /></head>
      <body>
        <a className="mf-skip" href="#main">{L.skip}</a>
        <DatastegBar lang={lang} site="money-flow" />
        <Suspense><SiteMasthead lang={lang} names={names} /></Suspense>
        <main id="main" tabIndex={-1}>{children}</main>
        <FamilyStrip lang={lang} names={names} />
        <SiteFooter lang={lang} line={releaseLine()} />
        <Suspense><PageCount /></Suspense>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(site) }} />
      </body>
    </html>
  );
}
