// Imena akorda: čitanje u srpskom (H, B=Bb, Fis, Es, As…) i engleskom (B, Bb, F#, Eb…) imenovanju,
// neutralan zapis (koren 0–11 + nastavak + bas) i prikaz u izabranom imenovanju.
// Neutralan akord: { r: 0–11, s: 'm7', b: null|0–11 }. Sve što nije akord ostaje tekst: { t: 'N.C.' }.
import { parseChord, SHARP_NAMES } from './music.js';

const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, H: 11 };
export const NAMES = {
  en: { sharp: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'], flat: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] },
  sr: { sharp: ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'Ais', 'H'], flat: ['C', 'Des', 'D', 'Es', 'E', 'F', 'Ges', 'G', 'As', 'A', 'B', 'H'] },
};

/** Da li je nastavak akorda (m, 7, maj7, sus4, add9, dim…) ispravan. */
function validSuffix(s) { return !!parseChord('C' + s); }

/**
 * Jedan ton (koren ili bas) sa početka stringa. Vraća [{ pc, len, marker }] — sve moguće varijante,
 * jer npr. „Esus4“ može biti E + sus4 (ispravno) ili Es + us4 (neispravno); odluku donosi nastavak.
 * marker: 'H' (srpsko H), 'Bsr' (B koje mora biti Bb), 'B' (dvosmisleno B), 'de' (Fis/Es/As…), 'Bb' (englesko), ''
 */
function noteOptions(str, naming) {
  const m = /^([A-Ha-h])/.exec(str);
  if (!m) return [];
  const L = m[1].toUpperCase();
  let base = LETTER[L];
  if (L === 'B' && naming === 'sr') base = 10;
  const opts = [];
  const rest = str.slice(1);
  const plainMarker = L === 'H' ? 'H' : L === 'B' ? 'B' : '';
  // simboli: #, b, ♯, ♭
  const sym = /^(#|♯|b|♭)/.exec(rest);
  if (sym && !(L === 'H')) {
    const off = sym[1] === '#' || sym[1] === '♯' ? 1 : -1;
    // „Bb“ na srpskom papiru: B već znači Bb — znak b je samo dodatno pojašnjenje
    if (L === 'B' && naming === 'sr' && off === -1) opts.push({ pc: 10, len: 2, marker: 'Bb' });
    else
    opts.push({ pc: (base + off + 12) % 12, len: 2, marker: L === 'B' && off === -1 ? 'Bb' : plainMarker });
  }
  // srpski/nemački nastavci: is (povišeno), es / s (sniženo: Es, As), Hes = B
  const de = /^(is|es|s)/.exec(rest);
  if (de && L !== 'B') {
    const ok = de[1] === 'is' || (de[1] === 's' && (L === 'E' || L === 'A')) || (de[1] === 'es' && L !== 'E' && L !== 'A');
    if (ok) opts.push({ pc: (LETTER[L] + (de[1] === 'is' ? 1 : -1) + 12) % 12, len: 1 + de[1].length, marker: 'de' });
  }
  opts.push({ pc: base, len: 1, marker: plainMarker });
  return opts;
}

/**
 * Pročitaj akord u datom imenovanju ('sr' ili 'en'). Vraća { r, s, b, markers } ili null.
 * lowercaseMinor: „e“ = Em, „fis7“ = F#m7 (samo za redove sa akordima).
 */
export function readChord(token, naming = 'en', { lowercaseMinor = false } = {}) {
  let s = String(token || '').trim().replace(/^\(|\)$/g, '');
  if (!s) return null;
  const lower = /^[a-h]/.test(s);
  if (lower && !lowercaseMinor) return null;
  const [main, bassStr, extra] = s.split('/');
  if (extra !== undefined) return null;
  for (const o of noteOptions(main, naming)) {
    let suffix = main.slice(o.len);
    if (lower) suffix = 'm' + suffix;
    if (!validSuffix(suffix)) continue;
    let b = null, bm = '';
    if (bassStr !== undefined) {
      const bo = noteOptions(bassStr, naming).find((x) => x.len === bassStr.length);
      if (!bo) continue;
      b = bo.pc; bm = bo.marker;
    }
    return { r: o.pc, s: suffix, b, markers: [o.marker, bm].filter(Boolean) };
  }
  return null;
}

/** Da li je red sa akordima (svaka reč je akord ili oznaka kao x2, |, N.C.). */
const EXTRA = /^(\||x\d+|\d+x|N\.?C\.?|%|\.{2,}|-+|\(|\))$/i;
export function isChordLineAs(line, naming, opts) {
  const toks = String(line || '').trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return false;
  let n = 0;
  for (const t of toks) { if (readChord(t, naming, opts)) n++; else if (!EXTRA.test(t)) return false; }
  return n > 0;
}

// ---- Koje imenovanje koristi papir? ----
/**
 * Prepoznaj imenovanje iz svih akorda pesme (tekstovi kako su napisani).
 * Vraća { naming: 'sr'|'en'|'any', confidence: 'sure'|'guess'|'ask', reason }.
 */
export function detectNaming(tokens) {
  const read = tokens.map((t) => readChord(t, 'en')).filter(Boolean);
  const markers = new Set(read.flatMap((c) => c.markers));
  const hasH = markers.has('H'), hasDe = markers.has('de'), hasBb = markers.has('Bb'), hasB = markers.has('B');
  if ((hasH || hasDe) && hasBb) return { naming: 'sr', confidence: 'ask', reason: 'mixed' };
  if (hasH) return { naming: 'sr', confidence: 'sure', reason: 'H' };
  if (hasDe) return { naming: 'sr', confidence: 'sure', reason: 'de' };
  if (hasBb) return { naming: 'en', confidence: 'sure', reason: 'Bb' };
  if (!hasB) return { naming: 'any', confidence: 'sure', reason: 'noB' };
  // Samo „B“ bez drugih tragova: koje značenje bolje odgovara ostalim akordima?
  // Isti akordi pročitani na oba načina — koje čitanje daje uverljiviji tonalitet (dur ili mol)?
  const asBb = detectKey(tokens.map((t) => readChord(t, 'sr')).filter(Boolean)).ranked[0].score;
  const asB = detectKey(tokens.map((t) => readChord(t, 'en')).filter(Boolean)).ranked[0].score;
  const diff = asBb - asB;
  if (Math.abs(diff) < 0.5) return { naming: diff >= 0 ? 'sr' : 'en', confidence: 'ask', reason: 'B', fit: { asBb, asB } };
  return { naming: diff > 0 ? 'sr' : 'en', confidence: 'guess', reason: 'B', fit: { asBb, asB } };
}

// ---- Tonalitet ----
const MAJOR = { 0: 'M', 2: 'm', 4: 'm', 5: 'M', 7: 'M', 9: 'm', 11: 'd' };
const MINOR = { 0: 'm', 2: 'd', 3: 'M', 5: 'm', 7: 'm', 8: 'M', 10: 'M' };
const kind = (s) => (/^dim|m7b5|ø/.test(s) ? 'd' : /^m(?!aj)/.test(s) ? 'm' : 'M');

/**
 * Prepoznaj tonalitet iz neutralnih akorda (redom kako se javljaju).
 * Vraća { root, minor, confident, ranked: [{root, minor, score}] }.
 */
export function detectKey(chords) {
  const cs = chords.filter((c) => c && c.r !== undefined);
  if (!cs.length) return null;
  const ranked = [];
  for (let k = 0; k < 12; k++) for (const minor of [false, true]) {
    const table = minor ? MINOR : MAJOR;
    let sc = 0;
    for (const c of cs) {
      const deg = (c.r - k + 12) % 12, want = table[deg], got = kind(c.s);
      if (want === got) sc += 1;
      else if (minor && deg === 7 && got === 'M') sc += 0.9;     // V-dur u molu (harmonski mol)
      else if (!minor && deg === 2 && got === 'M') sc += 0.4;    // II-dur (dominanta dominante)
      else if (!minor && deg === 10 && got === 'M') sc += 0.4;   // bVII
      else if (want) sc += 0.1;
      else sc -= 0.8;
    }
    const tonic = (c) => c.r === k && kind(c.s) === (minor ? 'm' : 'M');
    if (tonic(cs[0])) sc += 1.5;
    if (tonic(cs[cs.length - 1])) sc += 2.5;
    ranked.push({ root: k, minor, score: +(sc / Math.sqrt(cs.length)).toFixed(2) });
  }
  ranked.sort((a, b) => b.score - a.score);
  const [a, b] = ranked;
  return { root: a.root, minor: a.minor, confident: a.score - b.score >= 0.5, ranked: ranked.slice(0, 4) };
}

// ---- Pisanje: povisilice ili snizilice prema tonalitetu i ulozi akorda ----
const FLAT_SIDE = new Set([5, 10, 3, 8, 1]); // F, B/Bb, Es/Eb, As/Ab, Des/Db (dur)
/**
 * Da li se crna dirka (pc) piše sniženo u datom tonalitetu.
 * Tonovi iz lestvice: prema strani kvintnog kruga (G, D, A… povisilice; F, B, Es… snizilice).
 * Pozajmljeni akordi: bIII, bVI, bVII sniženo (npr. B/Bb u G-duru), #I i #IV povišeno;
 * u molu je vođica povišena (Gis u a-molu).
 */
export function spellFlat(pc, key) {
  if (![1, 3, 6, 8, 10].includes(((pc % 12) + 12) % 12)) return false;
  if (!key) return [3, 10, 8].includes(pc);
  const deg = (pc - key.root + 12) % 12;
  const relMajor = key.minor ? (key.root + 3) % 12 : key.root;
  if (key.minor) {
    if ([11, 9, 6, 4].includes(deg)) return false; // vođica, povišena šesta, #4, durska terca
    if (deg === 1) return true;                   // napuljski (bII)
  } else {
    if (deg === 1 || deg === 6) return false;      // #I, #IV
    if (deg === 3 || deg === 8 || deg === 10) return true; // bIII, bVI, bVII
  }
  if (relMajor === 0) return [3, 10, 8].includes(pc);
  return FLAT_SIDE.has(relMajor);
}

/** Ime tona u imenovanju 'sr' ili 'en'. */
export function noteName(pc, naming, key) {
  const n = NAMES[naming === 'sr' ? 'sr' : 'en'];
  return (spellFlat(pc, key) ? n.flat : n.sharp)[((pc % 12) + 12) % 12];
}

/** Neutralan akord → tekst u izabranom imenovanju (posle transpozicije za n polutonova). */
export function renderChord(c, naming, key = null, n = 0) {
  if (!c) return '';
  if (c.t !== undefined) return c.t;
  const r = (c.r + n + 120) % 12;
  const b = c.b === null || c.b === undefined ? null : (c.b + n + 120) % 12;
  return noteName(r, naming, key) + c.s + (b === null ? '' : '/' + noteName(b, naming, key));
}

/** Ime tonaliteta: „G“, „Em“, „Fism“ / „F#m“, „Es“ / „Eb“. */
export function keyName(key, naming) {
  return noteName(key.root, naming, key) + (key.minor ? 'm' : '');
}

/** Kvintni krug za birač (dur spolja, paralelni mol iznutra). */
export const CIRCLE = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

export const _englishCanonical = (c) => SHARP_NAMES[c.r] + c.s + (c.b === null ? '' : '/' + SHARP_NAMES[c.b]);
