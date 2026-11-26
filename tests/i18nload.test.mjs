// v2.5.62: oba rečnika moraju da se učitaju (apostrof u engleskom tekstu je jednom prekinuo ceo fajl → meni ostao na srpskom)
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
for (const f of ['i18n.js', 'i18n-en.js', 'practiceText.js']) {
  test(`${f} se učitava`, async () => { const m = await import('../src/' + f); assert.ok(Object.keys(m).length > 0, f); });
}
