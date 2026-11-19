// UI strings, English and Korean (Korean: 해라체 in text, 합니다체 in UI messages; guides/voice-ko.md).
import type { Lang } from './types';

export const LANGS: Lang[] = ['en', 'ko'];
export const isLang = (x: string): x is Lang => x === 'en' || x === 'ko';

const S = {
  en: {
    siteName: 'money-flow',
    description: 'Where money is made and where it goes: cross-border positions from markets to countries to the global top, from BIS, IMF and central bank statistics. Every number with its sources, method and checks, citable by release.',
    skip: 'Skip to content',
    nav: { economy: 'Economy', markets: 'Markets', world: 'World', sovereign: 'Sovereign', method: 'Method', sources: 'Sources', checks: 'Checks', releases: 'Releases' },
    cite: 'Cite', night: 'Switch to Night', day: 'Switch to Day',
    latest: 'Latest',
    mode: 'Mode', world: 'World', economy: 'Economy', market: 'Market', focus: 'Focus', direction: 'Direction', inflows: 'Inflows', outflows: 'Outflows',
    width: 'Width', position: 'Position', flow: 'Flow', basis: 'Basis', residence: 'Residence', nationality: 'Nationality', periods: 'Periods',
    aligned: 'Aligned', newest: 'Newest', day_: 'Day', dayView: 'View as of', dayNote: 'shows the newest data published by this day; each figure states its own period', holders: 'Holders shown', play: 'Play', pause: 'Pause', clear: 'Reset view',
    chart: 'Chart', table: 'Table', source: 'Source: ', updated: 'Updated', calculations: 'Calculations: datasteg money-flow',
    thisView: 'This view', coverage: 'Coverage', sources: 'Sources', rulesApplied: 'Rules applied', checks: 'Checks',
    numbers: 'Numbers in this view, USD bn', numbersNote: 'The drawn marks only, as they appear in the chart. Totals were computed before rounding, so rows may differ from a total by rounding.',
    citeView: 'Cite this view', copy: 'Copy', copied: 'Copied', figureNote: 'Figure note', bibtex: 'BibTeX', ris: 'RIS', datasetsCite: "The datasets' own citations", methodCite: "The method's citation",
    png: 'PNG', svg: 'SVG', csv: 'CSV of this view', copyNote: 'Copy figure note',
    notIdentified: 'Not identified', other: 'Other', directInvestors: 'Direct investors (not split by investor)',
    reservesIO: 'Reserve managers and international organisations', otherInstr: 'Banks abroad, derivatives and other instruments (no split by reporter)',
    basisNote: 'Residence basis: a holder is the economy where the position is booked. FC marks a BIS offshore centre, FD a fund domicile (Luxembourg, Ireland, the Netherlands, Switzerland): holders there are rarely the end investors.',
    pass: 'Pass', warning: 'Warning', info: 'Information', fail: 'Fail',
    release: 'release', method: 'method', notLatest: (t: string, d: string, l: string) => `You are viewing release ${t} of ${d}. The latest is ${l}.`,
    viewLatest: 'View the latest',
    channel: { debt: 'Portfolio debt', bank: 'Bank loans and deposits', fdi: 'Direct investment', equity: 'Portfolio equity', unsplit: 'Portfolio, type not reported', reserves: 'Reserves', portfolio: 'Portfolio', bank_other: 'Bank derivatives and other',
      bank_nat: 'Foreign claims of BIS banks by nationality (bank type 4R, all instruments): beside the IIP, not added' } as Record<string, string>,
    channelShort: { debt: 'Debt', bank: 'Bank', fdi: 'FDI', equity: 'Equity', unsplit: 'Portfolio', reserves: 'Reserves', bank_other: 'Bank other' } as Record<string, string>,
    rung: { global: 'Global', country: 'Country', market: 'Markets' },
    made: 'Made here', border: 'Border (IIP)',
    measure: { cb_assets: 'Central bank assets', monetary_base: 'Monetary base', currency: 'Currency', reserves_banks: 'Bank reserves', m1: 'M1', broad_money: 'Broad money', m3: 'M3', lf: 'Lf', l: 'L (liquidity)', credit_private: 'Credit to the private sector', fx_reserves: 'FX reserves', mmf_retail: 'Retail money funds', treasury_account: 'Treasury account', reverse_repo: 'ON reverse repo', swap_lines: 'Swap lines', repo_lending: 'Repo lending', ids_outstanding: 'International debt securities', banks_claims_nonres: "Banks' claims on non-residents", banks_liabilities_nonres: "Banks' liabilities to non-residents" } as Record<string, string>,
    iip: { total: 'Total', direct: 'Direct', portfolio: 'Portfolio', other: 'Other', reserves: 'Reserves', net: 'Net' } as Record<string, string>,
    holder: 'Holder', destination: 'Destination', channelCol: 'Channel', positionCol: 'Position', periodCol: 'Period', sourceCol: 'Source', rulesCol: 'Rules', reportedCol: 'Reported by', flowCol: 'Latest flow',
    reportedBy: { creditor: 'holder', debtor: 'host', mirror_debtor: 'host (mirror)', mirror_creditor: 'investor (mirror)' } as Record<string, string>,
    kpi: { portIn: 'Securities held abroad', portOut: 'Foreign securities held', bankIn: 'Bank claims on', bankOut: "Banks' claims abroad",
      bankLbs: 'Bank loans and deposits owed (BIS locational)', bankNat: 'Foreign claims of BIS banks by nationality (bank type 4R, all instruments)',
      iipIn: 'Gross external liabilities (incl. equity)', iipOut: 'Gross external assets', niip: 'Net IIP (assets − liabilities)', reserves: 'FX reserves',
      split: (debt: string, eq: string, der: string | null) => `debt ${debt} · equity ${eq}${der ? ` · derivatives ${der}` : ''}`, withEquity: 'total, equity included',
      netOf: (a: string, l: string) => `${a} assets − ${l} liabilities`,
      equityHint: 'Equity liabilities (portfolio equity and direct investment equity) are marked to market: they rise with domestic stock prices, and a rise is not new borrowing. Debt = portfolio debt, other investment and direct investment debt.',
      assetsHint: 'All external financial assets at market value, reserves included; debt = portfolio debt, other investment and direct investment debt, equity = portfolio and direct investment equity.',
      netHint: 'Assets less liabilities, both at market value: above zero the economy is a net creditor to the rest of the world. Equity liabilities move with domestic stock prices, so a stock rally lowers it without any new borrowing.',
      vintage: (pub: string, read: string) => `IMF IIP published ${pub} (read ${read}).` },
    holdersCount: (n: number) => `${n} holders`, destsCount: (n: number) => `${n} destinations`,
    inUsd: (v: string) => `${v} in USD`,
    last13: 'last 13 weeks', last13m: 'last 13 months',
    notes: 'Notes', notMeasured: 'not measured', ghost: 'not measured weekly',
    economiesTitle: 'Economies', marketsTitle: 'Markets', methodTitle: 'Method', sourcesTitle: 'Sources', checksTitle: 'Checks', releasesTitle: 'Releases',
    market_: { equity: 'Portfolio equity', bonds: 'Portfolio debt', bank: 'Bank loans and deposits', fdi: 'Direct investment' } as Record<string, string>,
    ladder: 'The money ladder',
    page: { world: 'World', econ: 'Economy', market: 'Markets', sovereign: 'Sovereign' },
    ask: { econ: 'Who puts money into this economy, through which instruments, and where its own money goes', market: 'For each instrument, who holds whose assets', world: 'Where dollars and other funding move, and who is exposed when they turn' },
    // method 1.6: the nationality overlay and the derivatives-and-other pool as context
    natCheck: 'Nationality draws the foreign claims of BIS banks (CBS, all instruments, claims in the local currency included) as an overlay beside the IIP: outside its stack and out of the headline sum',
    natPoolNote: 'an overlay: not an external liability item of the IIP, and not added to any total',
    oiDesc: 'BIS LBS: all reporters\' claims on {economy} in derivatives and other instruments. In no other channel, so a pool of its own, shown as context with its own total: the LBS other instruments are wider than derivatives, so the IIP derivatives item is not their total. The BIS publishes no split by reporter',
  },
  ko: {
    siteName: 'money-flow',
    description: '돈이 어디서 만들어지고 어디로 가는지 시장에서 국가, 세계 최상층까지 나타냅니다. BIS·IMF·중앙은행 통계로 산출한 수치마다 출처와 방법, 점검 결과를 밝힙니다. 릴리스 단위로 인용할 수 있습니다.',
    skip: '본문 바로가기',
    nav: { economy: '경제', markets: '시장', world: '세계', sovereign: '국가 재정', method: '방법론', sources: '출처', checks: '점검', releases: '릴리스' },
    cite: '인용', night: '야간 테마로 전환', day: '주간 테마로 전환',
    latest: '최신',
    mode: '모드', world: '세계', economy: '경제', market: '시장', focus: '대상', direction: '방향', inflows: '유입', outflows: '유출',
    width: '폭', position: '잔액', flow: '흐름', basis: '기준', residence: '거주성', nationality: '국적', periods: '기간',
    aligned: '정렬', newest: '최신', day_: '날짜', dayView: '보기 기준일', dayNote: '이날까지 공표된 최신 자료 기준입니다. 자료 시점은 수치마다 따로 밝힙니다', holders: '보유국 수', play: '재생', pause: '정지', clear: '보기 초기화',
    chart: '차트', table: '표', source: '자료: ', updated: '갱신', calculations: '계산: datasteg money-flow',
    thisView: '이 화면', coverage: '포괄률', sources: '자료', rulesApplied: '적용 규칙', checks: '점검',
    numbers: '이 화면의 수치, 억 달러', numbersNote: '차트에 그려진 값만 싣습니다. 합계는 반올림 전에 계산했으므로 행의 합과 합계가 반올림만큼 다를 수 있습니다.',
    citeView: '이 화면 인용하기', copy: '복사', copied: '복사했습니다', figureNote: '그림 주석', bibtex: 'BibTeX', ris: 'RIS', datasetsCite: '원자료 인용', methodCite: '방법론 인용',
    png: 'PNG', svg: 'SVG', csv: '이 화면 CSV', copyNote: '그림 주석 복사',
    notIdentified: '미확인', other: '기타', directInvestors: '직접투자자(투자국 미구분)',
    reservesIO: '준비자산 운용기관·국제기구', otherInstr: '해외 은행의 파생상품·기타 상품(보고국 미구분)',
    basisNote: '거주성 기준입니다. 보유국은 잔액이 계상된 경제입니다. FC는 BIS 기준 역외금융센터, FD는 펀드 소재지(룩셈부르크, 아일랜드, 네덜란드, 스위스)입니다. 이들 보유국은 최종투자자가 아닌 경우가 많습니다.',
    pass: '통과', warning: '경고', info: '참고', fail: '실패',
    release: '릴리스', method: '방법론', notLatest: (t: string, d: string, l: string) => `${d} 릴리스 ${t}를 보고 있습니다. 최신 릴리스는 ${l}입니다.`,
    viewLatest: '최신으로 보기',
    channel: { debt: '증권투자(채권)', bank: '은행 대출금·예금', fdi: '직접투자', equity: '증권투자(주식)', unsplit: '증권투자(유형 미보고)', reserves: '준비자산', portfolio: '증권투자', bank_other: '은행 파생상품·기타',
      bank_nat: '국적 기준 BIS 은행의 대외채권(은행 유형 4R, 모든 금융상품)입니다. IIP와 별도로 표시하며 합산하지 않습니다.' } as Record<string, string>,
    channelShort: { debt: '채권', bank: '은행', fdi: '직접투자', equity: '주식', unsplit: '증권', reserves: '준비자산', bank_other: '은행 기타' } as Record<string, string>,
    rung: { global: '세계', country: '국가', market: '시장' },
    made: '국내 창출', border: '국경(IIP)',
    measure: { cb_assets: '중앙은행 자산', monetary_base: '본원통화', currency: '현금통화', reserves_banks: '지급준비금', m1: 'M1', broad_money: '광의통화', m3: 'M3', lf: 'Lf', l: 'L(광의유동성)', credit_private: '민간신용', fx_reserves: '외환보유액', mmf_retail: '개인 MMF', treasury_account: '미 재무부 일반계정', reverse_repo: '익일물 역RP', swap_lines: '통화스왑', repo_lending: 'RP 대출', ids_outstanding: '국제채권 잔액', banks_claims_nonres: '은행의 대외채권', banks_liabilities_nonres: '은행의 대외채무' } as Record<string, string>,
    iip: { total: '합계', direct: '직접투자', portfolio: '증권투자', other: '기타투자', reserves: '준비자산', net: '순대외' } as Record<string, string>,
    holder: '보유국', destination: '투자 대상국', channelCol: '경로', positionCol: '잔액', periodCol: '기간', sourceCol: '자료', rulesCol: '규칙', reportedCol: '보고 주체', flowCol: '최근 흐름',
    reportedBy: { creditor: '보유국', debtor: '투자 대상국', mirror_debtor: '투자 대상국(미러)', mirror_creditor: '투자국(미러)' } as Record<string, string>,
    kpi: { portIn: '해외 보유 증권', portOut: '보유 해외 증권', bankIn: '해외 은행의 채권', bankOut: '은행의 대외채권',
      bankLbs: '은행 대출금·예금 채무(BIS 소재지 기준)', bankNat: '국적 기준 BIS 은행의 대외채권(은행 유형 4R, 모든 금융상품)입니다.',
      iipIn: '대외금융부채(총액·지분 포함)', iipOut: '대외금융자산(총액)', niip: '순대외금융자산(자산−부채)', reserves: '외환보유액',
      split: (debt: string, eq: string, der: string | null) => `채무성 ${debt} · 지분성 ${eq}${der ? ` · 파생 ${der}` : ''}`, withEquity: '지분 포함 총액',
      netOf: (a: string, l: string) => `자산 ${a} − 부채 ${l}`,
      equityHint: '지분성 부채(증권투자 주식과 직접투자 지분)는 시가로 평가합니다. 국내 주가가 오르면 평가액이 함께 늘어납니다. 그러나 그 증가는 외국에서 새로 차입한 것이 아닙니다. 채무성 부채는 증권투자 채권, 기타투자, 직접투자 채무상품입니다.',
      assetsHint: '대외금융자산 전체를 시가로 평가한 값이며 준비자산을 포함합니다. 채무성은 증권투자 채권, 기타투자, 직접투자 채무상품입니다. 지분성은 증권투자 주식과 직접투자 지분입니다.',
      netHint: '대외금융자산에서 대외금융부채를 뺀 값이며, 둘 다 시가 기준입니다. 0보다 크면 세계에 대해 순채권국입니다. 지분성 부채는 국내 주가를 따라 움직이므로, 주가가 오르면 새로운 차입이 없어도 순대외금융자산이 줄어듭니다.',
      vintage: (pub: string, read: string) => `IMF IIP ${pub} 공표(${read} 수집).` },
    holdersCount: (n: number) => `보유국 ${n}개`, destsCount: (n: number) => `투자 대상국 ${n}개`,
    inUsd: (v: string) => `달러 표시 ${v}`,
    last13: '최근 13주', last13m: '최근 13개월',
    notes: '용어', notMeasured: '측정 안 됨', ghost: '주간 자료 없음',
    economiesTitle: '경제', marketsTitle: '시장', methodTitle: '방법론', sourcesTitle: '자료', checksTitle: '점검', releasesTitle: '릴리스',
    market_: { equity: '증권투자(주식)', bonds: '증권투자(채권)', bank: '은행 대출·예금', fdi: '직접투자' } as Record<string, string>,
    ladder: '돈의 사다리',
    page: { world: '세계', econ: '경제', market: '시장', sovereign: '국가 재정' },
    ask: { econ: '누가 어떤 경로로 이 경제에 자금을 공급하고, 이 경제의 자금은 어디로 투자되는가', market: '상품마다 누가 어느 나라의 자산을 보유하는가', world: '달러 등 자금이 어디로 이동하는지, 흐름이 바뀌면 어느 경제가 영향을 받는지' },
    natCheck: '국적 기준은 국제결제은행(BIS) 보고은행의 대외채권(CBS, 전체 상품, 현지통화 채권 포함)을 국제투자대조표(IIP) 옆에 겹쳐 표시합니다. IIP 누적 막대에는 포함하지 않고 대표 합계에도 더하지 않습니다.',
    natPoolNote: '겹쳐 보여 주는 참고 지표입니다. IIP의 대외부채 항목이 아니며 어떤 합계에도 더하지 않습니다.',
    oiDesc: 'BIS LBS는 모든 보고국 은행이 {economy} 거주자에 대해 보유한 파생상품·기타 금융상품 청구권입니다. 다른 경로에는 포함되지 않아 별도 항목으로 두고, 자체 합계와 함께 참고로 표시합니다. LBS 기타 금융상품은 파생상품보다 범위가 넓으므로 IIP 파생상품 항목이 그 합계가 되지는 않습니다. BIS는 보고국별 내역을 공표하지 않습니다.',
  },
};

export type Strings = typeof S.en;
const MEMO: Partial<Record<Lang, Strings>> = {};
/** The strings of a language; a Korean string still waiting for its draft ('') shows its English (withFallback). */
export function t(lang: Lang): Strings {
  return (MEMO[lang] ??= lang === 'en' ? S.en : withFallback(S.en, S[lang] as Strings));
}

export function name(codes: Record<string, { en: string; ko: string }>, code: string, lang: Lang): string {
  if (code === '_other') return t(lang).other;
  if (code === '_ni') return t(lang).notIdentified;
  if (code === '_rio') return t(lang).reservesIO;
  if (code === '_oi') return t(lang).otherInstr;
  const e = codes[code];
  return e ? (lang === 'ko' ? e.ko || e.en : e.en) : code;
}

/** A string table for `lang` where a string still waiting for its Korean ('', the project's mark for "qkr has not drafted
 *  it yet") shows its English instead, so a page never prints an empty label. Recurses into nested objects. */
export function withFallback<T>(en: T, x: T): T {
  if (typeof en !== 'object' || en === null || Array.isArray(en)) return (x === '' || x == null ? en : x) as T;
  const out: Record<string, unknown> = { ...(en as Record<string, unknown>) };
  for (const [k, v] of Object.entries((x ?? {}) as Record<string, unknown>)) {
    const e = (en as Record<string, unknown>)[k];
    out[k] = typeof v === 'object' && v !== null && !Array.isArray(v) && typeof e === 'object' && e !== null ? withFallback(e, v) : v === '' ? e : v;
  }
  return out as T;
}
