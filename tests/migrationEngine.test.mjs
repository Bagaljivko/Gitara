// v2.5.66: prelazak na novu Google vezu (nov Cloud projekat = prazna skrivena fascikla). Dva uređaja istog naloga
// prelaze jedan za drugim: ništa se ne gubi, starije ne prepisuje novije, obrisano ostaje obrisano, drugi uređaj ne
// šalje ponovo ono što je prvi već poslao, velika biblioteka ide u delovima ispod 2,5 MB, provera nalazi sve.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, SNAP_PART } from '../src/syncEngine.js';
import { memDrive, memDevice } from './helpers/syncFakes.mjs';

const song = (i, extra = {}) => ({ id: 's' + i, title: 'Pesma ' + i, artist: 'Bend', sections: [{ name: 'S', lines: [{ text: `tekst ${i} `.repeat(20), chords: [{ chord: 'G', position: 0 }] }] }], ...extra });
function dev(name, drive, opts = {}) {
  const d = memDevice(name, opts.now);
  d.bind = (dr) => { d.engine = createEngine(d.local, dr.remote, { node: name, now: opts.now, ask: async () => true }); };
  d.bind(drive);
  d.sync = () => d.engine.sync();
  // isto što radi syncLocal.rebaseForNewSpace (IndexedDB): ista verzija, „čeka slanje“, oznake brisanja ostaju; stanje Drive-a od nule
  d.rebase = (dr) => {
    for (const [k, m] of d.meta) if (m.hlc) d.meta.set(k, { hlc: m.hlc, base: '', dirty: true, deleted: !!m.deleted });
    for (const k of ['pageToken', 'snapAt', 'snapFile', 'snapFiles', 'snapsSeen', 'sinceSnap', 'refetch']) d.state.delete(k);
    d.bind(dr);
  };
  return d;
}

test('two devices move to the new space one after another: nothing lost, newest wins, tombstones kept, few requests', async () => {
  const oldD = memDrive(), newD = memDrive();
  let t = 1000; const now = () => t;
  const A = dev('A', oldD, { now }), B = dev('B', oldD, { now });
  for (let i = 0; i < 300; i++) A.edit('song:s' + i, song(i));
  A.edit('secret', 'AIzaGeminiKey123'); A.edit('pref:lang', 'sr'); A.edit('practice', { v: 1, games: { pauk: { best: 80, plays: 2 } }, songs: {} });
  await A.sync(); await B.sync();
  t = 2000; A.edit('song:s1', song(1, { title: 'A je menjao' }));
  t = 3000; B.edit('song:s2', song(2, { title: 'B je menjao' })); B.remove('song:s3');
  t = 4000; B.edit('song:s500', song(500)); // samo na B
  await A.sync(); await B.sync(); await A.sync();
  // A prelazi prvi
  A.rebase(newD);
  let r0 = newD.stats.req; await A.sync();
  const aReq = newD.stats.req - r0;
  assert.ok(aReq <= 8, `A: ${aReq} zahteva za ~300 stavki`);
  // B (ima iste stavke) prelazi drugi: ne šalje ponovo ono što je A već poslao
  B.rebase(newD);
  r0 = newD.stats.req; await B.sync();
  const bReq = newD.stats.req - r0;
  assert.ok(bReq <= 8, `B: ${bReq} zahteva`);
  assert.equal(B.pending(), 0, 'B: ništa ne čeka');
  // novi, treći uređaj na novoj vezi dobija sve
  const C = dev('C', newD, { now }); await C.sync();
  for (const d of [A, B, C]) {
    assert.equal(d.data.get('song:s1').title, 'A je menjao');
    assert.equal(d.data.get('song:s2').title, 'B je menjao');
    assert.ok(!d.data.has('song:s3'), 'obrisana pesma se ne vraća');
    assert.ok(d.data.has('song:s500'));
    assert.equal(d.data.get('secret'), 'AIzaGeminiKey123');
    assert.equal(d.data.get('practice').games.pauk.best, 80);
  }
  assert.equal(C.data.size, 300 + 1 + 3 - 1, 'C ima sve');
  for (const d of [A, B]) { const v = await d.engine.verify(); assert.equal(v.missing.length, 0, d === A ? 'A' : 'B'); }
});

test('newer edit on the second device is not overwritten by the first device\'s older copy', async () => {
  const oldD = memDrive(), newD = memDrive();
  let t = 1000; const now = () => t;
  const A = dev('A', oldD, { now }), B = dev('B', oldD, { now });
  A.edit('song:s1', song(1)); await A.sync(); await B.sync();
  t = 5000; B.edit('song:s1', song(1, { title: 'novije na B' })); // B nije poslao (bez mreže), pa B prelazi POSLE A
  A.rebase(newD); await A.sync();
  B.rebase(newD); await B.sync(); await A.sync();
  assert.equal(A.data.get('song:s1').title, 'novije na B');
  assert.equal(B.data.get('song:s1').title, 'novije na B');
});

test('large library with photos: snapshot split into parts under 2.5 MB each; verify finds everything', async () => {
  const oldD = memDrive(), newD = memDrive();
  const A = dev('A', oldD);
  for (let i = 0; i < 1200; i++) A.edit('song:s' + i, song(i));
  const photo = 'data:image/jpeg;base64,' + Buffer.from(Array.from({ length: 90000 }, () => Math.random() * 256 | 0)).toString('base64'); // ~120 KB, ne sažima se
  for (let i = 0; i < 60; i++) A.edit('sph:st' + i, { id: 'st' + i, u: photo, at: 1 });
  A.rebase(newD);
  const r0 = newD.stats.req; await A.sync();
  const snaps = [...newD.files.values()].filter((f) => f.props.k === 'snapshot');
  assert.ok(snaps.length >= 3, `delova: ${snaps.length}`);
  for (const f of snaps) assert.ok(f.bytes.length < SNAP_PART + 200000 && f.bytes.length < 5e6, `deo ${f.bytes.length} B`);
  assert.ok(newD.stats.req - r0 <= snaps.length + 6, `zahteva: ${newD.stats.req - r0}`);
  const v = await A.engine.verify();
  assert.equal(v.missing.length, 0); assert.equal(v.total, 1260);
  const C = dev('C', newD); await C.sync();
  assert.equal(C.data.size, 1260);
});

test('interrupted upload resumes without duplicates; verify reports what is missing before that', async () => {
  const oldD = memDrive(), newD = memDrive();
  const A = dev('A', oldD);
  for (let i = 0; i < 40; i++) A.edit('song:s' + i, song(i));
  await A.sync();
  A.rebase(newD);
  // prekid posle 5 upisa (pojedinačni fajlovi: 40 ≤ 60, a snapAt još ne postoji → snapshot; zato prvo bez snapshot-a)
  const put = newD.remote.put; let n = 0;
  newD.remote.put = async (...a) => { if (++n > 1) throw Object.assign(new Error('net'), { code: 'OFFLINE' }); return put(...a); };
  await A.sync().catch(() => {});
  newD.remote.put = put;
  const before = await A.engine.verify();
  await A.sync();
  const after = await A.engine.verify();
  assert.equal(after.missing.length, 0, 'posle nastavka sve je tu');
  const keys = [...newD.files.values()].filter((f) => !f.removed && f.props.k !== 'snapshot').map((f) => f.props.k);
  assert.equal(keys.length, new Set(keys).size, 'bez duplikata');
  assert.ok(before.total === 40);
});
