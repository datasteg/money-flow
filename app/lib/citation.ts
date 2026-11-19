// How readers cite a view, after articles.datasteg.com's lib/citation.ts: one line, a figure note, a
// BibTeX @misc (plain BibTeX, natbib and the AEA templates as well as biblatex) and RIS. The author is the
// organisation, braced so BibTeX does not split it. Dataset and method citations come from the release
// (registry/citations, written by scripts/sitebuild/cite.py). tests/citation.test.mjs pins the strings.
import type { Lang } from './types';

export const SITE = 'https://money-flow.datasteg.com';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function longDate(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split('-').map(Number);
  return lang === 'ko' ? `${y}년 ${m}월 ${d}일` : `${d} ${MONTHS[m - 1]} ${y}`;
}

export interface ViewCite {
  lang: Lang;
  title: string;          // "Money ladder: Korea, inflows"
  key: string;            // "KOR-in"
  release: string;        // "20261029.1"
  method: string;         // "1.0"
  date: string;           // the release date, ISO
  path: string;           // "/en/e/KOR"
  query: string;          // "d=2026-10-27&dir=in" (without r)
  datasets: string[];     // short dataset names drawn, for the figure note and the BibTeX note
}

export function permalink(c: ViewCite): string {
  const q = new URLSearchParams(c.query);
  q.delete('r');
  const rest = q.toString();
  return `${SITE}${c.path}?r=${c.release}${rest ? `&${rest}` : ''}`;
}

export function citationText(c: ViewCite): string {
  const url = permalink(c);
  return c.lang === 'ko'
    ? `datasteg (${c.date.slice(0, 4)}), 「${c.title}」, datasteg money-flow, 릴리스 ${c.release}, 방법론 ${c.method}, ${longDate(c.date, 'ko')}, ${url}.`
    : `datasteg (${c.date.slice(0, 4)}), “${c.title}”, datasteg money-flow, release ${c.release}, method ${c.method}, ${longDate(c.date, 'en')}, ${url}.`;
}

export function figureNote(c: ViewCite): string {
  const list = c.datasets.length > 1 ? `${c.datasets.slice(0, -1).join(', ')} ${c.lang === 'ko' ? '및' : 'and'} ${c.datasets[c.datasets.length - 1]}` : c.datasets.join('');
  return c.lang === 'ko'
    ? `자료: datasteg money-flow(릴리스 ${c.release}, 방법론 ${c.method}), 원자료 ${list}.`
    : `Source: datasteg money-flow (release ${c.release}, method ${c.method}), from ${list}.`;
}

const tex = (x: string) => x.replace(/[\\{}]/g, '').replace(/([&%$#_])/g, '\\$1');

export function citationBibtex(c: ViewCite): string {
  const url = permalink(c);
  const title = tex(c.title).replace(/: ([^,]+),/, (_, n: string) => `: {${n}},`);   // keep the economy's capitals
  const fields: [string, string][] = [
    ['author', '{datasteg}'],
    ['title', title],
    ['howpublished', `datasteg money-flow, release ${c.release}, method ${c.method}`],
    ['year', c.date.slice(0, 4)],
    ['date', c.date],
    ['url', url],
    ['urldate', c.date],
    ['note', tex(`${c.lang === 'ko' ? '원자료' : 'Positions from'} ${c.datasets.join(', ')}`)],
    ...(c.lang === 'ko' ? [['langid', 'korean'] as [string, string]] : []),
  ];
  return `@misc{datasteg:mf:${c.key}:${c.release},\n${fields.map(([k, v]) => `  ${k.padEnd(12)} = {${v}}`).join(',\n')}\n}`;
}

export function citationRis(c: ViewCite): string {
  const rows: [string, string][] = [['TY', 'DATA'], ['AU', 'datasteg'], ['TI', c.title], ['PY', c.date.slice(0, 4)], ['DA', c.date.replace(/-/g, '/')],
    ['PB', 'datasteg money-flow'], ['ET', `release ${c.release}, method ${c.method}`], ['UR', permalink(c)], ['Y2', c.date], ['N1', c.datasets.join('; ')], ['ER', '']];
  return rows.map(([k, v]) => `${k}  - ${v}`).join('\n');
}
