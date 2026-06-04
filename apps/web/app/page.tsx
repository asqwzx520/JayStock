"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import Header from "@/components/layout/Header";
import LeftPanel from "@/components/layout/LeftPanel";
import RightPanel from "@/components/layout/RightPanel";
import { ChartSkeleton, DashboardSkeleton, NewsListSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
// Type-only imports (erased at runtime — safe to keep static)
import type { IndicatorType, ChartType, DrawingTool } from "@/components/chart/KLineChart";
import type { Period }                   from "@/components/chart/PeriodSelector";
import IndicatorSelector  from "@/components/chart/IndicatorSelector";
import PeriodSelector     from "@/components/chart/PeriodSelector";
import ChartTypeSelector  from "@/components/chart/ChartTypeSelector";
import DrawingToolbar     from "@/components/chart/DrawingToolbar";

// ── Heavy components: lazy-loaded to reduce initial JS bundle ────────────────
// TradingView Lightweight Charts (~400 KB), ECharts-based charts, etc.
const KLineChart = dynamic(
  () => import("@/components/chart/KLineChart"),
  { ssr: false, loading: () => <ChartSkeleton /> }
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
  { ssr: false, loading: () => <DashboardSkeleton /> }
);

const ScreenerPanel = dynamic(
  () => import("@/components/screener/ScreenerPanel"),
  { ssr: false, loading: () => <TableSkeleton rows={10} /> }
);

const StockNews = dynamic(
  () => import("@/components/market/StockNews"),
  { ssr: false, loading: () => <NewsListSkeleton /> }
);

const BacktestPanel = dynamic(
  () => import("@/components/backtest/BacktestPanel"),
  { ssr: false, loading: () => <div className="flex-1 flex items-center justify-center" style={{ color: "var(--text-tertiary)" }}>載入回測引擎中...</div> }
);

const AnalysisPanel = dynamic(
  () => import("@/components/analysis/AnalysisPanel"),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);
import {
  getQuote,
  getKline,
  getIntradayKline,
  getChips,
  getMargin,
  getFundamental,
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
  type FundamentalData,
} from "@/lib/api";
import { useStockWebSocket } from "@/lib/useStockWebSocket";
import type { ChartBar } from "@/components/chart/KLineChart";

const isIntradayPeriod = (p: string): p is IntradayPeriod =>
  (INTRADAY_PERIODS as string[]).includes(p);

type ViewTab   = "kline" | "chips" | "market" | "screener" | "news" | "backtest" | "analysis";
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

function FundItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <span style={{ color: "var(--text-tertiary)" }}>{label}</span>
      <span className="font-medium" style={{ color: color ?? "var(--text-primary)" }}>{value}</span>
    </div>
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
  const [chartType, setChartType]       = useState<ChartType>("candle");
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

  // 基本面資料
  const [fundamental, setFundamental] = useState<FundamentalData | null>(null);

  // 繪圖工具
  const [activeTool, setActiveTool]   = useState<DrawingTool>("cursor");
  const [drawingClearKey, setDrawingClearKey] = useState(0);

  // 手機版左側 Drawer
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = leftPanelOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [leftPanelOpen]);

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

  // 即時報價：WebSocket（盤中 5s，盤外 30s）
  const { quotes: wsQuotes } = useStockWebSocket([symbol]);
  useEffect(() => {
    const q = wsQuotes[symbol];
    if (q) setQuote(q);
  }, [wsQuotes, symbol]);

  // 基本面：symbol 變動時重載（後端 TTL=1h，不影響效能）
  useEffect(() => {
    setFundamental(null);
    getFundamental(symbol).then(setFundamental).catch(() => {});
  }, [symbol]);

  function handleSelectStock(sym: string, name?: string) {
    setSymbol(sym);
    if (name) setStockName(name);
    setChipsData([]); setChipsCumul(null); setChipsStreak(null);
    setMarginData([]); setMarginLatest(null);
  }

  return (
    <div className="flex flex-col h-full">
      <Header onSelectStock={handleSelectStock} />

      <div className="flex flex-1 min-h-0">
        <LeftPanel
          currentSymbol={symbol}
          onSelectStock={(sym) => handleSelectStock(sym)}
          drawerOpen={leftPanelOpen}
          onDrawerClose={() => setLeftPanelOpen(false)}
        />

        <main className="flex-1 flex flex-col min-w-0 min-h-0">

          {/* ── Row 1：主導航 Tab ──────────────────────── */}
          <div
            className="shrink-0 flex items-center border-b overflow-x-auto"
            style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
          >
            {/* 漢堡按鈕（手機版專用） */}
            <button
              onClick={() => setLeftPanelOpen(true)}
              className="lg:hidden shrink-0 flex items-center justify-center w-10 h-10 ml-1"
              style={{ color: "var(--text-secondary)" }}
              aria-label="開啟自選股"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect y="3" width="18" height="2" rx="1" fill="currentColor"/>
                <rect y="8" width="18" height="2" rx="1" fill="currentColor"/>
                <rect y="13" width="18" height="2" rx="1" fill="currentColor"/>
              </svg>
            </button>

            {(["kline", "chips", "market", "screener", "news", "backtest", "analysis"] as ViewTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => { setViewTab(tab); setLeftPanelOpen(false); }}
                className="px-3 sm:px-4 py-2.5 text-sm font-medium transition-colors shrink-0"
                style={{
                  color: viewTab === tab ? "var(--color-brand)" : "var(--text-secondary)",
                  borderBottom: viewTab === tab ? "2px solid var(--color-brand)" : "2px solid transparent",
                }}
              >
                {tab === "kline"    ? "走勢圖"
                  : tab === "chips"   ? "籌碼"
                  : tab === "market"  ? "大盤"
                  : tab === "screener"? "選股"
                  : tab === "news"     ? "新聞"
                  : tab === "backtest" ? "回測"
                  : "分析"}
              </button>
            ))}
          </div>

          {/* ── Row 2：圖表工具列（走勢圖/籌碼 才顯示）── */}
          {(viewTab === "kline" || viewTab === "chips") && (
            <div
              className="shrink-0 flex items-center justify-between gap-2 px-3 sm:px-4 py-1.5 border-b overflow-x-auto"
              style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
            >
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
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
                      className="num text-base font-bold"
                      style={{
                        color: quote.change > 0
                          ? "var(--color-up)"
                          : quote.change < 0
                          ? "var(--color-down)"
                          : "var(--color-flat)",
                      }}
                    >
                      {quote.price.toFixed(2)}
                      <span className="text-xs ml-1.5">
                        {quote.change > 0 ? "+" : ""}
                        {quote.change_pct.toFixed(2)}%
                      </span>
                    </span>
                  )}
                </div>

                {/* 分隔線 */}
                <div className="w-px h-4 shrink-0" style={{ background: "var(--border)" }} />

                {/* K線：週期 + 圖形種類 */}
                {viewTab === "kline" ? (
                  <>
                    <PeriodSelector active={period} onChange={setPeriod} />
                    <ChartTypeSelector active={chartType} onChange={setChartType} />
                  </>
                ) : (
                  /* 籌碼：天數 + 子 tab + streak */
                  <>
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

                    {chipsSubTab === "institutional" && chipsStreak && (
                      <div className="flex items-center gap-1.5">
                        <StreakBadge label="外資" streak={chipsStreak.foreign} color="#F59E0B" />
                        <StreakBadge label="投信" streak={chipsStreak.trust}   color="#8B5CF6" />
                        <StreakBadge label="自營" streak={chipsStreak.dealer}  color="#06B6D4" />
                      </div>
                    )}
                  </>
                )}
              </div>

              {viewTab === "kline" && (
                <div className="flex items-center gap-2">
                  <DrawingToolbar
                    active={activeTool}
                    onChange={setActiveTool}
                    onClearAll={() => setDrawingClearKey((k) => k + 1)}
                  />
                  <IndicatorSelector active={indicators} onChange={setIndicators} />
                </div>
              )}
            </div>
          )}

          {/* ── 基本面摘要列（走勢圖 tab 才顯示）─────────── */}
          {viewTab === "kline" && fundamental && (
            <div
              className="shrink-0 flex items-center gap-4 px-4 py-1 border-b overflow-x-auto"
              style={{
                background: "var(--bg-elevated)",
                borderColor: "var(--border)",
                fontSize: "11px",
              }}
            >
              {fundamental.market_cap_fmt && (
                <FundItem label="市值" value={fundamental.market_cap_fmt} />
              )}
              {fundamental.pe_trailing != null && (
                <FundItem label="本益比" value={fundamental.pe_trailing.toFixed(1)} />
              )}
              {fundamental.eps_trailing != null && (
                <FundItem
                  label="EPS"
                  value={fundamental.eps_trailing.toFixed(2)}
                  color={fundamental.eps_trailing >= 0 ? "var(--color-up)" : "var(--color-down)"}
                />
              )}
              {fundamental.dividend_yield != null && (
                <FundItem label="殖利率" value={`${fundamental.dividend_yield.toFixed(2)}%`} color="var(--color-up)" />
              )}
              {fundamental.week52_high != null && fundamental.week52_low != null && (
                <FundItem
                  label="52W 區間"
                  value={`${fundamental.week52_low.toFixed(0)} – ${fundamental.week52_high.toFixed(0)}`}
                />
              )}
              {fundamental.beta != null && (
                <FundItem label="Beta" value={fundamental.beta.toFixed(2)} />
              )}
              {fundamental.sector && (
                <FundItem label="產業" value={fundamental.sector} />
              )}
            </div>
          )}

          {/* ── 主圖區 ──────────────────────────────────── */}
          <div className="flex-1 min-h-0 relative">

            {/* K 線 */}
            {viewTab === "kline" && (
              <>
                {loading && klineData.length === 0 && <ChartSkeleton />}
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
                      chartType={chartType}
                      activeTool={activeTool}
                      clearKey={drawingClearKey}
                      symbol={symbol}
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
                {chipsLoading && chipsData.length === 0 && <ChartSkeleton />}
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

            {/* 個股新聞 */}
            {viewTab === "news" && (
              <StockNews symbol={symbol} />
            )}

            {/* 回測 */}
            {viewTab === "backtest" && (
              <BacktestPanel symbol={symbol} />
            )}

            {/* 分析 */}
            {viewTab === "analysis" && (
              <AnalysisPanel symbol={symbol} />
            )}

            {/* 籌碼 — 融資融券 */}
            {viewTab === "chips" && chipsSubTab === "margin" && (
              <>
                {marginLoading && marginData.length === 0 && <ChartSkeleton />}
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
