import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix, qrSVG } from '../src/qr.js';

test('QR picks the smallest version and has finder patterns in three corners', () => {
  const q = qrMatrix('https://bagaljivko.github.io/Gitara/');
  assert.equal(q.version, 3);
  assert.equal(q.size, 29);
  const finder = (ox, oy) => {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      assert.equal(q.dark(ox + x, oy + y), d !== 2, `finder at ${ox},${oy}`);
    }
  };
  finder(0, 0); finder(q.size - 7, 0); finder(0, q.size - 7);
  for (let i = 8; i < q.size - 8; i++) assert.equal(q.dark(i, 6), i % 2 === 0, 'timing row');
});

test('QR grows with longer text and rejects text that does not fit', () => {
  assert.equal(qrMatrix('x'.repeat(100)).version, 6);
  assert.equal(qrMatrix('x'.repeat(178)).version, 9);
  assert.throws(() => qrMatrix('x'.repeat(300)));
});

test('QR SVG has a white quiet zone and escapes the label', () => {
  const svg = qrSVG('A', { label: '"<x>"' });
  assert.match(svg, /viewBox="0 0 29 29"/);
  assert.match(svg, /&quot;&lt;x&gt;&quot;/);
});
