'use client';
// The filter row (Sinho Dashboards §: one row that scopes everything below and writes the URL). It holds the
// economy filter, the view settings and the day, with playback a quarter at a time. The page is
// rendered on the server for each state, so a citation of the URL always reproduces the view. It is a signboard
// (Sinho `deep`): the selected segment and the scrubber are the centre-line yellow. On phones the row folds into a
// 44px summary bar that stays under the header and opens the full controls in a bottom sheet.
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Icon } from './sn';
import { SegmentedControl } from './sn/client';

type Opt = { value: string; label: string };

function useQuery() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (changes: Record<string, string | null>, replace = false) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) { if (v == null || v === '') q.delete(k); else q.set(k, v); }
    const s = q.toString();
    start(() => (replace ? router.replace : router.push)(`${path}${s ? `?${s}` : ''}`, { scroll: false }));
  };
  return { sp, set, pending, router };
}

export function FilterRow({ lang, economy, economies, economyLabel, controls, day, links }: {
  lang: string; economy?: string; economies?: Opt[]; economyLabel?: string;
  controls: { key: string; label: string; value: string; options: Opt[]; def: string }[];
  day?: { d: string; min: string; max: string; label: string; play: string; pause: string; step?: number; note?: string };
  links?: { label: string; value: string; options: (Opt & { href: string })[] };
}) {
  const { set, pending, sp, router } = useQuery();
  const [open, setOpen] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const [wrapped, setWrapped] = useState(false);
  const ko = lang === 'ko';
  // the strip stays under the header only while it is one row
  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const check = () => {
      const kids = [...el.children].filter((k) => (k as HTMLElement).offsetParent !== null) as HTMLElement[];
      setWrapped(kids.length > 1 && kids.some((k) => k.offsetTop > kids[0].offsetTop + 8));
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement, prev = html.style.overflow;
    html.style.overflow = 'hidden';
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    sheet.current?.querySelector<HTMLElement>('select, [role=radio][tabindex="0"], button')?.focus();
    return () => { html.style.overflow = prev; document.removeEventListener('keydown', esc); };
  }, [open]);
  const summary = [
    economies && economy ? economies.find((o) => o.value === economy)?.label ?? economy : null,
    links ? links.options.find((o) => o.value === links.value)?.label ?? null : null,
    ...controls.map((c) => c.options.find((o) => o.value === c.value)?.label ?? c.value),
    day ? day.d : null,
  ].filter(Boolean) as string[];
  const title = ko ? '필터' : 'Filters';
  return (
    <div className={`mf-fbar${open ? ' is-open' : ''}`}>
      <button type="button" className="mf-fsum" aria-expanded={open} aria-controls="mf-filters" onClick={() => setOpen(true)}>
        <span className="mf-fsum__icon"><Icon name="sliders" size={18} /><span className="mf-sr">{title}: </span></span>
        <span className="mf-fsum__chips">{summary.map((x, i) => <span key={i} className="mf-fsum__chip">{day && x === day.d && day.d >= day.max ? <span className="mf-led" aria-hidden /> : null}{x}</span>)}</span>
      </button>
      {open ? <div className="mf-fscrim" onClick={() => setOpen(false)} aria-hidden /> : null}
      <div id="mf-filters" ref={sheet} className={`mf-filters${pending ? ' is-pending' : ''}${wrapped ? ' is-wrapped' : ''}`} role={open ? 'dialog' : 'group'} aria-modal={open || undefined} aria-label={title}>
        <div className="mf-filters__head">
          <span className="mf-filters__title">{title}</span>
          <button type="button" className="mf-filters__close" onClick={() => setOpen(false)} aria-label={ko ? '닫기' : 'Close'}><Icon name="close" size={20} /></button>
        </div>
        {economies && economy ? (
          <div className="sn-field mf-field mf-field--econ">
            <label className="sn-field__label" htmlFor="mf-econ">{economyLabel}</label>
            <div className="sn-select">
              <select id="mf-econ" className="sn-input sn-select__el" value={economy} onChange={(e) => {
                const q = sp.toString();
                router.push(`/${lang}/e/${e.target.value}${q ? `?${q}` : ''}`);
              }}>
                {economies.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <span className="sn-select__chev"><Icon name="chevron" size={18} /></span>
            </div>
          </div>
        ) : null}
        {links ? (
          <div className="sn-field mf-field" title={links.label}>
            <span className="sn-field__label">{links.label}</span>
            <SegmentedControl label={links.label} value={links.value} options={links.options} onChange={(v) => {
              const o = links.options.find((x) => x.value === v);
              if (o) router.push(`${o.href}${sp.get('d') ? `?d=${sp.get('d')}` : ''}`);
            }} />
          </div>
        ) : null}
        {controls.length ? (
          <div className="mf-fgroup">
            {controls.map((c) => (
              <div className={`sn-field mf-field mf-field--${c.key}`} key={c.key} title={c.label}>
                <span className="sn-field__label">{c.label}</span>
                <SegmentedControl label={c.label} value={c.value} options={c.options} onChange={(v) => set({ [c.key]: v === c.def ? null : v })} />
              </div>
            ))}
          </div>
        ) : null}
        {day ? <DayControl {...day} latest={ko ? '최신' : 'Latest'} commit={(d) => set({ d: d >= day.max ? null : d }, true)} /> : null}
      </div>
    </div>
  );
}

function DayControl({ d, min, max, label, play, pause, step = 91, note, latest, commit }: { d: string; min: string; max: string; label: string; play: string; pause: string; step?: number; note?: string; latest: string; commit: (d: string) => void }) {
  const t0 = Date.parse(min);
  const toIdx = (x: string) => Math.round((Date.parse(x) - t0) / 86400000);
  const toDay = (i: number) => new Date(t0 + i * 86400000).toISOString().slice(0, 10);
  const n = toIdx(max);
  const [i, setI] = useState(toIdx(d));
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => setI(toIdx(d)), [d]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!playing) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setPlaying(false); return; }
    timer.current = window.setInterval(() => {
      setI((j) => {
        const next = Math.min(n, j + step);
        commit(toDay(next));
        if (next >= n) setPlaying(false);
        return next;
      });
    }, 900);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="sn-field mf-field mf-field--day">
      <label className="sn-field__label" htmlFor="mf-day">{label}</label>
      <div className="mf-dayctl">
        <button type="button" className="sn-btn sn-btn--deep sn-btn--sm mf-play" aria-pressed={playing} onClick={() => { if (!playing && i >= n) setI(0); setPlaying(!playing); }}>{playing ? pause : play}</button>
        <input id="mf-day" className="mf-range" type="range" min={0} max={n} step={1} value={i} onChange={(e) => setI(Number(e.target.value))}
          style={{ ['--p' as string]: `${n ? (100 * i) / n : 100}%` }}
          onPointerUp={() => commit(toDay(i))} onKeyUp={() => commit(toDay(i))} aria-valuetext={toDay(i)} />
        <output htmlFor="mf-day" className="mf-dayctl__out">{i >= n ? <span className="mf-led" title={latest}><span className="mf-sr">{latest} </span></span> : null}{toDay(i)}</output>
        {note ? <span className="mf-dayctl__note">{note}</span> : null}
      </div>
    </div>
  );
}

/** Remembers the economy last viewed, so the Economy tab opens on it next time (a first-party cookie, a year). */
export function RememberEconomy({ code }: { code: string }) {
  useEffect(() => {
    try { document.cookie = `mf_econ=${code}; path=/; max-age=31536000; samesite=lax`; } catch { /* cookies blocked: the default economy */ }
  }, [code]);
  return null;
}
