// Primer pesme za prvo pokretanje: pokazuje akorde, tablaturu, ritam, auto-skrol i „Lakša verzija“.
// Tekst je originalan, napisan za aplikaciju.
import { textToSections } from './songformat.js';
import { settings, songs } from './db.js';

const SR = `[Uvod]
e|-----0-------0-|
B|---2---2---2---|
G|-2-------2-----|
D|---------------|
A|0--------------|
E|---------------|

[Strofa 1]
A                  E
Sedim na pragu, veče tiho pada,
F#m                  D
gitara u krilu, svira mi se sada.
A                   E
Četiri akorda i malo strpljenja,
D            E           A
pesma se rodi bez puno učenja.

[Refren]
D              A
Polako, polako, bez žurbe i straha,
D                 E
svaka greška je deo zanata.
D              A
Polako, polako, prsti će znati,
F#m        E         A
pesma se uvek ume vratiti.

[Strofa 2]
A                  E
Ako je barre teško da se drži,
F#m                  D
pritisni „Lakša verzija“ — kapodaster pomeri.
A                   E
Isti zvuk, a prsti odmah lakše,
D            E           A
pa ponovo refren, sve do kraja.`;

const EN = `[Intro]
e|-----0-------0-|
B|---2---2---2---|
G|-2-------2-----|
D|---------------|
A|0--------------|
E|---------------|

[Verse 1]
A                  E
Sitting on the porch as the evening is falling,
F#m                  D
guitar on my knee and a melody calling.
A                   E
Four little chords and a little bit of patience,
D            E           A
a song comes along without much explanation.

[Chorus]
D              A
Slowly, slowly, no hurry, no worry,
D                 E
every mistake is a part of the story.
D              A
Slowly, slowly, your fingers will know,
F#m        E         A
the song always finds its way home.

[Verse 2]
A                  E
If a barre chord is hard to hold for long,
F#m                  D
tap "Easier version" — the capo moves along.
A                   E
Same sound, but your fingers feel lighter,
D            E           A
then back to the chorus, a little bit brighter.`;

export function demoSong(lang) {
  const en = lang === 'en';
  return {
    title: en ? 'Example: Slowly' : 'Primer: Polako',
    artist: en ? 'MARLI (example song)' : 'MARLI (primer pesme)',
    key: 'A',
    sections: textToSections(en ? EN : SR),
    strum: { id: 'folk', sig: '4/4', steps: 'D-DU-UDU' },
    scrollSpeed: 3,
    demo: true,
  };
}

/** Prvo pokretanje: dodaj primer pesme samo ako je biblioteka prazna (i samo jednom). */
export async function seedDemoSong(lang) {
  if (await settings.get('demoSeeded', false)) return false;
  await settings.set('demoSeeded', true);
  try { if ((JSON.parse(localStorage.getItem('gitara-sync') || 'null') || {}).on) return false; } catch {} // pesme stižu sa naloga
  if (await songs.count()) return false;
  await songs.save(demoSong(lang));
  return true;
}
