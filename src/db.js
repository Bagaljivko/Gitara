// Jednostavan IndexedDB omotač: pesme i podešavanja ostaju samo na uređaju.
import { upgradeSong, needsUpgrade } from './songmodel.js';
import { nextVersion } from './syncClock.js';
const DB_NAME = 'gitara';
// v2: mali indeks pesama („lib“) za brzu biblioteku; v3: obrisane pesme („deleted“: id + vreme);
// v4: sinhronizacija između uređaja („sync“: verzija i „čeka slanje“ po stavci, „syncState“, „versions“: Prethodna verzija)
const DB_VERSION = 4;
let dbPromise = null;

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      if (!db.objectStoreNames.contains('lib')) db.createObjectStore('lib', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('deleted')) db.createObjectStore('deleted', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sync')) db.createObjectStore('sync', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('syncState')) db.createObjectStore('syncState');
      if (!db.objectStoreNames.contains('versions')) db.createObjectStore('versions', { keyPath: 'n', autoIncrement: true }).createIndex('key', 'key');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; }; // nova verzija aplikacije u drugom prozoru
      db.onclose = () => { if (dbPromise) dbPromise = null; }; // v1.93: telefon je sam zatvorio vezu (dugo u pozadini) — sledeće otvaranje je nova veza
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// ---- Indeks pesama: samo ono što biblioteka i setliste prikazuju (bez akorda i originala) ----
// Pesma sa svim akordima i originalom je ~10–15 KB; za 300 pesama čitanje svega je ~4 MB i na
// sporom telefonu traje pola sekunde. Indeks je ~20 puta manji i čita se odmah.
const LIB_V = 2; // v2: vrsta pesme (TAB)
const fold = (x) => String(x || '').trim().toLocaleLowerCase('sr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'dj');
export function summarize(rec) {
  const secs = rec.sections || [];
  return {
    v: LIB_V, id: rec.id, title: rec.title || '', artist: rec.artist || '', key: rec.key || '', keyN: rec.keyN || null,
    transpose: rec.transpose || 0, capo: rec.capo || 0, tuning: rec.tuning || '', folders: rec.folders || [],
    demo: !!rec.demo, createdAt: rec.createdAt || 0, updatedAt: rec.updatedAt || 0, ...(rec.type === 'tab' ? { type: 'tab' } : {}),
    ...(rec.student ? { student: rec.student } : {}), ...(rec.fromStudent ? { fromStudent: 1 } : {}), ...(rec.fromT ? { fromT: 1 } : {}), // v1.78: nastava
    hasTabs: secs.some((x) => (x.tabs || []).length),
    find: fold(secs.map((sec) => (sec.lines || []).map((l) => l.text || '').join('\n')).join('\n')), // za pretragu teksta
  };
}

/** v1.93: transakcija; ako je veza u međuvremenu zatvorena („connection is closing“), otvori novu i pokušaj još jednom. */
export async function transaction(stores, mode) {
  for (let i = 0; ; i++) {
    const db = await open();
    try { return db.transaction(stores, mode); }
    catch (e) { if (i === 0 && e && e.name === 'InvalidStateError') { try { db.close(); } catch {} dbPromise = null; continue; } throw e; }
  }
}
function tx(store, mode, fn) {
  return transaction(store, mode).then((t) => new Promise((resolve, reject) => {
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : r);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

// Obaveštenja o izmenama (za automatsku rezervnu kopiju na Google Drive).
export const events = new EventTarget();
const changed = (type, detail, remote = false) => {
  if (type === 'songs-changed') libMem = null; // indeks u memoriji je zastareo
  const e = new CustomEvent(type, { detail });
  e.remote = remote; // izmena stigla sinhronizacijom (sa drugog uređaja ili iz druge kartice) — ne šalje se nazad
  events.dispatchEvent(e);
};
/** Sinhronizacija je upisala u bazu mimo ovog modula: osveži indeks i javi ekranima. */
export function notifyRemote(keys) {
  let songsHit = false;
  const sets = new Set();
  for (const k of keys) {
    if (k.startsWith('song:')) songsHit = true;
    else { const s = SYNC_SETTING_OF(k); if (s) sets.add(s); }
  }
  if (songsHit) changed('songs-changed', null, true);
  for (const s of sets) changed('settings-changed', s, true);
}

// ---- Sinhronizacija: svaka izmena u istoj transakciji označi stavku „čeka slanje“ (outbox) ----
// Više izmena iste stavke pre slanja = jedna promena. Verzija (hibridni sat) je uvek veća od one koju zamenjuje.
export const PREF_KEYS = ['a4', 'lang', 'metBpm', 'tunerRoom', 'tuning', 'wakeMode', 'wakeMinutes', 'noteNames', 'geminiModel', 'geminiModelSel', 'syncMigrated', 'myRhythms', 'strumSuggest', 'weekGoal'];
const LIST_KEYS = { setlists: 'set:', folders: 'folder:' }; // nizovi: svaka set lista / folder je posebna stavka
const WHOLE_KEYS = ['practice', 'skale', 'activity', 'teacher', 'students', 'myTeacher', 'requests', 'myRequests', 'myEx', 'rpList']; // v1.97: Moje vežbe // v1.73: activity = svirano/vežbano po uređaju; v1.78: nastava
export function SYNC_SETTING_OF(k) {
  if (k.startsWith('set:')) return 'setlists';
  if (k.startsWith('folder:')) return 'folders';
  if (k.startsWith('pref:')) return k.slice(5);
  if (k === 'secret') return 'geminiKey';
  return WHOLE_KEYS.includes(k) ? k : null;
}
function mark(store, key, deleted = false) {
  const r = store.get(key);
  // base: verzija na kojoj je izmena napravljena (za prepoznavanje istovremenih izmena na dva uređaja)
  r.onsuccess = () => { const m = r.result; store.put({ ...(m || {}), key, hlc: nextVersion(m && m.hlc), base: m && m.dirty ? m.base || '' : (m && m.hlc) || '', dirty: true, deleted }); };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** settings.set/remove → stavke za sinhronizaciju (u istoj transakciji). */
function markSetting(sync, key, val, old, removed) {
  if (LIST_KEYS[key]) {
    const pre = LIST_KEYS[key];
    const was = new Map((Array.isArray(old) ? old : []).filter((x) => x && x.id).map((x) => [x.id, x]));
    const now = new Map((removed || !Array.isArray(val) ? [] : val).filter((x) => x && x.id).map((x) => [x.id, x]));
    for (const [id, x] of now) if (!same(x, was.get(id))) mark(sync, pre + id);
    for (const id of was.keys()) if (!now.has(id)) mark(sync, pre + id, true);
  } else if (WHOLE_KEYS.includes(key)) { if (!same(val, old)) mark(sync, key, !!removed); }
  else if (PREF_KEYS.includes(key)) { if (!same(val, old)) mark(sync, 'pref:' + key, !!removed); }
  else if (key === 'geminiKey') { if (!same(val, old)) mark(sync, 'secret', !!removed); }
}
export const SYNCED_SETTING = (k) => !!LIST_KEYS[k] || WHOLE_KEYS.includes(k) || PREF_KEYS.includes(k) || k === 'geminiKey';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function txMulti(stores, fn) {
  return transaction(stores, 'readwrite').then((t) => new Promise((resolve, reject) => {
    const r = fn(...stores.map((n) => t.objectStore(n)));
    t.oncomplete = () => resolve(r);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
// Obrisana pesma se pamti (id + vreme): nijedno kasnije upisivanje stare kopije (otvoren ekran pesme, rezervna kopija,
// druga kartica) je ne vraća. Samo `force` (novija verzija iz rezervne kopije, izmenjena posle brisanja) briše oznaku.
const putRec = (rec, force = false) => txMulti(['songs', 'lib', 'deleted', 'sync'], (s, l, d, y) => {
  const out = { ok: true };
  const write = () => { s.put(rec); l.put(summarize(rec)); if (!rec.demo) mark(y, 'song:' + rec.id); }; // primer pesme ostaje samo na uređaju
  if (force) { d.delete(rec.id); write(); return out; }
  const r = d.get(rec.id);
  r.onsuccess = () => { if (r.result) out.ok = false; else write(); };
  return out;
});
export const newSongId = uid;
const TOMB_DAYS = 180; // oznake starije od pola godine se brišu

let libMem = null; // indeks u memoriji (ponovni ulazak u biblioteku bez čitanja baze)
async function rebuildLib() {
  const all = await tx('songs', 'readonly', (s) => s.getAll());
  const sums = all.map(summarize);
  await txMulti(['lib'], (l) => { l.clear(); sums.forEach((x) => l.put(x)); });
  return sums;
}

export const songs = {
  all: () => tx('songs', 'readonly', (s) => s.getAll()),
  /** Brzo: samo naslov, izvođač, tonalitet, oznake i tekst za pretragu (ne menjati vraćene objekte). */
  async list() {
    if (libMem) return libMem.slice();
    let sums = await tx('lib', 'readonly', (l) => l.getAll());
    const n = await songs.count();
    if (sums.length !== n || sums.some((x) => x.v !== LIB_V)) sums = await rebuildLib();
    libMem = sums;
    return sums.slice();
  },
  count: () => tx('songs', 'readonly', (s) => s.count()),
  get: (id) => tx('songs', 'readonly', (s) => s.get(id)),
  async save(song) {
    const now = Date.now();
    // Svaka pesma dobija neutralni sloj akorda i snimak originala (ako ih još nema)
    const up = needsUpgrade(song) ? upgradeSong(song) : song;
    const rec = { ...up, id: song.id || uid(), createdAt: song.createdAt || now, updatedAt: now };
    if ((await putRec(rec)).ok) changed('songs-changed', rec.id);
    return rec;
  },
  /** Upis cele pesme kakva jeste (isti id). Obrisana pesma se ne vraća, osim uz { force: true }. Vraća id ili null. */
  put: async (rec0, { force = false } = {}) => {
    const rec = needsUpgrade(rec0) ? upgradeSong(rec0) : rec0;
    if (!(await putRec(rec, force)).ok) return null;
    changed('songs-changed', rec.id);
    return rec.id;
  },
  remove: (id, at = Date.now()) => txMulti(['songs', 'lib', 'deleted', 'sync'], (s, l, d, y) => {
    const r = s.get(id);
    r.onsuccess = () => { if (!(r.result && r.result.demo)) mark(y, 'song:' + id, true); s.delete(id); l.delete(id); d.put({ id, at }); };
  }).then(() => { changed('songs-changed', id); }),
  /** Obrisane pesme: { id: vreme } (stare oznake se usput brišu). */
  async deleted() {
    const all = await tx('deleted', 'readonly', (d) => d.getAll());
    const cut = Date.now() - TOMB_DAYS * 864e5, out = {}, old = [];
    for (const x of all) { if (x.at < cut) old.push(x.id); else out[x.id] = x.at; }
    if (old.length) await txMulti(['deleted'], (d) => old.forEach((id) => d.delete(id)));
    return out;
  },
  /** Oznake brisanja sa drugog uređaja (iz rezervne kopije): zapamti ih i obriši te pesme ako nisu menjane posle toga. */
  async markDeleted(map) {
    let n = 0;
    for (const [id, at] of Object.entries(map || {})) {
      const cur = await songs.get(id);
      if (cur && (cur.updatedAt || 0) > at) continue; // menjana posle brisanja na drugom uređaju — ostaje
      const had = await tx('deleted', 'readonly', (d) => d.get(id));
      if (had && had.at >= at && !cur) continue;
      await txMulti(['songs', 'lib', 'deleted', 'sync'], (s, l, d, y) => { s.delete(id); l.delete(id); d.put({ id, at: Math.max(at, had ? had.at : 0) }); if (cur) mark(y, 'song:' + id, true); });
      if (cur) n++;
    }
    if (n) changed('songs-changed', null);
    return n;
  },
  clear: () => txMulti(['songs', 'lib', 'sync'], (s, l, y) => {
    const r = s.getAllKeys();
    r.onsuccess = () => { r.result.forEach((id) => mark(y, 'song:' + id, true)); s.clear(); l.clear(); };
  }).then(() => { changed('songs-changed', null); }),
};

function setWithSync(key, val, removed) {
  if (!SYNCED_SETTING(key)) return tx('settings', 'readwrite', (s) => (removed ? s.delete(key) : s.put(val, key)));
  return txMulti(['settings', 'sync'], (s, y) => {
    const r = s.get(key);
    r.onsuccess = () => {
      const put = () => { if (removed) s.delete(key); else s.put(val, key); };
      // v1.68: „Prenesi ključ na moje uređaje“ isključeno → Gemini ključ ostaje samo na ovom uređaju (ne šalje se)
      if (key === 'geminiKey') { const k = s.get('keySync'); k.onsuccess = () => { if (k.result !== false) markSetting(y, key, val, r.result, removed); put(); }; return; }
      markSetting(y, key, val, r.result, removed); put();
    };
  });
}

/**
 * v1.68: „Prenesi ključ na moje uređaje“ (podešavanje samo ovog uređaja). Uključeno: ključ ovog uređaja ide na ostale
 * uređaje; ako ovde nema ključa, uzima se onaj koji je u međuvremenu stigao sa naloga (čuvan sa strane dok je bilo isključeno).
 */
export function setKeySync(on) {
  return txMulti(['settings', 'sync', 'syncState'], (s, y, ss) => {
    s.put(!!on, 'keySync');
    if (!on) return;
    const r = s.get('geminiKey');
    r.onsuccess = () => {
      if (r.result) { mark(y, 'secret'); return; }
      const h = ss.get('held:secret');
      h.onsuccess = () => { if (h.result) s.put(h.result, 'geminiKey'); ss.delete('held:secret'); };
    };
  }).then(() => { changed('settings-changed', 'geminiKey'); });
}
export const settings = {
  get: (key, def) => tx('settings', 'readonly', (s) => s.get(key)).then((v) => (v === undefined ? def : v)),
  set: (key, val) => setWithSync(key, val, false).then(() => { changed('settings-changed', key); }),
  remove: (key) => setWithSync(key, undefined, true).then(() => { if (SYNCED_SETTING(key)) changed('settings-changed', key); }),
  keys: () => tx('settings', 'readonly', (s) => s.getAllKeys()), // v1.71: rezervna kopija cele aplikacije
};

// ---- Prethodna verzija (izgubljena strana sukoba, ponovni sken…): do 5 po stavci, ukupno do 300 ----
const VERSIONS_PER_KEY = 5, VERSIONS_MAX = 300;
export function keepVersion(store, key, data, reason, hlc = '', at = Date.now()) {
  if (data == null) return;
  store.add({ key, data, reason, hlc, at });
  const r = store.index('key').getAllKeys(key);
  r.onsuccess = () => { const ks = r.result; for (let i = 0; i < ks.length - VERSIONS_PER_KEY; i++) store.delete(ks[i]); };
  const c = store.count();
  c.onsuccess = () => { if (c.result > VERSIONS_MAX) { const k = store.getAllKeys(null, c.result - VERSIONS_MAX); k.onsuccess = () => k.result.forEach((n) => store.delete(n)); } };
}
export const versions = {
  /** Sačuvaj staru verziju (npr. pre ponovnog skeniranja). */
  save: (key, data, reason) => txMulti(['versions'], (v) => keepVersion(v, key, data, reason)),
  /** Prethodne verzije jedne stavke (najnovija prva) ili svih. */
  async list(key) {
    const all = await tx('versions', 'readonly', (v) => (key ? v.index('key').getAll(key) : v.getAll()));
    return all.sort((a, b) => b.at - a.at);
  },
  remove: (n) => txMulti(['versions'], (v) => v.delete(n)),
};

// ---- Stanje sinhronizacije (za Web Worker i podešavanja) ----
export const syncMeta = {
  all: () => tx('sync', 'readonly', (y) => y.getAll()),
  pending: () => tx('sync', 'readonly', (y) => y.getAll()).then((a) => a.filter((m) => m.dirty).length),
  state: (k) => tx('syncState', 'readonly', (s) => s.get(k)),
  setState: (k, v) => tx('syncState', 'readwrite', (s) => s.put(v, k)),
};
