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
const EXCL_LOCAL = new Set(['gitara-diag', 'gitara-boots', 'gitara-lastscan', 'gitara-sync', 'gitara-echo-clean', 'marli-keycheck', 'marli-pdf-queue', 'marli-bk',
  'marli-def1701', 'marli-def-test', 'marli-intro', 'marli-intro-gate', 'marli-invite-test']);
const KEY_RE = /^[\w-]{10,200}$/;
const LAST = 'marli-bk'; // kada je poslednja kopija napravljena (na ovom uređaju)

const day = () => new Date().toISOString().slice(0, 10);
const songsN = (n) => songsCount(n);
export const lastBackups = () => { try { return JSON.parse(localStorage.getItem(LAST) || '{}') || {}; } catch { return {}; } };
const noteLast = (kind, where) => { try { const o = lastBackups(); o[kind] = { at: Date.now(), where }; localStorage.setItem(LAST, JSON.stringify(o)); } catch {} };
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
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (LOCAL_RE.test(k) && !EXCL_LOCAL.has(k)) local[k] = localStorage.getItem(k); } } catch {}
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
  if (kind === 'songs' && !(await counts()).songs) { toast(t('set.nothingToExport')); return null; }
  if (!(await ensureConnected())) return null;
  const drive = await import('./drive.js');
  try {
    const at = await drive.saveNamed(await driveName(kind), await build(kind));
    noteLast(kind, 'drive');
    toast(t(kind === 'full' ? 'bk.savedFullT' : 'bk.savedSongsT'));
    return { ok: true, at };
  } catch (e) {
    if (e && e.code === 'cancelled') return null;
    const v = await dialog({ title: t('bk.driveFailTitle'), body: t('bk.driveFail', { msg: (e && e.message) || '' }),
      buttons: [{ label: t('common.cancel'), value: null }, { label: t('bk.saveFile'), value: 'file', kind: 'primary' }] });
    if (v === 'file') await saveFile(kind);
    return null;
  }
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
async function fromDrive(kind) {
  if (!(await ensureConnected())) return null;
  toast(t('restore.looking'));
  const drive = await import('./drive.js');
  const names = kind === 'full' ? [drive.BK_FULL, 'gitara-backup.json'] : [drive.BK_SONGS, drive.BK_FULL, 'gitara-backup.json'];
  for (const n of names) {
    let f = null;
    try { f = await drive.readNamed(n); }
    catch (e) { if (e && e.code === 'cancelled') return null; if (e && e.code === 'offline') { toast(t('drive.e.offline'), 'error'); return null; } }
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
export async function restoreFull({ from = 'drive' } = {}) {
  const src = from === 'file' ? await fromFile() : await fromDrive('full');
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
export async function restoreSongs({ from = 'drive' } = {}) {
  const src = from === 'file' ? await fromFile() : await fromDrive('songs');
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
