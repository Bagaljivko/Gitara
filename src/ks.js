// Fizički model trzane žice (Karplus–Strong, sa proširenjima Jaffe–Smith):
// - pobuda: kratak šum „trzalice“, filtriran i oblikovan mestom trzaja (bliže kobilici = svetlije),
// - petlja: linija kašnjenja dugačka tačno jedan period + filter gubitaka (više frekvencije brže utihnu)
//   + all-pass za razlomljeni deo perioda, tako da je visina tona tačna (važno za referentne tonove tunera),
// - dve blago razdešene „polarizacije“ žice daju prirodno treperenje, kao kod prave gitare.
// Čista funkcija (bez Web Audio), pa može da se testira u Node-u.

function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
}

/** Jedna polarizacija žice. */
function string(sr, freq, n, { t60, brightness, pickPos, rnd }) {
  const period = sr / freq;
  // ukupno kašnjenje petlje = L (bafer) + 0.5 (filter gubitaka) + frac (all-pass) = period
  let L = Math.floor(period - 0.5);
  let frac = period - 0.5 - L;
  if (frac < 0.1) { L -= 1; frac += 1; } // all-pass je stabilniji za frac u (0.1, 1.1)
  const C = (1 - frac) / (1 + frac);
  const g = Math.pow(0.001, 1 / (t60 * freq)); // −60 dB posle t60 sekundi
  // Pobuda: šum → niskopropusni (mekoća trzaja) → češalj po mestu trzaja
  const buf = new Float32Array(L);
  const a = 0.15 + 0.8 * brightness;
  let lp = 0;
  for (let i = 0; i < L; i++) { lp += a * (rnd() - lp); buf[i] = lp; }
  const d = Math.max(1, Math.round(pickPos * L));
  const ex = Float32Array.from(buf);
  for (let i = 0; i < L; i++) buf[i] = ex[i] - 0.9 * ex[(i - d + L) % L];
  let mean = 0;
  for (let i = 0; i < L; i++) mean += buf[i];
  mean /= L;
  for (let i = 0; i < L; i++) buf[i] -= mean;

  const out = new Float32Array(n);
  let idx = 0, prev = 0, apX = 0, apY = 0;
  for (let k = 0; k < n; k++) {
    const y = buf[idx];
    out[k] = y;
    const f = g * 0.5 * (y + prev); // filter gubitaka (prosek dva uzorka)
    prev = y;
    const ap = C * f + apX - C * apY; // all-pass za tačnu visinu
    apX = f; apY = ap;
    buf[idx] = ap;
    if (++idx === L) idx = 0;
  }
  return out;
}

/**
 * Zvuk trzane žice kao niz uzoraka (mono, normalizovan na vršnu vrednost 1).
 * @param {number} sr frekvencija uzorkovanja
 * @param {number} freq visina tona (Hz)
 * @param {object} o duration (s), t60 (s, trajanje do −60 dB), brightness 0–1, pickPos (0–0.5), seed
 */
export function pluckedString(sr, freq, { duration = 2.6, t60, brightness = 0.35, pickPos = 0.14, seed = (Math.random() * 2 ** 31) | 0 } = {}) {
  const n = Math.max(1, Math.round(duration * sr));
  // Prirodno zvonjenje: debela E ~4,8 s, tanka E ~3,2 s (nezavisno od toga koliko dugo puštamo zvuk)
  const T = t60 || Math.max(1.5, 4.8 - Math.log2(freq / 82.41) * 0.8);
  const rnd = rand(seed);
  const det = Math.pow(2, 0.35 / 1200); // ±0,35 centi između polarizacija
  const h = string(sr, freq * det, n, { t60: T, brightness, pickPos, rnd });
  const v = string(sr, freq / det, n, { t60: T * 0.8, brightness: brightness * 0.9, pickPos: pickPos * 1.1, rnd });
  const out = new Float32Array(n);
  let peak = 1e-9;
  for (let i = 0; i < n; i++) { out[i] = 0.62 * h[i] + 0.38 * v[i]; peak = Math.max(peak, Math.abs(out[i])); }
  // Normalizacija i mekan kraj u poslednjoj trećini (kao kad se žica lagano priguši), bez pucketanja
  const fade = Math.min(n, Math.round(Math.max(0.06, duration * 0.35) * sr));
  for (let i = 0; i < n; i++) {
    let s = out[i] / peak;
    if (i >= n - fade) { const x = (n - i) / fade; s *= x * x; }
    out[i] = s;
  }
  return out;
}
