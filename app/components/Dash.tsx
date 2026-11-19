'use client';
// The dashboard's side rail and title block. The rail holds the detail a paper needs (coverage, sources, rules,
// checks, flows, Cite, terms) as sections that open and close in place: beside the chart on wide screens, below it on
// narrow ones, never a scrolling box of its own. From 1600px it folds to a 48px rail of icons (kept in localStorage).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './sn';

export interface RailSection { id: string; label: string; icon: string; content: ReactNode; open?: boolean; wideOpen?: boolean }

const KEY = 'mf-rail';

export function Rail({ label, sections, foot, lang }: { label: string; sections: RailSection[]; foot?: ReactNode; lang: string }) {
  const ko = lang === 'ko';
  const [folded, setFolded] = useState(false);
  const self = useRef<HTMLElement>(null);
  useEffect(() => {
    try { if (localStorage.getItem(KEY) === 'folded') setFolded(true); } catch { /* storage blocked: open */ }
    // wide screens open a few more sections at first; narrow ones only those marked open
    if (matchMedia('(min-width: 1024px)').matches) {
      for (const s of sections) if (s.wideOpen) self.current?.querySelector<HTMLDetailsElement>(`#rail-${s.id}`)?.setAttribute('open', '');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fold = (v: boolean) => {
    setFolded(v);
    try { localStorage.setItem(KEY, v ? 'folded' : 'open'); } catch { /* storage blocked: this visit only */ }
  };
  const go = (id: string) => {
    fold(false);
    requestAnimationFrame(() => {
      const d = self.current?.querySelector<HTMLDetailsElement>(`#rail-${id}`);
      if (!d) return;
      d.open = true;
      d.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      d.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
    });
  };
  return (
    <aside className="mf-rail" data-folded={folded} aria-label={label} ref={self}>
      <div className="mf-rail__bar">
        <button type="button" className="mf-rail__toggle" onClick={() => fold(!folded)} aria-expanded={!folded}
          aria-label={folded ? (ko ? '세부 패널 펼치기' : 'Open the detail panel') : (ko ? '세부 패널 접기' : 'Fold the detail panel')}>
          <Icon name={folded ? 'railOpen' : 'railClose'} size={20} />
        </button>
        {folded ? sections.map((s) => (
          <button key={s.id} type="button" className="mf-rail__icon" onClick={() => go(s.id)} aria-label={s.label} title={s.label}><Icon name={s.icon} size={20} /></button>
        )) : null}
      </div>
      <div className="mf-rail__body">
        {sections.map((s) => (
          <details key={s.id} id={`rail-${s.id}`} className="mf-rsec" open={s.open}>
            <summary className="mf-rsec__sum"><Icon name={s.icon} size={18} /><span className="mf-rsec__title">{s.label}</span><span className="mf-rsec__chev"><Icon name="chevron" size={18} /></span></summary>
            <div className="mf-rsec__body">{s.content}</div>
          </details>
        ))}
        {foot}
      </div>
    </aside>
  );
}

/** The page title: kicker, a headline of at most two lines and one line of status, the rest behind "More". */
export function TitleBlock({ kicker, title, status, tools, lang }: { kicker: ReactNode; title: string; status: ReactNode; tools?: ReactNode; lang: string }) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const h = useRef<HTMLHeadingElement>(null), p = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const check = () => setClipped([h.current, p.current].some((el) => !!el && el.scrollHeight > el.clientHeight + 1));
    check();
    const ro = new ResizeObserver(check);
    if (p.current) ro.observe(p.current);
    return () => ro.disconnect();
  }, []);
  return (
    <header className={`mf-dash__title mf-head${open ? ' is-open' : ''}`}>
      {kicker}
      <h1 className="mf-dash__h1" ref={h} title={title}>{title}</h1>
      {tools}
      <div className="mf-head__meta">
        <p className="mf-dash__status" ref={p}>{status}</p>
        {clipped || open ? <button type="button" className="mf-head__more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? (lang === 'ko' ? '접기' : 'Less') : (lang === 'ko' ? '더보기' : 'More')}</button> : null}
      </div>
    </header>
  );
}
