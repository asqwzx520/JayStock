"use client";

import { useState, useCallback, useRef } from "react";
import {
  getScreenerTemplates,
  runScreener,
  type ScreenerTemplate,
  type ScreenerResult,
  type ScreenerResponse,
} from "@/lib/api";

interface Props {
  onSelectStock: (sym: string, name: string) => void;
}

// ── 條紋徽章 ─────────────────────────────────────────────────────────────────
function StreakBadge({
  streak,
  label,
}: {
  streak: { days: number; direction: string };
  label: string;
}) {
  if (!streak || streak.days === 0) return null;
  const isBuy = streak.direction === "buy";
  return (
    <span
      className="text-[10px] px-1 py-0.5 rounded font-semibold whitespace-nowrap"
      style={{
        background: isBuy ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
        color:      isBuy ? "var(--color-up)"       : "var(--color-down)",
        border:     `1px solid ${isBuy ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
      }}
    >
      {label}{isBuy ? "▲" : "▼"}{streak.days}
    </span>
  );
}

// ── RSI 色帶 ─────────────────────────────────────────────────────────────────
function RsiCell({ rsi }: { rsi: number }) {
  const color =
    rsi >= 70 ? "var(--color-up)"
    : rsi <= 30 ? "var(--color-down)"
    : "var(--text-primary)";
  return (
    <span className="num font-medium" style={{ color }}>
      {rsi.toFixed(1)}
    </span>
  );
}

// ── 主元件 ───────────────────────────────────────────────────────────────────
export default function ScreenerPanel({ onSelectStock }: Props) {
  const [templates,       setTemplates]       = useState<ScreenerTemplate[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [selected,        setSelected]        = useState<string>("");
  const [nlQuery,         setNlQuery]          = useState("");
  const [response,        setResponse]         = useState<ScreenerResponse | null>(null);
  const [loading,         setLoading]          = useState(false);
  const [error,           setError]             = useState("");
  const [sortCol,         setSortCol]          = useState<keyof ScreenerResult>("score");
  const [sortAsc,         setSortAsc]          = useState(false);
  const nlRef = useRef<HTMLInputElement>(null);

  // 載入模板清單（只需一次）
  const ensureTemplates = useCallback(async () => {
    if (templatesLoaded) return;
    try {
      const { templates: t } = await getScreenerTemplates();
      setTemplates(t);
      setTemplatesLoaded(true);
    } catch {
      // 模板載入失敗不影響主流程，fallback 空陣列
    }
  }, [templatesLoaded]);

  // 執行選股
  const handleRun = useCallback(async (tid?: string, nl?: string) => {
    await ensureTemplates();
    setLoading(true);
    setError("");
    try {
      const res = await runScreener(tid, nl, 50);
      setResponse(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "選股失敗，請稍後再試");
    } finally {
      setLoading(false);
    }
  }, [ensureTemplates]);

  // 點擊模板卡
  const handleTemplateClick = async (tid: string) => {
    setSelected(tid);
    setNlQuery("");
    await handleRun(tid);
  };

  // 自然語言提交
  const handleNlSubmit = async () => {
    if (!nlQuery.trim()) return;
    setSelected("");
    await handleRun(undefined, nlQuery.trim());
  };

  // 排序
  const handleSort = (col: keyof ScreenerResult) => {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(false);
    }
  };

  const sortedResults = (() => {
    if (!response?.results) return [];
    return [...response.results].sort((a, b) => {
      const av = a[sortCol] as number | string;
      const bv = b[sortCol] as number | string;
      if (typeof av === "number" && typeof bv === "number") {
        return sortAsc ? av - bv : bv - av;
      }
      return sortAsc
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  })();

  const SortIcon = ({ col }: { col: keyof ScreenerResult }) =>
    sortCol === col ? (
      <span className="ml-0.5 opacity-70">{sortAsc ? "↑" : "↓"}</span>
    ) : (
      <span className="ml-0.5 opacity-20">↕</span>
    );

  // ── 預設顯示：尚未執行選股 ────────────────────────────────────────────────
  const showEmpty = !loading && !response && !error;

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: "var(--bg-surface)" }}
    >
      {/* ── 模板卡區 ──────────────────────────────────────────────── */}
      <div
        className="shrink-0 p-4 pb-3 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="text-xs font-semibold mb-3" style={{ color: "var(--text-secondary)" }}>
          預設策略模板
        </div>
        <div className="grid grid-cols-5 gap-2">
          {(templatesLoaded ? templates : DEFAULT_TEMPLATES).map((t) => (
            <button
              key={t.id}
              onClick={() => handleTemplateClick(t.id)}
              disabled={loading}
              className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg text-center
                         transition-all border"
              style={{
                background:   selected === t.id ? `${t.color}22` : "var(--bg-elevated)",
                borderColor:  selected === t.id ? t.color          : "var(--border)",
                color:        selected === t.id ? t.color          : "var(--text-secondary)",
                boxShadow:    selected === t.id ? `0 0 0 1px ${t.color}66` : "none",
              }}
            >
              <span className="text-xl leading-none">{t.icon}</span>
              <span className="text-[11px] font-semibold leading-tight">{t.name}</span>
            </button>
          ))}
        </div>

        {/* ── 自然語言輸入 ──────────────────────────────────────────── */}
        <div className="flex gap-2 mt-3">
          <input
            ref={nlRef}
            value={nlQuery}
            onChange={(e) => setNlQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleNlSubmit()}
            placeholder='自然語言選股，例如：「找外資連買三天的股票」'
            disabled={loading}
            className="flex-1 px-3 py-1.5 rounded text-sm outline-none"
            style={{
              background:  "var(--bg-elevated)",
              border:      "1px solid var(--border)",
              color:       "var(--text-primary)",
            }}
          />
          <button
            onClick={handleNlSubmit}
            disabled={loading || !nlQuery.trim()}
            className="px-4 py-1.5 rounded text-sm font-semibold transition-opacity"
            style={{
              background: "var(--color-brand)",
              color:      "#fff",
              opacity:    loading || !nlQuery.trim() ? 0.5 : 1,
            }}
          >
            掃描
          </button>
        </div>

        {/* NLP 識別提示 */}
        {response?.nl_matched && (
          <div className="mt-1.5 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            已識別為：
            <span style={{ color: "var(--color-brand)" }}>
              &nbsp;{DEFAULT_TEMPLATES.find((t) => t.id === response.nl_matched)?.name ?? response.nl_matched}
            </span>
          </div>
        )}
      </div>

      {/* ── 結果區 ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-auto">

        {/* 載入中 */}
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div
              className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: "var(--color-brand)", borderTopColor: "transparent" }}
            />
            <div className="text-sm" style={{ color: "var(--text-tertiary)" }}>
              正在掃描股票池，首次載入需 15-30 秒…
            </div>
          </div>
        )}

        {/* 錯誤 */}
        {error && !loading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-sm" style={{ color: "var(--color-down)" }}>{error}</div>
          </div>
        )}

        {/* 空狀態（尚未執行） */}
        {showEmpty && (
          <div className="flex flex-col items-center justify-center h-full gap-2 opacity-50">
            <div className="text-3xl">🔍</div>
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
              點選模板或輸入條件開始選股
            </div>
          </div>
        )}

        {/* 結果表格 */}
        {!loading && response && response.total > 0 && (
          <div>
            {/* 結果摘要列 */}
            <div
              className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 text-xs border-b"
              style={{
                background:  "var(--bg-surface)",
                borderColor: "var(--border)",
                color:       "var(--text-tertiary)",
              }}
            >
              <span>
                找到
                <span className="mx-1 font-semibold" style={{ color: "var(--text-primary)" }}>
                  {response.total}
                </span>
                檔符合條件
              </span>
              {response.cache_time && (
                <span>資料更新：{response.cache_time}</span>
              )}
            </div>

            {/* 表格 */}
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}>
                  <Th col="score"      label="評分"   onSort={handleSort} sortCol={sortCol} sortAsc={sortAsc} />
                  <Th col="symbol"     label="代碼"   onSort={handleSort} sortCol={sortCol} sortAsc={sortAsc} />
                  <th className="px-3 py-2 text-left font-medium">名稱</th>
                  <Th col="price"      label="現價"   onSort={handleSort} sortCol={sortCol} sortAsc={sortAsc} />
                  <Th col="change_pct" label="漲跌%"  onSort={handleSort} sortCol={sortCol} sortAsc={sortAsc} />
                  <Th col="vol_ratio"  label="量比"   onSort={handleSort} sortCol={sortCol} sortAsc={sortAsc} />
                  <Th col="rsi14"      label="RSI"    onSort={handleSort} sortCol={sortCol} sortAsc={sortAsc} />
                  <th className="px-3 py-2 text-left font-medium">法人</th>
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((r, idx) => (
                  <ResultRow
                    key={r.symbol}
                    r={r}
                    rank={idx + 1}
                    onSelect={() => onSelectStock(r.symbol, r.name)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 空結果 */}
        {!loading && response && response.total === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 opacity-50">
            <div className="text-2xl">😶</div>
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
              目前沒有符合條件的股票
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 表頭元件 ─────────────────────────────────────────────────────────────────
function Th({
  col,
  label,
  onSort,
  sortCol,
  sortAsc,
}: {
  col:     keyof ScreenerResult;
  label:   string;
  onSort:  (c: keyof ScreenerResult) => void;
  sortCol: keyof ScreenerResult;
  sortAsc: boolean;
}) {
  return (
    <th
      className="px-3 py-2 text-left font-medium cursor-pointer select-none hover:opacity-80"
      onClick={() => onSort(col)}
    >
      {label}
      {sortCol === col ? (
        <span className="ml-0.5 opacity-70">{sortAsc ? "↑" : "↓"}</span>
      ) : (
        <span className="ml-0.5 opacity-20">↕</span>
      )}
    </th>
  );
}

// ── 結果列元件 ───────────────────────────────────────────────────────────────
function ResultRow({
  r,
  rank,
  onSelect,
}: {
  r:        ScreenerResult;
  rank:     number;
  onSelect: () => void;
}) {
  const isUp   = r.change_pct > 0;
  const isDown = r.change_pct < 0;
  const changeColor = isUp
    ? "var(--color-up)"
    : isDown
    ? "var(--color-down)"
    : "var(--color-flat)";

  // 評分色條
  const scoreColor =
    r.score >= 70 ? "var(--color-up)"
    : r.score >= 40 ? "var(--color-brand)"
    : "var(--text-tertiary)";

  return (
    <tr
      className="cursor-pointer border-b"
      style={{ borderColor: "var(--border)", transition: "background-color 0.2s ease" }}
      onClick={onSelect}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "var(--bg-elevated)";
        e.currentTarget.classList.add("tr-shimmer-active");
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "";
        e.currentTarget.classList.remove("tr-shimmer-active");
      }}
    >
      {/* 評分 */}
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span
            className="num text-xs font-bold"
            style={{ color: scoreColor, minWidth: 28 }}
          >
            {r.score.toFixed(0)}
          </span>
          <div
            className="h-1 rounded-full flex-1"
            style={{ background: "var(--bg-elevated)", minWidth: 40 }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width:      `${r.score}%`,
                background: scoreColor,
              }}
            />
          </div>
        </div>
      </td>

      {/* 代碼 */}
      <td className="px-3 py-2">
        <span className="num font-semibold" style={{ color: "var(--color-brand)" }}>
          {r.symbol}
        </span>
        {r.ma20_breakout && (
          <span
            className="ml-1 text-[9px] px-1 py-0.5 rounded font-bold"
            style={{ background: "rgba(245,158,11,0.2)", color: "#F59E0B" }}
          >
            突破
          </span>
        )}
      </td>

      {/* 名稱 */}
      <td
        className="px-3 py-2 max-w-[80px] truncate"
        style={{ color: "var(--text-secondary)" }}
      >
        {r.name}
      </td>

      {/* 現價 */}
      <td className="px-3 py-2">
        <span className="num font-medium" style={{ color: "var(--text-primary)" }}>
          {r.price.toFixed(2)}
        </span>
      </td>

      {/* 漲跌% */}
      <td className="px-3 py-2">
        <span className="num font-semibold" style={{ color: changeColor }}>
          {r.change_pct > 0 ? "+" : ""}
          {r.change_pct.toFixed(2)}%
        </span>
      </td>

      {/* 量比 */}
      <td className="px-3 py-2">
        <span
          className="num"
          style={{
            color:
              r.vol_ratio >= 1.5 ? "var(--color-up)"
              : r.vol_ratio >= 1.0 ? "var(--text-primary)"
              : "var(--text-tertiary)",
          }}
        >
          {r.vol_ratio.toFixed(2)}x
        </span>
      </td>

      {/* RSI */}
      <td className="px-3 py-2">
        <RsiCell rsi={r.rsi14} />
      </td>

      {/* 法人 */}
      <td className="px-3 py-2">
        <div className="flex items-center gap-1 flex-wrap">
          <StreakBadge streak={r.foreign_streak} label="外" />
          <StreakBadge streak={r.trust_streak}   label="投" />
          <StreakBadge streak={r.dealer_streak}  label="自" />
        </div>
      </td>
    </tr>
  );
}

// ── 預設模板（靜態，用於初始渲染 + fallback）────────────────────────────────
const DEFAULT_TEMPLATES: ScreenerTemplate[] = [
  { id: "strong_breakout", name: "強勢突破", icon: "🚀", desc: "", tags: [], color: "#F59E0B" },
  { id: "foreign_buying",  name: "外資連買", icon: "🏦", desc: "", tags: [], color: "#3B82F6" },
  { id: "margin_warning",  name: "融資警示", icon: "⚠️", desc: "", tags: [], color: "#EF4444" },
  { id: "accumulation",    name: "低檔蓄積", icon: "📦", desc: "", tags: [], color: "#8B5CF6" },
  { id: "major_control",   name: "主力控盤", icon: "🎯", desc: "", tags: [], color: "#10B981" },
];
