/*
 * OpenSCQ30 Web service worker.
 *
 * Strategy:
 *  - navigations: network first, cached index.html as the offline fallback
 *  - hashed assets and media: cache first, stored on first use
 *  - everything else (cross origin, non GET): untouched
 *
 * The cache name carries a build id that scripts/finalize-sw.mjs stamps in, so a new deploy
 * activates a fresh cache and deletes the old ones.
 */

const CACHE = "openscq30-web-__BUILD_ID__";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const fresh = await fetch(request);
          cache.put("index.html", fresh.clone());
          return fresh;
        } catch {
          const cached = await cache.match("index.html");
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      try {
        const fresh = await fetch(request);
        if (fresh && (fresh.ok || fresh.type === "opaque")) {
          cache.put(request, fresh.clone());
        }
        return fresh;
      } catch {
        return hit ?? Response.error();
      }
    })(),
  );
});
