'use client';
// The Sovereign section's charts: the signal-count timeline and one small multiple per rule, with episode bands,
// the threshold line, the projection hatch and a shared crosshair. Every chart shares the same year domain and the
// same left/right plot margins (PL, PR), so a hovered or pinned year sits at the same place in each. Ported from
// global-network's WarningApp (2 Nov 2026) onto Sinho tokens; the counting is lib/sovereign.ts, unchanged.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { num, period } from '@/lib/format';
import { RULES, countAt, fy, nowCount, nowState, stateAt, type Episode, type RuleId, type SEcon, type Settings, type SovereignClient } from '@/lib/sovereign';
import { sovereign as strings } from '@/lib/strings/sovereign';
import type { Lang } from '@/lib/types';
import { rich } from './rich';
import { Term } from './Term';

const CLIP: Record<RuleId, [number, number]> = { r1: [0, 260], r2: [-20, 12], r3: [-15, 25], r4: [-20, 20], r5: [-250, 400], r6: [0, 600], r7: [-3, 25] };
/** Shared plot margins, in pixels, of the timeline and every rule chart. */
export const PL = 36, PR = 8;

export function fmt(r: RuleId, v: number | null | undefined, lang: Lang, unit: string): string {
  if (v == null) return '–';
  if (unit === 'pp') return lang === 'ko' ? `${num(v, 'ko', 1)}%p` : `${num(v, 'en', 1)} pp`;
  if (r === 'r6' || r === 'r5') return `${num(v, lang, 0)}%`;
  return `${num(v, lang, 1)}%`;
}
export const yearLabel = (y: number, lang: Lang) => (lang === 'ko' ? `${y}년` : String(y));
export const monthLabel = (p: string | number | null | undefined, lang: Lang) => (p ? period(`${String(p).slice(0, 7)}-01`, 'M', lang) : '–');
export const up = (r: string) => r.toUpperCase();

function niceTicks(lo: number, hi: number, n = 3): number[] {
  const span = hi - lo || 1;
  const raw = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => span / s <= n + 0.5) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(8));
  return out;
}

/** The year domain is the same everywhere: from half a year before the first year to half a year after the last. */
function xOf(ys: number[], w: number) {
  const a = ys[0] - 0.5, b = ys[ys.length - 1] + 0.5;
  return (t: number) => PL + ((t - a) / (b - a)) * (w - PL - PR);
}
function yearAt(ys: number[], w: number, px: number): number | null {
  const a = ys[0] - 0.5, b = ys[ys.length - 1] + 0.5;
  const y = Math.round(a + ((px - PL) / (w - PL - PR)) * (b - a));
  return y >= ys[0] && y <= ys[ys.length - 1] ? y : null;
}

/** The pixel size of a box, so charts draw at their real size (crisp text, exact shared margins). */
function useSize(init: [number, number]) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number]>(init);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => { const w = el.clientWidth, h = el.clientHeight; if (w > 0 && h > 0) setSize((p) => (p[0] === w && p[1] === h ? p : [w, h])); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export interface Linked { hover: number | null; pin: number | null; setHover: (y: number | null) => void; setPin: (y: number | null) => void }

// ---------------------------------------------------------------- shared chart parts
/** Overlapping episodes of one type drawn as one band (Argentina's defaults run on several creditor groups at once). */
interface Band { type: Episode['type']; a: number; b: number; label: string }
function unionBands(eps: Episode[], endFy: number): Band[] {
  // a running episode reaches the end of the axis (fixed by the data, so the server and the browser draw the same width)
  const out: Band[] = [];
  for (const t of ['precautionary', 'default', 'eu', 'imf'] as const) {
    const xs = eps.filter((e) => e.type === t).map((e) => ({ a: fy(e.start), b: e.end ? fy(e.end) : endFy, l: `${e.en ?? e.facility ?? ''} ${e.start}–${e.end ?? ''}` })).sort((p, q) => p.a - q.a);
    for (const x of xs) {
      const last = out.length && out[out.length - 1].type === t ? out[out.length - 1] : null;
      if (last && x.a <= last.b) { last.b = Math.max(last.b, x.b); last.label += `\n${x.l}`; } else out.push({ type: t, a: x.a, b: x.b, label: x.l });
    }
  }
  return out;
}

function Bands({ eps, x, y0, y1, pid, endFy }: { eps: Episode[]; x: (v: number) => number; y0: number; y1: number; pid: string; endFy: number }) {
  const bands = useMemo(() => unionBands(eps, endFy), [eps, endFy]);
  return (
    <g>
      {bands.map((bd, k) => (<rect key={k} x={x(bd.a)} y={y0} width={Math.max(1.5, x(bd.b) - x(bd.a))} height={y1 - y0} className={`mf-sov-band mf-sov-band--${bd.type}`} fill={bd.type === 'precautionary' ? `url(#${pid})` : undefined}><title>{bd.label}</title></rect>))}
    </g>
  );
}

function Patterns({ uid }: { uid: string }) {
  return (
    <>
      <pattern id={`h${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" className="mf-sov-hatch" />
      </pattern>
      <pattern id={`p${uid}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="5" className="mf-sov-projhatch" />
      </pattern>
    </>
  );
}

/** Pointer handling shared by the timeline and the charts: hover follows the pointer, a click or tap pins the year. */
function usePointer(ys: number[], w: number, { setHover, setPin }: Pick<Linked, 'setHover' | 'setPin'>) {
  const at = (ev: React.PointerEvent<SVGSVGElement>) => { const box = ev.currentTarget.getBoundingClientRect(); return yearAt(ys, w, ((ev.clientX - box.left) / box.width) * w); };
  return {
    onPointerMove: (ev: React.PointerEvent<SVGSVGElement>) => { if (ev.pointerType === 'mouse') setHover(at(ev)); },
    onPointerLeave: (ev: React.PointerEvent<SVGSVGElement>) => { if (ev.pointerType === 'mouse') setHover(null); },
    onPointerUp: (ev: React.PointerEvent<SVGSVGElement>) => { const y = at(ev); if (y != null) setPin(y); if (ev.pointerType !== 'mouse') setHover(null); },
  };
}

function Cross({ x, hover, pin, y0, y1 }: { x: (v: number) => number; hover: number | null; pin: number | null; y0: number; y1: number }) {
  return (
    <>
      {pin != null && <line x1={x(pin)} x2={x(pin)} y1={y0} y2={y1} className="mf-sov-pinline" />}
      {hover != null && hover !== pin && <line x1={x(hover)} x2={x(hover)} y1={y0} y2={y1} className="mf-sov-cross" />}
    </>
  );
}

function XTicks({ ys, x, y, every = 10 }: { ys: number[]; x: (v: number) => number; y: number; every?: number }) {
  return <>{ys.filter((t) => t % every === 0).map((t) => (<text key={t} x={x(t)} y={y} textAnchor="middle" className="mf-sov-tick">{t}</text>))}</>;
}

// ---------------------------------------------------------------- the signal-count timeline
export function Timeline({ data, e, eps, s, lang, hover, pin, setHover, setPin }: { data: SovereignClient; e: SEcon; eps: Episode[]; s: Settings; lang: Lang } & Linked) {
  const S = strings(lang);
  const [ref, [w, h]] = useSize([900, 120]);
  const ys = data.years;
  const x = xOf(ys, w);
  const MT = 6, MB = 16, top = RULES.length;
  const y = (v: number) => MT + (1 - v / top) * (h - MT - MB);
  const counts = useMemo(() => ys.map((_, j) => countAt(data, e, j, s)), [data, e, s, ys]);
  const slot = (w - PL - PR) / ys.length;
  const bw = Math.max(2, slot * 0.64);
  const uid = useId().replace(/:/g, '');
  const ptr = usePointer(ys, w, { setHover, setPin });
  const at = hover ?? pin;
  const cj = at != null ? ys.indexOf(at) : -1;
  const now = nowCount(data, e, s);
  const read = cj >= 0
    ? `${yearLabel(at!, lang)}${at! >= data.proj0 ? ` (${S.projLabel})` : ''}: ${counts[cj].k}/${counts[cj].n}${counts[cj].on.length ? ` · ${counts[cj].on.map(up).join(' ')}` : ''}`
    : `${S.nowTitle}: ${now.k}/${now.n}${now.on.length ? ` · ${now.on.map(up).join(' ')}` : ''}`;
  return (
    <div className="mf-sov-tl">
      <div className="mf-sov-tl__head">
        <h3 className="mf-sov-h"><Term id="w_count">{S.timelineTitle}</Term></h3>
        <ul className="mf-sov-key">
          <li><span className="mf-sov-sw mf-sov-sw--hit" />{S.legend.count}</li>
          <li><span className="mf-sov-sw mf-sov-sw--k" />{S.legend.countBelow}</li>
          <li><span className="mf-sov-sw mf-sov-sw--n" />{S.timelineAvail}</li>
          <li><span className="mf-sov-sw mf-sov-sw--kline" />K = {s.K}</li>
          <li><span className="mf-sov-sw mf-sov-sw--proj" />{rich(`[[w_proj|${S.legend.proj}]]`)}</li>
        </ul>
        <span className="mf-sov-read mf-mono" aria-live="polite">{read}</span>
      </div>
      <div className="mf-sov-tl__plot" ref={ref}>
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${S.timelineTitle}: ${read}`} {...ptr}>
          <defs><clipPath id={`c${uid}`}><rect x={PL} y={0} width={Math.max(0, w - PL - PR)} height={h - MB + 1} /></clipPath><Patterns uid={uid} /></defs>
          <g clipPath={`url(#c${uid})`}>
            <Bands eps={eps} x={x} y0={MT} y1={h - MB} pid={`h${uid}`} endFy={ys[ys.length - 1] + 0.5} />
            <rect x={x(data.proj0 - 0.5)} y={MT} width={Math.max(0, w - PR - x(data.proj0 - 0.5))} height={h - MT - MB} fill={`url(#p${uid})`} />
            {pin != null && <rect x={x(pin - 0.5)} y={0} width={slot} height={h - MB} className="mf-sov-selcol" />}
            {[2, 4, 6].map((t) => (<line key={t} x1={PL} x2={w - PR} y1={y(t)} y2={y(t)} className="mf-sov-grid" />))}
            {ys.map((yy, j) => {
              const c = counts[j];
              const proj = yy >= data.proj0;
              return (
                <g key={yy}>
                  {c.n > 0 && <rect x={x(yy) - bw / 2} y={y(c.n)} width={bw} height={y(0) - y(c.n)} className="mf-sov-bar-n" />}
                  {c.k > 0 && <rect x={x(yy) - bw / 2} y={y(c.k)} width={bw} height={y(0) - y(c.k)} rx={1.5} className={`mf-sov-bar-k${c.k >= s.K ? ' is-hit' : ''}${proj ? ' is-proj' : ''}`} />}
                </g>
              );
            })}
            <line x1={PL} x2={w - PR} y1={y(0)} y2={y(0)} className="mf-sov-axis" />
            <line x1={PL} x2={w - PR} y1={y(s.K)} y2={y(s.K)} className="mf-sov-kline" />
            <Cross x={x} hover={hover} pin={pin} y0={0} y1={h - MB} />
          </g>
          {[0, s.K, top].filter((t, i, a) => a.indexOf(t) === i).map((t) => (<text key={t} x={PL - 5} y={y(t) + 3.5} textAnchor="end" className={`mf-sov-tick${t === s.K ? ' is-k' : ''}`}>{t === s.K ? `K ${t}` : t}</text>))}
          <XTicks ys={ys} x={x} y={h - 3} every={5} />
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- one rule's small multiple
export function RuleChart({ r, data, e, eps, s, lang, hover, pin, setHover, setPin, benchName }: { r: RuleId; data: SovereignClient; e: SEcon; eps: Episode[]; s: Settings; lang: Lang; benchName: string } & Linked) {
  const S = strings(lang);
  const cfg = data.rules[r];
  const uid = useId().replace(/:/g, '');
  const [ref, [w, h]] = useSize([300, 130]);
  const ys = data.years;
  const vals = e.v[r];
  const thr = s.thr[r];
  const x = xOf(ys, w);
  const ptr = usePointer(ys, w, { setHover, setPin });
  const allNa = e.na[r].every(Boolean);
  const off = s.off.includes(r);
  const monthly = r === 'r7' && e.spread.t0 ? e.spread.v.map((v, k) => [Number(e.spread.t0!.slice(0, 4)) + (Number(e.spread.t0!.slice(5, 7)) - 1 + k + 0.5) / 12, v] as [number, number | null]) : [];
  const empty = !vals.some((v) => v != null) && !monthly.some((m) => m[1] != null);
  const note = r === 'r4' ? S.r4note : r === 'r7' && !e.r7_bench_self ? S.r7note(benchName) : null;
  const head = (
    <figcaption className="mf-sov-chart__head">
      <span className="mf-sov-chart__t"><span className="mf-sov-fam">{S.groups[cfg.group]}</span> <Term id={`w_${r}`}>{`${up(r)} ${S.ruleShort[r]}`}</Term></span>
      <span className="mf-sov-chart__u">{rich(S.units[cfg.unit])}{note ? ` · ${note}` : ''}</span>
    </figcaption>
  );
  // A rule that does not apply, or has no data at all, is a compact grey tile, not an empty chart.
  if (allNa || empty) {
    return (
      <figure className="mf-sov-chart is-na">
        {head}
        <p className="mf-sov-chart__msg">{allNa ? (r === 'r6' ? S.naR6 : S.naR7) : S.noData}</p>
      </figure>
    );
  }
  const MT = 6, MB = 16;
  const inWin = monthly.filter((m) => m[0] >= ys[0] - 0.5);
  const present = [...vals, ...inWin.map((m) => m[1])].filter((v): v is number => v != null);
  const [c0, c1] = CLIP[r];
  let lo = Math.min(...present, thr, 0), hi = Math.max(...present, thr, 0);
  lo = Math.max(lo, c0); hi = Math.min(hi, c1);
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad; hi += pad;
  const y = (v: number) => MT + (1 - (Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * (h - MT - MB);
  const ticks = niceTicks(lo, hi, 3);
  const path = (from: number, to: number) => {
    let d = '', pen = false;
    for (let j = 0; j < ys.length; j++) {
      const yy = ys[j], v = vals[j];
      if (yy < from || yy > to || v == null) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${x(yy).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    }
    return d.trim();
  };
  const mpath = (() => { let d = '', pen = false; for (const [t, v] of monthly) { if (v == null) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)} `; pen = true; } return d.trim(); })();
  const at = hover ?? pin;
  const aj = at != null ? ys.indexOf(at) : -1;
  const av = aj >= 0 ? vals[aj] : null;
  const ast = aj >= 0 ? stateAt(data, e, r, aj, s) : null;
  const nv = e.now[r];
  const nst = nowState(data, e, r, s);
  const read = aj >= 0
    ? `${yearLabel(at!, lang)}: ${fmt(r, av, lang, cfg.unit)}${av != null && ast ? ` · ${S.state[ast]}` : ''}${at! >= data.proj0 && av != null ? ` (${S.projLabel})` : ''}`
    : `${S.nowTitle}: ${fmt(r, nv?.v, lang, cfg.unit)}${nv?.v != null ? ` · ${S.state[nst]}` : ''}`;
  return (
    <figure className={`mf-sov-chart${off ? ' is-dim' : ''}`}>
      {head}
      <span className={`mf-sov-chart__read mf-mono${ast === 'on' || (aj < 0 && nst === 'on') ? ' is-on' : ''}`} aria-live="polite">{off ? S.switchedOff : read}</span>
      <div className="mf-sov-chart__plot" ref={ref}>
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${up(r)} ${S.ruleShort[r]}: ${read}`} {...ptr}>
          <defs><clipPath id={`c${uid}`}><rect x={PL} y={0} width={Math.max(0, w - PL - PR)} height={h - MB + 1} /></clipPath><Patterns uid={uid} /></defs>
          <g clipPath={`url(#c${uid})`}>
            <Bands eps={eps} x={x} y0={MT} y1={h - MB} pid={`h${uid}`} endFy={ys[ys.length - 1] + 0.5} />
            <rect x={x(data.proj0 - 0.5)} y={MT} width={Math.max(0, w - PR - x(data.proj0 - 0.5))} height={h - MT - MB} className="mf-sov-projbg" />
            {ticks.map((t) => (<line key={t} x1={PL} x2={w - PR} y1={y(t)} y2={y(t)} className={t === 0 ? 'mf-sov-zero' : 'mf-sov-grid'} />))}
            {mpath && <path d={mpath} className="mf-sov-mline" />}
            <line x1={PL} x2={w - PR} y1={y(thr)} y2={y(thr)} className="mf-sov-thrline" />
            <path d={path(ys[0], data.proj0 - 1)} className="mf-sov-line" />
            <path d={path(data.proj0 - 1, ys[ys.length - 1])} className="mf-sov-line mf-sov-line--proj" />
            {ys.map((yy, j) => {
              const v = vals[j];
              if (v == null || stateAt(data, e, r, j, s) !== 'on') return null;
              return <circle key={yy} cx={x(yy)} cy={y(v)} r={3.2} className={`mf-sov-on${yy >= data.proj0 ? ' is-proj' : ''}`} />;
            })}
            {av != null && <circle cx={x(at!)} cy={y(av)} r={3.6} className="mf-sov-dot" />}
            <Cross x={x} hover={hover} pin={pin} y0={0} y1={h - MB} />
          </g>
          {ticks.map((t) => (<text key={t} x={PL - 5} y={y(t) + 3.5} textAnchor="end" className="mf-sov-tick">{num(t, lang, Math.abs(t) < 10 && t % 1 !== 0 ? 1 : 0)}</text>))}
          <XTicks ys={ys} x={x} y={h - 3} />
        </svg>
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------- legend
export function Legend({ lang }: { lang: Lang }) {
  const S = strings(lang);
  return (
    <ul className="mf-sov-legend__list">
      <li><span className="mf-sov-swl mf-sov-swl--line" />{S.legend.value}</li>
      <li><span className="mf-sov-swl mf-sov-swl--thr" />{rich(`[[w_threshold|${S.legend.thr}]]`)}</li>
      <li><span className="mf-sov-swl mf-sov-swl--on" />{S.legend.on}</li>
      <li><span className="mf-sov-swl mf-sov-swl--proj" />{rich(`[[w_proj|${S.legend.proj}]]`)}</li>
      {(['imf', 'eu', 'default', 'precautionary'] as const).map((k) => (<li key={k}><span className={`mf-sov-swl mf-sov-band--${k}`} />{rich(S.legend[k])}</li>))}
    </ul>
  );
}
