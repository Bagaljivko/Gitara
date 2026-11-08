// v1.68: tastatura i miš na računaru. Prečice rade preko istih dugmadi kao dodir (bez posebne logike po ekranu).
// Pesma: razmak = listanje, ↑ ↓ = brzina (dok lista), + − = slova, ← → = prethodna/sledeća pesma (dva panela),
// Esc = zaustavi / nazad. Svuda: / = pretraga pesama, ? = spisak prečica. Ctrl + točkić = veličina slova.
// Nastup (pedala / tastatura) ima svoje tastere u stage.js.
import { t } from './i18n.js';
import { dialog, esc } from './ui.js';

const typing = (el) => !!(el && el.closest && el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
const modalOpen = () => !!document.querySelector('.modal-backdrop, .more-backdrop, .det-backdrop, .rp-sheet');
const songView = () => document.querySelector('.song-view #sLyrics') ? document.querySelector('.song-view') : null;

export const SHORTCUTS = [
  ['space', 'keys.space'], ['↑ ↓', 'keys.speed'], ['+ −', 'keys.zoom'], ['Ctrl + 🖱', 'keys.wheel'], ['← →', 'keys.prevNext'],
  ['/', 'keys.search'], ['Esc', 'keys.esc'], ['?', 'keys.help'], ['PageDown / →', 'keys.stage'], ['Shift + → ←', 'keys.stageSong'],
];

export function showShortcuts() {
  const rows = SHORTCUTS.map(([k, d]) => `<tr><td><kbd>${k === 'space' ? esc(t('keys.spaceKey')) : esc(k)}</kbd></td><td>${esc(t(d))}</td></tr>`).join('');
  return dialog({ title: t('keys.title'), html: true, body: `<table class="keys-table">${rows}</table><p class="small muted">${esc(t('keys.pedalNote'))}</p>`, className: 'keys-dialog' });
}

function zoomStep(sv, d) { sv.querySelector(`.zoom-pill [data-zoom="${d > 0 ? 1 : -1}"]`)?.click(); }

function openSearch() {
  const go = () => { const row = document.getElementById('lSearchRow'); if (row && row.hidden) document.getElementById('lSearchBtn')?.click(); else document.getElementById('lSearch')?.focus(); };
  if (document.getElementById('lSearchBtn')) return go();
  location.hash = '#/pesme';
  let n = 0; const tick = () => { if (document.getElementById('lSearchBtn')) go(); else if (++n < 40) setTimeout(tick, 50); }; tick();
}

function nextSong(d) {
  const items = [...document.querySelectorAll('.two-pane .pane-list .song-item[data-id]')];
  if (!items.length) return false;
  const cur = items.findIndex((li) => li.classList.contains('selected'));
  const k = cur < 0 ? (d > 0 ? 0 : items.length - 1) : cur + d;
  if (k < 0 || k >= items.length) return true;
  location.hash = '#/pesma/' + encodeURIComponent(items[k].dataset.id);
  items[k].scrollIntoView({ block: 'nearest' });
  return true;
}

function onKey(e) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
  if (document.body.classList.contains('stage-mode')) { if (e.key === '?') { e.preventDefault(); showShortcuts(); } return; } // Nastup: svoji tasteri
  if (modalOpen()) return;
  if (e.key === '?') { e.preventDefault(); showShortcuts(); return; }
  if (e.key === '/') { e.preventDefault(); openSearch(); return; }
  const sv = songView();
  if (!sv) return;
  const playing = document.getElementById('sPlay')?.classList.contains('playing');
  if (e.key === ' ' && !e.target.closest?.('button, a')) { e.preventDefault(); document.getElementById('sPlay')?.click(); return; }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && playing) {
    e.preventDefault();
    const r = document.getElementById('sSpeed');
    if (r) { r.value = String(Math.min(10, Math.max(1, +r.value + (e.key === 'ArrowUp' ? 1 : -1)))); r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }
    return;
  }
  if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomStep(sv, 1); return; }
  if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomStep(sv, -1); return; }
  if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.repeat) { if (nextSong(e.key === 'ArrowRight' ? 1 : -1)) e.preventDefault(); return; }
  if (e.key === 'Escape') {
    if (playing) { document.getElementById('sPlay')?.click(); return; }
    if (!document.body.classList.contains('two-pane-mode')) sv.querySelector('.topbar .back')?.click();
  }
}

// Ctrl + točkić (i štipanje na touchpad-u, koje pregledač šalje kao Ctrl + točkić) = veličina teksta pesme, ne cele stranice
let wheelAcc = 0, wheelT = 0;
function onWheel(e) {
  if (!e.ctrlKey) return;
  const sv = songView();
  if (!sv || modalOpen()) return;
  e.preventDefault();
  wheelAcc += e.deltaY;
  clearTimeout(wheelT); wheelT = setTimeout(() => { wheelAcc = 0; }, 250);
  if (Math.abs(wheelAcc) >= 40) { zoomStep(sv, wheelAcc < 0 ? 1 : -1); wheelAcc = 0; }
}

// Prevuci fajl bilo gde u prozor: slika → skeniranje, PDF / .gitara → uvoz (isto kao „+“ → Uvezi)
let dropEl = null, dragN = 0;
const hasFiles = (e) => !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
function dropShow(v) {
  if (v && !dropEl) {
    dropEl = document.createElement('div');
    dropEl.className = 'drop-zone';
    dropEl.innerHTML = `<div class="drop-card"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20h14v-2H5zm7-17-5.5 5.5 1.4 1.4L11 6.8V16h2V6.8l3.1 3.1 1.4-1.4z"/></svg><b>${esc(t('drop.title'))}</b><span>${esc(t('drop.hint'))}</span></div>`;
    document.body.appendChild(dropEl);
  } else if (!v && dropEl) { dropEl.remove(); dropEl = null; }
}
function initDrop() {
  addEventListener('dragenter', (e) => { if (!hasFiles(e) || document.body.classList.contains('stage-mode') || modalOpen()) return; dragN++; dropShow(true); });
  addEventListener('dragover', (e) => { if (hasFiles(e) && dropEl) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  addEventListener('dragleave', () => { if (dragN > 0 && --dragN === 0) dropShow(false); });
  addEventListener('drop', (e) => {
    if (!hasFiles(e) || !dropEl) return;
    e.preventDefault(); dragN = 0; dropShow(false);
    const files = [...e.dataTransfer.files];
    import('./songs.js').then((m) => m.importDropped(files)).catch(() => {});
  });
}

// Računar: jednom kratak savet za mikrofon kad se prvi put otvori ekran koji sluša gitaru (Tuner, Akordi, Vežbe)
function micTip() {
  const check = () => {
    if (!/^#\/(tuner|akordi|vezbe)/.test(location.hash || '#/tuner')) return;
    try { if (localStorage.getItem('gitara-pcmic')) return; localStorage.setItem('gitara-pcmic', '1'); } catch { return; }
    removeEventListener('hashchange', check);
    import('./ui.js').then((u) => setTimeout(() => u.toast(t('mic.pcTip')), 900));
  };
  import('./install.js').then((i) => { if (!i.isComputer()) return; addEventListener('hashchange', check); check(); }).catch(() => {});
}

let on = false;
export function initKeys() {
  if (on) return; on = true;
  document.addEventListener('keydown', onKey);
  addEventListener('wheel', onWheel, { passive: false });
  initDrop();
  micTip();
}
