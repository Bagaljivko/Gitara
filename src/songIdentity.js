// Ista pesma ili ne? — pesme se spajaju po ID-u; ovo služi samo za:
//  • tačne duplikate (isti naslov i isti sadržaj, bez obzira na interna polja akorda i redosled ključeva)
//  • „Ova pesma već postoji“ posle skeniranja (isti naslov ili skoro isti tekst i akordi)
const fold = (x) => String(x || '').trim().toLocaleLowerCase('sr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'dj').replace(/\s+/g, ' ');

/** Kanonski zapis sadržaja: naslov, izvođač, delovi (ime, tekst, akordi sa mestom), tablature. */
export function contentKey(s) {
  const secs = (s.sections || []).map((sec) => [
    fold(sec.name),
    (sec.lines || []).map((l) => [String(l.text || '').replace(/\s+$/, ''), (l.chords || []).map((c) => [String(c.chord || ''), Math.round(Number(c.position) || 0)]).sort((a, b) => a[1] - b[1])]),
    (sec.tabs || []).map((tb) => JSON.stringify(tb)),
  ]);
  // TAB pesma: taktovi i note (zapis je već očišćen, pa je JSON dovoljan)
  return JSON.stringify([fold(s.title), fold(s.artist), secs, s.type === 'tab' ? ['tab', s.tab || null] : 0]);
}

export const sameTitle = (a, b) => !!fold(a) && fold(a) === fold(b);

const words = (s) => (s.sections || []).flatMap((sec) => (sec.lines || []).flatMap((l) => fold(l.text).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1)));
const chordSeq = (s) => (s.sections || []).flatMap((sec) => (sec.lines || []).flatMap((l) => (l.chords || []).map((c) => String(c.chord || '').replace(/\s/g, ''))));
function dice(a, b) { // sličnost dva niza (dvojke susednih elemenata), 0–1
  const pairs = (x) => { const m = new Map(); for (let i = 0; i + 1 < x.length; i++) { const k = x[i] + '\u0001' + x[i + 1]; m.set(k, (m.get(k) || 0) + 1); } return m; };
  const A = pairs(a), B = pairs(b); let n = 0, na = 0, nb = 0;
  for (const v of A.values()) na += v;
  for (const v of B.values()) nb += v;
  for (const [k, v] of A) n += Math.min(v, B.get(k) || 0);
  return na + nb ? (2 * n) / (na + nb) : 0;
}

/** Skoro ista pesma: tekst ≥ 85 % isti i akordi ≥ 70 % isti (ili oba bez akorda). */
const tabTokens = (s) => (s.tab && Array.isArray(s.tab.bars) ? s.tab.bars.flatMap((b) => (b.notes || []).map((n) => n.s + ':' + n.f)) : []);
export function nearlySame(a, b) {
  // TAB pesme: skoro isti niz nota (žica:prag); TAB i pesma sa akordima nisu ista pesma
  if (a.type === 'tab' || b.type === 'tab') {
    if (a.type !== b.type) return false;
    const ta = tabTokens(a), tb = tabTokens(b);
    return ta.length >= 8 && tb.length >= 8 && dice(ta, tb) >= 0.85;
  }
  const wa = words(a), wb = words(b);
  if (wa.length < 6 || wb.length < 6) return false;
  if (dice(wa, wb) < 0.85) return false;
  const ca = chordSeq(a), cb = chordSeq(b);
  if (!ca.length && !cb.length) return true;
  return dice(ca, cb) >= 0.7;
}

/** Postojeća pesma koja je verovatno ista kao nova (prvo isti naslov, pa skoro isti sadržaj). `list` = pune pesme. */
export function findExisting(song, list) {
  return list.find((x) => sameTitle(x.title, song.title)) || list.find((x) => nearlySame(x, song)) || null;
}
