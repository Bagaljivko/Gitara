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
import { mergePractice, mergeSkale, mergeActivity } from './syncMerge.js';

export const SCHEMA = 1;
export const TOMB_DAYS = 90;
export const SNAPSHOT = 'snapshot';
const PAR = 4;                 // istovremeni zahtevi (čitanje)
const PAR_W = 2, W_GAP = 450;  // v2.2: slanje — najviše 2 odjednom; v2.5.62: bar 0,45 s razmaka (Google: oko 3 upisa u sekundi po nalogu — ostaje rezerva za kopiju i sanduče)
const SNAP_EVERY = 120;        // posle toliko pojedinačnih fajlova — nov snapshot (novi uređaj brže kreće)
const SNAP_BULK = 60;          // v2.5.66: više od toliko stavki za slanje odjednom → snapshot (u delovima)
export const SNAP_PART = 600000; // v2.5.68: ~600 KB po delu (bilo 2,5 MB) — i na sporoj vezi svaki deo stigne na vreme, a traka napreduje posle svakog dela

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
  activity: (a, b) => mergeActivity(a, b), // v1.73: po uređaju, noviji zapis istog uređaja pobeđuje
  knownChords: (a, b) => unionList(a, b, 300), // v2.5.1: akordi koje znam — unija sa svih uređaja
  dupIgnore: (a, b) => unionList(a, b, 500), // v2.5.1: „nisu duplikati“
  marliAdded: (a, b) => unionList(a, b, 50), // v2.5.2: MARLI put nivoi koji su već dodati (ne dodaju se ponovo)
};
const unionList = (a, b, max) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].filter((x) => typeof x === 'string'))].slice(-max);
const mergeFor = (key) => MERGE[key] || null;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let wLast = 0;
/** Upisi na Drive: najviše PAR_W odjednom, sa razmakom između početaka. */
// v2.5.66: posle prve greške niko ne uzima sledeću stavku i krug se završava tek kad stanu svi — inače bi „zaostali“
// radnici slali i dok sledeći krug (ponovni pokušaj) šalje iste stavke → isti fajl dvaput na Drive-u
async function runAll(n, list, step) {
  let i = 0, err = null;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (!err && i < list.length) { const k = i++; try { await step(list[k], k); } catch (e) { if (!err) err = e; } } }));
  if (err) throw err;
}
async function wpool(list, fn) { await runAll(PAR_W, list, async (x) => { const w = wLast + W_GAP - Date.now(); wLast = Math.max(Date.now(), wLast + W_GAP); if (w > 0) await new Promise((r) => setTimeout(r, w)); await fn(x); }); }
async function pool(list, fn) { const out = []; await runAll(PAR, list, async (x, k) => { out[k] = await fn(x, k); }); return out; }

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
    if (m && m.hlc === p.h) {
      // ista verzija je već na Drive-u (v2.5.66: posle prelaska na novu vezu drugi uređaj ju je već poslao) — ne šalje se ponovo
      const patch = { ...(fileId && m.fileId !== fileId ? { fileId } : {}), ...(m.dirty && !m.deleted === !p.d ? { dirty: false } : {}) };
      if (Object.keys(patch).length) await local.setMeta(key, patch);
      return false;
    }
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
      else if (f.props.h === m.hlc && ((f.fileId && m.fileId !== f.fileId) || (m.dirty && !m.deleted === (f.props.d !== '1')))) await local.setMeta(k, { ...(f.fileId ? { fileId: f.fileId } : {}), ...(m.dirty && !m.deleted === (f.props.d !== '1') ? { dirty: false } : {}) }); // v2.5.66: ista verzija već postoji
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
    const mine = new Set([await local.state('snapFile'), ...((await local.state('snapFiles')) || [])].filter(Boolean)); // v2.5.66: snapshot u delovima
    const seen = (await local.state('snapsSeen')) || {};
    const snaps = files.filter((f) => f.props && f.props.k === SNAPSHOT && !f.removed && !mine.has(f.fileId) && (f.props.h || '') > (seen[f.fileId] || ''))
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
    // v2.5.66: i kad čeka mnogo stavki (npr. posle prelaska na novu vezu) — snapshot u delovima umesto stotina zahteva
    if ((!(await local.state('snapAt')) && dirty.length > 20) || dirty.length > SNAP_BULK) {
      await writeSnapshot(all);
      for (const [k, m] of dirty) { const cur = await local.meta(k); if (cur && cur.hlc === m.hlc) await local.setMeta(k, { dirty: false, inSnap: true }); }
      return dirty.length;
    }
    let sent = 0;
    await wpool(dirty, async ([k, m]) => {
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

  /** v2.5.66: snapshot u delovima (svaki ispod ~2,5 MB) — svaki deo je običan snapshot fajl sa istom verzijom. */
  async function writeSnapshot(all) {
    const parts = [[]]; let size = 0;
    for (const [k, m] of all) {
      if (!m.hlc || blocked.has(k)) continue;
      const it = { s: SCHEMA, k, h: m.hlc, d: m.deleted ? 1 : 0, v: m.deleted ? null : await local.read(k) };
      const n = JSON.stringify(it).length;
      if (size + n > SNAP_PART && parts[parts.length - 1].length) { parts.push([]); size = 0; }
      parts[parts.length - 1].push(it); size += n;
    }
    const h = clock.tick();
    const old = [...new Set([await local.state('snapFile'), ...((await local.state('snapFiles')) || [])].filter(Boolean))];
    const ids = [];
    for (let i = 0; i < parts.length; i++) {
      const p = { s: SCHEMA, k: SNAPSHOT, h, v: { items: Object.fromEntries(parts[i].map((x) => [x.k, x])) } };
      const bytes = await gzip(p);
      const x = await sha(bytes);
      const r = await remote.put(SNAPSHOT, bytes, { k: SNAPSHOT, h, s: String(SCHEMA), d: '0', x, part: String(i), parts: String(parts.length) }, old[i] || undefined);
      ids.push(r.fileId);
      // v2.5.68: posle svakog dela — te stavke su na Drive-u (traka napreduje; posle prekida se ne šalju ponovo)
      await local.setState('snapFiles', [...ids, ...old.slice(ids.length)]);
      for (const it of parts[i]) { const cur = await local.meta(it.k); if (cur && cur.dirty && cur.hlc === it.h) await local.setMeta(it.k, { dirty: false, inSnap: true }); }
    }
    for (const id of old.slice(parts.length)) await remote.del(id).catch(() => {}); // višak starih delova
    await local.setState('snapFile', ids[0]);
    await local.setState('snapFiles', ids);
    await local.setState('snapAt', h);
    await local.setState('sinceSnap', 0);
  }

  /** v2.5.66: provera posle prelaska — da li Drive ima svaku stavku ovog uređaja u istoj ili novijoj verziji.
   *  Vraća { total, ok, missing: [ključevi] }; ništa ne menja. */
  async function verify() {
    const files = await remote.list();
    const have = new Map();
    const bump = (k, h) => { if (k && (!have.has(k) || h > have.get(k))) have.set(k, h); };
    for (const f of files) {
      if (!f.props || f.removed) continue;
      if (f.props.k === SNAPSHOT) {
        const snap = await fetchPayload(f).catch(() => null);
        if (!snap || !snap.v || !snap.v.items) continue;
        for (const it of Object.values(snap.v.items)) bump(it.k, it.h || '');
      } else bump(f.props.k, f.props.h || '');
    }
    const missing = [];
    let total = 0;
    for (const [k, m] of await local.all()) {
      if (!m.hlc || blocked.has(k)) continue;
      total++;
      if (!(have.get(k) >= m.hlc)) missing.push(k);
    }
    return { total, ok: total - missing.length, missing };
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
  // v2.5.66: jedan krug u isto vreme — prelazak i obična sinhronizacija se ne preklapaju (inače isti fajl dvaput na Drive-u)
  let chain = Promise.resolve();
  const one = (fn) => (...a) => { const p = chain.then(() => fn(...a)); chain = p.catch(() => {}); return p; };
  async function syncRound() {
    await initClock();
    onStatus('syncing');
    newer = false;
    // fajlovi koji su prošli put bili oštećeni: ponovo
    const re = (await local.state('refetch')) || [];
    if (re.length) { await local.setState('refetch', []); await fetchApplyList(re.map((fileId) => ({ fileId, props: null }))).catch(() => {}); }
    const pulled = await pull();
    if (stale.length) { const ids = stale.splice(0); await wpool(ids, (id) => remote.del(id).catch(() => {})); }
    const sent = await push();
    if (Math.random() < 0.05) await cleanTombs();
    await saveClock();
    onStatus(newer ? 'newer' : 'synced');
    return { pulled, sent, newer };
  }

  /** v2.5.66: posle prelaska — samo PREUZMI iz stare veze (remote = stara skrivena fascikla). Ništa se ne šalje tamo, stanje
   *  nove veze (token, snimci) se ne dira; ono što je tamo novije postaje izmena ovde koja čeka slanje na NOVU vezu.
   *  Stavka koja ovde već čeka slanje ostaje (ne gazi se). Vraća broj preuzetih stavki. */
  async function importAll() {
    await initClock();
    const files = (await remote.list()).filter((f) => f.props && !f.removed);
    const take = async (p) => {
      if (!p || !p.k || p.k === SNAPSHOT || (Number(p.s) || 0) > SCHEMA) return false;
      const m = await local.meta(p.k);
      if (m && (m.dirty || (m.hlc && p.h <= m.hlc))) return false;
      clock.recv(p.h);
      await local.write(p.k, p.d ? null : p.v, { hlc: p.h, base: '', dirty: true, deleted: !!p.d });
      return true;
    };
    const changed = [];
    for (const f of files.filter((x) => x.props.k === SNAPSHOT).sort((a, b) => ((a.props.h || '') > (b.props.h || '') ? 1 : -1))) {
      const snap = await fetchPayload(f).catch(() => null);
      for (const p of Object.values((snap && snap.v && snap.v.items) || {})) if (await take(p)) changed.push(p.k);
    }
    await pool(files.filter((x) => x.props.k !== SNAPSHOT), async (f) => { const p = await fetchPayload(f).catch(() => null); if (p && p.k === f.props.k && (await take(p))) changed.push(p.k); });
    await saveClock();
    if (changed.length) onApplied([...new Set(changed)]);
    return new Set(changed).size;
  }

  return { sync: one(syncRound), verify: one(verify), importAll: one(importAll), get newerSchema() { return newer; }, get blocked() { return blocked; } };
}
