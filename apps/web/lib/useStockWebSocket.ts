"use client";

/**
 * useStockWebSocket — 即時行情 WebSocket hook
 *
 * 用法：
 *   const { quotes, connected, stale } = useStockWebSocket(["2330", "2317"]);
 *
 * - connected: WebSocket 已連線
 * - stale:     TWSE circuit breaker 開路，資料可能延遲
 * - quotes:    Record<string, Quote>（隨推送增量更新）
 *
 * 斷線自動重連（指數退避，最多 10 次）。
 * symbols 陣列內容改變時自動重連。
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { Quote } from "@/lib/api";

const WS_BASE = (() => {
  const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  // http → ws, https → wss
  return base.replace(/^http/, "ws");
})();

const BASE_RECONNECT_MS = 2_000;
const MAX_RECONNECT     = 10;

interface WsMessage {
  type: "quotes" | "ping" | "stale" | "error";
  data?: Record<string, Quote>;
  msg?: string;
}

export function useStockWebSocket(symbols: string[]) {
  const [quotes, setQuotes]       = useState<Record<string, Quote>>({});
  const [connected, setConnected] = useState(false);
  const [stale, setStale]         = useState(false);

  const wsRef        = useRef<WebSocket | null>(null);
  const retryCount   = useRef(0);
  const retryTimer   = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mountedRef   = useRef(true);
  const symbolsRef   = useRef<string[]>(symbols);
  const symsKeyRef   = useRef(symbols.join(","));
  // connectRef 讓 onclose 可以遞迴排程重連，避免 const TDZ lint error
  const connectRef   = useRef<() => void>(() => {});

  // 始終保持 symbolsRef 最新
  useEffect(() => { symbolsRef.current = symbols; }, [symbols]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    const syms = symbolsRef.current;
    if (syms.length === 0) return;

    const url = `${WS_BASE}/ws/quotes?symbols=${syms.join(",")}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        setConnected(true);
        setStale(false);
        retryCount.current = 0;
      };

      ws.onmessage = (ev: MessageEvent<string>) => {
        if (!mountedRef.current) return;
        try {
          const msg = JSON.parse(ev.data) as WsMessage;
          switch (msg.type) {
            case "quotes":
              if (msg.data) setQuotes(prev => ({ ...prev, ...msg.data }));
              setStale(false);
              break;
            case "stale":
              setStale(true);
              break;
            case "error":
              // 靜默記錄，不影響 UI
              break;
            // "ping" — 忽略
          }
        } catch {
          // 忽略 JSON 解析錯誤
        }
      };

      ws.onerror = () => {
        // onclose 會跟著觸發，在那裡處理重連
        ws.close();
      };

      ws.onclose = () => {
        setConnected(false);
        if (!mountedRef.current) return;
        if (retryCount.current < MAX_RECONNECT) {
          const delay = BASE_RECONNECT_MS * Math.min(2 ** retryCount.current, 16);
          retryCount.current++;
          retryTimer.current = setTimeout(() => connectRef.current(), delay);
        }
      };
    } catch {
      // WebSocket 不支援（SSR 等），靜默失敗
    }
  }, []);  // connect 本身不依賴外部變數（透過 ref 讀取）

  // connectRef 始終指向最新的 connect（deps=[] 所以 connect 是穩定的）
  useEffect(() => { connectRef.current = connect; }, [connect]);

  // 初始化
  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearTimeout(retryTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // symbols 改變時重連（只在內容真正不同時觸發）
  useEffect(() => {
    const key = symbols.join(",");
    if (key === symsKeyRef.current) return;
    symsKeyRef.current = key;
    clearTimeout(retryTimer.current);
    retryCount.current = 0;
    wsRef.current?.close();  // 觸發 onclose → 自動用新 symbols 重連
  }, [symbols]);

  return { quotes, connected, stale };
}
