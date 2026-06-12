"use client";

/**
 * P16-46: 收益歸因分析
 * 把總報酬分解成：出場原因 × 多空方向，找出哪種出場策略最有效。
 */

import type { BacktestTrade } from "@/lib/api";
import { useMemo } from "react";

interface Props {
  trades: BacktestTrade[];
}

const EXIT_LABELS: Record<string, string> = {
  signal:            "訊號出場",
  stop_loss:         "固定停損",
  stop_loss_gap:     "停損（跳空）",
  trailing_stop:     "移動停損",
  trailing_stop_gap: "移動停損（跳空）",
  take_profit:       "停利",
  time_stop:         "時間停損",
  end_of_period:     "期末強平",
};

const EXIT_COLORS: Record<string, string> = {
  signal:            "#6366f1",
  stop_loss:         "#ef4444",
  stop_loss_gap:     "#b91c1c",
  trailing_stop:     "#f97316",
  trailing_stop_gap: "#c2410c",
  take_profit:       "#22c55e",
  time_stop:         "#a855f7",
  end_of_period:     "#64748b",
};

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(item);
  }
  return m;
}

function calcGroup(ts: BacktestTrade[]) {
  const wins  = ts.filter(t => t.pnl > 0).length;
  const pnl   = ts.reduce((s, t) => s + t.pnl, 0);
  const avgRet = ts.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / ts.length;
  const fees  = ts.reduce((s, t) => s + (t.fee ?? 0), 0);
  return { count: ts.length, wins, pnl, avgRet, fees, winRate: wins / ts.length };
}

export default function ReturnAttributionPanel({ trades }: Props) {
  const { byExit, bySide, totalPnl, summary } = useMemo(() => {
    if (!trades || trades.length === 0) return { byExit: [], bySide: [], totalPnl: 0, summary: null };

    const total = trades.reduce((s, t) => s + t.pnl, 0);

    // 按出場原因分組
    const exitMap = groupBy(trades, t => t.exit_reason ?? "signal");
    const byExitArr = Array.from(exitMap.entries())
      .map(([key, ts]) => ({ key, label: EXIT_LABELS[key] ?? key, color: EXIT_COLORS[key] ?? "#6366f1", ...calcGroup(ts) }))
      .sort((a, b) => b.pnl - a.pnl);

    // 按多空方向分組
    const sideMap = groupBy(trades, t => t.side ?? "long");
    const bySideArr = Array.from(sideMap.entries())
      .map(([key, ts]) => ({ key, label: key === "long" ? "多頭" : "空頭", color: key === "long" ? "#22c55e" : "#ef4444", ...calcGroup(ts) }));

    // 整體統計
    const wins = trades.filter(t => t.pnl > 0).length;
    const profitTrades = trades.filter(t => t.pnl > 0);
    const lossTrades   = trades.filter(t => t.pnl <= 0);
    const avgWin  = profitTrades.length ? profitTrades.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / profitTrades.length : 0;
    const avgLoss = lossTrades.length   ? lossTrades.reduce((s, t) => s + (t.pnl_pct ?? 0), 0) / lossTrades.length   : 0;

    return {
      byExit:   byExitArr,
      bySide:   bySideArr,
      totalPnl: total,
      summary:  { wins, total: trades.length, avgWin, avgLoss },
    };
  }, [trades]);

  if (!summary) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        無交易資料
      </div>
    );
  }

  const maxAbsPnl = Math.max(1, ...byExit.map(g => Math.abs(g.pnl)));

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* ── 多空貢獻 ──────────────────────────────────────────── */}
      {bySide.length > 1 && (
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>多空貢獻</div>
          <div className="flex gap-3">
            {bySide.map(g => (
              <div
                key={g.key}
                className="flex-1 rounded-lg p-3"
                style={{ background: "var(--bg-elevated)", border: `1px solid ${g.color}44` }}
              >
                <div className="text-[10px] mb-1" style={{ color: g.color }}>{g.label}</div>
                <div className="text-sm font-bold" style={{ color: g.pnl >= 0 ? "#22c55e" : "#ef4444" }}>
                  {g.pnl >= 0 ? "+" : ""}{g.pnl.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                  {g.count} 筆 · 勝率 {(g.winRate * 100).toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 出場原因條形圖 ────────────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
          各出場原因累計損益
        </div>
        <div className="flex flex-col gap-2">
          {byExit.map(g => {
            const barW  = Math.abs(g.pnl) / maxAbsPnl * 65;
            const isPos = g.pnl >= 0;
            const share = totalPnl !== 0 ? (g.pnl / Math.abs(totalPnl)) * 100 : 0;
            return (
              <div key={g.key} className="flex items-center gap-2">
                <div className="text-[10px] text-right shrink-0 w-24" style={{ color: "var(--text-secondary)" }}>
                  {g.label}
                </div>
                <div className="flex-1 flex items-center gap-1 relative h-5">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-1/2 flex justify-end">
                      <div
                        className="h-4 rounded-l"
                        style={{ width: isPos ? 0 : `${barW}%`, background: "#ef4444", opacity: 0.8 }}
                      />
                    </div>
                    <div className="w-px h-5 shrink-0" style={{ background: "var(--border)" }} />
                    <div className="w-1/2">
                      <div
                        className="h-4 rounded-r"
                        style={{ width: isPos ? `${barW}%` : 0, background: g.color, opacity: 0.8 }}
                      />
                    </div>
                  </div>
                </div>
                <div className="text-[10px] font-mono w-24" style={{ color: isPos ? "#22c55e" : "#ef4444" }}>
                  {isPos ? "+" : ""}{g.pnl.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[9px] w-12 shrink-0" style={{ color: "var(--text-tertiary)" }}>
                  {share >= 0 ? "+" : ""}{share.toFixed(1)}%
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 明細表格 ─────────────────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>各出場原因詳細統計</div>
        <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr style={{ background: "var(--bg-elevated)" }}>
                {["出場原因", "筆數", "勝率", "平均報酬", "累計損益", "手續費"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium" style={{ color: "var(--text-secondary)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byExit.map((g, i) => (
                <tr
                  key={g.key}
                  style={{ borderTop: "1px solid var(--border)", background: i % 2 ? "var(--bg-elevated)" : "transparent" }}
                >
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: g.color }} />
                      {g.label}
                    </span>
                  </td>
                  <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>{g.count}</td>
                  <td className="px-3 py-2" style={{ color: g.winRate >= 0.5 ? "#22c55e" : "#ef4444" }}>
                    {(g.winRate * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 font-mono" style={{ color: g.avgRet >= 0 ? "#22c55e" : "#ef4444" }}>
                    {g.avgRet >= 0 ? "+" : ""}{(g.avgRet * 100).toFixed(2)}%
                  </td>
                  <td className="px-3 py-2 font-mono" style={{ color: g.pnl >= 0 ? "#22c55e" : "#ef4444" }}>
                    {g.pnl >= 0 ? "+" : ""}{g.pnl.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-3 py-2 font-mono" style={{ color: "var(--text-tertiary)" }}>
                    {g.fees.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
