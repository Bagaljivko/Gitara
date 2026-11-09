// v1.70: „Šta je novo“ — kratak pregled po verziji (Podešavanja → O aplikaciji). „Saznaj više“ otvara stranicu sa
// detaljima i snimcima ekrana (docs/novosti/). Posle ažuriranja zlatna tačka (na „Podešavanja“ i pored dugmeta) dok se ne pogleda.
import { t, getLang } from './i18n.js';
import { esc, dialog } from './ui.js';
import { APP_VERSION } from './version.js';

export const NOTES = [
  { v: '1.79', date: '2026-11-09', items: [
    { i: '⭐', sr: ['Pitaj nastavnika', 'Od nastavnika → „Želim da naučim…“ ili „Imaš li ovu pesmu?“: naslov, izvođač i napomena idu nastavniku porukom. U „Moji zahtevi“ vidiš šta je poslato, šta je stiglo i šta nastavnik nema.'], en: ['Ask your teacher', 'From teacher → “I want to learn…” or “Do you have this song?”: title, artist and a note go to your teacher in a message. “My requests” shows what was sent, what arrived and what your teacher doesn’t have.'] },
    { i: '📊', sr: ['Pregled za nastavnika', 'Na računaru i velikom tabletu „Učenici“ su pregled: brojke, tabela učenika, zahtevi sa dugmadima Pošalji pesmu / Nemam / Rešeno i „Treba pažnje“. Na telefonu su zahtevi na stranici učenika.'], en: ['Teacher overview', 'On computers and large tablets “Students” is an overview: numbers, a students table, requests with Send song / Don’t have it / Done and “Needs attention”. On phones the requests are on the student’s page.'] },
  ] },
  { v: '1.78', date: '2026-11-09', items: [
    { i: '🎓', sr: ['Nastava: učenici', 'Podešavanja → Nastava → „Ja sam nastavnik“: učenici, snimci i set liste po učeniku, slanje pesama i set lista jednom ili više učenika (svako dobija svoju poruku).'], en: ['Teaching: students', 'Settings → Teaching → “I’m a teacher”: students, recordings and setlists per student, sending songs and setlists to one or more students (each gets their own message).'] },
    { i: '📨', sr: ['Od nastavnika', 'Učenik prihvati pozivnicu: sve od nastavnika je na jednom mestu i osvežava se bez duplikata, a snimak se nastavniku šalje jednim dodirom. Biblioteke se nikad ne dele.'], en: ['From teacher', 'The student accepts the invite: everything from the teacher is in one place and updates without duplicates, and a recording goes to the teacher with one tap. Libraries are never shared.'] },
  ] },
  { v: '1.77', date: '2026-11-09', items: [
    { i: '🖥', sr: ['Nov izgled na računaru', 'Meni je gore (logo levo, nalog i sinhronizacija desno), sadržaj je širi. Vežbe: „Danas“ kao veliki blok, igre u velikim pločicama. Podešavanje igre u dve kolone, a „Počni“ je uvek dole, uz kratak pregled izabranog. Telefon ostaje isti.'], en: ['New look on computers', 'The menu is at the top (logo left, account and sync right), content is wider. Practice: “Today” as a big block, games as large tiles. Game setup in two columns, with “Start” always at the bottom next to a short summary of your choices. Phones stay the same.'] },
  ] },
  { v: '1.76', date: '2026-11-09', items: [
    { i: '💬', sr: ['Pošalji utisak', 'Podešavanja → Pošalji utisak: javi šta ne radi, predloži ideju ili reci šta ti se sviđa — čita ga autor aplikacije. Bez mreže poruka sačeka i pošalje se sama.'], en: ['Send feedback', 'Settings → Send feedback: report what’s wrong, suggest an idea or say what you like — the app’s author reads it. Offline, the message waits and is sent by itself.'] },
    { i: '🩺', sr: ['Pošalji dijagnostiku', 'Ako nešto zapne: Podešavanja → Dijagnostika → Pošalji dijagnostiku. Bez pesama i ključeva.'], en: ['Send diagnostics', 'If something gets stuck: Settings → Diagnostics → Send diagnostics. No songs or keys.'] },
  ] },
  { v: '1.75', date: '2026-11-09', items: [
    { i: '🎸', sr: ['Ime akorda na liniji', 'Promena akorda, Delovi pesme i Ritam (sa akordima): iznad žute linije stoji ime akorda koji sviraš, a otkucaj pre promene i sledeći („Em › G“). Brojevi i boje prstiju ostaju.'], en: ['Chord name on the line', 'Chord switch, Song parts and Rhythm (with chords): the chord you play is named above the yellow line, and one beat before a change the next one too (“Em › G”). Finger numbers and colors stay.'] },
  ] },
  { v: '1.74', date: '2026-11-08', items: [
    { i: '👋', sr: ['Dobrodošao nazad — jedna prijava', 'Nov telefon, računar ili obrisani podaci: aplikacija odmah pita da povežeš Google nalog — pesme, podešavanja, Vežbe i Gemini ključ stižu sami.'], en: ['Welcome back — one sign-in', 'New phone, computer or cleared data: the app asks right away to connect your Google account — songs, settings, Practice and your Gemini key arrive by themselves.'] },
    { i: '☁', sr: ['Drive se sam pretraži', 'Posle povezivanja aplikacija sama nađe rezervne kopije na Drive-u i ponudi noviju (vidi se koliko je stara).'], en: ['Drive is searched by itself', 'After connecting, the app finds the backups on Drive by itself and offers the newer one (showing how old it is).'] },
  ] },
  { v: '1.73', date: '2026-11-08', items: [
    { i: '⏱', sr: ['Koliko sviraš i vežbaš', 'Vežbe: ova nedelja i „Moje pesme“ — svirano, vežbano, koliko puta, najbolji rezultat. Računa se samo aktivno vreme.'], en: ['How much you play and practice', 'Practice: this week and “My songs” — played, practiced, how many times, best score. Only active time counts.'] },
    { i: '♪', sr: ['Sve o pesmi', 'Dodir na pesmu: delovi pesme i napredak tempa (npr. 80 → 100 BPM, cilj 112), pa „Vežbaj“ najslabiji deo.'], en: ['Everything about a song', 'Tap a song: its parts and tempo progress (e.g. 80 → 100 BPM, target 112), then “Practice” the weakest part.'] },
    { i: '✓', sr: ['Spremnost set liste', 'Na set listi: „Spremno 6 od 9“ i tačka uz svaku pesmu.'], en: ['Setlist readiness', 'On a setlist: “Ready 6 of 9” and a dot next to each song.'] },
    { i: '◎', sr: ['Nedeljni cilj', 'Po želji: npr. 3 h nedeljno — krug na Vežbama se puni.'], en: ['Weekly goal', 'Optional: e.g. 3 h a week — the ring in Practice fills up.'] },
    { i: '★', sr: ['Nova ikonica', 'Telefon je lakše prepoznaje; ako i dalje vidiš staru, aplikacija jednom kaže šta da uradiš.'], en: ['New icon', 'Easier for the phone to pick up; if you still see the old one, the app tells you once what to do.'] },
  ] },
  { v: '1.72', date: '2026-11-08', items: [
    { i: '⚙', sr: ['Nova Podešavanja', 'Kratak spisak sa ikonicama i trenutnim vrednostima; svaka celina je svoja stranica. Na računaru: spisak levo, stranica desno.'], en: ['New Settings', 'A short list with icons and current values; each section is its own page. On a computer: list on the left, page on the right.'] },
    { i: '✓', sr: ['Stanje na jedan pogled', 'Na vrhu: Google nalog, sinhronizacija, rezervna kopija i Gemini ključ.'], en: ['Status at a glance', 'At the top: Google account, sync, backup and Gemini key.'] },
    { i: '🔑', sr: ['Gemini ključ se sklopi', 'Kad ključ radi, vidi se samo „Ključ radi“ sa Proveri / Promeni. Sve ostalo je pod „Napredno“.'], en: ['Gemini key folds away', 'When the key works you only see “Key works” with Check / Change. Everything else is under “Advanced”.'] },
  ] },
  { v: '1.71', date: '2026-11-08', items: [
    { i: '🛡', sr: ['Rezervne kopije — jednostavno', '„Cela aplikacija“ (sve, i Gemini ključ) i „Samo pesme“ — na Google Drive-u, same se pronađu pri vraćanju.'], en: ['Backups — simple', '“Whole app” (everything, including the Gemini key) and “Songs only” — on Google Drive, found by themselves when restoring.'] },
    { i: '🔑', sr: ['Vrati ključ sa Google naloga', 'Ključ je nestao? Jedan dodir u kartici Gemini ključ ga vraća.'], en: ['Restore key from Google account', 'Key gone? One tap in the Gemini key card brings it back.'] },
    { i: '❔', sr: ['Proveri ključ kaže šta je', 'Dnevni limit, Google zauzet ili loš ključ — i šta (ne) treba da uradiš.'], en: ['Check key tells you what it is', 'Daily limit, Google busy or a bad key — and what you do (or don’t) need to do.'] },
    { i: '✨', sr: ['Uvod samo pri otvaranju', 'MARLI ekran se više ne prikazuje pri povlačenju nadole.'], en: ['Intro only on open', 'The MARLI screen no longer shows on pull-to-refresh.'] },
  ] },
  { v: '1.70', date: '2026-11-08', items: [
    { i: '💻', sr: ['MARLI na računaru', 'Poveži isti Google nalog — pesme, set liste i Gemini ključ stižu sami.'], en: ['MARLI on your computer', 'Connect the same Google account — songs, setlists and your Gemini key arrive by themselves.'] },
    { i: '≡', sr: ['Biblioteka na računaru', 'Tabela, više pesama odjednom, folderi i set liste prevlačenjem, brzo uređivanje.'], en: ['Library on your computer', 'Table, many songs at once, folders and setlists by drag and drop, quick edit.'] },
    { i: '📄', sr: ['Više PDF-ova odjednom', 'Sa tekstom odmah, skenirani preko Gemini-ja — red se nastavlja sam.'], en: ['Many PDFs at once', 'Text PDFs right away, scanned ones via Gemini — the queue continues by itself.'] },
    { i: '↺', sr: ['Dobrodošao nazad', 'Posle brisanja podataka sve se vraća sa Google Drive-a, i Gemini ključ.'], en: ['Welcome back', 'After clearing data everything comes back from Google Drive, including the Gemini key.'] },
    { i: '🔄', sr: ['Sinhronizacija podrazumevano', 'Povezivanje Google naloga uključuje sinhronizaciju na svakom uređaju.'], en: ['Sync by default', 'Connecting your Google account turns on sync on every device.'] },
  ] },
  { v: '1.69', date: '2026-11-08', items: [
    { i: '★', sr: ['Gitara je sada MARLI', 'Melodija, Akordi, Ritam, Ljubav, Inspiracija — novo ime, ikonica i uvodna animacija.'], en: ['Gitara is now MARLI', 'Melody, Accords, Rhythm, Love, Inspiration — new name, icon and intro.'] },
  ] },
];
const SEEN = 'marli-seen-ver';
export const major = (v) => String(v).split('.').slice(0, 2).join('.');
export const unseen = () => { try { return localStorage.getItem(SEEN) !== major(APP_VERSION); } catch { return false; } };
export const markSeen = () => { try { localStorage.setItem(SEEN, major(APP_VERSION)); } catch {} document.querySelectorAll('.wn-dot').forEach((d) => d.remove()); };
export const moreUrl = (v = major(APP_VERSION)) => 'docs/novosti/' + (getLang() === 'en' ? '?lang=en' : '') + '#v' + v;

/** Panel „Šta je novo u X“ (najnovija verzija, ranije na dodir). */
export async function showWhatsNew(all = false) {
  const en = getLang() === 'en';
  const list = all ? NOTES : NOTES.slice(0, 1);
  const html = list.map((n) => `<div class="wn-ver">${all ? `<div class="wn-vh">MARLI ${esc(n.v)}</div>` : ''}${n.items.map((x) => { const [a, b] = en ? x.en : x.sr; return `<div class="wn-it"><i>${esc(x.i)}</i><div><b>${esc(a)}</b><span>${esc(b)}</span></div></div>`; }).join('')}</div>`).join('');
  markSeen();
  const v = await dialog({
    title: all ? t('wn.allTitle') : t('wn.title', { v: NOTES[0].v }), html: true, className: 'wn-modal',
    body: html,
    buttons: [...(all ? [] : [{ label: t('wn.older'), value: 'older' }]), { label: t('wn.more') + ' ↗', value: 'more', kind: 'primary' }],
  });
  if (v === 'more') window.open(moreUrl(), '_blank', 'noopener');
  if (v === 'older') showWhatsNew(true);
}

/** Zlatna tačka na „Podešavanja“ posle ažuriranja (dok se „Šta je novo“ ne pogleda). */
export function navDot() {
  if (!unseen()) return;
  const a = document.querySelector('.nav a[data-tab="podesavanja"]');
  if (a && !a.querySelector('.wn-dot')) a.insertAdjacentHTML('beforeend', '<i class="wn-dot" aria-hidden="true"></i>');
}

