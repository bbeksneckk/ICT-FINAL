/* Corner Café service worker.
   Network first for every file of this site, so an update is seen straight away;
   the saved copy is used only when the network does not answer.
   Requests to the database (another origin) are never cached. */
const CACHE = "corner-cafe-v1";
const SHELL = [
  "./", "index.html", "screen.html", "poster.html", "test-lab.html", "shelf-simulator.html", "manifest.webmanifest",
  "css/app.css",
  "js/config.js", "js/demo-data.js", "js/domain.js", "js/api.js", "js/charts.js", "js/art.js", "js/qr.js", "js/app.js",
  "js/screen.js", "js/poster.js", "js/lab.js", "js/simulator.js", "js/device-config.js",
  "assets/icons/logo.svg", "assets/icons/app-192.png", "assets/icons/app-512.png",
  "assets/fonts/adventor-bold.woff", "assets/fonts/adventor-regular.woff",
  "assets/fonts/inter-regular.woff", "assets/fonts/inter-medium.woff", "assets/fonts/inter-semibold.woff",
  "assets/images/coffee-480.webp", "assets/images/coffee-960.webp", "assets/images/pastry-480.webp"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // Supabase and anything else: straight to the network
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
      if (hit) return hit;
      if (req.mode === "navigate") { const home = await caches.match("index.html"); if (home) return home; }
      throw err;
    }
  })());
});
