// Vežbe: zajedničko slušanje za sve igre.
// - note: kopija tunerove detekcije (practicePitch.js) u režimu „bilo koja nota“
// - trzaj: tačan trenutak udarca (na 5 ms), za proveru „u ritmu“
// - akordi: hromagram iz postojećeg prepoznavanja akorda (chordrec.js), uz blagu proveru
//   („većina tonova akorda se čuje“ je dovoljno — radi i sa mikrofonom telefona u običnoj sobi)
// Mikrofon se potpuno gasi na stop()/close().
import { openMic, closeMic } from './audio.js';
import { PracticePitch } from './practicePitch.js';
import { getRoom, roomToSensitivity } from './tunerSettings.js';
import { parseChord, QUALITIES } from './music.js';

const LAT_KEY = 'gitara-practice-latency';
/** Kašnjenje zvuka na ovom uređaju (ms): od trzaja do trenutka kada ga aplikacija „čuje“. */
export function getLatency() { try { const v = Number(localStorage.getItem(LAT_KEY)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; } }
export function setLatency(ms) { try { localStorage.setItem(LAT_KEY, String(Math.round(ms))); } catch {} }
const DEFAULT_LATENCY = 60; // dok se ne izmeri
const SUSTAIN_MS = 90;      // udarac mora da zvoni bar ovoliko (klik metronoma ne zvoni)

export function createListener() {
  let mic = null, an = null, buf = null, timer = 0, tracker = null, opts = {};
  let chordAn = null, spec = null, chordTimer = 0, chordMod = null;
  const acc = new Float32Array(12), accBass = new Float32Array(12);
  let lastPoll = 0, blocks = [], lastOnset = -1e9, running = false, sr = 48000, pending = [];

  // ---- Trzaj: energija u blokovima od 5 ms; nagli skok iznad buke = udarac ----
  function detectOnset(now) {
    const n = Math.min(buf.length, Math.max(240, Math.round(((now - lastPoll) / 1000) * sr)));
    const B = Math.round(sr * 0.005), start = Math.max(0, buf.length - n - (n % B));
    const floor = Math.max(tracker.floor || 0, 0.0004);
    // blagi niskopropusni filter (~1 kHz) preko novih uzoraka: gitara ima energiju ispod ~1 kHz,
    // klik metronoma (kvadratni ton 1,2–1,8 kHz) skoro nema
    const a = 1 - Math.exp(-2 * Math.PI * 1000 / sr);
    let y1 = buf[start] || 0, y2 = y1;
    let found = null;
    for (let i = start; i + B <= buf.length; i += B) {
      let e = 0, el = 0;
      for (let k = i; k < i + B; k++) { const x = buf[k]; e += x * x; y1 += a * (x - y1); y2 += a * (y1 - y2); el += y2 * y2; }
      const lvl = Math.sqrt(e / B);
      const prevMin = blocks.length ? Math.min(...blocks.slice(-6)) : lvl;
      const prev = blocks.length ? blocks[blocks.length - 1] : lvl;
      blocks.push(lvl); if (blocks.length > 12) blocks.shift();
      const at = now - ((buf.length - i) / sr) * 1000;
      const lowShare = e ? el / e : 0;
      if (!found && lvl > floor * 3.2 && lvl > prevMin * 3 && lvl > prev * 1.5 && at - lastOnset > 90) {
        if (lowShare < 0.3) continue; // klik/kucanje: visoki ton bez „tela“ — preskoči (i ne blokira pravi trzaj posle njega)
        found = { at, level: lvl };
      }
    }
    return found;
  }

  function poll() {
    if (!running) return;
    an.getFloatTimeDomainData(buf);
    const now = performance.now();
    const lat = getLatency() ?? DEFAULT_LATENCY;
    const r = tracker.process(buf, sr, now);
    if (opts.onOnset) {
      const o = detectOnset(now);
      if (o) { lastOnset = o.at; if (chordAn) { acc.fill(0); accBass.fill(0); } pending.push({ ...o, due: o.at + SUSTAIN_MS }); }
      // Klik metronoma (iz zvučnika telefona) i kucanje nestanu za ~50 ms; žica zvoni dalje.
      // Udarac se prihvata tek kad se 90 ms kasnije još čuje (vreme udarca ostaje tačno).
      if (pending.length) {
        let e = 0; const B = Math.round(sr * 0.02);
        for (let k = buf.length - B; k < buf.length; k++) e += buf[k] * buf[k];
        const lvlNow = Math.sqrt(e / B);
        pending = pending.filter((pd) => {
          if (now < pd.due) return true;
          if (lvlNow >= pd.level * 0.1) opts.onOnset({ at: pd.at - lat, level: pd.level });
          return false;
        });
      }
    }
    lastPoll = now;
    if (r.state === 'tracking' && opts.onNote) opts.onNote({ midi: tracker.midiOf(r.sid), cents: r.cents, stable: r.stable, freq: r.freq, at: now - lat });
    else if (r.state !== 'tracking' && opts.onSilence) opts.onSilence();
  }

  // ---- Akordi (samo kad igra traži): hromagram se sabira od poslednjeg trzaja ----
  function chordFrame() {
    if (!running || !chordAn) return;
    chordAn.getFloatFrequencyData(spec);
    if (performance.now() - lastOnset > 1600) return; // bez udarca nema analize (govor, buka)
    const { chroma, bass } = chordMod.chromaFromSpectrum(spec, sr, chordAn.fftSize);
    for (let i = 0; i < 12; i++) { acc[i] = acc[i] * 0.82 + chroma[i]; accBass[i] = accBass[i] * 0.82 + bass[i]; }
  }

  return {
    /** opts: { notes, chords, onNote, onOnset, onSilence } */
    async start(o = {}) {
      opts = o;
      if (running) return;
      mic = await openMic();
      sr = mic.ctx.sampleRate;
      an = mic.ctx.createAnalyser();
      an.fftSize = 4096;
      an.smoothingTimeConstant = 0;
      mic.source.connect(an);
      buf = new Float32Array(an.fftSize);
      tracker = new PracticePitch({ sensitivity: roomToSensitivity(await getRoom()) });
      tracker.setAnyNote();
      if (o.chords) {
        chordMod = await import('./chordrec.js');
        chordAn = mic.ctx.createAnalyser();
        chordAn.fftSize = 16384;
        chordAn.smoothingTimeConstant = 0.5;
        mic.source.connect(chordAn);
        spec = new Float32Array(chordAn.frequencyBinCount);
        chordTimer = setInterval(chordFrame, 90);
      }
      blocks = []; lastOnset = -1e9; lastPoll = performance.now(); pending = [];
      running = true;
      timer = setInterval(poll, 20);
    },
    /** Promeni povratne pozive bez ponovnog otvaranja mikrofona. */
    setHandlers(o) { opts = { ...opts, ...o }; },
    /** Igra je odsvirala zvuk (npr. „Sluh“): ne slušaj sopstveni ton. */
    mute(ms) { tracker?.mute(ms, performance.now()); },

    /**
     * Blaga provera akorda: koliko tonova akorda se jasno čuje od poslednjeg trzaja.
     * ok = većina tonova (2 od 3, 3 od 4) i ti tonovi nose bar ~polovinu zvuka.
     */
    chordHeard(name) {
      const p = parseChord(name);
      if (!p || !QUALITIES[p.quality]) return { ok: false, present: 0, need: 3, share: 0 };
      const tones = [...new Set(QUALITIES[p.quality].intervals.map((iv) => (p.root + iv) % 12))];
      const max = Math.max(...acc) || 0;
      if (!max) return { ok: false, present: 0, need: Math.ceil(tones.length * 0.6), share: 0 };
      let present = 0, inChord = 0, total = 0;
      acc.forEach((x, pc) => { total += x; if (tones.includes(pc)) { inChord += x; if (x >= 0.2 * max) present++; } });
      const need = Math.max(2, Math.ceil(tones.length * 0.6));
      const share = total ? inChord / total : 0;
      return { ok: present >= need && share >= 0.45, present, need, share };
    },
    resetChord() { acc.fill(0); accBass.fill(0); },
    get latency() { return getLatency() ?? DEFAULT_LATENCY; },

    stop() {
      if (!running) return;
      running = false;
      clearInterval(timer); clearInterval(chordTimer);
      try { mic.source.disconnect(an); } catch {}
      try { if (chordAn) mic.source.disconnect(chordAn); } catch {}
      chordAn = null;
      closeMic();
      mic = null;
    },
    close() { this.stop(); },
  };
}

/**
 * Ocena tajminga jednog udarca u odnosu na otkucaj (dt = udarac − otkucaj, ms).
 * Do ±45 ms je „tačno“; do ±110 ms „malo rano/kasno“; više od toga se računa kao promašen ritam.
 */
export function judgeTiming(dt, beatMs) {
  const a = Math.abs(dt), lim = Math.min(180, beatMs * 0.4);
  if (a <= 45) return { kind: 'hit', score: 1 };
  if (a <= 110) return { kind: dt < 0 ? 'early' : 'late', score: 1 - (a - 45) / 130 };
  if (a <= lim) return { kind: dt < 0 ? 'early' : 'late', score: 0.35 };
  return { kind: 'off', score: 0 };
}

/**
 * Udarci i note zajedno: svaki udarac (trzaj) dobija notu koja se najčešće čula 30–300 ms posle njega
 * (prvo očitavanje posle trzaja ume da bude još prethodna nota dok detektor ne „pređe“ na novu).
 */
export function createHitLog() {
  const hits = [];
  return {
    hits,
    onset(o) { hits.push({ at: o.at, notes: [] }); if (hits.length > 64) hits.splice(0, 16); },
    note(nt) {
      for (let i = hits.length - 1; i >= 0 && i >= hits.length - 3; i--) {
        const h = hits[i], d = nt.at - h.at;
        if (d >= 30 && d <= 300) { h.notes.push(nt.midi); break; }
      }
    },
    /** Najčešća nota posle udarca (ili null). */
    midiOf(h) {
      if (!h.notes.length) return null;
      const c = new Map(); h.notes.forEach((m) => c.set(m, (c.get(m) || 0) + 1));
      return [...c].sort((a, b) => b[1] - a[1])[0][0];
    },
    clear() { hits.length = 0; },
  };
}

/**
 * Ista nota? Dozvoljena je i oktava gore/dole: mikrofon telefona slabo hvata osnovni ton debelih žica,
 * pa se nota ponekad očita oktavu više. Igra ionako kaže na kojoj žici se svira.
 */
export const sameNote = (a, b) => a != null && b != null && (a === b || Math.abs(a - b) === 12);
