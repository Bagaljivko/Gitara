// JEDINI put za deljenje u aplikaciji (pesme, TAB, snimci, set liste, aplikacija, fajlovi kao PDF).
// NOVE MOGUĆNOSTI DELJENJA MORAJU DA KORISTE OVAJ MODUL: nijedan drugi fajl ne poziva navigator.share i ne pravi linkove
// sa podacima u adresi (proverava tests/shareservice.test.mjs).
//
// Kratak link: sadržaj (isti zapis kao .gitara fajl: sažet JSON + verzija šeme + hash) ide u Google Drive pošiljaoca,
// folder „Gitara – deljeno“ (opseg drive.file: aplikacija vidi samo svoje fajlove; traži se tek pri prvom deljenju),
// fajl dobija dozvolu „svako sa linkom: čitanje“, a link je https://bagaljivko.github.io/Gitara/#d/<fileId>.
// Deljenje je „sve ili ništa“: link se pokazuje tek kad su i fajl i dozvola upisani i provereni; ako dozvola ne uspe,
// fajl se briše. Isti predmet ponovo = isti fajl i link (izmenjen sadržaj se upisuje u isti fajl); „Novi link“ = zasebna
// zamrznuta kopija. Nalog koji ne dozvoljava javne linkove: mali .gitara fajl kroz meni za deljenje (nikad dugačak link).
// Nikad se ne šalju Gemini ključ, tokeni, fotografije, napredak ni podešavanja uređaja (packSong: samo sadržaj pesme).
import { t, songsCount, getLang } from './i18n.js';
import { esc, toast, dialog } from './ui.js';
import { songs as db, settings } from './db.js';
import { buildShareFile, FILE_EXT, FILE_MIME } from './shareCode.js';
import { SHARE_BASE, SHARE_FOLDER } from './shareConfig.js';
import { safeFileName } from './songformat.js';
import { REC_FOLDER } from './collections.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const REG = 'shares'; // spisak podeljenog (samo na ovom uređaju): { key, fileId, kind, name, at, hash, frozen }
const ORPHAN_MS = 10 * 60000;

/** Ima li telefon sistemski meni za deljenje. */
export const canShareNative = () => !!navigator.share;
export const shareLinkOf = (fileId) => `${SHARE_BASE}#d/${fileId}`;
export const getShares = async () => (await settings.get(REG, [])) || [];
const saveShares = (list) => settings.set(REG, list);

// ---------------- Fajlovi (PDF, izvoz): sistemski meni za deljenje ili preuzimanje ----------------
/** Fajl kroz meni telefona (ili preuzimanje). Vraća 'shared' | 'downloaded' | null (otkazano). */
export async function shareFile(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return null; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}

// ---------------- Aplikacija (adresa, bez podataka) ----------------
export async function shareApp(url) {
  if (navigator.share) { try { await navigator.share({ title: 'Gitara', text: t('appShare.shareText'), url }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return null; } }
  return copyLink(url, t('appShare.copied'));
}
export const copyAppLink = (url) => copyLink(url, t('appShare.copied'));
async function copyLink(link, msg = t('share.linkCopied')) {
  try { await navigator.clipboard.writeText(link); toast(msg); return 'copied'; }
  catch { await dialog({ title: t('link.copyTitle'), html: true, body: `<textarea class="link-box" readonly rows="3">${esc(link)}</textarea>` }); return 'copied'; }
}

// ---------------- Pesme i set liste ----------------
const isRec = (s) => (s.folders || []).includes(REC_FOLDER) && !!s.recording;
/** Podeli pesmu (sa akordima, TAB ili snimak). */
export function shareSong(song) {
  return shareItem({ key: 'song:' + song.id, kind: 'song', name: song.title, artist: song.artist || '', songs: [song], what: isRec(song) ? 'rec' : song.type === 'tab' ? 'tab' : 'song' });
}
/** Podeli set listu (pune kopije pesama redom; obrisane pesme se preskaču i to se kaže). */
export async function shareSetlist(sl) {
  const got = await Promise.all((sl.songIds || []).map((id) => db.get(id).catch(() => null)));
  const list = got.filter(Boolean), missing = got.length - list.length;
  if (!list.length) { toast(t('sl.noSongs'), 'error'); return null; }
  return shareItem({ key: 'set:' + sl.id, kind: 'set', name: sl.name, songs: list, what: 'set', missing });
}
export function missingText(n) {
  if (getLang() === 'en') return t('share.missing', { n });
  const m10 = n % 10, m100 = n % 100;
  const form = m10 === 1 && m100 !== 11 ? 'nije pronađena i nije podeljena' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'nisu pronađene i nisu podeljene' : 'nije pronađeno i nije podeljeno';
  return `${songsCount(n)} ${form}`;
}

/** Tekst poruke (bez emodžija; WhatsApp ne vidi deo posle #, pa poruka sama kaže šta je to). */
export function shareMessage(item, link, who = '') {
  const by = item.artist ? ` – ${item.artist}` : '';
  const base = { name: item.name, title: item.name, by, n: songsCount(item.songs ? item.songs.length : 0), link, who };
  return t(`share.msg.${item.what}${who ? '' : 'Anon'}`, base);
}

let busy = false;
/** Ceo tok deljenja jednog predmeta. Vraća način ('link' | 'file' | 'copied' | null). */
export async function shareItem(item, { fresh = false } = {}) {
  if (busy) return null;
  busy = true;
  try {
    const drive = await import('./drive.js');
    if (navigator.onLine === false) return needAccount(item);
    try { await drive.shareToken({ interactive: false }); } catch { return needAccount(item); }
    toast(t('share.making'));
    const file = await buildShareFile(item);
    let res;
    try { res = await publish(drive, item, file, fresh); }
    catch (e) {
      if (e && e.policy) return policyFallback(item, file);
      if (e && (e.code === 'offline' || e.code === 'reconnect')) return needAccount(item);
      await dialog({ title: t('share.failedTitle'), body: (e && e.message) || t('share.failed') });
      return null;
    }
    return linkSheet(item, res);
  } finally { busy = false; }
}

/** „Za deljenje je potreban internet i Google nalog“ + „Poveži“ (dodir korisnika otvara izbor naloga). */
async function needAccount(item) {
  const go = await dialog({ title: t('share.needTitle'), body: t('share.needBody'), buttons: [{ label: t('common.cancel'), value: null }, { label: t('share.connect'), value: 'go', kind: 'primary' }] });
  if (go !== 'go') return null;
  if (navigator.onLine === false) { toast(t('share.offline'), 'error'); return null; }
  try { await (await import('./drive.js')).shareToken({ interactive: true }); }
  catch (e) { toast((e && e.message) || t('share.failed'), 'error'); return null; }
  busy = false;
  return shareItem(item);
}

/** Upload + javna dozvola (ili ponovna upotreba / izmena postojećeg fajla). Vraća { fileId, link, updated }. */
async function publish(drive, item, file, fresh) {
  const list = await getShares();
  const ex = !fresh && list.find((r) => r.key === item.key && !r.frozen);
  if (ex) {
    if (ex.hash === file.hash && (await stillPublic(drive, ex.fileId))) return { fileId: ex.fileId, link: shareLinkOf(ex.fileId), updated: false };
    try {
      await uploadMedia(drive, ex.fileId, file.text);
      await ensurePublic(drive, ex.fileId, false);
      Object.assign(ex, { hash: file.hash, name: item.name, at: Date.now() });
      await saveShares(list);
      return { fileId: ex.fileId, link: shareLinkOf(ex.fileId), updated: true };
    } catch (e) {
      if (e && e.code !== 'notfound') throw e;
      await saveShares(list.filter((r) => r !== ex)); // fajl je obrisan na Drive-u — napravi nov
    }
  }
  const folder = await ensureFolder(drive);
  const key = fresh ? `${item.key}#${Date.now().toString(36)}` : item.key;
  const fileId = await createFile(drive, folder, `${safeFileName(item.name)}${FILE_EXT}`, file.text, key);
  try { await ensurePublic(drive, fileId, true); }
  catch (e) { await drive.driveApi(`${API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }).catch(() => {}); throw e; } // sve ili ništa
  const now = await getShares();
  now.push({ key, fileId, kind: item.kind, what: item.what, name: item.name, artist: item.artist || '', n: item.songs.length, at: Date.now(), hash: file.hash, ...(fresh ? { frozen: true } : {}) });
  await saveShares(now);
  return { fileId, link: shareLinkOf(fileId), updated: false, fresh };
}

async function ensureFolder(drive) {
  const saved = await settings.get('shareFolder', '');
  if (saved) {
    try { const f = await (await drive.driveApi(`${API}/files/${encodeURIComponent(saved)}?fields=id,trashed`)).json(); if (f && !f.trashed) return saved; } catch (e) { if (e.code !== 'notfound') throw e; }
  }
  const q = `name='${SHARE_FOLDER.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const found = (await (await drive.driveApi(`${API}/files?spaces=drive&fields=files(id)&q=${encodeURIComponent(q)}`)).json()).files || [];
  const id = found[0] ? found[0].id : (await (await drive.driveApi(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: SHARE_FOLDER, mimeType: 'application/vnd.google-apps.folder' }) })).json()).id;
  await settings.set('shareFolder', id);
  return id;
}
function multipart(meta, text) {
  const boundary = 'gsh' + Math.random().toString(36).slice(2);
  return { boundary, body: new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${FILE_MIME}\r\n\r\n`, text, `\r\n--${boundary}--`]) };
}
async function createFile(drive, folder, name, text, key) {
  const { boundary, body } = multipart({ name, mimeType: FILE_MIME, parents: [folder], appProperties: { gitaraShare: '1', key: key.slice(0, 100) } }, text);
  const r = await (await drive.driveApi(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })).json();
  if (!r || !r.id) throw new Error(t('share.failed'));
  return r.id;
}
async function uploadMedia(drive, fileId, text) {
  await drive.driveApi(`${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id`, { method: 'PATCH', headers: { 'Content-Type': FILE_MIME }, body: text });
}
const isAnyoneReader = (p) => p && p.type === 'anyone' && p.role === 'reader';
async function readPerms(drive, fileId) {
  return ((await (await drive.driveApi(`${API}/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(id,type,role)`)).json()).permissions) || [];
}
async function stillPublic(drive, fileId) { try { return (await readPerms(drive, fileId)).some(isAnyoneReader); } catch { return false; } }
/** „Svako sa linkom: čitanje“ — upiše se i proveri čitanjem nazad. Nalog koji to ne dozvoljava → { policy: true }. */
async function ensurePublic(drive, fileId, create) {
  if (!create && (await stillPublic(drive, fileId))) return;
  try {
    await drive.driveApi(`${API}/files/${encodeURIComponent(fileId)}/permissions?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'anyone', role: 'reader', allowFileDiscovery: false }) });
  } catch (e) {
    if (e && e.code === 'denied' && !/rate/i.test(e.reason || '')) throw Object.assign(new Error(t('share.policy')), { policy: true });
    throw e;
  }
  if (!(await readPerms(drive, fileId)).some(isAnyoneReader)) throw Object.assign(new Error(t('share.policy')), { policy: true });
}

/** Link je spreman: „Podeli“ (meni telefona), „Kopiraj link“, „Novi link“ (zasebna zamrznuta kopija). */
async function linkSheet(item, res) {
  let who = '';
  try { who = await senderName(); } catch {}
  const msg = shareMessage(item, res.link, who);
  const body = `<p class="share-what">${esc(item.kind === 'set' ? t('share.whatSet', { name: item.name, n: songsCount(item.songs.length) }) : item.name)}</p>
    <p class="share-link">${esc(res.link)}</p>
    ${item.missing ? `<p class="small share-note">${esc(missingText(item.missing))}</p>` : ''}
    ${res.updated ? `<p class="small share-note">${esc(t('share.latest'))}</p>` : ''}${res.fresh ? `<p class="small share-note">${esc(t('share.frozenNote'))}</p>` : ''}`;
  const v = await dialog({
    title: t('share.ready'), html: true, className: 'share-sheet', body,
    buttons: [{ label: t('share.newLink'), value: 'new' }, { label: t('share.copyLink'), value: 'copy' }, ...(navigator.share ? [{ label: t('share.btn'), value: 'share', kind: 'primary' }] : [])],
  });
  if (v === 'copy') return copyLink(res.link);
  if (v === 'new') { busy = false; return shareItem(item, { fresh: true }); }
  if (v === 'share') {
    try { await navigator.share({ text: msg }); return 'link'; } catch (e) { if (e && e.name === 'AbortError') return null; return copyLink(res.link); }
  }
  return null;
}
async function senderName() {
  let n = await settings.get('shareName', null);
  if (n !== null) return n;
  const drive = await import('./drive.js');
  const j = await (await drive.driveApi(`${API}/about?fields=user(displayName)`)).json();
  n = String((j.user && j.user.displayName) || '').trim().split(/\s+/)[0].slice(0, 40);
  await settings.set('shareName', n);
  return n;
}

/** Nalog bez javnih linkova (posao, škola, dete, politika administratora): mali .gitara fajl. */
async function policyFallback(item, file) {
  const go = await dialog({ title: t('share.policyTitle'), body: t('share.policyBody'), buttons: [{ label: t('common.cancel'), value: null }, { label: t('share.sendFile'), value: 'file', kind: 'primary' }] });
  if (go !== 'file') return null;
  const f = new File([file.text], safeFileName(item.name) + FILE_EXT, { type: FILE_MIME });
  const note = t('share.fileNote', { name: item.name });
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ title: item.name, text: note, files: [f] }); return 'file'; } catch (e) { if (e && e.name === 'AbortError') return null; }
  }
  await shareFile(f, f.name, item.name);
  toast(t('share.fileSaved'));
  return 'file';
}

// ---------------- „Deljeno“ (Podešavanja) ----------------
/** Prestani da deliš: skida javnu dozvolu i briše fajl — link prestaje da radi (ko je već uvezao, zadržava kopiju). */
export async function stopSharing(fileId) {
  const drive = await import('./drive.js');
  await drive.shareToken({ interactive: false });
  try {
    for (const p of await readPerms(drive, fileId)) if (p.type === 'anyone') await drive.driveApi(`${API}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
    await drive.driveApi(`${API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
  } catch (e) { if (e.code !== 'notfound') throw e; }
  await saveShares((await getShares()).filter((r) => r.fileId !== fileId));
}
export const copyShareLink = (fileId) => copyLink(shareLinkOf(fileId));
/** Primalac u pogrešnom pregledaču (iOS…): kopiraj link da se otvori u pregledaču / aplikaciji. */
export const copyShareLinkText = (link) => copyLink(link, t('share.r.copied'));

/** Pri pokretanju (tiho, samo uz važeći token): fajlovi u „Gitara – deljeno“ bez zapisa (prekinuto deljenje) se brišu. */
export async function cleanupOrphans() {
  const folder = await settings.get('shareFolder', '');
  if (!folder || navigator.onLine === false) return 0;
  const drive = await import('./drive.js');
  if (!(await drive.shareTokenQuiet())) return 0;
  const known = new Set((await getShares()).map((r) => r.fileId));
  const q = `'${folder}' in parents and trashed=false`;
  const files = (await (await drive.driveApi(`${API}/files?spaces=drive&pageSize=200&fields=files(id,createdTime,appProperties)&q=${encodeURIComponent(q)}`)).json()).files || [];
  let n = 0;
  for (const f of files) {
    if (known.has(f.id) || !(f.appProperties && f.appProperties.gitaraShare)) continue;
    if (Date.now() - (Date.parse(f.createdTime) || 0) < ORPHAN_MS) continue; // deljenje je možda upravo u toku (druga kartica)
    await drive.driveApi(`${API}/files/${encodeURIComponent(f.id)}`, { method: 'DELETE' }).catch(() => {});
    n++;
  }
  return n;
}
