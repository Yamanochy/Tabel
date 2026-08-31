// ============================================================
// SERVICE WORKER — та же схема, что и в Досатуй: пробуем сеть первой
// (всегда самая свежая версия), и только если сети совсем нет —
// отдаём то, что сохранено (офлайн-режим).
// ============================================================

const VERSION = "tabel-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./equipment.js",
  "./drivers.js",
  "./shifts.js",
  "./advances.js",
  "./dosatuy-ref.js",
  "./offline-queue.js",
  "./auth.js",
  "./firebase-config.js",
  "./cloud-config.js",
  "./access-config.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "https://cdn.tailwindcss.com",
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js",
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((cache) =>
      Promise.all(
        ASSETS.map((url) => {
          const isCrossOrigin = !url.startsWith(self.location.origin) && url.startsWith("http");
          return fetch(url, isCrossOrigin ? { mode: "no-cors" } : {})
            .then((resp) => cache.put(url, resp))
            .catch(() => {});
        })
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp && resp.ok && e.request.url.startsWith(self.location.origin)) {
          const clone = resp.clone();
          caches.open(VERSION).then((cache) => cache.put(e.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
