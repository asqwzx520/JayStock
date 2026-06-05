"use client";

import { useState, useEffect } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TabDef, ViewTab } from "@/hooks/useTabConfig";
import { DEFAULT_TABS } from "@/hooks/useTabConfig";

// ── 單一 Tab 列 ───────────────────────────────────────────────────────────────
function SortableTabRow({
  tab,
  onToggle,
}: {
  tab: TabDef;
  onToggle: (id: ViewTab) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tab.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-3 py-2.5 border-b"
      {...attributes}
    >
      {/* 拖把 */}
      <span
        {...listeners}
        className="cursor-grab active:cursor-grabbing shrink-0"
        style={{ color: "var(--text-tertiary)", fontSize: "14px", lineHeight: 1 }}
        title="拖曳排序"
      >
        ⠿
      </span>

      {/* Tab 名稱 */}
      <span
        className="flex-1 text-sm font-medium"
        style={{ color: tab.visible ? "var(--text-primary)" : "var(--text-tertiary)" }}
      >
        {tab.label}
      </span>

      {/* 顯示/隱藏 toggle */}
      <button
        onClick={() => onToggle(tab.id)}
        title={tab.visible ? "點擊隱藏" : "點擊顯示"}
        className="shrink-0 w-8 h-8 flex items-center justify-center transition-colors"
        style={{
          color: tab.visible ? "var(--color-brand)" : "var(--text-tertiary)",
          background: "transparent",
          border: "none",
          borderRadius: "var(--radius-sm)",
          fontSize: "14px",
        }}
      >
        {tab.visible ? "👁" : "👁‍🗨"}
      </button>
    </div>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────
interface WorkspaceModalProps {
  tabs: TabDef[];
  onSave: (next: TabDef[]) => void;
  onClose: () => void;
}

export default function WorkspaceModal({ tabs, onSave, onClose }: WorkspaceModalProps) {
  const [local, setLocal] = useState<TabDef[]>(tabs);

  useEffect(() => { setLocal(tabs); }, [tabs]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLocal((prev) => {
      const oldIdx = prev.findIndex((t) => t.id === active.id);
      const newIdx = prev.findIndex((t) => t.id === over.id);
      return arrayMove(prev, oldIdx, newIdx);
    });
  }

  function handleToggle(id: ViewTab) {
    setLocal((prev) =>
      prev.map((t) => (t.id === id ? { ...t, visible: !t.visible } : t))
    );
  }

  function handleReset() {
    setLocal(DEFAULT_TABS);
  }

  function handleSave() {
    onSave(local);
    onClose();
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: "var(--bg-overlay)" }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="fixed z-50 flex flex-col"
        style={{
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "340px",
          maxHeight: "80vh",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              自訂工作區
            </div>
            <div className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
              拖曳排序 · 點眼睛圖示顯示 / 隱藏
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center"
            style={{
              color: "var(--text-tertiary)",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              fontSize: "12px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Sortable list */}
        <div
          className="flex-1 overflow-y-auto"
          style={{ borderColor: "var(--border)" }}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={local.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              {local.map((tab) => (
                <SortableTabRow
                  key={tab.id}
                  tab={tab}
                  onToggle={handleToggle}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-4 py-3 border-t shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <button
            onClick={handleReset}
            className="text-xs px-3 py-1.5"
            style={{
              color: "var(--text-tertiary)",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            重設預設
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-sm px-4 py-1.5"
              style={{
                color: "var(--text-secondary)",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="text-sm px-4 py-1.5 font-medium"
              style={{
                color: "#fff",
                background: "var(--color-brand)",
                border: "none",
                borderRadius: "var(--radius-sm)",
              }}
            >
              儲存
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
