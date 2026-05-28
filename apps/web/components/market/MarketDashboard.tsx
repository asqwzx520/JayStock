"use client";

/**
 * M5 市場儀錶板
 *
 * 結構：
 *   大盤指數欄（6 個指數卡）
 *   ─────────────────────────────────
 *   市場廣度儀錶板  |  產業板塊熱力圖
 *
 * sub-tab 切換：廣度+板塊 / 法人動向（復用 MarketChipsBoard）
 */

import { useState, useEffect, useCallback } from "react";
import MarketChipsBoard from "@/components/chart/MarketChipsBoard";
import {
  getMarketIndices,
  getMarketBreadth,
  getSectorHeatmap,
  type IndexQuote,
  type MarketBreadth,
  type SectorData,
} from "@/lib/api";

// ── 工具函數 ────────────────────────────────────────────────────────────────

function fmtNum(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function changeColor(n: number | null | undefined): string {
  if (n == null || n === 0) return "var(--color-flat)";
  return n > 0 ? "var(--color-up)" : "var(--color-down)";
}

/** 色板：-5% ~ +5% 映射到背景色 */
function heatColor(pct: number): string {
  const clamp = Math.max(-5, Math.min(5, pct));
  if (clamp > 0) {
    const intensity = Math.round((clamp / 5) * 180);
    return `rgba(239, 68, 68, ${0.08 + (clamp / 5) * 0.55})`; // 紅：上漲
  } else if (clamp < 0) {
    const abs = Math.abs(clamp);
    return `rgba(34, 197, 94, ${0.08 + (abs / 5) * 0.55})`; // 綠：下跌（台灣習慣）
  }
  return "rgba(255,255,255,0.05)";
}

// ── 指數卡 ──────────────────────────────────────────────────────────────────

function IndexCard({ idx }: { idx: IndexQuote }) {
  const pct = idx.change_pct;
  const color = changeColor(pct);

  return (
    <div
      className="flex flex-col gap-1 rounded-lg px-3 py-2.5 border"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--border)",
        minWidth: 130,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          {idx.flag} {idx.name}
        </span>
        {pct != null && (
          <span
            className="text-[10px] font-semibold px-1 rounded"
            style={{
              color,
              background: pct > 0
                ? "rgba(239,68,68,0.12)"
                : pct < 0
                ? "rgba(34,197,94,0.12)"
                : "rgba(128,128,128,0.1)",
            }}
          >
            {fmtPct(pct)}
          </span>
        )}
      </div>
      <div
        className="num font-bold text-base leading-tight"
        style={{ color: idx.price != null ? color : "var(--text-tertiary)" }}
      >
        {idx.price != null ? fmtNum(idx.price, idx.id === "TWII" ? 2 : 2) : "—"}
      </div>
      {idx.change != null && (
        <div className="num text-[11px]" style={{ color }}>
          {idx.change > 0 ? "+" : ""}{fmtNum(idx.change, 2)}
        </div>
      )}
    </div>
  );
}

// ── 指數欄 ──────────────────────────────────────────────────────────────────

function IndicesStrip({ indices, loading }: { indices: IndexQuote[]; loading: boolean }) {
  return (
    <div
      className="flex items-center gap-3 flex-wrap px-4 py-3 border-b"
      style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
    >
      <span className="text-xs font-medium shrink-0" style={{ color: "var(--text-secondary)" }}>
        大盤指數
      </span>
      {loading && indices.length === 0 ? (
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>載入中…</span>
      ) : (
        <div className="flex items-start gap-2 flex-wrap">
          {indices.map((idx) => <IndexCard key={idx.id} idx={idx} />)}
        </div>
      )}
    </div>
  );
}

// ── 市場廣度 ─────────────────────────────────────────────────────────────────

function BreadthBar({ label, count, total, color }: {
  label: string; count: number; total: number; color: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 text-right text-xs shrink-0" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <div
        className="flex-1 rounded-full overflow-hidden"
        style={{ background: "var(--bg-elevated)", height: 8 }}
      >
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="w-12 text-right num text-xs font-semibold shrink-0" style={{ color }}>
        {count.toLocaleString()}
      </span>
    </div>
  );
}

function BreadthPanel({ breadth, loading, error }: {
  breadth: MarketBreadth | null;
  loading: boolean;
  error: string;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>載入廣度資料…</span>
      </div>
    );
  }
  if (error || !breadth) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          {error || "市場廣度資料暫不可用"}
        </span>
      </div>
    );
  }

  const total = breadth.total || (breadth.advances + breadth.declines + breadth.unchanged);

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          市場廣度
        </span>
        {breadth.date && (
          <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            {breadth.date}
            {breadth.source === "screener_approx" && " (抽樣近似值)"}
          </span>
        )}
      </div>

      {/* 三色進度條 */}
      <div
        className="flex rounded-lg overflow-hidden"
        style={{ height: 16 }}
        title={`上漲 ${breadth.advances} / 持平 ${breadth.unchanged} / 下跌 ${breadth.declines}`}
      >
        {total > 0 && (
          <>
            <div
              style={{ width: `${(breadth.advances / total) * 100}%`, background: "var(--color-up)", opacity: 0.85 }}
            />
            <div
              style={{ width: `${(breadth.unchanged / total) * 100}%`, background: "rgba(128,128,128,0.4)" }}
            />
            <div
              style={{ width: `${(breadth.declines / total) * 100}%`, background: "var(--color-down)", opacity: 0.85 }}
            />
          </>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <BreadthBar label="上漲" count={breadth.advances}  total={total} color="var(--color-up)"   />
        <BreadthBar label="持平" count={breadth.unchanged} total={total} color="rgba(128,128,128,0.7)" />
        <BreadthBar label="下跌" count={breadth.declines}  total={total} color="var(--color-down)" />
      </div>

      <div className="flex gap-4 mt-1">
        <div
          className="flex-1 flex flex-col items-center gap-1 rounded-lg py-2.5"
          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}
        >
          <span className="text-[10px]" style={{ color: "rgba(239,68,68,0.8)" }}>漲停</span>
          <span className="num text-xl font-bold" style={{ color: "var(--color-up)" }}>
            {breadth.limit_up}
          </span>
        </div>
        <div
          className="flex-1 flex flex-col items-center gap-1 rounded-lg py-2.5"
          style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)" }}
        >
          <span className="text-[10px]" style={{ color: "rgba(34,197,94,0.8)" }}>跌停</span>
          <span className="num text-xl font-bold" style={{ color: "var(--color-down)" }}>
            {breadth.limit_down}
          </span>
        </div>
        <div
          className="flex-1 flex flex-col items-center gap-1 rounded-lg py-2.5"
          style={{ background: "var(--bg-elevated)" }}
        >
          <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>總計</span>
          <span className="num text-xl font-bold" style={{ color: "var(--text-primary)" }}>
            {total.toLocaleString()}
          </span>
        </div>
      </div>

      {/* A/D 比 */}
      {breadth.advances + breadth.declines > 0 && (
        <div
          className="flex items-center justify-between rounded px-3 py-2"
          style={{ background: "var(--bg-elevated)" }}
        >
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            漲跌比（A/D Ratio）
          </span>
          <span
            className="num text-sm font-bold"
            style={{
              color: breadth.advances >= breadth.declines
                ? "var(--color-up)"
                : "var(--color-down)",
            }}
          >
            {(breadth.advances / Math.max(1, breadth.declines)).toFixed(2)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── 產業板塊熱力圖 ────────────────────────────────────────────────────────────

function SectorTile({
  sector,
  onClick,
}: {
  sector: SectorData;
  onClick?: (s: SectorData) => void;
}) {
  const pct = sector.avg_change;
  return (
    <button
      className="flex flex-col items-center gap-1 rounded-lg px-2 py-3 text-center transition-opacity hover:opacity-80 border"
      style={{
        background: heatColor(pct),
        borderColor: Math.abs(pct) > 2
          ? (pct > 0 ? "rgba(239,68,68,0.35)" : "rgba(34,197,94,0.35)")
          : "var(--border)",
        cursor: onClick ? "pointer" : "default",
      }}
      onClick={() => onClick?.(sector)}
      title={`${sector.name}\n上漲 ${sector.advances} 跌 ${sector.declines}（共 ${sector.total} 檔）`}
    >
      <span
        className="text-[11px] font-semibold leading-tight"
        style={{ color: "var(--text-primary)" }}
      >
        {sector.name}
      </span>
      <span
        className="num text-sm font-bold"
        style={{ color: changeColor(pct) }}
      >
        {fmtPct(pct)}
      </span>
      {sector.total > 0 && (
        <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          ▲{sector.advances} ▼{sector.declines}
        </span>
      )}
    </button>
  );
}

function SectorHeatmap({
  sectors,
  loading,
  error,
  onSelectStock,
}: {
  sectors: SectorData[];
  loading: boolean;
  error: string;
  onSelectStock?: (sym: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState<SectorData | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>載入板塊資料…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          產業板塊
        </span>
        {sectors.length > 0 && (
          <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            {sectors.length} 個板塊
          </span>
        )}
      </div>

      {error ? (
        <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>{error}</div>
      ) : sectors.length === 0 ? (
        <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          板塊資料載入中（需 screener 快取就緒）
        </div>
      ) : (
        <>
          {/* 熱力圖格子 */}
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))" }}
          >
            {sectors.map((s) => (
              <SectorTile
                key={s.name}
                sector={s}
                onClick={setExpanded}
              />
            ))}
          </div>

          {/* 展開：板塊個股列表 */}
          {expanded && (
            <div
              className="rounded-lg border overflow-hidden"
              style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
            >
              <div
                className="flex items-center justify-between px-4 py-2 border-b"
                style={{ borderColor: "var(--border)" }}
              >
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {expanded.name} — 個股明細
                </span>
                <button
                  className="text-xs px-2 py-0.5 rounded"
                  style={{
                    background: "var(--bg-elevated)",
                    color: "var(--text-secondary)",
                  }}
                  onClick={() => setExpanded(null)}
                >
                  收起
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: "var(--bg-elevated)" }}>
                      <th className="text-left px-3 py-1.5" style={{ color: "var(--text-tertiary)" }}>代號</th>
                      <th className="text-left px-3 py-1.5" style={{ color: "var(--text-tertiary)" }}>名稱</th>
                      <th className="text-right px-3 py-1.5" style={{ color: "var(--text-tertiary)" }}>現價</th>
                      <th className="text-right px-3 py-1.5" style={{ color: "var(--text-tertiary)" }}>漲跌</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expanded.stocks.map((st) => (
                      <tr
                        key={st.symbol}
                        className="cursor-pointer hover:opacity-80 transition-opacity border-t"
                        style={{ borderColor: "var(--border)" }}
                        onClick={() => onSelectStock?.(st.symbol, st.name)}
                      >
                        <td className="px-3 py-1.5 num font-medium" style={{ color: "var(--color-brand)" }}>
                          {st.symbol}
                        </td>
                        <td className="px-3 py-1.5" style={{ color: "var(--text-primary)" }}>
                          {st.name}
                        </td>
                        <td className="px-3 py-1.5 text-right num" style={{ color: "var(--text-primary)" }}>
                          {fmtNum(st.price)}
                        </td>
                        <td
                          className="px-3 py-1.5 text-right num font-semibold"
                          style={{ color: changeColor(st.change_pct) }}
                        >
                          {fmtPct(st.change_pct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── 主元件 ───────────────────────────────────────────────────────────────────

type MarketSubTab = "breadth" | "chips";

interface MarketDashboardProps {
  onSelectStock?: (sym: string, name: string) => void;
}

export default function MarketDashboard({ onSelectStock }: MarketDashboardProps) {
  const [subTab, setSubTab] = useState<MarketSubTab>("breadth");

  // 指數
  const [indices, setIndices]           = useState<IndexQuote[]>([]);
  const [indicesLoading, setIndicesLoading] = useState(false);

  // 廣度
  const [breadth, setBreadth]           = useState<MarketBreadth | null>(null);
  const [breadthLoading, setBreadthLoading] = useState(false);
  const [breadthError, setBreadthError] = useState("");

  // 板塊
  const [sectors, setSectors]           = useState<SectorData[]>([]);
  const [sectorsLoading, setSectorsLoading] = useState(false);
  const [sectorsError, setSectorsError] = useState("");

  // ── 指數（每 60s 自動刷新）
  const loadIndices = useCallback(async () => {
    setIndicesLoading(true);
    try {
      const resp = await getMarketIndices();
      setIndices(resp.indices);
    } catch {
      // 指數靜默失敗，不阻塞頁面
    } finally {
      setIndicesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIndices();
    const id = setInterval(loadIndices, 60_000);
    return () => clearInterval(id);
  }, [loadIndices]);

  // ── 廣度 + 板塊（切換到 breadth tab 時載入）
  const loadBreadthAndSectors = useCallback(async () => {
    // 廣度
    setBreadthLoading(true);
    setBreadthError("");
    try {
      const b = await getMarketBreadth();
      setBreadth(b);
    } catch (e) {
      setBreadthError(e instanceof Error ? e.message : "廣度資料載入失敗");
    } finally {
      setBreadthLoading(false);
    }

    // 板塊
    setSectorsLoading(true);
    setSectorsError("");
    try {
      const s = await getSectorHeatmap();
      setSectors(s.sectors);
    } catch (e) {
      setSectorsError(e instanceof Error ? e.message : "板塊資料載入失敗");
    } finally {
      setSectorsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (subTab === "breadth") loadBreadthAndSectors();
  }, [subTab, loadBreadthAndSectors]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 指數欄 */}
      <IndicesStrip indices={indices} loading={indicesLoading} />

      {/* Sub-tab */}
      <div
        className="flex items-center gap-1 px-4 py-2 border-b shrink-0"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
      >
        {(["breadth", "chips"] as MarketSubTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className="px-3 py-1 text-xs rounded font-medium transition-colors"
            style={{
              background: subTab === t ? "var(--color-brand)" : "transparent",
              color: subTab === t ? "#fff" : "var(--text-secondary)",
            }}
          >
            {t === "breadth" ? "📊 廣度 & 板塊" : "🏦 法人動向"}
          </button>
        ))}
        {subTab === "breadth" && (
          <button
            className="ml-auto text-xs px-2 py-1 rounded transition-colors"
            style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
            onClick={loadBreadthAndSectors}
          >
            ↻ 刷新
          </button>
        )}
      </div>

      {/* 內容區 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {subTab === "breadth" ? (
          <div className="flex h-full gap-0 overflow-hidden">
            {/* 左：市場廣度 */}
            <div
              className="w-72 shrink-0 overflow-y-auto border-r"
              style={{ borderColor: "var(--border)" }}
            >
              <BreadthPanel
                breadth={breadth}
                loading={breadthLoading}
                error={breadthError}
              />
            </div>

            {/* 右：產業板塊熱力圖 */}
            <div className="flex-1 min-w-0 overflow-y-auto">
              <SectorHeatmap
                sectors={sectors}
                loading={sectorsLoading}
                error={sectorsError}
                onSelectStock={(sym, name) => onSelectStock?.(sym, name)}
              />
            </div>
          </div>
        ) : (
          <MarketChipsBoard
            onSelectStock={(sym) => onSelectStock?.(sym, sym)}
          />
        )}
      </div>
    </div>
  );
}
