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

Aplikacija se automatski objavljuje pri svakom `push`-u na granu `main` (`.github/workflows/deploy.yml`). GitHub Pages treba uključiti samo jednom:

1. Na GitHub-u otvori repozitorijum → **Settings** → **Pages**.
2. U delu **Build and deployment**, pod **Source**, izaberi **GitHub Actions**.
3. Pošalji bilo koju izmenu na `main` (ili otvori **Actions** → „Deploy na GitHub Pages“ → **Run workflow**).
4. Kada se workflow završi, aplikacija je na adresi `https://<korisničko-ime>.github.io/gitara/`. Tačna adresa piše u **Settings → Pages**.

Sve putanje u aplikaciji su relativne, pa manifest i service worker rade ispod podputanje `/gitara/`, bez obzira na velika i mala slova u imenu repozitorijuma.

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

Ako si slučajno odbio pristup mikrofonu:
- **iPhone:** Podešavanja → Safari → Mikrofon → Dozvoli.
- **Android:** Chrome → ⋮ → Podešavanja → Podešavanja sajta → Mikrofon.

## Gemini API ključ (za skeniranje pesama)

1. Otvori [aistudio.google.com](https://aistudio.google.com/app/apikey) i prijavi se svojim Google nalogom.
2. Klikni „Get API key“, pa „Create API key“.
3. U aplikaciji otvori **Podešavanja**, nalepi ključ, pa klikni **Sačuvaj** i **Proveri ključ**.

Ključ se čuva samo na tvom telefonu i šalje se samo Google-u kada skeniraš pesmu. **Nikada ne stavljaj ključ u kod ili u ovaj repozitorijum.**

## Deljenje pesama između učenika i nastavnika

- U prikazu pesme dodirni **Podeli pesmu**. Telefon otvara meni za deljenje (Viber, WhatsApp, e-pošta…) i šalje mali `.json` fajl. Ako deljenje nije podržano, fajl se preuzme.
- Primalac sačuva fajl, pa u tabu **Pesme** dodirne **Uvezi pesmu** i izabere ga. Ako pesma sa istim naslovom već postoji, aplikacija pita da li da je zameni ili da zadrži obe.

## Razvoj

```bash
npm install
npm run dev      # lokalni server
npm test         # testovi (teorija muzike, format pesme, detekcija tona)
npm run build    # produkcijski build u dist/ + service worker
npm run icons    # ponovo pravi PNG ikonice iz SVG-a (treba Playwright)
```

Tehnologija: obični HTML/CSS/JavaScript uz Vite, jsPDF sa ugrađenim fontom DejaVu Sans Mono (za č, ć, š, ž, đ) i Web Audio API (YIN za detekciju tona, hromagram za akorde).
