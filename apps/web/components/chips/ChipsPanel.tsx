"use client";

/**
 * 籌碼面板 — 6 區塊垂直滾動
 *
 * ① 籌碼評分     — 環形進度 + 7 項明細
 * ② 三大法人流量  — 每日買賣超柱狀圖（ChipsChart）
 * ③ 累積持倉走勢  — cumsum 折線圖（lightweight-charts）
 * ④ 外資持股%     — 月趨勢雙軸圖
 * ⑤ 主力券商排行  — 外資分點 / 投信分點 / 隔日沖分點，[5日][10日][20日]
 * ⑥ 融資融券      — MarginChart
 */

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  createChart, LineSeries, ColorType, CrosshairMode,
  type IChartApi, type ISeriesApi, type LineData, type Time,
} from "lightweight-charts";
import {
  getChips, getBrokerChips, getForeignHolding, getMargin,
  type ChipsBar, type ChipsCumulative, type ChipsCumulativePoint,
  type ChipsScore, type ChipsStreakMap, type BrokerChipsResponse,
  type BrokerEntry, type MarginBar, type MarginResponse,
} from "@/lib/api";

const ChipsChart  = dynamic(() => import("@/components/chart/ChipsChart"),  { ssr: false });
const MarginChart = dynamic(() => import("@/components/chart/MarginChart"), { ssr: false });

// ── Design tokens ─────────────────────────────────────────────────────────────
const F_COLOR = "#F59E0B";   // 外資
const T_COLOR = "#8B5CF6";   // 投信
const D_COLOR = "#06B6D4";   // 自營
const TOTAL_COLOR = "#94A3B8";

type ChipsDays = 20 | 60 | 120;
type BrokerDays = 5 | 10 | 20;

// ── Section wrapper ────────────────────────────────────────────────────────────
function Section({ title, children, action }: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
    >
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="text-xs font-bold tracking-widest uppercase"
              style={{ color: "var(--text-tertiary)" }}>
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── ① 籌碼評分 ────────────────────────────────────────────────────────────────
const SCORE_ITEM_ORDER = [
  "foreign_streak", "trust_streak", "dealer_streak",
  "foreign_cumsum", "combined_force", "margin_usage", "short_squeeze",
];

function ScoreRing({ score }: { score: number }) {
  const r = 40;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 70 ? "var(--color-up)" : score >= 40 ? "#F59E0B" : "var(--color-down)";
  return (
    <svg width="100" height="100" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--bg-elevated)" strokeWidth="10" />
      <circle
        cx="50" cy="50" r={r}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeDashoffset={circ * 0.25}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
      <text x="50" y="46" textAnchor="middle" style={{ fill: color, fontSize: "20px", fontWeight: 700, fontFamily: "monospace" }}>
        {score}
      </text>
      <text x="50" y="60" textAnchor="middle" style={{ fill: "var(--text-tertiary)", fontSize: "9px" }}>
        / 100
      </text>
    </svg>
  );
}

function ScoreSection({ score }: { score: ChipsScore }) {
  const labelColor = score.total >= 70 ? "var(--color-up)" : score.total >= 40 ? "#F59E0B" : "var(--color-down)";
  const verdict = score.total >= 70 ? "籌碼偏多" : score.total >= 40 ? "籌碼中性" : "籌碼偏空";

  return (
    <Section title="籌碼評分">
      <div className="flex flex-col sm:flex-row gap-4 p-4">
        {/* Ring */}
        <div className="flex flex-col items-center justify-center shrink-0 gap-1">
          <ScoreRing score={score.total} />
          <span className="text-xs font-bold" style={{ color: labelColor }}>{verdict}</span>
        </div>
        {/* Items */}
        <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-2 content-center">
          {SCORE_ITEM_ORDER.map((key) => {
            const item = score.items[key];
            if (!item) return null;
            const pct = item.max > 0 ? (item.score / item.max) * 100 : 0;
            const barColor = pct >= 70 ? "var(--color-up)" : pct >= 40 ? "#F59E0B" : "var(--color-down)";
            return (
              <div key={key} className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{item.label}</span>
                  <span className="text-[10px] num font-semibold" style={{ color: item.na ? "var(--text-tertiary)" : "var(--text-primary)" }}>
                    {item.score}/{item.max}
                  </span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: barColor, transition: "width 0.5s ease" }}
                  />
                </div>
                <span className="text-[9px]" style={{ color: "var(--text-tertiary)" }}>{item.value}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

// ── ③ 累積持倉走勢圖 ──────────────────────────────────────────────────────────
function CumulativeChart({ series }: { series: ChipsCumulativePoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || series.length === 0) return;
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

    const el = containerRef.current;
    const chart = createChart(el, {
      width: el.clientWidth,
      height: 200,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#94A3B8", fontSize: 11 },
      grid: { vertLines: { color: "rgba(42,48,69,0.4)" }, horzLines: { color: "rgba(42,48,69,0.4)" } },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { borderColor: "#2A3045", timeVisible: false },
      rightPriceScale: { borderColor: "#2A3045" },
    });
    chartRef.current = chart;

    const toTs = (d: string) => Math.floor(new Date(d).getTime() / 1000) as Time;

    const makeLineSeries = (color: string, label: string) => {
      const s = chart.addSeries(LineSeries, {
        color, lineWidth: 2, title: label,
        priceLineVisible: false, lastValueVisible: true,
      });
      return s;
    };

    const fSeries = makeLineSeries(F_COLOR, "外資");
    const tSeries = makeLineSeries(T_COLOR, "投信");
    const dSeries = makeLineSeries(D_COLOR, "自營");
    const totalS  = makeLineSeries(TOTAL_COLOR, "合計");

    fSeries.setData(series.map(p => ({ time: toTs(p.date), value: p.foreign })));
    tSeries.setData(series.map(p => ({ time: toTs(p.date), value: p.trust   })));
    dSeries.setData(series.map(p => ({ time: toTs(p.date), value: p.dealer  })));
    totalS.setData(series.map(p => ({ time: toTs(p.date), value: p.total   })));

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (chartRef.current) chartRef.current.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [series]);

  return (
    <div>
      <div ref={containerRef} />
      <div className="flex items-center gap-4 px-4 pb-3">
        {[{ color: F_COLOR, label: "外資" }, { color: T_COLOR, label: "投信" },
          { color: D_COLOR, label: "自營" }, { color: TOTAL_COLOR, label: "合計" }].map(l => (
          <div key={l.label} className="flex items-center gap-1">
            <div className="w-3 h-0.5 rounded" style={{ background: l.color }} />
            <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ④ 外資持股% 月趨勢 ────────────────────────────────────────────────────────
function ForeignHoldingSection({ symbol }: { symbol: string }) {
  const [data, setData] = useState<{ date: string; holding_pct: number | null; price: number | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);

  useEffect(() => {
    setLoading(true);
    getForeignHolding(symbol)
      .then(r => { if (r.data) setData(r.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [symbol]);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

    const el = containerRef.current;
    const chart = createChart(el, {
      width: el.clientWidth,
      height: 180,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#94A3B8", fontSize: 11 },
      grid: { vertLines: { color: "rgba(42,48,69,0.4)" }, horzLines: { color: "rgba(42,48,69,0.4)" } },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { borderColor: "#2A3045", timeVisible: false },
      leftPriceScale:  { visible: true, borderColor: "#2A3045" },
      rightPriceScale: { visible: true, borderColor: "#2A3045" },
    });
    chartRef.current = chart;

    const toTs = (d: string) => Math.floor(new Date(d + "-01").getTime() / 1000) as Time;

    const pctSeries = chart.addSeries(LineSeries, {
      color: F_COLOR, lineWidth: 2, title: "持股%",
      priceScaleId: "left", priceLineVisible: false,
    });
    const validPct = data.filter(d => d.holding_pct != null);
    pctSeries.setData(validPct.map(d => ({ time: toTs(d.date), value: d.holding_pct! })));

    const validPrice = data.filter(d => d.price != null);
    if (validPrice.length > 0) {
      const priceSeries = chart.addSeries(LineSeries, {
        color: "#60A5FA", lineWidth: 2, title: "股價",
        priceScaleId: "right", priceLineVisible: false, lineStyle: 2,
      });
      priceSeries.setData(validPrice.map(d => ({ time: toTs(d.date), value: d.price! })));
    }

    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      if (chartRef.current) chartRef.current.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [data]);

  return (
    <Section title="外資持股% 月趨勢">
      {loading ? (
        <div className="h-44 flex items-center justify-center">
          <span className="text-xs animate-pulse" style={{ color: "var(--text-tertiary)" }}>載入中…</span>
        </div>
      ) : data.length === 0 ? (
        <div className="h-20 flex items-center justify-center">
          <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>僅台股支援，美股不適用</span>
        </div>
      ) : (
        <div ref={containerRef} />
      )}
    </Section>
  );
}

// ── ⑤ 主力券商排行 ────────────────────────────────────────────────────────────
function BrokerTable({ entries, colorNet = true }: { entries: BrokerEntry[]; colorNet?: boolean }) {
  if (entries.length === 0) {
    return <p className="text-xs px-3 py-2" style={{ color: "var(--text-tertiary)" }}>無資料</p>;
  }
  const maxAbs = Math.max(...entries.map(e => Math.abs(e.net)), 1);
  return (
    <div className="divide-y" style={{ borderColor: "var(--border)" }}>
      {entries.map((e, i) => {
        const pct = Math.abs(e.net) / maxAbs;
        const color = e.net > 0 ? "var(--color-up)" : "var(--color-down)";
        return (
          <div key={i} className="flex items-center gap-2 px-3 py-1.5">
            <span className="text-[10px] w-4 shrink-0 num" style={{ color: "var(--text-tertiary)" }}>{i + 1}</span>
            <span className="flex-1 text-xs truncate" style={{ color: "var(--text-primary)" }}>{e.broker_name}</span>
            {e.pattern && (
              <span className="text-[9px] px-1 rounded shrink-0"
                style={{ background: "rgba(239,68,68,0.12)", color: "var(--color-down)" }}>
                {e.pattern === "known" ? "已知" : `${(e.daytrade_rate * 100).toFixed(0)}%`}
              </span>
            )}
            <div className="w-16 h-1 rounded overflow-hidden shrink-0" style={{ background: "var(--bg-elevated)" }}>
              <div className="h-full rounded" style={{ width: `${pct * 100}%`, background: color }} />
            </div>
            <span className="num text-xs w-14 text-right shrink-0 font-semibold"
                  style={{ color: colorNet ? color : "var(--text-primary)" }}>
              {e.net > 0 ? "+" : ""}{e.net.toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BrokerSection({ symbol }: { symbol: string }) {
  const [days, setDays]     = useState<BrokerDays>(5);
  const [data, setData]     = useState<BrokerChipsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");
  const [subTab, setSubTab] = useState<"general" | "foreign" | "trust" | "daytrade">("general");

  useEffect(() => {
    setLoading(true); setError("");
    getBrokerChips(symbol, days)
      .then(setData)
      .catch(() => setError("分點資料暫無（需 FinMind 進階方案）"))
      .finally(() => setLoading(false));
  }, [symbol, days]);

  const dayBtns: BrokerDays[] = [5, 10, 20];
  const tabs = [
    { id: "general"  as const, label: "綜合" },
    { id: "foreign"  as const, label: "外資分點" },
    { id: "trust"    as const, label: "投信分點" },
    { id: "daytrade" as const, label: "隔日沖" },
  ];

  return (
    <Section
      title="主力券商排行"
      action={
        <div className="flex gap-1">
          {dayBtns.map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className="text-[10px] px-2 py-0.5 rounded"
              style={{
                background: days === d ? "var(--color-brand)" : "var(--bg-elevated)",
                color: days === d ? "#fff" : "var(--text-tertiary)",
              }}
            >
              {d}日
            </button>
          ))}
        </div>
      }
    >
      {/* Sub-tabs */}
      <div className="flex border-b" style={{ borderColor: "var(--border)" }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className="px-3 py-1.5 text-[11px] font-medium transition-colors"
            style={{
              color: subTab === t.id ? "var(--color-brand)" : "var(--text-tertiary)",
              borderBottom: subTab === t.id ? "2px solid var(--color-brand)" : "2px solid transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="py-4 flex items-center justify-center">
          <span className="text-xs animate-pulse" style={{ color: "var(--text-tertiary)" }}>載入分點資料…</span>
        </div>
      )}
      {error && (
        <p className="text-xs px-3 py-3" style={{ color: "var(--text-tertiary)" }}>{error}</p>
      )}
      {!loading && !error && data && (
        <>
          {(subTab === "general" || subTab === "foreign" || subTab === "trust") && (
            <div className="grid grid-cols-2 divide-x" style={{ borderColor: "var(--border)" }}>
              <div>
                <p className="text-[9px] px-3 pt-2 pb-1 font-bold tracking-widest"
                   style={{ color: "var(--color-up)" }}>▲ 買超 TOP5</p>
                <BrokerTable entries={data[subTab].top_buy} />
              </div>
              <div>
                <p className="text-[9px] px-3 pt-2 pb-1 font-bold tracking-widest"
                   style={{ color: "var(--color-down)" }}>▼ 賣超 TOP5</p>
                <BrokerTable entries={data[subTab].top_sell} />
              </div>
            </div>
          )}
          {subTab === "daytrade" && (
            <div>
              <p className="text-[9px] px-3 pt-2 pb-1" style={{ color: "var(--text-tertiary)" }}>
                已知隔日沖分點 + 演算法偵測（逆轉率 &gt; 45%）
              </p>
              <BrokerTable entries={data.daytrade} colorNet={false} />
            </div>
          )}
        </>
      )}
    </Section>
  );
}

// ── Main ChipsPanel ────────────────────────────────────────────────────────────
interface ChipsPanelProps {
  symbol:   string;
  days?:    ChipsDays;
  onDaysChange?: (d: ChipsDays) => void;
}

export default function ChipsPanel({ symbol, days = 60, onDaysChange }: ChipsPanelProps) {
  const [chipsData,   setChipsData]   = useState<ChipsBar[]>([]);
  const [cumul,       setCumul]       = useState<ChipsCumulative | null>(null);
  const [cumulSeries, setCumulSeries] = useState<ChipsCumulativePoint[]>([]);
  const [streak,      setStreak]      = useState<ChipsStreakMap | null>(null);
  const [score,       setScore]       = useState<ChipsScore | null>(null);
  const [marginData,   setMarginData]   = useState<MarginBar[]>([]);
  const [marginLatest, setMarginLatest] = useState<MarginResponse["latest"]>(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState("");

  const load = useCallback(async (sym: string, d: number) => {
    setLoading(true); setError("");
    try {
      const [chips, margin] = await Promise.all([
        getChips(sym, d),
        getMargin(sym, d).catch(() => ({ data: [] })),
      ]);
      setChipsData(chips.data);
      setCumul(chips.cumulative);
      setCumulSeries(chips.cumulative_series ?? []);
      setStreak(chips.streak);
      setScore(chips.score ?? null);
      const mg = margin as MarginResponse;
      setMarginData(mg.data ?? []);
      setMarginLatest(mg.latest ?? null);
    } catch {
      setError("無法載入籌碼資料");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(symbol, days); }, [symbol, days, load]);

  const dayBtns: ChipsDays[] = [20, 60, 120];

  if (loading && chipsData.length === 0) {
    return (
      <div className="flex items-center justify-center h-32">
        <span className="text-sm animate-pulse" style={{ color: "var(--text-tertiary)" }}>載入籌碼資料…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center justify-center h-32">
        <span className="text-sm" style={{ color: "var(--color-down)" }}>{error}</span>
      </div>
    );
  }

  return (
    <div
      className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3"
      style={{ background: "var(--bg-elevated)" }}
    >
      {/* 日期範圍選擇器 */}
      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>期間</span>
        <div className="flex gap-1">
          {dayBtns.map(d => (
            <button
              key={d}
              onClick={() => onDaysChange?.(d)}
              className="text-xs px-3 py-1 rounded font-medium transition-colors"
              style={{
                background: days === d ? "var(--bg-surface)" : "transparent",
                color: days === d ? "var(--text-primary)" : "var(--text-secondary)",
                border: `1px solid ${days === d ? "var(--border-strong)" : "var(--border)"}`,
              }}
            >
              {d}日
            </button>
          ))}
        </div>
      </div>

      {/* ① 籌碼評分 */}
      {score && <ScoreSection score={score} />}

      {/* ② 三大法人流量 */}
      {chipsData.length > 0 && cumul && (
        <Section title="三大法人 · 每日買賣超">
          <div style={{ height: "220px" }}>
            <ChipsChart data={chipsData} cumulative={cumul} />
          </div>
        </Section>
      )}

      {/* ③ 累積持倉走勢 */}
      {cumulSeries.length > 0 && (
        <Section title="累積持倉走勢（期間內 cumsum）">
          <CumulativeChart series={cumulSeries} />
        </Section>
      )}

      {/* ④ 外資持股% 月趨勢 */}
      <ForeignHoldingSection symbol={symbol} />

      {/* ⑤ 主力券商排行 */}
      <BrokerSection symbol={symbol} />

      {/* ⑥ 融資融券 */}
      {marginData.length > 0 && (
        <Section title="融資融券">
          <div style={{ height: "200px" }}>
            <MarginChart data={marginData} latest={marginLatest} />
          </div>
        </Section>
      )}
    </div>
  );
}
