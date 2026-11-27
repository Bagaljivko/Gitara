// v2.5.66: prelazak na novu Google vezu (nov Cloud projekat „MARLI“). Obavezno za one koji su bili prijavljeni na Google;
// ko nikad nije bio prijavljen — ništa ne vidi. Redom (svaki korak se pamti u settings 'mig' — posle prekida nastavlja):
//   1. kopija svega na uređaju (pre bilo čega; bez nje se ne ide dalje)
//   2. poslednje preuzimanje sa stare veze (tiho, samo ako može bez prozora)
//   3. „Prijavi se“ (nova veza) — isti nalog (drugi nalog: ništa se ne šalje), oba ovlašćenja
//   4. sve stavke → nova veza, sa istim verzijama (u delovima), pa provera da je sve stiglo
//   5. veze sa drugima (nastavnik ↔ učenici, deljeni linkovi) — „preseljeno“ u starim fajlovima; u pozadini
//   6. gotovo; kopije i PDF-ovi sa stare veze u folder „MARLI“ — u pozadini
// Ništa se ne briše. Bez interneta: aplikacija radi na uređaju, ekran se vraća čim ima mreže.
import { t } from './i18n.js';
import { esc, toast } from './ui.js';
import { settings, songs as db, syncMeta } from './db.js';

const KEY = 'mig';
const ROLE = async () => { try { const tm = await import('./teach.js'); const tc = await tm.getTeacher(); if (tc && tc.on) return 'nastavnik'; if (await tm.getMyTeacher()) return 'učenik'; } catch {} return ''; };
const get = async () => (await settings.get(KEY, null)) || {};
const put = async (patch) => { const m = { ...(await get()), ...patch }; await settings.set(KEY, m); return m; };
const ev = (step, ok, extra = {}) => import('./feedback.js').then(async (F) => F.sendEvent({ step, ok: ok ? 'da' : 'ne', role: await ROLE(), ...extra })).catch(() => {});

/** Da li je ovaj uređaj ikad koristio Google (sinhronizacija, kopija, nastava, deljenje). Bez mreže. */
export async function usedGoogle() {
  const cfg = (await settings.get('syncCfg', null)) || {};
  const drv = (await settings.get('drive', null)) || {};
  if (cfg.on || cfg.id || drv.connected) return true;
  if ((await settings.get('driveRT', null)) || (await settings.get('driveToken', null))) return true;
  try {
    const tm = await import('./teach.js');
    const m = await tm.getMyTeacher(); if (m && (m.box || (m.prog && m.prog.fileId) || m.planFile)) return true;
    const tc = await tm.getTeacher(); if (tc && tc.on && (await tm.getStudents()).some((s) => (s.box && s.box.f) || (s.prog && s.prog.fileId) || s.planFile)) return true;
  } catch {}
  if (((await settings.get('shares', [])) || []).length) return true;
  return false;
}
let doneCache = null;
/** Prelazak je završen (ili nikad nije bio potreban). */
export async function migrationDone() {
  if (doneCache) return true;
  try { if (navigator.webdriver && localStorage.getItem('marli-mig-off')) return true; } catch {} // samo testovi drugih delova aplikacije
  const m = await get();
  if (m.done) return (doneCache = true);
  if (!(await usedGoogle())) { await put({ done: true, fresh: true, at: Date.now() }); return (doneCache = true); }
  return false;
}

// ---------------- ekran (preko cele aplikacije; bez „Kasnije“ i bez ✕) ----------------
const G_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" class="mg-g"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.3 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z"/></svg>';
let gate = null;
function screen({ h, p, rows = [], btn = '', g = false, sub = '', alt = '', prog = null }) {
  if (!gate) { gate = document.createElement('div'); gate.id = 'migGate'; gate.className = 'mig-gate'; gate.setAttribute('role', 'dialog'); gate.setAttribute('aria-modal', 'true'); document.body.appendChild(gate); document.body.classList.add('mig-open'); }
  gate.innerHTML = `<section class="view mig-box">
    <img src="icons/icon-192.png" alt="" width="64" height="64" class="mig-logo">
    <h1>${esc(h)}</h1><p class="muted mig-p">${p}</p>
    ${rows.length ? `<div class="set-grp mig-rows">${rows.map((r) => `<div class="tch-row"><span class="sr-ic" aria-hidden="true">${r[0]}</span><span><b>${esc(r[1])}</b><small>${esc(r[2])}</small></span></div>`).join('')}</div>` : ''}
    ${prog ? `<div class="mig-bar" role="progressbar" aria-valuenow="${prog.pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${prog.pct}%"></i></div><p class="muted small mig-pt">${esc(prog.t)}</p>` : ''}
    ${btn ? `<button type="button" class="btn primary wide mig-go" data-mg="go">${g ? G_ICON : ''}${esc(btn)}</button>` : ''}
    ${sub ? `<p class="muted small mig-sub">${esc(sub)}</p>` : ''}
    ${alt ? `<button type="button" class="btn wide mig-alt" data-mg="alt">${esc(alt)}</button>` : ''}
  </section>`;
  return new Promise((resolve) => { gate.onclick = (e) => { const b = e.target.closest('[data-mg]'); if (b) resolve(b.dataset.mg); }; });
}
function closeGate() { gate?.remove(); gate = null; document.body.classList.remove('mig-open'); }
const masked = (email) => { const [u, d] = String(email || '').split('@'); return u && d ? `${u.slice(0, 5)}…@${d}` : email || ''; };
const safeRow = () => ['🔒', t('mig.safeT'), t('mig.safeS')];

// ---------------- koraci ----------------
/** 1. Kopija svega na uređaju (pre bilo čega). Vraća broj pesama ili baca grešku. */
async function safetyCopy() {
  const m = await get();
  if (m.copy) return m.copy.n;
  const B = await import('./backups.js'); const E = await import('./syncEngine.js');
  const data = await B.buildFull();
  const bytes = await E.gzip(data);
  await settings.set('migCopy', { at: Date.now(), n: (data.songs || []).length, gz: bytes });
  const back = await settings.get('migCopy', null); // provera: čita se nazad i raspakuje
  const chk = await E.gunzip(back.gz);
  if (!chk || (chk.songs || []).length !== (data.songs || []).length) throw new Error('copy');
  await put({ copy: { at: Date.now(), n: (data.songs || []).length } });
  return (data.songs || []).length;
}

let running = null;
/** Pokreni prelazak (pri otvaranju aplikacije). Ne vraća se dok se ne završi (ili dok korisnik ne nastavi bez interneta). */
export function startMigration() { return running || (running = run().finally(() => { running = null; })); }

async function run() {
  if (await migrationDone()) return true;
  const S = await import('./sync.js'); const D = await import('./drive.js'); const O = await import('./oldAuth.js');
  const cfg = (await settings.get('syncCfg', null)) || {}; const drv = (await settings.get('drive', null)) || {};
  const email = cfg.email || drv.email || '';
  let m = await get();
  if (!m.started) { m = await put({ started: Date.now() }); ev('počeo', true); }
  // 0) druga kartica sa starom verzijom drži sinhronizaciju — mora da se zatvori (inače bi slala na staru vezu)
  for (;;) { if (await S.holdOldLock(2500)) break; if ((await screen({ h: t('mig.tabsT'), p: esc(t('mig.tabsP')), btn: t('mig.retry') })) !== 'go') continue; }
  // 1) kopija na uređaju
  for (;;) {
    try { await safetyCopy(); break; }
    catch { ev('kopija', false); if ((await screen({ h: t('mig.failT'), p: esc(t('mig.copyFail')), rows: [['⚠', t('mig.copyFailT'), t('mig.copyFailS')]], btn: t('mig.retry') })) === 'go') continue; }
  }
  for (;;) {
    // bez interneta: radi na uređaju, ekran se vraća čim ima mreže
    if (navigator.onLine === false) {
      await screen({ h: t('mig.title'), p: esc(t('mig.offP')), rows: [['📶', t('mig.offT'), t('mig.offS')]], btn: t('mig.offBtn') });
      closeGate();
      await new Promise((r) => addEventListener('online', r, { once: true }));
      continue;
    }
    // 2) poslednje preuzimanje sa stare veze (tiho)
    if (cfg.on && !m.oldPulled) { const r = await S.migOldPull().catch(() => null); m = await put({ oldPulled: r && r.ok ? 'ok' : 'skip' }); }
    // 3) prijava (nova veza)
    const fails = m.fails || 0;
    // čeka roditelja (dečji nalog): prvo tiho — možda je u međuvremenu odobreno (tada bez ijednog dodira); inače dečji
    // ekran (ne opšti), a dugme na njemu odmah otvara Google prijavu
    let tk = null, direct = false;
    if (m.kidWait) {
      tk = await D.syncToken({ interactive: false, hint: email }).catch(() => null);
      if (!(tk && tk.token)) {
        tk = null;
        const a = await screen({ h: t('mig.kidT'), p: esc(t('mig.kidP')), rows: [['👪', t('mig.kidRowT'), t('mig.kidRowS')], safeRow()], btn: t('mig.kidRetry'), g: true, sub: t('mig.kidSub'), alt: t('mig.kidWait') });
        if (a === 'alt') { closeGate(); waitForParent(); return false; }
        direct = true;
      }
    }
    if (!tk && !direct) {
      const tap = await screen({ h: t('mig.title'), p: esc(t('mig.p')), rows: [safeRow()], btn: t('mig.signIn'), g: true, sub: email ? t('mig.sameAcct', { e: masked(email) }) : '', alt: fails >= 3 ? t('mig.skipNow') : '' });
      if (tap === 'alt') { closeGate(); ev('preskočeno', false, { note: 'posle 3 neuspeha' }); return false; } // aplikacija radi na uređaju; ekran opet pri sledećem otvaranju
    }
    if (!tk) try { tk = await D.syncToken({ interactive: true, hint: email, pick: !!m.pick }); }
    catch (e) {
      if (e && e.code === 'cancelled') continue; // zatvorio Google prozor — isti ekran
      // dečji (nadzirani) nalog: Google traži da roditelj odobri novu aplikaciju — „odbijeno“ ili prozor koji se nikad ne javi
      //   „odbijeno“ (ne skinuta kvačica) → odmah; prozor koji se ne javi → od drugog puta (prvi put može biti i obična greška)
      const stuck = e && e.code === 'stuck' ? (m.stuck || 0) + 1 : 0;
      if (stuck) m = await put({ stuck });
      if (e && ((e.code === 'denied' && e.reason !== 'scope') || stuck >= 2)) {
        if (!m.kidWait) ev('čeka roditelja', false, { note: String(e.code) });
        m = await put({ kidWait: m.kidWait || Date.now() });
        continue; // dečji ekran (gore)
      }
      m = await put({ fails: fails + 1 }); ev('prijava', false, { note: String((e && e.code) || '') });
      if ((await screen({ h: t('mig.failT'), p: esc(t('mig.failP')), rows: [['⚠', t(e && e.code === 'denied' ? 'mig.scopeT' : 'mig.googleT'), t(e && e.code === 'denied' ? 'mig.scopeS' : 'mig.googleS')], ...(stuck ? [['👪', t('mig.kidT'), t('mig.kidHint')]] : [])], btn: t('mig.retry') })) === 'go') continue;
    }
    if (!tk) continue;
    // isti nalog?
    const acct = await S.migAbout(tk);
    if (!acct || !acct.id) { m = await put({ fails: fails + 1 }); await screen({ h: t('mig.failT'), p: esc(t('mig.failP')), rows: [['⚠', t('mig.googleT'), t('mig.googleS')]], btn: t('mig.retry') }); continue; }
    if ((cfg.id && acct.id !== cfg.id) || (!cfg.id && email && acct.email && acct.email.toLowerCase() !== email.toLowerCase())) {
      ev('drugi nalog', false);
      await (await import('./drive.js')).syncSignOut().catch(() => {});
      await screen({ h: t('mig.acctT'), p: t('mig.acctP', { e: `<b>${esc(masked(email))}</b>` }), btn: t('mig.acctBtn', { e: masked(email) }), g: true });
      m = await put({ pick: true });
      continue;
    }
    m = await put({ acct: { id: acct.id, email: acct.email }, pick: false });
    // prazan uređaj, a stari tragovi postoje: podaci su možda samo na staroj vezi
    if (!(await db.count()) && cfg.on && !m.oldPulled2 && (await O.hasOldSignIn())) {
      const has = await O.oldTokenSilent('sync');
      if (!has) { const a = await screen({ h: t('mig.oldT'), p: esc(t('mig.oldP')), btn: t('mig.oldBtn'), g: true }); if (a === 'go') { try { await O.oldTokenInteractive('sync', acct.email); } catch {} } }
      const r = await S.migOldPull().catch(() => null);
      m = await put({ oldPulled2: r && r.ok ? 'ok' : 'skip' });
    }
    // 4) slanje na novu vezu + provera
    if (cfg.on) {
      const ok = await uploadAll(S, tk);
      if (!ok) { m = await put({ fails: (m.fails || 0) + 1 }); ev('slanje', false); if ((await screen({ h: t('mig.failT'), p: esc(t('mig.failP')), rows: [['⚠', t('mig.upT'), t('mig.upS')]], btn: t('mig.retry') })) === 'go') continue; }
    }
    // 5) veze sa drugima: treba li stari ključ (jedan dodir)?
    const L = await import('./migLinks.js');
    if (await L.linksNeeded() && !(await O.oldTokenSilent('file'))) {
      const teacher = (await ROLE()) === 'nastavnik';
      const a = await screen({ h: t(teacher ? 'mig.linkT' : 'mig.linkTs'), p: esc(t(teacher ? 'mig.linkP' : 'mig.linkPs')), btn: t('mig.confirm'), g: true });
      if (a === 'go') { try { await O.oldTokenInteractive('file', acct.email); } catch (e) { if (e && e.code !== 'cancelled') ev('stara prijava', false, { note: String(e.code || '') }); continue; } }
    }
    // 6) gotovo
    await put({ done: true, doneAt: Date.now() }); doneCache = true;
    if (cfg.on) await S.migFinish(acct);
    closeGate();
    toast(t('mig.done'));
    ev('gotovo', true, { n: String((m.copy && m.copy.n) || 0) });
    background().catch(() => {});
    return true;
  }
}

/** Dok roditelj ne odobri: pri povratku u aplikaciju i na 2 min — tiho (bez prozora) proveri da li je odobreno; ako jeste,
 *  prelazak se nastavlja sam. Pri sledećem otvaranju aplikacije ekran se ionako pojavljuje ponovo. */
let kidTimer = 0;
function waitForParent() {
  const tryNow = async () => {
    if (document.hidden || running || navigator.onLine === false) return;
    try { const D = await import('./drive.js'); const tk = await D.syncTokenStored().catch(() => null) || await D.syncToken({ interactive: false }).catch(() => null); if (tk && tk.token) { clearInterval(kidTimer); document.removeEventListener('visibilitychange', tryNow); ev('roditelj odobrio', true); startMigration(); } } catch {}
  };
  clearInterval(kidTimer); kidTimer = setInterval(tryNow, 120000);
  document.addEventListener('visibilitychange', tryNow);
}

/** 4. sve stavke → nova veza (ista verzija), pa provera; najviše 3 kruga. */
async function uploadAll(S, tk) {
  let m = await get();
  if (!m.rebased) { await S.migRebase(); m = await put({ rebased: Date.now() }); }
  const total = Math.max(1, (await syncMeta.pending()) || 1);
  const draw = async () => { const left = await syncMeta.pending().catch(() => 0); const done = Math.max(0, total - left); screen({ h: t('mig.upH'), p: esc(t('mig.upP')), rows: [safeRow()], prog: { pct: Math.min(100, Math.round((done / total) * 100)), t: t('mig.upN', { a: done, b: total }) } }); };
  await draw();
  const iv = setInterval(() => draw().catch(() => {}), 700);
  try {
    for (let round = 0; round < 3; round++) {
      const r = await S.migUpload(tk, 8);
      if (!r || !r.ok) return false;
      const v = await S.migVerify();
      if (v && !v.error && !v.missing.length) { await put({ verified: { at: Date.now(), n: v.total } }); return true; }
      await S.migRebase(); // nešto nedostaje: ponovo označi sve (ono što je već tamo se ne šalje ponovo — ista verzija)
    }
    return false;
  } finally { clearInterval(iv); }
}

/** U pozadini, posle prelaska: veze sa drugima, kopija pre prelaska i kopije/PDF-ovi sa stare veze u folder „MARLI“. */
async function background() {
  const m = await get();
  const L = await import('./migLinks.js');
  if (!m.linksDone && (await L.linksNeeded())) {
    const r = await L.moveLinks().catch(() => ({ ok: false }));
    if (r.ok) { await put({ linksDone: Date.now() }); ev('veze', true, { n: String(r.total) }); }
    else { ev('veze', false, { note: r.needOld ? 'stari ključ' : `neuspelo ${r.failed || 0}` }); setTimeout(() => background().catch(() => {}), 10 * 60000); return; }
  }
  if (!m.copyUp) {
    try {
      const c = await settings.get('migCopy', null);
      const D = await import('./drive.js');
      if (c && c.gz) { await D.saveToFolder('MARLI – kopija pre prelaska.json.gz', new Blob([c.gz], { type: 'application/gzip' }), 'application/gzip'); await put({ copyUp: Date.now() }); }
    } catch {}
  }
  if (!m.oldFiles) { const r = await copyOldFiles().catch(() => null); if (r) await put({ oldFiles: Date.now(), oldN: r }); }
}
/** Najnovija ručna kopija, najnovija dnevna i svi PDF-ovi iz starog foldera „Gitara“ → folder „MARLI“ (stari ostaju do čišćenja). */
async function copyOldFiles() {
  const O = await import('./oldAuth.js');
  if (!(await O.oldTokenSilent('file'))) return 0;
  const folders = await O.oldList("name='Gitara' and mimeType='application/vnd.google-apps.folder' and trashed=false", 'files(id,name)');
  if (!folders.length) return 0;
  const files = await O.oldList(`'${folders[0].id}' in parents and trashed=false`);
  const latest = (pre) => files.filter((f) => f.name.startsWith(pre)).sort((a, b) => (a.modifiedTime < b.modifiedTime ? 1 : -1))[0];
  const pick = [latest('MARLI – cela aplikacija'), latest('MARLI – dnevna kopija'), latest('MARLI – pesme'), ...files.filter((f) => f.mimeType === 'application/pdf' || /\.pdf$/i.test(f.name))].filter(Boolean);
  const D = await import('./drive.js'); const m = await get(); const done = { ...(m.copied || {}) }; let n = 0;
  for (const f of pick) {
    if (done[f.id]) continue;
    const bytes = await O.oldRead(f.id);
    await D.saveToFolder(f.name, new Blob([bytes], { type: f.mimeType || 'application/octet-stream' }), f.mimeType || 'application/octet-stream');
    done[f.id] = 1; n++; await put({ copied: done });
    await new Promise((r) => setTimeout(r, 400));
  }
  return n;
}

/** Podešavanja → „Koristio/la si MARLI ranije? Preuzmi pesme iz stare veze“ (samo na dodir). */
export async function pullFromOld() {
  const O = await import('./oldAuth.js'); const S = await import('./sync.js');
  const cfg = (await settings.get('syncCfg', null)) || {};
  await O.oldTokenInteractive('sync', cfg.email || '');
  const r = await S.migImportOld(); // samo preuzimanje — nikad slanje na staru vezu posle prelaska
  if (!r || !r.ok) throw Object.assign(new Error('old'), { code: (r && r.code) || 'ERR' });
  return r.n;
}
