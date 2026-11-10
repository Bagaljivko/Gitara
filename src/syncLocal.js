// Uređaj za sinhronizaciju: IndexedDB kao izvor istine (radi u Web Worker-u, a bez njega i na glavnoj niti).
// Upisuje direktno u bazu (bez ponovnog označavanja „čeka slanje“); ekrani dobijaju obaveštenje preko poruke.
import { transaction, summarize, keepVersion, SYNC_SETTING_OF, PREF_KEYS } from './db.js';
const PREFS = new Set(PREF_KEYS);
import { hlcStr } from './syncEngine.js';

const STORES = ['songs', 'lib', 'deleted', 'settings', 'sync', 'syncState'];
function run(stores, mode, fn) {
  return transaction(stores, mode).then((t) => new Promise((resolve, reject) => {
    const out = fn(...stores.map((n) => t.objectStore(n)));
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
// Fotografije i zvuk se nikad ne šalju: iz pesme se izostavljaju slike/snimci (data: URL, Blob, bajtovi) — snimci su samo note.
const isMedia = (v) => (typeof v === 'string' && v.length > 512 && /^data:(image|audio|video)\//.test(v)) || (typeof Blob !== 'undefined' && v instanceof Blob) || v instanceof ArrayBuffer || ArrayBuffer.isView(v);
function noMedia(rec) { let out = rec; for (const [k, v] of Object.entries(rec)) if (isMedia(v)) { if (out === rec) out = { ...rec }; delete out[k]; } return out; }
const get = (store, key, cb) => { const r = store.get(key); r.onsuccess = () => cb(r.result); };
const box = () => ({ value: undefined });

/** Čita podatak stavke iz prodavnica. */
function readInto(st, key, out) {
  const [songs, , , settings, , syncState] = st;
  if (key.startsWith('song:')) return get(songs, key.slice(5), (v) => (out.value = v ? noMedia(v) : null));
  const setting = SYNC_SETTING_OF(key);
  if (!setting) return get(syncState, 'x:' + key, (v) => (out.value = v ?? null)); // nepoznata vrsta (novija aplikacija) — čuva se netaknuto
  get(settings, setting, (v) => {
    if (key.startsWith('set:') || key.startsWith('folder:')) {
      const id = key.slice(key.indexOf(':') + 1);
      out.value = (Array.isArray(v) ? v : []).find((x) => x && x.id === id) ?? null;
    } else out.value = v ?? null;
  });
}

function writeInto(st, key, data) {
  const [songs, lib, deleted, settings, , syncState] = st;
  if (key.startsWith('song:')) {
    const id = key.slice(5);
    if (data == null) { songs.delete(id); lib.delete(id); deleted.put({ id, at: Date.now() }); return; }
    const rec = { ...data, id };
    songs.put(rec); lib.put(summarize(rec)); deleted.delete(id);
    return;
  }
  const setting = SYNC_SETTING_OF(key);
  if (!setting) { if (data == null) syncState.delete('x:' + key); else syncState.put(data, 'x:' + key); return; }
  if (key.startsWith('set:') || key.startsWith('folder:')) {
    const id = key.slice(key.indexOf(':') + 1);
    get(settings, setting, (v) => {
      const list = Array.isArray(v) ? v.slice() : [];
      const i = list.findIndex((x) => x && x.id === id);
      if (data == null) { if (i >= 0) list.splice(i, 1); } else if (i >= 0) list[i] = { ...data, id }; else list.push({ ...data, id });
      settings.put(list, setting);
    });
    return;
  }
  if (key === 'secret') {
    // „Prenesi ključ na moje uređaje“ isključeno na ovom uređaju: ključ sa naloga se ne primenjuje, čuva se sa strane
    get(settings, 'keySync', (on) => {
      if (on === false) { if (data == null) syncState.delete('held:secret'); else syncState.put(data, 'held:secret'); }
      else if (data == null) settings.delete(setting); else settings.put(data, setting);
    });
    return;
  }
  if (data == null) settings.delete(setting); else settings.put(data, setting);
}

export function createLocal() {
  return {
    async all() { const r = await run(['sync'], 'readonly', (y) => y.getAll()); return new Map(r.result.map((m) => [m.key, m])); },
    async read(key) { const out = box(); await run(STORES, 'readonly', (...st) => { readInto(st, key, out); return out; }); return out.value ?? null; },
    async write(key, data, meta) {
      await run(STORES, 'readwrite', (...st) => {
        writeInto(st, key, data);
        const y = st[4];
        get(y, key, (m) => y.put({ ...(m || {}), ...meta, key }));
      });
    },
    async meta(key) { const out = box(); await run(['sync'], 'readonly', (y) => get(y, key, (v) => (out.value = v || null))); return out.value ?? null; },
    async setMeta(key, patch) {
      await run(['sync'], 'readwrite', (y) => { if (patch === null) y.delete(key); else get(y, key, (m) => y.put({ ...(m || {}), ...patch, key })); });
    },
    async state(k) { const out = box(); await run(['syncState'], 'readonly', (s) => get(s, k, (v) => (out.value = v))); return out.value; },
    async setState(k, v) { await run(['syncState'], 'readwrite', (s) => s.put(v, k)); },
    async saveVersion(key, data, reason, hlc) {
      if (!key.startsWith('song:') && !key.startsWith('set:')) return; // samo pesme i set liste (podešavanja nemaju „verziju“)
      await run(['versions'], 'readwrite', (v) => keepVersion(v, key, data, reason, hlc));
    },
  };
}

/** Prvo uključivanje (ili novi nalog): sve što još nema verziju dobija je — pesme i set liste prema svom vremenu izmene,
 *  ostalo „staro“ (ono sa naloga ima prednost; rezultati se ionako spajaju). Ništa se ne briše i ne prepisuje. */
export function seed(node) {
  return run(['songs', 'settings', 'sync'], 'readwrite', (songs, settings, y) => {
    const r = y.getAllKeys();
    r.onsuccess = () => {
      const has = new Set(r.result);
      const add = (key, t) => { if (!has.has(key)) { has.add(key); y.put({ key, hlc: hlcStr(Math.max(1, Number(t) || 1), 0, node + '~s'), dirty: true, deleted: false }); } };
      const s = songs.getAll();
      s.onsuccess = () => s.result.forEach((x) => { if (!x.demo) add('song:' + x.id, x.updatedAt || x.createdAt); });
      const keys = settings.getAllKeys();
      keys.onsuccess = () => {
        for (const k of keys.result) {
          get(settings, k, (v) => {
            if (v == null) return;
            if (k === 'setlists' && Array.isArray(v)) v.forEach((x) => x && x.id && add('set:' + x.id, x.updatedAt));
            else if (k === 'folders' && Array.isArray(v)) v.forEach((x) => x && x.id && add('folder:' + x.id, 1));
            else if (k === 'practice' || k === 'skale' || k === 'activity' || k === 'teacher' || k === 'students' || k === 'myTeacher' || k === 'requests' || k === 'myRequests') add(k, 1);
            else if (k === 'geminiKey') add('secret', 1);
            else if (PREFS.has(k)) add('pref:' + k, 1);
          });
        }
      };
    };
  });
}


/** Drugi Google nalog, „Spoji“: sve stavke ovog uređaja idu na novi nalog (oznake brisanja ne), stanje Drive-a od nule. */
export function resetForAccount() {
  return run(['sync', 'syncState'], 'readwrite', (y, s) => {
    const r = y.getAll();
    r.onsuccess = () => r.result.forEach((m) => { if (m.deleted) y.delete(m.key); else y.put({ key: m.key, hlc: m.hlc, dirty: true, deleted: false }); });
    const k = s.getAllKeys();
    k.onsuccess = () => k.result.forEach((x) => { if (!String(x).startsWith('x:')) s.delete(x); });
  });
}

/** Drugi Google nalog, a sve sa ovog uređaja je već sačuvano na starom nalogu: ovde se prikazuju podaci novog naloga
 *  (stari ostaju na svom Drive-u — vraćaju se prijavom na taj nalog). Podešavanja uređaja (jezik, štimovanje…) ostaju. */
export function wipeForAccount() {
  return run(['songs', 'lib', 'deleted', 'settings', 'sync', 'syncState', 'versions'], 'readwrite', (songs, lib, deleted, settings, y, s, v) => {
    songs.clear(); lib.clear(); deleted.clear(); y.clear(); s.clear(); v.clear();
    for (const k of ['setlists', 'folders', 'practice', 'skale', 'activity', 'teacher', 'students', 'myTeacher', 'requests', 'myRequests', 'geminiKey']) settings.delete(k);
  });
}
