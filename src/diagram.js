// SVG prikaz dijagrama akorda.
import { t } from './i18n.js';
import { getVoicings } from './chords.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Crta dijagram akorda kao SVG string.
 * @param {string} name ime akorda (prikazuje se kako je napisano)
 * @param {object} opts { voicing: index, size: 'sm'|'lg', showName }
 */
export function chordSVG(name, { voicing = 0, showName = true, showFingers = true } = {}) {
  const list = getVoicings(name);
  const v = list[voicing % Math.max(list.length, 1)];
  const W = 100, H = 124;
  const left = 18, top = showName ? 34 : 14, sw = 64 / 5, fh = 17, frets = 5;
  let s = `<svg class="chord-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('diagram.chord', { name }))}" xmlns="http://www.w3.org/2000/svg">`;
  if (showName) s += `<text x="${W / 2}" y="16" class="cd-name" text-anchor="middle">${esc(name)}</text>`;
  if (!v) {
    s += `<text x="${W / 2}" y="${top + 40}" class="cd-none" text-anchor="middle">${esc(t('diagram.none'))}</text></svg>`;
    return s;
  }
  const base = v.baseFret;
  // Prag 0 (nut) ili oznaka pozicije
  if (base === 1) s += `<rect x="${left - 1}" y="${top - 4}" width="${sw * 5 + 2}" height="4" class="cd-nut"/>`;
  else s += `<text x="${left + sw * 5 + 5}" y="${top + fh * 0.7}" class="cd-pos">${base}</text>`;
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
    s += `<rect x="${x1 - 6}" y="${y - 6}" width="${x2 - x1 + 12}" height="12" rx="6" class="cd-dot"/>`;
    if (showFingers) s += `<text x="${(x1 + x2) / 2}" y="${y + 3.6}" class="cd-finger" text-anchor="middle">1</text>`;
  }
  v.frets.forEach((f, i) => {
    if (f <= 0) return;
    if (v.barre && f === v.barre.fret && i >= v.barre.from && i <= v.barre.to) return;
    const x = left + i * sw, y = top + (f - base + 0.5) * fh;
    s += `<circle cx="${x}" cy="${y}" r="6" class="cd-dot"/>`;
    if (showFingers && v.fingers[i]) s += `<text x="${x}" y="${y + 3.6}" class="cd-finger" text-anchor="middle">${v.fingers[i]}</text>`;
  });
  s += '</svg>';
  return s;
}

export function voicingCount(name) {
  return getVoicings(name).length;
}
