// Numbers and dates in the page language (Sinho Bilingual §; voice: flat, exact). The release stores every amount in
// USD billions. English shows them as they are, with one decimal ("14,747.7 bn"); Korean shows them in 억 달러 as whole
// numbers ("147,477억 달러": one billion is ten 억), and in 조 only in headline sentences ("14.7조 달러"). Every amount on
// a page goes through amt() or money() below, so no page prints the billions unit in Korean (tests/format.test.mjs).
import type { Lang } from './types';

const LOCALE: Record<Lang, string> = { en: 'en-GB', ko: 'ko-KR' };

export function minus(s: string): string {
  return s.replace(/^-/, '−').replace(/ -/g, ' −');
}

export function num(v: number | null | undefined, lang: Lang, decimals = 1, signed = false): string {
  if (v == null || !Number.isFinite(v)) return '–';
  const s = new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: decimals, maximumFractionDigits: decimals, signDisplay: signed ? 'exceptZero' : 'auto' }).format(v);
  return minus(s);
}

/** The unit of amt(), for titles, column headers and stat tiles: "USD bn" / "억 달러". */
export function unit(lang: Lang): string {
  return lang === 'ko' ? '억 달러' : 'USD bn';
}

/** A USD bn amount as a bare number in the page's unit: "14,747.7" (bn) / "147,477" (억 달러). */
export function amt(v: number | null | undefined, lang: Lang, signed = false): string {
  if (v == null || !Number.isFinite(v)) return '–';
  return lang === 'ko' ? num(v * 10, 'ko', 0, signed) : num(v, 'en', 1, signed);
}

/** amt() rounded to whole units for crowded labels (matrix cells, axis bins): "14,748" (bn) / "147,477" (억 달러). */
export function amtWhole(v: number | null | undefined, lang: Lang): string {
  if (v == null || !Number.isFinite(v)) return '–';
  return lang === 'ko' ? num(v * 10, 'ko', 0) : num(v, 'en', 0);
}

/** A USD bn amount with its unit, for tooltips, aria labels and prose: "14,747.7 bn" / "147,477억 달러". */
export function money(v: number | null | undefined, lang: Lang, signed = false): string {
  if (v == null || !Number.isFinite(v)) return '–';
  return lang === 'ko' ? `${amt(v, 'ko', signed)}억 달러` : `${amt(v, 'en', signed)} bn`;
}

/** The stat-tile pair: the number, and its unit ("bn" / "억 달러"). */
export function tile(v: number | null | undefined, lang: Lang): { value: string; unit: string } {
  return { value: amt(v, lang), unit: lang === 'ko' ? '억 달러' : 'bn' };
}

/** Headline sentences only: "14.7 tn" / "14.7조 달러". */
export function tn(v: number | null | undefined, lang: Lang): string {
  if (v == null || !Number.isFinite(v)) return '–';
  return lang === 'ko' ? `${num(v / 1000, 'ko')}조 달러` : `${num(v / 1000, 'en')} tn`;
}

/** The Markets pages: cells and tooltips in "2,692억 달러" / "$269bn" (whole units), totals and stat tiles in
 *  "15.0조 달러" / "$15.0tn" (one decimal). The same on every market. */
export function usdBn(v: number | null | undefined, lang: Lang, signed = false): string {
  if (v == null || !Number.isFinite(v)) return '–';
  if (lang === 'ko') return `${num(v * 10, 'ko', 0, signed)}억 달러`;
  const s = num(Math.abs(v), 'en', 0);
  return `${v < 0 ? '−' : signed && v > 0 ? '+' : ''}$${s}bn`;
}
export function usdTn(v: number | null | undefined, lang: Lang, signed = false): string {
  if (v == null || !Number.isFinite(v)) return '–';
  if (lang === 'ko') return `${num(v / 1000, 'ko', 1, signed)}조 달러`;
  return `${v < 0 ? '−' : signed && v > 0 ? '+' : ''}$${num(Math.abs(v) / 1000, 'en', 1)}tn`;
}
/** usdTn() split for a stat tile: value "15.0" / "$15.0", unit "조 달러" / "tn". */
export function tnTile(v: number | null | undefined, lang: Lang): { value: string; unit: string } {
  if (v == null || !Number.isFinite(v)) return { value: '–', unit: '' };
  return lang === 'ko' ? { value: num(v / 1000, 'ko', 1), unit: '조 달러' } : { value: `$${num(v / 1000, 'en', 1)}`, unit: 'tn' };
}

/** The value as the CSV carries it: the displayed unit (bn with one decimal; 억 달러 whole). */
export function csvAmt(v: number | null | undefined, lang: Lang): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return lang === 'ko' ? Math.round(v * 10) : Math.round(v * 10) / 10;
}

/** "994.4 bn" in English; "9,944억 달러" or "1조 3,646억 달러" in Korean prose. */
export function bn(v: number | null | undefined, lang: Lang): string {
  if (v == null || !Number.isFinite(v)) return '–';
  if (lang === 'en') return `${num(v, 'en')} bn`;
  const eok = Math.round(Math.abs(v) * 10);
  const jo = Math.floor(eok / 10000);
  const rest = eok % 10000;
  const sign = v < 0 ? '−' : '';
  const parts = [jo ? `${jo}조` : '', rest ? `${new Intl.NumberFormat('ko-KR').format(rest)}억` : ''].filter(Boolean).join(' ');
  return `${sign}${parts || '0'} 달러`;
}

export function pct(v: number | null | undefined, lang: Lang): string {
  return v == null ? '–' : `${num(v, lang, 1)}%`;
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "21 Oct 2026" / "2026년 10월 21일". */
export function day(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '–';
  const [y, m, d] = iso.split('-').map(Number);
  return lang === 'ko' ? `${y}년 ${m}월 ${d}일` : `${d} ${MONTHS_EN[m - 1]} ${y}`;
}

export function longDay(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split('-').map(Number);
  return lang === 'ko' ? `${y}년 ${m}월 ${d}일` : `${d} ${MONTHS_LONG[m - 1]} ${y}`;
}

/** A period by its cadence: "Q1 2026", "end-2025", "Sep 2026", "week to 21 Oct 2026"; Korean "2026년 1분기" … */
export function period(iso: string | null | undefined, freq: string | null | undefined, lang: Lang): string {
  if (!iso) return '–';
  const [y, m] = iso.split('-').map(Number);
  switch (freq) {
    case 'Q': return lang === 'ko' ? `${y}년 ${Math.ceil(m / 3)}분기` : `Q${Math.ceil(m / 3)} ${y}`;
    case 'S': return lang === 'ko' ? `${y}년 ${m === 12 ? '말' : '6월 말'}` : (m === 12 ? `end-${y}` : `mid-${y}`);
    case 'A': return lang === 'ko' ? `${y}년 말` : `end-${y}`;
    case 'M': return lang === 'ko' ? `${y}년 ${m}월` : `${MONTHS_EN[m - 1]} ${y}`;
    case 'W': return lang === 'ko' ? `${day(iso, 'ko')}까지 1주` : `week to ${day(iso, 'en')}`;
    default: return day(iso, lang);
  }
}

/** The cadence implied by a period end: December may be S or A, so the caller passes what it knows. */
export function freqOf(group: string): string {
  return { debt: 'S', equity: 'S', unsplit: 'S', portfolio: 'S', bank: 'Q', fdi: 'A', reserves: 'Q' }[group] ?? 'Q';
}

export function kst(iso: string, lang: Lang): string {
  const d = new Date(iso);
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const hh = String(k.getUTCHours()).padStart(2, '0'), mm = String(k.getUTCMinutes()).padStart(2, '0');
  const date = `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`;
  return lang === 'ko' ? `${day(date, 'ko')} ${hh}:${mm} (KST)` : `${day(date, 'en')}, ${hh}:${mm} KST`;
}

/** The newest point at or before a day (the browser picks, it never adds: R13). */
export function at<T extends [string, number | null]>(pts: T[] | undefined, d: string): T | null {
  if (!pts) return null;
  let hit: T | null = null;
  for (const p of pts) { if (p[0] <= d) hit = p; else break; }
  return hit;
}
