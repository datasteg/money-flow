// Sinho components that render on the server (design/index.d.ts is the props contract; design/bundle.js the reference
// markup). Class names are Sinho's own (.sn-*), styled by design/sinho.css. Interactive ones are in ./client.tsx.
import type { ReactNode } from 'react';
import { minus } from '@/lib/format';
import type { Lang } from '@/lib/types';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export const ICONS: Record<string, string[]> = {
  download: ['M12 4v11', 'M7.5 10.5 12 15l4.5-4.5', 'M5 19.5h14'],
  chevron: ['M6 9l6 6 6-6'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 7.6v.1'],
  good: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M8 12.2l2.7 2.7L16 9.6'],
  warning: ['M10.3 4.2 2.6 17.6A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-2.9L13.7 4.2a2 2 0 0 0-3.4 0z', 'M12 9.5v4', 'M12 17v.1'],
  critical: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9 9l6 6', 'M15 9l-6 6'],
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3 12h18', 'M12 3c2.5 2.7 3.6 5.7 3.6 9s-1.1 6.3-3.6 9c-2.5-2.7-3.6-5.7-3.6-9S9.5 5.7 12 3z'],
  sort: ['M8 9l4-4 4 4', 'M8 15l4 4 4-4'],
  unlock: ['M5 11h14v9.5H5z', 'M8 11V7.5a4 4 0 0 1 7.6-1.7'],
  expand: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
  sliders: ['M4 7h10', 'M18 7h2', 'M14 5v4', 'M4 17h2', 'M10 17h10', 'M10 15v4'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  railClose: ['M4 4h16v16H4z', 'M15 4v16', 'M9 10l2 2-2 2'],
  railOpen: ['M4 4h16v16H4z', 'M15 4v16', 'M11 10l-2 2 2 2'],
  gauge: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 12l4-4'],
  database: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
  rules: ['M5 4h14v16H5z', 'M9 9h6', 'M9 13h6', 'M9 17h3'],
  checks: ['M4 7l2 2 3-3', 'M12 8h8', 'M4 15l2 2 3-3', 'M12 16h8'],
  flows: ['M4 8h14', 'M15 5l3 3-3 3', 'M20 16H6', 'M9 13l-3 3 3 3'],
  book: ['M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z', 'M4 5v16'],
  quote: ['M7 7h4v4H8a3 3 0 0 0 3 3v2a5 5 0 0 1-5-5V8a1 1 0 0 1 1-1z', 'M14 7h4v4h-3a3 3 0 0 0 3 3v2a5 5 0 0 1-5-5V8a1 1 0 0 1 1-1z'],
};

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {(ICONS[name] ?? []).map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

export function Masthead({ name, mark, tag, href, links, actions, label }: { name: string; mark?: ReactNode; tag?: string; href: string; links: { label: string; href: string; active?: boolean }[]; actions?: ReactNode; label: string }) {
  return (
    <header className="sn-mast mf-mast">
      <a className="sn-wordmark" href={href}>{mark}{name}{tag ? <span className="mf-mast__tag">{tag}</span> : null}</a>
      <nav className="sn-mast__nav" aria-label={label}>
        {links.map((l) => <a key={l.href} href={l.href} aria-current={l.active ? 'page' : undefined}>{l.label}</a>)}
      </nav>
      <div className="sn-mast__actions">{actions}</div>
    </header>
  );
}

export function LanguageSwitch({ current, options, label }: { current: Lang; options: { code: Lang; label: string; href: string }[]; label: string }) {
  return (
    <nav className="sn-lang" aria-label={label}>
      <span className="sn-lang__icon"><Icon name="globe" /></span>
      {options.map((o, i) => (
        <span key={o.code} style={{ display: 'contents' }}>
          {i > 0 && <span className="sn-lang__sep" aria-hidden>/</span>}
          <a href={o.href} lang={o.code} hrefLang={o.code} aria-current={o.code === current ? 'true' : undefined}>{o.label}</a>
        </span>
      ))}
    </nav>
  );
}

export function Footer({ name, href, links, note, label }: { name: string; href: string; links: { label: string; href: string }[]; note?: ReactNode; label: string }) {
  return (
    <footer className="sn-foot">
      <div className="sn-foot__row"><a className="sn-wordmark sn-wordmark--sm" href={href}>{name}</a></div>
      <nav className="sn-foot__nav" aria-label={label}>{links.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}</nav>
      {note ? <p className="sn-foot__note">{note}</p> : null}
    </footer>
  );
}

export function Delta({ value, direction = 'flat', tone = 'neutral', srLabel }: { value: string; direction?: 'up' | 'down' | 'flat'; tone?: string; srLabel?: string }) {
  const ARROW = { up: 'M6 1.5 11 9H1z', down: 'M6 10.5 1 3h10z', flat: 'M1 6h8M7 3l3 3-3 3' };
  return (
    <span className={cx('sn-delta', `sn-delta--${tone}`)}>
      <svg viewBox="0 0 12 12" className="sn-delta__arrow" aria-hidden focusable="false">
        {direction === 'flat' ? <path d={ARROW.flat} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /> : <path d={ARROW[direction]} fill="currentColor" />}
      </svg>
      {srLabel ? <span className="sn-visually-hidden">{srLabel} </span> : null}
      <span>{minus(value)}</span>
    </span>
  );
}

export function Sparkline({ data, width = 112, height = 32, label }: { data: (number | null)[]; width?: number; height?: number; label?: string }) {
  const v = data.filter((x): x is number => x != null);
  if (v.length < 2) return null;
  const pad = 4, min = Math.min(...v, 0), max = Math.max(...v, 0), span = max - min || 1;
  const x = (i: number) => pad + (i * (width - 2 * pad)) / (v.length - 1);
  const y = (n: number) => height - pad - ((n - min) / span) * (height - 2 * pad);
  const d = v.map((n, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(n).toFixed(1)}`).join(' ');
  return (
    <svg className="sn-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <line x1={pad} x2={width - pad} y1={y(0)} y2={y(0)} stroke="var(--viz-axis)" strokeWidth={1} />
      <path d={d} className="sn-spark__line" />
      <circle cx={x(v.length - 1)} cy={y(v[v.length - 1])} r={3} className="sn-spark__dot" />
    </svg>
  );
}

export function StatTile({ label, value, unit, sub, hero }: { label: string; value: string; unit?: string; sub?: ReactNode; hero?: boolean }) {
  return (
    <div className={cx('sn-stat', hero && 'sn-stat--hero')}>
      <p className="sn-stat__label">{label}</p>
      <p className="sn-stat__value">{minus(value)}{unit ? <span className="sn-stat__unit">{/^[%억조]/.test(unit) ? '' : ' '}{unit}</span> : null}</p>
      {sub ? <p className="sn-stat__source">{sub}</p> : null}
    </div>
  );
}

export function Notice({ tone = 'info', title, children, action }: { tone?: 'info' | 'good' | 'warning' | 'critical'; title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={cx('sn-notice', `sn-notice--${tone}`)} role={tone === 'critical' ? 'alert' : 'status'}>
      <span className="sn-notice__icon"><Icon name={tone} /></span>
      <div>
        {title ? <p className="sn-notice__title">{title}</p> : null}
        {children ? <div className="sn-notice__body">{children}</div> : null}
        {action ?? null}
      </div>
    </div>
  );
}

export function Tag({ kind = 'topic', href, children }: { kind?: 'topic' | 'jel' | 'new'; href?: string; children: ReactNode }) {
  const cls = cx('sn-tag', kind !== 'topic' && `sn-tag--${kind}`);
  return href ? <a className={cls} href={href}>{children}</a> : <span className={cls}>{children}</span>;
}

export function PaperCard({ label, title, authors, journal, citation, year, href, facts, lang }: {
  label: string; title?: string; authors?: string; journal?: string; citation?: string; year?: string | number; href?: string; facts?: { label: string; value: ReactNode }[]; lang?: string;
}) {
  const venue = [citation, year].filter(Boolean).join(', ');
  return (
    <aside className="sn-paper" aria-label={label}>
      <div className="sn-paper__head"><p className="sn-kicker sn-kicker--muted">{label}</p></div>
      {title ? <p className="sn-paper__title" lang={lang ?? 'en'}>{href ? <a className="sn-link" href={href} target="_blank" rel="noopener">{title}</a> : title}</p> : null}
      {authors ? <p className="sn-paper__authors" lang="en">{authors}</p> : null}
      {journal ? <p className="sn-paper__venue" lang="en"><span className="mf-venue">{journal}</span>{venue ? `, ${venue}` : null}</p> : null}
      {facts?.length ? (
        <dl className="sn-paper__facts">
          {facts.map((f, i) => <div key={i} style={{ display: 'contents' }}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
        </dl>
      ) : null}
    </aside>
  );
}

export function Status({ status, labels }: { status: string; labels: { pass: string; warning: string; info: string; fail: string } }) {
  const icon = status === 'pass' ? 'good' : status === 'fail' ? 'critical' : status === 'warning' ? 'warning' : 'info';
  const word = (labels as Record<string, string>)[status] ?? status;
  return <span className={cx('mf-status', `mf-status--${status}`)}><Icon name={icon} size={16} />{word}</span>;
}

export function Kicker({ children }: { children: ReactNode }) {
  return <p className="sn-kicker">{children}</p>;
}
