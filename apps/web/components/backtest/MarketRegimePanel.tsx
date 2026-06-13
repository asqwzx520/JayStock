"use client";

/**
 * P20-58: 市場環境（Regime）分析
 * 以基準指數 60 日 SMA 方向 + 波動率識別環境：
 *   多頭（Trending Up）/ 空頭（Trending Down）/ 盤整（Ranging）
 * 分別計算策略在各環境下的勝率、平均報酬、夏普。
 */

import type { BacktestTrade, BacktestBenchmarkPoint } from "@/lib/api";
import { useMemo } from "react";

interface Props {
  trades:         BacktestTrade[];
  benchmarkCurve: BacktestBenchmarkPoint[];
}

type Regime = "bull" | "bear" | "range";

interface RegimeStat {
  label:   string;
  color:   string;
  bg:      string;
  count:   number;
  wr:      number;
  avgRet:  number;
  sumPnl:  number;
  pct:     number;   // % of all trades
}

function sma(arr: number[], period: number): number[] {
  const out: number[] = new Array(arr.length).fill(NaN);
  for (let i = period - 1; i < arr.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += arr[j];
    out[i] = s / period;
  }
  return out;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = arr.reduce((s, v) => s + v, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

export default function MarketRegimePanel({ trades, benchmarkCurve }: Props) {
  const { regimeStats, dateRegimeMap, tradeRegimes } = useMemo(() => {
    if (!benchmarkCurve || benchmarkCurve.length < 65 || !trades || trades.length === 0) {
      return { regimeStats: null, dateRegimeMap: new Map<string, Regime>(), tradeRegimes: [] };
    }

    const vals  = benchmarkCurve.map(p => p.value);
    const dates = benchmarkCurve.map(p => p.time);
    const sma60 = sma(vals, 60);

    // 60 日日報酬波動率
    const rets: number[] = [];
    for (let i = 1; i < vals.length; i++) {
      rets.push(vals[i] / vals[i - 1] - 1);
    }
    const rollingVol20: number[] = new Array(vals.length).fill(NaN);
    for (let i = 20; i < vals.length; i++) {
      rollingVol20[i] = stdDev(rets.slice(i - 20, i)) * Math.sqrt(252);
    }
    const allVols = rollingVol20.filter(v => !isNaN(v));
    const medVol  = [...allVols].sort((a, b) => a - b)[Math.floor(allVols.length / 2)] ?? 0.15;

    // 每天的 regime
    const dateRegimeMap = new Map<string, Regime>();
    for (let i = 60; i < vals.length; i++) {
      const slope = sma60[i] - sma60[i - 10];  // 10日 SMA 斜率
      const vol   = rollingVol20[i] ?? medVol;
      let regime: Regime;
      if (vol > medVol * 1.3) {
        // 高波動 → 根據斜率判斷多空
        regime = slope > 0 ? "bull" : "bear";
      } else if (slope > 0) {
        regime = "bull";
      } else if (slope < 0) {
        regime = "bear";
      } else {
        regime = "range";
      }
      dateRegimeMap.set(dates[i], regime);
    }

    // 為每筆交易分配 regime（以進場日為準）
    const tradeRegimes: Regime[] = trades.map(t => dateRegimeMap.get(t.entry_date) ?? "range");

    // 各 regime 統計
    const groups: Record<Regime, BacktestTrade[]> = { bull: [], bear: [], range: [] };
    trades.forEach((t, i) => groups[tradeRegimes[i]].push(t));

    const makeStats = (arr: BacktestTrade[], label: string, color: string, bg: string): RegimeStat => ({
      label, color, bg,
      count:  arr.length,
      wr:     arr.length ? arr.filter(t => t.pnl > 0).length / arr.length : 0,
      avgRet: arr.length ? arr.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / arr.length : 0,
      sumPnl: arr.reduce((s, t) => s + t.pnl, 0),
      pct:    trades.length ? arr.length / trades.length : 0,
    });

    const regimeStats = [
      makeStats(groups.bull,  "多頭趨勢", "#22c55e", "#d1fae5"),
      makeStats(groups.bear,  "空頭趨勢", "#ef4444", "#fee2e2"),
      makeStats(groups.range, "盤整",    "#f59e0b", "#fef9c3"),
    ];

    return { regimeStats, dateRegimeMap, tradeRegimes };
  }, [trades, benchmarkCurve]);

  // regime 時序（用 benchmarkCurve 畫色帶）
  const regimeBands = useMemo(() => {
    const bands: { start: string; end: string; regime: Regime }[] = [];
    let cur: Regime | null = null;
    let startDate = "";
    for (const p of benchmarkCurve) {
      const r = dateRegimeMap.get(p.time);
      if (!r) continue;
      if (r !== cur) {
        if (cur && startDate) bands.push({ start: startDate, end: p.time, regime: cur });
        cur = r; startDate = p.time;
      }
    }
    if (cur && startDate) {
      bands.push({ start: startDate, end: benchmarkCurve[benchmarkCurve.length - 1]?.time ?? startDate, regime: cur });
    }
    return bands;
  }, [benchmarkCurve, dateRegimeMap]);

  if (!regimeStats) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        基準曲線資料不足（需至少 65 個交易日）
      </div>
    );
  }

  const REGIME_COLOR: Record<Regime, string> = { bull: "#22c55e", bear: "#ef4444", range: "#f59e0b" };
  const REGIME_LABEL: Record<Regime, string> = { bull: "多頭", bear: "空頭", range: "盤整" };

  // Timeline SVG
  const TW = 440, TH = 20, TP = 8;
  const minDate = benchmarkCurve[60]?.time ?? "";
  const maxDate = benchmarkCurve[benchmarkCurve.length - 1]?.time ?? "";
  const toX = (dateStr: string) => {
    if (!minDate || !maxDate || minDate === maxDate) return TW / 2;
    const total = new Date(maxDate).getTime() - new Date(minDate).getTime();
    const offset = new Date(dateStr).getTime() - new Date(minDate).getTime();
    return TP + (offset / total) * (TW - TP * 2);
  };

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* ── 各環境統計卡片 ──────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        {regimeStats.map(s => (
          <div key={s.label} className="rounded-lg p-3"
            style={{ background: s.bg, border: `1px solid ${s.color}44` }}>
            <div className="text-xs font-bold mb-2" style={{ color: s.color }}>{s.label}</div>
            <div className="flex flex-col gap-1">
              {[
                { label: "交易筆數",  value: `${s.count} 筆（${(s.pct * 100).toFixed(0)}%）` },
                { label: "勝率",     value: `${(s.wr * 100).toFixed(1)}%`, isNum: true, v: s.wr - 0.5 },
                { label: "平均報酬",  value: `${s.avgRet >= 0 ? "+" : ""}${(s.avgRet * 100).toFixed(2)}%`, isNum: true, v: s.avgRet },
                { label: "累積盈虧",  value: `${s.sumPnl >= 0 ? "+" : ""}${(s.sumPnl / 1000).toFixed(1)}K`, isNum: true, v: s.sumPnl },
              ].map(r => (
                <div key={r.label} className="flex justify-between text-[10px]">
                  <span style={{ color: "#374151" }}>{r.label}</span>
                  <span className="font-mono font-semibold"
                    style={{ color: r.isNum ? (r.v! >= 0 ? "#15803d" : "#dc2626") : "#374151" }}>
                    {r.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* ── 市場環境時序 ────────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          市場環境時序（以基準 60 日 SMA 斜率識別）
        </div>
        <div className="rounded-lg p-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <svg viewBox={`0 0 ${TW} ${TH + 16}`} style={{ width: "100%", height: TH + 16 }}>
            {regimeBands.map((b, i) => {
              const x1 = toX(b.start);
              const x2 = toX(b.end);
              return (
                <rect key={i} x={x1} y={0} width={Math.max(1, x2 - x1)} height={TH}
                  fill={REGIME_COLOR[b.regime]} opacity={0.5} />
              );
            })}
            {/* 標籤 */}
            <text x={TP} y={TH + 12} fontSize={7} fill="var(--text-tertiary)">{minDate.slice(0, 7)}</text>
            <text x={TW - TP} y={TH + 12} fontSize={7} textAnchor="end" fill="var(--text-tertiary)">{maxDate.slice(0, 7)}</text>
          </svg>
        </div>
        <div className="flex gap-3 mt-1.5">
          {(["bull","bear","range"] as Regime[]).map(r => (
            <div key={r} className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm" style={{ background: REGIME_COLOR[r], opacity: 0.7 }} />
              <span className="text-[9px]" style={{ color: "var(--text-secondary)" }}>{REGIME_LABEL[r]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 策略偏好分析 ────────────────────────────────── */}
      <div className="rounded-lg p-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
        <div className="text-[10px] font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          策略環境偏好診斷
        </div>
        {(() => {
          const best  = [...regimeStats].sort((a, b) => b.avgRet - a.avgRet)[0];
          const worst = [...regimeStats].sort((a, b) => a.avgRet - b.avgRet)[0];
          const suggestions: string[] = [];
          if (best.label === "多頭趨勢" && worst.label === "空頭趨勢")
            suggestions.push("順勢型策略：在多頭環境中有顯著優勢，空頭期建議縮減倉位或切換做空。");
          else if (best.label === "盤整")
            suggestions.push("均值回歸型策略：在盤整環境表現最佳，趨勢行情需注意停損保護。");
          else if (best.label === "空頭趨勢")
            suggestions.push("逆勢型策略：在下跌市場仍有正報酬，可能具有對沖價值。");
          if (worst.avgRet < -0.02)
            suggestions.push(`${worst.label}環境平均報酬 ${(worst.avgRet * 100).toFixed(1)}%，建議加入環境過濾器停止交易。`);
          if (best.wr > 0.65)
            suggestions.push(`${best.label}環境勝率高達 ${(best.wr * 100).toFixed(0)}%，可考慮在此環境加大倉位。`);
          return (
            <div className="flex flex-col gap-1.5">
              {suggestions.length === 0
                ? <span className="text-[10px]" style={{ color: "var(--text-primary)" }}>三種環境表現均衡，策略穩健性佳。</span>
                : suggestions.map((s, i) => (
                    <div key={i} className="text-[10px] flex items-start gap-1.5">
                      <span style={{ color: "#6366f1" }}>·</span>
                      <span style={{ color: "var(--text-primary)" }}>{s}</span>
                    </div>
                  ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
