import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage ??= { getItem() { return null; }, setItem() {} };
globalThis.document ??= { documentElement: {} };
const { makeTapTempo, TAP_NEEDED, chordNotes } = await import('../src/rhythm.js');

test('tap tempo needs 4 taps, then follows the tapped tempo (up or down)', () => {
  const tap = makeTapTempo();
  let r;
  for (let i = 0; i < TAP_NEEDED; i++) r = tap(1000 + i * 500); // 120 BPM
  assert.equal(r.bpm, 120);
  const tap2 = makeTapTempo();
  const first = tap2(0);
  assert.equal(first.bpm, null);
  assert.equal(first.count, 1);
  for (let i = 1; i < 6; i++) r = tap2(i * 1000); // 60 BPM — slower works too
  assert.equal(r.bpm, 60);
});

test('tap tempo ignores one sloppy tap (median) and restarts after a pause', () => {
  const tap = makeTapTempo();
  let r;
  [0, 500, 1000, 1700, 2000, 2500].forEach((x) => { r = tap(x); });
  assert.equal(r.bpm, 120);
  r = tap(6000); // pauza > 2,5 s
  assert.equal(r.bpm, null);
  assert.equal(r.count, 1);
});

test('chord notes come from the easiest fingering, muted strings skipped', () => {
  const c = chordNotes('C'); // x32010
  assert.equal(c.length, 5);
  assert.ok(Math.abs(c[0] - 130.81) < 0.1); // C3 na A žici, 3. prag
  assert.equal(chordNotes('G').length, 6);
  assert.equal(chordNotes(null), null);
});
