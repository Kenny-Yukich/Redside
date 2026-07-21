// sw.js — offline support. Cache the app shell so Redside opens with no signal;
// let live-data requests (USGS, Open-Meteo) go to the network and fail gracefully
// (the app falls back to its own localStorage cache).

const CACHE = "redside-v1";
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
  const url = new URL(e.request.url);
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
        if (res.ok && (url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com/.test(url.host))) {
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit)
    )
  );
});
