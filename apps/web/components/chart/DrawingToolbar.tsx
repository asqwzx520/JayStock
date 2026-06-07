"use client";
import type { DrawingTool } from "./KLineChart";

const TOOLS: { id: DrawingTool; icon: string; title: string }[] = [
  { id: "cursor",    icon: "↖",  title: "游標（正常拖曳）" },
  { id: "hline",     icon: "—",  title: "水平線（支撐/壓力）" },
  { id: "trendline", icon: "╱",  title: "趨勢線（拖曳畫線）" },
  { id: "fibonacci", icon: "φ",  title: "Fibonacci 回撤（拖曳定範圍）" },
  { id: "rectangle", icon: "□",  title: "矩形框選（拖曳畫框）" },
  { id: "text",      icon: "T",  title: "文字標籤（點擊輸入）" },
  { id: "channel",   icon: "∥",  title: "平行通道（拖曳基準線，再點選寬度）" },
  { id: "erase",     icon: "⌫",  title: "刪除（點選線段）" },
];

// Group separators: insert divider before "erase"
const DIVIDER_BEFORE: DrawingTool[] = ["fibonacci", "erase"];

interface Props {
  active:         DrawingTool;
  onChange:       (t: DrawingTool) => void;
  onClearAll:     () => void;
  onAlertClick?:  () => void;
}

export default function DrawingToolbar({ active, onChange, onClearAll, onAlertClick }: Props) {
  return (
    <div className="flex items-center gap-0.5 rounded p-0.5" style={{ background: "var(--bg-elevated)" }}>
      {TOOLS.map((t) => (
        <span key={t.id} className="flex items-center">
          {DIVIDER_BEFORE.includes(t.id) && (
            <span className="w-px h-3.5 mx-0.5 shrink-0" style={{ background: "var(--border)" }} />
          )}
          <button
            onClick={() => onChange(t.id)}
            title={t.title}
            className="px-2 h-6 flex items-center justify-center rounded text-xs font-medium transition-colors"
            style={{
              background: active === t.id ? "var(--color-brand)" : "transparent",
              color:      active === t.id ? "#fff" : "var(--text-secondary)",
              minWidth:   24,
            }}
          >
            {t.icon}
          </button>
        </span>
      ))}
      <span className="w-px h-3.5 mx-0.5 shrink-0" style={{ background: "var(--border)" }} />
      <button
        onClick={onClearAll}
        title="清除全部線段"
        className="px-2 h-6 flex items-center justify-center rounded text-xs transition-colors"
        style={{ color: "var(--text-tertiary)" }}
      >
        清
      </button>
      {/* 警報設定按鈕 */}
      {onAlertClick && (
        <>
          <span className="w-px h-3.5 mx-0.5 shrink-0" style={{ background: "var(--border)" }} />
          <button
            onClick={onAlertClick}
            title="設定技術指標警示"
            className="px-2 h-6 flex items-center justify-center rounded text-xs transition-colors"
            style={{ color: "var(--text-secondary)" }}
          >
            🔔
          </button>
        </>
      )}
    </div>
  );
}
