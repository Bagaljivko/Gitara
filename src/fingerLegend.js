// v2.0: legenda prstiju — ista ruka kao u igrama (bez teksta), plus 0 = prazna žica i × = ne sviraj.
// Ide ispod svakog vrata i hvata. ▾ je skuplja u malu ruku (pamti se za celu aplikaciju), dodir je opet otvara.
import { HAND_SVG } from './handSvg.js';
import { t } from './i18n.js';

const LS = 'marli-fleg';
const LIT = HAND_SVG.replace(/class="h-tip /g, 'class="h-tip lit ');
const min = () => { try { return localStorage.getItem(LS) === 'min'; } catch { return false; } };
let bound = false;
function bind() {
  if (bound) return; bound = true;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fleg-t]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const m = !min(); try { localStorage.setItem(LS, m ? 'min' : ''); } catch {}
    document.querySelectorAll('.fleg').forEach((x) => x.classList.toggle('min', m));
  }, true);
}
/** HTML legende. cls: dodatna klasa (npr. 'fleg-stage' za Samo sviraj). */
export function legendHTML(cls = '') {
  bind();
  return `<div class="fleg${min() ? ' min' : ''}${cls ? ' ' + cls : ''}" role="img" aria-label="${t('fleg.aria')}"><span class="fleg-hand">${LIT}</span><span class="fleg-s fleg-0" title="${t('fleg.open')}">0</span><span class="fleg-s fleg-x" title="${t('fleg.mute')}">×</span><button type="button" class="fleg-t" data-fleg-t aria-label="${t('fleg.toggle')}"></button></div>`;
}
/** Dodaj legendu odmah posle elementa (jednom). */
export function legendAfter(el, cls = '') {
  if (!el || (el.nextElementSibling && el.nextElementSibling.classList.contains('fleg'))) return;
  el.insertAdjacentHTML('afterend', legendHTML(cls));
}
