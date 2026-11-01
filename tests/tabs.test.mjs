import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAsciiTab, tabToAscii, isTabLine, cleanTab, noteAt, noteCol } from '../src/tabs.js';

const ASCII = [
  'e|-----0-----|---------3-|',
  'B|---1---1---|-------3---|',
  'G|-2-------2-|-----0-----|',
  'D|-----------|---0-------|',
  'A|3----------|-2---------|',
  'E|-----------|3--------x-|',
];

test('detects tab lines but not lyrics or chord lines', () => {
  assert.ok(ASCII.every(isTabLine));
  assert.ok(isTabLine('|---7h9---|'));
  assert.ok(!isTabLine('Am        F'));
  assert.ok(!isTabLine('Pevam ti pesmu - tiho'));
});

test('parses ASCII tab into bars and notes, and writes it back unchanged', () => {
  const tab = parseAsciiTab(ASCII, '4/4');
  assert.equal(tab.bars.length, 2);
  assert.equal(tab.bars[0].w, 11);
  assert.deepEqual(tab.bars[0].notes[0], { s: 5, f: '3', p: 0 });
  assert.ok(tab.bars[1].notes.some((n) => n.s === 6 && n.f === 'x'));
  assert.deepEqual(tabToAscii(tab), ASCII);
});

test('multi-digit frets and techniques', () => {
  const t = parseAsciiTab(['e|--12--|', 'B|------|', 'G|-5h7--|', 'D|------|', 'A|------|', 'E|------|']);
  assert.deepEqual(t.bars[0].notes.find((n) => n.s === 1), { s: 1, f: '12', p: 2 });
  assert.deepEqual(t.bars[0].notes.find((n) => n.s === 3 && n.f === '5'), { s: 3, f: '5', p: 1, t: 'h' });
  assert.deepEqual(tabToAscii(t), ['e|--12--|', 'B|------|', 'G|-5h7--|', 'D|------|', 'A|------|', 'E|------|']);
});

test('note lookup by absolute column (used for uncertain frets)', () => {
  const tab = parseAsciiTab(ASCII);
  const col = noteCol(tab, 1, 9);
  assert.equal(noteAt(tab, 1, col).f, '3');
});

test('cleanTab rejects invalid data', () => {
  assert.equal(cleanTab({ bars: [] }), null);
  assert.equal(cleanTab({ bars: [{ w: 4, notes: [{ s: 9, f: '1', p: 0 }] }] }), null);
  const ok = cleanTab({ sig: '3/4', bars: [{ w: 4, notes: [{ s: 1, f: '30', p: 0 }, { s: 2, f: '5', p: 1, t: 'h' }] }] });
  assert.deepEqual(ok, { sig: '3/4', bars: [{ w: 4, notes: [{ s: 2, f: '5', p: 1, t: 'h' }] }] });
});
