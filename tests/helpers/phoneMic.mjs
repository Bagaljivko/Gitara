// Realistični test-signali za Vežbe: kako telefon zaista „čuje“ gitaru.
// - žica: fizički model iz aplikacije (ks.js) + kratko „struganje“ trzalice (visoki šum) na početku
// - mikrofon telefona: slabo hvata duboke tonove (visokopropusni filter ~200 Hz), bez pojačanja (AGC isključen)
// - soba: šum (tiha ili bučna)
// - klik metronoma iz zvučnika telefona (kvadratni ton 1,2–1,8 kHz, 50 ms)
import { pluckedString } from '../../src/ks.js';

export const SR = 48000;
let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
export const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Prazan signal dužine sec sa šumom sobe (rms ≈ noise). */
export function room(sec, noise = 0.0006) {
  const out = new Float32Array(Math.round(sec * SR));
  let lp = 0;
  for (let i = 0; i < out.length; i++) { lp += 0.15 * (rnd() - lp); out[i] = lp * noise * 4.2; } // ružičasti-ish šum
  return out;
}

/** Dodaj trzaj žice (midi) u trenutku t (s), jačine amp (vrh ~amp). */
export function addPluck(sig, t, midi, amp = 0.06, { dur = 1.6, pick = 0.6 } = {}) {
  const s = pluckedString(SR, midiFreq(midi), { duration: dur, brightness: 0.45, seed: (Math.random() * 1e9) | 0 });
  let peak = 0; for (let i = 0; i < 2000; i++) peak = Math.max(peak, Math.abs(s[i]));
  const k = amp / (peak || 1), i0 = Math.round(t * SR);
  for (let i = 0; i < s.length && i0 + i < sig.length; i++) sig[i0 + i] += s[i] * k;
  // trzalica: 4 ms visokog šuma (struganje) — na telefonu je često jača od samog tona u prvim ms
  let hp = 0, prev = 0;
  for (let i = 0; i < 0.004 * SR && i0 + i < sig.length; i++) { const w = rnd(); hp = 0.85 * (hp + w - prev); prev = w; sig[i0 + i] += hp * amp * pick * (1 - i / (0.004 * SR)); }
  return sig;
}

/** Klik metronoma iz zvučnika telefona u trenutku t. */
export function addClick(sig, t, amp = 0.03, accent = false) {
  const f = accent ? 1760 : 1175, i0 = Math.round(t * SR);
  for (let i = 0; i < 0.05 * SR && i0 + i < sig.length; i++) {
    const env = Math.min(1, i / 96) * Math.exp(-i / (0.008 * SR));
    sig[i0 + i] += amp * env * (Math.sin(2 * Math.PI * f * i / SR) > 0 ? 1 : -1);
  }
  return sig;
}

/** Mikrofon telefona: odseca duboke tonove (2 pola, ~200 Hz) — osnovni ton debele E žice je slab. */
export function phoneMic(sig, fc = 200) {
  const w = Math.tan(Math.PI * fc / SR), q = Math.SQRT1_2, n = 1 / (1 + w / q + w * w);
  const b0 = n, b1 = -2 * n, b2 = n, a1 = 2 * (w * w - 1) * n, a2 = (1 - w / q + w * w) * n;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const out = new Float32Array(sig.length);
  for (let i = 0; i < sig.length; i++) { const x = sig[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; out[i] = y; }
  return out;
}

/** Pusti signal kroz detektor u kadrovima od 4096 uzoraka na svakih 20 ms (kao aplikacija). */
export function frames(sig, fn) {
  const W = 4096, HOP = 960;
  for (let s = 0; s + W <= sig.length; s += HOP) fn(sig.subarray(s, s + W), ((s + W) / SR) * 1000);
}
