// Service worker: lets the installed app run offline.
// On install it saves the game, the physics page and three.js; everything else
// (the results page's 17 MB survival data, etc.) is saved the first time it loads.
// Pages are served from the saved copy at once and refreshed in the background,
// so a new deploy shows up on the next launch. Bump VERSION to force a full refresh.
const VERSION = "falling-cat-20261108-210043";
const THREE = "https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js";
const CORE = [
  "./", "./index.html", "./physics.html", "./results.html", "./manifest.webmanifest",
  "./css/style.css",
  "./js/math3.js", "./js/physics.js", "./js/sim.js", "./js/pilots.js", "./js/narrator.js",
  "./js/render.js", "./js/ui.js", "./js/game.js",
  "./js/models/twoCylinder.js", "./js/models/modelA.js", "./js/models/modelB.js",
  "./js/models/modelC.js", "./js/models/modelD.js",
  "./lab/results/data.js",
  "./icons/icon-192.png", "./icons/icon-512.png",
  THREE,
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate: answer from the cache if we have it, fetch a fresh copy
// in the background (and fall back to the network, then the cache, when offline).
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin && req.url !== THREE) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => hit);
      if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
      return fresh.then((res) => res || new Response("Offline", { status: 503 }));
    })
  );
});
