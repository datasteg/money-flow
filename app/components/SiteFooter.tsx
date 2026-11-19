// The site's own footer line, under the family strip (Sinho Footer markup): the reference pages, the feed, the
// articles site (as trade-flow links it) and the release the page was served from.
import { familyLink } from '@/lib/family';
import { t } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

export function SiteFooter({ lang, line }: { lang: Lang; line: string | null }) {
  const L = t(lang);
  const articles = familyLink('articles', 'home', { lang });
  const links = [
    { label: L.nav.method, href: `/${lang}/method` }, { label: L.nav.sources, href: `/${lang}/sources` },
    { label: L.nav.checks, href: `/${lang}/checks` }, { label: L.nav.releases, href: `/${lang}/releases` },
    { label: lang === 'ko' ? '릴리스 피드(RSS)' : 'Release feed (RSS)', href: '/feed' },
    ...(articles ? [{ label: lang === 'ko' ? 'articles.datasteg.com의 해설' : 'Explainers on articles.datasteg.com', href: articles }] : []),
  ];
  return (
    <footer className="sn-foot mf-foot">
      <div className="sn-foot__row"><a className="sn-wordmark sn-wordmark--sm" href={`/${lang}`}>money-flow</a></div>
      <nav className="sn-foot__nav" aria-label={lang === 'ko' ? '사이트 정보' : 'About the site'}>{links.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}</nav>
      <p className="sn-foot__note">money-flow.datasteg.com · datasteg{line ? ` · ${line}` : ''}</p>
    </footer>
  );
}
