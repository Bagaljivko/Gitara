// Google Drive rezervna kopija (Google Identity Services + Drive REST API v3, direktno iz pregledača).
// Koristi samo opseg drive.file: aplikacija vidi isključivo fajlove koje je sama napravila.
// Nema client secret-a — token client radi samo sa javnim Client ID-jem.
import { songs as db, settings, events } from './db.js';
import { normalizeSong, SongFormatError, safeFileName, songExtras } from './songformat.js';
import { toast, dialog } from './ui.js';
import { t, songsCount, setLang } from './i18n.js';

const CLIENT_ID = '633765324865-ki9jk8hvnt9cfqbsemipfl8f796g3s1v.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GIS_URL = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_NAME = 'Gitara';
const BACKUP_NAME = 'gitara-backup.json';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const BACKUP_DELAY = 4000; // ms posle izmene
const BACKUP_SETTINGS = ['a4', 'geminiModel', 'lang']; // Gemini ključ se NIKAD ne šalje na Drive

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
  if (state.token) await settings.set('driveToken', { t: state.token, exp: state.tokenExp });
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
      if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
        return p.reject(new DriveError(t('drive.e.scope'), 'denied'));
      }
      p.resolve(resp);
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

/** Traži token. interactive=false: tihi pokušaj (bez izbora naloga). */
async function requestToken({ interactive }) {
  await loadGis();
  const client = getTokenClient();
  if (pendingToken) pendingToken.reject(new DriveError(t('drive.e.cancelled'), 'cancelled'));
  const resp = await new Promise((resolve, reject) => {
    pendingToken = { resolve, reject };
    const opts = { prompt: interactive ? (state.email ? '' : 'select_account') : 'none' };
    if (state.email) opts.login_hint = state.email;
    try { client.requestAccessToken(opts); } catch (e) { pendingToken = null; reject(new DriveError(t('drive.e.auth'), 'auth')); }
  });
  state.token = resp.access_token;
  state.tokenExp = Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 60000;
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
    if (res.status === 403) throw new DriveError(t('drive.e.forbidden'), 'denied');
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
async function buildBackup() {
  const all = await db.all();
  const s = {};
  for (const k of BACKUP_SETTINGS) { const v = await settings.get(k); if (v !== undefined) s[k] = v; }
  return {
    app: 'gitara', version: 1, type: 'backup', exportedAt: new Date().toISOString(),
    songs: all.map((sg) => ({ id: sg.id, title: sg.title, artist: sg.artist, key: sg.key, sections: sg.sections, transpose: sg.transpose || 0, createdAt: sg.createdAt, updatedAt: sg.updatedAt, ...songExtras(sg) })),
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
  const res = await api(`${API}/files/${f.id}?alt=media`);
  let data;
  try { data = await res.json(); } catch { throw new DriveError(t('drive.e.corrupt'), 'format'); }
  if (!data || data.app !== 'gitara' || !Array.isArray(data.songs)) throw new DriveError(t('drive.e.notBackup'), 'format');
  const songs = [];
  for (const s of data.songs) {
    try {
      const n = normalizeSong(s);
      songs.push({ ...n, id: typeof s.id === 'string' ? s.id.slice(0, 80) : undefined, createdAt: Number(s.createdAt) || undefined, updatedAt: Number(s.updatedAt) || undefined });
    } catch (e) { if (!(e instanceof SongFormatError)) throw e; }
  }
  const st = {};
  if (data.settings && typeof data.settings === 'object') {
    const a4 = Number(data.settings.a4);
    if (a4 >= 430 && a4 <= 450) st.a4 = a4;
    if (data.settings.lang === 'sr' || data.settings.lang === 'en') st.lang = data.settings.lang;
    if (typeof data.settings.geminiModel === 'string' && /^[a-z0-9][a-z0-9.\-]{1,80}$/i.test(data.settings.geminiModel)) st.geminiModel = data.settings.geminiModel;
  }
  return { songs, settings: st, modified: Date.parse(f.modifiedTime) || 0 };
}

const sig = (s) => JSON.stringify([String(s.title || '').trim().toLowerCase(), String(s.artist || '').trim().toLowerCase(), s.sections]);

/** Vraća pesme. mode: 'replace' | 'merge'. Vraća broj dodatih pesama. */
export async function applyRestore(backup, mode) {
  let added = 0;
  if (mode === 'replace') {
    await db.clear();
    for (const s of backup.songs) { await db.put({ ...s, id: s.id || undefined, createdAt: s.createdAt || Date.now(), updatedAt: s.updatedAt || Date.now() }).catch(() => db.save(s)); added++; }
  } else {
    const local = await db.all();
    const haveSig = new Set(local.map(sig));
    const haveId = new Set(local.map((s) => s.id));
    for (const s of backup.songs) {
      if (haveSig.has(sig(s))) continue; // ista pesma već postoji
      const rec = { ...s };
      if (!rec.id || haveId.has(rec.id)) delete rec.id; // ista oznaka, drugačiji sadržaj → zadrži obe
      await db.save(rec);
      haveSig.add(sig(s));
      added++;
    }
  }
  for (const [k, v] of Object.entries(backup.settings || {})) {
    if (k === 'lang') await setLang(v); // jezik se primenjuje odmah
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
  await requestToken({ interactive: true });
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
  if (!local.length && existing) {
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
  const t = state.token;
  Object.assign(state, { connected: false, email: '', folderId: '', backupId: '', lastBackup: 0, token: '', tokenExp: 0, needsReconnect: false, pending: false, lastError: '' });
  clearTimeout(timer);
  hideReconnectBanner();
  await settings.remove('drive');
  await settings.remove('driveToken');
  emit();
  if (t && window.google && google.accounts && google.accounts.oauth2) {
    try { google.accounts.oauth2.revoke(t, () => {}); } catch {}
  }
}

let offered = false;
async function offerRestore() {
  if (offered) return;
  offered = true;
  const ok = await dialog({
    title: t('drive.title'),
    body: t('drive.offerBody'),
    buttons: [{ label: t('drive.notNow'), value: false }, { label: t('drive.restoreSongs'), value: true, kind: 'primary' }],
  });
  if (!ok) return;
  try {
    const backup = await readBackup();
    if (!backup) return;
    const n = await applyRestore(backup, 'replace');
    toast(t('drive.restoredN', { n }));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch (e) {
    toast(e instanceof DriveError ? e.message : t('drive.e.restoreFailed'), 'error');
  }
}

// ---------------- Automatska rezervna kopija ----------------
let timer = 0;
let retryDelay = 30000;
let suppress = 0;

export function scheduleBackup(delay = BACKUP_DELAY) {
  if (!state.connected) return;
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

// ---------------- Pokretanje ----------------
export async function initDrive() {
  const saved = await settings.get('drive', null);
  if (saved && saved.connected) {
    Object.assign(state, saved);
    const tok = await settings.get('driveToken', null);
    if (tok && tok.exp > Date.now()) { state.token = tok.t; state.tokenExp = tok.exp; }
  }
  events.addEventListener('songs-changed', () => { if (!suppress) scheduleBackup(); });
  events.addEventListener('settings-changed', (e) => { if (!suppress && BACKUP_SETTINGS.includes(e.detail)) scheduleBackup(); });
  window.addEventListener('online', () => { if (state.pending) scheduleBackup(1500); });
  emit();
  if (!state.connected) return;
  if (state.pending) scheduleBackup(3000);
  // Prazna biblioteka (npr. podaci su obrisani) → ponudi vraćanje ako je token još važeći.
  if (state.token && navigator.onLine !== false) {
    const local = await db.all();
    if (!local.length) {
      try { if (await findBackup()) await offerRestore(); } catch {}
    }
  }
}

