"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import Header from "@/components/layout/Header";
import LeftPanel from "@/components/layout/LeftPanel";
import RightPanel from "@/components/layout/RightPanel";
// Type-only imports (erased at runtime — safe to keep static)
import type { IndicatorType } from "@/components/chart/KLineChart";
import type { Period }        from "@/components/chart/PeriodSelector";
import IndicatorSelector from "@/components/chart/IndicatorSelector";
import PeriodSelector    from "@/components/chart/PeriodSelector";

// ── Heavy components: lazy-loaded to reduce initial JS bundle ────────────────
// TradingView Lightweight Charts (~400 KB), ECharts-based charts, etc.
const KLineChart = dynamic(
  () => import("@/components/chart/KLineChart"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full"
           style={{ color: "var(--text-tertiary)" }}>
        載入圖表中…
      </div>
    ),
  }
);

const ChipsChart = dynamic(
  () => import("@/components/chart/ChipsChart"),
  { ssr: false }
);

const MarginChart = dynamic(
  () => import("@/components/chart/MarginChart"),
  { ssr: false }
);

const MarketDashboard = dynamic(
  () => import("@/components/market/MarketDashboard"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full"
           style={{ color: "var(--text-tertiary)" }}>
        載入市場儀錶板…
      </div>
    ),
  }
);

const ScreenerPanel = dynamic(
  () => import("@/components/screener/ScreenerPanel"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full"
           style={{ color: "var(--text-tertiary)" }}>
        載入選股器…
      </div>
    ),
  }
);
import {
  getQuote,
  getKline,
  getIntradayKline,
  getChips,
  getMargin,
  INTRADAY_PERIODS,
  type Quote,
  type KlineBar,
  type IntradayBar,
  type IntradayPeriod,
  type ChipsBar,
  type ChipsCumulative,
  type ChipsStreakMap,
  type MarginBar,
  type MarginResponse,
} from "@/lib/api";
import type { ChartBar } from "@/components/chart/KLineChart";

const isIntradayPeriod = (p: string): p is IntradayPeriod =>
  (INTRADAY_PERIODS as string[]).includes(p);

type ViewTab   = "kline" | "chips" | "market" | "screener";
type ChipsSubTab = "institutional" | "margin";

const CHIPS_DAYS = [20, 60, 120] as const;
type ChipsDays = (typeof CHIPS_DAYS)[number];

const DEFAULT_SYMBOL = "2330";

/** /stock/[symbol] 導回首頁時，會在 sessionStorage 留下初始股票 */
function readInitSymbol(): string {
  if (typeof window === "undefined") return DEFAULT_SYMBOL;
  const v = sessionStorage.getItem("stockpulse_init_symbol");
  if (v) {
    sessionStorage.removeItem("stockpulse_init_symbol");
    return v;
  }
  return DEFAULT_SYMBOL;
}

// ── streak badge ──────────────────────────────────────────────────
function StreakBadge({
  label,
  streak,
  color,
}: {
  label: string;
  streak: { days: number; direction: string } | undefined;
  color: string;
}) {
  if (!streak || streak.days === 0) return null;
  const isBuy = streak.direction === "buy";
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
      style={{
        background: isBuy ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
        color: isBuy ? "var(--color-up)" : "var(--color-down)",
        border: `1px solid ${isBuy ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
      }}
      title={`${label} 連續${isBuy ? "買超" : "賣超"} ${streak.days} 日`}
    >
      {label} {isBuy ? "▲" : "▼"}{streak.days}日
    </span>
  );
}

export default function Home() {
  const [symbol, setSymbol]       = useState(readInitSymbol);  // 支援 /stock/[symbol] 導入
  const [stockName, setStockName] = useState("台積電");
  const [quote, setQuote]         = useState<Quote | null>(null);

  // K線（日K = KlineBar[], 分K = IntradayBar[]）
  const [klineData, setKlineData]       = useState<ChartBar[]>([]);
  const [period, setPeriod]             = useState<Period>("daily");
  const [indicators, setIndicators]     = useState<IndicatorType[]>(["MA"]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState("");
  // 法人疊圖 (chips in K-line view)
  const [klineChipsData, setKlineChipsData] = useState<ChipsBar[]>([]);

  // 籌碼
  const [chipsData, setChipsData]   = useState<ChipsBar[]>([]);
  const [chipsCumul, setChipsCumul] = useState<ChipsCumulative | null>(null);
  const [chipsStreak, setChipsStreak] = useState<ChipsStreakMap | null>(null);
  const [chipsDays, setChipsDays]   = useState<ChipsDays>(60);
  const [chipsLoading, setChipsLoading] = useState(false);
  const [chipsError, setChipsError] = useState("");

  // 融資融券
  const [marginData, setMarginData]   = useState<MarginBar[]>([]);
  const [marginLatest, setMarginLatest] = useState<MarginResponse["latest"]>(null);
  const [marginLoading, setMarginLoading] = useState(false);
  const [marginError, setMarginError] = useState("");

  // 主 tab
  const [viewTab, setViewTab]         = useState<ViewTab>("kline");
  // 籌碼子 tab
  const [chipsSubTab, setChipsSubTab] = useState<ChipsSubTab>("institutional");

  // ── 載入 K 線（自動分流：分K / 日週月K）──────────────────────
  const loadKline = useCallback(async (sym: string, prd: string) => {
    setLoading(true); setError("");
    try {
      if (isIntradayPeriod(prd)) {
        // 分K：呼叫 /kline/{symbol}/intraday
        const [q, k] = await Promise.all([
          getQuote(sym).catch(() => null),
          getIntradayKline(sym, prd),
        ]);
        if (q) { setQuote(q); setStockName(q.name); }
        setKlineData(k.data as IntradayBar[]);
      } else {
        // 日/週/月 K
        const [q, k] = await Promise.all([
          getQuote(sym).catch(() => null),
          getKline(sym, prd),
        ]);
        if (q) { setQuote(q); setStockName(q.name); }
        setKlineData(k.data as KlineBar[]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
      setKlineData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── 載入 K 線法人疊圖 ─────────────────────────────────────────
  const loadKlineChips = useCallback(async (sym: string) => {
    try {
      const resp = await getChips(sym, 240);
      setKlineChipsData(resp.data);
    } catch {
      setKlineChipsData([]);
    }
  }, []);

  // ── 載入籌碼 ────────────────────────────────────────────────────
  const loadChips = useCallback(async (sym: string, days: number) => {
    setChipsLoading(true); setChipsError("");
    try {
      const resp = await getChips(sym, days);
      setChipsData(resp.data);
      setChipsCumul(resp.cumulative);
      setChipsStreak(resp.streak ?? null);
    } catch (e) {
      setChipsError(e instanceof Error ? e.message : "籌碼資料載入失敗");
      setChipsData([]); setChipsCumul(null); setChipsStreak(null);
    } finally {
      setChipsLoading(false);
    }
  }, []);

  // ── 載入融資融券 ────────────────────────────────────────────────
  const loadMargin = useCallback(async (sym: string, days: number) => {
    setMarginLoading(true); setMarginError("");
    try {
      const resp = await getMargin(sym, days);
      setMarginData(resp.data);
      setMarginLatest(resp.latest);
    } catch (e) {
      setMarginError(e instanceof Error ? e.message : "融資融券資料載入失敗");
      setMarginData([]); setMarginLatest(null);
    } finally {
      setMarginLoading(false);
    }
  }, []);

  // K 線：symbol / period 變動時重載
  useEffect(() => { loadKline(symbol, period); }, [symbol, period, loadKline]);

  // K 線法人疊圖：CHIPS 指標開啟時或 symbol 變動時載入（分K不支援）
  useEffect(() => {
    if (indicators.includes("CHIPS") && !isIntradayPeriod(period)) {
      loadKlineChips(symbol);
    } else {
      setKlineChipsData([]);
    }
  }, [symbol, indicators, period, loadKlineChips]);

  // 籌碼：切換到 chips tab 或 symbol/days 改變時重載
  useEffect(() => {
    if (viewTab === "chips") loadChips(symbol, chipsDays);
  }, [symbol, chipsDays, viewTab, loadChips]);

  // 融資券：chips tab + margin 子 tab 或 symbol/days 改變時重載
  useEffect(() => {
    if (viewTab === "chips" && chipsSubTab === "margin") loadMargin(symbol, chipsDays);
  }, [symbol, chipsDays, viewTab, chipsSubTab, loadMargin]);

  // 即時報價 15 秒更新
  useEffect(() => {
    if (!symbol) return;
    const id = setInterval(async () => {
      try { const q = await getQuote(symbol); setQuote(q); } catch { /* silent */ }
    }, 15_000);
    return () => clearInterval(id);
  }, [symbol]);

  function handleSelectStock(sym: string, name?: string) {
    setSymbol(sym);
    if (name) setStockName(name);
    setChipsData([]); setChipsCumul(null); setChipsStreak(null);
    setMarginData([]); setMarginLatest(null);
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        currentSymbol={`${symbol} ${stockName}`}
        onSelectStock={handleSelectStock}
      />

      <div className="flex flex-1 min-h-0">
        <LeftPanel
          currentSymbol={symbol}
          onSelectStock={(sym) => handleSelectStock(sym)}
        />

        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* ── 工具列 ──────────────────────────────────── */}
          <div
            className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 border-b"
            style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
          >
            <div className="flex items-center gap-3 flex-wrap">
              {/* 代碼 + 報價 */}
              <div className="flex items-baseline gap-2">
                <span className="num text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                  {symbol}
                </span>
                <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                  {stockName}
                </span>
                {quote && (
                  <span
                    className="num text-lg font-bold"
                    style={{
                      color: quote.change > 0
                        ? "var(--color-up)"
                        : quote.change < 0
                        ? "var(--color-down)"
                        : "var(--color-flat)",
                    }}
                  >
                    {quote.price.toFixed(2)}
                    <span className="text-sm ml-1.5">
                      {quote.change > 0 ? "+" : ""}
                      {quote.change_pct.toFixed(2)}%
                    </span>
                  </span>
                )}
              </div>

              {/* 主 Tab 切換 */}
              <div
                className="flex items-center gap-0.5 rounded p-0.5"
                style={{ background: "var(--bg-elevated)" }}
              >
                {(["kline", "chips", "market", "screener"] as ViewTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setViewTab(tab)}
                    className="px-3 py-1 text-xs rounded font-medium transition-colors"
                    style={{
                      background: viewTab === tab ? "var(--color-brand)" : "transparent",
                      color: viewTab === tab ? "#fff" : "var(--text-secondary)",
                    }}
                  >
                    {tab === "kline" ? "K線"
                      : tab === "chips" ? "籌碼"
                      : tab === "market" ? "大盤法人"
                      : "選股"}
                  </button>
                ))}
              </div>

              {/* K線週期 or 籌碼天數 (hidden in market/screener tab) */}
              {viewTab === "market" || viewTab === "screener" ? null : viewTab === "kline" ? (
                <PeriodSelector active={period} onChange={setPeriod} />
              ) : (
                <div className="flex items-center gap-1">
                  {CHIPS_DAYS.map((d) => (
                    <button
                      key={d}
                      onClick={() => setChipsDays(d)}
                      className="px-2.5 py-1 text-xs rounded font-medium transition-colors"
                      style={{
                        background: chipsDays === d ? "var(--bg-elevated)" : "transparent",
                        color: chipsDays === d ? "var(--text-primary)" : "var(--text-secondary)",
                      }}
                    >
                      {d}日
                    </button>
                  ))}
                </div>
              )}

              {/* 籌碼 sub-tab (only in chips tab) */}
              {viewTab === "chips" && (
                <div
                  className="flex items-center gap-0.5 rounded p-0.5"
                  style={{ background: "var(--bg-elevated)" }}
                >
                  {(["institutional", "margin"] as ChipsSubTab[]).map((st) => (
                    <button
                      key={st}
                      onClick={() => setChipsSubTab(st)}
                      className="px-2.5 py-1 text-xs rounded font-medium transition-colors"
                      style={{
                        background: chipsSubTab === st ? "var(--bg-surface)" : "transparent",
                        color: chipsSubTab === st ? "var(--text-primary)" : "var(--text-secondary)",
                      }}
                    >
                      {st === "institutional" ? "三大法人" : "融資券"}
                    </button>
                  ))}
                </div>
              )}

              {/* 連續買超/賣超 streak badges */}
              {viewTab === "chips" && chipsSubTab === "institutional" && chipsStreak && (
                <div className="flex items-center gap-1.5">
                  <StreakBadge label="外資" streak={chipsStreak.foreign} color="#F59E0B" />
                  <StreakBadge label="投信" streak={chipsStreak.trust}   color="#8B5CF6" />
                  <StreakBadge label="自營" streak={chipsStreak.dealer}  color="#06B6D4" />
                </div>
              )}
            </div>

            {viewTab === "kline" && (
              <IndicatorSelector active={indicators} onChange={setIndicators} />
            )}

          </div>

          {/* ── 主圖區 ──────────────────────────────────── */}
          <div className="flex-1 min-h-0 relative">

            {/* K 線 */}
            {viewTab === "kline" && (
              <>
                {loading && klineData.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center z-10"
                    style={{ background: "var(--bg-surface)" }}>
                    <span style={{ color: "var(--text-tertiary)" }}>載入中…</span>
                  </div>
                )}
                {error && (
                  <div className="absolute inset-0 flex items-center justify-center z-10"
                    style={{ background: "var(--bg-surface)" }}>
                    <span style={{ color: "var(--color-up)" }}>{error}</span>
                  </div>
                )}
                {klineData.length > 0 && (
                  <>
                    <KLineChart
                      data={klineData}
                      indicators={indicators}
                      chipsData={klineChipsData}
                    />
                    {/* Chip-lane labels when overlay active */}
                    {indicators.includes("CHIPS") && klineChipsData.length > 0 && (
                      <div className="pointer-events-none absolute z-10 left-2 flex flex-col"
                           style={{ bottom: "2%", gap: "7.5%" }}>
                        {[
                          { label: "自營", color: "#06B6D4" },
                          { label: "投信", color: "#8B5CF6" },
                          { label: "外資", color: "#F59E0B" },
                        ].map((l) => (
                          <div key={l.label}
                               className="text-[9px] font-semibold"
                               style={{ color: l.color }}>
                            {l.label}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {/* 籌碼 — 三大法人 */}
            {viewTab === "chips" && chipsSubTab === "institutional" && (
              <>
                {chipsLoading && chipsData.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center z-10"
                    style={{ background: "var(--bg-surface)" }}>
                    <span style={{ color: "var(--text-tertiary)" }}>載入籌碼中…</span>
                  </div>
                )}
                {chipsError && (
                  <div className="absolute inset-0 flex items-center justify-center z-10"
                    style={{ background: "var(--bg-surface)" }}>
                    <span style={{ color: "var(--color-up)" }}>{chipsError}</span>
                  </div>
                )}
                {chipsData.length > 0 && chipsCumul && (
                  <ChipsChart data={chipsData} cumulative={chipsCumul} />
                )}
              </>
            )}

            {/* M5 市場儀錶板（廣度 + 板塊 + 法人） */}
            {viewTab === "market" && (
              <MarketDashboard onSelectStock={(sym, name) => {
                handleSelectStock(sym, name);
                setViewTab("kline");
              }} />
            )}

            {/* 選股器 */}
            {viewTab === "screener" && (
              <ScreenerPanel
                onSelectStock={(sym, name) => {
                  handleSelectStock(sym, name);
                  setViewTab("kline");
                }}
              />
            )}

            {/* 籌碼 — 融資融券 */}
            {viewTab === "chips" && chipsSubTab === "margin" && (
              <>
                {marginLoading && marginData.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center z-10"
                    style={{ background: "var(--bg-surface)" }}>
                    <span style={{ color: "var(--text-tertiary)" }}>載入融資券中…</span>
                  </div>
                )}
                {marginError && (
                  <div className="absolute inset-0 flex items-center justify-center z-10"
                    style={{ background: "var(--bg-surface)" }}>
                    <span style={{ color: "var(--color-up)" }}>{marginError}</span>
                  </div>
                )}
                {marginData.length > 0 && (
                  <MarginChart data={marginData} latest={marginLatest} />
                )}
              </>
            )}
          </div>
        </main>

        <RightPanel quote={quote} />
      </div>
    </div>
  );
}
