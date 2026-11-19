'use client';
// The money ladder, drawn left to right: the global rung (the issuing central banks, and the holders
// abroad) on the left, the border of the economy (its IIP, and the money made at home) in the middle, and its markets,
// one node per instrument, on the right. The column order never changes with the direction: for inflows the ribbons run
// from the holders abroad across the border into the markets, for outflows from the markets out to the destinations,
// and the headers carry the arrow. One ribbon per counterparty and channel; width is the position (or the latest flow)
// on one scale for the whole ladder, so ribbons add up at every node. Colour is the channel, never the counterparty.
// Hover, tap or focus a ribbon or node for its value and provenance; Escape clears.
//
// Three layouts share the geometry. `full` is the figure the PNG/SVG export prints (1000 x 600, the rung panels drawn
// above the ribbons). `compact` is the screen: the viewBox is the box's own size in CSS pixels, so labels keep their
// size on any monitor, and the rung panels sit beside the chart as HTML (RungPanels). `phone` keeps at most eight
// counterparties (the rest fold into Other), numbers them in the chart and lists them below it; a tap opens a sheet.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Bar, NodeM, PoolM, Rib } from '@/lib/model';
import { useTip, type TipContent } from './Tip';

/** Channel colours: one CSS variable per channel (site.css), shared by the chart, its legend and its tooltips. */
export const COLOR: Record<string, string> = { debt: 'var(--mf-ch-debt)', bank: 'var(--mf-ch-bank)', fdi: 'var(--mf-ch-fdi)', equity: 'var(--mf-ch-equity)', reserves: 'var(--mf-ch-reserves)', unsplit: 'var(--mf-ch-unsplit)', bank_other: 'var(--mf-ch-bank)', bank_nat: 'var(--mf-ch-bank)' };
const STACK = ['debt', 'bank', 'fdi', 'equity', 'unsplit', 'reserves', 'bank_nat'];   // bank_nat last: the overlay sits below the IIP's stack
const POOL_OF: Record<string, string> = { debt: 'debt', bank: 'bank', fdi: 'fdi', equity: 'equity', unsplit: 'portfolio_ns', reserves: 'reserves', bank_nat: 'bank_nat' };
const NW = 10;

export type LadderMode = 'full' | 'compact' | 'phone';
export interface LadderSize { w: number; h: number; fs: number; mode: LadderMode }
/** The exported figure: the original geometry and label sizes, whatever the screen. */
export const EXPORT_SIZE: LadderSize = { w: 1000, h: 600, fs: 11, mode: 'full' };

interface Frame { W: number; H: number; TOP: number; BOTTOM: number; HX: number; BX: number; PX: number; LINE: number; PLINE: number; RY: number; clipN: number; clipP: number; hitN: number; fs: [number, number, number] }

function frame(z: LadderSize): Frame {
  if (z.mode === 'full') return { W: 1000, H: 600, TOP: 172, BOTTOM: 592, HX: 316, BX: 508, PX: 712, LINE: 13, PLINE: 28, RY: 20, clipN: 26, clipP: 44, hitN: 236, fs: [11, 10, 9] };
  const s = z.fs / 11, W = Math.round(z.w), H = Math.round(z.h);
  const small = Math.max(12, z.fs - 1);
  const HX = z.mode === 'phone' ? Math.round(z.fs * 2.4) : Math.round(Math.min(0.32 * W, 300 * s));
  const PX = z.mode === 'phone' ? W - Math.round(z.fs * 9.6) : Math.round(W - Math.min(0.3 * W, 320 * s));
  return {
    W, H, TOP: Math.round(46 * s), BOTTOM: H - 8, HX, PX, BX: Math.round((HX + NW + PX) / 2), LINE: Math.round(13 * s), PLINE: Math.round(28 * s), RY: Math.round(20 * s),
    clipN: Math.max(8, Math.floor((HX - 8 - 4.5 * z.fs) / (0.6 * z.fs))), clipP: Math.max(8, Math.floor((W - PX - NW - 8) / (0.6 * z.fs))), hitN: HX - 4,
    fs: [z.fs, small, small],
  };
}

export interface LadderText {
  rungs: { global: string; country: string; market: string };
  made: string; border: string; apex: string; flow: boolean; dir: 'in' | 'out'; econ: string;
  fmt: (v: number | null) => string; money: (v: number | null) => string; period: (iso: string, freq: string) => string; unit: string; channel: Record<string, string>;
  tip: { period: string; source: string; rules: string; reported: string; share: string; flow: string; published: string; derived: string; total: string };
  borderItems: { label: string; value: string }[];
  poolValue: (p: PoolM) => string;
  aria: string;
  other: string; close: string; holdersList: string; marketsList: string;
}

/** Text width in label units: a Hangul or CJK character is about two Latin ones. */
const units = (s: string) => [...s].reduce((n, c) => n + (/[ᄀ-ᇿ　-鿿가-힯]/.test(c) ? 1.9 : 1), 0);
function clip(s: string, max: number): string {
  if (units(s) <= max) return s;
  let out = '';
  for (const c of s) { if (units(out + c) > max - 1) break; out += c; }
  return `${out.trimEnd()}…`;
}

/** Spread labels so that neighbours never overlap: push down, then back up from the bottom. */
function spread(want: number[], pitch: number, lo: number, hi: number): number[] {
  const y = want.map((v) => Math.max(lo, v));
  for (let i = 1; i < y.length; i++) y[i] = Math.max(y[i], y[i - 1] + pitch);
  if (y.length && y[y.length - 1] > hi) {
    y[y.length - 1] = hi;
    for (let i = y.length - 2; i >= 0; i--) y[i] = Math.min(y[i], y[i + 1] - pitch);
  }
  return y;
}

function ribbonPath(x0: number, y0: number, x1: number, y1: number, w: number) {
  const m = (x0 + x1) / 2;
  return `M${x0},${y0} C${m},${y0} ${m},${y1} ${x1},${y1} L${x1},${y1 + w} C${m},${y1 + w} ${m},${y0 + w} ${x0},${y0 + w} Z`;
}

/** Phone: keep the largest named counterparties so that at most `max` nodes are drawn, and fold the rest into Other
 *  (one ribbon per channel and market, values summed). Display only: the table and the CSV keep every row. */
function fold(holders: NodeM[], ribbons: Rib[], max: number, otherLabel: string): { holders: NodeM[]; ribbons: Rib[] } {
  const sum = new Map<string, number>();
  for (const r of ribbons) sum.set(r.holder, (sum.get(r.holder) ?? 0) + r.value);
  const drawn = holders.filter((h) => sum.has(h.code));
  const named = drawn.filter((h) => h.kind === 'holder').sort((a, b) => (sum.get(b.code) ?? 0) - (sum.get(a.code) ?? 0));
  const rest = drawn.filter((h) => h.kind !== 'holder');
  const hasOther = rest.some((h) => h.kind === 'other');
  const keep = Math.max(1, max - rest.length - (hasOther ? 0 : 1));
  if (named.length <= keep + (hasOther ? 0 : 1)) return { holders, ribbons };
  const folded = new Set(named.slice(keep).map((h) => h.code));
  const other = rest.find((h) => h.kind === 'other') ?? { code: '_other', label: otherLabel, fc: false, kind: 'other' as const };
  const names = named.slice(keep).map((h) => h.label);
  const out: Rib[] = [], merged = new Map<string, Rib>();
  for (const r of ribbons) {
    if (!folded.has(r.holder) && r.holder !== other.code) { out.push(r); continue; }
    const key = `${r.group}|${r.pool ?? ''}`;
    const m = merged.get(key);
    if (!m) { merged.set(key, { ...r, id: `fold:${key}`, holder: other.code, label: other.label, rules: [...r.rules], rep: null, desc: names.join(', ') }); continue; }
    m.value += r.value;
    m.flow = m.flow == null && r.flow == null ? null : (m.flow ?? 0) + (r.flow ?? 0);
    m.share = m.share == null && r.share == null ? null : (m.share ?? 0) + (r.share ?? 0);
    for (const x of r.rules) if (!m.rules.includes(x)) m.rules.push(x);
  }
  return { holders: [...named.slice(0, keep), other, ...rest.filter((h) => h !== other)], ribbons: [...out, ...merged.values()] };
}

export function Ladder({ holders: h0, pools, ribbons: r0, apex, made, text, size = EXPORT_SIZE, sheet }: {
  holders: NodeM[]; pools: PoolM[]; ribbons: Rib[]; apex: Bar[]; made: Bar[]; text: LadderText; size?: LadderSize; sheet?: boolean;
}) {
  const phone = size.mode === 'phone';
  const t = useTip({ sheet: sheet ?? phone, close: text.close });
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => { if (!t.active) setHover(null); }, [t.active]);
  const F = frame(size);
  const { W, H, TOP, BOTTOM, HX, BX, PX, LINE, PLINE } = F;
  const { holders, ribbons } = useMemo(() => (phone ? fold(h0, r0, 8, text.other) : { holders: h0, ribbons: r0 }), [h0, r0, phone, text.other]);

  const L = useMemo(() => {
    // layout widths only: the sum of the drawn ribbons at each node (no reported total is computed here)
    const nodeSum = new Map<string, number>(), poolSum = new Map<string, number>();
    for (const r of ribbons) {
      nodeSum.set(r.holder, (nodeSum.get(r.holder) ?? 0) + r.value);
      const p = r.pool ?? POOL_OF[r.group];
      poolSum.set(p, (poolSum.get(p) ?? 0) + r.value);
    }
    // counterparties largest first, then Other and the unsplit totals in the model's order
    const named = holders.filter((h) => nodeSum.has(h.code) && h.kind === 'holder').sort((a, b) => (nodeSum.get(b.code) ?? 0) - (nodeSum.get(a.code) ?? 0));
    const nodes = [...named, ...holders.filter((h) => nodeSum.has(h.code) && h.kind !== 'holder')];
    const ps = pools.filter((p) => poolSum.has(p.id));
    const grand = [...nodeSum.values()].reduce((a, b) => a + b, 0) || 1;
    const gapN = nodes.length > 16 ? 3 : 5, gapP = 16;
    const span = BOTTOM - TOP;
    const k = Math.min(span - gapN * Math.max(0, nodes.length - 1), span - gapP * Math.max(0, ps.length - 1)) / grand;
    const ny = new Map<string, number>(), py = new Map<string, number>();
    let y = TOP;
    for (const n of nodes) { ny.set(n.code, y); y += (nodeSum.get(n.code) ?? 0) * k + gapN; }
    y = TOP;
    for (const p of ps) { py.set(p.id, y); y += (poolSum.get(p.id) ?? 0) * k + gapP; }
    // ribbons: in the node, stacked by channel; in the market, by counterparty order
    const ord = (r: Rib) => nodes.findIndex((h) => h.code === r.holder);
    const nodeOff = new Map<string, number>(), poolOff = new Map<string, number>();
    const geom = new Map<string, { y0: number; y1: number; w: number }>();
    for (const r of [...ribbons].sort((a, b) => ord(a) - ord(b) || STACK.indexOf(a.group) - STACK.indexOf(b.group))) {
      const o = nodeOff.get(r.holder) ?? 0;
      geom.set(r.id, { y0: (ny.get(r.holder) ?? TOP) + o, y1: 0, w: r.value * k });
      nodeOff.set(r.holder, o + r.value * k);
    }
    for (const r of [...ribbons].sort((a, b) => ord(a) - ord(b))) {
      const p = r.pool ?? POOL_OF[r.group];
      const o = poolOff.get(p) ?? 0;
      geom.get(r.id)!.y1 = (py.get(p) ?? TOP) + o;
      poolOff.set(p, o + r.value * k);
    }
    const nLab = spread(nodes.map((n) => (ny.get(n.code) ?? TOP) + ((nodeSum.get(n.code) ?? 0) * k) / 2 + Math.round(F.fs[0] * 0.36)), LINE, TOP + 4, BOTTOM + 2);
    const pLab = spread(ps.map((p) => (py.get(p.id) ?? TOP) + ((poolSum.get(p.id) ?? 0) * k) / 2 - 2), PLINE, TOP + 8, BOTTOM - PLINE / 2 + 2);
    return { nodes, ps, k, ny, py, nodeSum, poolSum, geom, nLab, pLab };
  }, [holders, pools, ribbons, TOP, BOTTOM, LINE, PLINE, F.fs]);

  const apexMax = Math.max(1, ...apex.map((a) => a.value ?? 0));
  const madeMax = Math.max(1, ...made.map((a) => a.value ?? 0));
  const poolName = (r: Rib) => pools.find((p) => p.id === (r.pool ?? POOL_OF[r.group]))?.label ?? text.channel[r.group];
  const arrow = text.dir === 'in' ? '→' : '←';
  const ribTip = (r: Rib): TipContent => ({
    id: r.id,
    title: text.dir === 'in' ? `${r.label} → ${text.econ} · ${poolName(r)}` : `${text.econ} · ${poolName(r)} → ${r.label}`,
    rows: [{ value: text.money(text.flow ? r.flow : r.value), color: COLOR[r.group], hatch: r.holder === '_ni' || r.group === 'unsplit',
      label: text.flow ? `${text.tip.flow} (${r.kind === 'published' ? text.tip.published : text.tip.derived})` : r.share != null ? `${text.tip.share} ${r.share.toFixed(1)}%` : '' }],
    meta: [`${text.tip.period}: ${text.period(r.period, r.freq)}${r.rep ? ` · ${text.tip.reported}: ${r.rep}` : ''}`, r.desc, `${text.tip.rules}: ${r.rules.join(' ')}`],
  });
  const on = (id: string, c: TipContent) => {
    const b = t.bind(c);
    return { ...b, onMouseMove: (e: { clientX: number; clientY: number }) => { setHover(id); b.onMouseMove(e); }, onMouseLeave: () => { setHover(null); b.onMouseLeave(); },
      onFocus: (e: { currentTarget: Element }) => { setHover(id); b.onFocus(e); }, onBlur: () => { setHover(null); b.onBlur(); },
      onClick: (e: { clientX: number; clientY: number }) => { setHover(id); b.onClick(e); } };
  };
  const nodeTip = (n: NodeM) => {
    const sum = L.nodeSum.get(n.code) ?? 0;
    const full = `${n.label}${n.fc ? ' · FC' : n.fd ? ' · FD' : ''}`;
    const byCh = ribbons.filter((r) => r.holder === n.code);
    return { full, sum, c: { title: full, rows: [{ value: text.money(sum), label: byCh.length > 1 ? `${text.tip.total} (${byCh.map((r) => text.channel[r.group]).join(' + ')})` : text.tip.total },
      ...(byCh.length > 1 ? byCh.map((r) => ({ value: text.money(r.value), label: text.channel[r.group], color: COLOR[r.group] })) : [])] } as TipContent };
  };
  const poolTip = (p: PoolM): TipContent => ({ title: p.label, rows: [{ value: p.total != null ? text.money(p.total) : text.money(L.poolSum.get(p.id) ?? 0), label: p.note, color: COLOR[p.id] }] });
  const rung = text.dir === 'in' ? ['var(--seq-700)', 'var(--seq-500)', 'var(--seq-300)'] : ['var(--div-neg-3)', 'var(--div-neg-2)', 'var(--div-neg-1)'];
  const vars = { ['--lfs' as string]: `${F.fs[0]}px`, ['--lfs-s' as string]: `${F.fs[1]}px`, ['--lfs-xs' as string]: `${F.fs[2]}px` };

  return (
    <div className={`mf-ladder mf-ladder--${size.mode}`} ref={t.ref} onKeyDown={(e) => { if (e.key === 'Escape') { setHover(null); t.hide(); } }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={size.mode === 'full' ? undefined : W} height={size.mode === 'full' ? undefined : H} role="img" aria-label={text.aria}
        className="mf-ladder__svg" preserveAspectRatio="xMidYMid meet" style={vars}>
        <defs>
          <pattern id="mf-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--surface)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--viz-context)" strokeWidth="2" />
          </pattern>
        </defs>
        {/* the rungs: column headers on an ordered tint (blue for inflows, orange for outflows), top to ground; the arrow is the direction */}
        <rect x={0} y={0} width={HX + NW + 16} height={4} fill={rung[0]} />
        <rect x={HX + NW + 18} y={0} width={PX - HX - NW - 30} height={4} fill={rung[1]} />
        <rect x={PX - 10} y={0} width={W - PX + 10} height={4} fill={rung[2]} />
        {phone ? null : <text x={0} y={F.RY} className="mf-rung">{text.rungs.global}</text>}
        <text x={phone ? HX + NW + 4 : HX + NW + 18} y={F.RY} className="mf-rung">{text.rungs.country}</text>
        <text x={PX - 10} y={F.RY} className="mf-rung">{text.rungs.market}</text>
        {phone ? null : <text x={HX + NW + 4} y={F.RY} textAnchor="middle" className="mf-rung" aria-hidden>{arrow}</text>}
        <text x={PX - 22} y={F.RY} textAnchor="middle" className="mf-rung" aria-hidden>{arrow}</text>

        {size.mode === 'full' ? <>
          {/* the global rung: the issuing central banks, on their own scale */}
          {apex.length ? <text x={0} y={40} className="mf-axis">{text.apex}</text> : null}
          {apex.slice(0, 6).map((a, i) => {
            const y = 50 + i * 18;
            const w = Math.max(1, ((a.value ?? 0) / apexMax) * 110);
            return (
              <g key={a.id}>
                <text x={0} y={y + 3} className="mf-label">{clip(a.label, 22)}</text>
                <rect x={112} y={y - 5} width={w} height={8} rx={2} fill="var(--viz-focus)" opacity={0.85} />
                <text x={228} y={y + 3} className="mf-value">{text.fmt(a.value)}<tspan className="mf-axis"> {a.period}</tspan></text>
              </g>
            );
          })}
          {/* the border: the IIP items this direction belongs to, then the money made at home (layer 2 as an outline, R9) */}
          <text x={HX + NW + 18} y={40} className="mf-axis">{text.border}</text>
          {text.borderItems.map((b, i) => (
            <g key={b.label}>
              <text x={HX + NW + 18} y={56 + i * 15} className="mf-label">{b.label}</text>
              <text x={BX + 24} y={56 + i * 15} textAnchor="end" className="mf-value">{b.value}</text>
            </g>
          ))}
          {made.length ? <text x={BX + 44} y={40} className="mf-axis">{text.made}</text> : null}
          {made.slice(0, 8).map((m, i) => {
            const y = 54 + i * 14;
            const w = Math.max(1, ((m.value ?? 0) / madeMax) * 34);
            return (
              <g key={m.id}>
                <text x={BX + 44} y={y} className="mf-tick">{clip(m.label, 16)}</text>
                <text x={BX + 150} y={y} textAnchor="end" className="mf-value">{text.fmt(m.value)}</text>
                <rect x={BX + 156} y={y - 6} width={w} height={6} rx={1} fill={m.dashed ? 'none' : m.layer === 0 ? 'var(--viz-focus)' : 'var(--viz-context)'}
                  stroke={m.dashed ? 'var(--ink-muted)' : 'none'} strokeDasharray={m.dashed ? '3 2' : undefined} />
              </g>
            );
          })}
        </> : null}

        {/* ribbons, crossing the border */}
        <g>
          {ribbons.map((r) => {
            const g = L.geom.get(r.id);
            if (!g || g.w <= 0) return null;
            const hatched = r.holder === '_ni' || r.group === 'unsplit' || r.holder === '_fdi' || r.holder === '_res';
            const dim = hover && hover !== r.id && hover !== `n:${r.holder}` && hover !== `p:${r.pool ?? POOL_OF[r.group]}`;
            const negative = text.flow && r.flow != null && r.flow < 0;
            const derived = text.flow && r.kind === 'derived';
            const overlay = r.group === 'bank_nat';                // the nationality overlay (J5): outlined, never a solid part of the stack
            const fill = negative ? 'none' : hatched ? 'url(#mf-hatch)' : COLOR[r.group];
            const lit = hover === r.id;
            return (
              <path key={r.id} d={ribbonPath(HX + NW, g.y0, PX, g.y1, g.w)} fill={fill}
                fillOpacity={hatched ? 1 : overlay ? 0.2 : r.holder === '_other' ? 0.45 : 0.72} stroke={lit ? 'var(--centerline)' : negative || derived || overlay ? COLOR[r.group] : hatched ? 'var(--viz-context)' : 'var(--surface)'}
                strokeWidth={lit ? 2 : negative || derived || overlay ? 1.5 : 0.5} strokeDasharray={(derived || overlay) && !lit ? '4 3' : undefined}
                opacity={dim ? 0.18 : 1} tabIndex={0} role="img" className="mf-ribbon"
                aria-label={`${ribTip(r).title}: ${text.money(text.flow ? r.flow : r.value)}, ${text.period(r.period, r.freq)}`}
                {...on(r.id, ribTip(r))} />
            );
          })}
        </g>
        <line x1={BX} x2={BX} y1={TOP - 8} y2={BOTTOM} stroke="var(--ink-muted)" strokeDasharray="6 4" pointerEvents="none" />

        {/* counterparty nodes, labels beside them (on phones a number, the names in the list below) */}
        {L.nodes.map((n, i) => {
          const y = L.ny.get(n.code) ?? TOP;
          const h = Math.max((L.nodeSum.get(n.code) ?? 0) * L.k, 1);
          const ly = L.nLab[i];
          const { full, sum, c } = nodeTip(n);
          const lit = hover === `n:${n.code}`;
          return (
            <g key={n.code} {...on(`n:${n.code}`, c)} tabIndex={0} className="mf-hit" role="img" aria-label={`${full}: ${text.money(sum)}`}>
              <rect x={HX} y={y} width={NW} height={h} rx={2} fill={n.kind === 'ni' ? 'url(#mf-hatch)' : lit ? 'var(--centerline)' : 'var(--ink)'} opacity={n.kind === 'holder' || lit ? 0.9 : 0.6} stroke={n.kind === 'ni' ? 'var(--viz-context)' : 'none'} />
              {n.fc || n.fd ? <line x1={HX - 3} x2={HX - 3} y1={y} y2={y + h} stroke="var(--ink-muted)" strokeDasharray={n.fc ? '2 2' : '4 2'} /> : null}
              {Math.abs(ly - 4 - (y + h / 2)) > 3 ? <path d={`M${HX - 6},${ly - 4} L${HX - 1},${y + h / 2}`} stroke="var(--line-strong)" fill="none" /> : null}
              <rect x={HX - F.hitN} y={ly - LINE + 3} width={F.hitN} height={LINE} fill="transparent" />
              {phone
                ? <text x={HX - 8} y={ly} textAnchor="end" className="mf-label mf-halo">{i + 1}</text>
                : <text x={HX - 8} y={ly} textAnchor="end" className="mf-label">{clip(full, F.clipN)}<tspan dx={6} className="mf-value">{text.fmt(sum)}</tspan></text>}
            </g>
          );
        })}

        {/* market nodes, labels beside them */}
        {L.ps.map((p, i) => {
          const y = L.py.get(p.id) ?? TOP;
          const h = Math.max((L.poolSum.get(p.id) ?? 0) * L.k, 1);
          const ly = L.pLab[i];
          const c = poolTip(p);
          const line2 = F.fs[0] + 2;
          return (
            <g key={p.id} {...on(`p:${p.id}`, c)} tabIndex={0} className="mf-hit" role="img" aria-label={`${p.label}: ${c.rows![0].value}, ${p.note}`}>
              <rect x={PX} y={y} width={NW} height={h} rx={2} fill={p.id === 'portfolio_ns' || p.id === '_other' ? 'url(#mf-hatch)' : COLOR[p.id] ?? 'var(--ink)'} opacity={COLOR[p.id] ? 1 : 0.85} />
              {Math.abs(ly + 2 - (y + h / 2)) > 3 ? <path d={`M${PX + NW + 1},${y + h / 2} L${PX + NW + 6},${ly - 3}`} stroke="var(--line-strong)" fill="none" /> : null}
              <rect x={PX + NW} y={ly - F.fs[0]} width={W - PX - NW} height={PLINE - 2} fill="transparent" />
              <text x={PX + NW + 8} y={ly} className="mf-label">{clip(p.label, F.clipP)}
                <tspan x={PX + NW + 8} dy={line2} className="mf-value">{text.poolValue(p)}</tspan>{phone ? null : <tspan dx={6} className="mf-axis">{size.mode === 'full' ? p.note : clip(p.note, F.clipP - units(text.poolValue(p)) - 2)}</tspan>}
              </text>
            </g>
          );
        })}
      </svg>
      {phone ? (
        <div className="mf-ladlist">
          <h3 className="mf-ladlist__h">{text.holdersList}</h3>
          <ol className="mf-ladlist__list">
            {L.nodes.map((n, i) => {
              const { full, sum, c } = nodeTip(n);
              const chs = ribbons.filter((r) => r.holder === n.code);
              return (
                <li key={n.code}>
                  <button type="button" className={`mf-ladlist__item${hover === `n:${n.code}` ? ' is-on' : ''}`} aria-pressed={hover === `n:${n.code}`}
                    onClick={(e) => { setHover(`n:${n.code}`); t.place(e.currentTarget, c); }}>
                    <span className="mf-ladlist__no">{i + 1}</span>
                    <span className="mf-ladlist__name">{full}</span>
                    <b className="mf-ladlist__v">{text.fmt(sum)}</b>
                    <span className="mf-ladlist__bar" aria-hidden>{chs.map((r) => <i key={r.id} style={{ flexGrow: r.value, background: COLOR[r.group] }} />)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <h3 className="mf-ladlist__h">{text.marketsList}</h3>
          <ul className="mf-ladlist__list">
            {L.ps.map((p) => (
              <li key={p.id}>
                <button type="button" className={`mf-ladlist__item${hover === `p:${p.id}` ? ' is-on' : ''}`} aria-pressed={hover === `p:${p.id}`}
                  onClick={(e) => { setHover(`p:${p.id}`); t.place(e.currentTarget, poolTip(p)); }}>
                  <span className="mf-ladlist__sw" style={{ background: COLOR[p.id] ?? 'var(--viz-context)' }} aria-hidden />
                  <span className="mf-ladlist__name">{p.label}<span className="mf-ladlist__note">{p.note}</span></span>
                  <b className="mf-ladlist__v">{text.poolValue(p) || text.fmt(L.poolSum.get(p.id) ?? 0)}</b>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {t.box}
    </div>
  );
}

/** The rung panels as HTML beside the screen chart: the issuing central banks (global rung), the border items and the
 *  money made at home (country rung). The exported figure draws the same panels inside the SVG. */
export function RungPanels({ apex, made, text, src, source }: { apex: Bar[]; made: Bar[]; text: LadderText; src?: { apex?: ReactNode; border?: ReactNode; made?: ReactNode }; source?: string }) {
  const foot = (n?: ReactNode) => (n ? <p className="mf-rungs__src">{source}{n}</p> : null);
  const apexMax = Math.max(1, ...apex.map((a) => a.value ?? 0));
  const madeMax = Math.max(1, ...made.map((a) => a.value ?? 0));
  return (
    <div className="mf-rungs">
      {apex.length ? (
        <section className="mf-rungs__col" aria-label={text.apex}>
          <h3 className="mf-rungs__h"><span className="mf-rungs__rung">{text.rungs.global}</span>{text.apex}</h3>
          <ul className="mf-rungs__list">
            {apex.slice(0, 6).map((a) => (
              <li key={a.id}><span className="mf-rungs__name">{a.label}</span><b>{text.fmt(a.value)}</b><span className="mf-rungs__per">{a.period}</span>
                <span className="mf-rungs__bar" aria-hidden><i style={{ width: `${(100 * Math.max(0, a.value ?? 0)) / apexMax}%`, background: 'var(--viz-focus)' }} /></span></li>
            ))}
          </ul>
          {foot(src?.apex)}
        </section>
      ) : null}
      <section className="mf-rungs__col" aria-label={text.border}>
        <h3 className="mf-rungs__h"><span className="mf-rungs__rung">{text.rungs.country}</span>{text.border}</h3>
        <ul className="mf-rungs__list">
          {text.borderItems.map((b) => <li key={b.label}><span className="mf-rungs__name">{b.label}</span><b>{b.value}</b></li>)}
        </ul>
        {foot(src?.border)}
      </section>
      {made.length ? (
        <section className="mf-rungs__col" aria-label={text.made}>
          <h3 className="mf-rungs__h"><span className="mf-rungs__rung">{text.rungs.country}</span>{text.made}</h3>
          <ul className="mf-rungs__list">
            {made.slice(0, 8).map((m) => (
              <li key={m.id}><span className="mf-rungs__name">{m.label}</span><b>{text.fmt(m.value)}</b><span className="mf-rungs__per">{m.period}</span>
                <span className="mf-rungs__bar" aria-hidden><i className={m.dashed ? 'is-dashed' : undefined}
                  style={{ width: `${(100 * Math.max(0, m.value ?? 0)) / madeMax}%`, background: m.dashed ? 'none' : m.layer === 0 ? 'var(--viz-focus)' : 'var(--viz-context)' }} /></span></li>
            ))}
          </ul>
          {foot(src?.made)}
        </section>
      ) : null}
    </div>
  );
}
