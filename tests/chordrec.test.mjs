import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singleSourceRatio, presentChordNotes, matchChord } from '../src/chordrec.js';

const series = (f0, n, w = (k) => 1 / k) => Array.from({ length: n }, (_, k) => ({ f: f0 * (k + 1), w: w(k + 1) }));

test('a sung/spoken note (one harmonic series) is recognised as a single source', () => {
  assert.ok(singleSourceRatio(series(130, 12)) > 0.95);
  assert.ok(singleSourceRatio(series(196, 8)) > 0.95);
});

test('a strummed open chord has several fundamentals', () => {
  const G = [98, 123.47, 146.83, 196, 246.94, 392].flatMap((f) => series(f, 4));
  const E = [82.41, 123.47, 164.81, 207.65, 246.94, 329.63].flatMap((f) => series(f, 4));
  const C = [130.81, 164.81, 196, 261.63, 329.63].flatMap((f) => series(f, 4));
  for (const ch of [G, E, C]) assert.ok(singleSourceRatio(ch) < 0.88, String(singleSourceRatio(ch)));
});

test('present notes and template matching for G major chroma', () => {
  const acc = new Float32Array(12);
  acc[7] = 1; acc[11] = 0.7; acc[2] = 0.8; // G B D
  const best = matchChord(acc, acc)[0];
  assert.equal(best.root, 7);
  assert.equal(best.quality, '');
  assert.equal(presentChordNotes(acc, 7, ''), 3);
  const two = new Float32Array(12); two[7] = 1; two[2] = 0.8;
  assert.ok(presentChordNotes(two, 7, '') < 3);
});
