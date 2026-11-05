// TAB u kratkom tekstu (kolone žica/prag): Romance D'Amour (32 takta, triole u 3/4) → tekst → isti taktovi, iste note
// i isto vreme (triole iz ravnomernih kolona); prsti, barre, ponavljanja; neravnomeran takt sa *trajanjima; presečen
// odgovor; smeće se odbacuje.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTabText } from '../src/tabScanText.js';
import { romanceScan } from './helpers/romance.mjs';
import { fromScan, checkBars } from '../src/tabSong.js';

export function toText(scan, from = 1, to = 99) {
  const L = [`NASLOV: ${scan.title}`, 'KOMPOZITOR: Anonymous', `TAKT: ${scan.sig}`, `TONALITET: ${scan.key}`, 'TEMPO: 0', `PRVI: ${from}`, `BROJ: ${to - from + 1}`];
  for (const b of scan.bars.filter((x) => x.n >= from && x.n <= to)) {
    const byStart = new Map();
    for (const n of b.notes) { const k = n.start.toFixed(3); if (!byStart.has(k)) byStart.set(k, []); byStart.get(k).push(n); }
    const cols = [...byStart.entries()].sort((a, c) => a[0] - c[0]).map(([, ns]) => ns.sort((a, c) => c.s - a.s).map((n) => `${n.s}/${n.f}${n.finger ? '^' + n.finger : ''}`).join('+'));
    const marks = [b.repeatStart && '|:', b.repeatEnd && ':|', ...(b.barre || []).map((x) => x.label), b.key && `TON=${b.key}`].filter(Boolean);
    L.push(`T${b.n}: ${cols.join(' ')}${marks.length ? ` [${marks.join(' ')}]` : ''}`);
  }
  return L.join('\n');
}

test('Romance: text columns → same notes and same timing as the full JSON reading', () => {
  const scan = romanceScan();
  const full = scan.bars.filter((b) => b.notes.length === 10); // pravilni taktovi (bas + 9 kolona trioli)
  const parsed = parseTabText(toText({ ...scan, bars: full }));
  assert.equal(parsed.title, scan.title); assert.equal(parsed.composer, 'Anonymous'); assert.equal(parsed.sig, '3/4');
  assert.equal(parsed.bars.length, full.length);
  for (const [i, b] of full.entries()) {
    const got = parsed.bars[i];
    assert.equal(got.n, b.n);
    const key = (n) => `${n.s}/${n.f}@${n.start.toFixed(2)}${n.finger ? '^' + n.finger : ''}`;
    assert.deepEqual(got.notes.map(key).sort(), b.notes.map(key).sort(), `bar ${b.n}`);
    // bas zvuči ceo takt, melodija do sledeće note na istoj žici
    assert.equal(got.notes.find((n) => n.start === 0 && n.s >= 5).len, 3);
    if (b.barre) assert.equal(got.barre[0].label, b.barre[0].label);
    assert.equal(!!got.repeatEnd, !!b.repeatEnd);
  }
  // pesma iz kratkog teksta: svi taktovi popunjavaju 3/4, nijedan nije označen
  const song = fromScan({ ...parsed, sig: '3/4' });
  assert.equal(song.tab.bars.length, full.length);
  assert.deepEqual(checkBars(song.tab).filter((f) => f.why !== 'scan'), []);
});

test('barre labels, fingers, repeats, endings, uneven bars with *durations, unsure bars', () => {
  const t = `NASLOV: Test
KOMPOZITOR:
TAKT: 4/4
TONALITET: G
TEMPO: 80
PRVI: 1
BROJ: 4
T1: 6/3+1/3^4*2 2/0*1 3/0*1 [|: BVII]
T2: 5/2 4/0 3/2 2/3 [1/2 BV ?]
T3: 6/0*1 1/0 2/1 [V1 :|]
T4: 4/0+3/2+2/3+1/2 [V2 TAKT=3/4 TON=D]`;
  const p = parseTabText(t);
  assert.equal(p.bpm, 80); assert.equal(p.pageBars, 4); assert.equal(p.composer, '');
  const [b1, b2, b3, b4] = p.bars;
  assert.deepEqual(b1.notes.map((n) => [n.s, n.f, n.start]), [[6, 3, 0], [1, 3, 0], [2, 0, 2], [3, 0, 3]]);
  assert.equal(b1.notes[1].finger, 4); assert.ok(b1.repeatStart); assert.deepEqual(b1.barre, [{ label: 'BVII', fret: 7 }]);
  assert.deepEqual(b2.notes.map((n) => n.start), [0, 1, 2, 3]); assert.deepEqual(b2.barre, [{ label: '1/2 BV', fret: 5, half: true }]);
  assert.deepEqual(p.unsure.map((u) => u.bar), [2]);
  assert.deepEqual(b3.notes.map((n) => n.start), [0, 1, 2.5]); // prva kolona 1 doba, ostale dve dele preostale 3 assert.equal(b3.ending, 1); assert.ok(b3.repeatEnd);
  assert.equal(b4.ending, 2); assert.equal(b4.sig, '3/4'); assert.equal(b4.key, 'D'); assert.equal(b4.notes.length, 4);
  assert.ok(b4.notes.every((n) => n.len === 3)); // jedan akord u 3/4: zvuči ceo takt
});

test('truncated answer drops the cut-off last bar; junk and impossible values are rejected', () => {
  const ok = 'TAKT: 3/4\nT1: 6/0 2/0 3/0\nT2: 6/0 2/0 3/';
  assert.deepEqual(parseTabText(ok, { truncated: true }).bars.map((b) => b.n), [1]);
  const bad = parseTabText('TAKT: 3/4\nT1: 7/0 2/0 3/0\nT2: 6/30 2/0\nT3: 6/0 2/0 3/0');
  assert.deepEqual(bad.bars.map((b) => [b.n, b.notes.length]), [[1, 2], [2, 1], [3, 3]]); // nepoznata žica / prag > 24 se izostave
  assert.deepEqual(bad.unsure.map((u) => u.bar), [1, 2]); // i takt se označi za proveru
  assert.equal(parseTabText('Izvini, ne vidim tablaturu.'), null);
  assert.equal(parseTabText('{"bars":[]}'), null);
});

test('checks: two notes on one string, durations that do not fit, repeated bars (loop) are caught', async () => {
  const { parseTabText } = await import('../src/tabScanText.js');
  const j = parseTabText('TAKT: 3/4\nT1: 6/0+6/3 2/0 3/0\nT2: 5/0*2 2/0*2 3/0*1\nT3: 4/2 3/2 2/3\nT2: 1/1 1/1 1/1\nT1: 6/0 6/0 6/0\nT4: 1/0', {});
  assert.deepEqual(j.bars.map((b) => b.n), [1, 2, 3, 4]); // duplicates ignored, first wins
  assert.equal(j.bars[0].doubt, 'dve note na istoj žici'); assert.equal(j.bars[0].notes.filter((x) => x.s === 6).length, 1);
  assert.equal(j.bars[1].doubt, 'trajanja ne odgovaraju taktu');
  assert.equal(j.bars[2].doubt, undefined);
  assert.deepEqual(j.unsure.map((u) => u.bar), [1, 2]);
  const sh = parseTabText('TAKT: 3/4\nT1: 6/0*1 2/0*1', {});
  assert.equal(sh.bars[0].doubt, undefined); assert.deepEqual(sh.unsure.map((u) => u.bar), [1]); // short bar: note, no re-read
  const l = parseTabText('T1: 6/0\nT2: 5/0\nT1: 6/0\nT3: 4/0', { loop: true });
  assert.deepEqual(l.bars.map((b) => b.n), [1, 2]); // after a loop starts, nothing more is trusted
});
