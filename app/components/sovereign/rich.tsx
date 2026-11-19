// Glossary markup in page strings: "[[w_k|signal threshold K]]" renders the label as a <Term id="w_k">, and "[[w_k]]"
// the glossary's own name for it. No directive: the server page and the client app both call it (Term itself is a
// client component). plain() drops the markup for attributes and metadata.
import { Fragment, type ReactNode } from 'react';
import { Term } from './Term';

const RE = /\[\[([a-z0-9_]+)(?:\|([^\]]+))?\]\]/g;

export function rich(s: string): ReactNode {
  if (!s.includes('[[')) return s;
  const out: ReactNode[] = [];
  let at = 0, k = 0;
  for (const m of s.matchAll(RE)) {
    if (m.index! > at) out.push(<Fragment key={k++}>{s.slice(at, m.index)}</Fragment>);
    out.push(<Term key={k++} id={m[1]}>{m[2]}</Term>);
    at = m.index! + m[0].length;
  }
  if (at < s.length) out.push(<Fragment key={k++}>{s.slice(at)}</Fragment>);
  return out;
}

export function plain(s: string): string {
  return s.replace(RE, (_, id: string, label?: string) => label ?? id);
}
