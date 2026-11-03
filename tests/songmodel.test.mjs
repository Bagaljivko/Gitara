import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage ??= { getItem() { return null; }, setItem() {} };
globalThis.document ??= { documentElement: {} };
const { upgradeSong, restoreOriginal, differsFromOriginal, CV } = await import('../src/songmodel.js');
const { textToSections, transposeSong, songMeta, normalizeSong } = await import('../src/songformat.js');
const { dn } = await import('../src/naming.js');

const song = (text, extra = {}) => ({ title: 'T', artist: '', key: '', sections: textToSections(text), ...extra });
const chords = (s) => s.sections.flatMap((x) => x.lines.flatMap((l) => l.chords.map((c) => c.chord)));

test('conversion keeps the original untouched and builds the neutral layer', () => {
  const s0 = song('G           D\nSunce sija,\nEm          H7\nvetar nosi,\nC     D     G\nkraj.');
  const s = upgradeSong(s0);
  assert.equal(s.cv, CV);
  assert.equal(s.naming, 'sr');
  assert.deepEqual(chords(s), ['G', 'D', 'Em', 'B7', 'C', 'D', 'G']); // interno: B7 = H7
  assert.deepEqual(s.original.sections[0].lines[1].chords.map((c) => c.chord), ['Em', 'H7']); // original kako je napisan
  assert.deepEqual(s.keyN, { root: 7, minor: false });
  assert.equal(s.keyAsk, false);
  assert.equal(differsFromOriginal(s), false);
  assert.equal(upgradeSong(s), s); // već konvertovana pesma se ne dira
});

test('B on a Serbian-style sheet becomes Bb; the question stays open when unclear', () => {
  const f = upgradeSong(song('F     C\nla la\nDm    B\nla la\nGm   C7   F\nla'));
  assert.deepEqual(chords(f), ['F', 'C', 'Dm', 'Bb', 'Gm', 'C7', 'F']);
  const amb = upgradeSong(song('G     B\nla la\nC     G\nla'));
  assert.equal(amb.namingAsk, true);
  const fixed = upgradeSong(amb, { naming: 'sr' });
  assert.deepEqual(chords(fixed), ['G', 'Bb', 'C', 'G']);
  assert.equal(fixed.namingAsk, false);
});

test('transposition by key: G→A (+2), slash chords, spelling, tabs follow (minus capo)', () => {
  const s = upgradeSong(song('G   C   Em   D7   D/F#\nla la la', { key: 'G' }));
  const a = transposeSong(s, 2);
  assert.deepEqual(chords(a), ['A', 'D', 'F#m', 'E7', 'E/G#']);
  assert.deepEqual(chords(a).map((c) => dn(c, 'sr')), ['A', 'D', 'Fism', 'E7', 'E/Gis']);
  assert.equal(dn(a.key, 'sr'), 'A');
  // Es-dur: As, ne Gis
  const eb = transposeSong(upgradeSong(song('C   F   G\nla')), 3);
  assert.deepEqual(chords(eb), ['Eb', 'Ab', 'Bb']);
  assert.deepEqual(chords(eb).map((c) => dn(c, 'sr')), ['Es', 'As', 'B']);
  // tablatura: +2 pomera pragove, 0 ih ne dira
  const tabSong = upgradeSong(song('G\nla\ne|-0-3-|\nB|-----|\nG|-----|\nD|-----|\nA|-----|\nE|-----|'));
  const notes = (x) => x.sections.flatMap((sec) => (sec.tabs || []).flatMap((tb) => tb.bars.flatMap((b) => b.notes.map((n) => Number(n.f)))));
  assert.deepEqual(notes(transposeSong(tabSong, 2)), [2, 5]);
  assert.deepEqual(notes(transposeSong(tabSong, -2)), [10, 1]); // −2 od 0 → oktavu više
});

test('restore original: text and chords as scanned, key +0, no capo', () => {
  const s = upgradeSong(song('G     D\nla la'));
  const edited = { ...s, title: 'Novo', transpose: 3, capo: 2, sections: [{ name: '', lines: [{ text: 'drugo', chords: [{ chord: 'C', position: 0, n: { r: 0, s: '', b: null } }] }] }] };
  assert.equal(differsFromOriginal(edited), true);
  const r = restoreOriginal(edited);
  assert.equal(r.title, 'T');
  assert.equal(r.transpose, 0);
  assert.equal(r.capo, 0);
  assert.deepEqual(chords(r), ['G', 'D']);
  assert.equal(differsFromOriginal(r), false);
});

test('backup round trip keeps original, naming and key; canonical chords are not re-read as Serbian', () => {
  const s = upgradeSong(song('F     C\nla\nDm    B\nla'));
  const back = { ...normalizeSong(s), ...songMeta(s) };
  assert.equal(back.cv, CV);
  assert.ok(back.original);
  const again = upgradeSong({ ...back, cv: CV }); // akordi bez n → ponovo se prave, kao nedvosmisleni engleski
  assert.deepEqual(chords(again), ['F', 'C', 'Dm', 'Bb']); // Bb ostaje Bb, ne postaje A
  assert.equal(again.original.sections[0].lines[1].chords[1].chord, 'B'); // original i dalje „B“
});

test('share link carries neutral chords and the chosen key; recipient transposes and renders in own naming', async () => {
  globalThis.location ??= { hash: '', origin: 'x', pathname: '/' };
  const sl = await import('../src/sharelink.js');
  const s = { ...upgradeSong(song('Em   Am\nla\nB7   Em\nla')), transpose: 2 };
  const back = sl._unpack(sl._pack(s));
  assert.equal(back.transpose, 2);
  const o = sl._pack(s);
  const rec = upgradeSong({ ...back, cv: o.cv, keyN: { root: o.kn[0], minor: !!o.kn[1] } });
  const t2 = transposeSong(rec, 2);
  assert.deepEqual(chords(t2), ['F#m', 'Bm', 'C#7', 'F#m']);
  assert.deepEqual(chords(t2).map((c) => dn(c, 'sr')), ['Fism', 'Hm', 'Cis7', 'Fism']);
});
