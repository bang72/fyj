const SHELL = "mivo-shell-v2";
const SHELL_URLS = ["/", "/offline", "/manifest.webmanifest", "/mivo-logo.jpg", "/icon-192.jpg", "/icon-512.jpg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== SHELL).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline")));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok && ["style", "script", "image", "font"].includes(request.destination)) {
      const copy = response.clone();
      void caches.open(SHELL).then((cache) => cache.put(request, copy));
    }
    return response;
  })));
});
