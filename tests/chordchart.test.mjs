// v2.4.33: PDF „lista akorada“ (delovi sa kućicama akorada, ×N, redosled, kapodaster, saveti u dve kolone) i lakši barré hvatovi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chordChartFromLines } from '../src/chordChart.js';
import { isChordLine, textToSections } from '../src/songformat.js';
import { getVoicings, easyIndex, isBarre } from '../src/chords.js';

const CHART = `THE SONG PATH  LEVEL 2                                                    Song 3 of 10
Sunny Road
                                                                          Capo 2nd fret
Some Band                                                                 Standard tuning

CHORDS
            G                        C                        D
     E  A  D  G  B  e          E A  D  G  B  e          E  A  D  G  B  e

WATCH OUT FOR                                          PRACTISE THIS
1. The change to D. It comes in quick                  The verse on its own, slowly,
after the C.                                           until it feels easy.

THE SONG

INTRO
                      G             C            D                                        ×2

VERSE
                      G             C             G             D

                      Em            C             D

CHORUS
                    C             G             D             ×3

THE PLAY THROUGH

   Intro    Verse     Chorus     Verse    Chorus
`;
const isTok = (t) => isChordLine(t);

test('lista akorada: delovi redom, ponavljanja, kapodaster, saveti', () => {
  const r = chordChartFromLines(CHART.split('\n'), isTok);
  assert.ok(r, 'treba da prepozna listu akorada');
  assert.equal(r.capo, 2);
  assert.equal(r.order, true);
  const names = r.text.split('\n').filter((l) => /^\[/.test(l));
  assert.deepEqual(names, ['[Intro]', '[Verse 1]', '[Chorus 1]', '[Verse 2]', '[Chorus 2]', '[Beleške]']);
  const intro = r.text.split('[Verse 1]')[0].split('\n').filter((l) => l.trim() && !/^\[/.test(l));
  assert.equal(intro.length, 2, 'Intro ×2');
  const chorus = r.text.split('[Chorus 1]')[1].split('[Verse 2]')[0].split('\n').filter((l) => l.trim());
  assert.equal(chorus.length, 3, 'Chorus ×3');
  assert.match(r.text, /Watch out for: 1\. The change to D\. It comes in quick after the C\./);
  assert.match(r.text, /Practise this: The verse on its own, slowly, until it feels easy\./);
  const secs = textToSections(r.text);
  const verse = secs.find((s) => /verse 1/i.test(s.name));
  assert.deepEqual(verse.lines.map((l) => l.chords.map((c) => c.chord).join(' ')), ['G C G D', 'Em C D']);
});

test('obična pesma sa tekstom nije lista akorada', () => {
  const song = '[Verse]\nG       C\nThis is a line of the song text\nD          G\nAnother line of lyrics here\n[Chorus]\nC   D\nSinging along the chorus line\n';
  assert.equal(chordChartFromLines(song.split('\n'), isTok), null);
});

test('lakši hvat za barré akorde (poslednji, ne menja podrazumevani)', () => {
  for (const [c, frets] of [['F', '-1,-1,3,2,1,1'], ['Bm', '-1,-1,4,4,3,2'], ['Bb', '-1,-1,3,3,3,1'], ['F#m', '-1,-1,4,2,2,2'], ['Fm', '-1,-1,3,1,1,1']]) {
    assert.ok(isBarre(c), c + ' je barré');
    const i = easyIndex(c); assert.ok(i > 0, c + ': lakši hvat postoji i nije prvi');
    assert.equal(getVoicings(c)[i].frets.join(','), frets, c);
    assert.ok(getVoicings(c)[0].barre, c + ': prvi hvat ostaje pun barré');
  }
  assert.equal(easyIndex('G'), -1); assert.equal(isBarre('G'), false);
});
