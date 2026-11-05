// Sinhronizacija između uređaja (Google Drive appDataFolder) — dva (i više) simulirana uređaja, lažni Drive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createClock, SCHEMA, gzip, sha } from '../src/syncEngine.js';
import { memDrive, memDevice } from './helpers/syncFakes.mjs';

const song = (i, extra = {}) => ({ id: 's' + i, title: 'Pesma ' + i, artist: 'Bend', key: 'G', sections: [{ name: 'Strofa', lines: [{ text: `tekst pesme broj ${i} — `.repeat(12), chords: [{ chord: 'G', position: 0 }, { chord: 'C', position: 20 }] }] }], ...extra });
function dev(name, drive, opts = {}) {
  const d = memDevice(name, opts.now);
  d.asked = [];
  d.engine = createEngine(d.local, drive.remote, { node: name, now: opts.now, ask: async (kind, info) => { d.asked.push({ kind, ...info }); return opts.answer ?? true; } });
  d.sync = () => d.engine.sync();
  return d;
}

test('two devices edit offline, then reconnect: both end up with everything', async () => {
  const drive = memDrive();
  const A = dev('A', drive), B = dev('B', drive);
  A.edit('song:s1', song(1)); A.edit('song:s2', song(2));
  B.edit('song:s3', song(3)); B.edit('set:x', { id: 'x', name: 'Svirka', songIds: ['s3'] });
  await A.sync(); await B.sync(); await A.sync();
  for (const d of [A, B]) assert.deepEqual([...d.data.keys()].sort(), ['set:x', 'song:s1', 'song:s2', 'song:s3']);
  assert.equal(A.pending() + B.pending(), 0);
  // više izmena iste pesme pre sinhronizacije = jedna promena (jedan fajl)
  for (let k = 0; k < 5; k++) A.edit('song:s1', song(1, { title: 'Pesma 1 v' + k }));
  const req = drive.stats.req; await A.sync();
  assert.ok(drive.stats.req - req <= 3, `outbox coalesced: ${drive.stats.req - req} requests`);
  await B.sync(); assert.equal(B.data.get('song:s1').title, 'Pesma 1 v4');
});

test('same song edited on both: newest wins everywhere, the other edit is kept as "Prethodna verzija"', async () => {
  const drive = memDrive();
  let t = 1000; const now = () => t;
  const A = dev('A', drive, { now }), B = dev('B', drive, { now });
  A.edit('song:s1', song(1)); await A.sync(); await B.sync();
  t = 2000; A.edit('song:s1', song(1, { title: 'A menja' }));
  t = 3000; B.edit('song:s1', song(1, { title: 'B menja' }));
  await A.sync(); await B.sync(); await A.sync();
  assert.equal(A.data.get('song:s1').title, 'B menja'); assert.equal(B.data.get('song:s1').title, 'B menja');
  assert.ok([...A.versions, ...B.versions].some((v) => v.value.title === 'A menja'), 'losing edit kept');
});

test('deleted on one device, edited (later) on the other: the edit wins; deleted later: deletion wins, edit kept', async () => {
  const drive = memDrive();
  let t = 1000; const now = () => t;
  const A = dev('A', drive, { now }), B = dev('B', drive, { now });
  A.edit('song:s1', song(1)); A.edit('song:s2', song(2)); await A.sync(); await B.sync();
  t = 2000; A.remove('song:s1'); t = 3000; B.edit('song:s1', song(1, { title: 'oživljena' }));
  t = 4000; B.edit('song:s2', song(2, { title: 'izmena pa brisanje' })); t = 5000; A.remove('song:s2');
  await A.sync(); await B.sync(); await A.sync();
  for (const d of [A, B]) { assert.equal(d.data.get('song:s1').title, 'oživljena'); assert.ok(!d.data.has('song:s2')); }
  assert.ok(B.versions.some((v) => v.value.title === 'izmena pa brisanje'));
});

test('practice progress always keeps the best values from both devices (no loser)', async () => {
  const drive = memDrive();
  const A = dev('A', drive), B = dev('B', drive);
  A.edit('practice', { v: 1, games: { pauk: { best: 90, plays: 3, lastDay: '2026-11-1' } }, songs: {} });
  B.edit('practice', { v: 1, games: { pauk: { best: 70, plays: 9, lastDay: '2026-11-5' }, ritam: { best: 60, plays: 1 } }, songs: {} });
  await A.sync(); await B.sync(); await A.sync();
  for (const d of [A, B]) {
    const p = d.data.get('practice');
    assert.equal(p.games.pauk.best, 90); assert.equal(p.games.pauk.plays, 9); assert.equal(p.games.ritam.best, 60);
  }
});

test('300 songs: first sync uses one snapshot; a new device gets everything in a few requests; then incremental', async () => {
  const drive = memDrive();
  const A = dev('A', drive);
  for (let i = 0; i < 300; i++) A.edit('song:s' + i, song(i));
  let r0 = drive.stats.req; await A.sync();
  const firstReq = drive.stats.req - r0;
  assert.ok(firstReq <= 6, `first upload: ${firstReq} requests`);
  const B = dev('B', drive);
  r0 = drive.stats.req; await B.sync();
  assert.equal(B.data.size, 300); assert.ok(drive.stats.req - r0 <= 6, `new device: ${drive.stats.req - r0} requests`);
  A.edit('song:s7', song(7, { title: 'nova' })); await A.sync();
  r0 = drive.stats.req; const before = drive.stats.bytesDown; await B.sync();
  assert.equal(B.data.get('song:s7').title, 'nova');
  assert.ok(drive.stats.req - r0 <= 4 && drive.stats.bytesDown - before < 4000, 'incremental: one small file');
});

test('measure: per-item files vs 12 shards for a 300-song library (phone network: 150 ms, 1.5 MB/s, 4 parallel)', async () => {
  // isti posao, dve strategije; vreme = zahtevi × kašnjenje / 4 paralelno + bajtovi / propusnost
  const lat = 150, bw = 1.5e6;
  const songs = Array.from({ length: 300 }, (_, i) => song(i));
  const sizes = await Promise.all(songs.map(async (s) => (await gzip({ s: 1, k: 'song:' + s.id, h: 'x', v: s })).length));
  const all = sizes.reduce((a, b) => a + b, 0), shard = all / 12 * 0.85; // shard se malo bolje sažima
  const time = (reqs, bytes) => Math.round((Math.ceil(reqs / 4) * lat) + (bytes / bw) * 1000);
  const perItem = { oneEdit: time(2, sizes[0]), tenEdits: time(11, sizes[0] * 10), otherDevicePull1: time(2, sizes[0]) };
  const shards = { oneEdit: time(3, shard * 2), tenEdits: time(1 + 2 * Math.min(12, 8), shard * 8 * 2), otherDevicePull1: time(2, shard) };
  console.log(`per-item: ${JSON.stringify(perItem)} ms; shards(12): ${JSON.stringify(shards)} ms; library ${Math.round(all / 1024)} KB gz`);
  assert.ok(perItem.oneEdit <= shards.oneEdit && perItem.otherDevicePull1 <= shards.otherDevicePull1, 'per-item files win for everyday edits');
});

test('newer schema from a newer app version: never overwritten, never applied — "Ažuriraj aplikaciju"', async () => {
  const drive = memDrive();
  const A = dev('A', drive);
  A.edit('song:s1', song(1)); await A.sync();
  // noviji klijent upiše stavku sa šemom 2
  const p = { s: SCHEMA + 1, k: 'song:s1', h: createClock('N').tick() + 'z', d: 0, v: { ...song(1), title: 'nova šema', future: { x: 1 } } };
  const bytes = await gzip(p);
  await drive.remote.put('song:s1', bytes, { k: 'song:s1', h: p.h, s: String(SCHEMA + 1), d: '0', x: await sha(bytes) }, drive.fileOf('song:s1')[0]);
  A.edit('song:s1', song(1, { title: 'stari klijent menja' }));
  const r = await A.sync();
  assert.equal(r.newer, true);
  assert.equal(A.data.get('song:s1').title, 'stari klijent menja', 'not applied');
  const f = drive.files.get(drive.fileOf('song:s1')[0]);
  assert.equal(f.props.s, String(SCHEMA + 1), 'not overwritten by the older app');
});

test('unknown fields survive round trips (an older app never strips data)', async () => {
  const drive = memDrive();
  const A = dev('A', drive), B = dev('B', drive);
  A.edit('song:s1', song(1, { budućePolje: { a: [1, 2] } })); await A.sync(); await B.sync();
  B.edit('song:s1', { ...B.data.get('song:s1'), title: 'B' }); await B.sync(); await A.sync();
  assert.deepEqual(A.data.get('song:s1').budućePolje, { a: [1, 2] });
});

test('eviction: a device whose storage was wiped is rebuilt from Drive — empty never means "deleted everything"', async () => {
  const drive = memDrive();
  const A = dev('A', drive), B = dev('B', drive);
  for (let i = 0; i < 30; i++) A.edit('song:s' + i, song(i));
  await A.sync(); await B.sync();
  const A2 = dev('A', drive); // isti uređaj, prazna memorija
  await A2.sync(); await B.sync();
  assert.equal(A2.data.size, 30); assert.equal(B.data.size, 30);
});

test('corrupt or partial file: skipped (hash mismatch), never applied, fetched again later', async () => {
  const drive = memDrive();
  const A = dev('A', drive), B = dev('B', drive);
  A.edit('song:s1', song(1)); await A.sync(); await B.sync();
  A.edit('song:s1', song(1, { title: 'nova' })); await A.sync();
  drive.corrupt(drive.fileOf('song:s1')[0]);
  await B.sync();
  assert.equal(B.data.get('song:s1').title, 'Pesma 1', 'corrupt version not applied');
  drive.heal(); await B.sync();
  assert.equal(B.data.get('song:s1').title, 'nova', 're-fetched');
});

test('expired / invalid page token: full reconcile against the ID map, nothing lost or duplicated', async () => {
  const drive = memDrive();
  const A = dev('A', drive), B = dev('B', drive);
  A.edit('song:s1', song(1)); await A.sync(); await B.sync();
  A.edit('song:s2', song(2)); A.edit('song:s1', song(1, { title: 'x' })); await A.sync();
  drive.expireTokens();
  await B.sync();
  assert.equal(B.data.get('song:s1').title, 'x'); assert.ok(B.data.has('song:s2'));
  assert.equal(drive.fileOf('song:s1').length, 1, 'no duplicate files');
});

test('mass-delete guard: a sync that would delete > 10 (or > 20 %) pauses and asks; "keep" restores everywhere', async () => {
  const drive = memDrive();
  const A = dev('A', drive), B = dev('B', drive, { answer: false });
  for (let i = 0; i < 30; i++) A.edit('song:s' + i, song(i));
  await A.sync(); await B.sync();
  for (let i = 0; i < 15; i++) A.remove('song:s' + i);
  await A.sync(); // A je pitan (odgovor: da)
  assert.equal(A.asked[0]?.kind, 'massDeleteOut');
  await B.sync();
  assert.equal(B.asked[0]?.kind, 'massDeleteIn'); assert.equal(B.data.size, 30, 'B kept them');
  await A.sync();
  assert.equal(A.data.size, 30, 'restored on A too');
});

test('both devices create the same settings item at the same time: one file wins, no endless duplicates', async () => {
  const drive = memDrive();
  let t = 1000; const now = () => t;
  const A = dev('A', drive, { now }), B = dev('B', drive, { now });
  A.edit('prefs', { lang: 'sr', a4: 440 }); t = 1500; B.edit('prefs', { lang: 'en', a4: 442 });
  await A.sync(); await B.sync(); await A.sync(); await B.sync();
  assert.deepEqual(A.data.get('prefs'), B.data.get('prefs'));
  assert.equal(A.data.get('prefs').lang, 'en');
});

test('first sign-in on a device that already has data: both sides merged, nothing overwritten', async () => {
  const drive = memDrive();
  const A = dev('A', drive), B = dev('B', drive);
  for (let i = 0; i < 25; i++) A.edit('song:a' + i, song('a' + i));
  await A.sync();
  for (let i = 0; i < 25; i++) B.edit('song:b' + i, song('b' + i));
  await B.sync(); await A.sync();
  assert.equal(A.data.size, 50); assert.equal(B.data.size, 50);
});

test('both devices upload the same song at the same moment: Drive never keeps the older version, both converge', async () => {
  const drive = memDrive({ latency: 5 });
  let t = 1000; const now = () => t;
  const A = dev('A', drive, { now }), B = dev('B', drive, { now });
  A.edit('song:s1', song(1)); await A.sync(); await B.sync();
  t = 2000; B.edit('song:s1', song(1, { title: 'starija (B)' }));
  t = 3000; A.edit('song:s1', song(1, { title: 'novija (A)' }));
  await Promise.all([A.sync(), B.sync()]); // istovremeno: oba šalju isti ključ
  await A.sync(); await B.sync(); await A.sync();
  assert.equal(A.data.get('song:s1').title, 'novija (A)');
  assert.equal(B.data.get('song:s1').title, 'novija (A)');
  // novi uređaj vidi novu verziju (najveća verzija za ključ), a zastareli fajlovi su obrisani
  const C = dev('C', drive); await C.sync();
  assert.equal(C.data.get('song:s1').title, 'novija (A)');
  assert.equal(drive.fileOf('song:s1').length, 1, 'one live file per song');
});

test('unknown item kinds from a same-schema app are kept untouched on round trips', async () => {
  const drive = memDrive();
  const A = dev('A', drive), B = dev('B', drive);
  A.edit('future:thing', { a: 1, nested: { b: [1, 2] } });
  await A.sync(); await B.sync();
  assert.deepEqual(B.data.get('future:thing'), { a: 1, nested: { b: [1, 2] } });
});

test('edits that raced (each device already sent its own): the losing edit is still kept as "Prethodna verzija"', async () => {
  const drive = memDrive();
  let t = 1000; const now = () => t;
  const A = dev('A', drive, { now }), B = dev('B', drive, { now });
  A.edit('song:s1', song(1)); await A.sync(); await B.sync();
  // A edits twice with syncs in between; B never edited → no false "previous version" on B
  t = 1500; A.edit('song:s1', song(1, { title: 'A v1' })); await A.sync();
  t = 1600; A.edit('song:s1', song(1, { title: 'A v2' })); await A.sync();
  await B.sync();
  assert.equal(B.data.get('song:s1').title, 'A v2');
  assert.equal(B.versions.length, 0, 'sequential edits from one device are not conflicts');
  // now both edit and both send before seeing the other
  t = 2000; B.edit('song:s1', song(1, { title: 'B (starija)' }));
  t = 3000; A.edit('song:s1', song(1, { title: 'A (novija)' }));
  await B.sync(); // B sends first (nothing new to pull yet)
  // A pulls B's older edit as well, but A's own is newer: A keeps its own and keeps B's as a previous version
  await A.sync(); await B.sync();
  assert.equal(A.data.get('song:s1').title, 'A (novija)'); assert.equal(B.data.get('song:s1').title, 'A (novija)');
  assert.ok(B.versions.some((v) => v.value.title === 'B (starija)'), 'loser kept on the device where it was made');
});

test('a device joins an already-synced account with a big library (snapshot upload): the other devices still get every song', async () => {
  const drive = memDrive();
  const A = dev('A', drive);
  A.edit('song:s1', song(1)); await A.sync();
  const B = dev('B', drive);
  for (let i = 100; i < 140; i++) B.edit('song:s' + i, song(i)); // 40 songs only on B
  await B.sync(); // B: first upload → snapshot (account has none yet)
  await A.sync();
  assert.equal([...A.data.keys()].filter((k) => k.startsWith('song:')).length, 41);
  const C = dev('C', drive); await C.sync();
  assert.equal([...C.data.keys()].filter((k) => k.startsWith('song:')).length, 41);
});
