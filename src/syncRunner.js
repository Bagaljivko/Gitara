// Jedan „radnik“ sinhronizacije: u Web Worker-u (syncWorker.js) ili, gde Worker ne može, na glavnoj niti.
// Poruke: init / sync / seed / reset / token / answer  →  status / applied / needToken / ask / done
import { createEngine, SyncError } from './syncEngine.js';
import { createLocal, seed, resetForAccount } from './syncLocal.js';
import { createDrive } from './syncDrive.js';

export function createRunner(post) {
  const waiting = new Map();
  let seq = 0, engine = null, drive = null, running = null, again = false, node = '', paused = false;
  const request = (msg) => new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, { resolve, reject }); post({ ...msg, id }); });
  let token = '', tokenExp = 0;
  async function getToken(force) {
    if (!force && token && Date.now() < tokenExp) return token;
    const r = await request({ t: 'needToken', force: !!force });
    if (!r || !r.token) throw new SyncError('auth', r && r.offline ? 'OFFLINE' : 'AUTH');
    token = r.token; tokenExp = r.exp || Date.now() + 50 * 60000;
    return token;
  }
  function make() {
    drive = createDrive(getToken);
    engine = createEngine(createLocal(), drive, {
      node,
      ask: (kind, info) => request({ t: 'ask', kind, info }),
      onStatus: (s) => post({ t: 'status', s }),
      onApplied: (keys) => post({ t: 'applied', keys }),
    });
  }
  async function syncLoop() {
    do {
      again = false;
      try { const r = await engine.sync(); post({ t: 'done', ok: true, sent: r.sent, pulled: r.pulled.length, newer: r.newer }); }
      catch (e) { post({ t: 'done', ok: false, code: (e && e.code) || 'ERR', msg: String((e && e.message) || e).slice(0, 200) }); again = false; }
    } while (again);
  }
  return async function onMessage(m) {
    if (m.t === 'init') { node = m.node; token = m.token || ''; tokenExp = m.exp || 0; make(); post({ t: 'ready' }); return; }
    if (m.t === 'setToken') { token = m.token; tokenExp = m.exp || Date.now() + 50 * 60000; return; } // nov nalog / nova prijava
    if (m.t === 'token' || m.t === 'answer') { const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w.resolve(m.value); } return; }
    if (m.t === 'seed') { await seed(node); post({ t: 'seeded', id: m.id }); return; }
    if (m.t === 'reset') { await resetForAccount(); make(); post({ t: 'wasReset', id: m.id }); return; }
    if (m.t === 'about') { try { post({ t: 'about', id: m.id, value: await drive.about() }); } catch (e) { post({ t: 'about', id: m.id, error: (e && e.code) || 'ERR' }); } return; }
    // promena naloga: sačekaj tekući krug i ne počinji novi dok se nalog ne promeni (nikad pola na jednom, pola na drugom)
    if (m.t === 'pause') { paused = true; again = false; if (running) await running; post({ t: 'paused', id: m.id }); return; }
    if (m.t === 'resume') { paused = false; return; }
    if (m.t === 'sync') {
      if (paused) { post({ t: 'done', ok: false, code: 'PAUSED' }); return; }
      if (running) { again = true; return; }
      running = syncLoop().finally(() => { running = null; });
    }
  };
}
