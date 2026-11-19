// The site card: name, tagline and the release's newest data day (plan, section 5.2). One per language route; the
// text stays English for the font's sake (lib/og.tsx).
import { manifest } from '@/lib/data';
import { ogCard, OG_SIZE } from '@/lib/og';

export const alt = 'money-flow: where money is made and where it goes';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function Image() {
  let period: string | undefined;
  try { const m = manifest(null); period = `release ${m.tag}`; } catch { period = undefined; }
  return ogCard({ kicker: 'the money ladder', title: 'Where money is made and where it goes', sub: 'Cross-border positions from markets to countries to the global top, from BIS, IMF and central bank statistics. Every number with its sources, method and checks.', period });
}
