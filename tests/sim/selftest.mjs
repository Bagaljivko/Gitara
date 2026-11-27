// Provera simulatora: node tests/sim/selftest.mjs  (bez pregledača; poslednji deo koristi pravi src/syncDrive.js)
import { createSim, migrationSim, appDefaults, SCOPES } from './driveSim.mjs';
import { createDrive } from '../../src/syncDrive.js';

let pass = 0, fail = 0;
const ok = (c, msg, d) => { if (c) { pass++; console.log('  ok  ' + msg); } else { fail++; console.log('  FAIL ' + msg, d === undefined ? '' : JSON.stringify(d)); } };
const section = (s) => console.log('\n# ' + s);
const reason = async (r) => { try { const j = await r.clone().json(); return j.error && j.error.errors && j.error.errors[0].reason; } catch { return ''; } };

const API = 'https://www.googleapis.com/drive/v3', UP = 'https://www.googleapis.com/upload/drive/v3';
const sim = createSim({
  clock: 'virtual',
  projects: { OLD: { userPerSec: 10, unitsPerMin: 300 }, NEW: {}, NOAPI: { apis: [] } },
  clients: { 'old.apps': { project: 'OLD' }, 'new.apps': { project: 'NEW', origins: ['https://app.test'] } },
  keys: { K_OLD: { project: 'OLD' }, K_NEW: { project: 'NEW' }, K_NOAPI: { project: 'NOAPI' }, K_RESTR: { project: 'NEW', apis: ['youtube'] } },
  helpers: { 'https://script.google.com/macros/s/OLDH/exec': { client: 'old.apps' }, 'https://script.google.com/macros/s/NEWH/exec': { client: 'new.apps' } },
  users: ['teacher@x.test', 'student@x.test'],
});
const F = sim.fetch;
const auth = (t, extra = {}) => ({ ...extra, headers: { Authorization: 'Bearer ' + t, ...(extra.headers || {}) } });
const mp = (meta, content, type = 'application/json') => { const b = 'sb' + Math.random().toString(36).slice(2); return { headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body: new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${type}\r\n\r\n`, content, `\r\n--${b}--`]) }; };
const tick = () => sim.advance(1000); // virtuelni sat: sekunda između koraka (da limit po sekundi ne smeta)

section('per-project visibility (drive.file)');
const oldT = sim.issueToken('teacher@x.test', 'OLD').access_token, newT = sim.issueToken('teacher@x.test', 'NEW').access_token;
let r = await F(`${UP}/files?uploadType=multipart&fields=id,name`, { method: 'POST', ...mp({ name: 'plan.json', mimeType: 'application/json' }, '{"a":1}'), headers: { ...mp({}, '').headers, Authorization: 'Bearer ' + oldT } });
// (gore: zaglavlje boundary mora da odgovara telu — pa ispod pravimo kako treba)
const up = async (tok, meta, content, url = `${UP}/files?uploadType=multipart&fields=id,name,parents`) => { const m = mp(meta, content); return F(url, { method: 'POST', body: m.body, headers: { ...m.headers, Authorization: 'Bearer ' + tok } }); };
ok(r.status === 400, 'multipart with wrong boundary → 400', r.status);
r = await up(oldT, { name: 'plan.json', mimeType: 'application/json' }, '{"a":1}');
const plan = await r.json();
ok(r.status === 200 && plan.id && plan.name === 'plan.json', 'OLD token creates file', plan);
tick();
r = await F(`${API}/files/${plan.id}?alt=media`, auth(oldT)); ok(r.status === 200 && (await r.text()) === '{"a":1}', 'OLD token reads its file');
r = await F(`${API}/files/${plan.id}?alt=media`, auth(newT)); ok(r.status === 404 && (await reason(r)) === 'notFound', 'NEW token (same user) gets 404 notFound');
r = await F(`${API}/files?spaces=drive&q=${encodeURIComponent("name='plan.json' and trashed=false")}&fields=files(id)`, auth(newT));
ok((await r.json()).files.length === 0, 'NEW token lists nothing');
r = await F(`${API}/files/${plan.id}?alt=media&key=K_NEW`); ok(r.status === 404, 'not shared yet → key read 404');
r = await F(`${API}/files/${plan.id}/permissions?fields=id`, auth(oldT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'anyone', role: 'reader', allowFileDiscovery: false }) }));
ok((await r.json()).id === 'anyoneWithLink', 'share anyone/reader → anyoneWithLink');
r = await F(`${API}/files/${plan.id}?alt=media&key=K_NEW`); ok(r.status === 200 && (await r.text()) === '{"a":1}', 'shared OLD file readable with NEW key');
r = await F(`${API}/files/${plan.id}?alt=media&key=K_OLD`); ok(r.status === 200, 'and with OLD key');
r = await F(`${API}/files/${plan.id}/permissions?fields=permissions(id,type,role)`, auth(oldT)); ok((await r.json()).permissions.length === 2, 'permissions list (owner + anyone)');
r = await F(`${API}/files/${plan.id}/permissions/anyoneWithLink`, auth(oldT, { method: 'DELETE' })); ok(r.status === 204, 'unshare');
r = await F(`${API}/files/${plan.id}?alt=media&key=K_NEW`); ok(r.status === 404, 'unshared → key read 404');
const stud = sim.issueToken('student@x.test', 'OLD').access_token;
r = await F(`${API}/files/${plan.id}?alt=media`, auth(stud)); ok(r.status === 404, 'other user, same project → 404');
tick();

section('keys');
sim.setPublic(plan.id, true);
r = await F(`${API}/files/${plan.id}?alt=media&key=K_NOAPI`); ok(r.status === 403 && (await reason(r)) === 'accessNotConfigured', 'key of project without Drive API → 403 accessNotConfigured');
r = await F(`${API}/files/${plan.id}?alt=media&key=K_RESTR`); ok(r.status === 403, 'key restricted to other APIs → 403');
r = await F(`${API}/files/${plan.id}?alt=media&key=NOPE`); ok(r.status === 400 && /API key not valid/.test(await r.text()), 'unknown key → 400 "API key not valid" (as real Google)');
r = await F(`${API}/files?spaces=drive&key=K_NEW`); ok(r.status === 401, 'key alone cannot list → 401');
r = await F(`${API}/files/${plan.id}?alt=media`); ok(r.status === 403, 'no credentials → 403');

section('appData isolation');
const syncT = sim.issueToken('student@x.test', 'NEW', 'drive.file drive.appdata').access_token, fileOnly = sim.issueToken('student@x.test', 'NEW', 'drive.file').access_token;
r = await up(syncT, { name: 'g-a.gz', parents: ['appDataFolder'], appProperties: { k: 'a' } }, 'AAA'); const ad = await r.json();
ok(r.status === 200 && ad.parents[0].startsWith('appdata-'), 'appData create (parents → real appDataFolder id)', ad);
r = await F(`${API}/files?spaces=appDataFolder&fields=files(id,name,appProperties)`, auth(syncT)); let j = await r.json();
ok(j.files.length === 1 && j.files[0].appProperties.k === 'a', 'listed in appDataFolder with appProperties', j);
r = await F(`${API}/files?spaces=drive&fields=files(id)`, auth(syncT)); ok((await r.json()).files.length === 0, 'not in spaces=drive');
r = await F(`${API}/files?spaces=appDataFolder`, auth(fileOnly)); ok(r.status === 403 && (await reason(r)) === 'insufficientScopes', 'drive.file-only token: appDataFolder → 403 insufficientScopes');
r = await F(`${API}/files/${ad.id}?alt=media`, auth(fileOnly)); ok(r.status === 404, 'drive.file-only token: appData file → 404');
const syncOld = sim.issueToken('student@x.test', 'OLD', 'drive.file drive.appdata').access_token;
r = await F(`${API}/files?spaces=appDataFolder&fields=files(id)`, auth(syncOld)); ok((await r.json()).files.length === 0, 'OLD project appDataFolder is separate (empty)');
r = await up(fileOnly, { name: 'x', parents: ['appDataFolder'] }, 'x'); ok(r.status === 403, 'drive.file-only token cannot write appData');
tick();

section('changes feed');
r = await F(`${API}/changes/startPageToken?fields=startPageToken`, auth(syncT)); const st = (await r.json()).startPageToken;
for (let i = 0; i < 5; i++) { await up(syncT, { name: `g-${i}.gz`, parents: ['appDataFolder'], appProperties: { i: String(i) } }, 'x' + i); tick(); }
await up(syncOld, { name: 'old.gz', parents: ['appDataFolder'] }, 'o'); // drugi projekat — ne sme da se vidi
const m = mp({ appProperties: { k: 'a2' } }, 'AAA2');
r = await F(`${UP}/files/${ad.id}?uploadType=multipart&fields=id`, { method: 'PATCH', body: m.body, headers: { ...m.headers, Authorization: 'Bearer ' + syncT } }); ok(r.status === 200, 'PATCH multipart update');
r = await F(`${API}/files/${ad.id}`, auth(syncT, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appProperties: { k: 'a3' } }) })); ok(r.status === 200, 'PATCH metadata');
const firstList = await (await F(`${API}/files?spaces=appDataFolder&q=${encodeURIComponent("name contains 'g-'")}&fields=files(id,name)`, auth(syncT))).json();
const del = firstList.files.find((f) => f.name === 'g-0.gz');
r = await F(`${API}/files/${del.id}`, auth(syncT, { method: 'DELETE' })); ok(r.status === 204, 'DELETE');
tick();
const f = 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,trashed,appProperties))';
let all = [], tok = st, pages = 0, nst = null;
while (tok) { j = await (await F(`${API}/changes?spaces=appDataFolder&includeRemoved=true&pageSize=2&pageToken=${tok}&fields=${encodeURIComponent(f)}`, auth(syncT))).json(); all.push(...j.changes); pages++; tok = j.nextPageToken; nst = j.newStartPageToken || nst; tick(); }
ok(pages === 3 && all.length === 6, 'paged changes: 5 new + 1 updated (deduped), pageSize 2 → 3 pages', { pages, n: all.length });
ok(all.some((c) => c.removed && c.fileId === del.id && !c.file), 'removed entry for deleted file');
ok(all.find((c) => c.fileId === ad.id).file.appProperties.k === 'a3', 'change carries current appProperties');
ok(!all.some((c) => c.file && c.file.name === 'old.gz'), 'OLD-project change not visible to NEW token');
j = await (await F(`${API}/changes?spaces=appDataFolder&pageToken=${nst}&fields=${encodeURIComponent(f)}`, auth(syncT))).json();
ok(j.changes.length === 0 && j.newStartPageToken === nst, 'no changes after newStartPageToken');
r = await F(`${API}/changes?spaces=appDataFolder&pageToken=999999`, auth(syncT)); ok(r.status === 400, 'future/invalid pageToken → 400');

section('queries, paging, orderBy, fields');
const fold = await (await F(`${API}/files?fields=id`, auth(newT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'MARLI – deljeno', mimeType: 'application/vnd.google-apps.folder' }) }))).json();
for (let i = 0; i < 7; i++) { await up(newT, { name: `backup-2026-01-0${i}.json`, parents: [fold.id], appProperties: { gitaraShare: '1' } }, `{"i":${i}}`); tick(); }
const q = `name contains 'backup-' and '${fold.id}' in parents and trashed=false`;
j = await (await F(`${API}/files?spaces=drive&pageSize=3&orderBy=name desc&fields=${encodeURIComponent('nextPageToken,files(id,name,modifiedTime)')}&q=${encodeURIComponent(q)}`, auth(newT))).json();
ok(j.files.length === 3 && j.files[0].name === 'backup-2026-01-06.json' && j.nextPageToken && !('appProperties' in j.files[0]), 'name contains + in parents + orderBy name desc + fields', j);
let n2 = j.files.length; while (j.nextPageToken) { j = await (await F(`${API}/files?spaces=drive&pageSize=3&orderBy=name desc&fields=${encodeURIComponent('nextPageToken,files(id,name)')}&q=${encodeURIComponent(q)}&pageToken=${j.nextPageToken}`, auth(newT))).json(); n2 += j.files.length; tick(); }
ok(n2 === 7, 'paging returns all 7');
j = await (await F(`${API}/files?spaces=drive&q=${encodeURIComponent("name contains 'up-2026'")}&fields=files(id)`, auth(newT))).json(); ok(j.files.length === 0, "name contains is prefix-of-word (like Drive): 'up-2026' does not match");
j = await (await F(`${API}/files?spaces=drive&q=${encodeURIComponent("mimeType='application/vnd.google-apps.folder' and name='MARLI – deljeno'")}&fields=files(id)`, auth(newT))).json(); ok(j.files.length === 1 && j.files[0].id === fold.id, 'folder lookup by name + mimeType');
r = await F(`${API}/files?q=${encodeURIComponent("name='a' or name='b'")}`, auth(newT)); ok(r.status === 400, 'unsupported q (or) → 400 invalid');
r = await F(`${API}/about?fields=user(permissionId,emailAddress,displayName)`, auth(newT)); j = await r.json(); ok(j.user.emailAddress === 'teacher@x.test' && /^\d+$/.test(j.user.permissionId), 'about.user', j);
r = await F(`${API}/about`, auth(newT)); ok(r.status === 400, 'about without fields → 400');
tick();

section('upload limits');
const big = new Uint8Array(5 * 1024 * 1024 + 10);
r = await up(newT, { name: 'big.bin' }, big); ok(r.status === 413, 'multipart > 5 MB → 413', r.status);
r = await F(`${UP}/files?uploadType=resumable&fields=id,size`, auth(newT, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(big.length) }, body: JSON.stringify({ name: 'big.bin', parents: [fold.id] }) }));
const loc = r.headers.get('location'); ok(r.status === 200 && /upload_id=/.test(loc), 'resumable init → Location', loc);
const CH = 2 * 1024 * 1024; let off = 0, last;
while (off < big.length) { const end = Math.min(off + CH, big.length); last = await F(loc, { method: 'PUT', headers: { 'Content-Range': `bytes ${off}-${end - 1}/${big.length}` }, body: big.subarray(off, end) }); if (last.status === 308) off = +last.headers.get('range').split('-')[1] + 1; else break; }
j = await last.json(); ok(last.status === 200 && j.size === String(big.length), 'resumable chunked upload completes', j);
r = await F(loc, { method: 'PUT', headers: { 'Content-Range': `bytes */${big.length}` } }); ok(r.status === 200, 'status query after completion → 200');
r = await F(`${UP}/files?uploadType=resumable`, auth(newT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'odd.bin' }) }));
const loc2 = r.headers.get('location');
r = await F(loc2, { method: 'PUT', headers: { 'Content-Range': 'bytes 0-299999/600000' }, body: new Uint8Array(300000) }); ok(r.status === 308 && r.headers.get('range') === `bytes=0-${256 * 1024 - 1}`, 'non-256KiB chunk: only full 256 KiB kept (308 Range)', r.headers.get('range'));
r = await F(loc2, { method: 'PUT', headers: { 'Content-Range': 'bytes */600000' } }); ok(r.status === 308, 'status query mid-upload → 308');
r = await F(loc2, { method: 'PUT', headers: { 'Content-Range': `bytes ${256 * 1024}-599999/600000` }, body: new Uint8Array(600000 - 256 * 1024) }); ok(r.status === 200, 'resume from Range → done');
sim.addUser('full@x.test', { quota: 1000 }); const fullT = sim.issueToken('full@x.test', 'NEW').access_token;
r = await up(fullT, { name: 'q' }, new Uint8Array(2000)); ok(r.status === 403 && (await reason(r)) === 'storageQuotaExceeded', 'storage quota → 403 storageQuotaExceeded');
tick();

section('rate limits (virtual clock)');
const rl = sim.issueToken('teacher@x.test', 'OLD').access_token;
let codes = [];
for (let i = 0; i < 12; i++) { r = await F(`${API}/files?fields=files(id)`, auth(rl)); codes.push(r.status === 403 ? await reason(r) : r.status); }
ok(codes.slice(0, 10).every((c) => c === 200) && codes[10] === 'userRateLimitExceeded', 'per-user 10 req/s → 11th is 403 userRateLimitExceeded', codes);
sim.advance(1000);
r = await F(`${API}/files?fields=files(id)`, auth(rl)); ok(r.status === 200, 'next second OK again');
// projekat OLD: 300 jedinica/min — mnogo korisnika, svaki ispod svog limita
sim.advance(61000);
let hit = null;
for (let i = 0; i < 400 && !hit; i++) { const t = sim.issueToken(`s${i % 40}@x.test`, 'OLD').access_token; r = await F(`${API}/files?fields=files(id)`, auth(t)); if (r.status === 403) hit = { i, j: await r.json() }; }
ok(hit && hit.i === 300 && hit.j.error.errors[0].reason === 'rateLimitExceeded' && /Total Query Cost/.test(hit.j.error.message), 'project 300 units/min → 301st is 403 rateLimitExceeded "Total Query Cost"', hit && { i: hit.i, msg: hit.j.error.message });
r = await F(`${API}/files/${plan.id}?alt=media&key=K_OLD`); ok(r.status === 403, 'public key reads count against the key project quota too');
sim.advance(60000);
r = await F(`${API}/files/${plan.id}?alt=media&key=K_OLD`); ok(r.status === 200, 'quota window slides after a minute');
ok(sim.stats.byProject.OLD > 300 && sim.stats.byEndpoint['files.list'] > 300 && sim.stats.rateLimited >= 3, 'stats count per project/endpoint/rate-limited', { OLD: sim.stats.byProject.OLD, rl: sim.stats.rateLimited });

section('fault injection');
sim.fail({ match: (q) => q.ep === 'files.media' && q.user === 'teacher@x.test', status: 503, reason: 'backendError', times: 2 });
r = await F(`${API}/files/${plan.id}?alt=media`, auth(oldT)); const s1 = r.status;
r = await F(`${API}/files/${plan.id}?alt=media`, auth(oldT)); const s2 = r.status;
r = await F(`${API}/files/${plan.id}?alt=media`, auth(oldT)); ok(s1 === 503 && s2 === 503 && r.status === 200, 'fail() times:2 then recovers', [s1, s2, r.status]);
sim.fail({ match: (q) => q.ep === 'files.list', status: 403, reason: 'rateLimitExceeded' });
r = await F(`${API}/files?fields=files(id)`, auth(newT)); ok(r.status === 403 && (await reason(r)) === 'rateLimitExceeded', 'injected rateLimitExceeded with Google error shape');
sim.offline(true);
let threw = false; try { await F(`${API}/files`, auth(newT)); } catch (e) { threw = e instanceof TypeError; }
ok(threw, 'offline → fetch throws TypeError'); sim.offline(false);
sim.dropAfter(2); const res3 = [];
for (let i = 0; i < 3; i++) { try { res3.push((await F(`${API}/files/${plan.id}?alt=media&key=K_NEW`)).status); } catch { res3.push('drop'); } }
ok(res3.join() === '200,200,drop', 'dropAfter(2): 2 succeed, then connection lost', res3); sim.offline(false);
sim.advance(1000);

section('auth: token helper, GIS decisions, revoke, expiry');
const dev = sim.device({ accounts: ['fresh1@x.test'] });
let a = sim.authorize(dev, { kind: 'token', client_id: 'new.apps', scope: SCOPES.file, prompt: 'none' }, { origin: 'https://app.test' });
ok(a.callback.error === 'consent_required', 'silent token, no consent yet → consent_required', a);
const dev2 = sim.device({ accounts: ['fresh2@x.test'] });
a = sim.authorize(dev2, { kind: 'code', client_id: 'new.apps', scope: `${SCOPES.file} ${SCOPES.appdata}` }, { origin: 'https://app.test' });
ok(a.callback.code && a.callback.prompt === 'consent', 'code flow: consent → code', a);
let h = await (await F('https://script.google.com/macros/s/OLDH/exec', { method: 'POST', body: JSON.stringify({ a: 'exchange', code: a.callback.code }) })).json();
ok(h.error === 'invalid_grant', 'NEW code exchanged at OLD helper → invalid_grant');
// (kod je i dalje neiskorišćen jer je odbijen drugom klijentu)
h = await (await F('https://script.google.com/macros/s/NEWH/exec', { method: 'POST', body: JSON.stringify({ a: 'exchange', code: a.callback.code }) })).json();
ok(h.access_token && h.refresh_token && /drive\.appdata/.test(h.scope), 'exchange at NEW helper → access + refresh', h);
let h2 = await (await F('https://script.google.com/macros/s/NEWH/exec', { method: 'POST', body: JSON.stringify({ a: 'exchange', code: a.callback.code }) })).json();
ok(h2.error === 'invalid_grant', 'code reuse → invalid_grant');
h2 = await (await F('https://script.google.com/macros/s/OLDH/exec', { method: 'POST', body: JSON.stringify({ a: 'refresh', rt: h.refresh_token }) })).json();
ok(h2.error === 'unauthorized_client', 'NEW refresh token at OLD helper → unauthorized_client (not invalid_grant!)', h2);
h2 = await (await F('https://script.google.com/macros/s/NEWH/exec', { method: 'POST', body: JSON.stringify({ a: 'refresh', rt: h.refresh_token }) })).json();
ok(h2.access_token && !h2.refresh_token, 'refresh → new access token');
a = sim.authorize(dev2, { kind: 'code', client_id: 'new.apps', scope: SCOPES.file, hint: 'fresh2@x.test' }, { origin: 'https://app.test' });
const h3 = await (await F('https://script.google.com/macros/s/NEWH/exec', { method: 'POST', body: JSON.stringify({ a: 'exchange', code: a.callback.code }) })).json();
ok(a.callback.prompt === 'none' && h3.access_token && !h3.refresh_token, 'second code without new consent → no refresh_token (Google behavior)', h3);
a = sim.authorize(dev2, { kind: 'token', client_id: 'new.apps', scope: SCOPES.file, prompt: 'none', hint: 'fresh2@x.test' }, { origin: 'https://app.test' });
ok(a.callback.access_token, 'silent token after consent → ok');
dev2.next('cancel', 'blocked', 'deny', { untick: ['drive.appdata'] });
const kinds = [];
for (let i = 0; i < 3; i++) { const x = sim.authorize(dev2, { kind: 'token', client_id: 'new.apps', scope: SCOPES.file, prompt: '' }, { origin: 'https://app.test' }); kinds.push(x.error_callback ? x.error_callback.type : x.callback.error); }
ok(kinds.join() === 'popup_closed,popup_failed_to_open,access_denied', 'queued behaviors: cancel, blocked, deny', kinds);
const dev3 = sim.device({ accounts: ['new@x.test'] }).next({ untick: ['drive.appdata'] });
a = sim.authorize(dev3, { kind: 'token', client_id: 'new.apps', scope: `${SCOPES.file} ${SCOPES.appdata}`, prompt: '' }, { origin: 'https://app.test' });
ok(a.callback.scope === SCOPES.file, 'partial consent (user unticks drive.appdata)', a.callback.scope);
a = sim.authorize(dev3, { kind: 'token', client_id: 'new.apps', scope: SCOPES.file, prompt: '' }, { origin: 'https://evil.test' });
ok(a.error_callback && a.error_callback.type === 'popup_closed' && dev3.log.at(-1).result === 'origin_mismatch', 'origin not authorized for client → popup error (origin_mismatch)');
r = await F('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=' + encodeURIComponent(h.refresh_token) });
ok(r.status === 200, 'revoke refresh token');
h2 = await (await F('https://script.google.com/macros/s/NEWH/exec', { method: 'POST', body: JSON.stringify({ a: 'refresh', rt: h.refresh_token }) })).json();
ok(h2.error === 'invalid_grant', 'after revoke → invalid_grant');
r = await F(`${API}/files?fields=files(id)`, auth(h3.access_token)); ok(r.status === 401 && (await reason(r)) === 'authError', 'access tokens of revoked grant → 401 authError');
const exp = sim.issueToken('teacher@x.test', 'NEW').access_token; sim.advance(3600e3);
r = await F(`${API}/files?fields=files(id)`, auth(exp)); ok(r.status === 401, 'token expires after 1 h (virtual clock)');
const sTest = createSim({ clock: 'virtual', projects: { T: { publishing: 'testing', testUsers: ['ok@x.test'] } }, clients: { c: { project: 'T' } }, helpers: { 'https://script.google.com/macros/s/T/exec': { client: 'c' } } });
const dT = sTest.device({ accounts: ['ok@x.test', 'kid@x.test'] });
ok(sTest.authorize(dT, { kind: 'code', client_id: 'c', scope: SCOPES.file, hint: 'kid@x.test' }).callback.error === 'access_denied', 'testing-mode project: non-test user → access_denied');
const cT = sTest.authorize(dT, { kind: 'code', client_id: 'c', scope: SCOPES.file, hint: 'ok@x.test' }).callback.code;
const rtT = (await (await sTest.fetch('https://script.google.com/macros/s/T/exec', { method: 'POST', body: JSON.stringify({ a: 'exchange', code: cT }) })).json()).refresh_token;
sTest.advance(7 * 86400e3 + 1);
ok((await (await sTest.fetch('https://script.google.com/macros/s/T/exec', { method: 'POST', body: JSON.stringify({ a: 'refresh', rt: rtT }) })).json()).error === 'invalid_grant', 'testing-mode refresh token dies after 7 days');

section("app's real src/syncDrive.js against the sim");
const sApp = createSim({ projects: { NEW: {} }, clients: { n: { project: 'NEW' } } });
let T = sApp.issueToken('kid@x.test', 'NEW').access_token;
const d = createDrive(async (force) => { if (force) T = sApp.issueToken('kid@x.test', 'NEW').access_token; return T; }, { fetchFn: sApp.fetch, baseDelay: 1 });
const me = await d.about(); ok(me.email === 'kid@x.test' && me.id, 'about()');
const t0 = await d.startToken();
const c1 = await d.put('song:1', new TextEncoder().encode('one'), { k: 'song:1', v: '1' });
await d.put('song:1', new TextEncoder().encode('one-b'), { k: 'song:1', v: '2' }, c1.fileId);
const c2 = await d.put('song:2', new TextEncoder().encode('two'), { k: 'song:2', v: '1' });
await d.del(c2.fileId);
const ch = await d.changes(t0);
ok(ch.items.length === 2 && ch.items.find((x) => x.fileId === c1.fileId).props.v === '2' && ch.items.find((x) => x.fileId === c2.fileId).removed && ch.newStart, 'changes(): update + removed', ch);
ok(new TextDecoder().decode(await d.get(c1.fileId)) === 'one-b', 'get() returns updated bytes');
ok((await d.list()).length === 1, 'list()');
sApp.expireTokens();
ok((await d.list()).length === 1, '401 → app forces new token and retries');
await d.del('missing-id'); ok(true, 'del() of missing file tolerated (404 okStatus)');
const other = await d.put('song:3', new TextEncoder().encode('x'), {}, 'id-from-OLD-project'); ok(other.fileId && other.fileId !== 'id-from-OLD-project', 'put() with fileId from another project → 404 → creates new (migration path)');

section('appDefaults / migrationSim');
const ad0 = appDefaults(); ok(/apps\.googleusercontent\.com$/.test(ad0.clientId) && ad0.apiKey.startsWith('AIza') && /\/exec$/.test(ad0.helperUrl), 'reads current IDs from src/', ad0);
const ms = migrationSim(); ok(ms.clients[ad0.clientId].project === 'OLD' && ms.keys[ad0.apiKey].project === 'OLD', 'migrationSim maps app IDs → OLD');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
