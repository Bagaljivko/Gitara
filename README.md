# Gitara

Gitara je aplikacija za učenika gitare i njegovog nastavnika. Radi na iPhone-u i Android-u, instalira se na početni ekran i radi bez interneta (osim skeniranja pesama).

**Šta aplikacija ima:**

- **Tuner** – štimer za standardno štimovanje (E A D G B E). Ima automatsko prepoznavanje žice, kazaljku u centima, glavu gitare sa označenim ključem i strelicom na koju stranu treba okrenuti ključ, i poruke „Zategni“, „Olabavi“ i „Naštimovano ✓“.
- **Akordi** (beta) – sluša odsvirani akord i prikazuje njegovo ime i dijagram (dur, mol, 7, maj7, m7, sus2, sus4, u svim tonalitetima).
- **Pesme** – biblioteka pesama sa akordima iznad teksta, dijagramima, transpozicijom, PDF izvozom („Skini PDF“), deljenjem („Podeli pesmu“) i uvozom („Uvezi pesmu“).
- **Skeniraj pesmu** – fotografiši rukom pisanu pesmu i Google Gemini će je prepisati. Pre čuvanja dobijaš ekran „Proveri i ispravi“.
- **Podešavanja** – Gemini API ključ (sa uputstvom kako se dobija besplatno), referentni ton A4 i rezervna kopija svih pesama.

Svi podaci (pesme i ključ) čuvaju se **samo na uređaju** (IndexedDB). Nema servera.

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

- U prikazu pesme dodirni **Podeli pesmu**. Telefon otvara meni za deljenje (Viber, WhatsApp, e-pošta…) i šalje mali `.json` fajl. Ako deljenje nije podržano, fajl se preuzme.
- Primalac sačuva fajl, pa u tabu **Pesme** dodirne **Uvezi pesmu** i izabere ga. Ako pesma sa istim naslovom već postoji, aplikacija pita da li da je zameni ili da zadrži obe.

## Razvoj

```bash
npm start        # lokalni server na http://localhost:8080
npm test         # testovi (teorija muzike, format pesme, detekcija tona)
npm run icons    # ponovo pravi PNG ikonice iz SVG-a (treba Playwright)
```

Tehnologija: obični HTML/CSS/JavaScript (ES moduli, bez build koraka). Za PDF se koristi jsPDF (`vendor/`) sa ugrađenim fontom DejaVu Sans Mono (`fonts/`, za č, ć, š, ž, đ). Zvuk se obrađuje preko Web Audio API-ja: YIN za detekciju tona i hromagram za akorde.
