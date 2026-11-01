// Jednostavan IndexedDB omotač: pesme i podešavanja ostaju samo na uređaju.
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

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export const songs = {
  all: () => tx('songs', 'readonly', (s) => s.getAll()),
  get: (id) => tx('songs', 'readonly', (s) => s.get(id)),
  async save(song) {
    const now = Date.now();
    const rec = { ...song, id: song.id || uid(), createdAt: song.createdAt || now, updatedAt: now };
    await tx('songs', 'readwrite', (s) => s.put(rec));
    return rec;
  },
  put: (rec) => tx('songs', 'readwrite', (s) => s.put(rec)),
  remove: (id) => tx('songs', 'readwrite', (s) => s.delete(id)),
};

export const settings = {
  get: (key, def) => tx('settings', 'readonly', (s) => s.get(key)).then((v) => (v === undefined ? def : v)),
  set: (key, val) => tx('settings', 'readwrite', (s) => s.put(val, key)),
  remove: (key) => tx('settings', 'readwrite', (s) => s.delete(key)),
};
