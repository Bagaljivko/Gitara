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
export function startMigration() {
  if (running) return running;
  running = (async () => {
    // v2.5.68: više kartica na istom uređaju — prelazak radi samo jedna; ostale čekaju i posle se ponovo učitaju
    if ((await migrationDone()) || !(navigator.locks && navigator.locks.request)) return run();
    return navigator.locks.request('marli-migrate', async () => {
      doneCache = null;
      if ((await get()).done) { location.reload(); return true; } // druga kartica je u međuvremenu završila
      return run();
    });
  })().finally(() => { running = null; });
  return running;
}
const POLL = () => globalThis.__marliTest?.handoffPollMs ?? 20000;
/** Dok je ekran „Prijavi se“ otvoren: ako drugi uređaj u međuvremenu završi i ostavi predaju — nastavi sam. */
function pollHandoff(cfg, stop) {
  return new Promise((res) => {
    const tick = async () => {
      if (stop.v) return;
      if (!document.hidden && navigator.onLine !== false) { const h = await takeHandoff(cfg).catch(() => null); if (h && !stop.v) { res(h); return; } }
      if (!stop.v) setTimeout(tick, POLL());
    };
    setTimeout(tick, POLL());
  });
}
const acctTag = async (id) => { try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('marli:' + id)); return 'nalog ' + [...new Uint8Array(b)].slice(0, 4).map((x) => x.toString(16).padStart(2, '0')).join(''); } catch { return ''; } };

async function run() {
  if (await migrationDone()) { const m = await get(); if (m.done && !m.fresh && !m.healed) setTimeout(() => healAfterMove().catch(() => {}), globalThis.__marliTest?.healDelay ?? 20000); if (m.done && !m.fresh && !(m.linksDone && m.copyUp && m.oldFiles && m.cleaned)) background().catch(() => {}); if (m.done && !m.fresh && !m.handoff) leaveHandoff().catch(() => {}); return true; }
  const S = await import('./sync.js'); const D = await import('./drive.js'); const O = await import('./oldAuth.js');
  const cfg = (await settings.get('syncCfg', null)) || {}; const drv = (await settings.get('drive', null)) || {};
  const email = cfg.email || drv.email || '';
  let m = await get();
  let quiet = false;
  if (!m.started) { m = await put({ started: Date.now() }); ev('počeo', true, { note: cfg.id ? await acctTag(cfg.id) : '' }); }
  // 0) druga kartica sa starom verzijom drži sinhronizaciju — mora da se zatvori (inače bi slala na staru vezu)
  for (;;) { if (await S.holdOldLock(2500)) break; if ((await screen({ h: t('mig.tabsT'), p: esc(t('mig.tabsP')), btn: t('mig.retry') })) !== 'go') continue; }
  // 1) kopija na uređaju
  for (;;) {
    try { await safetyCopy(); break; }
    catch { ev('kopija', false); if ((await screen({ h: t('mig.failT'), p: esc(t('mig.copyFail')), rows: [['⚠', t('mig.copyFailT'), t('mig.copyFailS')]], btn: t('mig.retry') })) === 'go') continue; }
  }
  for (;;) {
    // bez interneta: radi na uređaju, ekran se vraća čim ima mreže
    if (navigator.onLine === false) { // v2.5.68: bez ekrana — aplikacija radi, prelazak kreće sam čim se veza vrati
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
    // v2.5.68: ovaj uređaj je već bio prijavljen u ovom prelasku (npr. slanje nije uspelo pa „Pokušaj ponovo“) — bez nove
    // Google prijave: isti, sačuvan ključ / dugotrajna dozvola (svaki novi Google prozor je nova prilika da zaglavi)
    if (m.acct && m.acct.id && !m.pick) { const st = await D.syncTokenStored().catch(() => null); if (st && st.token) tk = st; }
    // v2.5.68: drugi uređaj — prvi je već prešao i ostavio predaju: bez prijave i bez ekrana (ako ne uspe: „Prijavi se“)
    if (!tk && !m.kidWait && !m.pick && !gate) { const h = await takeHandoff(cfg).catch(() => null); if (h) { tk = h.tk; quiet = true; m = await put({ via: 'auto', viaDev: h.dev || '', viaAt: h.at || Date.now() }); } }
    if (!tk && m.kidWait) {
      tk = await D.syncToken({ interactive: false, hint: email }).catch(() => null);
      if (!(tk && tk.token)) {
        tk = null;
        const a = await screen({ h: t('mig.kidT'), p: esc(t('mig.kidP')), rows: [['👪', t('mig.kidRowT'), t('mig.kidRowS')], safeRow()], btn: t('mig.kidRetry'), g: true, sub: t('mig.kidSub'), alt: t('mig.kidWait') });
        if (a === 'alt') { closeGate(); waitForParent(); return false; }
        direct = true;
      }
    }
    if (!tk && !direct) {
      const stop = { v: false };
      const tap = await Promise.race([screen({ h: t('mig.title'), p: esc(t('mig.p')), rows: [safeRow()], btn: t('mig.signIn'), g: true, sub: email ? t('mig.sameAcct', { e: masked(email) }) : '', alt: fails >= 3 ? t('mig.skipNow') : '' }), pollHandoff(cfg, stop)]);
      stop.v = true;
      if (tap && tap.tk) { tk = tap.tk; quiet = true; closeGate(); m = await put({ via: 'auto', viaDev: tap.dev || '', viaAt: tap.at || Date.now() }); } // drugi uređaj je u međuvremenu završio
      else if (tap === 'alt') { closeGate(); ev('preskočeno', false, { note: 'posle 3 neuspeha' }); return false; } // aplikacija radi na uređaju; ekran opet pri sledećem otvaranju
    }
    if (!tk) try { globalThis.__marliSigningIn = Date.now(); tk = await D.syncToken({ interactive: true, hint: email, pick: !!m.pick }); m = await put({ via: 'prijava' }); }
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
    globalThis.__marliSigningIn = 0;
    if (!tk) continue;
    // isti nalog?
    const acct = await S.migAbout(tk);
    if (!acct || !acct.id) { m = await put({ fails: fails + 1 }); await screen({ h: t('mig.failT'), p: esc(t('mig.failP')), rows: [['⚠', t('mig.googleT'), t('mig.googleS')]], btn: t('mig.retry') }); continue; }
    if ((cfg.id && acct.id !== cfg.id) || (!cfg.id && email && acct.email && acct.email.toLowerCase() !== email.toLowerCase())) {
      ev('drugi nalog', false, { note: quiet ? 'predaja' : '' });
      if (quiet) { quiet = false; await settings.remove('driveRT2'); await (await import('./drive.js')).syncSignOut().catch(() => {}); m = await put({ via: '' }); continue; } // nikad tuđi nalog
      await (await import('./drive.js')).syncSignOut().catch(() => {});
      await screen({ h: t('mig.acctT'), p: t('mig.acctP', { e: `<b>${esc(masked(email))}</b>` }), btn: t('mig.acctBtn', { e: masked(email) }), g: true });
      m = await put({ pick: true });
      continue;
    }
    m = await put({ acct: { id: acct.id, email: acct.email }, pick: false });
    if (!quiet) { const got = await adoptNewNote(tk, acct).catch(() => false); if (got) { ev('dugotrajna dozvola', true); m = await put({ via: 'auto', viaAt: Date.now() }); } } // drugi uređaj je bio prvi: veze i PDF-ove seli on
    if (quiet) m = await put({ via: 'auto' });
    // prazan uređaj, a stari tragovi postoje: podaci su možda samo na staroj vezi
    if (!(await db.count()) && cfg.on && !m.oldPulled2 && (await O.hasOldSignIn())) {
      const has = await O.oldTokenSilent('sync');
      if (!has) { const a = await screen({ h: t('mig.oldT'), p: esc(t('mig.oldP')), btn: t('mig.oldBtn'), g: true }); if (a === 'go') { try { await O.oldTokenInteractive('sync', acct.email); } catch {} } }
      const r = await S.migOldPull().catch(() => null);
      m = await put({ oldPulled2: r && r.ok ? 'ok' : 'skip' });
    }
    // 4) slanje na novu vezu + provera
    if (cfg.on) {
      if (quiet) toast(t('mig.autoBusy'));
      const ok = await uploadAll(S, tk, quiet);
      if (!ok && quiet) { ev('slanje', false, { note: 'auto' }); setTimeout(() => startMigration(), 120000); return false; } // tiho: ponovo za 2 min / pri sledećem otvaranju
      if (!ok) { m = await put({ fails: (m.fails || 0) + 1 }); ev('slanje', false); if ((await screen({ h: t('mig.failT'), p: esc(t('mig.failP')), rows: [['⚠', t('mig.upT'), t('mig.upS')]], btn: t('mig.retry') })) === 'go') continue; }
    }
    // 5) veze sa drugima: treba li stari ključ (jedan dodir)?
    const L = await import('./migLinks.js');
    // v2.5.68: samo ako nijedan drugi uređaj ovog naloga još nije završio (njegova beleška u novoj vezi) — inače veze seli on
    const otherDone = await newNotes(tk.token).then((x) => x.length > 0).catch(() => false);
    if (!otherDone && await L.linksNeeded() && !(await O.oldTokenSilent('file'))) {
      const teacher = (await ROLE()) === 'nastavnik';
      const a = await screen({ h: t(teacher ? 'mig.linkT' : 'mig.linkTs'), p: esc(t(teacher ? 'mig.linkP' : 'mig.linkPs')), btn: t('mig.confirm'), g: true });
      if (a === 'go') { try { await O.oldTokenInteractive('file', acct.email); } catch (e) { if (e && e.code !== 'cancelled') ev('stara prijava', false, { note: String(e.code || '') }); continue; } }
    }
    // 6) gotovo
    await put({ done: true, doneAt: Date.now() }); doneCache = true;
    if (cfg.on) await S.migFinish(acct);
    closeGate();
    toast(t(quiet ? 'mig.autoDone' : 'mig.done'));
    ev('gotovo', true, { n: String((m.copy && m.copy.n) || 0), note: `${quiet ? 'auto' : 'prijava'} · ${await acctTag(acct.id)}` });
    if (!quiet) leaveHandoff().catch(() => {});
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
async function uploadAll(S, tk, quiet = false) {
  globalThis.__marliMigBusy = true; try { return await uploadAllInner(S, tk, quiet); } finally { globalThis.__marliMigBusy = false; }
}
async function uploadAllInner(S, tk, quiet = false) {
  let m = await get();
  if (!m.rebased) { await S.migRebase(); m = await put({ rebased: Date.now() }); }
  const total = Math.max(1, (await syncMeta.pending()) || 1);
  const draw = async () => { const left = await syncMeta.pending().catch(() => 0); const done = Math.max(0, total - left); screen({ h: t('mig.upH'), p: esc(t('mig.upP')), rows: [safeRow()], prog: { pct: Math.min(100, Math.round((done / total) * 100)), t: t('mig.upN', { a: done, b: total }) } }); };
  if (!quiet) await draw();
  const iv = quiet ? 0 : setInterval(() => draw().catch(() => {}), 700);
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
// ---------------- v2.5.68: predaja drugim uređajima istog naloga ----------------
// Nova veza traži prijavu na svakom uređaju. Prvi uređaj koji pređe zato ostavi u skrivenoj fascikli STARE veze (vidi je
// samo MARLI tog naloga — isto mesto gde se sinhronizuje Gemini ključ) dugotrajnu dozvolu nove veze. Drugi uređaj je
// pročita (on još ima staru vezu), dobije svoj ključ preko pomoćnika i proveri da je isti nalog — bez Google prozora.
const HANDOFF = 'marli-predaja.json';
// ista beleška i u skrivenoj fascikli NOVE veze: uređaj koji je morao da se prijavi (stara prijava mu je istekla) odatle
// uzme dugotrajnu dozvolu — posle toga ga Google više nikad ne pita (bez nje bi ključ trajao samo sat vremena)
const NAPI = 'https://www.googleapis.com/drive/v3', NUP = 'https://www.googleapis.com/upload/drive/v3';
async function newNotes(tok) { const r = await fetch(`${NAPI}/files?spaces=appDataFolder&fields=${encodeURIComponent('files(id,modifiedTime)')}&q=${encodeURIComponent(`name='${HANDOFF}'`)}`, { headers: { Authorization: 'Bearer ' + tok } }); if (!r.ok) throw new Error('list ' + r.status); return (await r.json()).files || []; }
async function newNoteWrite(tok, text) {
  const b = 'mn' + Math.random().toString(36).slice(2);
  const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: HANDOFF, parents: ['appDataFolder'] })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${b}--`;
  const r = await fetch(`${NUP}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': `multipart/related; boundary=${b}` }, body });
  if (!r.ok) throw new Error('write ' + r.status);
}
/** Posle prijave na ovom uređaju: nema dugotrajne dozvole (Google je daje samo prvom uređaju) → uzmi je iz beleške. */
async function adoptNewNote(tk, acct) {
  if (await settings.get('driveRT2', null)) return false;
  const ex = await newNotes(tk.token); if (!ex.length) return false;
  const r = await fetch(`${NAPI}/files/${encodeURIComponent(ex[0].id)}?alt=media`, { headers: { Authorization: 'Bearer ' + tk.token } });
  if (!r.ok) return false;
  const j = await r.json().catch(() => null);
  if (!j || j.type !== 'handoff' || !j.rt || j.id !== acct.id) return false;
  await settings.set('driveRT2', { rt: j.rt, scope: j.scope || '' });
  return true;
}
async function leaveHandoff() {
  const m = await get(); if (m.handoff) return;
  const rt = await settings.get('driveRT2', null); const cfg = (await settings.get('syncCfg', null)) || {};
  if (!rt || !rt.rt || !cfg.on || !(m.acct || cfg.id)) return;
  if (!m.handoffNew) {
    try {
      const tk = await (await import('./drive.js')).syncTokenStored();
      if (tk && tk.token) { if (!(await newNotes(tk.token)).length) await newNoteWrite(tk.token, JSON.stringify({ app: 'marli', type: 'handoff', v: 1, rt: rt.rt, scope: rt.scope || '', id: (m.acct && m.acct.id) || cfg.id, at: Date.now() })); await put({ handoffNew: Date.now() }); }
    } catch {}
  }
  const O = await import('./oldAuth.js');
  if (!(await O.oldTokenSilent('sync'))) return;
  const ex = await O.oldList(`name='${HANDOFF}'`, 'files(id,name,modifiedTime)', 'appDataFolder');
  if (ex[0] && Date.now() - (Date.parse(ex[0].modifiedTime) || 0) < 30 * 864e5) { await put({ handoff: Date.now() }); return; } // već postoji (drugi uređaj je bio prvi)
  const D = await import('./devices.js');
  const body = JSON.stringify({ app: 'marli', type: 'handoff', v: 1, rt: rt.rt, scope: rt.scope || '', id: (m.acct && m.acct.id) || cfg.id, dev: D.myId(), at: Date.now() });
  await O.oldPutAppData(HANDOFF, body, ex[0] && ex[0].id);
  await put({ handoff: Date.now() }); ev('predaja ostavljena', true);
}
async function takeHandoff(cfg) {
  if (!cfg.on) return null;
  const O = await import('./oldAuth.js');
  if (!(await O.oldTokenSilent('sync'))) return null;
  const ex = await O.oldList(`name='${HANDOFF}'`, 'files(id,name,modifiedTime)', 'appDataFolder');
  if (!ex.length) return null;
  const j = JSON.parse(new TextDecoder().decode(await O.oldRead(ex[0].id, 'sync')));
  if (!j || j.type !== 'handoff' || !j.rt || !j.id || (cfg.id && j.id !== cfg.id) || Date.now() - (Number(j.at) || 0) > 90 * 864e5) return null; // tuđ, nepotpun ili zastareo → obična prijava
  const prev = await settings.get('driveRT2', null);
  await settings.set('driveRT2', { rt: j.rt, scope: j.scope || '' });
  const D = await import('./drive.js');
  const tk = await D.syncTokenStored().catch(() => null);
  if (!tk || !tk.token) { if (prev) await settings.set('driveRT2', prev); else await settings.remove('driveRT2'); return null; }
  return { tk, dev: j.dev || '', at: Number(j.at) || 0 };
}

let bgRun = null;
/** v2.5.67: posao posle prelaska (veze sa drugima, kopija na Drive, PDF-ovi) — jedan po jedan, tek kad se aplikacija
 *  smiri (prva sinhronizacija i dnevna kopija prvo), i nastavlja se pri svakom sledećem otvaranju dok se ne završi. */
/** v2.5.70: jednom posle prelaska, na svakom uređaju. Sigurne pretpostavke — samo DODAJE (nikad ne briše, nikad ne menja
 *  postojeći link ili sliku), i samo iz izvora koji dokazuju da je nešto pregaženo, a ne namerno uklonjeno:
 *  1) YouTube link pesme: iz „Prethodne verzije“ koju je sinhronizacija sačuvala posle prelaska (nastaje kad starija
 *     kopija sa drugog uređaja zameni ovu — namerno uklanjanje linka ne pravi takvu verziju);
 *  2) uređaj koji je vodio prelazak (prijava, imao najnovije podatke): iz njegove kopije pre prelaska — linkovi i slike
 *     učenika kojih sada nema (uređaji koji su prešli sami mogu imati staru kopiju — njihova se ne koristi);
 *  3) pun pregled nove veze (primenjuju se samo novije verzije) — za slučaj da nešto nije stiglo. */
export async function healAfterMove() {
  const m = await get();
  if (!m.done || m.fresh || m.healed) return null;
  let yt = 0, ph = 0;
  const has = (o) => o && typeof o === 'object' && Object.values(o).some((v) => typeof v === 'string' && v);
  const giveYt = async (id, old) => {
    const cur = await db.get(id);
    if (!cur || cur.demo || has(cur.yt) || !has(old.yt)) return; // obrisana pesma ostaje obrisana; postojeći link se ne dira
    await db.save({ ...cur, yt: { ...old.yt }, ...(old.ytSync && !cur.ytSync ? { ytSync: old.ytSync } : {}) });
    yt++;
  };
  try {
    const since = (m.started || m.doneAt || Date.now()) - 864e5;
    const { versions } = await import('./db.js');
    const vs = (await versions.list()).filter((v) => v && v.reason === 'conflict' && v.at >= since && String(v.key).startsWith('song:'));
    for (const v of vs) await giveYt(String(v.key).slice(5), v.data || {});
  } catch {}
  try {
    const lead = m.via === 'prijava';
    const cp = lead ? await settings.get('migCopy', null) : null;
    const data = cp && cp.gz ? await (await import('./syncEngine.js')).gunzip(cp.gz) : null;
    if (data) {
      for (const old of data.songs || []) if (old && old.id) await giveYt(old.id, old);
      const st = data.settings || {};
      const oldPh = new Map();
      for (const x of Array.isArray(st.studentPhotos) ? st.studentPhotos : []) if (x && x.id && typeof x.u === 'string' && x.u) oldPh.set(x.id, x.u);
      for (const x of Array.isArray(st.students) ? st.students : []) if (x && x.id && typeof x.photo === 'string' && x.photo && !oldPh.has(x.id)) oldPh.set(x.id, x.photo);
      if (oldPh.size) {
        const studs = new Set(((await settings.get('students', [])) || []).filter((x) => x && x.id).map((x) => x.id));
        const curPh = ((await settings.get('studentPhotos', [])) || []).filter((x) => x && x.id && typeof x.u === 'string');
        const have = new Set(curPh.filter((x) => x.u).map((x) => x.id));
        const add = [...oldPh].filter(([id]) => studs.has(id) && !have.has(id)).map(([id, u]) => ({ id, u, at: Date.now() }));
        if (add.length) { await settings.set('studentPhotos', [...curPh.filter((x) => !add.some((a) => a.id === x.id)), ...add]); ph = add.length; }
      }
    }
  } catch {}
  await put({ healed: Date.now() });
  try { const S = await import('./sync.js'); await S.fullPull(); } catch {}
  if (yt || ph) ev('popravka', true, { n: String(yt + ph), note: `yt ${yt} · slike ${ph}` });
  return { yt, ph };
}

function background(delay = globalThis.__marliTest?.bgDelay ?? 90000) {
  if (bgRun) return bgRun;
  bgRun = new Promise((r) => setTimeout(r, delay)).then(bgWork).finally(() => { bgRun = null; });
  return bgRun;
}
async function bgWork() {
  if (navigator.onLine === false) return;
  const m = await get();
  const L = await import('./migLinks.js');
  // v2.5.68: drugi uređaj istog naloga (predaja): veze nastavnik ↔ učenik i PDF-ove seli prvi uređaj; ovaj samo svoje
  // deljene linkove. Ako prvi uređaj ni posle 2 dana nije završio, ovaj preuzima.
  const helper = m.via === 'auto' && Date.now() - (m.viaAt || 0) < 2 * 864e5;
  if (!m.linksDone && !(await L.linksNeeded())) await put({ linksDone: Date.now() }); // nema veza sa drugima
  else if (!m.linksDone) {
    const r = await L.moveLinks(() => {}, { sharesOnly: helper }).catch(() => ({ ok: false }));
    try { (await import('./sync.js')).syncNow(); } catch {} // nove adrese odmah ka ostalim uređajima (da ne naprave svoje)
    if (r.ok && helper) { if (!(await L.linksNeeded())) await put({ linksDone: Date.now() }); } // ostalo seli prvi uređaj
    else if (r.ok) { await put({ linksDone: Date.now() }); ev('veze', true, { n: String(r.total) }); }
    else { ev('veze', false, { note: r.needOld ? 'stari ključ' : `neuspelo ${r.failed || 0}` }); setTimeout(() => background(0).catch(() => {}), 10 * 60000); return; }
  }
  if (!m.copyUp) {
    try {
      const c = await settings.get('migCopy', null);
      const D = await import('./drive.js');
      const DV = await import('./devices.js');
      if (c && c.gz) await D.saveToFolder(`MARLI – kopija pre prelaska (${DV.deviceName()} ${DV.myId().slice(-4)}).json.gz`, new Blob([c.gz], { type: 'application/gzip' }), 'application/gzip'); // po uređaju — ne zamenjuje tuđu
      await put({ copyUp: Date.now() });
    } catch {}
  }
  if (!m.oldFiles && helper) await put({ oldFiles: Date.now(), oldN: 0 }); // PDF-ove kopira prvi uređaj
  else if (!m.oldFiles) { const r = await copyOldFiles().catch(() => null); if (r != null) await put({ oldFiles: Date.now(), oldN: r }); }
  if (!m.cleaned) await cleanCopiedBackups().catch(() => {});
}
/** v2.5.67: 2.5.66 je pored PDF-ova kopirao i STARE rezervne kopije (cela aplikacija, pesme, dnevna) u „MARLI“. Tamo
 *  izgledaju kao današnje (datum kopiranja), a stara dnevna kopija od danas je mogla da zameni pravu današnju. Briše se
 *  samo takva kopija: isto ime kao rezervna kopija, napravljena u prvih 30 min posle prelaska i od tada nepromenjena.
 *  Original ostaje u staroj fascikli „Gitara“, a sve je i dalje na uređaju i u sinhronizaciji. Jednom. */
export async function cleanCopiedBackups() {
  const m = await get();
  if (m.cleaned || !m.doneAt) return;
  const D = await import('./drive.js');
  const from = m.doneAt - 60000, to = m.doneAt + 30 * 60000;
  const isBk = (n) => /^MARLI – (cela aplikacija|pesme|dnevna kopija )/.test(n || '');
  let n = 0;
  for (const f of await D.folderFiles()) {
    const c = Date.parse(f.createdTime) || 0, md = Date.parse(f.modifiedTime) || 0;
    if (!isBk(f.name) || c < from || c > to || md - c > 120000) continue;
    await D.deleteFileId(f.id).catch(() => {}); n++;
  }
  await put({ cleaned: Date.now(), cleanedN: n });
  if (n) { try { localStorage.removeItem('marli-autobk'); } catch {} (await import('./backups.js')).autoBackup().catch(() => {}); } // prava dnevna kopija za danas, iz nove verzije
}
/** Najnovija ručna kopija, najnovija dnevna i svi PDF-ovi iz starog foldera „Gitara“ → folder „MARLI“ (stari ostaju do čišćenja). */
async function copyOldFiles() {
  const O = await import('./oldAuth.js');
  if (!(await O.oldTokenSilent('file'))) return null; // stari ključ trenutno nije dostupan — pokušaće se ponovo
  const folders = await O.oldList("name='Gitara' and mimeType='application/vnd.google-apps.folder' and trashed=false", 'files(id,name)');
  if (!folders.length) return 0;
  const files = await O.oldList(`'${folders[0].id}' in parents and trashed=false`);
  // v2.5.67: samo PDF-ovi. Stare rezervne kopije ostaju u staroj fascikli „Gitara“ (ništa se ne briše); u „MARLI“ od sada
  // idu nove dnevne kopije. Kopiranje starih kopija je duplo slalo celu aplikaciju odmah posle prelaska.
  const pick = files.filter((f) => f.mimeType === 'application/pdf' || /\.pdf$/i.test(f.name));
  const D = await import('./drive.js'); const m = await get(); const done = { ...(m.copied || {}) }; let n = 0;
  for (const f of pick) {
    if (done[f.id]) continue;
    const bytes = await O.oldRead(f.id);
    await D.saveToFolder(f.name, new Blob([bytes], { type: f.mimeType || 'application/octet-stream' }), f.mimeType || 'application/octet-stream');
    done[f.id] = 1; n++; await put({ copied: done });
    await new Promise((r) => setTimeout(r, 3000)); // jedan po jedan, sa pauzom — ne zauzima vezu
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
