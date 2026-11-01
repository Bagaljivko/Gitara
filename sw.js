// Rad bez interneta: čuva celu aplikaciju u kešu i osvežava je u pozadini.
// Pri svakoj novoj verziji aplikacije povećaj broj u CACHE.
const CACHE = "gitara-v3";
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "src/audio.js",
  "src/chordrec.js",
  "src/chords.js",
  "src/db.js",
  "src/diagram.js",
  "src/gemini.js",
  "src/main.js",
  "src/music.js",
  "src/pdf.js",
  "src/settingsView.js",
  "src/songformat.js",
  "src/songs.js",
  "src/styles.css",
  "src/tuner.js",
  "src/ui.js",
  "src/version.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-192.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "vendor/jspdf.umd.min.js",
  "fonts/DejaVuSansMono.ttf",
  "fonts/DejaVuSansMono-Bold.ttf"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("gitara-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).origin !== self.location.origin) return; // npr. Gemini API ide direktno na mrežu
  e.respondWith(caches.open(CACHE).then(async cache => {
    const isPage = e.request.mode === "navigate";
    const cached = await cache.match(isPage ? "./" : e.request, { ignoreSearch: isPage });
    const network = fetch(e.request).then(res => {
      if (res && res.ok) cache.put(isPage ? "./" : e.request, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
