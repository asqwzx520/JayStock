"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { alertsApi, type AlertNotification } from "@/lib/api";

const POLL_INTERVAL = 60_000; // 每 60 秒 poll 一次

export default function AlertsToast() {
  const [alerts, setAlerts]     = useState<AlertNotification[]>([]);
  const [visible, setVisible]   = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await alertsApi.getUnread();
      if (res.notifications.length > 0) {
        setAlerts(res.notifications);
        setVisible(true);
      }
    } catch {
      // 靜默失敗
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    timerRef.current = setInterval(fetchAlerts, POLL_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [fetchAlerts]);

  async function dismissOne(id: string) {
    await alertsApi.markRead(id);
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    if (alerts.length <= 1) setVisible(false);
  }

  async function dismissAll() {
    await alertsApi.markAllRead();
    setAlerts([]);
    setVisible(false);
  }

  if (!visible || alerts.length === 0) return null;

  return (
    <div
      className="fixed bottom-20 right-4 z-50 flex flex-col gap-2 max-w-xs"
      role="region"
      aria-label="價格提醒通知"
    >
      {/* 全部已讀按鈕（多筆時顯示）*/}
      {alerts.length > 1 && (
        <button
          onClick={dismissAll}
          className="self-end text-xs px-2 py-1 rounded"
          style={{
            background: "var(--bg-elevated)",
            color:      "var(--text-secondary)",
            border:     "1px solid var(--border)",
          }}
        >
          全部清除 ({alerts.length})
        </button>
      )}

      {alerts.map((alert) => {
        const isAbove = alert.alert_type === "above";
        const color   = isAbove ? "var(--color-up)" : "var(--color-down)";
        const arrow   = isAbove ? "▲" : "▼";
        const label   = isAbove ? "突破" : "跌破";

        return (
          <div
            key={alert.id}
            className="flex items-start gap-3 p-3 rounded-lg shadow-lg"
            style={{
              background: "var(--bg-surface)",
              border:     `1px solid ${color}44`,
            }}
          >
            {/* 圖示 */}
            <span className="text-lg mt-0.5" style={{ color }}>
              {arrow}
            </span>

            {/* 內容 */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {alert.symbol} {label}提醒
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                設定價 <span className="num" style={{ color }}>{alert.threshold}</span>
                　現價 <span className="num" style={{ color: "var(--text-primary)" }}>{alert.price}</span>
              </p>
            </div>

            {/* 關閉按鈕 */}
            <button
              onClick={() => dismissOne(alert.id)}
              className="text-lg leading-none shrink-0 opacity-50 hover:opacity-100"
              style={{ color: "var(--text-secondary)" }}
              aria-label="關閉"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
