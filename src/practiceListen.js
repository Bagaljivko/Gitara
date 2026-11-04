// Vežbe: zajedničko slušanje za sve igre.
// Mikrofon i detekcija su ISTI kao u tuneru (isti openMic, isti analizator 4096 / 20 ms, ista osetljivost sobe
// i A4): kopija tunerove detekcije je u practicePitch.js (tuner je nikad ne učitava).
// - trzaj: kad ga tunerova detekcija prepozna (nagao skok jačine), pa se tačan trenutak traži u samom
//   zvuku (blokovi od 2,5 ms) — za proveru „u ritmu“
// - nota: tunerova detekcija u režimu „bilo koja nota“
// - akordi: hromagram iz postojećeg prepoznavanja akorda (chordrec.js), uz blagu proveru
// - jačina: za mali merač na ekranu igre (da se vidi da igra čuje gitaru)
// Mikrofon se potpuno gasi na stop()/close().
import { openMic, closeMic } from './audio.js';
import { PracticePitch } from './practicePitch.js';
import { getRoom, roomToSensitivity } from './tunerSettings.js';
import { settings } from './db.js';
import { parseChord, QUALITIES } from './music.js';

const LAT_KEY = 'gitara-practice-latency';
/** Kašnjenje zvuka na ovom uređaju (ms): od trzaja do trenutka kada ga aplikacija „čuje“. */
export function getLatency() { try { const v = Number(localStorage.getItem(LAT_KEY)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; } }
export function setLatency(ms) { try { localStorage.setItem(LAT_KEY, String(Math.round(ms))); } catch {} }
const DEFAULT_LATENCY = 60; // dok se ne izmeri

/** Jačina poslednjih ~20 ms (za merač) i trenutna jačina. */
function rmsTail(buf, n) {
  let e = 0;
  for (let i = buf.length - n; i < buf.length; i++) e += buf[i] * buf[i];
  return Math.sqrt(e / n);
}

// ---- Provera note posle trzaja ----
// Igra zna koju notu očekuje. Umesto „koja je ovo nota“ (teško kad prethodna žica još zvoni), pita se
// „da li se u novom zvuku čuje očekivana nota“: korelacija signala sa sobom pomerenim za 1–4 perioda te note.
// Prava nota daje ~0,7–1; susedni pragovi (±1, ±2) daju ~0. Testirano na realističnim signalima telefona.
export function noteScore(seg, sr, midi, a4 = 440) {
  const P = sr / (a4 * Math.pow(2, (midi - 69) / 12));
  let tot = 0, n = 0;
  for (let k = 1; k <= 4; k++) {
    const L = P * k, Li = Math.floor(L), fr = L - Li, W = seg.length - Li - 2;
    if (W < 400) break;
    let xy = 0, xx = 0, yy = 0;
    for (let i = 0; i < W; i++) { const a = seg[i], b = seg[i + Li] * (1 - fr) + seg[i + Li + 1] * fr; xy += a * b; xx += a * a; yy += b * b; }
    tot += xy / Math.sqrt(xx * yy + 1e-20); n++;
  }
  return n ? tot / n : 0;
}
/** Da li je trzaj (seg) očekivana nota (ili ista nota oktavu više/niže)? */
export function matchNote(seg, sr, midi, a4 = 440) {
  if (!seg) return { ok: false, score: 0 };
  let best = 0;
  for (const m of [midi, midi + 12, midi - 12]) {
    const s = noteScore(seg, sr, m, a4);
    const nb = Math.max(...[-2, -1, 1, 2].map((d) => noteScore(seg, sr, m + d, a4)));
    if (s >= 0.45 && s >= nb + 0.02) return { ok: true, score: s };
    best = Math.max(best, s);
  }
  return { ok: false, score: best };
}
/** Koja nota je ovo verovatno bila (za poruku „To je G“) — najbolji pogodak u opsegu gitare. */
export function guessNote(seg, sr, a4 = 440, lo = 40, hi = 88) {
  if (!seg) return null;
  let best = null, bs = 0.45;
  for (let m = lo; m <= hi; m++) { const s = noteScore(seg, sr, m, a4); if (s > bs + 0.03 || (best != null && m === best + 12 && s >= bs - 0.08)) { best = m; bs = Math.max(bs, s); } }
  return best;
}

/**
 * Detektor (bez Web Audio, može da se testira u Node-u): obradi kadar od 4096 uzoraka koji se završava u „now“.
 * Vraća { level, floor, onset?: { at }, pluck?: { at, seg, sr }, note?: { midi, … } }.
 * - trzaj: nagli skok energije (blokovi 2,5 ms), iznad buke sobe — radi i kad prethodne žice još zvone
 * - pluck: ~90 ms posle trzaja, isečak novog zvuka (za proveru očekivane note)
 * - note: tunerova detekcija (practicePitch.js) — za oznaku „čujem: …“
 */
export function createDetector({ sensitivity = 'auto', a4 = 440 } = {}) {
  const tr = new PracticePitch({ sensitivity, a4 });
  tr.a4 = a4;
  tr.setAnyNote();
  let lastAt = -1e9, lastCand = -1e9, prevEnd = null;
  const pends = [];        // napadi koji čekaju proveru (~90 ms)
  const blocks = [];       // energija blokova od 2,5 ms (poslednjih ~25 ms)
  const hist = [];         // isto, sa vremenom (poslednjih ~200 ms) — da li je napad „umro“ pre sledećeg
  let fl = -1;             // buka sobe: brzo pada, sporo raste (~10 s) — sviranje bez prestanka je ne podiže
  let a = 0, y1 = 0, y2 = 0;
  function process(buf, sr, now) {
    const B = Math.max(32, Math.round(sr * 0.0025));
    // novi uzorci od prethodnog kadra (kadar je 4096, pomera se ~960)
    const newN = prevEnd == null ? B * 8 : Math.min(buf.length, Math.max(B, Math.round(((now - prevEnd) / 1000) * sr)));
    prevEnd = now;
    const level = rmsTail(buf, Math.round(sr * 0.02));
    const minAbs = Math.max(0.0008, Math.max(fl, 0) * 3);
    const out = { level, floor: Math.max(fl, 0) };
    fl = fl < 0 || level < fl ? level : fl + (level - fl) * 0.002;
    for (let i = buf.length - newN - ((buf.length - newN) % B) + 0; i + B <= buf.length; i += B) {
      if (i < 0) continue;
      let e = 0; for (let k = i; k < i + B; k++) e += buf[k] * buf[k];
      e /= B;
      // prosek prethodnih 20 ms (ne minimum: kod debelih žica blok od 2,5 ms ume da padne u „dolinu“ talasa)
      const pre = blocks.length >= 8 ? blocks.slice(-8).reduce((x, y) => x + y, 0) / 8 : Infinity;
      blocks.push(e); if (blocks.length > 12) blocks.shift();
      const at = now - ((buf.length - i) / sr) * 1000;
      hist.push({ at, e }); if (hist.length > 80) hist.shift();
      // novi napad; i kad prethodni još čeka proveru (klik metronoma pa trzaj odmah posle njega — oba čekaju)
      if (e > pre * 4 && Math.sqrt(e) > minAbs && at > lastAt + 70 && at > lastCand + 25) {
        lastCand = at;
        pends.push({ at, rms: Math.sqrt(e), preRms: Math.sqrt(pre) });
      }
    }
    // ~90 ms posle napada: trzaj se prihvata samo ako zvuk još traje (klik metronoma iz zvučnika i kucanje
    // nestanu za ~50 ms, žica zvoni dalje) — pa se uzme isečak novog zvuka (od 15 ms posle napada) za proveru note
    while (pends.length && now - pends[0].at >= 90 && !out.pluck) {
      const c = pends.shift(), d = pends[0];
      if (c.at <= lastAt + 70) continue;
      // Sledeći napad ubrzo posle ovog: ako je ovaj zvuk utihnuo pre njega, bio je klik — računa se sledeći
      if (d && d.at - c.at >= 30 && d.at - c.at < 90) {
        const mid = hist.filter((h) => h.at >= Math.max(c.at + 20, d.at - 12.5) && h.at <= d.at - 2.5);
        const m = mid.length ? Math.sqrt(mid.reduce((x, h) => x + h.e, 0) / mid.length) : 0;
        // „utihnuo“ = vratio se na nivo od pre napada (tišina ili žica koja je već zvonila)
        if (m < Math.max(c.preRms * 1.35, minAbs)) continue;
      }
      // i zvuk mora trajno da bude jači nego pre napada (klik preko žice koja već zvoni to ne ispunjava)
      if (out.level >= c.rms * 0.12 && out.level >= c.preRms * 1.35) {
        lastAt = c.at;
        const from = Math.max(0, buf.length - Math.round(((now - (c.at + 15)) / 1000) * sr));
        const seg = Float32Array.from(tr.lowpass(buf.subarray(from), sr));
        out.onset = { at: c.at };
        out.pluck = { at: c.at, seg, sr, level: out.level };
      }
    }
    const r = tr.process(buf, sr, now);
    if (r.state === 'tracking') out.note = { midi: tr.midiOf(r.sid), cents: r.cents, stable: r.stable, freq: r.freq };
    return out;
  }
  return { tracker: tr, process };
}

export function createListener() {
  let mic = null, an = null, buf = null, timer = 0, det = null, opts = {};
  let chordAn = null, spec = null, chordTimer = 0, chordMod = null;
  const acc = new Float32Array(12), accBass = new Float32Array(12);
  let lastOnset = -1e9, running = false, sr = 48000, pending = [], lastNote = null;

  function poll() {
    if (!running) return;
    an.getFloatTimeDomainData(buf);
    const now = performance.now();
    const lat = getLatency() ?? DEFAULT_LATENCY;
    const ev = det.process(buf, sr, now);
    opts.onLevel?.({ level: ev.level, floor: ev.floor, note: lastNote });
    if (ev.onset) {
      lastOnset = ev.onset.at;
      if (chordAn) { acc.fill(0); accBass.fill(0); }
      opts.onOnset?.({ at: ev.onset.at - lat, level: ev.level });
    }
    if (ev.pluck) opts.onPluck?.({ at: ev.pluck.at - lat, seg: ev.pluck.seg, sr: ev.pluck.sr, a4: det.tracker.a4 });
    if (ev.note) {
      lastNote = ev.note.midi;
      opts.onNote?.({ ...ev.note, at: now - lat });
    } else opts.onSilence?.();
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
    /** opts: { chords, strums, onNote, onOnset, onSilence, onLevel } */
    async start(o = {}) {
      opts = { ...opts, ...o };
      if (o.chords) opts.strums = true; // akordi = udarci preko žica (bez jasne jedne note)
      if (running) return;
      // Isto kao tuner: deljeni mikrofon (audio.js), analizator 4096 bez izglađivanja, kadar na 20 ms
      mic = await openMic();
      sr = mic.ctx.sampleRate;
      an = mic.ctx.createAnalyser();
      an.fftSize = 4096;
      an.smoothingTimeConstant = 0;
      mic.source.connect(an);
      buf = new Float32Array(an.fftSize);
      const a4 = Number(await settings.get('a4', 440)) || 440;
      det = createDetector({ sensitivity: roomToSensitivity(await getRoom()), a4 });
      if (o.chords) {
        chordMod = await import('./chordrec.js');
        chordAn = mic.ctx.createAnalyser();
        chordAn.fftSize = 16384;
        chordAn.smoothingTimeConstant = 0.5;
        mic.source.connect(chordAn);
        spec = new Float32Array(chordAn.frequencyBinCount);
        chordTimer = setInterval(chordFrame, 90);
      }
      lastOnset = -1e9; pending = []; lastNote = null;
      running = true;
      timer = setInterval(poll, 20);
    },
    /** Promeni povratne pozive bez ponovnog otvaranja mikrofona. */
    setHandlers(o) { opts = { ...opts, ...o }; },
    /** Igra je odsvirala zvuk (npr. „Sluh“): ne slušaj sopstveni ton. */
    mute(ms) { det?.tracker.mute(ms, performance.now()); },
    get running() { return running; },

    /**
     * Blaga provera akorda: koliko tonova akorda se jasno čuje od poslednjeg trzaja.
     * ok = većina tonova (2 od 3, 3 od 4), uključujući osnovni ton, i ti tonovi nose bar ~polovinu zvuka.
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
      // i osnovni ton mora da se čuje (inače bi npr. Em — E, G, H — prošao kao C — C, E, G)
      const rootHeard = acc[p.root] >= 0.2 * max;
      return { ok: present >= need && share >= 0.45 && rootHeard, present, need, share, rootHeard };
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
      opts.onLevel?.(null);
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
    onset(o) { hits.push({ at: o.at, notes: [], seg: null }); if (hits.length > 64) hits.splice(0, 16); },
    /** Zvuk samog trzaja (~75 ms posle napada) — za proveru očekivane note. */
    pluck(p) { const h = hits.find((x) => Math.abs(x.at - p.at) < 5); if (h) { h.seg = p.seg; h.sr = p.sr; h.a4 = p.a4 || 440; } },
    /** Da li je ovaj trzaj očekivana nota? */
    matches(h, midi) { return h.seg ? matchNote(h.seg, h.sr, midi, h.a4).ok : sameNote(this.midiOf(h), midi); },
    note(nt) {
      for (let i = hits.length - 1; i >= 0 && i >= hits.length - 3; i--) {
        const h = hits[i], d = nt.at - h.at;
        if (d >= 30 && d <= 300) { h.notes.push(nt.midi); break; }
      }
    },
    /** Najčešća nota posle udarca (ili null). */
    midiOf(h) {
      if (h.seg && h.guess === undefined) h.guess = guessNote(h.seg, h.sr, h.a4);
      if (h.guess != null) return h.guess;
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
