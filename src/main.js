import { createTuner } from './tuner.js';
import { t, getLang, setLang, onLangChange, i18nReady } from './i18n.js';
import { settings, songs as songsDb, events as dbEvents } from './db.js';
import { setWakeZone } from './wakelock.js';
import { onNamingChange, loadNoteNamesPref } from './naming.js';
import { needsUpgrade, CV } from './songmodel.js';

await i18nReady; // engleski prevod (ako je izabran) mora biti učitan pre prvog prikaza

// Ekrani osim tunera se učitavaju tek kad zatrebaju (brže prvo otvaranje).
const lazy = (load) => { let p; return () => (p ||= load()); };
const loadSongs = lazy(() => import('./songs.js'));
const loadSetlists = lazy(() => import('./setlistsView.js'));
const loadSettings = lazy(() => import('./settingsView.js'));
const loadChordRec = lazy(() => import('./chordrec.js'));
const loadStage = lazy(() => import('./stage.js'));
const loadChordCheck = lazy(() => import('./chordCheck.js'));
const loadPractice = lazy(() => import('./practice.js')); // Vežbe: učitava se tek kad se otvori
// poslata pesma / set lista (shareImport.js): stari dugi linkovi, kratak link #d/<fileId> i ?d=<fileId> (Android intent iz
// „Otvori u aplikaciji Gitara“ — tamo # zauzima intent)
const hasSharedSong = () => location.hash.startsWith('#pesma=') || location.hash.startsWith('#g=') || location.hash.startsWith('#d/') || /[?&]d=/.test(location.search);

// Osećaj prave aplikacije: dugi pritisak ne otvara meni pregledača („Kopiraj / Potraži / Sačuvaj sliku“), ništa se ne
// označava i ne prevlači — osim u poljima za unos (gde se kuca i lepi tekst).
const editable = (el) => !!(el && el.closest && el.closest('input, textarea, [contenteditable]:not([contenteditable="false"])'));
for (const ev of ['contextmenu', 'selectstart', 'dragstart']) document.addEventListener(ev, (e) => { if (!editable(e.target)) e.preventDefault(); }, { capture: true });

const app = document.getElementById('app');
const views = {};
let activeLive = null; // tuner/akordi koriste mikrofon — gasimo ga pri promeni taba

async function liveView(name) {
  const factory = name === 'tuner' ? createTuner : (await loadChordRec()).createChordRec;
  if (!views[name]) {
    const el = document.createElement('div');
    el.className = 'live';
    views[name] = { el, ctl: factory(el) };
  }
  return views[name];
}

// Tablet u položenom režimu: lista i pesma jedna pored druge
const TWO_PANE = window.matchMedia('(min-width: 900px) and (min-height: 600px) and (orientation: landscape)');
TWO_PANE.addEventListener('change', () => { app.querySelector(':scope > .page')?.remove(); route(); });

// ---- Zaštita od praznog ekrana ----
// index.html beleži greške pre pokretanja i prikazuje „Pokušaj ponovo / Popravi aplikaciju“ ako se aplikacija
// uopšte ne pokrene. Ovde: kada se aplikacija pokrene, ukloni ekran za učitavanje; ako crtanje nekog ekrana
// ne uspe, umesto praznine prikaži poruku sa istim dugmadima. Sve se beleži samo na uređaju (Dijagnostika).
const boot = window.__gBoot || { add() {}, done: false, start: Date.now() };
function bootDone() {
  if (boot.done) return;
  boot.done = true;
  document.getElementById('boot')?.remove();
  document.getElementById('bootFail')?.remove();
  if (/[?&]r=\d/.test(location.search)) history.replaceState(history.state, '', location.pathname + location.hash); // posle „Popravi aplikaciju“
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    const k = 'gitara-boots';
    const a = JSON.parse(localStorage.getItem(k) || '[]');
    a.push({ t: Date.now(), ms: Math.round(performance.now()), sw: !!navigator.serviceWorker?.controller, nav: nav ? nav.type : '', disc: !!document.wasDiscarded });
    localStorage.setItem(k, JSON.stringify(a.slice(-12)));
  } catch {}
}
function showRouteError(e) {
  boot.add({ k: 'screen', m: String((e && (e.stack || e.message)) || e).slice(0, 400), h: location.hash.slice(0, 60) });
  app.querySelector(':scope > .page')?.remove();
  app.querySelectorAll(':scope > .live').forEach((el) => (el.hidden = true));
  const el = document.createElement('div');
  el.className = 'page';
  el.innerHTML = `<section class="view route-err">
    <h1>${t('err.title')}</h1>
    <p class="muted">${t('err.body')}</p>
    <button class="btn primary big wide" data-a="retry">${t('err.retry')}</button>
    <button class="btn wide" data-a="repair">${t('err.repair')}</button>
  </section>`;
  el.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-a]')?.dataset.a;
    if (a === 'retry') location.reload();
    if (a === 'repair') (boot.repair ? boot.repair() : location.reload());
  });
  app.appendChild(el);
}

let routeId = 0;
async function route() {
  try { await routeInner(); }
  catch (e) { console.error(e); showRouteError(e); }
  finally { bootDone(); }
}
async function routeInner() {
  const myRoute = ++routeId;
  setWakeZone(null); // ekrani koji računaju aktivnost (pesma, setlista, rečnik) je ponovo uključe
  const shared = hasSharedSong();
  const hash = shared ? '#/primljena' : location.hash || '#/tuner';
  const [, page, arg] = hash.match(/^#\/([^/?]*)\/?(.*)$/) || [, 'tuner', ''];
  const tab = { tuner: 'tuner', akordi: 'akordi', pesme: 'pesme', pesma: 'pesme', uredi: 'pesme', setlista: 'pesme', nastup: 'pesme', primljena: 'pesme', podesavanja: 'podesavanja', provera: 'podesavanja', vezbe: 'vezbe' }[page] || 'tuner';
  document.body.classList.toggle('tuner-screen', tab === 'tuner');
  document.querySelectorAll('.nav a').forEach((a) => {
    const on = a.dataset.tab === tab;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });

  if (activeLive && activeLive !== tab) { views[activeLive].ctl.hide(); }
  app.querySelectorAll(':scope > .live').forEach((el) => (el.hidden = true));
  if (!(TWO_PANE.matches && (page === 'pesme' || page === 'pesma'))) app.querySelector(':scope > .page')?.remove();
  if (tab !== 'pesme') document.body.classList.remove('two-pane-mode');

  if (tab === 'tuner' || tab === 'akordi') {
    const name = page === 'akordi' ? 'akordi' : 'tuner';
    const v = await liveView(name);
    if (routeId !== myRoute) return;
    if (!v.el.parentNode) app.appendChild(v.el);
    v.el.hidden = false;
    v.ctl.show();
    activeLive = name;
  } else if (tab === 'vezbe') {
    // Vežbe: posebna stranica, bez učitavanja pesmarice (osim kad igra „Delovi pesme“ sama zatraži pesmu)
    activeLive = null;
    const { renderPractice } = await loadPractice();
    if (routeId !== myRoute) return;
    const el = document.createElement('div');
    el.className = 'page';
    app.appendChild(el);
    const [rest, query = ''] = (arg || '').split('?');
    await renderPractice(el, rest.split('/').map(decodeURIComponent), new URLSearchParams(query));
  } else {
    activeLive = null;
    const [rawId, query = ''] = (arg || '').split('?');
    const dec = decodeURIComponent(rawId || '');
    const params = new URLSearchParams(query);
    const { renderLibrary, renderSong, renderSharedSong, setSelectedSong } = await loadSongs();
    const { renderEditor } = page === 'uredi' ? await import('./songEditor.js') : {};
    const { renderSetlist, setlistNav } = await loadSetlists();
    const { renderSettings } = page === 'podesavanja' ? await loadSettings() : {};
    const { renderStage } = page === 'nastup' ? await loadStage() : {};
    const { renderChordCheck } = page === 'provera' ? await loadChordCheck() : {};
    if (routeId !== myRoute) return;
    // Tablet položeno: dva panela — lista pesama levo, izabrana pesma desno
    const twoPane = TWO_PANE.matches && (page === 'pesme' || page === 'pesma') && params.get('tab') !== 'sl';
    document.body.classList.toggle('two-pane-mode', twoPane);
    if (twoPane) {
      setSelectedSong(page === 'pesma' ? dec : null);
      let tp = app.querySelector(':scope > .page.two-pane');
      if (!tp) {
        app.querySelector(':scope > .page')?.remove();
        tp = document.createElement('div');
        tp.className = 'page two-pane';
        tp.innerHTML = '<div class="pane-list"></div><div class="pane-song"></div>';
        app.appendChild(tp);
        await renderLibrary(tp.querySelector('.pane-list'), params);
      } else {
        // samo osveži oznaku izabrane pesme u listi
        tp.querySelectorAll('.song-item').forEach((li) => li.classList.toggle('selected', li.dataset.id === dec && page === 'pesma'));
      }
      const right = document.createElement('div');
      tp.querySelector('.pane-song').replaceWith(right);
      right.className = 'pane-song';
      if (page === 'pesma') await renderSong(right, dec, await setlistNav(params));
      else right.innerHTML = `<div class="pane-empty muted">${t('lib.selectSong')}</div>`;
      return;
    }
    app.querySelector(':scope > .page')?.remove();
    const el = document.createElement('div');
    el.className = 'page';
    app.appendChild(el);
    if (page === 'pesme') await renderLibrary(el, params);
    else if (page === 'pesma') await renderSong(el, dec, await setlistNav(params));
    else if (page === 'setlista') await renderSetlist(el, dec);
    else if (page === 'nastup') await renderStage(el, dec, params);
    else if (page === 'primljena') await renderSharedSong(el);
    else if (page === 'uredi') await renderEditor(el, dec);
    else if (page === 'podesavanja') await renderSettings(el);
    else if (page === 'provera') await renderChordCheck(el);
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && activeLive) views[activeLive].ctl.hide();
});

const offline = document.getElementById('offline');
const updateOnline = () => (offline.hidden = navigator.onLine !== false);
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);
updateOnline();

// Service worker — relativna putanja "sw.js" (scope = /Gitara/).
// Nova verzija se preuzme u pozadini; traka „Osveži“ je primenjuje jednim dodirom.
if ('serviceWorker' in navigator) {
  let updating = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (updating) location.reload(); });
  const offerUpdate = (w) => {
    const bar = document.getElementById('updateBar');
    if (!bar || !navigator.serviceWorker.controller) return;
    bar.hidden = false;
    bar.querySelector('button').onclick = () => { updating = true; bar.querySelector('button').disabled = true; w.postMessage('SKIP_WAITING'); };
  };
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').then((reg) => {
    if (reg.waiting) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed') offerUpdate(w); });
    });
    // Instalirana aplikacija se često samo vrati iz pozadine — tada proveri ima li nove verzije.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {}));
}

// Zamoli pregledač da ne briše pesme kad ponestane prostora (ili posle 7 dana na iPhone-u).
async function persistStorage() {
  try {
    if (!navigator.storage?.persist || await navigator.storage.persisted()) return;
    if (await songsDb.count()) await navigator.storage.persist();
  } catch {}
}
persistStorage();
dbEvents.addEventListener('songs-changed', persistStorage, { once: true });

// ---- Jezik ----
function applyStaticText() {
  document.documentElement.lang = getLang() === 'en' ? 'en' : 'sr-Latn';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
}
function rerenderAll() {
  for (const name of Object.keys(views)) {
    views[name].ctl.hide();
    views[name].el.remove();
    delete views[name];
  }
  activeLive = null;
  app.querySelector(':scope > .page')?.remove();
  route();
}
// Odmah ponovo iscrtaj sve ekrane na novom jeziku ili sa novim imenima nota (bez ponovnog učitavanja stranice).
onLangChange(() => { applyStaticText(); rerenderAll(); });
onNamingChange(() => rerenderAll());
// Imena nota iz IndexedDB-a (npr. posle vraćanja iz rezervne kopije)
settings.get('noteNames', null).then((v) => { if (v) loadNoteNamesPref(v); }).catch(() => {});
dbEvents.addEventListener('settings-changed', (e) => { if (e.detail === 'noteNames') settings.get('noteNames', null).then((v) => v && loadNoteNamesPref(v)); });
applyStaticText();
// Jezik iz IndexedDB (npr. posle vraćanja iz rezervne kopije) ima prednost.
settings.get('lang', null).then((v) => { if (v && v !== getLang()) setLang(v, { save: false }); }).catch(() => {});

route();
// Drive (automatska rezervna kopija) se učitava malo kasnije, kad se prvi ekran već prikaže.
const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1200));
// Jednokratna konverzija postojećih pesama u novi zapis akorda (original ostaje netaknut)
// Radi se samo dok ima šta da se prebaci: posle uspešnog prolaza se pamti, da se pri svakom
// pokretanju ne čita cela biblioteka (na sporom telefonu to je pola sekunde zauzetog ekrana).
const UPG_KEY = 'gitara-upgraded';
let upgDone = false; try { upgDone = localStorage.getItem(UPG_KEY) === String(CV); } catch {}
if (!upgDone) idle(() => songsDb.all().then((list) => Promise.all(list.filter(needsUpgrade).map((x) => songsDb.put(x))))
  .then(() => { try { localStorage.setItem(UPG_KEY, String(CV)); } catch {} }).catch(() => {}));
// Jednokratno: ukloni tačne duplikate pesama (ista pesma sačuvana dvaput) i kratko javi koliko ih je bilo
idle(() => import('./songSync.js').then((m) => m.cleanupDuplicates({ settings })).then(async (n) => {
  if (n) (await import('./ui.js')).toast(t('dup.cleaned', { n }));
}).catch(() => {}));
// Google Drive (~25 KB) se učitava samo ako je rezervna kopija uključena; inače tek kad se otvore Podešavanja
idle(() => settings.get('drive', null).then((d) => { if (d && d.connected) return import('./drive.js').then((m) => m.initDrive()); }).catch(() => {}));
// Deljenje: fajlovi u „Gitara – deljeno“ bez zapisa (prekinuto deljenje) se tiho brišu — samo ako je nešto deljeno
idle(() => settings.get('shareFolder', '').then((f) => f && import('./shareService.js').then((m) => m.cleanupOrphans())).catch(() => {}));
// Sinhronizacija između uređaja: tek posle prvog ekrana (nikad ne usporava pokretanje), samo ako je uključena
idle(() => settings.get('syncCfg', null).then(async (c) => {
  let ls = null; try { ls = JSON.parse(localStorage.getItem('gitara-sync') || 'null'); } catch {}
  if ((c && c.on) || (!c && ls && ls.on)) return (await import('./sync.js')).initSync();
  // stara rezervna kopija je povezana: jednom ponudi sinhronizaciju (isti Google nalog, jedan dodir)
  const d = await settings.get('drive', null);
  if (!c && d && d.connected && !(await settings.get('syncOffered', false))) {
    await settings.set('syncOffered', true);
    (await import('./ui.js')).toast(t('sync.offer'), '', { label: t('sync.connectBtn'), onClick: () => import('./sync.js').then((m) => m.connectSync()).catch(() => { location.hash = '#/podesavanja'; }) });
  }
}).catch(() => {}));
