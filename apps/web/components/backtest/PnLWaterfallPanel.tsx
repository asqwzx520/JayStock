"use client";

/**
 * P20-60: 累積盈虧瀑布圖 + Pareto 80/20 分析
 * - 按交易序號的累積 PnL（瀑布色塊）
 * - 各筆對總盈虧貢獻排序（正貢獻 vs 負貢獻）
 * - Pareto：前 N% 交易貢獻多少 % 利潤
 */

import type { BacktestTrade } from "@/lib/api";
import { useMemo } from "react";

interface Props {
  trades: BacktestTrade[];
  initialCapital: number;
}

export default function PnLWaterfallPanel({ trades, initialCapital }: Props) {
  const analysis = useMemo(() => {
    if (!trades || trades.length === 0) return null;

    // 累積 PnL 序列
    let cum = 0;
    const cumPnl = trades.map(t => { cum += t.pnl; return cum; });
    const totalPnl = cum;

    // 各筆貢獻排序（正/負分離）
    const winners = [...trades].filter(t => t.pnl > 0).sort((a, b) => b.pnl - a.pnl);
    const losers  = [...trades].filter(t => t.pnl <= 0).sort((a, b) => a.pnl - b.pnl);
    const totalWin  = winners.reduce((s, t) => s + t.pnl, 0);
    const totalLoss = losers.reduce((s, t) => s + t.pnl, 0);

    // Pareto：按絕對貢獻排序（正貢獻），看 Top N% 筆貢獻多少 % 利潤
    const sorted = [...trades].sort((a, b) => b.pnl - a.pnl);
    const pareto: { pct: number; cumPnlPct: number }[] = [];
    let cumP = 0;
    sorted.forEach((t, i) => {
      if (t.pnl > 0) cumP += t.pnl;
      pareto.push({ pct: (i + 1) / trades.length, cumPnlPct: totalWin > 0 ? cumP / totalWin : 0 });
    });

    // 找 80% 利潤由幾%交易貢獻
    const idx80 = pareto.findIndex(p => p.cumPnlPct >= 0.8);
    const top80Pct = idx80 >= 0 ? pareto[idx80].pct : 1.0;

    // 最大單筆贏/虧
    const biggestWin  = winners[0];
    const biggestLoss = losers[0];

    return { cumPnl, totalPnl, winners, losers, totalWin, totalLoss, sorted, pareto, top80Pct, biggestWin, biggestLoss };
  }, [trades]);

  if (!analysis) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        無交易資料
      </div>
    );
  }

  const { cumPnl, totalPnl, winners, losers, totalWin, totalLoss, pareto, top80Pct, biggestWin, biggestLoss } = analysis;

  // ── 累積 PnL 圖（折線 + 零線）
  const CW = 440, CH = 100, CP = 10;
  const minV = Math.min(0, ...cumPnl);
  const maxV = Math.max(0, ...cumPnl);
  const range = maxV - minV || 1;
  const cx = (i: number) => CP + (i / (cumPnl.length - 1 || 1)) * (CW - CP * 2);
  const cy = (v: number) => CP + (1 - (v - minV) / range) * (CH - CP * 2);
  const zeroY = cy(0);

  // ── Pareto 圖
  const PW = 220, PH = 80;
  const px = (p: number) => CP + p * (PW - CP * 2);
  const py = (p: number) => CP + (1 - p) * (PH - CP * 2);

  // ── Top-10 贏家/輸家貢獻條形
  const topWin  = winners.slice(0, 8);
  const topLoss = losers.slice(0, 8);
  const maxBar = Math.max(1, ...[...topWin, ...topLoss].map(t => Math.abs(t.pnl)));

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* ── 摘要卡片 ────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: "總淨盈虧",
            value: `${totalPnl >= 0 ? "+" : ""}${(totalPnl / 1000).toFixed(1)}K`,
            color: totalPnl >= 0 ? "#22c55e" : "#ef4444",
            hint:  `報酬率 ${((totalPnl / initialCapital) * 100).toFixed(1)}%`,
          },
          {
            label: "總盈利（勝方）",
            value: `+${(totalWin / 1000).toFixed(1)}K`,
            color: "#22c55e",
            hint:  `${winners.length} 筆獲利交易`,
          },
          {
            label: "總虧損（敗方）",
            value: `${(totalLoss / 1000).toFixed(1)}K`,
            color: "#ef4444",
            hint:  `${losers.length} 筆虧損交易`,
          },
          {
            label: "Pareto：80% 利潤",
            value: `前 ${(top80Pct * 100).toFixed(0)}% 筆`,
            color: top80Pct < 0.3 ? "#ef4444" : "#f59e0b",
            hint:  top80Pct < 0.3 ? "利潤高度集中，少數關鍵交易" : "利潤分佈尚均勻",
          },
        ].map(s => (
          <div key={s.label} className="rounded-lg p-3"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <div className="text-[10px] mb-1" style={{ color: "var(--text-secondary)" }}>{s.label}</div>
            <div className="text-sm font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[9px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{s.hint}</div>
          </div>
        ))}
      </div>

      {/* ── 累積 PnL 折線 ───────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          累積盈虧曲線（按交易序號）
        </div>
        <div className="rounded-lg p-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          <svg viewBox={`0 0 ${CW} ${CH + 14}`} style={{ width: "100%", height: CH + 14 }}>
            <defs>
              <linearGradient id="pnlGradUp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="pnlGradDown" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.02} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.3} />
              </linearGradient>
            </defs>

            {/* 零線 */}
            {zeroY >= CP && zeroY <= CH - CP && (
              <line x1={CP} y1={zeroY} x2={CW - CP} y2={zeroY}
                stroke="var(--border)" strokeWidth={0.8} />
            )}

            {/* 填充面積 */}
            {totalPnl >= 0 ? (
              <polygon
                points={[`${CP},${zeroY}`, ...cumPnl.map((v, i) => `${cx(i)},${cy(v)}`), `${cx(cumPnl.length - 1)},${zeroY}`].join(" ")}
                fill="url(#pnlGradUp)"
              />
            ) : (
              <polygon
                points={[`${CP},${zeroY}`, ...cumPnl.map((v, i) => `${cx(i)},${cy(v)}`), `${cx(cumPnl.length - 1)},${zeroY}`].join(" ")}
                fill="url(#pnlGradDown)"
              />
            )}

            {/* 折線（逐筆著色） */}
            {cumPnl.map((v, i) => {
              if (i === 0) return null;
              const x1 = cx(i - 1), y1 = cy(cumPnl[i - 1]);
              const x2 = cx(i), y2 = cy(v);
              return (
                <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={v >= (cumPnl[i - 1] ?? 0) ? "#22c55e" : "#ef4444"}
                  strokeWidth={1.2} />
              );
            })}

            <text x={CP} y={CH + 12} fontSize={7} fill="var(--text-tertiary)">交易 1</text>
            <text x={CW - CP} y={CH + 12} fontSize={7} textAnchor="end" fill="var(--text-tertiary)">
              第 {cumPnl.length} 筆
            </text>
            <text x={CP} y={CP + 6} fontSize={7} fill="var(--text-tertiary)">
              +{(maxV / 1000).toFixed(0)}K
            </text>
            {minV < 0 && (
              <text x={CP} y={CH - CP - 2} fontSize={7} fill="var(--text-tertiary)">
                {(minV / 1000).toFixed(0)}K
              </text>
            )}
          </svg>
        </div>
      </div>

      {/* ── Pareto 圖 + Top 贏輸家 ──────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Pareto 曲線 */}
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
            Pareto：累積利潤集中度
          </div>
          <div className="rounded-lg p-2" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <svg viewBox={`0 0 ${PW} ${PH + 16}`} style={{ width: "100%", height: PH + 16 }}>
              {/* 45° 均等線 */}
              <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)}
                stroke="var(--border)" strokeWidth={0.8} strokeDasharray="3,2" />
              {/* Pareto 曲線 */}
              <polyline
                points={pareto.map(p => `${px(p.pct)},${py(p.cumPnlPct)}`).join(" ")}
                fill="none" stroke="#6366f1" strokeWidth={1.5} strokeLinejoin="round"
              />
              {/* 80% 標線 */}
              <line x1={px(0)} y1={py(0.8)} x2={px(1)} y2={py(0.8)}
                stroke="#f59e0b" strokeWidth={0.6} strokeDasharray="2,2" opacity={0.8} />
              <line x1={px(top80Pct)} y1={py(0)} x2={px(top80Pct)} y2={py(1)}
                stroke="#f59e0b" strokeWidth={0.6} strokeDasharray="2,2" opacity={0.8} />
              <text x={PW - CP - 2} y={py(0.8) - 2} fontSize={6} textAnchor="end" fill="#f59e0b">80%利潤</text>
              {/* 軸標籤 */}
              <text x={px(0)} y={PH + 12} fontSize={6} fill="var(--text-tertiary)">0%</text>
              <text x={px(0.5)} y={PH + 12} fontSize={6} textAnchor="middle" fill="var(--text-tertiary)">50%筆數</text>
              <text x={px(1)} y={PH + 12} fontSize={6} textAnchor="end" fill="var(--text-tertiary)">100%</text>
            </svg>
          </div>
        </div>

        {/* Top 贏家/輸家 */}
        <div>
          <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
            最大贏家 vs 輸家（前 8 名）
          </div>
          <div className="rounded-lg p-2 flex flex-col gap-0.5"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            {[
              ...topWin.map((t, i) => ({ trade: t, side: "win" as const, rank: i + 1 })),
              ...topLoss.slice(0, Math.min(4, topLoss.length)).map((t, i) => ({ trade: t, side: "loss" as const, rank: i + 1 })),
            ].map(({ trade, side, rank }) => {
              const barPct = Math.abs(trade.pnl) / maxBar;
              return (
                <div key={`${side}-${rank}`} className="flex items-center gap-1.5">
                  <div className="text-[8px] w-6 text-right shrink-0"
                    style={{ color: side === "win" ? "#22c55e" : "#ef4444" }}>
                    {side === "win" ? "+" : ""}{(trade.pnl / 1000).toFixed(1)}K
                  </div>
                  <div className="flex-1 rounded-full h-2 overflow-hidden"
                    style={{ background: "var(--border)" }}>
                    <div className="h-full rounded-full"
                      style={{
                        width: `${barPct * 100}%`,
                        background: side === "win" ? "#22c55e" : "#ef4444",
                        opacity: 0.8,
                      }} />
                  </div>
                  <div className="text-[8px] shrink-0" style={{ color: "var(--text-tertiary)" }}>
                    {trade.entry_date.slice(5)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── 最大單筆 ────────────────────────────────────── */}
      {(biggestWin || biggestLoss) && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { trade: biggestWin,  label: "最大單筆獲利", color: "#22c55e", bg: "#d1fae5", sign: "+" },
            { trade: biggestLoss, label: "最大單筆虧損", color: "#ef4444", bg: "#fee2e2", sign: "" },
          ].filter(x => x.trade).map(({ trade: t, label, color, bg, sign }) => (
            <div key={label} className="rounded-lg p-3"
              style={{ background: bg, border: `1px solid ${color}44` }}>
              <div className="text-[10px] mb-1" style={{ color: "#374151" }}>{label}</div>
              <div className="text-sm font-bold" style={{ color }}>
                {sign}{(t.pnl / 1000).toFixed(2)}K（{sign}{(t.pnl_pct * 100).toFixed(1)}%）
              </div>
              <div className="text-[9px] mt-0.5" style={{ color: "#374151" }}>
                {t.entry_date} → {t.exit_date}（{t.hold_days}天）
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
