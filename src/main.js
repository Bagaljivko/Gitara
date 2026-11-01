import './styles.css';
import { createTuner } from './tuner.js';
import { createChordRec } from './chordrec.js';
import { renderLibrary, renderSong, renderEditor } from './songs.js';
import { renderSettings } from './settingsView.js';

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
  const [, page, arg] = hash.match(/^#\/([^/]*)\/?(.*)$/) || [, 'tuner', ''];
  const tab = { tuner: 'tuner', akordi: 'akordi', pesme: 'pesme', pesma: 'pesme', uredi: 'pesme', podesavanja: 'podesavanja' }[page] || 'tuner';
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
    const dec = decodeURIComponent(arg || '');
    if (page === 'pesme') await renderLibrary(el);
    else if (page === 'pesma') await renderSong(el, dec);
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

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  });
}

route();
