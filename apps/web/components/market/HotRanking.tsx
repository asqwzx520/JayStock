"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getMarketRanking, type RankingStock } from "@/lib/api";

const POLL_MS = 3 * 60 * 1000; // 3 分鐘

interface Props {
  onSelectSymbol?: (symbol: string) => void;
}

function RankColumn({
  title,
  emoji,
  list,
  metricFn,
  onSelectSymbol,
}: {
  title: string;
  emoji: string;
  list: RankingStock[];
  metricFn: (s: RankingStock) => { label: string; color: string };
  onSelectSymbol?: (sym: string) => void;
}) {
  return (
    <div
      className="flex flex-col flex-1 min-w-0 rounded-xl overflow-hidden"
      style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}
    >
      {/* Column header */}
      <div
        className="shrink-0 flex items-center gap-1.5 px-3 py-2 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="text-sm">{emoji}</span>
        <span className="text-xs font-bold tracking-wide" style={{ color: "var(--text-primary)" }}>
          {title}
        </span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <p className="text-center text-xs py-6" style={{ color: "var(--text-muted)" }}>暫無資料</p>
        ) : (
          list.map((s, i) => {
            const { label, color } = metricFn(s);
            return (
              <button
                key={s.symbol}
                onClick={() => onSelectSymbol?.(s.symbol)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
              >
                {/* Rank badge */}
                <span
                  className="text-[10px] w-5 h-5 rounded-full flex items-center justify-center shrink-0 font-bold"
                  style={{
                    background: i < 3 ? "var(--color-accent)" : "var(--bg-elevated)",
                    color:      i < 3 ? "#fff" : "var(--text-muted)",
                  }}
                >
                  {i + 1}
                </span>

                {/* Symbol + Name */}
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold block" style={{ color: "var(--text-primary)" }}>
                    {s.symbol}
                  </span>
                  <span className="text-[10px] block truncate" style={{ color: "var(--text-secondary)" }}>
                    {s.name}
                  </span>
                </div>

                {/* Price + metric */}
                <div className="text-right shrink-0">
                  <span className="text-[11px] block font-mono" style={{ color: "var(--text-primary)" }}>
                    {s.price?.toFixed(2) ?? "—"}
                  </span>
                  <span className="text-[11px] font-bold block" style={{ color }}>
                    {label}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function HotRanking({ onSelectSymbol }: Props) {
  const [data, setData]           = useState<{ gainers: RankingStock[]; losers: RankingStock[]; volume: RankingStock[] }>({
    gainers: [], losers: [], volume: [],
  });
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const load = useCallback(async () => {
    try {
      const res = await getMarketRanking();
      setData({
        gainers: res.gainers ?? [],
        losers:  res.losers  ?? [],
        volume:  res.volume  ?? [],
      });
      setUpdatedAt(res.updated_at ?? "");
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-xs animate-pulse" style={{ color: "var(--text-muted)" }}>載入中…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>資料暫時無法取得</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-3 p-3">
      {/* Header bar */}
      <div className="shrink-0 flex items-center justify-between">
        <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
          熱門排行
        </h2>
        {updatedAt && (
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            更新 {updatedAt}
          </span>
        )}
      </div>

      {/* 3-column layout */}
      <div className="flex-1 min-h-0 flex gap-3">
        <RankColumn
          title="漲幅排行"
          emoji="🚀"
          list={data.gainers}
          metricFn={s => ({
            label: `+${s.change_pct?.toFixed(2) ?? "—"}%`,
            color: "var(--color-up)",
          })}
          onSelectSymbol={onSelectSymbol}
        />
        <RankColumn
          title="跌幅排行"
          emoji="📉"
          list={data.losers}
          metricFn={s => ({
            label: `${s.change_pct?.toFixed(2) ?? "—"}%`,
            color: "var(--color-down)",
          })}
          onSelectSymbol={onSelectSymbol}
        />
        <RankColumn
          title="爆量排行"
          emoji="⚡"
          list={data.volume}
          metricFn={s => ({
            label: `${s.vol_ratio?.toFixed(1) ?? "—"}x`,
            color: s.change_pct >= 0 ? "var(--color-up)" : "var(--color-down)",
          })}
          onSelectSymbol={onSelectSymbol}
        />
      </div>
    </div>
  );
}
