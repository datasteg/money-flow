// The Method page's body, shared by the page and its print edition: the rules with their papers,
// what each did in this release (counts written by the build), the worked reconciliation for Korea, definitions.
import { PaperCard } from './sn';
import { money, num, pct, period } from '@/lib/format';
import { t, withFallback } from '@/lib/i18n';
import type { Econ, Lang, MethodRegistry, SourcesRegistry } from '@/lib/types';
import { SrcLink } from './Src';

const byId = <T,>(o: Record<string, T>) => Object.entries(o).sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)));

const WHY: Record<string, { en: string; ko: string }> = {
  hub: { en: 'the hub, not a borrower in this sense', ko: '중심축이며 이 의미의 차입국은 아닙니다.' },
  offshore_centre: { en: 'BIS offshore financial centre', ko: 'BIS 역외금융센터' },
  fund_domicile: { en: 'fund domicile (flagged FD)', ko: '펀드 소재지(FD 표시)' },
  aggregate: { en: 'aggregate; its members are shown', ko: '집계 단위이며, 회원국은 따로 표시합니다.' },
};

// The worked reconciliation's bank paragraph (method 1.6): the derivatives-and-other pool is context
// with its own total, no longer set against the IIP derivatives item. {tokens} are filled with this release's figures.
const STANDING_H = { en: 'One rule per quantity: the standing rule of the flow sites', ko: '지표 하나에 규칙 하나: 흐름 사이트의 상시 원칙' };
const STANDING_LEDE = { en: 'datasteg does not have to match other aggregations of the same data. It has to be consistent with itself: money-flow, trade-flow and global-network follow processes that agree, and the pages show them. Five rules make that testable.', ko: 'datasteg의 수치는 같은 자료를 달리 집계한 결과와 같을 필요는 없습니다. 다만 스스로는 일관돼야 합니다. money-flow, trade-flow, global-network는 서로 맞물리는 절차를 따르고, 각 페이지가 그 절차를 나타냅니다. 다섯 가지 원칙으로 이를 검증할 수 있습니다.' };

const REC = {
  en: { bank: 'All BIS reporters\' loans and deposits to Korea {total} = {ident} from single reporters + {ni} not identified (coverage {cov}; of which reporters with no instrument split, all instruments: {nosplit}, listed apart by the lender cut, R21). All instruments {all} = loans and deposits + debt securities {debt} (counted in portfolio debt) + derivatives and other {other} (a pool of its own, shown as context with its own total). IIP loans {loans} and deposits {deposits} (V15).' },
  ko: { bank: 'BIS 전체 보고국 은행이 한국에 제공한 대출·예금 {total} = 개별 보고국 분 {ident} + 보고국 미식별 분 {ni}입니다(포괄 비율 {cov}). 이 가운데 상품 구분이 없는 보고국의 전체 금융상품 기준 금액은 {nosplit}이며, 대출 축소 시나리오에서 별도로 표시합니다(R21). 전체 금융상품 {all} = 대출·예금 + 채무증권 {debt}(증권투자 부채성증권에 포함) + 파생상품 및 기타 {other}입니다. 파생상품 및 기타는 별도 집계로, 자체 합계와 함께 참고로 보여 줍니다. 국제투자대조표의 대출은 {loans}, 예금은 {deposits}입니다(V15).' },
};

export function MethodBody({ method, lang, korea, release, reg, names }: {
  method: MethodRegistry; lang: Lang; korea: Econ | null; release: string; reg?: SourcesRegistry; names?: (code: string) => string }) {
  const L = t(lang);
  const tx = (x: { en: string; ko: string }) => (lang === 'ko' && x.ko ? x.ko : x.en);   // a Korean text still waiting for its draft shows its English
  const R = withFallback(REC.en, REC[lang]);
  const idx = korea?.index.in.aligned;
  const lastKey = idx ? Object.keys(idx).sort().slice(-1)[0] : null;
  const lad = korea && lastKey != null ? korea.ladders.in[idx![lastKey]] : null;
  const g = lad?.g;
  return (
    <>
      {method.standing?.length ? (
        <>
          <h2 className="mf-h2" id="standing">{tx(STANDING_H)}</h2>
          <p>{tx(STANDING_LEDE)}</p>
          <ul className="mf-notes">{method.standing.map((c) => <li key={c.id} id={c.id}><b>{c.id} {tx(c.name)}.</b> {tx(c)}</li>)}</ul>
        </>
      ) : null}
      <h2 className="mf-h2">{lang === 'ko' ? '규칙' : 'Rules'}</h2>
      <div className="mf-rules">
        {byId(method.rules).map(([id, r]) => (
          <article className="mf-rule" id={id} key={id}>
            <div className="mf-rule__head"><span className="mf-rule__id">{id}</span><span className="mf-rule__name">{tx(r.name)}</span></div>
            <p>{tx(r)}</p>
            <p className="mf-why">{lang === 'ko' ? '이유: ' : 'Why: '}{tx(r.why)}</p>
            {method.effects[id] ? (
              <ul className="mf-effects">
                {Object.entries(method.effects[id]).map(([k, v]) => <li key={k}>{lang === 'ko' ? `릴리스 ${release}: ` : `In release ${release}: `}<b>{num(v, lang, 0)}</b> {k}</li>)}
              </ul>
            ) : null}
            <p className="mf-note" style={{ marginTop: 6 }}>{lang === 'ko' ? '코드' : 'Code'}: <span className="mf-mono">scripts/sitebuild/{r.fn.replace('.', '.py · ')}</span> · {lang === 'ko' ? '테스트' : 'tests'}: <span className="mf-mono">{r.tests.join(', ')}</span></p>
            {r.papers?.length ? (
              <div className="mf-papers">
                {r.papers.map((pid) => {
                  const p = method.papers[pid];
                  return p ? <PaperCard key={pid} label={lang === 'ko' ? `근거 논문 · jejualps ${pid}` : `Paper · jejualps ${pid}`} title={p.title} authors={p.authors} journal={p.journal} citation={p.citation} year={p.year} href={p.href} /> : null;
                })}
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {g ? (
        <>
          <h2 className="mf-h2" id="reconciliation">{lang === 'ko' ? '대조 예시: 한국, 유입' : 'Worked reconciliation: Korea, inflows'}</h2>
          <div className="mf-prose">
            <p>{lang === 'ko'
              ? `정렬 설정의 최신 사다리(증권 ${period(lad!.per.portfolio, 'S', 'ko')}, 은행 ${period(lad!.per.bank, 'Q', 'ko')})를 IIP 총계부터 따라갑니다.`
              : `The newest aligned ladder (portfolio ${period(lad!.per.portfolio, 'S', 'en')}, banks ${period(lad!.per.bank, 'Q', 'en')}), followed from the IIP total down.`}</p>
            <p><b>R6, {L.channel.portfolio}.</b> {lang === 'ko'
              ? `IIP 증권투자 부채 ${money(g.portfolio?.total, 'ko')} = 확인된 ${money(g.portfolio?.ident, 'ko')}(보고 보유국 ${money((g.portfolio?.ident ?? 0) - (g.portfolio?.rio ?? 0), 'ko')}, 그중 유형 미보고 ${money(g.unsplit?.ident, 'ko')}, 그리고 준비자산 운용기관·국제기구 집단 ${money(g.portfolio?.rio ?? 0, 'ko')}) + 어느 보유국도 보고하지 않은 ${money(g.portfolio?.ni, 'ko')}. 포괄률 ${pct(g.portfolio?.cov, 'ko')}. 보고 보유국 확인분 가운데 주식 ${money(g.equity?.ident, 'ko')}, 채권 ${money(g.debt?.ident, 'ko')}. IMF가 산출한 파생 부채 ${money(g.portfolio?.derived, 'ko')}는 확인분과 같습니다(V16).`
              : `IIP portfolio liabilities ${money(g.portfolio?.total, 'en')} = ${money(g.portfolio?.ident, 'en')} identified (${money((g.portfolio?.ident ?? 0) - (g.portfolio?.rio ?? 0), 'en')} by reporting holders, of which ${money(g.unsplit?.ident, 'en')} with no instrument split, and ${money(g.portfolio?.rio ?? 0, 'en')} by the reserves-and-international-organisations group) + ${money(g.portfolio?.ni, 'en')} reported by no holder. Coverage ${pct(g.portfolio?.cov, 'en')}. Of the reporting holders' part, equity ${money(g.equity?.ident, 'en')} and debt ${money(g.debt?.ident, 'en')}. The IMF's own derived liability, ${money(g.portfolio?.derived, 'en')}, equals the identified part (V16).`}</p>
            <p><b>R6, R5, {L.channel.bank}.</b> {R.bank.replace(/\{(\w+)\}/g, (_, k: string) => ({
              total: money(g.bank?.total, lang), ident: money(g.bank?.ident, lang), ni: money(g.bank?.ni, lang), cov: pct(g.bank?.cov, lang),
              nosplit: Object.entries(g.bank?.nosplit ?? {}).map(([h, v]) => `${h} ${money(v, lang)}`).join(', '), all: money(g.bank?.all_instr, lang),
              debt: money(g.bank?.debt_sec, lang), other: money(g.bank?.other_instr, lang), loans: money(g.bank?.iip_loans, lang), deposits: money(g.bank?.iip_deposits, lang),
            } as Record<string, string>)[k] ?? '')}</p>
            <p><b>R7, R4, R6, {L.channel.fdi}.</b> {lang === 'ko'
              ? `${g.fdi?.split ? `DIP ${period(lad!.per.fdi, 'A', 'ko')} 전체 투자국 합계 ${money(g.fdi?.total, 'ko')}(투자 대상국 평가 기준) = 투자국 확인 ${money(g.fdi?.ident, 'ko')} + 미확인 ${money(g.fdi?.ni, 'ko')}. IIP 직접투자 부채 ${money(g.fdi?.iip_total, 'ko')}(시장가치)는 국경에 둡니다.` : `직접투자 부채 ${money(g.fdi?.total, 'ko')}. 정렬 기간 이전의 DIP 연도가 없어 통째로 그립니다.`}`
              : `${g.fdi?.split ? `DIP ${period(lad!.per.fdi, 'A', 'en')} all-investor total ${money(g.fdi?.total, 'en')} (the host's valuation) = ${money(g.fdi?.ident, 'en')} identified by investor + ${money(g.fdi?.ni, 'en')} not identified. IIP direct investment liabilities ${money(g.fdi?.iip_total, 'en')} (market value) sit on the border.` : `Direct investment liabilities ${money(g.fdi?.total, 'en')}. No DIP year at or before the aligned period, so the ribbon is drawn whole.`}`}</p>
          </div>
        </>
      ) : null}

      {method.limits?.length ? (
        <>
          <h2 className="mf-h2" id="signal-board">{lang === 'ko' ? '세계 화면에 포함되는 것과 포함되지 않는 것' : 'What the World page can and cannot see'}</h2>
          <ul className="mf-notes">{method.limits.map((x, i) => <li key={i}>{tx(x)}</li>)}</ul>
          {method.switches?.length ? (
            <>
              <h3 className="mf-h3">{lang === 'ko' ? '국적·최종위험 기준으로 바꾼 곳' : 'Where the page uses nationality or ultimate risk'}</h3>
              <ul className="mf-notes">{method.switches.map((x, i) => <li key={i}>{tx(x)}</li>)}</ul>
              {reg ? <p className="mf-note">{lang === 'ko' ? '근거: ' : 'Source: '}<SrcLink reg={reg} id="paper.bisqr2603" lang={lang} />{lang === 'ko' ? ', BIS 분기보고서 2026년 3월' : ', BIS Quarterly Review, March 2026'}</p> : null}
            </>
          ) : null}
          {method.board_set ? (
            <>
              <h3 className="mf-h3">{lang === 'ko' ? `신호판의 경제(${method.board_set.in.length}개)` : `The board's economies (${method.board_set.in.length})`}</h3>
              <p className="mf-prose">{method.board_set.in.map((c) => names?.(c) ?? c).join(', ')}.</p>
              <h3 className="mf-h3">{lang === 'ko' ? '포함하지 않은 경제와 이유' : 'Left out, and why'}</h3>
              <ul className="mf-notes">
                {method.board_set.out.map(([c, why]) => <li key={c}><b>{names?.(c) ?? c}</b>: {WHY[why]?.[lang] ?? why}</li>)}
                <li>{lang === 'ko' ? '그 밖의 모든 경제: BIS 총신용에 GDP 분모가 없습니다(R19). 다섯 요소 가운데 하나라도 없는 분기는 그리지 않고 점검 V18에 이유와 함께 기록합니다.' : 'Every other economy: no GDP denominator in BIS total credit (R19). A quarter missing any of the five components is not drawn and is listed with its reason in check V18.'}</li>
              </ul>
            </>
          ) : null}
        </>
      ) : null}

      <h2 className="mf-h2">{lang === 'ko' ? '점검' : 'Checks'}</h2>
      <ul className="mf-notes">
        {byId(method.checks).map(([id, c]) => <li key={id}><b>{id} {tx(c.name)}.</b> {tx(c)} <span className="mf-muted">({c.tolerance}; {c.severity})</span></li>)}
      </ul>

      <h2 className="mf-h2">{lang === 'ko' ? '용어' : 'Definitions'}</h2>
      <ul className="mf-notes">
        {Object.entries(method.definitions).map(([k, d]) => <li key={k}><b>{k.replace('_', ' ')}.</b> {tx(d)}</li>)}
      </ul>

      <h2 className="mf-h2">{lang === 'ko' ? '변경 이력' : 'Changelog'}</h2>
      <ul className="mf-notes">{method.changelog.map((c) => <li key={c.version}><b>{c.version}</b> ({c.date}): {tx(c)}</li>)}</ul>
    </>
  );
}
