// v1.99.6: računar — Vežbe i Podešavanja: beli naslov sa jednim redom opisa pored (kao Tuner i Akordi).
// Ovde samo opis; raspored je CSS (body.desk-shell). Učitava se samo na računaru (iz deskShell.js).
import { t } from './i18n.js';
import { esc } from './ui.js';

const PAGES = [['.practice-view:not(.pr-game) > .pr-hub-head h1', 'dhd.vezbe'], ['.settings-view > .view-head h1', 'dhd.podesavanja']];
function paint() {
  for (const [sel, key] of PAGES) {
    const h1 = document.querySelector('#app ' + sel);
    if (h1 && !h1.parentElement.querySelector('.dhd-sub')) h1.insertAdjacentHTML('afterend', `<span class="dhd-sub">${esc(t(key))}</span>`);
  }
}
let inited = false;
export function initDeskHeads() {
  if (inited) return; inited = true;
  let q = 0; const later = () => { cancelAnimationFrame(q); q = requestAnimationFrame(paint); };
  const app = document.getElementById('app');
  if (app) new MutationObserver(() => { later(); setTimeout(paint, 300); }).observe(app, { childList: true }); // bez praćenja celog sadržaja (igre!)
  addEventListener('hashchange', () => { setTimeout(paint, 60); setTimeout(paint, 450); setTimeout(paint, 1400); });
  import('./i18n.js').then((m) => m.onLangChange?.(() => { document.querySelectorAll('.dhd-sub').forEach((x) => x.remove()); later(); })).catch(() => {});
  later();
}
