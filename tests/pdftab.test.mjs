import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findStaves, pdfToTabText, asciiTabBars, barsToText, pdfToPlainText, pdfChordText } from '../src/pdfTab.js';
import { parseTabText } from '../src/tabScanText.js';
import { isChordLine, textToSections } from '../src/songformat.js';

// Sintetička strana kao iz programa za note: notni sistem (5 linija), tablatura (6 linija), taktne crte, brojevi.
const SP = 7.5, TOP = 200, X0 = 40, X1 = 560;
function page({ bars, repeatAfter = -1, barre = null, gap = false }) {
  const segs = [], items = [], dots = [];
  const line = (x0, y0, x1, y1) => segs.push({ x0, y0, x1, y1 });
  for (let i = 0; i < 5; i++) line(X0, 100 + i * 8, X1, 100 + i * 8); // notni sistem (preskače se)
  for (let i = 0; i < 6; i++) { line(X0, TOP + i * SP, X0 + 200, TOP + i * SP); line(X0 + 206, TOP + i * SP, X1, TOP + i * SP); } // prekinuta oko broja
  const xs = [X0];
  const w = (X1 - X0 - (gap ? 60 : 0)) / bars.length;
  let x = X0;
  bars.forEach((b, bi) => {
    if (gap && bi === 1) { x += 60; xs.push(x); } // prazno mesto (promena tonaliteta) bez nota
    const cols = b.length, step = (w - 20) / (b.rest ? cols + 3 : cols);
    b.forEach((col, ci) => col.forEach(([s, f]) => items.push({ str: String(f), x: x + 12 + ci * step - 3, y: TOP + (s - 1) * SP + 3, w: String(f).length * 5, size: 8.7 })));
    x += w; xs.push(x);
  });
  for (const bx of xs) line(bx, TOP, bx, TOP + 5 * SP);
  if (repeatAfter >= 0) { const bx = xs[repeatAfter + 1]; line(bx - 4, TOP, bx - 4, TOP + 5 * SP); dots.push({ x: bx - 8, y: TOP + 1.5 * SP }, { x: bx - 8, y: TOP + 3.5 * SP }); }
  if (barre) items.push({ str: barre, x: X0 + 12, y: TOP - 14, w: 20, size: 9 });
  items.push({ str: 'IN MY LIFE', x: 230, y: 40, w: 120, size: 20 }, { str: 'John Lennon', x: 470, y: 70, w: 80, size: 10 });
  return { w: 595, h: 842, items, segs, dots };
}
const trip = (a, b, c) => [[[6, 0], [1, a]], [[2, 0]], [[3, 0]], [[1, b]], [[2, 0]], [[3, 0]], [[1, c]], [[2, 0]], [[3, 0]]];

test('drawn tab: 6 lines found (5-line staff ignored), strings by height, columns, even triplets in 3/4', () => {
  const pg = page({ bars: [trip(7, 7, 7), trip(7, 5, 3)] });
  const st = findStaves(pg.segs);
  assert.equal(st.length, 1); assert.ok(Math.abs(st[0].sp - SP) < 0.01);
  const r = pdfToTabText([pg]);
  assert.equal(r.sig, '3/4'); assert.equal(r.bars, 2); assert.equal(r.title, 'IN MY LIFE'); assert.equal(r.composer, 'John Lennon');
  const j = parseTabText(r.text);
  assert.deepEqual(j.bars[1].notes.filter((n) => n.s === 1).map((n) => [n.f, n.start]), [[7, 0], [5, 1], [3, 2]]);
  assert.deepEqual(j.bars[0].notes.filter((n) => n.s === 2).map((n) => n.start), [0.333, 1.333, 2.333]);
  assert.deepEqual(j.unsure, []);
});

test('drawn tab: repeat dots, barre label, empty strip skipped, rest at bar end', () => {
  const short = [[[6, 0], [1, 0]], [[2, 0]], [[3, 1]], [[1, 0]], [[2, 0]], [[3, 1]]]; short.rest = true;
  const r = pdfToTabText([page({ bars: [trip(12, 12, 12), trip(8, 7, 5), short], repeatAfter: 0, barre: 'BVII', gap: true })]);
  const j = parseTabText(r.text);
  assert.equal(j.bars.length, 3); // prazno mesto posle prvog takta nije takt
  assert.equal(j.bars[0].repeatEnd, true); assert.deepEqual(j.bars[0].barre.map((b) => b.fret), [7]);
  assert.deepEqual(j.bars[2].notes.filter((n) => n.s === 1).map((n) => n.start), [0, 1]); // 6 osmina-triola pa pauza
  assert.deepEqual(r.uneven, [3]);
});

test('ASCII tab (e|--7--|): bars split at |, position = column, two-digit frets, repeats', () => {
  const txt = `Romance
e|-7--------7--------7--------|-12-------10-------8--------:|
B|----0--------0--------0-----|----0--------0--------0-----:|
G|-------0--------0--------0--|-------0--------0--------0--:|
D|----------------------------|----------------------------:|
A|----------------------------|----------------------------:|
E|-0--------------------------|-0--------------------------:|`;
  const bars = asciiTabBars(txt);
  assert.equal(bars.length, 2); assert.equal(bars[0].cols.length, 9); assert.deepEqual(bars[1].mk, [':|']);
  const j = parseTabText(barsToText(bars, { sig: '3/4' }).text);
  assert.deepEqual(j.bars[1].notes.filter((n) => n.s === 1).map((n) => [n.f, n.start]), [[12, 0], [10, 1], [8, 2]]);
  assert.equal(j.bars[1].repeatEnd, true);
  assert.deepEqual(asciiTabBars('nema tablature\nAm C G'), []);
});

test('chords over lyrics: text rebuilt by position, header/footer dropped, sections kept', () => {
  const it = (str, x, y, size = 10.5) => ({ str, x, y, w: str.length * 6.3, size });
  const L = 40;
  const items = [it('Ispod Prozora', 200, 40, 20), it('Test Bend  ·  Tonalitet: Am', L, 60),
    it('Strofa 1', L, 100), it('Am', L, 115), it('C', L + 12 * 6.3, 115), it('G', L + 25 * 6.3, 115),
    it('Kad bi znala koliko te volim', L, 128), it('F', L, 141), it('E7', L + 15 * 6.3, 141), it('pevao bih ti svake noći', L, 154),
    it('Ispod Prozora — 1/1', 300, 800)];
  const pg = { w: 595, h: 842, items, segs: [], dots: [] };
  assert.equal(pdfToTabText([pg]), null);
  const r = pdfChordText([pg], isChordLine);
  assert.equal(r.title, 'Ispod Prozora'); assert.equal(r.artist, 'Test Bend');
  const secs = textToSections(r.text);
  assert.equal(secs[0].name, 'Strofa 1');
  assert.deepEqual(secs[0].lines[0].chords.map((c) => [c.chord, c.position]), [['Am', 0], ['C', 12], ['G', 25]]);
  assert.equal(secs[0].lines[1].text, 'pevao bih ti svake noći');
  assert.ok(!/1\/1/.test(r.text));
  assert.equal(pdfChordText([{ w: 1, h: 1, items: [it('Samo tekst bez akorda', L, 100)], segs: [], dots: [] }], isChordLine), null);
});

test('touching text pieces are joined without extra spaces', () => {
  const it = (str, x) => ({ str, x, y: 100, w: str.length * 6.32, size: 10.5 });
  assert.equal(pdfToPlainText([{ items: [it('e|-', 45.35), it('7', 64.32), it('--------', 70.64), it('7', 121.21)] }]), 'e|-7--------7');
});
