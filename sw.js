// sw.js — offline support. Cache the app shell so Redside opens with no signal;
// let live-data requests (USGS, Open-Meteo) go to the network and fail gracefully
// (the app falls back to its own localStorage cache).

const CACHE = "redside-v6";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./js/app.js",
  "./js/data.js",
  "./js/conditions.js",
  "./js/advisor.js",
  "./js/log.js",
  "./js/spot.js",
  "./js/spot-settings.js",
  "./js/spot-context.js",
  "./js/spot-map.js",
  "./js/spot-queue.js",
  "./js/spot-store.js",
  "./js/spot-media.js",
  "./js/spot-contract.js",
  "./assets/river-cast.jpg",
  "./assets/river-overlook.jpg",
  "./assets/riverside-angler.jpg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  // Worker POSTs (including analysis and advisor) never enter Cache Storage.
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const leaflet = url.origin === "https://cdnjs.cloudflare.com" && /^\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.(js|css)$/.test(url.pathname);
  // Leave Worker traffic and map tiles entirely to the browser/network.
  if (url.origin !== location.origin && !/^(fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.host) && !leaflet) return;
  // Never cache live APIs — always try network, and don't error out offline.
  if (/waterservices\.usgs\.gov|api\.open-meteo\.com|\/api\//.test(url.href)) {
    e.respondWith(fetch(e.request).catch(() => new Response("{}", { headers: { "Content-Type": "application/json" } })));
    return;
  }
  // App shell + fonts: cache-first, fall back to network, then cache the result.
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        if (res.ok && (url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com/.test(url.host) || leaflet)) {
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit || Response.error())
    )
  );
});
