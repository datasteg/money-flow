// Source links from the registry (config/sources.yaml `links`, `panels`; check V17): every source a page names is a
// link to the publisher's own page, opening in a new tab. An id the registry lacks renders as plain text marked
// data-src-missing, which the page test fails on, so a missing entry cannot pass unseen.
import type { ReactNode } from 'react';
import type { Lang, SourcesRegistry } from '@/lib/types';

export function SrcLink({ reg, id, lang, children }: { reg: SourcesRegistry; id: string; lang: Lang; children?: ReactNode }) {
  const e = reg.links?.[id];
  if (!e?.url) return <span data-src-missing={id}>{children ?? id}</span>;
  const opens = lang === 'ko' ? '새 탭에서 열림' : 'opens in new tab';
  return (
    <a className="mf-srcl" href={e.url} target="_blank" rel="noopener noreferrer" data-src={id} aria-label={`${e.name[lang]} — ${opens}`}>
      {children ?? e.label[lang]}
    </a>
  );
}

/** The links of one panel, joined by "; " (the registry says which links a panel names). */
export function PanelSrc({ reg, panel, lang, only }: { reg: SourcesRegistry; panel: string; lang: Lang; only?: string[] }) {
  const ids = (reg.panels?.[panel]?.links ?? []).filter((x) => !only || only.includes(x));
  if (!ids.length) return <span data-src-missing={panel}>{panel}</span>;
  return <>{ids.map((id, i) => <span key={id}>{i ? '; ' : ''}<SrcLink reg={reg} id={id} lang={lang} /></span>)}</>;
}

/** The registry link for a drawn series: its dataset, and its series code when the registry has one for it. */
export function linkFor(reg: SourcesRegistry, ds: string, key?: string | null): string | null {
  const ls = Object.entries(reg.links ?? {}).filter(([, e]) => e.dataset === ds);
  return (ls.find(([, e]) => key && e.code === key) ?? ls.find(([, e]) => !e.code || e.code === ds.split('.')[1]) ?? ls[0])?.[0] ?? null;
}

/** The page a dataset name links to: its registry link when one fits unambiguously (the series code, else the link
 *  named after the dataset, else the dataset's only link), otherwise the publisher's landing page for the dataset. */
function dsTarget(reg: SourcesRegistry, ds: string, key?: string | null): { id: string } | { url: string; name: { en: string; ko: string } } | null {
  const ls = Object.entries(reg.links ?? {}).filter(([, e]) => e.dataset === ds && e.url);
  const hit = ls.find(([, e]) => key && e.code === key) ?? ls.find(([, e]) => e.code === ds.split('.')[1]) ?? (ls.length === 1 ? ls[0] : undefined);
  if (hit) return { id: hit[0] };
  const d = reg.datasets[ds];
  if (!d?.landing) return null;
  const pub = reg.publishers[d.publisher];
  return { url: d.landing, name: { en: `${pub?.short ?? ''} ${d.en}`.trim(), ko: `${pub?.ko ?? ''} ${d.ko}`.trim() } };
}

/** A dataset named on a page, as a link (registry link or the dataset's landing page), with the given text. */
export function DsLink({ reg, ds, lang, code, children }: { reg: SourcesRegistry; ds: string; lang: Lang; code?: string | null; children: ReactNode }) {
  const tg = dsTarget(reg, ds, code);
  if (!tg) return <span data-src-missing={ds}>{children}</span>;
  if ('id' in tg) return <SrcLink reg={reg} id={tg.id} lang={lang}>{children}</SrcLink>;
  const opens = lang === 'ko' ? '새 탭에서 열림' : 'opens in new tab';
  return <a className="mf-srcl" href={tg.url} target="_blank" rel="noopener noreferrer" data-src={ds} aria-label={`${tg.name[lang]} — ${opens}`}>{children}</a>;
}

/** The dataset a short source name stands for ("IMF PIP", "BIS LBS", "IMF IIP"): its `short`, exactly or as a prefix. */
export function dsByShort(reg: SourcesRegistry, s: string): string | null {
  const ds = Object.entries(reg.datasets);
  return (ds.find(([, e]) => e.short === s) ?? ds.find(([, e]) => e.short?.startsWith(`${s} `)))?.[0] ?? null;
}

/** A line "period · note · SOURCE" with its last segment linked (to `ds`, or to the dataset its text names). */
export function SrcTail({ reg, text, lang, ds }: { reg: SourcesRegistry; text: string; lang: Lang; ds?: string | null }) {
  const sep = text.includes(' · ') ? ' · ' : text.startsWith('자료: ') || text.startsWith('출처: ') || text.startsWith('Source: ') ? ': ' : null;
  if (!sep) return <>{text}</>;
  const i = text.lastIndexOf(sep);
  const tail = text.slice(i + sep.length);
  const target = ds ?? dsByShort(reg, tail);
  if (!target) return <>{text}</>;
  return <>{text.slice(0, i + sep.length)}<DsLink reg={reg} ds={target} lang={lang}>{tail}</DsLink></>;
}
