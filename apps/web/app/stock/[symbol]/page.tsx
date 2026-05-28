/**
 * /stock/[symbol] — 個股分享頁（Server Component）
 *
 * 目的：
 *   1. 提供搜尋引擎可爬取的靜態 HTML（SEO）
 *   2. 產生個股 Open Graph 卡片（LINE / Twitter / FB 分享）
 *   3. 載入後立即導向主 SPA，並自動選取對應股票
 *
 * 快取策略：revalidate = 60 秒（盤中動態報價）
 */

import type { Metadata } from "next";
import StockRedirect from "./StockRedirect";

// ── 伺服器端取得個股基本報價 ─────────────────────────────────────────────────
const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface StockQuote {
  symbol:     string;
  name:       string;
  price:      number;
  change:     number;
  change_pct: number;
  volume:     number;
}

async function fetchQuote(symbol: string): Promise<StockQuote | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/quotes/${symbol}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return res.json() as Promise<StockQuote>;
  } catch {
    return null;
  }
}

// ── generateMetadata（SSR — 給爬蟲 / 預覽卡）────────────────────────────────
export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol } = await params;
  const stock = await fetchQuote(symbol);

  if (!stock) {
    return {
      title: `${symbol} 個股分析`,
      description: `查看 ${symbol} 的即時股價、K線圖表與法人籌碼 — StockPulse`,
    };
  }

  const { name, price, change, change_pct } = stock;
  const sign    = change >= 0 ? "▲" : "▼";
  const color   = change >= 0 ? "📈" : "📉";
  const priceStr   = price.toFixed(2);
  const changePctStr = `${sign}${Math.abs(change_pct).toFixed(2)}%`;
  const title  = `${symbol} ${name}  NT$${priceStr} ${changePctStr}`;
  const desc   = `${color} ${name}(${symbol}) 現價 NT$${priceStr}，${changePctStr}。` +
                 `查看完整 K線圖表、三大法人籌碼分析 — StockPulse`;

  return {
    title,
    description: desc,
    openGraph: {
      title,
      description: desc,
      url: `https://stockpulse.tw/stock/${symbol}`,
      images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    },
    twitter: {
      card:        "summary_large_image",
      title,
      description: desc,
      images:      ["/og-image.png"],
    },
  };
}

// ── Page（Server Component 殼 + Client 導向）────────────────────────────────
export default async function StockPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const stock = await fetchQuote(symbol);

  return (
    <div
      className="flex flex-col items-center justify-center h-full gap-6 p-8"
      style={{ background: "var(--bg-surface)", color: "var(--text-primary)" }}
    >
      {/* Server-rendered stock snapshot（爬蟲可讀取） */}
      {stock ? (
        <div className="text-center space-y-1">
          <p
            className="text-xs font-medium tracking-widest"
            style={{ color: "var(--text-tertiary)" }}
          >
            {symbol}
          </p>
          <h1 className="text-3xl font-bold">{stock.name}</h1>
          <p
            className="num text-5xl font-bold"
            style={{
              color:
                stock.change > 0
                  ? "var(--color-up)"
                  : stock.change < 0
                  ? "var(--color-down)"
                  : "var(--color-flat)",
            }}
          >
            {stock.price.toFixed(2)}
          </p>
          <p
            className="num text-lg"
            style={{
              color:
                stock.change >= 0 ? "var(--color-up)" : "var(--color-down)",
            }}
          >
            {stock.change >= 0 ? "+" : ""}
            {stock.change.toFixed(2)}&nbsp;（
            {stock.change_pct >= 0 ? "+" : ""}
            {stock.change_pct.toFixed(2)}%）
          </p>
        </div>
      ) : (
        <p style={{ color: "var(--text-secondary)" }}>
          找不到股票代碼：<strong>{symbol}</strong>
        </p>
      )}

      <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
        正在前往完整分析頁面…
      </p>

      {/* Client component：立即導向主 SPA 並選取該股票 */}
      <StockRedirect symbol={symbol} />
    </div>
  );
}
