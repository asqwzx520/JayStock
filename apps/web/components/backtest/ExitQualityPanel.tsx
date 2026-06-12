"use client";

/**
 * P15-44: 出場品質分析（MAE/MFE 散佈圖）
 * MAE = Max Adverse Excursion（最大不利偏移）：持倉期間最多虧多少
 * MFE = Max Favorable Excursion（最大有利偏移）：持倉期間最多賺多少
 *
 * 散佈圖解讀：
 *   - 點落在對角線附近 → 出場及時（接近最大利潤時出場）
 *   - 點在對角線右下方 → 放棄了大量利潤（太晚出場）
 *   - 點 MFE 大但 pnl 小 → 策略「利潤回吐」嚴重，需加移動停損
 */

import type { BacktestTrade } from "@/lib/api";
import { useMemo } from "react";

interface Props {
  trades: BacktestTrade[];
}

function dot(x: number, y: number, w: number, h: number, color: string, label: string) {
  return (
    <circle cx={x} cy={y} r={4} fill={color} opacity={0.7}>
      <title>{label}</title>
    </circle>
  );
}

export default function ExitQualityPanel({ trades }: Props) {
  const { valid, summary } = useMemo(() => {
    const v = trades.filter(
      t => typeof t.mae_pct === "number" && typeof t.mfe_pct === "number"
    );
    if (v.length === 0) return { valid: [], summary: null };

    const wins  = v.filter(t => t.pnl > 0);
    const loses = v.filter(t => t.pnl <= 0);

    // 利潤捕捉率：pnl_pct / mfe_pct（MFE > 0 才算）
    const captures = v
      .filter(t => (t.mfe_pct ?? 0) > 0.001)
      .map(t => (t.pnl_pct ?? 0) / (t.mfe_pct ?? 1));
    const avgCapture =
      captures.length > 0
        ? captures.reduce((s, c) => s + c, 0) / captures.length
        : null;

    // 平均 MAE（多頭為負）
    const avgMae = v.reduce((s, t) => s + (t.mae_pct ?? 0), 0) / v.length;
    const avgMfe = v.reduce((s, t) => s + (t.mfe_pct ?? 0), 0) / v.length;

    // 過度持有（MFE >> pnl）：利潤回吐 > 50% 的筆數
    const givebacks = v.filter(
      t => (t.mfe_pct ?? 0) > 0.02 && (t.pnl_pct ?? 0) < (t.mfe_pct ?? 0) * 0.5
    ).length;

    return {
      valid: v,
      summary: { avgCapture, avgMae, avgMfe, givebacks, total: v.length, wins: wins.length, loses: loses.length },
    };
  }, [trades]);

  if (!summary || valid.length === 0) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        無 MAE/MFE 資料（請使用最新版本重新執行回測）
      </div>
    );
  }

  // 座標映射：X = MAE（-30% ~ 0%），Y = MFE（0% ~ +50%）
  const SVG_W = 460, SVG_H = 300;
  const PAD_L = 50, PAD_R = 20, PAD_T = 20, PAD_B = 40;
  const plotW = SVG_W - PAD_L - PAD_R;
  const plotH = SVG_H - PAD_T - PAD_B;

  const maeMin = Math.min(-0.02, ...valid.map(t => t.mae_pct ?? 0)) * 1.1;
  const mfeMax = Math.max(0.02,  ...valid.map(t => t.mfe_pct ?? 0)) * 1.1;

  const toX = (mae: number) => PAD_L + ((mae - maeMin) / (0 - maeMin)) * plotW;
  const toY = (mfe: number) => PAD_T + plotH - (mfe / mfeMax) * plotH;

  // 理想出場線：y = -x（MAE 斜率 1 線）
  const lineX1 = toX(maeMin);
  const lineY1 = toY(-maeMin);
  const lineX2 = toX(0);
  const lineY2 = toY(0);

  const xTicks = [-0.25, -0.20, -0.15, -0.10, -0.05, 0].filter(v => v >= maeMin);
  const yTicks = [0, 0.05, 0.10, 0.15, 0.20, 0.30, 0.40].filter(v => v <= mfeMax);

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* ── 統計摘要 ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: "平均利潤捕捉率",
            value: summary.avgCapture != null
              ? `${(summary.avgCapture * 100).toFixed(1)}%`
              : "N/A",
            color: summary.avgCapture != null && summary.avgCapture >= 0.6 ? "#22c55e" : "#f59e0b",
            hint: "pnl / MFE，越高越好（目標 >60%）",
          },
          {
            label: "平均 MFE（最大利潤）",
            value: `+${(summary.avgMfe * 100).toFixed(2)}%`,
            color: "#22c55e",
            hint: "持倉期間平均最大有利偏移",
          },
          {
            label: "平均 MAE（最大損失）",
            value: `${(summary.avgMae * 100).toFixed(2)}%`,
            color: "#ef4444",
            hint: "持倉期間平均最大不利偏移",
          },
          {
            label: "利潤回吐筆數",
            value: `${summary.givebacks} 筆（${((summary.givebacks / summary.total) * 100).toFixed(0)}%）`,
            color: summary.givebacks / summary.total > 0.3 ? "#ef4444" : "#f59e0b",
            hint: "MFE > 2% 且最終報酬 < MFE×50%",
          },
        ].map(s => (
          <div
            key={s.label}
            className="rounded-lg p-3"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
          >
            <div className="text-[10px] mb-1" style={{ color: "var(--text-secondary)" }}>{s.label}</div>
            <div className="text-sm font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[9px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{s.hint}</div>
          </div>
        ))}
      </div>

      {/* ── MAE / MFE 散佈圖 ────────────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          MAE vs MFE 散佈圖（共 {summary.total} 筆交易）
        </div>
        <div
          className="rounded-lg p-2 overflow-x-auto"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        >
          <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{ width: "100%", maxWidth: SVG_W, height: SVG_H }}>
            {/* 網格線 */}
            {xTicks.map(v => (
              <line key={v} x1={toX(v)} y1={PAD_T} x2={toX(v)} y2={PAD_T + plotH}
                stroke="var(--border)" strokeWidth={0.5} />
            ))}
            {yTicks.map(v => (
              <line key={v} x1={PAD_L} y1={toY(v)} x2={PAD_L + plotW} y2={toY(v)}
                stroke="var(--border)" strokeWidth={0.5} />
            ))}

            {/* 理想線（MAE = -MFE，即損失 = 利潤，breakeven zone） */}
            <line x1={lineX1} y1={Math.min(lineY1, PAD_T + plotH)} x2={lineX2} y2={lineY2}
              stroke="#6366f1" strokeWidth={1} strokeDasharray="4,3" opacity={0.6} />

            {/* 散佈點 */}
            {valid.map((t, i) => {
              const x = toX(t.mae_pct ?? 0);
              const y = toY(t.mfe_pct ?? 0);
              const win = t.pnl > 0;
              const label = `${t.entry_date}→${t.exit_date}\nMAE:${((t.mae_pct ?? 0) * 100).toFixed(2)}% MFE:${((t.mfe_pct ?? 0) * 100).toFixed(2)}%\n報酬:${((t.pnl_pct ?? 0) * 100).toFixed(2)}%`;
              return dot(x, y, SVG_W, SVG_H, win ? "#22c55e" : "#ef4444", label);
            }).filter(Boolean)}

            {/* 軸標籤 */}
            {xTicks.map(v => (
              <text key={v} x={toX(v)} y={PAD_T + plotH + 14} fontSize={8}
                textAnchor="middle" fill="var(--text-tertiary)">
                {v === 0 ? "0" : `${(v * 100).toFixed(0)}%`}
              </text>
            ))}
            {yTicks.filter(v => v > 0).map(v => (
              <text key={v} x={PAD_L - 6} y={toY(v) + 3} fontSize={8}
                textAnchor="end" fill="var(--text-tertiary)">
                {`+${(v * 100).toFixed(0)}%`}
              </text>
            ))}

            {/* 軸標題 */}
            <text x={PAD_L + plotW / 2} y={SVG_H - 2} fontSize={9}
              textAnchor="middle" fill="var(--text-secondary)">
              MAE（最大不利偏移）→
            </text>
            <text x={12} y={PAD_T + plotH / 2} fontSize={9}
              textAnchor="middle" fill="var(--text-secondary)"
              transform={`rotate(-90, 12, ${PAD_T + plotH / 2})`}>
              MFE（最大有利偏移）↑
            </text>

            {/* 圖例 */}
            <circle cx={PAD_L + plotW - 60} cy={PAD_T + 12} r={4} fill="#22c55e" opacity={0.7} />
            <text x={PAD_L + plotW - 52} y={PAD_T + 15} fontSize={8} fill="var(--text-tertiary)">獲利</text>
            <circle cx={PAD_L + plotW - 28} cy={PAD_T + 12} r={4} fill="#ef4444" opacity={0.7} />
            <text x={PAD_L + plotW - 20} y={PAD_T + 15} fontSize={8} fill="var(--text-tertiary)">虧損</text>
          </svg>
        </div>
        <div className="text-[9px] mt-1.5" style={{ color: "var(--text-tertiary)" }}>
          紫色虛線 = 理想出場線（loss = profit）。點越靠近右上角代表獲利潛力大；MFE 遠高於最終報酬表示「利潤回吐」，考慮加移動停損。
        </div>
      </div>
    </div>
  );
}
