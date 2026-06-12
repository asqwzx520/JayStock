"use client";

/**
 * P15-43: 危機期間分析
 * 在資金曲線上標記重大市場事件，顯示各危機期間的策略表現。
 * 純前端，從 equity_curve 切片計算各期間績效。
 */

import type { BacktestEquityPoint } from "@/lib/api";
import { useMemo } from "react";

interface Props {
  equityCurve: BacktestEquityPoint[];
  benchmarkCurve?: { time: string; value: number }[];
}

interface CrisisEvent {
  id:    string;
  label: string;
  from:  string;
  to:    string;
  desc:  string;
  color: string;
}

const CRISIS_EVENTS: CrisisEvent[] = [
  { id: "covid",   label: "COVID 崩盤",        from: "2020-02-20", to: "2020-03-23", color: "#ef4444", desc: "美股 33 天跌 34%，台股跌 27%" },
  { id: "recover", label: "COVID 反彈",         from: "2020-03-23", to: "2020-08-18", color: "#22c55e", desc: "聯準會 QE 無限寬鬆，V 型反彈" },
  { id: "fed2022", label: "2022 升息熊市",      from: "2022-01-03", to: "2022-10-14", color: "#ef4444", desc: "Fed 急升息，那斯達克跌 33%，台股跌 40%" },
  { id: "svb2023", label: "SVB 銀行危機",       from: "2023-03-08", to: "2023-03-24", color: "#f59e0b", desc: "矽谷銀行倒閉引發金融板塊震盪" },
  { id: "ai2023",  label: "AI 牛市（2023）",    from: "2023-01-01", to: "2023-12-31", color: "#22c55e", desc: "ChatGPT 帶動 AI 概念股全年大漲" },
  { id: "tw2022",  label: "台股崩跌（2022）",   from: "2022-01-17", to: "2022-10-25", color: "#ef4444", desc: "台灣加權指數從 18619 跌至 12629，跌幅 32%" },
  { id: "us2024",  label: "美股緩步多頭（2024）", from: "2024-01-01", to: "2024-12-31", color: "#22c55e", desc: "AI/科技股持續領漲，台積電創新高" },
];

function getPerf(curve: BacktestEquityPoint[], from: string, to: string) {
  const slice = curve.filter(p => p.time >= from && p.time <= to);
  if (slice.length < 2) return null;
  const start = slice[0].value;
  const end   = slice[slice.length - 1].value;
  const ret   = (end - start) / start;

  // max drawdown within period
  let peak = start, mdd = 0;
  for (const p of slice) {
    if (p.value > peak) peak = p.value;
    const dd = (p.value - peak) / peak;
    if (dd < mdd) mdd = dd;
  }
  return { ret, mdd, start, end, days: slice.length };
}

export default function CrisisPanel({ equityCurve, benchmarkCurve }: Props) {
  const results = useMemo(() => {
    if (!equityCurve || equityCurve.length < 2) return [];
    const first = equityCurve[0].time;
    const last  = equityCurve[equityCurve.length - 1].time;

    return CRISIS_EVENTS.map(ev => {
      // 只顯示與回測期間有重疊的事件
      if (ev.to < first || ev.from > last) return null;
      const strat = getPerf(equityCurve, ev.from, ev.to);
      const bench = benchmarkCurve ? getPerf(
        benchmarkCurve.map(p => ({ time: p.time, value: p.value, drawdown: 0 })),
        ev.from, ev.to
      ) : null;
      if (!strat) return null;
      return { ev, strat, bench };
    }).filter(Boolean) as { ev: CrisisEvent; strat: NonNullable<ReturnType<typeof getPerf>>; bench: ReturnType<typeof getPerf> }[];
  }, [equityCurve, benchmarkCurve]);

  if (results.length === 0) {
    return (
      <div className="p-6 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
        回測期間未涵蓋任何已定義的危機事件
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
        顯示回測期間涵蓋的重大市場事件，分析策略在各特殊時期的表現。
      </div>

      <div className="flex flex-col gap-3">
        {results.map(({ ev, strat, bench }) => {
          const stratColor = strat.ret >= 0 ? "#22c55e" : "#ef4444";
          const alpha      = bench ? strat.ret - bench.ret : null;
          return (
            <div
              key={ev.id}
              className="rounded-lg p-4"
              style={{ background: "var(--bg-elevated)", border: `1px solid var(--border)`, borderLeft: `4px solid ${ev.color}` }}
            >
              {/* 標題列 */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {ev.label}
                  </span>
                  <span className="text-[10px] ml-2" style={{ color: "var(--text-tertiary)" }}>
                    {ev.from} → {ev.to}（{strat.days} 個交易日）
                  </span>
                </div>
              </div>
              <div className="text-[10px] mb-3" style={{ color: "var(--text-tertiary)" }}>{ev.desc}</div>

              {/* 績效指標 */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="text-center">
                  <div className="text-[9px] mb-0.5" style={{ color: "var(--text-tertiary)" }}>策略報酬</div>
                  <div className="text-base font-bold" style={{ color: stratColor }}>
                    {strat.ret >= 0 ? "+" : ""}{(strat.ret * 100).toFixed(2)}%
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-[9px] mb-0.5" style={{ color: "var(--text-tertiary)" }}>最大回撤</div>
                  <div className="text-base font-bold" style={{ color: "#ef4444" }}>
                    {(strat.mdd * 100).toFixed(2)}%
                  </div>
                </div>
                {bench && (
                  <div className="text-center">
                    <div className="text-[9px] mb-0.5" style={{ color: "var(--text-tertiary)" }}>基準報酬</div>
                    <div className="text-base font-bold" style={{ color: bench.ret >= 0 ? "#22c55e" : "#ef4444" }}>
                      {bench.ret >= 0 ? "+" : ""}{(bench.ret * 100).toFixed(2)}%
                    </div>
                  </div>
                )}
                {alpha !== null && (
                  <div className="text-center">
                    <div className="text-[9px] mb-0.5" style={{ color: "var(--text-tertiary)" }}>超額報酬 α</div>
                    <div className="text-base font-bold" style={{ color: alpha >= 0 ? "#22c55e" : "#ef4444" }}>
                      {alpha >= 0 ? "+" : ""}{(alpha * 100).toFixed(2)}%
                    </div>
                  </div>
                )}
              </div>

              {/* 報酬 bar */}
              <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, Math.abs(strat.ret) * 200)}%`,
                    background: stratColor,
                    marginLeft: strat.ret < 0 ? `${Math.max(0, 50 - Math.abs(strat.ret) * 200)}%` : "50%",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-[9px]" style={{ color: "var(--text-tertiary)" }}>
        危機期間績效僅供參考，實際持倉狀況因策略訊號而異，部分時期策略可能空倉。
      </div>
    </div>
  );
}
