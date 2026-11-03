import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage ??= { getItem() { return null; }, setItem() {} };
globalThis.document ??= { documentElement: {} };
const { readChord, renderChord, detectNaming, detectKey, keyName, CIRCLE } = await import('../src/chordnames.js');
const { analyzeSong, lowercaseChordLine } = await import('../src/chordCheck.js');
const { textToSections } = await import('../src/songformat.js');

const r = (t, n) => { const c = readChord(t, n); return c && [c.r, c.s, c.b]; };

test('reads Serbian and English names; B differs, H and Fis/Es/As do not', () => {
  assert.deepEqual(r('B', 'sr'), [10, '', null]);
  assert.deepEqual(r('B', 'en'), [11, '', null]);
  assert.deepEqual(r('Bb', 'sr'), [10, '', null]);
  assert.deepEqual(r('H7', 'sr'), [11, '7', null]);
  assert.deepEqual(r('Fism', 'sr'), [6, 'm', null]);
  assert.deepEqual(r('Es', 'sr'), [3, '', null]);
  assert.deepEqual(r('As', 'en'), [8, '', null]);
  assert.deepEqual(r('Esus4', 'sr'), [4, 'sus4', null]); // E + sus4, ne Es + us4
  assert.deepEqual(r('Asus2', 'sr'), [9, 'sus2', null]);
  assert.deepEqual(r('D/Fis', 'sr'), [2, '', 6]);
  assert.equal(readChord('e', 'sr'), null); // malo slovo nije akord (za sada)
  assert.equal(readChord('N.C.', 'en'), null);
});

test('detects the naming of a sheet', () => {
  assert.equal(detectNaming(['G', 'D', 'Em', 'H7', 'C']).naming, 'sr');
  assert.equal(detectNaming(['A', 'Fism', 'D']).reason, 'de');
  assert.equal(detectNaming(['F', 'Bb', 'C']).naming, 'en');
  const fB = detectNaming(['F', 'C', 'Dm', 'B', 'Gm', 'C7', 'F']);
  assert.deepEqual([fB.naming, fB.confidence], ['sr', 'guess']); // B = Bb u F-duru
  const eB = detectNaming(['E', 'A', 'B7', 'C#m', 'A', 'B', 'E']);
  assert.deepEqual([eB.naming, eB.confidence], ['en', 'guess']); // B = H u E-duru
  const em = detectNaming(['Em', 'Am', 'B7', 'Em']);
  assert.equal(em.naming, 'en'); // B7 je V7 u e-molu → H7
  assert.equal(detectNaming(['G', 'B', 'C', 'G']).confidence, 'ask');
  assert.equal(detectNaming(['A', 'E', 'F#m', 'D']).naming, 'any');
});

test('detects major and minor keys', () => {
  const k = (toks) => detectKey(toks.map((x) => readChord(x, 'en')));
  assert.deepEqual([k(['G', 'C', 'D', 'G']).root, k(['G', 'C', 'D', 'G']).minor], [7, false]);
  assert.deepEqual([k(['Em', 'Am', 'B7', 'Em']).root, k(['Em', 'Am', 'B7', 'Em']).minor], [4, true]);
});

test('spells by key and role; renders both namings; transposes', () => {
  const key = (root, minor = false) => ({ root, minor });
  const c = (r, s = '', b = null) => ({ r, s, b });
  assert.equal(renderChord(c(8), 'sr', key(3)), 'As');      // Ab u Es-duru
  assert.equal(renderChord(c(8), 'en', key(3)), 'Ab');
  assert.equal(renderChord(c(10), 'sr', key(7)), 'B');      // bVII u G-duru
  assert.equal(renderChord(c(8, 'dim'), 'sr', key(9, true)), 'Gisdim'); // vođica u a-molu
  assert.equal(renderChord(c(6, 'm'), 'sr', key(2)), 'Fism');
  assert.equal(renderChord(c(11, 'm'), 'sr', key(2)), 'Hm');
  // G → A (+2): G C Em D7 D/F# → A D F#m E7 E/G#
  const song = [c(7), c(0), c(4, 'm'), c(2, '7'), c(2, '', 6)];
  assert.deepEqual(song.map((x) => renderChord(x, 'en', key(9), 2)), ['A', 'D', 'F#m', 'E7', 'E/G#']);
  assert.deepEqual(song.map((x) => renderChord(x, 'sr', key(9), 2)), ['A', 'D', 'Fism', 'E7', 'E/Gis']);
  assert.deepEqual(CIRCLE.map((root) => keyName({ root, minor: false }, 'sr')), ['C', 'G', 'D', 'A', 'E', 'H', 'Fis', 'Des', 'As', 'Es', 'B', 'F']);
  assert.deepEqual(CIRCLE.map((root) => keyName({ root, minor: false }, 'en')), ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F']);
});

test('chord check: lowercase lines and chords saved as lyrics are found, nothing else flagged', () => {
  assert.equal(lowercaseChordLine('e     a     D'), true);
  assert.equal(lowercaseChordLine('a ja tebe volim'), false);
  assert.equal(lowercaseChordLine('a'), false);
  // Pesma sačuvana starom verzijom: red „A  Fism“ je tada ostao tekst
  const old = { sections: [{ name: '', lines: [
    { text: 'A           Fism', chords: [] }, { text: 'Kad se setim tvojih reči,', chords: [] },
    { text: 'e       a', chords: [] }, { text: 'nešto drugo', chords: [] },
    { text: 'la la la', chords: [{ chord: 'G', position: 0 }, { chord: 'D', position: 6 }] },
  ] }] };
  const a = analyzeSong(old);
  assert.equal(a.flags.lifted, 1);
  assert.equal(a.flags.lower, 1);
  assert.equal(a.sections[0].lines[0].chords[1].chord, 'Fism');
  const plain = analyzeSong({ sections: textToSections('G      D\nla la\nC      G\nla la') });
  assert.equal(plain.flags.any, false);
});

test('typed text with Serbian names is now read as chords directly', () => {
  const secs = textToSections('A           Fism\nKad se setim tvojih reči,\nHm   Cis7\nla la');
  assert.deepEqual(secs[0].lines[0].chords.map((c) => c.chord), ['A', 'Fism']);
  assert.deepEqual(secs[0].lines[1].chords.map((c) => c.chord), ['Hm', 'Cis7']);
});
