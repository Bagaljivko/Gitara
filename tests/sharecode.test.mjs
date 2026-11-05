// Deljenje set liste / pesme: paket → sažet kod (link ili .gitara fajl) → isti sadržaj; samo sadržaj pesama;
// veličina za dugu set listu (12 pesama, akordi + TAB).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makePackage, readPackage, encode, decode, shareLink, shareFileText, packageFrom, LINK_MAX } from '../src/shareCode.js';
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

test('size: deflate link for the 12-song set vs lz-string; a short set fits the link limit, the file always works', async () => {
  const pkg = makePackage(songs, 'Subotnja svirka');
  const link = await shareLink(pkg, 'https://bagaljivko.github.io/Gitara/');
  const lz = LZString.compressToEncodedURIComponent(JSON.stringify(pkg)).length;
  console.log(`12 songs: link ${link.length} chars (lz-string would be ${lz}); JSON ${JSON.stringify(pkg).length}`);
  assert.ok(link.length < lz, 'deflate is smaller than lz-string');
  const small = await shareLink(makePackage(songs.slice(0, 3), 'Kratka'), 'https://x/');
  assert.ok(small.length <= LINK_MAX, `3 songs: ${small.length}`);
  for (const text of [link, await shareFileText(pkg)]) {
    const p = await packageFrom(text);
    assert.equal(p.songs.length, 12); assert.equal(p.name, 'Subotnja svirka');
  }
});

test('single song uses the same package; bad input is rejected', async () => {
  const p = await packageFrom(await shareLink(makePackage([songs[0]]), 'https://x/'));
  assert.equal(p.kind, 'song'); assert.equal(p.songs.length, 1);
  await assert.rejects(() => packageFrom('https://x/#g=dAAAA'));
  await assert.rejects(() => packageFrom('nešto'));
});
