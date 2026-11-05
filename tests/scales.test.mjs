import test from 'node:test';
import assert from 'node:assert/strict';
import { boxNotes, runNotes, patternNotes, SCALES, OPEN, PATTERNS, SCALE_IDS, fingerFor } from '../src/scales.js';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nm = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
const where = (n) => `${n.s}:${n.f}`;

test('A minor pentatonic, frets 5-8: the classic box (E:5,8 A:5,7 D:5,7 G:5,7 H:5,8 e:5,8)', () => {
  const ns = boxNotes(9, 'minPent', 5);
  assert.deepEqual(ns.map(where), ['0:5', '0:8', '1:5', '1:7', '2:5', '2:7', '3:5', '3:7', '4:5', '4:8', '5:5', '5:8']);
  assert.deepEqual(ns.map((n) => nm(n.m)), ['A2', 'C3', 'D3', 'E3', 'G3', 'A3', 'C4', 'D4', 'E4', 'G4', 'A4', 'C5']);
  assert.deepEqual(ns.filter((n) => n.root).map((n) => nm(n.m)), ['A2', 'A3', 'A4']);
  // jedan prst na prag: 5→1, 7→3, 8→4
  assert.deepEqual(ns.map((n) => n.finger), [1, 4, 1, 3, 1, 3, 1, 3, 1, 4, 1, 4]);
});

test('G minor pentatonic at fret 3 is the same shape, 2 frets lower', () => {
  const a = boxNotes(9, 'minPent', 5), g = boxNotes(7, 'minPent', 3);
  assert.deepEqual(g.map((n) => [n.s, n.f + 2, n.finger]), a.map((n) => [n.s, n.f, n.finger]));
  assert.ok(g.filter((n) => n.root).every((n) => n.m % 12 === 7));
});

test('C major at fret 7 and E minor, A blues, A major pentatonic: only scale notes, every note once, roots right', () => {
  for (const [key, scale, pos] of [[0, 'major', 7], [4, 'minor', 0], [9, 'blues', 5], [9, 'majPent', 4], [2, 'chromatic', 2], [11, 'minPent', 12]]) {
    const ns = boxNotes(key, scale, pos);
    assert.ok(ns.length >= 6, `${key} ${scale} ${pos}`);
    const set = SCALES[scale];
    for (const n of ns) {
      assert.equal(OPEN[n.s] + n.f, n.m);
      assert.ok(set.includes((n.m - key + 120) % 12), `${nm(n.m)} not in ${scale}`);
      assert.equal(n.root, n.m % 12 === key);
      assert.ok(n.f >= pos && n.f <= pos + 3, `fret ${n.f} outside box ${pos}`);
      assert.equal(n.finger, fingerFor(n.f, pos));
    }
    assert.equal(new Set(ns.map((n) => n.m)).size, ns.length, 'each pitch once');
    for (let i = 1; i < ns.length; i++) assert.ok(ns[i].m > ns[i - 1].m);
  }
  // blues: A C D D# E G (d# = blue note)
  assert.deepEqual([...new Set(boxNotes(9, 'blues', 5).map((n) => NAMES[n.m % 12]))].sort(), ['A', 'C', 'D', 'D#', 'E', 'G'].sort());
  // C major position 7: C D E F G A B only
  assert.deepEqual([...new Set(boxNotes(0, 'major', 7).map((n) => NAMES[n.m % 12]))].sort(), ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
});

test('open position (0-4): open strings are finger 0, fret n is finger n', () => {
  const ns = boxNotes(4, 'minPent', 0); // E molska pentatonika u prvoj poziciji
  assert.deepEqual(ns.slice(0, 4).map(where), ['0:0', '0:3', '1:0', '1:2']);
  assert.deepEqual(ns.map((n) => n.finger), ns.map((n) => n.f));
});

test('every pattern starts and ends on the root (all scales, several keys and positions)', () => {
  for (const key of [0, 4, 7, 9, 11]) for (const scale of SCALE_IDS) for (const pos of [0, 3, 5, 8, 12]) {
    const run = runNotes(key, scale, pos);
    if (run.length < 3) continue;
    for (const p of PATTERNS) {
      const seq = patternNotes(key, scale, pos, p);
      assert.ok(seq[0].root && seq[seq.length - 1].root, `${key} ${scale} ${pos} ${p}`);
      assert.equal(seq[0].m, seq[seq.length - 1].m, 'starts and ends on the same root');
    }
  }
});

test('patterns: up-down, thirds, sequences of 3 and 4', () => {
  const N = runNotes(9, 'minPent', 5).map((n) => nm(n.m));
  assert.deepEqual(N, ['A2', 'C3', 'D3', 'E3', 'G3', 'A3', 'C4', 'D4', 'E4', 'G4', 'A4', 'C5']);
  const up = patternNotes(9, 'minPent', 5, 'updown').map((n) => nm(n.m));
  assert.equal(up.length, 2 * N.length - 1);
  assert.deepEqual(up.slice(0, 3), ['A2', 'C3', 'D3']);
  assert.deepEqual(patternNotes(9, 'minPent', 5, 'thirds').slice(0, 6).map((n) => nm(n.m)), ['A2', 'D3', 'C3', 'E3', 'D3', 'G3']);
  assert.deepEqual(patternNotes(9, 'minPent', 5, 'seq3').slice(0, 6).map((n) => nm(n.m)), ['A2', 'C3', 'D3', 'C3', 'D3', 'E3']);
  assert.deepEqual(patternNotes(9, 'minPent', 5, 'seq4').slice(0, 8).map((n) => nm(n.m)), ['A2', 'C3', 'D3', 'E3', 'C3', 'D3', 'E3', 'G3']);
});
