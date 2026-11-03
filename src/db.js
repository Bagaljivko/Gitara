// Jednostavan IndexedDB omotač: pesme i podešavanja ostaju samo na uređaju.
import { upgradeSong, needsUpgrade } from './songmodel.js';
const DB_NAME = 'gitara';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
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
const changed = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export const songs = {
  all: () => tx('songs', 'readonly', (s) => s.getAll()),
  get: (id) => tx('songs', 'readonly', (s) => s.get(id)),
  async save(song) {
    const now = Date.now();
    // Svaka pesma dobija neutralni sloj akorda i snimak originala (ako ih još nema)
    const up = needsUpgrade(song) ? upgradeSong(song) : song;
    const rec = { ...up, id: song.id || uid(), createdAt: song.createdAt || now, updatedAt: now };
    await tx('songs', 'readwrite', (s) => s.put(rec));
    changed('songs-changed', rec.id);
    return rec;
  },
  put: (rec0) => { const rec = needsUpgrade(rec0) ? upgradeSong(rec0) : rec0; return tx('songs', 'readwrite', (s) => s.put(rec)).then((r) => { changed('songs-changed', rec.id); return r; }); },
  remove: (id) => tx('songs', 'readwrite', (s) => s.delete(id)).then((r) => { changed('songs-changed', id); return r; }),
  clear: () => tx('songs', 'readwrite', (s) => s.clear()).then((r) => { changed('songs-changed', null); return r; }),
};

export const settings = {
  get: (key, def) => tx('settings', 'readonly', (s) => s.get(key)).then((v) => (v === undefined ? def : v)),
  set: (key, val) => tx('settings', 'readwrite', (s) => s.put(val, key)).then((r) => { changed('settings-changed', key); return r; }),
  remove: (key) => tx('settings', 'readwrite', (s) => s.delete(key)),
};
