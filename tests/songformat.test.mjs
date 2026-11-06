import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textToSections, sectionsToText, transposeSong, parseSharedFile, toSharedFile, songChords, progressionSummary, SongFormatError } from '../src/songformat.js';

const TEXT = `[Strofa 1]
Am        F
Pevam ti pesmu
C         G
ispod tvog prozora

[Refren]
Em   Hm
Šta ćeš, đače, žalim`;

test('tekst <-> sekcije (povratno)', () => {
  const s = textToSections(TEXT);
  assert.equal(s.length, 2);
  assert.equal(s[0].name, 'Strofa 1');
  assert.deepEqual(s[0].lines[0].chords, [{ chord: 'Am', position: 0 }, { chord: 'F', position: 10 }]);
  assert.equal(s[1].lines[0].text, 'Šta ćeš, đače, žalim');
  assert.equal(sectionsToText(s), TEXT);
});

test('akordi, progresija, transpozicija', () => {
  const song = { title: 'T', sections: textToSections(TEXT) };
  assert.deepEqual(songChords(song), ['Am', 'F', 'C', 'G', 'Em', 'Hm']);
  assert.deepEqual(progressionSummary(song)[0].chords, ['Am', 'F', 'C', 'G']);
  const t = transposeSong(song, 2);
  assert.deepEqual(songChords(t), ['Hm', 'G', 'D', 'A', 'F#m', 'C#m']);
  assert.deepEqual(songChords(transposeSong(song, 1)), ['Bbm', 'Gb', 'Db', 'Ab', 'Fm', 'Cm']);
});

test('deljeni fajl: izvoz i uvoz', () => {
  const song = { title: 'Pesma č', artist: 'X', key: 'Am', sections: textToSections(TEXT), transpose: 2 };
  const back = parseSharedFile(toSharedFile(song));
  assert.equal(back.title, 'Pesma č');
  assert.equal(back.transpose, 2);
  assert.deepEqual(back.sections, song.sections);
});

test('neispravan fajl daje poruku na srpskom', () => {
  assert.throws(() => parseSharedFile('nije json'), SongFormatError);
  assert.throws(() => parseSharedFile('{"a":1}'), SongFormatError);
  assert.throws(() => parseSharedFile('{"app":"drugo","song":{"sections":[]}}'), SongFormatError);
  assert.throws(() => parseSharedFile('{"song":{"title":"x","sections":[]}}'), SongFormatError);
});

test('ytFound cache: kept in backup meta (ids + text only), never in shared extras', async () => {
  const { cleanYtFound, songMeta, songExtras } = await import('../src/songformat.js');
  const raw = { listen: { q: 'Ceca Zakuni se', v: [{ id: 'abcDEF12345', t: 'Snimak', c: 'Kanal', d: '3:05', thumb: 'javascript:x' }, { id: 'bad id"><', t: 'x' }] }, other: { q: 'x', v: [] } };
  assert.deepEqual(cleanYtFound(raw), { listen: { q: 'Ceca Zakuni se', v: [{ id: 'abcDEF12345', t: 'Snimak', c: 'Kanal', d: '3:05' }] } });
  assert.equal(cleanYtFound(null), null);
  assert.ok(songMeta({ ytFound: raw }).ytFound);
  assert.ok(!('ytFound' in songExtras({ ytFound: raw })));
});
