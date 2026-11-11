const CACHE = "ash-chat-static-v5";
const STATIC_PATHS = ["/", "/index.html", "/styles.css", "/favicon.svg", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest", "/offline.html", "/src/app.js", "/src/api-client.js", "/src/auth.js", "/src/chat-state.js", "/src/markdown.js", "/src/voice.js", "/src/attachments.js", "/src/send-guard.js", "/runtime-config.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC_PATHS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;
  event.respondWith((async () => {
    try {
      const fresh = await fetch(event.request);
      if (fresh.ok && STATIC_PATHS.includes(url.pathname)) {
        const copy = fresh.clone();
        const cache = await caches.open(CACHE);
        await cache.put(event.request, copy);
      }
      return fresh;
    } catch {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === "navigate") {
        const offline = await caches.match("/offline.html");
        if (offline) return offline;
      }
      return new Response("ASH Chat is offline.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  })());
});
