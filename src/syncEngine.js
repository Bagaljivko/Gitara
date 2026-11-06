// Sinhronizacija između uređaja (Google Drive, skriveni appDataFolder korisnika; bez servera).
// Čista logika — bez DOM-a i bez mreže: radi u Web Worker-u (aplikacija) i u Node-u (testovi sa dva „uređaja“).
//
// Stavke: 'song:<id>', 'set:<id>', 'folder:<id>', 'practice', 'skale', 'pref:<ime>', 'secret'. Svaka je jedan gzip fajl
// { s: šema, k: ključ, h: verzija (hibridni logički sat), d: obrisano?, v: podaci } sa appProperties
// { k, h, s, d, x (SHA-256 sadržaja) }. Svaki uređaj piše SAMO svoje fajlove (meta.own): dva uređaja nikad ne prepisuju isti
// fajl, pa istovremeno slanje ne može da ostavi stariju verziju na Drive-u; važi fajl sa najvećom verzijom za ključ, a svoj
// zastareli fajl uređaj briše čim primi noviju verziju. Novi uređaj i prvo slanje: jedan „snapshot“ fajl, posle toga promene po stavci.
// Uređaj je izvor istine (IndexedDB); izmene čekaju kao „prljave“ stavke (više izmena iste stavke = jedna promena).
//
// local:  { all(), read(key), write(key, data|null, meta), meta(key), setMeta(key, patch), state(k), setState(k, v),
//           saveVersion(key, data, reason, hlc) }
// remote: { startToken(), changes(token), list(), get(fileId), put(name, bytes, props, fileId?), del(fileId) }
// opts:   { node, ask(kind, info) → Promise<bool>, onStatus(s), onApplied(keys), now() }
import { mergePractice, mergeSkale } from './syncMerge.js';

export const SCHEMA = 1;
export const TOMB_DAYS = 90;
export const SNAPSHOT = 'snapshot';
const PAR = 4;                 // istovremeni zahtevi
const SNAP_EVERY = 120;        // posle toliko pojedinačnih fajlova — nov snapshot (novi uređaj brže kreće)

// ---------------- Hibridni logički sat ----------------
// „0001715000000000:0003:node“ — poredi se kao tekst; ne zavisi od tačnog sata uređaja (napreduje i kad je sat iza).
const pad = (n, w) => String(n).padStart(w, '0');
export function hlcParse(h) { const [l, c, ...n] = String(h || '').split(':'); return { l: Number(l) || 0, c: Number(c) || 0, n: n.join(':') }; }
export const hlcStr = (l, c, n) => `${pad(l, 16)}:${pad(c, 4)}:${n}`;
export function createClock(node, last = '', now = () => Date.now()) {
  let { l, c } = hlcParse(last);
  return {
    /** Nov događaj na ovom uređaju. */
    tick() { const t = now(); if (t > l) { l = t; c = 0; } else c++; return hlcStr(l, c, node); },
    /** Primljena verzija sa drugog uređaja: sat ne sme da zaostane za njom. */
    recv(h) { const r = hlcParse(h), t = now(); const m = Math.max(l, r.l, t); c = m === l && m === r.l ? Math.max(c, r.c) + 1 : m === l ? c + 1 : m === r.l ? r.c + 1 : 0; l = m; return hlcStr(l, c, node); },
    get last() { return hlcStr(l, c, node); },
  };
}
export const hlcTime = (h) => hlcParse(h).l;

// ---------------- Pakovanje: gzip + SHA-256 ----------------
const enc = new TextEncoder(), dec = new TextDecoder();
async function pipe(bytes, Stream, mode) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream(mode))).arrayBuffer()); }
export const gzip = (obj) => pipe(enc.encode(JSON.stringify(obj)), CompressionStream, 'gzip');
export const gunzip = async (bytes) => JSON.parse(dec.decode(await pipe(bytes, DecompressionStream, 'gzip')));
export async function sha(bytes) { const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); let s = ''; for (let i = 0; i < 16; i++) s += d[i].toString(16).padStart(2, '0'); return s; }

/** Stavke koje se spajaju (ne pobeđuje jedna strana): rezultati uvek čuvaju najbolje. */
const MERGE = {
  practice: (a, b) => mergePractice(mergePractice(null, a), b),
  skale: (a, b) => mergeSkale(a, b),
};
const mergeFor = (key) => MERGE[key] || null;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function pool(list, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(PAR, list.length) }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); } })); return out; }

export class SyncError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

export function createEngine(local, remote, { node, ask = async () => true, onStatus = () => {}, onApplied = () => {}, now = () => Date.now() } = {}) {
  let clock = null;
  const blocked = new Set(); // stavke koje je napisala novija verzija aplikacije — ne diraju se
  let newer = false;

  async function initClock() { if (!clock) clock = createClock(node, (await local.state('hlc')) || '', now); }
  const saveClock = () => local.setState('hlc', clock.last);

  /** Preuzmi fajl, proveri SHA i šemu. Vraća payload ili null (oštećen / nepotpun — preskače se i traži ponovo). */
  async function fetchPayload(f) {
    const bytes = await remote.get(f.fileId);
    if (f.props && f.props.x && (await sha(bytes)) !== f.props.x) return null;
    try { return await gunzip(bytes); } catch { return null; }
  }

  /** Primeni stavku sa Drive-a (posle provere). Vraća true ako se lokalno nešto promenilo. */
  // istovremene izmene: obe strane su menjale istu verziju (nijedna nije videla drugu); samo za izmenu napravljenu ovde
  const concurrent = (m, p) => !!(m && m.mine && m.hlc && p.b !== undefined && p.b !== m.hlc && m.base !== p.h);
  const stale = []; // moji fajlovi koje je zamenila novija verzija sa drugog uređaja (brišu se na kraju kruga)
  const drop = (m) => { if (m && m.own) stale.push(m.own); return { mine: false, ...(m && m.own ? { own: null } : {}) }; };
  // verzija koju je napravio OVAJ uređaj (Drive javlja i moja slanja): deo moje istorije, nikad „sukob“
  const byMe = (h) => { const n = hlcParse(h).n; return !!node && (n === node || n.startsWith(node + '~')); }; // ~ui (ekrani), ~s (prvo uključivanje)
  async function apply(p, fileId) {
    const key = p.k;
    if (!key || key === SNAPSHOT) return false;
    if ((Number(p.s) || 0) > SCHEMA) { blocked.add(key); newer = true; return false; }
    const m = (await local.meta(key)) || null;
    if (m && m.hlc === p.h) { if (fileId && m.fileId !== fileId) await local.setMeta(key, { fileId }); return false; }
    if (m && m.hlc && byMe(p.h) && p.h < m.hlc) return false; // moje ranije slanje — već imam noviju izmenu
    clock.recv(p.h);
    const remoteData = p.d ? null : p.v;
    if (m && m.dirty) {
      // ista stavka menjana i ovde i na drugom uređaju
      const mg = mergeFor(key);
      if (mg && remoteData && !m.deleted) {
        const merged = mg(await local.read(key), remoteData);
        await local.write(key, merged, { hlc: clock.tick(), dirty: true, deleted: false, fileId: fileId || m.fileId });
        return true;
      }
      if (p.h > m.hlc) { // druga strana je novija: moja izmena ostaje kao „Prethodna verzija“
        const mine = m.deleted ? null : await local.read(key);
        if (mine && !same(mine, remoteData)) await local.saveVersion(key, mine, 'conflict', m.hlc);
        await local.write(key, remoteData, { hlc: p.h, dirty: false, deleted: !!p.d, fileId: fileId || m.fileId, ...drop(m) });
        return true;
      }
      if (remoteData && !same(remoteData, await local.read(key))) await local.saveVersion(key, remoteData, 'conflict', p.h); // moja je novija; njihova ostaje sačuvana
      if (fileId && !m.fileId) await local.setMeta(key, { fileId });
      return false;
    }
    if (m && m.hlc && p.h <= m.hlc) {
      // već imam noviju; ako je ta stara izmena nastala istovremeno sa mojom (nije videla moju), čuva se kao „Prethodna verzija“
      if (p.h < m.hlc && concurrent(m, p) && remoteData && !mergeFor(key) && !same(remoteData, await local.read(key))) await local.saveVersion(key, remoteData, 'conflict', p.h);
      return false;
    }
    if (m && !m.deleted && concurrent(m, p) && !mergeFor(key)) {
      // moja poslata izmena je zamenjena izmenom koja je nije videla: moja ostaje kao „Prethodna verzija“
      const mine = await local.read(key);
      if (mine && !same(mine, remoteData)) await local.saveVersion(key, mine, 'conflict', m.hlc);
    }
    const mg = mergeFor(key);
    if (mg && remoteData && m && !m.deleted) {
      // rezultati: i bez lokalne izmene spoji (stariji uređaj je možda imao bolji rezultat koji nije poslao)
      const cur = await local.read(key);
      const merged = cur ? mg(cur, remoteData) : remoteData;
      await local.write(key, merged, { hlc: p.h, dirty: false, deleted: false, fileId: fileId || m?.fileId, ...drop(m) });
      return true;
    }
    await local.write(key, remoteData, { hlc: p.h, dirty: false, deleted: !!p.d, fileId: fileId || m?.fileId, ...drop(m) });
    return true;
  }

  /** Kandidati iz Drive-a (promene ili ceo spisak): fajlovi novijih verzija nego ovde. */
  async function candidates(files) {
    const best = new Map(); // ključ → fajl sa najvećom verzijom (duplikati istog ključa se svode na jedan)
    const extra = [];
    for (const f of files) {
      const k = f.props && f.props.k;
      if (!k || k === SNAPSHOT || f.removed) continue;
      const b = best.get(k);
      if (!b || (f.props.h || '') > (b.props.h || '')) { if (b) extra.push(b); best.set(k, f); } else extra.push(f);
    }
    const out = [];
    for (const [k, f] of best) {
      if ((Number(f.props.s) || 0) > SCHEMA) { blocked.add(k); newer = true; continue; }
      const m = await local.meta(k);
      if (m && m.hlc && byMe(f.props.h) && f.props.h <= m.hlc) { if (f.fileId && m.fileId !== f.fileId && f.props.h === m.hlc) await local.setMeta(k, { fileId: f.fileId }); continue; } // moje slanje
      if (!m || !m.hlc || f.props.h > m.hlc || (m.dirty && f.props.h !== m.hlc)) out.push(f);
      else if (f.fileId && m.fileId !== f.fileId && f.props.h === m.hlc) await local.setMeta(k, { fileId: f.fileId });
    }
    return { out, extra };
  }

  /** Zaštita: jedna sinhronizacija ne briše masovno bez pitanja (> 10 ili > 20 % stavki). */
  async function guardDeletes(n, total, dir) {
    if (n <= 10 && n <= Math.max(1, total) * 0.2) return true;
    if (n <= 2) return true; // mala biblioteka: dve-tri stavke nisu „masovno“
    return !!(await ask(dir === 'in' ? 'massDeleteIn' : 'massDeleteOut', { n, total }));
  }

  async function pull() {
    let token = await local.state('pageToken');
    let files = [], next = null;
    if (!token) return initial();
    try {
      for (let guard = 0; guard < 500; guard++) {
        const r = await remote.changes(token);
        files.push(...r.items);
        if (r.next) { token = r.next; continue; }
        next = r.newStart || token;
        break;
      }
    } catch (e) {
      if (e && e.code === 'TOKEN') return reconcile(); // istekao / neispravan token — pun pregled po spisku
      throw e;
    }
    const applied = await fetchApply(files);
    await local.setState('pageToken', next);
    return applied;
  }

  async function fetchApply(files) {
    // snapshot fajlovi drugih uređaja (prvo slanje, periodični snimak): njihove stavke važe kao pojedinačni fajlovi;
    // svaki se preuzima samo kad je noviji od već viđenog (i nikad svoj)
    const mySnap = await local.state('snapFile');
    const seen = (await local.state('snapsSeen')) || {};
    const snaps = files.filter((f) => f.props && f.props.k === SNAPSHOT && !f.removed && f.fileId !== mySnap && (f.props.h || '') > (seen[f.fileId] || ''))
      .sort((a, b) => ((a.props.h || '') > (b.props.h || '') ? 1 : -1));
    const fromSnap = [];
    for (const f of snaps) {
      if ((Number(f.props.s) || 0) > SCHEMA) { newer = true; continue; }
      const snap = await fetchPayload(f).catch(() => null);
      if (!snap || !snap.v || !snap.v.items) continue; // oštećen: pokušaće se ponovo (nije označen kao viđen)
      for (const p of Object.values(snap.v.items)) if (await apply(p, null)) fromSnap.push(p.k);
      seen[f.fileId] = f.props.h;
    }
    if (snaps.length) await local.setState('snapsSeen', seen);
    const res = await fetchApplyNext(files);
    if (fromSnap.length) onApplied([...new Set(fromSnap)]);
    return [...new Set([...fromSnap, ...res])];
  }
  async function fetchApplyNext(files) {
    const { out } = await candidates(files);
    // masovno brisanje sa drugog uređaja?
    const localAll = await local.all();
    const live = [...localAll.values()].filter((m) => !m.deleted).length;
    const dels = out.filter((f) => f.props.d === '1' && localAll.get(f.props.k) && !localAll.get(f.props.k).deleted);
    if (dels.length && !(await guardDeletes(dels.length, live, 'in'))) {
      // „Zadrži“: ovde se obnove (nova verzija) i pošalju nazad
      for (const f of dels) await local.setMeta(f.props.k, { hlc: clock.tick(), dirty: true });
      const skip = new Set(dels.map((f) => f.props.k));
      return fetchApplyList(out.filter((f) => !skip.has(f.props.k)));
    }
    return fetchApplyList(out);
  }
  async function fetchApplyList(list) {
    const changed = [];
    const bad = [];
    await pool(list, async (f) => {
      const p = await fetchPayload(f).catch(() => null);
      if (!p || (f.props && p.k !== f.props.k)) { bad.push(f.fileId); return; }
      if (await apply(p, f.fileId)) changed.push(p.k);
    });
    if (bad.length) await local.setState('refetch', [...new Set([...(await local.state('refetch') || []), ...bad])]);
    if (changed.length) onApplied(changed);
    return changed;
  }

  /** Prvi put na ovom uređaju (i pun pregled kad je token istekao): spisak svih fajlova — snapshot-i pa pojedinačni
   *  fajlovi novijih verzija, prema lokalnoj mapi ID → fileId. */
  async function initial() {
    const start = await remote.startToken();
    const files = await remote.list();
    const changed = await fetchApply(files);
    const snaps = files.filter((f) => f.props && f.props.k === SNAPSHOT).map((f) => f.props.h || '').sort();
    await local.setState('pageToken', start);
    await local.setState('snapAt', snaps.length ? snaps[snaps.length - 1] : ((await local.state('snapAt')) || ''));
    return changed;
  }
  const reconcile = initial;

  async function payloadOf(key, m) {
    const data = m.deleted ? null : await local.read(key);
    return { s: SCHEMA, k: key, h: m.hlc, b: m.base || '', d: m.deleted ? 1 : 0, v: data };
  }
  const propsOf = (p, x) => ({ k: p.k, h: p.h, s: String(SCHEMA), d: p.d ? '1' : '0', x });

  async function push() {
    const all = await local.all();
    let dirty = [...all.entries()].filter(([k, m]) => m.dirty && !blocked.has(k));
    const dels = dirty.filter(([, m]) => m.deleted);
    const live = [...all.values()].filter((m) => !m.deleted).length + dels.length;
    if (dels.length && !(await guardDeletes(dels.length, live, 'out'))) {
      // „Ne“: brisanje ostaje samo ovde — stavke se vraćaju sa Drive-a pri punom pregledu
      for (const [k] of dels) await local.setMeta(k, { dirty: false, hlc: '', deleted: false });
      await local.setState('pageToken', '');
      dirty = dirty.filter(([, m]) => !m.deleted);
    }
    // prvo slanje (na Drive-u još nema ničega od ovog naloga): jedan snapshot umesto stotina fajlova
    if (!(await local.state('snapAt')) && dirty.length > 20) {
      await writeSnapshot(all);
      for (const [k, m] of dirty) { const cur = await local.meta(k); if (cur && cur.hlc === m.hlc) await local.setMeta(k, { dirty: false, inSnap: true }); }
      return dirty.length;
    }
    let sent = 0;
    await pool(dirty, async ([k, m]) => {
      const p = await payloadOf(k, m);
      const bytes = await gzip(p);
      const x = await sha(bytes);
      const r = await remote.put(k, bytes, propsOf(p, x), m.own || undefined); // samo svoj fajl
      const cur = await local.meta(k);
      // u međuvremenu ponovo izmenjeno? onda ostaje „prljavo“ (šalje se sledeći put)
      await local.setMeta(k, { own: r.fileId, fileId: r.fileId, hash: x, mine: true, ...(cur && cur.hlc === m.hlc ? { dirty: false } : {}) });
      sent++;
    });
    if (sent) await local.setState('sinceSnap', ((await local.state('sinceSnap')) || 0) + sent);
    if (((await local.state('sinceSnap')) || 0) >= SNAP_EVERY) await writeSnapshot(await local.all());
    return sent;
  }

  async function writeSnapshot(all) {
    const items = {};
    for (const [k, m] of all) {
      if (!m.hlc || blocked.has(k)) continue;
      items[k] = { s: SCHEMA, k, h: m.hlc, d: m.deleted ? 1 : 0, v: m.deleted ? null : await local.read(k) };
    }
    const h = clock.tick();
    const p = { s: SCHEMA, k: SNAPSHOT, h, v: { items } };
    const bytes = await gzip(p);
    const x = await sha(bytes);
    const r = await remote.put(SNAPSHOT, bytes, { k: SNAPSHOT, h, s: String(SCHEMA), d: '0', x }, (await local.state('snapFile')) || undefined);
    await local.setState('snapFile', r.fileId);
    await local.setState('snapAt', h);
    await local.setState('sinceSnap', 0);
  }

  /** Obrisane stavke starije od 90 dana: briše se i fajl na Drive-u (i oznaka ovde). */
  async function cleanTombs() {
    const cut = now() - TOMB_DAYS * 864e5;
    for (const [k, m] of await local.all()) {
      if (m.deleted && !m.dirty && m.hlc && hlcTime(m.hlc) < cut) {
        if (m.own) await remote.del(m.own).catch(() => {});
        await local.setMeta(k, null);
      }
    }
  }

  /** Jedan krug: preuzmi → (sukobi, zaštite) → pošalji → snapshot → čišćenje. */
  async function sync() {
    await initClock();
    onStatus('syncing');
    newer = false;
    // fajlovi koji su prošli put bili oštećeni: ponovo
    const re = (await local.state('refetch')) || [];
    if (re.length) { await local.setState('refetch', []); await fetchApplyList(re.map((fileId) => ({ fileId, props: null }))).catch(() => {}); }
    const pulled = await pull();
    if (stale.length) { const ids = stale.splice(0); await pool(ids, (id) => remote.del(id).catch(() => {})); }
    const sent = await push();
    if (Math.random() < 0.05) await cleanTombs();
    await saveClock();
    onStatus(newer ? 'newer' : 'synced');
    return { pulled, sent, newer };
  }

  return { sync, get newerSchema() { return newer; }, get blocked() { return blocked; } };
}
