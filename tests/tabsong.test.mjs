// TAB pesme: skenirana tablatura → pesma (taktovi, note, ponavljanja, barre, promena tonaliteta), provera taktova,
// delovi za vežbu i note za stazu. Primer: „Romance D'Amour“ (2 strane, 32 takta, 3/4) — taktovi 1–8 sa lista.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fromScan, checkBars, tabParts, partDifficulty, practiceItems, playOrder, barInfo, cleanTabSong, toColumns, tabKey } from '../src/tabSong.js';
import { romanceScan, BARS_1_8 } from './helpers/romance.mjs';

const song = fromScan(romanceScan());
const near = (a, b) => Math.abs(a - b) < 1e-3;

test('two pages merge into one song: 32 bars in order (the overlapping bar 16 only once), title, 3/4, Em', () => {
  assert.equal(song.type, 'tab');
  assert.equal(song.title, "Romance D'Amour");
  assert.equal(song.artist, 'Anonymous');
  assert.equal(song.tab.sig, '3/4');
  assert.equal(song.tab.key, 'Em');
  assert.equal(song.tab.bars.length, 32);
  assert.equal(song.tab.bars[15].notes.length, 10, 'bar 16 = the full reading, not the weaker overlap');
});

test('bars 1–8 match the sheet: bass on beat 1, e-B-G triplets, frets, 1/2 BV in bars 7–8', () => {
  BARS_1_8.forEach((x, i) => {
    const b = song.tab.bars[i];
    const bass = b.notes.filter((n) => n.s >= 4);
    assert.equal(bass.length, 1, `bar ${i + 1}: one bass note`);
    assert.deepEqual([bass[0].s, bass[0].f, bass[0].b, bass[0].d], [x.bass[0], x.bass[1], 0, 3], `bar ${i + 1} bass`);
    const mel = b.notes.filter((n) => n.s === 1);
    assert.deepEqual(mel.map((n) => n.f), x.mel, `bar ${i + 1} melody`);
    assert.deepEqual(mel.map((n) => n.b), [0, 1, 2], `bar ${i + 1} melody on the beats`);
    for (let k = 0; k < 3; k++) {
      const B = b.notes.find((n) => n.s === 2 && near(n.b, k + 1 / 3)), G = b.notes.find((n) => n.s === 3 && near(n.b, k + 2 / 3));
      assert.ok(B && B.f === x.b && near(B.d, 1 / 3), `bar ${i + 1} B string, beat ${k + 1}`);
      assert.ok(G && G.f === x.g && near(G.d, 1 / 3), `bar ${i + 1} G string, beat ${k + 1}`);
    }
    assert.equal(b.notes.length, 10);
    if (x.barre) assert.deepEqual(b.barre, [{ fret: 5, from: 1, to: 3, half: 1 }], `bar ${i + 1} 1/2 BV`);
    else assert.equal(b.barre, undefined);
  });
  assert.equal(song.tab.bars[6].notes.find((n) => n.s === 1 && n.f === 8).fi, 4, 'printed fingering kept');
});

test('repeats and the key change are kept: E minor 1–16, E major 17–32', () => {
  const info = barInfo(song.tab);
  assert.equal(info[0].key, 'Em'); assert.equal(info[15].key, 'Em'); assert.equal(info[16].key, 'E'); assert.equal(info[31].key, 'E');
  assert.equal(song.tab.bars[15].re, 2);
  assert.equal(song.tab.bars[16].rs, 1);
  assert.equal(song.tab.bars[31].re, 2);
  assert.equal(playOrder(song.tab).length, 64, 'both halves played twice');
  assert.deepEqual(song.tab.bars[19].barre, [{ fret: 9, from: 1, to: 6 }], 'BIX = full barre at fret 9');
});

test('validation: bars that do not add up to 3/4 and unsure readings are flagged (nothing guessed)', () => {
  const flags = checkBars(song.tab);
  assert.deepEqual(flags.map((f) => [f.bar + 1, f.why]), [[26, 'scan'], [30, 'short']]);
  // fret 25, string 7 → flagged, the bad note is dropped
  const bad = fromScan({ sig: '3/4', bars: [{ n: 1, notes: [{ s: 1, f: 25, start: 0, len: 3 }, { s: 6, f: 0, start: 0, len: 3 }] }, { n: 2, notes: [{ s: 7, f: 0, start: 0, len: 3 }, { s: 6, f: 0, start: 0, len: 3 }] }, { n: 3, notes: [{ s: 6, f: 0, start: 0, len: 4 }] }] });
  assert.deepEqual(checkBars(bad.tab).map((f) => f.why), ['fret', 'string', 'long']);
  // „U redu je“ removes the flag
  bad.tab.bars[2].ok = 1;
  assert.equal(checkBars(bad.tab).length, 2);
});

test('parts by structure: phrases of 4 bars, the two keys as whole parts, hardest = most jumps and barres', () => {
  const parts = tabParts(song.tab);
  assert.deepEqual(parts.filter((p) => p.kind === 'bars').map((p) => [p.from + 1, p.to + 1]), [[1, 4], [5, 8], [9, 12], [13, 16], [17, 20], [21, 24], [25, 28], [29, 32]]);
  assert.deepEqual(parts.filter((p) => p.kind === 'key').map((p) => [p.from + 1, p.to + 1, p.key]), [[1, 16, 'Em'], [17, 32, 'E']]);
  const d = parts.filter((p) => p.kind === 'bars').map((p) => partDifficulty(song.tab, p));
  const hardest = d.indexOf(Math.max(...d));
  assert.ok(d[0] < d[hardest] && [4, 5].includes(hardest), `hardest phrase: ${hardest} (${d.map((x) => x.toFixed(1))})`);
});

test('practice notes: exact string/fret/time, bass+melody as one attack, barre band, finger colours', () => {
  const items = practiceItems(song.tab, [0, 1, 2, 3, 4, 5, 6, 7]);
  const notes = items.filter((it) => it.kind === 'note' && !it.follow);
  assert.equal(notes.length, 8 * 9, '9 attacks per bar');
  const first = notes[0];
  assert.deepEqual([first.beat, first.s, first.f, first.midi], [0, 5, 7, 71], 'bar 1 beat 1: e7 on the high e (lane 5)');
  assert.deepEqual(first.group.map((g) => [g.s, g.f, g.follow]), [[0, 0, true]], 'with the open low E (lane 0) in the same attack');
  const b7 = notes.filter((it) => it.bar === 6);
  assert.deepEqual(b7.map((it) => [+(it.beat - 18).toFixed(3), 6 - it.s, it.f]).slice(0, 3), [[0, 1, 8], [0.333, 2, 5], [0.667, 3, 5]]);
  assert.equal(b7[0].finger, 4, 'printed finger'); assert.equal(b7[1].finger, 1, 'barre = first finger');
  const barres = items.filter((it) => it.kind === 'barre');
  assert.deepEqual(barres.map((b) => [b.beat, b.from, b.to, b.fret, b.deco]), [[18, 3, 5, 5, true], [21, 3, 5, 5, true]]);
  assert.equal(items.endBeat, 24);
});

test('clean / columns / key: survives a JSON round trip, different tabs are different content', () => {
  const again = cleanTabSong(JSON.parse(JSON.stringify(song.tab)));
  assert.equal(tabKey(again), tabKey(song.tab));
  const other = JSON.parse(JSON.stringify(song.tab)); other.bars[0].notes[1].f = 8;
  assert.notEqual(tabKey(cleanTabSong(other)), tabKey(song.tab));
  const cols = toColumns(song.tab, 0, 0);
  assert.equal(cols.bars[0].notes.length, 10); assert.equal(cols.bars[0].w, 28);
});

test('backup / import / share path keeps a TAB song intact; old chord songs are unchanged', async () => {
  const { normalizeSong, songMeta, songExtras } = await import('../src/songformat.js');
  const { contentKey, nearlySame } = await import('../src/songIdentity.js');
  const stored = { ...song, id: 'x1', bpm: 64, folders: ['f1'] };
  const backupEntry = JSON.parse(JSON.stringify({ id: stored.id, title: stored.title, artist: stored.artist, key: stored.key, sections: stored.sections, ...songExtras(stored), ...songMeta(stored) }));
  const n = normalizeSong(backupEntry);
  const back = { ...n, ...songMeta({ ...backupEntry, sections: n.sections }) };
  assert.equal(back.type, 'tab'); assert.equal(back.bpm, 64); assert.equal(back.tab.bars.length, 32);
  assert.equal(contentKey(back), contentKey(stored), 'restored copy = same content (merge never adds a second copy)');
  const other = JSON.parse(JSON.stringify(stored)); other.tab.bars[3].notes[2].f = 9;
  assert.notEqual(contentKey(other), contentKey(stored), 'a different tab with the same title is NOT an exact duplicate');
  assert.ok(nearlySame(other, stored), 'but it is nearly the same song (rescan → ask)');
  const chord = normalizeSong({ title: 'A', sections: [{ name: 'S', lines: [{ text: 'tekst', chords: [{ chord: 'G', position: 0 }] }] }] });
  assert.equal(chord.type, undefined); assert.equal(nearlySame(chord, stored), false);
});
