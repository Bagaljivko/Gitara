import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posAt, addAnchor } from '../src/playAlong.js';
import { youtubeId, cleanYtSync, songExtras } from '../src/songformat.js';

test('bez tačaka: ravnomerno kroz ceo video', () => {
  assert.equal(posAt(0, 200), 0);
  assert.equal(posAt(100, 200), 0.5);
  assert.equal(posAt(250, 200), 1);
});

test('jedna tačka: isti ritam od mesta gde je pomereno', () => {
  const a = addAnchor([], 50, 0.4); // ravnomerno bi bilo 0.25
  assert.ok(Math.abs(posAt(50, 200, a) - 0.4) < 1e-9);
  assert.ok(Math.abs(posAt(70, 200, a) - (0.4 + 20 / 200)) < 1e-9); // ista brzina (1/200 po sekundi)
  assert.ok(Math.abs(posAt(30, 200, a) - (0.4 - 20 / 200)) < 1e-9);
});

test('dve tačke: brzina između njih, i dalje istom brzinom', () => {
  let a = addAnchor([], 40, 0.2);
  a = addAnchor(a, 100, 0.5); // 0.3 za 60 s = 0.005/s
  assert.ok(Math.abs(posAt(70, 200, a) - 0.35) < 1e-9);
  assert.ok(Math.abs(posAt(120, 200, a) - 0.6) < 1e-9);
  assert.ok(Math.abs(posAt(20, 200, a) - 0.1) < 1e-9);
});

test('nova tačka zamenjuje blisku i one koje joj protivreče', () => {
  let a = addAnchor([], 40, 0.2);
  a = addAnchor(a, 41.5, 0.25); // ±3 s → zamena
  assert.deepEqual(a, [{ t: 41.5, f: 0.25 }]);
  a = addAnchor(a, 100, 0.6);
  a = addAnchor(a, 80, 0.7); // posle nje je 100 s na 0.6 — protivreči, briše se
  assert.deepEqual(a.map((x) => x.t), [41.5, 80]);
  for (let i = 0; i < 60; i++) a = addAnchor(a, 200 + i * 5, 0.8 + i * 0.003);
  assert.ok(a.length <= 40);
});

test('YouTube ID iz raznih adresa; usklađivanje se čuva samo za povezan video', () => {
  for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3', 'https://youtu.be/dQw4w9WgXcQ?si=x', 'https://m.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ']) assert.equal(youtubeId(u), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://example.com/x'), '');
  assert.deepEqual(cleanYtSync({ v: 'dQw4w9WgXcQ', a: [[12.345, 0.5], ['x', 1], [5, 2], [3, 0.1]] }), { v: 'dQw4w9WgXcQ', a: [[3, 0.1], [12.3, 0.5]] });
  const yt = { listen: 'https://youtu.be/dQw4w9WgXcQ' };
  assert.ok(songExtras({ yt, ytSync: { v: 'dQw4w9WgXcQ', a: [[1, 0.1]] } }).ytSync);
  assert.equal(songExtras({ yt, ytSync: { v: 'aaaaaaaaaaa', a: [[1, 0.1]] } }).ytSync, undefined);
});
