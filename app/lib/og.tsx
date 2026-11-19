// The Open Graph card every shared link shows: Sinho's night colours (asphalt ground,
// centre-line yellow mark, concrete ink), the wordmark, a title and a period. ImageResponse's bundled font covers Latin
// only, so the card uses English for both editions (Korean names would render as empty boxes).
import { ImageResponse } from 'next/og';

export const OG_SIZE = { width: 1200, height: 630 };
const ASPHALT = '#101114', CONCRETE = '#F2F2EF', CENTERLINE = '#FFC31A', INK_MUTED = '#A9ABB0', SIGN_LIT = '#6FA3FF';

export function ogCard({ kicker, title, sub, period }: { kicker: string; title: string; sub?: string; period?: string }) {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '64px 72px', background: ASPHALT, color: CONCRETE, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ width: 14, height: 56, background: CENTERLINE, borderRadius: 3 }} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: -1 }}>money-flow</div>
            <div style={{ fontSize: 20, color: INK_MUTED, letterSpacing: 2, textTransform: 'uppercase' }}>{kicker}</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontSize: title.length > 40 ? 56 : 72, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5 }}>{title}</div>
          {sub ? <div style={{ fontSize: 28, color: INK_MUTED, lineHeight: 1.3, maxWidth: 1000 }}>{sub}</div> : null}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 22, color: INK_MUTED }}>
          <div>money-flow.datasteg.com · datasteg</div>
          {period ? <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: SIGN_LIT }}><div style={{ width: 10, height: 10, borderRadius: 5, background: SIGN_LIT }} />{period}</div> : null}
        </div>
      </div>
    ),
    { ...OG_SIZE },
  );
}
