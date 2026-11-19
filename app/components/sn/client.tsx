'use client';
// Sinho's interactive components (design/bundle.js reference): ChartCard with its Chart/Table switch, the sortable
// DataTable, SegmentedControl, the Ticker (the one moving element) and the theme toggle.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './index';
import { minus } from '@/lib/format';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function SegmentedControl({ options, value, onChange, label, size }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; label: string; size?: 'sm' | 'md' }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className={cx('sn-seg', size === 'sm' && 'sn-seg--sm')} role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={o.value === value} tabIndex={o.value === value ? 0 : -1}
          className="sn-seg__opt" onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const n = options.length;
            const j = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + n) % n : null;
            if (j !== null) { e.preventDefault(); onChange(options[j].value); refs.current[j]?.focus(); }
          }}>{o.label}</button>
      ))}
    </div>
  );
}

export function ChartCard({ title, subtitle, legend, table, children, source, updated, tools, labels, footnote }: {
  title: string; subtitle?: string; legend?: ReactNode; table?: ReactNode; children: ReactNode; source?: string; updated?: string; tools?: ReactNode; footnote?: ReactNode;
  labels: { chart: string; table: string; source: string; updated: string };
}) {
  const [view, setView] = useState('chart');
  return (
    <section className="sn-card mf-card" aria-label={title}>
      <div className="sn-card__head">
        <div>
          <h3 className="sn-card__title">{title}</h3>
          {subtitle ? <p className="sn-card__sub">{subtitle}</p> : null}
        </div>
        <div className="sn-card__tools">
          {table ? <SegmentedControl size="sm" label={title} value={view} onChange={setView} options={[{ value: 'chart', label: labels.chart }, { value: 'table', label: labels.table }]} /> : null}
        </div>
      </div>
      {legend && view === 'chart' ? <div className="sn-card__legend">{legend}</div> : null}
      <div className="sn-card__body">{view === 'table' && table ? table : children}</div>
      {(source || updated || tools) ? (
        <div className="sn-card__foot mf-card__foot">
          <p className="sn-card__source">
            {source ? labels.source + source : null}
            {source && updated ? <span className="sn-sep" aria-hidden>·</span> : null}
            {updated ? `${labels.updated} ${updated}` : null}
            {footnote ? <span className="sn-card__note">{footnote}</span> : null}
          </p>
          {tools ? <div className="mf-tools">{tools}</div> : null}
        </div>
      ) : null}
    </section>
  );
}

export interface Col<R> { key: keyof R & string; label: string; align?: 'left' | 'right'; sortable?: boolean; render?: (v: R[keyof R], r: R) => ReactNode }

export function DataTable<R extends Record<string, unknown>>({ columns, rows, caption, dense, defaultSort, showCaption }: {
  columns: Col<R>[]; rows: R[]; caption: string; dense?: boolean; defaultSort?: { key: string; dir: 'asc' | 'desc' }; showCaption?: boolean;
}) {
  const [sort, setSort] = useState(defaultSort ?? null);
  const sorted = rows.slice();
  if (sort) sorted.sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
    return sort.dir === 'desc' ? -r : r;
  });
  return (
    <div className="sn-table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className={cx('sn-table', dense && 'sn-table--dense')}>
        <caption className={showCaption ? 'sn-table__caption' : 'sn-visually-hidden'}>{caption}</caption>
        <thead>
          <tr>{columns.map((c) => {
            const active = sort?.key === c.key;
            return (
              <th key={c.key} scope="col" className={c.align === 'right' ? 'is-num' : undefined} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sortable ? 'none' : undefined}>
                {c.sortable ? (
                  <button type="button" className={cx('sn-table__sort', active && 'is-active')}
                    onClick={() => setSort(active ? { key: c.key, dir: sort!.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.align === 'right' ? 'desc' : 'asc' })}>
                    {c.label}<Icon name="sort" size={14} />
                  </button>
                ) : c.label}
              </th>
            );
          })}</tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i}>{columns.map((c, j) => {
              const v = r[c.key];
              const content = c.render ? c.render(v, r) : (v as ReactNode);
              return j === 0 ? <th key={c.key} scope="row" className={c.align === 'right' ? 'is-num' : undefined}>{content}</th>
                : <td key={c.key} className={c.align === 'right' ? 'is-num' : undefined}>{content}</td>;
            })}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Ticker({ title, items, label }: { title: string; items: { label: string; value: string; unit?: string; note?: string }[]; label: string }) {
  const dur = Math.max(24, items.length * 6);
  const row = (dup: boolean) => (
    <ul className="sn-ticker__row" aria-hidden={dup ? true : undefined}>
      {items.map((it, i) => (
        <li key={i} className="sn-ticker__item">
          <span className="sn-ticker__label">{it.label}</span>
          <span className="sn-ticker__value">{minus(it.value)}</span>
          {it.unit ? <span className="sn-ticker__unit">{it.unit}</span> : null}
          {it.note ? <span className="sn-ticker__unit mf-ticker__note">{it.note}</span> : null}
        </li>
      ))}
    </ul>
  );
  return (
    <section className="sn-ticker" aria-label={label}>
      <p className="sn-ticker__title"><span className="sn-ticker__dot" aria-hidden />{title}</p>
      <div className="sn-ticker__viewport">
        <div className="sn-ticker__track" style={{ animationDuration: `${dur}s` }}>{row(false)}{row(true)}</div>
      </div>
    </section>
  );
}

export function ThemeToggle({ toNight, toDay }: { toNight: string; toDay: string }) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches));
  }, []);
  return (
    <button type="button" className="sn-btn sn-btn--quiet sn-btn--sm" aria-label={dark ? toDay : toNight}
      onClick={() => {
        const next = dark ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem('sinho-theme', next); } catch { /* private mode */ }
        setDark(!dark);
      }}>
      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
        {dark ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
          : <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />}
      </svg>
    </button>
  );
}

export function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="sn-btn sn-btn--secondary sn-btn--sm" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1600); } catch { /* no clipboard */ }
    }}>{ok ? done : label}</button>
  );
}

export function DownloadText({ text, filename, label, mime = 'text/plain' }: { text: string; filename: string; label: string; mime?: string }) {
  return (
    <button type="button" className="sn-btn sn-btn--quiet sn-btn--sm" onClick={() => {
      const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}><Icon name="download" size={16} />{label}</button>
  );
}
