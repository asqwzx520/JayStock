"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
const SW_PATH  = "/sw.js";

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

export interface UsePushNotificationReturn {
  isSupported:  boolean;
  permission:   PushPermission;
  isSubscribed: boolean;
  isLoading:    boolean;
  subscribe:    (userId: string) => Promise<boolean>;
  unsubscribe:  (userId: string) => Promise<boolean>;
}

/** base64url → Uint8Array（VAPID 公鑰格式轉換）*/
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw     = window.atob(base64);
  const output  = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

async function getVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/push/vapid-public-key`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.enabled ? data.public_key : null;
  } catch {
    return null;
  }
}

async function saveSubscriptionToServer(
  userId: string,
  sub: PushSubscription
): Promise<boolean> {
  const json = sub.toJSON();
  const keys = json.keys as { p256dh?: string; auth?: string } | undefined;
  if (!keys?.p256dh || !keys?.auth) return false;

  try {
    const res = await fetch(`${API_BASE}/api/v1/push/subscribe`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-ID":    userId,
      },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        p256dh:   keys.p256dh,
        auth:     keys.auth,
      }),
    });
    if (!res.ok && res.status !== 201) {
      const body = await res.text().catch(() => "");
      console.error("[push] 後端 /push/subscribe 回傳", res.status, body);
    }
    return res.ok || res.status === 201;
  } catch (e) {
    console.error("[push] fetch /push/subscribe 例外:", e);
    return false;
  }
}

async function deleteSubscriptionFromServer(
  userId: string,
  endpoint: string
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/push/subscribe`, {
      method:  "DELETE",
      headers: {
        "Content-Type": "application/json",
        "X-User-ID":    userId,
      },
      body: JSON.stringify({ endpoint }),
    });
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

export function usePushNotification(): UsePushNotificationReturn {
  const [isSupported,  setIsSupported]  = useState(false);
  const [permission,   setPermission]   = useState<PushPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading,    setIsLoading]    = useState(false);

  // Cache SW registration to avoid re-querying
  const swRegRef = useRef<ServiceWorkerRegistration | null>(null);

  // ── 初始化：檢查支援度 + 現有訂閱狀態 ────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setIsSupported(false);
      setPermission("unsupported");
      return;
    }

    setIsSupported(true);
    setPermission(Notification.permission as PushPermission);

    // 非同步檢查是否已有訂閱
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
        if (!reg) return;
        swRegRef.current = reg;
        const sub = await reg.pushManager.getSubscription();
        setIsSubscribed(!!sub);
      } catch {
        // Ignore
      }
    })();
  }, []);

  // ── 訂閱 ──────────────────────────────────────────────────────────────────
  const subscribe = useCallback(async (userId: string): Promise<boolean> => {
    if (!isSupported || isLoading) return false;
    setIsLoading(true);

    try {
      // 1. 取得 VAPID 公鑰
      console.log("[push] step1: 取得 VAPID 公鑰...");
      const vapidKey = await getVapidPublicKey();
      console.log("[push] step1 結果:", vapidKey ? `公鑰長度 ${vapidKey.length}` : "null（未啟用）");
      if (!vapidKey) {
        throw new Error("VAPID_NOT_READY");
      }

      // 2. 請求通知權限
      console.log("[push] step2: 請求通知權限...");
      const perm = await Notification.requestPermission();
      console.log("[push] step2 結果:", perm);
      setPermission(perm as PushPermission);
      if (perm !== "granted") return false;

      // 3. 註冊 Service Worker
      console.log("[push] step3: 註冊 Service Worker...");
      let reg = swRegRef.current;
      if (!reg) {
        reg = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
        await navigator.serviceWorker.ready;
        swRegRef.current = reg;
      }
      console.log("[push] step3 完成, scope:", reg.scope);

      // 4. 建立 Push 訂閱
      console.log("[push] step4: pushManager.subscribe...");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as ArrayBuffer,
      });
      console.log("[push] step4 完成, endpoint:", sub.endpoint.slice(-30));

      // 5. 送後端儲存
      console.log("[push] step5: 儲存訂閱到後端, userId:", userId.slice(0, 8));
      const ok = await saveSubscriptionToServer(userId, sub);
      console.log("[push] step5 結果:", ok ? "成功" : "失敗（後端回傳非 2xx）");
      if (ok) {
        setIsSubscribed(true);
        return true;
      } else {
        await sub.unsubscribe();
        return false;
      }
    } catch (err) {
      if (err instanceof Error && err.message === "VAPID_NOT_READY") {
        throw err;
      }
      console.error("[push] 訂閱失敗（step 詳情看上方）:", err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, isLoading]);

  // ── 取消訂閱 ──────────────────────────────────────────────────────────────
  const unsubscribe = useCallback(async (userId: string): Promise<boolean> => {
    if (!isSupported || isLoading) return false;
    setIsLoading(true);

    try {
      const reg = swRegRef.current ?? await navigator.serviceWorker.getRegistration(SW_PATH);
      if (!reg) return false;

      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setIsSubscribed(false);
        return true;
      }

      // 先通知後端刪除
      await deleteSubscriptionFromServer(userId, sub.endpoint);
      // 再取消瀏覽器端訂閱
      await sub.unsubscribe();
      setIsSubscribed(false);
      return true;
    } catch (err) {
      console.error("[push] 取消訂閱失敗:", err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, isLoading]);

  return { isSupported, permission, isSubscribed, isLoading, subscribe, unsubscribe };
}
