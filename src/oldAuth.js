// v2.5.66: STARA Google veza (stari Cloud projekat) — SAMO za prelazak na novu vezu i kasnije čišćenje.
// Ovde je jedino mesto gde postoji stari Client ID. Stara prijava je sačuvana pod starim ključevima („driveToken“,
// „driveRT“) — tako ih je ostavila prethodna verzija aplikacije; novi kod koristi „…2“ i nikad ih ne meša.
// Tiho (bez ikakvog prozora): važeći stari ključ ili dugotrajna dozvola preko starog pomoćnika. Sa prozorom: samo
// kad korisnik dodirne dugme na ekranu prelaska (nastavnik/učenik bez sačuvane prijave, podaci samo na staroj vezi).
import { settings } from './db.js';

export const OLD_CLIENT_ID = '633765324865-ki9jk8hvnt9cfqbsemipfl8f796g3s1v.apps.googleusercontent.com';
export const OLD_TOKEN_HELPER = 'https://script.google.com/macros/s/AKfycbz3QlL7bSgg60Q1ckjMsUINLkaSoXxPQ5epNqiHTlVsHIA2pGxYbLsO64qpxa6_8nZu/exec';
const SCOPE_FILE = 'https://www.googleapis.com/auth/drive.file';
const SCOPE_APPDATA = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3';

let mem = null; // { t, exp, file, app }
const helperUrl = () => (typeof globalThis.__marliOldHelper === 'string' ? globalThis.__marliOldHelper : OLD_TOKEN_HELPER);
const valid = (x, need) => x && x.t && Date.now() < x.exp && (need === 'sync' ? x.app : x.file);

/** Da li postoje tragovi stare prijave na ovom uređaju (bez mreže). */
export async function hasOldSignIn() {
  return !!((await settings.get('driveRT', null)) || (await settings.get('driveToken', null)));
}

/** Stari ključ BEZ ikakvog prozora, ili '' . need: 'file' (fajlovi) ili 'sync' (skrivena fascikla). */
export async function oldTokenSilent(need = 'file') {
  if (valid(mem, need)) return mem.t;
  const tok = await settings.get('driveToken', null);
  if (tok && tok.t && tok.exp > Date.now() + 60000) {
    const x = { t: tok.t, exp: tok.exp, app: tok.s === 2, file: tok.f === 1 || (tok.f === undefined && tok.s !== 2) };
    if (valid(x, need)) { mem = x; return x.t; }
  }
  const saved = await settings.get('driveRT', null);
  if (!saved || !saved.rt || navigator.onLine === false) return '';
  try {
    const ctrl = new AbortController(), tm = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(helperUrl(), { method: 'POST', body: JSON.stringify({ a: 'refresh', rt: saved.rt }), signal: ctrl.signal, redirect: 'follow' }).finally(() => clearTimeout(tm));
    const r = await res.json();
    if (!r || !r.access_token) return '';
    const sc = r.scope || saved.scope || '';
    mem = { t: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60000, file: /drive\.file/.test(sc), app: /drive\.appdata/.test(sc) };
    return valid(mem, need) ? mem.t : '';
  } catch { return ''; }
}

/** Stari ključ uz Google prozor (samo na dodir). hint = imejl naloga. Vraća ključ ili baca grešku sa .code. */
export async function oldTokenInteractive(need = 'file', hint = '') {
  const silent = await oldTokenSilent(need); if (silent) return silent;
  if (!(window.google && google.accounts && google.accounts.oauth2)) {
    await new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = resolve; s.onerror = () => reject(Object.assign(new Error('gis'), { code: 'offline' })); document.head.appendChild(s); });
  }
  const scope = need === 'sync' ? SCOPE_FILE + ' ' + SCOPE_APPDATA : SCOPE_FILE;
  const resp = await new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: OLD_CLIENT_ID, scope,
      callback: (r) => (r && r.access_token ? resolve(r) : reject(Object.assign(new Error('auth'), { code: r && r.error === 'access_denied' ? 'denied' : 'auth' }))),
      error_callback: (e) => reject(Object.assign(new Error('auth'), { code: e && e.type === 'popup_closed' ? 'cancelled' : e && e.type === 'popup_failed_to_open' ? 'popup' : 'auth' })),
    });
    client.requestAccessToken({ prompt: '', ...(hint ? { login_hint: hint } : {}), scope, include_granted_scopes: true });
  });
  const has = (s) => google.accounts.oauth2.hasGrantedAllScopes(resp, s);
  mem = { t: resp.access_token, exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 60000, file: has(SCOPE_FILE), app: has(SCOPE_APPDATA) };
  if (!valid(mem, need)) throw Object.assign(new Error('scope'), { code: 'denied' });
  return mem.t;
}

/** Drive REST sa starim ključem. Greške: { code: 'notfound' | 'rate' | 'auth' | 'offline' | 'http', status }. */
export async function oldApi(url, opts = {}, need = 'file') {
  const token = await oldTokenSilent(need);
  if (!token) throw Object.assign(new Error('no old token'), { code: 'auth' });
  let res;
  for (let attempt = 0; ; attempt++) {
    try { res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } }); }
    catch { throw Object.assign(new Error('offline'), { code: 'offline' }); }
    if (res.ok) return res;
    const rate = res.status === 429 || (res.status === 403 && /rate/i.test(await res.clone().text().catch(() => '')));
    if (rate && attempt < 1) { await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500)); continue; }
    if (rate) { try { (await import('./driveGate.js')).noteRate(); } catch {} }
    throw Object.assign(new Error('http ' + res.status), { code: res.status === 404 ? 'notfound' : res.status === 401 ? 'auth' : rate ? 'rate' : 'http', status: res.status });
  }
}

/** Prepiši sadržaj postojećeg (starog) fajla — „preseljeno na …“. */
export async function oldWrite(fileId, text, mime = 'application/json') {
  await oldApi(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id`, { method: 'PATCH', headers: { 'Content-Type': mime }, body: text });
}
/** Spisak fajlova stare veze (q = Drive upit). */
export async function oldList(q, fields = 'files(id,name,modifiedTime,mimeType,appProperties)', space = 'drive') {
  const out = []; let page = '';
  for (let i = 0; i < 50; i++) {
    const j = await (await oldApi(`${API}/files?spaces=${space}&pageSize=200&fields=${encodeURIComponent('nextPageToken,' + fields)}&q=${encodeURIComponent(q)}${page ? '&pageToken=' + encodeURIComponent(page) : ''}`, {}, space === 'appDataFolder' ? 'sync' : 'file')).json();
    out.push(...(j.files || []));
    if (!j.nextPageToken) break; page = j.nextPageToken;
  }
  return out;
}
export const oldRead = async (fileId) => new Uint8Array(await (await oldApi(`${API}/files/${encodeURIComponent(fileId)}?alt=media`)).arrayBuffer());
