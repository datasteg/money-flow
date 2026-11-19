'use client';
// The World page's Signal Board (R17–R19; the method version is passed in from the release's registry): each borrowing economy as a circle, x = vulnerability (half
// exposure: FX credit to GDP and, where scored, short-term bank debt to reserves, each read against every board economy
// so far and against the economy's own past; half buffers: the net IIP and the current account against GDP), y = flow
// score (bank and bond flows over the previous stock, a year, in %). Size = foreign-currency credit outstanding, colour =
// bond dependence (A3, shown, not scored). Both axes are fixed over the whole sample.
// The reader picks a quarter (a snapshot: the select, the arrows or the slider), filters the economies (IMF group,
// region, outflows or the risk zone) and follows up to six of them: a followed economy keeps its own colour and label,
// and Play moves only the followed ones, each with a tail of its last eight quarters that fades with age. The board's
// state is written to the URL (bq, bf, bg, br, bs, bo), so a snapshot can be cited. A pointer event goes to the marker
// whose centre is nearest (circles overlap); a click opens that economy's numbers, with the score's own arithmetic,
// dates and source links, in the panel beside the chart. Every number is computed by the build (views.board); the
// browser only draws, filters and picks a quarter.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { downloadCsv } from '@/lib/export';
import { fill as fillTemplate } from '@/lib/family';
import { csvAmt, money, num, pct, period } from '@/lib/format';
import { withFallback } from '@/lib/i18n';
import type { Board, Lang, SourcesRegistry } from '@/lib/types';
import { Icon } from './sn';
import { SegmentedControl } from './sn/client';
import { SrcLink } from './Src';
import { useTip, type TipContent } from './Tip';

type Row = Record<string, number | string | null>;
type Pt = { clientX: number; clientY: number };
const A3_BINS = [40, 55, 70, 85];                              // bond dependence (%): five steps of the blue scale (the darkest step
const A3_FILL = ['var(--seq-300)', 'var(--seq-400)', 'var(--seq-500)', 'var(--seq-600)', 'var(--seq-700)'];   // is left out: unseen on a dark page)
const RISK_X = 60;                                             // the at-risk quadrant: vulnerability above 60, flow below zero
const HIT_PAD = 3;                                             // px beyond a circle's edge that still counts as on it
const COINCIDE = 2;                                            // px: centres this close are one place; a repeat click cycles through them
const FOLLOW = ['var(--viz-1)', 'var(--viz-3)', 'var(--viz-5)', 'var(--viz-7)', 'var(--viz-2)', 'var(--viz-6)'];   // one colour per followed economy
const MAX_FOLLOW = FOLLOW.length;
const TAIL = 8;                                                // quarters of path behind a followed economy
const STEP_MS = 900;                                           // Play: one quarter per step; the dots glide for most of it
const REGIONS = ['Asia', 'Europe', 'Americas', 'Oceania', 'Africa'];
type Group = 'all' | 'ae' | 'em';
type Show = 'all' | 'out' | 'v60' | 'risk';
export interface BoardInit { q?: string; follow?: string[]; group?: string; region?: string; show?: string; only?: boolean }

const fill = (a3: number | null) => (a3 == null ? 'var(--viz-context)' : A3_FILL[A3_BINS.filter((b) => a3 >= b).length]);

function rowsOf(board: Board, q: string | undefined): Row[] {
  const x = q ? board.q[q] : undefined;
  return x ? x.rows.map((r) => Object.fromEntries(board.cols.map((c, i) => [c, r[i]]))) : [];
}

function ticks(lo: number, hi: number): number[] {
  const span = hi - lo, step = span <= 40 ? 10 : span <= 120 ? 20 : 50;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

const UI = {
  ko: { quarter: '분기', prev: '전분기', next: '다음 분기', group: '구분', all: '전체', ae: '선진', em: '신흥', region: '지역', allRegions: '전체 지역',
    regions: { Asia: '아시아', Europe: '유럽', Americas: '아메리카', Oceania: '오세아니아', Africa: '아프리카' } as Record<string, string>,
    show: '보기', showAll: '모두', out: '순유출', v60: '취약성 60 이상', risk: '위험 구역', follow: '따라가기', add: '경제 추가…', only: '따라가는 경제만',
    clear: '지우기', remove: (n: string) => `${n} 빼기`, play: (n: number) => (n ? `재생: ${n}개 경제` : '재생'), pause: '멈춤',
    playHint: '경제를 하나 이상 따라가면 재생할 수 있습니다', followBtn: '+ 따라가기', following: '따라가는 중 ✓', max: `최대 ${MAX_FOLLOW}개 경제`,
    tail: `꼬리: 따라가는 경제의 지난 ${TAIL}개 분기 경로(오래될수록 흐림)`, shown: (n: number, t: number) => `${t}개 경제 중 ${n}개 표시`, none: '조건에 맞는 경제가 없습니다' },
  en: { quarter: 'Quarter', prev: 'Previous quarter', next: 'Next quarter', group: 'Group', all: 'All', ae: 'Advanced', em: 'Emerging', region: 'Region', allRegions: 'All regions',
    regions: { Asia: 'Asia', Europe: 'Europe', Americas: 'Americas', Oceania: 'Oceania', Africa: 'Africa' } as Record<string, string>,
    show: 'Show', showAll: 'All', out: 'Net outflow', v60: 'Vulnerability ≥ 60', risk: 'Risk zone', follow: 'Follow', add: 'Add an economy…', only: 'Only followed',
    clear: 'Clear', remove: (n: string) => `Stop following ${n}`, play: (n: number) => (n ? `Play ${n} followed` : 'Play'), pause: 'Pause',
    playHint: 'Follow at least one economy to play its path', followBtn: '+ Follow', following: 'Following ✓', max: `up to ${MAX_FOLLOW}`,
    tail: `Tail: the followed economy's last ${TAIL} quarters (older is fainter)`, shown: (n: number, t: number) => `${n} of ${t} shown`, none: 'No economy matches the filters' },
};

const LABELS = {
  ko: { x: '취약성 점수(노출 절반·완충 절반, 0–100)', right: '더 취약 →', y: '자금흐름 점수(연율, %)', out: '순유출', in: '순유입', risk: '위험: 취약하고 자금이 유출되는 중',
    play: '재생', pause: '멈춤', quarter: '분기', v: '취약성', flow: '자금흐름', exp: '노출', buf: '완충 약점', a1: 'A1 외화신용/GDP', a2: 'A2: BIS 보고은행의 잔존만기 1년 이내 채권 ÷ 외환보유액 기준',
    a2g: 'A2 총준비자산 기준(참고)', resnet: '순준비자산(IRFCL I부+II부)', drains: '예정된 순유출(II부)', local: '국내 은행의 외화 채권(거주 비은행)', nolocal: 'LBS 국내 잔액 미보고, 국경 간 부분만',
    offshore: '역외 발행 표시: 국적 기준이 국경 간 거주성 기준보다 GDP의 5%p 이상 크거나 두 배', floored: '하한 적용: 순준비자산이 총준비자산의 10% 아래', a1x: 'A1 국경 간 부분만(참고)',
    a3: 'A3 채권 의존도', niip: '순대외금융자산/GDP', ca: '경상수지/GDP(4분기)', ned: '순대외채무/GDP', a1n: 'A1 국적 기준(참고)',
    b1: 'B1 은행 흐름', b2: 'B2 채권 순발행', lvl: '수준', own: '자기 과거', sig: '신호', open: '경제 탭에서 열기', size: '원 크기: 외화신용 잔액(거주성 기준)',
    colour: '색: 채권 의존도(A3, 점수에 넣지 않음)', arrow: '', none: '원을 누르면 점수의 계산과 구성요소가 여기에 표시됩니다.', beyond: '축 밖 값',
    carried: 'GDP는 직전 분기 값', gli: 'BIS 글로벌 유동성 지표(GLI)의 미 달러화·유로화·엔화 신용입니다(자국 통화 신용은 제외하고 현지 외화대출은 포함합니다).', ur: 'BIS 보고은행의 대외채권, 최종위험 기준(은행 유형 4R)', fxl: '외화 국경 간 비은행 대출',
    fxb: '외화 국제채권(비은행, 거주성 기준)', gdp: 'GDP(BIS 자료로 역산, 4개 분기)', st: 'BIS 보고은행 보유 잔존만기 1년 이내 채권(은행 유형 4O)', res: '준비자산', ids: '국제채권(국적)', loans: '은행에 진 대출·예금 채무(BIS 지역별 은행통계)',
    stock: '직전 분기말 잔액(채권+대출)', dropped: '빠진 경제', wd: '이번 분기 가장 큰 유출', bank: '은행', bond: '채권', nowd: '이번 분기에는 순유출 경제가 없습니다',
    notScored: '점수에 넣지 않음', ctx: '참고(점수에 넣지 않음)', csv: '이 분기 CSV', asof: '기준', how: '이 점수는 이렇게 계산합니다', calc: '계산',
    base: 'A2 기준 외환보유액', resraw: '순외환보유액(섹션 I + II, 하한 미적용)', noflow: '이번 분기 흐름 점수 없음', noflowList: '점수는 산출했으나 이번 분기 흐름 점수 없음(차트 미표시)', o1x: '자체 이력 비교는 값과 이력 모두 국경 간 부분을 기준으로 합니다. 이 경제에서는 과거에 A1의 구성이 바뀌었기 때문입니다.', notpub: 'II부 미공표',
    col: { eco: '경제', name: '이름', quarter: '분기', flow: '자금흐름(%)', exp: '노출', buf: '완충 약점', a1: 'A1 외화신용/GDP(%)', l1: 'A1 수준', o1: 'A1 자기 과거', s1: 'A1 신호',
      a2: 'A2: BIS 보고은행 보유 잔존만기 1년 이내 채권 ÷ 기준 외환보유액(%)', a2_scored: 'A2 점수 포함', l2: 'A2 수준', o2: 'A2 자기 과거', s2: 'A2 신호', niip: '순대외금융자산/GDP(%)', ca: '경상수지/GDP(%)', wn: '완충 약점: NIIP', wc: '완충 약점: 경상수지',
      a3: 'A3 채권 의존도(%)', ned: '순대외채무/GDP(%)', a1n: 'A1 국적 기준(%)', b1: 'B1(억 달러)', b2: 'B2(억 달러)',
      a1x: 'A1 국경 간 부분만(%)', a1_local: 'A1에 국내 외화 채권 포함', local_fx: '국내 외화 채권(억 달러)', offshore: '역외 발행 표시', a2g: 'A2 총준비자산 기준(%)', res_net: 'A2 기준 외환보유액(십억 달러)', a2_floored: 'A2 하한 적용',
      res_net_raw: '순외환보유액, 섹션 I + II(십억 달러)', o1x: '국경 간 부분 기준 A1 자체 이력', flow_missing: '흐름 자료 누락 사유' } as Record<string, string> }
  , en: { x: 'Vulnerability score (half exposure, half buffers; 0–100)', right: 'more vulnerable →', y: 'Flow score (% a year)', out: 'net outflow', in: 'net inflow', risk: 'at risk: vulnerable and losing funding',
    play: 'Play', pause: 'Pause', quarter: 'Quarter', v: 'Vulnerability', flow: 'Flow score', exp: 'Exposure', buf: 'Buffer weakness', a1: 'A1 FX credit / GDP', a2: 'A2: BIS banks\' claims due within a year ÷ reserve base',
    a2g: 'A2 on gross reserves (context)', resnet: 'Net reserves (IRFCL Section I + II)', drains: 'predetermined net drains (Section II)', local: 'local FX claims of banks inside the economy on resident non-banks', nolocal: 'no LBS local positions reported: cross-border only',
    offshore: 'Offshore issuance flag: nationality exceeds the cross-border residence figure by 5 points of GDP or is twice it', floored: 'floored: net reserves below a tenth of gross', a1x: 'A1 cross-border only (context)',
    a3: 'A3 bond dependence', niip: 'Net IIP / GDP', ca: 'Current account / GDP (4 quarters)', ned: 'Net external debt / GDP', a1n: 'A1 by nationality (context)',
    b1: 'B1 bank flow', b2: 'B2 bond net issues', lvl: 'level', own: 'own history', sig: 'signal', open: 'Open in the Economy tab', size: 'Size: FX credit outstanding (residence)',
    colour: 'Colour: bond dependence (A3, not scored)', arrow: '', none: 'Tap or click a circle to see how its score is built', beyond: 'beyond the axis',
    carried: 'GDP carried from the quarter before', gli: 'BIS GLI credit in US dollars, euros and yen (own currency left out; local FX loans included)', ur: 'Foreign claims of BIS banks, ultimate risk (bank type 4R)', fxl: 'FX cross-border loans to non-banks',
    fxb: 'FX international bonds (non-banks, residence)', gdp: 'GDP (BIS-implied, four quarters)', st: 'BIS banks\' claims due within a year (bank type 4O)', res: 'Reserves', ids: 'International debt securities (nationality)', loans: 'Bank loans and deposits owed (BIS locational)',
    stock: 'Stock a quarter before (bonds + loans)', dropped: 'Left out', wd: 'Largest withdrawals this quarter', bank: 'bank', bond: 'bond', nowd: 'No economy had a net outflow this quarter',
    notScored: 'not scored', ctx: 'Context (not scored)', csv: 'CSV of this quarter', asof: 'as of', how: 'How this score is computed', calc: 'Calculation',
    base: 'Reserve base of A2', resraw: 'Net reserves (section I + II, no floor)', noflow: 'no flow score this quarter', noflowList: 'Scored, but no flow score this quarter (not on the chart)',
    o1x: 'own history read on the cross-border part, value and history: A1’s composition has changed in this economy’s history', notpub: 'Section II not published',
    col: { eco: 'economy', name: 'name', quarter: 'quarter', flow: 'flow (%)', exp: 'exposure', buf: 'buffer weakness', a1: 'A1 FX credit / GDP (%)', l1: 'A1 level', o1: 'A1 own history', s1: 'A1 signal',
      a2: 'A2: BIS banks\' claims due within a year ÷ reserve base (%)', a2_scored: 'A2 scored', l2: 'A2 level', o2: 'A2 own history', s2: 'A2 signal', niip: 'net IIP / GDP (%)', ca: 'current account / GDP (%)', wn: 'buffer weakness: NIIP', wc: 'buffer weakness: current account',
      a3: 'A3 bond dependence (%)', ned: 'net external debt / GDP (%)', a1n: 'A1 by nationality (%)', b1: 'B1 (USD bn)', b2: 'B2 (USD bn)',
      a1x: 'A1 cross-border only (%)', a1_local: 'A1 includes local FX claims', local_fx: 'local FX claims on non-banks (USD bn)', offshore: 'offshore issuance flag', a2g: 'A2 on gross reserves (%)', res_net: 'reserve base of A2 (USD bn)', a2_floored: 'A2 floored',
      res_net_raw: 'net reserves, section I + II (USD bn)', o1x: 'A1 own history on the cross-border part', flow_missing: 'flow missing because' } as Record<string, string> },
};
type L = (typeof LABELS)['en'];

function Select({ id, label, value, onChange, children }: { id: string; label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <div className="sn-field mf-field mf-board__field">
      <label className="sn-field__label" htmlFor={id}>{label}</label>
      <div className="sn-select">
        <select id={id} className="sn-input sn-select__el" value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
        <span className="sn-select__chev"><Icon name="chevron" size={18} /></span>
      </div>
    </div>
  );
}

export function SignalBoard({ board, start, lang, names, pages, regions, reg, init, version, gnTemplate }: {
  board: Board; start: string; lang: Lang; names: Record<string, string>; pages: Record<string, string | undefined>;
  /** The method version printed in the explainer (registry/method), and global-network's country-sheet funding lane
   *  with `{iso3}` to fill (lib/family.ts; the family link of each board row), null when family.json has none. */
  version: string; gnTemplate: string | null;
  regions: Record<string, string | null>; reg: SourcesRegistry; init?: BoardInit;
}) {
  const ko = lang === 'ko';
  const qs = board.quarters;
  const [qi, setQi] = useState(() => {
    if (init?.q && qs.includes(init.q)) return qs.indexOf(init.q);
    return Math.max(0, qs.lastIndexOf(qs.filter((q) => q <= start).slice(-1)[0] ?? qs[qs.length - 1]));
  });
  const [playing, setPlaying] = useState(false);
  const [follow, setFollow] = useState<string[]>(() => (init?.follow ?? []).filter((c) => board.set.in.includes(c)).slice(0, MAX_FOLLOW));
  const [group, setGroup] = useState<Group>(() => (['ae', 'em'].includes(init?.group ?? '') ? init!.group as Group : 'all'));
  const [region, setRegion] = useState(() => (REGIONS.includes(init?.region ?? '') ? init!.region! : 'all'));
  const [show, setShow] = useState<Show>(() => (['out', 'v60', 'risk'].includes(init?.show ?? '') ? init!.show as Show : 'all'));
  const [only, setOnly] = useState(!!init?.only);
  const q = qs[qi];
  const rows = useMemo(() => rowsOf(board, q), [board, q]);
  const [sel, setSel] = useState<string | null>(() => follow[0] ?? board.q[q]?.top[0]?.[0] ?? null);
  const t = useTip();
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setQi((i) => { if (i >= qs.length - 1) { setPlaying(false); return i; } return i + 1; }), STEP_MS);
    return () => clearInterval(id);
  }, [playing, qs.length]);
  useEffect(() => { if (!follow.length) setPlaying(false); }, [follow.length]);
  // the board's state in the URL, so a snapshot can be cited (the page's own day stays in `d`)
  useEffect(() => {
    if (playing) return;
    const u = new URL(window.location.href);
    const put = (k: string, v: string | null) => (v ? u.searchParams.set(k, v) : u.searchParams.delete(k));
    put('bq', qi === qs.length - 1 ? null : q);
    put('bf', follow.length ? follow.join(',') : null);
    put('bg', group === 'all' ? null : group);
    put('br', region === 'all' ? null : region);
    put('bs', show === 'all' ? null : show);
    put('bo', only && follow.length ? '1' : null);
    if (u.toString() !== window.location.href) window.history.replaceState(window.history.state, '', u);
  }, [q, qi, qs.length, follow, group, region, show, only, playing]);

  const L: L = withFallback(LABELS.en, LABELS[lang] as L);   // a label still waiting for its Korean shows in English
  const U = UI[lang];
  const narrow = w < 640;
  const W = w, H = narrow ? Math.round(w * 1.1) : Math.min(660, Math.max(420, Math.round(w * 0.6)));
  const m = { l: narrow ? 40 : 52, r: 12, t: 14, b: narrow ? 44 : 46 };
  const [ylo, yhi] = board.domain.y;
  const X = (v: number) => m.l + (v / 100) * (W - m.l - m.r);
  const Y = (v: number) => m.t + ((yhi - Math.max(ylo, Math.min(yhi, v))) / (yhi - ylo)) * (H - m.t - m.b);
  const smax = Math.max(board.domain.size[1], 1);
  const rad = (s: number) => (narrow ? 3 : 4) + (narrow ? 14 : 22) * Math.sqrt(Math.max(0, s) / smax);
  const qLabel = period(q, 'Q', lang);
  const n = (v: unknown, d = 1) => num(v as number, lang, d);
  const adv = useMemo(() => new Set(board.groups?.advanced ?? []), [board]);
  const colourOf = (e: string) => { const i = follow.indexOf(e); return i < 0 ? null : FOLLOW[i]; };
  const pass = (r: Row) => {
    const e = r.eco as string, v = r.v as number, f = r.flow as number;
    if (group === 'ae' && !adv.has(e)) return false;
    if (group === 'em' && adv.has(e)) return false;
    if (region !== 'all' && regions[e] !== region) return false;
    if (show === 'out' && !(f < 0)) return false;
    if (show === 'v60' && !(v >= RISK_X)) return false;
    if (show === 'risk' && !(v >= RISK_X && f < 0)) return false;
    return true;
  };
  const visible = rows.filter((r) => follow.includes(r.eco as string) || (!(only && follow.length) && pass(r)));
  const dim = follow.length > 0 && !only;
  // every economy's position by quarter, for the tails
  const pos = useMemo(() => {
    const out = new Map<string, Map<string, [number, number]>>();
    const iv = board.cols.indexOf('v'), ifl = board.cols.indexOf('flow');
    for (const qq of qs) for (const r of board.q[qq].rows) {
      const e = r[0] as string;
      if (!out.has(e)) out.set(e, new Map());
      if (r[ifl] != null) out.get(e)!.set(qq, [r[iv] as number, r[ifl] as number]);   // a row without a flow score has no place on the chart
    }
    return out;
  }, [board, qs]);
  const tipOf = (r: Row): TipContent => ({ id: r.eco as string, title: <>{names[r.eco as string] ?? r.eco} · {qLabel}</>,
    rows: [{ value: n(r.v, 0), label: `${L.v} (0–100) = ½ × ${L.exp} ${n(r.exp, 0)} + ½ × ${L.buf} ${n(r.buf, 0)}`, color: fill(r.a3 as number) },
      { value: r.flow == null ? '–' : `${num(r.flow as number, lang, 1, true)}%`, label: r.flow == null ? `${L.flow}: ${L.noflow}` : L.flow },
      { value: pct(r.a1 as number, lang), label: `${L.a1} · ${L.sig} ${n(r.s1, 0)}` },
      { value: r.a2_scored ? pct(r.a2 as number, lang) : '–', label: `${L.a2} · ${r.a2_scored ? `${L.sig} ${n(r.s2, 0)}` : L.notScored}` },
      { value: `${num(r.niip as number, lang, 1, true)}%`, label: L.niip },
      { value: `${num(r.ca as number, lang, 1, true)}%`, label: L.ca },
      { value: r.b1 == null || r.b2 == null ? '–' : money((r.b1 as number) + (r.b2 as number), lang, true), label: `${L.b1} + ${L.b2}` }] });
  // marker geometry, in the order drawn (largest first, so small circles sit on top; followed economies on top of all)
  const marks = useMemo(() => [...visible].filter((r) => r.flow != null).sort((a, b) => (follow.includes(a.eco as string) ? 1 : 0) - (follow.includes(b.eco as string) ? 1 : 0) || (b.size as number) - (a.size as number))
    .map((r) => ({ r, e: r.eco as string, x: X(r.v as number), y: Y(r.flow as number), rr: rad(r.size as number) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible.map((r) => r.eco).join(), rows, W, H, follow.join()]);
  const tips = useMemo(() => new Map(marks.map((k) => [k.e, tipOf(k.r)])), [marks]);   // eslint-disable-line react-hooks/exhaustive-deps
  /** The economy under a pointer: of the circles that contain the point, the one whose centre is nearest. Overlapping
   *  circles therefore each own the half nearer their centre, and a click on any centre opens that economy, whatever
   *  is drawn on top. Markers whose centres coincide (within COINCIDE px) cannot be told apart by position: a click
   *  there opens the next one after the economy already open, so repeated clicks reach each of them. */
  const pick = (p: Pt, fallback: string, cycle = false): string => {
    const s = svg.current?.getBoundingClientRect();
    if (!s || !s.width) return fallback;
    const k = W / s.width, px = (p.clientX - s.left) * k, py = (p.clientY - s.top) * k;
    const hits = marks.map((c) => ({ e: c.e, d: Math.hypot(px - c.x, py - c.y), rr: c.rr })).filter((c) => c.d <= c.rr + HIT_PAD)
      .sort((a, b) => a.d - b.d || (a.e < b.e ? -1 : 1));
    if (!hits.length) return fallback;
    const near = hits.filter((c) => c.d <= hits[0].d + COINCIDE).map((c) => c.e).sort();
    if (cycle && near.length > 1 && sel && near.includes(sel)) return near[(near.indexOf(sel) + 1) % near.length];
    return hits[0].e;
  };
  // while playing, a tail stops at the quarter before: the dot glides from there and the newest segment follows it
  const tailEnd = playing ? qi - 1 : qi;
  const tails = follow.map((e, i) => {
    const seg: { x: number; y: number; k: number }[][] = [[]];
    for (let k = Math.max(0, qi - TAIL + 1); k <= tailEnd; k++) {
      const p = pos.get(e)?.get(qs[k]);
      if (!p) { if (seg[seg.length - 1].length) seg.push([]); continue; }
      seg[seg.length - 1].push({ x: X(p[0]), y: Y(p[1]), k: k - (qi - TAIL + 1) });
    }
    return { e, c: FOLLOW[i], seg: seg.filter((s) => s.length > 1) };
  });
  const yt = ticks(ylo, yhi);
  const cur = rows.find((r) => r.eco === sel) ?? null;
  const qd = board.q[q];
  const top = qd?.top ?? [];
  const wmax = Math.max(1, ...top.map(([, , b1, b2]) => Math.abs(b1) + Math.abs(b2)));
  const nm = (c: string): ReactNode => (pages[c] ? <a href={pages[c]}>{names[c] ?? c}</a> : names[c] ?? c);
  // the row's family link (plan, section 3.2): the same economy's funding lane on global-network
  const gn = (c: string): ReactNode => (gnTemplate ? <a className="mf-board__gn" href={fillTemplate(gnTemplate, { iso3: c })}>{ko ? `global-network에서 ${names[c] ?? c} 보기` : `${names[c] ?? c} in global-network`} →</a> : null);
  const toggle = (e: string) => setFollow((f) => (f.includes(e) ? f.filter((x) => x !== e) : f.length >= MAX_FOLLOW ? f : [...f, e]));
  const go = (i: number) => { setPlaying(false); setQi(Math.max(0, Math.min(qs.length - 1, i))); };
  const play = () => {
    if (playing) { setPlaying(false); return; }
    if (qi >= qs.length - 1) {                                  // from the first quarter any followed economy is drawn
      const first = qs.findIndex((qq) => follow.some((e) => pos.get(e)?.has(qq)));
      setQi(Math.max(0, first));
    }
    setPlaying(true);
  };
  const CSV_COLS = ['eco', 'name', 'quarter', 'v', 'flow', 'exp', 'buf', 'a1', 'l1', 'o1', 's1', 'a2', 'a2_scored', 'l2', 'o2', 's2', 'niip', 'ca', 'wn', 'wc', 'a3', 'ned', 'a1n', 'b1', 'b2',
    'a1x', 'a1_local', 'local_fx', 'offshore', 'a2g', 'res_net_raw', 'res_net', 'a2_floored', 'o1x', 'flow_missing'];
  const csv = () => downloadCsv(rows.map((r) => ({ ...r, name: names[r.eco as string] ?? r.eco, quarter: q, b1: csvAmt(r.b1 as number, lang), b2: csvAmt(r.b2 as number, lang) })),
    CSV_COLS.map((k) => (k === 'v' ? (ko ? `취약성(${version})` : `vulnerability (${version})`) : L.col[k] ?? k)),
    CSV_COLS,
    `money-flow-signal-board-${q}`);
  const addable = board.set.in.filter((c) => !follow.includes(c)).sort((a, b) => (names[a] ?? a).localeCompare(names[b] ?? b, lang));

  return (
    <div className="mf-board">
      <div className="mf-board__ctl">
        <div className="mf-board__when">
          <button type="button" className="sn-btn sn-btn--quiet sn-btn--sm mf-board__step" onClick={() => go(qi - 1)} disabled={qi <= 0} aria-label={U.prev}>‹</button>
          <div className="sn-select mf-board__qsel">
            <select className="sn-input sn-select__el" value={q} onChange={(e) => go(qs.indexOf(e.target.value))} aria-label={U.quarter}>
              {[...qs].reverse().map((qq) => <option key={qq} value={qq}>{period(qq, 'Q', lang)}</option>)}
            </select>
            <span className="sn-select__chev"><Icon name="chevron" size={18} /></span>
          </div>
          <button type="button" className="sn-btn sn-btn--quiet sn-btn--sm mf-board__step" onClick={() => go(qi + 1)} disabled={qi >= qs.length - 1} aria-label={U.next}>›</button>
        </div>
        <input type="range" min={0} max={qs.length - 1} value={qi} onChange={(e) => go(Number(e.target.value))}
          aria-label={L.quarter} aria-valuetext={qLabel} className="mf-board__range" />
        <button type="button" className="sn-btn sn-btn--secondary sn-btn--sm" onClick={play} aria-pressed={playing} disabled={!follow.length}
          title={follow.length ? undefined : U.playHint}>{playing ? U.pause : U.play(follow.length)}</button>
        <span className="mf-muted">{ko ? `${qd?.n ?? 0}개 경제 중 ${qd?.n_out ?? 0}개 순유출` : `${qd?.n_out ?? 0} of ${qd?.n ?? 0} economies with a net outflow`}</span>
        <button type="button" className="sn-btn sn-btn--quiet sn-btn--sm mf-board__csv" onClick={csv}>{L.csv}</button>
      </div>
      <div className="mf-board__filters" role="group" aria-label={ko ? '신호판 필터' : 'Signal Board filters'}>
        <div className="sn-field mf-field mf-board__field">
          <span className="sn-field__label">{U.group}</span>
          <SegmentedControl size="sm" label={U.group} value={group} onChange={(v) => setGroup(v as Group)}
            options={[{ value: 'all', label: U.all }, { value: 'ae', label: U.ae }, { value: 'em', label: U.em }]} />
        </div>
        <Select id="mf-board-region" label={U.region} value={region} onChange={setRegion}>
          <option value="all">{U.allRegions}</option>
          {REGIONS.map((r) => <option key={r} value={r}>{U.regions[r]}</option>)}
        </Select>
        <Select id="mf-board-show" label={U.show} value={show} onChange={(v) => setShow(v as Show)}>
          <option value="all">{U.showAll}</option><option value="out">{U.out}</option><option value="v60">{U.v60}</option><option value="risk">{U.risk}</option>
        </Select>
        <div className="sn-field mf-field mf-board__field mf-board__follow">
          <label className="sn-field__label" htmlFor="mf-board-follow">{U.follow} <span className="mf-muted">({U.max})</span></label>
          <div className="mf-board__followrow">
            <div className="sn-select">
              <select id="mf-board-follow" className="sn-input sn-select__el" value="" disabled={follow.length >= MAX_FOLLOW}
                onChange={(e) => { if (e.target.value) { toggle(e.target.value); setSel(e.target.value); } }}>
                <option value="">{U.add}</option>
                {addable.map((c) => <option key={c} value={c}>{names[c] ?? c}</option>)}
              </select>
              <span className="sn-select__chev"><Icon name="chevron" size={18} /></span>
            </div>
            {follow.map((e, i) => (
              <span key={e} className="mf-board__chip" style={{ borderColor: FOLLOW[i] }}>
                <span className="mf-board__chipdot" style={{ background: FOLLOW[i] }} aria-hidden />
                <button type="button" className="mf-board__chipname" onClick={() => setSel(e)}>{names[e] ?? e}</button>
                <button type="button" className="mf-board__chipx" onClick={() => toggle(e)} aria-label={U.remove(names[e] ?? e)}>×</button>
              </span>
            ))}
            {follow.length ? (
              <>
                <label className="mf-board__only"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> {U.only}</label>
                <button type="button" className="sn-btn sn-btn--quiet sn-btn--sm" onClick={() => { setFollow([]); setOnly(false); }}>{U.clear}</button>
              </>
            ) : null}
          </div>
        </div>
        <span className="mf-muted mf-board__count">{U.shown(visible.length, rows.length)}</span>
      </div>
      <div className="mf-board__main">
        <div className="mf-board__left">
          <div ref={box} className="mf-board__chart">
            <div ref={t.ref} style={{ position: 'relative' }}>
              <svg ref={svg} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ko ? `신호판, ${qLabel}: ${visible.length}개 경제` : `Signal Board, ${qLabel}: ${visible.length} economies`}
                className={`mf-board__svg${playing ? ' is-playing' : ''}`}>
                <rect x={X(RISK_X)} y={Y(0)} width={X(100) - X(RISK_X)} height={Y(ylo) - Y(0)} className="mf-board__risk" />
                <text x={X(100) - 6} y={Y(ylo) - 8} textAnchor="end" className="mf-board__risklab">{L.risk}</text>
                {[0, 20, 40, 60, 80, 100].map((v) => (
                  <g key={`x${v}`}><line x1={X(v)} x2={X(v)} y1={m.t} y2={H - m.b} stroke="var(--viz-grid)" />
                    <text x={X(v)} y={H - m.b + 14} textAnchor="middle" className="mf-axis">{v}</text></g>
                ))}
                {yt.map((v) => (
                  <g key={`y${v}`}><line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} stroke={v === 0 ? 'var(--ink-muted)' : 'var(--viz-grid)'} strokeWidth={v === 0 ? 1.5 : 1} />
                    <text x={m.l - 6} y={Y(v) + 3} textAnchor="end" className="mf-axis">{num(v, lang, 0, true)}</text></g>
                ))}
                <text x={m.l + 4} y={Y(0) + 13} className="mf-board__zero">{L.out} ↓</text>
                <text x={m.l + 4} y={Y(0) - 6} className="mf-board__zero">{L.in} ↑</text>
                <text x={(m.l + W - m.r) / 2} y={H - 8} textAnchor="middle" className="mf-axis mf-board__title">{narrow ? L.x.split(' (')[0].split('(')[0] : L.x}</text>
                {!narrow ? <text x={W - m.r} y={H - 8} textAnchor="end" className="mf-axis mf-board__title">{L.right}</text> : null}
                <text transform={`translate(${narrow ? 11 : 13},${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle" className="mf-axis mf-board__title">{L.y}</text>
                {tails.map(({ e, c, seg }) => (
                  <g key={`tail${e}`} className="mf-board__tail" stroke={c} fill={c} aria-hidden>
                    {seg.map((s, si) => s.slice(1).map((p, j) => {
                      const a = s[j], o = 0.12 + 0.78 * ((p.k + 1) / TAIL);   // newer segments are stronger
                      return <g key={`${si}-${p.k}`}><line x1={a.x} y1={a.y} x2={p.x} y2={p.y} strokeWidth={2.5} strokeOpacity={o} strokeLinecap="round" />
                        {j < s.length - 2 ? <circle cx={p.x} cy={p.y} r={2.5} fillOpacity={o} stroke="none" /> : null}</g>;
                    }))}
                    {seg.map((s, si) => <circle key={`s${si}`} cx={s[0].x} cy={s[0].y} r={2.5} fillOpacity={0.12} stroke="none" />)}
                  </g>
                ))}
                {marks.map(({ r, e, x, y, rr }) => {
                  const f = r.flow as number;
                  const out = f > yhi ? 'up' : f < ylo ? 'down' : null;
                  const c = tips.get(e)!;
                  const fc = colourOf(e);
                  return (
                    <g key={e} className={`mf-board__dot${sel === e ? ' is-sel' : ''}${fc ? ' is-follow' : ''}`} style={{ transform: `translate(${x}px, ${y}px)` }}
                      opacity={t.active && t.active.id !== e ? 0.45 : dim && !fc ? 0.3 : 1}>
                      <circle cx={0} cy={0} r={rr} fill={fill(r.a3 as number)} tabIndex={0} role="button" data-eco={e} style={fc ? { stroke: fc, strokeWidth: 3 } : undefined}
                        aria-label={`${names[e] ?? e}: ${L.v} ${n(r.v, 0)}, ${L.flow} ${num(f, lang, 1, true)}%`} aria-pressed={sel === e}
                        onMouseMove={(ev) => { const k = pick(ev, e); t.place(ev, tips.get(k) ?? c); }}
                        onMouseLeave={t.hide}
                        onClick={(ev) => { const k = ev.detail === 0 ? e : pick(ev, e, true); setSel(k); t.place(ev, tips.get(k) ?? c); }}
                        onFocus={(ev) => t.place(ev.currentTarget, c)} onBlur={t.hide}
                        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setSel(e); } }} />
                      {out ? <path d={out === 'up' ? `M-5 ${-rr - 3}l5 -7 5 7z` : `M-5 ${rr + 3}l5 7 5 -7z`} fill="var(--ink-muted)" aria-label={L.beyond} /> : null}
                      <text x={rr + 2} y={3} className={`mf-board__lab${fc ? ' is-follow' : ''}`} style={fc ? { fill: fc } : undefined}>{fc ? names[e] ?? e : e}</text>
                    </g>
                  );
                })}
                {!visible.length ? <text x={(m.l + W - m.r) / 2} y={(m.t + H - m.b) / 2} textAnchor="middle" className="mf-axis">{U.none}</text> : null}
              </svg>
              {t.box}
            </div>
            <ul className="mf-board__legend" aria-label={ko ? '범례' : 'Legend'}>
              <li>{L.size} · {money(board.domain.size[0], lang)} – {money(board.domain.size[1], lang)}</li>
              <li>{L.colour}: {A3_FILL.map((c, i) => <span key={c} className="mf-board__sw" style={{ background: c }} title={i === 0 ? `< ${A3_BINS[0]}%` : i === A3_FILL.length - 1 ? `≥ ${A3_BINS[i - 1]}%` : `${A3_BINS[i - 1]}–${A3_BINS[i]}%`} />)} <span className="mf-muted">{`<${A3_BINS[0]}% → ≥${A3_BINS[A3_BINS.length - 1]}%`}</span></li>
              <li>{U.tail}</li>
            </ul>
          </div>
          <section className="mf-board__wd" aria-label={L.wd}>
            <h3 className="mf-board__h3">{L.wd} · {qLabel}</h3>
            {top.length ? (
              <ol>
                {top.map(([c, tot, b1, b2]) => (
                  <li key={c}>
                    <span className="mf-board__wdname">{nm(c)}</span>
                    <b>{money(tot, lang, true)}</b>
                    <span className="mf-board__split" aria-hidden>
                      <span style={{ width: `${(100 * Math.abs(b1)) / wmax}%`, background: 'var(--viz-1)', opacity: b1 < 0 ? 1 : 0.4 }} />
                      <span style={{ width: `${(100 * Math.abs(b2)) / wmax}%`, background: 'var(--viz-7)', opacity: b2 < 0 ? 1 : 0.4 }} />
                    </span>
                    <span className="mf-muted">{L.bank} {money(b1, lang, true)} · {L.bond} {money(b2, lang, true)}</span>
                    {gn(c)}
                  </li>
                ))}
              </ol>
            ) : <p className="mf-muted">{L.nowd}</p>}
            <p className="mf-dcard__foot">{ko ? '은행(B1, BIS LBS 조정 변동)은 파랑, 채권(B2, BIS DSS 국적 기준 순발행)은 보라색으로 표시합니다. 흐린 막대는 유입입니다. 자료: ' : 'Bank (B1, BIS LBS adjusted change) in blue, bond (B2, BIS DSS net issues by nationality) in purple; a faint bar is an inflow. Source: '}
              <SrcLink reg={reg} id="bis.lbs_adj" lang={lang} />; <SrcLink reg={reg} id="bis.dss_nat" lang={lang} /></p>
          </section>
          <HowComputed board={board} lang={lang} L={L} ex={cur} name={cur ? names[cur.eco as string] ?? (cur.eco as string) : ''} qLabel={qLabel} reg={reg} version={version}
            mix={{ with: rows.filter((r) => r.a1_local).length, without: rows.filter((r) => !r.a1_local).map((r) => names[r.eco as string] ?? (r.eco as string)) }} />
        </div>
        <aside className="mf-board__side" aria-live="polite">
          {cur ? (
            <>
              <button type="button" className={`sn-btn sn-btn--sm ${follow.includes(cur.eco as string) ? 'sn-btn--secondary' : 'sn-btn--quiet'} mf-board__followbtn`}
                onClick={() => toggle(cur.eco as string)} aria-pressed={follow.includes(cur.eco as string)}
                disabled={!follow.includes(cur.eco as string) && follow.length >= MAX_FOLLOW}>
                {follow.includes(cur.eco as string) ? U.following : U.followBtn}</button>
              <Detail r={cur} q={q} lang={lang} L={L} name={nm(cur.eco as string)} href={pages[cur.eco as string]} reg={reg} family={gn(cur.eco as string)} />
            </>
          ) : <p className="mf-muted">{L.none}</p>}
          {qd?.no_flow?.length ? <p className="mf-board__drop"><b>{L.noflowList} ({qd.no_flow.length}):</b> {qd.no_flow.map(([c, why]) => `${names[c] ?? c} (${why})`).join(', ')}</p> : null}
          {qd?.drop.length ? <p className="mf-board__drop"><b>{L.dropped} ({qd.drop.length}):</b> {qd.drop.map(([c, why]) => `${names[c] ?? c} (${why})`).join(', ')}</p> : null}
        </aside>
      </div>
    </div>
  );
}

/** The selected economy: the score's own arithmetic first (score = ½ exposure + ½ buffer weakness, each part with its
 *  level and own-history signal), then the components with their numerators, denominators, dates and sources, then the
 *  context that is shown but not scored. */
function Detail({ r, q, lang, L, name, href, reg, family }: { r: Row; q: string; lang: Lang; L: L; name: ReactNode; href?: string; reg: SourcesRegistry; family?: ReactNode }) {
  const ko = lang === 'ko';
  const v = (k: string) => r[k] as number;
  const n = (k: string, d = 0) => num(v(k), lang, d);
  const sg = (k: string) => `${num(v(k), lang, 1, true)}%`;
  const p = period(q, 'Q', lang);
  const s = (id: string) => <SrcLink reg={reg} id={id} lang={lang} />;
  const asof = (k: string) => (r[k] ? ` (${L.asof} ${period(r[k] as string, 'Q', lang)})` : '');
  const line = (label: string, value: string, sub: ReactNode, src: ReactNode) => (
    <li><span className="mf-board__dl">{label}</span><b>{value}</b><span className="mf-board__dsub">{sub} · {p} · {src}</span></li>
  );
  const sig = (i: '1' | '2', k: 'a1' | 'a2') => <>{L.sig} {n(`s${i}`)} = ½ × {L.lvl} {n(`l${i}`)} + ½ × {L.own} {n(`o${i}`)} ({ko ? `자기 중앙값 ${pct(v(`m${i}`), lang)}, 척도 ${num(v(`sc${i}`), lang, 1)}%p` : `own median ${pct(v(`m${i}`), lang)}, scale ${num(v(`sc${i}`), lang, 1)} pp`}{i === '1' && r.o1x ? `; ${L.o1x}` : ''}) · {pct(v(k), lang)}</>;
  const flowOk = r.flow != null;
  const a2 = r.a2_scored ? 1 : 0;
  return (
    <div className="mf-board__detail">
      <h3 className="mf-board__h3">{name}</h3>
      {family ? <p className="mf-board__family">{family}</p> : null}
      <p className="mf-board__vf">{L.v} <b>{n('v')}</b> · {L.flow} <b>{flowOk ? `${num(v('flow'), lang, 1, true)}%` : '–'}</b></p>
      <p className="mf-board__calc"><span className="mf-muted">{L.calc}:</span> {n('v', 1)} = ½ × {L.exp} {n('exp', 1)} + ½ × {L.buf} {n('buf', 1)}<br />
        {L.exp} {n('exp', 1)} = {a2 ? <>({ko ? 'A1 신호' : 'A1 signal'} {n('s1', 1)} + {ko ? 'A2 신호' : 'A2 signal'} {n('s2', 1)}) ÷ 2</> : <>{ko ? 'A1 신호' : 'A1 signal'} {n('s1', 1)} ({ko ? 'A2는 점수에 넣지 않음' : 'A2 not scored'})</>}<br />
        {L.buf} {n('buf', 1)} = {[r.wn != null ? `${ko ? 'NIIP' : 'NIIP'} ${n('wn', 1)}` : null, r.wc != null ? `${ko ? '경상수지' : 'current account'} ${n('wc', 1)}` : null].filter(Boolean).join(' + ')}{r.wn != null && r.wc != null ? ' ÷ 2' : ''}</p>
      <ul>
        {line(L.a1, pct(v('a1'), lang), <>{sig('1', 'a1')} · {L.fxl} {money(v('fx_loans'), lang)}{r.a1_local ? <> + {L.local} {money(v('local_fx'), lang)}</> : null} + {L.fxb} {money(v('fx_bonds'), lang)} / {L.gdp} {money(v('gdp'), lang)}{v('gdp_carried') ? ` (${L.carried})` : ''}{r.a1_local ? '' : ` · ${L.nolocal}`}{r.gli != null ? ` · ${L.gli} ${money(v('gli'), lang)}` : ''}</>,
          <>{s('bis.lbs')}; {s('bis.dss_res')}; {s('bis.tc')}{r.gli != null ? <>; {s('bis.gli')}</> : null}</>)}
        {line(L.a2, r.a2 == null ? '–' : pct(v('a2'), lang), a2 ? <>{sig('2', 'a2')} · {L.st} {money(v('st'), lang)} / {L.base} {money(v('res_net'), lang)}{r.res_drains != null ? ` (${L.res} ${money(v('res'), lang)}, ${L.drains} ${money(v('res_drains'), lang, true)})` : ` (${L.res} ${money(v('res'), lang)}; ${L.notpub})`}{r.a2_floored ? ` · ${L.floored}` : ''}{r.res_net_raw != null ? ` · ${L.resraw} ${money(v('res_net_raw'), lang, true)}` : ''}</>
          : <>{L.notScored}: {ko ? '유로 회원국, 준비통화 발행국, 연준 상설 무제한 통화스왑 경제는 준비자산이 외화유동성의 마지막 보루가 아닙니다.' : 'a euro member, a reserve-currency issuer or an economy with a standing unlimited Fed swap line: reserves are not its last line of FX liquidity'}{r.st != null && r.res_net ? ` · ${L.st} ${money(v('st'), lang)} / ${L.base} ${money(v('res_net'), lang)}` : ''}</>,
          <>{s('bis.cbs')}; {s('imf.irfcl')}</>)}
        {line(L.niip, r.niip == null ? '–' : sg('niip'), r.wn == null ? (ko ? '공표 없음' : 'not published') : <>{ko ? '완충 약점' : 'weakness'} {n('wn', 1)} = 100 − {L.lvl} {num(100 - v('wn'), lang, 1)}{asof('niip_asof')}</>, s('imf.iip'))}
        {line(L.ca, r.ca == null ? '–' : sg('ca'), r.wc == null ? (ko ? '공표 없음' : 'not published') : <>{ko ? '완충 약점' : 'weakness'} {n('wc', 1)} = 100 − {L.lvl} {num(100 - v('wc'), lang, 1)}{asof('ca_asof')}</>, s('imf.bop'))}
        {line(L.b1, r.b1 == null ? '–' : money(v('b1'), lang, true), ko ? '환율·단절 조정 변동' : 'FX- and break-adjusted change', s('bis.lbs_adj'))}
        {line(L.b2, r.b2 == null ? '–' : money(v('b2'), lang, true), ko ? '국적 기준 순발행' : 'net issues by nationality', s('bis.dss_nat'))}
        {line(L.flow, flowOk ? `${num(v('flow'), lang, 1, true)}%` : '–', flowOk ? <>({L.b1} + {L.b2}) / {L.stock} {money(v('stock_prev'), lang)} × 4</> : <>{L.noflow} ({String(r.flow_missing ?? '')})</>, <>{s('bis.lbs_adj')}; {s('bis.dss_nat')}</>)}
      </ul>
      <details className="mf-board__ctx">
      <summary className="mf-board__h4">{L.ctx}</summary>
      <ul>
        {r.a3 == null ? null : line(L.a3, pct(v('a3'), lang), <>{L.ids} {money(v('ids'), lang)} / ({L.ids} + {L.loans} {money(v('loans'), lang)})</>, <>{s('bis.dss_nat')}; {s('bis.lbs_adj')}</>)}
        {r.a2g != null ? line(L.a2g, pct(v('a2g'), lang), <>{L.st} {money(v('st'), lang)} / {L.res} {money(v('res'), lang)}</>, s('imf.irfcl')) : null}
        {r.a1x != null && r.a1_local ? line(L.a1x, pct(v('a1x'), lang), <>{L.fxl} {money(v('fx_loans'), lang)} + {L.fxb} {money(v('fx_bonds'), lang)} / {L.gdp}</>, <>{s('bis.lbs_adj')}; {s('bis.dss_res')}</>) : null}
        {r.ned != null ? line(L.ned, sg('ned'), ko ? '채무상품 부채 − 채무상품 자산(준비자산 포함). 음수면 순채권' : 'debt liabilities − debt assets (reserves included); below zero is a net creditor', s('imf.iip')) : null}
        {r.a1n != null ? line(L.a1n, pct(v('a1n'), lang), <>{ko ? '국적 기준과 국경 간 거주성 기준의 차이는 해외 법인의 발행분' : 'the gap to the cross-border residence figure is issuance by offshore affiliates'}{r.offshore ? <> · <b>{L.offshore}</b></> : null}</>, s('bis.dss_nat')) : null}
        {r.ur != null ? line(L.ur, money(v('ur'), lang), ko ? '참고' : 'context', s('bis.cbs')) : null}
      </ul>
      </details>
      {href ? <p><a href={href}>{L.open} →</a></p> : null}
    </div>
  );
}

/** Paragraphs of "How this score is computed" changed or added by method 1.6: one
 *  string per language with {tokens} for the source links and figures; a Korean string still empty shows its English. */
const HOW = {
  en: {
    exposure: '{exposure} is the mean of two signals. A1, FX credit / GDP: cross-border loans and deposits in US dollars, euros and yen to resident non-banks ({lbs}), plus, where the economy reports to the LBS, the foreign-currency claims of banks inside it on resident non-banks (local positions, all foreign currencies and all instruments), plus international bonds of resident non-banks in those three currencies ({dss_res}), over four-quarter GDP ({tc}); the economy\'s own currency is left out, and an economy without local positions is cross-border only and marked. A2, BIS banks\' claims due within a year ÷ reserve base: international claims of BIS reporting banks with up to a year to run, all currencies, bank type 4O ({cbs}), over A2\'s reserve base, which is net reserves ({irfcl} section I official reserve assets plus section II predetermined net drains within a year) floored at a tenth of gross reserves. The floor belongs to A2 only: net reserves themselves are shown without it and can be negative. A2 is not scored for euro members, reserve-currency issuers (Japan, the UK) or an economy with a standing unlimited Fed swap line (Canada).',
    a1own: 'A1\'s own history compares like with like. An economy whose A1 has had the same composition in every quarter so far, with or without the local foreign-currency claims, reads its A1. Once the composition has changed at least once up to the quarter, it reads the cross-border part of A1, value and history alike, which every quarter has; the panel says so. An economy that starts or stops reporting the local part therefore does not read the switch as a move of its own.',
    mix: 'The level of A1 is ranked in one pool: in {q}, {with} economies\' A1 includes the local part and {without} are cross-border only ({list}). Their levels are compared as published.',
    buffer: '{buffer} is the mean of the level signals of net IIP / GDP ({iip}) and the current account over four quarters / GDP ({bop}), turned over (100 − level). Each buffer is its newest value at or before the quarter, quarterly or annual, at most four quarters old: an older quarterly value is carried and its date shown, and an annual value counts at its year end.',
  },
  ko: { exposure: '{exposure} 지표는 두 신호의 평균입니다. A1(외화 신용/GDP)은 거주자 비은행에 대한 미 달러·유로·엔화 표시 국경 간 대출·예금({lbs})에 두 항목을 더합니다. 하나는 해당 경제가 LBS에 보고하는 경우 그 안의 은행이 거주자 비은행에 대해 보유한 외화 채권(현지 포지션, 모든 외화·모든 상품)입니다. 다른 하나는 거주자 비은행이 같은 세 통화로 발행한 국제채권({dss_res})입니다. 이 합계를 최근 4개 분기 GDP({tc})로 나눕니다. 해당 경제의 자국 통화는 제외합니다. 현지 포지션이 없는 경제는 국경 간 신용만 반영하며 따로 표시합니다. A2(1년 안에 만기가 돌아오는 BIS 은행 채권 ÷ 준비자산 기준)는 BIS 보고은행이 이 경제에 대해 보유한 잔존만기 1년 이하 국제 채권(모든 통화, 은행 유형 4O, {cbs})을 A2의 준비자산 기준으로 나눈 값입니다. 준비자산 기준은 순외환보유액({irfcl} 섹션 I 공식 준비자산에 섹션 II의 1년 이내 예정된 순유출을 더한 값)이며, 총외환보유액의 십분의 일을 하한으로 둡니다. 이 하한은 A2에만 적용합니다. 순외환보유액 자체는 하한 없이 표시하며 음수일 수도 있습니다. 유로 회원국, 준비통화 발행국(일본·영국), 연준과 상시 무제한 통화스왑 계약을 맺은 경제(캐나다)는 A2 점수를 매기지 않습니다.', a1own: 'A1의 자체 이력은 같은 기준끼리 비교합니다. 지금까지 모든 분기에서 A1의 구성이 같았던 경제는 현지 외화 채권 포함 여부와 관계없이 A1을 그대로 읽습니다. 해당 분기까지 구성이 한 번이라도 바뀐 경제는 값과 이력 모두 A1의 국경 간 부분을 읽습니다. 국경 간 부분은 모든 분기에 있으며, 패널에 이를 표시합니다. 따라서 현지 부분의 보고를 시작하거나 중단한 경제도 그 전환을 자체 변동으로 읽지 않습니다.', mix: 'A1 수준은 하나의 모집단에서 순위를 매깁니다. {q} 기준 A1에 현지 부분이 포함된 경제는 {with}개, 국경 간 부분만 반영된 경제는 {without}개입니다({list}). 이들의 수준은 공표된 그대로 비교합니다.', buffer: '{buffer} 지표는 순대외금융자산/GDP({iip})와 최근 4분기 경상수지/GDP({bop})의 수준 신호를 평균한 뒤 뒤집은 값(100 − 수준)입니다. 각 완충 지표는 해당 분기나 그 이전의 가장 최근 값을 쓰며, 분기 자료와 연간 자료 모두 4분기 이내의 값만 씁니다. 이전 분기 값을 이어 쓸 때는 그 날짜를 표시하고, 연간 자료는 그해 말 값으로 봅니다.' },
};

/** A string with {tokens} as React nodes (source links, bold terms, figures). */
function rich(text: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && m[1] in nodes ? <span key={i}>{nodes[m[1]]}</span> : part;
  });
}

/** "How this score is computed": components, numerators, denominators and sources; the transformation and its windows;
 *  the aggregation, with the selected economy's numbers as the worked example; what the score is not. */
function HowComputed({ board, lang, L, ex, name, qLabel, reg, version, mix }: { board: Board; lang: Lang; L: L; ex: Row | null; name: string; qLabel: string; reg: SourcesRegistry; version: string; mix: { with: number; without: string[] } }) {
  const ko = lang === 'ko';
  const m = board.method;
  const s = (id: string) => <SrcLink reg={reg} id={id} lang={lang} />;
  const n1 = (k: string) => num(ex?.[k] as number, lang, 1);
  const floor = m ? `A1 ${m.floor.a1}%p, A2 ${m.floor.a2}%p` : '';
  const H = withFallback(HOW.en, HOW[lang]);
  const tok = { lbs: s('bis.lbs'), dss_res: s('bis.dss_res'), tc: s('bis.tc'), cbs: s('bis.cbs'), irfcl: s('imf.irfcl'), iip: s('imf.iip'), bop: s('imf.bop'),
    exposure: <b>{L.exp}</b>, buffer: <b>{L.buf}</b>, min: String(m?.min_history ?? 8), q: qLabel, with: String(mix.with), without: String(mix.without.length), list: mix.without.join(', ') };
  return (
    <details className="mf-board__how">
      <summary>{L.how}</summary>
      <div className="mf-prose">
        {ko ? <p><b>점수 = ½ × 노출 + ½ × 완충 약점</b>, 0–100. 60 이상이고 자금이 유출되는 경제가 오른쪽 아래 위험 구역에 들어갑니다.</p> : <p><b>Score = ½ × exposure + ½ × buffer weakness</b>, 0–100. An economy above 60 that is losing funding sits in the risk zone at the lower right.</p>}
        <p>{rich(H.exposure, tok)}</p>
        {ko ? <p><b>신호</b>는 둘의 절반씩입니다. <i>수준</i>은 그 분기까지 신호판 모든 경제·분기(2000년부터, 누적) 가운데 이 값 이하인 비율입니다. <i>자기 과거</i>는 그 경제의 2000년(또는 첫 분기)부터 이 분기까지 중앙값에서 떨어진 거리를 MAD×1.4826로 나눈 로버스트 z입니다. 척도에는 하한({floor})이 있어 좁은 이력에서 작은 움직임이 극단값이 되지 않습니다. z는 ±{m?.z_cap ?? 3}에서 잘라 0–100으로 옮깁니다(50 = 자기 중앙값). 지표마다 {m?.min_history ?? 8}개 분기가 쌓여야 씁니다. 창은 모두 누적이고 그 분기까지의 자료만 씁니다. 재생 화면의 과거 점수는 그때 알 수 있던 분기만으로 계산한 값입니다(자료는 최신 판입니다).</p> : <p>Each <b>signal</b> is half and half. The <i>level</i> is the share of every board economy-quarter so far (from 2000, expanding) at or below this value. The <i>own history</i> is a robust z: the distance from the economy's own median since 2000 (or its first quarter) up to this quarter, over 1.4826 × MAD, with a floor on that scale ({floor}) so a narrow history cannot turn a small move into an extreme; z is clipped at ±{m?.z_cap ?? 3} and mapped to 0–100 (50 = its own median). An indicator needs {m?.min_history ?? 8} quarters first. Every window is expanding and uses only quarters up to the one shown, so a past score in the replay is what the data up to then gave (newest vintages).</p>}
        <p>{rich(H.a1own, tok)}</p>
        {mix.without.length ? <p>{rich(H.mix, tok)}</p> : null}
        <p>{rich(H.buffer, tok)}</p>
        {ko ? (
          <>
            <p>이 점수는 순위가 아닙니다. 여러 경제가 같은 점수를 가질 수 있고, 누구도 0이나 100에 놓이도록 강제되지 않습니다. 절반은 다른 경제들과 비교한 수준, 절반은 자기 과거와 비교한 변화입니다. A3 채권 의존도, 순대외채무, 국적 기준 A1은 참고로만 표시합니다.</p>
            {ex ? <p className="mf-board__example"><b>예: {name}, {qLabel}.</b> {n1('v')} = ½ × {n1('exp')} + ½ × {n1('buf')}. 노출 {n1('exp')}은 A1 신호 {n1('s1')}{ex.a2_scored ? `와 A2 신호 ${n1('s2')}의 평균` : '(A2 점수 제외)'}, 완충 약점 {n1('buf')}은 {[ex.wn != null ? `NIIP ${n1('wn')}` : null, ex.wc != null ? `경상수지 ${n1('wc')}` : null].filter(Boolean).join('와 ')}{ex.wn != null && ex.wc != null ? '의 평균' : ''}이다.</p> : null}
            <p className="mf-muted">근거와 검증: 방법론 {version}(R17–R19, 점검 V18–V22), docs/methodology/vulnerability-v1.3.md와 vulnerability-v1.4.md.</p>
          </>
        ) : (
          <>
            <p>The score is not a ranking: economies can share a score and none is forced to 0 or 100. Half of it compares levels with the other economies, half compares an economy with its own past. A3 bond dependence, net external debt and A1 by nationality are shown as context only.</p>
            {ex ? <p className="mf-board__example"><b>Example: {name}, {qLabel}.</b> {n1('v')} = ½ × {n1('exp')} + ½ × {n1('buf')}. Exposure {n1('exp')} is {ex.a2_scored ? `the mean of the A1 signal ${n1('s1')} and the A2 signal ${n1('s2')}` : `the A1 signal ${n1('s1')} (A2 not scored)`}; buffer weakness {n1('buf')} is {[ex.wn != null ? `NIIP ${n1('wn')}` : null, ex.wc != null ? `current account ${n1('wc')}` : null].filter(Boolean).join(' and ')}{ex.wn != null && ex.wc != null ? ', averaged' : ''}.</p> : null}
            <p className="mf-muted">Evidence and validation: method {version} (R17–R19, checks V18–V22), docs/methodology/vulnerability-v1.3.md and vulnerability-v1.4.md.</p>
          </>
        )}
      </div>
    </details>
  );
}
