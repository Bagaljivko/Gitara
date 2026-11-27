# Lažni Google Drive + Google prijava (tests/sim)

Za probu prelaska sa STAROG na NOV Google Cloud projekat / OAuth klijent, sa jednim nastavnikom i 50+ učenika
(svaki Playwright context = jedan uređaj). Bez zavisnosti; `node tests/sim/selftest.mjs` proverava sve (86 provera,
uključujući pravi `src/syncDrive.js` nad simulatorom).

| Fajl | Šta je |
|---|---|
| `driveSim.mjs` | `createSim`, `migrationSim`, `appDefaults`, `routeHandler`, `installSim`, `SCOPES` |
| `gisStub.js` | `GIS_STUB`: tekst skripte koja glumi `accounts.google.com/gsi/client` |
| `selftest.mjs` | Node provera (bez pregledača) |

## Pravila koja sim oponaša
- `drive.file` i `drive.appdata` važe **po projektu**: token klijenta iz projekta X vidi i menja samo fajlove koje je
  taj korisnik napravio kroz X (i samo appDataFolder projekta X). Sve drugo je `404 notFound`, kao na pravom Drive-u.
- Javni fajl (`anyone`/`reader`) čita **bilo koji** projekat ključem: `files/{id}?alt=media&key=K`.
  Ključ projekta bez Drive API-ja → `403 accessNotConfigured`; ključ ograničen na druge API-je ili druge adrese
  (`apis`, `referrers`) → `403`; nepoznat ključ → `400 "API key not valid"` (tako radi Google; aplikacija to prepoznaje).
- Dozvola (consent) je po **klijentu** (`client_id`); `include_granted_scopes` vraća sve ranije dozvoljene opsege.
- Pomoćnik (`tools/token-helper.gs`) je vezan za jedan klijent: kod drugog klijenta → `invalid_grant`;
  **refresh token drugog klijenta → `unauthorized_client`** (aplikacija tada ne briše staru dozvolu, jer briše samo na `invalid_grant`).
- `refresh_token` stiže samo kad je korisnik video ekran za dozvolu (prvi put ili novi opseg); `{ refreshOnEveryCode: true }` menja to.
- Projekat u režimu „Testing“ (`publishing: 'testing', testUsers`) odbija ostale (`access_denied`), a refresh token traje 7 dana.
- Opoziv (`oauth2.googleapis.com/revoke` ili GIS `revoke`) poništava celu dozvolu tog naloga za taj klijent (sve tokene).

## Upotreba u Node-u
```js
import { createSim, migrationSim } from './driveSim.mjs';
const sim = createSim({
  clock: 'virtual',                       // sat stoji; sim.advance(ms). Podrazumevano: stvarno vreme (+ advance)
  projects: { OLD: { userPerSec: 10, unitsPerMin: 1e6 }, NEW: { publishing: 'production' } },
  clients:  { 'old.apps': { project: 'OLD' }, 'new.apps': { project: 'NEW', origins: ['http://127.0.0.1:1234'] } },
  keys:     { AIzaOLD: { project: 'OLD' }, AIzaNEW: { project: 'NEW', referrers: ['http://127.0.0.1:*'] } },
  helpers:  { 'https://script.google.com/macros/s/NEW/exec': { client: 'new.apps' } },
});
const { access_token } = sim.issueToken('kid@x.test', 'NEW', 'drive.file drive.appdata');
await sim.fetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder', { headers: { Authorization: 'Bearer ' + access_token } });
```
`migrationSim(newIds?, opts?)` pravi isto, a OLD su trenutni ID-jevi iz `src/` (`appDefaults()`: `CLIENT_ID` iz
`src/drive.js`, `SHARE_API_KEY` i `TOKEN_HELPER` iz `src/shareConfig.js`); NEW su `newIds = { clientId, apiKey, helperUrl }`.

### API
- Model: `addUser(email, {name, quota})`, `user(email)`, `issueToken(email, clientOrProject, scopes, {refresh})`,
  `revokeGrant(email, clientId)`, `expireTokens(filter)`, `tokenInfo(tok)`, `now()`, `advance(ms)`.
- Seme: `seed(email, project, { name, content, mimeType, parents, appData, appProperties, public, folder })`,
  `seedFolder(email, project, name)`, `setPublic(id, on)`.
- Pregled: `listFiles({ owner, project, appData, name })` (`.text()`, `.json()`, `.bytes`), `file(id)`, `publicRead(id)`,
  `snapshot({ bytes })`, `stats` (`total, byUser, byProject, byEndpoint, byStatus, byReason, rateLimited`), `log`, `resetStats()`.
- Kvarovi: `fail({ match: (req) => bool, status, reason, message, times = 1, network, body })` (req: `ep, method, url, path,
  params, headers, body, user, project`; vraća `{ cancel(), hits }`), `offline(true|false)` (fetch baca TypeError),
  `dropAfter(n)` (još n zahteva prolazi, pa je veza prekinuta dok `offline(false)`).
- Ograničenja po projektu: `userPerSec`, `userPerMin` (→ `userRateLimitExceeded`), `unitsPerMin` (klizni minut,
  `costs: { 'files.list': 1, … }` → `rateLimitExceeded` „Total Query Cost“), `rateStatus: 403 | 429`. Podrazumevano isključena.
  Javna čitanja ključem troše jedinice projekta tog ključa.
- `sim.handle({url, method, headers, body})` → `{status, headers, body}`; `sim.fetch(url, init)` → WHATWG `Response`.

Imena krajnjih tačaka (za `stats.byEndpoint` i `fail`): `about.get, files.list, files.get, files.media, files.create,
files.update, files.delete, permissions.list|get|create|delete, changes.getStartPageToken, changes.list,
upload.multipart, upload.media, upload.resumable, upload.resumable.put, helper, revoke, tokeninfo, gis`.

## U pregledaču (tests/e2e)
`open()` iz `tests/e2e/lib.mjs` pravi nov context (= nov uređaj) i vraća stranicu; sim se kači na `p.context()` pre `boot()`:
```js
import { open, boot } from '../lib.mjs';
import { migrationSim, installSim, SCOPES } from '../../sim/driveSim.mjs';

const sim = migrationSim({ clientId: NEW_ID, apiKey: NEW_KEY, helperUrl: NEW_HELPER }, { projects: { OLD: { userPerSec: 10 }, NEW: { userPerSec: 10 } } });
const t = await open(ctx, 'desk');
const tDev = await installSim(sim, t.context(), sim.device({ accounts: ['profa@x.test'] }));
await boot(t, ctx);
const kids = [];
for (let i = 0; i < 50; i++) {
  const p = await open(ctx, 'phone');
  const dev = await installSim(sim, p.context(), sim.device({ accounts: [`u${i}@x.test`] }));
  await boot(p, ctx); kids.push({ p, dev });
}
kids[3].dev.next('cancel');                         // učenik zatvori Google prozor
kids[4].dev.next({ untick: ['drive.appdata'] });    // skine kvačicu za sinhronizaciju
kids[5].dev.next('blocked');                        // pregledač blokira prozor
kids[6].dev.next({ pick: 'drugi@x.test' });         // izabere drugi nalog
kids[7].dev.silent = 'fail';                        // tiho obnavljanje (prompt:'none') uvek pada
```
- `installSim(sim, context, dev, { initScript })`: `context.route` za Drive / upload / `oauth2.googleapis.com` /
  pomoćnik (`script.google.com/macros/s/…/exec`) / `accounts.google.com/gsi/client` (servira `GIS_STUB`), i
  `context.exposeBinding('__simAuth')` preko kog GIS pita sim. `initScript: true` ubacuje GIS odmah (bez učitavanja).
  Rute na stranici (npr. `fakeDrive`) imaju prednost nad rutama contexta — ne mešati ih.
- Ponašanje prozora po uređaju: `dev.next(...)` (red, jedno po prozoru) ili `dev.default`; vrednosti
  `'approve' | 'cancel' | 'blocked' | 'deny' | 'hang' | { pick, untick, delay }`. Tiho (`prompt:'none'`): uspeva samo
  ako je nalog prijavljen (jedini, ili po `login_hint`) i dozvola za taj klijent već postoji; inače
  `login_required` / `interaction_required` / `consent_required`. `dev.log` beleži svaki zahtev i ishod.
- Klijent sa `origins` odbija druge adrese (`origin_mismatch` → korisnik zatvori prozor → `popup_closed`): nov klijent
  mora da ima i adresu test servera.
- Token bez prozora (kao specs 56/57): `const { access_token } = sim.issueToken(email, 'NEW')`, pa u stranici
  `settings.set('driveToken', { t: access_token, exp: Date.now() + 3500e3, s: 2, f: 1 })`.
- Drugi pomoćnik bez izmene koda: `addInitScript(() => { globalThis.__gitaraTokenHelper = 'https://script.google.com/macros/s/NEW/exec'; })`.

## Šta NIJE modelovano
Picker / „otvori sa“ (drive.file pristup tuđim fajlovima), deljeni diskovi, revizije, izvoz Google dokumenata,
`or`/`not`/zagrade/`fullText` u `q` (vraća 400, namerno glasno), `sharingRateLimitExceeded`, tačne Google-ove poruke
za neke ređe greške (413 `uploadTooLarge`, deljenje appData fajla), tačni pageToken-i Drive-a (ovde: brojevi /
neprozirni base64), troškovi jedinica po metodi (podrazumevano 1 po zahtevu), istek sesije za nastavljivo slanje
(7 dana, ne proverava se vlasnik), CORS preflight (handler odgovara na OPTIONS, Playwright ga obično ne šalje).
