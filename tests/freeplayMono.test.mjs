// Samo sviraj v2 (freeplayMono): pojedinačne note — tačnost sa oktavom, kašnjenje, lažne note od glasa i buke.
// Zvuk je sintetički (trzana žica sa neharmoničnošću, telefonski low-cut, glas, ventilator, brujanje …), sa
// fiksnim semenom; isti generator je korišćen za izbor metoda (MPM) i podešavanje.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonoEngine, pitchMPM, pitchYIN } from '../src/freeplayMono.js';
import { SR, rng, pluck, voice, roomNoise, hum, fan, tap, squeak, click, lowCut, OPEN } from './helpers/guitarSynth.mjs';

function run(y, params = {}) {
  const eng = createMonoEngine({ sr: SR, params }), ev = [];
  for (let i = 0; i + 128 <= y.length; i += 128) for (const e of eng.push(y.subarray(i, i + 128))) ev.push({ t: e.t / 1000, m: e.midis[0] });
  return ev;
}
function score(ev, notes) {
  let ok = 0; const delays = [], used = new Set();
  notes.forEach((n, i) => {
    const end = Math.min(notes[i + 1] ? notes[i + 1].t : 1e9, n.t + 0.35);
    const k = ev.findIndex((e, j) => !used.has(j) && e.t >= n.t - 0.03 && e.t < end);
    if (k < 0) return; used.add(k);
    if (ev[k].m === n.m) { ok++; delays.push((ev[k].t - n.t) * 1000); }
  });
  return { pct: (100 * ok) / notes.length, avg: delays.reduce((a, b) => a + b, 0) / (delays.length || 1), max: Math.max(0, ...delays) };
}
const buf = (s) => new Float32Array(Math.round(s * SR));

test('pitch methods: MPM and YIN find E2 … E6 with the right octave (also with a weak fundamental)', () => {
  const r = rng(5);
  for (const m of [40, 45, 52, 57, 64, 71, 76, 83, 88]) for (const weakF of [1, 0.2]) {
    const y = buf(0.3); pluck(y, 0.01, m, { peakDb: -20, dur: 0.3, weakF }, r);
    const seg = y.subarray(Math.round(0.05 * SR), Math.round(0.077 * SR));
    for (const fn of [pitchMPM, pitchYIN]) { const p = fn(seg, SR); const got = Math.round(69 + 12 * Math.log2(p.f / 440)); assert.equal(got, m, `${fn.name} ${m} weakF=${weakF}`); }
  }
});

test('all six strings, frets 0-12, three timbres, phone low-cut: ≥ 95 % right note with octave, delay < 100 ms', () => {
  const r = rng(11), notes = [], y = buf(6 * 7 * 0.36 + 1); let t = 0.4;
  for (let s = 0; s < 6; s++) for (const f of [0, 2, 4, 5, 7, 9, 12]) { const m = OPEN[s] + f; pluck(y, t, m, { timbre: ['steel', 'nylon', 'electric'][s % 3], cents: (r() * 2 - 1) * 30, peakDb: -18 - 14 * r(), dur: 0.34 }, r); notes.push({ t, m }); t += 0.36; }
  lowCut(y, 120); roomNoise(y, -59, r);
  const s = score(run(y), notes);
  assert.ok(s.pct >= 95, `correct ${s.pct.toFixed(1)} %`);
  assert.ok(s.avg < 100, `avg delay ${s.avg.toFixed(0)} ms`);
});

test('fast passage (~6 notes/s) and a legato trill (hammer-on / pull-off) are not skipped', () => {
  const r = rng(12), notes = [], y = buf(8); let t = 0.4;
  for (let k = 0; k < 14; k++) { const m = 64 + [0, 2, 3, 5, 7, 5, 3, 2][k % 8]; pluck(y, t, m, { peakDb: -22, dur: 0.16 }, r); notes.push({ t, m }); t += 0.17; }
  t += 0.5;
  for (let j = 0; j < 10; j++) { const m = j % 2 ? 72 : 70; pluck(y, t, m, { legato: j > 0, attackMs: j > 0 ? 8 : 3, peakDb: j > 0 ? -30 : -20, dur: 0.22 }, r); notes.push({ t, m }); t += 0.22; }
  roomNoise(y, -59, r);
  const s = score(run(y), notes);
  assert.ok(s.pct >= 90, `correct ${s.pct.toFixed(1)} %`);
});

test('speech (male, female) and room sounds give (almost) no notes', () => {
  const r = rng(13);
  const cases = [
    ['speech male', (y) => voice(y, 0.3, 19.7, { kind: 'speech', who: 'male', db: -26 }, r), 1],
    ['speech female', (y) => voice(y, 0.3, 19.7, { kind: 'speech', who: 'female', db: -22 }, r), 1],
    ['fan', (y) => fan(y, 0, 20, { db: -40 }, r), 0],
    ['mains hum 50 Hz', (y) => hum(y, 0, 20, { f: 50, db: -40 }), 0],
    ['body taps', (y) => { for (let t = 0.5; t < 19.5; t += 0.9) tap(y, t, { db: -18 }, r); }, 0],
    ['string squeaks', (y) => { for (let t = 0.5; t < 19.5; t += 1.1) squeak(y, t, { db: -30 }, r); }, 0],
    ['metronome clicks', (y) => { let k = 0; for (let t = 0.5; t < 19.5; t += 0.5) click(y, t, k++ % 4 === 0, { db: -20 }); }, 0],
  ];
  for (const [name, fn, max] of cases) { const y = buf(20); fn(y); roomNoise(y, -59, r); const n = run(y).length; assert.ok(n <= max, `${name}: ${n} false notes in 20 s`); }
});

test('soft (-40 dBFS) and very loud notes', () => {
  for (const db of [-40, -4]) {
    const r = rng(14), notes = [], y = buf(7); let t = 0.4;
    for (let k = 0; k < 12; k++) { const m = 45 + ((k * 7) % 34); pluck(y, t, m, { peakDb: db, dur: 0.4 }, r); notes.push({ t, m }); t += 0.5; }
    roomNoise(y, -59, r);
    const s = score(run(y), notes);
    assert.ok(s.pct >= 90, `${db} dB: ${s.pct.toFixed(1)} %`);
  }
});
