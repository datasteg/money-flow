// The token sheet: every colour, the type scale, the controls, cards and chart colours money-flow uses, drawn from
// the live tokens (design/tokens.css and the additions at the top of site.css), so the system can be checked by eye in
// both themes. Not linked from the masthead; docs/design-system.md says where each token is used.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StyleControls } from '@/components/StyleDemo';
import { DocLinks } from '@/components/Page';
import { Kicker, StatTile } from '@/components/sn';
import { isLang } from '@/lib/i18n';
import type { Lang } from '@/lib/types';

export const metadata: Metadata = { title: 'Style' };

const GROUPS: { en: string; ko: string; tokens: [string, string][] }[] = [
  { en: 'The street (Sinho primitives)', ko: '거리(Sinho 기본색)', tokens: [['concrete', 'Day ground, cards'], ['slab', 'Day page ground'], ['asphalt', 'Night ground, day ink'], ['sign', 'Action by day'], ['sign-lit', 'Action by night'], ['centerline', 'The one selected state per view'], ['led', 'The LED: newest day']] },
  { en: 'Surfaces', ko: '면', tokens: [['mf-ground', 'Page ground (added)'], ['mf-card', 'Cards, rail, KPI tiles (added)'], ['surface', 'Sinho surface; inside cards it follows the card'], ['surface-concrete', 'Night cards'], ['deep', 'Signboard: the filter strip'], ['deep-field', 'Fields on the signboard'], ['deep-lane', 'Scrubber track']] },
  { en: 'Ink and lines', ko: '글자와 선', tokens: [['ink', 'Text'], ['ink-secondary', 'Labels'], ['ink-muted', 'Metadata (≥ 4.5:1 on every ground)'], ['link', 'Links, kickers'], ['marking', 'Tab and nav underline, selected row'], ['line', 'Hairlines, card borders'], ['line-strong', 'Dashed lane dividers'], ['focus', 'Focus ring']] },
  { en: 'Ladder channels (added)', ko: '사다리 경로(추가)', tokens: [['mf-ch-debt', 'viz-1 · portfolio debt'], ['mf-ch-bank', 'viz-3 · bank loans and deposits'], ['mf-ch-fdi', 'viz-4 · direct investment'], ['mf-ch-equity', 'viz-5 · portfolio equity'], ['mf-ch-reserves', 'viz-7 · reserve assets'], ['mf-ch-unsplit', 'viz-context · type not reported']] },
  { en: 'Direction (added)', ko: '방향(추가)', tokens: [['mf-flow-in', 'seq-500 · inflows'], ['mf-flow-out', 'div-neg-2 · outflows']] },
  { en: 'Status', ko: '상태', tokens: [['status-good', ''], ['status-warning', ''], ['status-serious', ''], ['status-critical', '']] },
];
const RAMPS = [['viz', ['viz-1', 'viz-2', 'viz-3', 'viz-4', 'viz-5', 'viz-6', 'viz-7', 'viz-8']], ['seq', ['seq-100', 'seq-200', 'seq-300', 'seq-400', 'seq-500', 'seq-600', 'seq-700']], ['div', ['div-neg-3', 'div-neg-2', 'div-neg-1', 'div-mid', 'div-pos-1', 'div-pos-2', 'div-pos-3']]] as const;
const TYPE: [string, string, string][] = [['text-title', '22px / 700', '미국은 한국에 4,417억 달러의 청구권을 보유합니다'], ['text-kpi', '24px / 700, Archivo, tabular', '10,640억 달러'], ['text-kpi-sm', '20px, phones', '19,819'], ['text-md', '17px', '카드 제목'], ['text-base', '15px', '본문과 입력'], ['text-sm', '13px', '컨트롤과 범례'], ['text-xs', '12px, the smallest on screen', 'Sources, notes, axis · 출처와 주석']];

export default async function StylePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  if (!isLang(raw)) notFound();
  const lang: Lang = raw;
  const ko = lang === 'ko';
  return (
    <div className="mf-shell mf-style">
      <Kicker>{ko ? '디자인 시스템 · Sinho 1' : 'Design system · Sinho 1'}</Kicker>
      <h1 className="mf-title">{ko ? '토큰 시트: money-flow가 쓰는 색, 글자, 컨트롤' : 'Token sheet: the colours, type and controls money-flow uses'}</h1>
      <p className="mf-note">{ko ? '모든 견본은 현재 테마의 토큰 값으로 그립니다. 테마를 바꿔 두 테마를 함께 점검합니다. 각 토큰의 사용처는 docs/design-system.md에 있습니다.' : 'Every sample is drawn from the current theme’s tokens; switch the theme to check both. Where each token is used: docs/design-system.md.'}</p>
      {GROUPS.map((g) => (
        <section key={g.en}>
          <h2 className="mf-h2">{ko ? g.ko : g.en}</h2>
          <ul className="mf-swatches">
            {g.tokens.map(([n, u]) => <li key={n}><span className="mf-swatch" style={{ background: `var(--${n})` }} /><code>--{n}</code><span>{u}</span></li>)}
          </ul>
        </section>
      ))}
      <h2 className="mf-h2">{ko ? '차트 램프' : 'Chart ramps'}</h2>
      {RAMPS.map(([k, list]) => (
        <div key={k} className="mf-ramp"><code>{k}</code>{list.map((n) => <span key={n} title={`--${n}`} style={{ background: `var(--${n})` }} />)}</div>
      ))}
      <h2 className="mf-h2">{ko ? '글자 크기' : 'Type scale'}</h2>
      <ul className="mf-typescale">
        {TYPE.map(([n, d, sample]) => <li key={n}><code>--{n}</code><span className="mf-muted">{d}</span><span style={{ fontSize: `var(--${n})`, fontWeight: n.startsWith('text-kpi') || n === 'text-title' ? 700 : 500, fontVariantNumeric: 'tabular-nums' }}>{sample}</span></li>)}
      </ul>
      <h2 className="mf-h2">{ko ? '컨트롤: 간판(deep) 위의 필터' : 'Controls: the filter signboard (deep)'}</h2>
      <StyleControls lang={lang} />
      <h2 className="mf-h2">{ko ? '카드' : 'Cards'}</h2>
      <div className="mf-dash" data-dir="in" style={{ padding: 0 }}>
        <ul className="mf-kpis mf-kpis--strip">
          <li className="mf-kpi"><StatTile label={ko ? '해외 보유 증권(유입)' : 'Securities held abroad (inflows)'} value="10,640" unit={ko ? '억 달러' : 'USD bn'} sub={ko ? '2025년 말 · IMF PIP' : 'end-2025 · IMF PIP'} /></li>
          <li className="mf-kpi" style={{ ['--mf-dir' as string]: 'var(--mf-flow-out)' }}><StatTile label={ko ? '외환보유액(유출)' : 'Reserves (outflows)'} value="4,406" unit={ko ? '억 달러' : 'USD bn'} sub={ko ? '2026년 9월 · ECOS' : 'Sep 2026 · ECOS'} /></li>
        </ul>
        <section className="mf-dcard">
          <div className="mf-dcard__head"><div className="mf-dcard__titles"><h3 className="mf-dcard__title">{ko ? '차트 카드' : 'Chart card'}</h3><p className="mf-dcard__sub">{ko ? '범례는 간판 조각, 방향 칩은 방향 색 테두리' : 'Legend items are plates; the direction chip has the direction’s colour'}</p></div></div>
          <div className="mf-dcard__legend"><ul className="sn-legend">
            <li className="mf-dirchip" data-dir="in"><span aria-hidden>→</span>{ko ? '유입' : 'Inflows'}</li>
            {(['debt', 'bank', 'fdi', 'equity', 'reserves', 'unsplit'] as const).map((g) => <li key={g}><span className="sn-legend__item"><span className="sn-legend__key sn-legend__key--bar" style={{ ['--k' as string]: `var(--mf-ch-${g})` }} />{g}</span></li>)}
          </ul></div>
          <div className="mf-rungs" style={{ marginTop: 12 }}>
            <section className="mf-rungs__col"><h3 className="mf-rungs__h"><span className="mf-rungs__rung">{ko ? '세계' : 'World'}</span>{ko ? '발권 중앙은행 자산' : 'Issuing central banks'}</h3>
              <ul className="mf-rungs__list"><li><span className="mf-rungs__name">{ko ? '미국' : 'United States'}</span><b>67,456</b><span className="mf-rungs__per">2026-10-28</span><span className="mf-rungs__bar"><i style={{ width: '92%', background: 'var(--viz-focus)' }} /></span></li></ul></section>
          </div>
          <p className="mf-dcard__foot">{ko ? '자료: 점선 차선 위' : 'Source line, under a dashed lane mark'}</p>
        </section>
        <details className="mf-rsec" open><summary className="mf-rsec__sum"><span className="mf-rsec__title">{ko ? '레일 구역(펼침)' : 'Rail section (open)'}</span></summary><div className="mf-rsec__body"><ul className="mf-chips"><li><span className="mf-chip">R1</span></li><li><span className="mf-chip">R2</span></li></ul></div></details>
      </div>
      <DocLinks lang={lang} />
    </div>
  );
}
