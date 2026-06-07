"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import Header from "@/components/layout/Header";
import { ChartSkeleton, DashboardSkeleton, NewsListSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { useTabConfig } from "@/hooks/useTabConfig";
import type { ViewTab } from "@/hooks/useTabConfig";
// Type-only imports (erased at runtime — safe to keep static)
import type { IndicatorType, ChartType, DrawingTool } from "@/components/chart/KLineChart";
import type { Period }                   from "@/components/chart/PeriodSelector";
import IndicatorSelector  from "@/components/chart/IndicatorSelector";
import PeriodSelector     from "@/components/chart/PeriodSelector";
import ChartTypeSelector  from "@/components/chart/ChartTypeSelector";
import DrawingToolbar     from "@/components/chart/DrawingToolbar";
import AlertModal         from "@/components/ui/AlertModal";

// ── Heavy components: lazy-loaded to reduce initial JS bundle ────────────────
// TradingView Lightweight Charts (~400 KB), ECharts-based charts, etc.
const KLineChart = dynamic(
  () => import("@/components/chart/KLineChart"),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

const ChipsPanel = dynamic(
  () => import("@/components/chips/ChipsPanel"),
  { ssr: false, loading: () => <ChartSkeleton /> }
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

const CompareChart = dynamic(
  () => import("@/components/chart/CompareChart"),
  { ssr: false, loading: () => <ChartSkeleton /> }
);

const HomeDashboard = dynamic(
  () => import("@/components/dashboard/HomeDashboard"),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);

const CalendarView = dynamic(
  () => import("@/components/dashboard/CalendarView"),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);

const WatchlistSidebar = dynamic(
  () => import("@/components/layout/LeftPanel"),
  { ssr: false }
);

const AnalysisPanel = dynamic(
  () => import("@/components/analysis/AnalysisPanel"),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);

const HotRanking = dynamic(
  () => import("@/components/market/HotRanking"),
  { ssr: false, loading: () => <TableSkeleton rows={10} /> }
);

const WorkspaceModal = dynamic(
  () => import("@/components/ui/WorkspaceModal"),
  { ssr: false }
);
import {
  getQuote,
  getKline,
  getIntradayKline,
  getChips,
  getMargin,
  getFundamental,
  getStockVerdict,
  getPatterns,
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
  type CandlePattern,
} from "@/lib/api";
import { useStockWebSocket } from "@/lib/useStockWebSocket";
import type { ChartBar } from "@/components/chart/KLineChart";

const isIntradayPeriod = (p: string): p is IntradayPeriod =>
  (INTRADAY_PERIODS as string[]).includes(p);

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

  // 籌碼日期範圍（傳給 ChipsPanel）
  const [chipsDays, setChipsDays] = useState<ChipsDays>(60);

  // 主 tab
  const [viewTab, setViewTab] = useState<ViewTab>("kline");

  // 基本面資料
  const [fundamental, setFundamental] = useState<FundamentalData | null>(null);

  // AI 一句話評價
  const [verdict, setVerdict]             = useState<string | null>(null);
  const [verdictLoading, setVerdictLoading] = useState(false);

  // K 線型態辨識
  const [patterns, setPatterns] = useState<CandlePattern[]>([]);

  // 繪圖工具
  const [activeTool, setActiveTool]       = useState<DrawingTool>("cursor");
  const [drawingClearKey, setDrawingClearKey] = useState(0);
  const [alertModalOpen, setAlertModalOpen]   = useState(false);

  // 自訂工作區 Modal
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const { tabs, visibleTabs, reorder } = useTabConfig();

  // 手機版：已移除 LeftPanel Drawer，保留狀態供底部 nav 用
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);

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
    setVerdict(null);   // 換股時清除舊評價
  }, [symbol]);

  // K 線型態：symbol 變動時重載（後端 TTL=5min）
  useEffect(() => {
    setPatterns([]);
    getPatterns(symbol).then((r) => setPatterns(r.patterns)).catch(() => {});
  }, [symbol]);

  async function fetchVerdict() {
    if (verdictLoading) return;
    setVerdictLoading(true);
    try {
      const res = await getStockVerdict(symbol);
      setVerdict(res.verdict);
    } catch {
      setVerdict("暫時無法取得 AI 評價，請稍後再試。");
    } finally {
      setVerdictLoading(false);
    }
  }

  function handleSelectStock(sym: string, name?: string) {
    setSymbol(sym);
    if (name) setStockName(name);
  }

  return (
    <>
    <div className="flex flex-col h-full">
      <Header
        onSelectStock={handleSelectStock}
        currentSymbol={symbol}
        currentName={stockName}
      />

      <div className="flex flex-1 min-h-0">
        <main className="flex-1 flex flex-col min-w-0 min-h-0">

          {/* ── Row 1：主導航 Tab ──────────────────────── */}
          <div
            className="shrink-0 flex items-stretch border-b overflow-x-auto"
            style={{
              background: "var(--bg-base)",
              borderColor: "var(--border)",
              height: "36px",
            }}
          >
            {visibleTabs.map((tab) => {
              const isActive = viewTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setViewTab(tab.id)}
                  className="shrink-0 flex items-center px-4 transition-colors"
                  style={{
                    height: "100%",
                    fontSize: "12.5px",
                    fontWeight: isActive ? 600 : 500,
                    letterSpacing: "0.02em",
                    color: isActive ? "var(--color-brand)" : "var(--text-tertiary)",
                    background: isActive ? "rgba(59,130,246,0.07)" : "transparent",
                    borderBottom: isActive ? "2px solid var(--color-brand)" : "2px solid transparent",
                    borderRight: "1px solid var(--border)",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}

            {/* ⚙ 自訂工作區按鈕 */}
            <button
              onClick={() => setWorkspaceOpen(true)}
              title="自訂 Tab 排序與顯示"
              className="shrink-0 flex items-center justify-center ml-auto px-3 transition-colors"
              style={{
                height: "100%",
                fontSize: "13px",
                color: "var(--text-tertiary)",
                borderLeft: "1px solid var(--border)",
              }}
            >
              ⚙
            </button>
          </div>

          {/* ── Row 2：圖表工具列（走勢圖/籌碼 才顯示）── */}
          {(viewTab === "kline" || viewTab === "chips") && (
            <div
              className="shrink-0 flex items-center justify-between gap-2 px-3 sm:px-4 py-1.5 border-b overflow-x-auto"
              style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
            >
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                {/* 代碼 + 報價 — 衝擊版 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="num font-bold"
                    style={{ fontSize: "12px", color: "var(--color-brand)", letterSpacing: "0.06em" }}
                  >
                    {symbol}
                  </span>
                  <span className="font-semibold" style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                    {stockName}
                  </span>
                  {quote && (() => {
                    const isUp   = quote.change > 0;
                    const isDown = quote.change < 0;
                    const col    = isUp ? "var(--color-up)" : isDown ? "var(--color-down)" : "var(--color-flat)";
                    const glow   = isUp
                      ? { textShadow: "0 0 10px rgba(239,68,68,0.65), 0 0 24px rgba(239,68,68,0.3)" }
                      : isDown
                      ? { textShadow: "0 0 10px rgba(34,197,94,0.65), 0 0 24px rgba(34,197,94,0.3)" }
                      : {};
                    return (
                      <div className="flex items-baseline gap-1.5">
                        <span
                          className="num font-bold"
                          style={{ fontSize: "20px", letterSpacing: "-0.5px", color: col, ...glow }}
                        >
                          {quote.price.toFixed(2)}
                        </span>
                        <span
                          className="num"
                          style={{ fontSize: "12px", fontWeight: 600, color: col, opacity: 0.85, ...glow }}
                        >
                          {isUp ? "▲" : isDown ? "▼" : ""}
                          {quote.change > 0 ? "+" : ""}{quote.change_pct.toFixed(2)}%
                        </span>
                      </div>
                    );
                  })()}
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

                  </>
                )}
              </div>

              {viewTab === "kline" && (
                <div className="flex items-center gap-2">
                  <DrawingToolbar
                    active={activeTool}
                    onChange={setActiveTool}
                    onClearAll={() => setDrawingClearKey((k) => k + 1)}
                    onAlertClick={() => setAlertModalOpen(true)}
                  />
                  <IndicatorSelector active={indicators} onChange={setIndicators} />
                  {/* 🤖 AI 一句話評價按鈕 */}
                  <button
                    onClick={fetchVerdict}
                    disabled={verdictLoading}
                    title="AI 一句話評價"
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors"
                    style={{
                      background:  verdict ? "rgba(59,130,246,0.12)" : "var(--bg-elevated)",
                      border:      `1px solid ${verdict ? "rgba(59,130,246,0.4)" : "var(--border)"}`,
                      color:       verdict ? "var(--color-brand)" : "var(--text-secondary)",
                      opacity:     verdictLoading ? 0.6 : 1,
                    }}
                  >
                    {verdictLoading ? (
                      <span className="animate-spin text-[12px]">⟳</span>
                    ) : (
                      "🤖"
                    )}
                    <span className="hidden sm:inline">AI 評價</span>
                  </button>
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

          {/* ── AI 一句話評價帶（走勢圖 tab 顯示評價後才出現）── */}
          {viewTab === "kline" && verdict && (
            <div
              className="shrink-0 flex items-start gap-2 px-4 py-2 border-b"
              style={{
                background:   "rgba(59,130,246,0.06)",
                borderColor:  "rgba(59,130,246,0.2)",
                fontSize:     "12px",
              }}
            >
              <span style={{ color: "var(--color-brand)", fontSize: "14px", flexShrink: 0 }}>🤖</span>
              <span style={{ color: "var(--text-primary)", lineHeight: 1.6 }}>{verdict}</span>
              <button
                onClick={() => setVerdict(null)}
                className="ml-auto shrink-0 opacity-40 hover:opacity-80 text-xs"
                style={{ color: "var(--text-secondary)" }}
                title="關閉"
              >
                ✕
              </button>
            </div>
          )}

          {/* ── 主圖區 ──────────────────────────────────── */}
          <div className="flex-1 min-h-0 relative">

            {/* 首頁：280px 自選股側欄 + 右側儀錶板 */}
            {viewTab === "home" && (
              <div className="flex h-full min-h-0">
                {/* 自選股側欄（桌面版顯示）*/}
                <aside
                  className="hidden md:block shrink-0 border-r overflow-hidden"
                  style={{
                    width: "280px",
                    background: "var(--bg-surface)",
                    borderColor: "var(--border)",
                  }}
                >
                  <WatchlistSidebar
                    currentSymbol={symbol}
                    onSelectStock={(sym) => {
                      handleSelectStock(sym, "");
                      setViewTab("kline");
                    }}
                  />
                </aside>
                {/* 右側儀錶板 */}
                <div className="flex-1 min-w-0 min-h-0">
                  <HomeDashboard
                    onSelectStock={(sym) => {
                      handleSelectStock(sym, "");
                      setViewTab("kline");
                    }}
                  />
                </div>
              </div>
            )}

            {/* K 線 — 左側資訊欄 + 圖表 */}
            {viewTab === "kline" && (
              <div className="flex h-full min-h-0 overflow-hidden">

                {/* 左側資訊欄（190px，桌面版才顯示）*/}
                <aside
                  className="hidden md:flex flex-col shrink-0 overflow-y-auto border-r"
                  style={{
                    width: "190px",
                    background: "var(--bg-surface)",
                    borderColor: "var(--border)",
                  }}
                >
                  {quote ? (
                    <div className="p-3 flex flex-col gap-4">
                      {/* ① 即時報價 */}
                      <div>
                        <div className="text-[9px] font-bold tracking-widest mb-2"
                             style={{ color: "var(--text-tertiary)", textTransform: "uppercase" }}>
                          即時報價
                        </div>
                        <div className="num font-black"
                             style={{
                               fontSize: "26px",
                               lineHeight: 1,
                               letterSpacing: "-1px",
                               color: quote.change > 0 ? "var(--color-up)" : quote.change < 0 ? "var(--color-down)" : "var(--text-primary)",
                             }}>
                          {quote.price.toFixed(2)}
                        </div>
                        <div className="num mt-1 text-xs font-semibold"
                             style={{
                               color: quote.change > 0 ? "var(--color-up)" : quote.change < 0 ? "var(--color-down)" : "var(--text-secondary)",
                             }}>
                          {quote.change > 0 ? "▲" : quote.change < 0 ? "▼" : "—"}
                          {" "}{Math.abs(quote.change).toFixed(2)}
                          {" "}({quote.change_pct > 0 ? "+" : ""}{quote.change_pct.toFixed(2)}%)
                        </div>
                      </div>

                      {/* ② 今日行情 */}
                      <div>
                        <div className="text-[9px] font-bold tracking-widest mb-2"
                             style={{ color: "var(--text-tertiary)", textTransform: "uppercase" }}>
                          今日行情
                        </div>
                        {[
                          { label: "開盤", value: quote.open?.toFixed(2) ?? "--" },
                          { label: "最高", value: quote.high?.toFixed(2) ?? "--", color: "var(--color-up)" },
                          { label: "最低", value: quote.low?.toFixed(2) ?? "--", color: "var(--color-down)" },
                          { label: "成交量", value: quote.volume ? `${(quote.volume / 1000).toFixed(0)}張` : "--" },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="flex justify-between items-center py-1 border-b"
                               style={{ borderColor: "var(--border)", fontSize: "11.5px" }}>
                            <span style={{ color: "var(--text-tertiary)" }}>{label}</span>
                            <span className="num font-semibold" style={{ color: color ?? "var(--text-primary)" }}>{value}</span>
                          </div>
                        ))}
                      </div>

                      {/* ③ 三大法人（最新一日）*/}
                      {klineChipsData.length > 0 && (() => {
                        const last = klineChipsData[klineChipsData.length - 1];
                        return (
                          <div>
                            <div className="text-[9px] font-bold tracking-widest mb-2"
                                 style={{ color: "var(--text-tertiary)", textTransform: "uppercase" }}>
                              三大法人
                            </div>
                            {[
                              { label: "外資", value: last.foreign_net, color: "#F59E0B" },
                              { label: "投信", value: last.trust_net,   color: "#8B5CF6" },
                              { label: "自營", value: last.dealer_net,  color: "#06B6D4" },
                            ].map(({ label, value, color }) => {
                              const v = value ?? 0;
                              const fmt = v >= 0 ? `+${(v/1e8).toFixed(1)}億` : `${(v/1e8).toFixed(1)}億`;
                              return (
                                <div key={label} className="flex justify-between items-center py-1 border-b"
                                     style={{ borderColor: "var(--border)", fontSize: "11.5px" }}>
                                  <span style={{ color }}>{label}</span>
                                  <span className="num font-semibold"
                                        style={{ color: v >= 0 ? "var(--color-up)" : "var(--color-down)" }}>
                                    {fmt}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}

                      {/* ④ 技術指標快讀 */}
                      {fundamental && (
                        <div>
                          <div className="text-[9px] font-bold tracking-widest mb-2"
                               style={{ color: "var(--text-tertiary)", textTransform: "uppercase" }}>
                            基本面
                          </div>
                          {[
                            { label: "本益比",  value: fundamental.pe_trailing != null ? fundamental.pe_trailing.toFixed(1) : "--" },
                            { label: "EPS",     value: fundamental.eps_trailing != null ? fundamental.eps_trailing.toFixed(2) : "--",
                              color: fundamental.eps_trailing != null && fundamental.eps_trailing >= 0 ? "var(--color-up)" : "var(--color-down)" },
                            { label: "殖利率",  value: fundamental.dividend_yield != null ? `${fundamental.dividend_yield.toFixed(2)}%` : "--" },
                            { label: "Beta",    value: fundamental.beta != null ? fundamental.beta.toFixed(2) : "--" },
                          ].map(({ label, value, color }) => (
                            <div key={label} className="flex justify-between items-center py-1 border-b"
                                 style={{ borderColor: "var(--border)", fontSize: "11.5px" }}>
                              <span style={{ color: "var(--text-tertiary)" }}>{label}</span>
                              <span className="num font-semibold" style={{ color: color ?? "var(--text-primary)" }}>{value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-3 flex flex-col gap-2">
                      {[60, 80, 70, 50, 75, 65].map((w, i) => (
                        <div key={i} className="animate-pulse rounded"
                             style={{ height: "12px", width: `${w}%`, background: "var(--bg-elevated)" }} />
                      ))}
                    </div>
                  )}
                </aside>

                {/* 圖表區 */}
                <div className="flex-1 relative min-w-0 min-h-0">
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
                        patternMarkers={patterns}
                      />
                      {indicators.includes("CHIPS") && klineChipsData.length > 0 && (
                        <div className="pointer-events-none absolute z-10 left-2 flex flex-col"
                             style={{ bottom: "2%", gap: "7.5%" }}>
                          {[
                            { label: "自營", color: "#06B6D4" },
                            { label: "投信", color: "#8B5CF6" },
                            { label: "外資", color: "#F59E0B" },
                          ].map((l) => (
                            <div key={l.label} className="text-[9px] font-semibold"
                                 style={{ color: l.color }}>{l.label}</div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* 籌碼面板（垂直滾動，6 區塊）*/}
            {viewTab === "chips" && (
              <ChipsPanel
                symbol={symbol}
                days={chipsDays}
                onDaysChange={setChipsDays}
              />
            )}

            {/* 熱門排行 */}
            {viewTab === "ranking" && (
              <div className="flex-1 overflow-y-auto">
                <HotRanking onSelectSymbol={(sym) => {
                  handleSelectStock(sym, "");
                  setViewTab("kline");
                }} />
              </div>
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

            {/* 多股比較 */}
            {viewTab === "compare" && (
              <CompareChart initialSymbol={symbol} />
            )}

            {/* 財報/除權息月曆 */}
            {viewTab === "calendar" && (
              <CalendarView />
            )}

          </div>

          {/* 底部 Tab Bar 佔位（手機版推高內容，避免被 fixed bar 遮住） */}
          <div className="md:hidden shrink-0 h-14" />
        </main>
      </div>

      {/* ⚙ 自訂工作區 Modal */}
      {workspaceOpen && (
        <WorkspaceModal
          tabs={tabs}
          onSave={(next) => { reorder(next); }}
          onClose={() => setWorkspaceOpen(false)}
        />
      )}

      {/* ── 底部 Tab Bar（手機版 < 768px 專用）── */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 flex border-t"
        style={{
          background: "var(--bg-surface)",
          borderColor: "var(--border)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          height: "52px",
        }}
      >
        {/* 首頁 */}
        <button
          onClick={() => { setViewTab("home"); setLeftPanelOpen(false); }}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2"
          style={{ color: !leftPanelOpen && viewTab === "home" ? "var(--color-brand)" : "var(--text-tertiary)" }}
          aria-label="首頁"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 9.5L10 3l7 6.5V17a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
            <path d="M7 18v-5h6v5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
          </svg>
          <span className="text-[10px] font-medium">首頁</span>
        </button>

        {/* 走勢圖 */}
        <button
          onClick={() => { setViewTab("kline"); setLeftPanelOpen(false); }}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2"
          style={{ color: !leftPanelOpen && viewTab === "kline" ? "var(--color-brand)" : "var(--text-tertiary)" }}
          aria-label="走勢圖"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <polyline points="2,15 6,9 10,12 14,5 18,8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="text-[10px] font-medium">走勢</span>
        </button>

        {/* 分析 */}
        <button
          onClick={() => { setViewTab("analysis"); setLeftPanelOpen(false); }}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2"
          style={{ color: !leftPanelOpen && viewTab === "analysis" ? "var(--color-brand)" : "var(--text-tertiary)" }}
          aria-label="分析"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M13.5 13.5 L17.5 17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M6.5 9h5M9 6.5v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span className="text-[10px] font-medium">分析</span>
        </button>

        {/* 大盤 */}
        <button
          onClick={() => { setViewTab("market"); setLeftPanelOpen(false); }}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2"
          style={{ color: !leftPanelOpen && viewTab === "market" ? "var(--color-brand)" : "var(--text-tertiary)" }}
          aria-label="大盤"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="2" y="12" width="3" height="6" rx="0.5" fill="currentColor"/>
            <rect x="7" y="8"  width="3" height="10" rx="0.5" fill="currentColor"/>
            <rect x="12" y="4" width="3" height="14" rx="0.5" fill="currentColor"/>
            <rect x="17" y="9" width="1" height="1"  fill="currentColor"/>
          </svg>
          <span className="text-[10px] font-medium">大盤</span>
        </button>

        {/* 選股 */}
        <button
          onClick={() => { setViewTab("screener"); setLeftPanelOpen(false); }}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2"
          style={{ color: !leftPanelOpen && viewTab === "screener" ? "var(--color-brand)" : "var(--text-tertiary)" }}
          aria-label="選股"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 5h14M5 10h10M7 15h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span className="text-[10px] font-medium">選股</span>
        </button>
      </nav>
    </div>

    {/* 🔔 Alert Modal */}
    {alertModalOpen && (
      <AlertModal
        symbol={symbol}
        name={stockName}
        onClose={() => setAlertModalOpen(false)}
      />
    )}
    </>
  );
}
