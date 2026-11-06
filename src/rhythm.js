// Metronom i ritmovi (strumming): biblioteka obrazaca, precizno zakazivanje preko Web Audio i prikaz strelica.
import { audioCtx, click, strum } from './synth.js';
import { t } from './i18n.js';
import { getVoicings } from './chords.js';

export const SIGNATURES = {
  '2/4': { beats: 2, slotsPerBeat: 2, accents: [0] },
  '3/4': { beats: 3, slotsPerBeat: 2, accents: [0] },
  '4/4': { beats: 4, slotsPerBeat: 2, accents: [0] },
  '6/8': { beats: 6, slotsPerBeat: 1, accents: [0, 3] }, // doba = osmina, naglasak na 1 i 4
};

// Koraci: D = dole, U = gore, x = prigušeno, B = samo bas (palac, najdublja žica akorda), - = pauza.
// Jedan znak = jedna osmina (u 6/8 osmina = doba); 16 znakova u 4/4 = šesnaestine. swing: osmine „na i“ kasne (šafl).
export const PATTERNS = [
  // 4/4 — osnovni
  { id: 'folk', sig: '4/4', steps: 'D-DU-UDU', lv: 2, g: 'pop' },
  { id: 'downs', sig: '4/4', steps: 'D-D-D-D-', lv: 1, g: 'basic' },
  { id: 'eighths', sig: '4/4', steps: 'DUDUDUDU', lv: 1, g: 'basic' },
  { id: 'slowpop', sig: '4/4', steps: 'D-D-D-DU', lv: 1, g: 'pop' },
  { id: 'ballad44', sig: '4/4', steps: 'D---D-DU', lv: 1, g: 'ballad' },
  { id: 'pop', sig: '4/4', steps: 'D-DUD-DU', lv: 2, g: 'pop' },
  { id: 'popsync', sig: '4/4', steps: 'D-DU-U-U', lv: 2, g: 'pop' },
  { id: 'rock', sig: '4/4', steps: 'D-DUxUDU', lv: 3, g: 'rock' },
  { id: 'punk', sig: '4/4', steps: 'DDDDDDDD', lv: 2, g: 'rock' },
  { id: 'chuck', sig: '4/4', steps: 'D-xUD-xU', lv: 3, g: 'rock' },
  { id: 'rumba', sig: '4/4', steps: 'D-DUx-DU', lv: 3, g: 'latin' },
  { id: 'reggae', sig: '4/4', steps: '-U-U-U-U', lv: 2, g: 'reggae' },
  { id: 'boomchick', sig: '4/4', steps: 'B-D-B-D-', lv: 2, g: 'country' },
  { id: 'boomchick2', sig: '4/4', steps: 'B-DUB-DU', lv: 3, g: 'country' },
  // 4/4 — šafl (swing)
  { id: 'shuffle', sig: '4/4', steps: 'DUDUDUDU', swing: true, lv: 2, g: 'blues' },
  { id: 'swingballad', sig: '4/4', steps: 'D-DUD-DU', swing: true, lv: 2, g: 'blues' },
  // 4/4 — šesnaestine
  { id: 'pop16', sig: '4/4', steps: 'D-DUx-DU-UDUx-DU', lv: 3, g: 'pop' },
  { id: 'funk16', sig: '4/4', steps: 'DUxUDUDUDUxUDUDU', lv: 3, g: 'funk' },
  { id: 'bossa', sig: '4/4', steps: 'B--DB-D-B--DB-D-', lv: 3, g: 'latin' },
  // 3/4
  { id: 'waltz', sig: '3/4', steps: 'D-DUDU', lv: 2, g: 'waltz' },
  { id: 'slowwaltz', sig: '3/4', steps: 'D-D-D-', lv: 1, g: 'waltz' },
  { id: 'waltzbass', sig: '3/4', steps: 'B-D-D-', lv: 2, g: 'waltz' },
  // 6/8
  { id: 'ballad68', sig: '6/8', steps: 'D-UD-U', lv: 2, g: 'ballad' },
  { id: 'sixdown', sig: '6/8', steps: 'DDDDDD', lv: 1, g: 'ballad' },
  { id: 'sixddu', sig: '6/8', steps: 'DDUDDU', lv: 2, g: 'ballad' },
  // 2/4
  { id: 'march', sig: '2/4', steps: 'D-DU', lv: 1, g: 'basic' },
  { id: 'polka', sig: '2/4', steps: 'B-DU', lv: 2, g: 'country' },
];

/** Koliko mesta ima jedno doba ovog obrasca (2 = osmine, 4 = šesnaestine, 1 = 6/8). */
export function slotsPerBeatOf(p) {
  const sp = SIGNATURES[p && p.sig] || SIGNATURES['4/4'];
  const n = p && p.steps ? p.steps.length / sp.beats : sp.slotsPerBeat;
  return Number.isInteger(n) && n >= 1 ? n : sp.slotsPerBeat;
}

export const patternName = (p) => (p.id && t('pat.' + p.id) !== 'pat.' + p.id ? t('pat.' + p.id) : p.name || t('pat.custom'));

/** Proverava i čisti obrazac (iz pesme, Gemini odgovora ili uvoza). */
export function cleanPattern(p) {
  if (!p || typeof p !== 'object') return null;
  const sig = SIGNATURES[p.sig] ? p.sig : '4/4';
  const steps = String(p.steps || '').toUpperCase().replace(/X/g, 'x').replace(/[^DUxB-]/g, '');
  if (steps.length < 2 || steps.length > 16 || !/[DUxB]/.test(steps)) return null;
  const out = { sig, steps };
  if (p.swing === true && steps.length === SIGNATURES[sig].beats * 2) out.swing = true;
  if (typeof p.id === 'string' && PATTERNS.some((x) => x.id === p.id)) out.id = p.id;
  if (typeof p.name === 'string' && p.name.trim()) out.name = p.name.trim().slice(0, 40);
  return out;
}

/** Oznake doba ispod strelica: „1 & 2 &…“ ili „1 2 3 4 5 6“ za 6/8. */
export function countLabels(p) {
  const sg = SIGNATURES[p.sig] || SIGNATURES['4/4'];
  const and = t('pat.and');
  const k = slotsPerBeatOf(p);
  if (k === 4) return [...p.steps].map((_, i) => (i % 4 === 0 ? String(i / 4 + 1) : i % 4 === 2 ? and : '·'));
  return [...p.steps].map((_, i) => (k === 2 ? (i % 2 ? and : String(i / 2 + 1)) : String(i + 1)));
}

const ARROW = { D: '↓', U: '↑', x: '✕', B: 'B', '-': '·' };
export const arrowOf = (s) => ARROW[s] || '·';

/** HTML prikaz obrasca: strelice sa brojanjem ispod. */
export function patternHTML(p, { compact = false } = {}) {
  const counts = countLabels(p);
  return `<div class="pattern${compact ? ' compact' : ''}${p.steps.length > 8 ? ' p16' : ''}${p.swing ? ' swing' : ''}" aria-label="${p.steps}">${[...p.steps].map((s, i) => `<span class="pstep s-${s === '-' ? 'rest' : s}" data-i="${i}"><b>${arrowOf(s)}</b><i>${counts[i]}</i></span>`).join('')}</div>`;
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
    this.onStep = null;    // (slot, beat|null, accent, info{ bar, countIn, chord }) u trenutku kada se čuje
    this.onTempo = null;   // (bpm) kada trener brzine ubrza
    this.chords = null;    // npr. ['G','C','D','G'] — jedan akord po taktu (inače Em)
    this.countIn = 0;      // broj taktova odbrojavanja (samo klik) pre ritma
    this.trainer = null;   // { step: 5, every: 4, target: 140 } — postepeno ubrzavanje
    this.maxBars = 0;      // > 0: posle toliko taktova sam stane (npr. pregled ritma pesme), pa onEnd()
    this.onEnd = null;
    this.timer = 0;
  }

  get spec() { return SIGNATURES[this.sig] || SIGNATURES['4/4']; }

  start() {
    if (this.running) return;
    const c = audioCtx();
    this.running = true;
    this.ending = false;
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
    this.pendingUi = (this.pendingUi || []).filter(Boolean);
    while (this.next < c.currentTime + 0.12) {
      const i = this.slot % slotsPerBar;
      const barAll = Math.floor(this.slot / slotsPerBar);
      if (this.maxBars && barAll - this.countIn >= this.maxBars) {
        // kraj: ništa više se ne zakazuje; stane kad poslednji udarac odzvoni
        if (!this.ending) {
          this.ending = true;
          const d = Math.max(0, (this.next - c.currentTime) * 1000) + 350;
          this.pendingUi.push(setTimeout(() => { if (this.running) { this.stop(); this.onEnd?.(); } }, d));
        }
        break;
      }
      const countIn = barAll < this.countIn;
      const bar = barAll - this.countIn; // 0 = prvi takt posle odbrojavanja
      // Trener brzine: na početku takta, posle svakih „every“ taktova, dodaj „step“ BPM do cilja
      if (i === 0 && !countIn && bar > 0 && this.trainer && bar % this.trainer.every === 0 && this.bpm < this.trainer.target) {
        this.bpm = Math.min(this.trainer.target, this.bpm + this.trainer.step);
        const b = this.bpm, d = Math.max(0, (this.next - c.currentTime) * 1000);
        this.pendingUi.push(setTimeout(() => this.running && this.onTempo && this.onTempo(b), d));
      }
      const spb = this.pattern ? slotsPerBeatOf(this.pattern) : sp.slotsPerBeat;
      // šafl: osmina „na doba“ traje 2/3 doba, „na i“ 1/3 (triolski osećaj)
      const sw = this.pattern && this.pattern.swing && spb === 2 && !countIn;
      const slotDur = sw ? (60 / this.bpm) * (i % 2 ? 1 / 3 : 2 / 3) : 60 / this.bpm / spb;
      const isBeat = i % spb === 0;
      const beat = isBeat ? Math.floor(i / spb) % sp.beats : null;
      const accent = isBeat && sp.accents.includes(beat) && (beat === 0 || this.sig === '6/8');
      const chord = this.chords && this.chords.length && !countIn ? this.chords[bar % this.chords.length] : null;
      if (isBeat && (this.clicks || countIn)) click(this.next, beat === 0);
      if (this.pattern && !countIn) {
        const s = this.pattern.steps[i];
        const notes = chordNotes(chord);
        if (s === 'D' || s === 'U') strum(this.next, s, { accent: isBeat && beat === 0, notes });
        else if (s === 'B') strum(this.next, 'D', { accent: true, notes: bassOf(notes) });
        else if (s === 'x') strum(this.next, 'D', { mute: true, notes });
      }
      const delay = Math.max(0, (this.next - c.currentTime) * 1000);
      // at = trenutak kada se klik čuje (performance.now()), za proveru „u ritmu“ u Vežbama
      const at = performance.now() + (this.next - c.currentTime + (c.outputLatency || c.baseLatency || 0)) * 1000;
      const info = { bar, countIn, chord, countBeat: countIn ? beat : null, at };
      const id = setTimeout(() => this.running && this.onStep && this.onStep(i, beat, accent, info), delay);
      this.pendingUi.push(id);
      if (this.pendingUi.length > 64) this.pendingUi.splice(0, 32);
      this.next += slotDur;
      this.slot++;
    }
  }
}

/** Bas akorda (najdublja žica koja zvuči) — za „B“ udarac palcem. */
export const bassOf = (notes) => (notes && notes.length ? notes.slice(0, 1) : [82.41]);

// Frekvencije žica za akord (prvi, najlakši hvat); null = podrazumevani Em
const OPEN_MIDI = [40, 45, 50, 55, 59, 64];
const noteCache = new Map();
export function chordNotes(name) {
  if (!name) return null;
  if (noteCache.has(name)) return noteCache.get(name);
  const v = getVoicings(name)[0];
  const out = v ? v.frets.map((f, i) => (f < 0 ? null : 440 * Math.pow(2, (OPEN_MIDI[i] + f - 69) / 12))).filter(Boolean) : null;
  noteCache.set(name, out);
  return out;
}

/**
 * Tap tempo: tapni u ritmu muzike koju slušaš. Vraća { count, bpm }:
 * bpm je null dok ne bude bar 4 dodira (3 razmaka); posle toga se računa iz medijane poslednjih razmaka.
 * Pauza duža od 2,5 s počinje ispočetka.
 */
export const TAP_NEEDED = 4;
export function makeTapTempo() {
  let taps = [];
  return (now = performance.now()) => {
    if (taps.length && now - taps[taps.length - 1] > 2500) taps = [];
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length < TAP_NEEDED) return { count: taps.length, bpm: null };
    const gaps = taps.slice(1).map((x, i) => x - taps[i]).sort((x, y) => x - y);
    const med = gaps[Math.floor(gaps.length / 2)];
    return { count: taps.length, bpm: Math.max(40, Math.min(220, Math.round(60000 / med))) };
  };
}
