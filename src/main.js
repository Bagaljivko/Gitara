import { createTuner } from './tuner.js';
import { t, getLang, setLang, onLangChange } from './i18n.js';
import { settings, songs as songsDb, events as dbEvents } from './db.js';

// Ekrani osim tunera se učitavaju tek kad zatrebaju (brže prvo otvaranje).
const lazy = (load) => { let p; return () => (p ||= load()); };
const loadSongs = lazy(() => import('./songs.js'));
const loadSetlists = lazy(() => import('./setlistsView.js'));
const loadSettings = lazy(() => import('./settingsView.js'));
const loadChordRec = lazy(() => import('./chordrec.js'));
const loadStage = lazy(() => import('./stage.js'));
const hasSharedSong = () => location.hash.startsWith('#pesma='); // isto kao u sharelink.js

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

let routeId = 0;
async function route() {
  const myRoute = ++routeId;
  const shared = hasSharedSong();
  const hash = shared ? '#/primljena' : location.hash || '#/tuner';
  const [, page, arg] = hash.match(/^#\/([^/?]*)\/?(.*)$/) || [, 'tuner', ''];
  const tab = { tuner: 'tuner', akordi: 'akordi', pesme: 'pesme', pesma: 'pesme', uredi: 'pesme', setlista: 'pesme', nastup: 'pesme', primljena: 'pesme', podesavanja: 'podesavanja' }[page] || 'tuner';
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
  } else {
    activeLive = null;
    const [rawId, query = ''] = (arg || '').split('?');
    const dec = decodeURIComponent(rawId || '');
    const params = new URLSearchParams(query);
    const { renderLibrary, renderSong, renderEditor, renderSharedSong, setSelectedSong } = await loadSongs();
    const { renderSetlist, setlistNav } = await loadSetlists();
    const { renderSettings } = page === 'podesavanja' ? await loadSettings() : {};
    const { renderStage } = page === 'nastup' ? await loadStage() : {};
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
    if ((await songsDb.all()).length) await navigator.storage.persist();
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
onLangChange(() => {
  // Odmah ponovo iscrtaj sve ekrane na novom jeziku (bez ponovnog učitavanja stranice).
  applyStaticText();
  for (const name of Object.keys(views)) {
    views[name].ctl.hide();
    views[name].el.remove();
    delete views[name];
  }
  activeLive = null;
  app.querySelector(':scope > .page')?.remove();
  route();
});
applyStaticText();
// Jezik iz IndexedDB (npr. posle vraćanja iz rezervne kopije) ima prednost.
settings.get('lang', null).then((v) => { if (v && v !== getLang()) setLang(v, { save: false }); }).catch(() => {});

route();
// Drive (automatska rezervna kopija) se učitava malo kasnije, kad se prvi ekran već prikaže.
const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1200));
idle(() => import('./drive.js').then((m) => m.initDrive()).catch(() => {}));
