// SVG prikaz dijagrama akorda.
import { t } from './i18n.js';
import { getVoicings } from './chords.js';
import { dn } from './naming.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Crta dijagram akorda kao SVG string.
 * @param {string} name ime akorda (prikazuje se kako je napisano)
 * @param {object} opts { voicing: index, size: 'sm'|'lg', showName }
 */
// Već nacrtani dijagrami (isti akord se ne crta ponovo pri svakom osvežavanju ekrana)
const cache = new Map();
export function chordSVG(name, opts = {}) {
  const k = [name, opts.voicing || 0, opts.showName !== false, opts.showFingers !== false, !!opts.colorFingers, dn(name), t('diagram.chord', { name: '' })].join('|');
  let svg = cache.get(k);
  if (svg === undefined) {
    svg = drawChordSVG(name, opts);
    if (cache.size > 400) cache.clear();
    cache.set(k, svg);
  }
  return svg;
}

// colorFingers: tačke u bojama prstiju (Vežbe): fc1 plavo, fc2 žuto, fc3 roze, fc4 ljubičasto
function drawChordSVG(name, { voicing = 0, showName = true, showFingers = true, colorFingers = false } = {}) {
  const list = getVoicings(name);
  const v = list[voicing % Math.max(list.length, 1)];
  const W = 100, H = 124;
  const left = 18, top = showName ? 34 : 14, sw = 64 / 5, fh = 17, frets = 5;
  const label = dn(name); // prikaz u izabranom imenovanju (H, Fis, Es / B, F#, Eb)
  let s = `<svg class="chord-svg${colorFingers ? ' fcolors' : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('diagram.chord', { name: label }))}" xmlns="http://www.w3.org/2000/svg">`;
  if (showName) s += `<text x="${W / 2}" y="16" class="cd-name" text-anchor="middle">${esc(label)}</text>`;
  if (!v) {
    s += `<text x="${W / 2}" y="${top + 40}" class="cd-none" text-anchor="middle">${esc(t('diagram.none'))}</text></svg>`;
    return s;
  }
  const base = v.baseFret;
  // Prag 0 (nut) ili oznaka pozicije
  if (base === 1) s += `<rect x="${left - 1}" y="${top - 4}" width="${sw * 5 + 2}" height="4" class="cd-nut"/>`;
  else s += `<text x="${left + sw * 5 + 9}" y="${top + fh * 0.7}" class="cd-pos">${base}</text>`;
  for (let i = 0; i <= frets; i++) s += `<line x1="${left}" x2="${left + sw * 5}" y1="${top + i * fh}" y2="${top + i * fh}" class="cd-fret"/>`;
  for (let i = 0; i < 6; i++) s += `<line x1="${left + i * sw}" x2="${left + i * sw}" y1="${top}" y2="${top + frets * fh}" class="cd-string"/>`;
  // Otvorene / prigušene
  v.frets.forEach((f, i) => {
    const x = left + i * sw, y = top - 9;
    if (f === -1) s += `<path d="M${x - 3.5} ${y - 3.5}L${x + 3.5} ${y + 3.5}M${x + 3.5} ${y - 3.5}L${x - 3.5} ${y + 3.5}" class="cd-mute"/>`;
    else if (f === 0) s += `<circle cx="${x}" cy="${y}" r="3.6" class="cd-open"/>`;
  });
  // Barre
  if (v.barre) {
    const y = top + (v.barre.fret - base + 0.5) * fh;
    const x1 = left + v.barre.from * sw, x2 = left + v.barre.to * sw;
    s += `<rect x="${x1 - 6}" y="${y - 6}" width="${x2 - x1 + 12}" height="12" rx="6" class="cd-dot${colorFingers ? ' fc1' : ''}"/>`;
    if (showFingers) s += `<text x="${(x1 + x2) / 2}" y="${y + 3.6}" class="cd-finger" text-anchor="middle">1</text>`;
  }
  v.frets.forEach((f, i) => {
    if (f <= 0) return;
    if (v.barre && f === v.barre.fret && i >= v.barre.from && i <= v.barre.to) return;
    const x = left + i * sw, y = top + (f - base + 0.5) * fh;
    s += `<circle cx="${x}" cy="${y}" r="6" class="cd-dot${colorFingers && v.fingers[i] ? ' fc' + v.fingers[i] : ''}"/>`;
    if (showFingers && v.fingers[i]) s += `<text x="${x}" y="${y + 3.6}" class="cd-finger" text-anchor="middle">${v.fingers[i]}</text>`;
  });
  s += '</svg>';
  return s;
}

/** Na kom pragu počinje hvat (1 = uz glavu vrata). */
export function shapeBaseFret(name, voicing = 0) {
  const list = getVoicings(name);
  const v = list[voicing % Math.max(list.length, 1)];
  return v ? v.baseFret : 1;
}

/** „‹ Hvat 2 od 3 · 5. prag ›“ — isto u prozoru akorda i u rečniku. */
export function shapeNavHTML(name, voicing) {
  const n = getVoicings(name).length;
  if (n < 2) {
    const base = shapeBaseFret(name, voicing);
    return base > 1 ? `<p class="shape-nav-solo small muted">${esc(t('chord.fretPos', { n: base }))}</p>` : '';
  }
  const i = ((voicing % n) + n) % n;
  const base = shapeBaseFret(name, i);
  const arrow = (d, label, path) => `<button class="icon-btn shape-arrow" data-shape="${d}" aria-label="${esc(label)}" title="${esc(label)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg></button>`;
  return `<div class="shape-nav">
    ${arrow(-1, t('chord.prevShape'), 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z')}
    <div class="shape-lbl"><b>${esc(t('chord.shapeOf', { i: i + 1, n }))}</b>${base > 1 ? `<span>${esc(t('chord.fretPos', { n: base }))}</span>` : ''}</div>
    ${arrow(1, t('chord.nextShape'), 'M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z')}
  </div>`;
}

/** Prevlačenje levo/desno po elementu menja hvat. */
export function onShapeSwipe(el, cb) {
  let sx = 0, sy = 0, on = false;
  el.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; on = true; });
  el.addEventListener('pointerup', (e) => {
    if (!on) return; on = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) cb(dx < 0 ? 1 : -1);
  });
  el.addEventListener('pointercancel', () => { on = false; });
}

export function voicingCount(name) {
  return getVoicings(name).length;
}
