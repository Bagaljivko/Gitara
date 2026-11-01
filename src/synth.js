// Zvuk koji aplikacija sama pravi: referentni ton žice, klik metronoma i udarac za ritmove.
let ctx = null;

export function audioCtx() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/**
 * Prijatan ton nalik gitari (aditivna sinteza: harmonici koji brže utihnu, blagi niskopropusni filter).
 * Vraća trajanje u ms.
 */
export function pluck(freq, { when = 0, gain = 0.35, duration = 2.6 } = {}) {
  const c = audioCtx();
  const t0 = Math.max(c.currentTime, when || c.currentTime) + 0.01;
  const out = c.createGain();
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(5000, freq * 14), t0);
  lp.frequency.exponentialRampToValueAtTime(Math.max(400, freq * 3), t0 + duration);
  out.gain.setValueAtTime(0.0001, t0);
  out.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  out.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  out.connect(lp).connect(c.destination);
  const harm = [1, 0.55, 0.32, 0.2, 0.12, 0.08, 0.05];
  harm.forEach((a, i) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = freq * (i + 1) * (1 + 0.0004 * i * i); // blaga neharmoničnost žice
    g.gain.setValueAtTime(a, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration / (1 + i * 0.6));
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + duration + 0.05);
  });
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
export function strum(when, dir = 'D', { accent = false, mute = false } = {}) {
  const notes = dir === 'U' ? [...STRUM_NOTES].reverse().slice(0, 4) : STRUM_NOTES;
  const spread = 0.012;
  notes.forEach((f, i) => {
    pluck(f, { when: when + i * spread, gain: (accent ? 0.16 : 0.11) * (mute ? 0.5 : 1), duration: mute ? 0.12 : 0.9 });
  });
}
