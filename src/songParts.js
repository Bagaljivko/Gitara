// v2.4.34: delovi pesme i težina promena — lagan modul (ekran pesme i put kroz pesmu ga koriste bez učitavanja igara)
import { getVoicings } from './chords.js';
import { transposeSong } from './songformat.js';

/** Delovi pesme onako kako se sviraju (transpozicija i kapodaster uračunati): [{ i, name, chords:[{chord, lyric}] }] */
export function songParts(song, { dedupe = true } = {}) {
  const shapes = transposeSong(song, (song.transpose || 0) - (song.capo || 0));
  const seen = new Set();
  return (shapes.sections || []).map((sec, i) => ({
    i, name: sec.name || '',
    // uz svaki akord: reči koje se pevaju dok on traje (od njega do sledećeg akorda u redu), ostatak reda bleđe
    chords: (sec.lines || []).flatMap((l) => {
      const text = l.text || '', cs = [...(l.chords || [])].sort((a, b) => a.position - b.position);
      return cs.map((c, k) => {
        if (!text.trim()) return { chord: c.chord, lyric: '' };
        const a = Math.min(c.position, text.length), b = k + 1 < cs.length ? Math.min(cs[k + 1].position, text.length) : text.length;
        return { chord: c.chord, lyric: { pre: text.slice(0, a), cur: text.slice(a, Math.max(a, b)), post: text.slice(Math.max(a, b)) } };
      });
    }).filter((c) => c.chord),
  })).filter((p) => {
    if (!p.chords.length) return false;
    if (!dedupe) return true; // v2.4.26: „Pevaj uz tekst“ — svi delovi redom (i ponovljeni refren)
    const sig = p.name + '|' + p.chords.map((c) => c.chord).join(',');
    if (seen.has(sig)) return false; // isti refren ponovljen više puta = jedan deo
    seen.add(sig);
    return true;
  });
}

/** Težina promene akorda: koliko žica menja prag + barre. */
export function changeCost(a, b) {
  if (a === b) return 0;
  const va = getVoicings(a)[0], vb = getVoicings(b)[0];
  if (!va || !vb) return 2;
  let moves = 0;
  for (let s = 0; s < 6; s++) if (va.frets[s] !== vb.frets[s]) moves++;
  return 1 + moves * 0.5 + (vb.barre ? 3 : 0) + (Math.max(...vb.frets) > 4 ? 1 : 0);
}
/** Prosečna težina promena u delu (uključujući povratak na početak, jer se deo vrti u petlji). */
export function partDifficulty(p) {
  const c = p.chords.map((x) => x.chord);
  if (c.length < 2) return 0;
  let sum = 0;
  for (let k = 0; k < c.length; k++) sum += changeCost(c[k], c[(k + 1) % c.length]);
  return sum / c.length;
}
