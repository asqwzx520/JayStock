"use client";

import { useCallback, useEffect, useState } from "react";
import { getStockNews, type NewsItem } from "@/lib/api";

interface StockNewsProps {
  symbol: string;
}

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
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
}

export default function StockNews({ symbol }: StockNewsProps) {
  const [news, setNews]     = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(false);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>載入新聞中…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-32">
        <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>新聞暫時無法取得</span>
      </div>
    );
  }

  if (news.length === 0) {
    return (
      <div className="flex items-center justify-center h-32">
        <span className="text-sm" style={{ color: "var(--text-tertiary)" }}>暫無相關新聞</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-y-auto h-full">
      {news.map((item, i) => (
        <a
          key={i}
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex gap-3 px-4 py-3 hover:opacity-80 transition-opacity"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          {/* Thumbnail */}
          {item.thumbnail && (
            <img
              src={item.thumbnail}
              alt=""
              className="w-16 h-12 object-cover rounded shrink-0"
              style={{ background: "var(--bg-elevated)" }}
              loading="lazy"
            />
          )}

          {/* Content */}
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
  );
}
