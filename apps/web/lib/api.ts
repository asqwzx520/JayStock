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
  symbol: string;
  name: string;
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

export interface ChipsResponse {
  symbol:     string;
  days:       number;
  data:       ChipsBar[];
  cumulative: ChipsCumulative;
  streak:     ChipsStreakMap;
}

export function getChips(symbol: string, days = 60) {
  return fetcher<ChipsResponse>(`/api/v1/chips/${symbol}?days=${days}`);
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
): Promise<ScreenerResponse> {
  const res = await fetch(`${API_BASE}/api/v1/screener/run`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      template_id: templateId ?? null,
      nl_query:    nlQuery    ?? null,
      limit,
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
}

export interface StockNewsResponse {
  symbol: string;
  count:  number;
  news:   NewsItem[];
}

export function getStockNews(symbol: string) {
  return fetcher<StockNewsResponse>(`/api/v1/news/${encodeURIComponent(symbol)}`);
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
