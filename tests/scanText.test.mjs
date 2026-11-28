import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScanText, parseChordLine } from '../src/scanText.js';

test('chord line: positions are exact, chords mid-word and after the end', () => {
  const r = parseChordLine('[G]Zakuni se lju[Em]bavi na [D]ranjenu noć [C]');
  assert.equal(r.text, 'Zakuni se ljubavi na ranjenu noć');
  assert.deepEqual(r.chords, [{ chord: 'G', position: 0 }, { chord: 'Em', position: 13 }, { chord: 'D', position: 21 }, { chord: 'C', position: 33 }]);
});
test('chord-only line, Serbian names (H, Fis, Es, D/Fis), uncertain chord and word', () => {
  const a = parseChordLine('[Am] [D/Fis] [H7] [Es]');
  assert.equal(a.text, '');
  assert.deepEqual(a.chords.map((c) => c.chord), ['Am', 'D/Fis', 'H7', 'Es']);
  assert.ok(a.chords.every((c, i) => i === 0 || c.position > a.chords[i - 1].position + a.chords[i - 1].chord.length), 'chord-only chords must not overlap');
  const b = parseChordLine('[Hm?Em]ja sam {mrak?mrav} tvoj');
  assert.equal(b.text, 'ja sam mrak tvoj');
  assert.deepEqual(b.unsure, [{ kind: 'chord', text: 'Hm', position: 0, suggestion: 'Em' }, { kind: 'word', text: 'mrak', position: 7, suggestion: 'mrav' }]);
  // [ ] koji nije akord ostaje tekst
  assert.equal(parseChordLine('[Ref.] refren').text, '[Ref.] refren');
});
test('whole answer → same shape as the JSON scan (title, key, sections, strum, tab, uncertain)', () => {
  const j = parseScanText(`NASLOV: Zakuni se ljubavi
IZVOĐAČ: S. Krila
TONALITET: G
VRSTA: akordi
RITAM: D-DU-UDU 4/4
# Strofa 1
[G]Zakuni se ljubavi na [D]ranjenu noć
[D]Zakuni se ljubavi u tre[G]nutku ton

# Refren
RITAM: D-D- 4/4
[D]Ako tražiš mir uz mene ga [G]nađi
TAB:
e|-----0-----|
B|---1---1---|
G|-2-------2-|
D|-----------|
A|-----------|
E|-----------|
TAKT: 3/4
[Hm?Em]kraj`);
  assert.equal(j.title, 'Zakuni se ljubavi'); assert.equal(j.artist, 'S. Krila'); assert.equal(j.key, 'G'); assert.equal(j.sheetKind, 'akordi');
  assert.deepEqual(j.strum, { steps: 'D-DU-UDU', sig: '4/4' });
  assert.equal(j.sections.length, 2);
  assert.equal(j.sections[0].name, 'Strofa 1'); assert.equal(j.sections[0].lines.length, 2);
  assert.deepEqual(j.sections[0].lines[1].chords, [{ chord: 'D', position: 0 }, { chord: 'G', position: 23 }]);
  assert.deepEqual(j.sections[1].strum, { steps: 'D-D-', sig: '4/4' });
  assert.equal(j.sections[1].tab.split('\n').length, 6); assert.equal(j.sections[1].tabSig, '3/4');
  assert.deepEqual(j.uncertain, [{ section: 1, line: 1, kind: 'chord', text: 'Hm', position: 0, suggestion: 'Em' }]);
});
test('not this format → null (the app then asks the old JSON way)', () => {
  assert.equal(parseScanText(''), null);
  assert.equal(parseScanText('{ "title": "x", "sections": [] }'), null);
  assert.equal(parseScanText('Ne mogu da pročitam sliku.'), null);
  assert.equal(parseScanText('VRSTA: tab\n# Uvod\nTAB:\ne|-0-|\nB|-1-|\nG|-0-|\nD|-2-|\nA|-3-|\nE|---|').sheetKind, 'tab');
});
