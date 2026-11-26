// v2.5.2: MARLI put (courses/index.json) — 30 pesama sa listova: svaka se čita, akordi su akordi (nema „teksta“ od
// akorada), hvatovi postoje, saveti sr/en (bez ćirilice), i „Pronađi tekst“ ne gubi nijedan akord ni u jednoj pesmi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { normalizeSong } = await import('../src/songformat.js');
const { parseChord } = await import('../src/music.js');
const { getVoicings } = await import('../src/chords.js');
const { fitLyrics } = await import('../src/lyricsFit.js');
const { PATTERNS } = await import('../src/rhythm.js');
const data = JSON.parse(readFileSync(new URL('../courses/index.json', import.meta.url), 'utf8'));
const songs = data.courses.flatMap((c) => c.songs);

test('tri nivoa po 10 pesama, stalni i jedinstveni ID-jevi', () => {
  assert.deepEqual(data.courses.map((c) => [c.id, c.songs.length]), [['marli-1', 10], ['marli-2', 10], ['marli-3', 10]]);
  const ids = songs.map((s) => s.id);
  assert.equal(new Set(ids).size, 30);
  assert.ok(ids.every((id) => /^marli-L[123]-\d\d$/.test(id)));
});

test('svaka pesma se čita, svi akordi su akordi, tonalitet postoji', () => {
  for (const s of songs) {
    const n = normalizeSong({ title: s.title, artist: s.artist, key: s.key, sections: s.sections });
    assert.ok(n.sections.length, s.id);
    assert.ok(parseChord(s.key), s.id + ' tonalitet ' + s.key);
    for (const sec of s.sections) for (const l of sec.lines) {
      assert.equal(l.text.trim(), '', `${s.id} ${sec.name}: red akorada pročitan kao tekst „${l.text}“`);
      for (const c of l.chords) assert.ok(parseChord(c.chord), `${s.id}: ${c.chord}`);
    }
  }
});

test('hvatovi i ritmovi postoje', () => {
  for (const s of songs) {
    for (const [name, i] of Object.entries(s.shapes || {})) assert.ok(i < getVoicings(name).length, `${s.id} ${name} #${i}`);
    if (s.strum && s.strum.id) assert.ok(PATTERNS.some((p) => p.id === s.strum.id), s.id + ' ' + s.strum.id);
    if (s.strum) assert.match(s.strum.steps, /^[DUxB-]+$/);
  }
});

test('saveti na srpskom i engleskom, bez ćirilice', () => {
  const txt = JSON.stringify(data);
  assert.ok(!/[\u0400-\u04FF]/.test(txt), 'ćirilica u MARLI put');
  for (const s of songs) {
    assert.ok(s.tips && s.tips.en && s.tips.sr, s.id);
    assert.ok(s.tips.sr.new && s.tips.en.new, s.id + ' „Novo u pesmi“');
    assert.equal(s.tips.sr.watch.length, s.tips.en.watch.length, s.id);
  }
});

test('Pronađi tekst: akordi svake pesme ostaju svi i istim redom', () => {
  for (const s of songs) {
    const parts = s.sections.filter((x) => !/^(intro|uvod|solo|outro|riff|rif)/i.test(x.name));
    const raw = parts.map((x) => `[${x.name}]\n` + x.lines.map((_, i) => `prvi red reči broj ${i + 1} za probu`).join('\n')).join('\n\n');
    const r = fitLyrics({ sections: s.sections }, raw, { bpm: 90 });
    if (!parts.length) continue;
    assert.ok(r && r.matched > 0, s.id);
    const flat = (secs) => secs.flatMap((x) => x.lines.flatMap((l) => [...l.chords].sort((a, b) => a.position - b.position).map((c) => c.chord + (c.g ? '*' : ''))));
    assert.deepEqual(flat(r.sections), flat(s.sections), s.id + ': akordi posle teksta');
  }
});
