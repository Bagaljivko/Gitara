// v1.70: „Vrati rezervnu kopiju“ — prvo traži kopiju na Google Drive-u (folder „Gitara“), fajl sa uređaja je druga mogućnost.
// Koristi se iz Podešavanja (Rezervna kopija) i iz Pesme → „+“ → „Iz rezervne kopije“.
import { t } from './i18n.js';
import { settings, songs as db } from './db.js';
import { dialog, toast, pickFile } from './ui.js';

const plural = (n) => t('restore.songsN', { n });

/** Uvoz fajla rezervne kopije (.json) sa uređaja — spaja (ništa se ne briše). */
export async function restoreFromFile() {
  const file = await pickFile('.json,application/json,text/plain');
  if (!file) return false;
  const { parseBackup, SongFormatError } = await import('./songformat.js');
  try {
    const list = parseBackup(await file.text());
    const { mergeSongs } = await import('./songSync.js');
    const r = await mergeSongs(list);
    const added = r.added + r.updated;
    toast(added ? t('set.restored', { n: added }) : t('set.allExist'));
    return added > 0;
  } catch (e) {
    await dialog({ title: t('import.invalidTitle'), body: e instanceof SongFormatError ? e.message : t('set.cantRead') });
    return false;
  }
}

async function connected() {
  const d = (await settings.get('drive', null)) || {}, s = (await settings.get('syncCfg', null)) || {};
  return !!(d.connected || s.on);
}

/** Kopija na Drive-u ili null (bez pravljenja foldera). Greška mreže/dozvole → null + poruka. */
async function findOnDrive() {
  const drive = await import('./drive.js');
  await drive.initDrive().catch(() => {});
  try { return await drive.readOldBackup(); }
  catch (e) { if (e && e.code === 'offline') toast(t('drive.e.offline'), 'error'); return null; }
}

/** Vraćanje sa Drive-a: ako već ima pesama — Spoji / Zameni sve. */
async function applyDrive(backup) {
  const local = (await db.all()).filter((s) => !s.demo);
  let mode = 'replace';
  if (local.length) {
    mode = await dialog({
      title: t('drive.restoreTitle'),
      body: t('drive.restoreBody', { driveN: plural(backup.songs.length), date: (await import('./drive.js')).formatDate(backup.modified), localN: plural(local.length) }),
      buttons: [{ label: t('common.cancel'), value: null }, { label: t('drive.merge'), value: 'merge' }, { label: t('drive.replaceAll'), value: 'replace', kind: 'danger' }],
    });
    if (!mode) return false;
  }
  const n = await (await import('./drive.js')).applyRestore(backup, mode);
  toast(mode === 'merge' ? (n ? t('drive.merged', { n }) : t('drive.mergedNone')) : t('drive.restoredN', { n }));
  return true;
}

/** Glavni tok: Drive (ako je povezan, ili posle povezivanja) → fajl. Vraća true ako je nešto vraćeno. */
export async function restoreBackup() {
  if (!(await connected())) {
    const v = await dialog({ title: t('restore.title'), body: t('restore.notConnected'),
      buttons: [{ label: t('restore.pickFile'), value: 'file' }, { label: t('restore.connect'), value: 'connect', kind: 'primary' }] });
    if (!v) return false;
    if (v === 'file') return restoreFromFile();
    try { const { connectSync } = await import('./sync.js'); if (!(await connectSync())) return false; }
    catch (e) { if (e && e.code !== 'cancelled') toast((e && e.message) || t('common.error'), 'error'); return false; }
  }
  toast(t('restore.looking'));
  const backup = await findOnDrive();
  if (!backup || !backup.songs || !backup.songs.length) {
    const v = await dialog({ title: t('restore.title'), body: t('restore.noneOnDrive'), buttons: [{ label: t('common.cancel'), value: null }, { label: t('restore.pickFile'), value: 'file', kind: 'primary' }] });
    return v === 'file' ? restoreFromFile() : false;
  }
  const date = (await import('./drive.js')).formatDate(backup.modified);
  const v = await dialog({ title: t('restore.found'), body: t('restore.foundBody', { date, n: plural(backup.songs.length) }),
    buttons: [{ label: t('restore.pickFile'), value: 'file' }, { label: t('restore.fromDrive'), value: 'drive', kind: 'primary' }] });
  if (v === 'drive') return applyDrive(backup);
  if (v === 'file') return restoreFromFile();
  return false;
}
