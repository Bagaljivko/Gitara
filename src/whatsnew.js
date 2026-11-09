// v1.70: „Šta je novo“ — kratak pregled po verziji (Podešavanja → O aplikaciji). „Saznaj više“ otvara stranicu sa
// detaljima i snimcima ekrana (docs/novosti/). Posle ažuriranja zlatna tačka (na „Podešavanja“ i pored dugmeta) dok se ne pogleda.
import { t, getLang } from './i18n.js';
import { esc, dialog } from './ui.js';
import { APP_VERSION } from './version.js';

export const NOTES = [
  { v: '1.85', date: '2026-11-09', items: [
    { i: '🛡', sr: ['Rezervna kopija svaki dan — sama', 'Kad je Google nalog povezan, MARLI jednom dnevno sam sačuva celu aplikaciju na tvoj Google Drive (samo ako se nešto promenilo). Čuva se poslednjih 7 dana + po jedna za 4 nedelje; „Vrati sve“ nudi izbor datuma. Podrazumevano uključeno (Podešavanja → Rezervne kopije).'], en: ['A backup every day — by itself', 'With a Google account connected, MARLI saves the whole app to your Google Drive once a day (only if something changed). It keeps the last 7 days + one for each of 4 weeks; “Restore all” lets you pick the date. On by default (Settings → Backups).'] },
  ] },
  { v: '1.84', date: '2026-11-09', items: [
    { i: '📈', sr: ['Napredak porukom — bez Google naloga', 'Učenik bira kako nastavnik vidi napredak: automatski (Google nalog) ili porukom — jednim dodirom šalje brojeve ove nedelje, a Vežbe ga podsete jednom nedeljno. Dobro za decu, kod kojih Google traži roditelja ili ne dozvoljava pristup.'], en: ['Progress by message — no Google account', 'Students choose how their teacher sees progress: automatically (Google account) or by message — this week’s numbers in one tap, with a weekly reminder in Practice. Good for children, where Google asks a parent or doesn’t allow access.'] },
    { i: '🔐', sr: ['Google prijava više ne „zamrzne“', 'Ako se Google prozor ne javi (npr. posle roditeljevog odobrenja), MARLI prestane da čeka i ponudi „Pokušaj ponovo“ ili „Pošalji porukom“. Veza sa nastavnikom ostaje; dijagnostika beleži šta je Google odgovorio.'], en: ['Google sign-in no longer “freezes”', 'If Google’s window doesn’t answer (e.g. after a parent’s approval), MARLI stops waiting and offers “Try again” or “Send by message”. The teacher connection stays; diagnostics record what Google answered.'] },
  ] },
  { v: '1.83', date: '2026-11-09', items: [
    { i: '🎯', sr: ['Zadaci od nastavnika', 'Nastavnik predlaže vežbu (igra, deo pesme, skala ili nova pesma) sa ciljem, npr. „4 runde“ ili „najmanje 80%“. Učenik je vidi na vrhu Vežbi i zadatak se sam štiklira kad ga odvežba.'], en: ['Tasks from your teacher', 'Your teacher suggests practice (a game, song part, scale or new song) with a goal, e.g. “4 rounds” or “at least 80%”. You see it at the top of Practice, and it ticks itself once you’ve done it.'] },
    { i: '🗓', sr: ['Plan učenja po nedeljama', 'Gotovi planovi („Prvi akordi i prva pesma“, „Ritam i trzanje“, „Prsti i skale“) ili svoj. Sledeća nedelja se otvara kad su svi zadaci urađeni ili kad je nastavnik označi na času. Na računaru se zadaci prevlače mišem.'], en: ['Weekly learning plan', 'Ready-made plans (“First chords and first song”, “Rhythm and strumming”, “Fingers and scales”) or your own. The next week opens when all tasks are done or when the teacher marks it at the lesson. On computers, drag tasks with the mouse.'] },
  ] },
  { v: '1.82', date: '2026-11-09', items: [
    { i: '✏️', sr: ['Brza izmena akorda (samo na računaru)', 'Klikni akord u pesmi i promeni ga, pomeri ili ukloni; „+“ iznad teksta dodaje akord, dvoklik na red menja tekst. Sve se odmah čuva, Ctrl+Z poništava.'], en: ['Quick chord fixes (computers only)', 'Click a chord in the song to change, move or remove it; “+” above the lyrics adds a chord, double-click a line to edit the words. Saved right away, Ctrl+Z undoes.'] },
    { i: '🖥', sr: ['Uređivač: tekst i pregled (samo na računaru)', 'Tekst levo, pesma kako će izgledati desno; transponuj, pronađi i zameni, Ctrl+S čuva, nesačuvane izmene se pamte. Umesto „⋯“ traka Uredi · Uz video · Lakša verzija · Podeli, a desni klik na pesmu u spisku otvara meni. Telefon i tablet bez promene.'], en: ['Editor: text and preview (computers only)', 'Text on the left, the song as it will look on the right; transpose, find and replace, Ctrl+S saves, unsaved changes are kept. Instead of “⋯” a bar Edit · Play-along · Easier version · Share, and right-click on a song in the list opens a menu. Phones and tablets unchanged.'] },
  ] },
  { v: '1.81', date: '2026-11-09', items: [
    { i: '🎓', sr: ['Učenici kao prva kartica', 'Na računaru nastavnik ima karticu „Učenici“ na prvom mestu u meniju, sa brojem otvorenih zahteva. Na telefonu je sve isto (Učenici su u Pesmama).'], en: ['Students as the first tab', 'On computers, teachers get a “Students” tab first in the menu, with the number of open requests. Phones stay the same (Students are under Songs).'] },
  ] },
  { v: '1.80', date: '2026-11-09', items: [
    { i: '📈', sr: ['Napredak za nastavnika', 'Učenik može da uključi „Deli napredak“ (podrazumevano isključeno): nastavnik vidi samo brojeve — koliko se vežba, dane zaredom, igre i pesme iz „Delova pesme“. Bez pesama i snimaka; isključi i fajl se briše.'], en: ['Progress for your teacher', 'A student can turn on “Share progress” (off by default): the teacher sees numbers only — practice time, days in a row, games and Song parts songs. No songs or recordings; turn it off and the file is deleted.'] },
    { i: '🔍', sr: ['Proveri sa nastavnikom', 'U ⋯ svake pesme: nastavnik je ispravi i vrati, pošalje svoju verziju, sačuva kopiju ili kaže „u redu je“. Ispravka zameni tvoju pesmu tek kad potvrdiš — stara ostaje u Prethodnim verzijama.'], en: ['Check with teacher', 'In every song’s ⋯: your teacher corrects it and sends it back, sends their version, keeps a copy or says it’s fine. A correction replaces your song only when you confirm — the old one stays in Previous versions.'] },
  ] },
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

