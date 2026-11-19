'use client';
// The World page's lead chart: dollar credit to non-banks outside the US at each year end (BIS GLI), debt securities
// (emphasis) stacked on loans, measured data only. Both axes are fixed to the full sample (every year end and the
// newest quarter, the measured maximum), so the day slider and Play only reveal bars and never rescale. The BIS
// estimate of the dollar debt in FX swaps and forwards is not a time series and sits beside the chart (SwapsNote on
// the page). Hover or tap a year for its values. The chart is drawn in the pixels of its box (12px labels at any
// width): year labels thin out to fit, and the height follows the width.
import { useEffect, useState } from 'react';
import { amt, at, money, num, pct, period } from '@/lib/format';
import type { Lang, Pt } from '@/lib/types';
import { useTip } from './Tip';

/** Round axis ticks: a step of 1, 2, 2.5 or 5 × 10^k with four to seven intervals, the lowest top tick at or above max. */
export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const p = 10 ** Math.floor(Math.log10(max));
  let best: [number, number] | null = null;                                  // [step, intervals]
  for (const m of [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5]) {
    const step = m * p, n = Math.ceil(max / step - 1e-9);
    if (n >= 4 && n <= 7 && (!best || n * step < best[0] * best[1])) best = [step, n];
  }
  const [step, n] = best ?? [p, Math.ceil(max / p)];
  return Array.from({ length: n + 1 }, (_, i) => i * step);
}

export function GliChart({ total, sec, loans, d, lang }: { total: Pt[]; sec: Pt[]; loans: Pt[]; d: string; lang: Lang }) {
  const t = useTip();
  const ko = lang === 'ko';
  const [bw0, setBw0] = useState(900);
  useEffect(() => {
    const el = t.ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBw0(Math.max(280, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [t.ref]);
  const all = total.filter((p) => p[1] != null);
  const ends = all.filter((p, i) => p[0].endsWith('12-31') || i === all.length - 1);   // the full sample: fixed x positions
  const ticks = niceTicks(Math.max(...ends.map((p) => p[1] ?? 0)));
  const max = ticks[ticks.length - 1];
  const W = Math.round(bw0), H = Math.round(Math.min(360, Math.max(240, W * 0.34))), L0 = ko ? 58 : 46, B = H - 24, R0 = 8;
  const slot = (W - L0 - R0 - 6) / Math.max(ends.length, 1);
  const bw = Math.max(3, Math.min(24, slot - (slot > 10 ? 4 : 2)));
  const every = [1, 2, 4, 5, 10].find((k) => k * slot >= 40) ?? 10;   // a year label at least 40px from the next
  const y = (v: number) => B - (v / max) * (B - 16);
  const lab = ko ? { sec: '채권', loans: '대출', total: '합계', share: '채권 비중' } : { sec: 'Debt securities', loans: 'Loans', total: 'Total', share: 'Debt-securities share' };
  return (
    <div ref={t.ref} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="mf-heat mf-gli__svg" style={{ ['--lfs-s' as string]: '12px' }} preserveAspectRatio="xMidYMid meet" role="img" aria-label={ko ? '미국 밖 비은행의 달러 부채, 채권과 대출' : 'Dollar credit to non-banks outside the US: debt securities and loans'}>
        {ticks.map((v) => (
          <g key={v}><line x1={L0} x2={W - R0} y1={y(v)} y2={y(v)} stroke="var(--viz-grid)" />
            <text x={L0 - 6} y={y(v) + 3} textAnchor="end" className="mf-axis">{ko ? amt(v, 'ko') : `${num(v / 1000, 'en', v % 1000 ? 1 : 0)} tn`}</text></g>
        ))}
        {ends.map((p, i) => {
          const x = L0 + 6 + i * slot;
          const label = (i % every === 0 && ends.length - 1 - i >= every / 2) || i === ends.length - 1 ? <text x={x + bw / 2} y={B + 14} textAnchor="middle" className="mf-axis">{p[0].slice(0, 4)}</text> : null;
          if (p[0] > d) return <g key={p[0]}>{label}</g>;
          const s = at(sec, p[0])?.[1] ?? 0, l = at(loans, p[0])?.[1] ?? 0, tot = p[1] ?? s + l;
          const on = t.active?.id === p[0];
          const c = { id: p[0], title: p[0].endsWith('12-31') ? period(p[0], 'A', lang) : period(p[0], 'Q', lang),
            rows: [{ value: money(s, lang), label: lab.sec, color: 'var(--viz-focus)' }, { value: money(l, lang), label: lab.loans, color: 'var(--viz-context)' }, { value: money(tot, lang), label: lab.total }],
            meta: [`${lab.share} ${pct(tot ? (100 * s) / tot : null, lang)}`] };
          return (
            <g key={p[0]} opacity={t.active && !on ? 0.55 : 1}>
              <rect x={x} y={y(l)} width={bw} height={B - y(l)} fill="var(--viz-context)" />
              <rect x={x} y={y(l + s)} width={bw} height={Math.max(0, y(l) - y(l + s) - 2)} fill="var(--viz-focus)" />
              {label}
              <rect x={x - 2} y={16} width={bw + 4} height={B - 16} fill="transparent" tabIndex={0} role="img" className="mf-hit"
                aria-label={`${c.title}: ${lab.sec} ${money(s, lang)}, ${lab.loans} ${money(l, lang)}, ${lab.total} ${money(tot, lang)}`} {...t.bind(c)} />
            </g>
          );
        })}
      </svg>
      {t.box}
    </div>
  );
}
