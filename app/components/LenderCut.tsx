'use client';
// "Cut a lender" on the bank matrix (rule R21). The reader picks a side (by lender: one
// lender cuts every debtor; by debtor: each of one debtor's lenders cuts), an economy and a cut of 10–50%, and the
// panel lists the largest losses against net reserves. Everything numeric arrives in mkt/bank.lender_cut (claims, net
// reserves, lender shares); the browser only scales: loss = cut × share × claims. State goes into the URL
// (cut=1&by=&e=&pct=), so the panel can be linked to (global-network's lender scenario 301s here).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CUT_MAX, CUT_MIN, CUT_STEP, allInstrument, clampCut, cutByDebtor, cutByLender, debtors, lenders, netReserves, type CutBy } from '@/lib/lendercut';
import { num, period, usdBn } from '@/lib/format';
import type { Lang, LenderCut as LC } from '@/lib/types';
import { Icon } from './sn';
import { SegmentedControl } from './sn/client';

export interface LenderCutInit { open: boolean; by?: string; e?: string; pct?: string }

const T = {
  en: {
    title: 'Cut a lender: who loses, against net reserves', sub: 'A what-if on this matrix (rule R21). Pick a lender and every debtor it lends to takes the cut, or pick a debtor and each of its lenders cuts. Loss = cut × the lender’s share × the debtor’s bank loans and deposits owed to all BIS reporters, shown against the debtor’s net reserves (IMF reserve template, section I plus section II, without the floor A2 uses; no ratio where they are zero or below). Reporters that publish all instruments only, with no loans-and-deposits split, are listed apart with their amount and have no share. A scaling of reported positions, not a forecast: banks also roll over, hedge and replace.',
    by: 'Cut by', lender: 'Lender', debtor: 'Debtor', eco: 'Economy', cut: 'Cut', ofRes: 'of net reserves', bar: 'bar: full = net reserves', loss: 'Loss, USD bn', share: 'Share of claims', none: 'No pair data for this choice.',
    leadD: (e: string, p: number, l: string, loss: string, pct: string | null, res: string | null) => `If each lender cut its claims on ${e} by ${p}%, the largest loss would come from banks in ${l}: ${loss}${pct ? `, ${pct} of ${e}’s net reserves (${res})` : ''}.`,
    leadL: (l: string, p: number, d: string, loss: string, pct: string | null) => `If banks in ${l} cut their claims on every debtor by ${p}%, the loss against net reserves would be largest for ${d}: ${loss}${pct ? `, ${pct} of its net reserves` : ''}.`,
    noRes: 'no ratio: net reserves at or below zero, or not on the board', q: 'Positions', rule: 'Rule', top: (n: number) => `The ${n} largest`,
    apart: 'Reported for all instruments only (no loans-and-deposits split, so no share)', apartNote: 'All-instrument amounts, USD bn; their loans and deposits are not published, which is not the same as none.',
  },
  ko: {
    title: '대출을 끊으면: 순준비자산 대비 누가 얼마나 잃나', sub: '이 행렬에 적용하는 가정 시나리오입니다(규칙 R21). 대출국을 고르면 그 대출국이 자금을 공급한 모든 차입국이 축소분을 떠안습니다. 차입국을 고르면 그 차입국의 대출국이 저마다 대출을 줄입니다. 손실은 축소율 × 대출국 비중 × 차입국이 BIS 전체 보고국에 진 대출·예금 채무로 계산하고, 차입국의 순외환보유액과 비교해 표시합니다. 순외환보유액은 IMF 외환보유액 양식의 I부와 II부를 더한 값이며, A2에서 쓰는 하한은 두지 않습니다. 순외환보유액이 0 이하이면 비율을 표시하지 않습니다. 대출·예금을 따로 나누지 않고 전체 금융상품 기준으로만 공표하는 보고국은 금액과 함께 별도로 표시하며, 비중은 산출하지 않습니다. 이 값은 보고된 잔액을 비례해 줄인 값일 뿐 전망이 아닙니다. 실제로 은행은 만기를 연장하거나, 헤지하거나, 다른 자금으로 대체하기도 합니다.',
    by: '기준', lender: '대출국', debtor: '채무국', eco: '경제', cut: '삭감률', ofRes: '순준비자산 대비', bar: '막대 끝 = 순준비자산', loss: '손실(억 달러)', share: '채권 비중', none: '이 선택에는 짝 자료가 없습니다.',
    leadD: (e: string, p: number, l: string, loss: string, pct: string | null, res: string | null) => (pct ? `모든 대출국이 ${e}에 대한 채권을 ${p}% 줄이면 가장 큰 손실은 ${l} 은행에서 발생합니다. 손실액은 ${loss}이며 ${e} 순준비자산(${res})의 ${pct}입니다.` : `모든 대출국이 ${e}에 대한 채권을 ${p}% 줄이면 가장 큰 손실은 ${l} 은행에서 발생합니다. 손실액은 ${loss}입니다.`),
    leadL: (l: string, p: number, d: string, loss: string, pct: string | null) => (pct ? `${l} 은행이 모든 채무국에 대한 채권을 ${p}% 줄이면 순준비자산 대비 손실은 ${d}에서 가장 큽니다. 손실액은 ${loss}로 순준비자산의 ${pct}입니다.` : `${l} 은행이 모든 채무국에 대한 채권을 ${p}% 줄이면 순준비자산 대비 손실은 ${d}에서 가장 큽니다. 손실액은 ${loss}입니다.`),
    noRes: '비율 없음: 순외환보유액이 0 이하이거나 신호판에 없음', q: '잔액 기준', rule: '규칙', top: (n: number) => `상위 ${n}개`,
    apart: '전체 금융상품 기준으로만 보고한 보고국입니다(대출·예금 구분이 없어 비중을 산출하지 않습니다)', apartNote: '전체 금융상품 기준 금액이며 단위는 10억 달러입니다. 이들 보고국의 대출·예금은 공표되지 않았을 뿐, 없다는 뜻은 아닙니다.',
  },
};

export function LenderCutPanel({ lang, data, names, hrefs, init, source, methodHref }: {
  lang: Lang; data: LC; names: Record<string, string>; hrefs: Record<string, string | undefined>; init: LenderCutInit; source: ReactNode; methodHref: string;
}) {
  const L = { ...T.en, ...Object.fromEntries(Object.entries(T[lang]).filter(([, v]) => v !== '')) } as typeof T.en;   // a string still waiting for its Korean shows in English
  const ds = useMemo(() => debtors(data), [data]);
  const ls = useMemo(() => lenders(data), [data]);
  const by0: CutBy = init.by === 'lender' ? 'lender' : 'debtor';
  const [by, setBy] = useState<CutBy>(by0);
  const pick = (b: CutBy, e?: string) => { const list = b === 'lender' ? ls : ds; return e && list.includes(e) ? e : list[0]; };
  const [eco, setEco] = useState<string>(pick(by0, init.e?.toUpperCase()));
  const [pct, setPct] = useState<number>(clampCut(init.pct));
  const [touched, setTouched] = useState(init.open);
  const self = useRef<HTMLElement>(null);
  const nm = (c: string) => names[c] ?? c;
  const list = by === 'lender' ? ls : ds;
  const rows = useMemo(() => (by === 'lender' ? cutByLender(data, eco, pct) : cutByDebtor(data, eco, pct)).slice(0, 15), [data, by, eco, pct]);
  useEffect(() => {                                     // the choice goes into the URL once the reader has touched the panel (or came for it)
    if (!touched) return;
    const q = new URLSearchParams(window.location.search);
    q.set('cut', '1'); q.set('by', by); q.set('e', eco); q.set('pct', String(pct));
    window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`);
  }, [touched, by, eco, pct]);
  useEffect(() => { if (init.open) self.current?.scrollIntoView({ block: 'start' }); }, [init.open]);
  const changeBy = (b: string) => { const nb: CutBy = b === 'lender' ? 'lender' : 'debtor'; setBy(nb); setEco(pick(nb)); setTouched(true); };
  const top = rows[0];
  const d = by === 'debtor' ? data.debtors[eco] : null;
  const pctText = (x: number | null) => (x == null ? null : `${num(x, lang, x >= 10 ? 0 : 1)}%`);
  const lead = !top ? L.none : by === 'debtor'
    ? L.leadD(nm(eco), pct, nm(top.eco), usdBn(top.loss, lang), pctText(top.of_res), d && netReserves(d) != null ? usdBn(netReserves(d), lang) : null)
    : L.leadL(nm(eco), pct, nm(top.eco), usdBn(top.loss, lang), pctText(top.of_res));
  const maxRes = Math.max(1, ...rows.map((r) => r.of_res ?? 0));
  const scale = Math.max(100, maxRes);                   // the bar is full at 100% of net reserves (or the largest if above)
  return (
    <section ref={self} id="lender-cut" className="mf-dcard mf-cut" aria-label={L.title}>
      <div className="mf-dcard__head"><div><h2 className="mf-dcard__title">{L.title}</h2><p className="mf-dcard__sub">{L.sub}</p></div></div>
      <div className="mf-dcard__body">
        <div className="mf-cut__ctl">
          <div className="sn-field mf-field" title={L.by}>
            <span className="sn-field__label">{L.by}</span>
            <SegmentedControl size="sm" label={L.by} value={by} onChange={changeBy} options={[{ value: 'debtor', label: L.debtor }, { value: 'lender', label: L.lender }]} />
          </div>
          <div className="sn-field mf-field">
            <label className="sn-field__label" htmlFor="mf-cut-eco">{by === 'lender' ? L.lender : L.debtor}</label>
            <div className="sn-select">
              <select id="mf-cut-eco" className="sn-input sn-select__el" value={eco} onChange={(e) => { setEco(e.target.value); setTouched(true); }}>
                {list.map((c) => <option key={c} value={c}>{nm(c)}</option>)}
              </select>
              <span className="sn-select__chev"><Icon name="chevron" size={18} /></span>
            </div>
          </div>
          <div className="sn-field mf-field">
            <label className="sn-field__label" htmlFor="mf-cut-pct">{L.cut}</label>
            <div className="mf-cut__pct">
              <input id="mf-cut-pct" className="mf-range" type="range" min={CUT_MIN} max={CUT_MAX} step={CUT_STEP} value={pct} aria-valuetext={`${pct}%`}
                style={{ ['--p' as string]: `${(100 * (pct - CUT_MIN)) / (CUT_MAX - CUT_MIN)}%` }}
                onChange={(e) => { setPct(clampCut(e.target.value)); setTouched(true); }} />
              <output htmlFor="mf-cut-pct">{pct}%</output>
            </div>
          </div>
        </div>
        <p className="mf-cut__lead">{lead}</p>
        {rows.length ? (
          <>
            <p className="mf-cut__head" aria-hidden><span>{by === 'lender' ? L.debtor : L.lender} · {L.top(rows.length)}</span><span>{L.bar}</span><span>{L.loss}</span><span>{by === 'lender' ? L.ofRes : L.share}</span></p>
            <ol className="mf-cut__rows">
              {rows.map((r) => (
                <li key={r.eco}>
                  <span className="mf-cut__name">{hrefs[r.eco] ? <a href={hrefs[r.eco]}>{nm(r.eco)}</a> : nm(r.eco)}</span>
                  <span className="mf-cut__bar" aria-hidden>{r.of_res != null ? <span className={r.of_res >= 100 ? 'is-over' : ''} style={{ width: `${Math.min(100, (100 * r.of_res) / scale)}%` }} /> : null}</span>
                  <span className="mf-cut__num">{usdBn(r.loss, lang)}</span>
                  <span className="mf-cut__pctres">{by === 'lender' ? (r.of_res != null ? pctText(r.of_res) : <span className="mf-muted">{L.noRes}</span>) : `${num(r.share, lang, 1)}%`}</span>
                </li>
              ))}
            </ol>
          </>
        ) : null}
        {by === 'debtor' && allInstrument(data, eco).length ? (
          <div className="mf-cut__apart">
            <p className="mf-cut__head">{L.apart}</p>
            <ul className="mf-cut__rows">
              {allInstrument(data, eco).map(([c, v]) => (
                <li key={c}><span className="mf-cut__name">{hrefs[c] ? <a href={hrefs[c]}>{nm(c)}</a> : nm(c)}</span><span className="mf-cut__num">{usdBn(v, lang)}</span></li>
              ))}
            </ul>
            <p className="mf-muted">{L.apartNote}</p>
          </div>
        ) : null}
      </div>
      <p className="mf-dcard__foot">{source} · {L.q} {period(data.q, 'Q', lang)} · {L.rule} <a className="mf-chip" href={`${methodHref}#R21`}>R21</a></p>
    </section>
  );
}
