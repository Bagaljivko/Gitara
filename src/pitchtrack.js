// Praćenje tona žice za tuner: počinje na oštrom napadu (trzaj), prati ton dok zvoni i gasi se,
// a ignoriše govor i buku (nestabilan ton ili ton dalje od ~1 polustepena od žica gitare).
import { yin, rms } from './audio.js';

export const GUITAR = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4 (MIDI)

const MIN_LEVEL = 0.0022;      // apsolutni minimum (tiha visoka E žica)
const ONSET_RATIO = 2.0;       // skok glasnoće u odnosu na prethodne kadrove
const FLOOR_MULT_ON = 2.6;     // napad mora biti iznad šuma
const FLOOR_MULT_OFF = 1.5;    // ispod ovoga ton se smatra ugašenim
const STABLE_MS = 200;         // koliko dugo ton mora biti stabilan pre nego što se prikaže
const STABLE_CENTS = 30;       // dozvoljeno odstupanje tokom provere stabilnosti
const MAX_CENTS = 100;         // ~1 polustepen od ciljne žice
const ARM_TIMEOUT = 900;       // posle napada bez stabilnog tona — odustani
const LOST_MS = 260;
const TAIL_RATIO = 0.035;       // prestani da pratiš kada ton padne ~29 dB ispod napada           // koliko dugo sme da nema dobrog očitavanja dok pratimo ton

export class PitchTracker {
  constructor({ a4 = 440 } = {}) {
    this.a4 = a4;
    this.allowed = [0, 1, 2, 3, 4, 5];
    this.reset();
  }

  reset() {
    this.state = 'idle';       // idle | armed | locked
    this.floor = 0;
    this.levels = [];
    this.cands = [];
    this.armedAt = 0;
    this.lastGood = 0;
    this.sid = -1;
    this.recent = [];
    this.muteUntil = 0;
  }

  /** Ograniči na određene žice (ručni režim) ili sve (automatski). */
  setAllowed(ids) { this.allowed = ids; if (this.state === 'locked' && !ids.includes(this.sid)) this.release(); }

  /** Privremeno ignoriši mikrofon (npr. dok aplikacija sama svira referentni ton). */
  mute(ms, now) { this.muteUntil = Math.max(this.muteUntil, now + ms); this.release(); }

  release() { this.state = 'idle'; this.cands = []; this.recent = []; this.sid = -1; }

  target(sid) { return this.a4 * Math.pow(2, (GUITAR[sid] - 69) / 12); }

  /** Najbliža dozvoljena žica i odstupanje u centima, ili null ako je predaleko. */
  classify(freq) {
    let best = -1, bc = Infinity;
    for (const id of this.allowed) {
      const c = 1200 * Math.log2(freq / this.target(id));
      if (Math.abs(c) < Math.abs(bc)) { bc = c; best = id; }
    }
    return Math.abs(bc) <= MAX_CENTS ? { sid: best, cents: bc } : null;
  }

  /**
   * Obradi jedan kadar zvuka.
   * @returns {{state:string, sid:number, freq:number, cents:number}|{state:string}}
   */
  process(buf, sampleRate, now) {
    const level = rms(buf);
    const prev = this.levels.length ? this.levels.reduce((a, b) => a + b, 0) / this.levels.length : level;
    this.levels.push(level);
    if (this.levels.length > 4) this.levels.shift();

    if (now < this.muteUntil) { this.floor = this.floor || level; return { state: 'idle' }; }

    // Procena šuma (samo dok ne pratimo ton)
    if (this.state === 'idle') {
      if (!this.floor) this.floor = level;
      else if (level < this.floor * 2) this.floor = this.floor * 0.93 + level * 0.07;
      else this.floor = this.floor * 0.995 + level * 0.005;
    }
    const onLevel = Math.max(MIN_LEVEL, this.floor * FLOOR_MULT_ON);
    const offLevel = Math.max(MIN_LEVEL * 0.8, this.floor * FLOOR_MULT_OFF);

    const onset = level > onLevel && level > prev * ONSET_RATIO;
    if (onset) {
      // Novi trzaj (i dok pratimo — npr. sledeća žica)
      this.state = 'armed';
      this.armedAt = now;
      this.cands = [];
      this.peak = level;
    }
    if (this.state !== 'idle') this.peak = Math.max(this.peak || 0, level);
    if (this.state === 'idle') return { state: 'idle' };
    if (level < offLevel || level < this.peak * TAIL_RATIO) { this.release(); return { state: 'idle' }; }

    const r = yin(buf, sampleRate, { minFreq: 70, maxFreq: 400 });
    const reading = r && r.prob > 0.88 ? this.classify(r.freq) : null;

    if (this.state === 'armed') {
      if (!reading) {
        this.cands = [];
        if (now - this.armedAt > ARM_TIMEOUT) this.release();
        return { state: this.state === 'armed' ? 'armed' : 'idle' };
      }
      const c = { t: now, sid: reading.sid, freq: r.freq };
      if (this.cands.length) {
        const first = this.cands[0];
        const spread = Math.abs(1200 * Math.log2(c.freq / first.freq));
        if (first.sid !== c.sid || spread > STABLE_CENTS) this.cands = [];
      }
      this.cands.push(c);
      if (this.cands.length >= 3 && now - this.cands[0].t >= STABLE_MS) {
        this.state = 'locked';
        this.sid = c.sid;
        this.recent = this.cands.map((x) => x.freq).slice(-5);
        this.lastGood = now;
      } else {
        if (now - this.armedAt > ARM_TIMEOUT) this.release();
        return { state: this.state === 'armed' ? 'armed' : 'idle' };
      }
    } else if (this.state === 'locked') {
      const med = median(this.recent);
      if (reading && reading.sid === this.sid && Math.abs(1200 * Math.log2(r.freq / med)) < 60) {
        this.recent.push(r.freq);
        if (this.recent.length > 5) this.recent.shift();
        this.lastGood = now;
      } else if (now - this.lastGood > LOST_MS) {
        this.release();
        return { state: 'idle' };
      }
    }
    const freq = median(this.recent);
    return { state: 'locked', sid: this.sid, freq, cents: 1200 * Math.log2(freq / this.target(this.sid)) };
  }
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}
