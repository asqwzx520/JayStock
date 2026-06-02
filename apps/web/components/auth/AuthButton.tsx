"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useEffect } from "react";

/**
 * Google 登入/登出按鈕
 * 登入後自動把 Google 帳號 ID 寫入 localStorage（取代隨機 UUID），
 * 讓 watchlistApi 和 alertsApi 的 X-User-ID 綁定 Google 帳號。
 */
export default function AuthButton() {
  const { data: session, status } = useSession();

  // ── 同步 Google ID 到 localStorage ──────────────────────────────────────
  useEffect(() => {
    if (session?.user?.id) {
      try {
        localStorage.setItem("stockpulse_user_id", session.user.id);
      } catch {}
    }
  }, [session?.user?.id]);

  if (status === "loading") {
    return (
      <div
        className="w-7 h-7 rounded animate-pulse shrink-0"
        style={{ background: "var(--bg-elevated)" }}
      />
    );
  }

  if (session?.user) {
    return (
      <button
        onClick={() => signOut({ callbackUrl: "/" })}
        title={`${session.user.email} · 登出`}
        className="flex items-center justify-center w-7 h-7 rounded shrink-0 overflow-hidden transition-opacity hover:opacity-80"
        style={{ border: "1px solid var(--border)" }}
        aria-label="登出 Google"
      >
        {session.user.image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={session.user.image}
            alt={session.user.name ?? "Avatar"}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="text-xs font-bold" style={{ color: "var(--color-brand)" }}>
            {session.user.name?.[0]?.toUpperCase() ?? "G"}
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={() => signIn("google")}
      title="使用 Google 登入（跨裝置同步自選股）"
      className="flex items-center gap-1 px-2 h-7 text-xs rounded shrink-0 transition-colors hover:opacity-80"
      style={{
        background: "var(--bg-elevated)",
        color: "var(--text-secondary)",
        border: "1px solid var(--border)",
      }}
      aria-label="使用 Google 登入"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
      登入
    </button>
  );
}
