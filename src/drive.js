// Google Drive rezervna kopija (Google Identity Services + Drive REST API v3, direktno iz pregledača).
// Koristi samo opseg drive.file: aplikacija vidi isključivo fajlove koje je sama napravila.
// U aplikaciji nema client secret-a (samo javni Client ID); tajni deo je samo u pomoćniku (tools/token-helper.gs).
import { songs as db, settings, events } from './db.js';
import { mergeSongs } from './songSync.js';
import { cleanPractice, cleanSkale, mergeSkale, mergePractice } from './syncMerge.js';
import { normalizeSong, SongFormatError, safeFileName, songExtras, songMeta, cleanRecording } from './songformat.js';
import { cleanPattern } from './rhythm.js';
import { cleanFolders, cleanSetlists, cleanSongFolders, mergeById } from './collections.js';
import { toast, dialog } from './ui.js';
import { t, songsCount, setLang } from './i18n.js';
import { TOKEN_HELPER } from './shareConfig.js';

const CLIENT_ID = '633765324865-ki9jk8hvnt9cfqbsemipfl8f796g3s1v.apps.googleusercontent.com';
const SCOPE_FILE = 'https://www.googleapis.com/auth/drive.file';
const SCOPE_APPDATA = 'https://www.googleapis.com/auth/drive.appdata'; // sinhronizacija: skrivena fascikla aplikacije
const SCOPE = SCOPE_FILE + ' ' + SCOPE_APPDATA;
/** Sinhronizacija je uključena: stara rezervna kopija (fajl u folderu „Gitara“) se više ne menja sama. */
const syncOn = () => { try { return !!(JSON.parse(localStorage.getItem('gitara-sync') || 'null') || {}).on; } catch { return false; } };
const GIS_URL = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_NAME = 'Gitara';
const BACKUP_NAME = 'gitara-backup.json';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const BACKUP_DELAY = 4000; // ms posle izmene
export const BACKUP_SETTINGS = ['a4', 'geminiModel', 'geminiModelSel', 'lang', 'metBpm', 'folders', 'setlists', 'tunerRoom', 'tuning', 'wakeMode', 'wakeMinutes', 'noteNames', 'practice', 'freeplayRecs', 'skale', 'myRhythms', 'strumSuggest']; // Gemini ključ se NIKAD ne šalje na Drive

export class DriveError extends Error {
  constructor(message, code = '') { super(message); this.code = code; }
}

// ---------------- Stanje ----------------
const state = {
  connected: false,
  email: '',
  folderId: '',
  backupId: '',
  lastBackup: 0,
  token: '',
  tokenExp: 0,
  tokenSync: false, // token važi i za sinhronizaciju (drive.appdata)
  tokenFile: false, // token važi za fajlove koje aplikacija pravi (drive.file: rezervna kopija, deljenje)
  needsReconnect: false,
  busy: false,
  pending: false,
  lastError: '',
};
const listeners = new Set();
export const driveState = () => ({ ...state });
export function onDriveChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach((fn) => { try { fn(driveState()); } catch {} }); }

async function persist() {
  await settings.set('drive', {
    connected: state.connected, email: state.email, folderId: state.folderId, backupId: state.backupId,
    lastBackup: state.lastBackup, pending: state.pending,
  });
  // Token je kratkotrajan (oko 1 h); čuvamo ga da bi preživeo ponovno otvaranje aplikacije.
  if (state.token) await settings.set('driveToken', { t: state.token, exp: state.tokenExp, s: state.tokenSync ? 2 : 1, f: state.tokenFile ? 1 : 0 });
  else await settings.remove('driveToken');
}

// ---------------- Google Identity Services ----------------
let gisPromise = null;
function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if (navigator.onLine === false) return Promise.reject(new DriveError(t('drive.e.offline'), 'offline'));
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_URL;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gisPromise = null; s.remove(); reject(new DriveError(t('drive.e.gisLoad'), 'offline')); };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

let tokenClient = null;
let pendingToken = null;

function getTokenClient() {
  if (tokenClient) return tokenClient;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: (resp) => {
      const p = pendingToken; pendingToken = null;
      if (!p) return;
      if (resp.error) {
        const denied = resp.error === 'access_denied';
        return p.reject(new DriveError(denied ? t('drive.e.denied') : t('drive.e.auth'), denied ? 'denied' : 'auth'));
      }
      const file = google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE_FILE), app = google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE_APPDATA);
      if (!(p.need === 'sync' ? app : file)) return p.reject(new DriveError(t('drive.e.scope'), 'denied'));
      p.resolve({ ...resp, file, app });
    },
    error_callback: (err) => {
      const p = pendingToken; pendingToken = null;
      if (!p) return;
      if (err && err.type === 'popup_closed') p.reject(new DriveError(t('drive.e.cancelled'), 'cancelled'));
      else if (err && err.type === 'popup_failed_to_open') p.reject(new DriveError(t('drive.e.popup'), 'popup'));
      else p.reject(new DriveError(t('drive.e.auth'), 'auth'));
    },
  });
  return tokenClient;
}

// ---------------- Dugotrajna dozvola (bez Google prozora pri obnavljanju) ----------------
// Kratki ključ (1 h) se obnavlja kroz Google-ov prozor koji se na telefonu na tren pokaže (beli bljesak posle sat
// vremena). Sa pomoćnikom (Apps Script sa tajnim delom prijave): jednom „Dozvoli“, posle toga se ključ obnavlja običnim
// zahtevom, bez ikakvog prozora. Dozvola je SAMO na ovom telefonu (ne sinhronizuje se, nije u rezervnoj kopiji).
const RT_KEY = 'driveRT';
const helperUrl = () => (typeof globalThis.__gitaraTokenHelper === 'string' ? globalThis.__gitaraTokenHelper : TOKEN_HELPER);
async function helper(body) {
  const ctrl = new AbortController(), tm = setTimeout(() => ctrl.abort(), 20000);
  try {
    // običan tekst (bez „preflight“ zahteva) — tako Apps Script prima POST sa drugog sajta
    const res = await fetch(helperUrl(), { method: 'POST', body: JSON.stringify(body), signal: ctrl.signal, redirect: 'follow' });
    return await res.json();
  } finally { clearTimeout(tm); }
}
const scopesOf = (s) => ({ file: /drive\.file/.test(s || ''), app: /drive\.appdata/.test(s || '') });
function useAccess(r, need) {
  const sc = scopesOf(r.scope);
  if (need === 'sync' ? !sc.app : !sc.file) return false;
  state.token = r.access_token;
  state.tokenExp = Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60000;
  state.tokenSync = sc.app; state.tokenFile = sc.file; state.needsReconnect = false;
  return true;
}
/** Tiho obnavljanje (bez prozora): true ako je dobijen nov ključ. */
async function refreshQuiet(need) {
  if (!helperUrl() || navigator.onLine === false) return false;
  const saved = await settings.get(RT_KEY, null);
  if (!saved || !saved.rt) return false;
  let r;
  try { r = await helper({ a: 'refresh', rt: saved.rt }); } catch { return false; }
  if (r && r.error === 'invalid_grant') { await settings.remove(RT_KEY); return false; } // dozvola opozvana / istekla
  if (!r || !r.access_token || !useAccess({ ...r, scope: r.scope || saved.scope }, need)) return false;
  await persist(); emit();
  return true;
}
/** Ima li ovaj telefon dugotrajnu dozvolu (nema Google prozora pri obnavljanju)? */
export async function hasLongAccess() { return !!helperUrl() && !!(await settings.get(RT_KEY, null)); }
export const tokenHelperOn = () => !!helperUrl();
/** Na dodir: Google pita „Dozvoli“ (jednom), pomoćnik menja kod za ključ i dugotrajnu dozvolu. */
async function codeFlow({ need, hint, pick }) {
  await loadGis();
  const code = await new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initCodeClient({
      client_id: CLIENT_ID, scope: need === 'sync' ? SCOPE : SCOPE_FILE, ux_mode: 'popup', include_granted_scopes: true,
      ...(hint && !pick ? { hint } : {}), ...(pick ? { select_account: true } : {}),
      callback: (resp) => (resp && resp.code ? resolve(resp.code) : reject(new DriveError(resp && resp.error === 'access_denied' ? t('drive.e.denied') : t('drive.e.auth'), resp && resp.error === 'access_denied' ? 'denied' : 'auth'))),
      error_callback: (err) => reject(err && err.type === 'popup_closed' ? new DriveError(t('drive.e.cancelled'), 'cancelled') : err && err.type === 'popup_failed_to_open' ? new DriveError(t('drive.e.popup'), 'popup') : new DriveError(t('drive.e.auth'), 'auth')),
    });
    client.requestCode();
  });
  let r = null;
  try { r = await helper({ a: 'exchange', code }); } catch { r = null; }
  if (!r || !r.access_token) throw new DriveError(t('drive.e.auth'), 'helper');
  if (!useAccess(r, need)) throw new DriveError(t('drive.e.scope'), 'denied');
  if (r.refresh_token) await settings.set(RT_KEY, { rt: r.refresh_token, scope: r.scope || '' });
  await persist(); emit();
  return state.token;
}

/** Traži token. interactive=false: tihi pokušaj (bez izbora naloga). */
async function requestToken({ interactive, need = 'file', hint = '', pick = false }) {
  // 1) dugotrajna dozvola: nov ključ bez ikakvog prozora
  if (!interactive && (await refreshQuiet(need))) return state.token;
  // 2) na dodir, sa pomoćnikom: jednom „Dozvoli“ → posle toga nikad više prozor pri obnavljanju
  if (interactive && helperUrl()) {
    try { return await codeFlow({ need, hint: hint || state.email, pick }); }
    catch (e) { if (['cancelled', 'denied', 'popup', 'offline'].includes(e && e.code)) throw e; } // pomoćnik ne radi: kao ranije
  }
  // 3) kao ranije (kratki ključ; bez pomoćnika / dozvole Google na tren otvori svoj prozor)
  await loadGis();
  const client = getTokenClient();
  if (pendingToken) pendingToken.reject(new DriveError(t('drive.e.cancelled'), 'cancelled'));
  const resp = await new Promise((resolve, reject) => {
    pendingToken = { resolve, reject, need };
    const who = hint || state.email;
    const opts = { prompt: interactive ? (who && !pick ? '' : 'select_account') : 'none' };
    if (who && !pick) opts.login_hint = who;
    // samo opseg koji je sada potreban (rezervna kopija / deljenje: drive.file; sinhronizacija: oba) — ranije dozvole ostaju
    opts.scope = need === 'sync' ? SCOPE : SCOPE_FILE;
    opts.include_granted_scopes = true;
    try { client.requestAccessToken(opts); } catch (e) { pendingToken = null; reject(new DriveError(t('drive.e.auth'), 'auth')); }
  });
  state.token = resp.access_token;
  state.tokenExp = Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 60000;
  state.tokenSync = !!resp.app;
  state.tokenFile = !!resp.file;
  state.needsReconnect = false;
  await persist();
  emit();
  return state.token;
}

async function getToken() {
  if (state.token && Date.now() < state.tokenExp) return state.token;
  try {
    return await requestToken({ interactive: false });
  } catch (e) {
    if (e.code === 'offline') throw e;
    state.token = '';
    state.needsReconnect = true;
    await persist();
    emit();
    showReconnectBanner();
    throw new DriveError(t('drive.e.expired'), 'reconnect');
  }
}

// ---------------- Token za sinhronizaciju (sync.js) ----------------
/** Token sa pristupom skrivenoj fascikli aplikacije. interactive: iz dodira korisnika (izbor naloga / dozvola).
 *  Tiho osvežavanje ne prikazuje ništa; ako ne uspe, sinhronizacija pokaže malo dugme „Poveži“. */
export async function syncToken({ interactive = false, force = false, hint = '', pick = false } = {}) {
  if (!interactive && !force && state.token && state.tokenSync && Date.now() < state.tokenExp) return { token: state.token, exp: state.tokenExp };
  if (!interactive && navigator.onLine === false) throw new DriveError(t('drive.e.offline'), 'offline');
  await requestToken({ interactive, need: 'sync', hint, pick });
  return { token: state.token, exp: state.tokenExp };
}
/** v1.70: sinhronizacioni ključ bez ikakvog Google zahteva — samo već sačuvan važeći ključ ili dugotrajna dozvola; inače null. */
export async function syncTokenStored() {
  await initDrive().catch(() => {});
  if (state.token && state.tokenSync && Date.now() < state.tokenExp) return { token: state.token, exp: state.tokenExp };
  if (await refreshQuiet('sync').catch(() => false)) return { token: state.token, exp: state.tokenExp };
  return null;
}
// ---------------- Deljenje (shareService.js) ----------------
/** Token za fajlove koje aplikacija pravi (drive.file) — traži se tek pri prvom deljenju. interactive: iz dodira. */
export async function shareToken({ interactive = false } = {}) {
  if (!interactive && state.token && state.tokenFile && Date.now() < state.tokenExp) return state.token;
  if (!interactive && navigator.onLine === false) throw new DriveError(t('drive.e.offline'), 'offline');
  await requestToken({ interactive, need: 'file' });
  return state.token;
}
/** Važeći token za deljenje bez ikakvog prozora (za čišćenje pri pokretanju), ili ''. */
export async function shareTokenQuiet() { await initDrive().catch(() => {}); return state.token && state.tokenFile && Date.now() < state.tokenExp ? state.token : ''; }
/** Drive REST sa tokenom (greške kao DriveError: offline, denied, notfound, storage, rate, reconnect…). */
export const driveApi = (url, opts) => api(url, opts);

/** Odjava sinhronizacije: token se opoziva samo ako ga ni stara rezervna kopija ne koristi. */
export async function syncSignOut() {
  if (state.connected) return;
  const tk = state.token;
  Object.assign(state, { token: '', tokenExp: 0, tokenSync: false });
  await settings.remove('driveToken');
  await forgetLongAccess();
  if (tk && window.google && google.accounts && google.accounts.oauth2) { try { google.accounts.oauth2.revoke(tk, () => {}); } catch {} }
}
/** Stara rezervna kopija (gitara-backup.json) — samo čitanje, bez pravljenja foldera (za jednokratni prelazak). */
export async function readOldBackup() {
  const files = await findFiles(`name='${BACKUP_NAME}' and trashed=false`);
  if (!files.length) return null;
  return parseBackup(files[0]);
}

// ---------------- Drive REST ----------------
async function api(url, opts = {}, retry = true) {
  if (navigator.onLine === false) throw new DriveError(t('drive.e.noNet'), 'offline');
  const token = await getToken();
  let res;
  try {
    res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  } catch {
    throw new DriveError(t('drive.e.network'), 'offline');
  }
  if (res.status === 401 && retry) {
    state.token = ''; state.tokenExp = 0;
    return api(url, opts, false);
  }
  if (!res.ok) {
    let msg = '';
    try { const j = await res.json(); msg = (j.error && (j.error.message || '')) + ' ' + JSON.stringify((j.error && j.error.errors) || ''); } catch {}
    if (res.status === 401) { state.needsReconnect = true; emit(); showReconnectBanner(); throw new DriveError(t('drive.e.expired'), 'reconnect'); }
    if (res.status === 403 && /rate|quota|limit/i.test(msg)) throw new DriveError(t('drive.e.rate'), 'rate');
    if (res.status === 403 && /storage|space/i.test(msg)) throw new DriveError(t('drive.e.storage'), 'storage');
    if (res.status === 403) throw Object.assign(new DriveError(t('drive.e.forbidden'), 'denied'), { reason: msg });
    if (res.status === 404) throw new DriveError(t('drive.e.notFound'), 'notfound');
    if (res.status >= 500) throw new DriveError(t('drive.e.server'), 'server');
    throw new DriveError(msg.trim() ? t('drive.e.httpMsg', { msg: msg.trim().slice(0, 120) }) : t('drive.e.http'), 'http');
  }
  return res;
}

const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function findFiles(query, fields = 'files(id,name,modifiedTime)') {
  const url = `${API}/files?spaces=drive&pageSize=10&orderBy=modifiedTime desc&fields=${encodeURIComponent(fields)}&q=${encodeURIComponent(query)}`;
  return (await (await api(url)).json()).files || [];
}

async function ensureFolder() {
  if (state.folderId) {
    try {
      const f = await (await api(`${API}/files/${state.folderId}?fields=id,trashed`)).json();
      if (!f.trashed) return state.folderId;
    } catch (e) { if (e.code !== 'notfound') throw e; }
  }
  const found = await findFiles(`name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`);
  if (found.length) state.folderId = found[0].id;
  else {
    const res = await api(`${API}/files?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
    });
    state.folderId = (await res.json()).id;
  }
  state.backupId = '';
  await persist();
  return state.folderId;
}

async function findBackup() {
  const folder = await ensureFolder();
  const files = await findFiles(`name='${BACKUP_NAME}' and '${folder}' in parents and trashed=false`);
  state.backupId = files.length ? files[0].id : '';
  return files[0] || null;
}

/** Kreira ili menja fajl (multipart upload). */
async function uploadFile({ id, name, mime, blob, parents, appProperties }) {
  const meta = { name, mimeType: mime };
  if (!id && parents) meta.parents = parents;
  if (appProperties) meta.appProperties = appProperties;
  const boundary = 'gitara' + Math.random().toString(36).slice(2);
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, blob, `\r\n--${boundary}--`,
  ]);
  const url = id ? `${UPLOAD}/files/${id}?uploadType=multipart&fields=id,modifiedTime` : `${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`;
  const res = await api(url, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  return res.json();
}

// ---------------- Rezervna kopija ----------------
/** Spajanje rezultata (telefon + kopija): veći najbolji rezultat; niz i tempo sa skorije korišćenog. */
/** Moji snimci (Samo sviraj) iz rezervne kopije: samo poznat oblik, razumne granice (do 10 min, pragovi 0–12). */
function cleanFreeplayRecs(list) { // stari zapis (pre v1.37): pri otvaranju „Samo sviraj“ prelazi u pesme
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const r of list.slice(0, 200)) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string') continue;
    const c = cleanRecording(r);
    if (c) out.push({ v: 1, id: r.id.slice(0, 40), name: String(r.name || '').slice(0, 60) || r.id, created: Number(r.created) || 0, dur: c.dur, events: c.events });
  }
  return out;
}


/** v1.71: pesme za rezervnu kopiju (isti oblik kao ranije) + oznake obrisanih. */
export async function backupSongs() {
  const all = await db.all();
  return all.map((sg) => ({ id: sg.id, title: sg.title, artist: sg.artist, key: sg.key, sections: sg.sections, transpose: sg.transpose || 0, createdAt: sg.createdAt, updatedAt: sg.updatedAt, ...songExtras(sg), ...songMeta(sg), folders: sg.folders || [] }));
}
export const backupDeleted = () => db.deleted();

async function buildBackup() {
  const all = await db.all();
  const s = {};
  for (const k of BACKUP_SETTINGS) { const v = await settings.get(k); if (v !== undefined) s[k] = v; }
  return {
    app: 'gitara', version: 1, type: 'backup', exportedAt: new Date().toISOString(),
    deleted: await db.deleted(), // obrisane pesme (id → vreme): vraćanje ih ne donosi nazad
    songs: all.map((sg) => ({ id: sg.id, title: sg.title, artist: sg.artist, key: sg.key, sections: sg.sections, transpose: sg.transpose || 0, createdAt: sg.createdAt, updatedAt: sg.updatedAt, ...songExtras(sg), ...songMeta(sg), folders: sg.folders || [] })),
    settings: s,
  };
}

export async function backupNow() {
  if (!state.connected) throw new DriveError(t('drive.e.notConnected'), 'notconnected');
  state.busy = true; emit();
  try {
    const data = JSON.stringify(await buildBackup());
    const folder = await ensureFolder();
    if (!state.backupId) await findBackup();
    let r;
    try {
      r = await uploadFile({ id: state.backupId, name: BACKUP_NAME, mime: 'application/json', blob: new Blob([data], { type: 'application/json' }), parents: [folder] });
    } catch (e) {
      if (e.code !== 'notfound') throw e;
      state.backupId = '';
      r = await uploadFile({ name: BACKUP_NAME, mime: 'application/json', blob: new Blob([data], { type: 'application/json' }), parents: [folder] });
    }
    state.backupId = r.id;
    state.lastBackup = Date.parse(r.modifiedTime) || Date.now();
    state.pending = false;
    state.lastError = '';
    await persist();
    return state.lastBackup;
  } finally {
    state.busy = false; emit();
  }
}

/** Čita rezervnu kopiju sa Drive-a. Vraća { songs, settings, modified } ili null. */
export async function readBackup() {
  const f = await findBackup();
  if (!f) return null;
  return parseBackup(f);
}
async function parseBackup(f) {
  const res = await api(`${API}/files/${f.id}?alt=media`);
  let data;
  try { data = await res.json(); } catch { throw new DriveError(t('drive.e.corrupt'), 'format'); }
  return parseBackupData(data, Date.parse(f.modifiedTime) || 0);
}
/** v1.71: proverava i čisti sadržaj kopije (stari „gitara“ fajlovi i novi „marli“ — cela aplikacija ili samo pesme). */
export function parseBackupData(data, modified = 0) {
  if (!data || (data.app !== 'gitara' && data.app !== 'marli') || !Array.isArray(data.songs)) throw new DriveError(t('drive.e.notBackup'), 'format');
  const songs = [];
  for (const s of data.songs) {
    try {
      const n = normalizeSong(s);
      const folders = cleanSongFolders(s.folders);
      songs.push({ ...n, ...songMeta({ ...s, sections: n.sections }), ...(folders.length ? { folders } : {}), id: typeof s.id === 'string' ? s.id.slice(0, 80) : undefined, createdAt: Number(s.createdAt) || undefined, updatedAt: Number(s.updatedAt) || undefined });
    } catch (e) { if (!(e instanceof SongFormatError)) throw e; }
  }
  const st = {};
  if (data.settings && typeof data.settings === 'object') {
    const a4 = Number(data.settings.a4);
    if (a4 >= 430 && a4 <= 450) st.a4 = a4;
    if (data.settings.lang === 'sr' || data.settings.lang === 'en') st.lang = data.settings.lang;
    const bpm = Number(data.settings.metBpm);
    if (bpm >= 40 && bpm <= 220) st.metBpm = bpm;
    // Stari „tunerSens“ se namerno ne vraća (svi su prebačeni na „Auto“); vraća se samo novi izbor sobe.
    if (['auto', 'quiet', 'noisy'].includes(data.settings.tunerRoom)) st.tunerRoom = data.settings.tunerRoom;
    if (typeof data.settings.tuning === 'string') st.tuning = data.settings.tuning;
    const fr = cleanFreeplayRecs(data.settings.freeplayRecs);
    if (fr) st.freeplayRecs = fr; // Akordi → Samo sviraj: Moji snimci
    const pr = cleanPractice(data.settings.practice);
    if (pr) st.practice = pr; // Vežbe: najbolji rezultati, nizovi i poslednji tempo (po igri i po pesmi)
    const sk = cleanSkale(data.settings.skale);
    if (sk) st.skale = sk; // Vežbe → Skale: napredak i put
    if (['songs', 'active', 'never'].includes(data.settings.wakeMode)) st.wakeMode = data.settings.wakeMode;
    if (['auto', 'sr', 'en'].includes(data.settings.noteNames)) st.noteNames = data.settings.noteNames;
    if ([5, 10, 20].includes(Number(data.settings.wakeMinutes))) st.wakeMinutes = Number(data.settings.wakeMinutes);
    if (typeof data.settings.strumSuggest === 'boolean') st.strumSuggest = data.settings.strumSuggest; // Pesme → „Predlaži ritam“
    if (Array.isArray(data.settings.myRhythms)) { // „Moji ritmovi“ (sopstveni obrasci udaranja)
      const mr = data.settings.myRhythms.map((x) => { const c = x && cleanPattern(x); return c && typeof x.id === 'string' ? { id: x.id.slice(0, 40), name: c.name || '', sig: c.sig, steps: c.steps, ...(c.swing ? { swing: true } : {}) } : null; }).filter(Boolean).slice(-60);
      if (mr.length) st.myRhythms = mr;
    }
    const fo = cleanFolders(data.settings.folders);
    if (fo) st.folders = fo;
    const sl = cleanSetlists(data.settings.setlists);
    if (sl) st.setlists = sl;
    const ms = data.settings.geminiModelSel;
    if (ms === 'auto' || (typeof ms === 'string' && /^[a-z0-9][a-z0-9.\-]{1,80}$/i.test(ms))) st.geminiModelSel = ms;
    if (typeof data.settings.geminiModel === 'string' && /^[a-z0-9][a-z0-9.\-]{1,80}$/i.test(data.settings.geminiModel)) st.geminiModel = data.settings.geminiModel;
  }
  const deleted = {};
  if (data.deleted && typeof data.deleted === 'object') for (const [id, at] of Object.entries(data.deleted)) if (id.length <= 80 && Number(at) > 0) deleted[id] = Number(at);
  return { songs, deleted, settings: st, modified: modified || Date.parse(data.exportedAt) || 0 };
}

// ---------------- v1.71: „Cela aplikacija“ i „Samo pesme“ na Drive-u (folder „Gitara“) ----------------
export const BK_FULL = 'MARLI – cela aplikacija.json';
export const BK_SONGS = 'MARLI – pesme.json';
/** Sačuvaj (zameni) kopiju pod tim imenom. Vraća vreme izmene. Poziva se iz dodira (može da traži dozvolu). */
/** v1.73: ključ za fajlove na Drive-u — prvo bez prozora (važeći ili tiho obnovljen preko pomoćnika), tek onda prozor.
 *  Poziva se odmah na dodir (pre pripreme kopije), jer telefon blokira Google prozor ako od dodira prođe previše vremena. */
export async function fileToken() {
  await initDrive().catch(() => {});
  if (state.token && state.tokenFile && Date.now() < state.tokenExp) return state.token;
  if (await refreshQuiet('file').catch(() => false)) return state.token;
  return shareToken({ interactive: true });
}
export async function saveNamed(name, json) {
  await fileToken();
  const folder = await ensureFolder();
  const files = await findFiles(`name='${q(name)}' and '${folder}' in parents and trashed=false`);
  const r = await uploadFile({ id: files[0] && files[0].id, name, mime: 'application/json', blob: new Blob([json], { type: 'application/json' }), parents: [folder] });
  return Date.parse(r.modifiedTime) || Date.now();
}
/** Najnovija kopija pod tim imenom: { data, modified } ili null. */
export async function readNamed(name) {
  await fileToken();
  const files = await findFiles(`name='${q(name)}' and trashed=false`);
  if (!files.length) return null;
  const res = await api(`${API}/files/${files[0].id}?alt=media`);
  let data;
  try { data = await res.json(); } catch { throw new DriveError(t('drive.e.corrupt'), 'format'); }
  return { data, modified: Date.parse(files[0].modifiedTime) || 0 };
}
/** Bez ikakvog prozora: kada je kopija pod tim imenom poslednji put sačuvana. { modified } | null (nema je) | undefined (ne zna se). */
export async function peekNamed(name) {
  try {
    if (navigator.onLine === false) return undefined;
    if (!(await shareTokenQuiet()) && !(await syncTokenStored())) return undefined;
    const files = await findFiles(`name='${q(name)}' and trashed=false`);
    return files.length ? { modified: Date.parse(files[0].modifiedTime) || 0 } : null;
  } catch { return undefined; }
}
/** Stara automatska kopija (gitara-backup.json) kao sirovi podaci, ili null. */
export async function readOldNamed() { return readNamed(BACKUP_NAME); }

/** Vraća pesme. mode: 'replace' (zameni sve) | 'merge' (spoji po ID-u). Vraća broj dodatih (ili ažuriranih) pesama.
 *  Nikad ne pravi drugu kopiju iste pesme i ne vraća obrisane (oznake brisanja i ovde i u kopiji). */
export async function applyRestore(backup, mode, { revive = false } = {}) {
  if (mode === 'replace') await db.clear();
  const r = await mergeSongs(backup.songs, revive ? { revive: true } : { deleted: backup.deleted || {} });
  const added = r.added + (mode === 'merge' ? r.updated : 0);
  for (const [k, v] of Object.entries(backup.settings || {})) {
    if (k === 'lang') await setLang(v); // jezik se primenjuje odmah
    else if (mode === 'merge' && (k === 'folders' || k === 'setlists')) await settings.set(k, mergeById((await settings.get(k, [])) || [], v));
    else if (mode === 'merge' && k === 'practice') await settings.set(k, mergePractice(await settings.get(k, null), v));
    else if (mode === 'merge' && k === 'skale') await settings.set(k, mergeSkale(await settings.get(k, null), v));
    else if (mode === 'merge' && k === 'myRhythms') await settings.set(k, mergeById((await settings.get(k, [])) || [], v));
    else if (mode === 'merge' && k === 'freeplayRecs') await settings.set(k, mergeById((await settings.get(k, [])) || [], v));
    else await settings.set(k, v);
  }
  return added;
}

/** Ceo tok vraćanja sa pitanjem „zameni ili spoji“. Vraća true ako je nešto vraćeno. */
export async function restoreFlow() {
  const backup = await readBackup();
  if (!backup) { await dialog({ title: t('drive.noBackupTitle'), body: t('drive.noBackupBody') }); return false; }
  if (!backup.songs.length) { await dialog({ title: t('drive.emptyTitle'), body: t('drive.emptyBody') }); return false; }
  const local = await db.all();
  let mode = 'replace';
  if (local.length) {
    mode = await dialog({
      title: t('drive.restoreTitle'),
      body: t('drive.restoreBody', { driveN: songsCount(backup.songs.length), date: formatDate(backup.modified), localN: songsCount(local.length) }),
      buttons: [
        { label: t('common.cancel'), value: null },
        { label: t('drive.merge'), value: 'merge' },
        { label: t('drive.replaceAll'), value: 'replace', kind: 'danger' },
      ],
    });
    if (!mode) return false;
  }
  const n = await applyRestore(backup, mode);
  toast(mode === 'merge' ? (n ? t('drive.merged', { n }) : t('drive.mergedNone')) : t('drive.restoredN', { n }));
  return true;
}

export function plural(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'pesma';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'pesme';
  return 'pesama';
}

export function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return t('drive.date', { d: p(d.getDate()), m: p(d.getMonth() + 1), y: d.getFullYear(), hh: p(d.getHours()), mm: p(d.getMinutes()) });
}

// ---------------- Povezivanje ----------------
export async function connect() {
  if (navigator.onLine === false) throw new DriveError(t('drive.e.offline'), 'offline');
  state.email = state.email || '';
  await requestToken({ interactive: true, need: 'sync' }); // v1.70: oba ovlašćenja odjednom — posle toga se sinhronizacija uključuje bez novog prozora
  const about = await (await api(`${API}/about?fields=user(emailAddress,displayName)`)).json();
  state.email = (about.user && about.user.emailAddress) || '';
  state.connected = true;
  state.needsReconnect = false;
  hideReconnectBanner();
  await ensureFolder();
  await persist();
  emit();
  // Prazna biblioteka + postojeća kopija → ponudi vraćanje; inače odmah napravi kopiju.
  const local = await db.all();
  const existing = await findBackup();
  if (!local.length && existing && !(await alreadyAsked())) {
    await offerRestore();
  } else if (local.length) {
    await backupNow().catch(() => scheduleBackup());
  }
}

/** Ponovo poveži (posle isteka tokena) — mora da se pozove iz klika korisnika. */
export async function reconnect() {
  await requestToken({ interactive: true });
  hideReconnectBanner();
  if (state.pending) scheduleBackup(500);
}

export async function disconnect() {
  const t = state.token, keep = syncOn(); // sinhronizacija koristi isti token — ostaje
  Object.assign(state, { connected: false, email: '', folderId: '', backupId: '', lastBackup: 0, needsReconnect: false, pending: false, lastError: '' }, keep ? {} : { token: '', tokenExp: 0, tokenSync: false });
  clearTimeout(timer);
  hideReconnectBanner();
  await settings.remove('drive');
  if (!keep) { await settings.remove('driveToken'); await forgetLongAccess(); }
  emit();
  if (t && !keep && window.google && google.accounts && google.accounts.oauth2) {
    try { google.accounts.oauth2.revoke(t, () => {}); } catch {}
  }
}

// Ponuda za vraćanje se pokazuje samo jednom po instalaciji: odgovor (Vrati / Ne sada) se pamti
// na uređaju (IndexedDB, nije deo rezervne kopije), pa se briše samo ako se obrišu podaci aplikacije.
const ASKED_KEY = 'driveRestoreAsked';
let offering = false;
const alreadyAsked = async () => !!(await settings.get(ASKED_KEY, false));

async function offerRestore() {
  if (offering || (await alreadyAsked())) return;
  if (await db.count()) return; // biblioteka već ima pesme — ne pitaj
  offering = true;
  try {
    const ok = await dialog({
      title: t('drive.title'),
      body: t('drive.offerBody'),
      buttons: [{ label: t('drive.notNow'), value: false }, { label: t('drive.restoreSongs'), value: true, kind: 'primary' }],
      dismissible: false, // korisnik mora da odgovori, da bi se odgovor zapamtio
    });
    await settings.set(ASKED_KEY, true);
    if (!ok) return;
    const backup = await readBackup();
    if (!backup) return;
    const n = await applyRestore(backup, 'replace');
    toast(t('drive.restoredN', { n }));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch (e) {
    toast(e instanceof DriveError ? e.message : t('drive.e.restoreFailed'), 'error');
  } finally {
    offering = false;
  }
}

// ---------------- Automatska rezervna kopija ----------------
let timer = 0;
let retryDelay = 30000;
let suppress = 0;

export function scheduleBackup(delay = BACKUP_DELAY) {
  if (!state.connected || syncOn()) return;
  if (!state.pending) { state.pending = true; persist(); emit(); }
  clearTimeout(timer);
  timer = setTimeout(runScheduled, delay);
}

async function runScheduled() {
  if (!state.connected || !state.pending) return;
  if (navigator.onLine === false) { state.lastError = t('drive.waitingNet'); emit(); return; } // 'online' događaj pokreće ponovo
  if (state.busy) { scheduleBackup(2000); return; }
  try {
    await backupNow();
    retryDelay = 30000;
  } catch (e) {
    state.lastError = e instanceof DriveError ? e.message : t('drive.e.backupFailed');
    emit();
    if (e.code === 'reconnect' || e.code === 'denied' || e.code === 'storage') return; // čeka korisnika
    clearTimeout(timer);
    timer = setTimeout(runScheduled, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 15 * 60000);
  }
}

/** Privremeno isključuje automatsku kopiju (npr. tokom vraćanja). */
export async function withoutAutoBackup(fn) {
  suppress++;
  try { return await fn(); } finally { suppress--; }
}

// ---------------- PDF na Drive ----------------
export async function savePdfToDrive(blob, song) {
  if (!state.connected) return false;
  const folder = await ensureFolder();
  const name = safeFileName(song.title) + '.pdf';
  const idKey = String(song.id || name).slice(0, 100);
  const existing = await findFiles(`'${folder}' in parents and trashed=false and appProperties has { key='gitaraSongId' and value='${q(idKey)}' }`);
  await uploadFile({ id: existing[0] && existing[0].id, name, mime: 'application/pdf', blob, parents: [folder], appProperties: { gitaraSongId: idKey } });
  return true;
}

// ---------------- „Ponovo poveži“ traka ----------------
function showReconnectBanner() {
  if (document.getElementById('driveBanner')) return;
  const el = document.createElement('div');
  el.id = 'driveBanner';
  el.className = 'drive-banner';
  el.setAttribute('role', 'alert');
  el.innerHTML = `<span>${t('drive.bannerText')}</span><button class="btn small primary" id="driveReconnect">${t('drive.reconnect')}</button><button class="icon-btn" id="driveBannerClose" aria-label="${t('common.close')}">✕</button>`;
  document.body.appendChild(el);
  el.querySelector('#driveReconnect').addEventListener('click', async () => {
    try { await reconnect(); toast(t('drive.bannerOk')); }
    catch (e) { toast(e instanceof DriveError ? e.message : t('drive.e.connectFailed'), 'error'); }
  });
  el.querySelector('#driveBannerClose').addEventListener('click', () => el.remove());
}
function hideReconnectBanner() { document.getElementById('driveBanner')?.remove(); }

/** Odjava: dugotrajna dozvola se opoziva kod Google-a i briše sa telefona. */
async function forgetLongAccess() {
  const saved = await settings.get(RT_KEY, null);
  await settings.remove(RT_KEY);
  if (saved && saved.rt) fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=' + encodeURIComponent(saved.rt) }).catch(() => {});
}

// ---------------- Pokretanje ----------------
// Priprema se jednom; svi pozivi čekaju istu pripremu (da niko ne vidi „nije povezan“ dok se stanje još čita)
let initP = null;
export function initDrive() { return initP || (initP = doInit()); }
async function doInit() {
  const saved = await settings.get('drive', null);
  if (saved && saved.connected) {
    Object.assign(state, saved);
  }
  const tok = await settings.get('driveToken', null);
  if (tok && tok.exp > Date.now()) { state.token = tok.t; state.tokenExp = tok.exp; state.tokenSync = tok.s === 2; state.tokenFile = tok.f === 1 || (tok.f === undefined && tok.s !== 2); }
  events.addEventListener('songs-changed', () => { if (!suppress) scheduleBackup(); });
  events.addEventListener('settings-changed', (e) => { if (!suppress && BACKUP_SETTINGS.includes(e.detail)) scheduleBackup(); });
  window.addEventListener('online', () => { if (state.pending) scheduleBackup(1500); });
  emit();
  if (!state.connected) return;
  if (state.pending) scheduleBackup(3000);
  // Prazna biblioteka (npr. podaci su obrisani) → ponudi vraćanje ako je token još važeći.
  if (state.token && navigator.onLine !== false && !syncOn()) { // sa sinhronizacijom pesme stižu same
    if (!(await db.count())) {
      try { if (!(await alreadyAsked()) && (await findBackup())) await offerRestore(); } catch {}
    }
  }
}

// Modul se učitava tek kad zatreba (povezan Drive pri pokretanju, ili Podešavanja / PDF) — tada se odmah i pripremi
initDrive().catch(() => {});
