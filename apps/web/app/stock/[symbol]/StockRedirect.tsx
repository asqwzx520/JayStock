"use client";

/**
 * StockRedirect — Client Component
 * 把 symbol 存入 sessionStorage，然後導回首頁。
 * 首頁的 Home component 啟動時讀取這個值並自動選取該股票。
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function StockRedirect({ symbol }: { symbol: string }) {
  const router = useRouter();

  useEffect(() => {
    // 告知主 SPA 要顯示哪支股票
    sessionStorage.setItem("stockpulse_init_symbol", symbol.toUpperCase());
    router.replace("/");
  }, [symbol, router]);

  return null;
}
