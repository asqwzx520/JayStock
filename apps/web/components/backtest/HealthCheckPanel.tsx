"use client";

/**
 * P11-35: 一鍵策略體檢 + Gemini AI 白話解讀
 *
 * 前端依序執行 5 項檢查（樣本數 / 績效品質 / 最大回撤 / 退化偵測 / Monte Carlo），
 * 彙整成 pass/warn/fail 報告後呼叫後端 AI 總結（Gemini，失敗時規則式 fallback）。
 */

import { useState } from "react";

import {
  getBacktestAiSummary,
  type BacktestRequest,
  type BacktestResult,
  type HealthCheckItem,
} from "@/lib/api";

// ── Mulberry32 PRNG（與 MonteCarloPanel 同款，種子固定可重現） ──
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simpleSharpe(values: number[]): number {
  if (values.length < 3) return 0;
  const rets: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0) rets.push(values[i] / values[i - 1] - 1);
  }
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd   = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
  return sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;
}

function runChecks(result: BacktestResult): HealthCheckItem[] {
  const checks: HealthCheckItem[] = [];
  const s      = result.stats;
  const trades = result.trades;

  // 1) 樣本數
  const n = trades.length;
  checks.push({
    name:   "樣本數",
    status: n >= 30 ? "pass" : n >= 10 ? "warn" : "fail",
    detail: `${n} 筆交易${n < 30 ? "（建議 ≥ 30 筆才有統計意義）" : ""}`,
  });

  // 2) 績效品質（Sharpe）
  checks.push({
    name:   "風險調整報酬",
    status: s.sharpe >= 1 ? "pass" : s.sharpe >= 0.5 ? "warn" : "fail",
    detail: `Sharpe ${s.sharpe.toFixed(2)}`,
  });

  // 3) 最大回撤
  const mdd = Math.abs(s.max_drawdown);
  checks.push({
    name:   "最大回撤",
    status: mdd <= 0.2 ? "pass" : mdd <= 0.35 ? "warn" : "fail",
    detail: `${(mdd * 100).toFixed(1)}%`,
  });

  // 4) 退化偵測（前後半 Sharpe 比較）
  const ec = result.equity_curve;
  if (ec.length >= 20) {
    const mid = Math.floor(ec.length / 2);
    const h1  = simpleSharpe(ec.slice(0, mid).map(p => p.value));
    const h2  = simpleSharpe(ec.slice(mid).map(p => p.value));
    const decayed = h1 > 0 && h2 < h1 * 0.6;
    checks.push({
      name:   "策略退化",
      status: decayed ? (h2 < 0 ? "fail" : "warn") : "pass",
      detail: `前半 Sharpe ${h1.toFixed(2)} → 後半 ${h2.toFixed(2)}${decayed ? "（近期明顯轉弱）" : ""}`,
    });
  } else {
    checks.push({ name: "策略退化", status: "skip", detail: "資料不足（< 20 個資料點）" });
  }

  // 5) Monte Carlo（500 次重排，看第 5 百分位總報酬）
  if (n >= 10) {
    const pnls = trades.map(t => t.pnl_pct);
    const rand = mulberry32(42);
    const totals: number[] = [];
    for (let run = 0; run < 500; run++) {
      let eq = 1;
      // 隨機抽樣（有放回）重組交易序列
      for (let i = 0; i < pnls.length; i++) {
        eq *= 1 + pnls[Math.floor(rand() * pnls.length)];
      }
      totals.push(eq - 1);
    }
    totals.sort((a, b) => a - b);
    const p5 = totals[Math.floor(totals.length * 0.05)];
    checks.push({
      name:   "Monte Carlo 壓力",
      status: p5 > 0 ? "pass" : p5 > -0.1 ? "warn" : "fail",
      detail: `500 次模擬 P5 總報酬 ${(p5 * 100).toFixed(1)}%${p5 <= 0 ? "（最差 5% 情境會虧損）" : ""}`,
    });
  } else {
    checks.push({ name: "Monte Carlo 壓力", status: "skip", detail: "交易數不足（< 10 筆）" });
  }

  return checks;
}

const STATUS_META: Record<HealthCheckItem["status"], { icon: string; color: string; label: string }> = {
  pass: { icon: "✅", color: "#10b981", label: "通過" },
  warn: { icon: "⚠️", color: "#f59e0b", label: "注意" },
  fail: { icon: "❌", color: "#ef4444", label: "未過" },
  skip: { icon: "➖", color: "#94a3b8", label: "略過" },
};

interface Props {
  result:  BacktestResult;
  symbol:  string;
  lastReq: BacktestRequest | null;
}

export default function HealthCheckPanel({ result, symbol, lastReq }: Props) {
  const [checks,    setChecks]    = useState<HealthCheckItem[] | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiSource,  setAiSource]  = useState<"gemini" | "rule" | null>(null);
  const [loading,   setLoading]   = useState(false);

  async function handleRun() {
    setLoading(true);
    setAiSummary(null);
    const c = runChecks(result);
    setChecks(c);
    try {
      const r = await getBacktestAiSummary({
        symbol,
        strategy_type: lastReq?.strategy.type ?? "",
        stats:  result.stats,
        checks: c,
      });
      setAiSummary(r.summary);
      setAiSource(r.source);
    } catch {
      setAiSummary(null);
      setAiSource(null);
    } finally {
      setLoading(false);
    }
  }

  const passCount = checks?.filter(c => c.status === "pass").length ?? 0;
  const evaluated = checks?.filter(c => c.status !== "skip").length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>🩺 策略體檢</div>
          <div className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            樣本數 / 風險報酬 / 回撤 / 退化 / Monte Carlo 五項檢查 + AI 白話總結
          </div>
        </div>
        <button
          onClick={handleRun}
          disabled={loading}
          className="text-xs px-4 py-1.5 rounded-lg font-semibold transition-opacity"
          style={{ background: "var(--color-brand)", color: "#fff", opacity: loading ? 0.6 : 1 }}
        >
          {loading ? "體檢中..." : checks ? "重新體檢" : "開始體檢"}
        </button>
      </div>

      {/* AI 總結 */}
      {checks && (
        <div className="rounded-xl p-4" style={{ border: "1px solid rgba(59,130,246,0.35)", background: "rgba(59,130,246,0.06)" }}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-semibold" style={{ color: "var(--color-brand)" }}>
              🤖 AI 解讀
            </span>
            {aiSource && (
              <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
                {aiSource === "gemini" ? "Gemini" : "規則式"}
              </span>
            )}
          </div>
          <div className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {loading ? "AI 分析中..." : aiSummary ?? "AI 總結暫時無法取得，請參考下方各項檢查結果。"}
          </div>
        </div>
      )}

      {/* 檢查結果 */}
      {checks && (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div className="px-4 py-2 text-xs font-semibold flex items-center justify-between" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
            <span>檢查項目</span>
            <span style={{ color: passCount === evaluated ? "#10b981" : "var(--text-tertiary)" }}>
              {passCount}/{evaluated} 通過
            </span>
          </div>
          {checks.map(c => {
            const meta = STATUS_META[c.status];
            return (
              <div key={c.name} className="px-4 py-2.5 flex items-center gap-3" style={{ borderTop: "1px solid var(--border)" }}>
                <span className="text-sm shrink-0">{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{c.name}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{c.detail}</div>
                </div>
                <span className="text-[10px] font-semibold shrink-0" style={{ color: meta.color }}>{meta.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {!checks && (
        <div className="text-xs py-8 text-center" style={{ color: "var(--text-tertiary)" }}>
          點「開始體檢」對目前的回測結果做完整健康檢查
        </div>
      )}
    </div>
  );
}
