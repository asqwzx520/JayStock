/**
 * Dashboard layout — 完整交易平台，繼承 root layout 的 h-full overflow-hidden
 * （Landing page 在 / 路由，不套用此 layout）
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
