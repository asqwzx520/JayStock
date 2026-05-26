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

export function searchStocks(query: string) {
  return fetcher<SearchResponse>(
    `/api/v1/market/search?q=${encodeURIComponent(query)}`
  );
}
