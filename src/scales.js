// Skale: generator (iz formula intervala i standardnog štimovanja — bez ručno upisanih nota).
// Pozicija = kutija od 5 pragova (p … p+4; p = 0 … 12). „Jedan prst na prag“: pragovi p…p+3 su prsti 1–4
// (prazna žica = 0). Svaka nota skale u kutiji se svira tačno na jednom mestu (najniži prag na kom je u kutiji).
// Obrasci: gore-dole, terce, nizovi po 3 i po 4 — svaki počinje i završava na osnovnom tonu (toniki).

export const OPEN = [40, 45, 50, 55, 59, 64]; // E A D G H e (0 = debela E)
// Formule (polustepeni od osnovnog tona)
export const SCALES = {
  minPent: [0, 3, 5, 7, 10],
  majPent: [0, 2, 4, 7, 9],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
export const SCALE_IDS = Object.keys(SCALES);
export const PATTERNS = ['updown', 'thirds', 'seq3', 'seq4'];
export const POSITIONS = Array.from({ length: 13 }, (_, i) => i); // početni prag kutije 0 … 12
const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const keyName = (k) => PC[((k % 12) + 12) % 12];

/** Prst za prag u kutiji koja počinje na p (0 = prazna žica). */
export const fingerFor = (f, p) => (f === 0 ? 0 : p === 0 ? Math.min(4, f) : Math.min(4, f - p + 1));

/**
 * Note skale u kutiji: [{ s, f, m, finger, root, deg }] po visini (od najniže), svaka visina jednom.
 * key: 0–11 (C = 0), scale: id iz SCALES, pos: početni prag kutije.
 */
export function boxNotes(key, scale, pos) {
  const iv = SCALES[scale];
  if (!iv) throw new Error('unknown scale ' + scale);
  const span = [pos, pos + 3]; // jedan prst na prag
  const byPitch = new Map();
  for (let s = 0; s < 6; s++) {
    for (let f = span[0]; f <= span[1]; f++) {
      const m = OPEN[s] + f, d = (((m - key) % 12) + 12) % 12;
      const deg = iv.indexOf(d);
      if (deg < 0) continue;
      // ista visina na dve žice → niža žica ima viši prag; uzmi onu na višoj žici (manji prag, prirodniji prst)
      if (!byPitch.has(m) || byPitch.get(m).f > f) byPitch.set(m, { s, f, m, finger: fingerFor(f, pos), root: d === 0, deg });
    }
  }
  return [...byPitch.values()].sort((a, b) => a.m - b.m);
}

/** Note od najnižeg osnovnog tona u kutiji do najviše note (osnova za obrasce). */
export function runNotes(key, scale, pos) {
  const all = boxNotes(key, scale, pos);
  const r = all.findIndex((n) => n.root);
  return r < 0 ? [] : all.slice(r);
}

/** Obrazac kao niz nota; uvek počinje i završava na osnovnom tonu. */
export function patternNotes(key, scale, pos, pattern = 'updown') {
  const N = runNotes(key, scale, pos);
  if (N.length < 2) return N.slice();
  const top = N.length - 1, out = [];
  if (pattern === 'updown') {
    for (let i = 0; i <= top; i++) out.push(N[i]);
    for (let i = top - 1; i >= 0; i--) out.push(N[i]);
  } else if (pattern === 'thirds') {
    // gore: 1-3, 2-4, 3-5 … ; dole: top–(top−2), … , 3-1
    for (let i = 0; i + 2 <= top; i++) out.push(N[i], N[i + 2]);
    for (let i = top; i - 2 >= 0; i--) out.push(N[i], N[i - 2]);
  } else if (pattern === 'seq3' || pattern === 'seq4') {
    const g = pattern === 'seq3' ? 3 : 4;
    for (let i = 0; i + g - 1 <= top; i++) for (let k = 0; k < g; k++) out.push(N[i + k]);
    for (let i = top; i - g + 1 >= 0; i--) for (let k = 0; k < g; k++) out.push(N[i - k]);
  } else throw new Error('unknown pattern ' + pattern);
  // završi na osnovnom tonu (ako obrazac nije stigao do njega)
  if (!out.length) return patternNotes(key, scale, pos, 'updown'); // premalo nota za ovaj obrazac
  if (!out[out.length - 1].root) out.push(N[0]);
  return out;
}

/** Ključ za čuvanje napretka: „9-minPent-5-updown“. */
export const progressKey = (key, scale, pos, pattern) => `${key}-${scale}-${pos}-${pattern}`;
