// The datasteg flow-site family. One source of truth: the family registry shared by
// the datasteg sites, copied here before the image build (a test keeps the copies equal). This file only reads the copy and fills the link templates; the markup is in components/Family.tsx.
import family from './family.json';
import type { Lang } from './types';

export type FamilyText = Record<Lang, string>;
export interface FamilySite { id: string; host: string; name: string; prefix?: string; role: FamilyText; links: Record<string, string> }
export interface FamilyData { version: number; kicker: FamilyText; menu: FamilyText; current: FamilyText; open: FamilyText; sites: FamilySite[]; articles: FamilySite }

export const FAMILY = family as unknown as FamilyData;
export const SELF = 'money-flow';
export const SITE_URL = FAMILY.sites.find((s) => s.id === SELF)?.host ?? 'https://money-flow.datasteg.com';

/** Fills `{lang}`, `{iso3}`, `{a}`, `{b}`, … in a template; a placeholder with no value stays, so a caller can see it. */
export function fill(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** An absolute link into a family site: `familyLink('global-network', 'pair', { lang, a: 'USA', b: 'KOR' })`. Null when
 *  the site or the template is not in family.json, so a page can leave the link out instead of printing a broken one. */
export function familyLink(site: string, key: string, vars: Record<string, string | undefined>): string | null {
  const s = site === 'articles' ? FAMILY.articles : FAMILY.sites.find((x) => x.id === site);
  const t = s?.links[key];
  if (!s || !t) return null;
  const path = fill(t, vars);
  return /\{\w+\}/.test(path) ? null : `${s.host}${path}`;
}

/** The template itself with the host, for client components that fill `{a}`/`{b}` per cell (functions cannot cross
 *  the server–client boundary; a string can). */
export function familyTemplate(site: string, key: string, lang: Lang): string | null {
  const s = FAMILY.sites.find((x) => x.id === site);
  const t = s?.links[key];
  return s && t ? `${s.host}${fill(t, { lang })}` : null;
}

export interface FamilyCard { id: string; name: string; role: string; current: boolean; href: string | null; text: string }

/** The three cards for a page: each sibling's context link when the page has the same object (today: the economy),
 *  else its home page; the current site is marked and carries no link. Link text names the site and the object. */
export function familyCards(lang: Lang, ctx: { iso3?: string; name?: string } = {}): FamilyCard[] {
  return FAMILY.sites.map((s) => {
    const current = s.id === SELF;
    let href: string | null = null, text = '';
    if (!current) {
      const eco = ctx.iso3 && ctx.name ? familyLink(s.id, 'economy', { lang, iso3: ctx.iso3 }) : null;
      if (eco) { href = eco; text = lang === 'ko' ? `${s.name}에서 ${ctx.name} 보기` : `${ctx.name} in ${s.name}`; }
      else { href = familyLink(s.id, 'home', { lang }); text = fill(FAMILY.open[lang], { name: s.name }); }
    }
    return { id: s.id, name: s.name, role: s.role[lang], current, href, text };
  });
}
