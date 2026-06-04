"use client";
import type { DrawingTool } from "./KLineChart";

const TOOLS: { id: DrawingTool; icon: string; title: string }[] = [
  { id: "cursor",    icon: "↖",  title: "游標（正常拖曳）" },
  { id: "hline",     icon: "—",  title: "水平線（支撐/壓力）" },
  { id: "trendline", icon: "╱",  title: "趨勢線（拖曳畫線）" },
  { id: "erase",     icon: "⌫",  title: "刪除（點選線段）" },
];

interface Props {
  active: DrawingTool;
  onChange: (t: DrawingTool) => void;
  onClearAll: () => void;
}

export default function DrawingToolbar({ active, onChange, onClearAll }: Props) {
  return (
    <div className="flex items-center gap-0.5 rounded p-0.5" style={{ background: "var(--bg-elevated)" }}>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          title={t.title}
          className="px-2 h-6 flex items-center justify-center rounded text-xs font-medium transition-colors"
          style={{
            background: active === t.id ? "var(--color-brand)" : "transparent",
            color:      active === t.id ? "#fff" : "var(--text-secondary)",
          }}
        >
          {t.icon}
        </button>
      ))}
      <div className="w-px h-3.5 mx-0.5 shrink-0" style={{ background: "var(--border)" }} />
      <button
        onClick={onClearAll}
        title="清除全部線段"
        className="px-2 h-6 flex items-center justify-center rounded text-xs transition-colors"
        style={{ color: "var(--text-tertiary)" }}
      >
        清
      </button>
    </div>
  );
}
