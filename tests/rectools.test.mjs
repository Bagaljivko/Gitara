import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanEvents, estimateTempo, beatTabs } from '../src/recTools.js';

// pseudo-slučajno, ali isto pri svakom pokretanju
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const jit = (ms) => (rnd() * 2 - 1) * ms;
const note = (m = 50) => ({ notes: [{ m, s: 2, f: m - 50 }] });

// ritam u osminama (1 = trzaj, 0 = pauza), ponovljen
function play(bpm, pattern, bars = 6, j = 18, start = 1700) {
  const half = 60000 / bpm / 2, out = [];
  for (let b = 0; b < bars; b++) pattern.forEach((x, i) => { if (x) out.push({ t: Math.round(start + (b * pattern.length + i) * half + jit(j)), ...note(50 + (i % 5)) }); });
  return out;
}

test('tempo: steady quarter notes, eighths and mixed rhythms (not double or half)', () => {
  const cases = [
    [90, [1, 0, 1, 0, 1, 0, 1, 0]],
    [120, [1, 0, 1, 0, 1, 0, 1, 0]],
    [100, [1, 0, 1, 1, 0, 1, 1, 0]],
    [140, [1, 0, 0, 1, 1, 0, 1, 0]],
  ];
  for (const [bpm, pat] of cases) {
    const r = estimateTempo(play(bpm, pat));
    assert.ok(r, `${bpm}: no tempo`);
    assert.ok(Math.abs(r.bpm - bpm) / bpm < 0.04, `${bpm} BPM ${pat.join('')}: got ${r.bpm}`);
  }
});

test('tempo: very slow or very fast playing is ambiguous — the tempo, double or half is fine (same tab rhythm)', () => {
  for (const [bpm, pat] of [[75, [1, 1, 1, 1, 1, 1, 1, 1]], [64, [1, 0, 1, 0, 1, 0, 1, 1]], [170, [1, 0, 1, 0, 1, 0, 1, 0]]]) {
    const r = estimateTempo(play(bpm, pat));
    assert.ok(r && [bpm, 2 * bpm, bpm / 2].some((x) => Math.abs(r.bpm - x) / x < 0.04), `${bpm}: ${r && r.bpm}`);
  }
});

test('tempo: too few notes or no steady rhythm → none (tab without bars)', () => {
  assert.equal(estimateTempo(play(90, [1, 0, 0, 0, 0, 0, 0, 0], 3)), null);
  const free = [];
  let t = 0;
  for (let i = 0; i < 30; i++) { t += 150 + Math.round(rnd() * 1400); free.push({ t, ...note() }); }
  assert.equal(estimateTempo(free), null);
});

test('beat tab: notes land on the right eighth of the right bar; playback timing matches', () => {
  const ev = play(100, [1, 0, 1, 1, 0, 1, 1, 0], 4, 12, 900);
  const tempo = estimateTempo(ev);
  const tabs = beatTabs(ev, tempo);
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].bars.length, 4);
  for (const bar of tabs[0].bars) assert.deepEqual(bar.notes.map((n) => (n.p - 1) / 2), [0, 2, 3, 5, 6]);
  assert.ok(tabs[0].bars.every((b) => b.w === 16 && b.notes.every((n) => n.s === 4)));
});

test('clean: trims silence, drops unconfirmed "Am?", merges a chord read twice, keeps the rest', () => {
  const ev = [
    { t: 2000, notes: [{ m: 45, s: 1, f: 0 }] },
    { t: 2600, chord: 'C', notes: [] },
    { t: 2900, chord: 'C', notes: [] },          // isti udarac pročitan dvaput
    { t: 4000, chord: 'Am', u: 1, notes: [] },   // nesiguran, nigde potvrđen
    { t: 5000, chord: 'G', u: 1, notes: [] },    // nesiguran, ali kasnije siguran
    { t: 6000, chord: 'G', notes: [] },
  ];
  const c = cleanEvents(ev);
  assert.equal(c.changed, true);
  assert.deepEqual(c.events.map((e) => [e.t, e.chord || 'n']), [[0, 'n'], [600, 'C'], [3000, 'G'], [4000, 'G']]);
  assert.ok(c.events.every((e) => !('u' in e)));
  assert.equal(c.dur, 5500);
  assert.equal(cleanEvents([{ t: 0, notes: [{ m: 45, s: 1, f: 0 }] }]).changed, false);
});
