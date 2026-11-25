# MARLI (Gitara) — pravila rada

## Pravilo dizajna (važi za svaku promenu)
- Sve što se gradi mora da radi **sve funkcije efikasno** i da **izgleda i deluje kao ostatak aplikacije**, na telefonu i na računaru.
- Koristi postojeće delove aplikacije, ne nove stilove:
  - naslov stranice (`.view h1`) i `‹ Nazad` (`.back`);
  - male sekcije (`.tch-sec`);
  - grupe redova (`.set-grp` + `.tch-row` sa `.sr-ic` pločicom, naslovom, sivim podnaslovom i `›`);
  - dugmad (`.btn`, `.btn.primary`, `.btn.wide`, `.btn.small`);
  - čipovi (`.chip`), segmenti (`.seg-tabs`), kartice (`.card`), prozori (`dialog()` iz `ui.js`);
  - boje i mere iz `:root` (`--accent`, `--surface`, `--line`, `--muted`, `--radius`, `--mono`).
- Akordi iznad teksta izgledaju kao na ekranu pesme (narandžasti akordi u redu iznad teksta, monospace).
- **Ako zahtev ne može da stane u to** — nešto bi radilo lošije, ne bi se uklopilo u izgled, ili bi se dupliralo sa postojećim — **ne gradi odmah: prvo se javi i predloži bolje rešenje.**
- Vidljive promene: prvo maketa iz prave aplikacije (privremeni `tests/e2e/specs/99-shot.mjs`, posle obrisati), pa gradnja.

## Izdanje
- Verzija u `src/version.js`, zatim `node scripts/update-sw.mjs`.
- „Šta je novo“ (sr/en) na vrh `NOTES` u `src/whatsnew.js`.
- Odeljak u `docs/novosti/index.html` (id `v{verzija}`) sa slikom u `docs/novosti/img/` (pola veličine, 128 boja).
- Tekst: srpski (ekavica, latinica — bez ćirilice) i engleski. Novi ključevi u `src/i18n.js` i `src/i18n-en.js` posle `'room.title'` (vežbe: `src/practiceText.js`); bez duplih ključeva.

## Testovi (redom, nikad dva odjednom; ako se fajl menja tokom testa — ispočetka)
1. `npm test`
2. `node tests/e2e/run.mjs`
3. `node tests/e2e/run.mjs --built`

## Ostalo
- Push samo na `main`. Poruke komita na srpskom.
- Nikad tajne u repozitorijumu; Gemini ključ ostaje na uređaju / Drive-u korisnika. `SHARE_API_KEY` je namerno javan i ograničen.
- Kod štimera se ne menja bez odobrenja (test 02, `--approve-tuner` samo uz odobrenje).
