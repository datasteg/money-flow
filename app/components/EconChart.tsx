'use client';
// The dashboard's lead card: the ladder, its Chart/Table switch, the legend (channels switch on and off; the colours
// never move), the downloads and the source line. The CSV holds the drawn marks of open-class sources only (M11), in
// the unit the page shows (USD bn; 억 달러 on /ko), named in its column headers; licensed fund flows are never in it.
// The chart is laid out for the box it gets (Ladder: compact on screens, phone below 560px); PNG and SVG always print
// the 1000 x 600 figure, rendered off screen for the download. On phones the downloads sit behind one "⋯" menu and a
// button opens the whole ladder full screen, turned to landscape.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { DataTable, SegmentedControl } from './sn/client';
import { Icon } from './sn';
import { Ladder, RungPanels, COLOR, EXPORT_SIZE, type LadderSize, type LadderText } from './Ladder';
import { downloadCsv, downloadPng, downloadSvg, type FigureMeta } from '@/lib/export';
import { amt, csvAmt, money, period } from '@/lib/format';
import type { Bar, NodeM, PoolM, Rib } from '@/lib/model';
import type { Lang } from '@/lib/types';

export interface EconChartProps {
  lang: Lang;
  title: string; subtitle: string; source: ReactNode; updated: string;
  rungSrc?: { apex?: ReactNode; border?: ReactNode; made?: ReactNode };
  holders: NodeM[]; pools: PoolM[]; ribbons: Rib[]; apex: Bar[]; made: Bar[];
  flow: boolean; dir: 'in' | 'out'; econ: string;
  labels: {
    chart: string; table: string; source: string; updated: string; png: string; svg: string; csv: string;
    rungs: { global: string; country: string; market: string }; made: string; border: string; apex: string;
    channel: Record<string, string>; unit: string;
    tip: LadderText['tip'];
    cols: { holder: string; channel: string; position: string; flow: string; period: string; source: string; rules: string; reported: string };
    caption: string; note: string; legend: string; off: string[];
  };
  borderItems: { label: string; value: string }[];
  table: { holder: string; channel: string; value: number; flow: number | null; period: string; source: string; rules: string; rep: string }[];
  figure: FigureMeta;
  aria: string;
  legendHrefs: Record<string, string>;
}

/** The size of a box, kept current by a ResizeObserver; with the label size the viewport calls for. */
function useBox(on = true) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number; vw: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight, vw: window.innerWidth }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [on]);
  return { ref, box };
}

/** Screen layout: phone under 560px of chart width, else compact; labels clamp(12px, 0.75vw, 14px). */
function sizeFor(box: { w: number; h: number; vw: number } | null, nodes: number): LadderSize | null {
  if (!box || box.w < 50) return null;
  if (box.w < 560) return { w: box.w, h: Math.max(300, Math.min(440, 120 + Math.min(nodes, 8) * 36)), fs: 12, mode: 'phone' };
  return { w: box.w, h: Math.max(320, box.h), fs: Math.round(Math.min(14, Math.max(12, box.vw * 0.0075)) * 2) / 2, mode: 'compact' };
}

export function EconChart(p: EconChartProps) {
  const ko = p.lang === 'ko';
  const [view, setView] = useState('chart');
  const [full, setFull] = useState(false);
  const body = useBox(view === 'chart');
  const fmt = (v: number | null) => amt(v, p.lang);
  const text: LadderText = {
    rungs: p.labels.rungs, made: p.labels.made, border: p.labels.border, apex: p.labels.apex, flow: p.flow, dir: p.dir, econ: p.econ,
    fmt, money: (v: number | null) => money(v, p.lang), period: (iso: string, f: string) => period(iso, f, p.lang), unit: p.labels.unit,
    channel: p.labels.channel, tip: p.labels.tip, borderItems: p.borderItems, aria: p.aria,
    poolValue: (pl: PoolM) => (pl.total != null ? fmt(pl.total) : ''),
    other: ko ? '기타' : 'Other', close: ko ? '닫기' : 'Close', holdersList: p.labels.cols.holder, marketsList: p.labels.rungs.market,
  };
  const nodes = new Set(p.ribbons.map((r) => r.holder)).size;
  const size = sizeFor(body.box, nodes);
  const groups = ['debt', 'bank', 'fdi', 'equity', 'unsplit', 'reserves'].filter((g) => p.ribbons.some((r) => r.group === g) || p.labels.off.includes(g));
  // the figure: the 1000 x 600 ladder rendered off screen (in the page, so its labels have their computed styles)
  const figure = (go: (svg: SVGSVGElement) => void) => {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;left:-20000px;top:0;width:1000px;';
    document.body.appendChild(host);
    const root = createRoot(host);
    flushSync(() => root.render(<Ladder holders={p.holders} pools={p.pools} ribbons={p.ribbons} apex={p.apex} made={p.made} text={text} size={EXPORT_SIZE} />));
    const s = host.querySelector('svg.mf-ladder__svg') as SVGSVGElement | null;
    try { if (s) go(s); } finally { root.unmount(); host.remove(); }
  };
  const csv = () => downloadCsv(p.table.map((r) => ({ ...r, value: csvAmt(r.value, p.lang), flow: csvAmt(r.flow, p.lang) })),
    [p.labels.cols.holder, p.labels.cols.channel, p.labels.cols.position, p.labels.cols.flow, p.labels.cols.period, p.labels.cols.source, p.labels.cols.rules, p.labels.cols.reported],
    ['holder', 'channel', 'value', 'flow', 'period', 'source', 'rules', 'rep'], p.figure.filename);
  const btn = 'sn-btn sn-btn--quiet sn-btn--sm';
  const ladder = (z: LadderSize | null, sheet?: boolean) => z
    ? <Ladder holders={p.holders} pools={p.pools} ribbons={p.ribbons} apex={p.apex} made={p.made} text={text} size={z} sheet={sheet} />
    : <div className="mf-ladder mf-ladder--wait" aria-busy="true" />;
  return (
    <section className={`mf-dcard mf-chartcard${view === 'table' ? ' is-table' : ''}`} aria-label={p.title}>
      <div className="mf-dcard__head">
        <div className="mf-dcard__titles">
          <h2 className="mf-dcard__title">{p.title}</h2>
          <p className="mf-dcard__sub">{p.subtitle}</p>
        </div>
        <div className="mf-dcard__tools">
          <SegmentedControl size="sm" label={p.title} value={view} onChange={setView} options={[{ value: 'chart', label: p.labels.chart }, { value: 'table', label: p.labels.table }]} />
          <button type="button" className={btn} onClick={() => figure((s) => downloadPng(s, p.figure))}>{p.labels.png}</button>
          <button type="button" className={btn} onClick={() => figure((s) => downloadSvg(s, p.figure))}>{p.labels.svg}</button>
          <button type="button" className={btn} onClick={csv}>{p.labels.csv}</button>
        </div>
        <details className="mf-more">
          <summary className="sn-btn sn-btn--secondary sn-btn--sm" aria-label={ko ? '보기와 내려받기' : 'View and downloads'}>⋯</summary>
          <div className="mf-more__menu" role="menu">
            <button type="button" role="menuitem" onClick={(e) => { setView(view === 'chart' ? 'table' : 'chart'); e.currentTarget.closest('details')?.removeAttribute('open'); }}>
              {view === 'chart' ? p.labels.table : p.labels.chart}</button>
            <button type="button" role="menuitem" onClick={() => figure((s) => downloadPng(s, p.figure))}>{p.labels.png}</button>
            <button type="button" role="menuitem" onClick={() => figure((s) => downloadSvg(s, p.figure))}>{p.labels.svg}</button>
            <button type="button" role="menuitem" onClick={csv}>{p.labels.csv}</button>
          </div>
        </details>
      </div>
      <div className="mf-dcard__legend" data-chiprow>
        <ul className="sn-legend" aria-label={p.labels.legend}>
          <li className="mf-dirchip" data-dir={p.dir}><span aria-hidden>{p.dir === 'in' ? '→' : '←'}</span>{p.dir === 'in' ? (ko ? '유입' : 'Inflows') : (ko ? '유출' : 'Outflows')}</li>
          {groups.map((g) => {
            const off = p.labels.off.includes(g);
            return (
              <li key={g}>
                <a className={`sn-legend__item${off ? ' is-off' : ''}`} aria-pressed={!off} href={p.legendHrefs[g]} role="button">
                  <span className="sn-legend__key sn-legend__key--bar" style={{ ['--k' as string]: COLOR[g] }} aria-hidden />{p.labels.channel[g]}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
      {view === 'chart' ? <RungPanels apex={p.apex} made={p.made} text={text} src={p.rungSrc} source={p.labels.source} /> : null}
      <div className={`mf-dcard__body${view === 'table' ? ' is-table' : ''}`} ref={body.ref}>
        {view === 'chart' ? ladder(size) : <NumbersTable lang={p.lang} rows={p.table} labels={p.labels} flow={p.flow} />}
      </div>
      {view === 'chart' ? (
        <button type="button" className="sn-btn sn-btn--secondary mf-fullbtn" onClick={() => setFull(true)}>
          <Icon name="expand" size={18} />{ko ? '전체 차트 보기' : 'View the full chart'}</button>
      ) : null}
      <p className="mf-dcard__foot">{p.labels.source}{p.source} · {p.labels.updated} {p.updated}</p>
      {full ? <FullChart title={p.title} close={text.close} hint={ko ? '휴대폰을 가로로 돌려 주십시오' : 'Turn the phone sideways'} onClose={() => setFull(false)}>{(z) => ladder(z, true)}</FullChart> : null}
    </section>
  );
}

/** The whole ladder full screen. It asks for landscape (fullscreen + orientation lock, where the browser allows it);
 *  where it cannot, a portrait screen shows the chart turned a quarter, to be read with the phone held sideways. */
function FullChart({ title, close, hint, onClose, children }: { title: string; close: string; hint: string; onClose: () => void; children: (z: LadderSize | null) => ReactNode }) {
  const box = useBox();
  const self = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = self.current;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    el?.querySelector<HTMLElement>('.mf-fullchart__close')?.focus();
    (async () => {
      try {
        await el?.requestFullscreen?.();
        await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.('landscape');
      } catch { /* not allowed here: the CSS turn takes over */ }
    })();
    return () => {
      html.style.overflow = prev;
      document.removeEventListener('keydown', esc);
      try { screen.orientation?.unlock?.(); } catch { /* nothing to unlock */ }
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    };
  }, [onClose]);
  const z: LadderSize | null = box.box && box.box.w > 50 ? { w: box.box.w, h: box.box.h, fs: 12, mode: box.box.w < 560 ? 'phone' : 'compact' } : null;
  return (
    <div className="mf-fullchart" role="dialog" aria-modal="true" aria-label={title} ref={self}>
      <div className="mf-fullchart__turn">
        <div className="mf-fullchart__bar">
          <p className="mf-fullchart__title">{title}</p>
          <span className="mf-fullchart__hint">{hint}</span>
          <button type="button" className="sn-btn sn-btn--secondary sn-btn--sm mf-fullchart__close" onClick={onClose}>{close}</button>
        </div>
        <div className="mf-fullchart__body" ref={box.ref}>{children(z)}</div>
      </div>
    </div>
  );
}

/** The drawn marks as a table: the chart's Table view and the panel's Numbers tab. */
export function NumbersTable({ lang, rows, labels, flow }: { lang: Lang; rows: EconChartProps['table']; labels: EconChartProps['labels']; flow?: boolean }) {
  return (
    <>
      <p className="mf-note">{labels.note}</p>
      <DataTable dense caption={labels.caption} defaultSort={{ key: 'value', dir: 'desc' }} rows={rows}
        columns={[
          { key: 'holder', label: labels.cols.holder, sortable: true },
          { key: 'channel', label: labels.cols.channel, sortable: true },
          { key: 'value', label: labels.cols.position, align: 'right', sortable: true, render: (v) => amt(v as number, lang) },
          ...(flow ? [{ key: 'flow' as const, label: labels.cols.flow, align: 'right' as const, sortable: true, render: (v: unknown) => amt(v as number, lang, true) }] : []),
          { key: 'period', label: labels.cols.period },
          { key: 'source', label: labels.cols.source },
          { key: 'rules', label: labels.cols.rules },
          { key: 'rep', label: labels.cols.reported },
        ]} />
    </>
  );
}
