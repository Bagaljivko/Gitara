// Akordi → „Samo sviraj“: slušanje slobodnog sviranja (bez zadate note).
// Koristi proveru note iz Vežbi (practiceListen.js: guessNote / matchNote — korelacija na periodama tona) i
// imena akorda iz music.js; tunerov kod se ne koristi. Sve ovde radi i u Node-u (testovi sa simuliranom gitarom).
//
// Tok za svaki trzaj:
//  1) napad: nagli skok energije (blokovi 2,5 ms) iznad buke sobe — buka se meri pri otvaranju ekrana i stalno
//     se prilagođava, pa se računaju i tihi trzaji; osetljivost se može podesiti (1–5)
//  2) ~60 ms posle napada: zvuk mora još da traje (klik/kucanje nestanu) i ton mora da bude jasan (stabilna
//     periodičnost) — tek onda se nota prikaže (cilj: ≤ ~100 ms od trzaja). Nejasno → sačeka se ustaljen zvuk;
//     i dalje nejasno → ništa (nikad se ne pogađa nota koje nema).
//  3) ~180 ms posle napada: spektar novog zvuka (razlika u odnosu na zvuk pre trzaja — nota koja još zvoni od
//     ranije se ne računa kao nova) → dve note istovremeno, ili akord (ime samo ako se jasno čuju bar 3 note).
import { noteScore, matchNote } from './practiceListen.js';
import { QUALITIES, pcName } from './music.js';
import { chromaFromSpectrum, singleSourceRatio, matchChord, presentChordNotes } from './chordrec.js';

export const FP_MIN = 40, FP_MAX = 76; // E2 … E5 — pragovi 0–12 na svim žicama
const midiFreq = (m, a4) => a4 * Math.pow(2, (m - 69) / 12);

// ---------------- FFT (radix-2, jedan bafer, bez pravljenja nizova po pozivu) ----------------
export function createFFT(N) {
  const re = new Float32Array(N), im = new Float32Array(N), win = new Float32Array(N), mag = new Float32Array(N / 2);
  const rev = new Uint32Array(N), cos = new Float32Array(N / 2), sin = new Float32Array(N / 2);
  const bits = Math.log2(N);
  for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)); }
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / N); sin[i] = -Math.sin((2 * Math.PI * i) / N); }
  /** Amplituda spektra poslednjih N uzoraka iz buf (Hann prozor). Vraća deljeni niz (prepisuje se sledećim pozivom). */
  function run(buf, out = mag) {
    const off = buf.length - N;
    for (let i = 0; i < N; i++) { const j = rev[i], s = off + j; re[i] = s >= 0 ? buf[s] * win[j] : 0; im[i] = 0; }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let i = 0; i < N; i += size) for (let k = 0; k < half; k++) {
        const c = cos[k * step], s = sin[k * step], a = i + k, b = a + half;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
    for (let i = 0; i < N / 2; i++) out[i] = Math.hypot(re[i], im[i]);
    return out;
  }
  return { N, run };
}

// ---------------- Više nota iz spektra (harmonijski zbir) ----------------
const HW = [1, 0.62, 0.46, 0.38, 0.33, 0.29]; // težine harmonika 1–6
function peakAt(mag, f, binHz) { const b = Math.round(f / binHz); if (b < 1 || b >= mag.length - 1) return 0; return Math.max(mag[b - 1], mag[b], mag[b + 1]); }
function salience(mag, m, binHz, a4) { const f = midiFreq(m, a4); let s = 0; for (let h = 1; h <= 6; h++) s += HW[h - 1] * peakAt(mag, f * h, binHz); return s; }
// Da li je frekvencija f već „objašnjena“ (harmonik neke već nađene note)? Tada ne dokazuje novu notu.
function explained(f, found, a4) {
  // svetle žice imaju jake alikvote i do 40.; dozvoljeno malo odstupanje (blaga neharmoničnost prave žice)
  for (const m of found) { const f0 = midiFreq(m, a4), h = Math.round(f / f0); if (h >= 1 && h <= 48 && Math.abs(f - h * f0) < Math.max(8, 0.015 * f)) return true; }
  return false;
}
/** Doprinos note m koji NIJE objašnjen već nađenim notama (njihovi alikvoti ne čine novu notu). */
function exclusive(mag, m, binHz, a4, found) {
  const f = midiFreq(m, a4); let s = 0, own = 0;
  // „svoj“ dokaz: osnovni ili 2. harmonik (3. samo kod dubokih nota — mikrofon telefona slabo hvata ispod ~200 Hz)
  const ownMax = f < 200 ? 3 : 2;
  for (let h = 1; h <= 6; h++) { const fh = f * h; if (explained(fh, found, a4)) continue; const p = peakAt(mag, fh, binHz); s += HW[h - 1] * p; if (h <= ownMax) own = Math.max(own, p); }
  return { s, own };
}
/**
 * Note u spektru: najjača (ili zadata „first“ iz provere periode), pa svaka sledeća samo ako donosi zvuk koji
 * prethodne note ne objašnjavaju (bar rel × najjača) i ima sopstveni osnovni ili 2. harmonik. Oktava niže se
 * bira ako se čuje njen 3. harmonik (mikrofon telefona slabo hvata duboke osnovne tonove).
 */
export function notesFromSpectrum(mag, binHz, { a4 = 440, max = 6, rel = 0.3, first = null } = {}) {
  const found = [];
  let top = 0;
  if (first != null) { found.push(first); top = salience(mag, first, binHz, a4); }
  else {
    let best = -1, bs = 0;
    for (let m = FP_MIN; m <= FP_MAX; m++) { const sl = salience(mag, m, binHz, a4); if (sl > bs) { bs = sl; best = m; } }
    if (best < 0 || bs <= 0) return [];
    if (best - 12 >= FP_MIN) { const f = midiFreq(best - 12, a4); if (peakAt(mag, f * 3, binHz) > 0.3 * peakAt(mag, f * 2, binHz) && peakAt(mag, f * 2, binHz) > 0) best -= 12; }
    found.push(best); top = bs;
  }
  if (!(top > 0)) return found.map((midi) => ({ midi, s: 1 }));
  const out = [{ midi: found[0], s: 1 }];
  const peakTop = Math.max(...Array.from({ length: 6 }, (_, h) => peakAt(mag, midiFreq(found[0], a4) * (h + 1), binHz)));
  for (let n = 1; n < max; n++) {
    let best = -1, bs = 0, bestOwn = 0;
    for (let m = FP_MIN; m <= FP_MAX; m++) {
      if (found.includes(m) || explained(midiFreq(m, a4), found, a4)) continue;
      const e = exclusive(mag, m, binHz, a4, found);
      if (e.own < peakTop * 0.2) continue; // mora da ima svoj jasan alikvot
      if (e.s > bs) { bs = e.s; best = m; bestOwn = e.own; }
    }
    if (best < 0 || bs < top * rel) break;
    // da li je ovo zapravo alikvot niže note (×2, ×3, ×4) koja ima i svoj dokaz? (npr. H4 = 3. alikvot E3)
    for (const k of [2, 3, 4]) {
      const lf = midiFreq(best, a4) / k, l = Math.round(69 + 12 * Math.log2(lf / a4));
      if (l < FP_MIN || found.includes(l) || Math.abs(midiFreq(l, a4) - lf) > 0.02 * lf || explained(midiFreq(l, a4), found, a4)) continue;
      const e = exclusive(mag, l, binHz, a4, found);
      // svoj dokaz niže note: alikvot koji nije i alikvot više (osnovni, 2., 5. …)
      let ownL = 0; const fl = midiFreq(l, a4);
      for (const h of [1, 2, 4, 5]) { if (h % k === 0) continue; const fh = fl * h; if (!explained(fh, found, a4)) ownL = Math.max(ownL, peakAt(mag, fh, binHz)); }
      if (e.s >= bs * 0.45 && ownL >= peakTop * 0.06) { best = l; bs = e.s; bestOwn = ownL; break; }
    }
    // treća i dalje: samo ako zajedno čine akord (inače su to ostaci alikvota, ne nove note)
    if (n >= 2 && !chordFromNotes([...found, best])) break;
    found.push(best); out.push({ midi: best, s: bs / top, own: bestOwn / (peakTop || 1) });
  }
  return out;
}

// ---------------- Akord (bar 3 jasno čute note akorda) ----------------
const CHORD_Q = ['', 'm', '7', 'maj7', 'm7', 'sus2', 'sus4', 'dim', 'aug', '6', 'm6'];
const SIMPLE = { '': 0, m: 0, '7': 0.1, maj7: 0.15, m7: 0.12, sus2: 0.2, sus4: 0.2, dim: 0.3, aug: 0.3, '6': 0.25, m6: 0.25 };
const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Ime akorda iz čutih nota (MIDI), ili null. Bar 3 tona akorda, najviše 1 „strani“ ton; bas = koren ako može. */
export function chordFromNotes(midis) {
  const pcs = [...new Set(midis.map((m) => ((m % 12) + 12) % 12))];
  if (pcs.length < 3) return null;
  const bass = ((Math.min(...midis) % 12) + 12) % 12;
  let best = null;
  for (let r = 0; r < 12; r++) for (const q of CHORD_Q) {
    const tones = QUALITIES[q].intervals.map((iv) => (r + iv) % 12);
    const hit = tones.filter((x) => pcs.includes(x)).length, extra = pcs.filter((x) => !tones.includes(x)).length;
    if (hit < 3 || extra > 1 || !pcs.includes(r)) continue;
    const score = hit / tones.length - extra * 0.4 - SIMPLE[q] + (r === bass ? 0.3 : 0) + hit * 0.05;
    if (!best || score > best.score) best = { score, root: r, q };
  }
  return best ? PC[best.root] + best.q : null;
}

// ---------------- Glavni deo: obrada kadrova ----------------
// osetljivost 1 (manje) … 5 (više): koliko nagli skok (×) i koliko iznad buke sobe mora da bude trzaj
const SENS = { 1: [6, 5], 2: [5, 4], 3: [4, 3], 4: [3.2, 2.4], 5: [2.6, 1.9] };

/**
 * engine.process(buf, now) — buf: poslednjih ≥ 8192 uzoraka (najnoviji na kraju), now: vreme kraja kadra (ms).
 * Vraća { level, floor, events: [...] }:
 *  { type: 'note', id, at, midis: [m] }  — prva nota (brzo)
 *  { type: 'update', id, at, midis, chord } — posle spektra: dve note / akord / ispravka (samo ako se nešto menja)
 */
export function createFreeEngine({ sr = 48000, a4 = 440, sensitivity = 3 } = {}) {
  const fft = createFFT(8192), binHz = sr / fft.N;
  const pre = new Float32Array(fft.N / 2), post = new Float32Array(fft.N / 2), diff = new Float32Array(fft.N / 2), db = new Float32Array(fft.N / 2);
  let sens = SENS[sensitivity] || SENS[3];
  const B = Math.max(32, Math.round(sr * 0.0025));
  // sopstvena istorija zvuka (~0,35 s): „pre trzaja“ = pun prozor koji se završava tačno na napadu
  const HL = fft.N * 2, hist = new Float32Array(HL);
  const HN = 64, hAt = new Float64Array(HN), hE = new Float64Array(HN);
  let hN = 0, prevEnd = null, lastAt = -1e9, fl = -1, calib = [], t0 = null, id = 0;
  let pend = null;        // napad koji čeka proveru trajanja/tona
  const waiting = [];     // { id, at, due, kind: 'steady'|'poly'|'poly2', midis, strum }
  const done = new Map(); // id → poslednji javljen akord (da drugi pogled ne ponavlja isto)
  let lastChord = null;   // { name, at } — isti akord ponovo za par sekundi je „siguran“ (sviraju se ponavljanja)
  /**
   * Akord iz spektra novog zvuka (blaže pravilo nego za note):
   *  udarac preko žica: dovoljna 1 zasebno čuta nota akorda + jasni tonovi u spektru (ukupno 3);
   *  pojedinačni trzaj: 2 zasebno čute note + 3. jasan ton;
   *  ton koji može biti alikvot (kvinta/v. terca iznad čute note) računa se ako je dovoljno jak (≥ 60 %);
   *  septakordi/sus samo uz bar 3 zasebno čute note. „sure“ = sigurno; inače „možda“ (prikaz sa „?“).
   */
  function evalChord(found, strum, at) {
    for (let i = 0; i < diff.length; i++) db[i] = 20 * Math.log10(diff[i] + 1e-9);
    const cr = chromaFromSpectrum(db, sr, fft.N, a4);
    if (!(cr.energy > 0) || (!strum && singleSourceRatio(cr.peaks) > 0.88)) return null;
    const cmax = Math.max(...cr.chroma) || 1;
    const sepAll = new Set(found.map((x) => x.midi % 12));
    for (const cand of matchChord(cr.chroma, cr.bass).slice(0, 6)) {
      if (cand.score < (strum ? 0.68 : 0.72)) break;
      const tones = QUALITIES[cand.quality].intervals.map((iv) => (cand.root + iv) % 12);
      if (!['', 'm'].includes(cand.quality) && sepAll.size < 3) continue;
      const sep = new Set([...sepAll].filter((pc) => tones.includes(pc)));
      // septima/sekunda/kvarta (7, maj7, sus …) mora da bude zasebno čuta nota — inače je to alikvot terce
      const extra = QUALITIES[cand.quality].intervals.filter((iv) => ![0, 3, 4, 7].includes(iv)).map((iv) => (cand.root + iv) % 12);
      // … i ne sme biti alikvot druge čute note (kvinta/terca iznad nje, npr. D# iznad G# u E-duru)
      const ovOf = (pc) => [...sep].some((x) => x !== pc && ((x + 7) % 12 === pc || (x + 4) % 12 === pc));
      if (extra.some((pc) => !sep.has(pc) || ovOf(pc))) continue;
      const overtone = (pc) => [...sep].some((x) => (x + 7) % 12 === pc || (x + 4) % 12 === pc);
      const strongAll = tones.filter((pc) => !sep.has(pc) && cr.chroma[pc] >= (overtone(pc) ? 0.6 : 0.4) * cmax);
      const strongClean = strongAll.filter((pc) => !overtone(pc)).length;
      // pojedinačan trzaj (ne udarac preko žica): akord samo uz 3 zasebno čute note
      if (presentChordNotes(cr.chroma, cand.root, cand.quality) < 3 || sep.size < (strum ? 1 : 3) || sep.size + strongAll.length < 3) continue;
      const name = pcName(cand.root, { flat: [3, 8, 10].includes(cand.root) }) + cand.quality;
      // isti akord ponovo u roku od 4 s → siguran (sviraju se ponavljanja)
      const remembered = !!(lastChord && lastChord.name === name && at - lastChord.at < 4000);
      return { name, sure: (sep.size + strongClean >= 3 && cand.score >= 0.8) || remembered };
    }
    return null;
  }
  const GATE = 60;        // ms — zvuk mora još da traje (i daje isečak za proveru tona)
  // niskopropusni filter za isečak (kao u Vežbama): bolja provera periode
  const a = 1 - Math.exp((-2 * Math.PI * 1200) / sr);
  function lowpass(src) { const o = new Float32Array(src.length); let y1 = src[0] || 0, y2 = y1; for (let i = 0; i < src.length; i++) { y1 += a * (src[i] - y1); y2 += a * (y1 - y2); o[i] = y2; } return o; }
  const rmsTail = (buf, n) => { let e = 0; for (let i = buf.length - n; i < buf.length; i++) e += buf[i] * buf[i]; return Math.sqrt(e / n); };
  // Bez zadate note: nota oktavu/duodecimu niže „pristaje“ jednako dobro kao prava (njen period je umnožak) —
  // zato se uzima NAJVIŠA nota koja pristaje skoro kao najbolja (prava niža nota nikad ne pristaje višoj).
  const halfOf = (seg) => { const h = new Float32Array(seg.length >> 1); for (let i = 0; i < h.length; i++) h[i] = (seg[2 * i] + seg[2 * i + 1]) * 0.5; return h; };
  function guessFree(seg, preSeg = null) {
    const h = halfOf(seg), hp = preSeg ? halfOf(preSeg) : null;
    const post = new Float32Array(FP_MAX + 1), sc = new Float32Array(FP_MAX + 1);
    let bestRaw = 0, mb = FP_MIN;
    for (let m = FP_MIN; m <= FP_MAX; m++) {
      post[m] = noteScore(h, sr / 2, m, a4, 200);
      // ono što je zvonilo i pre trzaja vredi manje (nova nota je ona koja je „porasla“)
      sc[m] = hp ? post[m] - 0.5 * Math.max(0, noteScore(hp, sr / 2, m, a4, 200)) : post[m];
      if (post[m] > bestRaw) bestRaw = post[m];
      if (sc[m] > sc[mb]) mb = m;
    }
    if (bestRaw < 0.55) return null;
    // viša nota samo ako je tačan umnožak frekvencije (×2…×6): tada je „mb“ njen podton, a prava je viša
    let pick = mb;
    for (let m = mb + 1; m <= FP_MAX; m++) {
      const r = midiFreq(m, a4) / midiFreq(mb, a4), k = Math.round(r);
      if (k >= 2 && k <= 6 && Math.abs(r - k) < 0.03 && sc[m] >= sc[mb] - 0.05) pick = m;
    }
    // izabrana nota je jasno zvonila već pre trzaja: ako nije postala glasnija, to je stara nota (ne nova) —
    // tada druga jasna nota koja je porasla, ili ništa (sačekaj ustaljen zvuk); ako je glasnija — ista nota ponovo
    if (hp && post[pick] - sc[pick] > 0.25) {
      const f = midiFreq(pick, a4), louder = bandPower(seg, f) > 1.3 * bandPower(preSeg, f);
      if (!louder) {
        let alt = -1;
        for (let m = FP_MIN; m <= FP_MAX; m++) if (m % 12 !== pick % 12 && post[m] >= 0.55 && post[m] - sc[m] < 0.15 && (alt < 0 || sc[m] > sc[alt])) alt = m;
        return alt >= 0 ? alt : null;
      }
    }
    return pick;
  }
  // snaga jedne frekvencije po uzorku (Goertzel) — za poređenje „pre / posle“ trzaja
  function bandPower(seg, f) {
    const w = (2 * Math.PI * f) / sr, c = 2 * Math.cos(w);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < seg.length; i++) { const s0 = seg[i] + c * s1 - s2; s2 = s1; s1 = s0; }
    return (s1 * s1 + s2 * s2 - c * s1 * s2) / (seg.length * seg.length);
  }
  // snaga jedne frekvencije u isečku (Goertzel), u odnosu na ukupnu
  function goertzelRel(seg, f) {
    const w = (2 * Math.PI * f) / sr, c = 2 * Math.cos(w);
    let s1 = 0, s2 = 0, tot = 0;
    for (let i = 0; i < seg.length; i++) { const s0 = seg[i] + c * s1 - s2; s2 = s1; s1 = s0; tot += seg[i] * seg[i]; }
    const p = s1 * s1 + s2 * s2 - c * s1 * s2;
    return tot ? p / (tot * seg.length / 2) : 0;
  }
  // jasan ton: dobar pogodak i jasno bolji od susednih pragova
  function clearNote(seg, preSeg = null) {
    const g = guessFree(seg, preSeg);
    if (g == null) return null;
    // nota mora i da ZVUČI: energija na njenom osnovnom ili 2. harmoniku (zajednički „podton“ dve note je nema)
    const fg = midiFreq(g, a4);
    if (Math.max(goertzelRel(seg, fg), goertzelRel(seg, 2 * fg)) < 0.006) return null;
    const r = matchNote(seg, sr, g, a4);
    return r.ok && r.score >= 0.55 && r.margin >= 0.08 ? g : null;
  }

  function process(buf, now) {
    const events = [];
    if (t0 == null) t0 = now;
    const newN = prevEnd == null ? B * 8 : Math.min(buf.length, Math.max(B, Math.round(((now - prevEnd) / 1000) * sr)));
    prevEnd = now;
    const take = Math.min(newN, buf.length, HL);
    hist.copyWithin(0, take); hist.set(buf.subarray(buf.length - take), HL - take);
    const level = rmsTail(buf, Math.round(sr * 0.02));
    // isto, naglašeno (za prag buke i proveru da zvuk traje — u istim jedinicama kao napad)
    const n20 = Math.round(sr * 0.02); let ee = 0; for (let k = buf.length - n20; k < buf.length; k++) { const d = buf[k] - 0.95 * buf[k - 1]; ee += d * d; }
    const elev = Math.sqrt(ee / n20);
    // buka sobe: prvih ~0,6 s merenje (kao tunerova automatska osetljivost), posle prilagođavanje (brzo nadole, sporo nagore)
    if (now - t0 < 600) { calib.push(elev); const c = [...calib].sort((x, y) => x - y); fl = c[Math.floor(c.length * 0.5)]; }
    else fl = elev < fl ? fl + (elev - fl) * 0.2 : fl + (elev - fl) * 0.002;
    const minAbs = Math.max(0.0004, fl * sens[1]);
    for (let i = buf.length - newN - ((buf.length - newN) % B); i + B <= buf.length; i += B) {
      if (i < 0) continue;
      // „naglašen“ signal (razlika uzoraka): napad trzalice se jasno vidi i dok prethodne note još zvone
      let e = 0; for (let k = Math.max(1, i); k < i + B; k++) { const d = buf[k] - 0.95 * buf[k - 1]; e += d * d; }
      e /= B;
      let p = Infinity;
      if (hN >= 8) { p = 0; for (let k = hN - 8; k < hN; k++) p += hE[k % HN]; p /= 8; }
      const at = now - ((buf.length - i) / sr) * 1000;
      hAt[hN % HN] = at; hE[hN % HN] = e; hN++;
      if (now - t0 > 300 && e > p * sens[0] && Math.sqrt(e) > minAbs && at > lastAt + 60) {
        // udarac preko žica: više napada u ~80 ms = jedan „strum“ (vreme prvog; broji se koliko žica)
        if (pend && at - pend.at < 80) { pend.n++; pend.rms = Math.max(pend.rms, Math.sqrt(e)); continue; }
        // spektar pre napada (staro zvono) — da se kasnije vidi šta je NOVO
        if (!pend) { const back = Math.round(((now - at) / 1000) * sr); fft.run(hist.subarray(0, Math.max(fft.N, HL - back)), pre); }
        pend = { at, rms: Math.sqrt(e), preRms: Math.sqrt(p), n: 1 };
      }
    }
    // provera ~60 ms posle napada: zvuk traje + jasan ton
    if (pend && now - pend.at >= GATE) {
      const c = pend; pend = null;
      if (elev >= c.rms * 0.1 && elev >= c.preRms * 1.25) {
        lastAt = c.at;
        const from = Math.max(0, buf.length - Math.round(((now - (c.at + 12)) / 1000) * sr));
        // ~80 ms zvuka tačno pre napada (iz sopstvene istorije) — šta je već zvonilo
        const back = Math.round(((now - c.at) / 1000) * sr), n80 = Math.round(sr * 0.08);
        const preSeg = c.preRms > 0.0005 ? lowpass(hist.subarray(Math.max(0, HL - back - n80), Math.max(n80, HL - back))) : null;
        const m = clearNote(lowpass(buf.subarray(from)), preSeg);
        const nid = ++id;
        if (m != null) events.push({ type: 'note', id: nid, at: c.at, midis: [m] });
        else waiting.push({ id: nid, at: c.at, due: c.at + 150, kind: 'steady', preSeg });
        const strum = c.n >= 3; // dve žice zajedno = dvozvuk, ne udarac
        waiting.push({ id: nid, at: c.at, due: c.at + 180, kind: 'poly', midis: m != null ? [m] : [], strum });
        // drugi pogled ~0,4 s posle udarca (žice akorda se „skupe“): za udarce i neodlučene zvuke
        waiting.push({ id: nid, at: c.at, due: c.at + 400, kind: 'poly2', midis: m != null ? [m] : [], strum });
      }
    }
    for (let k = waiting.length - 1; k >= 0; k--) {
      const w = waiting[k];
      if (now < w.due) continue;
      waiting.splice(k, 1);
      if (w.kind === 'steady') {
        // nejasno na početku: ustaljen zvuk (poslednjih ~80 ms); i dalje nejasno → ništa
        const m = clearNote(lowpass(buf.subarray(buf.length - Math.round(sr * 0.08))), w.preSeg || null);
        if (m != null) { events.push({ type: 'note', id: w.id, at: w.at, midis: [m] }); const pw = waiting.find((x) => x.id === w.id); if (pw) pw.midis = [m]; }
        continue;
      }
      // brzo sviranje: već je stigla sledeća nota — spektar bi pomešao obe; ostaje potvrđena nota
      if (lastAt > w.at + 1 || (pend && pend.at > w.at + 1)) continue;
      // spektar novog zvuka: posle − (0,85 × pre) → dve note ili akord
      fft.run(buf, post);
      for (let i = 0; i < diff.length; i++) { const d = post[i] - 0.85 * pre[i]; diff[i] = d > 0 ? d : 0; }
      const found = notesFromSpectrum(diff, binHz, { a4, first: w.midis[0] ?? null });
      // drugi pogled samo za udarce preko žica ili kad je prvi čuo bar dve note (pojedinačna nota ostaje nota)
      if (w.kind === 'poly2' && !w.strum && !(done.get(w.id) || {}).multi) continue;
      if (w.kind === 'poly') { done.set(w.id, { multi: found.length >= 2 }); if (done.size > 64) done.delete(done.keys().next().value); }
      if (!found.length) continue;
      const mono = w.midis[0];
      // Akord: zajednički pomoćnici iz „Prepoznavanja“ (hromagram iz spektra)
      const ch = evalChord(found, w.strum, w.at);
      let chordName = ch && ch.name, chordSure = ch && ch.sure;
      if (w.kind === 'poly2') {
        // drugi pogled: javi samo ako donosi akord (ili ga potvrđuje) a prvi nije
        const prev = done.get(w.id) || {};
        if (!ch || (prev.name === ch.name && (prev.sure || !ch.sure))) continue;
      }
      if (chordName) { done.set(w.id, { ...(done.get(w.id) || {}), name: chordName, sure: chordSure }); if (chordSure) lastChord = { name: chordName, at: w.at }; }
      if (w.kind === 'poly2' && !chordName) continue;
      if (chordName) { events.push({ type: mono == null && w.kind === 'poly' ? 'note' : 'update', id: w.id, at: w.at, midis: [], chord: chordName, sure: chordSure }); continue; }
      let notes = found.map((x) => x.midi);
      // oktavu prve note uzmi iz provere periode (pouzdanija od spektra na mikrofonu telefona)
      if (mono != null) notes = notes.map((x) => (x % 12 === mono % 12 ? mono : x));
      notes = [...new Set(notes)];
      const chord = null;
      let show;
      // dve note: druga samo ako je interval takav da ga alikvoti jedne žice ne mogu „napraviti“
      // (oktava, kvinta, velika terca, mala septima su alikvoti prve note — tada se prikaže samo najjača)
      const iv = notes.length >= 2 ? (((notes[1] - notes[0]) % 12) + 12) % 12 : 0;
      // (i pola/ceo stepen: na dubokim tonovima spektar ne razdvaja susedne note pouzdano)
      if (notes.length >= 2 && ![0, 7, 4, 10, 1, 2, 11].includes(iv) && found[1].s >= 0.25 && found[1].own >= 0.45 && (mono == null || notes.includes(mono))) {
        show = (mono != null ? [mono, notes.find((x) => x !== mono)] : notes.slice(0, 2));
        // oktava druge note nije sigurna (mikrofon telefona) — uzmi onu najbližu iznad prve (tako leže dvozvuci na gitari)
        while (show[1] - 12 > show[0]) show[1] -= 12;
      }
      else show = mono != null ? [mono] : [];
      if (!show.length) continue;
      const same = mono != null && !chord && show.length === 1 && show[0] === mono;
      if (!same) events.push({ type: mono == null ? 'note' : 'update', id: w.id, at: w.at, midis: chord ? notes : show, chord });
    }
    return { level, floor: Math.max(fl, 0), events };
  }
  return {
    process,
    setSensitivity(v) { sens = SENS[v] || SENS[3]; },
    get floor() { return Math.max(fl, 0); },
  };
}
