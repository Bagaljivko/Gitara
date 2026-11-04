// Vežbe — „čuje li igra gitaru?“ Isti detektor kao u igrama, na realističnim signalima telefona:
// fizički model žice + struganje trzalice, mikrofon telefona (slabi duboki tonovi), tiha i bučna soba,
// tihi trzaji i klik metronoma iz zvučnika.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDetector, createHitLog, sameNote } from '../src/practiceListen.js';
import { SR, room, addPluck, addClick, phoneMic, frames } from './helpers/phoneMic.mjs';

const STRINGS = [40, 45, 50, 55, 59, 64];
// Pusti signal kroz detektor; vrati udarce sa notom (isto kao igre: nota najčešće čuta 30–300 ms posle udarca)
function listen(sig, { sensitivity = 'auto' } = {}) {
  const det = createDetector({ sensitivity }), log = createHitLog();
  const levels = [];
  frames(sig, (buf, now) => {
    const ev = det.process(buf, SR, now);
    levels.push(ev.level);
    if (ev.onset) log.onset({ at: ev.onset.at });
    if (ev.pluck) log.pluck(ev.pluck);
    if (ev.note) log.note({ midi: ev.note.midi, at: now });
  });
  return { hits: log.hits.map((h) => ({ at: h.at, h, midi: log.midiOf(h), matches: (m) => log.matches(h, m) })), levels };
}
// Za svaki pravi trzaj: da li postoji udarac u ±40 ms sa tačnom notom (ili oktavom — kao u igrama)?
function score(hits, plucks) {
  let found = 0, notes = 0, maxErr = 0;
  for (const p of plucks) {
    const h = hits.find((x) => Math.abs(x.at - p.t * 1000) <= 40);
    if (h) { found++; maxErr = Math.max(maxErr, Math.abs(h.at - p.t * 1000)); if (h.matches(p.midi)) notes++; }
  }
  const extra = hits.filter((h) => !plucks.some((p) => Math.abs(h.at - p.t * 1000) <= 40) && h.midi != null).length;
  return { found, notes, extra, maxErr };
}
function scene({ amp = 0.06, noise = 0.0006, clicks = false, midis, gap = 0.6 } = {}) {
  const ms = midis || [...STRINGS, 41, 46, 52, 57, 62, 67, 69, 72];
  let sig = room(1.5 + ms.length * gap + 1, noise);
  const plucks = ms.map((midi, i) => ({ t: 1.5 + i * gap, midi }));
  plucks.forEach((p) => addPluck(sig, p.t, p.midi, amp));
  if (clicks) for (let t = 1.0; t < sig.length / SR - 0.2; t += gap / 2) addClick(sig, t + 0.013, 0.04, false);
  return { sig: phoneMic(sig), plucks };
}

test('normal plucks on a phone mic, quiet room: every pluck and note is heard, timing within 40 ms', () => {
  const { sig, plucks } = scene({});
  const r = score(listen(sig).hits, plucks);
  console.log(`  normal/quiet: ${r.found}/${plucks.length} plucks, ${r.notes} right notes, ${r.extra} extra, max timing error ${r.maxErr.toFixed(0)} ms`);
  assert.equal(r.found, plucks.length);
  assert.ok(r.notes >= plucks.length - 1);
  assert.ok(r.maxErr <= 40);
});

test('soft plucks (≈ −36 dB) in a quiet room are still heard', () => {
  const { sig, plucks } = scene({ amp: 0.012 });
  const r = score(listen(sig).hits, plucks);
  console.log(`  soft/quiet: ${r.found}/${plucks.length} plucks, ${r.notes} right notes, ${r.extra} extra`);
  assert.ok(r.found >= plucks.length - 1);
  assert.ok(r.notes >= plucks.length - 2);
});

test('noisy room (fan/traffic): normal plucks are heard, noise alone gives no notes', () => {
  const { sig, plucks } = scene({ noise: 0.004 });
  const r = score(listen(sig).hits, plucks);
  console.log(`  normal/noisy: ${r.found}/${plucks.length} plucks, ${r.notes} right notes, ${r.extra} extra`);
  assert.ok(r.found >= plucks.length - 1);
  assert.ok(r.notes >= plucks.length - 2);
  const quiet = listen(phoneMic(room(6, 0.004))).hits.filter((h) => h.midi != null);
  assert.equal(quiet.length, 0, 'room noise must not produce notes');
});

test('metronome click from the phone speaker is never taken as a note', () => {
  let sig = room(8, 0.0006);
  for (let t = 1; t < 7.5; t += 0.5) addClick(sig, t, 0.05, Math.round(t) === t);
  const notes = listen(phoneMic(sig)).hits.filter((h) => h.midi != null);
  assert.equal(notes.length, 0);
});

test('plucks on the beat with the speaker click on top: plucks still heard and on time', () => {
  const { sig, plucks } = scene({ clicks: true });
  const r = score(listen(sig).hits, plucks);
  console.log(`  with clicks: ${r.found}/${plucks.length} plucks, ${r.notes} right notes, max timing error ${r.maxErr.toFixed(0)} ms`);
  assert.ok(r.found >= plucks.length - 1);
  assert.ok(r.notes >= plucks.length - 2);
  assert.ok(r.maxErr <= 40);
});

test('the same string plucked again while it still rings (rhythm) counts every pluck', () => {
  const { sig, plucks } = scene({ midis: Array(12).fill(40), gap: 0.3 }); // osmine na 100 BPM na praznoj E
  const r = score(listen(sig).hits, plucks);
  console.log(`  re-plucks of low E every 300 ms: ${r.found}/${plucks.length}`);
  assert.ok(r.found >= plucks.length - 1);
});

test('the level meter moves with the guitar (silence low, pluck high)', () => {
  const { sig } = scene({ midis: [45], amp: 0.03 });
  const { levels } = listen(sig);
  const quiet = Math.max(...levels.slice(10, 40)), loud = Math.max(...levels);
  assert.ok(loud > quiet * 8, `meter barely moves: ${quiet} → ${loud}`);
});

test('the speaker click while a string is still ringing is not counted as a strum', () => {
  let sig = room(6, 0.0006);
  addPluck(sig, 1, 45, 0.06, { dur: 5 });                       // A zvoni dugo
  for (let t = 1.5; t < 5.5; t += 0.5) addClick(sig, t, 0.05);  // klikovi preko nje
  const hits = listen(phoneMic(sig)).hits;
  console.log(`  clicks over a ringing string: ${hits.length} hit(s) (only the real pluck expected)`);
  assert.equal(hits.length, 1);
});
