// Biranje tonaliteta: kvintni krug koji se okreće prstom (dur spolja, paralelni mol iznutra).
// Izabrani tonalitet je gore. Zvezdica = svi akordi ove pesme su tada laki otvoreni hvatovi.
// Za teže tonalitete predlaže put sa kapodasterom. Predlozi su samo saveti — primenjuju se tek na dodir.
import { t } from './i18n.js';
import { esc } from './ui.js';
import { dn } from './naming.js';
import { CIRCLE, keyName } from './chordnames.js';
import { transposeSong, songChords } from './songformat.js';
import { shapeCost } from './suggest.js';
import { chordNotes } from './rhythm.js';
import { audioCtx, strum, stopGroup } from './synth.js';

/** Pomeraj u opsegu −5…+6 (G→A = +2, G→F = −2). */
export const offsetIn = (o) => { const x = ((o % 12) + 12) % 12; return x > 6 ? x - 12 : x; };

/** Koliko su laki hvatovi pesme pri datom pomeraju (bez kapodastera). */
export function friendliness(song, o) {
  const shapes = [...new Set(songChords(transposeSong(song, o)).map((c) => c.replace(/\/.*/, '')))];
  if (!shapes.length) return { open: true, cost: 0, max: 0 };
  const costs = shapes.map(shapeCost);
  const max = Math.max(...costs);
  return { open: max <= 2, cost: costs.reduce((a, b) => a + b, 0), max };
}

/** Put sa kapodasterom za tonalitet sa pomerajem o: najmanji kapodaster uz koji su svi hvatovi laki. */
export function capoRoute(song, o) {
  for (let c = 1; c <= 7; c++) if (friendliness(song, o - c).open) return { capo: c, shapesOffset: o - c };
  return null;
}

/** 2–3 predloga: najbliži tonaliteti originalu sa lakim hvatovima (ili put sa kapodasterom). */
export function keySuggestions(song, current, limit = 3) {
  const out = [];
  for (let o = -5; o <= 6; o++) {
    if (o === current) continue;
    const f = friendliness(song, o);
    if (f.open) out.push({ o, capo: 0, rank: Math.abs(o) });
    else { const r = capoRoute(song, o); if (r) out.push({ o, capo: r.capo, shapesOffset: r.shapesOffset, rank: Math.abs(o) + 0.5 + r.capo * 0.1 }); }
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, limit);
}

/**
 * Otvori točak. opts: { song (radni sloj, sa keyN), tp, capo, onPick(tp, capo|undefined) }.
 */
export function openKeyWheel({ song, tp, capo, onPick }) {
  const base = song.keyN || { root: 0, minor: false };
  const minor = !!base.minor;
  const majorOf = (root) => (minor ? (root + 3) % 12 : root);
  const origIdx = CIRCLE.indexOf(majorOf(base.root));
  const keyAt = (idx) => ({ root: minor ? (CIRCLE[idx] + 9) % 12 : CIRCLE[idx], minor });
  const offsetOf = (idx) => offsetIn((minor ? (CIRCLE[idx] + 9) % 12 : CIRCLE[idx]) - base.root);
  const idxOf = (o) => CIRCLE.indexOf(majorOf((base.root + o + 120) % 12));
  const label = (k) => dn(keyName(k, 'en'));
  const fr = CIRCLE.map((_, i) => friendliness(song, offsetOf(i)));
  let sel = idxOf(tp);
  let stopPreview = () => {}; // pravi se ispod, uz dugme ▶
  let rot = -sel * 30; // stepeni

  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  const R = 150, rOut = 116, rIn = 76;
  const seg = (i, r1, r2) => {
    const a1 = ((i * 30 - 15 - 90) * Math.PI) / 180, a2 = ((i * 30 + 15 - 90) * Math.PI) / 180;
    const p = (r, a) => `${(R + r * Math.cos(a)).toFixed(1)},${(R + r * Math.sin(a)).toFixed(1)}`;
    return `M${p(r2, a1)} A${r2},${r2} 0 0 1 ${p(r2, a2)} L${p(r1, a2)} A${r1},${r1} 0 0 0 ${p(r1, a1)} Z`;
  };
  const pos = (i, r) => { const a = ((i * 30 - 90) * Math.PI) / 180; return [R + r * Math.cos(a), R + r * Math.sin(a)]; };
  const ring = CIRCLE.map((root, i) => {
    const [ox, oy] = pos(i, rOut), [ix, iy] = pos(i, rIn), [sx, sy] = pos(i, rOut + 26);
    const maj = { root, minor: false }, mi = { root: (root + 9) % 12, minor: true };
    return `<g class="kw-key${i === origIdx ? ' orig' : ''}" data-i="${i}">
      <path class="kw-seg out" d="${seg(i, 96, 138)}"/><path class="kw-seg in" d="${seg(i, 56, 96)}"/>
      ${i === origIdx ? `<path class="kw-orig" d="${seg(i, 56, 138)}"/>` : ''}
      <text class="kw-lbl maj${minor ? '' : ' mode'}" x="${ox}" y="${oy}" data-x="${ox}" data-y="${oy}">${esc(label(maj))}</text>
      <text class="kw-lbl min${minor ? ' mode' : ''}" x="${ix}" y="${iy}" data-x="${ix}" data-y="${iy}">${esc(label(mi))}</text>
      ${fr[i].open ? `<text class="kw-star" x="${sx}" y="${sy}" data-x="${sx}" data-y="${sy}">★</text>` : ''}
    </g>`;
  }).join('');

  wrap.innerHTML = `<div class="modal kw-modal" role="dialog" aria-modal="true" aria-label="${esc(t('kw.title'))}">
    <div class="kw-top"><h2 class="modal-title">${t('kw.title')}</h2>
      <button class="icon-btn kw-x" data-a="done" aria-label="${t('common.close')}" title="${t('common.close')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button></div>
    <div class="kw-chips" id="kwChips"></div>
    <div class="kw-wheel-wrap">
      <svg class="kw-wheel" viewBox="0 -24 300 324" id="kwSvg" aria-hidden="true">
        <g id="kwRot" style="transform-origin:150px 150px">${ring}</g>
        <circle cx="150" cy="150" r="54" class="kw-hub"/>
        <path d="M150 -14 l-9 -10 h18 z" class="kw-pointer"/>
      </svg>
      <button class="kw-hub-btn" id="kwPlay" aria-label="${t('kw.preview')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
    </div>
    <div class="kw-info" aria-live="polite">
      <div class="kw-step"><button class="btn round small" id="kwDown" aria-label="${t('kw.down')}">−1</button><b id="kwName"></b><button class="btn round small" id="kwUp" aria-label="${t('kw.up')}">+1</button></div>
      <span id="kwDelta" class="small muted"></span><p id="kwHint" class="small"></p></div>
    <p class="small muted kw-legend">★ ${t('kw.legendStar')} · <span class="kw-orig-sw"></span> ${t('kw.legendOrig', { k: label(base) })}</p>
    <label class="small kw-select">${t('kw.list')}
      <select id="kwSelect">${CIRCLE.map((_, i) => `<option value="${i}">${esc(label(keyAt(i)))}${fr[i].open ? ' ★' : ''}${i === origIdx ? ' · ' + esc(t('kw.origShort')) : ''}</option>`).join('')}</select>
    </label>
    <div class="modal-actions">
      <button class="btn" data-a="orig" id="kwOrig"></button>
      <button class="btn primary" data-a="done" id="kwUse"></button>
    </div></div>`;
  wrap.__close = () => close(); // dugme „nazad“ zatvara točak (izabrani tonalitet ostaje)
  document.body.appendChild(wrap);
  const $ = (id) => wrap.querySelector('#' + id);
  const g = $('kwRot');

  function applyRotation(animate) {
    g.style.transition = animate ? 'transform .28s cubic-bezier(.2,.9,.3,1.2)' : 'none';
    g.style.transform = `rotate(${rot}deg)`;
    // natpisi ostaju uspravni
    wrap.querySelectorAll('.kw-lbl, .kw-star').forEach((el) => {
      el.style.transition = g.style.transition;
      el.style.transformOrigin = `${el.dataset.x}px ${el.dataset.y}px`;
      el.style.transform = `rotate(${-rot}deg)`;
    });
  }
  function drawInfo() {
    const o = offsetOf(sel);
    const k = keyAt(sel);
    wrap.querySelectorAll('.kw-key').forEach((el) => el.classList.toggle('sel', +el.dataset.i === sel));
    $('kwName').textContent = label(k);
    $('kwDelta').textContent = o === 0 ? t('kw.isOrig') : t('kw.delta', { n: (o > 0 ? '+' : '−') + Math.abs(o) });
    let hint = '';
    if (fr[sel].open) hint = t('kw.allOpen');
    else {
      const r = capoRoute(song, o);
      hint = r ? t('kw.capoRoute', { k: label(k), c: r.capo, s: label({ root: (base.root + r.shapesOffset + 120) % 12, minor }) }) : t('kw.barre');
    }
    $('kwHint').textContent = hint;
    $('kwSelect').value = String(sel);
    // Dugmad govore šta rade: tonalitet se menja odmah, ovim se samo zatvara prozor
    $('kwUse').textContent = t('kw.use', { k: label(k) });
    $('kwOrig').textContent = t('kw.origBtn', { k: label(base) });
    $('kwOrig').disabled = o === 0;
    // Predlozi (čipovi)
    $('kwChips').innerHTML = keySuggestions(song, o).map((s) => {
      const k2 = { root: (base.root + s.o + 120) % 12, minor };
      const reason = s.capo ? t('kw.chipCapo', { c: s.capo, s: label({ root: (base.root + s.shapesOffset + 120) % 12, minor }) }) : t('kw.chipOpen');
      return `<button class="kw-chip" data-o="${s.o}" data-c="${s.capo}"><b>${esc(label(k2))}</b><span>${esc(reason)}</span></button>`;
    }).join('');
  }
  const pick = (i, animate = true) => {
    stopPreview();
    const was = sel;
    sel = ((i % 12) + 12) % 12;
    // najkraći put rotacije do novog položaja
    let target = -sel * 30;
    while (target - rot > 180) target -= 360;
    while (rot - target > 180) target += 360;
    rot = target;
    applyRotation(animate);
    drawInfo();
    if (was !== sel) { try { navigator.vibrate && navigator.vibrate(8); } catch {} onPick(offsetOf(sel)); }
  };

  // ---- Okretanje prstom ----
  const svg = $('kwSvg');
  let drag = null;
  const angleAt = (e) => { const r = svg.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + (r.height * 174) / 324; return (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI; };
  svg.addEventListener('pointerdown', (e) => {
    drag = { a0: angleAt(e), rot0: rot, x: e.clientX, y: e.clientY, moved: false, lastIdx: sel };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    let d = angleAt(e) - drag.a0;
    if (d > 180) d -= 360; if (d < -180) d += 360;
    if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 6) { drag.moved = true; stopPreview(); }
    if (!drag.moved) return;
    rot = drag.rot0 + d;
    applyRotation(false);
    const idx = ((Math.round(-rot / 30) % 12) + 12) % 12;
    if (idx !== drag.lastIdx) { drag.lastIdx = idx; try { navigator.vibrate && navigator.vibrate(6); } catch {} wrap.querySelectorAll('.kw-key').forEach((el) => el.classList.toggle('sel', +el.dataset.i === idx)); }
  });
  const end = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) {
      // dodir na tonalitet → okreni ga gore
      const k = e.target.closest && e.target.closest('.kw-key');
      if (k) pick(+k.dataset.i);
      return;
    }
    pick(Math.round(-rot / 30)); // „škljocne“ na najbliži
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  // ---- Pregled zvuka: prvih nekoliko akorda u izabranom tonalitetu ----
  // Svaki pokret točka (ili ponovni dodir na ▶/■) odmah prekida pregled, da se zvuci ne preklapaju.
  const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  const STOP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z"/></svg>';
  let previewTimer = 0, previewing = false;
  stopPreview = () => {
    if (!previewing) return;
    previewing = false;
    clearTimeout(previewTimer);
    stopGroup('kw-preview');
    const b = $('kwPlay');
    if (b) { b.classList.remove('playing'); b.innerHTML = PLAY_ICON; b.setAttribute('aria-label', t('kw.preview')); }
  };
  $('kwPlay').addEventListener('click', () => {
    if (previewing) { stopPreview(); return; }
    const sounding = songChords(transposeSong(song, offsetOf(sel))).slice(0, 4);
    if (!sounding.length) return;
    const c = audioCtx();
    let tt = c.currentTime + 0.08;
    for (const ch of sounding) { strum(tt, 'D', { notes: chordNotes(ch), group: 'kw-preview' }); tt += 0.95; }
    previewing = true;
    const b = $('kwPlay');
    b.classList.add('playing'); b.innerHTML = STOP_ICON; b.setAttribute('aria-label', t('kw.stopPreview'));
    previewTimer = setTimeout(() => { previewing = true; stopPreview(); }, sounding.length * 950 + 2400);
  });
  $('kwSelect').addEventListener('change', (e) => pick(+e.target.value));
  $('kwDown').addEventListener('click', () => pick(idxOf(offsetIn(offsetOf(sel) - 1))));
  $('kwUp').addEventListener('click', () => pick(idxOf(offsetIn(offsetOf(sel) + 1))));
  wrap.addEventListener('click', (e) => {
    const chip = e.target.closest('.kw-chip');
    if (chip) { const o = +chip.dataset.o, c = +chip.dataset.c; pick(idxOf(o)); if (c) onPick(o, c); return; }
    const a = e.target.closest('[data-a]');
    if (e.target === wrap || (a && a.dataset.a === 'done')) { close(); return; }
    if (a && a.dataset.a === 'orig') pick(origIdx);
  });
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') pick(sel + 1);
    else if (e.key === 'ArrowLeft') pick(sel - 1);
  };
  document.addEventListener('keydown', onKey);
  function close() { stopPreview(); wrap.remove(); document.removeEventListener('keydown', onKey); }
  applyRotation(false);
  drawInfo();
  return { setOffset(o) { pick(idxOf(o)); }, close };
}
