// „Pusti“: pesma → zvučni događaji. TAB: tačne note i vreme iz tablature (Romance, taktovi 1–8, ponavljanja);
// akordi: udarci po ritmu pesme, dužina akorda kako je napisan, kapodaster i transpozicija u visini tona.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tabTimeline, chordTimeline, chordHalves } from '../src/songPlay.js';
import { fromScan } from '../src/tabSong.js';
import { romanceScan, BARS_1_8 } from './helpers/romance.mjs';
import { textToSections } from '../src/songformat.js';

const near = (a, b, e = 1e-3) => Math.abs(a - b) < e;
const OPEN = [64, 59, 55, 50, 45, 40];

test('TAB: bars 1–8 of Romance play exactly the tab notes at the tab times (bass rings the whole bar)', () => {
  const tl = tabTimeline(fromScan(romanceScan()));
  const first = tl.events.filter((e) => e.beat < 24 - 1e-6);
  assert.equal(first.length, 80);
  BARS_1_8.forEach((x, i) => {
    const off = i * 3, ev = first.filter((e) => e.beat >= off - 1e-6 && e.beat < off + 3 - 1e-6);
    const bass = ev.find((e) => e.s >= 4);
    assert.deepEqual([bass.midi, bass.beat, bass.dur], [OPEN[x.bass[0] - 1] + x.bass[1], off, 3], `bar ${i + 1} bass`);
    for (let k = 0; k < 3; k++) {
      const m = ev.find((e) => e.s === 1 && near(e.beat, off + k)), B = ev.find((e) => e.s === 2 && near(e.beat, off + k + 1 / 3)), G = ev.find((e) => e.s === 3 && near(e.beat, off + k + 2 / 3));
      assert.equal(m.midi, 64 + x.mel[k], `bar ${i + 1} melody ${k + 1}`);
      assert.equal(B.midi, 59 + x.b); assert.equal(G.midi, 55 + x.g);
      assert.ok(near(B.dur, 1 / 3) && near(m.dur, 1));
    }
  });
  assert.deepEqual(tl.segs.slice(0, 8).map((s) => [s.beat, s.ref.bar]), [[0, 0], [3, 1], [6, 2], [9, 3], [12, 4], [15, 5], [18, 6], [21, 7]]);
  assert.equal(tl.total, 192, '32 bars, each half played twice (repeats)');
  assert.deepEqual(tl.segs[16].ref, { bar: 0 }, 'after bar 16 the repeat goes back to bar 1');
  assert.deepEqual(tl.parts.find((p) => p.from === 18 || p.name === '5–8') && [tl.parts[1].from, tl.parts[1].to], [12, 24]);
});

test('chords: strums follow the song pattern; chord lengths as written; capo and transposition in the pitch', () => {
  const song = {
    title: 'Test', key: 'G', transpose: 2, capo: 2, strum: { sig: '4/4', steps: 'D-DU-UDU' },
    sections: textToSections('[Strofa]\nG                       C\nOvo je dugačak red teksta i ovde\nD    G\nkratko'),
  };
  const tl = chordTimeline(song);
  // red 1: G preko dugog dela teksta (2 takta), C (1 takt); red 2: kratak tekst → po takt
  assert.deepEqual(tl.segs.map((s) => [s.chord, s.beat, s.len]), [['G', 0, 8], ['C', 8, 4], ['D', 12, 4], ['G', 16, 4]]);
  const g = tl.events.filter((e) => e.chord === 'G' && e.beat < 8);
  assert.deepEqual(g.map((e) => e.beat), [0, 1, 1.5, 2.5, 3, 3.5, 4, 5, 5.5, 6.5, 7, 7.5], 'D-DU-UDU, two bars');
  assert.deepEqual(g.slice(0, 4).map((e) => e.dir), ['D', 'D', 'U', 'U']);
  // tp 2 − kapo 2 = oblici kako su napisani (G), zvuči A: najniža nota G oblika (G2) podignuta za kapo 2 = A2
  const low = Math.min(...g[0].freqs), A2 = 440 * Math.pow(2, (45 - 69) / 12);
  assert.ok(Math.abs(low / A2 - 1) < 0.002, `lowest sounding note ${low.toFixed(1)} Hz = A2`);
  // bez ritma: podrazumevan za 4/4; strofa = deo za petlju
  const plain = chordTimeline({ ...song, strum: undefined, capo: 0, transpose: 0 });
  assert.equal(plain.events.filter((e) => e.beat < 4).length, 6);
  assert.deepEqual(plain.parts.map((p) => [p.name, p.from, p.to]), [['Strofa', 0, 20]]);
  assert.equal(Math.min(...plain.events[0].freqs).toFixed(1), (440 * Math.pow(2, (43 - 69) / 12)).toFixed(1), 'no capo: G2');
});

test('chord lengths from the text: long span = 2 bars, squeezed = half a bar, chords-only line = 1 bar each', () => {
  assert.deepEqual(chordHalves({ text: 'a b c d e f g h i j k l', chords: [{ chord: 'G', position: 0 }, { chord: 'C', position: 4 }, { chord: 'D', position: 6 }, { chord: 'E', position: 10 }] }), [2, 1, 2, 4]);
  assert.deepEqual(chordHalves({ text: '', chords: [{ chord: 'G', position: 0 }, { chord: 'C', position: 4 }] }), [2, 2]);
});

test('player loop: scheduling stays a short window ahead and wraps to the part start (no runaway loop)', async () => {
  const plucks = [];
  let now = 0;
  const ctx = { currentTime: 0, state: 'running', resume: async () => {} };
  const { createPlayerWith } = await import('../src/songPlayerCore.js');
  const tl = tabTimeline(fromScan(romanceScan()));
  const pl = createPlayerWith(tl, { bpm: 60, ctx: () => ctx, play: (e, when) => plucks.push([e.beat, when]) });
  // tempo 50 %: dve sekunde po dobi
  pl.setLoop({ from: 0, to: 12 });
  pl.play(9);
  for (let t = 0; t < 7; t += 0.04) { ctx.currentTime = t; pl.tick(); }
  const beats = plucks.map((x) => x[0]);
  assert.ok(plucks.length < 60, `${plucks.length} scheduled in 7 s`);
  assert.ok(beats.some((b, i) => i && b < beats[i - 1]), 'wrapped to the start of the part');
  assert.ok(plucks.every(([, w]) => w < 7.5), 'nothing scheduled far ahead');
  assert.ok(Math.max(...beats) < 12);
  void now;
});

test('player timing: 60 BPM = 1 s per beat for every note of bars 1–2; at 50 % tempo 2 s per beat', async () => {
  const { createPlayerWith } = await import('../src/songPlayerCore.js');
  const tl = tabTimeline(fromScan(romanceScan()));
  for (const [rate, spb] of [[1, 1], [0.5, 2]]) {
    const ctx = { currentTime: 10, state: 'running' }, got = [];
    const pl = createPlayerWith(tl, { bpm: 60, rate, ctx: () => ctx, play: (e, when) => got.push([e.beat, e.midi, when]) });
    pl.play(0);
    for (let t = 10; t < 10 + 6.2 * spb; t += 0.04) { ctx.currentTime = t; pl.tick(); }
    const exp = tl.events.filter((e) => e.beat < 6 - 1e-6);
    const mine = got.filter(([b]) => b < 6 - 1e-6);
    assert.equal(mine.length, exp.length, `rate ${rate}: all notes of bars 1–2`);
    mine.forEach(([b, m, w], i) => { assert.equal(m, exp[i].midi); assert.ok(Math.abs(w - mine[0][2] - b * spb) < 1e-6, `beat ${b} at ${w}`); });
  }
});
