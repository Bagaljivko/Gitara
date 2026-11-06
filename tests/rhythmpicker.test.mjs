import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage ??= { getItem() { return null; }, setItem() {} };
globalThis.document ??= { documentElement: {} };
const { PATTERNS, cleanPattern, countLabels, slotsPerBeatOf, bassOf } = await import('../src/rhythm.js');
const { parseStrumText, quantizeTaps } = await import('../src/rhythmPicker.js');
const { chordTimeline } = await import('../src/songPlay.js');
const { t } = await import('../src/i18n.js');

test('library: ~27 rhythms, ids unique, every pattern valid and named (sr + short name + group)', () => {
  assert.ok(PATTERNS.length >= 25);
  assert.equal(new Set(PATTERNS.map((p) => p.id)).size, PATTERNS.length);
  for (const p of PATTERNS) {
    const c = cleanPattern(p);
    assert.ok(c, p.id); assert.equal(c.id, p.id); assert.equal(c.steps, p.steps); assert.equal(!!c.swing, !!p.swing);
    assert.notEqual(t('pat.' + p.id), 'pat.' + p.id, p.id); assert.notEqual(t('patS.' + p.id), 'patS.' + p.id, p.id); assert.notEqual(t('rpg.' + p.g), 'rpg.' + p.g, p.g);
    assert.ok([1, 2, 3].includes(p.lv), p.id);
  }
  for (const id of ['folk', 'downs', 'eighths', 'rock', 'reggae', 'waltz', 'ballad68', 'march']) assert.ok(PATTERNS.some((p) => p.id === id), 'old id kept: ' + id);
  assert.ok(PATTERNS.some((p) => p.id === 'bossa' && p.steps.length === 16));
});

test('16ths, swing and bass: grid, counting, cleaning', () => {
  const f = PATTERNS.find((p) => p.id === 'funk16');
  assert.equal(slotsPerBeatOf(f), 4);
  assert.deepEqual(countLabels(f).slice(0, 5), ['1', '·', 'i', '·', '2']);
  assert.equal(slotsPerBeatOf({ sig: '4/4', steps: 'D-DU-UDU' }), 2);
  assert.equal(slotsPerBeatOf({ sig: '6/8', steps: 'D-UD-U' }), 1);
  assert.equal(cleanPattern({ sig: '4/4', steps: 'b-d-b-d-' }).steps, 'B-D-B-D-');
  assert.equal(cleanPattern({ sig: '4/4', steps: 'DUDUDUDU', swing: true }).swing, true);
  assert.equal(cleanPattern({ sig: '4/4', steps: 'D-DU-UDUD-DU-UDU', swing: true }).swing, undefined); // šafl samo na osminama
  assert.deepEqual(bassOf([98, 123, 147]), [98]);
});

test('typed / pasted rhythm: chord-site notation, arrows, length → time signature', () => {
  assert.deepEqual(parseStrumText('D DU UDU'), { sig: '4/4', steps: 'D-DU-UDU', fit: true });
  assert.deepEqual(parseStrumText('↓ ↓↑ ↑↓↑', '4/4'), { sig: '4/4', steps: 'D-DU-UDU', fit: true });
  assert.equal(parseStrumText('D DUDU').sig, '3/4');
  assert.equal(parseStrumText('D UD U', '6/8').sig, '6/8');
  assert.equal(parseStrumText('D DU').sig, '2/4');
  assert.deepEqual(parseStrumText('DUxUDUDUDUxUDUDU'), { sig: '4/4', steps: 'DUxUDUDUDUxUDUDU', fit: true, sixteen: true });
  assert.equal(parseStrumText('B D B D ').steps, 'B-D-B-D-'.slice(0, 7) + '-');
  const short = parseStrumText('D D U', '4/4'); assert.equal(short.steps, 'D-D-U---'); assert.equal(short.fit, false);
  assert.equal(parseStrumText('hello?'), null);
  assert.equal(parseStrumText('   '), null);
});

test('tap-in: swipes snap to the nearest eighth, majority over two bars, late/early within half a slot', () => {
  const slots = [];
  for (let bar = 0; bar < 2; bar++) for (let i = 0; i < 8; i++) slots.push({ at: 1000 + (bar * 8 + i) * 250, i, bar });
  const at = (bar, i, d = 0) => 1000 + (bar * 8 + i) * 250 + d;
  const taps = [{ at: at(0, 0, 40), dir: 'D' }, { at: at(0, 2, -60), dir: 'D' }, { at: at(0, 3, 30), dir: 'U' }, { at: at(0, 6), dir: 'D' },
    { at: at(1, 0), dir: 'D' }, { at: at(1, 2, 20), dir: 'D' }, { at: at(1, 3), dir: 'U' }, { at: at(1, 5, 100), dir: 'U' }, { at: at(1, 6), dir: 'D' }];
  assert.equal(quantizeTaps(taps, slots, 8), 'D-DU-UD-');
  assert.equal(quantizeTaps([], slots, 8), '--------');
  assert.equal(quantizeTaps([{ at: 99999, dir: 'D' }], slots, 8), '--------'); // daleko van takta: ništa
});

test('song playback: bass stroke plays only the bass note, swing delays the off-beats', () => {
  const song = { sections: [{ name: 'A', lines: [{ text: '', chords: [{ chord: 'C', position: 0 }] }] }], strum: { sig: '4/4', steps: 'B-D-B-D-' } };
  const ev = chordTimeline(song).events;
  assert.deepEqual(ev.map((e) => [e.beat, e.freqs.length === 1]), [[0, true], [1, false], [2, true], [3, false]]);
  const sw = chordTimeline({ ...song, strum: { sig: '4/4', steps: 'DUDUDUDU', swing: true } }).events.map((e) => Math.round(e.beat * 1000) / 1000);
  assert.deepEqual(sw.slice(0, 4), [0, 0.667, 1, 1.667]);
  const st = chordTimeline({ ...song, strum: { sig: '4/4', steps: 'DUDUDUDU' } }).events.map((e) => e.beat);
  assert.deepEqual(st.slice(0, 4), [0, 0.5, 1, 1.5]);
  const s16 = chordTimeline({ ...song, strum: { sig: '4/4', steps: 'D-DU-UDUD-DU-UDU' } }).events.map((e) => e.beat);
  assert.deepEqual(s16.slice(0, 3), [0, 0.5, 0.75]);
});
