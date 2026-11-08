// Google Drive REST (appDataFolder — skrivena fascikla aplikacije u korisnikovom Drive-u) za sinhronizaciju.
// Običan fetch, bez biblioteka; samo potrebna polja (fields). Greške 429 / 5xx: ponovo, sa rastućim čekanjem i
// slučajnim pomakom. Svaki fajl se menja u celosti jednim zahtevom (nikad pola fajla).
import { SyncError } from './syncEngine.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const MIME = 'application/gzip';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fileName = (key) => 'g-' + key.replace(/[^\w.:-]/g, '_').slice(0, 120) + '.gz';

/** getToken(force) → Promise<string>; fetchFn za testove. */
export function createDrive(getToken, { fetchFn = (...a) => fetch(...a), tries = 5, baseDelay = 800, timeoutMs = 60000 } = {}) {
  async function call(url, opts = {}, { okStatus = [] } = {}) {
    let forced = false;
    for (let attempt = 0; ; attempt++) {
      const token = await getToken(forced);
      let res;
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const tm = ctrl && setTimeout(() => ctrl.abort(), timeoutMs);
      try { res = await fetchFn(url, { ...opts, ...(ctrl ? { signal: ctrl.signal } : {}), headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } }); }
      catch { throw ctrl && ctrl.signal.aborted ? new SyncError('timeout', 'RETRY') : new SyncError('network', 'OFFLINE'); }
      finally { clearTimeout(tm); }
      if (res.ok || okStatus.includes(res.status)) return res;
      let reason = '', msg = '';
      try { const j = await res.json(); const e = j.error || {}; msg = e.message || ''; reason = (e.errors && e.errors[0] && e.errors[0].reason) || e.status || ''; } catch {}
      if (res.status === 401) { if (!forced) { forced = true; continue; } throw new SyncError('auth', 'AUTH'); }
      if (res.status === 403 && /storageQuotaExceeded|quotaExceeded/i.test(reason + msg) && !/rate/i.test(reason)) throw new SyncError('quota', 'QUOTA');
      if (res.status === 403 && /insufficient|appNotAuthorized|scope|forbidden|domainPolicy/i.test(reason + msg)) throw new SyncError('scope', 'AUTH');
      if (res.status === 429 || res.status >= 500 || (res.status === 403 && /rate|limit/i.test(reason + msg))) {
        if (attempt + 1 >= tries) throw new SyncError('busy', 'RETRY');
        await sleep(baseDelay * 2 ** attempt * (0.5 + Math.random())); // rastuće čekanje + slučajni pomak
        continue;
      }
      if ((res.status === 400 || res.status === 404 || res.status === 410) && /pageToken|token/i.test(msg + reason) && /changes/.test(url)) throw new SyncError('token', 'TOKEN');
      if (res.status === 404) throw new SyncError('notfound', 'NOTFOUND');
      throw new SyncError('http ' + res.status, 'HTTP');
    }
  }
  const view = (f) => ({ fileId: f.id, name: f.name, props: f.appProperties || {}, removed: !!f.trashed });

  async function create(name, bytes, props) {
    const boundary = 'gs' + Math.random().toString(36).slice(2);
    const meta = { name, mimeType: MIME, appProperties: props, parents: ['appDataFolder'] };
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${MIME}\r\n\r\n`, bytes, `\r\n--${boundary}--`]);
    const res = await call(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    return { fileId: (await res.json()).id };
  }
  async function update(fileId, bytes, props) {
    const boundary = 'gs' + Math.random().toString(36).slice(2);
    const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ appProperties: props })}\r\n--${boundary}\r\nContent-Type: ${MIME}\r\n\r\n`, bytes, `\r\n--${boundary}--`]);
    const res = await call(`${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id`, { method: 'PATCH', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    return { fileId: (await res.json()).id };
  }

  return {
    async about() {
      const j = await (await call(`${API}/about?fields=user(permissionId,emailAddress,displayName)`)).json();
      return { id: j.user && j.user.permissionId, email: (j.user && j.user.emailAddress) || '' };
    },
    async startToken() { return (await (await call(`${API}/changes/startPageToken?fields=startPageToken`)).json()).startPageToken; },
    async changes(token) {
      const f = 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,trashed,appProperties))';
      const j = await (await call(`${API}/changes?spaces=appDataFolder&includeRemoved=true&pageSize=1000&pageToken=${encodeURIComponent(token)}&fields=${encodeURIComponent(f)}`)).json();
      const items = (j.changes || []).map((c) => (c.file ? { ...view(c.file), removed: !!(c.removed || c.file.trashed) } : { fileId: c.fileId, props: {}, removed: true }));
      return { items, next: j.nextPageToken || null, newStart: j.newStartPageToken || null };
    },
    async list() {
      const out = [];
      let page = '';
      for (let i = 0; i < 200; i++) {
        const j = await (await call(`${API}/files?spaces=appDataFolder&pageSize=1000&fields=${encodeURIComponent('nextPageToken,files(id,name,appProperties)')}${page ? '&pageToken=' + encodeURIComponent(page) : ''}`)).json();
        out.push(...(j.files || []).map(view));
        if (!j.nextPageToken) break;
        page = j.nextPageToken;
      }
      return out;
    },
    async get(fileId) { return new Uint8Array(await (await call(`${API}/files/${encodeURIComponent(fileId)}?alt=media`)).arrayBuffer()); },
    async put(key, bytes, props, fileId) {
      if (fileId) {
        try { return await update(fileId, bytes, props); }
        catch (e) { if (e.code !== 'NOTFOUND') throw e; } // fajl je u međuvremenu obrisan — novi
      }
      return create(fileName(key), bytes, props);
    },
    async del(fileId) { await call(`${API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }, { okStatus: [404] }); },
  };
}
