# Gitara

Gitara je aplikacija za učenika gitare i njegovog nastavnika. Radi na iPhone-u i Android-u, instalira se na početni ekran i radi bez interneta (osim skeniranja pesama).

**Šta aplikacija ima:**

- **Tuner** – štimer za standardno štimovanje (E A D G B E) i za Drop D, pola tona niže, DADGAD i Open G: kazaljka od ♭ do ♯, velika nota, crtež glave gitare sa dugmićima za žice. Počinje da meri na trzaj žice i prati ton dok zvoni, a ignoriše govor i buku. Naštimovana žica postaje zelena i ostaje zelena do „Resetuj“; kada su svih šest zelene, pojavi se „Gitara je spremna“. Dugi pritisak na dugme žice (ili ikonica zvučnika) pušta referentni ton. Osetljivost (Niska / Srednja / Visoka) se bira u Podešavanjima; prag se sam prilagođava buci u prostoriji.
- **Akordi** – prepoznavanje odsviranog akorda (beta; analizira samo posle udarca preko žica), **Rečnik** akorda (hvat, tonovi i zvuk za svaki akord) i **Ritam**: metronom 40–220 BPM sa tap tempom, taktovima 2/4, 3/4, 4/4, 6/8 i biblioteka ritmova (strelice ↓ ↑) koji se sviraju uz metronom.
- **Pesme** – biblioteka sa folderima i setlistama, akordi iznad teksta, dijagrami, transpozicija, **kapodaster** (prikazuje hvatove koje sviraš), **ritam** za pesmu ili deo pesme, **automatsko skrolovanje**, **vežbanje dela pesme** (jedna sekcija u krug uz metronom), štimovanje po pesmi, PDF („Skini PDF“), deljenje i uvoz. Setlista ima i **Nastup** preko celog ekrana (veliki tekst, listanje dodirom, prevlačenjem ili Bluetooth pedalom). Pri prvom pokretanju dodaje se primer pesme.
- **Skeniraj pesmu** – fotografiši rukom pisanu pesmu ili napravi snimke ekrana (može više strana odjednom) i Google Gemini je prepisuje u jednu pesmu, zajedno sa ritmom ako je zapisan. Pre čuvanja dobijaš ekran „Proveri i ispravi“.
- **Podešavanja** – jezik, Gemini API ključ i model, referentni ton A4, Google Drive rezervna kopija i rezervna kopija u fajlu. Dugme **Podeli** (gore desno) prikazuje QR kod sa linkom ka aplikaciji za drugi telefon (QR se pravi na samom uređaju, `src/qr.js`), a **Proveri ažuriranja** (dole) odmah učitava najnoviju verziju.

Ekran ostaje upaljen dok tuner ili prepoznavanje akorda slušaju, dok svira metronom i dok pesma sama skroluje.

**Jezik:** srpski (podrazumevano) ili engleski — bira se u **Podešavanja → Jezik / Language** i menja se odmah. Pesme (naslovi, tekst, akordi) se nikad ne prevode. Svi tekstovi interfejsa su u `src/i18n.js`.

Svi podaci (pesme i ključ) čuvaju se **samo na uređaju** (IndexedDB). Nema servera. Aplikacija traži od pregledača trajno čuvanje podataka i podseća na rezervnu kopiju kada imaš 3+ pesme bez Google Drive-a.

**Nove verzije:** aplikacija radi iz keša (uvek usklađena verzija). Kada je objavljena nova verzija, pojavi se traka „Nova verzija je spremna — Osveži“.

---

## Objavljivanje na GitHub Pages

Aplikacija je statička, bez build koraka (isto kao Trening-za-decu): `index.html`, `manifest.webmanifest`, `sw.js` i ikonice su u korenu repozitorijuma, a sve putanje su relativne. Zato radi na `https://bagaljivko.github.io/Gitara/` na oba načina objavljivanja:

- **Settings → Pages → Source: GitHub Actions** (preporučeno). Workflow `.github/workflows/deploy.yml` pokreće testove i objavljuje aplikaciju pri svakom `push`-u na `main`.
- **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**. Ovako je podešen Trening-za-decu.

Posle izmene fajlova povećaj broj u `CACHE` u `sw.js` (npr. `gitara-v3` → `gitara-v4`), da bi telefoni preuzeli novu verziju.

## Instalacija na telefon

### iPhone (Safari)

1. Otvori adresu aplikacije u **Safariju**. Drugi pregledači na iPhone-u ne mogu da instaliraju aplikaciju.
2. Dodirni dugme **Podeli** (kvadrat sa strelicom na gore).
3. Izaberi **Dodaj na početni ekran** (Add to Home Screen), pa **Dodaj**.
4. Pokreni Gitaru sa početnog ekrana. Kada tuner prvi put zatraži mikrofon, dozvoli ga.

### Android (Chrome)

1. Otvori adresu aplikacije u **Chrome-u**.
2. Dodirni meni **⋮** → **Instaliraj aplikaciju** (ili **Dodaj na početni ekran**).
3. Potvrdi sa **Instaliraj**.

Ako Chrome ne nudi „Instaliraj aplikaciju“: otvori stranicu, sačekaj nekoliko sekundi i osveži je (prvo učitavanje priprema rad bez interneta). Ako si sajt otvarao pre poslednje izmene, u Chrome-u idi na ⋮ → Podešavanja → Podešavanja sajta → Svi sajtovi → bagaljivko.github.io → Obriši podatke, pa otvori adresu ponovo.

Ako si slučajno odbio pristup mikrofonu:
- **iPhone:** Podešavanja → Safari → Mikrofon → Dozvoli.
- **Android:** Chrome → ⋮ → Podešavanja → Podešavanja sajta → Mikrofon.

## Gemini API ključ (za skeniranje pesama)

1. Otvori [aistudio.google.com](https://aistudio.google.com/app/apikey) i prijavi se svojim Google nalogom.
2. Klikni „Get API key“, pa „Create API key“.
3. U aplikaciji otvori **Podešavanja**, nalepi ključ, pa klikni **Sačuvaj** i **Proveri ključ**.

Aplikacija podrazumevano koristi model **gemini-3.8-flash**. Ako ga Google ukine, upiši novi model u polje **Gemini model** u Podešavanjima (bez izmene koda). Kada Google u poruci o grešci predloži zamenu, aplikacija nudi dugme „Koristi …“.

Ključ se čuva samo na tvom telefonu i šalje se samo Google-u kada skeniraš pesmu. **Nikada ne stavljaj ključ u kod ili u ovaj repozitorijum.**

## Google Drive rezervna kopija

U **Podešavanjima → Google Drive** dodirni **Poveži Google Drive** i prijavi se Google nalogom.

- Aplikacija na tvom Drive-u pravi folder **Gitara** i u njemu drži jedan fajl, `gitara-backup.json`, sa svim pesmama i podešavanjima. Gemini ključ se **ne** šalje na Drive.
- Kopija se automatski ažurira nekoliko sekundi posle svake izmene (dodavanje, izmena, brisanje pesme). Ako nema interneta, pokušava ponovo kada se veza vrati.
- **Vrati iz Drive-a** vraća pesme. Ako na telefonu već ima pesama, biraš između **Zameni sve** i **Spoji** (zadržava obe verzije, bez duplikata).
- **Skini PDF** i dalje preuzima PDF, a kada je Drive povezan, čuva ga i u folder Gitara. Ako istu pesmu izvezeš ponovo, fajl se zamenjuje.
- Aplikacija koristi samo dozvolu `drive.file`, pa vidi isključivo fajlove koje je sama napravila.

**Podešavanje u Google Cloud konzoli (jednom):** OAuth Client ID `633765324865-ki9jk8hvnt9cfqbsemipfl8f796g3s1v.apps.googleusercontent.com` (tip „Web application“) mora pod **Authorized JavaScript origins** da ima `https://bagaljivko.github.io`, a za lokalni rad i `http://localhost:8080`. Client secret se ne koristi i nikada se ne stavlja u repozitorijum. Dok je OAuth ekran za saglasnost u režimu „Testing“, pod **Test users** dodaj Google naloge koji će se prijavljivati.

## Deljenje pesama između učenika i nastavnika

- U prikazu pesme dodirni **Podeli pesmu**. Cela pesma (tekst, akordi, kapodaster, ritam, sačuvani YouTube linkovi) se pakuje u link, npr. `https://bagaljivko.github.io/Gitara/#pesma=…`, i šalje preko Vibera, WhatsApp-a, e-pošte… Ako telefon nema meni za deljenje, link se kopira („Link kopiran“).
- Primalac otvori link: Gitara prikaže pesmu i pita **„Dodaj pesmu u biblioteku?“**. Ako pesma sa istim naslovom već postoji, bira **Zameni** ili **Sačuvaj obe**. Ako nema instaliranu aplikaciju, pesma se otvara u pregledaču uz ponudu za instalaciju.
- **Uvezi pesmu** i dalje prihvata `.json` fajlove, a **Skini PDF** pravi PDF.

## Razvoj

```bash
npm start        # lokalni server na http://localhost:8080
npm test         # testovi (teorija muzike, format pesme, detekcija tona)
npm run icons    # ponovo pravi PNG ikonice iz SVG-a (treba Playwright)
```

Tehnologija: obični HTML/CSS/JavaScript (ES moduli, bez build koraka). Za PDF se koristi jsPDF (`vendor/`) sa ugrađenim fontom DejaVu Sans Mono (`fonts/`, skraćen na latinicu sa srpskim slovima č, ć, š, ž, đ); oba se preuzimaju u pozadini posle instalacije. Zvuk se obrađuje preko Web Audio API-ja: YIN za detekciju tona i hromagram za akorde.

Zvuk gitare (tuner, rečnik akorda, tablature, ritmovi): snimljeni tonovi akustične gitare `assets/guitar/40.mp3`–`86.mp3` iz FluidR3_GM (Frank Wen), u MP3 obliku iz projekta [MIDI.js Soundfonts](https://github.com/gleitz/midi-js-soundfonts) (Benjamin Gleitzman), licenca CC BY 3.0 (`assets/guitar/LICENSE.txt`). Ako snimak ne može da se učita, koristi se fizički model žice (`src/ks.js`).
