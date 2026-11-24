// v2.4.1: tuner sme da označi žicu kao naštimovanu samo kad stvarno jeste — i uvek kad jeste.
// Sintetičke žice (čelik, najlon, električna; čist zvuk i mikrofon telefona bez dubokih tonova), ista logika kao ekran:
// presuda (r.judge) mora biti unutar TUNE.normal.done ovoliko ms zaredom (DONE_HOLD u tuner.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PitchTracker, TUNE } from '../src/pitchtrack.js';
import { SR, pluck, roomNoise, lowCut, rng } from './helpers/guitarSynth.mjs';

const OPEN = [40, 45, 50, 55, 59, 64];
const HOLD = 350;
function ticked(cents, sid, timbre, mic, seed) {
  const r = rng(seed + sid); const y = new Float32Array(5 * SR); roomNoise(y, -62, r);
  pluck(y, 1, OPEN[sid], { timbre, cents, dur: 3 }, r); if (mic === 'phone') lowCut(y, 150);
  const tr = new PitchTracker({ a4: 440 }); tr.reset(); let since = 0; const judges = [];
  for (let s = 0; s + 4096 <= y.length; s += 960) {
    const now = ((s + 4096) / SR) * 1000; const q = tr.process(y.subarray(s, s + 4096), SR, now);
    if (q.state !== 'tracking' || q.judge == null) { since = 0; continue; }
    judges.push(q.judge);
    if (Math.abs(q.judge) <= TUNE.normal.done) { if (!since) since = now; if (now - since >= HOLD) return { done: true, judges }; } else since = 0;
  }
  return { done: false, judges };
}
const memo = new Map();
function sweep(cents) {
  if (memo.has(cents)) return memo.get(cents);
  let n = 0, tot = 0; const err = [];
  for (const mic of ['clean', 'phone']) for (const timbre of ['steel', 'nylon', 'electric']) for (let sid = 0; sid < 6; sid++) {
    const q = ticked(cents, sid, timbre, mic, 11); tot++; if (q.done) n++;
    if (q.judges.length) err.push(q.judges[q.judges.length >> 1] - cents);
  }
  err.sort((a, b) => a - b);
  const out = { n, tot, medErr: err[err.length >> 1] }; memo.set(cents, out); return out;
}

test('naštimovana žica (0 i −2 centa) se uvek označi', () => {
  for (const c of [0, -2]) { const s = sweep(c); assert.equal(s.n, s.tot, `${c} c: označeno ${s.n}/${s.tot}`); }
});
test('žica 6 ili 9 centi daleko se (skoro) nikad ne označi', () => {
  for (const c of [-9, 9, 6]) { const s = sweep(c); assert.equal(s.n, 0, `${c} c: označeno ${s.n}/${s.tot}`); }
  const s = sweep(-6); assert.ok(s.n <= 2, `−6 c: označeno ${s.n}/${s.tot}`); // debela E na čeliku zvuči ~3 c više u prvoj sekundi
});
test('presuda je tačna (medijana greške ≤ 1 cent)', () => {
  for (const c of [-6, 0, 6]) { const s = sweep(c); assert.ok(Math.abs(s.medErr) <= 1, `${c} c: greška ${s.medErr.toFixed(2)}`); }
});
