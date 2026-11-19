'use client';
// The Markets matrix and its panel (market mode; redesign of 30 Oct 2026). Rows hold, columns issued: a
// cell is what residents of the row economy hold of what residents of the column economy issued, an end-of-period
// position. Shade: seven log-spaced bins with round breaks, the same on every market; optionally a square whose area
// is proportional to the value. Other and the totals are margins in grey, outside the scale. Net mode shows
// row→column less column→row on a diverging scale. A label opens the country focus (a bottom sheet on phones).
// Every number arrives computed on the server from the release (the page file); this file only lays it out.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fill as fillTemplate } from '@/lib/family';
import { usdBn, usdTn, amtWhole, num } from '@/lib/format';
import type { Focus, Lang } from '@/lib/types';
import { DataTable, SegmentedControl } from './sn/client';
import { useTip, type TipContent } from './Tip';

export type TagKind = 'FC' | 'FD' | 'SPE';
export interface EconInfo { n: string; tag: TagKind | null; href: string | null }
export interface Target { cell?: [string, string]; econ?: string; tab?: string }
export interface Insight { text: string; target: Target }
export interface RoundTrip { a: string; b: string; ab: number; ba: number }

export interface MarketViewProps {
  lang: Lang; market: string; periodText: string;
  econ: Record<string, EconInfo>;
  rows: string[]; cols: string[];                       // the top 30 holders and destinations, in display order
  hTot: Record<string, number>; dTot: Record<string, number>;
  holdersOther: number; destsOther: number; total: number;
  pairs: Record<string, number>;                         // "A|B" for A in rows, B in cols
  focus: Record<string, Focus>;
  insights: Insight[]; roundTrips: RoundTrip[]; rtRule: string;
  text: { sentence: string; valuation: string; rowTitle: string; colTitle: string; title: string };
  tags: Record<TagKind, { ko: string; en: string; desc: string }>;
  explainer: ReactNode; about: ReactNode; source: ReactNode; docLinks: ReactNode;
  /** `cell`: the pair to focus on arrival (?h=A&d=B, linked from global-network's pair page). */
  init: { n: number; mode: string; enc: string; cell?: [string, string] };
  /** global-network's pair page with `{a}`/`{b}` to fill (lib/family.ts); null when family.json has none. */
  pairTemplate: string | null;
}

// log-spaced bins, USD bn: <10, 10–30, 30–100, 100–300, 300–1,000, 1,000–3,000, ≥3,000 (100억 … 3만억 달러)
export const BREAKS = [10, 30, 100, 300, 1000, 3000];
const NET_BREAKS = [10, 100, 1000];
const binOf = (v: number) => 1 + BREAKS.filter((b) => v >= b).length;
const netBin = (v: number) => NET_BREAKS.filter((b) => Math.abs(v) >= b).length;
const SIZES: Record<number, { cw: number; ch: number; fs: number; thr: number }> = {
  12: { cw: 52, ch: 32, fs: 12, thr: 30 }, 20: { cw: 46, ch: 28, fs: 12, thr: 100 }, 30: { cw: 42, ch: 24, fs: 12, thr: 100 },
};

const fill = (v: string, a: Record<string, string>) => v.replace(/\{(\w+)\}/g, (_, k) => a[k] ?? '');

export function MarketView(p: MarketViewProps) {
  const { lang } = p;
  const ko = lang === 'ko';
  const t = useTip();
  const [n, setN] = useState(p.init.n);
  const [mode, setMode] = useState(p.init.mode);
  const [enc, setEnc] = useState(p.init.enc);
  const [hov, setHov] = useState<[string, string] | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [tab, setTab] = useState('holders');
  const [kf, setKf] = useState<[number, number]>([0, 0]);
  const [focusCell, setFocusCell] = useState<[string, string] | null>(p.init.cell ?? null);
  const scroller = useRef<HTMLDivElement>(null);
  // a linked cell (?h=&d=): widen the matrix to hold it, then scroll it into view and focus it (which shows its tip)
  useEffect(() => {
    const c = p.init.cell;
    if (!c) return;
    const [a, b] = c;
    const need = [12, 20, 30].find((k) => p.rows.slice(0, k).includes(a) && p.cols.slice(0, k).includes(b));
    if (!need) { if (p.focus[a]) setFocus(a); return; }
    if (need > n) setN(need);
    const t0 = window.setTimeout(() => {
      const el = document.getElementById(`mfc-${a}-${b}`);
      el?.scrollIntoView({ block: 'center', inline: 'center' });
      (el as HTMLElement | null)?.focus({ preventScroll: true });
    }, 120);
    return () => window.clearTimeout(t0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {                                     // the view settings go into the URL, so a citation reproduces them
    const q = new URLSearchParams(window.location.search);
    const set = (k: string, v: string, def: string) => (v === def ? q.delete(k) : q.set(k, v));
    set('n', String(n), '12'); set('mode', mode, 'gross'); set('enc', enc, 'size');
    const s = q.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${s ? `?${s}` : ''}`);
  }, [n, mode, enc]);

  const rows = p.rows.slice(0, n), cols = p.cols.slice(0, n);
  // the cells widen to fill the card (never below the size for this count, at most three times it), so a wide screen
  // gets a larger matrix instead of empty space beside it; on narrow screens the matrix keeps its size and scrolls sideways
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const base = SIZES[n] ?? SIZES[12];
  const el = scroller.current;
  // what is not a cell column (row labels, the totals column, spacing), measured on the rendered table
  const tbl = el?.querySelector<HTMLElement>('table');
  const heads = el ? [...el.querySelectorAll<HTMLElement>('.mf-mx__ch')] : [];
  const fixed = tbl && heads.length ? tbl.offsetWidth - heads.reduce((a, h) => a + h.offsetWidth, 0) : 0;
  const fit = avail && fixed ? Math.floor((avail - fixed - 1) / cols.length) - 4 : 0;
  const grow = Math.min(3, fit / base.cw);
  const sz = grow > 1 ? { ...base, cw: Math.floor(base.cw * grow), ch: Math.round(base.ch * Math.min(1.6, Math.sqrt(grow))), fs: grow >= 1.5 ? base.fs + 1 : base.fs } : base;
  const nm = (c: string) => p.econ[c]?.n ?? c;
  const v = (a: string, b: string): number | null => (a === b ? null : p.pairs[`${a}|${b}`] ?? 0);
  const rev = (a: string, b: string): number | null => (p.rows.includes(b) && p.cols.includes(a) ? (p.pairs[`${b}|${a}`] ?? 0) : null);
  const net = (a: string, b: string): number | null => { const x = v(a, b), y = rev(a, b); return x == null || y == null ? null : x - y; };
  const ri = new Map(rows.map((r, i) => [r, i])), ci = new Map(cols.map((c, j) => [c, j]));
  const redundant = (a: string, b: string, i: number, j: number) => { const i2 = ri.get(b), j2 = ci.get(a); return i2 != null && j2 != null && (i2 < i || (i2 === i && j2 < j)); };
  const vmax = useMemo(() => Math.max(1, ...rows.flatMap((r) => cols.map((c) => (r === c ? 0 : mode === 'net' ? Math.abs(net(r, c) ?? 0) : v(r, c) ?? 0)))), [n, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowMax = Math.max(1, ...rows.map((r) => p.hTot[r] ?? 0)), colMax = Math.max(1, ...cols.map((c) => p.dTot[c] ?? 0));
  const share = (x: number, of: number | undefined) => (of ? `${num((100 * x) / of, lang, 1)}%` : '–');

  const sentence = (a: string, b: string, x: number) => `${fill(p.text.sentence, { a: nm(a), b: nm(b), v: usdBn(x, lang) })} (${p.periodText}${ko ? ' 잔액' : ' position'}${p.text.valuation ? `, ${p.text.valuation}` : ''})`;
  const cellTip = (a: string, b: string): TipContent => {
    const x = v(a, b);
    if (x == null) return { id: `${a}|${b}`, title: ko ? `${nm(a)} → ${nm(a)}: 자국 보유는 국경 간 잔액이 아니어서 제외한다 (domestic, not cross-border)` : `${nm(a)} → ${nm(a)}: domestic holdings are not cross-border and are left out` };
    const y = rev(a, b);
    const gn = p.pairTemplate ? fillTemplate(p.pairTemplate, { a, b }) : null;
    const meta: ReactNode[] = [
      y == null ? (ko ? `역방향 ${nm(b)} → ${nm(a)}: 상위 30개 경제 밖이라 표시하지 않음` : `Reverse ${nm(b)} → ${nm(a)}: outside the top 30, not shown`)
        : `${ko ? '역방향' : 'Reverse'} ${nm(b)} → ${nm(a)}: ${usdBn(y, lang)}`,
      y == null ? null : `${ko ? '순' : 'Net'} (${nm(a)} → ${nm(b)} − ${ko ? '역방향' : 'reverse'}): ${usdBn(x - y, lang, true)}`,
      `${ko ? `${nm(a)} 보유 합계의` : `${share(x, p.hTot[a])} of what ${nm(a)} holds`}${ko ? ` ${share(x, p.hTot[a])}` : ''} · ${ko ? `${nm(b)}의 외국인 보유 합계의 ${share(x, p.dTot[b])}` : `${share(x, p.dTot[b])} of ${nm(b)}'s foreign holders`}`,
      // the family link (plan, section 3.2): funding and trade for this pair on global-network; a click pins the tip so that it can be followed
      gn ? <a href={gn}>{ko ? `global-network에서 ${nm(a)}–${nm(b)} 보기` : `${nm(a)} and ${nm(b)} in global-network`} →</a> : null,
    ];
    return { id: `${a}|${b}`, title: x ? sentence(a, b, x) : (ko ? `${nm(a)} → ${nm(b)} 짝 자료 없음` : `${nm(a)} → ${nm(b)}: no pair data`), meta: x ? meta : [] };
  };

  const tagTip = (k: TagKind): TipContent => ({ id: `tag-${k}`, title: `${k} · ${p.tags[k].ko}`, meta: [p.tags[k].en, p.tags[k].desc] });
  const tag = (c: string) => { const k = p.econ[c]?.tag; return k ? <span className={`mf-tg mf-tg--${k}`} tabIndex={0} role="note" aria-label={`${k}: ${p.tags[k][lang === 'ko' ? 'ko' : 'en']}`} {...t.bind(tagTip(k))} onClick={(e) => e.stopPropagation()}>{k}</span> : null; };
  const label = (c: string, side: 'row' | 'col') => (
    <button type="button" className={`mf-mx__lab mf-mx__lab--${side}${focus === c ? ' is-on' : ''}`} onClick={() => openFocus(c)} aria-label={`${nm(c)}: ${ko ? '초점 열기' : 'open focus'}`}>
      <span className="mf-mx__name">{nm(c)}</span>{tag(c)}
    </button>
  );

  const openFocus = (c: string) => { setFocus(c); };
  const goTo = (tg: Target) => {
    if (tg.econ) openFocus(tg.econ);
    if (tg.tab) { setFocus(null); setTab(tg.tab); }
    if (tg.cell) {
      const [a, b] = tg.cell;
      const need = [12, 20, 30].find((k) => p.rows.slice(0, k).includes(a) && p.cols.slice(0, k).includes(b)) ?? 30;
      if (need > n) setN(need);
      if (mode !== 'gross') setMode('gross');
      setTimeout(() => { const el = document.getElementById(`mfc-${a}-${b}`); el?.scrollIntoView({ block: 'nearest', inline: 'center' }); (el as HTMLElement | null)?.focus(); }, 60);
    }
  };

  const onKey = (e: React.KeyboardEvent, i: number, j: number) => {
    const d: Record<string, [number, number]> = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
    if (e.key in d) {
      e.preventDefault();
      const ni = Math.max(0, Math.min(rows.length - 1, i + d[e.key][0])), nj = Math.max(0, Math.min(cols.length - 1, j + d[e.key][1]));
      setKf([ni, nj]);
      document.getElementById(`mfc-${rows[ni]}-${cols[nj]}`)?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFocus(rows[i]); }
  };

  const cell = (a: string, b: string, i: number, j: number) => {
    const tip = cellTip(a, b);
    const bind = t.bind(tip);
    const line = hov && (hov[0] === a || hov[1] === b), mirror = hov && hov[0] === b && hov[1] === a;
    const common = {
      id: `mfc-${a}-${b}`, tabIndex: kf[0] === i && kf[1] === j ? 0 : -1, onKeyDown: (e: React.KeyboardEvent) => onKey(e, i, j),
      ...bind,
      onMouseEnter: () => { setHov([a, b]); if (focusCell) setFocusCell(null); },
      onFocus: (e: React.FocusEvent) => { bind.onFocus(e); setHov([a, b]); setKf([i, j]); },
      onBlur: () => { bind.onBlur(); setHov(null); },
      onMouseLeave: () => { bind.onMouseLeave(); setHov(null); },
      style: { width: sz.cw, height: sz.ch, fontSize: sz.fs },
    };
    const cls = `mf-c${line ? ' is-line' : ''}${mirror ? ' is-mirror' : ''}${t.active?.id === tip.id ? ' is-active' : ''}${focusCell && focusCell[0] === a && focusCell[1] === b ? ' is-focus' : ''}`;
    if (a === b) return <td><div className={`${cls} mf-c--self`} role="gridcell" aria-label={tip.title as string} {...common} /></td>;
    const x = v(a, b) ?? 0;
    if (mode === 'net') {
      const y = net(a, b);
      if (y == null) return <td><div className={`${cls} mf-c--na`} role="gridcell" aria-label={tip.title as string} {...common}>·</div></td>;
      if (redundant(a, b, i, j)) return <td><div className={`${cls} mf-c--dup`} role="gridcell" aria-label={`${tip.title} ${ko ? '(거울 칸: 반대쪽 칸과 부호만 다릅니다)' : '(mirror: the opposite cell with the sign reversed)'}`} {...common} /></td>;
      const k = netBin(y), col = k === 0 ? 'var(--div-mid)' : `var(--div-${y > 0 ? 'pos' : 'neg'}-${k})`;
      const side = Math.sqrt(Math.abs(y) / vmax);
      const on = enc === 'color' && k >= 2;
      return (
        <td><div className={cls} role="gridcell" aria-label={`${tip.title}. ${ko ? '순' : 'net'} ${usdBn(y, lang, true)}`} {...common} style={{ ...common.style, background: enc === 'color' ? col : undefined }}>
          {enc === 'size' ? <span className="mf-c__sq" style={{ width: Math.max(3, side * (sz.ch - 2)), height: Math.max(3, side * (sz.ch - 2)), background: col }} /> : null}
          {Math.abs(y) >= sz.thr ? <span className={`mf-c__v${on ? ' is-on' : ''}`}>{(y > 0 ? '+' : '') + amtWhole(y, lang).replace('-', '−')}</span> : null}
        </div></td>
      );
    }
    if (!x) return <td><div className={`${cls} mf-c--zero`} role="gridcell" aria-label={tip.title as string} {...common} /></td>;
    const k = binOf(x), col = `var(--seq-${k}00)`;
    const side = Math.sqrt(Math.max(0, x) / vmax);                 // a negative position (FDI: net reverse investment) draws the smallest square
    return (
      <td><div className={cls} role="gridcell" aria-label={tip.title as string} {...common} style={{ ...common.style, background: enc === 'color' ? col : undefined }}>
        {enc === 'size' ? <span className="mf-c__sq" style={{ width: Math.max(3, side * (sz.ch - 2)), height: Math.max(3, side * (sz.ch - 2)), background: col }} /> : null}
        {x >= sz.thr ? <span className={`mf-c__v${enc === 'color' && k >= 5 ? ' is-on' : ''}`}>{amtWhole(x, lang)}</span> : null}
      </div></td>
    );
  };

  const rowMargin = (r: string) => {
    const tot = p.hTot[r] ?? 0, shown = cols.reduce((s, c) => s + (v(r, c) ?? 0), 0), other = Math.max(0, tot - shown);
    const tip = { id: `rm-${r}`, title: ko ? `${nm(r)}의 해외 보유 합계 ${usdBn(tot, lang)}` : `${nm(r)} holds ${usdBn(tot, lang)} abroad in all`,
      meta: [ko ? `표에 없는 투자 대상국(기타) ${usdBn(other, lang)}, ${share(other, tot)}` : `Destinations not in the table (Other): ${usdBn(other, lang)}, ${share(other, tot)}`] };
    return (
      <td className="mf-mx__rm"><div className="mf-rm" tabIndex={0} aria-label={`${tip.title}. ${tip.meta[0]}`} {...t.bind(tip)}>
        <span className="mf-rm__bar" style={{ width: `${(100 * tot) / rowMax}%` }}><span className="mf-rm__in" style={{ width: `${tot ? (100 * shown) / tot : 0}%` }} /></span>
        <span className="mf-rm__txt">{usdTn(tot, lang)} · {ko ? '기타' : 'Other'} {share(other, tot)}</span>
      </div></td>
    );
  };
  const colMargin = (c: string) => {
    const tot = p.dTot[c] ?? 0, shown = rows.reduce((s, r) => s + (v(r, c) ?? 0), 0), other = Math.max(0, tot - shown);
    const tip = { id: `cm-${c}`, title: ko ? `${nm(c)}에 대한 외국인 보유 합계 ${usdBn(tot, lang)}` : `Foreign holders hold ${usdBn(tot, lang)} of ${nm(c)} in all`,
      meta: [ko ? `표에 없는 보유국(기타) ${usdBn(other, lang)}, ${share(other, tot)}` : `Holders not in the table (Other): ${usdBn(other, lang)}, ${share(other, tot)}`] };
    const h = (44 * tot) / colMax;
    return (
      <td className="mf-mx__cm"><div className="mf-cm" tabIndex={0} aria-label={`${tip.title}. ${tip.meta[0]}`} {...t.bind(tip)} style={{ width: sz.cw }}>
        <span className="mf-cm__bar" style={{ height: h }}><span className="mf-cm__in" style={{ height: `${tot ? (100 * shown) / tot : 0}%` }} /></span>
        <span className="mf-cm__txt">{share(other, tot)}</span>
      </div></td>
    );
  };

  const f = focus ? p.focus[focus] : null;
  const fmax = f ? Math.max(1, ...f.out_top.map((x) => x[1]), ...f.in_top.map((x) => x[1])) : 1;
  const sideList = (l: [string, number][], dir: 'out' | 'in') => (
    <ul className={`mf-bf__list mf-bf__list--${dir}`}>
      {l.map(([c, x]) => (
        <li key={c} className={p.econ[c]?.tag ? 'is-pass' : ''}>
          <span className="mf-bf__name">{p.focus[c] ? <button type="button" className="mf-linkbtn" onClick={() => openFocus(c)}>{nm(c)}</button> : nm(c)}{tag(c)}</span>
          <span className="mf-bf__bar"><span style={{ width: `${(100 * x) / fmax}%` }} /></span>
          <b>{usdBn(x, lang)}</b>
        </li>
      ))}
    </ul>
  );
  const focusPanel = focus && f ? (
    <section className="mf-focus" aria-label={`${ko ? '초점' : 'Focus'}: ${nm(focus)}`}>
      <div className="mf-focus__head">
        <h3 className="mf-focus__title">{nm(focus)} {tag(focus)}</h3>
        <button type="button" className="sn-btn sn-btn--quiet sn-btn--sm" onClick={() => setFocus(null)}>{ko ? '닫기' : 'Close'}</button>
      </div>
      <p className="mf-focus__kpi">
        <span>{ko ? '해외 보유(총)' : 'Holds abroad (gross)'} <b>{usdTn(f.out, lang)}</b></span>
        <span>{ko ? '외국인 보유(총)' : 'Held by foreigners (gross)'} <b>{usdTn(f.in, lang)}</b></span>
        <span>{ko ? '순(해외 보유 − 외국인 보유)' : 'Net (abroad − by foreigners)'} <b>{usdTn(f.out - f.in, lang, true)}</b></span>
      </p>
      <p className="mf-focus__pass">{ko
        ? `해외 보유분 중 FC·${p.market === 'fdi' ? 'SPE' : 'FD'} 대상 ${share(f.out_pass, f.out)} · 외국인 보유분 중 FC·${p.market === 'fdi' ? 'SPE' : 'FD'} 보유자 ${share(f.in_pass, f.in)}`
        : `${share(f.out_pass, f.out)} of its holdings abroad are in FC/${p.market === 'fdi' ? 'SPE' : 'FD'} economies · ${share(f.in_pass, f.in)} of its foreign holders are FC/${p.market === 'fdi' ? 'SPE' : 'FD'}`}</p>
      <div className="mf-bf">
        <div><h4>{ko ? '이 나라가 해외에 보유한 것(상위 10)' : 'What it holds abroad (top 10)'}</h4>{sideList(f.out_top, 'out')}</div>
        <div><h4>{ko ? '이 나라 자산을 보유한 곳(상위 10)' : "Who holds its assets (top 10)"}</h4>{sideList(f.in_top, 'in')}</div>
      </div>
      <p className="mf-note">{ko ? '빗금 막대는 FC·FD(펀드)·SPE 상대국을 나타냅니다. 짝 자료로 확인된 잔액만 더합니다.' : 'Hatched bars: FC, FD or SPE counterparties. Only positions identified by pair data are summed.'}
        {p.econ[focus]?.href ? <> <a className="sn-link" href={p.econ[focus]!.href!}>{ko ? '이 경제의 사다리 보기' : 'Open its ladder'}</a></> : null}</p>
    </section>
  ) : null;

  const passCols = (which: 'out' | 'in') => [
    { key: 'name', label: which === 'out' ? (ko ? '보유국' : 'Holder') : (ko ? '투자 대상국' : 'Destination'), sortable: true,
      render: (_: unknown, r: Record<string, unknown>) => <button type="button" className="mf-linkbtn" onClick={() => openFocus(r.code as string)}>{r.name as string}{p.econ[r.code as string]?.tag ? ` · ${p.econ[r.code as string]!.tag}` : ''}</button> },
    { key: 'gross', label: which === 'out' ? (ko ? '해외 보유' : 'Held abroad') : (ko ? '외국인 보유' : 'Foreign-held'), align: 'right' as const, sortable: true, render: (x: unknown) => usdTn(x as number, lang) },
    { key: 'pass', label: which === 'out' ? (ko ? 'FC·FD 대상 %' : '% in FC/FD') : (ko ? 'FC·FD 보유 %' : '% by FC/FD'), align: 'right' as const, sortable: true, render: (x: unknown) => (x == null ? '–' : `${num(x as number, lang, 1)}%`) },
  ];
  const passRows = (which: 'out' | 'in') => (which === 'out' ? p.rows : p.cols).map((c) => {
    const fc = p.focus[c]; const g = which === 'out' ? fc?.out ?? 0 : fc?.in ?? 0; const ps = which === 'out' ? fc?.out_pass ?? 0 : fc?.in_pass ?? 0;
    return { code: c, name: nm(c), gross: g, pass: g ? (100 * ps) / g : null };
  });

  const tabs = [
    { id: 'holders', label: ko ? '보유국' : 'Holders', content: <DataTable dense caption={ko ? '보유국별 해외 보유와 FC·FD 비중' : 'Holders: holdings abroad and the FC/FD share'} columns={passCols('out') as never} rows={passRows('out') as never} defaultSort={{ key: 'gross', dir: 'desc' }} /> },
    { id: 'dests', label: ko ? '투자 대상국' : 'Destinations', content: <DataTable dense caption={ko ? '투자 대상국별 외국인 보유와 FC·FD 보유자 비중' : 'Destinations: foreign holdings and the FC/FD share of holders'} columns={passCols('in') as never} rows={passRows('in') as never} defaultSort={{ key: 'gross', dir: 'desc' }} /> },
    { id: 'rt', label: ko ? '왕복 짝' : 'Round trips', content: (
      <div>
        <p className="mf-note">{p.rtRule}</p>
        {p.roundTrips.length ? <ul className="mf-rt">{p.roundTrips.map((r) => (
          <li key={`${r.a}${r.b}`}><button type="button" className="mf-linkbtn" onClick={() => goTo({ cell: [r.a, r.b] })}>{nm(r.a)} ⇄ {nm(r.b)}</button>
            <span>{nm(r.a)} → {nm(r.b)} <b>{usdBn(r.ab, lang)}</b></span><span>{nm(r.b)} → {nm(r.a)} <b>{usdBn(r.ba, lang)}</b></span></li>))}</ul>
          : <p className="mf-note">{ko ? '이 기간에는 규칙에 맞는 짝이 없습니다.' : 'No pair meets the rule in this period.'}</p>}
      </div>) },
    { id: 'about', label: ko ? '사다리와의 차이' : 'Ladder vs Markets', content: p.about },
  ];

  return (
    <div className="mf-mkt">
      <ul className="mf-insights" aria-label={ko ? '자료에서 읽은 것' : 'What the data say'}>
        {p.insights.map((x, i) => <li key={i}><button type="button" className="mf-insight" onClick={() => goTo(x.target)}>{x.text}<span aria-hidden> →</span></button></li>)}
      </ul>
      <Fragment key="explainer">{p.explainer}</Fragment>{/* server-made nodes sit in keyed fragments among siblings */}
      <div className="mf-dash__main mf-mkt__main">
        <section className="mf-dcard mf-mkt__card" aria-label={p.text.title}>
          <div className="mf-dcard__head">
            <div><h2 className="mf-dcard__title">{p.text.title}</h2></div>
            <div className="mf-dcard__tools mf-mkt__tools">
              <SegmentedControl size="sm" label={ko ? '표시할 경제 수' : 'Economies shown'} value={String(n)} onChange={(x) => setN(Number(x))} options={[12, 20, 30].map((k) => ({ value: String(k), label: ko ? `상위 ${k}` : `Top ${k}` }))} />
              <SegmentedControl size="sm" label={ko ? '총액 또는 순액' : 'Gross or net'} value={mode} onChange={setMode} options={[{ value: 'gross', label: ko ? '총액' : 'Gross' }, { value: 'net', label: ko ? '순액' : 'Net' }]} />
              <SegmentedControl size="sm" label={ko ? '표현' : 'Encoding'} value={enc} onChange={setEnc} options={[{ value: 'color', label: ko ? '색만' : 'Colour only' }, { value: 'size', label: ko ? '색+크기' : 'Colour + size' }]} />
            </div>
          </div>
          <Legend lang={lang} mode={mode} enc={enc} thr={sz.thr} tags={p.tags} market={p.market} tagTip={(k) => t.bind(tagTip(k))} />
          <div ref={t.ref} className="mf-mx__wrap">
            <div className="mf-mx__axes" aria-hidden><span>{p.text.rowTitle}</span><span className="mf-mx__arrow">{ko ? '행 → 열' : 'row → column'}</span><span>{p.text.colTitle}</span></div>
            <div className="mf-mx" ref={scroller}>
              <table role="grid" aria-label={p.text.title} aria-rowcount={rows.length + 2} aria-colcount={cols.length + 2}>
                <thead><tr>
                  <th className="mf-mx__corner" scope="col"><span className="mf-mx__ct">{ko ? '보유국 ↓ · 투자 대상국 →' : 'Holder ↓ · issuer →'}</span></th>
                  {cols.map((c) => <th key={c} scope="col" className={`mf-mx__ch${hov?.[1] === c ? ' is-line' : ''}`} style={{ width: sz.cw + 4 }}><div className="mf-mx__chi">{label(c, 'col')}</div></th>)}
                  <th scope="col" className="mf-mx__rmh">{ko ? '합계 · 표 밖(기타) 비중' : 'Total · share outside the table (Other)'}</th>
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r}>
                      <th scope="row" className={`mf-mx__rh${hov?.[0] === r ? ' is-line' : ''}`}>{label(r, 'row')}</th>
                      {cols.map((c, j) => <Fragment key={c}>{cell(r, c, i, j)}</Fragment>)}
                      {rowMargin(r)}
                    </tr>
                  ))}
                  <tr className="mf-mx__cmr">
                    <th scope="row" className="mf-mx__rh mf-mx__cmh">{ko ? '열 합계(빗금 = 표 밖 보유국)' : 'Column total (hatched = holders outside the table)'}</th>
                    {cols.map((c) => <Fragment key={c}>{colMargin(c)}</Fragment>)}
                    <td className="mf-mx__rm"><span className="mf-rm__txt">{ko ? `확인된 합계 ${usdTn(p.total, lang)}` : `Identified total ${usdTn(p.total, lang)}`}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            {t.box}
          </div>
          <p className="mf-dcard__foot">{p.source}</p>
        </section>
        <div className={`mf-mkt__side${focus ? ' has-focus' : ''}`}>
          {focusPanel ? <div className="mf-sheet" role="dialog" aria-modal="false" aria-label={nm(focus!)}>{focusPanel}</div> : null}
          <aside className="mf-dpanel" aria-label={ko ? '세부' : 'Detail'}>
            <div className="sn-tabs mf-dpanel__tabs" role="tablist">
              {tabs.map((x, i) => <button key={x.id} type="button" role="tab" id={`tab-${x.id}`} aria-controls={`panel-${x.id}`} aria-selected={x.id === tab} tabIndex={x.id === tab ? 0 : -1} className="sn-tab" onClick={() => setTab(x.id)}
                onKeyDown={(e) => {
                  const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
                  if (j !== null) { e.preventDefault(); setTab(tabs[j].id); (document.getElementById(`tab-${tabs[j].id}`) as HTMLElement | null)?.focus(); }
                }}>{x.label}</button>)}
            </div>
            {tabs.map((x) => <div key={x.id} role="tabpanel" id={`panel-${x.id}`} aria-labelledby={`tab-${x.id}`} hidden={x.id !== tab} className="mf-dpanel__body"><Fragment key="c">{x.content}</Fragment>{x.id === 'holders' ? <Fragment key="d">{p.docLinks}</Fragment> : null}</div>)}
          </aside>
        </div>
      </div>
    </div>
  );
}

function Legend({ lang, mode, enc, thr, tags, market, tagTip }: { lang: Lang; mode: string; enc: string; thr: number; tags: MarketViewProps['tags']; market: string;
  tagTip: (k: TagKind) => Record<string, unknown> }) {
  const ko = lang === 'ko';
  const lab = (b: number) => (ko ? `${num(b * 10, 'ko', 0)}` : b >= 1000 ? `$${b / 1000}tn` : `$${b}bn`);
  const thrText = ko ? `${num(thr * 10, 'ko', 0)}억 달러` : `$${thr}bn`;
  return (
    <div className="mf-lg">
      {mode === 'gross' ? (
        <div className="mf-lg__ramp" aria-label={ko ? '색 범례' : 'Colour legend'}>
          <span className="mf-lg__cap">{ko ? '칸 값(로그 구간)' : 'Cell value (log bins)'}</span>
          <span className="mf-lg__sw">{[1, 2, 3, 4, 5, 6, 7].map((k) => <i key={k} style={{ background: `var(--seq-${k}00)` }} />)}</span>
          <span className="mf-lg__ticks">{BREAKS.map((b) => <span key={b}>{lab(b)}</span>)}</span>
          <span className="mf-lg__dir">{ko ? <><span className="mf-only-light">진할수록 크다</span><span className="mf-only-dark">밝을수록 크다</span>{' · 억 달러'}</> : <><span className="mf-only-light">darker = larger</span><span className="mf-only-dark">brighter = larger</span></>}</span>
        </div>
      ) : (
        <div className="mf-lg__ramp" aria-label={ko ? '순액 범례' : 'Net legend'}>
          <span className="mf-lg__cap">{ko ? '순액 = 행→열 − 열→행' : 'Net = row→column − column→row'}</span>
          <span className="mf-lg__sw">{['neg-3', 'neg-2', 'neg-1', 'mid', 'pos-1', 'pos-2', 'pos-3'].map((k) => <i key={k} style={{ background: `var(--div-${k})` }} />)}</span>
          <span className="mf-lg__ticks">{ko ? <><span>−1만</span><span>−1,000</span><span>−100</span><span>+100</span><span>+1,000</span><span>+1만 억 달러</span></> : <><span>−$1tn</span><span>−$100bn</span><span>−$10bn</span><span>+$10bn</span><span>+$100bn</span><span>+$1tn</span></>}</span>
          <span className="mf-lg__dir">{ko ? '파랑: 행이 더 많이 보유 · 주황: 열이 더 많이 보유 · 빗금 칸: 거울(반대쪽 칸의 부호 반대)' : 'Blue: the row holds more · orange: the column holds more · hatched: mirror of a cell already shown'}</span>
        </div>
      )}
      <span className="mf-lg__item">{enc === 'size' ? (ko ? '■ 사각형 넓이 ∝ 값' : '■ square area ∝ value') : (ko ? '색만' : 'colour only')}</span>
      <span className="mf-lg__item">{ko ? `숫자: ${thrText} 이상 칸` : `Numbers: cells of ${thrText} or more`}</span>
      <span className="mf-lg__item"><i className="mf-lg__self" />{ko ? '자국 보유 제외' : 'Domestic, not cross-border (left out)'}</span>
      <span className="mf-lg__item"><i className="mf-lg__other" />{ko ? '합계·기타는 회색, 색 척도 밖' : 'Totals and Other in grey, off the scale'}</span>
      {(['FC', market === 'fdi' ? 'SPE' : 'FD'] as TagKind[]).map((k) => (
        <span key={k} className="mf-lg__item"><span className={`mf-tg mf-tg--${k}`} tabIndex={0} role="note" {...tagTip(k)}>{k}</span>{ko ? tags[k].ko : tags[k].en}{ko ? ` (${tags[k].en})` : ''}</span>
      ))}
    </div>
  );
}
