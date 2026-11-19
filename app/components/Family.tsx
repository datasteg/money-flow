'use client';
// The family of flow sites, in Sinho style: the footer strip on every page (kicker and
// three cards, the current site marked, each sibling with its context link) and the same cards behind the masthead's
// "Other sites" item. The context comes from the path: on /e/{iso3} the siblings link to the same economy; elsewhere to
// their home pages. Cross-site links keep the reader's language, open in the same tab and carry no UTM parameters.
import { usePathname } from 'next/navigation';
import { FAMILY, familyCards, type FamilyCard } from '@/lib/family';
import type { Lang } from '@/lib/types';

/** The cards for the page under `pathname`; `names` gives economy names in the page language (economy pages only). */
export function useFamily(lang: Lang, names: Record<string, string>): FamilyCard[] {
  const path = usePathname() ?? '';
  const m = /^\/(?:en|ko)\/e\/([A-Za-z0-9]{3})(?:\/|$)/.exec(path);
  const iso3 = m?.[1]?.toUpperCase();
  return familyCards(lang, iso3 && names[iso3] ? { iso3, name: names[iso3] } : {});
}

export function FamilyCards({ lang, cards, compact }: { lang: Lang; cards: FamilyCard[]; compact?: boolean }) {
  return (
    <ul className={`mf-family__cards${compact ? ' mf-family__cards--compact' : ''}`}>
      {cards.map((c) => (
        <li key={c.id} className={`mf-family__card${c.current ? ' is-current' : ''}`} aria-current={c.current ? 'true' : undefined}>
          <p className="mf-family__name">{c.name}{c.current ? <span className="mf-family__here">{FAMILY.current[lang]}</span> : null}</p>
          <p className="mf-family__role">{c.role}</p>
          {c.href ? <a className="mf-family__link" href={c.href}>{c.text}<span aria-hidden> →</span></a> : null}
        </li>
      ))}
    </ul>
  );
}

export function FamilyStrip({ lang, names }: { lang: Lang; names: Record<string, string> }) {
  const cards = useFamily(lang, names);
  return (
    <section className="mf-family" aria-label={FAMILY.kicker[lang]}>
      <p className="sn-kicker">{FAMILY.kicker[lang]}</p>
      <FamilyCards lang={lang} cards={cards} />
    </section>
  );
}

/** The masthead item: a disclosure that opens the same three cards (reachable without scrolling). */
export function FamilyMenu({ lang, names }: { lang: Lang; names: Record<string, string> }) {
  const cards = useFamily(lang, names);
  return (
    <details className="mf-other">
      <summary className="sn-btn sn-btn--quiet sn-btn--sm">{FAMILY.menu[lang]}</summary>
      <div className="mf-other__pop" role="region" aria-label={FAMILY.kicker[lang]}>
        <p className="sn-kicker">{FAMILY.kicker[lang]}</p>
        <FamilyCards lang={lang} cards={cards} compact />
      </div>
    </details>
  );
}
