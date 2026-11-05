import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPaper } from '../src/gemini.js';

// sintetička fotografija: tamni sto, svetao list (sa tamnim „brojevima“) u sredini
function photo(W, H, box, { table = 60, paper = 210 } = {}) {
  const lum = new Uint8Array(W * H).fill(table);
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) lum[y * W + x] = (x * 7 + y * 3) % 23 === 0 ? 30 : paper;
  return lum;
}

test('paper on a table is found and cropped with a small margin', () => {
  const W = 200, H = 260, r = findPaper(photo(W, H, { x: 30, y: 40, w: 140, h: 190 }, { table: 100 }), W, H);
  assert.ok(r && !r.dark);
  assert.ok(Math.abs(r.x - 30 / W + 0.015) < 0.02 && Math.abs(r.y - 40 / H + 0.015) < 0.02);
  assert.ok(Math.abs(r.w - 140 / W - 0.03) < 0.03 && Math.abs(r.h - 190 / H - 0.03) < 0.03);
});

test('whole photo is paper (screenshot / scan) → no crop; tiny paper → no crop; dark photo → dark', () => {
  const W = 120, H = 160;
  assert.equal(findPaper(photo(W, H, { x: 0, y: 0, w: W, h: H }), W, H), null);
  assert.equal(findPaper(photo(W, H, { x: 50, y: 60, w: 20, h: 30 }, { table: 120 }), W, H), null);
  assert.deepEqual(findPaper(new Uint8Array(W * H).fill(40), W, H), { dark: true });
});
