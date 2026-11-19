'use client';
// <Term id="w_r1">label</Term>: a term with a dotted underline and a small ⓘ that opens its glossary card (what it is,
// why it matters, how it is calculated, the threshold, an example from this release, sources). Click or tap opens
// it; on a desktop pointer, hovering previews it; Esc, the close button or a click outside closes it and focus returns
// to the term. On a phone the card is a bottom sheet. The cards come from the release (`gloss` in sovereign/global,
// written from config/sovereign_glossary.yaml); the sources are registry links (config/sources.yaml) so that every
// source named on the page is the publisher's own page. rich() in ./rich.tsx turns "[[id|label]]" in a string into terms.
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Gloss } from '@/lib/sovereign';
import type { Lang } from '@/lib/types';

/** A registry link as the client needs it (the server picks these out of registry/sources). */
export interface SrcRef { label: string; name: string; url: string }
interface Ctx { lang: Lang; gloss: Record<string, Gloss>; srcs: Record<string, SrcRef> }
const GlossCtx = createContext<Ctx | null>(null);

export function GlossProvider({ lang, gloss, srcs, children }: Ctx & { children: ReactNode }) {
  return <GlossCtx.Provider value={{ lang, gloss, srcs }}>{children}</GlossCtx.Provider>;
}

const W = {
  en: { what: 'What it is', read: 'How to read it', calc: 'How it is calculated', why: 'Why it matters', thr: 'Threshold', ex: 'Example', src: 'Source', close: 'Close', more: 'Explain', opens: 'opens in new tab' },
  ko: { what: '정의', read: '읽는 법', calc: '계산', why: '중요성', thr: '기준', ex: '예', src: '자료', close: '닫기', more: '설명', opens: '새 탭에서 열림' },
};
const PARTS = ['what', 'why', 'read', 'calc', 'thr', 'ex'] as const;

/** While a range slider is dragged no card opens, and an open one closes, so a card never covers the slider. */
let dragging = false;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement)?.matches?.('input[type=range]')) dragging = true; }, true);
  window.addEventListener('pointerup', () => { dragging = false; }, true);
  window.addEventListener('pointercancel', () => { dragging = false; }, true);
}

type Mode = null | 'peek' | 'open';

/** The sources of a card: registry links where the registry has the id (always, on a release that passed V17). */
export function GlossSources({ src, lang, srcs, inline }: { src: Gloss['src']; lang: Lang; srcs: Record<string, SrcRef>; inline?: boolean }) {
  const w = W[lang];
  return (
    <>{src.map((s, i) => {
      const e = srcs[s.src];
      const series = s.series?.length ? <span className="mf-mono mf-muted"> {s.series.join(', ')}</span> : null;
      const period = s.period ? <span className="mf-muted"> · {s.period}</span> : null;
      return (
        <span key={`${s.src}${i}`} className={inline ? undefined : 'mf-sov-gloss__src'}>
          {i && inline ? '; ' : ''}
          {e ? <a className="mf-srcl" href={e.url} target="_blank" rel="noopener noreferrer" data-src={s.src} aria-label={`${e.name} — ${w.opens}`}>{e.label}</a> : <span>{s.src}</span>}
          {series}{period}
        </span>
      );
    })}</>
  );
}

/** The body of one card, shared by the popover and the Method tab's list. */
export function GlossBody({ g, lang, srcs }: { g: Gloss; lang: Lang; srcs: Record<string, SrcRef> }) {
  const w = W[lang];
  return (
    <>
      {PARTS.map((k) => (g[k] ? (
        <span className="mf-sov-gloss__sec" key={k}><span className="mf-sov-gloss__k">{w[k]}</span><span className="mf-sov-gloss__v">{g[k]}
          {k === 'calc' && g.formula ? <code className="mf-sov-gloss__formula">{g.formula}</code> : null}</span></span>
      ) : null))}
      {g.src.length > 0 ? <span className="mf-sov-gloss__sec"><span className="mf-sov-gloss__k">{w.src}</span><span className="mf-sov-gloss__v"><GlossSources src={g.src} lang={lang} srcs={srcs} inline /></span></span> : null}
    </>
  );
}

export function Term({ id, children }: { id: string; children?: ReactNode }) {
  const info = useContext(GlossCtx);
  const g = info?.gloss[id];
  const lang = info?.lang ?? 'en';
  const [mode, setMode] = useState<Mode>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; sheet: boolean } | null>(null);
  const trig = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | null>(null);
  const quiet = useRef(false); // focus handed back after Esc or the close button must not reopen the card
  const uid = useId();

  const place = useCallback(() => {
    const t = trig.current;
    if (!t) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (vw < 560) { setPos({ left: 0, top: 0, width: vw, sheet: true }); return; }
    const r = t.getBoundingClientRect();
    const width = Math.min(380, vw - 32);
    const left = Math.max(16, Math.min(r.left, vw - width - 16));
    const h = card.current?.offsetHeight ?? 260;
    const below = r.bottom + 8;
    const top = below + h > vh - 8 && r.top - 8 - h > 8 ? r.top - 8 - h : Math.min(below, Math.max(8, vh - h - 8));
    setPos({ left, top, width, sheet: false });
  }, []);

  useLayoutEffect(() => { if (mode) place(); }, [mode, place]);

  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setMode(null); quiet.current = true; trig.current?.focus(); } };
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (trig.current?.contains(n) || card.current?.contains(n)) return;
      setMode(null);
    };
    const onMove = () => place();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [mode, place]);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  if (!g) return <>{children}</>;
  const canHover = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const clear = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null; } };
  const peek = () => { if (!canHover() || mode === 'open' || dragging) return; clear(); timer.current = window.setTimeout(() => setMode((m) => m ?? 'peek'), 250); };
  const unpeek = () => { clear(); if (mode === 'peek' || mode === null) timer.current = window.setTimeout(() => setMode((m) => (m === 'peek' ? null : m)), 180); };
  const toggle = () => { clear(); setMode((m) => (m === 'open' ? null : 'open')); };
  const w = W[lang];
  const cardId = `mf-term-${uid.replace(/:/g, '')}`;

  return (
    <span className="mf-term">
      <span ref={trig} className="mf-term__label" role="button" tabIndex={0} aria-expanded={mode === 'open'} aria-controls={mode ? cardId : undefined} aria-describedby={mode === 'peek' ? cardId : undefined}
        aria-label={`${typeof children === 'string' ? children : g.term}: ${w.more}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
        onMouseEnter={peek} onMouseLeave={unpeek}
        onFocus={(e) => { if (quiet.current) { quiet.current = false; return; } if (!dragging && e.currentTarget.matches(':focus-visible')) setMode((m) => m ?? 'peek'); }}
        onBlur={(e) => { if (!card.current?.contains(e.relatedTarget as Node)) setMode((m) => (m === 'peek' ? null : m)); }}>
        {children ?? g.term}<span className="mf-term__i" aria-hidden="true">ⓘ</span>
      </span>
      {mode && (
        <span ref={card} id={cardId} role={mode === 'open' ? 'dialog' : 'tooltip'} aria-label={g.term}
          className={`mf-sov-gloss${pos?.sheet ? ' is-sheet' : ''}${mode === 'peek' ? ' is-peek' : ''}`}
          style={pos && !pos.sheet ? { left: pos.left, top: pos.top, width: pos.width } : pos?.sheet ? undefined : { visibility: 'hidden' }}
          onMouseEnter={clear} onMouseLeave={unpeek} onClick={(e) => e.stopPropagation()}>
          <span className="mf-sov-gloss__head">
            <span className="mf-sov-gloss__term">{g.term}</span>
            {mode === 'open' && <button type="button" className="mf-sov-gloss__close" onClick={() => { setMode(null); quiet.current = true; trig.current?.focus(); }} aria-label={w.close}>×</button>}
          </span>
          <GlossBody g={g} lang={lang} srcs={info?.srcs ?? {}} />
        </span>
      )}
    </span>
  );
}
