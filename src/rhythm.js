// Metronom i ritmovi (strumming): biblioteka obrazaca, precizno zakazivanje preko Web Audio i prikaz strelica.
import { audioCtx, click, strum } from './synth.js';
import { t } from './i18n.js';

export const SIGNATURES = {
  '2/4': { beats: 2, slotsPerBeat: 2, accents: [0] },
  '3/4': { beats: 3, slotsPerBeat: 2, accents: [0] },
  '4/4': { beats: 4, slotsPerBeat: 2, accents: [0] },
  '6/8': { beats: 6, slotsPerBeat: 1, accents: [0, 3] }, // doba = osmina, naglasak na 1 i 4
};

// Koraci: D = dole, U = gore, x = prigušeno, - = pauza. Jedan znak = jedna osmina.
export const PATTERNS = [
  { id: 'folk', sig: '4/4', steps: 'D-DU-UDU' },
  { id: 'downs', sig: '4/4', steps: 'D-D-D-D-' },
  { id: 'eighths', sig: '4/4', steps: 'DUDUDUDU' },
  { id: 'rock', sig: '4/4', steps: 'D-DUxUDU' },
  { id: 'reggae', sig: '4/4', steps: '-U-U-U-U' },
  { id: 'waltz', sig: '3/4', steps: 'D-DUDU' },
  { id: 'ballad68', sig: '6/8', steps: 'D-UD-U' },
  { id: 'march', sig: '2/4', steps: 'D-DU' },
];

export const patternName = (p) => (p.id && t('pat.' + p.id) !== 'pat.' + p.id ? t('pat.' + p.id) : p.name || t('pat.custom'));

/** Proverava i čisti obrazac (iz pesme, Gemini odgovora ili uvoza). */
export function cleanPattern(p) {
  if (!p || typeof p !== 'object') return null;
  const sig = SIGNATURES[p.sig] ? p.sig : '4/4';
  const steps = String(p.steps || '').toUpperCase().replace(/X/g, 'x').replace(/[^DUx-]/g, '');
  if (steps.length < 2 || steps.length > 16 || !/[DUx]/.test(steps)) return null;
  const out = { sig, steps };
  if (typeof p.id === 'string' && PATTERNS.some((x) => x.id === p.id)) out.id = p.id;
  if (typeof p.name === 'string' && p.name.trim()) out.name = p.name.trim().slice(0, 40);
  return out;
}

/** Oznake doba ispod strelica: „1 & 2 &…“ ili „1 2 3 4 5 6“ za 6/8. */
export function countLabels(p) {
  const sg = SIGNATURES[p.sig] || SIGNATURES['4/4'];
  return [...p.steps].map((_, i) => (sg.slotsPerBeat === 2 ? (i % 2 ? '&' : String(i / 2 + 1)) : String(i + 1)));
}

const ARROW = { D: '↓', U: '↑', x: '✕', '-': '·' };
export const arrowOf = (s) => ARROW[s] || '·';

/** HTML prikaz obrasca: strelice sa brojanjem ispod. */
export function patternHTML(p, { compact = false } = {}) {
  const counts = countLabels(p);
  return `<div class="pattern${compact ? ' compact' : ''}" aria-label="${p.steps}">${[...p.steps].map((s, i) => `<span class="pstep s-${s === '-' ? 'rest' : s}" data-i="${i}"><b>${arrowOf(s)}</b><i>${counts[i]}</i></span>`).join('')}</div>`;
}

/** Tekstualni prikaz za PDF: dva reda (strelice, brojanje). */
export function patternText(p) {
  const counts = countLabels(p);
  return { arrows: [...p.steps].map((s) => arrowOf(s).padEnd(2)).join(''), counts: counts.map((c) => c.padEnd(2)).join('') };
}

/**
 * Precizan metronom (Web Audio „lookahead“ zakazivanje — ne „pliva“ kao setInterval).
 * onStep(slotIndex, beatIndex|null, isAccent) se poziva u trenutku kada se zvuk čuje.
 */
export class Metronome {
  constructor() {
    this.bpm = 90;
    this.sig = '4/4';
    this.pattern = null;   // ako je zadat, svira se i udarac preko žica
    this.clicks = true;
    this.running = false;
    this.onStep = null;
    this.timer = 0;
  }

  get spec() { return SIGNATURES[this.sig] || SIGNATURES['4/4']; }

  start() {
    if (this.running) return;
    const c = audioCtx();
    this.running = true;
    this.slot = 0;
    this.next = c.currentTime + 0.08;
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.pendingUi?.forEach(clearTimeout);
    this.pendingUi = [];
  }

  schedule() {
    const c = audioCtx();
    const sp = this.spec;
    const slotsPerBar = this.pattern ? this.pattern.steps.length : sp.beats * sp.slotsPerBeat;
    const slotDur = 60 / this.bpm / sp.slotsPerBeat;
    this.pendingUi = (this.pendingUi || []).filter(Boolean);
    while (this.next < c.currentTime + 0.12) {
      const i = this.slot % slotsPerBar;
      const isBeat = i % sp.slotsPerBeat === 0;
      const beat = isBeat ? Math.floor(i / sp.slotsPerBeat) % sp.beats : null;
      const accent = isBeat && sp.accents.includes(beat) && (beat === 0 || this.sig === '6/8');
      if (isBeat && this.clicks) click(this.next, beat === 0);
      if (this.pattern) {
        const s = this.pattern.steps[i];
        if (s === 'D' || s === 'U') strum(this.next, s, { accent: isBeat && beat === 0 });
        else if (s === 'x') strum(this.next, 'D', { mute: true });
      }
      const delay = Math.max(0, (this.next - c.currentTime) * 1000);
      const id = setTimeout(() => this.running && this.onStep && this.onStep(i, beat, accent), delay);
      this.pendingUi.push(id);
      if (this.pendingUi.length > 64) this.pendingUi.splice(0, 32);
      this.next += slotDur;
      this.slot++;
    }
  }
}

/** Tap tempo: vraća BPM iz poslednjih dodira (ili null). */
export function makeTapTempo() {
  let taps = [];
  return () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps.push(now);
    if (taps.length > 5) taps.shift();
    if (taps.length < 2) return null;
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    return Math.max(40, Math.min(220, Math.round(60000 / avg)));
  };
}
