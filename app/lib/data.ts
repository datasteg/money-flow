// The release store, read on the server only: SITE_DIR holds objects/<sha256>.json.br and
// releases/<tag>.json. A page asks for a path in a release; the manifest names its content hash. Nothing here is
// served raw: there is no data route, so the browser receives only what a page draws (no series downloads).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import type { Manifest, Meta } from './types';

const ROOT = process.env.SITE_DIR ?? path.join(process.cwd(), 'site');
const TAG = /^\d{8}\.\d+$/;
const manifests = new Map<string, Manifest>();
const objects = new Map<string, unknown>();
const MAX_OBJECTS = 48;

export function latestTag(): string {
  return readFileSync(path.join(ROOT, 'releases', 'latest'), 'utf8').trim();
}

/** The manifest of a release: the one asked for (?r=) if it exists, else the latest. */
export function manifest(tag?: string | null): Manifest {
  const t = tag && TAG.test(tag) && existsSync(path.join(ROOT, 'releases', `${tag}.json`)) ? tag : latestTag();
  let m = manifests.get(t);
  if (!m) {
    m = JSON.parse(readFileSync(path.join(ROOT, 'releases', `${t}.json`), 'utf8')) as Manifest;
    manifests.set(t, m);
  }
  return m;
}

export function isLatest(m: Manifest): boolean {
  return m.tag === latestTag();
}

/** One file of a release, decoded; null when the release has no such path. */
export function read<T>(m: Manifest, p: string): T | null {
  const h = m.files[p];
  if (!h) return null;
  const hit = objects.get(h);
  if (hit) {
    objects.delete(h);
    objects.set(h, hit);
    return hit as T;
  }
  const v = JSON.parse(brotliDecompressSync(readFileSync(path.join(ROOT, 'objects', `${h}.json.br`))).toString('utf8'));
  objects.set(h, v);
  while (objects.size > MAX_OBJECTS) objects.delete(objects.keys().next().value as string);
  return v as T;
}

export function meta(m: Manifest): Meta {
  return read<Meta>(m, 'meta') as Meta;
}

export interface ReleaseRow { tag: string; date: string; built: string; method: string; code: string; changed: string[]; checks: Record<string, number>; vintages?: Record<string, string> }

export function releases(): ReleaseRow[] {
  const dir = path.join(ROOT, 'releases');
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse().map((f) => {
    const m = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    return { tag: m.tag, date: m.date, built: m.built, method: m.method, code: m.code, changed: m.changed ?? [], checks: m.checks ?? {}, vintages: m.vintages };
  });
}
