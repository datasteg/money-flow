// What every page loads: the release (?r= or the latest), its meta, registries and checks.
import { latestTag, manifest, meta as readMeta, read } from './data';
import type { Checks, Citations, Manifest, Meta, MethodRegistry, SourcesRegistry, World } from './types';

export interface Loaded { m: Manifest; latest: string; meta: Meta; reg: SourcesRegistry; method: MethodRegistry; checks: Checks | null; cites: Citations; world: World; r: string | null }

export function load(sp: Record<string, string | string[] | undefined>): Loaded {
  const r = typeof sp.r === 'string' ? sp.r : null;
  const m = manifest(r);
  return {
    m, latest: latestTag(), meta: readMeta(m), r: r && r !== latestTag() ? r : null,
    reg: read<SourcesRegistry>(m, 'registry/sources')!, method: read<MethodRegistry>(m, 'registry/method')!,
    checks: read<Checks>(m, 'checks'), cites: read<Citations>(m, 'registry/citations')!, world: read<World>(m, 'world/global')!,
  };
}

export function dayParam(sp: Record<string, string | string[] | undefined>, meta: Meta): string {
  const d = typeof sp.d === 'string' ? sp.d : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= '2000-01-01' && d <= meta.day ? d : meta.day;
}

/** Economy names in one language for every economy with a page (the family strip's context links), {} when the store
 *  cannot be read (the layout must still render). */
export function economyNames(lang: 'en' | 'ko'): Record<string, string> {
  try {
    const meta = readMeta(manifest(null));
    return Object.fromEntries(Object.entries(meta.economies).filter(([, e]) => e.page).map(([c, e]) => [c, lang === 'ko' ? e.ko || e.en : e.en]));
  } catch { return {}; }
}

/** "release 20261102.1 · method 1.4" for the footer, from the latest release; null when the store cannot be read. */
export function releaseLine(): string | null {
  try { const m = manifest(null); return `release ${m.tag} · method ${m.method}`; } catch { return null; }
}

/** The economy filter: every economy with a page, by name in the page language (World is its own tab). */
export function economyOptions(meta: Meta, lang: 'en' | 'ko'): { value: string; label: string }[] {
  return Object.entries(meta.economies).filter(([, e]) => e.page).map(([c, e]) => ({ value: c, label: lang === 'ko' ? e.ko : e.en }))
    .sort((a, b) => a.label.localeCompare(b.label, lang));
}
