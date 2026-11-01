const CACHE = "ash-chat-static-v1";
const STATIC_PATHS = ["/", "/index.html", "/styles.css", "/favicon.svg", "/manifest.webmanifest", "/src/app.js", "/src/api-client.js", "/src/auth.js", "/src/chat-state.js", "/src/markdown.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC_PATHS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});
