const CACHE_VERSION = "20260801-1640";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).then((response) => {
        const headers = new Headers(response.headers);
        headers.set("x-sw-version", CACHE_VERSION);
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      }),
    );
    return;
  }
  event.respondWith(fetch(event.request));
});