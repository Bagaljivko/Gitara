// Jednostavan IndexedDB omotač: pesme i podešavanja ostaju samo na uređaju.
import { upgradeSong, needsUpgrade } from './songmodel.js';
const DB_NAME = 'gitara';
const DB_VERSION = 2; // v2: mali indeks pesama („lib“) za brzu biblioteku
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      if (!db.objectStoreNames.contains('lib')) db.createObjectStore('lib', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; }; // nova verzija aplikacije u drugom prozoru
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// ---- Indeks pesama: samo ono što biblioteka i setliste prikazuju (bez akorda i originala) ----
// Pesma sa svim akordima i originalom je ~10–15 KB; za 300 pesama čitanje svega je ~4 MB i na
// sporom telefonu traje pola sekunde. Indeks je ~20 puta manji i čita se odmah.
const LIB_V = 1;
const fold = (x) => String(x || '').trim().toLocaleLowerCase('sr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'dj');
export function summarize(rec) {
  const secs = rec.sections || [];
  return {
    v: LIB_V, id: rec.id, title: rec.title || '', artist: rec.artist || '', key: rec.key || '', keyN: rec.keyN || null,
    transpose: rec.transpose || 0, capo: rec.capo || 0, tuning: rec.tuning || '', folders: rec.folders || [],
    demo: !!rec.demo, createdAt: rec.createdAt || 0, updatedAt: rec.updatedAt || 0,
    hasTabs: secs.some((x) => (x.tabs || []).length),
    find: fold(secs.map((sec) => (sec.lines || []).map((l) => l.text || '').join('\n')).join('\n')), // za pretragu teksta
  };
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : r);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

// Obaveštenja o izmenama (za automatsku rezervnu kopiju na Google Drive).
export const events = new EventTarget();
const changed = (type, detail) => {
  if (type === 'songs-changed') libMem = null; // indeks u memoriji je zastareo
  events.dispatchEvent(new CustomEvent(type, { detail }));
};

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function txMulti(stores, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(stores, 'readwrite');
    const r = fn(...stores.map((n) => t.objectStore(n)));
    t.oncomplete = () => resolve(r);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
const putRec = (rec) => txMulti(['songs', 'lib'], (s, l) => { s.put(rec); l.put(summarize(rec)); });

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
    await putRec(rec);
    changed('songs-changed', rec.id);
    return rec;
  },
  put: (rec0) => { const rec = needsUpgrade(rec0) ? upgradeSong(rec0) : rec0; return putRec(rec).then(() => { changed('songs-changed', rec.id); return rec.id; }); },
  remove: (id) => txMulti(['songs', 'lib'], (s, l) => { s.delete(id); l.delete(id); }).then(() => { changed('songs-changed', id); }),
  clear: () => txMulti(['songs', 'lib'], (s, l) => { s.clear(); l.clear(); }).then(() => { changed('songs-changed', null); }),
};

export const settings = {
  get: (key, def) => tx('settings', 'readonly', (s) => s.get(key)).then((v) => (v === undefined ? def : v)),
  set: (key, val) => tx('settings', 'readwrite', (s) => s.put(val, key)).then((r) => { changed('settings-changed', key); return r; }),
  remove: (key) => tx('settings', 'readwrite', (s) => s.delete(key)),
};
