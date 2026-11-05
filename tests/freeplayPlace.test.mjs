// Samo sviraj: položaj note na vratu (mikrofon čuje samo visinu — žicu nagađamo kao gitarista: ruka stoji na jednom mestu).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlacer, fingerAt, OPEN } from '../src/freeplayPlace.js';

const at = (s, f) => OPEN[s] + f;

test('locked hand: every note lands inside the 4-fret box (A minor pentatonic at fret 5)', () => {
  const p = createPlacer();
  p.lock(5);
  const box = [[0, 5], [0, 8], [1, 5], [1, 7], [2, 5], [2, 7], [3, 5], [3, 7], [4, 5], [4, 8], [5, 5], [5, 8]];
  let t = 0;
  for (const [s, f] of box) {
    const got = p.place(at(s, f), [], (t += 300));
    assert.deepEqual(got, { s, f }, `midi ${at(s, f)}`);
  }
  // A2 (45) is the open A string too — with the hand at fret 5 it is the low E, fret 5
  assert.deepEqual(p.place(45, [], (t += 300)), { s: 0, f: 5 });
  p.lock(null);
  assert.equal(p.locked, null);
});

test('automatic: a phrase in one position stays in one hand window (no jumping around the neck)', () => {
  const p = createPlacer();
  let t = 0;
  const frets = [76, 74, 72, 69, 67, 64, 62, 64, 67, 69].map((m) => p.place(m, [], (t += 250)).f).filter((f) => f > 0);
  assert.ok(Math.max(...frets) - Math.min(...frets) <= 4, `frets ${frets}`);
});

test('two notes at once never share a string; chord voicing follows the hand', () => {
  const p = createPlacer();
  const a = p.place(64, [], 0), b = p.place(59, [a.s], 0);
  assert.notEqual(a.s, b.s);
  p.lock(7);
  const v = p.chord('A');
  assert.ok(v && v.baseFret >= 4, `A near fret 7, got base ${v && v.baseFret}`);
});

test('finger colour: first finger on the hand position, open string = 0', () => {
  assert.equal(fingerAt(0, 6.5), 0);
  assert.equal(fingerAt(5, 6.5), 1);
  assert.equal(fingerAt(8, 6.5), 4);
});
