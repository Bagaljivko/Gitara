// v2.4.37: serija sa lista → kurs, novi oblici lista akorada (petlja „THE SONG“, akordi nad brojanjem „1 & 2 &…“, ×N u svom
// redu, naslov dela sa napomenom), [A B] = jedan takt u reprodukciji, tekst uz postojeće akorde. Izmišljeni podaci.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chordChartFromLines, barsFromCounts, seriesFromLines } from '../src/chordChart.js';
import { isChordLine, textToSections } from '../src/songformat.js';
import { chordHalves } from '../src/songPlay.js';
import { fitLyrics, lyricBlocks, hasLyrics } from '../src/lyricsFit.js';

const isChord = (tok) => isChordLine(tok);

test('serija iz zaglavlja lista', () => {
  assert.deepEqual(seriesFromLines(['MY TEST PATH  LEVEL 2                         Song 4 of 10', 'Some Title']), { name: 'My Test Path', level: 2, n: 4, of: 10 });
  assert.equal(seriesFromLines(['Some Title', 'Capo 2nd fret']), null);
});

test('akordi nad brojanjem: dva u taktu → [A B], akord preko dva takta se ponavlja', () => {
  const ch = ' Em7                              G';
  const cn = '  1       &       2       &        3       &       4       &';
  assert.deepEqual(barsFromCounts(ch, cn, isChord), ['[Em7', 'G]']);
  const ch2 = ' G';
  const cn2 = '   1      2      &      3      &      4      &      1      2      &      3      &      4      &';
  assert.deepEqual(barsFromCounts(ch2, cn2, isChord), ['G', 'G']);
});

test('list: delovi nad brojanjem, ×N u svom redu, naslov sa napomenom', () => {
  const lines = `THE SONG
INTRO
 Em7                              G
  1       &       2       &        3       &       4       &

                                                                       ×2
 Dsus4                        Asus4
  1       &       2       &        3       &       4       &

BEFORE VERSE 2 This only happens once
 Cadd9                            Dsus4
  1       &       2       &        3       &       4       &

VERSE 2 4 times this time
 Em7                              G
  1       &       2       &        3       &       4       &`.split('\n');
  const r = chordChartFromLines(lines, isChord);
  assert.ok(r, 'pročitano');
  const secs = textToSections(r.text);
  assert.deepEqual(secs.map((s) => s.name), ['Intro', 'Before verse 2', 'Verse 2']);
  assert.equal(secs[0].lines.length, 4, 'uvod ×2 (dva reda po dva puta)');
  assert.equal(secs[2].lines.length, 4, 'strofa 4 puta');
  const l = secs[0].lines[0];
  assert.deepEqual(l.chords.map((c) => c.chord), ['Em7', 'G']);
  assert.deepEqual(chordHalves(l), [1, 1], 'Em7 i G dele jedan takt');
});

test('list: cela pesma u jednoj petlji („THE SONG“, ×2 ispod svakog akorda)', () => {
  const lines = `THE SONG

                      G             G/F#            Cadd9                G
                      ×2               ×2               ×2               ×2

           Each chord gets 2 strumming patterns. This loop repeats the whole way through.`.split('\n');
  const r = chordChartFromLines(lines, isChord);
  assert.ok(r);
  const secs = textToSections(r.text);
  assert.equal(secs.length, 1);
  assert.deepEqual(secs[0].lines[0].chords.map((c) => c.chord), ['G', 'G', 'G/F#', 'G/F#', 'Cadd9', 'Cadd9', 'G', 'G']);
});

test('tekst uz akorde: delovi teksta na delove pesme, refren ponovljen, uvod ostaje bez reči', () => {
  const song = { sections: textToSections('[Intro]\nG      C\n\n[Verse 1]\nG      C      D      G\n\n[Chorus]\nC      G\n\n[Verse 2]\nG      C      D      G\n\n[Chorus]\nC      G') };
  assert.equal(hasLyrics(song), false);
  const raw = 'Line one of the verse\nLine two goes here\n\nChorus line sing it\n\nSecond verse first line\nSecond verse ends\n\nChorus line sing it';
  const r = fitLyrics(song, raw);
  assert.equal(r.matched, 4);
  assert.equal(r.sections[0].lines[0].text, '', 'uvod bez reči');
  assert.equal(r.sections[1].lines[0].text, 'Line one of the verse');
  assert.deepEqual(r.sections[1].lines.flatMap((l) => l.chords.map((c) => c.chord)), ['G', 'C', 'D', 'G']);
  assert.equal(r.sections[2].lines[0].text, 'Chorus line sing it');
  assert.ok(hasLyrics({ sections: r.sections }));
  // oznake delova u tekstu i LRC vreme
  const b = lyricBlocks('[Chorus]\n[00:12.00] Hey hey\n[00:15.50] Ho ho');
  assert.equal(b[0].label, 'Chorus'); assert.equal(b[0].lines[1].t, 15.5);
});
