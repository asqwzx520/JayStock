"use client";

import { useState, useEffect } from "react";
import type {
  TechnicalSummary,
  FundamentalData,
  FinancialsData,
  AnnualFinancial,
  MonthlyRevenueItem,
  MonthlyRevenueResponse,
  ValuationBandStats,
  ValuationBandResponse,
  PeerRow,
  PeerComparisonResponse,
  ForeignHoldingItem,
  ForeignHoldingResponse,
  DividendHistoryResponse,
} from "@/lib/api";
import { getTechnical, getFundamental, getFinancials, getMonthlyRevenue, getValuationBand, getPeerComparison, getForeignHolding, getDividendHistory, getAiAnalysis, getEarnings, getVolumeProfile, getFinancialAlerts } from "@/lib/api";
import type { AiAnalysisResponse, EarningsResponse, VolumeProfileResponse, FinancialAlertsResponse, FinancialAlert } from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v: number | null | undefined, digits = 1) {
  if (v == null) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}
function fmt(v: number | null | undefined, digits = 2) {
  if (v == null) return "—";
  return v.toFixed(digits);
}

function updown(v: number | null | undefined): string {
  if (v == null) return "var(--text-primary)";
  return v >= 0 ? "var(--color-up)" : "var(--color-down)";
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
      <div className="px-4 py-2.5 border-b text-xs font-bold tracking-wide uppercase" style={{ borderColor: "var(--border)", color: "var(--text-tertiary)", background: "var(--bg-elevated)" }}>
        {title}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function MetricRow({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "var(--border)" }}>
      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>{label}</span>
      <div className="text-right">
        <span className="text-xs num font-medium" style={{ color: color ?? "var(--text-primary)" }}>{value}</span>
        {sub && <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{sub}</div>}
      </div>
    </div>
  );
}

// ── Signal Badge ──────────────────────────────────────────────────────────────

const SIGNAL_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  golden_cross: { label: "黃金叉 ✅", color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  death_cross:  { label: "死亡叉 ❌", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  bullish:      { label: "多方",    color: "#22c55e", bg: "rgba(34,197,94,0.10)" },
  bearish:      { label: "空方",    color: "#ef4444", bg: "rgba(239,68,68,0.10)" },
  overbought:   { label: "超買 ⚠️", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  oversold:     { label: "超賣 💡", color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  strong:       { label: "強勢",    color: "#22c55e", bg: "rgba(34,197,94,0.10)" },
  weak:         { label: "弱勢",    color: "#ef4444", bg: "rgba(239,68,68,0.10)" },
  high:         { label: "放量 🔥", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  above_avg:    { label: "量增",    color: "#22c55e", bg: "rgba(34,197,94,0.10)" },
  normal:       { label: "正常",    color: "#6b7280", bg: "rgba(107,114,128,0.10)" },
  low:          { label: "量縮",    color: "#ef4444", bg: "rgba(239,68,68,0.10)" },
  strong_bull:  { label: "強多排列 🚀", color: "#22c55e", bg: "rgba(34,197,94,0.15)" },
  bull:         { label: "多頭排列",  color: "#22c55e", bg: "rgba(34,197,94,0.10)" },
  neutral:      { label: "中性",    color: "#6b7280", bg: "rgba(107,114,128,0.10)" },
  bear:         { label: "空頭排列",  color: "#ef4444", bg: "rgba(239,68,68,0.10)" },
  strong_bear:  { label: "強空排列 📉", color: "#ef4444", bg: "rgba(239,68,68,0.15)" },
};

function SignalBadge({ signal }: { signal: string | null | undefined }) {
  if (!signal) return <span style={{ color: "var(--text-tertiary)" }}>—</span>;
  const s = SIGNAL_LABELS[signal] ?? { label: signal, color: "var(--text-secondary)", bg: "var(--bg-elevated)" };
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ color: s.color, background: s.bg }}>
      {s.label}
    </span>
  );
}

// ── AI Analysis Section ───────────────────────────────────────────────────────

function AiAnalysisSection({ symbol }: { symbol: string }) {
  const [data,    setData]    = useState<AiAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [shown,   setShown]   = useState(false);

  const load = () => {
    if (loading) return;
    setShown(true);
    setLoading(true);
    setError(null);
    getAiAnalysis(symbol)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  // Reset when symbol changes
  useEffect(() => { setData(null); setError(null); setShown(false); }, [symbol]);

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}
    >
      <div
        className="px-4 py-2.5 border-b flex items-center justify-between"
        style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
      >
        <span className="text-xs font-bold tracking-wide uppercase" style={{ color: "var(--text-tertiary)" }}>
          🤖 AI 技術分析解讀
        </span>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1 rounded text-xs font-semibold transition-colors"
          style={{
            background: loading ? "var(--bg-elevated)" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
            color:      loading ? "var(--text-tertiary)" : "#fff",
            border:     "1px solid transparent",
            cursor:     loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "生成中..." : data ? "重新生成" : "✨ 生成 AI 解讀"}
        </button>
      </div>

      <div className="p-4">
        {!shown && !data && (
          <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            點擊「生成 AI 解讀」，Gemini 將結合 RSI / MACD / MA / 法人籌碼，
            自動生成這檔股票的繁體中文技術分析段落。
          </p>
        )}
        {loading && (
          <div className="space-y-2">
            {[80, 100, 65, 90, 75].map((w, i) => (
              <div
                key={i}
                className="animate-pulse rounded h-3"
                style={{ width: `${w}%`, background: "var(--bg-elevated)", animationDelay: `${i * 60}ms` }}
              />
            ))}
          </div>
        )}
        {error && (
          <p className="text-xs" style={{ color: "var(--color-down)" }}>
            生成失敗：{error}（請稍後再試）
          </p>
        )}
        {data && !loading && (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>
              {data.analysis}
            </p>
            <div className="pt-2 border-t flex flex-wrap gap-3 text-[10px]" style={{ borderColor: "var(--border)", color: "var(--text-tertiary)" }}>
              {data.meta.rsi14 != null && (
                <span>RSI: <span className="num" style={{ color: "var(--text-secondary)" }}>{data.meta.rsi14}</span></span>
              )}
              <span>量比: <span className="num" style={{ color: "var(--text-secondary)" }}>{data.meta.vol_ratio}x</span></span>
              {data.meta.ma_above.length > 0 && (
                <span>站上: <span style={{ color: "var(--color-up)" }}>{data.meta.ma_above.join(" / ")}</span></span>
              )}
              <span className="ml-auto">由 Gemini 1.5 Flash 生成・僅供參考</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Earnings Surprise Section ─────────────────────────────────────────────────

function EarningsSurpriseSection({
  data,
  loading,
  error,
}: {
  data:    EarningsResponse | null;
  loading: boolean;
  error:   string | null;
}) {
  if (loading) return <Loading msg="從 Yahoo Finance 載入盈餘數據中..." />;
  if (error)   return <Err msg={error} />;
  if (!data)   return null;

  const surps = data.quarterly_surprise.filter(s => s.eps_actual != null);
  if (!surps.length) {
    return (
      <Section title="📣 Earnings Surprise">
        <p className="text-xs py-2" style={{ color: "var(--text-tertiary)" }}>
          {data.message ?? "暫無季度盈餘數據（可能為非上市公司或 yfinance 資料不足）"}
        </p>
      </Section>
    );
  }

  const maxAbs = Math.max(...surps.map(s => Math.abs(s.eps_actual ?? 0)), 0.01);

  return (
    <Section title="📣 Earnings Surprise（EPS 預估 vs 實際）">
      {data.message && (
        <p className="text-[10px] mb-3 rounded px-2 py-1.5" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
          ℹ️ {data.message}
        </p>
      )}

      {/* Bar chart for EPS actual */}
      <div className="mb-4">
        <div className="text-[10px] mb-2" style={{ color: "var(--text-tertiary)" }}>
          實際 EPS（{data.currency}）
        </div>
        <div className="flex items-end gap-1.5" style={{ height: 80 }}>
          {surps.slice(-8).map((s) => {
            const v  = s.eps_actual ?? 0;
            const h  = Math.max(2, (Math.abs(v) / maxAbs) * 64);
            const up = v >= 0;
            const surpColor =
              s.surprise_pct != null
                ? s.surprise_pct > 5   ? "var(--color-up)"
                : s.surprise_pct < -5  ? "var(--color-down)"
                : "var(--text-secondary)"
                : "var(--text-secondary)";
            return (
              <div key={s.date} className="flex flex-col items-center flex-1 gap-0.5 min-w-0">
                {s.surprise_pct != null && (
                  <div className="text-[8px] num font-bold" style={{ color: surpColor }}>
                    {s.surprise_pct > 0 ? "+" : ""}{s.surprise_pct.toFixed(0)}%
                  </div>
                )}
                <div
                  className="w-full rounded-t"
                  style={{ height: h, background: up ? "var(--color-up)" : "var(--color-down)", opacity: 0.82, minHeight: 2 }}
                  title={`EPS: ${v.toFixed(3)}\n預估: ${s.eps_estimate ?? "—"}\nSurprise: ${s.surprise_pct != null ? s.surprise_pct.toFixed(1) + "%" : "—"}`}
                />
                <div className="text-[8px] num" style={{ color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                  {s.date.slice(0, 7)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 mt-2 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          <span><span style={{ color: "var(--color-up)" }}>■</span> 正 EPS</span>
          <span><span style={{ color: "var(--color-down)" }}>■</span> 負 EPS</span>
          {data.has_estimates && (
            <span>柱頂數字 = Surprise %（+超預期 / -低於預期）</span>
          )}
        </div>
      </div>

      {/* Detail table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ minWidth: 360 }}>
          <thead>
            <tr>
              {["日期", "實際 EPS", data.has_estimates ? "分析師預估" : null, data.has_estimates ? "驚喜幅度" : null]
                .filter(Boolean)
                .map(h => (
                  <th key={h!} className="px-2 py-1.5 text-left" style={{ color: "var(--text-tertiary)", borderBottom: "1px solid var(--border)" }}>
                    {h}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {surps.slice(0, 8).map((s, i) => {
              const surpColor =
                s.surprise_pct != null
                  ? s.surprise_pct > 5   ? "var(--color-up)"
                  : s.surprise_pct < -5  ? "var(--color-down)"
                  : "var(--text-secondary)"
                  : "var(--text-secondary)";
              return (
                <tr key={s.date} style={{ borderBottom: "1px solid var(--border)", background: i % 2 ? "var(--bg-elevated)" : "transparent" }}>
                  <td className="px-2 py-1.5 num text-[11px]" style={{ color: "var(--text-tertiary)" }}>{s.date}</td>
                  <td className="px-2 py-1.5 num font-medium" style={{ color: (s.eps_actual ?? 0) >= 0 ? "var(--color-up)" : "var(--color-down)" }}>
                    {s.eps_actual != null ? s.eps_actual.toFixed(3) : "—"}
                  </td>
                  {data.has_estimates && (
                    <td className="px-2 py-1.5 num" style={{ color: "var(--text-secondary)" }}>
                      {s.eps_estimate != null ? s.eps_estimate.toFixed(3) : "—"}
                    </td>
                  )}
                  {data.has_estimates && (
                    <td className="px-2 py-1.5 num font-semibold" style={{ color: surpColor }}>
                      {s.surprise_pct != null ? `${s.surprise_pct > 0 ? "+" : ""}${s.surprise_pct.toFixed(1)}%` : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
        資料來源：Yahoo Finance earnings_dates｜Surprise = (實際 - 預估) / |預估|
      </div>
    </Section>
  );
}

// ── Volume Profile Section ────────────────────────────────────────────────────

const VP_PERIODS = [
  { id: "1m", label: "1M" },
  { id: "3m", label: "3M" },
  { id: "6m", label: "6M" },
  { id: "1y", label: "1Y" },
  { id: "2y", label: "2Y" },
];

function VolumeProfileSection({ symbol }: { symbol: string }) {
  const [vpPeriod, setVpPeriod] = useState("3m");
  const [data,     setData]     = useState<VolumeProfileResponse | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const load = (sym: string, per: string) => {
    setLoading(true); setError(null);
    getVolumeProfile(sym, per)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { setData(null); setError(null); load(symbol, vpPeriod); }, [symbol]);
  useEffect(() => { if (data !== null || loading) load(symbol, vpPeriod); }, [vpPeriod]);

  const W_BAR_MAX = 200;   // max SVG bar width in px

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
      {/* Header */}
      <div className="px-4 py-2.5 border-b flex items-center justify-between" style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}>
        <span className="text-xs font-bold tracking-wide uppercase" style={{ color: "var(--text-tertiary)" }}>
          📊 Volume Profile（價位成交量分佈）
        </span>
        {/* Period selector */}
        <div className="flex items-center gap-0.5 rounded p-0.5" style={{ background: "var(--bg-surface)" }}>
          {VP_PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setVpPeriod(p.id)}
              className="px-2 py-0.5 rounded text-[10px] font-medium"
              style={{
                background: vpPeriod === p.id ? "var(--color-brand)" : "transparent",
                color:      vpPeriod === p.id ? "#fff" : "var(--text-secondary)",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {loading && (
          <div className="space-y-1">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="animate-pulse rounded h-2.5 shrink-0" style={{ width: 40, background: "var(--bg-elevated)" }} />
                <div className="animate-pulse rounded h-2.5" style={{ width: `${30 + Math.sin(i) * 20}%`, background: "var(--bg-elevated)", animationDelay: `${i * 40}ms` }} />
              </div>
            ))}
          </div>
        )}
        {error && <p className="text-xs" style={{ color: "var(--color-down)" }}>載入失敗：{error}</p>}
        {data && !loading && (() => {
          // Only render top 30 bins sorted by price descending (high → low)
          const sortedBins = [...data.bins].sort((a, b) => b.price - a.price);
          const visibleBins = sortedBins.length > 40
            ? sortedBins.filter((_, i) => i % Math.ceil(sortedBins.length / 40) === 0)
            : sortedBins;

          const priceColor = (bin: typeof data.bins[0]) => {
            if (bin.is_poc) return "#f59e0b";
            if (bin.in_va)  return "rgba(59,130,246,0.75)";
            return "rgba(107,114,128,0.5)";
          };

          const currentInBin = (bin: typeof data.bins[0]) =>
            data.current_price >= bin.price_low && data.current_price < bin.price_high;

          return (
            <div className="space-y-4">
              {/* Key levels */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "VAH 價值區上緣", value: data.vah, color: "#22c55e" },
                  { label: "POC 最大量價位", value: data.poc, color: "#f59e0b" },
                  { label: "VAL 價值區下緣", value: data.val, color: "#ef4444" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="rounded-lg p-2.5 text-center" style={{ background: "var(--bg-elevated)" }}>
                    <div className="text-[9px] mb-1" style={{ color: "var(--text-tertiary)" }}>{label}</div>
                    <div className="text-sm num font-bold" style={{ color }}>{value.toLocaleString()}</div>
                    {data.current_price > 0 && (
                      <div className="text-[9px] num mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                        {((value - data.current_price) / data.current_price * 100) >= 0 ? "+" : ""}
                        {((value - data.current_price) / data.current_price * 100).toFixed(1)}%
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Horizontal bar chart */}
              <div className="space-y-0.5">
                {visibleBins.map((bin) => {
                  const isCurrent = currentInBin(bin);
                  const barW = Math.round(bin.volume_pct * W_BAR_MAX);
                  return (
                    <div
                      key={bin.price}
                      className="flex items-center gap-1.5"
                      style={{ background: isCurrent ? "rgba(255,255,255,0.04)" : undefined, borderRadius: 2 }}
                    >
                      {/* Price label */}
                      <div
                        className="text-[9px] num shrink-0 text-right"
                        style={{ width: 46, color: bin.is_poc ? "#f59e0b" : isCurrent ? "var(--color-brand)" : "var(--text-tertiary)" }}
                      >
                        {bin.price.toLocaleString()}
                      </div>

                      {/* Bar */}
                      <div style={{ width: W_BAR_MAX, position: "relative", height: 8 }}>
                        <div
                          style={{
                            height: "100%",
                            width: barW,
                            background: priceColor(bin),
                            borderRadius: 1,
                            transition: "width 0.2s",
                          }}
                        />
                      </div>

                      {/* Current price marker + special labels */}
                      <div className="text-[8px] shrink-0" style={{ color: "var(--text-tertiary)", minWidth: 32 }}>
                        {bin.is_poc && <span style={{ color: "#f59e0b" }}>◄POC</span>}
                        {isCurrent && !bin.is_poc && <span style={{ color: "var(--color-brand)" }}>◄現價</span>}
                        {data.current_price === data.vah && bin.price === data.vah && !bin.is_poc && <span style={{ color: "#22c55e" }}>◄VAH</span>}
                        {data.current_price === data.val && bin.price === data.val && !bin.is_poc && <span style={{ color: "#ef4444" }}>◄VAL</span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Legend */}
              <div className="flex flex-wrap items-center gap-3 text-[10px] pt-2 border-t" style={{ borderColor: "var(--border)", color: "var(--text-tertiary)" }}>
                <span><span style={{ color: "#f59e0b" }}>■</span> POC（最大量）</span>
                <span><span style={{ color: "rgba(59,130,246,0.9)" }}>■</span> 價值區（70% 成交量）</span>
                <span><span style={{ color: "rgba(107,114,128,0.9)" }}>■</span> 非價值區</span>
                <span className="ml-auto">共 {data.n_bars} 根 K 棒 · {data.period.toUpperCase()} 區間</span>
              </div>

              <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                POC 為主力成本密集區，常作支撐/壓力參考。VAH/VAL 為價值區上下緣，突破視為強勢。
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── Financial Alerts Section ──────────────────────────────────────────────────

function FinancialAlertsSection({
  data,
  loading,
  error,
}: {
  data:    FinancialAlertsResponse | null;
  loading: boolean;
  error:   string | null;
}) {
  if (loading) return <Loading msg="分析財報異常中..." />;
  if (error)   return <Err msg={error} />;
  if (!data)   return null;

  if (!data.alerts.length) {
    return (
      <Section title="🔍 財報異常警示">
        <div className="flex items-center gap-2 py-2">
          <span className="text-sm">✅</span>
          <p className="text-xs" style={{ color: "var(--color-up)" }}>
            未發現明顯財報異常（應收/存貨比率正常、無連續獲利衰退）
          </p>
        </div>
      </Section>
    );
  }

  const severityConfig = {
    danger:  { border: "var(--color-down)", bg: "rgba(239,68,68,0.08)",  icon: "🔴" },
    warning: { border: "#f59e0b",           bg: "rgba(245,158,11,0.08)", icon: "⚠️" },
  };

  function AlertCard({ alert }: { alert: FinancialAlert }) {
    const cfg = severityConfig[alert.severity];
    return (
      <div
        className="rounded-lg p-3 space-y-2"
        style={{ border: `1px solid ${cfg.border}`, background: cfg.bg }}
      >
        <div className="text-xs font-semibold" style={{ color: alert.severity === "danger" ? "var(--color-down)" : "#f59e0b" }}>
          {alert.title}
        </div>
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {alert.detail}
        </p>
        {alert.data.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1">
            {alert.data.map((d) => (
              <span
                key={d.year}
                className="text-[9px] num px-1.5 py-0.5 rounded"
                style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
              >
                {d.year}：{
                  "value" in d && d.value != null ? `${d.value}${alert.unit !== "原幣" && alert.unit !== "億" ? alert.unit : ""}` :
                  "fcf_ratio" in d && d.fcf_ratio != null ? `FCF/NI ${d.fcf_ratio}%` :
                  "—"
                }
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  const dangers  = data.alerts.filter(a => a.severity === "danger");
  const warnings = data.alerts.filter(a => a.severity === "warning");

  return (
    <Section title={`🔍 財報異常警示（${data.alert_count} 項）`}>
      <div className="space-y-3">
        {dangers.length > 0 && (
          <div className="space-y-2">
            {dangers.map(a => <AlertCard key={a.id} alert={a} />)}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="space-y-2">
            {warnings.map(a => <AlertCard key={a.id} alert={a} />)}
          </div>
        )}
        <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          {data.note}。財報異常僅供參考，需結合產業背景綜合判斷。
        </p>
      </div>
    </Section>
  );
}

// ── Technical Section ─────────────────────────────────────────────────────────

function TechSection({ data }: { data: TechnicalSummary }) {
  const perf = data.performance;
  const perfEntries: [string, number | null][] = [
    ["1 週", perf["1w"]], ["1 月", perf["1m"]], ["3 月", perf["3m"]],
    ["6 月", perf["6m"]], ["1 年", perf["1y"]],
  ];

  const w52pos = data.week52.position;
  const posBarW = Math.round(w52pos * 100);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Indicators */}
      <Section title="技術指標信號">
        <div className="space-y-1">
          <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "var(--border)" }}>
            <div>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>RSI (14)</span>
              <span className="num text-xs ml-2" style={{ color: data.rsi.value != null && data.rsi.value < 30 ? "#3b82f6" : data.rsi.value != null && data.rsi.value > 70 ? "#f59e0b" : "var(--text-primary)" }}>
                {data.rsi.value != null ? data.rsi.value.toFixed(1) : "—"}
              </span>
            </div>
            <SignalBadge signal={data.rsi.signal} />
          </div>
          <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "var(--border)" }}>
            <div>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>MACD</span>
              <span className="num text-xs ml-2" style={{ color: data.macd.histogram != null ? (data.macd.histogram >= 0 ? "var(--color-up)" : "var(--color-down)") : "var(--text-primary)" }}>
                {data.macd.histogram != null ? (data.macd.histogram >= 0 ? "+" : "") + data.macd.histogram.toFixed(2) : "—"}
              </span>
            </div>
            <SignalBadge signal={data.macd.signal} />
          </div>
          <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "var(--border)" }}>
            <div>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>KD</span>
              <span className="num text-xs ml-2" style={{ color: "var(--text-primary)" }}>
                K {data.kd.k != null ? data.kd.k.toFixed(0) : "—"} / D {data.kd.d != null ? data.kd.d.toFixed(0) : "—"}
              </span>
            </div>
            <SignalBadge signal={data.kd.signal} />
          </div>
          <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "var(--border)" }}>
            <div>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>MA 排列</span>
              <span className="text-xs ml-2" style={{ color: "var(--text-tertiary)" }}>
                {data.ma.above_count}MA 之上
              </span>
            </div>
            <SignalBadge signal={data.ma.alignment} />
          </div>
          <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "var(--border)" }}>
            <div>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>成交量比</span>
              <span className="num text-xs ml-2" style={{ color: "var(--text-primary)" }}>
                {data.volume.ratio.toFixed(2)}x
              </span>
            </div>
            <SignalBadge signal={data.volume.signal} />
          </div>
          <div className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: "var(--border)" }}>
            <div>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>布林 %B</span>
              <span className="num text-xs ml-2" style={{ color: "var(--text-primary)" }}>
                {data.bollinger.pct_b != null ? (data.bollinger.pct_b * 100).toFixed(0) + "%" : "—"}
              </span>
            </div>
            <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
              {data.bollinger.lower?.toLocaleString()} – {data.bollinger.upper?.toLocaleString()}
            </span>
          </div>
        </div>
      </Section>

      {/* Price position + performance */}
      <div className="flex flex-col gap-4">
        {/* 52W gauge */}
        <Section title="52 週價格位置">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="num" style={{ color: "var(--color-down)" }}>{data.week52.low.toLocaleString()}</span>
              <span className="num font-bold" style={{ color: "var(--color-brand)" }}>{data.price.toLocaleString()}</span>
              <span className="num" style={{ color: "var(--color-up)" }}>{data.week52.high.toLocaleString()}</span>
            </div>
            <div className="relative h-3 rounded-full overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${posBarW}%`, background: "linear-gradient(90deg, #22c55e, #ef4444)" }} />
              <div className="absolute inset-y-0" style={{ left: `${posBarW}%`, width: 2, background: "#fff", transform: "translateX(-50%)" }} />
            </div>
            <div className="text-center text-xs num" style={{ color: "var(--text-secondary)" }}>
              位於 52W 區間 {posBarW}% 位置
            </div>
          </div>

          {/* Support/Resistance */}
          <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-[10px] mb-1" style={{ color: "var(--text-tertiary)" }}>支撐</div>
                {data.support_resistance.support_levels.map((v, i) => (
                  <div key={i} className="num" style={{ color: "var(--color-down)" }}>{v.toLocaleString()}</div>
                ))}
              </div>
              <div>
                <div className="text-[10px] mb-1" style={{ color: "var(--text-tertiary)" }}>壓力</div>
                {data.support_resistance.resistance_levels.map((v, i) => (
                  <div key={i} className="num" style={{ color: "var(--color-up)" }}>{v.toLocaleString()}</div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* Performance */}
        <Section title="價格績效">
          <div className="grid grid-cols-5 gap-1">
            {perfEntries.map(([label, v]) => (
              <div key={label} className="text-center py-2 rounded" style={{ background: "var(--bg-elevated)" }}>
                <div className="text-[10px] mb-0.5" style={{ color: "var(--text-tertiary)" }}>{label}</div>
                <div className="text-xs num font-semibold" style={{ color: updown(v) }}>
                  {v != null ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : "—"}
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* MA Table */}
      <div className="lg:col-span-2">
        <Section title="均線位置">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {([5, 10, 20, 60, 120, 240] as const).map(p => {
              const key = `ma${p}` as keyof typeof data.ma;
              const val = data.ma[key] as number | null;
              const diff = val ? ((data.price - val) / val) : null;
              return (
                <div key={p} className="rounded-lg p-2 text-center" style={{ background: "var(--bg-elevated)", border: `1px solid ${diff != null && diff >= 0 ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}` }}>
                  <div className="text-[10px] mb-0.5" style={{ color: "var(--text-tertiary)" }}>MA{p}</div>
                  <div className="text-xs num font-medium">{val ? val.toLocaleString() : "—"}</div>
                  {diff != null && (
                    <div className="text-[10px] num" style={{ color: updown(diff) }}>
                      {diff >= 0 ? "+" : ""}{(diff * 100).toFixed(1)}%
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );
}

// ── Fundamental Section ───────────────────────────────────────────────────────

function FundSection({ data }: { data: FundamentalData }) {
  const recColor: Record<string, string> = {
    buy: "#22c55e", "strong buy": "#16a34a",
    hold: "#f59e0b", sell: "#ef4444", "strong sell": "#dc2626",
  };
  const recLabel: Record<string, string> = {
    buy: "買入", "strong buy": "強力買入",
    hold: "持有", sell: "賣出", "strong sell": "強力賣出",
  };
  const rec = data.analyst_recommendation?.toLowerCase();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {/* 估值 */}
      <Section title="📊 估值">
        <MetricRow label="本益比 (P/E)"       value={fmt(data.pe_trailing)}  />
        <MetricRow label="預估本益比"          value={fmt(data.pe_forward)}   />
        <MetricRow label="股價淨值比 (P/B)"    value={fmt(data.pb_ratio)}    />
        <MetricRow label="股價營收比 (P/S)"    value={fmt(data.ps_ratio)}    />
        <MetricRow label="EV/EBITDA"          value={fmt(data.ev_ebitda)}   />
        <MetricRow label="PEG"                value={fmt(data.peg_ratio)}   />
        <MetricRow label="市值"               value={data.market_cap_fmt ?? "—"} />
      </Section>

      {/* 盈利能力 */}
      <Section title="💰 盈利能力">
        <MetricRow label="ROE（股東權益報酬）"  value={pct(data.roe)}          color={data.roe && data.roe >= 0.15 ? "var(--color-up)" : undefined} />
        <MetricRow label="ROA（資產報酬率）"    value={pct(data.roa)}          color={data.roa && data.roa >= 0.05 ? "var(--color-up)" : undefined} />
        <MetricRow label="毛利率"              value={pct(data.gross_margin)} color={data.gross_margin && data.gross_margin >= 0.3 ? "var(--color-up)" : undefined} />
        <MetricRow label="營業利益率"          value={pct(data.operating_margin)} />
        <MetricRow label="淨利率"              value={pct(data.profit_margin)} color={data.profit_margin && data.profit_margin >= 0.1 ? "var(--color-up)" : undefined} />
        <MetricRow label="EPS (TTM)"          value={fmt(data.eps_trailing)} />
        <MetricRow label="預估 EPS"           value={fmt(data.eps_forward)}  />
      </Section>

      {/* 財務健康 */}
      <Section title="🏦 財務健康">
        <MetricRow label="負債/股東權益"       value={fmt(data.debt_to_equity)} color={data.debt_to_equity && data.debt_to_equity > 2 ? "var(--color-down)" : undefined} />
        <MetricRow label="流動比率"            value={fmt(data.current_ratio)}  color={data.current_ratio && data.current_ratio >= 2 ? "var(--color-up)" : undefined} />
        <MetricRow label="速動比率"            value={fmt(data.quick_ratio)}    />
        <MetricRow label="營收成長 YoY"        value={pct(data.revenue_growth)} color={updown(data.revenue_growth)} />
        <MetricRow label="獲利成長 YoY"        value={pct(data.earnings_growth)} color={updown(data.earnings_growth)} />
        <MetricRow label="Beta"               value={fmt(data.beta)}           />
        <MetricRow label="產業"               value={data.industry ?? "—"}     />
      </Section>

      {/* 股利 */}
      <Section title="💵 股利">
        <MetricRow label="殖利率"              value={data.dividend_yield != null ? `${data.dividend_yield.toFixed(2)}%` : "—"} color={data.dividend_yield && data.dividend_yield >= 4 ? "var(--color-up)" : undefined} />
        <MetricRow label="每股股利"            value={fmt(data.dividend_rate)} />
        <MetricRow label="配息率"              value={pct(data.payout_ratio)}  />
      </Section>

      {/* 分析師 */}
      <Section title="🎯 分析師共識">
        {rec && (
          <div className="flex items-center justify-between mb-3 pb-3 border-b" style={{ borderColor: "var(--border)" }}>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>評級</span>
            <span
              className="text-xs font-bold px-2 py-0.5 rounded"
              style={{ color: recColor[rec] ?? "var(--text-primary)", background: `${recColor[rec] ?? "#6b7280"}22` }}
            >
              {recLabel[rec] ?? data.analyst_recommendation}
            </span>
          </div>
        )}
        <MetricRow
          label="目標均價"
          value={data.analyst_target ? data.analyst_target.toLocaleString() : "—"}
          sub={data.analyst_target_upside != null ? `${data.analyst_target_upside >= 0 ? "+" : ""}${data.analyst_target_upside.toFixed(1)}% 空間` : undefined}
          color={data.analyst_target_upside != null ? updown(data.analyst_target_upside) : undefined}
        />
        <MetricRow label="覆蓋分析師數" value={data.analyst_count ? `${data.analyst_count} 位` : "—"} />
      </Section>

      {/* 公司簡介 */}
      <Section title="🏢 公司資訊">
        <MetricRow label="產業"   value={data.sector   ?? "—"} />
        <MetricRow label="行業"   value={data.industry ?? "—"} />
        <MetricRow label="員工數" value={data.employees ? data.employees.toLocaleString() : "—"} />
        {data.website && (
          <div className="flex items-center justify-between py-1.5">
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>官網</span>
            <a href={data.website} target="_blank" rel="noopener noreferrer"
              className="text-xs truncate max-w-[140px]" style={{ color: "var(--color-brand)" }}>
              {data.website.replace(/^https?:\/\//, "")}
            </a>
          </div>
        )}
      </Section>
    </div>
  );
}

// ── Foreign Holding Section ───────────────────────────────────────────────────

function ForeignHoldingChart({ items }: { items: ForeignHoldingItem[] }) {
  if (items.length < 2) return null;

  const W = 560, H = 170;
  const PAD = { t: 20, r: 52, b: 32, l: 44 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  // Left scale: holding %
  const pcts   = items.map(d => d.holding_pct);
  const pctMin = Math.max(0,   Math.min(...pcts) - 3);
  const pctMax = Math.min(100, Math.max(...pcts) + 3);
  const pctRng = pctMax - pctMin || 1;

  // Right scale: price (normalized to same visual space)
  const priceVals = items.map(d => d.price).filter((v): v is number => v != null);
  const hasPrice  = priceVals.length >= 2;
  const priceMin  = hasPrice ? Math.min(...priceVals) : 0;
  const priceMax  = hasPrice ? Math.max(...priceVals) : 1;
  const priceRng  = priceMax - priceMin || 1;

  const toX = (i: number) => PAD.l + (i / (items.length - 1)) * iW;
  const toPctY = (v: number) => PAD.t + (1 - (v - pctMin) / pctRng) * iH;
  const toPriceY = (v: number) =>
    PAD.t + (1 - (v - priceMin) / priceRng) * iH;

  // Area path for holding %
  const areaD =
    `M${toX(0)},${toPctY(pcts[0])} ` +
    pcts.map((v, i) => `L${toX(i)},${toPctY(v)}`).join(" ") +
    ` L${toX(pcts.length - 1)},${PAD.t + iH} L${toX(0)},${PAD.t + iH} Z`;

  const linePts = pcts.map((v, i) => `${toX(i)},${toPctY(v)}`).join(" ");

  const pricePts = hasPrice
    ? items
        .filter(d => d.price != null)
        .map((d, _i) => {
          const idx = items.indexOf(d);
          return `${toX(idx)},${toPriceY(d.price!)}`;
        })
        .join(" ")
    : "";

  // X labels (every 2-3 months)
  const xLabels = items
    .map((d, i) => ({ i, label: d.month === 1 || d.month === 7 ? `${d.year % 100}/${String(d.month).padStart(2, "0")}` : "" }))
    .filter(l => l.label);

  // Y ticks (left: %)
  const yTicks = [0, 0.33, 0.67, 1].map(r => ({
    y:     PAD.t + (1 - r) * iH,
    label: (pctMin + r * pctRng).toFixed(1),
  }));

  const trend = pcts.length >= 2 ? pcts[pcts.length - 1] - pcts[0] : 0;
  const lineColor = trend >= 0 ? "#22c55e" : "#ef4444";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }} aria-label="外資持股比例走勢">
      <defs>
        <linearGradient id="fh-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.03" />
        </linearGradient>
      </defs>

      {/* Grid + Y ticks */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={t.y} y2={t.y}
            stroke="var(--border)" strokeWidth={0.5} />
          <text x={PAD.l - 4} y={t.y + 3}
            textAnchor="end" fontSize={8} fill="var(--text-tertiary)">{t.label}%</text>
        </g>
      ))}

      {/* Area + line: holding % */}
      <path d={areaD} fill="url(#fh-grad)" />
      <polyline points={linePts} fill="none"
        stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" />

      {/* Price overlay */}
      {hasPrice && (
        <>
          <polyline points={pricePts} fill="none"
            stroke="#9ca3af" strokeWidth={1.2}
            strokeDasharray="4 3" opacity={0.8} />
          {/* Right Y label (price) */}
          <text x={W - PAD.r + 4} y={PAD.t + 10}
            fontSize={8} fill="#9ca3af" opacity={0.8}>↑ 股價</text>
        </>
      )}

      {/* Latest dot */}
      <circle cx={toX(items.length - 1)} cy={toPctY(pcts[pcts.length - 1])}
        r={3.5} fill="#3b82f6" />

      {/* X labels */}
      {xLabels.map(({ i, label }) => (
        <text key={label} x={toX(i)} y={H - 4}
          textAnchor="middle" fontSize={8} fill="var(--text-tertiary)">{label}</text>
      ))}

      {/* Y axis */}
      <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + iH}
        stroke="var(--border)" strokeWidth={0.5} />
    </svg>
  );
}

function ForeignHoldingSection({
  data,
  loading,
  error,
}: {
  data:    ForeignHoldingResponse | null;
  loading: boolean;
  error:   string | null;
}) {
  if (loading) return <Loading msg="從 TWSE 載入外資持股資料中..." />;
  if (error)   return <Err msg={error} />;
  if (!data)   return null;

  if (!data.is_tw) {
    return (
      <Section title="🌏 外資持股比例">
        <p className="text-xs py-2" style={{ color: "var(--text-tertiary)" }}>
          外資持股比例為台灣上市公司特有指標（TWSE每月公告），美股不適用。
        </p>
      </Section>
    );
  }

  if (!data.data.length) {
    return (
      <Section title="🌏 外資持股比例">
        <p className="text-xs py-2" style={{ color: "var(--text-tertiary)" }}>
          {data.message ?? "TWSE 暫無資料"}
        </p>
      </Section>
    );
  }

  const latest   = data.latest_pct;
  const change1y = data.change_1y;

  // Trend direction
  const trendColor =
    change1y == null ? "var(--text-secondary)" :
    change1y > 0 ? "var(--color-up)" :
    change1y < 0 ? "var(--color-down)" :
    "var(--text-secondary)";

  const trendLabel =
    change1y == null ? "—" :
    change1y > 1   ? "持續增持 📈" :
    change1y > 0   ? "小幅增持"  :
    change1y < -1  ? "持續減持 📉" :
    change1y < 0   ? "小幅減持"  :
    "持平";

  return (
    <Section title="🌏 外資持股比例走勢（近 12 個月）">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg p-3 text-center" style={{ background: "var(--bg-elevated)" }}>
          <div className="text-[10px] mb-1" style={{ color: "var(--text-tertiary)" }}>最新持股比例</div>
          <div className="text-lg num font-bold" style={{ color: "#3b82f6" }}>
            {latest != null ? `${latest.toFixed(2)}%` : "—"}
          </div>
        </div>
        <div className="rounded-lg p-3 text-center" style={{ background: "var(--bg-elevated)" }}>
          <div className="text-[10px] mb-1" style={{ color: "var(--text-tertiary)" }}>近 12 月變化</div>
          <div className="text-sm num font-bold" style={{ color: trendColor }}>
            {change1y != null ? `${change1y >= 0 ? "+" : ""}${change1y.toFixed(2)}pp` : "—"}
          </div>
          <div className="text-[10px]" style={{ color: trendColor }}>{trendLabel}</div>
        </div>
        <div className="rounded-lg p-3 text-center" style={{ background: "var(--bg-elevated)" }}>
          <div className="text-[10px] mb-1" style={{ color: "var(--text-tertiary)" }}>近 12 月區間</div>
          <div className="text-xs num">
            {data.min_pct != null && data.max_pct != null
              ? `${data.min_pct}% – ${data.max_pct}%`
              : "—"}
          </div>
        </div>
      </div>

      {/* Chart */}
      <ForeignHoldingChart items={data.data} />

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
        <span><span style={{ color: "#3b82f6" }}>■</span> 外資持股比例（%）</span>
        <span><span style={{ color: "#9ca3af" }}>─ ─</span> 月收盤股價</span>
        <span className="ml-auto">資料來源：TWSE MI_QIANW</span>
      </div>

      {/* Detail table */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs" style={{ minWidth: 320 }}>
          <thead>
            <tr>
              {["年月", "持股比例", "月變化(pp)", "股價"].map(h => (
                <th key={h} className="px-2 py-1.5 text-left"
                  style={{ color: "var(--text-tertiary)", borderBottom: "1px solid var(--border)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...data.data].reverse().slice(0, 12).map((d, i, arr) => {
              const prev = arr[i + 1];
              const delta = (prev?.holding_pct != null && d.holding_pct != null)
                ? d.holding_pct - prev.holding_pct
                : null;
              return (
                <tr key={d.date}
                  style={{ borderBottom: "1px solid var(--border)", background: i % 2 ? "var(--bg-elevated)" : "transparent" }}>
                  <td className="px-2 py-1.5 num">{d.year}/{String(d.month).padStart(2, "0")}</td>
                  <td className="px-2 py-1.5 num font-medium" style={{ color: "#3b82f6" }}>
                    {d.holding_pct.toFixed(2)}%
                  </td>
                  <td className="px-2 py-1.5 num"
                    style={{ color: delta != null ? (delta >= 0 ? "var(--color-up)" : "var(--color-down)") : "var(--text-tertiary)" }}>
                    {delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}` : "—"}
                  </td>
                  <td className="px-2 py-1.5 num" style={{ color: "var(--text-secondary)" }}>
                    {d.price != null ? d.price.toLocaleString() : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ── Valuation Band Section ────────────────────────────────────────────────────

/** 單一指標（PE 或 PB）帶狀歷史圖 */
function ValuationBandChart({
  stats,
  color,
  ariaLabel,
}: {
  stats:     ValuationBandStats;
  color:     string;
  ariaLabel: string;
}) {
  const W = 560, H = 170;
  const PAD = { t: 20, r: 68, b: 32, l: 44 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const hist = stats.history;
  if (!hist.length) return null;

  const allVals = [
    ...hist.map(d => d.value),
    stats.band_2std_low,
    stats.band_2std_high,
  ].filter(v => v > 0);
  const rawMin = Math.min(...allVals);
  const rawMax = Math.max(...allVals);
  const margin = (rawMax - rawMin) * 0.08 || 1;
  const minY = Math.max(0, rawMin - margin);
  const maxY = rawMax + margin;
  const range = maxY - minY || 1;

  const toX = (i: number) => PAD.l + (i / Math.max(hist.length - 1, 1)) * iW;
  const toY = (v: number) => PAD.t + (1 - (Math.min(maxY, Math.max(minY, v)) - minY) / range) * iH;

  const y2hi  = toY(Math.min(maxY, stats.band_2std_high));
  const y2lo  = toY(Math.max(minY, stats.band_2std_low));
  const y1hi  = toY(Math.min(maxY, stats.band_1std_high));
  const y1lo  = toY(Math.max(minY, stats.band_1std_low));
  const yMean = toY(stats.mean);
  const yCurr = toY(stats.current);

  const linePts = hist.map((d, i) => `${toX(i)},${toY(d.value)}`).join(" ");

  const xLabels: { x: number; label: string }[] = [];
  let lastYear = 0;
  hist.forEach((d, i) => {
    const yr = parseInt(d.time.slice(0, 4));
    if (yr !== lastYear) { xLabels.push({ x: toX(i), label: String(yr) }); lastYear = yr; }
  });

  const clampY = (y: number) => Math.min(PAD.t + iH - 2, Math.max(PAD.t + 2, y));

  const refLines = [
    { y: y2hi,  v: stats.band_2std_high, tag: "+2σ", op: 0.45, dash: true  },
    { y: y1hi,  v: stats.band_1std_high, tag: "+1σ", op: 0.65, dash: false },
    { y: yMean, v: stats.mean,            tag: "均",  op: 0.85, dash: true  },
    { y: y1lo,  v: stats.band_1std_low,   tag: "-1σ", op: 0.65, dash: false },
    { y: y2lo,  v: stats.band_2std_low,   tag: "-2σ", op: 0.45, dash: true  },
  ];

  const currColor =
    stats.current > stats.band_1std_high ? "var(--color-down)" :
    stats.current < stats.band_1std_low  ? "var(--color-up)"   :
    color;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }} aria-label={ariaLabel}>
      {/* ±2σ band */}
      <rect x={PAD.l} y={y2hi} width={iW} height={Math.max(0, y2lo - y2hi)} fill={color} opacity={0.07} />
      {/* ±1σ band */}
      <rect x={PAD.l} y={y1hi} width={iW} height={Math.max(0, y1lo - y1hi)} fill={color} opacity={0.15} />

      {/* Reference lines + right labels */}
      {refLines.map(({ y, v, tag, op, dash }) => (
        <g key={tag}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y}
            stroke={color} strokeWidth={0.8}
            strokeDasharray={dash ? "3 3" : undefined}
            opacity={op} />
          <text x={W - PAD.r + 3} y={clampY(y) + 3} fontSize={8} fill={color} opacity={Math.min(1, op + 0.15)}>
            {v.toFixed(1)}
          </text>
          <text x={W - PAD.r + 34} y={clampY(y) + 3} fontSize={7} fill="var(--text-tertiary)">{tag}</text>
        </g>
      ))}

      {/* Current guide line */}
      <line x1={PAD.l} x2={W - PAD.r} y1={yCurr} y2={yCurr}
        stroke={currColor} strokeWidth={1.2} strokeDasharray="6 3" opacity={0.9} />

      {/* Historical line */}
      <polyline points={linePts} fill="none" stroke={color} strokeWidth={1.6}
        strokeLinejoin="round" opacity={0.85} />

      {/* Latest dot */}
      <circle cx={toX(hist.length - 1)} cy={yCurr} r={3.5} fill={currColor} />

      {/* X labels */}
      {xLabels.map(({ x, label }) => (
        <text key={label} x={x} y={H - 4} textAnchor="middle" fontSize={8} fill="var(--text-tertiary)">{label}</text>
      ))}
      <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + iH} stroke="var(--border)" strokeWidth={0.5} />
    </svg>
  );
}

/** 分位數半圓弧 */
function PercentileArc({ pct, color }: { pct: number; color: string }) {
  const r = 26, cx = 34, cy = 34;
  const clampPct = Math.min(99.9, Math.max(0.1, pct));
  const angle = (clampPct / 100) * Math.PI;
  const ex = cx - r * Math.cos(angle);
  const ey = cy - r * Math.sin(angle);
  const largArc = clampPct > 50 ? 1 : 0;
  const bgPath = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const fgPath = `M ${cx - r} ${cy} A ${r} ${r} 0 ${largArc} 1 ${ex} ${ey}`;
  return (
    <svg viewBox="0 0 68 42" style={{ width: 68, height: 42, flexShrink: 0 }}>
      <path d={bgPath} fill="none" stroke="var(--bg-elevated)" strokeWidth={5} />
      <path d={fgPath} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" />
      <text x={cx} y={cy + 8} textAnchor="middle" fontSize={11} fontWeight={700} fill={color}>
        {pct.toFixed(0)}%
      </text>
    </svg>
  );
}

function ValuationCard({ stats, label, color }: { stats: ValuationBandStats; label: string; color: string }) {
  const zone =
    stats.current > stats.band_1std_high ? { text: "偏高估",   clr: "var(--color-down)" } :
    stats.current < stats.band_1std_low  ? { text: "偏低估",   clr: "var(--color-up)"   } :
    stats.current > stats.mean           ? { text: "中性偏高", clr: "#f59e0b"           } :
                                           { text: "中性偏低", clr: "#3b82f6"           };
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-4">
        <PercentileArc pct={stats.percentile} color={color} />
        <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-1.5">
          <div>
            <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>當前 {label}</div>
            <div className="text-lg num font-bold" style={{ color }}>{stats.current.toFixed(1)}x</div>
          </div>
          <div>
            <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>估值評估</div>
            <div className="text-sm font-semibold" style={{ color: zone.clr }}>{zone.text}</div>
          </div>
          <div>
            <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>5 年均值</div>
            <div className="text-xs num">{stats.mean.toFixed(1)}x</div>
          </div>
          <div>
            <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>±1σ 正常區間</div>
            <div className="text-xs num">{stats.band_1std_low.toFixed(1)} – {stats.band_1std_high.toFixed(1)}</div>
          </div>
        </div>
      </div>
      <ValuationBandChart stats={stats} color={color} ariaLabel={`${label} 歷史估值帶`} />
      <div className="flex items-center gap-4 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
        <span><span style={{ color }}>─</span> 歷史 {label}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ display: "inline-block", width: 12, height: 8, background: color, opacity: 0.15, borderRadius: 1 }} />±1σ 帶
        </span>
        <span>分位弧 = 當前在 5 年中的位置</span>
      </div>
    </div>
  );
}

function ValuationBandSection({
  data,
  loading,
  error,
}: {
  data:    ValuationBandResponse | null;
  loading: boolean;
  error:   string | null;
}) {
  if (loading) return <Loading msg="計算歷史估值帶中（約 5-10 秒）..." />;
  if (error)   return <Err msg={error} />;
  if (!data)   return null;

  const hasPE = !!(data.pe && data.pe.history.length >= 52);
  const hasPB = !!(data.pb && data.pb.history.length >= 52);

  if (!hasPE && !hasPB) {
    return (
      <Section title="📐 PE / PB 歷史估值帶">
        <p className="text-xs py-2" style={{ color: "var(--text-tertiary)" }}>
          歷史季度財務數據不足，無法計算估值帶（需至少 4 季 EPS / 淨值資料）。
        </p>
      </Section>
    );
  }

  return (
    <div className="space-y-4">
      {hasPE && (
        <Section title="📐 本益比（P/E）歷史估值帶">
          <ValuationCard stats={data.pe!} label="PE" color="#8b5cf6" />
        </Section>
      )}
      {hasPB && (
        <Section title="📐 股價淨值比（P/B）歷史估值帶">
          <ValuationCard stats={data.pb!} label="PB" color="#06b6d4" />
        </Section>
      )}
    </div>
  );
}

// ── Monthly Revenue Section ───────────────────────────────────────────────────

/** 月營收走勢折線圖（SVG） */
function RevenueTrendChart({ items }: { items: MonthlyRevenueItem[] }) {
  const W = 560, H = 130;
  const PAD = { t: 16, r: 12, b: 28, l: 52 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  // 千元 → 億 (1億 = 100,000千元)
  const vals = items.map(d => (d.revenue ?? 0) / 1e5);
  const maxV = Math.max(...vals, 0.1);
  const minV = Math.min(...vals.filter(v => v > 0), 0);
  const range = maxV - minV || 1;

  const toX = (i: number) =>
    items.length <= 1 ? PAD.l + iW / 2 : PAD.l + (i / (items.length - 1)) * iW;
  const toY = (v: number) => PAD.t + (1 - (v - minV) / range) * iH;

  const pts = vals.map((v, i) => `${toX(i)},${toY(v)}`).join(" ");
  // area fill
  const area = `M${toX(0)},${toY(vals[0])} ` +
    vals.map((v, i) => `L${toX(i)},${toY(v)}`).join(" ") +
    ` L${toX(vals.length - 1)},${PAD.t + iH} L${toX(0)},${PAD.t + iH} Z`;

  // X labels: every 6 months
  const xLabels = items
    .map((d, i) => ({ i, label: d.month === 1 || d.month === 7 ? `${d.year % 100}/${String(d.month).padStart(2, "0")}` : "" }))
    .filter(l => l.label);

  // Y axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(r => ({
    y: PAD.t + (1 - r) * iH,
    label: ((minV + r * range) >= 100 ? `${Math.round((minV + r * range) / 100)}K` : (minV + r * range).toFixed(0)),
  }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }} aria-label="月營收走勢圖">
      <defs>
        <linearGradient id="rev-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* Grid */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={t.y} y2={t.y} stroke="var(--border)" strokeWidth={0.5} />
          <text x={PAD.l - 4} y={t.y + 3} textAnchor="end" fontSize={8} fill="var(--text-tertiary)">{t.label}</text>
        </g>
      ))}
      {/* Area fill */}
      <path d={area} fill="url(#rev-grad)" />
      {/* Line */}
      <polyline points={pts} fill="none" stroke="#3b82f6" strokeWidth={1.5} strokeLinejoin="round" />
      {/* Last year comparison (dashed) */}
      {items.some(d => d.last_year_revenue != null) && (
        <polyline
          points={items.map((d, i) => `${toX(i)},${toY((d.last_year_revenue ?? 0) / 1e5)}`).join(" ")}
          fill="none"
          stroke="#6b7280"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.6}
        />
      )}
      {/* X labels */}
      {xLabels.map(({ i, label }) => (
        <text key={i} x={toX(i)} y={H - 4} textAnchor="middle" fontSize={8} fill="var(--text-tertiary)">{label}</text>
      ))}
      {/* Latest dot */}
      {vals.length > 0 && (
        <circle cx={toX(vals.length - 1)} cy={toY(vals[vals.length - 1])} r={3} fill="#3b82f6" />
      )}
    </svg>
  );
}

/** YoY 成長率柱狀圖（SVG） */
function YoYBarChart({ items }: { items: MonthlyRevenueItem[] }) {
  const display = items.filter(d => d.yoy_pct != null).slice(-24);
  if (!display.length) return null;

  const vals = display.map(d => d.yoy_pct ?? 0);
  const maxAbs = Math.max(...vals.map(Math.abs), 1);
  const H = 90, barW = Math.max(4, Math.floor(560 / display.length) - 2);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${Math.max(display.length * (barW + 2), 200)} ${H + 24}`}
        style={{ width: "100%", height: H + 24, minWidth: 200 }}
        aria-label="月營收 YoY 成長率"
        preserveAspectRatio="none"
      >
        {/* Zero line */}
        <line x1={0} x2={display.length * (barW + 2)} y1={H / 2} y2={H / 2} stroke="var(--border)" strokeWidth={0.5} />
        {display.map((d, i) => {
          const v = d.yoy_pct ?? 0;
          const barH = Math.max(2, (Math.abs(v) / maxAbs) * (H / 2 - 4));
          const isPos = v >= 0;
          const x = i * (barW + 2);
          const y = isPos ? H / 2 - barH : H / 2;
          const label = d.month === 1 || d.month === 7
            ? `${String(d.year % 100).padStart(2, "0")}/${String(d.month).padStart(2, "0")}`
            : "";
          return (
            <g key={`${d.year}-${d.month}`}>
              <rect
                x={x} y={y} width={barW} height={barH}
                fill={isPos ? "var(--color-up)" : "var(--color-down)"}
                opacity={0.85}
                rx={1}
              >
                <title>{`${d.year}/${d.month}: ${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}</title>
              </rect>
              {label && (
                <text x={x + barW / 2} y={H + 14} textAnchor="middle" fontSize={7} fill="var(--text-tertiary)">{label}</text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex items-center gap-3 mt-1 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
        <span style={{ color: "var(--color-up)" }}>■</span> YoY 成長
        <span style={{ color: "var(--color-down)" }}>■</span> YoY 衰退
        <span className="ml-auto">灰虛線 = 去年同月</span>
      </div>
    </div>
  );
}

function MonthlyRevenueSection({
  data,
  loading,
  error,
}: {
  data:    MonthlyRevenueResponse | null;
  loading: boolean;
  error:   string | null;
}) {
  if (loading) return <Loading msg="從 MOPS 載入月營收中..." />;
  if (error)   return <Err msg={error} />;

  if (!data) return null;

  // 非台股說明
  if (!data.is_tw) {
    return (
      <Section title="📆 月營收">
        <p className="text-xs py-2" style={{ color: "var(--text-tertiary)" }}>
          月營收為台灣上市公司特有揭露指標（每月 10 日公告），美股不適用。
        </p>
      </Section>
    );
  }

  if (!data.data.length) {
    return (
      <Section title="📆 月營收">
        <p className="text-xs py-2" style={{ color: "var(--text-tertiary)" }}>
          {data.message ?? "暫無月營收資料（MOPS 尚未公告或非上市公司）"}
        </p>
      </Section>
    );
  }

  const items = data.data;
  const latest = items[items.length - 1];
  const prevMonth = items.length >= 2 ? items[items.length - 2] : null;

  // MoM change
  const mom = (latest.revenue != null && prevMonth?.revenue != null && prevMonth.revenue > 0)
    ? ((latest.revenue - prevMonth.revenue) / prevMonth.revenue) * 100
    : null;

  // 億 conversion (1億 = 100,000 千元)
  const toHundredMillion = (v: number | null) => v != null ? (v / 1e5).toFixed(2) : "—";

  return (
    <div className="space-y-4">
      {/* Summary */}
      <Section title="📆 月營收摘要">
        <div className="grid grid-cols-3 gap-3 mb-4">
          {/* Latest revenue */}
          <div className="rounded-lg p-3 text-center" style={{ background: "var(--bg-elevated)" }}>
            <div className="text-[10px] mb-1" style={{ color: "var(--text-tertiary)" }}>
              最新 {latest.year}/{latest.month}
            </div>
            <div className="text-sm num font-bold">{toHundredMillion(latest.revenue)}</div>
            <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>億元</div>
          </div>
          {/* YoY */}
          <div className="rounded-lg p-3 text-center" style={{ background: "var(--bg-elevated)" }}>
            <div className="text-[10px] mb-1" style={{ color: "var(--text-tertiary)" }}>單月 YoY</div>
            <div className="text-sm num font-bold" style={{ color: latest.yoy_pct != null ? (latest.yoy_pct >= 0 ? "var(--color-up)" : "var(--color-down)") : "var(--text-primary)" }}>
              {latest.yoy_pct != null ? `${latest.yoy_pct >= 0 ? "+" : ""}${latest.yoy_pct.toFixed(1)}%` : "—"}
            </div>
            <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>vs 去年同月</div>
          </div>
          {/* Cumulative YoY */}
          <div className="rounded-lg p-3 text-center" style={{ background: "var(--bg-elevated)" }}>
            <div className="text-[10px] mb-1" style={{ color: "var(--text-tertiary)" }}>累計 YoY</div>
            <div className="text-sm num font-bold" style={{ color: latest.cumulative_yoy_pct != null ? (latest.cumulative_yoy_pct >= 0 ? "var(--color-up)" : "var(--color-down)") : "var(--text-primary)" }}>
              {latest.cumulative_yoy_pct != null ? `${latest.cumulative_yoy_pct >= 0 ? "+" : ""}${latest.cumulative_yoy_pct.toFixed(1)}%` : "—"}
            </div>
            <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>今年累計 vs 去年</div>
          </div>
        </div>
        {/* MoM row */}
        <div className="flex items-center justify-between text-xs pt-2 border-t" style={{ borderColor: "var(--border)" }}>
          <span style={{ color: "var(--text-secondary)" }}>環比（月增率）</span>
          <span className="num font-medium" style={{ color: mom != null ? (mom >= 0 ? "var(--color-up)" : "var(--color-down)") : "var(--text-secondary)" }}>
            {mom != null ? `${mom >= 0 ? "+" : ""}${mom.toFixed(1)}%` : "—"}
          </span>
        </div>
        {latest.cumulative != null && (
          <div className="flex items-center justify-between text-xs pt-1.5 border-t" style={{ borderColor: "var(--border)" }}>
            <span style={{ color: "var(--text-secondary)" }}>今年累計營收</span>
            <span className="num font-medium">{toHundredMillion(latest.cumulative)} 億元</span>
          </div>
        )}
      </Section>

      {/* Trend chart */}
      <Section title="📊 月營收走勢（近 24 個月，億元）">
        <RevenueTrendChart items={items} />
        <div className="flex items-center gap-4 mt-2 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          <span><span style={{ color: "#3b82f6" }}>─</span> 當月營收</span>
          <span><span style={{ color: "#6b7280" }}>- -</span> 去年同月</span>
        </div>
      </Section>

      {/* YoY bar chart */}
      <Section title="📈 單月 YoY 成長率（%）">
        <YoYBarChart items={items} />
      </Section>

      {/* Detail table */}
      <Section title="📋 月營收明細（近 12 個月）">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: 420 }}>
            <thead>
              <tr>
                {["年月", "當月營收（億）", "去年同月（億）", "單月 YoY", "累計 YoY"].map(h => (
                  <th key={h} className="px-2 py-1.5 text-left" style={{ color: "var(--text-tertiary)", borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...items].reverse().slice(0, 12).map((d, i) => (
                <tr key={`${d.year}-${d.month}`} style={{ borderBottom: "1px solid var(--border)", background: i % 2 ? "var(--bg-elevated)" : "transparent" }}>
                  <td className="px-2 py-1.5 num font-medium">{d.year}/{String(d.month).padStart(2, "0")}</td>
                  <td className="px-2 py-1.5 num">{toHundredMillion(d.revenue)}</td>
                  <td className="px-2 py-1.5 num" style={{ color: "var(--text-secondary)" }}>{toHundredMillion(d.last_year_revenue)}</td>
                  <td className="px-2 py-1.5 num" style={{ color: d.yoy_pct != null ? (d.yoy_pct >= 0 ? "var(--color-up)" : "var(--color-down)") : "var(--text-secondary)" }}>
                    {d.yoy_pct != null ? `${d.yoy_pct >= 0 ? "+" : ""}${d.yoy_pct.toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-2 py-1.5 num" style={{ color: d.cumulative_yoy_pct != null ? (d.cumulative_yoy_pct >= 0 ? "var(--color-up)" : "var(--color-down)") : "var(--text-secondary)" }}>
                    {d.cumulative_yoy_pct != null ? `${d.cumulative_yoy_pct >= 0 ? "+" : ""}${d.cumulative_yoy_pct.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          資料來源：公開資訊觀測站（MOPS），每月 10 日公告。金額單位：億元（10,000萬）。
        </div>
      </Section>
    </div>
  );
}

// ── Peer Comparison Section ───────────────────────────────────────────────────

const PEER_COLS: {
  key:      keyof PeerRow;
  label:    string;
  fmt:      (v: number | null) => string;
  higher?:  boolean;   // true = green when higher; false = green when lower; undefined = neutral
}[] = [
  { key: "market_cap_fmt", label: "市值",    fmt: v => v != null ? String(v) : "—",            higher: undefined },
  { key: "pe_trailing",    label: "P/E",     fmt: v => v != null ? v.toFixed(1) : "—",          higher: false },
  { key: "pb_ratio",       label: "P/B",     fmt: v => v != null ? v.toFixed(2) : "—",          higher: false },
  { key: "roe",            label: "ROE",     fmt: v => v != null ? `${(v*100).toFixed(1)}%` : "—", higher: true },
  { key: "gross_margin",   label: "毛利率",  fmt: v => v != null ? `${(v*100).toFixed(1)}%` : "—", higher: true },
  { key: "profit_margin",  label: "淨利率",  fmt: v => v != null ? `${(v*100).toFixed(1)}%` : "—", higher: true },
  { key: "dividend_yield", label: "殖利率",  fmt: v => v != null ? `${(v*100).toFixed(2)}%` : "—", higher: true },
  { key: "change_1y_pct",  label: "1Y漲跌", fmt: v => v != null ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` : "—", higher: true },
];

function peerCellColor(
  val: number | null,
  median: number | null,
  higher: boolean | undefined,
): string {
  if (val == null || median == null || higher === undefined) return "var(--text-primary)";
  const better = higher ? val > median * 1.02 : val < median * 0.98;
  const worse  = higher ? val < median * 0.98 : val > median * 1.02;
  if (better) return "var(--color-up)";
  if (worse)  return "var(--color-down)";
  return "var(--text-primary)";
}

function PeerComparisonSection({
  data,
  loading,
  error,
  targetSymbol,
  onCustomPeers,
}: {
  data:          PeerComparisonResponse | null;
  loading:       boolean;
  error:         string | null;
  targetSymbol:  string;
  onCustomPeers: (peers: string) => void;
}) {
  const [editMode,  setEditMode]  = useState(false);
  const [inputVal,  setInputVal]  = useState("");

  if (loading) return <Loading msg="載入同業資料中（約 10-15 秒）..." />;
  if (error)   return <Err msg={error} />;
  if (!data || !data.rows.length) return null;

  const validRows = data.rows.filter(r => !r.error);

  // Compute per-column medians (for color coding)
  const medians: Partial<Record<keyof PeerRow, number | null>> = {};
  for (const col of PEER_COLS) {
    if (col.higher === undefined) continue;
    const vals = validRows.map(r => r[col.key] as number | null).filter(v => v != null) as number[];
    if (!vals.length) { medians[col.key] = null; continue; }
    const sorted = [...vals].sort((a, b) => a - b);
    medians[col.key] = sorted[Math.floor(sorted.length / 2)];
  }

  const handleCustom = () => {
    const cleaned = inputVal.trim().replace(/\s+/g, ",");
    onCustomPeers(cleaned);
    setEditMode(false);
  };

  return (
    <Section title="🏢 同業比較">
      {/* Header row: industry info + 自訂按鈕 */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          {validRows[0]?.industry ?? validRows[0]?.sector ?? ""}
          {data.custom && <span className="ml-2 px-1.5 py-0.5 rounded text-[9px]" style={{ background: "var(--bg-elevated)", color: "var(--color-brand)" }}>自訂</span>}
        </div>
        <button
          className="text-[10px] px-2 py-1 rounded"
          style={{ background: "var(--bg-elevated)", color: "var(--color-brand)", border: "1px solid var(--border)" }}
          onClick={() => { setEditMode(e => !e); setInputVal(""); }}
        >
          {editMode ? "取消" : "✏️ 自訂對比"}
        </button>
      </div>

      {/* Custom input */}
      {editMode && (
        <div className="flex gap-2 mb-3">
          <input
            className="flex-1 rounded px-2 py-1 text-xs"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)", outline: "none" }}
            placeholder="輸入股票代號，用逗號分隔（最多 6 支）"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleCustom()}
          />
          <button
            className="px-3 py-1 rounded text-xs font-medium"
            style={{ background: "var(--color-brand)", color: "#fff" }}
            onClick={handleCustom}
          >
            比較
          </button>
        </div>
      )}

      {/* Comparison table */}
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-xs" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th className="text-left px-2 py-2 sticky left-0 z-10" style={{ color: "var(--text-tertiary)", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", minWidth: 100 }}>
                公司
              </th>
              {PEER_COLS.map(c => (
                <th key={String(c.key)} className="text-right px-2 py-2" style={{ color: "var(--text-tertiary)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, idx) => {
              const isTarget = row.yf_symbol === data.target_yf;
              const rowBg = isTarget
                ? "rgba(var(--color-brand-rgb, 59,130,246), 0.08)"
                : idx % 2 ? "var(--bg-elevated)" : "transparent";
              return (
                <tr
                  key={row.yf_symbol}
                  style={{
                    background: rowBg,
                    borderBottom: "1px solid var(--border)",
                    fontWeight: isTarget ? 600 : undefined,
                  }}
                >
                  {/* Company name */}
                  <td className="px-2 py-2 sticky left-0 z-10" style={{ background: rowBg }}>
                    <div className="flex items-center gap-1.5">
                      {isTarget && (
                        <span className="shrink-0 text-[8px] px-1 py-0.5 rounded" style={{ background: "var(--color-brand)", color: "#fff" }}>目標</span>
                      )}
                      <div>
                        <div className="num" style={{ color: "var(--text-primary)" }}>{row.symbol}</div>
                        <div className="text-[10px] truncate max-w-[80px]" style={{ color: "var(--text-tertiary)" }} title={row.name}>
                          {row.name?.replace(/\s*\(.*?\)/, "").substring(0, 12)}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Metric columns */}
                  {PEER_COLS.map(col => {
                    const raw = row[col.key];
                    const numVal = typeof raw === "number" ? raw : null;
                    const displayVal = col.key === "market_cap_fmt"
                      ? (row.market_cap_fmt ?? "—")
                      : col.fmt(numVal);
                    const color = col.higher !== undefined
                      ? peerCellColor(numVal, medians[col.key] as number | null, col.higher)
                      : (col.key === "change_1y_pct" && numVal != null)
                        ? updown(numVal)
                        : "var(--text-primary)";
                    return (
                      <td key={String(col.key)} className="px-2 py-2 text-right num" style={{ color }}>
                        {displayVal}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
        色碼：<span style={{ color: "var(--color-up)" }}>■</span> 優於同業中位 &nbsp;
        <span style={{ color: "var(--color-down)" }}>■</span> 遜於同業中位（P/E、P/B 越低越優）
      </div>
    </Section>
  );
}

// ── Financial Charts (Simple SVG Bars) ───────────────────────────────────────

type BarKey = "revenue" | "net_income" | "operating_cf" | "free_cf";

const BAR_CONFIGS: { key: BarKey; label: string; color: string }[] = [
  { key: "revenue",      label: "年度營收",    color: "#3b82f6" },
  { key: "net_income",   label: "年度淨利",    color: "#22c55e" },
  { key: "operating_cf", label: "營業現金流",  color: "#8b5cf6" },
  { key: "free_cf",      label: "自由現金流",  color: "#f59e0b" },
];

function BarChart({ data, config, divisor, unit }: {
  data:    AnnualFinancial[];
  config:  typeof BAR_CONFIGS[0];
  divisor: number;
  unit:    string;
}) {
  const vals = data.map(d => (d[config.key] ?? 0) / divisor);
  const maxAbs = Math.max(...vals.map(Math.abs), 1);

  return (
    <div>
      <div className="text-[10px] font-semibold mb-2" style={{ color: "var(--text-tertiary)" }}>{config.label}（{unit}）</div>
      <div className="flex items-end gap-1.5" style={{ height: 100 }}>
        {data.map((d, i) => {
          const v = (d[config.key] ?? 0) / divisor;
          const h = Math.round(Math.abs(v) / maxAbs * 80);
          const isNeg = v < 0;
          return (
            <div key={d.year} className="flex flex-col items-center flex-1 gap-0.5">
              <div className="text-[9px] num leading-none" style={{ color: isNeg ? "var(--color-down)" : config.color }}>
                {v !== 0 ? (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}K` : v.toFixed(0)) : ""}
              </div>
              <div
                className="w-full rounded-t"
                style={{ height: h || 2, background: isNeg ? "var(--color-down)" : config.color, opacity: 0.8 + (i / data.length) * 0.2, minHeight: 2 }}
                title={`${d.year}: ${v.toFixed(1)} ${unit}`}
              />
              <div className="text-[9px] num" style={{ color: "var(--text-tertiary)" }}>{d.year}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FinancialSection({ data }: { data: FinancialsData }) {
  if (!data.annual.length) return (
    <div className="text-xs text-center py-8" style={{ color: "var(--text-tertiary)" }}>
      無法取得財務報表資料（部分股票 yfinance 不提供）
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Bar Charts */}
      <Section title="📈 財務報表趨勢（最多 10 年）">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {BAR_CONFIGS.map(c => (
            <BarChart key={c.key} data={data.annual} config={c} divisor={data.divisor} unit={data.unit} />
          ))}
        </div>
      </Section>

      {/* Margins trend */}
      <Section title="📉 利潤率趨勢">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: 480 }}>
            <thead>
              <tr>
                {["年份", "毛利率", "營業利益率", "淨利率", "ROE", "ROA"].map(h => (
                  <th key={h} className="px-2 py-1.5 text-left" style={{ color: "var(--text-tertiary)", borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...data.annual].reverse().map((r, i) => (
                <tr key={r.year} style={{ borderBottom: "1px solid var(--border)", background: i % 2 ? "var(--bg-elevated)" : "transparent" }}>
                  <td className="px-2 py-1.5 num font-medium">{r.year}</td>
                  <td className="px-2 py-1.5 num" style={{ color: r.gross_margin && r.gross_margin >= 0.3 ? "var(--color-up)" : "var(--text-primary)" }}>{pct(r.gross_margin)}</td>
                  <td className="px-2 py-1.5 num" style={{ color: r.operating_margin && r.operating_margin >= 0.15 ? "var(--color-up)" : "var(--text-primary)" }}>{pct(r.operating_margin)}</td>
                  <td className="px-2 py-1.5 num" style={{ color: r.net_margin && r.net_margin >= 0.1 ? "var(--color-up)" : "var(--text-primary)" }}>{pct(r.net_margin)}</td>
                  <td className="px-2 py-1.5 num">—</td>
                  <td className="px-2 py-1.5 num">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Quarterly EPS */}
      {data.quarterly_eps.length > 0 && (
        <Section title="📋 季度 EPS">
          <div className="flex items-end gap-2" style={{ height: 100 }}>
            {data.quarterly_eps.slice(-8).map((q, i) => {
              const v = q.eps ?? 0;
              const maxV = Math.max(...data.quarterly_eps.map(x => Math.abs(x.eps ?? 0)), 1);
              const h = Math.round(Math.abs(v) / maxV * 80);
              return (
                <div key={`${q.year}-${q.month}`} className="flex flex-col items-center flex-1 gap-0.5">
                  <div className="text-[9px] num" style={{ color: v >= 0 ? "var(--color-up)" : "var(--color-down)" }}>
                    {v.toFixed(2)}
                  </div>
                  <div
                    className="w-full rounded-t"
                    style={{ height: h || 2, background: v >= 0 ? "var(--color-up)" : "var(--color-down)", minHeight: 2 }}
                    title={`${q.year} Q${Math.ceil(q.month / 3)}: EPS ${v}`}
                  />
                  <div className="text-[9px] num" style={{ color: "var(--text-tertiary)" }}>
                    {q.year} Q{Math.ceil(q.month / 3)}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Dividend History Section ──────────────────────────────────────────────────

function DividendHistorySection({
  data,
  loading,
  error,
}: {
  data:    DividendHistoryResponse | null;
  loading: boolean;
  error:   string | null;
}) {
  if (loading) return <Loading msg="從 yfinance 載入股利歷史中..." />;
  if (error)   return <Err msg={error} />;
  if (!data)   return null;

  if (!data.annual.length) {
    return (
      <Section title="💰 股利歷史（近 10 年）">
        <p className="text-xs py-2" style={{ color: "var(--text-tertiary)" }}>
          暫無配息紀錄（可能為不配息成長股，或 yfinance 無此資料）
        </p>
      </Section>
    );
  }

  const items = data.annual;
  const maxDiv   = Math.max(...items.map(d => d.total_dividend ?? 0), 0.01);
  const yieldVals = items.filter(d => d.yield_pct != null).map(d => d.yield_pct!);
  const maxYield  = Math.max(...yieldVals, 1);

  const BAR_CLR  = "#f59e0b";
  const LINE_CLR = "#22c55e";

  const W = 560, H = 150;
  const PAD = { t: 20, r: 50, b: 28, l: 44 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;
  const n  = items.length;
  const barW = Math.max(8, Math.floor(iW / n) - 4);

  const toX      = (i: number) => PAD.l + (i + 0.5) * (iW / n);
  const toDivY   = (v: number) => PAD.t + (1 - v / maxDiv)   * iH;
  const toYieldY = (v: number) => PAD.t + (1 - v / maxYield) * iH;

  const yieldPts = items
    .map((d, i) => d.yield_pct != null ? `${toX(i)},${toYieldY(d.yield_pct)}` : null)
    .filter(Boolean).join(" ");

  const yTicks = [0, 0.5, 1].map(r => ({
    y:     PAD.t + (1 - r) * iH,
    label: (r * maxDiv).toFixed(2),
  }));

  return (
    <div className="space-y-4">
      <Section title="💰 股利歷史（近 10 年）">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-lg p-3 text-center" style={{ background: "var(--bg-elevated)" }}>
            <div className="text-[10px] mb-1" style={{ color: "var(--text-tertiary)" }}>連續配息年數</div>
            <div className="text-lg num font-bold"
              style={{ color: data.consecutive_years >= 10 ? "var(--color-up)" : "var(--text-primary)" }}>
              {data.consecutive_years > 0 ? `${data.consecutive_years} 年` : "—"}
            </div>
          </div>
          <div className="rounded-lg p-3 text-center" style={{ background: "var(--bg-elevated)" }}>
            <div className="text-[10px] mb-1" style={{ color: "var(--text-tertiary)" }}>當前殖利率</div>
            <div className="text-lg num font-bold"
              style={{ color: data.latest_yield != null && data.latest_yield >= 4 ? "var(--color-up)" : "var(--text-primary)" }}>
              {data.latest_yield != null ? `${data.latest_yield.toFixed(2)}%` : "—"}
            </div>
          </div>
          <div className="rounded-lg p-3 text-center" style={{ background: "var(--bg-elevated)" }}>
            <div className="text-[10px] mb-1" style={{ color: "var(--text-tertiary)" }}>下次除息日</div>
            <div className="text-sm num font-bold">{data.next_ex_date ?? "—"}</div>
            {data.next_dividend != null && (
              <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                每股 {data.next_dividend.toFixed(2)} {data.currency}
              </div>
            )}
          </div>
        </div>

        {/* Combined bar (dividend) + line (yield) chart */}
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }} aria-label="股利歷史圖">
          {/* Grid + left Y ticks (dividend) */}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={PAD.l} x2={W - PAD.r} y1={t.y} y2={t.y}
                stroke="var(--border)" strokeWidth={0.5} />
              <text x={PAD.l - 4} y={t.y + 3} textAnchor="end" fontSize={8} fill="var(--text-tertiary)">
                {t.label}
              </text>
            </g>
          ))}

          {/* Bars: annual dividend */}
          {items.map((d, i) => {
            const v    = d.total_dividend ?? 0;
            const barH = Math.max(2, (v / maxDiv) * iH);
            const x    = toX(i) - barW / 2;
            const y    = PAD.t + iH - barH;
            return (
              <rect key={d.year} x={x} y={y} width={barW} height={barH}
                fill={BAR_CLR} opacity={0.82} rx={2}>
                <title>{`${d.year}: ${data.currency} ${v.toFixed(2)}`}</title>
              </rect>
            );
          })}

          {/* Line: yield % */}
          {yieldPts && (
            <polyline points={yieldPts} fill="none"
              stroke={LINE_CLR} strokeWidth={2} strokeLinejoin="round" />
          )}
          {items.map((d, i) =>
            d.yield_pct != null ? (
              <circle key={`dot-${d.year}`}
                cx={toX(i)} cy={toYieldY(d.yield_pct)}
                r={3} fill={LINE_CLR} />
            ) : null
          )}

          {/* Right Y label (yield %) */}
          <text x={W - PAD.r + 4} y={PAD.t + 10} fontSize={8} fill={LINE_CLR}>%</text>

          {/* X labels */}
          {items.map((d, i) => (
            <text key={`xl-${d.year}`} x={toX(i)} y={H - 4}
              textAnchor="middle" fontSize={8} fill="var(--text-tertiary)">
              {d.year}
            </text>
          ))}

          <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + iH}
            stroke="var(--border)" strokeWidth={0.5} />
        </svg>

        <div className="flex items-center gap-4 mt-2 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          <span><span style={{ color: BAR_CLR }}>■</span> 每股股利（{data.currency}）</span>
          <span><span style={{ color: LINE_CLR }}>─</span> 殖利率（%，右軸）</span>
          <span className="ml-auto">資料來源：Yahoo Finance</span>
        </div>
      </Section>

      {/* Detail table */}
      <Section title="📋 年度股利明細">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: 380 }}>
            <thead>
              <tr>
                {["年度", `每股股利（${data.currency}）`, "殖利率", "配息次數", "除息日"].map(h => (
                  <th key={h} className="px-2 py-1.5 text-left"
                    style={{ color: "var(--text-tertiary)", borderBottom: "1px solid var(--border)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...items].reverse().map((d, i) => (
                <tr key={d.year}
                  style={{ borderBottom: "1px solid var(--border)", background: i % 2 ? "var(--bg-elevated)" : "transparent" }}>
                  <td className="px-2 py-1.5 num font-medium">{d.year}</td>
                  <td className="px-2 py-1.5 num" style={{ color: BAR_CLR }}>
                    {d.total_dividend != null ? d.total_dividend.toFixed(2) : "—"}
                  </td>
                  <td className="px-2 py-1.5 num"
                    style={{ color: d.yield_pct != null ? (d.yield_pct >= 4 ? "var(--color-up)" : "var(--text-primary)") : "var(--text-tertiary)" }}>
                    {d.yield_pct != null ? `${d.yield_pct.toFixed(2)}%` : "—"}
                  </td>
                  <td className="px-2 py-1.5 num" style={{ color: "var(--text-secondary)" }}>
                    {d.payments}
                  </td>
                  <td className="px-2 py-1.5 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                    {d.dates.join("、") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          殖利率計算基準：除息年年底收盤價。資料來源：Yahoo Finance。
        </div>
      </Section>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

type AnalysisTab = "technical" | "fundamental" | "financials";

interface Props { symbol: string }

export default function AnalysisPanel({ symbol }: Props) {
  const [tab, setTab] = useState<AnalysisTab>("technical");

  const [techData,  setTechData]  = useState<TechnicalSummary | null>(null);
  const [fundData,  setFundData]  = useState<FundamentalData  | null>(null);
  const [finData,   setFinData]   = useState<FinancialsData   | null>(null);
  const [revData,   setRevData]   = useState<MonthlyRevenueResponse | null>(null);
  const [bandData,  setBandData]  = useState<ValuationBandResponse  | null>(null);
  const [peerData,  setPeerData]  = useState<PeerComparisonResponse | null>(null);
  const [fhData,    setFhData]    = useState<ForeignHoldingResponse  | null>(null);
  const [divData,   setDivData]   = useState<DividendHistoryResponse | null>(null);
  const [earnData,   setEarnData]   = useState<EarningsResponse | null>(null);
  const [faData,     setFaData]     = useState<FinancialAlertsResponse | null>(null);
  const [customPeers, setCustomPeers] = useState("");

  const [techLoad, setTechLoad]   = useState(false);
  const [fundLoad, setFundLoad]   = useState(false);
  const [finLoad,  setFinLoad]    = useState(false);
  const [revLoad,  setRevLoad]    = useState(false);
  const [bandLoad, setBandLoad]   = useState(false);
  const [peerLoad, setPeerLoad]   = useState(false);
  const [fhLoad,   setFhLoad]     = useState(false);
  const [divLoad,  setDivLoad]    = useState(false);
  const [earnLoad, setEarnLoad]   = useState(false);
  const [faLoad,   setFaLoad]     = useState(false);

  const [techErr, setTechErr]     = useState<string | null>(null);
  const [fundErr, setFundErr]     = useState<string | null>(null);
  const [finErr,  setFinErr]      = useState<string | null>(null);
  const [revErr,  setRevErr]      = useState<string | null>(null);
  const [bandErr, setBandErr]     = useState<string | null>(null);
  const [peerErr, setPeerErr]     = useState<string | null>(null);
  const [fhErr,   setFhErr]       = useState<string | null>(null);
  const [divErr,  setDivErr]      = useState<string | null>(null);
  const [earnErr, setEarnErr]     = useState<string | null>(null);
  const [faErr,   setFaErr]       = useState<string | null>(null);

  const loadPeers = (sym: string, peers = "") => {
    setPeerLoad(true); setPeerErr(null);
    getPeerComparison(sym, peers || undefined)
      .then(setPeerData).catch(e => setPeerErr(e.message)).finally(() => setPeerLoad(false));
  };

  // Load on symbol change
  useEffect(() => {
    setTechData(null); setFundData(null); setFinData(null);  setRevData(null);  setBandData(null);  setPeerData(null);  setFhData(null);  setDivData(null);  setEarnData(null);  setFaData(null);
    setTechErr(null);  setFundErr(null);  setFinErr(null);   setRevErr(null);   setBandErr(null);   setPeerErr(null);   setFhErr(null);   setDivErr(null);   setEarnErr(null);   setFaErr(null);
    setCustomPeers("");

    setTechLoad(true);
    getTechnical(symbol).then(setTechData).catch(e => setTechErr(e.message)).finally(() => setTechLoad(false));

    setFundLoad(true);
    getFundamental(symbol).then(setFundData).catch(e => setFundErr(e.message)).finally(() => setFundLoad(false));

    setFinLoad(true);
    getFinancials(symbol).then(setFinData).catch(e => setFinErr(e.message)).finally(() => setFinLoad(false));

    setRevLoad(true);
    getMonthlyRevenue(symbol).then(setRevData).catch(e => setRevErr(e.message)).finally(() => setRevLoad(false));

    setBandLoad(true);
    getValuationBand(symbol).then(setBandData).catch(e => setBandErr(e.message)).finally(() => setBandLoad(false));

    loadPeers(symbol);

    setFhLoad(true);
    getForeignHolding(symbol).then(setFhData).catch(e => setFhErr(e.message)).finally(() => setFhLoad(false));

    setDivLoad(true);
    getDividendHistory(symbol).then(setDivData).catch(e => setDivErr(e.message)).finally(() => setDivLoad(false));

    setEarnLoad(true);
    getEarnings(symbol).then(setEarnData).catch(e => setEarnErr(e.message)).finally(() => setEarnLoad(false));

    setFaLoad(true);
    getFinancialAlerts(symbol).then(setFaData).catch(e => setFaErr(e.message)).finally(() => setFaLoad(false));
  }, [symbol]);

  const TABS: { id: AnalysisTab; label: string }[] = [
    { id: "technical",   label: "🔍 技術面" },
    { id: "fundamental", label: "📊 基本面" },
    { id: "financials",  label: "📋 財務報表" },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Tab bar */}
      <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b overflow-x-auto" style={{ borderColor: "var(--border)" }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-3 py-1 rounded text-xs font-medium shrink-0 transition-colors"
            style={{
              background: tab === t.id ? "var(--color-brand)" : "var(--bg-elevated)",
              color:      tab === t.id ? "#fff" : "var(--text-secondary)",
            }}
          >
            {t.label}
          </button>
        ))}
        <span className="text-xs ml-2" style={{ color: "var(--text-tertiary)" }}>— {symbol}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {/* Technical */}
        {tab === "technical" && (
          techLoad ? <Loading msg="計算技術指標中..." /> :
          techErr  ? <Err msg={techErr} /> :
          techData ? (
            <div className="space-y-4">
              <AiAnalysisSection symbol={symbol} />
              <TechSection data={techData} />
              <VolumeProfileSection symbol={symbol} />
              <ForeignHoldingSection data={fhData} loading={fhLoad} error={fhErr} />
            </div>
          ) :
          <Loading msg="載入中..." />
        )}

        {/* Fundamental — FundSection + MonthlyRevenueSection */}
        {tab === "fundamental" && (
          fundLoad ? <Loading msg="載入基本面資料中..." /> :
          fundErr  ? <Err msg={fundErr} /> :
          fundData ? (
            <div className="space-y-4">
              <FundSection data={fundData} />
              <DividendHistorySection data={divData} loading={divLoad} error={divErr} />
              <ValuationBandSection  data={bandData} loading={bandLoad} error={bandErr} />
              <MonthlyRevenueSection data={revData}  loading={revLoad}  error={revErr}  />
              <PeerComparisonSection
                data={peerData}  loading={peerLoad} error={peerErr}
                targetSymbol={symbol}
                onCustomPeers={(peers) => { setCustomPeers(peers); loadPeers(symbol, peers); }}
              />
            </div>
          ) :
          <Loading msg="載入中..." />
        )}

        {/* Financials */}
        {tab === "financials" && (
          finLoad ? <Loading msg="載入財務報表中..." /> :
          finErr  ? <Err msg={finErr} /> :
          finData ? (
            <div className="space-y-4">
              <FinancialAlertsSection data={faData} loading={faLoad} error={faErr} />
              <EarningsSurpriseSection data={earnData} loading={earnLoad} error={earnErr} />
              <FinancialSection data={finData} />
            </div>
          ) :
          <Loading msg="載入中..." />
        )}
      </div>
    </div>
  );
}

function Loading({ msg: _msg }: { msg: string }) {
  return (
    <div className="py-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex justify-between py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="animate-pulse rounded" style={{ width: "38%", height: "10px", background: "var(--bg-elevated)", animationDelay: `${i * 50}ms` }} />
          <div className="animate-pulse rounded" style={{ width: "26%", height: "10px", background: "var(--bg-elevated)", animationDelay: `${i * 50 + 25}ms` }} />
        </div>
      ))}
    </div>
  );
}
function Err({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg p-4 text-xs" style={{ background: "var(--color-down-subtle)", color: "var(--color-down)", border: "1px solid var(--color-down)" }}>
      無法載入資料：{msg}
    </div>
  );
}
