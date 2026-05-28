"use client";

import { useState, useEffect, useCallback } from "react";
import { getMarketChipsSummary, type MarketChipsSummary, type MarketChipsMover } from "@/lib/api";

const FOREIGN_COLOR = "#F59E0B";
const TRUST_COLOR   = "#8B5CF6";
const DEALER_COLOR  = "#06B6D4";

type InstType = "foreign" | "trust" | "dealer";

const INST_LABELS: Record<InstType, { label: string; color: string }> = {
  foreign: { label: "外資",   color: FOREIGN_COLOR },
  trust:   { label: "投信",   color: TRUST_COLOR   },
  dealer:  { label: "自營商", color: DEALER_COLOR  },
};

function formatK(n: number): string {
  const abs  = Math.abs(n);
  const sign = n >= 0 ? "+" : "-";
  if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(1)}萬`;
  return `${n >= 0 ? "+" : ""}${n.toLocaleString()}`;
}

function MoverTable({
  title,
  rows,
  onSelectStock,
}: {
  title: string;
  rows: MarketChipsMover[];
  onSelectStock: (sym: string) => void;
}) {
  return (
    <div className="flex flex-col min-h-0">
      <div
        className="text-[10px] font-semibold px-2 py-1 shrink-0"
        style={{ color: "var(--text-tertiary)" }}
      >
        {title}
      </div>
      <div className="overflow-y-auto flex-1 min-h-0">
        {rows.map((r) => (
          <button
            key={r.symbol}
            onClick={() => onSelectStock(r.symbol)}
            className="w-full flex items-center justify-between px-2 py-1 text-xs hover:bg-white/5 transition-colors"
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="num font-medium shrink-0" style={{ color: "var(--text-secondary)" }}>
                {r.symbol}
              </span>
              <span className="truncate" style={{ color: "var(--text-tertiary)" }}>
                {r.name}
              </span>
            </span>
            <span
              className="num text-[11px] font-semibold shrink-0 ml-2"
              style={{ color: r.net >= 0 ? "var(--color-up)" : "var(--color-down)" }}
            >
              {formatK(r.net)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TotalBar({
  type,
  total,
}: {
  type: InstType;
  total: MarketChipsSummary["total"];
}) {
  const value = total[type];
  const { label, color } = INST_LABELS[type];
  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color }} />
      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <span
        className="num text-xs font-bold ml-auto"
        style={{ color: value >= 0 ? "var(--color-up)" : "var(--color-down)" }}
      >
        {formatK(value)}
      </span>
    </div>
  );
}

interface MarketChipsBoardProps {
  onSelectStock: (sym: string) => void;
}

export default function MarketChipsBoard({ onSelectStock }: MarketChipsBoardProps) {
  const [data, setData]       = useState<MarketChipsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [activeInst, setActiveInst] = useState<InstType>("foreign");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await getMarketChipsSummary();
      setData(resp);
    } catch (e) {
      setError(e instanceof Error ? e.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const group = data?.[activeInst];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Header ──────────────────────────────────────────── */}
      <div
        className="shrink-0 px-3 py-2 border-b flex items-center justify-between gap-3"
        style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
      >
        <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
          大盤法人動向
        </span>
        <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          {data?.date ?? "—"}
        </span>
        <button
          onClick={load}
          disabled={loading}
          className="text-[10px] px-2 py-0.5 rounded border transition-colors"
          style={{
            borderColor: "var(--border)",
            color: "var(--text-secondary)",
            background: "transparent",
          }}
        >
          {loading ? "載入中…" : "重新整理"}
        </button>
      </div>

      {/* ── Market totals ────────────────────────────────────── */}
      {data && (
        <div
          className="shrink-0 border-b"
          style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
        >
          <div className="text-[9px] px-3 pt-1.5 pb-0.5" style={{ color: "var(--text-tertiary)" }}>
            全市場淨買超（張）
          </div>
          <TotalBar type="foreign" total={data.total} />
          <TotalBar type="trust"   total={data.total} />
          <TotalBar type="dealer"  total={data.total} />
          <div className="pb-1" />
        </div>
      )}

      {/* ── Institution selector ─────────────────────────────── */}
      <div
        className="shrink-0 flex border-b px-2 py-1.5 gap-1"
        style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
      >
        {(["foreign", "trust", "dealer"] as InstType[]).map((t) => {
          const { label, color } = INST_LABELS[t];
          const isActive = activeInst === t;
          return (
            <button
              key={t}
              onClick={() => setActiveInst(t)}
              className="px-2.5 py-0.5 text-xs rounded transition-colors font-medium"
              style={{
                background: isActive ? `${color}22` : "transparent",
                color:      isActive ? color : "var(--text-tertiary)",
                border:     `1px solid ${isActive ? color : "transparent"}`,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ── State guards ─────────────────────────────────────── */}
      {loading && !data && (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            載入中…
          </span>
        </div>
      )}
      {error && (
        <div className="flex-1 flex items-center justify-center px-4 text-center">
          <span className="text-xs" style={{ color: "var(--color-down)" }}>
            {error}
          </span>
        </div>
      )}

      {/* ── Buyer / Seller tables ─────────────────────────────── */}
      {group && (
        <div className="flex-1 grid grid-cols-2 min-h-0 gap-0 divide-x"
             style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-col min-h-0">
            <MoverTable
              title={`${INST_LABELS[activeInst].label} 買超 Top ${group.buyers.length}`}
              rows={group.buyers}
              onSelectStock={onSelectStock}
            />
          </div>
          <div className="flex flex-col min-h-0">
            <MoverTable
              title={`${INST_LABELS[activeInst].label} 賣超 Top ${group.sellers.length}`}
              rows={group.sellers}
              onSelectStock={onSelectStock}
            />
          </div>
        </div>
      )}
    </div>
  );
}
