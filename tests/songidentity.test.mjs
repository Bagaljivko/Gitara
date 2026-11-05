// Pesme: ista pesma ili ne (tačan duplikat; „Ova pesma već postoji“ posle skeniranja).
import test from 'node:test';
import assert from 'node:assert/strict';
import { contentKey, nearlySame, findExisting } from '../src/songIdentity.js';
import { normalizeSong, songMeta } from '../src/songformat.js';
import { upgradeSong } from '../src/songmodel.js';

const song = (text, chords = ['Am', 'C'], title = 'Pesma') => ({ title, artist: 'X', key: 'Am', sections: [{ name: 'Strofa', lines: [{ text, chords: chords.map((c, i) => ({ chord: c, position: i * 6 })) }, { text: 'druga linija iste pesme ovde i sad', chords: [] }] }] });

test('a stored song and its Drive backup copy (normalized) have the same content key', () => {
  const stored = upgradeSong(song('ovo je prva linija jedne pesme'));
  const back = JSON.parse(JSON.stringify(stored));
  const n = normalizeSong(back);
  assert.equal(contentKey({ ...n, ...songMeta({ ...back, sections: n.sections }) }), contentKey(stored));
});

test('different chord or different text = different content (never removed as a duplicate)', () => {
  const a = song('ovo je prva linija jedne pesme');
  assert.notEqual(contentKey(a), contentKey(song('ovo je prva linija jedne pesme', ['Am', 'G'])));
  assert.notEqual(contentKey(a), contentKey(song('ovo je prva linija druge pesme')));
});

test('rescan: same title or nearly the same lyrics and chords is found; a different song is not', () => {
  const have = [song('ovo je prva linija jedne pesme koju sviram', ['Am', 'C'], 'Stara')];
  assert.ok(findExisting(song('nešto sasvim drugo', ['G'], 'stara '), have), 'same title (case/space)');
  assert.ok(nearlySame(have[0], song('ovo je prva linija jedne pesme koju sviram', ['Am', 'C'], 'Drugi naslov')));
  assert.equal(findExisting(song('potpuno drugi tekst o moru i suncu leti', ['E', 'A'], 'Nova'), have), null);
});
