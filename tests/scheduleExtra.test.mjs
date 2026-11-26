// v2.5.4 (Mile): stalni termin ostaje kad se doda dodatni čas; drugi stalni termin; otkazivanje jednog ne dira drugi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
const S = await import('../src/schedule.js');
const DAY = 864e5, mon = new Date(2026, 10, 23).getTime(); // ponedeljak
const base = () => ({ id: 'a', slot: { dow: 0, hm: '20:00', dur: 45, every: 1, from: mon - 7 * DAY, off: {}, moved: {} } });
const hm = (o) => { const d = new Date(o.ts); return `${d.getDay()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

test('dodatni čas se pojavi, stalni termin ostaje', () => {
  const st = { ...base(), extra: [{ ts: new Date(2026, 10, 26, 18, 0).getTime(), dur: 45 }] };
  const o = S.occurrences(st, mon, mon + 7 * DAY);
  assert.deepEqual(o.map(hm), ['1 20:00', '4 18:00']);
  assert.ok(o[0].slot && !o[0].extra && o[1].extra);
  // sledeće nedelje samo stalni
  assert.deepEqual(S.occurrences(st, mon + 7 * DAY, mon + 14 * DAY).map(hm), ['1 20:00']);
});

test('drugi stalni termin: oba svake nedelje, različiti ključevi', () => {
  const st = { ...base(), slots2: [{ dow: 3, hm: '18:00', dur: 60, every: 1, from: mon - 7 * DAY, off: {}, moved: {} }] };
  const o = S.occurrences(st, mon, mon + 14 * DAY);
  assert.deepEqual(o.map(hm), ['1 20:00', '4 18:00', '1 20:00', '4 18:00']);
  assert.equal(new Set(o.map((x) => x.key)).size, 4);
  assert.equal(o[1].dur, 60);
});

test('otkazan stalni čas istog dana ne briše dodatni', () => {
  const st = { ...base(), extra: [{ ts: new Date(2026, 10, 23, 17, 0).getTime(), dur: 45 }] };
  st.slot.off[S.dkey(mon)] = 1;
  const o = S.occurrences(st, mon, mon + 7 * DAY);
  assert.deepEqual(o.map(hm), ['1 17:00']);
  assert.ok(o[0].extra);
});

test('sledeći čas uzima i dodatni', () => {
  const now = new Date(2026, 10, 24, 12, 0).getTime();
  const x = new Date(2026, 10, 26, 18, 0).getTime();
  assert.equal(S.nextOf({ ...base(), extra: [{ ts: x, dur: 45 }] }, now), x);
  assert.equal(new Date(S.nextOf(base(), now)).getDay(), 1);
});
