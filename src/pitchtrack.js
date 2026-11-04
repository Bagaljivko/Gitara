// Praćenje tona žice za tuner.
// - Prag jačine se prilagođava prostoriji: prve sekunde se meri pozadinska buka, prag je malo iznad nje.
// - Prvo očitavanje se prikazuje odmah (posle ~2 kadra), a tek stabilan ton (~100 ms) sme da označi žicu zelenom.
// - Ton se prati dok zvoni i gasi se; govor i buka se odbijaju po nestabilnosti visine i udaljenosti od žica.
import { yin, rms } from './audio.js';

export const GUITAR = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4 (MIDI)

/** Tri nivoa osetljivosti. Visoka: tihe gitare i tihe sobe. Niska: bučna mesta. */
export const SENSITIVITY = {
  low: { onMult: 4.0, offMult: 2.0, minLevel: 0.0025, prob: 0.88, window: 100, tail: 0.03, lostMs: 300 },
  medium: { onMult: 2.4, offMult: 1.4, minLevel: 0.0011, prob: 0.82, window: 150, tail: 0.012, lostMs: 450 },
  high: { onMult: 1.7, offMult: 1.2, minLevel: 0.0006, prob: 0.78, window: 180, tail: 0.006, lostMs: 600 },
};

// „Auto“: osetljivost se bira sama prema izmerenoj buci u sobi i stalno se prilagođava.
// Tiha soba → kao „Visoka“, uobičajena → „Srednja“, bučna → „Niska“ (glatko između, po logaritmu buke).
const AUTO_QUIET = 0.00025, AUTO_NORMAL = 0.0007, AUTO_NOISY = 0.0025; // RMS nivo buke
// U tihoj sobi: pragovi jačine kao „Visoka“ (čuje i tihe žice), ali filtriranje govora kao „Srednja“
const AUTO_QUIET_CFG = { ...SENSITIVITY.medium, onMult: SENSITIVITY.high.onMult, offMult: SENSITIVITY.high.offMult, minLevel: SENSITIVITY.high.minLevel, tail: SENSITIVITY.high.tail };
export function autoConfig(floor) {
  const l = Math.log(Math.max(floor, 1e-6));
  const a = Math.log(AUTO_QUIET), m = Math.log(AUTO_NORMAL), z = Math.log(AUTO_NOISY);
  const [from, to, k] = l <= m
    ? [AUTO_QUIET_CFG, SENSITIVITY.medium, Math.max(0, Math.min(1, (l - a) / (m - a)))]
    : [SENSITIVITY.medium, SENSITIVITY.low, Math.max(0, Math.min(1, (l - m) / (z - m)))];
  const out = {};
  for (const key of Object.keys(from)) out[key] = from[key] + (to[key] - from[key]) * k;
  return out;
}

const CALIBRATE_MS = 1000;   // merenje buke u prostoriji na početku
const ONSET_RATIO = 1.8;     // skok jačine koji se računa kao trzaj
const ARM_MS = 300;          // posle trzaja ovoliko čekamo prvi jasan ton
const SHOW_FRAMES = 2;       // dva saglasna očitavanja → kazaljka se pomera
const STABLE_MS = 100;       // ovoliko dugo stabilan ton → sme da se označi kao naštimovan
const STABLE_CENTS = 20;     // dozvoljeno kolebanje visine dok se proverava stabilnost
const JUMP_CENTS = 60;       // veći skok = nova nota (npr. druga žica)
const UNSTABLE_MS = 500;     // prozor za proveru „klizanja“ (govor, pevanje)
const UNSTABLE_BREAKS = 3;   // ovoliko prekida stabilnosti u prozoru = nije žica

export class PitchTracker {
  constructor({ a4 = 440, sensitivity = 'auto' } = {}) {
    this.a4 = a4;
    this.allowed = [0, 1, 2, 3, 4, 5];
    this.strings = GUITAR;
    this.setSensitivity(sensitivity);
    this.reset();
  }

  setSensitivity(level) {
    this.auto = !SENSITIVITY[level]; // 'auto' (i sve nepoznato) = sama bira
    this.level = this.auto ? 'auto' : level;
    this.cfg = this.auto ? SENSITIVITY.medium : SENSITIVITY[level];
  }

  reset() {
    this.state = 'idle';
    this.floor = 0;
    this.calib = [];
    this.calibStart = 0;
    this.calibDone = false;
    this.room = 0; this.roomCalib = []; this.autoFloor = -1; // „Auto“: buka sobe bez tonova sa visinom
    this.hist = [];
    this.release();
    this.muteUntil = 0;
  }

  release() { this.state = 'idle'; this.sid = -1; this.recent = []; this.run = []; this.peak = 0; this.lastGood = 0; this.breaks = []; this.shown = false; this.lastLevel = 0; }

  /** Merenje buke je u toku (prva sekunda). */
  get calibrating() { return !this.calibDone; }

  setAllowed(ids) { this.allowed = ids; if (this.sid >= 0 && !ids.includes(this.sid)) this.release(); }

  /** Privremeno ignoriši mikrofon (npr. dok aplikacija sama svira referentni ton). */
  mute(ms, now) { this.muteUntil = Math.max(this.muteUntil, now + ms); this.release(); }

  /** Druga štimovanja (npr. Drop D): MIDI brojevi šest žica. */
  setTuning(midi) { this.strings = midi && midi.length === 6 ? midi : GUITAR; this.release(); }

  target(sid) { return this.a4 * Math.pow(2, (this.strings[sid] - 69) / 12); }

  classify(freq) {
    let best = -1, bc = Infinity;
    for (const id of this.allowed) {
      const c = 1200 * Math.log2(freq / this.target(id));
      if (Math.abs(c) < Math.abs(bc)) { bc = c; best = id; }
    }
    return Math.abs(bc) <= this.cfg.window ? { sid: best, cents: bc } : null;
  }

  /** Prilagodljiv nivo buke: brzo prati pad, sporo rast (da glasna nota ne podigne prag). */
  updateFloor(level, now) {
    if (!this.calibStart) this.calibStart = now;
    if (!this.calibDone) {
      // Tipična tišina u sobi (60. percentil — vrhovi poput kucanja ne podižu prag)
      // Dok zvoni nota, ne računaj je kao buku.
      if (this.state === 'idle') {
        this.calib.push(level);
        const s = [...this.calib].sort((a, b) => a - b);
        this.floor = s[Math.floor(s.length * 0.6)];
      }
      if (now - this.calibStart >= CALIBRATE_MS) this.calibDone = true;
      return;
    }
    if (this.state !== 'idle') return;
    this.floor = level < this.floor ? this.floor * 0.9 + level * 0.1 : this.floor * 0.997 + level * 0.003;
  }

  /**
   * „Auto“: koliko je soba bučna, mereno samo iz zvuka BEZ jasne visine (ventilator, saobraćaj, žamor).
   * Žica koja zvoni ima jasnu visinu, pa se ne računa kao buka — inače bi tuner, pokrenut dok žica
   * još zvoni, nekoliko sekundi bio prestrog.
   */
  updateRoom(buf, sampleRate, level, now) {
    if (this.state !== 'idle') return;
    // Lagano: svaki treći kadar, na 4× manjoj rezoluciji (dovoljno da se razlikuje „ton“ od „šuma“);
    // na slabijim telefonima to je ~16 puta manje računanja nego puna provera.
    if ((this.roomTick = (this.roomTick || 0) + 1) % 3 && this.calibDone) return;
    const lp = this.lowpass(buf, sampleRate), D = 4;
    const n = Math.floor(lp.length / D);
    if (!this.dec || this.dec.length !== n) this.dec = new Float32Array(n);
    for (let i = 0; i < n; i++) this.dec[i] = lp[i * D];
    const y = yin(this.dec, sampleRate / D, { minFreq: 70, maxFreq: 420 });
    if (y && y.prob >= 0.5) return; // ton sa visinom — nije buka sobe
    if (!this.calibDone) {
      this.roomCalib.push(level);
      const s = [...this.roomCalib].sort((a, b) => a - b);
      this.room = s[Math.floor(s.length * 0.6)];
    } else {
      this.room = level < this.room ? this.room * 0.9 + level * 0.1 : this.room * 0.997 + level * 0.003;
    }
    if (this.room !== this.autoFloor) { this.autoFloor = this.room; this.cfg = autoConfig(this.room); }
  }

  /**
   * Obradi jedan kadar zvuka.
   * @returns {{state:'idle'}|{state:'tracking', sid, freq, cents, stable:boolean}}
   */
  process(buf, sampleRate, now) {
    const level = rms(buf);
    if (now < this.muteUntil) return { state: 'idle' };
    this.updateFloor(level, now);
    if (this.auto) this.updateRoom(buf, sampleRate, level, now);
    const cfg = this.cfg;
    const onLevel = Math.max(cfg.minLevel, this.floor * cfg.onMult);
    const offLevel = Math.max(cfg.minLevel * 0.7, this.floor * cfg.offMult);

    const hist = this.hist;
    const before = hist.length ? Math.min(...hist) : 0;
    hist.push(level);
    if (hist.length > 6) hist.shift();
    if (this.state === 'idle') {
      if (level < onLevel || this.calibrating && now - this.calibStart < 300) return { state: 'idle' };
      // Trzaj žice = nagao skok jačine u odnosu na poslednjih ~120 ms (nezavisno od same glasnoće).
      if (level < before * ONSET_RATIO) return { state: 'idle' };
      this.state = 'listening';
      this.onsetAt = now;
      this.peak = level;
    }
    // Posle trzaja mora brzo da se pojavi jasan ton žice; inače (govor, kucanje) čekaj sledeći trzaj.
    if (!this.shown && now - this.onsetAt > ARM_MS) { this.release(); return { state: 'idle' }; }
    this.peak = Math.max(this.peak, level);
    // Ton se ugasio (ispod buke ili daleko ispod početne jačine)
    if (level < offLevel || level < this.peak * cfg.tail) { this.release(); return { state: 'idle' }; }

    const r = yin(this.lowpass(buf, sampleRate), sampleRate, { minFreq: 70, maxFreq: 420 });
    const prevLevel = this.lastLevel;
    this.lastLevel = level;
    let freq = r && r.prob > cfg.prob ? r.freq : 0;
    // Dok nota zvoni i slabi, YIN ponekad skoči oktavu dole/gore. Ako je očitavanje
    // tačno 1/2, 1/3, 2… od tona koji već pratimo, to je ista nota — ispravi ga.
    if (freq && this.sid >= 0 && this.recent.length) {
      const ref = median(this.recent);
      for (const k of [0.5, 1 / 3, 0.25, 2]) {
        if (Math.abs(1200 * Math.log2((freq / k) / ref)) < 35) { freq /= k; break; }
      }
    }
    let reading = freq ? this.classify(freq) : null;
    // Nova nota (druga žica ili velik skok) se prihvata samo uz novi trzaj (skok jačine);
    // bez toga je to šum u repu tona ili govor preko gitare — preskoči očitavanje.
    if (reading && this.sid >= 0 && this.recent.length) {
      const jump = reading.sid !== this.sid || Math.abs(1200 * Math.log2(freq / median(this.recent))) > JUMP_CENTS;
      if (jump) {
        if (level > prevLevel * 1.5 || now - this.lastGood > cfg.lostMs) {
          this.recent = [];
          this.run = [];
          this.shown = false;
          this.onsetAt = now;
          this.peak = level;
        } else reading = null;
      }
    }
    if (!reading) {
      if (this.sid >= 0 && now - this.lastGood <= cfg.lostMs) return this.shown ? this.output(now) : { state: 'idle' }; // kratak prekid — zadrži
      if (this.sid >= 0) { this.release(); return { state: 'idle' }; }
      this.run = [];
      return { state: 'idle' };
    }
    r.freq = freq;
    // „run“ = uzastopna očitavanja u uskom opsegu → stabilnost.
    // Govor stalno klizi po visini: ako se niz prekida više puta u kratkom roku, ne prikazuj ništa.
    if (this.run.length && (this.run[0].sid !== reading.sid || Math.abs(1200 * Math.log2(r.freq / this.run[0].freq)) > STABLE_CENTS)) {
      this.run = [];
      this.breaks.push(now);
    }
    this.breaks = this.breaks.filter((t) => now - t < UNSTABLE_MS);
    this.run.push({ t: now, sid: reading.sid, freq: r.freq });
    this.sid = reading.sid;
    this.recent.push(r.freq);
    if (this.recent.length > 5) this.recent.shift();
    this.lastGood = now;
    if (this.breaks.length >= UNSTABLE_BREAKS) { this.release(); return { state: 'idle' }; } // visina klizi → nije žica
    if (this.run.length < SHOW_FRAMES) return this.shown ? this.output(now) : { state: 'idle' };
    return this.output(now);
  }

  /** Blagi niskopropusni filter (~1,2 kHz, dva prolaza): uklanja šištanje mikrofona, a osnovni ton i prvi prizvuci ostaju. */
  lowpass(buf, sampleRate) {
    if (!this.lp || this.lp.length !== buf.length) this.lp = new Float32Array(buf.length);
    const a = 1 - Math.exp(-2 * Math.PI * 1200 / sampleRate);
    const out = this.lp;
    let y1 = buf[0], y2 = buf[0];
    for (let i = 0; i < buf.length; i++) { y1 += a * (buf[i] - y1); y2 += a * (y1 - y2); out[i] = y2; }
    return out;
  }

  output(now) {
    const freq = median(this.recent);
    const stable = this.run.length >= 3 && now - this.run[0].t >= STABLE_MS;
    this.shown = true;
    return { state: 'tracking', sid: this.sid, freq, cents: 1200 * Math.log2(freq / this.target(this.sid)), stable };
  }
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}
