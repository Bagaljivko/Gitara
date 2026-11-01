import { createTuner } from './tuner.js';
import { createChordRec } from './chordrec.js';
import { renderLibrary, renderSong, renderEditor } from './songs.js';
import { renderSetlist, setlistNav } from './setlistsView.js';
import { renderSettings } from './settingsView.js';
import { initDrive } from './drive.js';
import { t, getLang, setLang, onLangChange } from './i18n.js';
import { settings } from './db.js';

const app = document.getElementById('app');
const views = {};
let activeLive = null; // tuner/akordi koriste mikrofon — gasimo ga pri promeni taba

function liveView(name, factory) {
  if (!views[name]) {
    const el = document.createElement('div');
    el.className = 'live';
    views[name] = { el, ctl: factory(el) };
  }
  return views[name];
}

async function route() {
  const hash = location.hash || '#/tuner';
  const [, page, arg] = hash.match(/^#\/([^/?]*)\/?(.*)$/) || [, 'tuner', ''];
  const tab = { tuner: 'tuner', akordi: 'akordi', pesme: 'pesme', pesma: 'pesme', uredi: 'pesme', setlista: 'pesme', podesavanja: 'podesavanja' }[page] || 'tuner';
  document.body.classList.toggle('tuner-screen', tab === 'tuner');
  document.querySelectorAll('.nav a').forEach((a) => {
    const on = a.dataset.tab === tab;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });

  if (activeLive && activeLive !== tab) { views[activeLive].ctl.hide(); }
  app.querySelectorAll(':scope > .live').forEach((el) => (el.hidden = true));
  app.querySelector(':scope > .page')?.remove();

  if (tab === 'tuner' || tab === 'akordi') {
    const name = page === 'akordi' ? 'akordi' : 'tuner';
    const v = liveView(name, name === 'tuner' ? createTuner : createChordRec);
    if (!v.el.parentNode) app.appendChild(v.el);
    v.el.hidden = false;
    v.ctl.show();
    activeLive = name;
  } else {
    activeLive = null;
    const el = document.createElement('div');
    el.className = 'page';
    app.appendChild(el);
    const [rawId, query = ''] = (arg || '').split('?');
    const dec = decodeURIComponent(rawId || '');
    const params = new URLSearchParams(query);
    if (page === 'pesme') await renderLibrary(el, params);
    else if (page === 'pesma') await renderSong(el, dec, await setlistNav(params));
    else if (page === 'setlista') await renderSetlist(el, dec);
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

// Service worker — isto kao u aplikaciji Trening-za-decu: relativna putanja "sw.js" (scope = /Gitara/).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

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
  route();
});
applyStaticText();
// Jezik iz IndexedDB (npr. posle vraćanja iz rezervne kopije) ima prednost.
settings.get('lang', null).then((v) => { if (v && v !== getLang()) setLang(v, { save: false }); }).catch(() => {});

route();
initDrive().catch(() => {});
