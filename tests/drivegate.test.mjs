import test from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const G = await import('../src/driveGate.js');

test('isRate: samo „uspori“, ne pun Drive', () => {
  assert.equal(G.isRate(403, 'rateLimitExceeded'), true);
  assert.equal(G.isRate(403, 'userRateLimitExceeded'), true);
  assert.equal(G.isRate(429, ''), true);
  assert.equal(G.isRate(403, 'storageQuotaExceeded'), false);
  assert.equal(G.isRate(403, 'forbidden'), false);
  assert.equal(G.isRate(404, ''), false);
});
test('pauza raste i smanjuje se posle uspeha', () => {
  store.clear(); const now = 1e12;
  assert.equal(G.cooling(now), false);
  const a = G.noteRate(now); assert.ok(a >= 50000 && a <= 70000, String(a));
  assert.ok(G.cooling(now + 1000));
  const b = G.noteRate(now); assert.ok(b > a * 1.4, `${a} ${b}`);
  G.noteOk(); assert.equal(G.cooling(now + 1000), false);
  for (let i = 0; i < 12; i++) G.noteRate(now);
  assert.ok(G.coolLeft(now) <= 15 * 60000 * 1.15);
});
test('ranRecently / markRan', () => {
  store.clear(); G.markRan('box', 1000);
  assert.equal(G.ranRecently('box', 5000, 3000), true);
  assert.equal(G.ranRecently('box', 5000, 7000), false);
});
