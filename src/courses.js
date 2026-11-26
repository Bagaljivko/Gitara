// v2.4.37: Kursevi — uređen spisak pesama za učenje (kao setlista, ali za učenje): redosled, nivo, napredak, šta sledi.
// Pesma živi jednom u „Pesme“; kurs samo pokazuje na nju. Ništa nije zaključano — aplikacija samo predlaže sledeću.
// Kurs: { v:1, id, name, ic, items: [{ s: songId } | { n, t?, miss: true }], series?: { name, level }, fromT?, marli?, updatedAt }
// Serija sa lista (npr. „THE SONG PATH LEVEL 3“ + „Song 6 of 10“): pesma ide na svoje mesto, prazna mesta čekaju ostale.
import { settings, songs as db } from './db.js';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const clean = (s, max = 60) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, max);
const MAX_ITEMS = 60;

export const getCourses = async () => { const v = await settings.get('courses', []); return (Array.isArray(v) ? v : []).filter((c) => c && c.id); }; // v2.5.64: oštećen zapis ne ruši ekran
export const getCourse = async (id) => (await getCourses()).find((c) => c.id === id) || null;
async function saveAll(list) { await settings.set('courses', list); }

export async function addCourse(name, items = [], extra = {}) {
  const c = { v: 1, id: uid(), name: clean(name), ic: extra.ic || '🎓', items: items.slice(0, MAX_ITEMS), ...extra, updatedAt: Date.now() };
  if (!c.name) return null;
  const list = await getCourses(); list.push(c); await saveAll(list);
  return c;
}
export async function updateCourse(id, patch) {
  const list = await getCourses(); const i = list.findIndex((x) => x.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch, v: 1, updatedAt: Date.now(), name: patch.name !== undefined ? clean(patch.name) || list[i].name : list[i].name };
  if (list[i].items) list[i].items = list[i].items.slice(0, MAX_ITEMS);
  await saveAll(list);
  return list[i];
}
/** v2.5.64: obrisane pesme izlaze i iz kurseva (da kurs ne pokazuje na pesmu koje nema). Vraća stanje za „Poništi“ ili null. */
export async function dropSongs(ids) {
  const set = new Set(ids || []); if (!set.size) return null;
  const list = await getCourses(); const before = JSON.parse(JSON.stringify(list)); let ch = false;
  for (const c of list) {
    const items = (c.items || []).filter((x) => !(x && x.s && set.has(x.s)));
    if (items.length !== (c.items || []).length) { c.items = items; c.updatedAt = Date.now(); ch = true; }
  }
  if (!ch) return null;
  await saveAll(list); return before;
}
export async function restoreCourses(before) { if (Array.isArray(before)) await saveAll(before); }
export async function deleteCourse(id) { await saveAll((await getCourses()).filter((x) => x.id !== id)); }

/** Kursevi u kojima je pesma: [{ course, index }] (index u items). */
export async function coursesOfSong(songId) {
  const out = [];
  for (const c of await getCourses()) { const i = (c.items || []).findIndex((x) => x && x.s === songId); if (i >= 0) out.push({ course: c, index: i }); }
  return out;
}
/** Prethodna / sledeća stavka kursa (pesma ili prazno mesto). */
export function neighbours(course, index) {
  const it = course.items || [];
  return { prev: index > 0 ? { ...it[index - 1], index: index - 1 } : null, next: index + 1 < it.length ? { ...it[index + 1], index: index + 1 } : null };
}

/** Naziv kursa za seriju: „The Song Path · Level 3“. */
export const seriesName = (s) => clean(`${s.name}${s.level ? ' · Level ' + s.level : ''}`, 60);
const seriesKey = (s) => `${String(s.name || '').toLowerCase()}|${s.level || ''}`;

/** Pesma sa lista iz serije → na svoje mesto u kursu te serije (kurs se pravi sam; prazna mesta do „of“). */
export async function placeInSeries(songId, series) {
  if (!songId || !series || !series.name || !(series.n >= 1)) return null;
  const list = await getCourses();
  let c = list.find((x) => x.series && seriesKey(x.series) === seriesKey(series));
  const total = Math.min(MAX_ITEMS, Math.max(series.of || 0, series.n, c ? (c.items || []).length : 0));
  const items = c ? [...(c.items || [])] : [];
  // pesma već negde u kursu (ponovo uvezena) — skloni je sa starog mesta
  for (let i = 0; i < items.length; i++) if (items[i] && items[i].s === songId) items[i] = { n: i + 1, miss: true };
  while (items.length < total) items.push({ n: items.length + 1, miss: true });
  items[series.n - 1] = { s: songId };
  if (c) return updateCourse(c.id, { items });
  return addCourse(seriesName(series), items, { series: { name: clean(series.name), level: series.level || 0 } });
}

export { seriesFromLines } from './chordChart.js';

/** Rezervna kopija / sinhronizacija: očisti listu kurseva. */
export function cleanCourses(raw) {
  if (!Array.isArray(raw)) return null;
  return raw.filter((c) => c && typeof c.id === 'string' && clean(c.name)).slice(0, 100).map((c) => ({
    v: 1, id: c.id.slice(0, 80), name: clean(c.name), ic: typeof c.ic === 'string' ? c.ic.slice(0, 4) : '🎓',
    items: (Array.isArray(c.items) ? c.items : []).slice(0, MAX_ITEMS).map((x, i) => (x && typeof x.s === 'string' ? { s: x.s.slice(0, 80) } : { n: i + 1, miss: true, ...(x && x.t ? { t: clean(x.t, 80) } : {}) })),
    ...(c.series && c.series.name ? { series: { name: clean(c.series.name), level: Math.max(0, Math.min(99, Number(c.series.level) || 0)) } } : {}),
    ...(Number(c.updatedAt) > 0 ? { updatedAt: Number(c.updatedAt) } : {}),
  }));
}

/**
 * Predlog za sledeću pesmu (pri pravljenju kursa): pesme iz biblioteke koje nisu u kursu, po tome koliko je lak sledeći
 * korak — novi akordi (u odnosu na akorde kursa i poznate), barré, kapodaster. Vraća [{ id, title, artist, why, cost }].
 */
export async function suggestNext(course, { limit = 3 } = {}) {
  const P = await import('./songParts.js'); const C = await import('./chords.js'); const SP = await import('./songPath.js');
  const inC = new Set((course.items || []).filter((x) => x.s).map((x) => x.s));
  const known = await SP.knownChords();
  const have = new Set(known);
  const courseStrums = new Set();
  for (const id of inC) { const s = await db.get(id).catch(() => null); if (!s) continue; for (const p of P.songParts(s)) for (const c of p.chords) have.add(c.chord); if (s.strum && s.strum.steps) courseStrums.add(s.strum.steps); }
  const all = (await db.list()).filter((s) => !inC.has(s.id) && !s.deleted && !s.demo && s.type !== 'tab' && !s.recording).slice(0, 150); // primer pesma se ne predlaže
  const out = [];
  for (const sum of all) {
    const s = await db.get(sum.id).catch(() => null); if (!s) continue;
    const ch = [...new Set(P.songParts(s).flatMap((p) => p.chords.map((c) => c.chord)))];
    if (!ch.length) continue;
    const fresh = ch.filter((c) => !have.has(c)), barre = ch.filter((c) => C.isBarre(c));
    const sameStrum = s.strum && s.strum.steps && courseStrums.has(s.strum.steps);
    const cost = fresh.length * 3 + barre.length * 2 + (s.capo ? 0.5 : 0) + (sameStrum ? -0.5 : 0) + ch.length * 0.1;
    out.push({ id: s.id, title: s.title, artist: s.artist || '', fresh, barre, capo: s.capo || 0, sameStrum: !!sameStrum, chords: ch, cost });
  }
  out.sort((a, b) => a.cost - b.cost);
  return out.slice(0, limit);
}

/** Poređaj pesme kursa po težini (prazna mesta ostaju na kraju). */
export async function sortByDifficulty(course) {
  const P = await import('./songParts.js'); const C = await import('./chords.js');
  const songs = []; const have = new Set();
  for (const x of course.items || []) if (x.s) { const s = await db.get(x.s).catch(() => null); if (s) songs.push({ x, ch: [...new Set(P.songParts(s).flatMap((p) => p.chords.map((c) => c.chord)))], capo: s.capo || 0 }); }
  const order = [];
  while (songs.length) {
    let bi = 0, bc = Infinity;
    songs.forEach((s, i) => { const c = s.ch.filter((k) => !have.has(k)).length * 3 + s.ch.filter((k) => C.isBarre(k)).length * 2 + (s.capo ? 0.5 : 0); if (c < bc) { bc = c; bi = i; } });
    const [s] = songs.splice(bi, 1); s.ch.forEach((k) => have.add(k)); order.push(s.x);
  }
  return [...order, ...(course.items || []).filter((x) => !x.s)];
}
