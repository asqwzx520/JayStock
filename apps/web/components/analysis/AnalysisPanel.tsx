"use client";

import { useState, useEffect } from "react";
import type {
  TechnicalSummary,
  FundamentalData,
  FinancialsData,
  AnnualFinancial,
  MonthlyRevenueItem,
  MonthlyRevenueResponse,
} from "@/lib/api";
import { getTechnical, getFundamental, getFinancials, getMonthlyRevenue } from "@/lib/api";

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
      <Section title="📈 財務報表趨勢（5 年）">
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

// ── Main ─────────────────────────────────────────────────────────────────────

type AnalysisTab = "technical" | "fundamental" | "financials";

interface Props { symbol: string }

export default function AnalysisPanel({ symbol }: Props) {
  const [tab, setTab] = useState<AnalysisTab>("technical");

  const [techData,  setTechData]  = useState<TechnicalSummary | null>(null);
  const [fundData,  setFundData]  = useState<FundamentalData  | null>(null);
  const [finData,   setFinData]   = useState<FinancialsData   | null>(null);
  const [revData,   setRevData]   = useState<MonthlyRevenueResponse | null>(null);

  const [techLoad, setTechLoad]   = useState(false);
  const [fundLoad, setFundLoad]   = useState(false);
  const [finLoad,  setFinLoad]    = useState(false);
  const [revLoad,  setRevLoad]    = useState(false);

  const [techErr, setTechErr]     = useState<string | null>(null);
  const [fundErr, setFundErr]     = useState<string | null>(null);
  const [finErr,  setFinErr]      = useState<string | null>(null);
  const [revErr,  setRevErr]      = useState<string | null>(null);

  // Load on symbol change
  useEffect(() => {
    setTechData(null); setFundData(null); setFinData(null);  setRevData(null);
    setTechErr(null);  setFundErr(null);  setFinErr(null);   setRevErr(null);

    setTechLoad(true);
    getTechnical(symbol).then(setTechData).catch(e => setTechErr(e.message)).finally(() => setTechLoad(false));

    setFundLoad(true);
    getFundamental(symbol).then(setFundData).catch(e => setFundErr(e.message)).finally(() => setFundLoad(false));

    setFinLoad(true);
    getFinancials(symbol).then(setFinData).catch(e => setFinErr(e.message)).finally(() => setFinLoad(false));

    setRevLoad(true);
    getMonthlyRevenue(symbol).then(setRevData).catch(e => setRevErr(e.message)).finally(() => setRevLoad(false));
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
          techData ? <TechSection data={techData} /> :
          <Loading msg="載入中..." />
        )}

        {/* Fundamental — FundSection + MonthlyRevenueSection */}
        {tab === "fundamental" && (
          fundLoad ? <Loading msg="載入基本面資料中..." /> :
          fundErr  ? <Err msg={fundErr} /> :
          fundData ? (
            <div className="space-y-4">
              <FundSection data={fundData} />
              <MonthlyRevenueSection data={revData} loading={revLoad} error={revErr} />
            </div>
          ) :
          <Loading msg="載入中..." />
        )}

        {/* Financials */}
        {tab === "financials" && (
          finLoad ? <Loading msg="載入財務報表中..." /> :
          finErr  ? <Err msg={finErr} /> :
          finData ? <FinancialSection data={finData} /> :
          <Loading msg="載入中..." />
        )}
      </div>
    </div>
  );
}

function Loading({ msg }: { msg: string }) {
  return (
    <div className="flex items-center justify-center h-48 gap-2 text-sm" style={{ color: "var(--text-tertiary)" }}>
      <span className="animate-spin">⏳</span> {msg}
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
