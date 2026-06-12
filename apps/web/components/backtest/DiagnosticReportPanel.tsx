"use client";

/**
 * P17-51: 回測綜合健診報告
 * 單頁可列印的策略診斷摘要，整合評分卡、關鍵指標、風險旗標、改善建議。
 */

import type { BacktestResult, BacktestRequest } from "@/lib/api";
import { useMemo } from "react";

interface Props {
  result:  BacktestResult;
  request: BacktestRequest;
}

/* ── 評分邏輯（與 ScorecardPanel 一致） ──────────────────────── */
function scoreCAGR(v: number) {
  if (v >= 0.30) return 25; if (v >= 0.20) return 20;
  if (v >= 0.15) return 15; if (v >= 0.10) return 10; if (v >= 0.05) return 5; return 0;
}
function scoreSharpe(v: number) {
  if (v >= 2.0) return 25; if (v >= 1.5) return 20;
  if (v >= 1.0) return 15; if (v >= 0.5) return 10; if (v >= 0.0) return 5; return 0;
}
function scoreMDD(v: number) {
  const d = Math.abs(v);
  if (d <= 0.05) return 25; if (d <= 0.10) return 20;
  if (d <= 0.20) return 15; if (d <= 0.30) return 10; if (d <= 0.40) return 5; return 0;
}
function scoreWR(v: number) {
  if (v >= 0.70) return 15; if (v >= 0.60) return 12;
  if (v >= 0.55) return  9; if (v >= 0.50) return  6; if (v >= 0.40) return 3; return 0;
}
function scorePF(v: number) {
  if (v >= 3.0) return 10; if (v >= 2.0) return 8;
  if (v >= 1.5) return  6; if (v >= 1.2) return 4; if (v >= 1.0) return 2; return 0;
}
function grade(s: number) {
  if (s >= 80) return { label: "A", color: "#22c55e" };
  if (s >= 65) return { label: "B", color: "#86efac" };
  if (s >= 50) return { label: "C", color: "#f59e0b" };
  if (s >= 35) return { label: "D", color: "#f97316" };
  return { label: "F", color: "#ef4444" };
}

function pct(v: number, d = 2) {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;
}

function fmtNum(v: number, d = 0) {
  return v.toLocaleString("zh-TW", { maximumFractionDigits: d });
}

/* ── 風險旗標生成 ─────────────────────────────────────────────── */
function buildFlags(r: BacktestResult, req: BacktestRequest): { level: "red" | "yellow" | "green"; text: string }[] {
  const flags: { level: "red" | "yellow" | "green"; text: string }[] = [];
  const s = r.stats;

  if (Math.abs(s.max_drawdown) > 0.30)
    flags.push({ level: "red", text: `最大回撤 ${pct(s.max_drawdown)} 超過 -30%，風險偏高` });
  if (s.sharpe < 0.5)
    flags.push({ level: "red", text: `Sharpe Ratio ${s.sharpe.toFixed(2)} 不足 0.5，風險調整報酬差` });
  if (s.profit_factor < 1.2)
    flags.push({ level: "red", text: `Profit Factor ${s.profit_factor.toFixed(2)} 低於 1.2，策略競爭力弱` });
  if (s.total_trades < 20)
    flags.push({ level: "yellow", text: `交易筆數僅 ${s.total_trades} 筆，統計樣本可能不足` });
  if (s.win_rate < 0.40)
    flags.push({ level: "yellow", text: `勝率 ${(s.win_rate * 100).toFixed(1)}% 偏低，需確認盈虧比是否補償` });
  if (s.avg_hold_days < 2)
    flags.push({ level: "yellow", text: `平均持倉 ${s.avg_hold_days.toFixed(1)} 天過短，手續費拖累顯著` });
  if (s.cagr > s.benchmark_cagr + 0.10)
    flags.push({ level: "green", text: `年化超額 ${pct(s.cagr - s.benchmark_cagr)} ，顯著優於基準` });
  if (s.sharpe >= 1.5)
    flags.push({ level: "green", text: `Sharpe ${s.sharpe.toFixed(2)} ≥ 1.5，風險調整報酬優異` });
  if (s.max_drawdown > -0.10 && s.cagr > 0.10)
    flags.push({ level: "green", text: `回撤控制 ${pct(s.max_drawdown)} 且年化 ${pct(s.cagr)}，攻守兼備` });

  return flags.slice(0, 6);
}

/* ── 改善建議 ─────────────────────────────────────────────────── */
function buildSuggestions(r: BacktestResult, req: BacktestRequest): string[] {
  const s = r.stats;
  const suggestions: string[] = [];

  if (!req.stop_loss_pct && Math.abs(s.max_drawdown) > 0.15)
    suggestions.push("未設停損，建議加入固定停損（5-10%）控制回撤");
  if (!req.trailing_stop_pct && s.profit_factor > 1.5)
    suggestions.push("策略有獲利潛力，加入移動停損（10-15%）可保護浮盈");
  if (s.avg_hold_days < 3)
    suggestions.push("持倉極短，考慮延長至 3-10 天以降低手續費佔比");
  if (s.total_trades > 100 && s.win_rate < 0.45)
    suggestions.push("高頻低勝率：建議提高進場訊號門檻或加入確認條件");
  if (Math.abs(s.max_drawdown) > 0.20 && !req.position_size_pct)
    suggestions.push("建議將倉位比例降至 50-75%，在市場不利時保留更多緩衝");
  if (s.cagr < s.benchmark_cagr)
    suggestions.push("年化落後基準，考慮調整策略週期或換用更合適的指標組合");
  if (suggestions.length === 0)
    suggestions.push("策略整體健康，可進行 Walk-Forward 驗證防止過擬合");

  return suggestions.slice(0, 4);
}

export default function DiagnosticReportPanel({ result, request }: Props) {
  const { score, gradeInfo, flags, suggestions } = useMemo(() => {
    const s = result.stats;
    const sc = scoreCAGR(s.cagr) + scoreSharpe(s.sharpe) + scoreMDD(s.max_drawdown)
             + scoreWR(s.win_rate) + scorePF(s.profit_factor);
    return {
      score:      sc,
      gradeInfo:  grade(sc),
      flags:      buildFlags(result, request),
      suggestions: buildSuggestions(result, request),
    };
  }, [result, request]);

  const s = result.stats;
  const printDate = new Date().toLocaleDateString("zh-TW");

  return (
    <div className="flex flex-col gap-5 p-4" id="diagnostic-report">
      {/* ── 頁首 ──────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 pb-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <div>
          <div className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
            策略健診報告
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {request.symbol} · {request.strategy.type} · {request.start_date} → {request.end_date}
          </div>
          <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
            產生日期：{printDate}
          </div>
        </div>

        {/* 評分圓圈 */}
        <div className="flex flex-col items-center gap-0.5 shrink-0">
          <div
            className="w-16 h-16 rounded-full flex flex-col items-center justify-center border-4"
            style={{ borderColor: gradeInfo.color, background: `${gradeInfo.color}15` }}
          >
            <span className="text-2xl font-black" style={{ color: gradeInfo.color, lineHeight: 1 }}>
              {gradeInfo.label}
            </span>
            <span className="text-[10px] font-bold" style={{ color: gradeInfo.color }}>{score}/100</span>
          </div>
          <span className="text-[9px]" style={{ color: "var(--text-tertiary)" }}>綜合評分</span>
        </div>
      </div>

      {/* ── 關鍵指標 3×2 ─────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "年化報酬（CAGR）", value: pct(s.cagr),          color: s.cagr >= 0 ? "#22c55e" : "#ef4444" },
          { label: "Sharpe Ratio",      value: s.sharpe.toFixed(2),    color: s.sharpe >= 1 ? "#22c55e" : "#f59e0b" },
          { label: "最大回撤",          value: pct(s.max_drawdown),    color: "#ef4444" },
          { label: "勝率",              value: `${(s.win_rate * 100).toFixed(1)}%`,
            color: s.win_rate >= 0.5 ? "#22c55e" : "#f59e0b" },
          { label: "Profit Factor",     value: s.profit_factor.toFixed(2),
            color: s.profit_factor >= 1.5 ? "#22c55e" : "#f59e0b" },
          { label: "超額報酬",
            value: pct(s.cagr - s.benchmark_cagr),
            color: s.cagr >= s.benchmark_cagr ? "#22c55e" : "#ef4444" },
        ].map(m => (
          <div key={m.label} className="rounded-lg p-2.5"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <div className="text-[9px] mb-0.5" style={{ color: "var(--text-secondary)" }}>{m.label}</div>
            <div className="text-sm font-bold" style={{ color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* ── 次要指標 ──────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "交易筆數",   value: fmtNum(s.total_trades) },
          { label: "平均持倉",   value: `${s.avg_hold_days.toFixed(1)} 天` },
          { label: "最終資金",   value: `${fmtNum(s.final_equity)} 元` },
          { label: "Calmar",     value: s.calmar.toFixed(2) },
        ].map(m => (
          <div key={m.label} className="rounded-lg p-2 text-center"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <div className="text-[9px] mb-0.5" style={{ color: "var(--text-secondary)" }}>{m.label}</div>
            <div className="text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* ── 風險旗標 ──────────────────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          診斷結果
        </div>
        <div className="flex flex-col gap-1.5">
          {flags.map((f, i) => {
            const icon  = f.level === "red" ? "🔴" : f.level === "yellow" ? "🟡" : "🟢";
            const color = f.level === "red" ? "#fee2e2" : f.level === "yellow" ? "#fef9c3" : "#d1fae5";
            const border = f.level === "red" ? "#fca5a5" : f.level === "yellow" ? "#fde68a" : "#86efac";
            return (
              <div key={i} className="rounded-lg px-3 py-2 flex items-start gap-2"
                style={{ background: color, border: `1px solid ${border}` }}>
                <span className="text-xs shrink-0">{icon}</span>
                <span className="text-[11px]" style={{ color: "#1f2937" }}>{f.text}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 改善建議 ──────────────────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          改善建議
        </div>
        <div className="rounded-lg p-3 flex flex-col gap-2"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          {suggestions.map((sg, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-[10px] font-bold shrink-0 mt-0.5" style={{ color: "#6366f1" }}>
                {i + 1}.
              </span>
              <span className="text-[11px]" style={{ color: "var(--text-primary)" }}>{sg}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── 設定快照 ──────────────────────────────────────────── */}
      <div>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          回測設定
        </div>
        <div className="rounded-lg p-3 grid grid-cols-2 gap-1"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
          {[
            ["策略類型",   request.strategy.type],
            ["初始資金",   `${fmtNum(request.initial_capital ?? 1_000_000)} 元`],
            ["停損",       request.stop_loss_pct ? `${((request.stop_loss_pct) * 100).toFixed(1)}%` : "無"],
            ["停利",       request.take_profit_pct ? `${((request.take_profit_pct) * 100).toFixed(1)}%` : "無"],
            ["移動停損",   request.trailing_stop_pct ? `${((request.trailing_stop_pct) * 100).toFixed(1)}%` : "無"],
            ["時間停損",   request.max_hold_days ? `${request.max_hold_days} 天` : "無"],
            ["倉位比例",   `${((request.position_size_pct ?? 1) * 100).toFixed(0)}%`],
            ["做空",       request.allow_short ? "啟用" : "停用"],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-[9px] w-20 shrink-0" style={{ color: "var(--text-tertiary)" }}>{k}：</span>
              <span className="text-[9px]" style={{ color: "var(--text-primary)" }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 列印按鈕 */}
      <button
        onClick={() => window.print()}
        className="w-full py-2 rounded-lg text-sm font-semibold transition-opacity print:hidden"
        style={{ background: "var(--color-brand)", color: "#fff" }}
      >
        📄 列印 / 匯出 PDF
      </button>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #diagnostic-report, #diagnostic-report * { visibility: visible; }
          #diagnostic-report { position: absolute; top: 0; left: 0; width: 100%; }
        }
      `}</style>
    </div>
  );
}
