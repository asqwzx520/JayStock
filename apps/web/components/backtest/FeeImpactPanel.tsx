"use client";

/**
 * P17-50: 手續費影響分析
 * 計算費用對策略報酬的拖累效果：
 * - 費用佔毛利比例（費損率）
 * - 零手續費模擬報酬
 * - 損益平衡分析（需要幾筆交易才能回收手續費）
 */

import type { BacktestTrade, BacktestStats } from "@/lib/api";
import { useMemo } from "react";

interface Props {
  trades:         BacktestTrade[];
  stats:          BacktestStats;
  initialCapital: number;
}

function pct(v: number, d = 2) {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;
}

export default function FeeImpactPanel({ trades, stats, initialCapital }: Props) {
  const analysis = useMemo(() => {
    if (!trades || trades.length === 0) return null;

    const totalFee   = trades.reduce((s, t) => s + (t.fee ?? 0), 0);
    const netPnl     = trades.reduce((s, t) => s + t.pnl, 0);
    const grossPnl   = netPnl + totalFee;                    // 無手續費時的損益
    const feeRatio   = grossPnl > 0 ? totalFee / grossPnl : null;  // 費損率

    const netReturn   = netPnl / initialCapital;
    const grossReturn = grossPnl / initialCapital;
    const feeDrag     = grossReturn - netReturn;              // 手續費拖累的報酬率

    // 平均每筆費用
    const avgFeePerTrade = totalFee / trades.length;

    // 按費用大小排序找出最貴的 5 筆
    const topFee = [...trades]
      .sort((a, b) => (b.fee ?? 0) - (a.fee ?? 0))
      .slice(0, 5);

    // 損益平衡：需要多少筆獲利才能覆蓋全部手續費
    const avgWinPnl = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) /
      Math.max(1, trades.filter(t => t.pnl > 0).length);
    const breakevenTrades = avgWinPnl > 0 ? Math.ceil(totalFee / avgWinPnl) : null;

    // 模擬不同折扣下的報酬
    const scenarios = [
      { label: "原價（無折扣）",   discount: 0 },
      { label: "6折（0.0855%）", discount: 0.4 },
      { label: "5折（0.07125%）",discount: 0.5 },
      { label: "3折（0.04275%）",discount: 0.7 },
      { label: "1折（0.01425%）",discount: 0.9 },
      { label: "零手續費",        discount: 1.0 },
    ].map(s => {
      // 只折扣買入佣金，賣出佣金 = 買入佣金 + 0.3%（台股不折扣稅）
      // 但這裡我們用線性近似：fee_saved = totalFee * discount * 買入佔比
      // 簡化：假設買入費 ≈ totalFee * 0.32（佣金佔總費用約32%，稅約68%）
      const COMMISSION_SHARE = 0.32;
      const saved    = totalFee * s.discount * COMMISSION_SHARE;
      const simPnl   = netPnl + saved;
      const simRet   = simPnl / initialCapital;
      return { ...s, simRet, saved, isBase: s.discount === 0 };
    });

    return {
      totalFee, netPnl, grossPnl, feeRatio,
      netReturn, grossReturn, feeDrag,
      avgFeePerTrade, topFee, breakevenTrades, scenarios,
    };
  }, [trades, initialCapital]);

  if (!analysis) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        無交易資料
      </div>
    );
  }

  const {
    totalFee, netPnl, grossPnl, feeRatio,
    netReturn, grossReturn, feeDrag,
    avgFeePerTrade, topFee, breakevenTrades, scenarios,
  } = analysis;

  const feeDragSevere = feeDrag > 0.05;

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* ── 費用警告 ─────────────────────────────────────────── */}
      {feeDragSevere && (
        <div
          className="rounded-lg p-3 flex gap-2 items-start"
          style={{ background: "#fef2f2", border: "1px solid #fca5a5" }}
        >
          <span>⚠️</span>
          <div className="text-[11px]" style={{ color: "#991b1b" }}>
            手續費拖累報酬達 <strong>{(feeDrag * 100).toFixed(2)}%</strong>，
            建議洽詢券商申請折扣或減少交易頻率。
          </div>
        </div>
      )}

      {/* ── 關鍵指標 ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: "總手續費",
            value: totalFee.toLocaleString("zh-TW", { maximumFractionDigits: 0 }),
            sub:   "元",
            color: "#ef4444",
          },
          {
            label: "費損率",
            value: feeRatio !== null ? `${(feeRatio * 100).toFixed(1)}%` : "N/A",
            sub:   "手續費 / 毛利",
            color: feeRatio !== null && feeRatio > 0.3 ? "#ef4444" : "#f59e0b",
          },
          {
            label: "手續費拖累",
            value: `${(feeDrag * 100).toFixed(2)}%`,
            sub:   "毛報酬 − 淨報酬",
            color: feeDragSevere ? "#ef4444" : "#f59e0b",
          },
          {
            label: "平均每筆費用",
            value: avgFeePerTrade.toLocaleString("zh-TW", { maximumFractionDigits: 0 }),
            sub:   "元 / 筆",
            color: "var(--text-primary)",
          },
        ].map(s => (
          <div key={s.label} className="rounded-lg p-3"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <div className="text-[10px] mb-1" style={{ color: "var(--text-secondary)" }}>{s.label}</div>
            <div className="text-sm font-bold" style={{ color: s.color }}>
              {s.value} <span className="text-[10px] font-normal">{s.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── 淨 vs 毛報酬比較 ──────────────────────────────────── */}
      <div className="rounded-lg p-4" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
        <div className="text-xs font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
          淨報酬 vs 毛報酬（零手續費）
        </div>
        <div className="flex flex-col gap-2">
          {[
            { label: "毛報酬（零手續費）", ret: grossReturn, pnl: grossPnl, color: "#22c55e" },
            { label: "淨報酬（實際）",     ret: netReturn,   pnl: netPnl,   color: "#6366f1" },
          ].map(r => {
            const barW = Math.min(100, Math.abs(r.ret) * 500);
            return (
              <div key={r.label} className="flex items-center gap-3">
                <div className="text-[10px] w-32 shrink-0" style={{ color: "var(--text-secondary)" }}>
                  {r.label}
                </div>
                <div className="flex-1 h-5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${barW}%`, background: r.color, opacity: 0.8 }}
                  />
                </div>
                <div className="text-[11px] font-mono w-16 text-right shrink-0"
                  style={{ color: r.ret >= 0 ? "#22c55e" : "#ef4444" }}>
                  {pct(r.ret)}
                </div>
                <div className="text-[9px] w-20 text-right shrink-0" style={{ color: "var(--text-tertiary)" }}>
                  {r.pnl >= 0 ? "+" : ""}{r.pnl.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}
                </div>
              </div>
            );
          })}
        </div>
        {breakevenTrades !== null && (
          <div className="text-[9px] mt-3" style={{ color: "var(--text-tertiary)" }}>
            損益平衡：需 <strong>{breakevenTrades}</strong> 筆平均獲利才能覆蓋全部手續費
          </div>
        )}
      </div>

      {/* ── 折扣情境模擬 ──────────────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          不同折扣情境模擬（僅佣金部分可折扣，0.3% 稅不變）
        </div>
        <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr style={{ background: "var(--bg-elevated)" }}>
                {["情境", "模擬報酬", "較現況改善", "節省費用（元）"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium"
                    style={{ color: "var(--text-secondary)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s, i) => {
                const delta = s.simRet - netReturn;
                return (
                  <tr key={s.label}
                    style={{
                      borderTop: "1px solid var(--border)",
                      background: s.isBase
                        ? "var(--bg-elevated)"
                        : i % 2 ? "var(--bg-elevated)" : "transparent",
                      fontWeight: s.isBase ? "600" : undefined,
                    }}>
                    <td className="px-3 py-2" style={{ color: "var(--text-primary)" }}>{s.label}</td>
                    <td className="px-3 py-2 font-mono" style={{ color: s.simRet >= 0 ? "#22c55e" : "#ef4444" }}>
                      {pct(s.simRet)}
                    </td>
                    <td className="px-3 py-2 font-mono" style={{ color: delta > 0 ? "#22c55e" : "var(--text-tertiary)" }}>
                      {delta > 0.0001 ? `+${(delta * 100).toFixed(2)}%` : "—"}
                    </td>
                    <td className="px-3 py-2 font-mono" style={{ color: "var(--text-secondary)" }}>
                      {s.saved > 0 ? s.saved.toLocaleString("zh-TW", { maximumFractionDigits: 0 }) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 費用最高的 5 筆交易 ───────────────────────────────── */}
      {topFee.length > 0 && (
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
            費用最高的 5 筆交易
          </div>
          <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr style={{ background: "var(--bg-elevated)" }}>
                  {["進場日", "出場日", "持倉天", "報酬%", "損益", "費用"].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium"
                      style={{ color: "var(--text-secondary)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topFee.map((t, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)", background: i % 2 ? "var(--bg-elevated)" : "transparent" }}>
                    <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>{t.entry_date}</td>
                    <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>{t.exit_date}</td>
                    <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>{t.hold_days}</td>
                    <td className="px-3 py-2 font-mono"
                      style={{ color: (t.pnl_pct ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                      {pct(t.pnl_pct ?? 0)}
                    </td>
                    <td className="px-3 py-2 font-mono"
                      style={{ color: t.pnl >= 0 ? "#22c55e" : "#ef4444" }}>
                      {t.pnl >= 0 ? "+" : ""}{t.pnl.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-3 py-2 font-mono" style={{ color: "#ef4444" }}>
                      {(t.fee ?? 0).toLocaleString("zh-TW", { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
