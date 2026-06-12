const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function fetcher<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  open: number;
  high: number;
  low: number;
  prev_close: number;
  change: number;
  change_pct: number;
  volume: number;
  bid: number;
  ask: number;
  time: string;
}

export interface KlineBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

export interface KlineResponse {
  symbol: string;
  period: string;
  count: number;
  data: KlineBar[];
}

export interface StockItem {
  symbol:    string;
  name:      string;
  market?:   "TW" | "US";
  exchange?: string;  // "NASDAQ" | "NYSE" | undefined
}

export interface SearchResponse {
  query: string;
  count: number;
  data: StockItem[];
}

export function getQuote(symbol: string) {
  return fetcher<Quote>(`/api/v1/quotes/${symbol}`);
}

export function getQuotesBatch(symbols: string[]) {
  return fetcher<Record<string, Quote>>(
    `/api/v1/quotes?symbols=${symbols.join(",")}`
  );
}

export function getKline(symbol: string, period = "daily") {
  return fetcher<KlineResponse>(`/api/v1/kline/${symbol}?period=${period}`);
}

/** 美股日K（yfinance，TTL 1h 後端快取） */
export function getUsKline(symbol: string, period = "daily") {
  return fetcher<KlineResponse>(`/api/v1/kline/us/${symbol}?period=${period}`);
}

// ── Intraday K-line (分K) ───────────────────────────────────────────────────
export interface IntradayBar {
  time:   number;  // Unix timestamp (秒)
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

export interface IntradayResponse {
  symbol: string;
  period: string;
  date:   string;
  count:  number;
  data:   IntradayBar[];
}

export type IntradayPeriod = "1m" | "5m" | "15m" | "30m" | "60m";
export const INTRADAY_PERIODS: IntradayPeriod[] = ["1m", "5m", "15m", "30m", "60m"];

export function getIntradayKline(
  symbol: string,
  period: IntradayPeriod = "5m",
  date?: string,
) {
  const qs = date ? `&date=${date}` : "";
  return fetcher<IntradayResponse>(
    `/api/v1/kline/${symbol}/intraday?period=${period}${qs}`,
  );
}

export function searchStocks(query: string) {
  return fetcher<SearchResponse>(
    `/api/v1/market/search?q=${encodeURIComponent(query)}`
  );
}

export interface ChipsBar {
  date: string;
  foreign_buy: number;
  foreign_sell: number;
  foreign_net: number;
  trust_buy: number;
  trust_sell: number;
  trust_net: number;
  dealer_buy: number;
  dealer_sell: number;
  dealer_net: number;
  total_net: number;
}

export interface ChipsCumulative {
  foreign: number;
  trust: number;
  dealer: number;
  total: number;
}

export interface ChipsStreak {
  days: number;
  direction: "buy" | "sell" | "flat";
}

export interface ChipsStreakMap {
  foreign: ChipsStreak;
  trust:   ChipsStreak;
  dealer:  ChipsStreak;
}

export interface ChipsCumulativePoint {
  date:    string;
  foreign: number;
  trust:   number;
  dealer:  number;
  total:   number;
}

export interface ChipsScoreItem {
  score: number;
  max:   number;
  label: string;
  value: string;
  na?:   boolean;
}

export interface ChipsScore {
  total: number;
  items: Record<string, ChipsScoreItem>;
}

export interface ChipsResponse {
  symbol:            string;
  days:              number;
  data:              ChipsBar[];
  cumulative:        ChipsCumulative;
  cumulative_series: ChipsCumulativePoint[];
  streak:            ChipsStreakMap;
  score:             ChipsScore;
}

export function getChips(symbol: string, days = 60) {
  return fetcher<ChipsResponse>(`/api/v1/chips/${symbol}?days=${days}`);
}

// ── Broker chips (分點) ───────────────────────────────────────────────────────

export interface BrokerEntry {
  broker_id:     string;
  broker_name:   string;
  buy:           number;
  sell:          number;
  net:           number;
  type:          "foreign" | "trust" | "daytrade" | "general";
  daytrade_rate: number;
  pattern?:      "known" | "detected";
}

export interface BrokerChipsResponse {
  symbol:   string;
  days:     number;
  general:  { top_buy: BrokerEntry[]; top_sell: BrokerEntry[] };
  foreign:  { top_buy: BrokerEntry[]; top_sell: BrokerEntry[] };
  trust:    { top_buy: BrokerEntry[]; top_sell: BrokerEntry[] };
  daytrade: BrokerEntry[];
}

export function getBrokerChips(symbol: string, days: 5 | 10 | 20 = 5) {
  return fetcher<BrokerChipsResponse>(`/api/v1/chips/${symbol}/brokers?days=${days}`);
}

// ── Margin (融資融券) ──────────────────────────────────────────
export interface MarginBar {
  date:           string;
  margin_balance: number;
  margin_change:  number;
  short_balance:  number;
  short_change:   number;
  ratio:          number | null;
}

export interface MarginResponse {
  symbol: string;
  days:   number;
  data:   MarginBar[];
  latest: MarginBar | null;
}

export function getMargin(symbol: string, days = 60) {
  return fetcher<MarginResponse>(`/api/v1/margin/${symbol}?days=${days}`);
}

// ── Market chips summary (市場整體法人動向) ─────────────────────────────────
export interface MarketChipsMover {
  symbol: string;
  name:   string;
  net:    number;
}

export interface MarketChipsGroup {
  buyers:  MarketChipsMover[];
  sellers: MarketChipsMover[];
}

export interface MarketChipsSummary {
  date:    string;
  total:   { foreign: number; trust: number; dealer: number };
  foreign: MarketChipsGroup;
  trust:   MarketChipsGroup;
  dealer:  MarketChipsGroup;
}

export function getMarketChipsSummary(dateStr?: string) {
  const qs = dateStr ? `?date=${dateStr}` : "";
  return fetcher<MarketChipsSummary>(`/api/v1/market/chips/summary${qs}`);
}

// ── Watchlist ──────────────────────────────────────────────────────────────
export interface WatchlistItem {
  id:                 string;
  symbol:             string;
  note:               string;
  tags:               string[];
  sort_order:         number;
  price_alert_above:  number | null;
  price_alert_below:  number | null;
}

export interface WatchlistGroup {
  id:         string;
  name:       string;
  sort_order: number;
}

export interface WatchlistState {
  groups: WatchlistGroup[];
  items:  Record<string, WatchlistItem[]>;
}

/** 從 localStorage 取得或產生持久化的 user UUID */
export function getUserId(): string {
  if (typeof window === "undefined") return "ssr-placeholder";
  let uid = localStorage.getItem("stockpulse_user_id");
  if (!uid) {
    uid = crypto.randomUUID();
    localStorage.setItem("stockpulse_user_id", uid);
  }
  return uid;
}

function watchlistFetcher<T>(path: string, init?: RequestInit): Promise<T> {
  const uid = getUserId();
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-User-ID": uid,
      ...(init?.headers ?? {}),
    },
  }).then(async (res) => {
    if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
    if (res.status === 204) return undefined as T;
    return res.json() as T;
  });
}

export const watchlistApi = {
  get: () =>
    watchlistFetcher<WatchlistState>("/api/v1/watchlist"),

  sync: (state: WatchlistState) =>
    watchlistFetcher<WatchlistState>("/api/v1/watchlist/sync", {
      method: "POST",
      body: JSON.stringify(state),
    }),

  createGroup: (name: string) =>
    watchlistFetcher<WatchlistGroup>("/api/v1/watchlist/groups", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  updateGroup: (gid: string, patch: Partial<Pick<WatchlistGroup, "name" | "sort_order">>) =>
    watchlistFetcher<WatchlistGroup>(`/api/v1/watchlist/groups/${gid}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  deleteGroup: (gid: string) =>
    watchlistFetcher<void>(`/api/v1/watchlist/groups/${gid}`, { method: "DELETE" }),

  addItem: (gid: string, symbol: string) =>
    watchlistFetcher<WatchlistItem>(`/api/v1/watchlist/groups/${gid}/items`, {
      method: "POST",
      body: JSON.stringify({ symbol }),
    }),

  removeItem: (iid: string) =>
    watchlistFetcher<void>(`/api/v1/watchlist/items/${iid}`, { method: "DELETE" }),

  updateItem: (iid: string, patch: Partial<Omit<WatchlistItem, "id" | "symbol">>) =>
    watchlistFetcher<WatchlistItem>(`/api/v1/watchlist/items/${iid}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
};

// ── Screener (選股器) ──────────────────────────────────────────────────────
export interface ScreenerTemplate {
  id:    string;
  name:  string;
  icon:  string;
  desc:  string;
  tags:  string[];
  color: string;
}

export interface ChipStreak {
  days:      number;
  direction: "buy" | "sell" | "flat";
}

export interface ScreenerResult {
  symbol:            string;
  name:              string;
  price:             number;
  change_pct:        number;
  rsi14:             number;
  ma20:              number;
  ma5:               number;
  vol_ratio:         number;
  above_ma20:        boolean;
  ma20_breakout:     boolean;
  near_high20:       boolean;
  near_low20:        boolean;
  foreign_streak:    ChipStreak;
  trust_streak:      ChipStreak;
  dealer_streak:     ChipStreak;
  foreign_net_today: number;
  trust_net_today:   number;
  score:             number;
  // 基本面欄位（可能為 null，首次快取未就緒時）
  pe?:             number | null;
  dividend_yield?: number | null;
  gross_margin?:   number | null;
  market_cap_b?:   number | null;
  roe?:            number | null;
  eps_growth?:     number | null;
  revenue_growth?: number | null;
}

export interface FundFilters {
  pe_min?:             number;
  pe_max?:             number;
  yield_min?:          number;
  yield_max?:          number;
  gross_margin_min?:   number;
  market_cap_min_b?:   number;
  market_cap_max_b?:   number;
  roe_min?:            number;
  eps_growth_min?:     number;
  revenue_growth_min?: number;
}

export interface ScreenerResponse {
  template:   ScreenerTemplate | null;
  conditions: Record<string, unknown>;
  total:      number;
  results:    ScreenerResult[];
  cache_time: string | null;
  nl_matched: string | null;
}

export function getScreenerTemplates() {
  return fetcher<{ templates: ScreenerTemplate[] }>("/api/v1/screener/templates");
}

export async function runScreener(
  templateId?: string,
  nlQuery?: string,
  limit = 50,
  fundFilters?: FundFilters,
): Promise<ScreenerResponse> {
  const res = await fetch(`${API_BASE}/api/v1/screener/run`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      template_id:        templateId ?? null,
      nl_query:           nlQuery    ?? null,
      limit,
      // 基本面篩選（undefined 不傳，後端 Optional 會是 None）
      ...fundFilters,
    }),
  });
  if (!res.ok) throw new Error(`Screener API ${res.status}`);
  return res.json();
}

// ── Market Indices (大盤指數) ────────────────────────────────────────────────
export interface IndexQuote {
  id:         string;
  name:       string;
  flag:       string;
  ticker:     string;
  price:      number | null;
  change:     number | null;
  change_pct: number | null;
}

export interface MarketIndicesResponse {
  indices: IndexQuote[];
}

export function getMarketIndices() {
  return fetcher<MarketIndicesResponse>("/api/v1/market/indices");
}

// ── Market Breadth (市場廣度) ────────────────────────────────────────────────
export interface MarketBreadth {
  advances:   number;
  declines:   number;
  unchanged:  number;
  limit_up:   number;
  limit_down: number;
  total:      number;
  date:       string;
  source?:    string; // "screener_approx" when fallback
}

export function getMarketBreadth() {
  return fetcher<MarketBreadth>("/api/v1/market/breadth");
}

// ── Sector Heatmap (產業板塊) ────────────────────────────────────────────────
export interface SectorStock {
  symbol:     string;
  name:       string;
  change_pct: number;
  price:      number;
  vol_ratio:  number;
}

export interface SectorData {
  name:       string;
  avg_change: number;
  advances:   number;
  declines:   number;
  unchanged:  number;
  total:      number;
  stocks:     SectorStock[];
}

export interface SectorHeatmapResponse {
  sectors: SectorData[];
}

export function getSectorHeatmap() {
  return fetcher<SectorHeatmapResponse>("/api/v1/market/sectors");
}

// ── US Quote (美股報價) ──────────────────────────────────────────────────────
export interface USQuote {
  symbol:     string;
  price:      number;
  change:     number;
  change_pct: number;
  prev_close: number;
  currency?:  string;
  market_cap?: number | null;
  volume?:    number | null;
}

export function getUSQuote(symbol: string) {
  return fetcher<USQuote>(`/api/v1/quotes/us/${encodeURIComponent(symbol)}`);
}

// ── Market Ranking (熱門排行) ────────────────────────────────────────────────
export interface RankingStock {
  symbol:     string;
  name:       string;
  price:      number;
  change:     number;
  change_pct: number;
  volume:     number;
  vol_ratio:  number;
}

export interface MarketRankingResponse {
  gainers:    RankingStock[];
  losers:     RankingStock[];
  volume:     RankingStock[];
  updated_at: string;
}

export function getMarketRanking() {
  return fetcher<MarketRankingResponse>("/api/v1/market/ranking");
}

// ── Stock News (個股新聞) ────────────────────────────────────────────────────
export interface NewsItem {
  title:        string;
  publisher:    string;
  link:         string;
  published_at: number;   // Unix timestamp（秒）
  thumbnail:    string | null;
  type:         string;
  importance:   "高" | "中" | "低";  // 後端重要度評分
  is_chinese:   boolean;              // 標題含中文
}

export interface StockNewsResponse {
  symbol: string;
  count:  number;
  news:   NewsItem[];
}

export function getStockNews(symbol: string) {
  return fetcher<StockNewsResponse>(`/api/v1/news/${encodeURIComponent(symbol)}`);
}

// ── Ownership (TDCC 股權分散) ────────────────────────────────────────────────
export interface OwnershipPoint {
  week_date:         string;
  retail_pct:        number | null;
  major_pct:         number | null;
  shareholder_count: number | null;
  major_count:       number | null;
}

export interface OwnershipResponse {
  symbol:  string;
  weeks:   number;
  latest:  OwnershipPoint;
  history: OwnershipPoint[];
}

export function getOwnership(symbol: string, weeks: number = 12) {
  return fetcher<OwnershipResponse>(`/api/v1/ownership/${encodeURIComponent(symbol)}?weeks=${weeks}`);
}

// ── Monthly Revenue (MOPS 月營收) ────────────────────────────────────────────
export interface RevenueRow {
  year:    number;
  month:   number;
  revenue: number;
  yoy_pct: number | null;
  mom_pct: number | null;
}

export interface RevenueResponse {
  symbol: string;
  count:  number;
  data:   RevenueRow[];
  status?: string;
}

export function getRevenue(symbol: string, months: number = 24) {
  return fetcher<RevenueResponse>(`/api/v1/revenue/${encodeURIComponent(symbol)}?months=${months}`);
}

// ── Price Alert Notifications ────────────────────────────────────────────────
export interface AlertNotification {
  id:         string;
  symbol:     string;
  alert_type: "above" | "below";
  threshold:  number;
  price:      number;
  created_at: string;
}

export interface AlertsResponse {
  notifications: AlertNotification[];
}

function alertsFetcher<T>(path: string, init?: RequestInit): Promise<T> {
  const uid = getUserId();
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-User-ID": uid,
      ...(init?.headers ?? {}),
    },
  }).then(async (res) => {
    if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
    if (res.status === 204) return undefined as T;
    return res.json() as T;
  });
}

// ── Fundamental Data（個股基本面）────────────────────────────────────────────
export interface FundamentalData {
  symbol:         string;
  name:           string | null;
  currency:       string;
  market_cap:     number | null;
  market_cap_fmt: string | null;
  // 估值
  pe_trailing:    number | null;
  pe_forward:     number | null;
  pb_ratio:       number | null;
  ps_ratio:       number | null;
  peg_ratio:      number | null;
  ev_ebitda:      number | null;
  // EPS
  eps_trailing:   number | null;
  eps_forward:    number | null;
  // 股利
  dividend_yield: number | null;
  dividend_rate:  number | null;
  payout_ratio:   number | null;
  // 盈利能力
  roe:            number | null;
  roa:            number | null;
  gross_margin:   number | null;
  operating_margin: number | null;
  profit_margin:  number | null;
  // 財務健康
  debt_to_equity: number | null;
  current_ratio:  number | null;
  quick_ratio:    number | null;
  // 成長
  revenue_growth:  number | null;
  earnings_growth: number | null;
  // 分析師
  analyst_target:          number | null;
  analyst_target_upside:   number | null;
  analyst_recommendation:  string | null;
  analyst_count:           number | null;
  // 其他
  week52_high:    number | null;
  week52_low:     number | null;
  beta:           number | null;
  avg_volume:     number | null;
  shares_outstanding: number | null;
  sector:         string | null;
  industry:       string | null;
  employees:      number | null;
  website:        string | null;
}

export function getFundamental(symbol: string) {
  return fetcher<FundamentalData>(`/api/v1/fundamental/${encodeURIComponent(symbol)}`);
}

// ── Technical Summary ─────────────────────────────────────────────────────────
export interface TechnicalSummary {
  price: number;
  rsi:   { value: number | null; signal: string | null };
  macd:  { macd: number | null; signal_line: number | null; histogram: number | null; signal: string | null };
  kd:    { k: number | null; d: number | null; signal: string | null };
  ma:    { ma5: number | null; ma10: number | null; ma20: number | null; ma60: number | null; ma120: number | null; ma240: number | null; alignment: string; above_count: number; below_count: number };
  bollinger: { upper: number | null; lower: number | null; mid: number | null; pct_b: number | null };
  volume: { today: number; avg20: number; ratio: number; signal: string };
  week52: { high: number; low: number; position: number };
  performance: { "1w": number | null; "1m": number | null; "3m": number | null; "6m": number | null; "1y": number | null };
  support_resistance: { support: number; resistance: number; support_levels: number[]; resistance_levels: number[] };
}

export function getTechnical(symbol: string) {
  return fetcher<TechnicalSummary>(`/api/v1/technical/${encodeURIComponent(symbol)}`);
}

// ── Financials ────────────────────────────────────────────────────────────────
export interface AnnualFinancial {
  year:              number;
  revenue:           number | null;
  net_income:        number | null;
  gross_profit:      number | null;
  operating_income:  number | null;
  eps:               number | null;
  gross_margin:      number | null;
  net_margin:        number | null;
  operating_margin:  number | null;
  operating_cf:      number | null;
  capex:             number | null;
  free_cf:           number | null;
}

export interface QuarterlyEps {
  year:       number;
  month:      number;
  eps:        number | null;
  net_income: number | null;
}

export interface FinancialsData {
  symbol:        string;
  currency:      string;
  unit:          string;
  divisor:       number;
  annual:        AnnualFinancial[];
  quarterly_eps: QuarterlyEps[];
}

export function getFinancials(symbol: string) {
  return fetcher<FinancialsData>(`/api/v1/financials/${encodeURIComponent(symbol)}`);
}

// ── Backtest ──────────────────────────────────────────────────────────────────

export interface BacktestStrategyConfig {
  type: string;
  fast?:               number;
  slow?:               number;
  signal?:             number;
  period?:             number;
  oversold?:           number;
  overbought?:         number;
  k_period?:           number;
  d_period?:           number;
  buy_zone?:           number;
  sell_zone?:          number;
  std?:                number;
  logic?:              "AND" | "OR";   // shared logic（向後相容；entry/exit_logic 優先）
  entry_logic?:        "AND" | "OR";   // P0-3
  exit_logic?:         "AND" | "OR";   // P0-3
  entry_conditions?:   Array<{ field: string; op: string; value: string | number }>;
  exit_conditions?:    Array<{ field: string; op: string; value: string | number }>;
  // P2-8: DSL strategy
  entry_dsl?:          string;
  exit_dsl?:           string;
}

export interface DSLValidateResult {
  ok:    boolean;
  error: string | null;
}

export async function validateDSL(dsl: string): Promise<DSLValidateResult> {
  const res = await fetch(`${API_BASE}/api/v1/backtest/dsl/validate`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ dsl }),
  });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  return res.json();
}

export interface BacktestRequest {
  symbol:           string;
  strategy:         BacktestStrategyConfig;
  start_date:       string;   // YYYY-MM-DD
  end_date:         string;
  initial_capital?: number;
  stop_loss_pct?:   number | null;
  take_profit_pct?: number | null;
  slippage_pct?:      number;         // P9-29 滑價（預設 0.001 = 0.1%）
  trailing_stop_pct?: number | null;  // P10-32 移動停損
  max_hold_days?:     number | null;  // P10-33 時間停損
}

export interface BacktestStats {
  total_return:   number;
  cagr:           number;
  sharpe:         number;
  sortino:        number;
  calmar:         number;
  max_drawdown:   number;
  max_dd_days:    number;
  win_rate:       number;
  profit_factor:  number;
  avg_hold_days:  number;
  total_trades:   number;
  best_trade:     number;
  worst_trade:    number;
  benchmark_cagr: number;
  alpha:          number;
  final_equity:   number;
}

export interface BacktestEquityPoint {
  time:     string;
  value:    number;
  drawdown: number;
}

export interface BacktestBenchmarkPoint {
  time:  string;
  value: number;
}

export type BacktestExitReason =
  | "signal" | "stop_loss" | "take_profit" | "end_of_period"
  | "stop_loss_gap" | "trailing_stop" | "trailing_stop_gap" | "time_stop";  // 引擎 v2

export interface BacktestTrade {
  entry_date:  string;
  exit_date:   string;
  entry_price: number;
  exit_price:  number;
  shares:      number;
  pnl:         number;
  pnl_pct:     number;
  hold_days:   number;
  side:        "long" | "short";
  fee?:        number;              // 手續費總額（買入 + 賣出 + 證交稅，元）
  exit_reason?: BacktestExitReason; // signal / stop_loss / take_profit / end_of_period
}

export interface BacktestMonthlyReturn {
  year:       number;
  month:      number;
  return_pct: number;
}

export interface BacktestRegimeStat {
  trade_count: number;
  win_rate:    number | null;
  total_pnl:   number;
  avg_pnl_pct: number | null;
}

export interface BacktestResult {
  stats:           BacktestStats;
  equity_curve:    BacktestEquityPoint[];
  benchmark_curve: BacktestBenchmarkPoint[];
  trades:          BacktestTrade[];
  monthly_returns: BacktestMonthlyReturn[];
  regime_stats?:   { bull: BacktestRegimeStat | null; bear: BacktestRegimeStat | null; sideways: BacktestRegimeStat | null };
  engine_version?: number;   // P9-31：成交模型版本（v2 = 隔日開盤 + 盤中觸發）
}

export interface BacktestPresetParam {
  key:     string;
  label:   string;
  type:    "int" | "float";
  default: number;
  min:     number;
  max:     number;
}

export interface BacktestPreset {
  id:      string;
  name:    string;
  desc:    string;
  icon:    string;
  params:  BacktestPresetParam[];
  default: BacktestStrategyConfig;
}

export async function runBacktest(req: BacktestRequest): Promise<BacktestResult> {
  const res = await fetch(`${API_BASE}/api/v1/backtest/run`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err?.detail ?? `API ${res.status}`);
  }
  return res.json();
}

export function getBacktestPresets(): Promise<{ presets: BacktestPreset[] }> {
  return fetcher<{ presets: BacktestPreset[] }>("/api/v1/backtest/presets");
}

// ── P0-4: 我的策略書（儲存、列表、刪除）──────────────────────────────────────

export interface SavedStrategy {
  id:              string;
  user_id:         string;
  name:            string;
  note:            string;
  strategy_json:   BacktestStrategyConfig;
  symbol:          string;
  start_date:      string;
  end_date:        string;
  initial_capital: number;
  stop_loss_pct:   number | null;
  take_profit_pct: number | null;
  created_at:      string;
}

export interface SaveStrategyRequest {
  name:            string;
  note?:           string;
  strategy:        BacktestStrategyConfig;
  symbol:          string;
  start_date:      string;
  end_date:        string;
  initial_capital: number;
  stop_loss_pct?:  number;
  take_profit_pct?: number;
}

export async function listSavedStrategies(): Promise<{ strategies: SavedStrategy[] }> {
  const res = await fetch(`${API_BASE}/api/v1/backtest/strategies`, {
    headers: { "X-User-ID": getUserId() },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function saveStrategy(req: SaveStrategyRequest): Promise<SavedStrategy> {
  const res = await fetch(`${API_BASE}/api/v1/backtest/strategies`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "X-User-ID": getUserId() },
    body:    JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err?.detail ?? `API ${res.status}`);
  }
  return res.json();
}

export async function deleteSavedStrategy(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/backtest/strategies/${id}`, {
    method:  "DELETE",
    headers: { "X-User-ID": getUserId() },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
}

// ── Foreign Holding（外資持股比例）──────────────────────────────────────────
export interface ForeignHoldingItem {
  year:        number;
  month:       number;
  date:        string;   // YYYY-MM
  holding_pct: number;   // 0–100 (%)
  price:       number | null;
}

export interface ForeignHoldingResponse {
  symbol:      string;
  is_tw:       boolean;
  data:        ForeignHoldingItem[];
  latest_pct:  number | null;
  change_1y:   number | null;   // percentage-point change vs 12M ago
  max_pct:     number | null;
  min_pct:     number | null;
  message:     string | null;
}

export function getForeignHolding(symbol: string) {
  return fetcher<ForeignHoldingResponse>(`/api/v1/foreign-holding/${encodeURIComponent(symbol)}`);
}

// ── Peer Comparison（同業比較表）────────────────────────────────────────────
export interface PeerRow {
  symbol:          string;
  yf_symbol:       string;
  name:            string;
  price:           number | null;
  change_1y_pct:   number | null;
  market_cap:      number | null;
  market_cap_fmt:  string | null;
  pe_trailing:     number | null;
  pb_ratio:        number | null;
  roe:             number | null;
  gross_margin:    number | null;
  profit_margin:   number | null;
  revenue_growth:  number | null;
  dividend_yield:  number | null;
  sector:          string | null;
  industry:        string | null;
  error?:          string;
}

export interface PeerComparisonResponse {
  symbol:    string;
  target_yf: string;
  custom:    boolean;
  rows:      PeerRow[];
}

export function getPeerComparison(symbol: string, peers?: string) {
  const qs = peers ? `?peers=${encodeURIComponent(peers)}` : "";
  return fetcher<PeerComparisonResponse>(`/api/v1/peer-comparison/${encodeURIComponent(symbol)}${qs}`);
}

// ── Valuation Band（PE / PB 歷史估值帶）────────────────────────────────────
export interface ValuationBandPoint {
  time:  string;   // YYYY-MM-DD (weekly)
  value: number;
}

export interface ValuationBandStats {
  current:         number;
  mean:            number;
  std:             number;
  band_1std_low:   number;
  band_1std_high:  number;
  band_2std_low:   number;
  band_2std_high:  number;
  percentile:      number;   // 0–100: where current sits in 5-year range
  history:         ValuationBandPoint[];
}

export interface ValuationBandResponse {
  symbol: string;
  pe:     ValuationBandStats | null;
  pb:     ValuationBandStats | null;
}

export function getValuationBand(symbol: string) {
  return fetcher<ValuationBandResponse>(`/api/v1/valuation-band/${encodeURIComponent(symbol)}`);
}

// ── Monthly Revenue（月營收）────────────────────────────────────────────────
export interface MonthlyRevenueItem {
  year:                   number;
  month:                  number;
  revenue:                number | null;   // 千元
  last_year_revenue:      number | null;
  yoy_pct:                number | null;   // % (e.g., 8.5 means +8.5%)
  cumulative:             number | null;
  last_year_cumulative:   number | null;
  cumulative_yoy_pct:     number | null;
}

export interface MonthlyRevenueResponse {
  symbol:   string;
  is_tw:    boolean;
  data:     MonthlyRevenueItem[];
  unit:     string;
  message?: string;
}

export function getMonthlyRevenue(symbol: string) {
  return fetcher<MonthlyRevenueResponse>(`/api/v1/monthly-revenue/${encodeURIComponent(symbol)}`);
}

// ── Dividend History（股利歷史）──────────────────────────────────────────────
export interface DividendAnnual {
  year:           number;
  total_dividend: number | null;
  yield_pct:      number | null;
  payments:       number;
  dates:          string[];
}

export interface DividendHistoryResponse {
  symbol:            string;
  is_tw:             boolean;
  currency:          string;
  annual:            DividendAnnual[];
  consecutive_years: number;
  latest_yield:      number | null;
  next_ex_date:      string | null;
  next_dividend:     number | null;
}

export function getDividendHistory(symbol: string) {
  return fetcher<DividendHistoryResponse>(`/api/v1/dividends/${encodeURIComponent(symbol)}`);
}

// ── Volume Profile（價位成交量分佈）────────────────────────────────────────────
export interface VolumeProfileBin {
  price:      number;
  price_low:  number;
  price_high: number;
  volume:     number;
  volume_pct: number;   // 0–1 relative to max bin
  is_poc:     boolean;
  in_va:      boolean;  // in Value Area (70%)
}

export interface VolumeProfileResponse {
  symbol:        string;
  period:        string;
  current_price: number;
  poc:           number;   // Point of Control price
  vah:           number;   // Value Area High
  val:           number;   // Value Area Low
  total_volume:  number;
  n_bars:        number;
  price_min:     number;
  price_max:     number;
  bins:          VolumeProfileBin[];
}

export function getVolumeProfile(symbol: string, period = "3m") {
  return fetcher<VolumeProfileResponse>(
    `/api/v1/volume-profile/${encodeURIComponent(symbol)}?period=${period}`
  );
}

// ── Financial Alerts（財報異常警示）─────────────────────────────────────────
export interface FinancialAlertDataPoint {
  year:  number;
  value?: number | null;
  [key: string]: unknown;
}

export interface FinancialAlert {
  id:       string;
  severity: "warning" | "danger";
  title:    string;
  detail:   string;
  data:     FinancialAlertDataPoint[];
  unit:     string;
  label:    string;
}

export interface FinancialAlertsResponse {
  symbol:       string;
  alerts:       FinancialAlert[];
  alert_count:  number;
  has_danger:   boolean;
  has_warning:  boolean;
  data_summary: Record<string, unknown>;
  note:         string;
}

export function getFinancialAlerts(symbol: string) {
  return fetcher<FinancialAlertsResponse>(
    `/api/v1/financial-alerts/${encodeURIComponent(symbol)}`
  );
}

// ── AI Analysis（AI 技術分析解讀）────────────────────────────────────────────
export interface AiAnalysisMeta {
  price:      number;
  change_pct: number;
  rsi14:      number | null;
  macd:       string;
  ma_above:   string[];
  vol_ratio:  number;
  chips:      string;
}

export interface AiAnalysisResponse {
  symbol:   string;
  analysis: string;
  meta:     AiAnalysisMeta;
}

export function getAiAnalysis(symbol: string) {
  return fetcher<AiAnalysisResponse>(`/api/v1/ai-analysis/${encodeURIComponent(symbol)}`);
}

// ── Compare（多股比較走勢）───────────────────────────────────────────────────
export interface ComparePoint {
  time:  string;   // YYYY-MM-DD
  value: number;   // normalized to 100
}

export interface CompareResponse {
  symbols: string[];
  names:   Record<string, string>;
  period:  string;
  series:  Record<string, ComparePoint[]>;
}

export function getCompare(symbols: string[], period = "1y") {
  const s = symbols.map(encodeURIComponent).join(",");
  return fetcher<CompareResponse>(`/api/v1/compare?symbols=${s}&period=${period}`);
}

// ── Earnings Surprise（盈餘驚喜）────────────────────────────────────────────
export interface EarningsSurpriseItem {
  date:         string;
  eps_estimate: number | null;
  eps_actual:   number | null;
  surprise_pct: number | null;
}

export interface EarningsAnnual {
  year:       number;
  revenue:    number | null;
  net_income: number | null;
}

export interface EarningsResponse {
  symbol:             string;
  currency:           string;
  quarterly_surprise: EarningsSurpriseItem[];
  annual_earnings:    EarningsAnnual[];
  has_estimates:      boolean;
  message:            string | null;
}

export function getEarnings(symbol: string) {
  return fetcher<EarningsResponse>(`/api/v1/earnings/${encodeURIComponent(symbol)}`);
}

export const alertsApi = {
  getUnread: () =>
    alertsFetcher<AlertsResponse>("/api/v1/alerts"),

  markRead: (id: string) =>
    alertsFetcher<void>(`/api/v1/alerts/${id}/read`, { method: "POST" }),

  markAllRead: () =>
    alertsFetcher<void>("/api/v1/alerts/read-all", { method: "POST" }),

  delete: (id: string) =>
    alertsFetcher<void>(`/api/v1/alerts/${id}`, { method: "DELETE" }),
};

// ── Dashboard Summary（個人化首頁摘要）────────────────────────────────────────

export type SignalSeverity = "positive" | "warning" | "info" | "custom";
export type SignalGroup    = "chips" | "technical" | "calendar" | "custom";

export interface DashboardSignal {
  id:       string;
  label:    string;
  severity: SignalSeverity;
  group:    SignalGroup;
  date?:    string;
}

export interface DashboardUpcomingDate {
  type:       "exdiv" | "earnings";
  label:      string;
  date:       string;   // YYYY-MM-DD
  days_until: number;
  value?:     number;   // dividend amount (exdiv only)
}

export interface DashboardQuote {
  price:      number;
  change_pct: number;
  vol_ratio:  number;
  rsi14:      number;
  name:       string;
}

export interface DashboardSymbolData {
  symbol:         string;
  quote:          DashboardQuote;
  signals:        DashboardSignal[];
  signal_count:   number;
  upcoming_dates: DashboardUpcomingDate[];
  has_alert:      boolean;
}

export interface DashboardSummaryResponse {
  symbols:    string[];
  data:       Record<string, DashboardSymbolData>;
  updated_at: number;
}

export function getDashboardSummary(
  symbols: string[],
  userId?: string | null
): Promise<DashboardSummaryResponse> {
  const s = symbols.map(encodeURIComponent).join(",");
  const uid = userId ?? getUserId();
  return fetch(`${API_BASE}/api/v1/dashboard/summary?symbols=${s}`, {
    headers: { "X-User-ID": uid },
  }).then(async (res) => {
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json() as Promise<DashboardSummaryResponse>;
  });
}

// ── Alert Rules（用戶自訂警示規則）──────────────────────────────────────────────

export type AlertRuleOperator = ">" | "<" | ">=" | "<=" | "=";
export type AlertRuleLogic    = "AND" | "OR";

export interface AlertRuleCondition {
  field:    string;
  operator: AlertRuleOperator;
  value:    number;
}

export interface AlertRule {
  id:         string;
  name:       string;
  conditions: AlertRuleCondition[];
  logic:      AlertRuleLogic;
  is_active:  boolean;
  created_at?: string;
}

export interface AlertRulesResponse {
  rules: AlertRule[];
  count: number;
}

export interface CreateAlertRulePayload {
  name:       string;
  conditions: AlertRuleCondition[];
  logic:      AlertRuleLogic;
  is_active?: boolean;
}

export const ALERT_RULE_FIELDS: { value: string; label: string; unit: string; hint?: string }[] = [
  // ── 基本技術 ──
  { value: "rsi14",               label: "RSI(14)",     unit: "",  hint: "超賣<30 / 超買>70" },
  { value: "vol_ratio",           label: "量比",        unit: "x", hint: "今日量 ÷ 20日均量" },
  { value: "change_pct",          label: "漲跌幅",      unit: "%", hint: "當日漲跌 %" },
  // ── 均線 ──
  { value: "above_ma20",          label: "站上MA20",    unit: "",  hint: "1=是 0=否" },
  { value: "ma20_breakout",       label: "突破MA20",    unit: "",  hint: "今天突破(1) 否(0)" },
  { value: "above_ma5",           label: "站上MA5",     unit: "",  hint: "1=是 0=否" },
  { value: "above_ma60",          label: "站上MA60",    unit: "",  hint: "1=是 0=否" },
  // ── 震盪指標 ──
  { value: "stoch_k",             label: "KD-K值",      unit: "",  hint: "0-100，超賣<20 超買>80" },
  { value: "macd_hist",           label: "MACD柱",      unit: "",  hint: "正=多頭 負=空頭" },
  // ── 籌碼 ──
  { value: "foreign_streak_days", label: "外資連買",    unit: "日", hint: "外資連買天數" },
  { value: "trust_streak_days",   label: "投信連買",    unit: "日", hint: "投信連買天數" },
  { value: "foreign_sell_days",   label: "外資連賣",    unit: "日", hint: "外資連賣天數" },
  { value: "trust_sell_days",     label: "投信連賣",    unit: "日", hint: "投信連賣天數" },
];

export const alertRulesApi = {
  list: () =>
    alertsFetcher<AlertRulesResponse>("/api/v1/alert-rules"),

  create: (payload: CreateAlertRulePayload) =>
    alertsFetcher<AlertRule>("/api/v1/alert-rules", {
      method:  "POST",
      body:    JSON.stringify(payload),
    }),

  update: (id: string, payload: Partial<CreateAlertRulePayload & { is_active: boolean }>) =>
    alertsFetcher<AlertRule>(`/api/v1/alert-rules/${id}`, {
      method:  "PUT",
      body:    JSON.stringify(payload),
    }),

  delete: (id: string) =>
    alertsFetcher<void>(`/api/v1/alert-rules/${id}`, { method: "DELETE" }),

  toggle: (id: string) =>
    alertsFetcher<AlertRule>(`/api/v1/alert-rules/${id}/toggle`, { method: "PATCH" }),
};

// ── Web Push ──────────────────────────────────────────────────────────────────

export interface PushVapidResponse {
  enabled:    boolean;
  public_key: string | null;
}

export interface PushStatusResponse {
  enabled:          boolean;
  subscribed_count: number;
}

export function getPushVapidKey(): Promise<PushVapidResponse> {
  return fetcher<PushVapidResponse>("/api/v1/push/vapid-public-key");
}

export function getPushStatus(userId: string): Promise<PushStatusResponse> {
  return fetch(`${API_BASE}/api/v1/push/status`, {
    headers: { "X-User-ID": userId },
  }).then((r) => r.json());
}

// ── AI 功能（Verdict / Compare Analysis / Watchlist Summary）─────────────────

export interface StockVerdictResponse {
  symbol:  string;
  verdict: string;
  meta: {
    price:      number;
    change_pct: number;
    trend:      string;
    rsi14:      number | null;
  };
}

export interface CompareAnalysisResponse {
  symbols:  string[];
  period:   string;
  analysis: string;
  data:     string[];
}

export interface AiWatchlistSummaryResponse {
  summary:    string;
  symbols:    string[];
  stock_data: string[];
}

export function getStockVerdict(symbol: string): Promise<StockVerdictResponse> {
  return fetcher<StockVerdictResponse>(`/api/v1/ai-analysis/${encodeURIComponent(symbol)}/verdict`);
}

export async function getCompareAnalysis(
  symbols: string[],
  period = "1y",
): Promise<CompareAnalysisResponse> {
  const res = await fetch(`${API_BASE}/api/v1/ai-analysis/compare`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ symbols, period }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: /ai-analysis/compare`);
  return res.json();
}

export interface RecommendationPick {
  symbol: string;
  name: string;
  price: number;
  change_pct: number;
  score: number;
  reason: string;
  foreign_streak: { days: number; direction: string };
  trust_streak: { days: number; direction: string };
  above_ma20: boolean;
  vol_ratio: number;
}
export interface RecommendationsResponse {
  picks: RecommendationPick[];
  message: string | null;
}
export async function getRecommendations(): Promise<RecommendationsResponse> {
  const res = await fetch(`${API_BASE}/api/v1/recommendations`);
  if (!res.ok) throw new Error(`API ${res.status}: /recommendations`);
  return res.json();
}

export async function getAiWatchlistSummary(
  symbols: string[],
  userId?: string,
): Promise<AiWatchlistSummaryResponse> {
  const res = await fetch(`${API_BASE}/api/v1/dashboard/ai-summary`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      ...(userId ? { "X-User-ID": userId } : {}),
    },
    body: JSON.stringify({ symbols }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: /dashboard/ai-summary`);
  return res.json();
}

// ── Calendar API ──────────────────────────────────────────────────────────────

export type CalendarEventType = "exdiv" | "earnings" | "agm";

export interface CalendarEvent {
  symbol:  string;
  name:    string;
  type:    CalendarEventType;
  label:   string;        // "除息日" / "財報公布" / "股東常會"
  date:    string;        // "YYYY-MM-DD"
  value:   number | null; // 除息金額（如有）
}

export interface CalendarResponse {
  window_days: number;
  from_date:   string;
  to_date:     string;
  count:       number;
  events:      CalendarEvent[];
}

// ── Candlestick Patterns API ──────────────────────────────────────────────────

export type PatternDirection = "bullish" | "bearish" | "neutral";

export interface CandlePattern {
  date:        string;           // "YYYY-MM-DD"
  name:        string;           // e.g. "hammer"
  label:       string;           // e.g. "錘頭"
  direction:   PatternDirection;
  description: string;
}

export interface PatternsResponse {
  symbol:   string;
  patterns: CandlePattern[];
}

export function getPatterns(symbol: string, limit = 90): Promise<PatternsResponse> {
  return fetcher<PatternsResponse>(`/api/v1/patterns/${symbol}?limit=${limit}`);
}

export async function getCalendar(symbols: string[]): Promise<CalendarResponse> {
  if (!symbols.length) return { window_days: 30, from_date: "", to_date: "", count: 0, events: [] };
  const res = await fetch(`${API_BASE}/api/v1/calendar?symbols=${symbols.join(",")}`);
  if (!res.ok) throw new Error(`API ${res.status}: /calendar`);
  return res.json();
}

// ── P1-5: 參數最佳化 ──────────────────────────────────────────────────────────

export type OptimizeSortBy = "sharpe" | "total_return" | "win_rate" | "max_drawdown";

export interface OptimizeRequest {
  symbol:          string;
  strategy_type:   string;
  param_ranges?:   Record<string, number[]>;
  use_preset?:     boolean;
  start_date:      string;
  end_date:        string;
  initial_capital?: number;
  stop_loss_pct?:  number;
  take_profit_pct?: number;
  sort_by?:        OptimizeSortBy;
  top_n?:          number;
}

export interface OptimizeResultItem {
  rank:   number;
  params: Record<string, number>;
  stats:  BacktestStats;
}

export interface OptimizeHeatmap {
  param_x:      string;
  param_y:      string;
  x_values:     number[];
  y_values:     number[];
  matrix:       (number | null)[][];
  metric:       OptimizeSortBy;
  metric_label: string;
}

export interface OptimizeResponse {
  results:      OptimizeResultItem[];
  total_combos: number;
  valid_combos: number;
  sort_by:      OptimizeSortBy;
  heatmap:      OptimizeHeatmap | null;
}

export async function runOptimize(body: OptimizeRequest): Promise<OptimizeResponse> {
  const res = await fetch(`${API_BASE}/api/v1/backtest/optimize`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `API ${res.status}`);
  }
  return res.json();
}

export async function getOptimizePresets(): Promise<Record<string, Record<string, number[]>>> {
  const r = await fetcher<{ presets: Record<string, Record<string, number[]>> }>("/api/v1/backtest/optimize/presets");
  return r.presets;
}

// ── P1-6: 策略比較 ──────────────────────────────────────────────────────────

export interface CompareSlotRequest {
  name:            string;
  symbol:          string;
  strategy:        BacktestStrategyConfig;
  start_date:      string;
  end_date:        string;
  initial_capital?: number;
  stop_loss_pct?:  number;
  take_profit_pct?: number;
}

export interface CompareRequest {
  slots: CompareSlotRequest[];
}

export interface CompareEquityPoint {
  time:  string;
  value: number;   // normalised to base 100
}

export interface CompareStrategyResult {
  name:             string;
  symbol:           string;
  color:            string;
  stats:            BacktestStats | null;
  equity_curve_norm: CompareEquityPoint[];
  error:            string | null;
}

export interface ComparePair {
  a:           string;
  b:           string;
  t_stat:      number | null;
  p_value:     number | null;
  significant: boolean;
  note:        string;
}

export interface CompareResponse {
  strategies:  CompareStrategyResult[];
  significance: { pairs: ComparePair[] };
}

export async function runCompare(body: CompareRequest): Promise<CompareResponse> {
  const res = await fetch(`${API_BASE}/api/v1/backtest/compare`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `API ${res.status}`);
  }
  return res.json();
}

// ── P4-16: Live Signal ────────────────────────────────────────────────────────

export interface LiveSignalResult {
  signal:       "buy" | "sell" | "holding" | "none";
  reason:       string;
  latest_date:  string;
  latest_close: number;
  indicators:   Record<string, number>;
}

export async function getLiveSignal(
  symbol:   string,
  strategy: BacktestStrategyConfig,
): Promise<LiveSignalResult> {
  const res = await fetch(`${API_BASE}/api/v1/backtest/live-signal`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ symbol, strategy }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `API ${res.status}`);
  }
  return res.json();
}

// ── P6-21: Stop Recommendation ───────────────────────────────────────────────

export interface StopRecommendResult {
  baseline_total_pnl:   number;
  recommended_stop_loss:   number | null;
  recommended_take_profit: number | null;
  sl_improved_total:    number | null;
  tp_improved_total:    number | null;
  sl_improvement_pct:   number;
  tp_improvement_pct:   number;
  trade_count:          number;
  avg_loss:             number;
  avg_gain:             number;
  p5_loss:              number;
  p95_gain:             number;
}

// P11-35: 一鍵體檢 AI 總結
export interface HealthCheckItem {
  name:   string;
  status: "pass" | "warn" | "fail" | "skip";
  detail: string;
}

export async function getBacktestAiSummary(payload: {
  symbol:        string;
  strategy_type: string;
  stats:         BacktestStats;
  checks:        HealthCheckItem[];
}): Promise<{ summary: string; source: "gemini" | "rule" }> {
  const res = await fetch(`${API_BASE}/api/v1/backtest/ai-summary`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `API ${res.status}`);
  }
  return res.json();
}

export async function getStopRecommendation(trades: BacktestTrade[]): Promise<StopRecommendResult> {
  const res = await fetch(`${API_BASE}/api/v1/backtest/stop-recommendation`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ trades }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `API ${res.status}`);
  }
  return res.json();
}

