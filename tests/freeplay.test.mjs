// Akordi → „Samo sviraj“: slušanje slobodnog sviranja na realističnim signalima telefona (simulirana gitara).
// Najvažnije: nikad nota koje nema (ni u buci), nota svetli brzo (~70 ms), preklopljene note se ne gube.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFreeEngine, chordFromNotes } from '../src/freeplayListen.js';
import { SR, room, addPluck, phoneMic } from './helpers/phoneMic.mjs';

function run(sig) {
  const eng = createFreeEngine({ sr: SR }), ev = [];
  for (let end = 8192; end <= sig.length; end += 960) {
    const now = (end / SR) * 1000;
    eng.process(sig.subarray(end - 8192, end), now).events.forEach((e) => ev.push({ ...e, now }));
  }
  return ev;
}
function score(ev, truth) {
  let found = 0, right = 0, wrongNote = 0, named = 0; const lat = [], used = new Set();
  for (const tr of truth) {
    const cand = ev.filter((e) => Math.abs(e.at - tr.t * 1000) < 45);
    if (!cand.length) continue;
    found++; cand.forEach((c) => used.add(c.id));
    const first = cand.find((c) => c.type === 'note');
    if (first) lat.push(first.now - tr.t * 1000);
    const fin = cand[cand.length - 1];
    if (fin.chord) { if (tr.chord === fin.chord) { right++; named++; } else wrongNote++; continue; }
    const shown = fin.midis;
    if (shown.every((m) => tr.midis.includes(m))) right++;
    else if (shown.some((m) => !tr.midis.some((x) => x % 12 === m % 12))) wrongNote++; // pogrešno ime note
  }
  const extra = new Set(ev.filter((e) => !used.has(e.id)).map((e) => e.id)).size;
  lat.sort((a, b) => a - b);
  return { found, right, wrongNote, named, extra, median: lat[lat.length >> 1] ?? 0, max: lat[lat.length - 1] ?? 0 };
}

test('quiet single notes (≈ −38 dB): heard, right note, lit within ~100 ms', () => {
  const ms = [40, 45, 50, 55, 59, 64, 43, 48, 52, 57, 62, 67]; let s = room(1 + ms.length * 0.7 + 1, 0.0006);
  const tr = ms.map((m, i) => ({ t: 1 + i * 0.7, midis: [m] })); tr.forEach((x) => addPluck(s, x.t, x.midis[0], 0.012));
  const r = score(run(phoneMic(s)), tr);
  console.log(`  quiet: ${r.found}/12 heard, ${r.right} right, ${r.wrongNote} wrong, ${r.extra} extra, light ${r.median.toFixed(0)} ms (max ${r.max.toFixed(0)})`);
  assert.ok(r.found >= 10); assert.equal(r.wrongNote, 0); assert.equal(r.extra, 0); assert.ok(r.median <= 100);
});
test('fast run (a note every 130 ms) with room noise', () => {
  const ms = [45, 47, 48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67]; let s = room(1 + ms.length * 0.13 + 1.5, 0.002);
  const tr = ms.map((m, i) => ({ t: 1 + i * 0.13, midis: [m] })); tr.forEach((x) => addPluck(s, x.t, x.midis[0], 0.05, { dur: 0.3 }));
  const r = score(run(phoneMic(s)), tr);
  console.log(`  fast run: ${r.found}/14 heard, ${r.right} right, ${r.wrongNote} wrong, ${r.extra} extra, light ${r.median.toFixed(0)} ms`);
  assert.ok(r.found >= 10); assert.ok(r.right >= 9); assert.ok(r.wrongNote <= 1); assert.equal(r.extra, 0);
});
test('overlapping notes: a new note while the previous still rings is heard as one new note', () => {
  const ms = [45, 52, 57, 60, 64, 57, 52, 48]; let s = room(1 + ms.length * 0.45 + 2, 0.0008);
  const tr = ms.map((m, i) => ({ t: 1 + i * 0.45, midis: [m] })); tr.forEach((x) => addPluck(s, x.t, x.midis[0], 0.05, { dur: 2.5 }));
  const r = score(run(phoneMic(s)), tr);
  console.log(`  overlapping: ${r.found}/8 heard, ${r.right} right, ${r.extra} extra`);
  assert.equal(r.found, 8); assert.ok(r.right >= 7); assert.equal(r.wrongNote, 0);
});
test('two notes at once: never a wrong note (both, or only the strongest)', () => {
  const ps = [[45, 50], [48, 57], [57, 60], [52, 60], [45, 52], [55, 59]]; let s = room(1 + ps.length * 0.9 + 1, 0.0008);
  const tr = ps.map((p, i) => ({ t: 1 + i * 0.9, midis: p })); tr.forEach((x) => x.midis.forEach((m) => addPluck(s, x.t, m, 0.045)));
  const r = score(run(phoneMic(s)), tr);
  console.log(`  two notes: ${r.found}/6 heard, ${r.right} shown correctly (both or strongest), ${r.wrongNote} wrong`);
  assert.equal(r.found, 6); assert.equal(r.wrongNote, 0);
});
test('strummed chords with room noise: a chord name only when sure, otherwise the right notes', () => {
  const C = { C: [48, 52, 55, 60, 64], G: [43, 47, 50, 55, 59, 67], Am: [45, 52, 57, 60, 64], Em: [40, 47, 52, 55, 59, 64], D: [50, 57, 62, 66], E: [40, 47, 52, 56, 59, 64] };
  const seq = ['C', 'G', 'Am', 'Em', 'D', 'E']; let s = room(1 + seq.length * 1.2 + 1, 0.002);
  const tr = seq.map((c, i) => ({ t: 1 + i * 1.2, chord: c, midis: C[c] })); tr.forEach((x) => C[x.chord].forEach((m, k) => addPluck(s, x.t + k * 0.012, m, 0.04)));
  const r = score(run(phoneMic(s)), tr);
  console.log(`  chords: ${r.found}/6 heard, ${r.named} named, ${r.right} named or shown correctly, ${r.wrongNote} wrong`);
  assert.equal(r.found, 6); assert.ok(r.wrongNote <= 1); assert.ok(r.named >= 4);
});
test('room noise alone never makes a note', () => {
  assert.equal(run(phoneMic(room(6, 0.003))).length, 0);
});
test('chord names from notes need three chord tones', () => {
  assert.equal(chordFromNotes([48, 52, 55]), 'C');
  assert.equal(chordFromNotes([45, 52]), null);
});
test('the same note plucked again (repeats) lights every time', () => {
  let s = room(5, 0.0008);
  const tr = [0, 1, 2, 3, 4, 5].map((i) => ({ t: 1 + i * 0.4, midis: [57] }));
  tr.forEach((x, i) => addPluck(s, x.t, 57, 0.05, { dur: 1.5, restrike: i > 0 }));
  const r = score(run(phoneMic(s)), tr);
  console.log(`  repeats: ${r.found}/6 heard, ${r.right} right, ${r.wrongNote} wrong`);
  assert.ok(r.right >= 5); assert.equal(r.wrongNote, 0);
});
