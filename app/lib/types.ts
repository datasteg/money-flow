// The shapes of the release files (scripts/sitebuild/views.py writes them; gate.py fixes their fields).
export type Lang = 'en' | 'ko';
export type Pt = [string, number | null];

export interface Series { ds: string; key?: string | null; f: string; det?: string; pts: Pt[] }

export interface Group {
  parts?: Record<string, number>;
  n?: number;
  ident?: number;
  other?: Record<string, number>;
  flow?: Record<string, [number | null, string]>;
  other_flow?: Record<string, Record<string, number>>;
  rep?: Record<string, string>;
  total?: number | null;
  ni?: number | null;
  cov?: number | null;
  excess?: boolean;
  all_instr?: number | null;
  split?: boolean;
  top?: string; top_v?: number; top_share?: number | null;
  // method 1.1: the reserves-and-IO group (R6), the other reporter's figure (R4), DIP and IIP totals, the bank instrument
  // split and reporters without one (R5), the excess over the total (R6), the IMF derived liability (V16)
  rio?: number; alt?: Record<string, number>; dip_total?: number | null; iip_total?: number | null;
  debt_sec?: number; other_instr?: number; iip_loans?: number; iip_deposits?: number; nosplit?: Record<string, number>; nosplit_share?: number;
  excess_by?: number; derived?: number;
  /** Releases before method 1.6 set the derivatives-and-other pool against the IIP derivatives item; no longer read. */
  iip_deriv?: number | null;
}

export interface Ladder {
  per: Record<string, string | null>;
  rank: string[];
  g: Record<string, Group>;
  nat?: { per: string; rank: string[]; parts: Record<string, number>; ident: number; other: Record<string, number>; total: number | null; ni: number | null; cov: number | null; excess: boolean };
}

export interface Flag { id: string; status: string; dir?: string; group?: string; value?: number | null; period?: string; note?: string }

export interface Econ {
  code: string;
  ladders: Record<'in' | 'out', Ladder[]>;
  index: Record<'in' | 'out', { aligned: Record<string, number>; newest: Record<string, number> }>;
  border: { in?: { iip: Record<string, Pt[]>; bop: Record<string, Pt[]> }; out?: { iip: Record<string, Pt[]>; bop: Record<string, Pt[]> }; net: Pt[];
    vintage?: { published: string | null; read: string } };
  made: Record<string, Series>;
  context: Record<string, Series>;
  tic: Record<string, Series & { flow: Pt[] }> | null;
  usd_bank: Series | null;
  checks: Flag[];
}

export interface EconomyMeta { en: string; ko: string; region: string | null; subregion: string | null; lat: number | null; lon: number | null; agg: boolean; page: boolean; fc: boolean; fd?: boolean }

export interface Meta {
  method: string;
  day: string;
  asof: string[];
  economies: Record<string, EconomyMeta>;
  markets: string[];
  datasets: Record<string, { vintage: string; newest: string | null; freq: string | null; class: string }>;
}

export interface Manifest {
  tag: string; date: string; built: string; previous: string | null; changed: string[]; files: Record<string, string>;
  method: string; code: string; vintages: Record<string, string>; checks: Record<string, number>; size_json: number;
  datasets: Meta['datasets'];
}

export interface DatasetEntry {
  publisher: string; class: string; short: string; en: string; ko: string; landing: string; cadence: string;
  lag_days: Record<string, number>; series?: { en: string; ko: string }; planned?: boolean; notice?: string;
  keys?: Record<string, { publisher?: string; class?: string; note?: string }>;
}
export interface Publisher { en: string; ko: string; short: string; terms: string; terms_note: string }
export interface SourceLink {
  dataset?: string; paper?: string; publisher: string | null; code?: string; label: Record<Lang, string>; name: Record<Lang, string>; url: string;
  cadence: Record<Lang, string>; checked: string; estimate?: { usd_bn: number; as_of: string; up_to?: boolean };
}
export interface SourcesRegistry {
  classes: Record<string, { shown: boolean; csv: boolean; en: string; ko: string }>;
  publishers: Record<string, Publisher>;
  datasets: Record<string, DatasetEntry>;
  /** What a page names as its source (config/sources.yaml `links`), and which panel names which (`panels`; V17). */
  links: Record<string, SourceLink>;
  panels: Record<string, { en: string; ko: string; links: string[] }>;
}

export interface Rule { name: { en: string; ko: string }; en: string; ko: string; why: { en: string; ko: string }; papers?: string[]; fn: string; tests: string[] }
export interface CheckDef { name: { en: string; ko: string }; en: string; ko: string; tolerance: string; severity: string }
export interface Paper { authors: string; title?: string; journal: string; citation: string; year: number; href?: string }
export interface MethodRegistry {
  version: string; date: string; changelog: { version: string; date: string; en: string; ko: string }[];
  papers: Record<string, Paper>; rules: Record<string, Rule>; checks: Record<string, CheckDef>;
  definitions: Record<string, { en: string; ko: string }>; effects: Record<string, Record<string, number>>;
  /** Since method 1.2: what the World page's Signal Board can and cannot see, the nationality switches, and its economies. */
  limits?: { en: string; ko: string }[]; switches?: { en: string; ko: string }[];
  /** Since method 1.6: the standing rule C1–C5 of the flow sites. */
  standing?: { id: string; name: { en: string; ko: string }; en: string; ko: string }[];
  board_set?: { in: string[]; out: [string, string][] };
}

export interface CheckResult {
  id: string; name: { en: string; ko: string }; severity: string; tolerance: string; status: string; summary: string;
  observed: number | string | null; details: unknown[]; n_details: number; by_economy?: Record<string, number>;
}
export interface Checks { results: CheckResult[]; summary: Record<string, number>; registry: string[] }

export interface Citations {
  datasets: Record<string, Record<Lang, { text: string; bibtex: string; ris: string; credit: string }>>;
  method: Record<Lang, { text: string; bibtex: string; ris: string }>;
}

export interface Focus { out: number; in: number; out_pass: number; in_pass: number; out_top: [string, number][]; in_top: [string, number][] }

/** `mkt/bank.lender_cut` (the surface contract; rule R21 "Cut a lender"): for each debtor, its bank loans and deposits from all
 *  LBS reporters (USD bn), the board's net reserves (`res_net_raw`: IRFCL Section I + II without A2's floor, may be
 *  negative; method 1.6) and A2's reserve base (`res_net`, floored), each lender's share of the claims in %, and the
 *  reporters that publish all instruments only for it (`all_instr`, USD bn, no share). loss = cut × share × claims; the
 *  browser only scales. Fields after `res_net` are absent in releases before method 1.6. */
export interface LenderCut {
  q: string;
  debtors: Record<string, { claims_usd: number; res_net: number | null; res_net_raw?: number | null; lenders: Record<string, number>; all_instr?: Record<string, number> }>;
}

export interface Market {
  market: string; ds: string;
  lender_cut?: LenderCut;
  periods: { p: string; holders: Record<string, number>; dests: Record<string, number>; holders_other: number; dests_other: number; pairs: [string, string, number][]; total: number; n_holders: number; n_dests: number;
    /** Each economy in the top 30 either way: gross out and in over every pair, the part with an offshore centre or fund
     *  domicile on the other side, and its ten largest counterparties each way. */
    focus: Record<string, Focus> }[];
}

/** The world view, as far as the app reads it. The release file also carries `plumbing`, `ids` and `ticker` (Fed
 *  plumbing series, BIS IDS outstanding and a weekly ticker), which no page draws; they are left out of the type so
 *  that an unread field cannot look like a used one. */
export interface World {
  apex: Record<string, Series>;
  gli: Record<string, { ds: string; f: string; total: Pt[]; securities: Pt[]; loans: Pt[] }>;
  cofer: Record<string, Pt[]>;
  economies: Record<string, { assets?: Pt[]; liabilities?: Pt[] }>;
  pairs: Record<string, Record<string, [string, string, number][]>>;
  board: Board;
  pulse: Pulse;
}

/** The Signal Board (R17–R19; the method version comes from the release's registry): rows are arrays in the order of `cols`. */
export interface Board {
  cols: string[]; quarters: string[];
  q: Record<string, { rows: (string | number | null)[][]; drop: [string, string][]; n: number; n_out: number; top: [string, number, number, number][];
    /** Method 1.6: economies drawn with their score but no flow score this quarter, with the reason. */
    no_flow?: [string, string][] }>;
  domain: { x: [number, number]; y: [number, number]; size: [number, number] };
  set: { in: string[]; out: [string, string][]; euro?: Record<string, string> }; y_clip: [number, number];
  /** IMF WEO advanced economies on the board (the page's group filter). */
  groups?: { advanced: string[] };
  /** The score's constants (method 1.3 onwards), for the "how this is computed" box. */
  method?: { floor: { a1: number; a2: number }; z_cap: number; min_history: number; min_pool: number; reserve_issuers: string[]; standing_swap: string[]; from: string;
    a2_reserves?: string; res_floor?: number; a1_local?: boolean; buffers?: string[]; offshore_gap?: number; offshore_ratio?: number;
    a1_own_history?: string; gli_currencies?: string[] };
}
export interface PulseSeries { ds: string; key: string; f: string; pts?: Pt[]; latest?: Pt; chg?: number | null; kind?: 'abs' | 'pct'; age?: number; stale?: boolean; missing?: boolean }
export interface Pulse {
  swap_lines: PulseSeries; custody_treasuries: PulseSeries; dollar_index: PulseSeries;
  tic?: { ds: string; f: string; official: Pt[]; private: Pt[]; latest: string; age: number };
}
