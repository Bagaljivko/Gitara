// Proba prelaska na novu Google vezu (2.5.66) — najrizičniji slučaj: nastavnik sa mnogo učenika.
// Pravo „pre“: stara verzija aplikacije (2.5.65, iz git worktree-a) radi nad starim projektom u simulatoru; zatim isti
// pregledački podaci (ista adresa = isti IndexedDB) otvaraju 2.5.66 — kao pravo ažuriranje. Bez pravih korisnika.
//   node tests/sim/dryrun.mjs [--n 52] [--songs 1000] [--old <putanja do 2.5.65>] [--only teacher,…]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createSim, installSim } from './driveSim.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const N0 = Number(arg('n', 52)), SONGS = Number(arg('songs', 1000)), SUP = Number(arg('sup', 3));
const N = N0 + SUP; // + dečji (nadzirani) nalozi: čeka odobrenje (prozor se ne javi), roditelj odbio, odobreno kasnije
const SUP_MODE = ['hang', 'deny', 'later'];
const NEW_ROOT = new URL('../../', import.meta.url).pathname;
const OLD_ROOT = arg('old', '/tmp/claude-0/-home-user/5acc3b3c-c7ec-5fc4-b0ba-484df35f0a2c/scratchpad/old2565/');
const STATE = '/tmp/claude-0/-home-user/5acc3b3c-c7ec-5fc4-b0ba-484df35f0a2c/scratchpad/dry-state/';
rmSync(STATE, { recursive: true, force: true }); mkdirSync(STATE, { recursive: true });

// ---- isti ID-jevi kao u aplikaciji ----
const rd = (root, p, k) => (new RegExp(`${k}\\s*=\\s*'([^']*)'`).exec(readFileSync(join(root, p), 'utf8')) || [])[1];
const OLD = { client: rd(OLD_ROOT, 'src/drive.js', 'CLIENT_ID'), key: rd(OLD_ROOT, 'src/shareConfig.js', 'SHARE_API_KEY'), helper: rd(OLD_ROOT, 'src/shareConfig.js', 'TOKEN_HELPER') };
const NEW = { client: rd(NEW_ROOT, 'src/drive.js', 'CLIENT_ID'), key: rd(NEW_ROOT, 'src/shareConfig.js', 'SHARE_API_KEY'), helper: rd(NEW_ROOT, 'src/shareConfig.js', 'TOKEN_HELPER') };
if (OLD.client === NEW.client) throw new Error('stari i novi klijent su isti — proveri putanje');
const sim = createSim({
  projects: { OLD: { apis: ['drive', 'youtube'], userPerSec: 10, unitsPerMin: 1e6 }, NEW: { apis: ['drive', 'youtube'], userPerSec: 10, unitsPerMin: 1e6 } },
  clients: { [OLD.client]: { project: 'OLD' }, [NEW.client]: { project: 'NEW' } },
  keys: { [OLD.key]: { project: 'OLD', apis: ['drive', 'youtube'] }, [NEW.key]: { project: 'NEW', apis: ['drive', 'youtube'] } },
  helpers: { [OLD.helper]: { client: OLD.client }, [NEW.helper]: { client: NEW.client } },
  refreshOnEveryCode: true,
});

// ---- jedna adresa, koren se menja (= ažuriranje) ----
let ROOT = OLD_ROOT;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.pdf': 'application/pdf' };
const srv = createServer((req, rsp) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = join(ROOT, p);
  if (!existsSync(f) || !statSync(f).isFile()) { rsp.writeHead(404); rsp.end(); return; }
  rsp.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); rsp.end(readFileSync(f));
});
await new Promise((r) => srv.listen(4517, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:4517/';
const browser = await chromium.launch();

// ---- uređaji ----
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const devices = new Map();
async function openDev(name, email, { phone = true } = {}) {
  let d = devices.get(name);
  if (!d) { d = { name, email, sim: sim.device({ accounts: [email] }), state: null }; devices.set(name, d); }
  const ctx = await browser.newContext({ viewport: phone ? { width: 412, height: 892 } : { width: 1440, height: 900 }, serviceWorkers: 'block', ...(d.state ? { storageState: d.state } : {}) });
  await ctx.addInitScript(() => { try { localStorage.setItem('gitara-tour', '1'); localStorage.setItem('gitara-upgraded', '9'); localStorage.setItem('marli-fs-off', 'test'); } catch {} window.__marliTest = { ...(window.__marliTest || {}), noHints: true, authStuckMs: 3000 }; });
  await installSim(sim, ctx, d.sim, { initScript: true });
  const p = await ctx.newPage();
  p.errs = []; p.on('pageerror', (e) => p.errs.push(String(e).slice(0, 300)));
  if (process.env.DBG) p.on('console', (m) => log('   [' + name + ']', m.text().slice(0, 200)));
  await p.goto(BASE + '#/pesme'); await p.waitForTimeout(1200);
  d.ctx = ctx; d.p = p; return d;
}
async function closeDev(d) { d.state = STATE + d.name + '.json'; await d.ctx.storageState({ path: d.state, indexedDB: true }); await d.ctx.close(); d.ctx = null; d.p = null; }
const ev = (d, fn, a) => Promise.race([d.p.evaluate(fn, a), new Promise((_, rej) => setTimeout(() => rej(new Error('ISTEKLO ' + d.name + ' · poslednji Google koraci: ' + JSON.stringify((d.sim.log || []).slice(-4)))), Number(process.env.EVMS || 600000)))]);

// ======================= FAZA A: stara verzija (2.5.65) nad starim projektom =======================
const T = { name: 'teacher', email: 'mile@x.test' };
const kids = Array.from({ length: N }, (_, i) => ({ name: 'kid' + i, email: `ucenik${i}@x.test`, i }));
sim.addUser(T.email); kids.forEach((k) => sim.addUser(k.email));
const grp = (i) => (i >= N0 ? 'dete' : i < Math.round(N0 * 0.3) ? 'pre' : i < Math.round(N0 * 0.6) ? 'posle' : i < Math.round(N0 * 0.7) ? 'offline' : i < Math.round(N0 * 0.8) ? 'stara' : i < Math.round(N0 * 0.9) ? 'dva' : 'isto');
const t0 = Date.now();
sim.projects.OLD.userPerSec = 1000; // priprema nije ono što se proverava — bez ograničenja; u fazi B opet strogo
log(`FAZA A — stara verzija 2.5.65 · nastavnik + ${N} učenika · ${SONGS} pesama`);
{
  const d = await openDev(T.name, T.email, { phone: false });
  const r = await ev(d, async ({ N, SONGS }) => {
    const db = await import('./src/db.js'); const S = await import('./src/sync.js');
    for (let i = 0; i < SONGS; i++) await db.songs.save({ title: 'Pesma ' + i, artist: 'Bend ' + (i % 40), sections: [{ name: 'Strofa', lines: [{ text: `stih pesme ${i} `.repeat(8), chords: [{ chord: 'G', position: 0 }, { chord: 'C', position: 12 }] }] }] });
    await db.settings.set('geminiKey', 'AIzaGeminiTeacherKey_0123456789abcdefghij');
    await db.settings.set('practice', { v: 1, games: { pauk: { best: 91, plays: 40 } }, songs: {} });
    console.log('pesme gotove'); await S.connectSync(); console.log('sync povezan');
    const tm = await import('./src/teach.js'); await tm.setTeacher({ on: true, name: 'Mile' });
    const photo = 'data:image/jpeg;base64,' + btoa(String.fromCharCode(...Array.from({ length: 45000 }, () => Math.random() * 256 | 0)));
    const ids = [];
    for (let i = 0; i < N; i++) { const st = await tm.addStudent({ name: 'Učenik ' + i }); await tm.updateStudent(st.id, { photo, tasks: [{ id: 't' + i, kind: 'game', game: 'pauk' }] }); ids.push(st.id); }
    return { ids, tid: (await tm.getTeacher()).id };
  }, { N, SONGS });
  T.tid = r.tid; kids.forEach((k, i) => (k.sid = r.ids[i]));
  // sanduče, plan, pesme, glasovni komentar za svakog učenika (staro: putData starim klijentom)
  for (const k of kids) {
    k.box = await ev(d, async ({ sid, i }) => {
      const B = await import('./src/teachBox.js'); const P = await import('./src/plan.js'); const S = await import('./src/shareService.js'); const db = await import('./src/db.js');
      console.log('box…'); const box = await B.ensureBox(sid, { interactive: true });
      console.log('plan…'); await P.sendPlanLink(sid); console.log('pesma…');
      const songs = [await db.songs.save({ title: 'Za učenika ' + i, artist: 'Mile', sections: [{ name: 'S', lines: [{ text: 'la la', chords: [{ chord: 'D', position: 0 }] }] }] })];
      const it = await B.inlineItem({ kind: 'song', name: songs[0].title, share: { songs } }); await B.boxPut(sid, [it]);
      const voice = await S.putData('', JSON.stringify({ app: 'marli', type: 'voice', v: 1, mime: 'audio/webm', data: btoa('glas-' + i) }), { name: 'MARLI – glasovni komentar.json' });
      const rec = await db.songs.save({ title: 'Snimak učenika ' + i, artist: '', student: sid, src: 'rec' + i + ':0', sections: [{ name: 'S', lines: [{ text: 'x', chords: [] }] }], cmts: [{ id: 'c' + i, at: Date.now(), text: 'bravo', voice, key: 'cmt:c' + i }] });
      await B.boxPut(sid, [{ key: 'cmt:c' + i, kind: 'cmt', id: 'c' + i, f: 'rec' + i, text: 'bravo', voice, name: rec.title }]);
      return box;
    }, { sid: k.sid, i: k.i });
  }
  // podeljena set lista (stari link)
  T.share = await ev(d, async () => { const S = await import('./src/shareService.js'); const db = await import('./src/db.js'); const s = (await db.songs.list())[0]; const r = await S.publishOnly({ key: 'song:' + s.id, kind: 'song', name: s.title, songs: [await db.songs.get(s.id)], what: 'song' }); return r && (r.fileId || r); });
  // sinhronizacija do kraja
  await ev(d, async () => { const S = await import('./src/sync.js'); for (let i = 0; i < 20; i++) { S.syncNow(); await new Promise((r) => setTimeout(r, 1500)); if (!(await (await import('./src/db.js')).syncMeta.pending())) break; } });
  T.errsA = d.p.errs.slice(); await closeDev(d);
  log(`  nastavnik spreman (${((Date.now() - t0) / 1000) | 0}s) · deljeno: ${JSON.stringify(T.share).slice(0, 60)}`);
}
for (const k of kids) {
  const d = await openDev(k.name, k.email);
  const r = await ev(d, async ({ k, tid }) => {
    const tm = await import('./src/teach.js'); const db = await import('./src/db.js'); const P = await import('./src/progress.js'); const B = await import('./src/teachBox.js');
    const mySong = await db.songs.save({ title: 'Moj snimak ' + k.i, artist: 'Ja', sections: [{ name: 'S', lines: [{ text: 'snimak', chords: [] }] }] });
    await tm.setMyTeacher({ name: 'Mile', tid, sid: k.sid, box: k.box, recF: { ['rec' + k.i]: mySong.id } }); // snimak koji je učenik poslao (nastavnik ga komentariše)
    if (!k.sync && k.tok) await db.settings.set('driveToken', { t: k.tok, exp: Date.now() + 3500e3, s: 1, f: 1 }); // prijava samo za fajlove (kao „Poveži“ dugme)
    console.log('checkBox…'); await B.checkBox({ force: true }); console.log('pesme…');
    await db.settings.set('geminiKey', 'AIzaStudentKey_' + k.i + '_abcdefghijklmnopqrstuv');
    for (let j = 0; j < 8; j++) await db.songs.save({ title: `Moja ${k.i}-${j}`, artist: 'Ja', sections: [{ name: 'S', lines: [{ text: 'tekst', chords: [{ chord: 'Am', position: 0 }] }] }] });
    if (k.sync) { const S = await import('./src/sync.js'); await S.connectSync(); }
    const m = await tm.getMyTeacher(); await tm.setMyTeacher({ ...m, prog: { on: true } });
    console.log('napredak…'); const f = await P.syncProgress({ force: true, interactive: true }); console.log('proveri…', f);
    // „proveri sa nastavnikom“ (deljeni fajl) u odlaznom
    const S2 = await import('./src/shareService.js'); const s = (await db.songs.list()).find((x) => x.title.startsWith('Moja'));
    const sh = await S2.publishOnly({ key: 'song:' + s.id, kind: 'song', name: s.title, songs: [await db.songs.get(s.id)], what: 'song' });
    const m2 = await tm.getMyTeacher(); await tm.setMyTeacher({ ...m2, out: [...(m2.out || []), { id: 'chk' + k.i, type: 'check', f: sh && (sh.fileId || sh), title: s.title, at: Date.now() }] });
    console.log('napredak 2…'); await P.syncProgress({ force: true, interactive: true }); console.log('gotovo');
    const got = (await db.songs.list()).filter((x) => x.title.startsWith('Za učenika')).length;
    return { prog: f, got, plan: !!(await tm.getMyTeacher()).planFile };
  }, { k: { ...k, tok: sim.issueToken(k.email, 'OLD', 'drive.file').access_token, sync: ['pre', 'posle', 'dva', 'isto'].includes(grp(k.i)) && k.i % 2 === 0 }, tid: T.tid });
  k.prog = r.prog; k.gotA = r.got; k.planA = r.plan; k.sync = ['pre', 'posle', 'dva', 'isto'].includes(grp(k.i)) && k.i % 2 === 0; k.errsA = d.p.errs.slice();
  await closeDev(d);
}
// nastavnik upiše id-jeve fajlova napretka (kao posle skeniranja QR-a) i pročita ih jednom
{
  const d = await openDev(T.name, T.email, { phone: false });
  await ev(d, async (list) => { const tm = await import('./src/teach.js'); const P = await import('./src/progress.js'); for (const k of list) { await tm.updateStudent(k.sid, { prog: { on: true, fileId: k.prog } }); await P.studentProgress(await tm.getStudent(k.sid), { fresh: true }); } }, kids.map((k) => ({ sid: k.sid, prog: k.prog })));
  await closeDev(d);
}
// drugi uređaj učenika (grupa „dva“): ista prijava, sinhronizacija, pa izmena koja ostaje na STAROJ vezi
for (const k of kids.filter((x) => grp(x.i) === 'dva' && x.sync)) {
  const d = await openDev(k.name + 'b', k.email);
  await ev(d, async () => { const S = await import('./src/sync.js'); await S.connectSync(); await new Promise((r) => setTimeout(r, 4000)); const db = await import('./src/db.js'); await db.songs.save({ title: 'Sa drugog uređaja', artist: 'B', sections: [{ name: 'S', lines: [{ text: 'b', chords: [] }] }] }); S.syncNow(); await new Promise((r) => setTimeout(r, 4000)); });
  await closeDev(d);
}
sim.projects.OLD.userPerSec = 10;
const preA = { files: sim.listFiles({ project: 'OLD' }).length, req: sim.stats.total };
log(`FAZA A gotova za ${((Date.now() - t0) / 1000) | 0}s · stari projekat: ${preA.files} fajlova · ${preA.req} zahteva · greške u stranicama: nastavnik ${T.errsA.length}, učenici ${kids.reduce((a, k) => a + k.errsA.length, 0)}`);
if (T.errsA.length) log('  ', T.errsA.slice(0, 3));
const badA = kids.filter((k) => !k.gotA || !k.planA || !k.prog);
if (badA.length) log('  UPOZORENJE: priprema nepotpuna za', badA.map((k) => `${k.name}(pesma ${k.gotA},plan ${k.planA},napredak ${!!k.prog})`).slice(0, 5));
if (badA.length && !process.env.ANYWAY) { log('PRIPREMA NEISPRAVNA — proba se prekida'); process.exit(2); }

// ======================= FAZA B: ažuriranje na 2.5.66 =======================
ROOT = NEW_ROOT;
sim.resetStats();
const report = { problems: [], timings: {} };
const problem = (x) => { report.problems.push(x); log('  PROBLEM:', x); };
async function migrate(d, { expect = 'done', script = [] } = {}) {
  for (const s of script) d.sim.next(s);
  const t1 = Date.now(); const before = sim.stats.total;
  const shown = await d.p.waitForSelector('#migGate', { timeout: 15000 }).then(() => true).catch(() => false);
  if (!shown) return { shown: false };
  for (let i = 0; i < 120; i++) {
    const st = await ev(d, async () => ({ gate: !!document.getElementById('migGate'), h: document.querySelector('#migGate h1')?.textContent || '', btn: !!document.querySelector('#migGate [data-mg="go"]'), m: await (await import('./src/db.js')).settings.get('mig', null) }));
    if (!st.gate && st.m && st.m.done) return { shown: true, ok: true, ms: Date.now() - t1, req: sim.stats.total - before, m: st.m };
    if (st.btn && /Prijavi|Potvrdi|Prebaci|Pokušaj|Izaberi|odobrio/.test(await ev(d, () => document.querySelector('#migGate [data-mg="go"]')?.textContent || ''))) {
      if (expect === 'stop-at' + st.h) return { shown: true, ok: false, at: st.h };
      await d.p.click('#migGate [data-mg="go"]').catch(() => {});
    }
    await d.p.waitForTimeout(700);
  }
  return { shown: true, ok: false, ms: Date.now() - t1, at: await ev(d, () => document.querySelector('#migGate h1')?.textContent || '') };
}
// dečji nalog: Google ne izdaje ključ dok roditelj ne odobri — „odbijeno“ (access_denied) ili prozor koji se ne javi
const KID_T = 'Zamoli roditelja da odobri prijavu';
const gateH = (d) => ev(d, () => document.querySelector('#migGate h1')?.textContent || '');
async function tapGo(d) { await d.p.click('#migGate [data-mg="go"]').catch(() => {}); }
async function comeBack(d) { await d.p.waitForTimeout(300); await ev(d, () => { dispatchEvent(new Event('blur')); dispatchEvent(new Event('focus')); }); } // vratio se iz Google prozora
async function supervised(k) {
  const mode = SUP_MODE[(k.i - N0) % SUP_MODE.length]; const out = { who: k.name, grp: 'dete', mode };
  const d = await openDev(k.name, k.email);
  d.sim.default = mode === 'hang' ? 'hang' : 'deny';
  const shown = await d.p.waitForSelector('#migGate', { timeout: 15000 }).then(() => true).catch(() => false);
  if (!shown) { problem(`${k.name}: ekran prelaska se ne pojavljuje`); await closeDev(d); return out; }
  for (let i = 0; i < 40 && (await gateH(d)) !== KID_T; i++) { if (await ev(d, () => !!document.querySelector('#migGate [data-mg="go"]'))) { await tapGo(d); if (mode === 'hang') await comeBack(d); } await d.p.waitForTimeout(mode === 'hang' ? 3800 : 700); }
  out.kidScreen = (await gateH(d)) === KID_T;
  if (!out.kidScreen) problem(`${k.name} (${mode}): nema dečjeg ekrana — „${await gateH(d)}“`);
  // „Nastavi dok čekaš“: aplikacija radi, pesme i nastavnik ostaju
  await d.p.click('#migGate [data-mg="alt"]').catch(() => {}); await d.p.waitForTimeout(800);
  out.gateGone = !(await ev(d, () => !!document.getElementById('migGate')));
  out.wait = await ev(d, async (i) => { const db = await import('./src/db.js'); const B = await import('./src/teachBox.js'); await B.checkBox({ force: true }).catch((e) => String(e)); const s = await db.songs.list(); return { mine: s.filter((x) => x.title.startsWith('Moja ')).length, fromTeacher: s.some((x) => x.title === 'Za učenika ' + i), key: await db.settings.get('geminiKey', ''), teacher: !!(await (await import('./src/teach.js')).getMyTeacher()) }; }, k.i);
  if (!out.gateGone) problem(`${k.name}: „Nastavi dok čekaš“ ne zatvara ekran`);
  if (out.wait.mine !== 8 || !out.wait.fromTeacher || !out.wait.key || !out.wait.teacher) problem(`${k.name} dok čeka: ${JSON.stringify(out.wait)}`);
  await closeDev(d);
  // ponovo otvori (još nije odobreno): odmah dečji ekran, ne opšti
  const d2 = await openDev(k.name, k.email); d2.sim.default = mode === 'hang' ? 'hang' : 'deny';
  await d2.p.waitForSelector('#migGate', { timeout: 15000 }).catch(() => {}); await d2.p.waitForTimeout(1500);
  out.reopenKid = (await gateH(d2)) === KID_T;
  if (!out.reopenKid) problem(`${k.name}: pri ponovnom otvaranju nije dečji ekran — „${await gateH(d2)}“`);
  if (mode === 'later') {
    // roditelj odobri; Google sada daje ključ i bez prozora → nastavlja se samo (bez dodira), čim se dete vrati u aplikaciju
    await d2.p.click('#migGate [data-mg="alt"]').catch(() => {}); await d2.p.waitForTimeout(500);
    sim.issueToken(k.email, 'NEW', 'drive.file drive.appdata'); d2.sim.default = 'approve';
    await ev(d2, () => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    const t1 = Date.now(); let r = null;
    for (let i = 0; i < 90; i++) { const m = await ev(d2, async () => (await (await import('./src/db.js')).settings.get('mig', null)) || {}); if (m.done) { r = m; break; } if (await ev(d2, () => !!document.querySelector('#migGate [data-mg="go"]')) && !/Zamoli/.test(await gateH(d2))) await tapGo(d2); await d2.p.waitForTimeout(700); }
    out.autoResumed = !!r; out.autoMs = Date.now() - t1;
    if (!r) problem(`${k.name}: posle odobrenja prelazak se ne nastavlja sam`);
  }
  await closeDev(d2);
  return out;
}
// prekid usred slanja: aplikacija ubijena (zatvorena) dok traka napreduje, pa ponovo otvorena — nastavlja bez duplikata
async function killMidUpload(d, who) {
  if (!(await d.p.waitForSelector('#migGate', { timeout: 15000 }).then(() => true).catch(() => false))) return false;
  for (let i = 0; i < 60; i++) { if (await d.p.$('.mig-bar')) break; if (await ev(d, () => !!document.querySelector('#migGate [data-mg="go"]'))) await tapGo(d); await d.p.waitForTimeout(150); }
  const had = !!(await d.p.$('.mig-bar'));
  await closeDev(d); log(`  ${who}: aplikacija zatvorena usred slanja (traka ${had ? 'je bila' : 'NIJE bila'} prikazana)`);
  return had;
}
const posle = kids.filter((x) => grp(x.i) === 'posle');
const CHAOS = new Map([[posle[0], 'drugi nalog'], [posle[1], 'Google 500 ×3'], [posle[2], 'pomoćnik 500 ×2'], [posle[3], 'mreža pukla usred slanja'], [posle.find((x, j) => j >= 4 && x.i % 2 === 0) || posle[4], 'ubijena usred slanja']].filter(([k]) => k));
async function chaos(d, k, what) {
  if (what === 'drugi nalog') { sim.addUser('drugi' + k.i + '@x.test'); d.sim.accounts.push('drugi' + k.i + '@x.test'); d.sim.next({ pick: 'drugi' + k.i + '@x.test' }); }
  if (what === 'Google 500 ×3') sim.fail({ status: 500, reason: 'backendError', times: 3, match: (q) => q.project === 'NEW' && q.user === k.email && q.method !== 'GET' });
  if (what === 'pomoćnik 500 ×2') sim.fail({ status: 500, reason: 'backendError', times: 2, match: (q) => q.ep === 'helper' });
  if (what === 'mreža pukla usred slanja') { sim.dropAfter(6); setTimeout(() => sim.offline(false), 4000); }
}
// nastavnikovo „čeka slanje“ (Google traži pauzu → sanduče se šalje kasnije): sačekaj da ode, kao pri sledećem otvaranju
async function drainOutbox(d, label) {
  const t1 = Date.now();
  const r = await ev(d, async () => { const B = await import('./src/teachBox.js'); const q0 = await B.pendingCount(); for (let i = 0; i < 120 && (await B.pendingCount()); i++) { await B.flushOutbox().catch(() => 0); await new Promise((r) => setTimeout(r, 2000)); } return { q0, left: await B.pendingCount() }; });
  log(`  ${label}: na čekanju ${r.q0} · posle ${((Date.now() - t1) / 1000) | 0} s ostalo ${r.left}`);
  (report.outbox = report.outbox || []).push({ label, ...r, ms: Date.now() - t1 });
  if (r.left) problem(`${label}: ${r.left} stavki i dalje čeka slanje`);
}
const order = [];
// 1) učenici „pre“ (pre nastavnika)
for (const k of kids.filter((x) => grp(x.i) === 'pre')) order.push(['kid', k]);
order.push(['teacher']);
for (const k of kids.filter((x) => grp(x.i) === 'dete')) order.push(['dete', k]);
for (const k of kids.filter((x) => ['posle', 'dva', 'isto'].includes(grp(x.i)))) order.push(['kid', k]);
const results = [];
for (const [kind, k] of order) {
  if (kind === 'teacher') {
    let d = await openDev(T.name, T.email, { phone: false });
    const killed = await killMidUpload(d, 'nastavnik');
    d = await openDev(T.name, T.email, { phone: false });
    const r = await migrate(d); r.killed = killed;
    results.push({ who: 'nastavnik', ...r });
    log(`nastavnik: ${r.ok ? 'OK' : 'NIJE ' + r.at} · ${r.ms} ms · ${r.req} zahteva`);
    // veze sa učenicima (u pozadini) — sačekaj
    const t1 = Date.now();
    for (let i = 0; i < 400; i++) { const m = await ev(d, async () => (await (await import('./src/db.js')).settings.get('mig', null)) || {}); if (m.linksDone) break; await d.p.waitForTimeout(1500); }
    const lk = await ev(d, async () => { const m = (await (await import('./src/db.js')).settings.get('mig', null)) || {}; const L = m.links || {}; return { linksDone: !!m.linksDone, box: Object.keys(L.box || {}).length, plan: Object.keys(L.plan || {}).length, voice: Object.keys(L.voice || {}).length, shares: Object.keys(L.shares || {}).length, copied: m.oldFiles ? m.oldN : null }; });
    report.timings.teacherLinks = { ms: Date.now() - t1, ...lk };
    log(`  veze sa učenicima: ${JSON.stringify(lk)} · ${Date.now() - t1} ms`);
    if (!lk.linksDone) problem('nastavnik: veze sa učenicima nisu završene');
    await drainOutbox(d, 'nastavnik posle seljenja veza');
    T.errsB = d.p.errs.slice(); await closeDev(d);
  } else if (kind === 'dete') {
    const r = await supervised(k); r.ok = !!(r.kidScreen && r.gateGone && r.reopenKid); results.push(r); log(`dete ${k.name} (${r.mode}): dečji ekran ${r.kidScreen ? 'da' : 'NE'} · radi dok čeka ${r.gateGone && r.wait && r.wait.mine === 8 ? 'da' : 'NE'} · ponovo dečji ${r.reopenKid ? 'da' : 'NE'}${r.mode === 'later' ? ` · samo nastavljeno ${r.autoResumed ? 'da (' + r.autoMs + ' ms)' : 'NE'}` : ''}`);
  } else {
    let d = await openDev(k.name, k.email); const what = CHAOS.get(k);
    if (what === 'ubijena usred slanja') { await killMidUpload(d, k.name); d = await openDev(k.name, k.email); }
    else if (what) await chaos(d, k, what);
    const r = await migrate(d); if (what) { r.chaos = what; log(`  ${k.name} (${what}): ${r.ok ? 'OK' : 'NIJE ' + r.at} · ${r.ms} ms`); }
    results.push({ who: k.name, grp: grp(k.i), ...r });
    if (!r.ok && r.shown !== false) problem(`${k.name} (${grp(k.i)}): prelazak nije završen — ${r.at}`);
    k.errsB = d.p.errs.slice(); await closeDev(d);
  }
}
log(`prelazak: ${results.filter((r) => r.ok).length}/${results.length} uspešno · bez ekrana (nisu bili prijavljeni): ${results.filter((r) => r.shown === false).length}`);
report.rate = { limited: sim.stats.rateLimited, byReason: sim.stats.byReason };
log('ograničenja brzine:', JSON.stringify(report.rate));

// ======================= PROVERE =======================
// a) svaki učenik prati nastavnika: nova pesma POSLE prelaska stiže; napredak stiže nastavniku; plan i glas rade
{
  const d = await openDev(T.name, T.email, { phone: false });
  await ev(d, async (list) => { const B = await import('./src/teachBox.js'); const db = await import('./src/db.js'); for (const k of list) { const s = await db.songs.save({ title: 'Posle prelaska ' + k.i, artist: 'Mile', sections: [{ name: 'S', lines: [{ text: 'nova', chords: [{ chord: 'E', position: 0 }] }] }] }); const it = await B.inlineItem({ kind: 'song', name: s.title, share: { songs: [s] } }); await B.boxPut(k.sid, [it]); } }, kids.map((k) => ({ sid: k.sid, i: k.i })));
  await drainOutbox(d, 'nastavnik posle slanja nove pesme svima');
  await closeDev(d);
}
for (const k of kids) {
  const d = await openDev(k.name, k.email);
  if (grp(k.i) === 'stara' || grp(k.i) === 'offline') { await migrate(d); } // ažurirali su kasnije
  if (grp(k.i) === 'dete' && !(await ev(d, async () => ((await (await import('./src/db.js')).settings.get('mig', null)) || {}).done))) { d.sim.default = 'approve'; const r = await migrate(d); log(`dete ${k.name}: roditelj odobrio → prelazak ${r.ok ? 'OK' : 'NIJE ' + r.at}`); if (!r.ok) problem(`${k.name}: posle odobrenja prelazak nije završen`); }
  const r = await ev(d, async (i) => {
    const B = await import('./src/teachBox.js'); const tm = await import('./src/teach.js'); const db = await import('./src/db.js'); const P = await import('./src/progress.js'); const S = await import('./src/shareService.js');
    await B.checkBox({ force: true });
    const songs = await db.songs.list();
    const m = await tm.getMyTeacher();
    const cm = Object.values(m.cmts || {}).flat().find((c) => c && c.voice);
    const voice = cm && cm.voice ? await S.readData(cm.voice) : null;
    await db.settings.set('practice', { v: 1, games: { pauk: { best: 50 + i, plays: 3 } }, songs: {} }); window.dispatchEvent(new Event('marli-act'));
    const pf = await P.syncProgress({ force: true });
    return { newSong: songs.some((s) => s.title === 'Posle prelaska ' + i), old: songs.some((s) => s.title === 'Za učenika ' + i), mine: songs.filter((s) => s.title.startsWith('Moja ')).length, key: await db.settings.get('geminiKey', ''), plan: !!m.planFile, voice: !!(voice && voice.type === 'voice'), voiceId: cm && cm.voice, prog: pf, box: m.box };
  }, k.i);
  k.after = r;
  if (!r.newSong) problem(`${k.name} (${grp(k.i)}): ne dobija pesme posle prelaska`);
  if (!r.old || r.mine !== 8) problem(`${k.name}: izgubljene pesme (od nastavnika ${r.old}, svoje ${r.mine}/8)`);
  if (r.key !== 'AIzaStudentKey_' + k.i + '_abcdefghijklmnopqrstuv') problem(`${k.name}: Gemini ključ ${r.key ? 'promenjen' : 'izgubljen'}`);
  if (!r.voice) problem(`${k.name}: glasovni komentar ne može da se pusti`);
  else if ((sim.file(r.voiceId) || {}).project !== 'NEW') problem(`${k.name}: glasovni komentar još pokazuje na stari fajl (radi, ali nestaje pri čišćenju)`);
  k.errsC = d.p.errs.slice(); await closeDev(d);
}
{
  const d = await openDev(T.name, T.email, { phone: false });
  const r = await ev(d, async (list) => {
    const tm = await import('./src/teach.js'); const P = await import('./src/progress.js'); const db = await import('./src/db.js');
    const out = [];
    for (const k of list) { const st = await tm.getStudent(k.sid); const pr = await P.studentProgress(st, { fresh: true }); out.push({ i: k.i, ok: !!(pr && !pr.err && !pr.gone && pr.type === 'progress'), best: pr && pr.games && pr.games[0] ? pr.games[0] : null, file: (await tm.getStudent(k.sid)).prog.fileId }); }
    const songs = await db.songs.count(); const key = await db.settings.get('geminiKey', '');
    const reqs = await tm.getRequests();
    const S = await import('./src/sync.js'); let pend = -1; for (let i = 0; i < 40; i++) { S.syncNow(); await new Promise((r) => setTimeout(r, 1500)); pend = await db.syncMeta.pending(); if (!pend) break; }
    const titles = (await db.songs.list()).map((s) => s.title).sort();
    return { out, songs, key, pend, titles, checks: reqs.filter((x) => x.type === 'check' || x.fileId).length };
  }, kids.map((k) => ({ sid: k.sid, i: k.i })));
  for (const o of r.out) if (!o.ok) problem(`nastavnik ne vidi napredak učenika ${o.i} (${grp(o.i)})`);
  if (r.key !== 'AIzaGeminiTeacherKey_0123456789abcdefghij') problem('nastavnik: Gemini ključ');
  T.titles = r.titles; if (r.pend) problem(`nastavnik: ${r.pend} izmena nije poslato posle 60 s`);
  report.teacher = { songs: r.songs, progressOk: r.out.filter((o) => o.ok).length, checks: r.checks };
  log(`nastavnik posle: ${r.songs} pesama · napredak vidi za ${r.out.filter((o) => o.ok).length}/${N} · zahteva „proveri“: ${r.checks}`);
  await closeDev(d);
}
// b) nov (treći) uređaj nastavnika na NOVOJ vezi dobija sve
{
  const d = await openDev('teacher-new', T.email, { phone: false });
  const r = await ev(d, async (want) => { const S = await import('./src/sync.js'); await S.connectSync(); for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 1000)); if ((await (await import('./src/db.js')).songs.count()) >= want) break; } const db = await import('./src/db.js'); const tm = await import('./src/teach.js'); return { songs: await db.songs.count(), key: await db.settings.get('geminiKey', ''), students: (await tm.getStudents()).length, practice: ((await db.settings.get('practice', null)) || {}).games, titles: (await db.songs.list()).map((s) => s.title).sort() }; }, T.titles.length);
  const miss = T.titles.filter((x) => !r.titles.includes(x)); delete r.titles; r.missing = miss.length;
  if (miss.length) problem(`nov uređaj nastavnika: nedostaje ${miss.length} pesama (${miss.slice(0, 3).join(', ')})`);
  report.freshDevice = r;
  log(`nov uređaj nastavnika (nova veza): ${r.songs} pesama · ${r.students} učenika · ključ ${r.key ? 'da' : 'NE'}`);
  if (r.students !== N) problem(`nov uređaj: ${r.students}/${N} učenika`);
  if (!r.key) problem('nov uređaj: nema Gemini ključa');
  await closeDev(d);
}
// c) stari deljeni link (stari id) i dalje radi — prati „preseljeno“
{
  const d = await openDev('stranac', 'stranac@x.test');
  const r = await ev(d, async (id) => { const I = await import('./src/shareImport.js'); const p = await I.fetchPackage(id); return p && p.songs ? p.songs.length : 0; }, T.share);
  if (!r) problem('stari deljeni link više ne radi'); else log('stari deljeni link: radi (' + r + ' pesma)');
  await closeDev(d);
}
// e) stara kartica (2.5.65 ostala otvorena / iz keša) pored nove: ne sme da sinhronizuje na staru vezu, a njene izmene stižu na novu
{
  const k = kids.find((x) => x.sync && grp(x.i) === 'pre') || kids.find((x) => x.sync);
  if (k) {
    const d = await openDev(k.name, k.email); // nova verzija (prelazak gotov) — vodi sinhronizaciju
    await d.p.waitForTimeout(3000);
    const before = sim.listFiles({ project: 'OLD', appData: true }).length;
    ROOT = OLD_ROOT; const p1 = await d.ctx.newPage(); p1.errs = []; p1.on('pageerror', (e) => p1.errs.push(String(e).slice(0, 200)));
    await p1.goto(BASE + '#/pesme'); await p1.waitForTimeout(1500); ROOT = NEW_ROOT;
    const oldVer = await p1.evaluate(async () => (await import('./src/version.js')).APP_VERSION || '');
    await p1.evaluate(async () => { const db = await import('./src/db.js'); await db.songs.save({ title: 'Iz stare kartice', artist: 'X', sections: [{ name: 'S', lines: [{ text: 'stara', chords: [] }] }] }); const S = await import('./src/sync.js'); for (let i = 0; i < 4; i++) { try { S.syncNow(); } catch {} await new Promise((r) => setTimeout(r, 2000)); } });
    const after = sim.listFiles({ project: 'OLD', appData: true }).length;
    await ev(d, async () => { const S = await import('./src/sync.js'); for (let i = 0; i < 8; i++) { S.syncNow(); await new Promise((r) => setTimeout(r, 1500)); if (!(await (await import('./src/db.js')).syncMeta.pending())) break; } });
    const fresh = await browser.newContext(); await installSim(sim, fresh, sim.device({ accounts: [k.email] }), { initScript: true });
    await fresh.addInitScript(() => { try { localStorage.setItem('gitara-tour', '1'); localStorage.setItem('gitara-upgraded', '9'); } catch {} window.__marliTest = { noHints: true }; });
    const p3 = await fresh.newPage(); await p3.goto(BASE + '#/pesme'); await p3.waitForTimeout(1000);
    const got = await p3.evaluate(async () => { const S = await import('./src/sync.js'); await S.connectSync(); for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 1000)); const L = await (await import('./src/db.js')).songs.list(); if (L.some((s) => s.title === 'Iz stare kartice')) return true; } return false; });
    await fresh.close(); await p1.close();
    log(`stara kartica (${oldVer}) pored nove: upisa na staru vezu ${after - before} · izmena iz stare kartice stigla na novu vezu: ${got ? 'da' : 'NE'}`);
    report.oldTab = { oldVer, oldWrites: after - before, reachedNew: got };
    if (after - before > 0) problem(`stara kartica je upisala ${after - before} fajlova na staru vezu`);
    if (!got) problem('izmena iz stare kartice nije stigla na novu vezu');
    await closeDev(d);
  }
}
// d) duplikati u novoj skrivenoj fascikli
{
  const byUser = {};
  for (const f of sim.listFiles({ project: 'NEW', appData: true })) { const k = f.appProperties && f.appProperties.k; if (!k || k === 'snapshot') continue; const key = f.owner + '|' + k; byUser[key] = (byUser[key] || 0) + 1; }
  const dups = Object.entries(byUser).filter(([, n]) => n > 1);
  log(`nova fascikla: ${sim.listFiles({ project: 'NEW', appData: true }).length} fajlova · ponovljenih ključeva: ${dups.length}`);
}
const allErrs = [...(T.errsB || []), ...kids.flatMap((k) => [...(k.errsB || []), ...(k.errsC || [])])];
log(`greške u stranicama (2.5.66): ${allErrs.length}`, allErrs.slice(0, 5));
log(`ukupno zahteva (faza B + provere): ${sim.stats.total} · ograničeno: ${sim.stats.rateLimited}`);
log(`PROBLEMA: ${report.problems.length}`);
console.log(JSON.stringify({ results: results.map((r) => ({ who: r.who, grp: r.grp, ok: r.ok, ms: r.ms, req: r.req, chaos: r.chaos, mode: r.mode })), report }, null, 0).slice(0, 4000));
await browser.close(); srv.close();
process.exit(0);
