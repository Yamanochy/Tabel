// ============================================================
// SERVICE WORKER — офлайн-кэш приложения.
// ============================================================

const VERSION = "tabel-v2";

// Свои файлы — без них приложение офлайн не запустится вообще.
// Если хоть один не скачался, установка ДОЛЖНА провалиться, чтобы
// не затереть предыдущий рабочий кэш (одно неудачное обновление на
// плохой связи иначе ломает офлайн-режим насовсем).
const CORE_ASSETS = [
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
];

// Внешние библиотеки — тоже нужны офлайн, но если какая-то разово не
// скачалась, рушить установку из-за неё не стоит.
const CDN_ASSETS = [
  "https://cdn.tailwindcss.com",
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js",
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    for (const url of CORE_ASSETS) {
      const resp = await fetch(url, { cache: "reload" });
      if (!resp || !resp.ok) throw new Error("Не скачался " + url);
      await cache.put(url, resp);
    }
    await Promise.all(CDN_ASSETS.map((url) =>
      fetch(url, { mode: "no-cors" }).then((r) => cache.put(url, r)).catch(() => {})
    ));
  })());
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

// сеть, но с таймаутом: если связь формально есть, а данные не идут,
// не ждём бесконечно, а отдаём сохранённую копию
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(request).then((resp) => { clearTimeout(timer); resolve(resp); },
                        (err) => { clearTimeout(timer); reject(err); });
  });
}

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const isOwnFile = url.origin === self.location.origin;

  // запросы к базе и облаку не трогаем — Firebase сам умеет офлайн
  if (!isOwnFile && !CDN_ASSETS.some((a) => e.request.url.startsWith(a.split("?")[0]))) return;

  e.respondWith((async () => {
    try {
      const resp = await fetchWithTimeout(e.request, 3000);
      if (resp && resp.ok && isOwnFile) {
        const clone = resp.clone();
        caches.open(VERSION).then((cache) => cache.put(e.request, clone));
      }
      return resp;
    } catch (err) {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      if (e.request.mode === "navigate") {
        const fallback = await caches.match("./index.html");
        if (fallback) return fallback;
      }
      return new Response("Нет сети и нет сохранённой копии", { status: 503, statusText: "Offline" });
    }
  })());
});
