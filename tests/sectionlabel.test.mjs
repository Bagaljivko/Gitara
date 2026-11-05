import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionLabel } from '../src/sectionLabel.js';

test('section labels shown in the app language (stored text unchanged)', () => {
  const sr = (x) => sectionLabel(x, 'sr'), en = (x) => sectionLabel(x, 'en');
  assert.equal(sr('Verse 2'), 'Strofa 2'); assert.equal(sr('VERSE'), 'Strofa'); assert.equal(sr('2. strofa'), 'Strofa 2'); assert.equal(sr('Strofa II'), 'Strofa 2');
  assert.equal(sr('Chorus'), 'Refren'); assert.equal(sr('Ref.'), 'Refren'); assert.equal(sr('R:'), 'Refren'); assert.equal(sr('REFREN'), 'Refren');
  assert.equal(sr('Pre-chorus'), 'Pre-refren'); assert.equal(sr('Prechorus'), 'Pre-refren');
  assert.equal(sr('Intro'), 'Uvod'); assert.equal(sr('Bridge'), 'Most'); assert.equal(sr('Solo'), 'Solo'); assert.equal(sr('Instrumental'), 'Instrumental'); assert.equal(sr('Outro'), 'Kraj');
  assert.equal(en('Uvod'), 'Intro'); assert.equal(en('Strofa 1'), 'Verse 1'); assert.equal(en('Pre-refren'), 'Pre-chorus'); assert.equal(en('Refren'), 'Chorus');
  assert.equal(en('Most'), 'Bridge'); assert.equal(en('Kraj'), 'Outro'); assert.equal(en('3. strofa'), 'Verse 3');
  assert.equal(sr('Gitarski deo kod Mileta'), 'Gitarski deo kod Mileta'); // nepoznato ostaje
  assert.equal(sr(''), '');
});
