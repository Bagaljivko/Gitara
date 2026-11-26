// v2.4.35: sa lista akorada (PDF) i ono što je nacrtano — hvatovi iz dijagrama, ritam iz strelica, saveti → vežbe.
// Izmišljen list (koordinate kao što ih daje readPdf), bez tuđeg sadržaja.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sheetShapes, sheetStrum, sheetExtras, sheetVideos } from '../src/sheetExtras.js';
import { matchVoicing, getVoicings } from '../src/chords.js';
import { sheetTips } from '../src/songPath.js';
import { textToSections, cleanYoutubeUrl } from '../src/songformat.js';
import { chordTimeline } from '../src/songPlay.js';

const SS = 14, FS = 17;
const it = (str, x, y, size = 7.5) => ({ str, x, y, size, w: size * 0.55 * str.length });
/** Dijagram: naziv, mreža (6 žica, 4 praga), brojevi prstiju na (žica, prag), × iznad prigušenih. */
function diagram(name, x0, top, frets, fingers) {
  const items = [it(name, x0 + 2.5 * SS - 6, top - 24, 15)], segs = [];
  for (let s = 0; s < 6; s++) segs.push({ x0: x0 + s * SS, y0: top, x1: x0 + s * SS, y1: top + 4 * FS });
  for (let f = 1; f <= 4; f++) segs.push({ x0, y0: top + f * FS, x1: x0 + 5 * SS, y1: top + f * FS });
  frets.forEach((f, s) => {
    const x = x0 + s * SS;
    if (f > 0) { const n = String(fingers[s]); const w = 7.5 * 0.55; items.push({ str: n, x: x - w / 2, y: top + (f - 0.5) * FS, size: 7.5, w }); }
    if (f < 0) segs.push({ x0: x - 3, y0: top - 6, x1: x + 3, y1: top - 12 }, { x0: x - 3, y0: top - 12, x1: x + 3, y1: top - 6 });
  });
  return { items, segs };
}
/** Ritam: „STRUM“, strelice (drška + vrh) iznad oznaka; '-' = drška bez vrha (pauza). */
function strum(labels, dirs, y = 600) {
  const items = [it('STRUM', 52, y - 56, 8.5)], segs = [];
  labels.forEach((l, k) => {
    const x = 160 + k * 44, w = 7.5 * 0.55;
    items.push({ str: l, x: x - w / 2, y, size: 7.5, w });
    const d = dirs[k]; if (!d) return;
    segs.push({ x0: x, y0: y - 37, x1: x, y1: y - 15 });
    if (d === 'D') segs.push({ x0: x - 5, y0: y - 20, x1: x, y1: y - 13 }, { x0: x, y0: y - 13, x1: x + 5, y1: y - 20 });
    if (d === 'U') segs.push({ x0: x - 5, y0: y - 32, x1: x, y1: y - 39 }, { x0: x, y0: y - 39, x1: x + 5, y1: y - 32 });
  });
  items.push(it('The Campfire strum, easy and even. One go per chord box.', 150, y + 20, 9.5));
  return { items, segs };
}
const merge = (...ps) => ({ items: ps.flatMap((p) => p.items), segs: ps.flatMap((p) => p.segs) });

test('dijagrami: prsti i × → hvat sa lista; poznat drugi hvat se bira po pragovima', () => {
  const page = merge(diagram('G', 80, 270, [3, 2, 0, 0, 3, 3], [2, 1, 0, 0, 3, 4]), diagram('Fmaj7', 220, 270, [-1, 3, 3, 2, 1, 0], [0, 3, 4, 2, 1, 0]), diagram('Am', 360, 270, [-1, 0, 2, 2, 1, 0], [0, 0, 2, 3, 1, 0]));
  const sh = sheetShapes(page);
  assert.deepEqual(sh.G.frets, [3, 2, 0, 0, 3, 3]);
  assert.deepEqual(sh.G.fingers, [2, 1, 0, 0, 3, 4]);
  assert.deepEqual(sh.Fmaj7.frets, [-1, 3, 3, 2, 1, 0]);
  assert.deepEqual(sh.Am.frets, [-1, 0, 2, 2, 1, 0]);
  // G sa 3. pragom na h žici i Fmaj7 sa basom C su u biblioteci (na kraju — postojeći redosled ostaje)
  const gi = matchVoicing('G', sh.G.frets), fi = matchVoicing('Fmaj7', sh.Fmaj7.frets);
  assert.ok(gi > 0 && getVoicings('G')[gi].alt, 'G 320033');
  assert.ok(fi > 0 && getVoicings('Fmaj7')[fi].alt, 'Fmaj7 x33210');
  assert.equal(getVoicings('G')[0].frets.join(''), '320003', 'podrazumevani G se ne menja');
  assert.equal(matchVoicing('Am', sh.Am.frets), 0);
});

test('ritam: strelice iznad „1 2 & 3 & 4 &“ → obrazac (pauza = crtica), naziv iz rečenice', () => {
  const r = sheetStrum(strum(['1', '2', '&', '3', '&', '4', '&'], ['D', 'D', 'U', '-', 'U', 'D', 'U']));
  assert.deepEqual(r, { sig: '4/4', steps: 'D-DU-UDU', name: 'Campfire strum' });
  const r2 = sheetStrum(strum(['1', '&', '2', '&', '3', '&'], ['D', null, 'D', 'U', 'D', 'U']));
  assert.equal(r2.sig, '3/4'); assert.equal(r2.steps, 'D-DUDU');
  assert.equal(sheetStrum({ items: [it('Nema ritma', 10, 10)], segs: [] }), null);
  const all = sheetExtras([merge(diagram('D', 80, 270, [-1, -1, 0, 2, 3, 2], [0, 0, 0, 1, 3, 2]), strum(['1', '2', '3', '4'], ['D', 'D', 'D', 'D']))]);
  assert.deepEqual(all.shapes.D.frets, [-1, -1, 0, 2, 3, 2]); assert.equal(all.strum.steps, 'D-D-D-D-');
});

test('saveti sa lista → vežba (niz) i promena („posle“)', () => {
  const song = { sections: textToSections(`[Strofa]
G      C      D

[Beleške]
Watch out for: 1. A slow start. Take your time. 2. The D in the verse. It comes in quick after the C. 3. Strumming too hard.
Practise this: The verse on its own: G, C, Em, D, round and round until it feels easy.`) };
  const tp = sheetTips(song);
  assert.deepEqual(tp.practice, [{ ch: ['G', 'C', 'Em', 'D'], label: 'The verse on its own' }]);
  assert.deepEqual(tp.pairs, [{ a: 'C', b: 'D' }]);
  assert.deepEqual(sheetTips({ sections: textToSections('[Strofa]\nG C') }), { practice: [], pairs: [] });
});

test('kućica na listu = jedan prolaz ritma (red samo sa akordima: takt po akordu)', () => {
  const song = { sections: textToSections('[Refren]\nD      G      E7      D'), strum: { id: 'folk', sig: '4/4', steps: 'D-DU-UDU' } };
  const tl = chordTimeline(song);
  assert.deepEqual(tl.segs.map((s) => s.len), [4, 4, 4, 4]);
  assert.equal(tl.events.filter((e) => e.chord === 'G').length, 6, 'ceo obrazac na jedan akord');
});

test('YouTube sa lista: klikabilan ili ispisan link → lekcija ili snimak za Uz video (po tekstu oko linka)', () => {
  const page = { items: [it('Watch', 52, 700), it('Learn it with me in the video.', 52, 712), it('Play along with the record: youtu.be/RECORDabc12', 300, 760)], links: [{ url: 'https://www.youtube.com/watch?v=LESSONabc12', x: 80, y: 705 }, { url: 'https://example.com/x', x: 1, y: 1 }] };
  const v = sheetVideos([page], cleanYoutubeUrl);
  assert.match(v.tutorial, /LESSONabc12/);
  assert.match(v.listen, /RECORDabc12/);
  assert.deepEqual(sheetVideos([{ items: [it('bez linka', 1, 1)], links: [] }], cleanYoutubeUrl), {});
  // jedan link bez objašnjenja = lekcija
  assert.match(sheetVideos([{ items: [it('https://youtu.be/ONLYone1234', 1, 1)] }], cleanYoutubeUrl).tutorial, /ONLYone1234/);
});
