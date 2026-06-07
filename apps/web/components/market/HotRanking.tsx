"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getMarketRanking, type RankingStock } from "@/lib/api";

type Tab = "gainers" | "losers" | "volume";

const TABS: { key: Tab; label: string }[] = [
  { key: "gainers", label: "漲幅" },
  { key: "losers",  label: "跌幅" },
  { key: "volume",  label: "爆量" },
];

const POLL_MS = 3 * 60 * 1000; // 3 分鐘

interface Props {
  onSelectSymbol?: (symbol: string) => void;
}

export default function HotRanking({ onSelectSymbol }: Props) {
  const [tab, setTab]               = useState<Tab>("gainers");
  const [data, setData]             = useState<Record<Tab, RankingStock[]>>({
    gainers: [], losers: [], volume: [],
  });
  const [updatedAt, setUpdatedAt]   = useState("");
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(false);
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

  const list = data[tab];

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-1 shrink-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex-1 text-xs py-1 rounded transition-colors"
            style={{
              background: tab === t.key ? "var(--color-accent)" : "var(--bg-elevated)",
              color:      tab === t.key ? "#fff" : "var(--text-secondary)",
              fontWeight: tab === t.key ? 600 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Updated at */}
      {updatedAt && (
        <p className="text-center text-[10px] pb-1 shrink-0" style={{ color: "var(--text-muted)" }}>
          更新 {updatedAt}
        </p>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <p className="text-center text-xs py-6" style={{ color: "var(--text-muted)" }}>
            載入中…
          </p>
        )}
        {!loading && error && (
          <p className="text-center text-xs py-6" style={{ color: "var(--text-muted)" }}>
            資料暫時無法取得
          </p>
        )}
        {!loading && !error && list.length === 0 && (
          <p className="text-center text-xs py-6" style={{ color: "var(--text-muted)" }}>
            暫無資料
          </p>
        )}
        {!loading && !error && list.map((s, i) => {
          const isUp    = s.change_pct >= 0;
          const color   = isUp ? "var(--color-up)" : "var(--color-down)";
          const sign    = isUp ? "+" : "";
          const metric  = tab === "volume"
            ? `${s.vol_ratio?.toFixed(1) ?? "—"}x`
            : `${sign}${s.change_pct?.toFixed(2) ?? "—"}%`;

          return (
            <button
              key={s.symbol}
              onClick={() => onSelectSymbol?.(s.symbol)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left stock-row-shimmer"
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              {/* Rank */}
              <span
                className="text-[11px] w-4 shrink-0 text-center font-mono"
                style={{ color: i < 3 ? "var(--color-accent)" : "var(--text-muted)" }}
              >
                {i + 1}
              </span>

              {/* Symbol + Name */}
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold block" style={{ color: "var(--text-primary)" }}>
                  {s.symbol}
                </span>
                <span
                  className="text-[10px] block truncate"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {s.name}
                </span>
              </div>

              {/* Price + metric */}
              <div className="text-right shrink-0">
                <span className="text-xs block font-mono" style={{ color: "var(--text-primary)" }}>
                  {s.price?.toFixed(2) ?? "—"}
                </span>
                <span className="text-[11px] font-semibold block" style={{ color }}>
                  {metric}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
