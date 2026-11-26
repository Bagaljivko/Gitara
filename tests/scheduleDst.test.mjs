// v2.5.64: Raspored posle promene vremena (Evropa, 25. 10. 2026) — ponedeljak je ponedeljak, čas ostaje u 17:00.
process.env.TZ = 'Europe/Belgrade';
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
const S = await import('../src/schedule.js');

test('ponedeljak nedelje posle promene vremena', () => {
  const m = new Date(S.monday(new Date(2026, 9, 28, 12).getTime())); // sreda 28. 10.
  assert.deepEqual([m.getDate(), m.getMonth() + 1, m.getDay(), m.getHours()], [26, 10, 1, 0]);
  const m2 = new Date(S.monday(new Date(2026, 2, 31, 9).getTime())); // posle prelaska na letnje (29. 3.)
  assert.deepEqual([m2.getDate(), m2.getMonth() + 1, m2.getDay()], [30, 3, 1]);
});
test('nedeljni čas ostaje u isto vreme preko promene vremena', () => {
  const st = { id: 's', slot: { dow: 0, hm: '17:00', dur: 45, every: 1, from: new Date(2026, 9, 1).getTime(), off: {}, moved: {} } };
  const occ = S.occurrences(st, new Date(2026, 9, 15).getTime(), new Date(2026, 10, 10).getTime());
  assert.ok(occ.length >= 3);
  for (const o of occ) { const d = new Date(o.ts); assert.deepEqual([d.getDay(), d.getHours(), d.getMinutes()], [1, 17, 0]); }
});
