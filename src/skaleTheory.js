// Skale → kartice i „Teorija“: kratko (1–2 rečenice), pa „Saznaj više“ (intervali, formula, zašto tako zvuči, gde se koristi).
// Učitava se tek kad se otvori kartica ili biblioteka. Srpski (ekavica, latinica) + engleski.
// U srpskom tekstu nota B je „H“ (kao u aplikaciji), a B♭ je „B“.
export const TOPICS = ['penta', 'scales', 'technique'];
export const CARDS = {
  pentatonic: { topic: 'penta' },
  root: { topic: 'penta' },
  movable: { topic: 'penta' },
  majPent: { topic: 'penta' },
  blues: { topic: 'scales' },
  minor: { topic: 'scales' },
  major: { topic: 'scales' },
  thirds: { topic: 'technique' },
  sequences: { topic: 'technique' },
  chromatic: { topic: 'technique' },
};

export const sr = {
  'sk.topic.penta': 'Pentatonika',
  'sk.topic.scales': 'Skale',
  'sk.topic.technique': 'Tehnika',

  'sk.card.pentatonic.t': 'Pentatonika',
  'sk.card.pentatonic.s': 'Ovo je molska pentatonika: 5 tonova koji uvek zvuče dobro zajedno. Zato je omiljena za rok i blues solo.',
  'sk.card.pentatonic.m': 'Formula: 1 – ♭3 – 4 – 5 – ♭7 (osnovni ton, mala terca, čista kvarta, čista kvinta, mala septima). U A-molu to su A, C, D, E, G. Između susednih tonova nema polustepena — izostavljeni su 2. i 6. ton molske skale — pa nijedan ton ne „para“ uši preko akorda i teško je pogrešiti. Čuje se u roku, bluzu, popu i metalu.',

  'sk.card.root.t': 'Kuća skale',
  'sk.card.root.s': 'Osnovni ton (tonika) je „kuća“ skale: odatle melodija kreće i tu se smiruje. U ovoj kutiji A je tri puta — na debeloj E, na D žici i na tankoj e.',
  'sk.card.root.m': 'Tonike su na stazi označene narandžastim krugom. Kad bend svira u A-molu, završi frazu na A i zvučaće rešeno, „kod kuće“. Dok sviraš, koristi tonike kao orijentir: uvek znaš gde si u skali.',

  'sk.card.movable.t': 'Isti oblik, drugo mesto',
  'sk.card.movable.s': 'Oblik ostaje isti — samo ga pomeriš. Na 3. pragu ista kutija daje G-mol pentatoniku, na 5. pragu A-mol.',
  'sk.card.movable.m': 'Pomeriš li oblik za jedan prag, sve note su pola stepena više. Tonalitet zavisi od toga gde je prvi prst na debeloj E žici (tu je tonika): 3. prag = G, 5. = A, 8. = C, 10. = D, 12. = E. Zato jedan naučen oblik vredi za svih 12 tonaliteta.',

  'sk.card.thirds.t': 'Terce',
  'sk.card.thirds.s': 'Terce: sviraš ton, pa ton dva mesta dalje u skali, pa se vratiš korak nazad. Ruka uči da preskače, a ne samo da ide redom.',
  'sk.card.thirds.m': 'Redosled je 1-3, 2-4, 3-5… gore, pa isto nadole. Tako zvuči kao melodija, a ne kao penjanje uz merdevine — zato se ovakve vežbe koriste da solo bude zanimljiviji. U durskoj i molskoj skali taj preskok je baš terca; u pentatonici je ponekad i kvarta.',

  'sk.card.blues.t': 'Blues nota',
  'sk.card.blues.s': 'Blues skala je pentatonika plus jedan ton: D# između D i E (u A). To je „plava nota“ — kroz nju se prolazi, na njoj se ne ostaje.',
  'sk.card.blues.m': 'Formula: 1 – ♭3 – 4 – ♭5 – 5 – ♭7. U A to su A, C, D, D#, E, G. Smanjena kvinta (♭5) zvuči napeto i „prljavo“; kad klizneš preko nje do kvinte, dobiješ tipičan bluz zvuk.',

  'sk.card.majPent.t': 'Veselija strana',
  'sk.card.majPent.s': 'Durska pentatonika zvuči vedro: kantri, pop i sunčaniji rok. Opet pet tonova, samo drugačije raspoređenih.',
  'sk.card.majPent.m': 'Formula: 1 – 2 – 3 – 5 – 6. U A-duru: A, H, C#, E, F#. Zanimljivo: A-dur pentatonika ima iste tonove kao F#-mol pentatonika — razlika je samo koji ton čuješ kao „kuću“.',

  'sk.card.minor.t': 'Cela molska skala',
  'sk.card.minor.s': 'Prirodni mol ima 7 tonova: pentatonika plus još dva (H i F u A-molu). Zvuči tužnije i mirnije, kao melodija pesme.',
  'sk.card.minor.m': 'Formula: 1 – 2 – ♭3 – 4 – 5 – ♭6 – ♭7. Koraci: ceo, pola, ceo, ceo, pola, ceo, ceo. A-mol ima iste tonove kao C-dur — on je njegov „paralelni mol“.',

  'sk.card.major.t': 'Durska skala',
  'sk.card.major.s': 'Durska skala je „do-re-mi“: osnova većine melodija koje znaš. Zvuči veselo i svetlo.',
  'sk.card.major.m': 'Koraci: ceo, ceo, pola, ceo, ceo, ceo, pola. U C-duru su to samo bele dirke klavira: C, D, E, F, G, A, H. Iz nje nastaju akordi većine pesama (C, Dm, Em, F, G, Am).',

  'sk.card.sequences.t': 'Sekvence',
  'sk.card.sequences.s': 'Sekvence: ista mala grupa tonova (po 3 ili po 4) pomera se kroz skalu. Ruka uči obrasce, a solo dobija ritam.',
  'sk.card.sequences.m': 'Po 3: 1-2-3, 2-3-4, 3-4-5… Po 4: 1-2-3-4, 2-3-4-5… Gitaristi ih koriste za brze, „tekuće“ pasaže. Počni sporo — čist ton je važniji od brzine — pa ubrzavaj po 5 BPM.',

  'sk.card.chromatic.t': 'Hromatska skala',
  'sk.card.chromatic.s': 'Hromatska skala: svih 12 tonova, prag po prag. Nije za solo, nego za prste — jedan prst na svaki prag.',
  'sk.card.chromatic.m': 'Između dva susedna praga je pola stepena, a 12 polustepena čini oktavu. Ova vežba razvija nezavisnost prstiju, čist ton i sinhronizaciju leve i desne ruke.',
};

export const en = {
  'sk.topic.penta': 'Pentatonic',
  'sk.topic.scales': 'Scales',
  'sk.topic.technique': 'Technique',

  'sk.card.pentatonic.t': 'Pentatonic',
  'sk.card.pentatonic.s': 'This is the minor pentatonic: 5 notes that always sound good together. That’s why it’s the favourite for rock and blues solos.',
  'sk.card.pentatonic.m': 'Formula: 1 – ♭3 – 4 – 5 – ♭7 (root, minor third, perfect fourth, perfect fifth, minor seventh). In A minor: A, C, D, E, G. There are no half steps between neighbouring notes — the 2nd and 6th of the minor scale are left out — so no note clashes with the chords and it’s hard to go wrong. You hear it in rock, blues, pop and metal.',

  'sk.card.root.t': 'Home of the scale',
  'sk.card.root.s': 'The root is the “home” of the scale: melodies start there and come to rest there. In this box A appears three times — on the low E, the D string and the high e.',
  'sk.card.root.m': 'Roots are marked with an orange ring on the track. When a band plays in A minor, end a phrase on A and it sounds resolved, “at home”. While you play, use the roots as landmarks: you always know where you are.',

  'sk.card.movable.t': 'Same shape, new place',
  'sk.card.movable.s': 'The shape stays the same — you just move it. At the 3rd fret the same box is G minor pentatonic, at the 5th fret A minor.',
  'sk.card.movable.m': 'Move a shape up one fret and every note is a half step higher. The key is set by where your first finger sits on the low E string (that’s the root): fret 3 = G, 5 = A, 8 = C, 10 = D, 12 = E. One shape learned works in all 12 keys.',

  'sk.card.thirds.t': 'Thirds',
  'sk.card.thirds.s': 'Thirds: play a note, then the note two steps up the scale, then step back. Your hand learns to skip, not just to walk in order.',
  'sk.card.thirds.m': 'The order is 1-3, 2-4, 3-5… going up, then the same coming down. It sounds like a melody rather than climbing a ladder — that’s why this kind of exercise makes solos more interesting. In the major and minor scales the skip is a real third; in the pentatonic it is sometimes a fourth.',

  'sk.card.blues.t': 'The blue note',
  'sk.card.blues.s': 'The blues scale is the pentatonic plus one note: D# between D and E (in A). That’s the “blue note” — you pass through it, you don’t stay on it.',
  'sk.card.blues.m': 'Formula: 1 – ♭3 – 4 – ♭5 – 5 – ♭7. In A: A, C, D, D#, E, G. The flat fifth (♭5) sounds tense and “gritty”; slide through it to the fifth and you get the classic blues sound.',

  'sk.card.majPent.t': 'The brighter side',
  'sk.card.majPent.s': 'The major pentatonic sounds bright: country, pop and sunnier rock. Again five notes, just arranged differently.',
  'sk.card.majPent.m': 'Formula: 1 – 2 – 3 – 5 – 6. In A major: A, B, C#, E, F#. Fun fact: A major pentatonic has the same notes as F# minor pentatonic — the only difference is which note you hear as “home”.',

  'sk.card.minor.t': 'The full minor scale',
  'sk.card.minor.s': 'The natural minor has 7 notes: the pentatonic plus two more (B and F in A minor). It sounds sadder and calmer, like a song melody.',
  'sk.card.minor.m': 'Formula: 1 – 2 – ♭3 – 4 – 5 – ♭6 – ♭7. Steps: whole, half, whole, whole, half, whole, whole. A minor has the same notes as C major — it’s its “relative minor”.',

  'sk.card.major.t': 'The major scale',
  'sk.card.major.s': 'The major scale is “do-re-mi”: the basis of most melodies you know. It sounds happy and bright.',
  'sk.card.major.m': 'Steps: whole, whole, half, whole, whole, whole, half. In C major it’s just the white keys of a piano: C, D, E, F, G, A, B. Most songs’ chords come from it (C, Dm, Em, F, G, Am).',

  'sk.card.sequences.t': 'Sequences',
  'sk.card.sequences.s': 'Sequences: the same small group of notes (3 or 4) moves through the scale. Your hand learns patterns and your solos get rhythm.',
  'sk.card.sequences.m': 'Groups of 3: 1-2-3, 2-3-4, 3-4-5… Groups of 4: 1-2-3-4, 2-3-4-5… Guitarists use them for fast, flowing runs. Start slowly — a clean note matters more than speed — then speed up 5 BPM at a time.',

  'sk.card.chromatic.t': 'Chromatic scale',
  'sk.card.chromatic.s': 'The chromatic scale: all 12 notes, fret by fret. It’s not for solos, it’s for your fingers — one finger per fret.',
  'sk.card.chromatic.m': 'Two neighbouring frets are a half step apart, and 12 half steps make an octave. This exercise builds finger independence, clean tone and left-right hand sync.',
};
