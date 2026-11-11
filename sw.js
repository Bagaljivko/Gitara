// Rad bez interneta: cela aplikacija se čuva u kešu i služi iz njega (uvek ista, usklađena verzija).
// Nova verzija = novi broj u CACHE (scripts/update-sw.mjs). Aplikacija tada prikaže „Osveži“.
const CACHE = "gitara-v143";
const SHELL = [
  "./",
  "index.html",
  "privacy.html",
  "manifest.webmanifest",
  "src/activity.js",
  "src/audio.js",
  "src/backups.js",
  "src/chordCheck.js",
  "src/chordDict.js",
  "src/chordnames.js",
  "src/chordrec.js",
  "src/chords.js",
  "src/collate.js",
  "src/collections.js",
  "src/db.js",
  "src/demo.js",
  "src/diag.js",
  "src/diagram.js",
  "src/drive.js",
  "src/editorDesk.js",
  "src/feedback.js",
  "src/freeplay.css",
  "src/freeplay.js",
  "src/freeplayListen.js",
  "src/freeplayMono.js",
  "src/freeplayPlace.js",
  "src/freeplayText.js",
  "src/gemini.js",
  "src/guitarSamples.js",
  "src/headstockKnobs.js",
  "src/i18n-en.js",
  "src/i18n.js",
  "src/install.js",
  "src/installNudge.js",
  "src/keyWheel.js",
  "src/keys.js",
  "src/ks.js",
  "src/libDesk.js",
  "src/lzstring.js",
  "src/main.js",
  "src/music.js",
  "src/naming.js",
  "src/navAcct.js",
  "src/notify.js",
  "src/pChords.js",
  "src/pEar.js",
  "src/pHunter.js",
  "src/pRhythm.js",
  "src/pScales.js",
  "src/pSong.js",
  "src/pSpider.js",
  "src/pTab.js",
  "src/pdf.js",
  "src/pdfQueue.js",
  "src/pdfTab.js",
  "src/pitchtrack.js",
  "src/plan.js",
  "src/planView.js",
  "src/playAlong.js",
  "src/practice.css",
  "src/practice.js",
  "src/practiceBoard.js",
  "src/practiceCommon.js",
  "src/practiceListen.js",
  "src/practicePitch.js",
  "src/practiceText.js",
  "src/practiceTrack.js",
  "src/progress.js",
  "src/qr.js",
  "src/recTools.js",
  "src/restore.js",
  "src/rhythm.js",
  "src/rhythmPicker.js",
  "src/rhythmView.js",
  "src/scales.js",
  "src/sectionLabel.js",
  "src/setlistsView.js",
  "src/settingsView.js",
  "src/shareCode.js",
  "src/shareConfig.js",
  "src/shareImport.js",
  "src/shareService.js",
  "src/sharelink.js",
  "src/skalePath.js",
  "src/skaleTheory.js",
  "src/songChrome.js",
  "src/songEditor.js",
  "src/songIdentity.js",
  "src/songPlay.js",
  "src/songPlayer.js",
  "src/songPlayerCore.js",
  "src/songPracticeCard.js",
  "src/songPracticeUI.js",
  "src/songQuick.js",
  "src/songSync.js",
  "src/songTouchEdit.js",
  "src/songformat.js",
  "src/songmodel.js",
  "src/songs.js",
  "src/stage.js",
  "src/statsView.js",
  "src/streamRead.js",
  "src/styles.css",
  "src/suggest.js",
  "src/sync.js",
  "src/syncClock.js",
  "src/syncDrive.js",
  "src/syncEngine.js",
  "src/syncLocal.js",
  "src/syncMerge.js",
  "src/syncRunner.js",
  "src/syncWorker.js",
  "src/synth.js",
  "src/tab.css",
  "src/tabData.js",
  "src/tabEditor.js",
  "src/tabScanText.js",
  "src/tabSong.js",
  "src/tabText.js",
  "src/tabView.js",
  "src/tabs.js",
  "src/teach.js",
  "src/teachBox.js",
  "src/teachView.js",
  "src/textCase.js",
  "src/tour.js",
  "src/tuner.js",
  "src/tunerSettings.js",
  "src/tunerWave.js",
  "src/tunings.js",
  "src/ui.js",
  "src/update.js",
  "src/version.js",
  "src/versionsView.js",
  "src/wakelock.js",
  "src/welcome.js",
  "src/whatsnew.js",
  "src/ytPick.js",
  "src/ytShare.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-192.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "assets/headstock.webp"
];
// Retko korišćeni veliki fajlovi (PDF): preuzimaju se u pozadini, posle instalacije, da ne usporavaju prvo otvaranje.
const LAZY = ["vendor/jspdf.umd.min.js", "vendor/pdfjs/pdf.min.mjs", "vendor/pdfjs/pdf.worker.min.mjs", "fonts/DejaVuSansMono.ttf", "fonts/DejaVuSansMono-Bold.ttf", "assets/guitar/40.mp3", "assets/guitar/41.mp3", "assets/guitar/42.mp3", "assets/guitar/43.mp3", "assets/guitar/44.mp3", "assets/guitar/45.mp3", "assets/guitar/46.mp3", "assets/guitar/47.mp3", "assets/guitar/48.mp3", "assets/guitar/49.mp3", "assets/guitar/50.mp3", "assets/guitar/51.mp3", "assets/guitar/52.mp3", "assets/guitar/53.mp3", "assets/guitar/54.mp3", "assets/guitar/55.mp3", "assets/guitar/56.mp3", "assets/guitar/57.mp3", "assets/guitar/58.mp3", "assets/guitar/59.mp3", "assets/guitar/60.mp3", "assets/guitar/61.mp3", "assets/guitar/62.mp3", "assets/guitar/63.mp3", "assets/guitar/64.mp3", "assets/guitar/65.mp3", "assets/guitar/66.mp3", "assets/guitar/67.mp3", "assets/guitar/68.mp3", "assets/guitar/69.mp3", "assets/guitar/70.mp3", "assets/guitar/71.mp3", "assets/guitar/72.mp3", "assets/guitar/73.mp3", "assets/guitar/74.mp3", "assets/guitar/75.mp3", "assets/guitar/76.mp3", "assets/guitar/77.mp3", "assets/guitar/78.mp3", "assets/guitar/79.mp3", "assets/guitar/80.mp3", "assets/guitar/81.mp3", "assets/guitar/82.mp3", "assets/guitar/83.mp3", "assets/guitar/84.mp3", "assets/guitar/85.mp3", "assets/guitar/86.mp3"];
const fresh = (u) => new Request(u, { cache: "reload" }); // zaobiđi HTTP keš da se verzije ne pomešaju

self.addEventListener("install", e => {
  // Početna strana direktno iz keša, bez buđenja service worker-a (Chrome 123+): posle dužeg nekorišćenja telefon
  // ugasi service worker, a njegovo ponovno pokretanje je bio beli ekran sa kružićem pre prvog prikaza.
  // Samo tačna adresa aplikacije bez ?… (deljeni linkovi, „Popravi“ i sl. idu kroz fetch ispod).
  try {
    if (e.addRoutes && self.URLPattern) {
      const scope = new URL(self.registration.scope);
      e.addRoutes({ condition: { requestMode: "navigate", urlPattern: new URLPattern({ protocol: scope.protocol.slice(0, -1), hostname: scope.hostname, pathname: scope.pathname, search: "" }) }, source: { cacheName: CACHE } });
    }
  } catch (_) {}
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL.map(fresh));
    // Prvo instaliranje, ili prelaz sa starih verzija (≤ v24, bez dugmeta „Osveži“): aktiviraj odmah.
    const legacy = (await caches.keys()).some(k => { const m = /^gitara-v(\d+)$/.exec(k); return m && +m[1] <= 24; });
    if (!self.registration.active || legacy) self.skipWaiting();
  })());
});
self.addEventListener("message", e => { if (e.data === "SKIP_WAITING") self.skipWaiting(); });
// Prenos velikih fajlova iz starog keša i brisanje starijih verzija — jednom, u pozadini, nikad ispred zahteva.
let cleaning = null;
const cleanup = () => cleaning || (cleaning = (async () => {
  const keys = await caches.keys();
  const c = await caches.open(CACHE);
  for (const u of LAZY) {
    if (await c.match(u)) continue;
    for (const k of keys) { if (k === CACHE) continue; const r = await (await caches.open(k)).match(u); if (r) { await c.put(u, r); break; } }
  }
  // samo STARIJE verzije (novija koja se upravo instalira ostaje!)
  const ver = (k) => { const m = /^gitara-v(\d+)$/.exec(k); return m ? +m[1] : -1; }, mine = ver(CACHE);
  await Promise.all(keys.filter(k => k.startsWith("gitara-") && ver(k) < mine).map(k => caches.delete(k)));
  await Promise.all(LAZY.map(async u => { if (!(await c.match(u))) await c.add(fresh(u)); })).catch(() => {});
})().catch(() => {}));
self.addEventListener("activate", e => {
  // Aktivacija mora biti trenutna: dok traje, pregledač drži sve zahteve (i ponovno učitavanje posle „Osveži“) —
  // to je bio beli ekran sa kružićem posle ažuriranja. Zato ovde SAMO preuzimanje stranice; ostalo posle (fetch).
  e.waitUntil(self.clients.claim());
});
// v1.95: dodir na obaveštenje → otvori MARLI (ili već otvoren prozor) na tom mestu
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const href = (e.notification.data && e.notification.data.href) || "";
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const c = all[0];
    if (c) { await c.focus(); c.postMessage({ type: "marli-open", href }); return; }
    await self.clients.openWindow("./" + href);
  })());
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // npr. Gemini API ide direktno na mrežu
  if (url.pathname.includes("/docs/")) return; // predlozi/dokumentacija (npr. docs/marli/) — ne aplikacija, uvek sa mreže
  if (!cleaning) e.waitUntil(new Promise(r => setTimeout(r, 2000)).then(cleanup)); // posle prvog prikaza, ne pre
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Navigacija na samu aplikaciju → keširana početna strana; ostale stranice (npr. privacy.html) → svoj fajl
    const isPage = e.request.mode === "navigate" && !/\/privacy\.html$/.test(url.pathname);
    // ?v=… u adresi (dodaje se pri objavi) samo sprečava mešanje verzija u kešu pregledača — ovde je svejedno
    const cached = await cache.match(isPage ? "./" : e.request, { ignoreSearch: true })
      || (LAZY.some(u => url.pathname.endsWith("/" + u)) ? await caches.match(e.request, { ignoreSearch: true }) : null); // još u starom kešu
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
