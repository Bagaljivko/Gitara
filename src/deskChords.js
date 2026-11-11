// v1.99.5: računar — Akordi: četiri kartice umesto trake (ikonica + jedan red opisa), sadržaj svakog režima u dve kolone.
// Ovde samo dodaci (opis ispod naslova, ikonice i opisi na karticama); raspored je CSS (body.desk-shell).
// Prepoznavanje, Samo sviraj, Rečnik i Ritam rade isto kao do sada. Učitava se samo na računaru (iz deskShell.js).
import { t } from './i18n.js';
import { esc } from './ui.js';

const IC = { rec: '🎧', free: '🎸', dict: '▦', rhythm: '♩' };
function paint() {
  const v = document.querySelector('.chordrec-view'); if (!v) return;
  const h1 = v.querySelector('.view-head h1');
  if (h1 && !v.querySelector('.dch-sub')) h1.insertAdjacentHTML('afterend', `<span class="dch-sub">${esc(t('dch.sub'))}</span>`);
  v.querySelectorAll(':scope > .seg-tabs > button[data-pane]').forEach((b) => {
    if (b.querySelector('.dch-ic')) return;
    const k = b.dataset.pane;
    b.insertAdjacentHTML('afterbegin', `<span class="dch-ic" aria-hidden="true">${IC[k] || '•'}</span>`);
    b.insertAdjacentHTML('beforeend', `<span class="dch-d">${esc(t('dch.' + k))}</span>`);
  });
}
let inited = false;
export function initDeskChords() {
  if (inited) return; inited = true;
  const later = () => setTimeout(paint, 0);
  const app = document.getElementById('app');
  if (app) new MutationObserver(later).observe(app, { childList: true });
  addEventListener('hashchange', later);
  import('./i18n.js').then((m) => m.onLangChange?.(() => { document.querySelectorAll('.dch-sub, .dch-ic, .dch-d').forEach((x) => x.remove()); later(); })).catch(() => {});
  later();
}
