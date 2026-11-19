'use client';
// The masthead: wordmark (no logo) with the site's one concept, the money ladder; the three tabs, which follow its
// rungs (Economy: one economy's border and markets; Markets: one instrument across economies; World: the top), and
// since 2 Nov 2026 a fourth, Sovereign (the seven stress-signal rules R22–R28); the
// language switch (which keeps the path and the query) and the theme toggle. The sibling sites are in the datasteg bar
// above the masthead (family/DatastegBar.tsx, 9 Nov 2026), which replaced the "Other sites" menu; the wordmark carries
// the site's mark from the family icon set (a ladder: the money ladder's rungs). Method, Sources, Checks and Releases are
// reached from the line of links under each dashboard's panel.
import { usePathname, useSearchParams } from 'next/navigation';
import { LanguageSwitch, Masthead } from './sn';
import { ThemeToggle } from './sn/client';
import { SiteMark } from './DatastegBar';
import { t } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

/** `names` is no longer read here (the datasteg bar finds the economy from the path); kept so callers need no change. */
export function SiteMasthead({ lang }: { lang: Lang; names?: Record<string, string> }) {
  const path = usePathname() ?? `/${lang}`;
  const sp = useSearchParams();
  const L = t(lang);
  const rest = path.replace(/^\/(en|ko)/, '');
  const q = sp?.toString() ? `?${sp.toString()}` : '';
  const sec = rest.split('/')[1] ?? '';
  const links = [
    { label: L.nav.economy, href: `/${lang}`, active: sec === '' || sec === 'e' },
    { label: L.nav.markets, href: `/${lang}/m/equity`, active: sec === 'm' },
    { label: L.nav.world, href: `/${lang}/world`, active: sec === 'world' },
    { label: L.nav.sovereign, href: `/${lang}/sovereign`, active: sec === 'sovereign' },
  ];
  const actions = (
    <>
      <LanguageSwitch current={lang} label={lang === 'ko' ? '언어' : 'Language'}
        options={[{ code: 'en', label: 'EN', href: `/en${rest}${q}` }, { code: 'ko', label: '한국어', href: `/ko${rest}${q}` }]} />
      <ThemeToggle toNight={L.night} toDay={L.day} />
    </>
  );
  return (
    <>
      <Masthead name="money-flow" mark={<SiteMark id="money-flow" size={24} className="ds-wordmark-mark" />} tag={L.ladder} href={`/${lang}`} links={links} actions={actions} label={lang === 'ko' ? '주 메뉴' : 'Primary'} />
      {/* below 904px the four tabs leave the 56px masthead and sit under it as route chips */}
      <nav className="mf-routes" aria-label={lang === 'ko' ? '주 메뉴' : 'Primary'}>
        {links.map((l) => <a key={l.href} href={l.href} aria-current={l.active ? 'page' : undefined}>{l.label}</a>)}
      </nav>
    </>
  );
}
