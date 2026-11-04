// Vežbe: vodoravni vrat gitare (SVG). Crta se jednom; posle se samo menjaju klase (lagano i za slabije telefone).
// Žice: 0 = debela E (gore) … 5 = tanka e (dole) — kao kad gledaš svoju gitaru dok sviraš (isto kao staza).
// Boje prstiju (iste u svim igrama): 1 kažiprst plavo, 2 srednji žuto, 3 domali roze, 4 mali ljubičasto, 0 prazna žica belo.
import { midiName } from './music.js';
import { dn } from './naming.js';

export const OPEN_MIDI = [40, 45, 50, 55, 59, 64]; // E A D G H e
export const noteLabel = (midi) => dn(midiName(midi).name);
/** Prst za prag (prva pozicija: prag 1 → 1. prst …; viši pragovi u istom obrascu od četiri). 0 = prazna žica. */
export const fingerOf = (f) => (f <= 0 ? 0 : ((f - 1) % 4) + 1);
export const FINGER_COLORS = ['#dfe3e8', '#5aa9ff', '#ffd75e', '#ff7cc3', '#b48cff'];

export function createBoard(el, { from = 0, to = 12 } = {}) {
  const W = 340, H = 150, padL = 34, padR = 10, padT = 16, padB = 22;
  let lo = from, hi = to;
  const gx = (f) => padL + ((f - lo + 0.5) / (hi - lo + 1)) * (W - padL - padR); // sredina polja (prazna žica = levo od nultog praga)
  const sy = (s) => padT + (s / 5) * (H - padT - padB);

  function draw() {
    const fx = (f) => padL + ((f - lo) / (hi - lo + 1)) * (W - padL - padR); // linija praga
    let g = '';
    for (let f = lo; f <= hi + 1; f++) g += `<line class="pb-fret${f === 1 && lo <= 1 ? ' nut' : ''}" x1="${fx(f).toFixed(1)}" x2="${fx(f).toFixed(1)}" y1="${padT - 4}" y2="${H - padB + 4}"/>`;
    for (const f of [3, 5, 7, 9, 12, 15, 17]) if (f >= lo && f <= hi) g += f === 12
      ? `<circle class="pb-inlay" cx="${gx(f).toFixed(1)}" cy="${(sy(1) + sy(2)) / 2}" r="3.2"/><circle class="pb-inlay" cx="${gx(f).toFixed(1)}" cy="${(sy(3) + sy(4)) / 2}" r="3.2"/>`
      : `<circle class="pb-inlay" cx="${gx(f).toFixed(1)}" cy="${(sy(2) + sy(3)) / 2}" r="3.2"/>`;
    for (let s = 0; s < 6; s++) g += `<line class="pb-str" x1="${padL - 6}" x2="${W - padR}" y1="${sy(s)}" y2="${sy(s)}" style="stroke-width:${(2.1 - s * 0.28).toFixed(2)}"/>`;
    for (let s = 0; s < 6; s++) g += `<text class="pb-sname" x="7" y="${sy(s) + 3}" text-anchor="middle">${s === 5 ? dn('E').toLowerCase() : dn(midiName(OPEN_MIDI[s]).name)}</text>`;
    for (let f = Math.max(lo, 1); f <= hi; f++) if ([1, 3, 5, 7, 9, 12, 15].includes(f)) g += `<text class="pb-num" x="${gx(f).toFixed(1)}" y="${H - 5}" text-anchor="middle">${f}</text>`;
    el.innerHTML = `<svg class="pboard" viewBox="0 0 ${W} ${H}" role="img">${g}<g class="pb-marks"></g></svg>`;
    marks = el.querySelector('.pb-marks');
  }
  let marks = null;
  draw();

  // Oznake (krugovi) — ponovo se koriste, ne prave se stalno novi
  const pool = new Map(); // key "s:f" → <g>
  function dot(s, f) {
    const key = s + ':' + f;
    let d = pool.get(key);
    if (!d) {
      d = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      d.setAttribute('class', 'pb-dot');
      d.innerHTML = `<circle r="9.5"/><text text-anchor="middle" dy="3.6"></text>`;
      pool.set(key, d);
      marks.appendChild(d);
    }
    d.setAttribute('transform', `translate(${(f === 0 ? padL - 12 : gx(f)).toFixed(1)} ${sy(s)})`);
    return d;
  }

  return {
    /** Prikaži opseg pragova (npr. 0–5 za početnike, 5–9 za više pozicije). */
    setRange(a, b) { if (a === lo && b === hi) return; lo = a; hi = b; pool.clear(); draw(); },
    /** Sledeći cilj svetli zeleno; label = npr. prst (1–4) ili ime note. */
    target(s, f, label = '', finger = fingerOf(f)) {
      marks.querySelectorAll('.pb-dot.target').forEach((x) => x.setAttribute('class', 'pb-dot'));
      if (s == null) return;
      const d = dot(s, f);
      d.setAttribute('class', `pb-dot target fc${finger}`);
      d.querySelector('text').textContent = label;
    },
    /** Posle udarca: 'hit' (tačno) ili 'miss' (promašaj) — kratko, pa nestane. */
    /** Prikaz (boja prsta) + zeleni/crveni prsten oko tačke: kind 'hit' | 'miss' | 'show' */
    mark(s, f, kind, label = '', finger = fingerOf(f), ms = 900) {
      const d = dot(s, f), cls = `pb-dot shown fc${finger} ${kind}`;
      d.setAttribute('class', cls);
      d.querySelector('text').textContent = label;
      clearTimeout(d._t);
      if (ms) d._t = setTimeout(() => { if (d.getAttribute('class') === cls) d.setAttribute('class', 'pb-dot'); }, ms);
    },
    /** Pogrešna nota: bled crveni krug sa brojem praga (nestane posle ~1 s, ili ranije na clearGhost). */
    ghost(s, f) {
      if (f < lo || f > hi) return;
      const d = dot(s, f), cls = 'pb-dot ghost';
      d.setAttribute('class', cls);
      d.querySelector('text').textContent = String(f);
      clearTimeout(d._t);
      d._t = setTimeout(() => { if (d.getAttribute('class') === cls) d.setAttribute('class', 'pb-dot'); }, 1000);
    },
    clearGhost() { marks.querySelectorAll('.pb-dot.ghost').forEach((x) => x.setAttribute('class', 'pb-dot')); },
    /** Sve nevidljivo. */
    clear() { pool.forEach((d) => d.setAttribute('class', 'pb-dot')); },
  };
}
