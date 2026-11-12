// v1.71: dve jasne rezervne kopije.
//  • „Cela aplikacija“ — SVE: pesme, set liste, folderi, sva podešavanja, Gemini ključ, Vežbe (rezultati, nizovi,
//    tempo), Skale, moji ritmovi, snimci i „već viđeno“ oznake. Vraćanje zamenjuje sve u aplikaciji.
//  • „Samo pesme“ — pesme i njihovi folderi. Vraćanje ne dira ništa drugo (Dodaj nove / Zameni sve pesme).
// Glavni put je Google Drive i radi sam: čuvanje i vraćanje same nađu fajl (folder „Gitara“, uvek isto ime) — korisnik
// ništa ne bira. Fajl na uređaju (telefon ili računar) je dodatna mogućnost.
import { t, songsCount } from './i18n.js';
import { settings, songs as db } from './db.js';
import { dialog, toast, pickFile, esc } from './ui.js';
import { APP_VERSION } from './version.js';

// Ne ide u kopiju: prijava na Google, stanje sinhronizacije, keš spiska modela, privremeno i dijagnostika
const EXCL_SETTINGS = new Set(['driveToken', 'driveRT', 'drive', 'syncCfg', 'syncMigrated', 'syncOffered', 'geminiModels', 'shareFolder', 'held:secret']);
const LOCAL_RE = /^(gitara-|marli-)/;
const EXCL_LOCAL = new Set(['gitara-diag', 'gitara-boots', 'gitara-lastscan', 'gitara-sync', 'gitara-echo-clean', 'marli-keycheck', 'marli-pdf-queue', 'marli-bk', 'marli-rp', 'marli-songbar',
  'marli-autobk', 'marli-def1701', 'marli-def-test', 'marli-dev', 'marli-intro', 'marli-intro-gate', 'marli-invite-test', 'marli-fb-q', 'marli-fb-url-test', 'marli-last-tab']); // v2.0: poslednja kartica je samo navigacija na ovom uređaju — ne u kopiju
const KEY_RE = /^[\w.\-]{10,300}$/; // stari (AIza…, 39) i novi Google oblik (AQ.…, sa tačkom)
const LAST = 'marli-bk'; // kada je poslednja kopija napravljena (na ovom uređaju)

const day = () => new Date().toISOString().slice(0, 10);
const songsN = (n) => songsCount(n);
export const lastBackups = () => { try { return JSON.parse(localStorage.getItem(LAST) || '{}') || {}; } catch { return {}; } };
const noteLast = (kind, where) => { try { const o = lastBackups(); o[kind] = { at: Date.now(), where }; localStorage.setItem(LAST, JSON.stringify(o)); } catch {} };
// greške sa Drive-om idu u dijagnostiku (Podešavanja → Dijagnostika → Kopiraj izveštaj)
function logErr(what, e) { try { const L = JSON.parse(localStorage.getItem('gitara-diag') || '[]'); L.push({ t: Date.now(), k: 'backup', m: `${what}: ${(e && (e.code || e.name)) || ''} ${(e && e.message) || e}${e && e.reason ? ' [' + e.reason + ']' : ''}`.slice(0, 400) }); localStorage.setItem('gitara-diag', JSON.stringify(L.slice(-60))); } catch {} }
const driveName = async (kind) => { const d = await import('./drive.js'); return kind === 'full' ? d.BK_FULL : d.BK_SONGS; };

export async function isConnected() {
  const d = (await settings.get('drive', null)) || {}, s = (await settings.get('syncCfg', null)) || {};
  return !!(d.connected || s.on);
}
/** Povezivanje sa Google nalogom iz dodira (bez pitanja — kao i sinhronizacija). false = otkazano/neuspelo. */
async function ensureConnected() {
  if (await isConnected()) return true;
  try { const { connectSync } = await import('./sync.js'); return !!(await connectSync()); }
  catch (e) { if (e && e.code !== 'cancelled') toast((e && e.message) || t('common.error'), 'error'); return false; }
}

/** Šta je sada u aplikaciji (za kartice): broj pesama, set lista, foldera, ima li ključa i napretka. */
export async function counts() {
  const all = (await db.all()).filter((s) => !s.demo);
  const sets = (await settings.get('setlists', [])) || [], folders = (await settings.get('folders', [])) || [];
  const pr = (await settings.get('practice', null)) || {};
  return { songs: all.length, sets: sets.length, folders: folders.length, key: !!(await settings.get('geminiKey', '')), practice: Object.keys(pr.games || {}).length + Object.keys(pr.songs || {}).length > 0 };
}
/** Kada je kopija poslednji put sačuvana na Drive-u — bez prozora; undefined ako se ne zna. */
export async function onDrive(kind) { return (await import('./drive.js')).peekNamed(await driveName(kind)); }

// ---------------- Pravljenje ----------------
export async function buildFull() {
  const drive = await import('./drive.js');
  const st = {};
  for (const k of await settings.keys()) {
    if (typeof k !== 'string' || EXCL_SETTINGS.has(k)) continue;
    const v = await settings.get(k);
    if (v !== undefined) st[k] = v;
  }
  const local = {};
  try { const ks = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (LOCAL_RE.test(k) && !EXCL_LOCAL.has(k)) ks.push(k); } for (const k of ks.sort()) local[k] = localStorage.getItem(k); } catch {} // v2.0: stalni redosled (pregledač menja redosled ključeva) — ista kopija = isti otisak
  return { app: 'marli', type: 'full', version: 2, appVersion: APP_VERSION, exportedAt: new Date().toISOString(),
    songs: await drive.backupSongs(), deleted: await drive.backupDeleted(), settings: st, local };
}
export async function buildSongs() {
  const drive = await import('./drive.js');
  const folders = await settings.get('folders', []);
  const demo = new Set((await db.all()).filter((s) => s.demo).map((s) => s.id)); // primer pesme se ne šalje
  return { app: 'marli', type: 'songs', version: 2, appVersion: APP_VERSION, exportedAt: new Date().toISOString(),
    songs: (await drive.backupSongs()).filter((s) => !demo.has(s.id)), settings: Array.isArray(folders) && folders.length ? { folders } : {} };
}
const build = async (kind) => JSON.stringify(kind === 'full' ? await buildFull() : await buildSongs());

/** Fajl na uređaju: telefon (deljenje → Fajlovi, Drive…) ili računar (preuzimanje). */
export async function saveFile(kind) {
  if (kind === 'songs' && !(await counts()).songs) { toast(t('set.nothingToExport')); return false; }
  const name = `MARLI-${kind === 'full' ? 'cela-aplikacija' : 'pesme'}-${day()}.json`;
  const r = await (await import('./shareService.js')).shareFile(new Blob([await build(kind)], { type: 'application/json' }), name, t(kind === 'full' ? 'bk.fullTitle' : 'bk.songsTitle'));
  if (r) { noteLast(kind, 'file'); if (r === 'downloaded') toast(t('bk.fileSaved', { name })); }
  return !!r;
}

/** „Sačuvaj sve“ / „Sačuvaj pesme“: na Google Drive, samo od sebe (poveže nalog ako treba). Vraća { ok, at } ili null. */
export async function saveBackup(kind) {
  if (!(await ensureConnected())) return null;
  const drive = await import('./drive.js');
  try {
    await drive.fileToken(); // odmah na dodir (Google prozor, ako uopšte treba, ne sme da čeka pripremu kopije)
    if (kind === 'songs' && !(await counts()).songs) { toast(t('set.nothingToExport')); return null; }
    const at = await drive.saveNamed(await driveName(kind), await build(kind));
    noteLast(kind, 'drive');
    toast(t(kind === 'full' ? 'bk.savedFullT' : 'bk.savedSongsT'));
    return { ok: true, at };
  } catch (e) {
    logErr('save ' + kind, e);
    if (e && e.code === 'cancelled') return null;
    const v = await dialog({ title: t('bk.driveFailTitle'), body: t('bk.driveFail', { msg: (e && e.message) || '' }),
      buttons: [{ label: t('common.cancel'), value: null }, { label: t('bk.saveFile'), value: 'file', kind: 'primary' }] });
    if (v === 'file') await saveFile(kind);
    return null;
  }
}

// ---------------- v1.85: automatska dnevna kopija (podrazumevano uključeno) ----------------
// Jednom dnevno, pri prvom korišćenju tog dana, ako se nešto promenilo: „Cela aplikacija“ kao poseban fajl po danu
// (folder „Gitara“ na korisnikovom Drive-u). Čuva se poslednjih 7 dana + po jedna za 4 nedelje pre toga.
// Bez ikakvog Google prozora: ako ključ ne može tiho da se obnovi, pokušava se sledeći put.
export const DAILY = 'MARLI – dnevna kopija ';
const AUTO = 'marli-autobk';
const dailyName = (d) => `${DAILY}${d}.json`;
export const dailyDate = (name) => (/(\d{4}-\d{2}-\d{2})\.json$/.exec(name || '') || [])[1] || '';
export const autoInfo = () => { try { return JSON.parse(localStorage.getItem(AUTO) || '{}') || {}; } catch { return {}; } };
export async function autoOn() { return (await settings.get('autoBackup', true)) !== false; }
export async function setAutoOn(on) { await settings.set('autoBackup', !!on); if (on) autoBackup({ force: true }).catch(() => {}); }
const hashOf = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return String(h >>> 0); };
/** Koje dnevne kopije ostaju: 7 najnovijih + najnovija iz svake od 4 nedelje pre toga. */
export function keepDaily(dates) {
  const ds = [...new Set(dates)].sort().reverse();
  const keep = new Set(ds.slice(0, 7)), weeks = new Set();
  for (const d of ds.slice(7)) {
    const t0 = Date.parse(d + 'T12:00:00Z'); const wd = (new Date(t0).getUTCDay() + 6) % 7; const wk = Math.round((t0 - wd * 864e5) / 864e5);
    if (weeks.has(wk) || weeks.size >= 4) continue;
    weeks.add(wk); keep.add(d);
  }
  return keep;
}
let autoRunning = false;
/** Vraća: 'saved' | 'same' | 'skip' | 'later' (nije moglo tiho). */
export async function autoBackup({ force = false } = {}) {
  if (autoRunning) return 'skip';
  if (!(await autoOn()) || !(await isConnected()) || navigator.onLine === false) return 'skip';
  const today = day(), last = autoInfo();
  if (!force && last.day === today) return 'skip';
  autoRunning = true;
  try {
    const data = await buildFull();
    if (!(data.songs || []).length && !last.hash) return 'skip'; // prazna aplikacija — nema šta da se čuva
    const hash = hashOf(JSON.stringify({ ...data, exportedAt: 0, appVersion: 0 }));
    const store = (o) => { try { localStorage.setItem(AUTO, JSON.stringify({ ...last, ...o })); } catch {} };
    if (!force && last.hash === hash) { store({ day: today }); return 'same'; }
    const drive = await import('./drive.js');
    const at = await drive.saveNamedQuiet(dailyName(today), JSON.stringify(data));
    if (!at) return 'later';
    store({ day: today, hash, at, n: (data.songs || []).length });
    // čišćenje starih
    try {
      const files = await drive.listNamed(DAILY, { quiet: true });
      const keep = keepDaily(files.map((f) => dailyDate(f.name)).filter(Boolean));
      for (const f of files) if (dailyDate(f.name) && !keep.has(dailyDate(f.name))) await drive.deleteFileId(f.id).catch(() => {});
    } catch (e) { logErr('auto prune', e); }
    return 'saved';
  } catch (e) { logErr('auto', e); return 'later'; } finally { autoRunning = false; }
}
/** Pokretanje: posle pokretanja aplikacije i kad se vrati u prvi plan (najviše jednom dnevno). */
let autoInited = false;
// v1.86: samo u mirnom trenutku — nikad dok traje igra, snimanje, sviranje pesme ili otvoren prozor; pa kad je telefon besposlen
const busy = () => document.hidden || /^#\/vezbe\/[a-z]/.test(location.hash) // igra
  || !!document.querySelector('.modal-backdrop, .recording, .ch.playing, .ln.playing, body.stage-mode'); // prozor, snimanje, pesma svira, set na sceni
function whenCalm(fn, tries = 0) {
  if (busy()) { if (tries < 30) setTimeout(() => whenCalm(fn, tries + 1), 60000); return; }
  const go = () => (busy() ? setTimeout(() => whenCalm(fn, tries + 1), 60000) : fn());
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 10000 }); else setTimeout(go, 500);
}
export function initAutoBackup() {
  if (autoInited) return; autoInited = true;
  const run = () => { if (autoInfo().day !== day()) whenCalm(() => autoBackup().catch(() => {})); };
  setTimeout(run, 25000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(run, 4000); });
}
/** „Vrati sve“ sa Drive-a: izbor kopije (ručna + dnevne). '' = ručna/najnovija, null = otkazano. */
async function pickFullCopy() {
  const drive = await import('./drive.js');
  let files = [], manual = null;
  try { files = await drive.listNamed(DAILY); } catch (e) { logErr('list daily', e); }
  try { manual = await drive.peekNamed(drive.BK_FULL); } catch {}
  const daily = files.map((f) => ({ name: f.name, d: dailyDate(f.name), at: Date.parse(f.modifiedTime) || 0 })).filter((x) => x.d).sort((a, b) => (a.d < b.d ? 1 : -1));
  if (!daily.length) return '';
  const opts = [...(manual ? [{ name: drive.BK_FULL, label: t('bk.pickManual'), sub: drive.formatDate(manual.modified) }] : []),
    ...daily.map((x) => ({ name: x.name, label: dayLabel(x.d), sub: t('bk.pickDaily', { time: (drive.formatDate(x.at).split(' ').pop() || '') }) }))];
  let pick = opts[0].name;
  const p = dialog({ title: t('bk.pickTitle'), html: true, className: 'tch-dlg', body: `<p class="small muted">${esc(t('bk.pickBody'))}</p><div class="tch-opts bk-picks" role="radiogroup">${opts.map((o, i) => `<button type="button" class="tch-opt${i ? '' : ' on'}" data-o="${esc(o.name)}" role="radio" aria-checked="${!i}"><span class="tch-opt-ic bk-pick-ic"><svg viewBox="0 0 24 24" aria-hidden="true">${o.name === drive.BK_FULL ? '<path d="M12 2 3 6v6c0 5 3.8 9.4 9 10 5.2-.6 9-5 9-10V6l-9-4z"/>' : '<path d="M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zM5 9h14v10H5z"/>'}</svg></span><span><b>${esc(o.label)}</b><small>${esc(o.sub)}</small></span></button>`).join('')}</div>`,
    buttons: [{ label: t('common.cancel'), value: null }, { label: t('bk.pickOk'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  box?.querySelector('.bk-picks')?.addEventListener('click', (e) => { const b = e.target.closest('[data-o]'); if (!b) return; pick = b.dataset.o; box.querySelectorAll('.bk-picks .tch-opt').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }); });
  return (await p) === 'ok' ? pick : null;
}
function dayLabel(d) {
  const today = day(), y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  if (d === today) return cap(t('st.today')); if (d === y) return cap(t('st.yesterday'));
  const [Y, M, D] = d.split('-').map(Number); return `${D}. ${M}. ${Y}.`;
}

// ---------------- Vraćanje ----------------
/** Fajl sa uređaja (JSON) ili null. */
async function fromFile() {
  const file = await pickFile('.json,application/json,text/plain');
  if (!file) return null;
  const text = await file.text();
  try { return { data: JSON.parse(text), modified: file.lastModified || 0, text, src: 'file' }; }
  catch { return { data: null, modified: 0, text, src: 'file' }; }
}

/** Google Drive, samo od sebe: poveže nalog ako treba i nađe najnoviju kopiju (nova, pa starija). null = nema / otkazano. */
async function fromDrive(kind, only = '') {
  if (!(await ensureConnected())) return null;
  const drive = await import('./drive.js');
  try { await drive.fileToken(); } catch (e) { logErr('restore ' + kind, e); if (e && e.code !== 'cancelled') toast((e && e.message) || t('common.error'), 'error'); return null; }
  toast(t('restore.looking'));
  const names = only ? [only] : kind === 'full' ? [drive.BK_FULL, 'gitara-backup.json'] : [drive.BK_SONGS, drive.BK_FULL, 'gitara-backup.json'];
  for (const n of names) {
    let f = null;
    try { f = await drive.readNamed(n); }
    catch (e) { logErr('read ' + n, e); if (e && e.code === 'cancelled') return null; if (e && e.code === 'offline') { toast(t('drive.e.offline'), 'error'); return null; } }
    if (f) return { ...f, name: n, src: 'drive' };
  }
  const v = await dialog({ title: t(kind === 'full' ? 'bk.restoreFullTitle' : 'bk.restoreSongsTitle'), body: t('bk.noneOnDrive'),
    buttons: [{ label: t('common.ok'), value: null }, { label: t('bk.fromFile'), value: 'file' }] });
  return v === 'file' ? fromFile() : null;
}

/** Kartica sa sadržajem kopije u dijalogu (datum, odakle, šta je unutra). */
function summaryHtml(src, items) {
  const ico = src.src === 'drive'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 10.2A7 7 0 0 0 6.1 8.1 5 5 0 0 0 6.5 18h12a4 4 0 0 0 .9-7.8z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l6 6v14H6zm8 1.5V9h5.5z"/></svg>';
  return `<div class="bk-sum"><div class="bk-sum-h"><span class="bk-sum-ico">${ico}</span><div><b>${esc(src.when)}</b><small>${esc(src.where)}</small></div></div>
    <ul class="bk-chips">${items.map(([k, v, ok]) => `<li class="${ok === false ? 'no' : ''}"><span>${esc(k)}</span><b>${esc(String(v))}</b></li>`).join('')}</ul></div>`;
}

/** „Vrati sve“: kopija cele aplikacije sa Drive-a (ili iz fajla: from='file') zamenjuje sve. */
export async function restoreFull({ from = 'drive', name = '' } = {}) {
  if (from === 'drive' && !name) { // v1.85: izbor — ručna kopija ili jedna od dnevnih
    if (!(await ensureConnected())) return false;
    try { await (await import('./drive.js')).fileToken(); } catch (e) { if (e && e.code !== 'cancelled') toast((e && e.message) || t('common.error'), 'error'); return false; }
    const pick = await pickFullCopy(); if (pick === null) return false; name = pick;
  }
  const src = from === 'file' ? await fromFile() : await fromDrive('full', name);
  if (!src) return false;
  const drive = await import('./drive.js');
  let parsed;
  try { parsed = drive.parseBackupData(src.data, src.modified); }
  catch { await dialog({ title: t('import.invalidTitle'), body: t('bk.notBackup') }); return false; }
  const data = src.data, full = data.app === 'marli' && data.type === 'full';
  const sets = (parsed.settings.setlists || []).length, hasKey = full && typeof (data.settings || {}).geminiKey === 'string' && !!data.settings.geminiKey;
  const pr = parsed.settings.practice || {}, hasPr = Object.keys(pr.games || {}).length + Object.keys(pr.songs || {}).length > 0;
  const html = summaryHtml(
    { src: src.src, when: drive.formatDate(parsed.modified || Date.now()), where: src.src === 'drive' ? t('bk.whereDriveName', { name: src.name }) : t('bk.whereFile') },
    [[t('bk.cSongs'), parsed.songs.length], [t('bk.cSets'), sets], [t('bk.cKey'), hasKey ? '✓' : '—', hasKey], [t('bk.cPractice'), hasPr ? '✓' : '—', hasPr], [t('bk.cSettings'), '✓']])
    + `<p class="small muted">${t('bk.confirmFull')}${full ? '' : ' ' + t('bk.oldNote')}</p>`;
  const ok = await dialog({ title: t('bk.restoreFullTitle'), html: true, body: html, className: 'bk-modal',
    buttons: [{ label: t('common.cancel'), value: false }, { label: t('bk.restoreAllBtn'), value: true, kind: 'danger' }] });
  if (!ok) return false;
  // 1) pesme + poznata podešavanja (provereno, kao ranije); pesme iz kopije se vraćaju i ako su ovde bile obrisane
  await drive.applyRestore(parsed, 'replace', { revive: true });
  // 2) sve ostalo iz nove kopije: ostala podešavanja, Gemini ključ, „već viđeno“ oznake
  if (full) {
    const known = new Set(drive.BACKUP_SETTINGS);
    for (const [k, v] of Object.entries(data.settings || {})) {
      if (EXCL_SETTINGS.has(k) || known.has(k) || v === undefined) continue;
      if (k === 'geminiKey') { if (typeof v === 'string' && KEY_RE.test(v.trim())) await settings.set('geminiKey', v.trim()); continue; }
      if (k === 'keySync') { await (await import('./db.js')).setKeySync(v !== false); continue; }
      await settings.set(k, v);
    }
    try { for (const [k, v] of Object.entries(data.local || {})) if (LOCAL_RE.test(k) && !EXCL_LOCAL.has(k) && typeof v === 'string') localStorage.setItem(k, v); } catch {}
  }
  toast(t('bk.restoredFull'));
  setTimeout(() => location.reload(), 1400); // jezik, izgled, Vežbe… — sve iz kopije odmah na snazi
  return true;
}

/** „Vrati pesme“: samo pesme (i folderi pesama) sa Drive-a (ili iz fajla). Ne dira podešavanja, set liste ni ključ. */
export async function restoreSongs({ from = 'drive', name = '' } = {}) {
  const src = from === 'file' ? await fromFile() : await fromDrive('songs', name);
  if (!src) return false;
  const drive = await import('./drive.js');
  let songs, folders = null, modified = src.modified;
  try {
    const p = drive.parseBackupData(src.data, src.modified);
    songs = p.songs; folders = p.settings.folders || null; modified = p.modified;
  } catch {
    try { songs = (await import('./songformat.js')).parseBackup(src.text || JSON.stringify(src.data)); } // starija izvezena lista
    catch (e) { await dialog({ title: t('import.invalidTitle'), body: (e && e.message) || t('bk.notBackup') }); return false; }
  }
  if (!songs || !songs.length) { await dialog({ title: t('drive.emptyTitle'), body: t('drive.emptyBody') }); return false; }
  const local = (await db.all()).filter((s) => !s.demo);
  const html = summaryHtml({ src: src.src, when: drive.formatDate(modified || Date.now()), where: src.src === 'drive' ? t('bk.whereDriveName', { name: src.name }) : t('bk.whereFile') },
    [[t('bk.cSongs'), songs.length], [t('bk.cFolders'), (folders || []).length], [t('bk.cNow'), local.length]])
    + `<p class="small muted">${t(local.length ? 'bk.confirmSongs' : 'bk.confirmSongsEmpty')}</p>`;
  const mode = await dialog({ title: t('bk.restoreSongsTitle'), html: true, body: html, className: 'bk-modal',
    buttons: local.length
      ? [{ label: t('common.cancel'), value: null }, { label: t('bk.replaceSongs'), value: 'replace', kind: 'danger' }, { label: t('bk.addMissing'), value: 'merge', kind: 'primary' }]
      : [{ label: t('common.cancel'), value: null }, { label: t('bk.restoreSongsBtn'), value: 'merge', kind: 'primary' }] });
  if (!mode) return false;
  if (mode === 'replace') await db.clear();
  if (folders) { const { mergeById } = await import('./collections.js'); await settings.set('folders', mergeById((await settings.get('folders', [])) || [], folders)); }
  const { mergeSongs } = await import('./songSync.js');
  const r = await mergeSongs(songs, { revive: true });
  const n = r.added + r.updated;
  toast(n ? t('bk.restoredSongs', { n: songsN(n) }) : t('drive.mergedNone'));
  return true;
}

// ---------------- v1.74: posle povezivanja — Drive se sam pretraži, novija kopija se ponudi ----------------
export function ageText(ts) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return t('bk.ageMin', { n: Math.max(1, m) });
  const h = Math.round(m / 60); if (h < 24) return t('bk.ageH', { n: h });
  const d = Math.round(h / 24); return d === 1 ? t('bk.ageD1') : t('bk.ageD', { n: d });
}
/** arrived: šta je stiglo prvom sinhronizacijom (ključevi 'song:…', 'secret'…). Ponudi se samo ako je kopija korisna:
 *  sinhronizacija nije donela ništa, ili je kopija na Drive-u novija od najnovije pesme koja je stigla. */
export const gotAnything = (arrived) => [...(arrived || [])].some((k) => k.startsWith('song:') || k.startsWith('set:') || k === 'secret');
export async function offerAfterConnect(arrived) {
  try {
    const drive = await import('./drive.js');
    const cands = [];
    for (const [name, kind] of [[drive.BK_FULL, 'full'], [drive.BK_SONGS, 'songs'], ['gitara-backup.json', 'old']]) {
      const f = await drive.peekNamed(name);
      if (f && f.modified) cands.push({ name, kind, modified: f.modified });
    }
    const marli = cands.filter((c) => c.kind !== 'old');
    const list = (marli.length ? marli : cands).sort((a, b) => b.modified - a.modified);
    if (!list.length) return 'none';
    const gotNothing = !gotAnything(arrived);
    const newest = Math.max(0, ...(await db.all()).filter((s) => !s.demo).map((s) => Number(s.updatedAt) || 0));
    const useful = gotNothing ? list : list.filter((c) => c.modified > newest + 5 * 60e3);
    if (!useful.length) return 'none';
    const rec = useful.find((c) => c.kind === 'full') || useful[0];
    const label = (c) => t(c.kind === 'full' ? 'bk.fullTitle' : c.kind === 'songs' ? 'bk.songsTitle' : 'bk.oldTitle');
    const html = `<p>${t(gotNothing ? 'bk.offerEmpty' : 'bk.offerNewer')}</p>
      <ul class="bk-offer">${useful.map((c) => `<li class="${c === rec ? 'rec' : ''}"><b>${esc(label(c))}</b><span>${esc(ageText(c.modified))}</span>${c === rec ? `<em>${t('bk.recommended')}</em>` : ''}</li>`).join('')}</ul>`;
    const v = await dialog({ title: t('bk.offerTitle'), html: true, body: html, className: 'bk-modal',
      buttons: [{ label: t('bk.offerNo'), value: null }, { label: t('bk.offerYes', { what: label(rec) }), value: 'yes', kind: 'primary' }] });
    if (v !== 'yes') return false;
    return rec.kind === 'songs' ? restoreSongs({ name: rec.name }) : restoreFull({ name: rec.name });
  } catch { return 'none'; }
}
