"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

/**
 * Client 端 SessionProvider 包裝器
 * 在 layout.tsx（Server Component）中嵌套此元件，提供 useSession() 給整個應用。
 */
export default function SessionProviderWrapper({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  return <SessionProvider session={session}>{children}</SessionProvider>;
}
