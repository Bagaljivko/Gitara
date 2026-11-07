// Ekran pesme (akordi i TAB): meni „⋯“ (umesto „Aa“), veličina slova (klizač), uvećanje sa dva prsta i jednokratno
// objašnjenje za „Prethodne verzije“. Zajedničko za oba ekrana, da izgledaju i rade isto.
import { dialog } from './ui.js';
import { t } from './i18n.js';
import { versions } from './db.js';

export const MORE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm6 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm6 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>';

const ICONS = {
  edit: '<path d="M3 17.2V21h3.8l11-11-3.8-3.8-11 11zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8L20.7 7z"/>',
  easy: '<path d="M7 2h2v4h6V2h2v4h2a2 2 0 0 1 2 2v3H3V8a2 2 0 0 1 2-2h2V2zm-4 11h18v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7zm5 3v2h8v-2H8z"/>',
  details: '<path d="M12 3v10.6A4 4 0 1 0 14 17V7h4V3h-6z"/>',
  yt: '<path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3L10 15z"/>',
  listen: '<path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3L10 15z"/>',
  tutorial: '<path d="M12 3 1 9l11 6 9-4.9V17h2V9L12 3zM5 13.2v4L12 21l7-3.8v-4L12 17l-7-3.8z"/>',
  trash: '<path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9zm4 2v8h1.5v-8H10zm3.5 0v8H15v-8h-1.5z"/>',
  versions: '<path d="M13 3a9 9 0 0 0-9 9H1l3.9 3.9L9 12H6a7 7 0 1 1 2.1 5l-1.4 1.4A9 9 0 1 0 13 3zm-1 5v5l4.3 2.5.7-1.2-3.5-2.1V8H12z"/>',
};

/** Isti meni za pesmu sa akordima i TAB pesmu: Slušaj, Tutorial, Uredi pesmu (+ stavke samo za akorde). */
export function songMenuItems(stored, extra = []) {
  const yt = stored.yt || {};
  const ytItem = (kind) => ({ value: kind, label: t(kind === 'listen' ? 'yt.listen' : 'yt.tutorial'), sub: t(yt[kind] ? 'yt.linkedSub' : 'yt.pickSub'), icon: kind, ...(yt[kind] ? { alt: { value: kind + ':change', label: t('yt.change') } } : {}) });
  return [ytItem('listen'), ytItem('tutorial'), { value: 'edit', label: t('song.editMenu'), sub: t(stored.type === 'tab' ? 'song.editSubTab' : 'song.editSub'), icon: 'edit' }, ...extra];
}

/**
 * „⋯“: veliki meni ispod dugmeta (gore desno), krupni redovi sa ikonicom i kratkim opisom.
 * items: [{ value, label, sub?, icon? }]; „Prethodne verzije“ se dodaje sama (ako postoje). Vraća izbor ili null.
 */
export async function moreMenu(key, items = []) {
  const has = key ? (await versions.list(key).catch(() => [])).length > 0 : false;
  const all = [...items, ...(has ? [{ value: 'versions', label: t('song.versionsMenu'), sub: t('song.versionsSub'), icon: 'versions' }] : [])];
  const v = await new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop more-backdrop';
    wrap.innerHTML = `<div class="more-pop" role="menu">${all.map((it) => `<button class="more-item${it.on ? ' on' : ''}" role="menuitem" data-v="${it.value}">
      <span class="more-ico"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[it.icon] || ''}</svg></span>
      <span class="more-txt"><b>${it.label}</b>${it.sub ? `<span>${it.sub}</span>` : ''}</span>${it.on ? '<span class="more-on">✓</span>' : ''}${it.alt ? `<span class="more-alt" role="button" data-v="${it.alt.value}">${it.alt.label}</span>` : ''}</button>`).join('')}</div>`;
    const done = (x) => { wrap.remove(); resolve(x); };
    wrap.__close = () => done(null);
    wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) { e.stopPropagation(); return done(b.dataset.v); } if (!e.target.closest('.more-pop')) done(null); });
    document.body.appendChild(wrap);
  });
  if (v === 'versions') (await import('./versionsView.js')).openVersions(key);
  return v;
}

/**
 * Sadržaj nekadašnjih „Detalja“ kao panel odozdo: isti element ostaje u ekranu pesme (dugmad i dalje rade),
 * samo se prikaže preko ekrana. Zatvara se ✕, dodirom van panela ili dugmetom „nazad“.
 */
export function openPanel(det, title) {
  if (!det || det.classList.contains('det-sheet')) return;
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop det-backdrop';
  const close = () => { det.classList.remove('det-sheet'); det.open = false; bd.remove(); det.querySelector('.det-close')?.remove(); det.querySelector('.det-title')?.remove(); };
  bd.__close = close;
  bd.addEventListener('click', close);
  document.body.appendChild(bd);
  det.insertAdjacentHTML('afterbegin', `<h2 class="det-title">${title}</h2><button class="icon-btn det-close" aria-label="${t('common.close')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>`);
  det.querySelector('.det-close').addEventListener('click', (e) => { e.preventDefault(); close(); });
  det.classList.add('det-sheet');
  det.open = true;
  return close;
}

/**
 * Veličina slova uz sam tekst: „− 🔍 +“ u gornjem desnom uglu teksta, ostaje vidljivo dok se pesma skroluje.
 * Menja se odmah (na svaki dodir), čuva se kratko posle poslednjeg dodira.
 */
export function zoomPillHTML() {
  return `<div class="zoom-wrap"><div class="zoom-pill" role="group" aria-label="${t('song.textSize')}">
    <button data-zoom="-1" aria-label="${t('song.smaller')}">−</button>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3a7 7 0 0 1 5.6 11.2l4.6 4.6-1.4 1.4-4.6-4.6A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg>
    <button data-zoom="1" aria-label="${t('song.bigger')}">+</button></div></div>`;
}
export function bindZoomPill(root, { get, apply, save, min = 0.8, max = 1.8, step = 0.1 }) {
  let tm = 0;
  root.querySelector('.zoom-pill')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-zoom]');
    if (!b) return;
    const z = Math.min(max, Math.max(min, Math.round((get() + step * +b.dataset.zoom) * 10) / 10));
    if (z === get()) return;
    apply(z);
    clearTimeout(tm); tm = setTimeout(save, 600);
  });
}

/**
 * Uvećanje sa dva prsta (kao kod slika). Dok prsti klize: samo brz pregled (CSS scale); kad se puste: nova veličina.
 * get() → trenutna veličina; set(z) → primeni i sačuvaj. Jedan prst = običan skrol.
 */
export function attachPinch(el, { get, set, min = 0.8, max = 1.8 }) {
  let d0 = 0, z0 = 1, z = 1, hint = null;
  const dist = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    d0 = dist(e); z0 = get(); z = z0;
    const r = el.getBoundingClientRect();
    el.style.transformOrigin = `${((e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left)}px ${((e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top)}px`;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !d0) return;
    e.preventDefault();
    z = Math.min(max, Math.max(min, z0 * (dist(e) / d0)));
    el.style.transform = `scale(${z / z0})`;
    if (!hint) { hint = document.createElement('div'); hint.className = 'pinch-hint'; document.body.appendChild(hint); }
    hint.textContent = Math.round(z * 100) + '%';
  }, { passive: false });
  const end = () => {
    if (!d0) return;
    d0 = 0; el.style.transform = ''; el.style.transformOrigin = '';
    hint?.remove(); hint = null;
    if (Math.abs(z - z0) > 0.04) set(Math.round(z * 10) / 10);
  };
  el.addEventListener('touchend', (e) => { if (e.touches.length < 2) end(); });
  el.addEventListener('touchcancel', end);
}

/** Prvi put kad pesma ima sačuvanu prethodnu verziju: kratko objašnjenje gde je (posle toga nikad više). */
let tipBusy = false;
export async function versionTipOnce(key) {
  try { if (localStorage.getItem('gitara-vertip')) return; } catch { return; }
  if (tipBusy) return; // ekran se može nacrtati dvaput zaredom — objašnjenje samo jednom
  tipBusy = true;
  const l = await versions.list(key).catch(() => []);
  if (!l.length) { tipBusy = false; return; }
  try { localStorage.setItem('gitara-vertip', '1'); } catch {}
  await dialog({ title: t('song.versionsMenu'), body: t('ver.tip'), buttons: [{ label: t('common.ok'), value: true, kind: 'primary' }] });
}
