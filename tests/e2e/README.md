# MARLI — browser testovi (e2e)

Proveravaju celu aplikaciju u pravom pregledaču (Chromium preko Playwright-a) na telefonu, telefonu položeno,
tabletu (uspravno i položeno) i računaru. Pokreću se pre svake objave, **jedan po jedan, nikad paralelno**.

```bash
node tests/e2e/run.mjs                 # svi testovi (~10 min)
node tests/e2e/run.mjs --only 05,16    # samo neki (deo imena fajla)
node tests/e2e/run.mjs --built         # objavljena kopija (minify + verzija u adresama, kao deploy.yml)
node tests/e2e/run.mjs --list          # spisak
```

Izveštaj: `tests/e2e/last-report.txt` (ne čuva se u repozitorijumu). Jedinični testovi: `npm test`.

- `lib.mjs` — uređaji, otvaranje stranice (obilazak/saveti isključeni osim kad test traži), pesme za probu,
  provera preliva i ključeva bez prevoda, merenje memorije, usporen procesor, lažni mikrofon (`fakeMic`).
- `specs/` — po jedan fajl za oblast. Test pada na prvoj neispunjenoj proveri i na svakoj grešci u stranici.
- `tuner-files.json` — otisak koda tunera. Kod tunera se ne menja bez odobrenja; posle odobrene izmene:
  `node tests/e2e/run.mjs --only tuner --approve-tuner`.
