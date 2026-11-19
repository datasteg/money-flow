'use client';
// The one tooltip every chart uses (Sinho .sn-tip). Hover shows it, a tap shows it on touch screens (a second tap
// elsewhere hides it), keyboard focus shows it at the mark, Escape hides it. The chart's wrapper is the positioning
// box: spread `ref` on it and `bind(content)` on each mark, and render `box` inside the wrapper. On phones (`sheet`) the
// content opens in a bottom sheet instead of floating over the mark, with a close button. A click pins the tip: it
// then stays when the pointer leaves the mark and takes pointer events, so a link inside it (the Markets cell's link to
// the global-network pair page) can be followed; a click elsewhere or Escape unpins and hides it.
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export interface TipRow { value: string; label?: string; color?: string; hatch?: boolean }
export interface TipContent { id?: string; title: ReactNode; rows?: TipRow[]; meta?: ReactNode[] }

type Pt = { clientX: number; clientY: number };

export function useTip(opts?: { sheet?: boolean; close?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; c: TipContent } | null>(null);
  const pinned = useRef(false);
  const hide = useCallback(() => { if (!pinned.current) setTip(null); }, []);
  const unpin = useCallback(() => { pinned.current = false; setTip(null); }, []);
  const place = useCallback((p: Pt | Element, c: TipContent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    if (p instanceof Element) { const b = p.getBoundingClientRect(); setTip({ x: b.left - box.left + b.width / 2, y: b.top - box.top + b.height / 2, c }); }
    else setTip({ x: p.clientX - box.left, y: p.clientY - box.top, c });
  }, []);
  useEffect(() => {
    if (!tip) return;
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) unpin(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') unpin(); };
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', esc); };
  }, [tip, unpin]);
  const bind = (c: TipContent) => ({
    onMouseMove: (e: Pt) => place(e, c),
    onMouseLeave: hide,
    onClick: (e: Pt) => { pinned.current = true; place(e, c); },
    onFocus: (e: { currentTarget: Element }) => place(e.currentTarget, c),
    onBlur: hide,
  });
  const w = ref.current?.clientWidth ?? 600, h = ref.current?.clientHeight ?? 400;
  const box = !tip ? null : opts?.sheet ? (
    <div className="mf-tipsheet" role="dialog" aria-label={typeof tip.c.title === 'string' ? tip.c.title : undefined}>
      <TipBox c={tip.c} />
      <button type="button" className="mf-tipsheet__close" onClick={hide} aria-label={opts.close ?? 'Close'}>×</button>
    </div>
  ) : <TipBox c={tip.c} left={Math.max(4, Math.min(tip.x + 14, w - 290))} top={tip.y > h - 150 ? Math.max(4, tip.y - 150) : tip.y + 14} pinned={pinned.current} />;
  return { ref, bind, box, hide, place, active: tip?.c ?? null };
}

export function TipBox({ c, left, top, pinned }: { c: TipContent; left?: number; top?: number; pinned?: boolean }) {
  return (
    <div className={`sn-tip mf-tip${pinned ? ' is-pinned' : ''}`} role="status" aria-live="polite" style={left == null ? undefined : { left, top }}>
      <p className="sn-tip__title">{c.title}</p>
      {c.rows?.map((r, i) => (
        <p className="sn-tip__row" key={i}>
          <span className={`sn-tip__key sn-tip__key--bar${r.hatch ? ' mf-tip__hatch' : ''}`} style={r.color && !r.hatch ? { background: r.color } : undefined} aria-hidden />
          <span className="sn-tip__value">{r.value}</span>
          <span className="sn-tip__label">{r.label ?? ''}</span>
        </p>
      ))}
      {c.meta?.filter(Boolean).map((m, i) => <p className="mf-tip__meta" key={i}>{m}</p>)}
    </div>
  );
}

/** A ranked horizontal bar list (the World and Markets panels): label and value on one line, the bar under it, and the
 *  shared tooltip on hover or tap with the full name, the value with its unit and the row's note. */
export function BarList({ rows, color }: {
  rows: { key: string; label: ReactNode; name: string; value: number | null; shown: string; full: string; note?: ReactNode; color?: string; tipNote?: string }[];
  color?: string;
}) {
  const t = useTip();
  const m = Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <div ref={t.ref} style={{ position: 'relative' }}>
      <ul className="mf-mini">
        {rows.map((r) => (
          <li key={r.key} {...t.bind({ title: r.name, rows: [{ value: r.full, label: r.tipNote ?? (typeof r.note === 'string' ? r.note : undefined), color: r.color ?? color ?? 'var(--viz-focus)' }] })} tabIndex={0}>
            {/* label and note may be elements made by a server page: each sits in its own keyed fragment, never as an
                unkeyed member of a sibling list (React asks for keys there, and a server element cannot be marked) */}
            <span><Fragment key="label">{r.label}</Fragment>{r.note ? <span key="note" className="mf-muted"> · <Fragment key="n">{r.note}</Fragment></span> : null}</span><b>{r.shown}</b>
            <span className="mf-mini__bar"><span style={{ width: `${(100 * Math.max(0, r.value ?? 0)) / m}%`, background: r.color ?? color ?? 'var(--viz-focus)' }} /></span>
          </li>
        ))}
      </ul>
      {t.box}
    </div>
  );
}
