'use client';
// The Sovereign section, interactive part (money-flow's fourth dashboard; ported from global-network's Fiscal Stress
// Monitor on 2 Nov 2026). The title block names the economy and its count; under it a deep
// signboard (views, economy, K, year, reset, link) in the idiom of the other dashboards' filter row; then the "one
// economy" view: the scorecard (value, as-of, threshold editor, on/off switch and status per rule) beside one linked
// panel, the signal-count timeline over the seven rule charts. Hover draws the crosshair on all of them; a click pins
// the year (?y=), the scorecard switches to it, ← → move it, Esc goes back to the latest values. The other views
// (compare, past crises, method & sources) are tabs with #hash links. All counting is lib/sovereign.ts, unchanged;
// the URL carries e, r1..r7, off, k and y as global-network's page did, beside the release (?r=) untouched.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { CiteBlock } from '../CiteBlock';
import { Icon, Kicker, Notice } from '../sn';
import { SegmentedControl } from '../sn/client';
import { num } from '@/lib/format';
import { DEFAULT_ECONOMY, RULES, REG, countAt, defaults, fromUrl, mergedSearch, nowCount, nowState, ownQuery, readYear, stateAt, validate, type Episode, type RuleCfg, type RuleId, type SEcon, type Settings, type SovereignClient, type State } from '@/lib/sovereign';
import { sovereign as strings } from '@/lib/strings/sovereign';
import type { Lang } from '@/lib/types';
import { Legend, RuleChart, Timeline, fmt, monthLabel, up, yearLabel, type Linked } from './charts';
import { rich } from './rich';
import { Term } from './Term';

type Tab = 'one' | 'compare' | 'backtest' | 'method';
const TABS: Tab[] = ['one', 'compare', 'backtest', 'method'];
const GROUPS = ['fiscal', 'external', 'market'] as const;

export interface SovereignAppProps {
  data: SovereignClient; lang: Lang;
  /** The query the server saw (own keys only), so the first render matches the URL on both sides. */
  search: string;
  release: { tag: string; date: string; method: string; label: string; methodLabel: string };
  /** "Updated <time>", rendered on the server. */
  updated: ReactNode;
  cite: { labels: { title: string; copy: string; copied: string; note: string; bibtex: string; ris: string; datasets: string; method: string }; datasets: { name: string; text: string; bibtex: string }[]; method: { text: string; bibtex: string }; names: string[]; button: string };
  /** Server-rendered pieces: the release notice, "how to read", the source lines, the past-crises checks, the method tab. */
  notice: ReactNode; help: ReactNode; footRules: ReactNode; footEpisodes: ReactNode; backtest: ReactNode; method: ReactNode;
  vintage: string;
}

// ---------------------------------------------------------------- the app
export function SovereignApp({ data, lang, search, release, updated, cite, notice, help, footRules, footEpisodes, backtest, method, vintage }: SovereignAppProps) {
  const S = strings(lang);
  const [s, setS] = useState<Settings>(() => fromUrl(data, search));
  const [pin, setPin] = useState<number | null>(() => readYear(data, search));
  const [hover, setHover] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('one');
  const [sheet, setSheet] = useState(false);
  const [copied, setCopied] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const ready = useRef(false);

  useEffect(() => {
    const fromHash = () => { const h = window.location.hash.slice(1) as Tab; setTab(TABS.includes(h) ? h : 'one'); };
    fromHash();
    ready.current = true;
    window.addEventListener('hashchange', fromHash);
    window.addEventListener('popstate', fromHash);
    return () => { window.removeEventListener('hashchange', fromHash); window.removeEventListener('popstate', fromHash); };
  }, []);
  useEffect(() => {
    if (!ready.current) return;
    const id = window.setTimeout(() => window.history.replaceState(window.history.state, '', `${window.location.pathname}${mergedSearch(data, s, pin, window.location.search)}${window.location.hash}`), 150);
    return () => window.clearTimeout(id);
  }, [s, pin, data]);

  // ← → move the pinned year, Esc returns to the latest values; not while typing, on a slider, or in a dialog.
  useEffect(() => {
    const ys = data.years;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const el = ev.target as HTMLElement | null;
      if (el?.closest?.('input, select, textarea, [contenteditable="true"], [role="dialog"], [role="listbox"], details[open]')) return;
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        ev.preventDefault();
        const left = ev.key === 'ArrowLeft';
        setPin((p) => (p == null ? (left ? data.last_actual : data.proj0) : Math.min(ys[ys.length - 1], Math.max(ys[0], p + (left ? -1 : 1)))));
      } else if (ev.key === 'Escape') { setPin(null); setHover(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data]);

  const go = useCallback((t: Tab, scroll = false) => {
    window.history.pushState(window.history.state, '', `${window.location.pathname}${window.location.search}#${t}`);
    setTab(t);
    if (scroll) top.current?.scrollIntoView({ block: 'start' });
  }, []);

  const e = data.econ[s.e];
  const eps = useMemo(() => data.episodes.filter((x) => x.eco === s.e), [data, s.e]);
  const nameOf = (c: string) => data.names[c]?.[lang] ?? c;
  const valid = useMemo(() => validate(data, s), [data, s]);
  const setThr = (r: RuleId, v: number) => setS((p) => ({ ...p, thr: { ...p.thr, [r]: v } }));
  const toggle = (r: RuleId) => setS((p) => ({ ...p, off: p.off.includes(r) ? p.off.filter((x) => x !== r) : [...p.off, r] }));
  const setK = (K: number) => setS((p) => ({ ...p, K }));
  const pick = (c: string) => { setS((p) => ({ ...p, e: c })); setHover(null); };
  const reset = () => setS((p) => ({ ...defaults(data), e: p.e }));
  const copy = () => { try { void navigator.clipboard.writeText(window.location.href); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } };
  const L: Linked = { hover, pin, setHover, setPin };

  // the headline: the pinned year's count, else the latest values
  const j = pin != null ? data.years.indexOf(pin) : -1;
  const c = j >= 0 ? countAt(data, e, j, s) : nowCount(data, e, s);
  const when = j >= 0 ? `${yearLabel(pin!, lang)}${pin! >= data.proj0 ? (lang === 'ko' ? `, ${S.projLabel}` : ` (${S.projLabel})`) : ''}` : (lang === 'ko' ? '최신 값' : 'latest values');
  const headline = c.n > 0 ? S.headline(nameOf(s.e), c.k, c.n, when, c.k >= s.K) : S.headlineNone(nameOf(s.e));
  const viewCite = { lang, title: lang === 'ko' ? `국가 재정 스트레스 신호 ${nameOf(s.e)}` : `Sovereign stress signals: ${nameOf(s.e)}`, key: `sovereign-${s.e}`, release: release.tag, method: release.method, date: release.date,
    path: `/${lang}/sovereign`, query: ownQuery(data, s, pin).toString(), datasets: cite.names };

  return (
    <div className="mf-dash mf-dash--free mf-sov" ref={top}>
      <div className="mf-dash__title">
        <Kicker>{S.kicker}</Kicker>
        <h1 className="mf-dash__h1">{headline}</h1>
        <details className="mf-citepop">
          <summary className="sn-btn sn-btn--secondary sn-btn--sm">{cite.button}</summary>
          <div><CiteBlock cite={viewCite} labels={cite.labels} datasets={cite.datasets} method={cite.method} /></div>
        </details>
        <p className="mf-dash__status">{S.ask} · {release.label} {release.tag} · {release.methodLabel} {release.method} · {updated} · <Term id="w_vintage">{vintage}</Term> · <strong>{S.caveat}</strong></p>
      </div>
      {notice}
      {help}

      <div className="mf-sov__bar" role="group" aria-label={S.tabsLabel}>
        <nav className="mf-sov__tabs" aria-label={S.tabsLabel}>
          {TABS.map((t) => (<a key={t} href={`#${t}`} aria-current={tab === t ? 'page' : undefined} onClick={(ev) => { ev.preventDefault(); go(t); }}>{S.tabs[t]}</a>))}
        </nav>
        <div className="mf-sov__ctl">
          <EconomyBox data={data} value={s.e} lang={lang} onPick={pick} />
          <div className="sn-field mf-sov__field mf-sov__wide"><span className="sn-field__label">{rich(S.kLabel)}</span><KSeg data={data} K={s.K} setK={setK} /></div>
          <YearSeg data={data} lang={lang} pin={pin} setPin={setPin} />
          <div className="mf-sov__btns mf-sov__wide">
            <button type="button" className="sn-btn sn-btn--secondary sn-btn--sm" onClick={reset}>{S.reset}</button>
            <button type="button" className="sn-btn sn-btn--secondary sn-btn--sm" onClick={copy} aria-live="polite">{copied ? S.copied : S.copy}</button>
          </div>
          <button type="button" className="sn-btn sn-btn--deep sn-btn--sm mf-sov__narrow" aria-haspopup="dialog" aria-expanded={sheet} onClick={() => setSheet(true)}><Icon name="sliders" size={16} />{S.rulesBtn}</button>
        </div>
      </div>

      {tab === 'one' && (
        <section aria-label={S.tabs.one} className="mf-sov__panel">
          <div className="mf-sov__one">
            <Scorecard data={data} e={e} s={s} lang={lang} name={nameOf(s.e)} pin={pin} setThr={setThr} toggle={toggle} foot={footRules} />
            <div className="mf-dcard mf-sov__linked">
              <Timeline data={data} e={e} eps={eps} s={s} lang={lang} {...L} />
              <div className="mf-sov-charts">
                {RULES.map((r) => (<RuleChart key={r} r={r} data={data} e={e} eps={eps} s={s} lang={lang} benchName={nameOf(e.bench)} {...L} />))}
                <div className="mf-sov-chart mf-sov-legend"><p className="mf-sov-h3">{S.legendTitle}</p><Legend lang={lang} /></div>
              </div>
              <p className="mf-dcard__foot">{S.chartHint} {rich(S.howToRead)}</p>
            </div>
          </div>
          <section className="mf-dcard" aria-labelledby="mf-sov-eps">
            <div className="mf-dcard__head"><div><h2 id="mf-sov-eps" className="mf-dcard__title">{S.episodesTitle(nameOf(s.e))}</h2></div>
              <div className="mf-dcard__tools"><a className="mf-linkbtn" href="#backtest" onClick={(ev) => { ev.preventDefault(); go('backtest', true); }}>{S.episodesLink}</a></div></div>
            <div className="mf-dcard__body"><EpisodeList eps={eps} lang={lang} /></div>
            <p className="mf-dcard__foot">{footEpisodes}</p>
          </section>
        </section>
      )}

      {tab === 'compare' && (
        <section aria-labelledby="mf-sov-cmp" className="mf-sov__panel mf-dcard">
          <div className="mf-dcard__head"><div>
            <h2 id="mf-sov-cmp" className="mf-dcard__title">{S.tableTitle}{pin != null ? ` · ${yearLabel(pin, lang)}` : ''}</h2>
            <p className="mf-dcard__sub">{pin != null ? S.tableLedeYear(yearLabel(pin, lang)) : S.tableLede}</p>
          </div></div>
          <div className="mf-dcard__body"><Compare data={data} s={s} lang={lang} pin={pin} pick={(c) => { pick(c); go('one', true); }} /></div>
          <p className="mf-dcard__foot">{footRules}</p>
        </section>
      )}

      {tab === 'backtest' && (
        <section aria-labelledby="mf-sov-valid" className="mf-sov__panel mf-dcard">
          <div className="mf-dcard__head"><div>
            <h2 id="mf-sov-valid" className="mf-dcard__title">{S.validTitle}</h2>
            <p className="mf-dcard__sub">{S.validLede}</p>
          </div></div>
          <div className="mf-dcard__body mf-sov__valid">
            <ul className="mf-kpis mf-kpis--sm mf-sov__tiles">
              <li><div className="sn-stat"><p className="sn-stat__label">{rich(S.hit)}</p><p className="sn-stat__value">{valid.hit_rate == null ? '–' : `${num(valid.hit_rate, lang, 0)}%`}</p><p className="sn-stat__source">{rich(S.hitSub(valid.hits, valid.scored, valid.episodes))}</p></div></li>
              <li><div className="sn-stat"><p className="sn-stat__label">{rich(S.false_)}</p><p className="sn-stat__value">{valid.false_rate == null ? '–' : `${num(valid.false_rate, lang, 1)}%`}</p><p className="sn-stat__source">{rich(S.falseSub(valid.alarms, valid.calm))}</p></div></li>
              <li><div className="sn-stat"><p className="sn-stat__label">{rich(S.auroc)}</p><p className="sn-stat__value">{num(valid.auroc, lang, 2)} <span className="sn-stat__unit">{S.aurocRead}</span></p><p className="sn-stat__source">{rich(S.aurocSub(valid.pos_years, valid.calm, valid.scored))}</p></div></li>
            </ul>
            <Notice tone="info">{rich(S.validWarn)}</Notice>
            <h3 className="mf-sov-h">{S.epListTitle}</h3>
            <div className="sn-table-wrap" tabIndex={0}>
              <table className="sn-table sn-table--dense mf-sov-spells">
                <thead><tr><th scope="col">{S.epCols.eco}</th><th scope="col">{S.epCols.start}</th><th scope="col" className="is-num">{S.epCols.max}</th><th scope="col">{S.epCols.res}</th></tr></thead>
                <tbody>
                  {valid.per.map((p) => (
                    <tr key={`${p.eco}${p.start}`}>
                      <th scope="row"><button type="button" className="mf-linkbtn" onClick={() => { pick(p.eco); go('one', true); }}>{nameOf(p.eco)}</button></th>
                      <td className="mf-mono">{p.start.slice(0, 7)}</td>
                      <td className="is-num">{p.data ? p.max : '–'}</td>
                      <td><span className={`mf-sov-pill mf-sov-pill--${!p.data ? 'neutral' : p.hit ? 'good' : 'warn'}`}>{S.res[!p.data ? 'nodata' : p.hit ? 'hit' : 'miss']}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* a server-rendered element as the only child of its own box: React 19 key-checks it otherwise */}
            <div className="mf-sov__sec">{backtest}</div>
          </div>
          <p className="mf-dcard__foot">{footEpisodes}</p>
        </section>
      )}

      {tab === 'method' && <section aria-label={S.tabs.method} className="mf-sov__panel mf-dcard mf-sov__method"><div className="mf-dcard__body">{method}</div></section>}

      {sheet && <RulesSheet data={data} s={s} lang={lang} setThr={setThr} toggle={toggle} setK={setK} reset={reset} copy={copy} copied={copied} close={() => setSheet(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- toolbar pieces
function EconomyBox({ data, value, lang, onPick }: { data: SovereignClient; value: string; lang: Lang; onPick: (c: string) => void }) {
  const S = strings(lang);
  const id = useId().replace(/:/g, '');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [act, setAct] = useState(0);
  const inp = useRef<HTMLInputElement>(null);
  const nm = useCallback((c: string) => data.names[c]?.[lang] ?? c, [data, lang]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return data.economies;
    const o = lang === 'ko' ? 'en' : 'ko';
    return data.economies.filter((c) => nm(c).toLowerCase().includes(t) || (data.names[c]?.[o] ?? '').toLowerCase().includes(t) || c.toLowerCase().startsWith(t));
  }, [q, data, lang, nm]);
  useEffect(() => { if (open) document.getElementById(`${id}o${list[act]}`)?.scrollIntoView({ block: 'nearest' }); }, [act, open, list, id]);
  const choose = (c: string) => { onPick(c); setOpen(false); setQ(''); inp.current?.blur(); };
  return (
    <div className="sn-field mf-sov__field mf-sov-combo">
      <label className="sn-field__label" htmlFor={`${id}i`}>{S.economy}</label>
      <div className="mf-sov-combo__box">
        <input id={`${id}i`} ref={inp} className="sn-input mf-sov-combo__in" role="combobox" aria-expanded={open} aria-controls={`${id}l`} aria-autocomplete="list"
          aria-activedescendant={open && list[act] ? `${id}o${list[act]}` : undefined} autoComplete="off" spellCheck={false}
          value={open ? q : nm(value)} placeholder={S.search}
          onFocus={() => { setOpen(true); setQ(''); setAct(Math.max(0, data.economies.indexOf(value))); }}
          onChange={(ev) => { setQ(ev.target.value); setAct(0); setOpen(true); }}
          onBlur={() => { setOpen(false); setQ(''); }}
          onKeyDown={(ev) => {
            if (ev.key === 'ArrowDown') { ev.preventDefault(); setOpen(true); setAct((a) => Math.min(list.length - 1, a + 1)); }
            else if (ev.key === 'ArrowUp') { ev.preventDefault(); setAct((a) => Math.max(0, a - 1)); }
            else if (ev.key === 'Enter') { ev.preventDefault(); if (list[act]) choose(list[act]); }
            else if (ev.key === 'Escape') { ev.preventDefault(); setOpen(false); setQ(''); inp.current?.blur(); }
          }} />
        <span className="sn-select__chev" aria-hidden><Icon name="chevron" size={18} /></span>
        {open && (
          <ul id={`${id}l`} role="listbox" className="mf-sov-combo__list" aria-label={S.economy}>
            {list.length ? list.map((c, i) => (
              <li key={c} id={`${id}o${c}`} role="option" aria-selected={c === value} className={i === act ? 'is-act' : undefined}
                onMouseDown={(ev) => { ev.preventDefault(); choose(c); }} onMouseEnter={() => setAct(i)}>
                <span>{nm(c)}</span><span className="mf-mono mf-muted">{c}</span>
              </li>
            )) : <li className="mf-sov-combo__none">{S.noMatch}</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

function KSeg({ data, K, setK }: { data: SovereignClient; K: number; setK: (k: number) => void }) {
  const ks = Array.from({ length: data.K.max - data.K.min + 1 }, (_, i) => data.K.min + i);
  return <SegmentedControl size="sm" label="K" value={String(K)} onChange={(v) => setK(Number(v))} options={ks.map((k) => ({ value: String(k), label: String(k) }))} />;
}

function YearSeg({ data, lang, pin, setPin }: { data: SovereignClient; lang: Lang; pin: number | null; setPin: (y: number | null) => void }) {
  const S = strings(lang);
  return (
    <div className="sn-field mf-sov__field mf-sov-year" role="group" aria-label={S.yearLabel}>
      <span className="sn-field__label">{S.yearLabel}</span>
      <div className="sn-seg sn-seg--sm">
        <button type="button" className="sn-seg__opt" role="radio" aria-checked={pin == null} onClick={() => setPin(null)} title={S.backToLatest}>{S.latest}</button>
        <button type="button" className="sn-seg__opt mf-mono" role="radio" aria-checked={pin != null} onClick={() => setPin(pin ?? data.last_actual)}>{pin != null ? (pin >= data.proj0 ? `${pin}*` : String(pin)) : S.pickYear}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- scorecard
function Scorecard({ data, e, s, lang, name, pin, setThr, toggle, foot }: { data: SovereignClient; e: SEcon; s: Settings; lang: Lang; name: string; pin: number | null; setThr: (r: RuleId, v: number) => void; toggle: (r: RuleId) => void; foot: ReactNode }) {
  const S = strings(lang);
  const j = pin != null ? data.years.indexOf(pin) : -1;
  const c = j >= 0 ? countAt(data, e, j, s) : nowCount(data, e, s);
  const reached = c.n > 0 && c.k >= s.K;
  const proj = pin != null && pin >= data.proj0;
  return (
    <section className="mf-dcard mf-sov-card" aria-labelledby="mf-sov-card-h">
      <div className="mf-sov-card__head">
        <p className="sn-kicker sn-kicker--muted" id="mf-sov-card-h">{pin != null ? S.yearTitle(pin) : S.nowTitle} · {name}{proj ? ` · ${S.projLabel}` : ''}</p>
        <div className="mf-sov-card__count">
          <span className="mf-sov-big" aria-live="polite"><Term id="w_count">{`${c.k}/${c.n}`}</Term></span>
          <div className="mf-sov-card__meta">
            <span className="mf-sov-small">{rich(`[[w_k|${S.kAt(s.K)}]]`)}</span>
            <span className={`mf-sov-pill mf-sov-pill--${reached ? 'bad' : 'neutral'}`}>{reached ? S.reached : S.below}</span>
          </div>
        </div>
        <p className="mf-sov-card__caveat">{S.nowCount(c.k, c.n)} · <strong>{S.caveat}</strong></p>
      </div>
      <table className="mf-sov-score">
        <thead>
          <tr><th scope="col">{S.cols.rule}</th><th scope="col" className="is-num">{S.cols.value}</th><th scope="col">{S.cols.asof}</th><th scope="col" className="mf-sov-ed">{S.cols.thr}</th><th scope="col" className="mf-sov-ed">{S.cols.use}</th><th scope="col">{S.cols.status}</th></tr>
        </thead>
        {GROUPS.map((g) => (
          <tbody key={g}>
            <tr className="mf-sov-score__g"><th colSpan={6} scope="rowgroup">{S.groups[g]} <span className="mf-muted">{S.groupRange[g]}</span></th></tr>
            {RULES.filter((r) => data.rules[r].group === g).map((r) => {
              const cfg = data.rules[r];
              const st = j >= 0 ? stateAt(data, e, r, j, s) : nowState(data, e, r, s);
              const nv = e.now[r];
              const v = j >= 0 ? e.v[r][j] : nv?.v;
              const asof0: ReactNode = st === 'na' ? '' : j >= 0 ? yearLabel(pin!, lang) : !nv ? '' : nv.kind === '12m' ? <span title={S.last12(monthLabel(nv.p, lang))}>{monthLabel(nv.p, lang)}<br />{S.m12}</span> : yearLabel(Number(nv.p), lang);
              // the source of the year's value (R25, R26: the Signal Board or the WEO/IIP; R27: the board), method 1.6
              const jy = j >= 0 ? j : nv && nv.kind === 'year' ? data.years.indexOf(Number(nv.p)) : -1;
              const sk = st === 'na' || v == null || jy < 0 ? null : r === 'r6' ? 'mf' : r === 'r4' || r === 'r5' ? e.src?.[r]?.[jy] ?? null : null;
              const asof: ReactNode = sk ? <>{asof0}<br /><span className="mf-muted" title={S.srcTitle}>{S.src[sk] ?? sk}</span></> : asof0;
              return (
                <tr key={r} className={`is-${st}`}>
                  <th scope="row" className="mf-sov-score__rule"><Term id={`w_${r}`}>{up(r)}</Term> <span>{S.ruleShort[r]}</span></th>
                  <td className="is-num mf-mono">{st === 'na' ? '' : fmt(r, v, lang, cfg.unit)}</td>
                  <td className="mf-sov-score__asof">{asof}</td>
                  <td className="mf-sov-ed"><ThrEdit r={r} cfg={cfg} value={s.thr[r]} lang={lang} onChange={(x) => setThr(r, x)} disabled={s.off.includes(r)} /></td>
                  <td className="mf-sov-ed"><Switch on={!s.off.includes(r)} label={S.useRule(up(r))} onChange={() => toggle(r)} /></td>
                  <td><StateTag st={st} lang={lang} short /></td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
      <p className="mf-dcard__foot">{foot}</p>
    </section>
  );
}

/** Sinho's switch: a button with role switch, the thumb inside. */
function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: () => void }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="sn-switch__track mf-sov-switch" onClick={onChange}><span className="sn-switch__thumb" aria-hidden /></button>;
}

const clampTo = (c: RuleCfg, v: number) => Math.min(c.max, Math.max(c.min, Math.round(v / c.step) * c.step));
const pctOf = (c: RuleCfg, v: number) => `${((v - c.min) / (c.max - c.min || 1)) * 100}%`;

/** A threshold cell: a button showing "≥ 90%"; clicking opens a small slider and number box, the default a faint tick. */
function ThrEdit({ r, cfg, value, lang, onChange, disabled }: { r: RuleId; cfg: RuleCfg; value: number; lang: Lang; onChange: (v: number) => void; disabled: boolean }) {
  const S = strings(lang);
  const [open, setOpen] = useState(false);
  const [txt, setTxt] = useState(String(value));
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { setTxt(String(value)); }, [value]);
  useEffect(() => {
    if (!open) return;
    const down = (ev: PointerEvent) => { const n = ev.target as Node; if (!box.current?.contains(n) && !btn.current?.contains(n)) setOpen(false); };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key, true); };
  }, [open]);
  const sign = cfg.dir === 'ge' ? '≥' : '≤';
  const label = `${sign} ${fmt(r, value, lang, cfg.unit)}`;
  const commit = () => { const v = Number(txt); if (txt.trim() !== '' && Number.isFinite(v)) onChange(clampTo(cfg, v)); else setTxt(String(value)); };
  return (
    <div className="mf-sov-thr">
      <button ref={btn} type="button" className={`mf-sov-thr__btn mf-mono${value !== cfg.default ? ' is-changed' : ''}`} aria-expanded={open} disabled={disabled}
        aria-label={`${S.editThr(up(r))}: ${label}`} onClick={() => setOpen((o) => !o)}>{label}</button>
      {open && (
        <div ref={box} className="mf-sov-thr__pop" role="dialog" aria-label={S.editThr(up(r))}>
          <p className="mf-sov-small"><strong>{up(r)} {S.ruleShort[r]}</strong> {sign} <span className="mf-mono">{fmt(r, value, lang, cfg.unit)}</span></p>
          <div className="mf-sov-thr__track">
            <input type="range" className="mf-range" min={cfg.min} max={cfg.max} step={cfg.step} value={value} autoFocus style={{ ['--p' as string]: pctOf(cfg, value) }}
              onChange={(ev) => onChange(Number(ev.target.value))} aria-label={S.editThr(up(r))} aria-valuetext={label} />
            <span className="mf-sov-thr__tick" style={{ left: `calc(6px + (100% - 12px) * ${(cfg.default - cfg.min) / (cfg.max - cfg.min || 1)})` }} aria-hidden="true" />
          </div>
          <div className="mf-sov-thr__row">
            <input type="number" className="sn-input mf-sov-thr__num" min={cfg.min} max={cfg.max} step={cfg.step} value={txt} aria-label={S.editThr(up(r))}
              onChange={(ev) => setTxt(ev.target.value)} onBlur={commit} onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commit(); } }} />
            <span className="mf-sov-small mf-muted">{S.defaultIs(fmt(r, cfg.default, lang, cfg.unit))}</span>
            <button type="button" className="sn-btn sn-btn--secondary sn-btn--sm" onClick={() => { commit(); setOpen(false); btn.current?.focus(); }}>{S.done}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function StateTag({ st, lang, short }: { st: State; lang: Lang; short?: boolean }) {
  const S = strings(lang);
  const kind = st === 'on' ? 'bad' : st === 'off' ? 'good' : 'neutral';
  const txt = (short ? S.stateShort : S.state)[st];
  const label = st === 'missing' ? <Term id="w_missing">{txt}</Term> : st === 'na' ? <Term id="w_na">{txt}</Term> : txt;
  return <span className={`mf-sov-pill mf-sov-pill--${kind}`}>{label}</span>;
}

// ---------------------------------------------------------------- compare: the cross-economy heatmap
/** Tint of a cell: red, stronger the further past the threshold; below it, a faint tint within a quarter of the slider range. */
function heat(cfg: RuleCfg, thr: number, v: number | null | undefined, st: State): string | undefined {
  if (v == null || (st !== 'on' && st !== 'off')) return undefined;
  const d = (cfg.dir === 'ge' ? v - thr : thr - v) / (cfg.max - cfg.min || 1);
  if (st === 'on') return `color-mix(in srgb, var(--status-critical) ${Math.round(26 + 34 * Math.min(1, Math.max(0, d) * 4))}%, transparent)`;
  const near = Math.max(0, 1 + d * 4);
  return near > 0 ? `color-mix(in srgb, var(--status-critical) ${Math.round(3 + 13 * near)}%, transparent)` : undefined;
}

type SortKey = 'count' | 'name' | RuleId;
function Compare({ data, s, lang, pin, pick }: { data: SovereignClient; s: Settings; lang: Lang; pin: number | null; pick: (c: string) => void }) {
  const S = strings(lang);
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: 'count', desc: true });
  const j = pin != null ? data.years.indexOf(pin) : -1;
  const rows = useMemo(() => data.economies.map((c) => {
    const E = data.econ[c];
    const cnt = j >= 0 ? countAt(data, E, j, s) : nowCount(data, E, s);
    const cell = Object.fromEntries(RULES.map((r) => [r, { v: j >= 0 ? E.v[r][j] : E.now[r]?.v ?? null, st: j >= 0 ? stateAt(data, E, r, j, s) : nowState(data, E, r, s) }])) as Record<RuleId, { v: number | null; st: State }>;
    return { c, name: data.names[c]?.[lang] ?? c, cnt, cell };
  }), [data, s, lang, j]);
  const key = (x: { v: number | null; st: State }) => (x.st === 'na' || x.v == null ? -Infinity : x.v);
  const sorted = [...rows].sort((a, b) => {
    let d = 0;
    if (sort.k === 'count') d = a.cnt.k - b.cnt.k || (a.cnt.n ? a.cnt.k / a.cnt.n : 0) - (b.cnt.n ? b.cnt.k / b.cnt.n : 0);
    else if (sort.k === 'name') d = a.name.localeCompare(b.name, lang);
    else { const ka = key(a.cell[sort.k]), kb = key(b.cell[sort.k]); d = ka === kb ? 0 : ka < kb ? -1 : 1; }
    return sort.desc ? -d : d;
  });
  const arrow = (k: SortKey) => (sort.k === k ? (sort.desc ? ' ↓' : ' ↑') : '');
  const th = (k: SortKey, label: ReactNode, cls = '', term?: string) => (
    <th className={cls || undefined} scope="col" aria-sort={sort.k === k ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className="sn-table__sort" onClick={() => setSort((p) => ({ k, desc: p.k === k ? !p.desc : k !== 'name' }))}>{label}{arrow(k)}</button>
      {term && <Term id={term}>{''}</Term>}
    </th>
  );
  return (
    <>
      <ul className="mf-sov-key" aria-label={S.legendTitle}>
        <li><span className="mf-sov-sw mf-sov-sw--far" />{S.heat.far}</li>
        <li><span className="mf-sov-sw mf-sov-sw--near" />{S.heat.near}</li>
        <li><span className="mf-sov-sw mf-sov-sw--past" /><strong>{S.heat.on}</strong></li>
        <li><span className="mf-sov-sw mf-sov-sw--na" />{S.heat.na}</li>
      </ul>
      <div className="mf-sov-heat sn-table-wrap" tabIndex={0}>
        <table className="sn-table sn-table--dense mf-sov-heat__t">
          <thead><tr>{th('name', S.cols.eco)}{th('count', S.cols.count, 'is-num', 'w_count')}{RULES.map((r) => (
            <th key={r} className="is-num" scope="col" aria-sort={sort.k === r ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
              <button type="button" className="sn-table__sort" onClick={() => setSort((p) => ({ k: r, desc: p.k === r ? !p.desc : true }))}>{up(r)}{arrow(r)}</button><Term id={`w_${r}`}>{''}</Term>
              <span className="mf-sov-heat__thr mf-mono">{data.rules[r].dir === 'ge' ? '≥' : '≤'} {fmt(r, s.thr[r], lang, data.rules[r].unit)}</span>
            </th>))}</tr></thead>
          <tbody>
            {sorted.map(({ c, name, cnt, cell }) => (
              <tr key={c} className={c === s.e ? 'is-sel' : ''} onClick={() => pick(c)} tabIndex={0} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(c); } }} aria-current={c === s.e ? 'true' : undefined}>
                <th scope="row">{name}</th>
                <td className={`is-num${cnt.n > 0 && cnt.k >= s.K ? ' mf-sov-heat__hit' : ''}`}>{`${cnt.k}/${cnt.n}`}</td>
                {RULES.map((r) => {
                  const { v, st } = cell[r];
                  return <td key={r} className={`is-num mf-mono is-${st}`} style={{ background: heat(data.rules[r], s.thr[r], v, st) }} title={S.state[st]}>{st === 'na' ? '·' : fmt(r, v, lang, data.rules[r].unit)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- the rules sheet (narrow screens)
function RulesSheet({ data, s, lang, setThr, toggle, setK, reset, copy, copied, close }: { data: SovereignClient; s: Settings; lang: Lang; setThr: (r: RuleId, v: number) => void; toggle: (r: RuleId) => void; setK: (k: number) => void; reset: () => void; copy: () => void; copied: boolean; close: () => void }) {
  const S = strings(lang);
  const btn = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    btn.current?.focus();
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && !ev.defaultPrevented) { ev.preventDefault(); closeRef.current(); } };
    document.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = prev; opener?.focus?.(); };
  }, []);
  return (
    <div className="mf-sov-sheet" role="dialog" aria-modal="true" aria-labelledby="mf-sov-sheet-h">
      <div className="mf-sov-sheet__back" onClick={close} />
      <div className="mf-sov-sheet__body">
        <div className="mf-sov-sheet__head"><h2 id="mf-sov-sheet-h" className="mf-sov-h">{S.rulesTitle}</h2><button ref={btn} type="button" className="sn-btn sn-btn--secondary sn-btn--sm" onClick={close}>{S.close}</button></div>
        <p className="mf-note">{S.rulesLede}</p>
        <div className="mf-sov-sheet__k"><span className="mf-sov-small">{rich(S.kLabel)}</span><KSeg data={data} K={s.K} setK={setK} /></div>
        {GROUPS.map((g) => (
          <fieldset key={g} className="mf-sov-group">
            <legend className="sn-kicker sn-kicker--muted">{S.groups[g]} {S.groupRange[g]}</legend>
            {RULES.filter((r) => data.rules[r].group === g).map((r) => {
              const c = data.rules[r];
              const on = !s.off.includes(r);
              const id = `mf-sov-sheet-${r}`;
              return (
                <div key={r} className={`mf-sov-rule${on ? '' : ' is-off'}`}>
                  <div className="mf-sov-rule__head">
                    <Switch on={on} label={S.useRule(up(r))} onChange={() => toggle(r)} />
                    <span className="mf-sov-rule__name"><Term id={`w_${r}`}>{`${up(r)} ${S.ruleShort[r]}`}</Term> <span className="mf-muted mf-mono">{REG[r]}</span></span>
                    <output htmlFor={id} className="mf-mono mf-sov-rule__val">{c.dir === 'ge' ? '≥' : '≤'} {fmt(r, s.thr[r], lang, c.unit)}</output>
                  </div>
                  <input id={id} type="range" className="mf-range" min={c.min} max={c.max} step={c.step} value={s.thr[r]} disabled={!on} style={{ ['--p' as string]: pctOf(c, s.thr[r]) }}
                    onChange={(ev) => setThr(r, Number(ev.target.value))} aria-label={S.editThr(up(r))} aria-valuetext={fmt(r, s.thr[r], lang, c.unit)} />
                  <span className="mf-sov-small mf-muted">{S.defaultIs(fmt(r, c.default, lang, c.unit))}</span>
                </div>
              );
            })}
          </fieldset>
        ))}
        <div className="mf-sov__btns">
          <button type="button" className="sn-btn sn-btn--secondary sn-btn--sm" onClick={reset}>{S.reset}</button>
          <button type="button" className="sn-btn sn-btn--secondary sn-btn--sm" onClick={copy} aria-live="polite">{copied ? S.copied : S.copy}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the selected economy's episodes
const FAC: Record<string, string> = { SBA: 'w_f_sba', EFF: 'w_f_eff', FCL: 'w_f_fcl', PLL: 'w_f_pll', SLL: 'w_f_sll', PCI: 'w_f_pci', GLF: 'w_f_glf', EFSF: 'w_f_efsf', EFSM: 'w_f_efsm', ESM: 'w_f_esm', 'EU-BoP': 'w_f_eubop' };
const TYPE: Record<string, string> = { imf: 'w_ep_imf', eu: 'w_ep_eu', default: 'w_ep_default', precautionary: 'w_ep_prec' };
function EpisodeList({ eps, lang }: { eps: Episode[]; lang: Lang }) {
  const S = strings(lang);
  if (!eps.length) return <p className="mf-note" style={{ margin: 0 }}>{S.noEpisodes}</p>;
  return (
    <div className="sn-table-wrap" tabIndex={0}>
      <table className="sn-table sn-table--dense">
        <thead><tr><th scope="col">{S.epCols2.type}</th><th scope="col">{S.epCols2.what}</th><th scope="col">{S.epCols2.from}</th><th scope="col">{S.epCols2.to}</th></tr></thead>
        <tbody>
          {eps.map((ep) => (
            <tr key={ep.id}>
              <th scope="row"><span className={`mf-sov-swl mf-sov-band--${ep.type}`} /> <Term id={TYPE[ep.type]}>{S.epType[ep.type]}</Term></th>
              <td>{ep.facility && FAC[ep.facility] ? <Term id={FAC[ep.facility]}>{(lang === 'ko' ? ep.ko : ep.en) ?? ep.facility}</Term> : ((lang === 'ko' ? ep.ko : ep.en) ?? ep.facility)}
                {ep.source && <> · <a className="sn-link" href={ep.source} target="_blank" rel="noopener noreferrer" aria-label={`${S.sourceWord} — ${lang === 'ko' ? '새 탭에서 열림' : 'opens in new tab'}`}>{S.sourceWord}</a></>}</td>
              <td className="mf-mono">{ep.precision === 'year' ? ep.start.slice(0, 4) : ep.start}</td>
              <td className="mf-mono">{ep.end ? (ep.precision === 'year' ? ep.end.slice(0, 4) : ep.end) : S.running}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { DEFAULT_ECONOMY };
