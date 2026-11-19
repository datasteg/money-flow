import type { MetadataRoute } from 'next';
import { manifest, read } from '@/lib/data';
import { LANGS } from '@/lib/i18n';
import { SITE } from '@/lib/seo';
import type { Meta, World } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Both languages, from the same lists the pages use: the economies of the Signal Board
// set and the hubs the world view names (board.set.in and board.set.out), the four markets, World, Sovereign and the
// four reference pages. Other economies stay reachable but out of the sitemap at first. lastModified is the release date.
export default function sitemap(): MetadataRoute.Sitemap {
  const m = manifest(null);
  const meta = read<Meta>(m, 'meta')!;
  const world = read<World>(m, 'world/global')!;
  const date = new Date(m.date);
  const hubs = world.board.set.out.map(([c]) => c);
  const economies = [...new Set([...world.board.set.in, ...hubs])].filter((c) => meta.economies[c]?.page);
  const paths = [
    ...economies.map((c) => `/e/${c}`),
    ...meta.markets.map((k) => `/m/${k}`),
    '/world', '/sovereign', '/method', '/sources', '/checks', '/releases',
  ];
  const languages = (p: string) => Object.fromEntries([...LANGS.map((l) => [l, `${SITE}/${l}${p}`]), ['x-default', `${SITE}/en${p}`]]);
  return LANGS.flatMap((lang) => paths.map((p) => ({
    url: `${SITE}/${lang}${p}`, lastModified: date, changeFrequency: 'daily' as const, priority: p === '/world' || p === '/sovereign' ? 0.9 : p.startsWith('/e/') || p.startsWith('/m/') ? 0.8 : 0.5,
    alternates: { languages: languages(p) },
  })));
}
