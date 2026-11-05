// Lažni Google Drive (appDataFolder sa dnevnikom promena) i lažni uređaj (IndexedDB) za testove sinhronizacije.
import { createClock } from '../../src/syncEngine.js';

export function memDrive({ latency = 0, bandwidth = Infinity } = {}) {
  const files = new Map(), log = [];
  let nextId = 1, minToken = 0, corrupt = new Set();
  const stats = { req: 0, bytesUp: 0, bytesDown: 0, ms: 0 };
  const cost = async (bytes = 0) => { stats.req++; stats.ms += latency + (bytes / bandwidth) * 1000; };
  const view = (id) => { const f = files.get(id); return { fileId: id, name: f.name, props: { ...f.props }, removed: !!f.removed }; };
  const remote = {
    async startToken() { await cost(); return String(log.length); },
    async changes(token) {
      await cost();
      const t = Number(token);
      if (!(t >= minToken) || t > log.length) { const e = new Error('token'); e.code = 'TOKEN'; throw e; }
      const ids = [...new Set(log.slice(t))];
      return { items: ids.map(view), next: null, newStart: String(log.length) };
    },
    async list() { await cost(); return [...files.keys()].filter((id) => !files.get(id).removed).map(view); },
    async get(id) {
      const f = files.get(id);
      await cost(f.bytes.length); stats.bytesDown += f.bytes.length;
      if (corrupt.has(id)) { const b = f.bytes.slice(); b[b.length >> 1] ^= 0xff; return b; }
      return f.bytes;
    },
    async put(name, bytes, props, fileId) {
      await cost(bytes.length); stats.bytesUp += bytes.length;
      const id = fileId && files.has(fileId) ? fileId : 'f' + nextId++;
      files.set(id, { name, bytes, props: { ...props } });
      log.push(id);
      return { fileId: id };
    },
    async del(id) { await cost(); const f = files.get(id); if (f) { f.removed = true; log.push(id); } },
  };
  return { remote, files, stats, expireTokens() { minToken = log.length + 1; }, corrupt(id) { corrupt.add(id); }, heal() { corrupt = new Set(); },
    fileOf(key) { return [...files.entries()].filter(([, f]) => f.props.k === key && !f.removed).map(([id]) => id); } };
}

/** Uređaj: podaci (ključ → vrednost) + sinhronizacioni meta podaci, kao IndexedDB u aplikaciji. */
export function memDevice(node, now = () => Date.now()) {
  const data = new Map(), meta = new Map(), state = new Map(), versions = [];
  const clock = createClock(node + '~ui', '', now);
  const local = {
    async all() { return new Map([...meta.entries()].map(([k, m]) => [k, { ...m }])); },
    async read(key) { return data.has(key) ? structuredClone(data.get(key)) : null; },
    async write(key, value, m) { if (value == null) data.delete(key); else data.set(key, structuredClone(value)); meta.set(key, { ...(meta.get(key) || {}), ...m }); },
    async meta(key) { return meta.has(key) ? { ...meta.get(key) } : null; },
    async setMeta(key, patch) { if (patch === null) meta.delete(key); else meta.set(key, { ...(meta.get(key) || {}), ...patch }); },
    async state(k) { return state.get(k); },
    async setState(k, v) { state.set(k, v); },
    async saveVersion(key, value, reason, hlc) { versions.push({ key, value: structuredClone(value), reason, hlc }); },
  };
  return {
    local, data, meta, state, versions,
    /** Izmena kao u aplikaciji: podatak + „prljavo“ sa novom verzijom (više izmena = jedna promena). */
    edit(key, value) { data.set(key, structuredClone(value)); const m = meta.get(key); meta.set(key, { ...(m || {}), hlc: m && m.hlc ? clock.recv(m.hlc) : clock.tick(), base: m && m.dirty ? m.base : (m && m.hlc) || '', dirty: true, deleted: false }); },
    remove(key) { data.delete(key); const m = meta.get(key); meta.set(key, { ...(m || {}), hlc: m && m.hlc ? clock.recv(m.hlc) : clock.tick(), base: m && m.dirty ? m.base : (m && m.hlc) || '', dirty: true, deleted: true }); },
    pending() { return [...meta.values()].filter((m) => m.dirty).length; },
  };
}
