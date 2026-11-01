// Predlozi za pesmu: lakša verzija (kapodaster sa najlakšim hvatovima) i predlog ritma.
import { transposeSong, songChords } from './songformat.js';
import { getVoicings } from './chords.js';
import { canonicalName, parseChord } from './music.js';
import { PATTERNS } from './rhythm.js';

// Najlakši otvoreni hvatovi (manji broj = lakše). Sve ostalo se boduje po tome da li traži barre.
const EASY = {
  G: 0, C: 0, D: 0, Em: 0, Am: 0, E: 0, A: 0,
  Dm: 1, E7: 1, A7: 1, D7: 1, G7: 1, Am7: 1, Em7: 1, C7: 1.5, Cmaj7: 1, Fmaj7: 1.5, Dmaj7: 1.5, Amaj7: 1.5,
  Asus2: 1, Asus4: 1, Dsus2: 1, Dsus4: 1, Esus4: 1, Cadd9: 1, Dm7: 1.5, B7: 2,
};

/** Težina jednog hvata: otvoreni lak = 0–2, barre / visoki položaj = 6–8, nepoznat = 5. */
export function shapeCost(name) {
  const p = parseChord(name);
  if (!p) return 0; // nije akord (ne utiče)
  const base = canonicalName(name).replace(/\/.*/, '');
  if (EASY[base] !== undefined) return EASY[base];
  const v = getVoicings(base)[0];
  if (!v) return 5;
  if (v.barre || v.baseFret > 1) return /^(F|Bm|Bb|F#m|Cm|Gm|C#m|G#m|Fm|Bbm|Ebm)/.test(base) ? 7 : 8;
  return 3;
}

/**
 * Najlakši kapodaster 0–7 za pesmu (sa trenutnom transpozicijom).
 * Vraća { capo, shapes, cost, baseCost } ili null ako nema lakše verzije od originala.
 */
export function easiestCapo(song, transpose = 0) {
  const costOf = (capo) => {
    const shapes = songChords(transposeSong(song, transpose - capo)).map((c) => c.replace(/\/.*/, ''));
    const uniq = [...new Set(shapes)];
    return { capo, shapes: uniq, cost: uniq.reduce((a, c) => a + shapeCost(c), 0) + capo * 0.15 };
  };
  const base = costOf(0);
  if (!base.shapes.length) return null;
  let best = base;
  for (let c = 1; c <= 7; c++) { const r = costOf(c); if (r.cost < best.cost - 0.01) best = r; }
  if (best.capo === 0 || base.cost - best.cost < 1.5) return null; // nije vredno
  return { ...best, baseCost: base.cost };
}

/** Lokalni predlog ritma (kada Gemini nije dostupan). */
export function localStrum(song) {
  const text = (song.sections || []).map((s) => s.name + ' ' + s.lines.map((l) => l.text).join(' ')).join(' ').toLowerCase();
  if (/valcer|waltz|3\/4/.test(text)) return { id: 'waltz', reasonKey: 'sug.strumWaltz' };
  if (/6\/8/.test(text)) return { id: 'ballad68', reasonKey: 'sug.strumBallad' };
  if (/reggae|rege/.test(text)) return { id: 'reggae', reasonKey: 'sug.strumReggae' };
  return { id: 'folk', reasonKey: 'sug.strumFolk' };
}

export const patternById = (id) => PATTERNS.find((p) => p.id === id) || null;
