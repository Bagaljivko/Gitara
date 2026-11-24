import test from 'node:test';
import assert from 'node:assert/strict';
import { streakOf, SHIELD_EVERY } from '../src/streak.js';
const run = (from, n, ms = 600000) => Object.fromEntries(Array.from({ length: n }, (_, i) => [from + i, ms]));

test('prazno i jedan dan', () => {
  assert.equal(streakOf({}, 100).streak, 0);
  assert.deepEqual(streakOf({ 100: 1 }, 100), { streak: 1, shields: 0, saved: [], best: 1, todayDone: true });
});
test('danas još nije vežbano — niz traje', () => {
  const r = streakOf(run(95, 5), 100); // 95..99, danas 100
  assert.equal(r.streak, 5); assert.equal(r.todayDone, false);
});
test('bez štita: propušten dan prekida niz', () => {
  const d = { ...run(90, 3), ...run(94, 2) }; // 93 propušten
  assert.equal(streakOf(d, 95).streak, 2);
  assert.equal(streakOf(d, 95).best, 3);
});
test('7 dana = štit; jedan propušten dan pojede štit, niz traje', () => {
  const d = { ...run(80, SHIELD_EVERY), ...run(88, 3) }; // 80..86, 87 propušten, 88..90
  const r = streakOf(d, 90);
  assert.equal(r.streak, 10); assert.equal(r.shields, 0); assert.deepEqual(r.saved, [87]);
});
test('najviše 2 štita; dva propuštena dana pokrivena', () => {
  const d = { ...run(50, 21), ...run(73, 1) }; // 50..70 (3×7 → 2 štita), 71 i 72 propušteni
  const r = streakOf(d, 73);
  assert.equal(r.streak, 22); assert.equal(r.shields, 0); assert.deepEqual(r.saved, [71, 72]);
});
test('tri propuštena dana — štitovi ne pomažu', () => {
  const d = { ...run(50, 21), ...run(74, 1) };
  assert.equal(streakOf(d, 74).streak, 1);
});
test('juče propušteno, danas nije kraj dana — štit čuva niz', () => {
  const d = run(80, 7); // 80..86, 87 propušten, danas 88
  const r = streakOf(d, 88);
  assert.equal(r.streak, 7); assert.equal(r.shields, 0); assert.deepEqual(r.saved, [87]);
});
test('prekinut niz bez štita (dva dana pauze do danas)', () => {
  assert.equal(streakOf(run(80, 3), 85).streak, 0);
});
