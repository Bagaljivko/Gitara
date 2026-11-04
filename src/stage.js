// Nastup: setlista preko celog ekrana — veliki tekst, bez menija, ekran ostaje upaljen.
// Dodir uz desnu/levu ivicu = sledeća/prethodna strana; prevlačenje levo/desno = sledeća/prethodna pesma.
// Radi i Bluetooth pedala za okretanje strana (šalje PageDown/PageUp ili strelice).
import { songs as db } from './db.js';
import { getSetlist } from './collections.js';
import { t } from './i18n.js';
import { esc } from './ui.js';
import { transposeSong } from './songformat.js';
import { renderSectionsHTML, fitLyrics } from './songs.js';
import { layoutTabs } from './tabs.js';
import { keepAwake, allowSleep } from './wakelock.js';
import { cleanTuning } from './tunings.js';

const ZOOM_KEY = 'gitara-stage-zoom';
const getZoom = () => { try { return Number(localStorage.getItem(ZOOM_KEY)) || 1.3; } catch { return 1.3; } };
const setZoomPref = (z) => { try { localStorage.setItem(ZOOM_KEY, String(z)); } catch {} };

/** Uđi u nastup (poziva se iz dodira korisnika, da bi ceo ekran bio dozvoljen). */
export function enterStage(setlistId, index = 0) {
  try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch {}
  location.hash = `#/nastup/${encodeURIComponent(setlistId)}?i=${index}`;
}

export async function renderStage(root, setlistId, params) {
  const sl = await getSetlist(setlistId);
  if (!sl) { location.hash = '#/pesme?tab=sl'; return; }
  // samo pesme ove setliste (ne cela biblioteka)
  const all = new Map((await Promise.all(sl.songIds.map((id) => db.get(id).catch(() => null)))).filter(Boolean).map((s) => [s.id, s]));
  const ids = sl.songIds.filter((x) => all.has(x));
  if (!ids.length) { location.hash = '#/setlista/' + encodeURIComponent(setlistId); return; }
  let i = Math.max(0, Math.min(ids.length - 1, Number(params.get('i')) || 0));
  let zoom = getZoom();

  document.body.classList.add('stage-mode');
  keepAwake('stage');
  root.innerHTML = `
  <section class="stage" aria-label="${esc(t('stage.title'))}">
    <header class="stage-bar" id="stBar">
      <button class="icon-btn" id="stExit" aria-label="${t('stage.exit')}" title="${t('stage.exit')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>
      <div class="stage-info"><b id="stTitle"></b><span class="small muted" id="stMeta"></span></div>
      <button class="btn small icon-only" id="stDown" aria-label="${t('song.fontDown')}">A−</button>
      <button class="btn small icon-only" id="stUp" aria-label="${t('song.fontUp')}">A+</button>
    </header>
    <div class="stage-body" id="stBody"></div>
  </section>`;
  const $ = (q) => root.querySelector('#' + q);

  function draw() {
    const s = all.get(ids[i]);
    const capo = s.capo || 0;
    const shapes = transposeSong(s, (s.transpose || 0) - capo);
    const tuning = cleanTuning(s.tuning);
    $('stTitle').textContent = `${i + 1}/${ids.length} · ${s.title}`;
    $('stMeta').textContent = [s.artist, capo ? t('pdf.capo', { n: capo }) : '', tuning !== 'standard' ? t('tuning.' + tuning) : ''].filter(Boolean).join(' · ');
    const next = ids[i + 1] ? all.get(ids[i + 1]) : null;
    $('stBody').innerHTML = `
      <h1 class="stage-h1">${esc(s.title)}</h1>
      <div class="lyrics stage-lyrics" style="--zoom:${zoom}">${renderSectionsHTML(shapes.sections)}</div>
      <div class="stage-end">
        ${next ? `<button class="btn primary big wide" data-go="next">${esc(t('stage.nextSong', { title: next.title }))} ›</button>` : `<p class="muted center">${t('stage.end')}</p>`}
        ${i > 0 ? `<button class="btn wide" data-go="prev">‹ ${t('stage.prev')}</button>` : ''}
      </div>`;
    fitLyrics(root.querySelector('.stage-lyrics'));
    layoutTabs($('stBody'));
    window.scrollTo(0, 0);
    history.replaceState(null, '', `#/nastup/${encodeURIComponent(setlistId)}?i=${i}`);
  }
  const go = (d) => { const k = i + d; if (k < 0 || k >= ids.length) return false; i = k; draw(); return true; };
  const barH = () => $('stBar').offsetHeight;
  const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
  function pageDown() { if (atBottom()) go(1); else window.scrollBy({ top: window.innerHeight * 0.82 - barH(), behavior: 'smooth' }); }
  function pageUp() { if (window.scrollY <= 4) { if (go(-1)) requestAnimationFrame(() => window.scrollTo(0, document.documentElement.scrollHeight)); } else window.scrollBy({ top: -(window.innerHeight * 0.82 - barH()), behavior: 'smooth' }); }
  const setZoom = (d) => { zoom = Math.min(2.4, Math.max(0.9, +(zoom + d).toFixed(2))); setZoomPref(zoom); const l = root.querySelector('.stage-lyrics'); if (l) { l.style.setProperty('--zoom', zoom); fitLyrics(l); layoutTabs($('stBody')); } };

  $('stDown').addEventListener('click', () => setZoom(-0.1));
  $('stUp').addEventListener('click', () => setZoom(0.1));
  $('stExit').addEventListener('click', () => { location.hash = '#/setlista/' + encodeURIComponent(setlistId); });

  // Dodir: ivice listaju strane, sredina sakriva/prikazuje traku. Prevlačenje: druga pesma.
  let sx = 0, sy = 0, st = 0;
  $('stBody').addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; st = performance.now(); });
  $('stBody').addEventListener('pointerup', (e) => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50 && performance.now() - st < 700) go(dx < 0 ? 1 : -1);
  });
  $('stBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (b) return go(b.dataset.go === 'next' ? 1 : -1);
    if (e.target.closest('button, a')) return;
    const x = e.clientX / window.innerWidth;
    if (x > 0.78) pageDown(); else if (x < 0.22) pageUp(); else root.querySelector('.stage').classList.toggle('bar-hidden');
  });
  const onKey = (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (['PageDown', 'ArrowDown', 'ArrowRight', ' '].includes(e.key)) { e.preventDefault(); pageDown(); }
    else if (['PageUp', 'ArrowUp', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); pageUp(); }
    else if (e.key === 'Escape') $('stExit').click();
  };
  document.addEventListener('keydown', onKey);
  const onHash = () => {
    if (location.hash.startsWith('#/nastup/')) return;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onHash);
    document.body.classList.remove('stage-mode');
    allowSleep('stage');
    try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch {}
  };
  window.addEventListener('hashchange', onHash);
  draw();
}
