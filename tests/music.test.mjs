import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChord, canonicalName, transposeChord, transposeKey } from '../src/music.js';
import { getVoicings, libraryChordNames } from '../src/chords.js';
import { yin } from '../src/audio.js';

test('parsira akorde, H = B', () => {
  assert.equal(canonicalName('Hm'), 'Bm');
  assert.equal(canonicalName('H7'), 'B7');
  assert.equal(canonicalName('Amin7'), 'Am7');
  assert.equal(canonicalName('CM7'), 'Cmaj7');
  assert.equal(canonicalName('E-'), 'Em');
  assert.equal(canonicalName('D/F#'), 'D/F#');
  for (const w of ['Do', 'Da', 'Ako', 'Hej', 'Ne', 'Bog']) assert.equal(parseChord(w), null, w);
});

test('transpozicija', () => {
  assert.equal(transposeChord('C', 2), 'D');
  assert.equal(transposeChord('Am', 3), 'Cm');
  assert.equal(transposeChord('Hm', 1), 'Cm');
  assert.equal(transposeChord('Am', 2), 'Bm');
  assert.equal(transposeChord('Am', 2, { useH: true }), 'Hm');
  assert.equal(transposeChord('Hm', -1, { useH: true, flat: true }), 'Bbm');
  assert.equal(transposeChord('Bb', 2), 'C');
  assert.equal(transposeChord('G/B', 2), 'A/C#');
  assert.equal(transposeKey('G', 2), 'A');
  assert.equal(transposeKey('Am', 1), 'Bbm');
});

test('biblioteka ima dijagram za sve osnovne akorde u svim tonalitetima', () => {
  for (const n of libraryChordNames()) assert.ok(getVoicings(n).length > 0, n);
  const F = getVoicings('F')[0];
  assert.deepEqual(F.frets, [1, 3, 3, 2, 1, 1]);
  assert.ok(F.barre);
  assert.deepEqual(getVoicings('C')[0].frets, [-1, 3, 2, 0, 1, 0]);
  assert.deepEqual(getVoicings('Hm')[0].frets, [-1, 2, 4, 4, 3, 2]);
});

test('YIN prepoznaje žice gitare', () => {
  const sr = 48000;
  for (const f of [82.41, 110, 146.83, 196, 246.94, 329.63]) {
    const buf = new Float32Array(4096);
    for (let i = 0; i < buf.length; i++) {
      const t = i / sr;
      buf[i] = 0.5 * Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * 2 * f * t) + 0.2 * Math.sin(2 * Math.PI * 3 * f * t);
    }
    const r = yin(buf, sr);
    const cents = 1200 * Math.log2(r.freq / f);
    assert.ok(Math.abs(cents) < 2, `${f}: ${r.freq} (${cents.toFixed(2)}¢)`);
  }
});
