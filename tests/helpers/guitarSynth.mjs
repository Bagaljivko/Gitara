// Kopija generatora iz razvojnog merenja (sintetički zvuk; bez ijednog stvarnog snimka).
// Synthetic test material: plucked strings (timbres, inharmonicity, phone low-cut), speech/singing/humming and
// room interference. Deterministic (seeded) so every method is compared on identical audio.
export const SR = 48000;
const TAU = Math.PI * 2;
export function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const dbA = (db) => Math.pow(10, db / 20);
export const mf = (m, cents = 0) => 440 * Math.pow(2, (m - 69 + cents / 100) / 12);
export const OPEN = [40, 45, 50, 55, 59, 64];

export const TIMBRES = {
  steel: { B: 1.2e-4, tilt: 0.9, hiDecay: 1.0, decay: 1.6, body: 0.25, nH: 24 },
  nylon: { B: 0.4e-4, tilt: 1.4, hiDecay: 2.2, decay: 1.2, body: 0.35, nH: 16 },
  electric: { B: 0.8e-4, tilt: 0.7, hiDecay: 0.7, decay: 2.4, body: 0.0, nH: 28 },
};

/** Plucked string added into buffer y at time t (s). opts: timbre, cents, peakDb, dur (s, until damped), attackMs, pos (pluck position), palm, bendTo (semitones), slideFrom (midi). */
export function pluck(y, t, m, o = {}, r = Math.random) {
  const T = TIMBRES[o.timbre || 'steel'];
  const f0 = mf(m, o.cents || 0), n0 = Math.round(t * SR);
  const dur = Math.min(o.dur ?? 1.5, 4), len = Math.round((dur + 0.08) * SR);
  const pos = o.pos ?? 0.12 + 0.12 * r();
  const att = Math.max(1, (o.attackMs ?? 2 + 4 * r()) * SR / 1000);
  const decayBase = (o.palm ? 0.12 : T.decay) * (1 + 0.3 * r());
  const parts = [];
  const weakF = o.weakF ?? (r() < 0.4 ? 0.15 + 0.3 * r() : 1);
  for (let h = 1; h <= T.nH; h++) {
    const fh = f0 * h * Math.sqrt(1 + T.B * h * h);
    if (fh > 9000) break;
    let a = Math.abs(Math.sin(Math.PI * h * pos)) / Math.pow(h, T.tilt);
    if (o.palm) a /= 1 + 0.25 * h * h;
    if (h === 3) a *= o.h3 ?? 1.6; // strong 3rd partial: tempts subharmonic errors
    if (h === 1) a *= weakF; // phone mic / guitar body: fundamental often weaker than the 2nd partial
    const tau = decayBase / (1 + T.hiDecay * 0.08 * h * h * (f0 / 200));
    parts.push({ fh, a: a * (0.85 + 0.3 * r()), tau, ph: r() * TAU });
  }
  const norm = parts.reduce((s, p) => s + p.a, 0) || 1;
  const peak = dbA(o.peakDb ?? -20);
  const bend = o.bendTo || 0, slideFrom = o.slideFrom;
  let phs = parts.map((p) => p.ph);
  for (let i = 0; i < len; i++) {
    const n = n0 + i; if (n < 0 || n >= y.length) continue;
    const ts = i / SR;
    let env = i < att ? i / att : 1;
    if (ts > dur) env *= Math.exp(-(ts - dur) / 0.012); // damped by the fretting hand
    // pitch change: bend (up over 0.2 s from 0.12 s) or slide (from slideFrom over first 0.1 s)
    let ratio = 1;
    if (bend && ts > 0.12) ratio = Math.pow(2, (bend * Math.min(1, (ts - 0.12) / 0.2)) / 12);
    if (slideFrom != null && ts < 0.1) ratio = Math.pow(2, ((slideFrom - m) * (1 - ts / 0.1)) / 12);
    let s = 0;
    for (let k = 0; k < parts.length; k++) {
      const p = parts[k];
      phs[k] += (TAU * p.fh * ratio) / SR;
      s += p.a * Math.exp(-ts / p.tau) * Math.sin(phs[k]);
    }
    y[n] += (peak * env * s) / norm * 1.6;
  }
  // pick: contact scrape 6-20 ms before the string speaks (damps the old note, noisy), then a short release click
  if (!o.legato) {
    const pre = Math.round((0.006 + 0.014 * r()) * SR), g = peak * (0.08 + 0.15 * r());
    let lp = 0;
    for (let i = -pre; i < 0; i++) { const n = n0 + i; if (n >= 0 && n < y.length) { lp += 0.2 * ((r() * 2 - 1) - lp); y[n] += g * (lp * 2 + 0.3 * (r() * 2 - 1)) * (1 + i / pre); } }
    for (let i = 0; i < Math.round(0.003 * SR); i++) { const n = n0 + i; if (n < y.length) y[n] += peak * 0.25 * (r() * 2 - 1) * (1 - i / (0.003 * SR)); }
  }
}

// ---- voice: glottal pulse train through formants; pitch glides like speech ----
const VOWELS = [[730, 1090, 2440], [270, 2290, 3010], [300, 870, 2240], [530, 1840, 2480], [570, 840, 2410], [440, 1020, 2240], [660, 1720, 2410]];
function resonator(fc, bw) { const R = Math.exp(-Math.PI * bw / SR), th = TAU * fc / SR; return { a1: -2 * R * Math.cos(th), a2: R * R, g: 1 - R, y1: 0, y2: 0 }; }
function res(rz, x) { const y = rz.g * x - rz.a1 * rz.y1 - rz.a2 * rz.y2; rz.y2 = rz.y1; rz.y1 = y; return y; }

/** kind: 'speech' | 'sing' | 'hum'. who: 'male' (100-150, up to 330), 'female' (170-280), 'child' (250-400). */
export function voice(y, t0, t1, { kind = 'speech', who = 'male', db = -24 } = {}, r = Math.random) {
  const base = who === 'male' ? 115 : who === 'female' ? 210 : 290;
  let n = Math.round(t0 * SR); const end = Math.min(y.length, Math.round(t1 * SR));
  const g = dbA(db);
  while (n < end) {
    const sylDur = kind === 'speech' ? 0.12 + 0.22 * r() : 0.35 + 0.7 * r();
    const len = Math.min(end - n, Math.round(sylDur * SR));
    const v = VOWELS[Math.floor(r() * VOWELS.length)], v2 = VOWELS[Math.floor(r() * VOWELS.length)];
    const rz = v.map((f, i) => resonator(f, 60 + 40 * i));
    // pitch contour: speech glides constantly (~900-4000 cents/s); singing holds with vibrato; humming steady
    const fStart = base * Math.pow(2, (r() * 2 - 1) * (kind === 'speech' ? 0.45 : 0.6));
    const glide = kind === 'speech' ? (r() * 2 - 1) * (1500 + 2500 * r()) : 0; // cents/s
    let ph = 0, jit = 1, shim = 1;
    // consonant noise burst before speech syllables
    if (kind === 'speech' && r() < 0.6) { const cl = Math.round((0.02 + 0.05 * r()) * SR); for (let i = 0; i < cl && n + i < end; i++) y[n + i] += g * 0.35 * (r() * 2 - 1); n += cl; }
    for (let i = 0; i < len && n + i < end; i++) {
      const ts = i / SR, k = i / len;
      let f = fStart * Math.pow(2, (glide * ts) / 1200);
      if (kind === 'speech') f *= Math.pow(2, (0.08 * Math.sin(TAU * 3 * ts + ph)) / 12);
      if (kind === 'sing') f *= Math.pow(2, (0.3 * Math.sin(TAU * 5.5 * ts) * Math.min(1, ts / 0.25)) / 12);
      f = Math.min(400, Math.max(80, f));
      // natural voice: cycle-to-cycle jitter (~1 %), shimmer and breath noise
      ph += (f * jit) / SR; if (ph >= 1) { ph -= 1; jit = 1 + (kind === 'hum' ? 0.004 : 0.012) * (r() * 2 - 1); shim = 1 + 0.08 * (r() * 2 - 1); }
      const pulse = (2 * ph - 1) * shim + (kind === 'hum' ? 0.02 : 0.12) * (r() * 2 - 1); // sawtooth-like glottal source + aspiration
      let s = pulse;
      if (kind === 'hum') s = Math.sin(TAU * ph) + 0.3 * Math.sin(2 * TAU * ph);
      else { // formants (moving from v to v2 within the syllable)
        rz.forEach((z, j) => { const fc = v[j] + (v2[j] - v[j]) * k, R = Math.exp(-Math.PI * (60 + 40 * j) / SR), th = TAU * fc / SR; z.a1 = -2 * R * Math.cos(th); z.a2 = R * R; });
        s = rz.reduce((a, z, j) => a + res(z, pulse) * [1, 0.6, 0.3][j], 0) * 4;
      }
      const env = Math.min(1, k / 0.15, (1 - k) / 0.2) * (kind === 'speech' ? 0.6 + 0.4 * Math.sin(Math.PI * k) : 1);
      y[n + i] += g * env * s;
    }
    n += len + Math.round((kind === 'speech' ? 0.03 + 0.15 * r() : 0.05 + 0.2 * r()) * SR);
  }
}

export function roomNoise(y, db = -59, r = Math.random) { // pinkish noise
  const g = dbA(db) * 3.5; let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < y.length; i++) { const w = r() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; y[i] += g * (b0 + b1 + b2 + w * 0.1848) * 0.25; }
}
export function hum(y, t0, t1, { f = 50, db = -42 } = {}) { const g = dbA(db); for (let n = Math.round(t0 * SR); n < Math.min(y.length, t1 * SR); n++) { const ts = n / SR; y[n] += g * (Math.sin(TAU * f * ts) + 0.5 * Math.sin(TAU * 2 * f * ts) + 0.35 * Math.sin(TAU * 3 * f * ts) + 0.2 * Math.sin(TAU * 5 * f * ts)); } }
export function fan(y, t0, t1, { db = -40 } = {}, r = Math.random) { const g = dbA(db); let lp = 0; for (let n = Math.round(t0 * SR); n < Math.min(y.length, t1 * SR); n++) { lp += 0.05 * ((r() * 2 - 1) - lp); const ts = n / SR; y[n] += g * (lp * 3 + 0.4 * Math.sin(TAU * 118 * ts) + 0.2 * Math.sin(TAU * 236 * ts)); } }
export function tap(y, t, { db = -18 } = {}, r = Math.random) { const g = dbA(db), f = 140 + 120 * r(); for (let i = 0; i < 0.06 * SR; i++) { const n = Math.round(t * SR) + i; if (n >= y.length) break; const ts = i / SR; y[n] += g * (Math.exp(-ts / 0.012) * Math.sin(TAU * f * ts) + (i < 0.002 * SR ? (r() * 2 - 1) : 0)); } }
export function squeak(y, t, { db = -30 } = {}, r = Math.random) { const g = dbA(db); let bp = 0, lp = 0; for (let i = 0; i < 0.18 * SR; i++) { const n = Math.round(t * SR) + i; if (n >= y.length) break; const w = r() * 2 - 1; lp += 0.3 * (w - lp); bp = w - lp; y[n] += g * bp * Math.sin(Math.PI * i / (0.18 * SR)); } }
export function click(y, t, accent = false, { db = -22 } = {}) { const g = dbA(db), f = accent ? 1760 : 1175; for (let i = 0; i < 0.06 * SR; i++) { const n = Math.round(t * SR) + i; if (n >= y.length) break; const ts = i / SR; y[n] += g * Math.sign(Math.sin(TAU * f * ts)) * Math.exp(-ts / 0.012); } }
/** Background music/TV: quiet chords + speech, far away (low-passed). */
export function tv(y, t0, t1, { db = -36 } = {}, r = Math.random) {
  const tmp = new Float32Array(y.length);
  voice(tmp, t0, t1, { kind: 'speech', who: r() < 0.5 ? 'male' : 'female', db: db + 4 }, r);
  for (let t = t0; t < t1; t += 0.5 + r()) [0, 4, 7].forEach((iv, k) => pluck(tmp, t + k * 0.01, 48 + Math.floor(r() * 12) + iv, { peakDb: db - 2, dur: 0.6, timbre: 'nylon' }, r));
  let lp = 0; for (let i = 0; i < y.length; i++) { lp += 0.25 * (tmp[i] - lp); y[i] += lp; }
}
/** Phone mic low cut (2nd order high-pass, applied twice = 4th order) at fc. */
export function lowCut(y, fc = 120) {
  for (let pass = 0; pass < 2; pass++) {
    const w = Math.tan(Math.PI * fc / SR), k = 1 / (1 + Math.SQRT2 * w + w * w);
    const b0 = k, b1 = -2 * k, b2 = k, a1 = 2 * (w * w - 1) * k, a2 = (1 - Math.SQRT2 * w + w * w) * k;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) { const x = y[i], o = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = o; y[i] = o; }
  }
}
