import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapScannedChords } from '../src/songformat.js';

const one = (text, ps) => ({ sections: [{ name: '', lines: [{ text, chords: ps.map((p, i) => ({ chord: 'C' + i, position: p })) }] }] });
const pos = (s) => s.sections[0].lines[0].chords.map((c) => c.position);

test('v2.5.70: scanned chord on a space between words moves to the next word', () => {
  const s = one('Zakuni se ljubavi na ranjenu noć', [6, 17]); // oba na razmaku posle reči
  assert.equal(snapScannedChords(s), 2);
  assert.deepEqual(pos(s), [7, 18]);
});
test('chords inside a word (syllable), at a word start or after the line stay where they are', () => {
  const s = one('Zakuni se ljubavi', [0, 13, 7, 30]);
  assert.equal(snapScannedChords(s), 0);
  assert.deepEqual(pos(s), [0, 13, 7, 30]);
});
test('never moves onto another chord, never more than 3 spaces, chord-only lines untouched', () => {
  const s = one('a  b', [1, 3]);
  snapScannedChords(s); assert.deepEqual(pos(s), [1, 3]);
  const w = one('a      b', [1]); snapScannedChords(w); assert.deepEqual(pos(w), [1]);
  const e = one('', [0, 4]); snapScannedChords(e); assert.deepEqual(pos(e), [0, 4]);
});
