// The Sovereign card: the section's name and the WEO vintage it reads (plan, section 5.2; English for the font).
import { manifest, read } from '@/lib/data';
import { ogCard, OG_SIZE } from '@/lib/og';
import { vintageLabel, type Sovereign } from '@/lib/sovereign';

export const alt = 'money-flow: sovereign stress signals, seven rules by economy and year';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function Image() {
  let period: string | undefined;
  try { const d = read<Sovereign>(manifest(null), 'sovereign/global'); period = d ? vintageLabel(d.meta.vintage, 'en') : undefined; } catch { period = undefined; }
  return ogCard({ kicker: 'sovereign · seven stress signals', title: 'Seven sovereign stress signals', sub: 'Debt, deficits, the external accounts and bond spreads against fixed thresholds, counted each year since 1990 beside past programmes and defaults. A count of signals, not a forecast.', period });
}
