// Proba prelaska (2.5.68) za korisnika sa VIŠE UREĐAJA — nastavnik Mile: računar (Chrome, Edge, Safari), Android telefon,
// iPhone (Safari, bez Web Locks), stari tablet (spor procesor). Samo PRVI uređaj sme da traži „Prijavi se“; svi ostali
// prelaze sami (predaja), bez gubitka, bez duplikata, bez pokvarenih veza sa učenicima.
// Stara verzija (2.5.65, git worktree) pravi početno stanje nad starim projektom u simulatoru; isti podaci pregledača
// zatim otvaraju novu verziju (kao pravo ažuriranje). Svaki scenario kreće od istog sačuvanog stanja (sim.save/load).
//   node tests/sim/multidevice.mjs [--only orders,simul,tabs,late,offline,wrong,wiped,note,links] [--orders 24]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createSim, installSim } from './driveSim.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const ONLY = (arg('only', '') || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const MAX_ORDERS = Number(arg('orders', 24));
const SONGS = Number(arg('songs', 40)), STUDENTS = Number(arg('students', 3));
const NEW_ROOT = new URL('../../', import.meta.url).pathname;
const SCR = '/tmp/claude-0/-home-user/5acc3b3c-c7ec-5fc4-b0ba-484df35f0a2c/scratchpad/';
const OLD_ROOT = arg('old', SCR + 'old2565/');
const STATE = SCR + 'md-state/', BASE_STATE = SCR + 'md-base/';
rmSync(STATE, { recursive: true, force: true }); mkdirSync(STATE, { recursive: true });

const rd = (root, p, k) => (new RegExp(`${k}\\s*=\\s*'([^']*)'`).exec(readFileSync(join(root, p), 'utf8')) || [])[1];
const OLD = { client: rd(OLD_ROOT, 'src/drive.js', 'CLIENT_ID'), key: rd(OLD_ROOT, 'src/shareConfig.js', 'SHARE_API_KEY'), helper: rd(OLD_ROOT, 'src/shareConfig.js', 'TOKEN_HELPER') };
const NEW = { client: rd(NEW_ROOT, 'src/drive.js', 'CLIENT_ID'), key: rd(NEW_ROOT, 'src/shareConfig.js', 'SHARE_API_KEY'), helper: rd(NEW_ROOT, 'src/shareConfig.js', 'TOKEN_HELPER') };
const sim = createSim({
  projects: { OLD: { apis: ['drive', 'youtube'], userPerSec: 1000, unitsPerMin: 1e6 }, NEW: { apis: ['drive', 'youtube'], userPerSec: 10, unitsPerMin: 1e6 } },
  clients: { [OLD.client]: { project: 'OLD' }, [NEW.client]: { project: 'NEW' } },
  keys: { [OLD.key]: { project: 'OLD', apis: ['drive', 'youtube'] }, [NEW.key]: { project: 'NEW', apis: ['drive', 'youtube'] } },
  helpers: { [OLD.helper]: { client: OLD.client }, [NEW.helper]: { client: NEW.client } },
});

let ROOT = OLD_ROOT;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const srv = createServer((req, rsp) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = join(ROOT, p);
  if (!existsSync(f) || !statSync(f).isFile()) { rsp.writeHead(404); rsp.end(); return; }
  rsp.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); rsp.end(readFileSync(f));
});
await new Promise((r) => srv.listen(4521, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:4521/';
const browser = await chromium.launch();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- uređaji (iPhone/Safari: Chromium sa njihovim ekranom i oznakom; iPhone bez Web Locks — starija iOS verzija) ----
const UA = {
  desk: undefined,
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  phone: 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
  tab: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  student: 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  fam: undefined,
};
const VIEW = { desk: [1440, 900], edge: [1366, 768], safari: [1440, 900], phone: [412, 892], ios: [390, 844], tab: [800, 1280], student: [412, 892], fam: [1440, 900] };
const kindOf = (name) => name.replace(/\d+$/, '');
const devices = new Map();
const MILE = 'mile@x.test';
async function openDev(name, email, { tabs = 1, offline = false, noOldAuth = false } = {}) {
  let d = devices.get(name);
  if (!d) { d = { name, email, sim: sim.device({ accounts: [email] }) }; devices.set(name, d); }
  const k = kindOf(name), st = STATE + name + '.json';
  const ctx = await browser.newContext({ viewport: { width: VIEW[k][0], height: VIEW[k][1] }, userAgent: UA[k], serviceWorkers: 'block', ...(existsSync(st) ? { storageState: st } : {}) });
  await ctx.addInitScript(({ noLocks, off, noOld }) => {
    try { localStorage.setItem('gitara-tour', '1'); localStorage.setItem('gitara-upgraded', '9'); localStorage.setItem('marli-fs-off', 'test'); localStorage.setItem('marli-fb-url-test', 'https://feedback.test/exec'); } catch {}
    window.__marliTest = { ...(window.__marliTest || {}), noHints: true, authStuckMs: 3000, handoffPollMs: 1500, bgDelay: 500, ...(noOld ? { noOldAuth: true } : {}) };
    if (noLocks) { try { Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }); } catch {} }
    if (off) { window.__online = false; Object.defineProperty(Navigator.prototype, 'onLine', { get() { return !!window.__online; }, configurable: true }); } // telefon bez mreže (aplikacija se otvara iz keša)
  }, { noLocks: k === 'ios', off: offline, noOld: noOldAuth });
  await installSim(sim, ctx, d.sim, { initScript: true });
  d.events = d.events || [];
  await ctx.route('https://feedback.test/**', (r) => { try { const j = JSON.parse(r.request().postData() || '{}'); if (j.kind === 'event') d.events.push(j); } catch {} return r.fulfill({ status: 200, body: 'ok' }); });
  if (offline) sim.offline(true);
  const pages = [];
  for (let i = 0; i < tabs; i++) {
    const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(String(e).slice(0, 200)));
    if (k === 'tab') { const c = await ctx.newCDPSession(p); await c.send('Emulation.setCPUThrottlingRate', { rate: 4 }); }
    p.goto(BASE + '#/pesme').catch(() => {});
    pages.push(p);
  }
  await pages[0].waitForTimeout(1200);
  d.ctx = ctx; d.p = pages[0]; d.pages = pages; return d;
}
async function closeDev(d) { await d.ctx.storageState({ path: STATE + d.name + '.json', indexedDB: true }); await d.ctx.close(); d.ctx = null; }
const ev = (p, fn, a) => Promise.race([p.evaluate(fn, a), new Promise((_, rej) => setTimeout(() => rej(new Error('ISTEKLO')), 300000))]);
const mig = (p) => ev(p, async () => (await (await import('./src/db.js')).settings.get('mig', null)) || {});

// ======================= FAZA A: stara verzija (2.5.65) =======================
const t0 = Date.now();
log(`FAZA A — 2.5.65 · Mile: računar + Edge + Safari + Android + iPhone + stari tablet · ${SONGS} pesama · ${STUDENTS} učenika`);
sim.addUser(MILE); sim.addUser('ucenik@x.test'); sim.addUser('drugi@x.test');
const T = {};
{
  const d = await openDev('desk', MILE);
  const r = await ev(d.p, async ({ SONGS, STUDENTS }) => {
    const db = await import('./src/db.js'); const S = await import('./src/sync.js');
    for (let i = 0; i < SONGS; i++) await db.songs.save({ title: 'Pesma ' + i, artist: 'Bend', sections: [{ name: 'S', lines: [{ text: `stih ${i} `.repeat(8), chords: [{ chord: 'G', position: 0 }] }] }] });
    await db.settings.set('geminiKey', 'AIzaMileKey_0123456789abcdefghijklmnop');
    await S.connectSync();
    const tm = await import('./src/teach.js'); await tm.setTeacher({ on: true, name: 'Mile' });
    const photo = 'data:image/jpeg;base64,' + btoa(String.fromCharCode(...Array.from({ length: 60000 }, () => Math.random() * 256 | 0)));
    const ids = []; for (let i = 0; i < STUDENTS; i++) { const st = await tm.addStudent({ name: 'Učenik ' + i }); await tm.updateStudent(st.id, { photo }); ids.push(st.id); }
    const B = await import('./src/teachBox.js'); const P = await import('./src/plan.js'); const SS = await import('./src/shareService.js');
    const boxes = [];
    for (let i = 0; i < ids.length; i++) {
      boxes.push(await B.ensureBox(ids[i], { interactive: true })); await P.sendPlanLink(ids[i]);
      const s = await db.songs.save({ title: 'Za učenika ' + i, artist: 'Mile', sections: [{ name: 'S', lines: [{ text: 'la', chords: [{ chord: 'D', position: 0 }] }] }] });
      await B.boxPut(ids[i], [await B.inlineItem({ kind: 'song', name: s.title, share: { songs: [s] } })]);
    }
    const s0 = (await db.songs.list())[0]; await SS.publishOnly({ key: 'song:' + s0.id, kind: 'song', name: s0.title, songs: [await db.songs.get(s0.id)], what: 'song' });
    for (let i = 0; i < 20; i++) { S.syncNow(); await new Promise((r) => setTimeout(r, 1500)); if (!(await db.syncMeta.pending())) break; }
    return { ids, boxes, tid: (await tm.getTeacher()).id, songs: (await db.songs.list()).length };
  }, { SONGS, STUDENTS });
  Object.assign(T, r); await closeDev(d);
}
// ostali Mile-ovi uređaji: stara verzija, sinhronizacija sa istim nalogom (svaki ima svoju staru prijavu)
for (const name of ['edge', 'safari', 'phone', 'ios', 'tab']) {
  const d = await openDev(name, MILE);
  const n = await ev(d.p, async (want) => { const S = await import('./src/sync.js'); await S.connectSync(); const db = await import('./src/db.js'); for (let i = 0; i < 40 && (await db.songs.list()).length < want; i++) await new Promise((r) => setTimeout(r, 1000)); return (await db.songs.list()).length; }, T.songs);
  if (name === 'phone') await ev(d.p, async () => { const SS = await import('./src/shareService.js'); const db = await import('./src/db.js'); const s = (await db.songs.list()).find((x) => x.title === 'Pesma 5'); await SS.publishOnly({ key: 'song:' + s.id, kind: 'song', name: s.title, songs: [await db.songs.get(s.id)], what: 'song' }); }); // svoj deljeni link (po uređaju)
  log(`  ${name}: ${n}/${T.songs} pesama`);
  if (n < T.songs) { log('PRIPREMA NEISPRAVNA'); process.exit(2); }
  await closeDev(d);
}
// učenik (druga osoba): stara verzija, povezan sa nastavnikom
{
  const d = await openDev('student', 'ucenik@x.test');
  await ev(d.p, async ({ tid, sid, box }) => { const tm = await import('./src/teach.js'); const B = await import('./src/teachBox.js'); await tm.setMyTeacher({ name: 'Mile', tid, sid, box }); await B.checkBox({ force: true }); }, { tid: T.tid, sid: T.ids[0], box: T.boxes[0] });
  await closeDev(d);
}
const base = sim.save(); rmSync(BASE_STATE, { recursive: true, force: true }); cpSync(STATE, BASE_STATE, { recursive: true });
log(`FAZA A gotova za ${((Date.now() - t0) / 1000) | 0}s · ${T.songs} pesama · ${T.ids.length} učenika`);

// ======================= pomoćnici za fazu B =======================
const report = [], problems = [];
const problem = (sc, x) => { problems.push(`[${sc}] ${x}`); log('  PROBLEM:', x); };
function reset() { sim.load(base); rmSync(STATE, { recursive: true, force: true }); cpSync(BASE_STATE, STATE, { recursive: true }); devices.forEach((d) => { d.events = []; }); }
/** Uređaj otvori novu verziju i (ako treba) dodirne „Prijavi se“. Beleži: da li se video ekran, dodire, vreme, zahteve. */
async function switchDev(name, { tap = true, d = null, maxS = 120 } = {}) {
  ROOT = NEW_ROOT;
  const t1 = Date.now(), r0 = sim.stats.total;
  d = d || (await openDev(name, MILE));
  let gateSeen = false, taps = 0, heap = 0, m = {};
  for (let i = 0; i < maxS * 4; i++) {
    m = await mig(d.p).catch(() => ({}));
    if (m.done) break;
    const g = await d.p.evaluate(() => { const b = document.querySelector('#migGate [data-mg="go"]'); return { gate: !!document.getElementById('migGate'), btn: b ? b.textContent : '', heap: (performance.memory && performance.memory.usedJSHeapSize) || 0 }; }).catch(() => ({}));
    heap = Math.max(heap, g.heap || 0);
    if (g.gate) gateSeen = true;
    if (tap && g.btn && /Prijavi|Pokušaj|Izaberi/.test(g.btn)) { taps++; await d.p.click('#migGate [data-mg="go"]').catch(() => {}); await d.p.waitForTimeout(800); }
    await d.p.waitForTimeout(250);
  }
  return { d, ok: !!m.done, via: m.via || '', gateSeen, taps, ms: Date.now() - t1, req: sim.stats.total - r0, heapMB: Math.round(heap / 1e6) };
}
async function waitBg(d, s = 60) { for (let i = 0; i < s; i++) { const m = await mig(d.p).catch(() => ({})); if (m.linksDone && m.oldFiles && m.copyUp) return m; await d.p.waitForTimeout(1000); } return mig(d.p); }
async function stateOf(d) {
  return ev(d.p, async () => {
    const db = await import('./src/db.js'); const tm = await import('./src/teach.js'); const S = await import('./src/sync.js');
    for (let i = 0; i < 15; i++) { S.syncNow(); await new Promise((r) => setTimeout(r, 1000)); if (!(await db.syncMeta.pending())) break; }
    const songs = (await db.songs.list()).filter((s) => !s.demo).map((s) => s.title).sort(); // primer pesme (po uređaju) se ne broji
    return { songs, key: await db.settings.get('geminiKey', ''), students: (await tm.getStudents()).length, pend: await db.syncMeta.pending(), status: S.syncState ? S.syncState().status : '' };
  });
}
function dupKeys() {
  const by = {};
  // ISTA verzija stavke dvaput = duplikat (svaki uređaj piše svoj fajl za stavku koju je menjao — to je namerno; starije verzije čisti vlasnik)
  for (const f of sim.listFiles({ owner: MILE, project: 'NEW', appData: true })) { const k = f.appProperties && f.appProperties.k; if (!k || k === 'snapshot') continue; const h = String(f.appProperties.h || ''); by[k + '|' + h] = (by[k + '|' + h] || 0) + 1; } // ista verzija dvaput = pravi duplikat
  return Object.entries(by).filter(([, n]) => n > 1).map(([k]) => k);
}
const newNamed = (name) => sim.listFiles({ owner: MILE, project: 'NEW', appData: false }).filter((f) => f.name === name).length;
async function checkAll(sc, names, { links = true } = {}) {
  const sts = [];
  for (const n of names) { const d = await openDev(n, MILE); sts.push([n, await stateOf(d)]); await closeDev(d); }
  const ref = sts[0][1].songs;
  for (const [n, s] of sts) {
    if (JSON.stringify(s.songs) !== JSON.stringify(ref)) problem(sc, `${n}: pesme se razlikuju (${s.songs.length} vs ${ref.length}: +${s.songs.filter((x) => !ref.includes(x)).slice(0, 3)} −${ref.filter((x) => !s.songs.includes(x)).slice(0, 3)})`);
    if (s.songs.length < T.songs) problem(sc, `${n}: izgubljene pesme ${s.songs.length}/${T.songs}`);
    if (s.key !== 'AIzaMileKey_0123456789abcdefghijklmnop') problem(sc, `${n}: Gemini ključ`);
    if (s.students !== T.ids.length) problem(sc, `${n}: učenika ${s.students}/${T.ids.length}`);
    if (s.pend) problem(sc, `${n}: ${s.pend} čeka slanje`);
  }
  const dk = dupKeys(); if (dk.length) problem(sc, `duplikati na novoj vezi: ${dk.length} (${dk.slice(0, 3)})`);
  if (links) {
    const nb = newNamed('MARLI – za učenika.json'), np = newNamed('MARLI – plan.json');
    if (nb !== T.ids.length) problem(sc, `nova sandučad: ${nb} (treba ${T.ids.length} — po jedno)`);
    if (np !== T.ids.length) problem(sc, `novi planovi: ${np} (treba ${T.ids.length})`);
  }
  return sts;
}
function perms(a) { if (a.length <= 1) return [a]; const out = []; a.forEach((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).forEach((p) => out.push([x, ...p]))); return out; }
function summarize(sc, rs) {
  const s = rs.map((r) => `${r.name}:${r.via === 'auto' ? 'sam' : r.via || '?'}${r.gateSeen ? '(ekran)' : ''}${r.taps ? `·${r.taps}dod` : ''} ${(r.ms / 1000).toFixed(1)}s ${r.req}z${r.heapMB ? ` ${r.heapMB}MB` : ''}`).join(' | ');
  log(`${sc}: ${s}`); report.push({ sc, rs: rs.map(({ d, ...x }) => x) });
}
function expectOneTap(sc, rs) {
  rs.forEach((r, i) => {
    if (!r.ok) problem(sc, `${r.name}: prelazak nije završen`);
    if (i === 0 && r.via !== 'prijava') problem(sc, `${r.name} (prvi): očekivana prijava, dobijeno ${r.via}`);
    if (i > 0 && (r.via !== 'auto' || r.taps || r.gateSeen)) problem(sc, `${r.name}: nije prešao sam (via ${r.via}, dodira ${r.taps}, ekran ${r.gateSeen})`);
  });
}
async function eventsCheck(sc, names) {
  for (const n of names) { const e = (devices.get(n).events || []).find((x) => x.step === 'gotovo'); if (!e) problem(sc, `${n}: nema reda „gotovo“ u tabeli`); else if (!/(auto|prijava) · nalog [0-9a-f]{8}/.test(e.note || '')) problem(sc, `${n}: red „gotovo“ bez načina/naloga (${e.note})`); }
  const tags = new Set(names.map((n) => ((devices.get(n).events || []).find((x) => x.step === 'gotovo') || {}).note).filter(Boolean).map((x) => x.split(' · ')[1]));
  if (tags.size > 1) problem(sc, `različite oznake naloga za iste uređaje: ${[...tags]}`);
}

// ======================= 1+2) svi redosledi (svaki uređaj može biti prvi) =======================
if (want('orders')) {
  const ALL = perms(['desk', 'phone', 'tab', 'ios']).slice(0, MAX_ORDERS);
  for (const order of ALL) {
    reset(); const sc = 'redosled ' + order.join('→');
    const rs = [];
    for (const n of order) { const r = await switchDev(n); r.name = n; if (rs.length === 0) await waitBg(r.d); await closeDev(r.d); rs.push(r); }
    expectOneTap(sc, rs); summarize(sc, rs);
    if (order === ALL[0] || order[0] === 'tab') { await checkAll(sc, order); await eventsCheck(sc, order); }
    else { const dk = dupKeys(); if (dk.length) problem(sc, `duplikati: ${dk.length}`); const nb = newNamed('MARLI – za učenika.json'); if (nb !== T.ids.length) problem(sc, `nova sandučad: ${nb}`); }
  }
  // desktop pregledači (Edge, Safari) posle Chrome-a
  reset();
  { const sc = 'računar Chrome → Edge → Safari'; const rs = []; for (const n of ['desk', 'edge', 'safari']) { const r = await switchDev(n); r.name = n; if (!rs.length) await waitBg(r.d); await closeDev(r.d); rs.push(r); } expectOneTap(sc, rs); summarize(sc, rs); await checkAll(sc, ['desk', 'edge', 'safari']); await eventsCheck(sc, ['desk', 'edge', 'safari']); }
}

// ======================= 3) istovremeno: tri uređaja u istoj sekundi, pre predaje =======================
if (want('simul')) {
  reset(); const sc = 'istovremeno desk+phone+tab';
  ROOT = NEW_ROOT;
  const ds = await Promise.all(['desk', 'phone', 'tab'].map((n) => openDev(n, MILE)));
  const r0 = sim.stats.total;
  const rs = await Promise.all(ds.map((d, i) => switchDev(d.name, { d, tap: i === 0 }))); // samo računar dodirne „Prijavi se“
  rs.forEach((r, i) => { r.name = ds[i].name; });
  for (const r of rs) if (!r.ok) problem(sc, `${r.name}: nije završen`);
  if (rs[1].via !== 'auto' || rs[2].via !== 'auto' || rs[1].taps || rs[2].taps) problem(sc, `telefon/tablet nisu prešli sami: ${rs.map((r) => r.via + '/' + r.taps)}`);
  const snapOwners = new Set(sim.listFiles({ owner: MILE, project: 'NEW', appData: true }).filter((f) => f.appProperties && f.appProperties.k === 'snapshot').map((f) => f.appProperties.h.split(':').pop()));
  if (snapOwners.size > 1) problem(sc, `pun snimak je slalo ${snapOwners.size} uređaja (treba 1)`);
  await waitBg(rs[0].d); for (const d of ds) await closeDev(d);
  summarize(sc, rs); log(`  ukupno zahteva: ${sim.stats.total - r0} · snimak slao ${snapOwners.size} uređaj(a)`);
  await checkAll(sc, ['desk', 'phone', 'tab']);
}

// ======================= 4) više kartica na istom računaru =======================
if (want('tabs')) {
  reset(); const sc = '3 kartice na računaru';
  ROOT = NEW_ROOT;
  const d = await openDev('desk', MILE, { tabs: 3 });
  // korisnik dodirne „Prijavi se“ u kartici u kojoj se pojavi ekran (ostale kartice čekaju)
  const t1 = Date.now(), r0 = sim.stats.total; let taps = 0, gates = 0, done = false;
  for (let i = 0; i < 240 && !done; i++) {
    for (const p of d.pages) {
      const g = await p.evaluate(() => { const b = document.querySelector('#migGate [data-mg="go"]'); return { gate: !!document.getElementById('migGate'), btn: b ? b.textContent : '' }; }).catch(() => ({}));
      if (g.gate) gates = Math.max(gates, 1);
      if (g.btn && /Prijavi/.test(g.btn)) { taps++; await p.click('#migGate [data-mg="go"]').catch(() => {}); await p.waitForTimeout(800); }
    }
    done = !!(await mig(d.p).catch(() => ({}))).done; await d.p.waitForTimeout(500);
  }
  const shown = await Promise.all(d.pages.map((p) => p.evaluate(() => !!document.getElementById('migGate')).catch(() => false)));
  if (shown.filter(Boolean).length > 1) problem(sc, 'ekran „Prijavi se“ u više kartica odjednom');
  const r = { ok: done, via: (await mig(d.p)).via, gateSeen: !!gates, taps, ms: Date.now() - t1, req: sim.stats.total - r0 };
  if (taps !== 1) problem(sc, `dodira: ${taps} (treba 1)`);
  await d.p.waitForTimeout(4000);
  const st = await Promise.all(d.pages.map((p) => p.evaluate(async () => ({ gate: !!document.getElementById('migGate'), done: !!(((await (await import('./src/db.js')).settings.get('mig', null)) || {}).done) })).catch(() => ({ gate: null }))));
  if (st.some((x) => x.gate || !x.done)) problem(sc, `kartice posle prelaska: ${JSON.stringify(st)}`);
  const started = (d.events || []).filter((e) => e.step === 'gotovo').length;
  if (started !== 1) problem(sc, `„gotovo“ poslato ${started} puta (treba 1 — prelazi samo jedna kartica)`);
  r.name = 'desk×3'; summarize(sc, [r]);
  await waitBg(d); await closeDev(d);
  const dk = dupKeys(); if (dk.length) problem(sc, `duplikati: ${dk.length}`);
}

// ======================= 5) kasni uređaj: nedeljama na staroj verziji, sa svojim izmenama =======================
if (want('late')) {
  reset(); const sc = 'kasni Safari (stara verzija, 3 nedelje)';
  // Safari ostaje na 2.5.65 i menja „Pesma 3“ i dodaje svoju pesmu (stara veza)
  ROOT = OLD_ROOT;
  { const d = await openDev('safari', MILE); await ev(d.p, async () => { const db = await import('./src/db.js'); const s = (await db.songs.list()).find((x) => x.title === 'Pesma 3'); await db.songs.save({ ...s, artist: 'Safari starije' }); await db.songs.save({ title: 'Samo sa Safarija', artist: 'S', sections: [{ name: 'S', lines: [{ text: 's', chords: [] }] }] }); const S = await import('./src/sync.js'); for (let i = 0; i < 10; i++) { S.syncNow(); await new Promise((r) => setTimeout(r, 1200)); if (!(await db.syncMeta.pending())) break; } }); await closeDev(d); }
  await new Promise((r) => setTimeout(r, 1500));
  // računar pređe i zatim (novije) menja istu pesmu
  const r1 = await switchDev('desk'); r1.name = 'desk';
  await ev(r1.d.p, async () => { const db = await import('./src/db.js'); const s = (await db.songs.list()).find((x) => x.title === 'Pesma 3'); await db.songs.save({ ...s, artist: 'Računar novije' }); const S = await import('./src/sync.js'); for (let i = 0; i < 10; i++) { S.syncNow(); await new Promise((r) => setTimeout(r, 1000)); if (!(await db.syncMeta.pending())) break; } });
  await waitBg(r1.d); await closeDev(r1.d);
  // Safari ponovo menja (posle računara, na staroj vezi — ne vidi novu), pa tek posle 3 nedelje dobije novu verziju
  ROOT = OLD_ROOT;
  { const d = await openDev('safari', MILE); await ev(d.p, async () => { const db = await import('./src/db.js'); await db.songs.save({ title: 'Safari ponovo', artist: 'S', sections: [{ name: 'S', lines: [{ text: 's2', chords: [] }] }] }); }); await closeDev(d); }
  sim.advance(21 * 864e5);
  const r2 = await switchDev('safari'); r2.name = 'safari';
  // Safari nema dugotrajnu staru dozvolu (Google je daje samo prvom uređaju), a stari ključ je istekao → jedan dodir je
  // neizbežan; posle njega mora da ima dugotrajnu NOVU dozvolu (iz beleške), da ga Google više nikad ne pita
  const rt2 = await ev(r2.d.p, async () => !!(await (await import('./src/db.js')).settings.get('driveRT2', null)));
  if (!r2.ok || r2.taps !== 1) problem(sc, `Safari: očekivan tačno 1 dodir (via ${r2.via}, dodira ${r2.taps})`);
  if (!rt2) problem(sc, 'Safari posle prijave nema dugotrajnu dozvolu (pitaće ponovo za sat vremena)');
  await closeDev(r2.d); summarize(sc, [r1, r2]);
  const sts = await checkAll(sc, ['desk', 'safari'], { links: false });
  for (const [n, s] of sts) { for (const t of ['Samo sa Safarija', 'Safari ponovo']) if (!s.songs.includes(t)) problem(sc, `${n}: nema „${t}“ (izmena sa kasnog uređaja izgubljena)`); }
  const d = await openDev('desk', MILE);
  const a = await ev(d.p, async () => { const db = await import('./src/db.js'); return (await db.songs.list()).find((x) => x.title === 'Pesma 3').artist; });
  if (a !== 'Računar novije') problem(sc, `novija izmena pregažena starijom: „${a}“`);
  await closeDev(d);
}

// ======================= 2b) stvaran dan: stare kratke prijave istekle (samo računar ima dugotrajnu staru) =======================
if (want('stale')) {
  for (const order of [['phone', 'desk', 'tab', 'ios'], ['tab', 'phone', 'desk', 'ios'], ['desk', 'tab', 'phone', 'ios']]) {
    reset(); const sc = 'istekle prijave ' + order.join('→');
    sim.expireTokens((t) => t.client === OLD.client);
    const rs = [];
    for (const n of order) { const r = await switchDev(n); r.name = n; r.rt2 = await ev(r.d.p, async () => !!(await (await import('./src/db.js')).settings.get('driveRT2', null))); if (!rs.length) await waitBg(r.d); await closeDev(r.d); rs.push(r); }
    summarize(sc, rs);
    rs.forEach((r, i) => {
      if (!r.ok) problem(sc, `${r.name}: nije prešao`);
      if (r.taps > 1) problem(sc, `${r.name}: ${r.taps} dodira (najviše 1)`);
      if (i > 0 && r.name === 'desk' && r.via !== 'auto') problem(sc, 'računar (ima dugotrajnu staru dozvolu) nije prešao sam');
      if (!r.rt2) problem(sc, `${r.name}: nema dugotrajnu novu dozvolu`);
    });
    // sat kasnije: novi ključevi istekli — svi uređaji rade bez ijednog prozora
    sim.expireTokens((t) => t.client === NEW.client);
    for (const n of order) {
      const d = await openDev(n, MILE); const before = d.sim.log.length;
      const st = await stateOf(d);
      const pop = d.sim.log.slice(before).filter((x) => x.prompt !== 'none').length;
      if (st.status !== 'synced' || pop) problem(sc, `${n} sat kasnije: ${st.status}, prozora ${pop}`);
      await closeDev(d);
    }
    await checkAll(sc, order, { links: true });
  }
}

// ======================= 6) bez interneta pri otvaranju =======================
if (want('offline')) {
  reset(); const sc = 'telefon bez interneta';
  const r1 = await switchDev('desk'); r1.name = 'desk'; await waitBg(r1.d); await closeDev(r1.d);
  ROOT = NEW_ROOT;
  const d = await openDev('phone', MILE, { offline: true });
  await d.p.waitForTimeout(3000);
  const gateOff = await d.p.evaluate(() => !!document.getElementById('migGate'));
  if (gateOff) problem(sc, 'ekran prelaska prikazan bez interneta');
  sim.offline(false); await d.p.evaluate(() => { window.__online = true; dispatchEvent(new Event('online')); });
  const r2 = await switchDev('phone', { d, tap: false }); r2.name = 'phone'; await closeDev(d);
  expectOneTap(sc, [r1, r2]); summarize(sc, [r1, r2]);
}

// ======================= 7) drugi Google nalog (porodični računar) =======================
if (want('wrong')) {
  reset(); const sc = 'porodični računar, drugi nalog';
  const r1 = await switchDev('desk'); r1.name = 'desk'; await waitBg(r1.d); await closeDev(r1.d);
  ROOT = OLD_ROOT;
  { const d = await openDev('fam', 'drugi@x.test'); await ev(d.p, async () => { const db = await import('./src/db.js'); await db.songs.save({ title: 'Porodična pesma', artist: 'P', sections: [{ name: 'S', lines: [{ text: 'p', chords: [] }] }] }); await (await import('./src/sync.js')).connectSync(); await new Promise((r) => setTimeout(r, 4000)); }); await closeDev(d); }
  const r2 = await switchDev('fam', { tap: false, maxS: 15 }); r2.name = 'fam';
  if (r2.via === 'auto' || r2.ok) problem(sc, 'drugi nalog je prešao sam (ne sme)');
  if (!r2.gateSeen) problem(sc, 'drugi nalog: nema ekrana „Prijavi se“');
  await closeDev(r2.d);
  const mixed = sim.listFiles({ owner: 'drugi@x.test', project: 'NEW' }).length;
  if (mixed) problem(sc, `podaci drugog naloga na novoj vezi bez prijave: ${mixed}`);
  summarize(sc, [r1, r2]);
}

// ======================= 8) obrisana stara prijava (očišćen pregledač / iPhone) =======================
if (want('wiped')) {
  reset(); const sc = 'iPhone bez stare prijave';
  const r1 = await switchDev('desk'); r1.name = 'desk'; await waitBg(r1.d); await closeDev(r1.d);
  ROOT = NEW_ROOT;
  const d = await openDev('ios', MILE, { noOldAuth: true });
  const r2 = await switchDev('ios', { d }); r2.name = 'ios'; await closeDev(d);
  if (!r2.ok || r2.via !== 'prijava' || !r2.taps) problem(sc, `očekivana obična prijava (via ${r2.via}, dodira ${r2.taps})`);
  summarize(sc, [r1, r2]);
  await checkAll(sc, ['desk', 'ios'], { links: false });
}

// ======================= 9) predaja: pokvarena / tuđa / zastarela =======================
if (want('note')) {
  for (const [kind, mk] of [['pokvarena', () => '{"app":"marli","type":"hand'], ['bez dozvole', (j) => JSON.stringify({ ...j, rt: 'neispravno' })], ['tuđ nalog', (j) => JSON.stringify({ ...j, id: 'nekoDrugi' })], ['zastarela', (j) => JSON.stringify({ ...j, at: Date.now() - 100 * 864e5 })]]) {
    reset(); const sc = 'predaja ' + kind;
    const r1 = await switchDev('desk'); r1.name = 'desk'; await waitBg(r1.d);
    const f = sim.listFiles({ owner: MILE, project: 'OLD', appData: true, name: 'marli-predaja.json' })[0];
    if (!f) { problem(sc, 'nema predaje posle prvog uređaja'); await closeDev(r1.d); continue; }
    await closeDev(r1.d);
    let cur = {}; try { cur = JSON.parse(sim.content(f.id)); } catch {}
    sim.setContent(f.id, mk(cur)); // ista beleška, pokvarena / izmenjena
    const r2 = await switchDev('phone'); r2.name = 'phone'; await closeDev(r2.d);
    if (!r2.ok) problem(sc, 'telefon nije prešao');
    if (r2.via !== 'prijava' || !r2.taps) problem(sc, `loša beleška je prihvaćena (via ${r2.via}) — treba obična prijava`);
    summarize(sc, [r1, r2]);
  }
}

// ======================= 11) veze sa učenikom: učenik prelazi posle, nastavnik šalje sa bilo kog uređaja =======================
if (want('links')) {
  reset(); const sc = 'učenik posle tableta i telefona';
  for (const n of ['tab', 'phone', 'desk']) { const r = await switchDev(n); r.name = n; if (n === 'tab') await waitBg(r.d, 120); await closeDev(r.d); }
  const nb = newNamed('MARLI – za učenika.json'); if (nb !== T.ids.length) problem(sc, `nova sandučad: ${nb}`);
  // nastavnik pošalje novu pesmu sa telefona (ne sa uređaja koji je selio veze)
  { const d = await openDev('phone', MILE); await ev(d.p, async (sid) => { const B = await import('./src/teachBox.js'); const db = await import('./src/db.js'); const s = await db.songs.save({ title: 'Posle prelaska', artist: 'Mile', sections: [{ name: 'S', lines: [{ text: 'n', chords: [] }] }] }); await B.boxPut(sid, [await B.inlineItem({ kind: 'song', name: s.title, share: { songs: [s] } })]); for (let i = 0; i < 30 && (await B.pendingCount()); i++) { await B.flushOutbox(); await new Promise((r) => setTimeout(r, 1500)); } }, T.ids[0]); await closeDev(d); }
  ROOT = NEW_ROOT;
  const ds = await openDev('student', 'ucenik@x.test');
  const rs = await switchDev('student', { d: ds });
  const got = await ev(ds.p, async () => { const B = await import('./src/teachBox.js'); await B.checkBox({ force: true }); const db = await import('./src/db.js'); return (await db.songs.list()).map((s) => s.title); });
  if (!got.includes('Posle prelaska')) problem(sc, 'učenik ne dobija pesmu poslatu posle prelaska');
  if (!got.includes('Za učenika 0')) problem(sc, 'učenik izgubio staru pesmu od nastavnika');
  await closeDev(ds); rs.name = 'student'; summarize(sc, [rs]);
}

log(`PROBLEMA: ${problems.length}`); problems.forEach((p) => log('  ' + p));
console.log(JSON.stringify({ report, problems }).slice(0, 6000));
await browser.close(); srv.close();
process.exit(problems.length ? 1 : 0);
