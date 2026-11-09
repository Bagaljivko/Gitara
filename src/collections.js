// Folderi i setliste. Folderi: lista {id, name}; pesma ima song.folders = [id…] (može biti u više foldera).
// Setlista: {id, name, songIds:[…]} — uređen spisak pesama.
import { settings, songs as db } from './db.js';
import { t } from './i18n.js';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const clean = (s, max = 60) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, max);

// ---------------- Folderi ----------------
export const getFolders = async () => (await settings.get('folders', [])) || [];
/** Stalni folder za snimke iz „Samo sviraj“ (ne može se preimenovati ni obrisati; ime prati jezik). */
export const REC_FOLDER = 'moji-snimci';
export const isSystemFolder = (id) => id === REC_FOLDER;
export const folderLabel = (f) => (f && f.id === REC_FOLDER ? t('folder.myRecs') : f ? f.name : '');
export async function ensureRecFolder() {
  const list = await getFolders();
  if (list.some((f) => f.id === REC_FOLDER)) return;
  list.unshift({ id: REC_FOLDER, name: 'Moji snimci' });
  await settings.set('folders', list);
}

export async function addFolder(name) {
  const list = await getFolders();
  const f = { id: uid(), name: clean(name) };
  if (!f.name) return null;
  list.push(f);
  await settings.set('folders', list);
  return f;
}

export async function renameFolder(id, name) {
  const n = clean(name);
  if (!n || isSystemFolder(id)) return;
  const list = (await getFolders()).map((f) => (f.id === id ? { ...f, name: n } : f));
  await settings.set('folders', list);
}

export async function deleteFolder(id) {
  if (isSystemFolder(id)) return;
  await settings.set('folders', (await getFolders()).filter((f) => f.id !== id));
  // Ukloni folder iz pesama (pesme ostaju u biblioteci)
  // nađi ih u brzom indeksu, pa učitaj i menjaj samo te pesme
  for (const sum of await db.list()) {
    if (!(sum.folders || []).includes(id)) continue;
    const s = await db.get(sum.id);
    if (s && Array.isArray(s.folders) && s.folders.includes(id)) {
      s.folders = s.folders.filter((x) => x !== id);
      await db.put(s);
    }
  }
}

export async function setSongFolders(songId, folderIds) {
  const s = await db.get(songId);
  if (!s) return;
  s.folders = [...new Set(folderIds)];
  if (!s.folders.length) delete s.folders;
  await db.put(s);
}

// ---------------- Setliste ----------------
export const getSetlists = async () => ((await settings.get('setlists', [])) || []).map(dropSound);
// stari izbor „Zvuk (Pusti)“ uz set listu se više ne koristi — ne prikazuje se i nestaje pri sledećem čuvanju
function dropSound(x) { if (!x || !x.play || !('sound' in x.play)) return x; const { sound, ...play } = x.play; return { ...x, play }; }
export const getSetlist = async (id) => (await getSetlists()).find((x) => x.id === id) || null;

async function saveSetlists(list) { await settings.set('setlists', list); }

export async function addSetlist(name) {
  const list = await getSetlists();
  const sl = { v: 1, id: uid(), name: clean(name), songIds: [], updatedAt: Date.now() };
  if (!sl.name) return null;
  list.push(sl);
  await saveSetlists(list);
  return sl;
}

export async function updateSetlist(id, patch) {
  const list = await getSetlists();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch, v: 1, updatedAt: Date.now(), name: patch.name !== undefined ? clean(patch.name) || list[i].name : list[i].name };
  await saveSetlists(list);
  return list[i];
}

export async function deleteSetlist(id) { await saveSetlists((await getSetlists()).filter((x) => x.id !== id)); }

/** Validacija foldera i setlista iz rezervne kopije. */
export function cleanFolders(raw) {
  if (!Array.isArray(raw)) return null;
  return raw.filter((f) => f && typeof f.id === 'string' && clean(f.name)).slice(0, 200).map((f) => ({ id: f.id.slice(0, 80), name: clean(f.name) }));
}
export function cleanSetlists(raw) {
  if (!Array.isArray(raw)) return null;
  return raw.filter((x) => x && typeof x.id === 'string' && clean(x.name)).slice(0, 200).map((x) => ({
    id: x.id.slice(0, 80),
    name: clean(x.name),
    songIds: (Array.isArray(x.songIds) ? x.songIds : []).filter((s) => typeof s === 'string').slice(0, 500),
    v: 1, ...(Number(x.updatedAt) > 0 ? { updatedAt: Number(x.updatedAt) } : {}),
    ...(cleanPlay(x.play) ? { play: cleanPlay(x.play) } : {}),
    // v1.78: nastava — za koje učenike, kada je poslato, i da li je stigla od nastavnika (isti link = ista set lista)
    ...(Array.isArray(x.students) ? { students: x.students.filter((s) => typeof s === 'string').slice(0, 200).map((s) => s.slice(0, 40)) } : {}),
    ...(x.sentTo && typeof x.sentTo === 'object' ? { sentTo: Object.fromEntries(Object.entries(x.sentTo).filter(([k, v]) => typeof k === 'string' && Number(v) > 0).slice(0, 200)) } : {}),
    ...(typeof x.src === 'string' ? { src: x.src.slice(0, 120) } : {}),
    ...(x.fromT && typeof x.fromT === 'object' ? { fromT: { tid: String(x.fromT.tid || '').slice(0, 40), name: String(x.fromT.name || '').slice(0, 60) } } : {}),
  }));
}
/** Izbor za „Sviraj set“ (pauza u sekundama, -1 = čekaj mene; skrolovanje; zvuk) — pamti se uz set listu. */
export function cleanPlay(p) {
  if (!p || typeof p !== 'object') return null;
  const pause = [-1, 0, 5, 10, 20].includes(Number(p.pause)) ? Number(p.pause) : 5;
  return { pause, scroll: !!p.scroll }; // zvuk u „Sviraj set“ više ne postoji (stara podešavanja se ne čitaju)
}
export const cleanSongFolders = (raw) => (Array.isArray(raw) ? raw.filter((x) => typeof x === 'string').slice(0, 50).map((x) => x.slice(0, 80)) : []);

/** Spajanje po id-ju (za „Spoji“ pri vraćanju iz rezervne kopije). */
export function mergeById(local, incoming) {
  const map = new Map(local.map((x) => [x.id, x]));
  // isti ID: ostaje novija verzija (set liste imaju updatedAt); bez vremena ostaje lokalna, kao i pre
  for (const x of incoming) { const cur = map.get(x.id); if (!cur || (x.updatedAt && cur.updatedAt && x.updatedAt > cur.updatedAt)) map.set(x.id, x); }
  return [...map.values()];
}
