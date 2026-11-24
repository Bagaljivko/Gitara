// v2.4.7: Pesme na računaru — lista | razdelnik | pesma. Razdelnik se prevlači (širina liste se pamti; do kraja levo = fokus),
// dvoklik ili F = fokus (samo pesma preko cele širine), Esc ili „‹ Lista“ = nazad na listu. Fokus se pamti.
const LW = 'marli-dk-lw', FK = 'marli-dk-focus';
const MIN = 240, CLOSE = 170;
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

export const isFocus = () => document.body.classList.contains('dk-focus');
export function setFocus(on) {
  document.body.classList.toggle('dk-focus', !!on);
  set(FK, on ? '1' : '0');
  window.dispatchEvent(new Event('resize')); // pesma ponovo uklopi tekst
}
export const toggleFocus = () => setFocus(!isFocus());
const maxW = (tp) => Math.max(MIN, Math.min(620, Math.round(tp.clientWidth * 0.5)));
function applyW(tp, w) { tp.style.setProperty('--dk-lw', Math.round(Math.max(MIN, Math.min(maxW(tp), w))) + 'px'); }

/** Jednom, kad se napravi raspored biblioteke na računaru. */
export function initDeskLayout(tp) {
  if (get(FK) === '1') document.body.classList.add('dk-focus');
  const saved = Number(get(LW)); if (saved) applyW(tp, saved);
  const div = tp.querySelector('.dk-div'), list = tp.querySelector('.pane-list');
  if (!div || !list) return;
  let drag = null;
  div.addEventListener('pointerdown', (e) => {
    if (e.button) return; e.preventDefault();
    drag = { x0: list.getBoundingClientRect().left, w0: list.getBoundingClientRect().width };
    div.setPointerCapture?.(e.pointerId); tp.classList.add('dk-resizing');
  });
  div.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const w = e.clientX - drag.x0;
    tp.classList.toggle('dk-will-focus', w < CLOSE);
    if (w >= CLOSE) applyW(tp, w);
  });
  const end = (e) => {
    if (!drag) return; const w0 = drag.w0; drag = null; tp.classList.remove('dk-resizing', 'dk-will-focus');
    const w = e.clientX - list.getBoundingClientRect().left;
    if (w < CLOSE) { applyW(tp, w0); setFocus(true); return; } // do kraja levo = samo pesma (širina liste ostaje zapamćena)
    applyW(tp, w); set(LW, String(parseInt(tp.style.getPropertyValue('--dk-lw'), 10)));
    window.dispatchEvent(new Event('resize'));
  };
  div.addEventListener('pointerup', end); div.addEventListener('pointercancel', end);
  div.addEventListener('dblclick', () => setFocus(true));
  div.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); e.stopPropagation();
    const cur = list.getBoundingClientRect().width;
    applyW(tp, cur + (e.key === 'ArrowRight' ? 30 : -30)); set(LW, String(parseInt(tp.style.getPropertyValue('--dk-lw'), 10)));
    window.dispatchEvent(new Event('resize'));
  });
}
