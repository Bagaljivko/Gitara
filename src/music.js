// Muzička teorija: note, parsiranje akorda, transpozicija.

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, H: 11 };

// Kanonski kvaliteti akorda i intervali (u polutonovima od korena).
export const QUALITIES = {
  '': { intervals: [0, 4, 7], label: 'dur' },
  m: { intervals: [0, 3, 7], label: 'mol' },
  '7': { intervals: [0, 4, 7, 10], label: 'dominantni septakord' },
  maj7: { intervals: [0, 4, 7, 11], label: 'veliki septakord' },
  m7: { intervals: [0, 3, 7, 10], label: 'molski septakord' },
  sus2: { intervals: [0, 2, 7], label: 'sus2' },
  sus4: { intervals: [0, 5, 7], label: 'sus4' },
  dim: { intervals: [0, 3, 6], label: 'smanjeni' },
  aug: { intervals: [0, 4, 8], label: 'prekomerni' },
  '6': { intervals: [0, 4, 7, 9], label: 'sekstakord' },
  m6: { intervals: [0, 3, 7, 9], label: 'molski sekstakord' },
  '9': { intervals: [0, 4, 7, 10, 2], label: 'nonakord' },
  add9: { intervals: [0, 4, 7, 2], label: 'add9' },
  '7sus4': { intervals: [0, 5, 7, 10], label: '7sus4' },
  m7b5: { intervals: [0, 3, 6, 10], label: 'polusmanjeni' },
  dim7: { intervals: [0, 3, 6, 9], label: 'smanjeni septakord' },
  mmaj7: { intervals: [0, 3, 7, 11], label: 'mol sa velikom septimom' },
  m9: { intervals: [0, 3, 7, 10, 2], label: 'molski nonakord' },
};

// Alias -> kanonski kvalitet. Redosled je bitan (duži prvo).
const QUALITY_ALIASES = [
  ['mmaj7', 'mmaj7'], ['mM7', 'mmaj7'], ['m(maj7)', 'mmaj7'], ['minmaj7', 'mmaj7'],
  ['maj7', 'maj7'], ['Maj7', 'maj7'], ['MAJ7', 'maj7'], ['M7', 'maj7'], ['Δ7', 'maj7'], ['Δ', 'maj7'], ['ma7', 'maj7'], ['j7', 'maj7'],
  ['m7b5', 'm7b5'], ['m7-5', 'm7b5'], ['ø7', 'm7b5'], ['ø', 'm7b5'],
  ['min7', 'm7'], ['mi7', 'm7'], ['-7', 'm7'], ['m7', 'm7'],
  ['min9', 'm9'], ['m9', 'm9'],
  ['dim7', 'dim7'], ['°7', 'dim7'],
  ['7sus4', '7sus4'], ['7sus', '7sus4'],
  ['sus2', 'sus2'], ['sus4', 'sus4'], ['sus', 'sus4'],
  ['add9', 'add9'], ['add2', 'add9'], ['2', 'add9'],
  ['dim', 'dim'], ['°', 'dim'],
  ['aug', 'aug'], ['+5', 'aug'], ['+', 'aug'], ['#5', 'aug'],
  ['min6', 'm6'], ['m6', 'm6'], ['-6', 'm6'],
  ['min', 'm'], ['mi', 'm'], ['moll', 'm'], ['mol', 'm'], ['-', 'm'], ['m', 'm'],
  ['dur', ''], ['maj', ''], ['M', ''],
  ['7', '7'], ['6', '6'], ['9', '9'],
  ['', ''],
];

const CHORD_RE = /^([A-H])(#|b|♯|♭)?([^/]*)(?:\/([A-H])(#|b|♯|♭)?)?$/;

function accidentalOffset(acc) {
  if (!acc) return 0;
  if (acc === '#' || acc === '♯') return 1;
  return -1; // b, ♭
}

/**
 * Parsira ime akorda. Vraća { root, quality, bass, rootName, usesH, flat } ili null.
 * "Hm" se prepoznaje kao Bm (H = B u nemačkoj/srpskoj notaciji).
 */
export function parseChord(name) {
  if (!name) return null;
  let s = String(name).trim().replace(/[()\[\]]/g, (c) => (c === '(' || c === ')' ? c : ''));
  s = s.replace(/\s+/g, '');
  if (!s) return null;
  const m = s.match(CHORD_RE);
  if (!m) return null;
  const [, letter, acc, rest, bassLetter, bassAcc] = m;
  if (acc && letter === 'H') return null;
  let qualityRaw = rest || '';
  let quality = null;
  for (const [alias, canon] of QUALITY_ALIASES) {
    if (qualityRaw === alias) { quality = canon; break; }
  }
  if (quality === null) {
    // pokušaj da ukloniš zagrade, npr. "7(b9)" — uzmi najduži prefiks koji znamo
    const cleaned = qualityRaw.replace(/[()]/g, '');
    for (const [alias, canon] of QUALITY_ALIASES) {
      if (cleaned === alias) { quality = canon; break; }
    }
  }
  if (quality === null) {
    for (const [alias, canon] of QUALITY_ALIASES) {
      if (alias && qualityRaw.startsWith(alias) && /^[\d()#b+\-♯♭]*$/.test(qualityRaw.slice(alias.length))) { quality = canon; break; }
    }
  }
  if (quality === null) return null;
  const root = (LETTER_PC[letter] + accidentalOffset(acc) + 12) % 12;
  const bass = bassLetter ? (LETTER_PC[bassLetter] + accidentalOffset(bassAcc) + 12) % 12 : null;
  return {
    root,
    quality,
    bass,
    usesH: letter === 'H' || bassLetter === 'H',
    flat: acc === 'b' || acc === '♭',
  };
}

export function isChord(token) {
  return parseChord(token) !== null;
}

export function pcName(pc, { flat = false, useH = false } = {}) {
  let n = (flat ? FLAT_NAMES : SHARP_NAMES)[((pc % 12) + 12) % 12];
  // U H-notaciji B (si) se piše H; Bb ostaje "Bb" da ne bi bilo zabune.
  if (useH && n === 'B') n = 'H';
  return n;
}

/** Kanonsko (međunarodno) ime akorda, npr. Hm -> Bm. */
export function canonicalName(name, opts = {}) {
  const p = parseChord(name);
  if (!p) return name;
  return formatChord(p, opts);
}

export function formatChord(p, { flat = p.flat, useH = false } = {}) {
  let s = pcName(p.root, { flat, useH }) + p.quality;
  if (p.bass !== null && p.bass !== undefined) s += '/' + pcName(p.bass, { flat, useH });
  return s;
}

// Tonaliteti u kojima se pišu snizilice.
const FLAT_KEYS = new Set([5, 10, 3, 8, 1]); // F, Bb, Eb, Ab, Db (dur)

/** Da li u datom tonalitetu koristiti ♭ (na osnovu korena tonaliteta i da li je mol). */
export function prefersFlats(keyRoot, minor = false) {
  const major = minor ? (keyRoot + 3) % 12 : keyRoot;
  return FLAT_KEYS.has(major);
}

/** Transponuje jedan akord za n polutonova. Nepoznate tokene ostavlja netaknute. */
export function transposeChord(name, n, { flat, useH } = {}) {
  if (!n) return name;
  const p = parseChord(name);
  if (!p) return name;
  const t = { ...p, root: (p.root + n + 120) % 12, bass: p.bass === null ? null : (p.bass + n + 120) % 12 };
  return formatChord(t, { flat: flat ?? p.flat, useH: useH ?? p.usesH });
}

export function parseKey(key) {
  if (!key) return null;
  const p = parseChord(String(key).replace(/\s*(dur|mol|major|minor|-dur|-mol)$/i, (m) => (/mol|minor/i.test(m) ? 'm' : '')));
  if (!p) return null;
  return { root: p.root, minor: p.quality === 'm' || p.quality === 'm7', usesH: p.usesH, flat: p.flat };
}

export function transposeKey(key, n, useH) {
  const k = parseKey(key);
  if (!k || !n) return key;
  const root = (k.root + n + 120) % 12;
  const flat = prefersFlats(root, k.minor);
  return pcName(root, { flat, useH: useH ?? k.usesH }) + (k.minor ? 'm' : '');
}

// ---- Note i frekvencije ----
export function freqToMidi(f, a4 = 440) {
  return 69 + 12 * Math.log2(f / a4);
}
export function midiToFreq(m, a4 = 440) {
  return a4 * Math.pow(2, (m - 69) / 12);
}
export function midiName(m) {
  const r = Math.round(m);
  return { name: SHARP_NAMES[((r % 12) + 12) % 12], octave: Math.floor(r / 12) - 1 };
}
