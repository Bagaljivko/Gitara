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

const TAU = Math.PI * 2;
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
  maxGrowDb: 0.8,
  histCents: 20,
  strictCents: 5,  // dok neko priča: treći prozor mora biti ovoliko blizu
  speechTau: 1500,  // ms — koliko dugo se pamti da neko priča
  speechOn: 0.18,   // udeo „klizećih“ okvira iznad kog važi strože pravilo    // ranija jasna merenja (posle napada) moraju biti u ±20 centi (ili oktavu dalje)   // jačina u drugom prozoru sme da poraste najviše ovoliko (žica slabi, glas raste)
  minConf: { yin: 0.8, mpm: 0.8, hs: 0.6, fusion: 0.8 },
  isolate: true,
  newPitchCents: 80, // visina celog zvuka je „nova“ ako je bar ovoliko daleko od onoga što je zvučalo pre napada
  subFix: false,    // provera oktave/duodecime niže — merenjem lošija od samog MPM-a, isključena
  subRatio: 0.08,
  legato: true,
  legatoCents: 70,  // nova visina bar ovoliko daleko (≥ ~pola tona + rezerva)
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
        pending.push({ at: cand.t - (HOP / sr) * 500, preLv: cand.pre, rise: lv - cand.pre, jump: cand.jump, newDb });
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

  function emit(m, at, kind, extra = {}) {
    const mi = Math.round(m);
    if (mi < MONO_MIN || mi > MONO_MAX || Math.abs(m - mi) * 100 > P.maxCents) return false;
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
      P.debug?.push({ t: p.at, why: 'accept', A, B, rise: p.rise, jump: p.jump, newDb: p.newDb, wait: end - p.at, grow, diff });
      emit((A.m + B.m) / 2, p.at, 'attack', { lv: B.lv });
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
    if (!P.legato || !active || pending.length || cand || speech > P.speechOn) { if (active) active.cand = null; return; }
    const t = tNow();
    if (t - active.last > P.legatoWindowMs) { active = null; return; }
    if (t - trackT < 12) return;
    trackT = t;
    const e = lastEst && Math.abs(ctxT - t) < 1 ? lastEst : estimate(t - P.winMs);
    if (!e || e.conf < minConf || e.lv < bgDb + 12 || e.lv > active.peakLv + 3) { active.cand = null; return; }
    const d = (e.m - active.f) * 100;
    if (Math.abs(d) < P.legatoCents || Math.abs(Math.abs(d) - 1200) < 60 || Math.abs(Math.abs(d) - 1902) < 60) { active.cand = null; return; }
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
          sinceHop = 0; analyseFrame(); trackContext(); checkPending(); trackLegato(); }
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
