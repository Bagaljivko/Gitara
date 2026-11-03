// Zvuk koji aplikacija sama pravi: referentni ton žice, klik metronoma i udarac za ritmove.
import { pluckedString } from './ks.js';
let ctx = null;

export function audioCtx() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// ---- Zvuk gitare: fizički model žice (src/ks.js) + „telo“ gitare i malo prostora ----
const buses = new WeakMap();
/** Zajednički lanac za sve žice: rezonance drvenog tela, blago ublažavanje visokih i kratak odjek sobe. */
function guitarBus(c) {
  if (buses.has(c)) return buses.get(c);
  const input = c.createGain();
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 65; hp.Q.value = 0.7;
  const body1 = c.createBiquadFilter(); body1.type = 'peaking'; body1.frequency.value = 105; body1.Q.value = 1.4; body1.gain.value = 5;
  const body2 = c.createBiquadFilter(); body2.type = 'peaking'; body2.frequency.value = 220; body2.Q.value = 1.6; body2.gain.value = 3;
  const mid = c.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 700; mid.Q.value = 0.9; mid.gain.value = -2;
  const air = c.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 4500; air.gain.value = -5;
  input.connect(hp).connect(body1).connect(body2).connect(mid).connect(air);
  // Limiter: akord od 6 žica ne sme da „pucketa“ (izobličenje) ni na glasnom telefonu
  const lim = c.createDynamicsCompressor();
  lim.threshold.value = -10; lim.knee.value = 6; lim.ratio.value = 6; lim.attack.value = 0.003; lim.release.value = 0.25;
  lim.connect(c.destination);
  const dry = c.createGain(); dry.gain.value = 0.9;
  air.connect(dry).connect(lim);
  // Kratak odjek (veštački impuls: šum koji brzo utihne) — zvuk kao u sobi, a ne „u kutiji“
  try {
    const len = Math.round(c.sampleRate * 0.9), ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) { lp += 0.35 * ((Math.random() * 2 - 1) - lp); d[i] = lp * Math.pow(1 - i / len, 3.2); }
    }
    const conv = c.createConvolver(); conv.buffer = ir;
    const wet = c.createGain(); wet.gain.value = 0.16;
    air.connect(conv).connect(wet).connect(lim);
  } catch {}
  buses.set(c, input);
  return input;
}

/**
 * Trzaj jedne žice (fizički model). Vraća trajanje u ms.
 * mute = prigušena žica (dlanom), brightness 0–1 (mekši ili oštriji trzaj).
 */
export function pluck(freq, { when = 0, gain = 0.35, duration = 2.6, mute = false, brightness = 0.5, ctx = null } = {}) {
  const c = ctx || audioCtx();
  const t0 = Math.max(c.currentTime, when || c.currentTime) + 0.01;
  const data = pluckedString(c.sampleRate, freq, mute
    ? { duration: Math.min(duration, 0.25), t60: 0.09, brightness: 0.25, pickPos: 0.2 }
    : { duration, brightness });
  const buf = c.createBuffer(1, data.length, c.sampleRate);
  buf.getChannelData(0).set(data);
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(g).connect(guitarBus(c));
  src.start(t0);
  return duration * 1000;
}

/** Kratak klik metronoma (naglašen za prvu dobu). */
export function click(when, accent = false) {
  const c = audioCtx();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'square';
  o.frequency.value = accent ? 1760 : 1175;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.2, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  o.connect(g).connect(c.destination);
  o.start(when);
  o.stop(when + 0.06);
}

// Akord E-mol (otvorene žice + 2. prag) — neutralan zvuk za vežbanje ritma.
const STRUM_NOTES = [82.41, 123.47, 164.81, 196.0, 246.94, 329.63];

/** Udarac preko žica: dir 'D' (dole) ili 'U' (gore); mute = prigušen „čik“. */
export function strum(when, dir = 'D', { accent = false, mute = false, ctx = null } = {}) {
  // Udarac nadole kreće od debelih žica, nagore od tankih (i obično zahvati samo 4 žice)
  const notes = dir === 'U' ? [...STRUM_NOTES].reverse().slice(0, 4) : STRUM_NOTES;
  const spread = dir === 'U' ? 0.009 : 0.011;
  notes.forEach((f, i) => {
    pluck(f, { when: when + i * spread + Math.random() * 0.002, gain: (accent ? 0.25 : 0.19) * (mute ? 0.7 : 1) * (dir === 'U' ? 0.85 : 1), duration: 1.1, mute, brightness: dir === 'U' ? 0.6 : 0.45, ctx });
  });
}
