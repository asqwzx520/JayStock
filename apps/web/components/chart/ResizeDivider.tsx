"use client";

interface ResizeDividerProps {
  onDrag: (deltaY: number) => void;
}

export default function ResizeDivider({ onDrag }: ResizeDividerProps) {
  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    let lastY = startY;

    function onMove(ev: MouseEvent) {
      const delta = ev.clientY - lastY;
      lastY = ev.clientY;
      onDrag(delta);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      className="shrink-0 flex items-center justify-center select-none"
      style={{
        height:     "5px",
        cursor:     "row-resize",
        background: "var(--border)",
        position:   "relative",
        zIndex:     5,
      }}
    >
      {/* 視覺提示：三條橫紋 */}
      <div className="flex flex-col gap-[2px] pointer-events-none">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{ width: "24px", height: "1px", background: "var(--text-tertiary)", opacity: 0.5 }}
          />
        ))}
      </div>
    </div>
  );
}
