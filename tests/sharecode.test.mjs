// Deljenje set liste / pesme: paket → sažet kod (link ili .gitara fajl) → isti sadržaj; samo sadržaj pesama;
// veličina za dugu set listu (12 pesama, akordi + TAB).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makePackage, readPackage, encode, decode, shareFileText, packageFrom, buildShareFile, parseShareFile, SHARE_SCHEMA, SHARE_MAX_BYTES } from '../src/shareCode.js';
import { textToSections } from '../src/songformat.js';
import { fromScan } from '../src/tabSong.js';
import { romanceScan } from './helpers/romance.mjs';
import LZString from '../src/lzstring.js';

const LYR = ['Kad se setim tvojih očiju plavih', 'i onih dana kad smo bili mladi', 'sve bih dao da se vrati vreme', 'da te opet sretnem kraj reke', 'noć je duga, a ja ne spavam', 'pevam pesmu koju samo ti znaš'];
function chordSong(i) {
  const ch = [['G', 'D', 'Em', 'C'], ['Am', 'F', 'C', 'G'], ['E', 'A', 'H7', 'E'], ['D', 'G', 'A', 'D']][i % 4];
  const block = (name) => `[${name}]\n` + LYR.map((l, k) => `${ch[k % 4]}           ${ch[(k + 1) % 4]}\n${l}`).join('\n');
  return { title: `Pesma broj ${i + 1}`, artist: 'Bend', key: ch[0], capo: i % 3, transpose: i % 2, bpm: 80 + i, strum: { id: 'folk', sig: '4/4', steps: 'D-DU-UDU' },
    sections: textToSections([block('Strofa 1'), block('Refren'), block('Strofa 2'), block('Refren')].join('\n\n')),
    // lično — ne sme u paket
    folders: ['f1'], id: 'x' + i, seen: true, practice: { best: 99 } };
}
const songs = [...Array.from({ length: 11 }, (_, i) => chordSong(i)), { ...fromScan(romanceScan()), bpm: 64, folders: ['f2'] }];

test('a set list of 12 songs (chords + tab) round-trips through the code: all content, nothing personal', async () => {
  const pkg = makePackage(songs, 'Subotnja svirka');
  const back = readPackage(await decode(await encode(pkg)));
  assert.equal(back.kind, 'set'); assert.equal(back.name, 'Subotnja svirka'); assert.equal(back.songs.length, 12);
  back.songs.slice(0, 11).forEach((s, i) => {
    assert.equal(s.title, songs[i].title); assert.equal(s.capo || 0, songs[i].capo); assert.equal(s.transpose || 0, songs[i].transpose); assert.equal(s.bpm, songs[i].bpm);
    assert.deepEqual(s.strum, songs[i].strum);
    assert.deepEqual(s.sections.map((x) => x.lines.map((l) => [l.text, l.chords.map((c) => c.chord)])), songs[i].sections.map((x) => x.lines.map((l) => [l.text, l.chords.map((c) => c.chord)])));
    for (const k of ['folders', 'id', 'seen', 'practice']) assert.equal(s[k], undefined, `no ${k}`);
  });
  const tab = back.songs[11];
  assert.equal(tab.type, 'tab'); assert.equal(tab.tab.bars.length, 32); assert.equal(tab.bpm, 64);
  assert.deepEqual(tab.tab.bars.map((b) => b.notes.length), songs[11].tab.bars.map((b) => b.notes.length));
});

// stari dugi linkovi (#g=…) iz v1.46 se i dalje otvaraju (novi se više ne prave)
const oldLink = async (pkg) => 'https://bagaljivko.github.io/Gitara/#g=' + (await encode(pkg));

test('old long links (#g=) and old .gitara files still import; deflate beats lz-string', async () => {
  const pkg = makePackage(songs, 'Subotnja svirka');
  const link = await oldLink(pkg);
  assert.ok(link.length < LZString.compressToEncodedURIComponent(JSON.stringify(pkg)).length);
  for (const text of [link, await shareFileText(pkg)]) {
    const p = await packageFrom(text);
    assert.equal(p.songs.length, 12); assert.equal(p.name, 'Subotnja svirka');
  }
});

test('single song uses the same package; bad input is rejected', async () => {
  const p = await packageFrom(await oldLink(makePackage([songs[0]])));
  assert.equal(p.kind, 'song'); assert.equal(p.songs.length, 1);
  await assert.rejects(() => packageFrom('https://x/#g=dAAAA'));
  await assert.rejects(() => packageFrom('nešto'));
});

test('shared file (short link / .gitara): schema version + hash; tampered, oversized, newer, wrong shape and script text handled', async () => {
  const set = await buildShareFile({ kind: 'set', name: 'Jakov', songs: songs.slice(0, 6) });
  const back = await parseShareFile(set.text);
  assert.equal(back.kind, 'set'); assert.equal(back.name, 'Jakov'); assert.equal(back.songs.length, 6);
  const o = JSON.parse(set.text);
  assert.equal(o.v, SHARE_SCHEMA); assert.match(o.hash, /^[0-9a-f]{64}$/);
  // nothing personal or secret in the shared file
  for (const bad of ['folders', 'practice', 'seen', '"f1"', 'geminiKey', 'AIza', 'token', 'data:image']) assert.ok(!JSON.stringify(back).includes(bad) && !set.text.includes(bad), bad);
  const code = async (fn) => { try { await fn(); return 'ok'; } catch (e) { return e.code || e.message; } };
  // tampered content (hash mismatch)
  const t1 = { ...o, code: o.code.slice(0, -4) + (o.code.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA') };
  assert.equal(await code(() => parseShareFile(JSON.stringify(t1))), 'CORRUPT');
  assert.equal(await code(() => parseShareFile(JSON.stringify({ ...o, n: 5 }))), 'CORRUPT'); // count mismatch
  assert.equal(await code(() => parseShareFile(JSON.stringify({ ...o, extra: '<script>' }))), 'CORRUPT'); // unexpected field
  assert.equal(await code(() => parseShareFile(JSON.stringify({ ...o, v: SHARE_SCHEMA + 1 }))), 'NEWER');
  assert.equal(await code(() => parseShareFile('x'.repeat(SHARE_MAX_BYTES + 1))), 'TOO_BIG');
  assert.equal(await code(() => parseShareFile('{"app":"gitara"')), 'CORRUPT');
  assert.equal(await code(() => parseShareFile('[]')), 'CORRUPT');
  assert.equal(await code(() => parseShareFile(JSON.stringify({ ...o, kind: 'settings' }))), 'CORRUPT');
  // script in song text stays plain text (rendered as text by the app, never executed)
  const evil = { title: '<img src=x onerror=alert(1)>', artist: '<script>alert(2)</script>', key: 'G', sections: textToSections('G\n<b onmouseover=alert(3)>tekst</b>') };
  const e2 = await parseShareFile((await buildShareFile({ kind: 'song', name: evil.title, songs: [evil] })).text);
  assert.equal(e2.songs[0].title, evil.title); assert.equal(e2.songs[0].artist, evil.artist);
  // recordings travel as notes only
  const rec = { title: 'Snimak', artist: '', key: '', sections: textToSections('x'), recording: { v: 1, dur: 2000, recId: 'r1', events: [{ t: 0, notes: [{ m: 45, s: 5, f: 0 }] }], audio: 'data:audio/webm;base64,AAAA' } };
  const r2 = await parseShareFile((await buildShareFile({ kind: 'song', name: 'Snimak', songs: [rec] })).text);
  assert.equal(r2.songs[0].recording.events.length, 1); assert.equal(r2.songs[0].recording.audio, undefined);
  // the same content gives the same hash (reuse link when unchanged)
  assert.equal((await buildShareFile({ kind: 'set', name: 'Jakov', songs: songs.slice(0, 6) })).hash, set.hash);
  assert.notEqual((await buildShareFile({ kind: 'set', name: 'Jakov', songs: songs.slice(0, 5) })).hash, set.hash);
});
