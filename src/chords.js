// Biblioteka dijagrama akorda: otvoreni akordi + pokretni barre oblici (E i A oblik) u svim tonalitetima.
import { parseChord, formatChord } from './music.js';

// frets: žice od E (6.) do e (1.); -1 = prigušena, 0 = otvorena.
// fingers: 0 = bez prsta. barre: { fret, from, to } (indeksi žica 0..5).
const OPEN = {
  C: ['x32010', '032010'],
  A: ['x02220', '001230'],
  G: ['320003', '210003'],
  E: ['022100', '023100'],
  D: ['xx0232', '000132'],
  Am: ['x02210', '002310'],
  Em: ['022000', '023000'],
  Dm: ['xx0231', '000231'],
  A7: ['x02020', '002030'],
  B7: ['x21202', '021304'],
  C7: ['x32310', '032410'],
  D7: ['xx0212', '000213'],
  E7: ['020100', '020100'],
  G7: ['320001', '320001'],
  Amaj7: ['x02120', '002130'],
  Cmaj7: ['x32000', '032000'],
  Dmaj7: ['xx0222', '000111'],
  Emaj7: ['021100', '031200'],
  Fmaj7: ['xx3210', '003210'],
  Gmaj7: ['320002', '320001'],
  Am7: ['x02010', '002010'],
  Dm7: ['xx0211', '000211'],
  Em7: ['022030', '023040'],
  Asus2: ['x02200', '001200'],
  Dsus2: ['xx0230', '000130'],
  Asus4: ['x02230', '001230'],
  Dsus4: ['xx0233', '000134'],
  Esus4: ['022200', '023400'],
  Csus4: ['x33011', '034011'],
  Cadd9: ['x32030', '021030'],
  G6: ['320000', '210000'],
  E9: ['020102', '020103'],
  A7sus4: ['x02030', '002030'],
  E7sus4: ['020200', '020300'],
  Bdim: ['x2343x', '012430'],
  Am6: ['x02212', '002314'],
  Dadd9: ['xx0230', '000130'],
  Gadd9: ['320203', '210304'],
  Eadd9: ['024100', '024100'],
};

// Pokretni oblici: offset u odnosu na prag korena; null = prigušena.
const E_SHAPES = {
  '': [0, 2, 2, 1, 0, 0],
  m: [0, 2, 2, 0, 0, 0],
  '7': [0, 2, 0, 1, 0, 0],
  maj7: [0, null, 1, 1, 0, null],
  m7: [0, 2, 0, 0, 0, 0],
  sus4: [0, 2, 2, 2, 0, 0],
  '7sus4': [0, 2, 0, 2, 0, 0],
  m7b5: [0, null, 0, 0, -1, null],
  mmaj7: [0, 2, 1, 0, 0, 0],
  '9': [0, 2, 0, 1, 0, 2],
  aug: [0, null, 2, 1, 1, 0],
};
const A_SHAPES = {
  '': [null, 0, 2, 2, 2, 0],
  m: [null, 0, 2, 2, 1, 0],
  '7': [null, 0, 2, 0, 2, 0],
  maj7: [null, 0, 2, 1, 2, 0],
  m7: [null, 0, 2, 0, 1, 0],
  sus2: [null, 0, 2, 2, 0, 0],
  sus4: [null, 0, 2, 2, 3, 0],
  '7sus4': [null, 0, 2, 0, 3, 0],
  dim: [null, 0, 1, 2, 1, null],
  aug: [null, 0, 3, 2, 2, null],
  '6': [null, 0, 2, 2, 2, 2],
  m6: [null, 0, 2, 2, 1, 2],
  '9': [null, 0, -1, 0, 0, null],
  m7b5: [null, 0, 1, 0, 1, null],
  dim7: [null, 0, 1, -1, 1, null],
  mmaj7: [null, 0, 2, 1, 1, 0],
  m9: [null, 0, -2, 0, 0, null],
};

// Ako nema oblika za kvalitet, prikaži najbliži jednostavniji.
const FALLBACK = { add9: '', m9: 'm7', '9': '7', '6': '', m6: 'm', dim7: 'dim', mmaj7: 'm', '7sus4': 'sus4', m7b5: 'dim', aug: '', dim: 'm', sus2: '' };

const E_ROOT = 4; // E
const A_ROOT = 9; // A

function fromString(fretStr, fingerStr) {
  const frets = [...fretStr].map((c) => (c === 'x' ? -1 : parseInt(c, 36)));
  const fingers = [...fingerStr].map((c) => parseInt(c, 10));
  // Detektuj barre: isti prst 1 na više žica na istom pragu.
  let barre = null;
  const ones = frets.map((f, i) => (fingers[i] === 1 && f > 0 ? i : -1)).filter((i) => i >= 0);
  if (ones.length >= 2 && ones.every((i) => frets[i] === frets[ones[0]])) {
    barre = { fret: frets[ones[0]], from: ones[0], to: ones[ones.length - 1] };
  }
  return { frets, fingers, barre };
}

function fromShape(shape, rootFret) {
  const frets = shape.map((o) => (o === null ? -1 : rootFret + o));
  const fingers = new Array(6).fill(0);
  let barre = null;
  const played = frets.map((f, i) => (f >= 0 ? i : -1)).filter((i) => i >= 0);
  const hasNeg = shape.some((o) => o !== null && o < 0);
  const zeros = shape.map((o, i) => (o === 0 ? i : -1)).filter((i) => i >= 0);
  if (rootFret > 0 && !hasNeg && zeros.length >= 2) {
    const from = played[0];
    const to = zeros[zeros.length - 1];
    barre = { fret: rootFret, from, to };
    for (let i = from; i <= to; i++) if (frets[i] === rootFret) fingers[i] = 1;
    const rest = played
      .filter((i) => fingers[i] === 0 && frets[i] > 0)
      .sort((a, b) => frets[a] - frets[b] || a - b);
    rest.forEach((i, k) => (fingers[i] = Math.min(2 + k, 4)));
  } else {
    const rest = played.filter((i) => frets[i] > 0).sort((a, b) => frets[a] - frets[b] || a - b);
    rest.forEach((i, k) => (fingers[i] = Math.min(1 + k, 4)));
  }
  return { frets, fingers, barre };
}

function movable(shape, rootPc, stringRootPc) {
  let r = (rootPc - stringRootPc + 12) % 12;
  const minOff = Math.min(...shape.filter((o) => o !== null));
  if (r === 0 || r + minOff < 1) r += 12; // r=0 bi bio otvoreni akord — njega pokrivamo tabelom
  if (r + Math.max(...shape.filter((o) => o !== null)) > 15) return null;
  return fromShape(shape, r);
}

// v2.4.33: lakši (mali) oblici barré akorda — korenski ton i kvalitet → [pragovi, prsti] (E A D G H e)
const EASY_SHAPES = {
  '5|': ['xx3211', '003211'], '5|m': ['xx3111', '003111'], '11|m': ['xx4432', '003421'], '10|': ['xx3331', '002341'],
  '6|m': ['xx4222', '003111'], '0|m': ['xx5543', '003421'], '7|m': ['xx5333', '003111'], '1|m': ['xx6654', '003421'],
};
// v2.4.35: drugi otvoreni hvatovi koje nastavnici često uče (G sa 3. pragom na h žici, Fmaj7 sa basom C, …)
const ALT_SHAPES = {
  '7|': [['320033', '210034']], '5|maj7': [['x33210', '034210']], '0|': [['x32013', '032014']],
  '2|7': [['xx0212', '000213']], '9|m7': [['x02010', '002010']],
};
// v2.5.2: hvatovi po punom imenu akorda (i akordi sa basom: G/F# nije isto što i G). Akord sa basom → ovaj hvat je prvi
// (do sada je G/F# pokazivao običan G); ostali → dodaju se na kraj kao drugi hvatovi. Sa listova MARLI puta i nastavnika.
const NAMED_SHAPES = {
  'G/F#': [['2x0033', '100034'], ['2x0233', '100234']], 'D/F#': [['2x0232', '100132'], ['20023x', '100230']],
  'C/B': [['x20010', '020010']], 'G/B': [['x20033', '010034']], 'Am7/G': [['302210', '402310']], 'Am/G': [['302210', '402310']],
  'C/G': [['332010', '342010']], 'D/A': [['x00232', '000132']], 'C/E': [['032010', '032010']], 'F/C': [['x33211', '034211']],
  'Cadd9': [['x32033', '021034']], 'Em7': [['022033', '012034']], 'Asus4': [['x02233', '001234']], 'Gsus2': [['300233', '200134']],
  'A7sus4': [['x02033', '001034']], 'D#dim': [['xx1212', '001324']], 'C6': [['x32200', '032100']], 'Am7': [['x02213', '002314']],
};
const cache = new Map();

/**
 * Vraća listu položaja za akord (prvi je preporučeni), ili [] ako nije prepoznat.
 * Svaki položaj: { frets, fingers, barre, baseFret, name, approx }
 */
export function getVoicings(chordName) {
  const p = parseChord(chordName);
  if (!p) return [];
  const full = formatChord(p, { flat: false });
  const named = NAMED_SHAPES[full] || [];
  const key = p.bass != null && named.length ? full : p.root + '|' + p.quality;
  if (cache.has(key)) return cache.get(key);

  const build = (quality) => {
    const out = [];
    for (const flat of [false, true]) {
      const nm = formatChord({ root: p.root, quality, bass: null }, { flat });
      if (OPEN[nm]) { out.push(fromString(...OPEN[nm])); break; }
    }
    if (E_SHAPES[quality]) { const v = movable(E_SHAPES[quality], p.root, E_ROOT); if (v) out.push(v); }
    if (A_SHAPES[quality]) { const v = movable(A_SHAPES[quality], p.root, A_ROOT); if (v) out.push(v); }
    return out;
  };

  let list = build(p.quality);
  let approx = false;
  if (!list.length && FALLBACK[p.quality] !== undefined) {
    list = build(FALLBACK[p.quality]);
    approx = true;
  }
  // Otvoreni prvi, ostali po visini na vratu.
  const isOpen = (v) => v.frets.some((f) => f === 0) && Math.max(...v.frets) <= 4 && !v.barre;
  list.sort((a, b) => (isOpen(b) - isOpen(a)) || (minFret(a) - minFret(b)));
  // ukloni duplikate
  const seen = new Set();
  list = list.filter((v) => { const k = v.frets.join(','); if (seen.has(k)) return false; seen.add(k); return true; });
  list = list.map((v) => ({ ...v, baseFret: baseFret(v), approx }));
  // v2.4.33: lakši hvat za barré akorde (mali oblik na 4 žice) — uvek dostupan kao poslednji hvat
  const ez = EASY_SHAPES[p.root + '|' + p.quality];
  if (ez && list.some((v) => v.barre)) { const v = fromString(ez[0], ez[1]); list.push({ ...v, baseFret: baseFret(v), approx, easy: true }); }
  // v2.4.35: česti drugi hvatovi (npr. sa lista nastavnika) — dodaju se na kraj, postojeći redosled se ne menja
  for (const al of ALT_SHAPES[p.root + '|' + p.quality] || []) { const v = fromString(al[0], al[1]); if (!list.some((x) => x.frets.join() === v.frets.join())) list.push({ ...v, baseFret: baseFret(v), approx: false, alt: true }); }
  if (p.bass != null && named.length) { // akord sa basom: njegovi hvatovi prvi, pa hvatovi osnovnog akorda
    const own = named.map((al) => { const v = fromString(al[0], al[1]); return { ...v, baseFret: baseFret(v), approx: false }; });
    list = [...own, ...list.filter((x) => !own.some((o) => o.frets.join() === x.frets.join()))];
  } else if (p.bass == null) for (const al of named) { const v = fromString(al[0], al[1]); if (!list.some((x) => x.frets.join() === v.frets.join())) list.push({ ...v, baseFret: baseFret(v), approx: false, alt: true }); }
  cache.set(key, list);
  return list;
}
/** v2.4.35: indeks hvata sa istim pragovima (prsti mogu da se razlikuju) ili -1. */
export function matchVoicing(name, frets) {
  const want = (frets || []).join();
  return getVoicings(name).findIndex((v) => v.frets.join() === want);
}
/** v2.4.33: indeks lakšeg hvata (ili -1). */
export function easyIndex(name) { return getVoicings(name).findIndex((v) => v.easy); }
/** v2.4.33: da li je podrazumevani hvat barré. */
export function isBarre(name) { const v = getVoicings(name)[0]; return !!(v && v.barre); }

function minFret(v) {
  const f = v.frets.filter((x) => x > 0);
  return f.length ? Math.min(...f) : 0;
}

function baseFret(v) {
  const fretted = v.frets.filter((x) => x > 0);
  if (!fretted.length) return 1;
  const max = Math.max(...fretted);
  if (max <= 4) return 1;
  return Math.min(...fretted);
}

/** Sva imena akorda za koje biblioteka ima dijagram (za prikaz/test). */
export function libraryChordNames() {
  const names = [];
  const roots = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const quals = ['', 'm', '7', 'maj7', 'm7', 'sus2', 'sus4', 'dim', 'aug', '6', 'm6', '9', 'add9'];
  for (const r of roots) for (const q of quals) names.push(r + q);
  return names;
}
