/**
 * JayStock Service Worker — Web Push Notification
 *
 * 負責接收後端透過 VAPID 發送的 push 事件，
 * 顯示系統通知，點擊後跳轉至對應股票頁面。
 */

const CACHE_VERSION = "jaystock-v1";

// ── Push 事件：接收並顯示通知 ─────────────────────────────────────────────────
self.addEventListener("push", function (event) {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "JayStock", body: event.data ? event.data.text() : "" };
  }

  const title   = data.title || "JayStock 提醒";
  const options = {
    body:               data.body    || "",
    icon:               "/next.svg",
    badge:              "/next.svg",
    tag:                data.tag     || "jaystock-alert",
    data:               { url: data.url || "/" },
    requireInteraction: false,
    silent:             false,
    vibrate:            [200, 100, 200],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── Notification Click：聚焦既有分頁或開新分頁 ────────────────────────────────
self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        // 尋找已開啟的 JayStock 分頁
        for (const client of clientList) {
          if ("focus" in client) {
            // 已有分頁，導航並聚焦
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        // 沒有已開啟的分頁，開新分頁
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

// ── Install / Activate：立即接管頁面（跳過等待）────────────────────────────────
self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    // 清理舊版 cache
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION)
          .map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});
