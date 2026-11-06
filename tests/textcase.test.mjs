import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixCaps } from '../src/textCase.js';

test('all-caps titles and names become normal case', () => {
  assert.equal(fixCaps('IN MY LIFE'), 'In My Life');
  assert.equal(fixCaps('ROMANCE D\'AMOUR'), 'Romance D\'Amour');
  assert.equal(fixCaps('JOHN LENNON AND PAUL McCARTNEY'), 'JOHN LENNON AND PAUL McCARTNEY'); // has small letters: untouched
  assert.equal(fixCaps('JOHN LENNON AND PAUL MCCARTNEY'), 'John Lennon and Paul Mccartney');
  assert.equal(fixCaps('THE SOUND OF SILENCE'), 'The Sound of Silence');
  assert.equal(fixCaps('SONATA NO. IV'), 'Sonata No. IV');
  assert.equal(fixCaps('ĐURĐEVDAN JE A JA NISAM S ONOM'), 'Đurđevdan Je a Ja Nisam S Onom');
  assert.equal(fixCaps('LET IT BE (LIVE)'), 'Let It Be (Live)');
  assert.equal(fixCaps('I WILL SURVIVE'), 'I Will Survive');
  assert.equal(fixCaps('ROCK-AND-ROLL MUSIC'), 'Rock-And-Roll Music');
});

test('normal text, short acronyms and empty values stay as they are', () => {
  for (const s of ['In My Life', 'Romance D\'Amour', 'AC/DC', 'ABBA', 'U2', '', 'Trad.', 'F. Tárrega']) assert.equal(fixCaps(s), s);
  assert.equal(fixCaps(undefined), undefined);
});

test('Serbian Latin alphabetical order: C Č Ć, D Dž Đ, L Lj, S Š, Z Ž; numbers naturally', async () => {
  const { srCompare } = await import('../src/collate.js');
  const w = ['Zora', 'Žar', 'Šuma', 'Sunce', 'Čaša', 'Cvet', 'Ćup', 'Dan', 'Đak', 'Džep', 'Ljubav', 'Lom'];
  assert.deepEqual([...w].sort(srCompare), ['Cvet', 'Čaša', 'Ćup', 'Dan', 'Džep', 'Đak', 'Lom', 'Ljubav', 'Sunce', 'Šuma', 'Zora', 'Žar']);
  assert.deepEqual(['Pesma 10', 'Pesma 2', 'pesma 1'].sort(srCompare), ['pesma 1', 'Pesma 2', 'Pesma 10']);
  assert.equal(srCompare(null, ''), 0);
});
