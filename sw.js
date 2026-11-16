const CACHE = "jh-offline-v3";

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.add("/offline.html"))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET" || request.mode !== "navigate") return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
});
