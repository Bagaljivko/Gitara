// Sinhronizacija između uređaja — glavna nit: prijava (Google), jedna kartica sinhronizuje (Web Locks, inače
// BroadcastChannel + zakup u localStorage), prilagodljivo osvežavanje, status, pitanja (masovno brisanje, drugi nalog),
// jednokratni prelazak sa stare rezervne kopije. Sam posao (mreža, gzip, baza) radi Web Worker (syncWorker.js).
// Učitava se tek kad je prvi ekran prikazan (requestIdleCallback) i samo ako je sinhronizacija uključena.
import { t, getLang, setLang } from './i18n.js';
import { settings, syncMeta, versions, events, notifyRemote, SYNCED_SETTING } from './db.js';
import { deviceNode } from './syncClock.js';
import { toast, dialog, esc } from './ui.js';

const CFG = 'syncCfg';
const LS = 'gitara-sync';
const lsGet = () => { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch { return null; } };
const lsSet = (v) => { try { localStorage.setItem(LS, JSON.stringify(v)); } catch {} };

const st = { on: false, email: '', status: 'off', last: 0, pending: 0, leader: false, quotaShown: false, migrating: false };
const listeners = new Set();
export const syncState = () => ({ ...st });
export function onSyncChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => { listeners.forEach((fn) => { try { fn(syncState()); } catch {} }); drawPill(); };

// v2.5.66: nov kanal i nova brava — stari kod (prozor otvoren pre ažuriranja) koristi „gitara-sync“ i ne meša se sa novim
const bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel('marli-sync-2') : null;
const tabId = Math.random().toString(36).slice(2);

// ---------------- Radnik (Worker ili glavna nit) ----------------
let port = null, waits = new Map(), seq = 0;
function startWorker() {
  if (port) return port;
  const onMsg = (m) => handle(m);
  try {
    const url = new URL('./syncWorker.js' + new URL(import.meta.url).search, import.meta.url);
    const w = new Worker(url, { type: 'module' });
    w.onmessage = (e) => onMsg(e.data);
    w.onerror = (e) => { e.preventDefault?.(); if (port && port.w === w) { port = null; w.terminate(); fallback(); } };
    port = { w, send: (m) => w.postMessage(m) };
  } catch { fallback(); }
  function fallback() {
    // bez module Worker-a: isti posao na glavnoj niti (u malim koracima, posle prvog ekrana)
    const p = import('./syncRunner.js').then(({ createRunner }) => createRunner((m) => setTimeout(() => onMsg(m))));
    port = { send: (m) => p.then((h) => h(m)) };
    port.send({ t: 'init', node: deviceNode() });
  }
  port.send({ t: 'init', node: deviceNode() });
  return port;
}
const call = (msg, reply) => new Promise((resolve) => { const id = 'c' + ++seq; waits.set(id, { resolve, reply }); startWorker().send({ ...msg, id }); });

async function handle(m) {
  if (m.t === 'needToken' && m.src === 'old') { // v2.5.66: poslednje preuzimanje sa stare veze — samo tiho
    let value = null;
    try { const O = await import('./oldAuth.js'); const tk = await O.oldTokenSilent('sync'); value = tk ? { token: tk, exp: Date.now() + 30 * 60000 } : null; } catch { value = null; }
    port && port.send({ t: 'token', id: m.id, value });
    return;
  }
  if (m.t === 'needToken') {
    let value = null;
    try {
      const p = (await import('./drive.js')).syncToken({ force: m.force, hint: st.email }); // uvek nalog sinhronizacije
      value = await Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('token timeout'), { code: 'timeout' })), 30000))]);
    }
    catch (e) { value = { offline: e && e.code === 'offline' }; if (!value.offline) { setStatus('connect'); logSync('token', e); } }
    port && port.send({ t: 'token', id: m.id, value });
    return;
  }
  if (m.t === 'ask') { const value = await ask(m.kind, m.info); port && port.send({ t: 'answer', id: m.id, value }); return; }
  if (m.t === 'status') { if (m.s === 'syncing') setStatus('syncing'); return; }
  if (m.t === 'applied') { applied(m.keys); bc && bc.postMessage({ t: 'applied', keys: m.keys }); return; }
  if (m.t === 'done') { done(m); return; }
  for (const [id, w] of waits) if (m.id === id && w.reply === m.t) { waits.delete(id); w.resolve(m); }
}

// ---------------- Status ----------------
function setStatus(s) {
  if (st.status === s && s !== 'synced') return;
  st.status = s;
  if (s === 'synced') st.last = Date.now();
  if (st.leader && bc) bc.postMessage({ t: 'status', s, last: st.last });
  emit();
}
/** v2.4.4: šta se dešava i šta da uradiš — običnim rečima (ispod stanja u Podešavanjima). */
export function statusHelp(s = st.status) {
  if (s === 'error' && st.rate) return t('sync.help.rate');
  return { offline: t('sync.help.offline'), connect: t('sync.help.connect'), newer: t('sync.help.newer'), quota: t('sync.help.quota'), error: t('sync.help.error') }[s] || '';
}
export function statusText(s = st.status) {
  return { synced: t('sync.synced'), syncing: t('sync.syncing'), offline: t('sync.offline'), connect: t('sync.connect'), newer: t('sync.newer'), quota: t('sync.quota'), error: t('sync.error'), off: '' }[s] || '';
}
let pill = null, pillHidden = '';
function drawPill() {
  // malo dugme samo kad korisnik može nešto da uradi; nikad ne zaklanja ekran i ne blokira
  const want = st.on && (st.status === 'connect' || st.status === 'newer' || (st.status === 'quota' && !st.quotaShown)) && pillHidden !== st.status ? st.status : '';
  if (!want) { pill?.remove(); pill = null; return; }
  if (!pill) { pill = document.createElement('div'); pill.className = 'sync-pill'; pill.setAttribute('role', 'status'); document.body.appendChild(pill); }
  const btn = want === 'connect' ? t('sync.connectBtn') : want === 'newer' ? t('sync.updateBtn') : '';
  pill.innerHTML = `<span>${esc(statusText(want))}</span>${btn ? `<button class="btn small primary" data-p="go">${esc(btn)}</button>` : ''}<button class="icon-btn" data-p="x" aria-label="${esc(t('common.close'))}">✕</button>`;
  pill.onclick = async (e) => {
    const a = e.target.closest('[data-p]')?.dataset.p;
    if (a === 'x') { pillHidden = want; if (want === 'quota') st.quotaShown = true; drawPill(); }
    if (a === 'go' && want === 'connect') reconnect().catch((err) => toast(err?.message || t('common.error'), 'error'));
    if (a === 'go' && want === 'newer') updateApp();
  };
}
async function updateApp() {
  try { const reg = await navigator.serviceWorker?.getRegistration(); await reg?.update(); if (reg?.waiting) { reg.waiting.postMessage('SKIP_WAITING'); return; } } catch {}
  location.reload();
}

// ---------------- Raspored (prilagodljivo osvežavanje) ----------------
let timer = 0, failures = 0, lastInput = Date.now(), lastRun = (() => { try { return Number(localStorage.getItem('marli-last-sync')) || 0; } catch { return 0; } })(); // v2.4.11: i posle ponovnog otvaranja (brzo osvežavanje ne pokreće nov krug odmah)
// v2.5.63: zajednički limit Google Drive-a (svi korisnici aplikacije) — provera na 2 min dok se koristi; kad nekoliko
// provera zaredom ne donese ništa, razmak raste do 10 min (svaka izmena ovde ili tamo ga vraća na 2 min). Izmene na ovom
// uređaju i dalje idu odmah (8–30 s, scheduleSoon); otvaranje aplikacije i „Proveri sada“ proveravaju odmah.
const ACTIVE = 120000, IDLE = 300000, MAXQ = 600000;
const GAP = 30000, SOON = 8000; // posle izmene: najranije 8 s, a između dva kruga najmanje 30 s (više izmena = jedno slanje)
const fresh = () => (globalThis.__marliTest || {}).syncFresh ?? 60000; // v2.5.63 (testovi mogu da skrate): brzo ponovno otvaranje / povratak — krug od pre manje od 1 min je i dalje svež
let rateHit = false, quiet = 0;
function delay() {
  const idle = Date.now() - lastInput > 120000;
  let d = idle ? IDLE : ACTIVE;
  if (quiet >= 3) d = Math.min(MAXQ, d * 2 ** Math.min(3, quiet - 2)); // 3 prazne provere zaredom → ređe
  if (navigator.connection && navigator.connection.saveData) d *= 3; // štednja podataka
  if (failures) d = Math.min(15 * 60000, 15000 * 2 ** (failures - 1)) * (0.5 + Math.random()); // greške: sve ređe, sa slučajnim pomakom
  return d;
}
function schedule(ms) {
  clearTimeout(timer);
  if (!st.on) return;
  if (!st.leader) return;
  if (document.hidden && ms == null) return; // sakrivena aplikacija: pauza (nastavlja se kad se vrati)
  timer = setTimeout(runNow, ms == null ? delay() : ms);
}
/** Izmena ili poruka sa druge kartice: pošalji uskoro, ali ne češće od jednom u 30 s. */
function scheduleSoon() { const T = globalThis.__marliTest || {}, soon = T.syncSoon ?? SOON, gap = T.syncGap ?? GAP; schedule(Math.max(soon, lastRun + gap - Date.now())); } // testovi mogu da skrate
function runNow() {
  clearTimeout(timer);
  if (!st.on || !st.leader) return;
  if (navigator.onLine === false) { setStatus('offline'); return; }
  // v2.4.11: Google je tražio pauzu (bilo koji deo aplikacije) — sačekaj je, pa tek onda šalji
  try { const left = Math.max(0, (JSON.parse(localStorage.getItem('marli-drive-cool') || 'null') || {}).until - Date.now() || 0); if (left > 0) { timer = setTimeout(runNow, left + 2000); return; } } catch {}
  lastRun = Date.now();
  try { localStorage.setItem('marli-last-sync', String(lastRun)); } catch {}
  startWorker().send({ t: 'sync' });
}
// v1.74.1: zašto sinhronizacija ne uspeva — u dijagnostiku (kratko, bez ključeva i sadržaja)
function logSync(what, e) { try { const L = JSON.parse(localStorage.getItem('gitara-diag') || '[]'); L.push({ t: Date.now(), k: 'sync', m: `${what}: ${(e && (e.code || e.name)) || ''} ${(e && (e.msg || e.message)) || ''}`.slice(0, 200) }); localStorage.setItem('gitara-diag', JSON.stringify(L.slice(-60))); } catch {} }
function done(m) {
  if (m.code === 'PAUSED') return;
  if (!m.ok) logSync('sync', m);
  syncMeta.pending().then((n) => { st.pending = n; emit(); }).catch(() => {});
  if (m.ok) {
    st.rate = false; import('./driveGate.js').then((G) => G.noteOk()).catch(() => {}); import('./devices.js').then((D) => D.beat()).catch(() => {}); // v2.4.4: ovaj uređaj u spisku „Uređaji“
    failures = 0;
    quiet = m.sent || m.pulled ? 0 : quiet + 1;
    setStatus(m.newer ? 'newer' : 'synced');
    if (firstRun) {
      // v1.74: posle prve sinhronizacije — ima li (novija) rezervna kopija na Drive-u. Ako sinhronizacija nije donela ništa,
      // prvo se nudi kopija (bez poruke „na nalogu još nema pesama“); poruka ostaje samo kad nema ni kopije.
      const arrived = new Set(firstRun);
      (async () => {
        if (!migrated && !st.migrating) await migrateOnce();
        const B = await import('./backups.js');
        if (!B.gotAnything(arrived) && !lastMigrated) { const r = await B.offerAfterConnect(arrived); if (r !== 'none') { firstRun = null; return; } }
        await firstSummary();
        if (B.gotAnything(arrived)) await B.offerAfterConnect(arrived);
      })().catch(() => {});
    }
    else if (!migrated && !st.migrating) migrateOnce();
  } else {
    if (m.code === 'OFFLINE') setStatus('offline');
    else if (m.code === 'AUTH') setStatus('connect');
    else if (m.code === 'QUOTA') setStatus('quota'); // Drive pun: sve ostaje ovde, status se pokaže jednom
    else setStatus(navigator.onLine === false ? 'offline' : 'error');
    if (m.code !== 'OFFLINE' && m.code !== 'PAUSED') { const e = `${m.code || ''} ${m.msg || ''}`.trim().slice(0, 120); if (e !== st.err) { st.err = e; import('./drive.js').then((d) => d.logAuth('sinhronizacija: greška', e)).catch(() => {}); } } // v1.99.2
    rateHit = /rate|busy|429/i.test(m.msg || ''); st.rate = rateHit; // v2.4.4: jasniji opis („Google je usporio“)
    if (rateHit) import('./driveGate.js').then((G) => G.noteRate()).catch(() => {}); // v2.4.11: i ostali pozadinski poslovi sačekaju
    failures = m.code === 'QUOTA' ? Math.max(failures + 1, 4) : rateHit ? Math.max(failures + 1, 3) : failures + 1; // v2.2: Google „uspori“ → prvi novi pokušaj tek posle ~1 min
  }
  schedule();
}

/** Izmena na ovom uređaju: pošalji uskoro (više izmena zaredom = jedno slanje). */
let pendT = 0;
function localChange(e) {
  if (e.remote || !st.on) return;
  if (e.type === 'settings-changed' && !SYNCED_SETTING(e.detail)) return; // podešavanja samo ovog uređaja (token, keš…)
  // v2.5.63: vreme sviranja (upisuje se svakog minuta dok je pesma otvorena) ide sa redovnom proverom, ne posebno slanje
  if (e.type === 'settings-changed' && e.detail === 'activity') { clearTimeout(pendT); pendT = setTimeout(() => syncMeta.pending().then((n) => { st.pending = n; emit(); }).catch(() => {}), 300); return; }
  quiet = 0;
  clearTimeout(pendT);
  pendT = setTimeout(() => syncMeta.pending().then((n) => { st.pending = n; emit(); }).catch(() => {}), 300);
  if (st.leader) { if (st.status !== 'connect') scheduleSoon(); }
  else bc && bc.postMessage({ t: 'dirty' });
  if (navigator.onLine === false) setStatus('offline');
}

// v1.68: prva sinhronizacija posle „Poveži“ — skuplja šta je stiglo, pa jedan kratak rezime
let firstRun = null, lastMigrated = 0;
async function firstSummary() {
  const k = firstRun; firstRun = null;
  const songsN = [...k].filter((x) => x.startsWith('song:')).length + lastMigrated, setsN = [...k].filter((x) => x.startsWith('set:')).length;
  lastMigrated = 0;
  const parts = [];
  if (songsN) parts.push(t('sw.gotSongs', { n: songsN }));
  if (setsN) parts.push(t('sw.gotSets', { n: setsN }));
  if (k.has('secret')) parts.push(t('sw.gotKey'));
  if ([...k].some((x) => x.startsWith('pref:') || x === 'practice' || x === 'skale' || x.startsWith('folder:'))) parts.push(t('sw.gotPrefs'));
  if (parts.length) {
    // ključ nije stigao i nema ga ni ovde: kratko uputstvo (stari ključ je i dalje u Google AI Studio)
    const noKey = !k.has('secret') && !(await settings.get('geminiKey', ''));
    await dialog({ title: t('sw.doneTitle'), body: t('sw.doneBody', { list: parts.join(', ') }) + (noKey ? ' ' + t('sw.noKey') : ''), buttons: [{ label: t('common.ok'), value: true, kind: 'primary' }] });
    return;
  }
  // ništa nije stiglo: na nalogu još nema podataka (drugi uređaj nema uključenu sinhronizaciju)
  const mine = (await (await import('./db.js')).songs.count().catch(() => 0));
  if (!mine) await dialog({ title: t('sw.emptyTitle'), body: t('sw.emptyBody', { email: st.email || '' }), buttons: [{ label: t('common.ok'), value: true, kind: 'primary' }] });
  else toast(t('sw.sentOnly'));
}

async function applied(keys) {
  if (firstRun) keys.forEach((x) => firstRun.add(x));
  notifyRemote(keys);
  // biblioteka je otvorena (ništa se ne kuca, nema dijaloga): odmah pokaži nove pesme, na istom mestu
  if (keys.some((k) => k.startsWith('song:') || k.startsWith('set:') || k.startsWith('folder:')) && /^#\/pesme(\?|$)/.test(location.hash)
    && !document.querySelector('.modal-backdrop') && !document.activeElement?.matches?.('input,textarea,[contenteditable]')) {
    const y = scrollY;
    dispatchEvent(new HashChangeEvent('hashchange'));
    setTimeout(() => scrollTo(0, y), 250);
  }
  if (keys.includes('pref:lang')) { const v = await settings.get('lang', null); if ((v === 'sr' || v === 'en') && v !== getLang()) setLang(v, { save: false }); }
}

// ---------------- Jedna kartica sinhronizuje ----------------
let releaseLock = null, leaseTimer = 0;
function becomeLeader() {
  if (st.leader) return;
  st.leader = true;
  startWorker();
  if (Date.now() - lastRun < fresh()) schedule(lastRun + fresh() - Date.now()); else runNow(); // v2.5.63: brzo ponovno otvaranje — krug je svež
}
/** v2.5.66: stara brava „gitara-sync“ se uzme i nikad ne pusti — stari kod (prozor otvoren pre ažuriranja) tako više
 *  ne može da sinhronizuje sa starom vezom dok je nova verzija otvorena. Vraća true kad je uzeta. */
let oldLockHeld = false;
export function holdOldLock(waitMs = 0) {
  if (oldLockHeld) return Promise.resolve(true);
  if (!(navigator.locks && navigator.locks.request)) {
    const K = 'gitara-sync-lead'; // stari zakup: stalno „moj“, pa stari prozor nikad ne postaje glavni
    const tick = () => { try { localStorage.setItem(K, JSON.stringify({ id: 'marli2-' + tabId, at: Date.now() + 60000 })); } catch {} };
    tick(); setInterval(tick, 2000); oldLockHeld = true; return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let done = false;
    navigator.locks.request('gitara-sync', () => { oldLockHeld = true; if (!done) { done = true; resolve(true); } return new Promise(() => {}); }).catch(() => {});
    if (waitMs >= 0) setTimeout(() => { if (!done) { done = true; resolve(oldLockHeld); } }, waitMs || 50);
  });
}
function electLeader() {
  holdOldLock(-1);
  if (navigator.locks && navigator.locks.request) {
    navigator.locks.request('marli-sync-2', () => new Promise((res) => { releaseLock = res; becomeLeader(); })).catch(() => {});
    return;
  }
  // bez Web Locks: zakup u localStorage (obnavlja se svake 3 s; ističe posle 8 s)
  const K = 'marli-sync-lead';
  const tick = () => {
    let cur = null; try { cur = JSON.parse(localStorage.getItem(K) || 'null'); } catch {}
    if (!cur || cur.id === tabId || Date.now() - cur.at > 8000) {
      try { localStorage.setItem(K, JSON.stringify({ id: tabId, at: Date.now() })); } catch {}
      setTimeout(() => { let c2 = null; try { c2 = JSON.parse(localStorage.getItem(K) || 'null'); } catch {} if (c2 && c2.id === tabId) becomeLeader(); }, 50);
    }
  };
  tick();
  leaseTimer = setInterval(tick, 3000);
  addEventListener('pagehide', () => { try { const c = JSON.parse(localStorage.getItem(K) || 'null'); if (c && c.id === tabId) localStorage.removeItem(K); } catch {} });
}
bc && (bc.onmessage = (e) => {
  const m = e.data || {};
  if (m.t === 'applied') applied(m.keys || []);
  else if (m.t === 'status' && !st.leader) { st.status = m.s; st.last = m.last || st.last; emit(); }
  else if (m.t === 'dirty' && st.leader) scheduleSoon();
  else if (m.t === 'cfg') loadCfg().then(() => { if (st.on && !started) begin(); emit(); });
  else if (m.t === 'syncNow' && st.leader) runNow();
});

// ---------------- Pitanja ----------------
async function ask(kind, info) {
  if (kind === 'massDeleteIn') {
    return !!(await dialog({ title: t('sync.massInTitle', { n: info.n }), body: t('sync.massInBody', { n: info.n, total: info.total }), dismissible: false,
      buttons: [{ label: t('sync.keepHere'), value: false }, { label: t('sync.deleteHere'), value: true, kind: 'danger' }] }));
  }
  if (kind === 'massDeleteOut') {
    return !!(await dialog({ title: t('sync.massOutTitle', { n: info.n }), body: t('sync.massOutBody', { n: info.n }), dismissible: false,
      buttons: [{ label: t('sync.restoreThem'), value: false }, { label: t('sync.deleteAll'), value: true, kind: 'danger' }] }));
  }
  return true;
}

// ---------------- Podešavanje ----------------
let migrated = false, started = false;
async function loadCfg() {
  const c = (await settings.get(CFG, null)) || lsGet() || {};
  st.on = !!c.on; st.email = c.email || ''; migrated = !!c.migrated;
  return c;
}
async function saveCfg(patch) {
  const c = { ...((await settings.get(CFG, null)) || {}), ...patch };
  await settings.set(CFG, c);
  lsSet({ on: !!c.on, id: c.id || '', email: c.email || '' }); // preživi i gubitak baze (pa se sve vrati sa Drive-a)
  bc && bc.postMessage({ t: 'cfg' });
  return c;
}

function begin() {
  if (started) return;
  started = true;
  events.addEventListener('songs-changed', localChange);
  events.addEventListener('settings-changed', localChange);
  let lastWake = 0;
  const wake = () => {
    if (document.hidden) return;
    if (!st.leader) { if (Date.now() - lastWake > 5000) { lastWake = Date.now(); bc && bc.postMessage({ t: 'syncNow' }); } return; }
    lastInput = Date.now(); quiet = 0; // povratak u aplikaciju = opet „aktivno“
    if (Date.now() - lastRun > fresh()) runNow(); else schedule(lastRun + fresh() - Date.now()); // v2.5.63: krug od pre < 1 min je svež
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); else wake(); });
  addEventListener('focus', wake);
  addEventListener('online', () => { failures = 0; runNow(); });
  addEventListener('offline', () => setStatus('offline'));
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true });
  // zamoli pregledač da ne briše podatke
  navigator.storage?.persist?.().catch(() => {});
  electLeader();
  syncMeta.pending().then((n) => { st.pending = n; emit(); }).catch(() => {});
}

/** Pokretanje pri otvaranju aplikacije (posle prvog ekrana). */
let initP = null;
export function initSync() { return initP || (initP = doInit()); }
async function doInit() {
  await cleanOwnEchoes();
  const c = await loadCfg();
  if (!c.on) { emit(); return; }
  if (!(await (await import('./migrate.js')).migrationDone())) { st.status = 'connect'; emit(); return; } // v2.5.66: prvo prelazak na novu vezu (ekran prelaska)
  setStatus(navigator.onLine === false ? 'offline' : 'syncing');
  begin();
  // v2.5.1: nove vrste podataka (akordi koje znam, „nisu duplikati“, slike učenika) — jednom dodati u slanje (seed dodaje samo ono čega nema)
  try { if (localStorage.getItem('marli-seed') !== '2.5.1') setTimeout(() => call({ t: 'seed' }, 'seeded').then(() => { try { localStorage.setItem('marli-seed', '2.5.1'); } catch {} syncNow(); }).catch(() => {}), 8000); } catch {}
  setTimeout(() => offerLongAccess().catch(() => {}), 6000);
}

/**
 * Jednom (telefon koji je već povezan pre pomoćnika): „Dozvoli“ jednom → posle toga ključ se obnavlja bez Google-ovog
 * prozora (bez belog bljeska). „Kasnije“ → ponovo najranije za 3 dana; do tada sve radi kao ranije.
 */
async function offerLongAccess() {
  const drive = await import('./drive.js');
  if (!st.on || !drive.tokenHelperOn() || (await drive.hasLongAccess()) || navigator.onLine === false || document.hidden) return;
  let last = 0; try { last = Number(localStorage.getItem('gitara-longask')) || 0; } catch {}
  if (Date.now() - last < 3 * 864e5) return;
  try { localStorage.setItem('gitara-longask', String(Date.now())); } catch {}
  const ok = await dialog({ title: t('sync.longTitle'), body: t('sync.longBody'), buttons: [{ label: t('common.later'), value: false }, { label: t('sync.longOk'), value: true, kind: 'primary' }] });
  if (!ok) return;
  try { await reconnect(); toast(t('sync.longDone')); } catch (e) { if (e && e.code !== 'cancelled') toast((e && e.message) || t('common.error'), 'error'); }
}

/**
 * Jednokratno (v1.53): lažne „Prethodne verzije — izmena sa drugog uređaja“ do v1.52. Drive javlja i slanja ovog
 * uređaja; kad je pesma u međuvremenu ponovo menjana, sopstveno ranije slanje je čuvano kao „sukob“. Briše se
 * samo kopija koju je napravio OVAJ uređaj, i to samo ako je i trenutna verzija pesme sa ovog uređaja (pravi sukob:
 * trenutna verzija je sa drugog uređaja — ta kopija ostaje).
 */
async function cleanOwnEchoes() {
  try {
    if (localStorage.getItem('gitara-echo-clean')) return;
    const node = deviceNode();
    const me = (h) => { const n = String(h || '').split(':').slice(2).join(':'); return !!node && (n === node || n.startsWith(node + '~')); };
    const metas = new Map((await syncMeta.all()).map((m) => [m.key, m]));
    for (const v of await versions.list()) {
      const m = metas.get(v.key);
      if (v.reason === 'conflict' && me(v.hlc) && m && m.hlc && me(m.hlc)) await versions.remove(v.n);
    }
    localStorage.setItem('gitara-echo-clean', '1');
  } catch {}
}

/** „Poveži Google nalog“: prijava, provera naloga, spajanje (nikad prepisivanje), prvo slanje. */
export async function connectSync({ pick = false, silent = false } = {}) {
  await call({ t: 'pause' }, 'paused');
  try { return await connectInner(pick, silent); }
  finally { startWorker().send({ t: 'resume' }); if (st.on && st.leader) setTimeout(runNow, 0); }
}
async function connectInner(pick, silent = false) {
  const drive = await import('./drive.js');
  const prev = { ...lsGet(), ...((await settings.get(CFG, null)) || {}) };
  let tk = null;
  if (!pick) { try { tk = await drive.syncTokenStored(); } catch {} } // već sačuvan ključ sa oba ovlašćenja: bez novog Google prozora (bez tihog Google zahteva — on bi preskočio „Dozvoli“ i dugotrajnu dozvolu)
  if ((!tk || !tk.token) && silent) return false; // v2.5.1: tiho prebacivanje — bez Google prozora
  if (!tk || !tk.token) tk = await drive.syncToken({ interactive: true, pick, hint: pick ? '' : prev.email || '' });
  startWorker().send({ t: 'setToken', token: tk.token, exp: tk.exp });
  const ab = await call({ t: 'about' }, 'about');
  if (ab.error || !ab.value || !ab.value.id) throw Object.assign(new Error(t(ab.error === 'OFFLINE' ? 'sync.offline' : 'sync.e.account')), { user: true });
  const acct = ab.value;
  if (silent && prev.id && prev.id !== acct.id) return false; // drugi nalog — pita se samo na dodir
  if (prev.id && prev.id !== acct.id) {
    // drugi Google nalog na ovom uređaju
    const pending = await syncMeta.pending();
    if (pending > 0) {
      const ok = await dialog({ title: t('sync.mergeTitle'), body: t('sync.mergeBody', { n: pending, old: prev.email || '?', now: acct.email }),
        buttons: [{ label: t('common.cancel'), value: false }, { label: t('sync.mergeYes'), value: true, kind: 'primary' }] });
      if (!ok) { await drive.syncSignOut().catch(() => {}); return false; }
      await call({ t: 'reset' }, 'wasReset');
    } else {
      const ok = await dialog({ title: t('sync.switchTitle'), body: t('sync.switchBody', { old: prev.email || '?', now: acct.email }),
        buttons: [{ label: t('common.cancel'), value: false }, { label: t('sync.switchYes'), value: true, kind: 'primary' }] });
      if (!ok) { await drive.syncSignOut().catch(() => {}); return false; }
      const { wipeForAccount } = await import('./syncLocal.js');
      await wipeForAccount();
      notifyRemote(['song:*', 'set:*', 'folder:*', 'practice', 'skale', 'activity', 'secret']);
      await call({ t: 'reset' }, 'wasReset');
    }
  }
  firstRun = new Set();
  await call({ t: 'seed' }, 'seeded'); // sve na ovom uređaju ide na nalog (spaja se sa onim što je već tamo)
  await saveCfg({ on: true, id: acct.id, email: acct.email, ...(prev.id && prev.id !== acct.id ? { migrated: false } : {}) });
  await loadCfg();
  st.status = 'syncing'; st.quotaShown = false; pillHidden = '';
  emit();
  if (!started) begin(); // prva sinhronizacija kreće posle „resume“
  if (!st.leader) bc && bc.postMessage({ t: 'syncNow' });
  return true;
}
/** Token je istekao i tiho osvežavanje nije uspelo: jedan dodir. */
export async function reconnect() {
  const drive = await import('./drive.js');
  const tk = await drive.syncToken({ interactive: true, hint: st.email });
  port && port.send({ t: 'setToken', token: tk.token, exp: tk.exp });
  pillHidden = '';
  setStatus('syncing');
  runNow();
}
/** Isključi sinhronizaciju na ovom uređaju (podaci ostaju i ovde i na Drive-u). */
export async function disconnectSync() {
  await saveCfg({ on: false });
  st.on = false; st.status = 'off';
  clearTimeout(timer);
  emit();
  (await import('./drive.js')).syncSignOut().catch(() => {});
}
export function syncNow() { if (st.leader) runNow(); else bc && bc.postMessage({ t: 'syncNow' }); }

// ---------------- Jednokratno: stara rezervna kopija (gitara-backup.json) ----------------
// Pesme i rezultati iz nje se spajaju (po ID-u i po sadržaju — bez duplikata); sama kopija ostaje netaknuta.
async function migrateOnce() {
  if (migrated || st.migrating || !st.leader) return;
  st.migrating = true;
  try {
    // jednom po nalogu (oznaka se sinhronizuje): drugi uređaj istog naloga ne spaja kopiju ponovo
    if (await settings.get('syncMigrated', false)) { await saveCfg({ migrated: true }); migrated = true; return; }
    const drive = await import('./drive.js');
    const backup = await drive.readOldBackup();
    if (backup) {
      const keep = ['folders', 'setlists', 'practice', 'skale', 'freeplayRecs'];
      const s = {};
      for (const k of keep) if (backup.settings && backup.settings[k] !== undefined) s[k] = backup.settings[k];
      const n = await drive.applyRestore({ ...backup, settings: s }, 'merge');
      lastMigrated = n || 0;
      if (n && !firstRun) toast(t('sync.migrated', { n }));
    }
    await settings.set('syncMigrated', true);
    await saveCfg({ migrated: true });
    migrated = true;
    schedule(1500);
  } catch (e) {
    // bez dozvole za stari fajl (ili ga nema): nema šta da se prenese; inače pokušava ponovo posle sledeće sinhronizacije
    if (e && (e.code === 'denied' || e.code === 'notfound')) { await saveCfg({ migrated: true }).catch(() => {}); migrated = true; }
  }
  finally { st.migrating = false; }
}

// ---------------- v2.5.66: prelazak na novu Google vezu (poziva migrate.js) ----------------
/** Poslednji krug sa STAROM vezom (tiho): pokupi izmene sa drugih uređaja koje još nisu stigle ovde. */
export async function migOldPull() {
  const O = await import('./oldAuth.js');
  const tk = await O.oldTokenSilent('sync');
  if (!tk) return { ok: false, code: 'NOTOKEN' };
  await call({ t: 'source', src: 'old', token: tk, exp: Date.now() + 30 * 60000 }, 'sourceSet');
  try { return (await call({ t: 'syncOnce' }, 'once')).value; }
  finally { await call({ t: 'source', src: 'new' }, 'sourceSet'); }
}
/** Posle prelaska (Podešavanja): samo preuzmi iz stare veze — ništa ne šalje tamo; preuzeto ide na novu vezu. */
export async function migImportOld() {
  const O = await import('./oldAuth.js');
  const tk = await O.oldTokenSilent('sync');
  if (!tk) return { ok: false, code: 'NOTOKEN' };
  await call({ t: 'source', src: 'old', token: tk, exp: Date.now() + 30 * 60000 }, 'sourceSet');
  try { return (await call({ t: 'importAll' }, 'imported')).value; }
  finally { await call({ t: 'source', src: 'new' }, 'sourceSet'); }
}
/** Sve stavke ovog uređaja → nova (prazna) fascikla, ista verzija. Jednom po uređaju (posle toga samo nastavak). */
export async function migRebase() { await call({ t: 'rebase' }, 'rebased'); }
/** Krugovi sa NOVOM vezom dok ništa ne čeka (najviše n). Vraća poslednji rezultat. */
export async function migUpload(tk, n = 6) {
  startWorker().send({ t: 'setToken', token: tk.token, exp: tk.exp });
  let r = null;
  for (let i = 0; i < n; i++) {
    r = (await call({ t: 'syncOnce' }, 'once')).value;
    if (!r || !r.ok) return r;
    if (!(await syncMeta.pending())) return r;
  }
  return r;
}
export async function migAbout(tk) { startWorker().send({ t: 'setToken', token: tk.token, exp: tk.exp }); const ab = await call({ t: 'about' }, 'about'); return ab.error ? null : ab.value; }
export async function migVerify() { return (await call({ t: 'verify' }, 'verified')).value; }
/** Posle uspešnog prelaska: sinhronizacija nastavlja normalno (nova veza). */
export async function migFinish(acct) {
  await saveCfg({ on: true, id: acct.id, email: acct.email });
  await loadCfg();
  st.status = 'synced'; st.last = Date.now(); emit();
  if (!started) begin();
}
