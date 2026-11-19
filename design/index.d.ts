import type * as React from 'react';

/** Every component accepts `lang` ("en" | "ko"). It switches built-in strings and Korean typography.
 *  When omitted, components read <html lang>. */
export type Lang = 'en' | 'ko';
interface Base { lang?: Lang; className?: string }
/** A categorical slot 1–8, the emphasis colour, the de-emphasis grey, or a raw `var(--token)`. */
export type SeriesColor = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 'focus' | 'context' | string;

/* ---------------- Navigation ---------------- */
export interface MastheadLink { label: string; href?: string; active?: boolean }
export interface MastheadProps extends Base {
  /** Publication name, set as a type-only wordmark. Default "Sinho". Stays Latin in both languages. */
  name?: string;
  href?: string;
  /** 3–5 primary sections. */
  links?: MastheadLink[];
  /** LanguageSwitch, optional theme toggle, one primary Subscribe button. */
  actions?: React.ReactNode;
}
export declare function Masthead(props: MastheadProps): React.ReactElement;

export interface LanguageOption { code: Lang; label: string; href?: string; onClick?: React.MouseEventHandler }
export interface LanguageSwitchProps extends Base {
  current?: Lang;
  /** Default: EN and 한국어. `href` must point at the same page in the other language. */
  options?: LanguageOption[];
  showIcon?: boolean;
}
export declare function LanguageSwitch(props: LanguageSwitchProps): React.ReactElement;

export interface TabItem { id: string; label: React.ReactNode; count?: number; tabId?: string; panelId?: string }
export interface TabsProps extends Base { items: TabItem[]; value?: string; defaultValue?: string; onChange?: (id: string) => void; label?: string }
export declare function Tabs(props: TabsProps): React.ReactElement;

export interface FooterProps extends Base { name?: string; href?: string; links?: MastheadLink[]; note?: React.ReactNode; languageSwitch?: React.ReactNode }
export declare function Footer(props: FooterProps): React.ReactElement;

/* ---------------- Actions & inputs ---------------- */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = accent fill (one per view) · secondary = outlined (default) · quiet = text only · deep = on deep blocks only */
  variant?: 'primary' | 'secondary' | 'quiet' | 'deep';
  size?: 'md' | 'sm';
  href?: string;
  icon?: 'bookmark' | 'share' | 'unlock' | 'download' | 'globe' | 'info';
}
export declare function Button(props: ButtonProps): React.ReactElement;

export interface SubscribeBoxProps extends Base {
  title?: string; body?: string; placeholder?: string; buttonLabel?: string;
  /** Cadence and unsubscribe promise. */
  fine?: string; doneMessage?: string;
  onSubmit?: (email: string) => void;
}
export declare function SubscribeBox(props: SubscribeBoxProps): React.ReactElement;

interface FieldProps extends Base { label?: string; hint?: string; error?: string; width?: number | string; id?: string }
export interface TextFieldProps extends FieldProps, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'lang'> {}
export declare function TextField(props: TextFieldProps): React.ReactElement;

export interface SelectOption { value: string; label: string }
export interface SelectProps extends FieldProps, Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'lang'> { options: SelectOption[] }
export declare function Select(props: SelectProps): React.ReactElement;

export interface SegmentedControlProps extends Base { options: SelectOption[]; value?: string; defaultValue?: string; onChange?: (value: string) => void; label: string; size?: 'md' | 'sm' }
export declare function SegmentedControl(props: SegmentedControlProps): React.ReactElement;

export interface SwitchProps extends Base { label: React.ReactNode; checked?: boolean; defaultChecked?: boolean; onChange?: (on: boolean) => void; disabled?: boolean }
export declare function Switch(props: SwitchProps): React.ReactElement;

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'lang'>, Base {
  label: React.ReactNode;
  /** Show a series colour swatch when the checkbox picks a chart series. */
  swatch?: SeriesColor;
}
export declare function Checkbox(props: CheckboxProps): React.ReactElement;

/* ---------------- Newsletter: feed & article ---------------- */
export interface TagProps extends Base { kind?: 'topic' | 'jel' | 'new'; href?: string; children?: React.ReactNode }
export declare function Tag(props: TagProps): React.ReactElement;

export interface StoryCardProps extends Base {
  kicker?: string;
  /** The finding as a sentence — not the paper's title. */
  title: string;
  dek?: string; href?: string;
  /** Already formatted for the language: "14 Oct" / "10월 14일". */
  date?: string;
  /** "6 min read" / "6분". */
  readTime?: string;
  tags?: string[];
  thumbnail?: string | React.ReactNode; thumbnailAlt?: string;
  isNew?: boolean;
}
export declare function StoryCard(props: StoryCardProps): React.ReactElement;

export interface IssueHeroProps extends Base {
  /** Zero-padded, e.g. "014". Rendered "Issue 014" / "제14호". */
  issue: string;
  date?: string; title: string; note?: string; meta?: string;
  children?: React.ReactNode;
}
export declare function IssueHero(props: IssueHeroProps): React.ReactElement;

export interface ArticleHeaderProps extends Base {
  kicker?: string; title: string; subtitle?: string;
  author: string; authorInitials?: string;
  /** "Summary" / "요약", "Insight" / "인사이트". */
  role?: string; readTime?: string; date?: string;
  leading?: React.ReactNode;
  /** Defaults to Save + Share. Pass null for none. */
  actions?: React.ReactNode;
  onSave?: () => void; onShare?: () => void;
}
export declare function ArticleHeader(props: ArticleHeaderProps): React.ReactElement;

export interface PaperFact { label: string; value: React.ReactNode }
export interface PaperCardProps extends Base {
  label?: string;
  /** The paper's exact title, in its own language. */
  title: string;
  /** Korean rendering of the title, shown below it on the Korean edition. */
  titleTranslated?: string;
  /** Language of the paper's metadata. Default "en". */
  paperLang?: string;
  authors?: string; journal?: string; citation?: string; year?: string | number;
  doi?: string; href?: string; jel?: string[]; openAccess?: boolean;
  facts?: PaperFact[];
}
export declare function PaperCard(props: PaperCardProps): React.ReactElement;

export interface KeyFindingsProps extends Base { title?: string; items: React.ReactNode[] }
export declare function KeyFindings(props: KeyFindingsProps): React.ReactElement;

export interface InsightProps extends Base { label?: string; children: React.ReactNode; by?: string }
export declare function Insight(props: InsightProps): React.ReactElement;

export interface FigureProps extends Base {
  src?: string; alt?: string; children?: React.ReactNode;
  caption?: React.ReactNode; source?: string;
  width?: 'column' | 'wide' | 'full';
}
export declare function Figure(props: FigureProps): React.ReactElement;

export interface LaneRuleProps { className?: string }
export declare function LaneRule(props?: LaneRuleProps): React.ReactElement;

/* ---------------- Data ---------------- */
export interface DeltaProps extends Base {
  /** Signed, formatted: "+0.2 pp", "-8bp" (a leading "-" becomes "−"). */
  value: string;
  direction?: 'up' | 'down' | 'flat';
  /** good/bad/neutral for indicators; rise/fall for market prices (flips inside [data-market="kr"]). */
  tone?: 'good' | 'bad' | 'neutral' | 'rise' | 'fall';
}
export declare function Delta(props: DeltaProps): React.ReactElement;

export interface SparklineProps { data: number[]; width?: number; height?: number; label?: string; className?: string }
export declare function Sparkline(props: SparklineProps): React.ReactElement | null;

export interface StatTileProps extends Base {
  label: string;
  /** Formatted value; compact large numbers ("12.9K", "1.2조"). */
  value: string;
  unit?: string;
  delta?: DeltaProps;
  /** What the delta compares to: "vs Sep", "전월 대비". */
  period?: string;
  trend?: number[]; trendLabel?: string;
  source?: string;
  /** 56px hero figure — one per view. */
  hero?: boolean;
}
export declare function StatTile(props: StatTileProps): React.ReactElement;

export interface LineSeries { id: string; label: string; values: (number | null)[]; color?: SeriesColor; dashed?: boolean }
export interface ChartBand { from: number; to: number; label?: string }
export interface LineChartProps extends Base {
  x: string[];
  series: LineSeries[];
  /** Series ids to hide (driven by Legend onToggle). Colours never re-assign. */
  hidden?: string[];
  height?: number;
  yFormat?: (v: number) => string;
  yTickFormat?: (v: number) => string;
  yMin?: number; yMax?: number; yTickCount?: number;
  /** Shaded index ranges: recessions, forecast horizon. */
  bands?: ChartBand[];
  /** Fill under a single series at opacity-area. */
  area?: boolean;
  /** Direct end-labels (≤ 4 series, auto-off on collision). Default true. */
  endLabels?: boolean;
  labelSpace?: number;
  /** Multiply every size (2 on a 1080px infographic). */
  scale?: number;
  /** The takeaway, for screen readers. */
  ariaLabel: string;
  width?: number;
}
export declare function LineChart(props: LineChartProps): React.ReactElement;

export interface BarDatum { label: string; value: number; color?: SeriesColor }
export interface BarChartProps extends Base {
  data: BarDatum[];
  format?: (v: number) => string;
  color?: SeriesColor;
  /** Label to show in viz-focus; everything else viz-context. */
  highlight?: string;
  /** Positive div-pos-2, negative div-neg-2. */
  diverging?: boolean;
  labelWidth?: number; barThickness?: number; scale?: number;
  ariaLabel: string; width?: number;
}
export declare function BarChart(props: BarChartProps): React.ReactElement;

export interface LegendItem { id?: string; label: string; color?: SeriesColor; type?: 'line' | 'bar' | 'dot'; dashed?: boolean }
export interface LegendProps { items: LegendItem[]; hidden?: string[]; onToggle?: (id: string) => void; label?: string; className?: string }
export declare function Legend(props: LegendProps): React.ReactElement;

export interface TooltipRow { label: string; value: string; color?: SeriesColor; type?: 'line' | 'bar' }
export interface ChartTooltipProps { title?: string; rows: TooltipRow[]; style?: React.CSSProperties; className?: string }
export declare function ChartTooltip(props: ChartTooltipProps): React.ReactElement;

export interface ChartCardProps extends Base {
  /** What is plotted + unit. */
  title: string;
  subtitle?: string;
  /** View settings only (Level/Change). Filters go in the page filter row. */
  controls?: React.ReactNode;
  legend?: React.ReactNode;
  /** Same data as a DataTable — adds the Chart/Table toggle. */
  table?: React.ReactNode;
  children?: React.ReactNode;
  source?: string; updated?: string; footnote?: React.ReactNode;
  onDownload?: () => void;
  state?: 'ready' | 'loading' | 'refetching' | 'empty' | 'error';
  height?: number; emptyTitle?: string; emptyBody?: string; errorTitle?: string; errorMessage?: React.ReactNode;
}
export declare function ChartCard(props: ChartCardProps): React.ReactElement;

export interface DataColumn<R = any> {
  key: string; label: React.ReactNode;
  align?: 'left' | 'right';
  sortable?: boolean;
  /** Decimals for numeric cells (default 2). */
  decimals?: number;
  render?: (value: any, row: R) => React.ReactNode;
  width?: number | string;
}
export interface DataTableProps<R = any> extends Base {
  columns: DataColumn<R>[]; rows: R[];
  caption: string; showCaption?: boolean;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  dense?: boolean;
}
export declare function DataTable<R = any>(props: DataTableProps<R>): React.ReactElement;

/* ---------------- Feedback ---------------- */
export interface NoticeProps extends Base { tone?: 'info' | 'good' | 'warning' | 'critical'; title?: string; children?: React.ReactNode; action?: React.ReactNode }
export declare function Notice(props: NoticeProps): React.ReactElement;

export interface SkeletonProps extends Base { variant?: 'text' | 'tile' | 'chart'; lines?: number; height?: number }
export declare function Skeleton(props: SkeletonProps): React.ReactElement;

export interface EmptyStateProps extends Base { title?: string; body?: string; action?: React.ReactNode }
export declare function EmptyState(props: EmptyStateProps): React.ReactElement;

/* ---------------- Infographics ---------------- */
export interface InfographicFrameProps extends Base {
  format?: 'square' | 'portrait' | 'story' | 'og';
  theme?: 'concrete' | 'deep';
  kicker?: string; title: string; subtitle?: string;
  /** One big number (<p className="sn-info__number">) and/or one chart with scale={2}. */
  children?: React.ReactNode;
  source?: string; name?: string;
  /** Issue tag, bottom-right: "Issue 014" / "제14호". */
  tag?: string;
}
export declare function InfographicFrame(props: InfographicFrameProps): React.ReactElement;

/* ---------------- Live ---------------- */
export interface TickerItem { label: string; /** Formatted value: "03:12", "1,284", "+0.4". */ value: string; unit?: string; delta?: DeltaProps }
export interface TickerProps extends Base {
  /** Short live label on the yellow plate. Default "Live" / "실시간". */
  title?: string;
  items: TickerItem[];
  /** Seconds for one full loop. Default max(24, items × 6). */
  duration?: number;
  /** No scrolling: one row that the reader scrolls by hand. */
  static?: boolean;
  /** "kr" flips rise/fall colours to Korean practice (rise red, fall blue). */
  market?: 'kr';
  label?: string;
}
export declare function Ticker(props: TickerProps): React.ReactElement;

/* ---------------- Utilities ---------------- */
export declare const strings: Record<Lang, Record<string, string | ((n: string) => string)>>;
export declare const format: {
  /** Intl number with typographic minus. `compact` gives "12.9K" (en) / "1.2만", "3.4억", "1.2조" (ko). */
  number(v: number, o?: { lang?: Lang; decimals?: number; compact?: boolean; signed?: boolean; unit?: string }): string;
  /** byline "14 Oct 2026" / "2026년 10월 14일"; feed "14 Oct" / "10월 14일"; month "Oct 2026" / "2026년 10월". */
  date(d: Date | string, o?: { lang?: Lang; style?: 'byline' | 'feed' | 'month' }): string;
  minus(s: string): string;
};

declare global {
  interface Window {
    Sinho: {
      Masthead: typeof Masthead; LanguageSwitch: typeof LanguageSwitch; Tabs: typeof Tabs; Footer: typeof Footer;
      Button: typeof Button; SubscribeBox: typeof SubscribeBox; TextField: typeof TextField; Select: typeof Select;
      SegmentedControl: typeof SegmentedControl; Switch: typeof Switch; Checkbox: typeof Checkbox;
      Tag: typeof Tag; StoryCard: typeof StoryCard; IssueHero: typeof IssueHero; ArticleHeader: typeof ArticleHeader;
      Figure: typeof Figure; LaneRule: typeof LaneRule; Insight: typeof Insight; PaperCard: typeof PaperCard; KeyFindings: typeof KeyFindings;
      StatTile: typeof StatTile; Delta: typeof Delta; Sparkline: typeof Sparkline; LineChart: typeof LineChart; BarChart: typeof BarChart;
      Legend: typeof Legend; ChartTooltip: typeof ChartTooltip; ChartCard: typeof ChartCard; DataTable: typeof DataTable;
      Notice: typeof Notice; Skeleton: typeof Skeleton; EmptyState: typeof EmptyState; InfographicFrame: typeof InfographicFrame; Ticker: typeof Ticker;
      strings: typeof strings; format: typeof format;
    };
  }
}
