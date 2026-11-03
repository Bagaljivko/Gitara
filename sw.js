// Rad bez interneta: cela aplikacija se čuva u kešu i služi iz njega (uvek ista, usklađena verzija).
// Nova verzija = novi broj u CACHE (scripts/update-sw.mjs). Aplikacija tada prikaže „Osveži“.
const CACHE = "gitara-v25";
const SHELL = [
  "./",
  "index.html",
  "privacy.html",
  "manifest.webmanifest",
  "src/audio.js",
  "src/chordrec.js",
  "src/chords.js",
  "src/collections.js",
  "src/db.js",
  "src/diagram.js",
  "src/drive.js",
  "src/gemini.js",
  "src/headstockKnobs.js",
  "src/i18n.js",
  "src/install.js",
  "src/lzstring.js",
  "src/main.js",
  "src/music.js",
  "src/pdf.js",
  "src/pitchtrack.js",
  "src/rhythm.js",
  "src/rhythmView.js",
  "src/setlistsView.js",
  "src/settingsView.js",
  "src/sharelink.js",
  "src/songformat.js",
  "src/songs.js",
  "src/styles.css",
  "src/suggest.js",
  "src/synth.js",
  "src/tabs.js",
  "src/tuner.js",
  "src/ui.js",
  "src/version.js",
  "src/wakelock.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-192.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "assets/headstock.webp"
];
// Retko korišćeni veliki fajlovi (PDF): preuzimaju se u pozadini, posle instalacije, da ne usporavaju prvo otvaranje.
const LAZY = ["vendor/jspdf.umd.min.js", "fonts/DejaVuSansMono.ttf", "fonts/DejaVuSansMono-Bold.ttf"];
const fresh = (u) => new Request(u, { cache: "reload" }); // zaobiđi HTTP keš da se verzije ne pomešaju

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL.map(fresh));
    // Prvo instaliranje, ili prelaz sa starih verzija (≤ v24, bez dugmeta „Osveži“): aktiviraj odmah.
    const legacy = (await caches.keys()).some(k => { const m = /^gitara-v(\d+)$/.exec(k); return m && +m[1] <= 24; });
    if (!self.registration.active || legacy) self.skipWaiting();
  })());
});
self.addEventListener("message", e => { if (e.data === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const c = await caches.open(CACHE);
    // PDF fajlovi: prenesi iz starog keša ako postoje, ostalo preuzmi u pozadini
    for (const u of LAZY) {
      if (await c.match(u)) continue;
      for (const k of keys) { if (k === CACHE) continue; const r = await (await caches.open(k)).match(u); if (r) { await c.put(u, r); break; } }
    }
    await Promise.all(keys.filter(k => k.startsWith("gitara-") && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    Promise.all(LAZY.map(async u => { if (!(await c.match(u))) await c.add(fresh(u)); })).catch(() => {});
  })());
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // npr. Gemini API ide direktno na mrežu
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Navigacija na samu aplikaciju → keširana početna strana; ostale stranice (npr. privacy.html) → svoj fajl
    const isPage = e.request.mode === "navigate" && !/\/privacy\.html$/.test(url.pathname);
    const cached = await cache.match(isPage ? "./" : e.request, { ignoreSearch: isPage });
    if (cached) return cached;
    try {
      const res = await fetch(e.request);
      if (res && res.ok && LAZY.some(u => url.pathname.endsWith("/" + u))) cache.put(e.request, res.clone());
      return res;
    } catch (err) {
      if (e.request.mode === "navigate") { const home = await cache.match("./"); if (home) return home; }
      throw err;
    }
  })());
});
