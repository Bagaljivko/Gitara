// Samo sviraj — prepoznavanje pojedinačnih nota (melodija), v2.
//
// Kako radi (ukratko):
//  1) napad: spektralni „flux“ (porast energije po opsezima) u odnosu na naučenu pozadinu sobe + nagli porast jačine
//     (pravi trzaj: +5…16 dB za ~25 ms; zvono stare žice ili ponovno okidanje: ~0 dB) → napad;
//  2) visina tona: dva kratka uzastopna prozora posle napada (svaki ~27 ms); metod je izmenljiv (YIN, MPM,
//     harmonijski zbir ili spoj MPM + harmonijska provera oktave) — izabran je onaj koji je merenjem bio najbolji;
//  3) prihvata se samo zvuk koji liči na trzanu žicu: nagao napad, ista visina u oba prozora (glas „klizi“ ~900–4000
//     centi/s, žica stoji), jasna periodičnost (glas je „šumovitiji“) i harmonici na celobrojnim umnošcima;
//  4) legato (hammer-on / pull-off / triler / klizanje): dok nota zvoni, visina se prati; nova stabilna visina = nova nota;
//  5) stalni tonovi (frižider, ventilator, brujanje mreže 50/60 Hz) uče se kao pozadina i ne izazivaju napad.
// Opseg gitare: E2 (82 Hz) … E6 (1319 Hz), uz ±50 centi (malo raštimovana gitara je u redu).

import { chromaFromSpectrum, matchChord, presentChordNotes } from './chordrec.js';
import { pcName, QUALITIES } from './music.js';
import { getVoicings } from './chords.js';

const TAU = Math.PI * 2;
const OPEN_M = [40, 45, 50, 55, 59, 64];
const MPM_K = 0.9;
export const MONO_MIN = 40, MONO_MAX = 88; // E2 … E6
const FMIN = 75, FMAX = 1400;

// ---------------- FFT (kompleksni, radix-2, u mestu) ----------------
function makeFFT(N) {
  const lev = Math.log2(N) | 0, cos = new Float64Array(N / 2), sin = new Float64Array(N / 2), rev = new Uint32Array(N);
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos((TAU * i) / N); sin[i] = Math.sin((TAU * i) / N); }
  for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < lev; b++) r = (r << 1) | ((i >>> b) & 1); rev[i] = r; }
  return function fft(re, im, inv = false) {
    for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let i = 0; i < N; i += size) for (let j = i, k = 0; j < i + half; j++, k += step) {
        const c = cos[k], s = inv ? sin[k] : -sin[k], l = j + half;
        const tr = re[l] * c - im[l] * s, ti = re[l] * s + im[l] * c;
        re[l] = re[j] - tr; im[l] = im[j] - ti; re[j] += tr; im[j] += ti;
      }
    }
    if (inv) for (let i = 0; i < N; i++) { re[i] /= N; im[i] /= N; }
  };
}
const fftCache = new Map();
function getFFT(N) { if (!fftCache.has(N)) fftCache.set(N, { f: makeFFT(N), re: new Float64Array(N), im: new Float64Array(N) }); return fftCache.get(N); }
const pow2 = (n) => 1 << Math.ceil(Math.log2(n));

/** Autokorelacija r[τ] = Σ x[j]·x[j+τ] (j preko celog isečka), preko FFT-a. */
function acf(x, maxLag) {
  const N = pow2(x.length + maxLag + 1), F = getFFT(N), re = F.re, im = F.im;
  re.fill(0); im.fill(0); for (let i = 0; i < x.length; i++) re[i] = x[i];
  F.f(re, im);
  for (let i = 0; i < N; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
  F.f(re, im, true);
  return re; // re[τ]
}
const parabolic = (a, b, c) => { const d = a - 2 * b + c; return d === 0 ? 0 : (0.5 * (a - c)) / d; };

// ---------------- metodi visine tona ----------------
/** YIN (de Cheveigné & Kawahara): prvi dovoljno dubok minimum normalizovane razlike. conf = 1 − d'. */
export function pitchYIN(x, sr, { fmin = FMIN, fmax = FMAX, thr = 0.15 } = {}) {
  const tMin = Math.max(2, Math.floor(sr / fmax)), tMax = Math.min(Math.ceil(sr / fmin), Math.floor(x.length / 2));
  const W = x.length - tMax;
  if (W < tMin * 2) return null;
  // d(τ) = Σ_{j<W} (x_j − x_{j+τ})² = e0 + e(τ) − 2 r(τ)   (r preko FFT-a, samo prvih W uzoraka × ceo isečak)
  const N = pow2(W + tMax + 1), F = getFFT(N), re = F.re, im = F.im;
  const re2 = new Float64Array(N), im2 = new Float64Array(N);
  re.fill(0); im.fill(0); for (let i = 0; i < W; i++) re[i] = x[i];
  for (let i = 0; i < W + tMax; i++) re2[i] = x[i];
  F.f(re, im); const ar = Float64Array.from(re), ai = Float64Array.from(im);
  re.set(re2); im.fill(0); F.f(re, im);
  for (let i = 0; i < N; i++) { const r = ar[i] * re[i] + ai[i] * im[i], ii = ar[i] * im[i] - ai[i] * re[i]; re[i] = r; im[i] = ii; }
  F.f(re, im, true);
  let e0 = 0; for (let i = 0; i < W; i++) e0 += x[i] * x[i];
  let eT = e0; const d = new Float64Array(tMax + 2);
  for (let t = 1; t <= tMax + 1; t++) { eT += x[t + W - 1] * x[t + W - 1] - x[t - 1] * x[t - 1]; d[t] = Math.max(0, e0 + eT - 2 * re[t]); }
  // kumulativno normalizovana
  const cm = new Float64Array(tMax + 2); cm[0] = 1; let run = 0;
  for (let t = 1; t <= tMax + 1; t++) { run += d[t]; cm[t] = run > 0 ? (d[t] * t) / run : 1; }
  let tau = -1;
  for (let t = tMin; t <= tMax; t++) if (cm[t] < thr) { while (t + 1 <= tMax && cm[t + 1] < cm[t]) t++; tau = t; break; }
  if (tau < 0) { let b = tMin; for (let t = tMin; t <= tMax; t++) if (cm[t] < cm[b]) b = t; tau = b; }
  const off = tau > 1 && tau < tMax ? parabolic(cm[tau - 1], cm[tau], cm[tau + 1]) : 0;
  return { f: sr / (tau + off), conf: 1 - Math.min(1, cm[tau]) };
}

/** McLeod Pitch Method: NSDF, prvi „ključni“ maksimum ≥ k·najveći. conf = jasnoća (vrednost NSDF-a). */
export function pitchMPM(x, sr, { fmin = FMIN, fmax = FMAX, k = MPM_K } = {}) {
  k = pitchMPM.k ?? k;
  const n = x.length, tMax = Math.min(Math.ceil(sr / fmin), n - 2), tMin = Math.max(2, Math.floor(sr / fmax));
  const r = acf(x, tMax);
  // m(τ) = Σ_{j<n−τ} x_j² + x_{j+τ}²
  const nsdf = new Float64Array(tMax + 2);
  let m = 2 * r[0];
  for (let t = 0; t <= tMax + 1; t++) { if (t > 0) m -= x[t - 1] * x[t - 1] + x[n - t] * x[n - t]; nsdf[t] = m > 0 ? (2 * r[t]) / m : 0; }
  const peaks = [];
  let t = 1;
  while (t < tMax && nsdf[t] > 0) t++; // preskoči deo oko nultog pomaka (od τ = 0, ne od tMin — inače se gubi prvi vrh za E6)
  while (t < tMax) {
    while (t < tMax && nsdf[t] <= 0) t++;
    let best = t;
    while (t < tMax && nsdf[t] > 0) { if (nsdf[t] > nsdf[best]) best = t; t++; }
    if (best < tMax && best >= tMin) peaks.push(best);
  }
  if (!peaks.length) return null;
  const top = Math.max(...peaks.map((p) => nsdf[p]));
  const pick = peaks.find((p) => nsdf[p] >= k * top);
  const off = parabolic(nsdf[pick - 1], nsdf[pick], nsdf[pick + 1]);
  return { f: sr / (pick + off), conf: nsdf[pick] };
}

/** Spektar (Hann, dopunjen nulama) — amplitude. */
function spectrum(x, N) {
  const F = getFFT(N), re = F.re, im = F.im, n = Math.min(x.length, N);
  re.fill(0); im.fill(0);
  for (let i = 0; i < n; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((TAU * i) / (n - 1)));
  F.f(re, im);
  const mag = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}
/** Harmonijski zbir: za svaki kandidat f0 zbir harmonika (sa malom tolerancijom za neharmoničnost žice),
 *  pomnožen „pokrivenošću“ (koliko očekivanih harmonika zaista postoji) — podton (f0/2, f0/3) nema svaki 2./3. harmonik. */
export function harmonicScore(mag, sr, N, f0, { H = 10, floor = 0 } = {}) {
  const bin = sr / N; let sum = 0, have = 0, want = 0, wsum = 0;
  for (let h = 1; h <= H; h++) {
    const fh = f0 * h * Math.sqrt(1 + 1e-4 * h * h);
    if (fh > 5000) break;
    const c = fh / bin, tol = Math.max(1.5, c * 0.012);
    let p = 0; for (let b = Math.max(1, Math.floor(c - tol)); b <= Math.min(mag.length - 1, Math.ceil(c + tol)); b++) if (mag[b] > p) p = mag[b];
    const w = 1 / (0.6 + 0.4 * h);
    sum += w * p; wsum += w; want++;
    if (p > floor) have++;
  }
  return { s: wsum ? sum / wsum : 0, cover: want ? have / want : 0, want };
}
export function pitchHS(x, sr, { fmin = FMIN, fmax = FMAX, N = 8192, mag = null } = {}) {
  const M = mag || spectrum(x, N);
  let mx = 0; for (let i = 1; i < M.length; i++) if (M[i] > mx) mx = M[i];
  if (!(mx > 0)) return null;
  const floor = mx * 0.06;
  let best = null;
  for (let c = 1200 * Math.log2(fmin / 440); c <= 1200 * Math.log2(fmax / 440); c += 10) {
    const f0 = 440 * Math.pow(2, c / 1200);
    const r = harmonicScore(M, sr, N, f0, { floor });
    const v = r.s * Math.pow(r.cover, 1.5);
    if (!best || v > best.v) best = { f: f0, v, cover: r.cover };
  }
  // fino: ±10 centi oko najboljeg (1 cent korak)
  const c0 = 1200 * Math.log2(best.f / 440);
  for (let c = c0 - 10; c <= c0 + 10; c += 1) {
    const f0 = 440 * Math.pow(2, c / 1200), r = harmonicScore(M, sr, N, f0, { floor }), v = r.s * Math.pow(r.cover, 1.5);
    if (v > best.v) best = { f: f0, v, cover: r.cover };
  }
  return { f: best.f, conf: best.cover };
}
/** Spoj: MPM daje period (radi i bez osnovnog tona), harmonijska provera bira oktavu/podton (f, f/2, f/3, 2f). */
export function pitchFusion(x, sr, opts = {}) {
  const a = pitchMPM(x, sr, opts);
  if (!a) return null;
  const N = 8192, M = spectrum(x, N);
  let mx = 0; for (let i = 1; i < M.length; i++) if (M[i] > mx) mx = M[i];
  const floor = mx * 0.06;
  let best = null;
  for (const k of [1 / 3, 1 / 2, 1, 2, 3]) {
    const f = a.f * k; if (f < FMIN * 0.97 || f > FMAX) continue;
    const r = harmonicScore(M, sr, N, f, { floor });
    // prednost originalnom periodu; viši kandidat mora da objasni i jači deo spektra
    const v = r.s * Math.pow(r.cover, 1.5) * (k === 1 ? 1.15 : 1);
    if (!best || v > best.v) best = { f, v };
  }
  return best ? { f: best.f, conf: a.conf } : null;
}
export const METHODS = { yin: pitchYIN, mpm: pitchMPM, hs: pitchHS, fusion: pitchFusion };

/**
 * „Samo novi zvuk“: iz isečka posle napada ukloni ono što je zvučalo i pre (glas koji traje, stara žica):
 * maska po opsezima m = max(0, 1 − α·|pre|/|posle|) (|pre| = najveće od susedna 3 opsega, da i blago klizanje glasa
 * bude uklonjeno), pa nazad u vreme. Kad pre nije bilo ničega, isečak ostaje isti.
 */
export function preMagnitudes(pre, n) {
  const N = pow2(n * 2), F = getFFT(N), re = F.re, im = F.im;
  re.fill(0); im.fill(0); for (let i = 0; i < Math.min(n, pre.length); i++) re[i] = pre[pre.length - Math.min(n, pre.length) + i];
  F.f(re, im);
  const pm = new Float64Array(N / 2 + 1);
  for (let i = 0; i <= N / 2; i++) pm[i] = Math.hypot(re[i], im[i]);
  return pm;
}
export function isolateNew(post, pre, alpha = 1.3, pmCached = null) {
  const n = post.length, N = pow2(n * 2), F = getFFT(N), re = F.re, im = F.im;
  const pm = pmCached || preMagnitudes(pre, n);
  re.fill(0); im.fill(0); for (let i = 0; i < n; i++) re[i] = post[i];
  F.f(re, im);
  for (let i = 0; i <= N / 2; i++) {
    const a = Math.hypot(re[i], im[i]);
    const p = Math.max(pm[Math.max(0, i - 1)], pm[i], pm[Math.min(N / 2, i + 1)]);
    const m = a > 0 ? Math.max(0, 1 - (alpha * p) / a) : 0;
    re[i] *= m; im[i] *= m;
    if (i > 0 && i < N / 2) { re[N - i] = re[i]; im[N - i] = -im[i]; }
  }
  F.f(re, im, true);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = re[i];
  return out;
}

/** Snaga (Goertzel sa Hann prozorom — malo „curenja“ sa jakih harmonika) na frekvencijama fs. */
function powerAt(x, sr, fs) {
  let e = 0; const n = x.length;
  for (const f of fs) {
    if (f > sr * 0.45) continue;
    const c = 2 * Math.cos((TAU * f) / sr); let s1 = 0, s2 = 0;
    for (let i = 0; i < n; i++) { const s0 = x[i] * (0.5 - 0.5 * Math.cos((TAU * i) / (n - 1))) + c * s1 - s2; s2 = s1; s1 = s0; }
    e += s1 * s1 + s2 * s2 - c * s1 * s2;
  }
  return e;
}
/**
 * Provera „da li je zapravo niža nota“: periodični metodi (MPM/YIN) skoče na 2. ili 3. harmonik kad je osnovni ton
 * slab (čest slučaj na telefonu). Ako između harmonika pronađene note (na f/k·j, j nije deljivo sa k) ima energije
 * (bar `ratio` od snage same note) i ta energija je NOVA (bar 2× jača nego pre napada) — prava nota je f/k.
 * Čista visoka nota tamo nema ništa; stara nota koja još zvoni ne računa se (bila je i pre).
 */
export function subharmonicFix(x, sr, f, pre = null, ratio = 0.08, fmin = FMIN) {
  const on = powerAt(x, sr, [f]);
  if (!(on > 0)) return f;
  let best = f;
  for (const k of [2, 3]) {
    const fl = f / k; if (fl < fmin * 0.97) continue;
    const off = []; for (let j = 1; j <= 2 * k; j++) if (j % k) off.push(fl * j * Math.sqrt(1 + 1e-4 * j * j));
    const offE = powerAt(x, sr, off), offPre = pre ? powerAt(pre, sr, off) * (x.length / pre.length) : 0;
    if (offE >= ratio * on && offE >= 2 * offPre) best = Math.min(best, fl);
  }
  return best;
}

// ---------------- motor ----------------
export const MONO_DEFAULTS = {
  method: 'mpm',    // izabran merenjem (MPM ≈ YIN > spoj > harmonijski zbir) — vidi tests/freeplayMono.test.mjs
  hpHz: 70,
  winMs: 27,        // svaki od dva prozora visine tona
  skipMs: 4,        // preskoči sam udarac trzalice
  decideMs: 110,    // najkasnije toliko posle napada (ms) — inače odustani
  riseDb: 4.5,      // najmanji porast jačine za ~25 ms (pravi trzaj 5–16 dB)
  fluxK: 2.2,       // flux iznad uobičajenog (medijana poslednjih ~0,4 s) puta ovo
  fluxMin: 25,
  newDb: -1.5,      // ili: nova energija (u opsezima koji su ojačali 2×) bar ovoliko u odnosu na staru
  aboveBgDb: 9,     // napad mora biti bar ovoliko iznad naučene pozadine
  stableCents: 10,  // dva prozora se slažu na ±10 centi (žica: ≤4; glas klizi: obično 15–300+)
  maxGrowDb: 0.8,   // jačina u drugom prozoru sme da poraste najviše ovoliko (žica slabi, glas raste)
  histCents: 20,    // ranija jasna merenja (posle napada) moraju biti u ±20 centi (ili oktavu/duodecimu dalje)
  strictCents: 5,  // dok neko priča: treći prozor mora biti ovoliko blizu
  speechTau: 1500,  // ms — koliko dugo se pamti da neko priča
  speechOn: 0.18,   // udeo „klizećih“ okvira iznad kog važi strože pravilo
  minConf: { yin: 0.8, mpm: 0.8, hs: 0.6, fusion: 0.8 },
  isolate: true,
  newPitchCents: 80, // visina celog zvuka je „nova“ ako je bar ovoliko daleko od onoga što je zvučalo pre napada
  subFix: false,    // provera oktave/duodecime niže — merenjem lošija od samog MPM-a, isključena
  subRatio: 0.08,
  legato: true,
  legatoCents: 70,  // nova visina bar ovoliko daleko (≥ ~pola tona + rezerva)
  polyHarm: 0,        // (merenjem: ne razdvaja akord od note — bas akorda „objašnjava“ skoro sve; isključeno)
  holdConf: 0.95,    // sasvim jasna jedna nota (≥ ovoliko) se nikad ne zadržava
  chordMs: 330,       // akord se imenuje ~0,33 s posle udarca (žice se „skupe“; duži prozor = jasniji tonovi)
  chordMin: 0.74,    // najmanja sličnost sa akordom (apstraktni šabloni)
  chordMinStrict: 0.86,
  soloConf: 0.93,    // jasnoća jednog izvora iznad koje to nije akord (dok neko priča)
  chordMinConf: 0.2, speechSoloConf: 0.9, speechMinConf: 0.35,  // ispod ovoga je šum (suglasnik, kucanje), ne akord
  chordModel: 'voiced', // 'voiced' = šabloni po stvarnim hvatovima (izabrano merenjem), 'template' = apstraktni šabloni
  voicedMin: 0.8, voicedMinStrict: 0.9, voicedTriadMargin: 0.1, voicedSure: 0.9,
  chordStrongRel: 0.18, // ton „postoji“ u akordu ako ima bar ovoliko od najjačeg (osnovni ton akorda je često udvostručen)
  strumRiseMs: 15,    // porast duži od ovoga + niska nota → možda akord (čeka se provera)
  strumBassMidi: 56,  // ispod G#3
  strumRiseOnlyMs: 24, // ovoliko dug porast → udarac i kod viših nota
  dupMs: 120,        // ista nota dvaput u ovoliko ms = jedan trzaj
  repeatMs: 700, repeatRiseDb: 1, // ponovljena ista nota dok zvoni: mora jačina da skoči bar ovoliko
  legatoWindowMs: 900, // posle poslednje note toliko se još prate hammer-on/pull-off
  maxCents: 50,
};

export function createMonoEngine({ sr: srIn = 48000, a4 = 440, params = {} } = {}) {
  // analiza na pola učestanosti (48 → 24 kHz): note gitare su ≤ 1,4 kHz, sve korisno je ispod 6 kHz — upola manje računa
  const dec = srIn >= 32000 && !params.noDecimate ? 2 : 1, sr = srIn / dec;
  const P = { ...MONO_DEFAULTS, ...params, minConf: { ...MONO_DEFAULTS.minConf, ...(params.minConf || {}) } };
  const est = METHODS[P.method];
  const minConf = P.minConf[P.method];
  // istorija (~1 s) visokopropusno filtriranog signala
  const HL = 1 << Math.ceil(Math.log2(sr * 1.0)), hist = new Float32Array(HL); let wpos = 0, total = 0;
  // HP filter (2. reda)
  const w = Math.tan((Math.PI * P.hpHz) / sr), kk = 1 / (1 + Math.SQRT2 * w + w * w);
  const hb0 = kk, hb1 = -2 * kk, hb2 = kk, ha1 = 2 * (w * w - 1) * kk, ha2 = (1 - Math.SQRT2 * w + w * w) * kk;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  // niskopropusni pre proređivanja (Butterworth 4. reda, ~0,4·nova učestanost)
  const lp = [0.5412, 1.3066].map((q) => { const wl = Math.tan((Math.PI * sr * 0.4) / srIn), k2 = 1 / (1 + wl / q + wl * wl); return { b0: wl * wl * k2, b1: 2 * wl * wl * k2, b2: wl * wl * k2, a1: 2 * (wl * wl - 1) * k2, a2: (1 - wl / q + wl * wl) * k2, x1: 0, x2: 0, y1: 0, y2: 0 }; });
  let decPhase = 0;
  // okviri za napad: FFT 1024, korak ~4 ms
  const FN = pow2(sr * 0.02), HOP = Math.round(sr * 0.004), FB = Math.min(FN / 2, Math.round((6000 / sr) * FN));
  const hann = new Float64Array(FN); for (let i = 0; i < FN; i++) hann[i] = 0.5 - 0.5 * Math.cos((TAU * i) / (FN - 1));
  const L1 = new Float32Array(FB), L2 = new Float32Array(FB), L0 = new Float32Array(FB), bg = new Float32Array(FB).fill(-120);
  const Pring = Array.from({ length: 8 }, () => new Float32Array(FB));
  const fluxHist = new Float32Array(100); let fhN = 0, sinceHop = 0, frames = 0;
  const lvHist = new Float32Array(16); // jačina (dB) po okviru, za porast za ~25 ms
  let lastOn = -1e9, cand = null;
  const pending = []; // napadi koji čekaju visinu tona
  const chordChecks = []; // napadi koji čekaju proveru akorda
  let lastPolyAt = -1e9, lastChord = null, lastChordEmit = -1e9;
  let active = null;  // nota koja zvoni (za legato): { m, at, lastTrack, peakDb }
  let id = 0, bgDb = -120, noisy = false, floorDb = 0, hopE = 0, hopN = 0;
  const out = [];
  const tNow = () => (total / sr) * 1000;
  const seg = (fromMs, lenMs) => { // uzorci iz istorije od vremena fromMs (apsolutno), dužine lenMs
    const n = Math.round((lenMs / 1000) * sr), start = Math.round((fromMs / 1000) * sr);
    if (start < total - HL || start + n > total) return null;
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) o[i] = hist[(start + i) & (HL - 1)];
    return o;
  };
  const midiOf = (f) => 69 + 12 * Math.log2(f / a4);
  // jačina samo na harmonicima note (Goertzel na h·f, h = 1…6) — glas ispod ne smeta
  function partialsDb(x, f) {
    let e = 0;
    for (let h = 1; h <= 6; h++) {
      const fh = f * h; if (fh > sr * 0.45) break;
      const c = 2 * Math.cos((TAU * fh) / sr); let s1 = 0, s2 = 0;
      for (let i = 0; i < x.length; i++) { const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; }
      e += s1 * s1 + s2 * s2 - c * s1 * s2;
    }
    return 10 * Math.log10(e / (x.length * x.length) + 1e-14);
  }
  function levelDb(x) { let e = 0; for (let i = 0; i < x.length; i++) e += x[i] * x[i]; return 10 * Math.log10(e / x.length + 1e-14); }

  function analyseFrame() {
    const F = getFFT(FN), re = F.re, im = F.im;
    for (let i = 0; i < FN; i++) { re[i] = hist[(total - FN + i) & (HL - 1)] * hann[i]; im[i] = 0; }
    F.f(re, im);
    let flux = 0, eAbove = 0, eAll = 0, eNew = 0, eOld = 0;
    const Pnow = Pring[(frames + 1) & 7], Ppre = Pring[(frames - 5) & 7]; // ~24 ms ranije
    for (let b = 1; b < FB; b++) {
      const p = re[b] * re[b] + im[b] * im[b], L = 10 * Math.log10(p + 1e-14);
      eAll += p; Pnow[b] = p;
      // nova energija: opsezi koji su ojačali bar 2× (nova nota donosi nove harmonike i dok stara još zvoni)
      if (frames > 8) { eOld += Ppre[b]; if (p > 2 * Ppre[b] && L > bg[b] + P.aboveBgDb) eNew += p - Ppre[b]; }
      // pozadina: brzo nadole, sporo nagore (~1,5 dB/s) — stalni tonovi postaju „pozadina“
      bg[b] = L < bg[b] ? bg[b] + (L - bg[b]) * 0.3 : bg[b] + Math.min(0.006, (L - bg[b]) * 0.002);
      if (L > bg[b] + P.aboveBgDb) { const d = L - Math.max(L1[b], L2[b]); if (d > 2) flux += d - 2; eAbove += p; }
      L2[b] = L1[b]; L1[b] = L0[b]; L0[b] = L;
    }
    frames++;
    const lv = 10 * Math.log10(eAll / FN + 1e-14);
    const newDb = 10 * Math.log10((eNew + 1e-14) / (eOld + 1e-14));
    lvHist[frames & 15] = lv;
    // pozadina sobe (dBFS-ish) — za „previše buke“
    // pozadina = najtiši nivo (brzo nadole, vrlo sporo nagore ~0,1 dB/s): priča ili sviranje je ne podižu
    bgDb = lv < bgDb ? bgDb + (lv - bgDb) * 0.2 : bgDb + Math.min(0.0004, (lv - bgDb) * 0.0004);
    fluxHist[fhN++ % fluxHist.length] = flux;
    const n = Math.min(fhN, fluxHist.length), arr = Array.from(fluxHist.subarray(0, n)).sort((a, b) => a - b);
    const med = arr[Math.floor(n * 0.5)] || 0;
    const rise = lv - lvHist[(frames - 6) & 15]; // ~24 ms ranije
    const t = tNow();
    if (P.trace && t >= P.trace[0] && t <= P.trace[1]) P.debug?.push({ t, why: 'frame', flux: Math.round(flux), med: Math.round(med), rise: +rise.toFixed(1), lv: +lv.toFixed(1) });
    // kandidat: nagao skok fluksa; potvrda: jačina u narednih ~28 ms poraste za riseDb u odnosu na pre kandidata
    if (frames > 30 && !cand && flux > Math.max(P.fluxMin, med * P.fluxK) && t - lastOn > 45) {
      cand = { t, pre: Math.min(lvHist[(frames - 1) & 15], lvHist[(frames - 2) & 15], lvHist[(frames - 3) & 15]), flux };
    }
    if (cand) {
      cand.jump = Math.max(cand.jump || 0, lv - lvHist[(frames - 2) & 15]); // najveći skok za ~8 ms (oštrina napada)
      if (lv - cand.pre >= P.riseDb || newDb >= P.newDb) {
        lastOn = cand.t;
        const chk = { at: cand.t - (HOP / sr) * 500, due: cand.t + P.chordMs };
        chordChecks.push(chk);
        pending.push({ at: chk.at, preLv: cand.pre, rise: lv - cand.pre, jump: cand.jump, newDb, chk });
        P.debug?.push({ t: cand.t, why: 'onset', flux: Math.round(cand.flux), med: Math.round(med), rise: +(lv - cand.pre).toFixed(1) });
        cand = null;
      } else if (t - cand.t > 28) cand = null;
    }
    return lv;
  }

  let preCache = null;
  function estimate(fromMs, preAt = null) {
    const raw = seg(fromMs, P.winMs);
    if (!raw) return null;
    let x = raw, pre = null, r = null;
    // Napad: ako je pre napada nešto zvučalo (glas, stara žica) i ceo zvuk i dalje „hvata“ tu staru visinu,
    // visina se meri samo na NOVOM zvuku. Kad je visina celog zvuka jasno nova — ostaje ona (izdvajanje bi
    // uz susednu notu, pola/ceo ton dalje, uklonilo i osnovni ton nove note).
    if (preAt != null && P.isolate) {
      // „pre“ je isti za sve pokušaje istog napada → računa se jednom; tišina pre = nema šta da se ukloni
      if (!preCache || preCache.at !== preAt) {
        const pr = seg(preAt - P.winMs - 2, P.winMs);
        preCache = { at: preAt, pre: pr, silent: !pr || levelDb(pr) < bgDb + 6, pm: null, pitch: null };
        if (pr && !preCache.silent) { preCache.pm = preMagnitudes(pr, raw.length); const pp = est(pr, sr); if (pp && pp.conf >= 0.8) preCache.pitch = midiOf(pp.f); }
      }
      pre = preCache.pre;
      if (pre && !preCache.silent) {
        r = est(raw, sr);
        const same = !r || r.conf < minConf || (preCache.pitch != null && Math.abs(midiOf(r.f) - preCache.pitch) * 100 < P.newPitchCents);
        if (same) { const iso = isolateNew(raw, pre, 1.3, preCache.pm); if (levelDb(iso) > levelDb(raw) - 20) { x = iso; r = null; } }
      }
    }
    if (!r) r = est(x, sr);
    if (!r || !(r.f > FMIN * 0.97 && r.f < FMAX)) return null;
    // oktava/duodecima niže — na celom zvuku (izdvajanje ume da ukloni slab osnovni ton), uz poređenje sa „pre“
    if (P.subFix) r.f = subharmonicFix(raw, sr, r.f, pre, P.subRatio);
    return { m: midiOf(r.f), conf: r.conf, lv: levelDb(x), x, f: r.f };
  }

  /** Udeo snage (80–2500 Hz) na harmonicima note f (uz malu neharmoničnost žice): jedna žica ~0,8+, akord manje. */
  function harmonicity(x, f) {
    if (!x || x.length < 64) return 1;
    const N = pow2(Math.max(2048, x.length)), M = spectrum(x, N), bin = sr / N;
    let tot = 0, on = 0;
    const lo = Math.ceil(75 / bin), hi = Math.min(M.length - 1, Math.floor(2500 / bin));
    for (let k = lo; k <= hi; k++) tot += M[k] * M[k];
    const used = new Set();
    for (let h = 1; h * f < 2500; h++) {
      const c = (f * h * Math.sqrt(1 + 1e-4 * h * h)) / bin, w = Math.max(2, c * 0.01);
      for (let k = Math.max(lo, Math.floor(c - w)); k <= Math.min(hi, Math.ceil(c + w)); k++) if (!used.has(k)) { used.add(k); on += M[k] * M[k]; }
    }
    return tot > 0 ? on / tot : 1;
  }
  /** Oznake udarca preko žica: koliko traje porast (pojedinačan trzaj ~ par ms, udarac 15–60 ms) i kako se menja
   *  udeo visokih tonova (nadole: prvo debele žice). */
  function strumFeatures(at) {
    const avail = tNow() - at + 10, x = seg(at - 10, Math.min(80, avail)); if (!x || avail < 40) return null;
    const blk = Math.round(sr * 0.002), env = [];
    for (let i = 0; i + blk <= x.length; i += blk) { let e = 0; for (let k = 0; k < blk; k++) e += x[i + k] * x[i + k]; env.push(e / blk); }
    const base = Math.min(...env.slice(0, 4)), mx = Math.max(...env.slice(4));
    let t10 = -1, t90 = -1; for (let i = 4; i < env.length; i++) { const v = env[i] - base; if (t10 < 0 && v >= 0.1 * (mx - base)) t10 = i; if (t90 < 0 && v >= 0.8 * (mx - base)) { t90 = i; break; } }
    const hiRatio = (y) => { if (!y) return 0; const N = 1024, M = spectrum(y, N), bin = sr / N; let lo = 0, hi = 0; for (let k = Math.ceil(70 / bin); k < M.length; k++) { const p2 = M[k] * M[k]; if (k * bin < 700) lo += p2; else hi += p2; } return hi / (lo + hi + 1e-14); };
    const h1 = hiRatio(seg(at, 15)), h2 = hiRatio(seg(at + 25, 20));
    return { riseMs: t10 >= 0 && t90 >= 0 ? (t90 - t10) * 2 : -1, hiEarly: +h1.toFixed(2), hiLate: +h2.toFixed(2) };
  }
  // Šabloni po stvarnim hvatovima na gitari (prva 3 hvata svakog uobičajenog akorda): očekivana hroma = svaka žica
  // sa svojim harmonicima (1/h, viši tonovi slabije — isto kao u merenju). Udvostručen osnovni ton i alikvoti su uračunati.
  const VOICED = (() => {
    const out = [], ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    for (const rn of ROOTS) for (const q of ['', 'm', '7', 'm7', 'maj7']) {
      const name = rn + q;
      for (const v of getVoicings(name).slice(0, 3)) {
        const ch = new Float64Array(12);
        v.frets.forEach((f, si) => { if (f < 0) return; const m = OPEN_M[si] + f;
          for (let h = 1; h <= 6; h++) { const fr = 440 * Math.pow(2, (m - 69) / 12) * h; if (fr > 2000) break; ch[(m + Math.round(12 * Math.log2(h)) + 120) % 12] += (1 / h) * (fr < 400 ? 1 : 400 / fr); } });
        const nrm = Math.hypot(...ch); out.push({ name, q, root: ROOTS.indexOf(rn), v: ch.map((x) => x / nrm) });
      }
    }
    return out;
  })();
  function voicedMatch(chroma, allowed) {
    const nrm = Math.hypot(...chroma) || 1, best = new Map();
    for (const t of VOICED) {
      if (!allowed.includes(t.q)) continue;
      let d = 0; for (let k = 0; k < 12; k++) d += t.v[k] * chroma[k];
      d /= nrm;
      if (!best.has(t.name) || best.get(t.name).score < d) best.set(t.name, { name: t.name, root: t.root, quality: t.q, score: d });
    }
    return [...best.values()].sort((a, b) => b.score - a.score);
  }
  // Akord ~0,33 s posle udarca: spektar novog zvuka (posle minus ono što je zvonilo pre), hroma, šabloni akorda.
  // Prikazuju se samo uobičajeni akordi (dur, mol, 7, m7, maj7); proširen akord samo ako je jasno bolji od trozvuka.
  const CHORD_Q = ['', 'm', '7']; // m7 / maj7 se mešaju sa trozvukom (npr. Em ↔ Cmaj7) — prikazuju se kao osnovni akord
  function evalChord(chk, strict = null) {
    const len = P.chordMs - 40, post = seg(chk.at + 30, len), pre = seg(chk.at - len - 5, len);
    if (!post) return null;
    const N = pow2(post.length), Mp = spectrum(post, N), Mq = pre ? spectrum(pre, N) : null;
    const db = new Float32Array(Mp.length);
    // novi zvuk = posle − pre; ali isti akord udaren ponovo skoro ništa „novo“ ne donosi → tada ceo zvuk
    let eP = 0, eD = 0;
    for (let k = 0; k < Mp.length; k++) { const a = Mp[k] * Mp[k], d = Math.max(0, a - (Mq ? 0.85 * Mq[k] * Mq[k] : 0)); eP += a; eD += d; db[k] = d; }
    const useAll = eD < 0.35 * eP && chordCtx(chk.at); // samo kad se upravo udaraju akordi (ponovljen udarac)
    for (let k = 0; k < Mp.length; k++) db[k] = 10 * Math.log10((useAll ? Mp[k] * Mp[k] : db[k]) + 1e-14);
    const cr = chromaFromSpectrum(db, sr, N, a4);
    if (!(cr.energy > 0)) return null;
    const mx = Math.max(...cr.chroma);
    const strong = cr.chroma.filter((v) => v >= (strict && !strict.triad ? 0.3 : P.chordStrongRel) * mx).length;
    if (strong < (strict ? strict.strong : 3)) { if (P.debug) chk.why = 'strong' + strong; return null; } // jedna ili dve note — nije akord
    const allowed = strict?.triad ? ['', 'm'] : CHORD_Q, voiced = P.chordModel === 'voiced';
    const cands = voiced ? voicedMatch(cr.chroma, allowed) : matchChord(cr.chroma, cr.bass).filter((c) => allowed.includes(c.quality));
    let top = cands[0];
    const minS = voiced ? (strict && !strict.triad ? P.voicedMinStrict : P.voicedMin) : strict ? strict.min : P.chordMin;
    if (!top || top.score < minS) { if (P.debug) chk.why = 'score' + (top ? top.score.toFixed(2) + (top.root) + top.quality : ''); return null; }
    if (!['', 'm'].includes(top.quality)) { const tri = cands.find((c) => c.root === top.root && ['', 'm'].includes(c.quality)); if (tri && tri.score >= top.score - (voiced ? P.voicedTriadMargin : 0.06)) top = tri; }
    if (presentChordNotes(cr.chroma, top.root, top.quality) < 3) { if (P.debug) chk.why = 'present'; return null; }
    const name = pcName(top.root, { flat: [3, 8, 10].includes(top.root) }) + top.quality;
    const second = cands.find((c) => c.root !== top.root);
    const remembered = !!(lastChord && lastChord.name === name && chk.at - lastChord.at < 4000);
    const sure = remembered || (top.score >= (voiced ? P.voicedSure : 0.84) && (!second || top.score - second.score >= 0.03));
    return { name, sure, score: top.score, pcs: QUALITIES[top.quality].intervals.map((iv) => (top.root + iv) % 12) };
  }
  const chordCtx = (at) => !!(lastChord && at - lastChord.at < 1500);
  function checkChords() {
    const t = tNow();
    for (let i = chordChecks.length - 1; i >= 0; i--) {
      const c = chordChecks[i];
      if (t < c.due) continue;
      chordChecks.splice(i, 1);
      // jasna pojedinačna nota (jedna žica) — nije akord; dok neko priča — ne nagađaj
      if (c.single && !c.poly) continue;
      // akord samo posle udarca preko žica (više žica / sporiji porast / zadržana niska nota) — ne od melodije koja zvoni
      const sf = c.poly || c.held ? null : strumFeatures(c.at);
      const strummy = c.poly || c.held || (sf && sf.riseMs >= P.strumRiseOnlyMs);
      // bez jasnih znakova udarca (nota nije prepoznata): akord samo ako je vrlo jasan (≥ 4 tona, visoka sličnost)
      // dok neko priča: akord samo uz jasan udarac (glas ne pravi akord od 3 tona sa naglim početkom)
      const onlySlow = strummy && !c.poly && !c.held;
      // jedan jasan periodičan izvor (glas ili jedna žica) — nije akord; akord je mešavina više perioda
      const solo = estimate(c.at + 40);
      const periodic = !!(solo && solo.conf >= P.soloConf);
      if (P.debug) c.periodic = solo ? +solo.conf.toFixed(2) : null; // samo sporiji porast (bez drugih znakova) → samo dur/mol
      // šum (suglasnik, kucanje) nema tonove → nije akord; jedan jasan izvor dok neko priča → glas
      const noisy = !c.poly && !c.held && (!solo || solo.conf < P.chordMinConf); // zadržana/višežična nota već je dokaz tonova
      // dok neko priča: glas je jedan jasan izvor (≥ 0,9) ili šum (< 0,35) — udarac preko žica je između
      const talky = speech > P.speechOn && (!strummy || periodic || (solo && (solo.conf >= P.speechSoloConf || solo.conf < P.speechMinConf)));
      const r = noisy || talky || c.at - lastChordEmit < 250 ? null : evalChord(c, strummy ? (onlySlow && !chordCtx(c.at) ? { min: P.chordMin, strong: 3, triad: true } : null) : chordCtx(c.at) ? null : { min: P.chordMinStrict, strong: 4 });
      P.debug?.push({ t: c.at, why: 'chord', r, periodic: c.periodic, poly: !!c.poly, held: c.held, rej: c.why || (c.at - lastChordEmit < 250 ? 'recent' : speech > P.speechOn ? 'speech' : ''), strummy });
      if (!r) { if (c.held && !chordCtx(c.at)) emit(c.held.m, c.at, 'attack', { lv: c.held.lv, late: true }); continue; }
      lastChordEmit = c.at; lastChord = { name: r.name, at: c.at, pcs: r.pcs }; active = null;
      out.push({ type: 'chord', id: ++id, at: c.at, t, chord: r.name, sure: r.sure, midis: [] });
    }
  }

  let lastEmit = null;
  function emit(m, at, kind, extra = {}) {
    const mi = Math.round(m);
    if (mi < MONO_MIN || mi > MONO_MAX || Math.abs(m - mi) * 100 > P.maxCents) return false;
    // isti trzaj uhvaćen dvaput (dva bliska napada) — jednom
    if (lastEmit && lastEmit.m === mi && at - lastEmit.at < P.dupMs) return false;
    // ista nota dok još zvoni: samo uz pravi novi trzaj (jačina skoči), inače je to ista žica koja zvoni
    if (kind === 'attack' && lastEmit && lastEmit.m === mi && at - lastEmit.at < P.repeatMs && (extra.rise ?? 99) < P.repeatRiseDb) return false;
    lastEmit = { m: mi, at };
    const ev = { type: 'note', id: ++id, at, t: tNow(), midis: [mi], cents: Math.round((m - mi) * 100), kind, ...extra };
    out.push(ev);
    active = { m: mi, f: m, at, last: tNow(), peakLv: kind === 'attack' ? extra.lv ?? -60 : active ? active.peakLv : -60, cand: null };
    return true;
  }

  // Posle napada: dva susedna prozora (svaki winMs) se pomeraju napred (korak ~6 ms) dok se ne slože —
  // žica počne da „govori“ 5–20 ms posle dodira trzalice, pa prvi par često nije čist. Najduže do decideMs.
  function checkPending() {
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i];
      const end = tNow(), from = end - 2 * P.winMs;
      if (from < p.at + P.skipMs) continue;
      if (p.lastTry && end - p.lastTry < 6) continue;
      p.lastTry = end;
      const late = end - p.at > P.decideMs;
      const A = estimate(from, p.at), B = estimate(from + P.winMs, p.at);
      const fail = (why) => { if (late) { pending.splice(i, 1); P.debug?.push({ t: p.at, why, A, B }); } };
      if (!A || !B) { fail('noest'); continue; }
      const okConf = A.conf >= minConf && B.conf >= minConf;
      const diff = Math.abs(A.m - B.m) * 100;
      // jačina posle napada: žica samo slabi (glas u prvim desetinama ms još raste) — meri se na harmonicima note
      const fAvg = (A.f + B.f) / 2, grow = partialsDb(B.x, fAvg) - partialsDb(A.x, fAvg);
      // sva ranija jasna merenja od napada moraju da se slažu (oktava dozvoljena — prvi prozor zna da „padne“ oktavu):
      // glas se pomera iz prozora u prozor, žica kad jednom stane — stoji
      const REL = [0, 1200, -1200, 1902, -1902, 2400, -2400]; // ista nota, oktava, duodecima (1/3), dve oktave
      const prevBad = okConf && (p.seen || []).some((e) => { const d = (e.m - B.m) * 100; return !REL.some((r) => Math.abs(d - r) <= P.histCents); });
      (p.seen ||= []).push(...[A].filter((e) => e.conf >= minConf));
      if (!okConf) { fail('conf'); continue; }
      if (prevBad) { fail('drift'); continue; }
      if (diff > P.stableCents) { fail('unstable'); continue; }
      if (grow > P.maxGrowDb || B.lv < A.lv - 9) { fail('drop'); continue; }
      // dok neko priča/peva: nota mora da stoji kroz tri prozora (još jedan par ~winMs kasnije)
      if (speech > P.speechOn || p.strict) {
        p.strict = true;
        if (!p.ok1) { p.ok1 = { m: B.m, t: end }; if (late) { pending.splice(i, 1); P.debug?.push({ t: p.at, why: 'speech' }); } continue; }
        if (end - p.ok1.t < P.winMs * 0.9) continue;
        if (Math.abs(B.m - p.ok1.m) * 100 > P.strictCents) { p.ok1 = null; if (late) { pending.splice(i, 1); P.debug?.push({ t: p.at, why: 'speech' }); } continue; }
      }
      pending.splice(i, 1);
      // jedna žica ili udarac preko više žica? Koliko zvuka objašnjavaju harmonici ove note
      const harm = harmonicity(seg(p.at + 8, end - p.at - 8), fAvg);
      const sf = strumFeatures(p.at);
      P.debug?.push({ t: p.at, why: 'accept', A, B, rise: p.rise, jump: p.jump, newDb: p.newDb, wait: end - p.at, grow, diff, harm, ...(sf || {}) });
      // dok se udaraju akordi: nota iz tog akorda je deo udarca, ne melodija
      const inChord = chordCtx(p.at) && lastChord.pcs.includes(Math.round((A.m + B.m) / 2) % 12);
      if (harm < P.polyHarm || p.at - lastPolyAt < 250 || inChord) { lastPolyAt = p.at; if (p.chk) p.chk.poly = true; active = null; continue; }
      // sporiji porast (udarac preko žica traje 15–60 ms) + niska nota (bas akorda) → sačekaj proveru akorda;
      // ako nije akord, nota se ipak prikaže (malo kasnije)
      const slow = sf && sf.riseMs >= 0 && Math.min(A.conf, B.conf) < P.holdConf && ((sf.riseMs >= P.strumRiseMs && B.m < P.strumBassMidi) || sf.riseMs >= P.strumRiseOnlyMs);
      if (slow && p.chk) { p.chk.held = { m: (A.m + B.m) / 2, lv: B.lv }; lastPolyAt = p.at; active = null; continue; }
      if (p.chk) p.chk.single = true;
      emit((A.m + B.m) / 2, p.at, 'attack', { lv: B.lv, rise: p.rise });
    }
  }

  // Kontekst „neko priča/peva“: svakih ~12 ms visina; okvir je „klizeći glas“ kad je jasan, a visina se
  // pomera 8–300 centi za 12 ms (≈650–25000 c/s; žica stoji, skokovi između nota su veći). Prosek ~1,5 s.
  let ctxT = 0, ctxPrev = null, speech = P.speechOn + 0.05, lastEst = null; // na početku strože, dok se ne vidi ko je u sobi
  function trackContext() {
    const t = tNow();
    if (t - ctxT < 12) return;
    const dt = t - ctxT; ctxT = t;
    // tišina: merenje bi ionako bilo nevažeće (ispod pozadine) — preskoči ga
    const quiet = lvHist[frames & 15] < bgDb + 6 && lvHist[(frames - 1) & 15] < bgDb + 6 && lvHist[(frames - 3) & 15] < bgDb + 6;
    const e = quiet ? null : estimate(t - P.winMs);
    lastEst = e;
    let glide = 0, valid = false;
    if (e && e.conf >= 0.75 && e.lv > bgDb + 6) {
      valid = true;
      if (ctxPrev) { const d = Math.abs(e.m - ctxPrev.m) * 100; glide = d > 15 && d < 300 ? 1 : 0; }
    }
    ctxPrev = valid ? e : null;
    if (valid) speech += (glide - speech) * (1 - Math.exp(-dt / P.speechTau));
    else speech *= Math.exp(-dt / (P.speechTau * 2));
  }

  // legato (hammer-on / pull-off / triler / klizanje): dok nota zvoni, prati se visina (~svakih 12 ms).
  // Nova nota samo ako je nova visina MIRNA u 3 uzastopna merenja (±stableCents — glas klizi), jasna,
  // jačina ne raste (žica slabi) i nije glasnija od trzaja koji ju je pokrenuo (hammer-on je tiši od trzaja).
  let trackT = 0;
  function trackLegato() {
    // dok neko priča/peva legato se ne prati (glas bi „vodio“ notu dalje)
    if (!P.legato || !active || pending.length || cand || speech > P.speechOn || chordCtx(tNow())) { if (active) active.cand = null; return; }
    const t = tNow();
    if (t - active.last > P.legatoWindowMs) { active = null; return; }
    if (t - trackT < 12) return;
    trackT = t;
    const e = lastEst && Math.abs(ctxT - t) < 1 ? lastEst : estimate(t - P.winMs);
    if (!e || e.conf < minConf || e.lv < bgDb + 12 || e.lv > active.peakLv + 3) { active.cand = null; return; }
    const d = (e.m - active.f) * 100;
    if (Math.abs(d) < P.legatoCents || [1200, 1902, 2400].some((r) => Math.abs(Math.abs(d) - r) < 60)) { active.cand = null; return; } // oktava/duodecima/dve oktave iste note = ista nota
    const c = active.cand;
    if (c && Math.abs((e.m - c.m0) * 100) <= P.stableCents && Math.abs((e.m - c.mLast) * 100) <= P.stableCents && e.lv <= c.lvLast + P.maxGrowDb) {
      c.n++; c.sum += e.m; c.mLast = e.m; c.lvLast = e.lv;
      if (c.n >= 3) { const peak = active.peakLv; emit(c.sum / c.n, c.at, 'legato', { lv: e.lv }); active.peakLv = peak; }
    } else active.cand = { m0: e.m, mLast: e.m, sum: e.m, n: 1, at: t - P.winMs, lvLast: e.lv };
  }

  return {
    params: P,
    /** Novi uzorci (redom, bez preklapanja). Vraća događaje nastale u ovom pozivu. */
    push(block) {
      out.length = 0;
      for (let i = 0; i < block.length; i++) {
        let xv = block[i];
        if (dec > 1) {
          for (const f of lp) { const o = f.b0 * xv + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2; f.x2 = f.x1; f.x1 = xv; f.y2 = f.y1; f.y1 = o; xv = o; }
          if ((decPhase = (decPhase + 1) % dec) !== 0) continue;
        }
        const yv = hb0 * xv + hb1 * x1 + hb2 * x2 - ha1 * y1 - ha2 * y2;
        x2 = x1; x1 = xv; y2 = y1; y1 = yv;
        hist[total & (HL - 1)] = yv; total++; hopE += yv * yv; hopN++;
        if (++sinceHop >= HOP && total >= FN) {
          // buka sobe u dBFS (najtiši nivo: brzo nadole, ~0,5 dB/s nagore) — za „previše buke“
          const d = 10 * Math.log10(hopE / Math.max(1, hopN) + 1e-14); hopE = 0; hopN = 0;
          floorDb = d < floorDb ? floorDb + (d - floorDb) * 0.3 : floorDb + Math.min(0.002, d - floorDb);
          sinceHop = 0; analyseFrame(); trackContext(); checkPending(); checkChords(); trackLegato(); }
      }
      return out.slice();
    },
    get bgDb() { return bgDb; },
    get floorDb() { return floorDb; },
    get lastOnset() { return lastOn; },
    /** Promena podešavanja u hodu (osetljivost). */
    setParams(o) { Object.assign(P, o || {}); },
    get speech() { return speech; },
    get noisy() { return noisy; },
    now: tNow,
  };
}
