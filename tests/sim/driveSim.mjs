// Lažni Google Drive v3 + Google prijava (GIS, pomoćnik za ključ, revoke) za probu prelaska na nov OAuth klijent.
// Čist Node modul bez zavisnosti. Vidi tests/sim/README.md. Pravila koja se namerno oponašaju:
//  - drive.file / drive.appdata su po PROJEKTU: token klijenta X vidi samo fajlove koje je napravio projekat od X
//    (i samo appDataFolder tog projekta); sve ostalo je 404 notFound, kao na pravom Drive-u.
//  - javni fajl (anyone/reader) čita BILO KOJI projekat ključem: files/{id}?alt=media&key=K.
//  - sat: podrazumevano stvarno vreme (+ sim.advance(ms)); { clock: 'virtual' } = sat stoji dok ga test ne pomeri.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { GIS_STUB } from './gisStub.js';

export const SCOPES = { file: 'https://www.googleapis.com/auth/drive.file', appdata: 'https://www.googleapis.com/auth/drive.appdata' };
const FOLDER = 'application/vnd.google-apps.folder';
const MAX_SIMPLE = 5 * 1024 * 1024, CHUNK = 256 * 1024, HOUR = 3600e3, DAY = 86400e3;
const STATUS = { 400: 'INVALID_ARGUMENT', 401: 'UNAUTHENTICATED', 403: 'PERMISSION_DENIED', 404: 'NOT_FOUND', 429: 'RESOURCE_EXHAUSTED', 500: 'INTERNAL', 503: 'UNAVAILABLE' };
const FILE_FIELDS = new Set('kind id name mimeType parents appProperties properties trashed explicitlyTrashed createdTime modifiedTime size md5Checksum spaces owners ownedByMe permissions permissionIds description starred version shared webViewLink headRevisionId capabilities quotaBytesUsed originalFilename fileExtension fullFileExtension iconLink thumbnailLink viewedByMe lastModifyingUser driveId trashedTime'.split(' '));
const enc = new TextEncoder(), dec = new TextDecoder();
const hash = (s, n = 32) => createHash('sha1').update(String(s)).digest('base64url').slice(0, n);
const fullScope = (s) => (/^https:|^(openid|email|profile)$/.test(s) ? s : 'https://www.googleapis.com/auth/' + s);
export const scopeList = (s) => [...new Set((Array.isArray(s) ? s : String(s || '').split(/[\s,]+/)).filter(Boolean).map(fullScope))];

/** Google-ova greška: { error: { code, message, status, errors: [{ message, domain, reason }] } } */
export class GErr extends Error {
  constructor(code, reason, message, extra = {}) { super(message); Object.assign(this, { code, reason, extra }); }
  body() {
    const e = { message: this.message, domain: this.extra.domain || 'global', reason: this.reason, ...(this.extra.location ? { location: this.extra.location, locationType: this.extra.locationType || 'parameter' } : {}) };
    return { error: { code: this.code, message: this.message, ...(STATUS[this.code] ? { status: this.extra.status || STATUS[this.code] } : {}), errors: [e] } };
  }
}
const notFound = (id) => new GErr(404, 'notFound', `File not found: ${id}.`, { location: 'fileId' });
const invalid = (loc, msg = 'Invalid Value') => new GErr(400, 'invalid', msg, { location: loc });
const json = (o, status = 200, headers = {}) => ({ status, headers: { 'content-type': 'application/json; charset=UTF-8', ...headers }, body: enc.encode(JSON.stringify(o)) });
const toBytes = (c) => (c instanceof Uint8Array ? c : typeof c === 'string' ? enc.encode(c) : c == null ? new Uint8Array() : enc.encode(JSON.stringify(c)));

// ---- partial response: fields=a,b(c,d),e/f ----
function parseFields(s) {
  let i = 0;
  const merge = (a, b) => (a === true || b === true ? true : !a ? b : { ...a, ...b });
  const item = () => {
    let n = ''; while (i < s.length && !',()/'.includes(s[i])) n += s[i++];
    let sub = true;
    if (s[i] === '(') { i++; sub = list(); if (s[i] !== ')') throw invalid('fields', `Invalid field selection ${s}`); i++; }
    else if (s[i] === '/') { i++; const [m, ss] = item(); sub = { [m]: ss }; }
    return [n.trim(), sub];
  };
  const list = () => { const o = {}; for (;;) { const [n, sub] = item(); if (n) o[n] = merge(o[n], sub); if (s[i] === ',') { i++; continue; } return o; } };
  return list();
}
function pick(v, spec) {
  if (spec === true || v == null || typeof v !== 'object' || spec['*']) return v;
  if (Array.isArray(v)) return v.map((x) => pick(x, spec));
  const o = {}; for (const k of Object.keys(spec)) if (v[k] !== undefined) o[k] = pick(v[k], spec[k]); return o;
}
function checkFileFields(spec, where) {
  if (!spec || spec === true) return;
  for (const k of Object.keys(spec)) if (k !== '*' && !FILE_FIELDS.has(k)) throw invalid('fields', `Invalid field selection ${k}`);
  void where;
}

// ---- q= (podskup Drive upitnog jezika) ----
function parseQ(q, ctx) {
  if (!q || !q.trim()) return () => true;
  const terms = []; let cur = '', quote = false, brace = 0;
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (quote) { cur += c; if (c === '\\') cur += q[++i] ?? ''; else if (c === "'") quote = false; continue; }
    if (c === "'") { quote = true; cur += c; continue; }
    if (c === '{') brace++; if (c === '}') brace--;
    const m = !brace && /^\s+and\s+/i.exec(q.slice(i));
    if (m) { terms.push(cur); cur = ''; i += m[0].length - 1; continue; }
    cur += c;
  }
  if (quote || brace) throw invalid('q');
  terms.push(cur);
  const str = (s) => { const m = /^'((?:[^'\\]|\\.)*)'$/.exec(s.trim()); if (!m) throw invalid('q'); return m[1].replace(/\\(.)/g, '$1'); };
  const cmp = (op, a, b) => ({ '=': a === b, '!=': a !== b, '<': a < b, '<=': a <= b, '>': a > b, '>=': a >= b })[op];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const preds = terms.map((t) => {
    let m;
    if ((m = /^\s*(name|mimeType)\s*(=|!=|contains)\s*('.*')\s*$/.exec(t))) {
      const [, field, op, v] = m, val = str(v);
      if (op === 'contains') { // Drive: „contains“ za ime je poklapanje POČETKA reči (HelloWorld ⊃ 'Hello', ali ne 'World')
        const rx = field === 'name' ? new RegExp('(^|[^\\p{L}\\p{N}])' + esc(val), 'iu') : new RegExp(esc(val), 'i');
        return (f) => rx.test(f[field]);
      }
      return (f) => cmp(op, f[field], val);
    }
    if ((m = /^\s*('.*')\s+in\s+parents\s*$/.exec(t))) { const id = ctx.alias(str(m[1])); return (f) => f.parents.includes(id); }
    if ((m = /^\s*trashed\s*(=|!=)\s*(true|false)\s*$/.exec(t))) { const v = m[2] === 'true'; return (f) => cmp(m[1], f.trashed, v); }
    if ((m = /^\s*(modifiedTime|createdTime)\s*(<=|>=|!=|=|<|>)\s*('.*')\s*$/.exec(t))) { const v = Date.parse(str(m[3])); if (isNaN(v)) throw invalid('q'); return (f) => cmp(m[2], Date.parse(f[m[1]]), v); }
    if ((m = /^\s*(appProperties|properties)\s+has\s+\{\s*key\s*=\s*('(?:[^'\\]|\\.)*')\s+and\s+value\s*=\s*('.*')\s*\}\s*$/.exec(t))) { const k = str(m[2]), v = str(m[3]); return (f) => f[m[1]][k] === v; }
    throw invalid('q'); // nepodržan izraz (or, not, zagrade, fullText…) — namerno glasno
  });
  return (f) => preds.every((p) => p(f));
}

function parseMultipart(buf, ctype) {
  const m = /boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(ctype || '');
  if (!m) throw new GErr(400, 'badContent', 'Invalid multipart request with 0 mime parts.');
  const B = Buffer.from('--' + (m[1] || m[2])), b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength), parts = [];
  let i = b.indexOf(B);
  while (i >= 0) {
    let s = i + B.length;
    if (b[s] === 45 && b[s + 1] === 45) break;
    if (b[s] === 13 && b[s + 1] === 10) s += 2;
    const he = b.indexOf('\r\n\r\n', s), nx = b.indexOf(B, he + 4);
    if (he < 0 || nx < 0) throw new GErr(400, 'badContent', 'Malformed multipart body.');
    let de = nx; if (b[de - 2] === 13 && b[de - 1] === 10) de -= 2;
    const head = b.subarray(s, he).toString();
    parts.push({ type: ((/content-type:\s*([^\r\n;]+)/i.exec(head) || [])[1] || '').trim(), data: new Uint8Array(b.subarray(he + 4, de)) });
    i = nx;
  }
  if (parts.length !== 2) throw new GErr(400, 'badContent', `Invalid multipart request with ${parts.length} mime parts.`);
  let meta; try { meta = JSON.parse(dec.decode(parts[0].data) || '{}'); } catch { throw new GErr(400, 'parseError', 'Parse Error'); }
  return { meta, data: parts[1].data, type: parts[1].type };
}

/** Trenutni ID-jevi iz aplikacije (stari projekat): Client ID, javni API ključ, adresa pomoćnika. */
export function appDefaults(root = new URL('../../', import.meta.url)) {
  const rd = (p) => readFileSync(new URL(p, root), 'utf8');
  const drive = rd('src/drive.js'), cfg = rd('src/shareConfig.js');
  const g = (src, k) => (new RegExp(`${k}\\s*=\\s*'([^']*)'`).exec(src) || [])[1] || '';
  return { clientId: g(drive, 'CLIENT_ID'), apiKey: g(cfg, 'SHARE_API_KEY'), helperUrl: g(cfg, 'TOKEN_HELPER'), origin: 'https://bagaljivko.github.io' };
}

/**
 * opts: {
 *   projects: { OLD: { apis:['drive'], userPerSec, userPerMin, unitsPerMin, costs:{endpoint:n}, rateStatus:403|429, publishing:'production'|'testing', testUsers:[] } },
 *   clients: { clientId: { project, origins?: ['https://…'] } }, keys: { key: { project, apis?: ['drive'], referrers?: ['https://host/*'] } },
 *   helpers: { url: { client } | { project } }, users: ['a@x' | {email,name,quota}], clock: 'real'|'virtual', start, latency, seed,
 *   refreshOnEveryCode: false }
 */
export function createSim(opts = {}) {
  let offset = 0, n = 0;
  const start = opts.start ?? Date.UTC(2026, 0, 5, 8);
  const virtual = opts.clock === 'virtual';
  const sim = {};
  const now = () => (virtual ? start : Date.now()) + offset;
  const id = (p = '1', len = 32) => p + hash(`${opts.seed || 'sim'}:${++n}`, len);
  const iso = () => new Date(now()).toISOString();

  const projects = {}, clients = {}, keys = {}, helpers = {};
  for (const [k, p] of Object.entries(opts.projects || { OLD: {}, NEW: {} })) projects[k] = { id: k, number: String(100000000000 + Object.keys(projects).length * 7919 + 1), apis: ['drive'], costs: {}, rateStatus: 403, publishing: 'production', testUsers: [], ...p };
  Object.assign(clients, opts.clients || {}); Object.assign(keys, opts.keys || {});
  for (const [u, h] of Object.entries(opts.helpers || {})) helpers[u] = { configured: true, ...h };

  const users = new Map(); // email → user
  const byPid = new Map();
  const files = new Map();
  const tokens = new Map(), refresh = new Map(), codes = new Map(), grants = new Map(), sessions = new Map();
  const changes = []; // { seq, user(pid), project, fileId, appData, removed, time }
  const faults = [];
  let offline = false, dropLeft = null;
  const win = new Map(); // rate windows

  sim.now = now; sim.iso = iso;
  sim.advance = (ms) => { offset += ms; return now(); };
  sim.projects = projects; sim.clients = clients; sim.keys = keys; sim.helpers = helpers;
  sim.stats = null; sim.log = [];
  sim.resetStats = () => { sim.stats = { total: 0, byUser: {}, byProject: {}, byEndpoint: {}, byStatus: {}, byReason: {}, rateLimited: 0 }; sim.log = []; };
  sim.resetStats();

  // ---------------- modeli ----------------
  sim.addUser = (u, o = {}) => {
    const x = typeof u === 'string' ? { email: u, ...o } : { ...u, ...o };
    if (users.has(x.email)) return users.get(x.email);
    const user = { email: x.email, displayName: x.name || x.email.split('@')[0], permissionId: '0' + BigInt('0x' + createHash('sha1').update(x.email).digest('hex').slice(0, 15)).toString().padStart(19, '0'), rootId: id('0A', 18), quota: x.quota ?? Infinity, seq: 1000 };
    users.set(user.email, user); byPid.set(user.permissionId, user);
    return user;
  };
  for (const u of opts.users || []) sim.addUser(u);
  const userOf = (u) => (typeof u === 'object' ? u : users.get(u) || byPid.get(u) || sim.addUser(u));
  sim.user = (email) => users.get(email);
  const appDataId = (user, project) => 'appdata-' + hash(user.permissionId + project, 20);
  const clientOf = (c) => (clients[c] ? c : Object.keys(clients).find((k) => clients[k].project === c));

  function record(f, removed = false) {
    const user = byPid.get(f.owner);
    changes.push({ seq: ++user.seq, user: f.owner, project: f.project, fileId: f.id, appData: f.appData, removed, time: iso() });
  }
  function usage(user) { let s = 0; for (const f of files.values()) if (f.owner === user.permissionId) s += f.bytes.length; return s; }
  function checkQuota(user, add) {
    if (usage(user) + add > user.quota) throw new GErr(403, 'storageQuotaExceeded', "The user's Drive storage quota has been exceeded.", { domain: 'usageLimits' });
  }
  function setProps(dst, src) { for (const [k, v] of Object.entries(src || {})) { if (v === null) delete dst[k]; else dst[k] = String(v); } }

  function makeFile(user, project, meta, bytes, mime) {
    const parents = (meta.parents && meta.parents.length ? meta.parents : ['root']).map((p) => (p === 'appDataFolder' ? appDataId(user, project) : p === 'root' ? user.rootId : p));
    const appData = parents.some((p) => p === appDataId(user, project));
    const f = { id: id(), owner: user.permissionId, project, name: meta.name ?? 'Untitled', mimeType: meta.mimeType || mime || 'application/octet-stream', parents, appData,
      appProperties: {}, properties: {}, description: meta.description, bytes: bytes || new Uint8Array(), createdTime: iso(), modifiedTime: meta.modifiedTime || iso(), trashed: !!meta.trashed, version: 1,
      perms: [{ id: user.permissionId, type: 'user', role: 'owner', emailAddress: user.email }] };
    setProps(f.appProperties, meta.appProperties); setProps(f.properties, meta.properties);
    files.set(f.id, f); record(f);
    return f;
  }
  function touch(f) { f.modifiedTime = iso(); f.version++; record(f); }
  function removeFile(f) {
    for (const c of [...files.values()]) if (c.parents.includes(f.id) && c.owner === f.owner) removeFile(c);
    files.delete(f.id); record(f, true);
  }
  const isPublic = (f) => f.perms.some((p) => p.type === 'anyone' && ['reader', 'commenter', 'writer'].includes(p.role));
  function resource(f) {
    const user = byPid.get(f.owner);
    return { kind: 'drive#file', id: f.id, name: f.name, mimeType: f.mimeType, parents: [...f.parents], ...(Object.keys(f.appProperties).length ? { appProperties: { ...f.appProperties } } : {}),
      ...(Object.keys(f.properties).length ? { properties: { ...f.properties } } : {}), ...(f.description ? { description: f.description } : {}),
      trashed: f.trashed, explicitlyTrashed: f.trashed, createdTime: f.createdTime, modifiedTime: f.modifiedTime, version: String(f.version), spaces: [f.appData ? 'appDataFolder' : 'drive'],
      ...(f.mimeType === FOLDER ? {} : { size: String(f.bytes.length), quotaBytesUsed: String(f.bytes.length), md5Checksum: createHash('md5').update(f.bytes).digest('hex') }),
      ownedByMe: true, owners: [{ kind: 'drive#user', displayName: user.displayName, emailAddress: user.email, permissionId: user.permissionId, me: true }],
      shared: isPublic(f), permissionIds: f.perms.map((p) => p.id), permissions: f.perms.map(permRes) };
  }
  const permRes = (p) => ({ kind: 'drive#permission', id: p.id, type: p.type, role: p.role, ...(p.emailAddress ? { emailAddress: p.emailAddress } : {}), ...(p.type === 'anyone' ? { allowFileDiscovery: !!p.allowFileDiscovery } : {}) });

  // ---------------- tokeni i dozvole ----------------
  const grantKey = (email, client) => email + '|' + client;
  const grantOf = (email, client) => { const k = grantKey(email, client); if (!grants.has(k)) grants.set(k, new Set()); return grants.get(k); };
  function mintAccess(user, client, scopes) {
    const t = 'ya29.sim-' + hash(`at${++n}${opts.seed || ''}`, 40);
    tokens.set(t, { user: user.email, client, project: clients[client].project, scopes: new Set(scopes), exp: now() + 3599e3, revoked: false });
    return t;
  }
  function mintRefresh(user, client) {
    const rt = '1//sim-' + hash(`rt${++n}`, 40), P = projects[clients[client].project];
    // Google: najviše 100 dugotrajnih dozvola po klijentu i nalogu — najstarija se tiho poništi
    const mine = [...refresh.entries()].filter(([, r]) => r.user === user.email && r.client === client && !r.revoked);
    if (mine.length >= 100) mine[0][1].revoked = true;
    refresh.set(rt, { user: user.email, client, at: now(), exp: P.publishing === 'testing' ? now() + 7 * DAY : Infinity, revoked: false });
    return rt;
  }
  /** Token bez prozora (za Node testove ili za ubacivanje u aplikaciju). clientOrProject: client_id ili 'OLD'/'NEW'. */
  sim.issueToken = (email, clientOrProject, scopes = 'drive.file drive.appdata', { refresh: withRt = false } = {}) => {
    const user = userOf(email), client = clientOf(clientOrProject);
    if (!client) throw new Error('sim: unknown client/project ' + clientOrProject);
    const sc = scopeList(scopes), g = grantOf(user.email, client); sc.forEach((s) => g.add(s));
    return { access_token: mintAccess(user, client, sc), expires_in: 3599, scope: sc.join(' '), token_type: 'Bearer', ...(withRt ? { refresh_token: mintRefresh(user, client) } : {}) };
  };
  /** Poništi celu dozvolu (kao „Ukloni pristup“ na myaccount.google.com, ili revoke bilo kog njenog tokena). */
  sim.revokeGrant = (email, client) => {
    grants.delete(grantKey(email, client));
    for (const t of tokens.values()) if (t.user === email && t.client === client) t.revoked = true;
    for (const r of refresh.values()) if (r.user === email && r.client === client) r.revoked = true;
  };
  function revokeToken(tok) {
    const t = tokens.get(tok) || refresh.get(tok);
    if (!t || t.revoked) return false;
    sim.revokeGrant(t.user, t.client); return true;
  }
  sim.expireTokens = (filter = () => true) => { for (const t of tokens.values()) if (filter(t)) t.exp = 0; };
  sim.tokenInfo = (tok) => tokens.get(tok) || null;

  function helperCall(h, p) {
    if (!h.configured) return { error: 'not_configured' };
    const client = h.client || clientOf(h.project);
    if (p.a === 'exchange' && typeof p.code === 'string') {
      const c = codes.get(p.code);
      if (!c || c.used || c.exp < now() || c.client !== client) return { error: 'invalid_grant' };
      c.used = true;
      const user = users.get(c.user), at = mintAccess(user, client, c.scopes);
      return { access_token: at, expires_in: 3599, scope: c.scopes.join(' '), ...(c.consent || opts.refreshOnEveryCode ? { refresh_token: mintRefresh(user, client) } : {}) };
    }
    if (p.a === 'refresh' && typeof p.rt === 'string') {
      const r = refresh.get(p.rt);
      if (!r || r.revoked || r.exp < now()) return { error: 'invalid_grant' };
      if (r.client !== client) return { error: 'unauthorized_client' }; // dozvola izdata drugom klijentu
      const sc = [...grantOf(r.user, client)];
      if (!sc.length) return { error: 'invalid_grant' };
      return { access_token: mintAccess(users.get(r.user), client, sc), expires_in: 3599, scope: sc.join(' ') };
    }
    return { error: 'bad_request' };
  }

  // ---------------- uređaji i prijava (GIS) ----------------
  /** Uređaj = jedan pregledač (Playwright context). accounts: nalozi prijavljeni u Google-u na tom uređaju. */
  sim.device = (o = {}) => {
    const accounts = [...(o.accounts || (o.account ? [o.account] : []))];
    accounts.forEach((e) => userOf(e));
    const dev = { name: o.name || 'dev' + (++n), account: o.account || accounts[0] || null, accounts, queue: [], default: o.default || 'approve', silent: o.silent || 'auto', log: [] };
    /** Sledeći prozori: 'approve' | 'cancel' | 'blocked' | 'deny' | 'hang' | { pick: email, untick: ['drive.appdata'], delay } */
    dev.next = (...b) => { dev.queue.push(...b); return dev; };
    return dev;
  };
  sim.authorize = (dev, req, { origin } = {}) => {
    const entry = { at: now(), ...req, origin }; dev.log.push(entry);
    const done = (r, why) => { entry.result = why || (r.callback && (r.callback.error || 'ok')) || (r.error_callback && r.error_callback.type) || (r.hang ? 'hang' : 'revoke'); return r; };
    if (req.kind === 'revoke') return done({ revoke: revokeToken(req.token) ? { successful: true } : { successful: false, error: 'invalid_token', error_description: 'Token expired or revoked' } });
    const c = clients[req.client_id], P = c && projects[c.project];
    const badClient = !c ? 'invalid_client' : c.origins && origin && !c.origins.includes(origin) ? 'origin_mismatch' : '';
    const want = scopeList(req.scope);
    const resp = (email, consent) => {
      const user = userOf(email), g = grantOf(email, req.client_id);
      const sc = req.include_granted_scopes !== false ? [...g] : want.filter((s) => g.has(s));
      if (req.kind === 'code') {
        const code = '4/sim-' + hash(`code${++n}`, 40);
        codes.set(code, { user: user.email, client: req.client_id, scopes: sc, consent, exp: now() + 600e3 });
        return { code, scope: sc.join(' '), authuser: '0', prompt: consent ? 'consent' : 'none' };
      }
      return { access_token: mintAccess(user, req.client_id, sc), token_type: 'Bearer', expires_in: 3599, scope: sc.join(' '), authuser: '0', prompt: consent ? 'consent' : 'none' };
    };
    const blocked = (email) => P && P.publishing === 'testing' && !P.testUsers.includes(email);
    if (req.kind === 'token' && req.prompt === 'none') { // tiho: bez prozora
      if (badClient) return done({ callback: { error: badClient } });
      if (dev.silent === 'fail') return done({ callback: { error: 'interaction_required' } });
      const email = req.hint ? (dev.accounts.includes(req.hint) ? req.hint : null) : dev.accounts.length === 1 ? dev.accounts[0] : null;
      if (!email) return done({ callback: { error: dev.accounts.length ? 'interaction_required' : 'login_required' } });
      if (blocked(email)) return done({ callback: { error: 'access_denied' } });
      if (!want.every((s) => grantOf(email, req.client_id).has(s))) return done({ callback: { error: 'consent_required' } });
      return done({ callback: resp(email, false) });
    }
    const b0 = dev.queue.length ? dev.queue.shift() : dev.default;
    const b = typeof b0 === 'string' ? { action: b0 } : { action: 'approve', ...b0 };
    const delay = b.delay || 0;
    if (b.action === 'blocked') return done({ error_callback: { type: 'popup_failed_to_open', message: 'Failed to open popup window' } });
    if (b.action === 'hang') return done({ hang: true });
    if (badClient) return done({ error_callback: { type: 'popup_closed', message: 'Popup window closed' }, delay }, badClient); // Google prikaže grešku, korisnik zatvori
    if (b.action === 'cancel') return done({ error_callback: { type: 'popup_closed', message: 'Popup window closed' }, delay });
    const chooser = req.select_account || req.prompt === 'select_account';
    const email = b.pick || (!chooser && req.hint && dev.accounts.includes(req.hint) ? req.hint : null) || dev.account || dev.accounts[0];
    if (!email) return done({ error_callback: { type: 'popup_closed', message: 'Popup window closed' }, delay }, 'no_account');
    if (!dev.accounts.includes(email)) dev.accounts.push(email);
    if (b.action === 'deny' || blocked(email)) return done({ callback: { error: 'access_denied' }, delay });
    const g = grantOf(userOf(email).email, req.client_id), missing = want.filter((s) => !g.has(s));
    const consent = missing.length > 0 || req.prompt === 'consent';
    const untick = scopeList(b.untick || []);
    missing.forEach((s) => { if (!untick.includes(s)) g.add(s); });
    return done({ callback: resp(email, consent), delay });
  };

  // ---------------- zahtevi ----------------
  sim.fail = (f) => { const h = { status: 500, reason: 'backendError', times: 1, ...f, hits: 0 }; h.cancel = () => { const i = faults.indexOf(h); if (i >= 0) faults.splice(i, 1); }; faults.push(h); return h; };
  sim.offline = (v = true) => { offline = !!v; if (!v) dropLeft = null; };
  sim.dropAfter = (k) => { dropLeft = k; };

  function classify(u, method) {
    const host = u.hostname, path = u.pathname, P = u.searchParams;
    if (host === 'accounts.google.com' && path.startsWith('/gsi/client')) return 'gis';
    if (host === 'script.google.com' && /^\/macros\/s\/[^/]+\/exec$/.test(path)) return 'helper';
    if (host === 'oauth2.googleapis.com' && path === '/revoke') return 'revoke';
    if (host === 'oauth2.googleapis.com' && path === '/tokeninfo') return 'tokeninfo';
    if (!/(^|\.)googleapis\.com$/.test(host)) return null;
    let m = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(path);
    if (m) return P.get('upload_id') ? 'upload.resumable.put' : `upload.${P.get('uploadType') || 'media'}`;
    if (!(m = /^\/drive\/v3\/(.+)$/.exec(path))) return 'unknown';
    const r = m[1];
    if (r === 'about') return 'about.get';
    if (r === 'files') return method === 'POST' ? 'files.create' : 'files.list';
    if (r === 'changes/startPageToken') return 'changes.getStartPageToken';
    if (r === 'changes') return 'changes.list';
    if (/^files\/[^/]+$/.test(r)) return { GET: P.get('alt') === 'media' ? 'files.media' : 'files.get', PATCH: 'files.update', DELETE: 'files.delete' }[method] || 'unknown';
    if (/^files\/[^/]+\/permissions$/.test(r)) return method === 'POST' ? 'permissions.create' : 'permissions.list';
    if (/^files\/[^/]+\/permissions\/[^/]+$/.test(r)) return method === 'DELETE' ? 'permissions.delete' : 'permissions.get';
    return 'unknown';
  }
  function resolveAuth(headers, P) {
    const h = headers.get('authorization'), tk = (h && (/^Bearer\s+(\S+)/i.exec(h) || [])[1]) || P.get('access_token');
    if (tk) {
      const t = tokens.get(tk);
      if (!t || t.revoked || t.exp <= now()) return { kind: 'bad' };
      return { kind: 'oauth', token: tk, user: users.get(t.user), email: t.user, project: t.project, client: t.client, scopes: t.scopes };
    }
    if (P.get('key') != null) return { kind: 'key', key: P.get('key'), project: keys[P.get('key')] && keys[P.get('key')].project };
    return { kind: 'none' };
  }
  function checkKey(a, headers) {
    const k = keys[a.key];
    if (!k) throw new GErr(400, 'badRequest', 'API key not valid. Please pass a valid API key.', { status: 'INVALID_ARGUMENT' });
    if (k.referrers) {
      const ref = headers.get('referer') || headers.get('origin') || '';
      const ok = ref && k.referrers.some((p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(ref));
      if (!ok) throw new GErr(403, 'forbidden', `Requests from referer ${ref || '<empty>'} are blocked.`, { status: 'PERMISSION_DENIED' });
    }
    if (k.apis && !k.apis.includes('drive')) throw new GErr(403, 'forbidden', 'Requests to this API drive.googleapis.com method google.apps.drive.v3.DriveFiles.Get are blocked.', { status: 'PERMISSION_DENIED' });
  }
  function checkApi(project) {
    const p = projects[project];
    if (!p || !p.apis.includes('drive')) throw new GErr(403, 'accessNotConfigured', `Google Drive API has not been used in project ${p ? p.number : project} before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=${p ? p.number : project} then retry.`, { domain: 'usageLimits' });
  }
  function rateLimit(a, ep) {
    const P = projects[a.project]; if (!P) return;
    const t = now(), sec = Math.floor(t / 1000), qmsg = (metric, limit) => `Quota exceeded for quota metric '${metric}' and limit '${limit}' of service 'drive.googleapis.com' for consumer 'project_number:${P.number}'.`;
    const bump = (k, size, limit) => { const w = win.get(k) || { s: -1, c: 0 }; const s = Math.floor(t / size); if (w.s !== s) { w.s = s; w.c = 0; } win.set(k, w); return ++w.c > limit; };
    const over = (reason, msg) => { sim.stats.rateLimited++; return new GErr(P.rateStatus, reason, msg, { domain: 'usageLimits', status: P.rateStatus === 429 ? 'RESOURCE_EXHAUSTED' : 'PERMISSION_DENIED' }); };
    if (a.kind === 'oauth' && P.userPerSec && bump(`us|${a.project}|${a.email}`, 1000, P.userPerSec)) throw over('userRateLimitExceeded', qmsg('Queries', 'Queries per second per user'));
    if (a.kind === 'oauth' && P.userPerMin && bump(`um|${a.project}|${a.email}`, 60000, P.userPerMin)) throw over('userRateLimitExceeded', qmsg('Queries', 'Queries per minute per user'));
    if (P.unitsPerMin) {
      const k = 'pu|' + a.project, b = win.get(k) || []; win.set(k, b);
      while (b.length && b[0][0] <= sec - 60) b.shift();
      const used = b.reduce((x, [, u]) => x + u, 0), cost = P.costs[ep] ?? 1;
      if (used + cost > P.unitsPerMin) throw over('rateLimitExceeded', qmsg('Total Query Cost', 'Units per minute'));
      if (b.length && b[b.length - 1][0] === sec) b[b.length - 1][1] += cost; else b.push([sec, cost]);
    }
    void sec;
  }

  const ctxFor = (a) => ({ alias: (p) => (p === 'appDataFolder' ? appDataId(a.user, a.project) : p === 'root' ? a.user.rootId : p) });
  const canSee = (f, a) => a.kind === 'oauth' && f.owner === a.user.permissionId && f.project === a.project && a.scopes.has(f.appData ? SCOPES.appdata : SCOPES.file);
  const getVisible = (fid, a) => { const f = files.get(fid); if (!f || !canSee(f, a)) throw notFound(fid); return f; };
  const needOauth = (a) => { if (a.kind !== 'oauth') throw new GErr(401, 'required', 'Login Required.', { location: 'Authorization', locationType: 'header' }); };
  const fieldsOf = (P, def) => parseFields(P.get('fields') || def);
  const out = (f, P, def = 'kind,id,name,mimeType') => { const spec = fieldsOf(P, def); checkFileFields(spec); return pick(resource(f), spec); };

  function writeCheck(a, meta, user) {
    const parents = meta.parents || [];
    const app = parents.includes('appDataFolder') || parents.includes(appDataId(user, a.project));
    if (app && !a.scopes.has(SCOPES.appdata)) throw new GErr(403, 'insufficientScopes', 'The granted scopes do not allow use of the Application Data folder.');
    if (!app && !a.scopes.has(SCOPES.file)) throw new GErr(403, 'insufficientPermissions', 'Insufficient Permission: Request had insufficient authentication scopes.');
    for (const p of parents) {
      if (p === 'appDataFolder' || p === 'root' || p === appDataId(user, a.project)) continue;
      const f = files.get(p); if (!f || !canSee(f, a)) throw notFound(p);
      if (f.mimeType !== FOLDER) throw new GErr(400, 'invalid', 'The specified parent is not a folder.', { location: 'parents' });
    }
  }
  function create(a, meta, bytes, mime) {
    writeCheck(a, meta, a.user); checkQuota(a.user, bytes.length);
    return makeFile(a.user, a.project, meta, bytes, mime);
  }
  function update(a, f, meta, bytes, P) {
    if (meta.parents) throw new GErr(403, 'fieldNotWritable', 'The resource body includes fields which are not directly writable.');
    if (bytes) checkQuota(a.user, bytes.length - f.bytes.length);
    if (meta.name != null) f.name = meta.name;
    if (meta.mimeType) f.mimeType = meta.mimeType;
    if (meta.description !== undefined) f.description = meta.description;
    if (meta.trashed !== undefined) f.trashed = !!meta.trashed;
    setProps(f.appProperties, meta.appProperties); setProps(f.properties, meta.properties);
    if (P && P.get('addParents')) for (const p of P.get('addParents').split(',')) { getVisible(p, a); if (!f.parents.includes(p)) f.parents.push(p); }
    if (P && P.get('removeParents')) f.parents = f.parents.filter((p) => !P.get('removeParents').split(',').includes(p));
    if (bytes) f.bytes = bytes;
    touch(f); return f;
  }
  const parseJson = (body) => { if (!body.length) return {}; try { return JSON.parse(dec.decode(body)); } catch { throw new GErr(400, 'parseError', 'Parse Error'); } };

  function drive(ep, req, a) {
    const { url: u, method, headers, body } = req, P = u.searchParams, fid = decodeURIComponent((/\/files\/([^/?]+)/.exec(u.pathname) || [])[1] || '');
    // javno čitanje ključem
    if (a.kind === 'key' && (ep === 'files.media' || ep === 'files.get')) {
      const f = files.get(fid);
      if (!f || !isPublic(f)) throw notFound(fid);
      if (ep === 'files.get') return json(out(f, P));
      if (f.mimeType === FOLDER) throw new GErr(403, 'fileNotDownloadable', 'Only files with binary content can be downloaded. Use Export with Docs Editors files.');
      return { status: 200, headers: { 'content-type': f.mimeType }, body: f.bytes };
    }
    needOauth(a);
    if (!a.scopes.has(SCOPES.file) && !a.scopes.has(SCOPES.appdata)) throw new GErr(403, 'insufficientPermissions', 'Request had insufficient authentication scopes.', { status: 'PERMISSION_DENIED' });
    switch (ep) {
      case 'about.get': {
        if (!P.get('fields')) throw new GErr(400, 'required', "The 'fields' parameter is required for this method.", { location: 'fields' });
        const u2 = a.user;
        return json(pick({ kind: 'drive#about', user: { kind: 'drive#user', displayName: u2.displayName, emailAddress: u2.email, permissionId: u2.permissionId, me: true }, storageQuota: { usage: String(usage(u2)), ...(isFinite(u2.quota) ? { limit: String(u2.quota) } : {}) } }, parseFields(P.get('fields'))));
      }
      case 'files.list': {
        const spaces = (P.get('spaces') || 'drive').split(',').map((s) => s.trim());
        if (spaces.some((s) => !['drive', 'appDataFolder', 'photos'].includes(s))) throw invalid('spaces');
        if (spaces.includes('appDataFolder') && !a.scopes.has(SCOPES.appdata)) throw new GErr(403, 'insufficientScopes', 'The granted scopes do not give access to all of the requested spaces.');
        const spec = fieldsOf(P, 'kind,incompleteSearch,files(kind,id,name,mimeType)');
        if (spec.files && spec.files !== true) checkFileFields(spec.files);
        const pred = parseQ(P.get('q'), ctxFor(a));
        let list = [...files.values()].filter((f) => canSee(f, a) && spaces.includes(f.appData ? 'appDataFolder' : 'drive') && pred(f));
        const ord = (P.get('orderBy') || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const [k, d] = s.split(/\s+/); return [k === 'name_natural' ? 'name' : k, d === 'desc' ? -1 : 1]; });
        for (const [k] of ord) if (!['name', 'modifiedTime', 'createdTime', 'folder', 'recency', 'viewedByMeTime', 'quotaBytesUsed', 'starred', 'sharedWithMeTime', 'modifiedByMeTime'].includes(k)) throw invalid('orderBy', 'Invalid Value');
        const key = (f, k) => (k === 'folder' ? (f.mimeType === FOLDER ? 0 : 1) : k === 'recency' ? f.modifiedTime : f[k] ?? '');
        if (ord.length) list.sort((x, y) => { for (const [k, d] of ord) { const p = key(x, k), q = key(y, k); if (p < q) return -d; if (p > q) return d; } return 0; });
        const size = Math.min(1000, Math.max(1, Number(P.get('pageSize')) || 100));
        const sig = hash(`${P.get('q')}|${P.get('orderBy')}|${spaces}|${a.token}`, 8);
        let off = 0;
        if (P.get('pageToken')) { const m = /^([0-9]+)~(.+)$/.exec(Buffer.from(P.get('pageToken'), 'base64url').toString()); if (!m || m[2] !== sig) throw invalid('pageToken'); off = +m[1]; }
        const page = list.slice(off, off + size);
        const res = { kind: 'drive#fileList', incompleteSearch: false, files: page.map(resource), ...(off + size < list.length ? { nextPageToken: Buffer.from(`${off + size}~${sig}`).toString('base64url') } : {}) };
        return json(pick(res, spec));
      }
      case 'files.get': return json(out(getVisible(fid, a), P));
      case 'files.media': {
        const f = getVisible(fid, a);
        if (f.mimeType === FOLDER) throw new GErr(403, 'fileNotDownloadable', 'Only files with binary content can be downloaded. Use Export with Docs Editors files.');
        return { status: 200, headers: { 'content-type': f.mimeType }, body: f.bytes };
      }
      case 'files.create': return json(out(create(a, parseJson(body), new Uint8Array()), P));
      case 'files.update': return json(out(update(a, getVisible(fid, a), parseJson(body), null, P), P));
      case 'files.delete': removeFile(getVisible(fid, a)); return { status: 204, headers: {}, body: null };
      case 'permissions.list': { const f = getVisible(fid, a); return json(pick({ kind: 'drive#permissionList', permissions: f.perms.map(permRes) }, fieldsOf(P, 'kind,permissions(kind,id,type,role)'))); }
      case 'permissions.get': { const f = getVisible(fid, a); const pid = u.pathname.split('/').pop(); const p = f.perms.find((x) => x.id === pid); if (!p) throw new GErr(404, 'notFound', `Permission not found: ${pid}.`, { location: 'permissionId' }); return json(pick(permRes(p), fieldsOf(P, 'kind,id,type,role'))); }
      case 'permissions.create': {
        const f = getVisible(fid, a), b = parseJson(body);
        if (f.appData) throw new GErr(403, 'forbidden', 'Files in the Application Data folder cannot be shared.');
        if (!['anyone', 'user', 'group', 'domain'].includes(b.type) || !['reader', 'commenter', 'writer', 'owner'].includes(b.role)) throw invalid('permission');
        const pid = b.type === 'anyone' ? (b.allowFileDiscovery ? 'anyone' : 'anyoneWithLink') : b.type === 'user' ? userOf(b.emailAddress).permissionId : id('p', 12);
        f.perms = f.perms.filter((p) => p.id !== pid); const p = { id: pid, type: b.type, role: b.role, emailAddress: b.emailAddress, allowFileDiscovery: !!b.allowFileDiscovery }; f.perms.push(p); touch(f);
        return json(pick(permRes(p), fieldsOf(P, 'kind,id,type,role')));
      }
      case 'permissions.delete': {
        const f = getVisible(fid, a), pid = decodeURIComponent(u.pathname.split('/').pop());
        if (!f.perms.some((p) => p.id === pid)) throw new GErr(404, 'notFound', `Permission not found: ${pid}.`, { location: 'permissionId' });
        if (pid === f.owner) throw new GErr(403, 'cannotRemoveOwner', 'The owner of a file cannot be removed.');
        f.perms = f.perms.filter((p) => p.id !== pid); touch(f); return { status: 204, headers: {}, body: null };
      }
      case 'changes.getStartPageToken': return json(pick({ kind: 'drive#startPageToken', startPageToken: String(a.user.seq + 1) }, fieldsOf(P, 'kind,startPageToken')));
      case 'changes.list': {
        const tok = P.get('pageToken');
        if (!tok) throw new GErr(400, 'required', 'Required parameter: pageToken', { location: 'pageToken' });
        if (!/^\d+$/.test(tok) || +tok > a.user.seq + 1) throw invalid('pageToken', 'Invalid Value');
        const spaces = (P.get('spaces') || 'drive').split(','), incRemoved = P.get('includeRemoved') !== 'false';
        if (spaces.includes('appDataFolder') && !a.scopes.has(SCOPES.appdata)) throw new GErr(403, 'insufficientScopes', 'The granted scopes do not give access to all of the requested spaces.');
        const last = new Map();
        for (const c of changes) if (c.seq >= +tok && c.user === a.user.permissionId && c.project === a.project && spaces.includes(c.appData ? 'appDataFolder' : 'drive') && a.scopes.has(c.appData ? SCOPES.appdata : SCOPES.file)) last.set(c.fileId, c);
        let list = [...last.values()].sort((x, y) => x.seq - y.seq);
        list = list.map((c) => { const f = files.get(c.fileId); return f && !c.removed ? { c, f } : { c, f: null }; }).filter((x) => incRemoved || x.f);
        const size = Math.min(1000, Math.max(1, Number(P.get('pageSize')) || 100)), page = list.slice(0, size);
        const res = { kind: 'drive#changeList', changes: page.map(({ c, f }) => ({ kind: 'drive#change', changeType: 'file', type: 'file', time: c.time, removed: !f, fileId: c.fileId, ...(f ? { file: resource(f) } : {}) })),
          ...(list.length > size ? { nextPageToken: String(list[size].c.seq) } : { newStartPageToken: String(a.user.seq + 1) }) };
        return json(pick(res, fieldsOf(P, 'kind,nextPageToken,newStartPageToken,changes(kind,changeType,time,removed,fileId,file(kind,id,name,mimeType))')));
      }
      case 'upload.multipart': case 'upload.media': {
        if (body.length > MAX_SIMPLE) throw new GErr(413, 'uploadTooLarge', 'Request Too Large: the request exceeds the 5 MB limit for simple and multipart uploads; use uploadType=resumable.');
        const mp = ep === 'upload.multipart' ? parseMultipart(body, headers.get('content-type')) : { meta: {}, data: body, type: (headers.get('content-type') || '').split(';')[0] };
        if (method === 'POST' && !fid) return json(out(create(a, mp.meta, mp.data, mp.type), P));
        if (method === 'PATCH' && fid) return json(out(update(a, getVisible(fid, a), mp.meta, mp.data, P), P));
        throw new GErr(400, 'badRequest', 'Bad Request');
      }
      case 'upload.resumable': {
        const meta = parseJson(body);
        if (method === 'POST' && !fid) writeCheck(a, meta, a.user); else if (method === 'PATCH' && fid) getVisible(fid, a); else throw new GErr(400, 'badRequest', 'Bad Request');
        const sid = 'sim-up-' + hash(`up${++n}`, 24), total = headers.get('x-upload-content-length');
        sessions.set(sid, { a, meta, fid, P, total: total != null ? +total : null, type: headers.get('x-upload-content-type') || meta.mimeType || '', chunks: [], got: 0, done: null, exp: now() + 7 * DAY });
        return { status: 200, headers: { location: `https://www.googleapis.com/upload/drive/v3/files${fid ? '/' + encodeURIComponent(fid) : ''}?uploadType=resumable&upload_id=${sid}`, 'x-guploader-uploadid': sid, 'content-length': '0' }, body: null };
      }
    }
    throw new GErr(404, 'notFound', 'Not Found');
  }

  function resumablePut(req) {
    const P = req.url.searchParams, s = sessions.get(P.get('upload_id'));
    if (!s || s.exp < now()) return { status: 404, headers: { 'content-type': 'text/plain' }, body: enc.encode('Not Found') };
    const range = (b) => (b ? { range: `bytes=0-${b - 1}` } : {});
    if (s.done) return json(out(s.done, s.P));
    const cr = req.headers.get('content-range'), body = req.body;
    let startAt = 0, total = s.total;
    if (cr) {
      let m;
      if ((m = /^bytes \*\/(\d+|\*)$/.exec(cr))) { if (m[1] !== '*') total = +m[1]; if (total == null || s.got < total) return { status: 308, headers: range(s.got), body: null }; }
      else if ((m = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(cr))) { startAt = +m[1]; if (m[3] !== '*') total = +m[3]; if (+m[2] - startAt + 1 !== body.length) throw new GErr(400, 'badContent', 'Content-Range does not match body length.'); }
      else throw new GErr(400, 'badContent', 'Invalid Content-Range.');
    } else total = body.length;
    if (startAt > s.got) throw new GErr(400, 'badContent', `Invalid request. According to the Content-Range header, the upload offset is ${startAt} but the server has ${s.got} bytes.`);
    const fresh = body.subarray(s.got - startAt);
    s.total = total;
    const finalChunk = total != null && s.got + fresh.length >= total;
    const keep = finalChunk ? fresh.subarray(0, total - s.got) : fresh.subarray(0, Math.floor(fresh.length / CHUNK) * CHUNK); // nepotpun komad: Drive čuva samo pune komade od 256 KiB
    s.chunks.push(keep); s.got += keep.length;
    if (!finalChunk) return { status: 308, headers: range(s.got), body: null };
    const all = new Uint8Array(s.got); let o = 0; for (const c of s.chunks) { all.set(c, o); o += c.length; }
    s.done = s.fid ? update(s.a, getVisible(s.fid, s.a), s.meta, all, s.P) : create(s.a, s.meta, all, s.type);
    return json(out(s.done, s.P));
  }

  function count(ep, a, status, reason) {
    const st = sim.stats; st.total++;
    st.byEndpoint[ep] = (st.byEndpoint[ep] || 0) + 1; st.byStatus[status] = (st.byStatus[status] || 0) + 1;
    if (reason) st.byReason[reason] = (st.byReason[reason] || 0) + 1;
    if (a && a.email) st.byUser[a.email] = (st.byUser[a.email] || 0) + 1;
    if (a && a.project) st.byProject[a.project] = (st.byProject[a.project] || 0) + 1;
    if (sim.log.length < 100000) sim.log.push({ t: now(), ep, user: a && a.email, project: a && a.project, status, reason });
  }

  /** Jezgro: { url, method, headers, body:Uint8Array } → { status, headers, body } ; bez mreže baca TypeError. */
  sim.handle = async (raw) => {
    if (opts.latency) await new Promise((r) => setTimeout(r, typeof opts.latency === 'function' ? opts.latency() : opts.latency));
    if (dropLeft != null) { if (dropLeft <= 0) offline = true; else dropLeft--; }
    if (offline) throw new TypeError('Failed to fetch');
    const url = new URL(raw.url), method = (raw.method || 'GET').toUpperCase(), headers = new Headers(raw.headers || {}), body = raw.body || new Uint8Array();
    const ep = classify(url, method);
    if (!ep) throw new Error('sim: not a Google URL ' + url.href);
    const req = { url, method, headers, body, ep, endpoint: ep, path: url.pathname, params: url.searchParams };
    const a = ['gis', 'helper', 'revoke', 'tokeninfo'].includes(ep) ? null : resolveAuth(headers, url.searchParams);
    if (a && a.kind === 'oauth') { req.user = a.email; req.project = a.project; } else if (a && a.kind === 'key') req.project = a.project;
    for (const f of faults) {
      if (f.times <= 0 || (f.match && !f.match(req))) continue;
      f.times--; f.hits++;
      if (f.times <= 0) f.cancel();
      if (f.network) { count(ep, a, 0, 'network'); throw new TypeError('Failed to fetch'); }
      count(ep, a, f.status, f.reason);
      return f.body ? { status: f.status, headers: { 'content-type': 'application/json; charset=UTF-8' }, body: toBytes(f.body) } : json(new GErr(f.status, f.reason, f.message || ({ notFound: 'File not found.', rateLimitExceeded: "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute' of service 'drive.googleapis.com'.", userRateLimitExceeded: 'User rate limit exceeded.', storageQuotaExceeded: "The user's Drive storage quota has been exceeded.", backendError: 'Backend Error' })[f.reason] || f.reason, { domain: /Rate|quota/i.test(f.reason) ? 'usageLimits' : 'global' }).body(), f.status);
    }
    let r;
    try {
      if (ep === 'gis') r = { status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8' }, body: enc.encode(GIS_STUB) };
      else if (ep === 'helper') {
        const h = helpers[url.origin + url.pathname];
        if (!h) r = { status: 404, headers: { 'content-type': 'text/html' }, body: enc.encode('<html><body>Sorry, unable to open the file at this time.</body></html>') };
        else if (method === 'GET') r = json({ ok: true, configured: !!h.configured });
        else { let p = {}; try { p = JSON.parse(dec.decode(body) || '{}'); } catch { p = null; } r = json(p ? helperCall(h, p) : { error: 'bad_request' }); }
      } else if (ep === 'revoke') {
        const tok = url.searchParams.get('token') || new URLSearchParams(dec.decode(body)).get('token');
        r = revokeToken(tok) ? json({}) : json({ error: 'invalid_token', error_description: 'Token expired or revoked' }, 400);
      } else if (ep === 'tokeninfo') {
        const t = tokens.get(url.searchParams.get('access_token'));
        r = t && !t.revoked && t.exp > now() ? json({ azp: t.client, aud: t.client, scope: [...t.scopes].join(' '), exp: String(Math.floor(t.exp / 1000)), expires_in: String(Math.floor((t.exp - now()) / 1000)), email: t.user }) : json({ error: 'invalid_token', error_description: 'Invalid Value' }, 400);
      } else if (ep === 'upload.resumable.put') r = resumablePut(req);
      else if (ep === 'unknown') r = { status: 404, headers: { 'content-type': 'text/html' }, body: enc.encode('Not Found') };
      else {
        if (a.kind === 'bad') throw new GErr(401, 'authError', 'Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential. See https://developers.google.com/identity/sign-in/web/devconsole-project.', { location: 'Authorization', locationType: 'header' });
        if (a.kind === 'none') throw new GErr(403, 'forbidden', "Method doesn't allow unregistered callers (callers without established identity). Please use API Key or other form of API consumer identity to call this API.");
        if (a.kind === 'key') checkKey(a, headers);
        checkApi(a.project);
        rateLimit(a, ep);
        r = drive(ep, req, a);
      }
    } catch (e) {
      if (!(e instanceof GErr)) throw e;
      r = json(e.body(), e.code);
    }
    let reason; if (r.status >= 400 && /json/.test(r.headers['content-type'] || '')) { try { const j = JSON.parse(dec.decode(r.body)); reason = (j.error && j.error.errors && j.error.errors[0].reason) || j.error; } catch {} }
    count(ep, a && a.kind !== 'bad' ? a : null, r.status, reason);
    return r;
  };

  /** WHATWG fetch: sim.fetch(url, init) → Response (bez mreže: TypeError). */
  sim.fetch = async (input, init = {}) => {
    const isReq = typeof input === 'object' && input && 'url' in input && typeof input.arrayBuffer === 'function';
    const url = isReq ? input.url : String(input), method = init.method || (isReq ? input.method : 'GET');
    const headers = new Headers(init.headers || (isReq ? input.headers : {}));
    let body = new Uint8Array();
    const src = init.body !== undefined ? init.body : isReq && !['GET', 'HEAD'].includes(method) ? await input.arrayBuffer() : null;
    if (src != null) { const rq = new Request('http://x/', { method: 'POST', body: src, duplex: 'half' }); body = new Uint8Array(await rq.arrayBuffer()); if (!headers.has('content-type') && rq.headers.get('content-type')) headers.set('content-type', rq.headers.get('content-type')); }
    const r = await sim.handle({ url, method, headers, body });
    return new Response([101, 204, 205, 304].includes(r.status) ? null : r.body, { status: r.status, headers: r.headers });
  };

  // ---------------- pomoć za testove ----------------
  const view = (f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, owner: byPid.get(f.owner).email, project: f.project, appData: f.appData, parents: [...f.parents], appProperties: { ...f.appProperties },
    size: f.bytes.length, trashed: f.trashed, public: isPublic(f), modifiedTime: f.modifiedTime, createdTime: f.createdTime, bytes: f.bytes, text: () => dec.decode(f.bytes), json: () => JSON.parse(dec.decode(f.bytes)) });
  /** Fajlovi (filter: owner = email ili permissionId, project, appData, name). */
  sim.listFiles = (flt = {}) => [...files.values()].filter((f) => (!flt.owner || f.owner === userOf(flt.owner).permissionId) && (!flt.project || f.project === flt.project) && (flt.appData == null || f.appData === flt.appData) && (!flt.name || f.name === flt.name)).map(view);
  sim.file = (fid) => (files.has(fid) ? view(files.get(fid)) : null);
  /** Sadržaj javnog fajla (kao da ga čita bilo ko ključem) ili null. */
  sim.publicRead = (fid) => { const f = files.get(fid); return f && isPublic(f) ? f.bytes : null; };
  /** Napravi fajl kao korisnik u projektu (bez zahteva). o: { name, content, mimeType, parents, appData, appProperties, public, folder } */
  sim.seed = (email, project, o = {}) => {
    const user = userOf(email);
    const meta = { name: o.name, mimeType: o.folder ? FOLDER : o.mimeType || (typeof o.content === 'string' || o.content instanceof Uint8Array || o.content == null ? 'application/octet-stream' : 'application/json'), parents: o.appData ? ['appDataFolder'] : o.parents, appProperties: o.appProperties };
    const f = makeFile(user, project, meta, toBytes(o.content));
    if (o.public) { f.perms.push({ id: 'anyoneWithLink', type: 'anyone', role: 'reader' }); }
    return view(f);
  };
  sim.seedFolder = (email, project, name, o = {}) => sim.seed(email, project, { ...o, name, folder: true });
  sim.setPublic = (fid, on = true) => { const f = files.get(fid); f.perms = f.perms.filter((p) => p.type !== 'anyone'); if (on) f.perms.push({ id: 'anyoneWithLink', type: 'anyone', role: 'reader' }); touch(f); };
  sim.snapshot = ({ bytes = false } = {}) => JSON.parse(JSON.stringify({
    now: now(), users: [...users.values()].map(({ email, permissionId, displayName }) => ({ email, permissionId, displayName })),
    files: [...files.values()].map((f) => { const { bytes: b, text, json: j, ...v } = view(f); void text; void j; return { ...v, sha1: createHash('sha1').update(b).digest('hex'), ...(bytes ? { b64: Buffer.from(b).toString('base64') } : {}) }; }),
    grants: [...grants.entries()].map(([k, s]) => ({ key: k, scopes: [...s] })),
    tokens: { access: tokens.size, refresh: refresh.size, liveRefresh: [...refresh.values()].filter((r) => !r.revoked && r.exp > now()).length },
    stats: sim.stats,
  }));
  return sim;
}

/** Gotov sim za prelazak: OLD = ID-jevi iz aplikacije (appDefaults), NEW = zadati. */
export function migrationSim(newIds = {}, opts = {}) {
  const o = appDefaults(), nw = { clientId: 'NEW-sim.apps.googleusercontent.com', apiKey: 'AIzaSim-NEW-key', helperUrl: 'https://script.google.com/macros/s/NEW-sim/exec', ...newIds };
  return createSim({
    ...opts,
    projects: { OLD: {}, NEW: {}, ...(opts.projects || {}) },
    clients: { [o.clientId]: { project: 'OLD' }, [nw.clientId]: { project: 'NEW' }, ...(opts.clients || {}) },
    keys: { [o.apiKey]: { project: 'OLD' }, [nw.apiKey]: { project: 'NEW' }, ...(opts.keys || {}) },
    helpers: { [o.helperUrl]: { client: o.clientId }, [nw.helperUrl]: { client: nw.clientId }, ...(opts.helpers || {}) },
  });
}

// ---------------- Playwright ----------------
export const SIM_ROUTES = [/^https:\/\/[a-z]+\.googleapis\.com\/(upload\/)?drive\/v3\//, /^https:\/\/oauth2\.googleapis\.com\/(revoke|tokeninfo)/, /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/, /^https:\/\/accounts\.google\.com\/gsi\/client/];
const cors = (origin) => ({ 'access-control-allow-origin': origin || '*', 'access-control-allow-credentials': 'true', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,content-range,x-upload-content-type,x-upload-content-length', 'access-control-expose-headers': 'location,range,x-guploader-uploadid' });
/** Handler za page.route / context.route: sve Google adrese ide u sim. */
export function routeHandler(sim) {
  return async (route) => {
    const r = route.request(), h = r.headers(), origin = h.origin;
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    let o;
    try { o = await sim.handle({ url: r.url(), method: r.method(), headers: h, body: r.postDataBuffer() || undefined }); }
    catch (e) { if (e instanceof TypeError) return route.abort('internetdisconnected').catch(() => {}); throw e; }
    return route.fulfill({ status: o.status, headers: { ...o.headers, ...cors(origin) }, body: o.body ? Buffer.from(o.body) : '' }).catch(() => {});
  };
}
/** Uređaj (context) povezan sa simom: rute + window.__simAuth + (po želji) GIS odmah u stranici. Vraća dev. */
export async function installSim(sim, context, dev = sim.device(), { initScript = false } = {}) {
  await context.exposeBinding('__simAuth', (src, req) => { let origin = ''; try { origin = new URL(src.page.url()).origin; } catch {} return sim.authorize(dev, req, { origin }); });
  if (initScript) await context.addInitScript(GIS_STUB);
  const h = routeHandler(sim);
  for (const re of SIM_ROUTES) await context.route(re, h);
  return dev;
}
export { GIS_STUB };
