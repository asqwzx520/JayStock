"use client";

import { useCallback, useEffect, useState } from "react";
import { getStockNews, type NewsItem } from "@/lib/api";

interface StockNewsProps {
  symbol: string;
}

type Importance = "全部" | "高" | "中" | "低";

const IMPORTANCE_TABS: Importance[] = ["全部", "高", "中", "低"];

const IMPORTANCE_STYLE: Record<Importance, { bg: string; color: string }> = {
  全部: { bg: "var(--color-brand)",          color: "#fff" },
  高:   { bg: "rgba(239,68,68,0.15)",        color: "var(--color-down)" },
  中:   { bg: "rgba(245,158,11,0.15)",       color: "#F59E0B" },
  低:   { bg: "rgba(148,163,184,0.15)",      color: "var(--text-tertiary)" },
};

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "美股":     ["標普", "道瓊", "那斯達克", "美股", "S&P", "Nasdaq", "美國股市"],
  "Fed/利率": ["Fed", "聯準會", "升息", "降息", "利率", "貨幣政策", "FOMC"],
  "半導體":   ["半導體", "晶圓", "台積電", "輝達", "AI晶片", "封測", "先進製程"],
  "匯率":     ["匯率", "美元", "台幣", "升值", "貶值", "外匯", "匯兌"],
  "財報":     ["財報", "EPS", "營收", "獲利", "盈餘", "虧損", "季報", "年報"],
  "法說":     ["法說", "投資人日", "法人說明會"],
};

function relativeTime(unixSec: number): string {
  const diffMs = Date.now() - unixSec * 1000;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1)    return "剛剛";
  if (diffMin < 60)   return `${diffMin} 分鐘前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)    return `${diffHr} 小時前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7)    return `${diffDay} 天前`;
  const d = new Date(unixSec * 1000);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export default function StockNews({ symbol }: StockNewsProps) {
  const [news,    setNews]    = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  // 篩選狀態
  const [importance,        setImportance]        = useState<Importance>("全部");
  const [activeCategories,  setActiveCategories]  = useState<string[]>([]);
  const [keyword,           setKeyword]           = useState("");
  const [chineseOnly,       setChineseOnly]       = useState(false); // 預設顯示全部語言

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const res = await getStockNews(symbol);
      setNews(res.news ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => { load(); }, [load]);

  // 切換分類 chip（多選）
  const toggleCategory = (cat: string) => {
    setActiveCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const chineseCount = news.filter(n => n.is_chinese).length;
  const englishCount = news.length - chineseCount;

  // 篩選邏輯（全前端）
  const filtered = news
    .filter(n => !chineseOnly || n.is_chinese)                     // 可切換中文過濾
    .filter(n => importance === "全部" || n.importance === importance)
    .filter(n =>
      activeCategories.length === 0 ||
      activeCategories.some(cat =>
        CATEGORY_KEYWORDS[cat].some(kw =>
          n.title.includes(kw) || n.publisher.includes(kw)
        )
      )
    )
    .filter(n => !keyword.trim() || n.title.includes(keyword.trim()));

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── 控制列 ─────────────────────────────────────────────────────── */}
      <div
        className="shrink-0 border-b px-3 pt-2 pb-2 flex flex-col gap-2"
        style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
      >
        {/* Row 1：重要度 tab + 關鍵字搜尋 */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {IMPORTANCE_TABS.map(tab => {
              const active = importance === tab;
              const style  = IMPORTANCE_STYLE[tab];
              return (
                <button
                  key={tab}
                  onClick={() => setImportance(tab)}
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold transition-all"
                  style={{
                    background: active ? style.bg  : "var(--bg-elevated)",
                    color:      active ? style.color : "var(--text-tertiary)",
                    border:     `1px solid ${active ? style.bg : "var(--border)"}`,
                  }}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          {/* 僅中文 toggle */}
          <button
            onClick={() => setChineseOnly(v => !v)}
            title={chineseOnly ? `顯示全部（含 ${englishCount} 篇英文）` : "切換為僅顯示中文新聞"}
            className="px-2 py-0.5 rounded text-[10px] font-medium transition-all"
            style={{
              background: chineseOnly ? "rgba(34,197,94,0.15)" : "var(--bg-elevated)",
              color:      chineseOnly ? "#4ADE80"              : "var(--text-tertiary)",
              border:     `1px solid ${chineseOnly ? "rgba(34,197,94,0.4)" : "var(--border)"}`,
            }}
          >
            {chineseOnly ? "🀄 僅中文" : `全部(${news.length})`}
          </button>

          {/* 搜尋框 */}
          <input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder="搜尋關鍵字…"
            className="ml-auto w-32 px-2 py-0.5 rounded text-[11px] outline-none"
            style={{
              background: "var(--bg-elevated)",
              border:     "1px solid var(--border)",
              color:      "var(--text-primary)",
            }}
          />
        </div>

        {/* Row 2：分類 chip（多選） */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {Object.keys(CATEGORY_KEYWORDS).map(cat => {
            const active = activeCategories.includes(cat);
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className="px-2 py-0.5 rounded text-[10px] font-medium transition-all"
                style={{
                  background:  active ? "rgba(59,130,246,0.18)" : "var(--bg-elevated)",
                  color:       active ? "#60A5FA"               : "var(--text-tertiary)",
                  border:      `1px solid ${active ? "rgba(59,130,246,0.4)" : "var(--border)"}`,
                }}
              >
                {cat}
              </button>
            );
          })}
          {activeCategories.length > 0 && (
            <button
              onClick={() => setActiveCategories([])}
              className="px-1.5 py-0.5 text-[10px] rounded transition-opacity"
              style={{ color: "var(--text-tertiary)", opacity: 0.6 }}
            >
              清除
            </button>
          )}
        </div>
      </div>

      {/* ── 新聞列表 ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">

        {loading && (
          <div className="flex items-center justify-center h-32">
            <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>載入新聞中…</span>
          </div>
        )}

        {error && !loading && (
          <div className="flex items-center justify-center h-32">
            <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>新聞暫時無法取得</span>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-1 opacity-50">
            <span className="text-2xl">📭</span>
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {news.length === 0 ? "暫無相關新聞" : "無符合篩選條件的新聞"}
            </span>
          </div>
        )}

        {!loading && !error && filtered.map((item, i) => (
          <a
            key={i}
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex gap-3 px-4 py-3 hover:opacity-80 transition-opacity"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            {/* 重要度色點 */}
            <div className="shrink-0 pt-1">
              <div
                className="w-1.5 h-1.5 rounded-full mt-0.5"
                style={{
                  background:
                    item.importance === "高" ? "var(--color-down)"
                    : item.importance === "中" ? "#F59E0B"
                    : "var(--text-tertiary)",
                  opacity: item.importance === "低" ? 0.4 : 1,
                }}
              />
            </div>

            {/* 縮圖 */}
            {item.thumbnail && (
              <img
                src={item.thumbnail}
                alt=""
                className="w-16 h-12 object-cover rounded shrink-0"
                style={{ background: "var(--bg-elevated)" }}
                loading="lazy"
              />
            )}

            {/* 內容 */}
            <div className="flex-1 min-w-0">
              <p
                className="text-sm font-medium leading-snug line-clamp-2"
                style={{ color: "var(--text-primary)" }}
              >
                {item.title}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  {item.publisher}
                </span>
                <span style={{ color: "var(--border)" }}>·</span>
                <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                  {relativeTime(item.published_at)}
                </span>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
