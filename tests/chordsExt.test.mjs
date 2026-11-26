// v2.5.5: prošireni akordi (Em11, Cmaj9, G13…) se više ne pojednostavljuju; power akordi imaju tonove (vežbe ih čuju);
// hvatovi pesme sa lista važe samo na toj pesmi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
const M = await import('../src/music.js');
const C = await import('../src/chords.js');
const fr = (v) => v.frets.map((f) => (f < 0 ? 'x' : f.toString(36))).join('');

test('prošireni akordi ostaju to što jesu', () => {
  for (const [n, q] of [['Em11', 'm11'], ['Am11', 'm11'], ['E11', '11'], ['Cmaj9', 'maj9'], ['G13', '13'], ['Cadd11', 'add11'], ['B5', '5'], ['Cmaj7', 'maj7'], ['C9', '9']]) {
    const p = M.parseChord(n); assert.equal(p && p.quality, q, n);
    assert.equal(M.formatChord(p), n);
    assert.ok(M.QUALITIES[q], 'tonovi za ' + q);
  }
  assert.equal(fr(C.getVoicings('Em11')[0]), '000000');
  assert.equal(fr(C.getVoicings('E5')[0]), '022xxx');
  assert.ok(C.getVoicings('Cmaj9').length && C.getVoicings('G13').length, 'približan hvat postoji');
});

test('hvatovi sa lista važe samo dok je otvorena ta pesma', () => {
  globalThis.location = { hash: '#/pesma/s1' };
  C.setSongGrips({ id: 's1', grips: { D: 'x5x07x/010030' } });
  const v = C.getVoicings('D');
  assert.equal(fr(v[0]), 'x5x07x'); assert.ok(v[0].grip); assert.equal(fr(v[1]), 'xx0232');
  globalThis.location.hash = '#/vezbe/promena?song=s1&k=chg'; assert.ok(C.getVoicings('D')[0].grip, 'i u vežbi te pesme');
  globalThis.location.hash = '#/akordi'; assert.equal(fr(C.getVoicings('D')[0]), 'xx0232', 'rečnik ne vidi hvat pesme');
  assert.equal(C.matchVoicing('D', [-1, 5, -1, 0, 7, -1]), -1, 'biblioteka ostaje ista');
  assert.deepEqual(C.cleanGrips({ D: 'x5x07x/010030', bad: 'zz' }), { D: 'x5x07x/010030' });
});
