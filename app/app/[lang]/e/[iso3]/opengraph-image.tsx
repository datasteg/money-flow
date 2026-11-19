// The economy card: the economy's name and the newest period on its ladder (plan, section 5.2; English for the font).
import { manifest, meta as readMeta, read } from '@/lib/data';
import { ogCard, OG_SIZE } from '@/lib/og';
import { period } from '@/lib/format';
import { newestPeriod } from '@/lib/model';
import type { Econ } from '@/lib/types';

export const alt = 'money-flow: one economy on the money ladder';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ lang: string; iso3: string }> }) {
  const { iso3 } = await params;
  const X = iso3.toUpperCase();
  let title = X, per: string | undefined;
  try {
    const m = manifest(null);
    title = readMeta(m).economies[X]?.en ?? X;
    const econ = read<Econ>(m, `econ/${X}`);
    const p = econ ? newestPeriod(econ) : null;
    per = p ? `newest period ${period(p, 'Q', 'en')}` : undefined;
  } catch { /* the card still names the economy */ }
  return ogCard({ kicker: 'the money ladder · economy', title, sub: 'Who puts money into this economy, through which instruments, and where its own money goes.', period: per });
}
