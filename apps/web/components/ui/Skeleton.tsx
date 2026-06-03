/**
 * Reusable skeleton loading components.
 * All use CSS animate-pulse via Tailwind.
 */

/** Single pulsing bar */
function Bar({ w = "100%", h = "12px", radius = "4px" }: { w?: string; h?: string; radius?: string }) {
  return (
    <div
      className="animate-pulse shrink-0"
      style={{
        width: w,
        height: h,
        borderRadius: radius,
        background: "var(--bg-elevated)",
      }}
    />
  );
}

/** Full-height chart area skeleton — fake OHLC bars rising from bottom */
export function ChartSkeleton() {
  const bars = [55, 80, 65, 90, 72, 40, 85, 60, 75, 50, 88, 63, 70, 45, 95, 68, 78, 52, 84, 58];
  return (
    <div className="absolute inset-0 flex flex-col" style={{ background: "var(--bg-surface)" }}>
      {/* fake price line area */}
      <div className="flex-1 flex items-end gap-[3px] px-4 pb-6 pt-8 opacity-30">
        {bars.map((h, i) => (
          <div
            key={i}
            className="animate-pulse flex-1 rounded-sm"
            style={{
              height: `${h}%`,
              background: i % 3 === 0 ? "var(--color-down)" : "var(--color-up)",
              animationDelay: `${i * 60}ms`,
            }}
          />
        ))}
      </div>
      {/* fake volume bars */}
      <div className="flex items-end gap-[3px] px-4 pb-2 opacity-20" style={{ height: "20%" }}>
        {bars.map((h, i) => (
          <div
            key={i}
            className="animate-pulse flex-1 rounded-sm"
            style={{
              height: `${Math.round(h * 0.5)}%`,
              background: "var(--text-tertiary)",
              animationDelay: `${i * 60}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Dashboard skeleton — breadth card + 2 column cards */
export function DashboardSkeleton() {
  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-4">
      {/* breadth row */}
      <div
        className="rounded-lg p-4 flex gap-4"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
      >
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex-1 flex flex-col gap-2">
            <Bar h="10px" w="60%" />
            <Bar h="22px" w="80%" />
          </div>
        ))}
      </div>
      {/* sector heatmap */}
      <div
        className="rounded-lg p-4"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
      >
        <Bar h="12px" w="120px" />
        <div className="mt-3 grid grid-cols-4 gap-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded" style={{ height: "48px", background: "var(--bg-surface)", animationDelay: `${i * 40}ms` }} />
          ))}
        </div>
      </div>
      {/* two column cards */}
      <div className="grid grid-cols-2 gap-4">
        {[0, 1].map((col) => (
          <div key={col} className="rounded-lg p-4 flex flex-col gap-3"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
            <Bar h="12px" w="100px" />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex justify-between">
                <Bar w="40%" h="10px" />
                <Bar w="25%" h="10px" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** News list skeleton */
export function NewsListSkeleton() {
  return (
    <div className="p-4 flex flex-col gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg p-3 flex gap-3"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        >
          {/* thumbnail placeholder */}
          <div
            className="animate-pulse shrink-0 rounded"
            style={{ width: "72px", height: "56px", background: "var(--bg-surface)", animationDelay: `${i * 80}ms` }}
          />
          <div className="flex-1 flex flex-col gap-2 justify-center">
            <Bar h="11px" w="90%" />
            <Bar h="11px" w="70%" />
            <Bar h="9px" w="40%" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Table rows skeleton — for screener */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  const cols = [15, 12, 10, 10, 10, 10, 10, 10];
  return (
    <div className="p-4 flex flex-col gap-0">
      {/* header */}
      <div className="flex gap-2 px-2 pb-2 border-b" style={{ borderColor: "var(--border)" }}>
        {cols.map((w, i) => (
          <Bar key={i} h="10px" w={`${w}%`} />
        ))}
      </div>
      {/* rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-2 px-2 py-2.5 border-b" style={{ borderColor: "var(--border)" }}>
          {cols.map((w, i) => (
            <div key={i} className="animate-pulse rounded" style={{ width: `${w}%`, height: "10px", background: "var(--bg-elevated)", animationDelay: `${(r * cols.length + i) * 20}ms` }} />
          ))}
        </div>
      ))}
    </div>
  );
}
