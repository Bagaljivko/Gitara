// v1.70: „Šta je novo“ — kratak pregled po verziji (Podešavanja → O aplikaciji). „Saznaj više“ otvara stranicu sa
// detaljima i snimcima ekrana (docs/novosti/). Posle ažuriranja zlatna tačka (na „Podešavanja“ i pored dugmeta) dok se ne pogleda.
import { t, getLang } from './i18n.js';
import { esc, dialog } from './ui.js';
import { APP_VERSION } from './version.js';

export const NOTES = [
  { v: '1.97', date: '2026-11-11', items: [
    { i: '🥁', sr: ['Ritam u Promeni akorda', '„Samo na 1“ ili obrazac udaranja (folk, pop, rok, balada, rege…) za ceo niz — ili „Ritam po akordu“: svaki akord svoj obrazac. Akord se proverava na prvom udarcu, ostali udarci na vreme.'], en: ['Rhythm in Chord changes', '“Only on 1” or a strumming pattern (folk, pop, rock, ballad, reggae…) for the whole sequence — or “Rhythm per chord”: each chord its own pattern. The chord is checked on the first strum, the other strums for timing.'] },
    { i: '💾', sr: ['Moje vežbe', '„Sačuvaj kao vežbu“ — niz, trajanja i ritam ostaju pod imenom, u Vežbama na vrhu, na svim tvojim uređajima. „Iz pesme…“ pravi niz od strofe ili refrena tvoje pesme.'], en: ['My exercises', '“Save as exercise” — the sequence, lengths and rhythm are kept under a name, at the top of Practice, on all your devices. “From a song…” builds a sequence from a verse or chorus of your song.'] },
    { i: '👩‍🏫', sr: ['Nastavnik šalje vežbu', '„Pošalji učeniku“ uz cilj (npr. 3 čiste runde na 90 BPM) — učenik je dobije sam u Moje vežbe, uz 🔔. Ako je promeni, čuva se kao njegova kopija; tvoja ostaje ista.'], en: ['Teachers send exercises', '“Send to a student” with a goal (e.g. 3 clean rounds at 90 BPM) — the student gets it automatically in My exercises, with a 🔔. If they change it, it is saved as their copy; yours stays the same.'] },
  ] },
  { v: '1.96', date: '2026-11-11', items: [
    { i: '🎸', sr: ['Promena akorda: bilo koji akordi', 'Koliko god akorda, redom, svaki sa svojim trajanjem (½, 1 ili 2 takta). „+ akord“: kucaj bilo koji akord (Cadd9, Hm, D/F#…), izaberi iz tona ili iz svojih pesama. Gotovi nizovi: G–D–Em–C, Am–F–C–G, bluz u A…'], en: ['Chord changes: any chords', 'As many chords as you like, in order, each with its own length (½, 1 or 2 bars). “+ chord”: type any chord (Cadd9, Bm, D/F#…), pick from the key or from your songs. Ready-made: G–D–Em–C, Am–F–C–G, blues in A…'] },
    { i: '🎯', sr: ['Najteža promena', 'MARLI pokaže koja promena je najteža i da savet (npr. „Prst 2 ostaje na mestu“). Posle runde: koja promena ti je bila najsporija i „Vežbaj samo X → Y“.'], en: ['Hardest change', 'MARLI shows which change is the hardest, with a tip (e.g. “Finger 2 stays put”). After a round: which change was slowest for you and “Practise only X → Y”.'] },
    { i: '👩‍🏫', sr: ['Nastavnik: svoj niz u planu', 'U „Predloži vežbu“ za Promenu akorda: gotov niz ili svoj („G Hm Em7 C“), sa ciljem. Učenik ga dobije sam i otvara baš taj niz.'], en: ['Teacher: your own sequence in the plan', 'In “Suggest practice” for Chord changes: a ready-made sequence or your own (“G Bm Em7 C”), with a goal. The student gets it automatically and it opens exactly that sequence.'] },
  ] },
  { v: '1.95', date: '2026-11-10', items: [
    { i: '🔔', sr: ['Obaveštenja', 'Zvonce gore desno (Pesme, Vežbe, Učenici, Od nastavnika; na računaru pored naloga): šta je stiglo — pesme, plan i odgovori od nastavnika, želje, snimci, provere i urađeni zadaci od učenika. Dodir vodi tačno na to mesto.'], en: ['Notifications', 'A bell at the top right (Songs, Practice, Students, From teacher; next to your account on a computer): what arrived — songs, plan and answers from your teacher, wishes, recordings, checks and finished tasks from students. A tap takes you straight there.'] },
    { i: '📳', sr: ['I na telefonu', 'U Obaveštenjima „Uključi“: sistemsko obaveštenje dok je MARLI otvoren ili u pozadini. Kad je potpuno zatvoren, sve čeka u zvoncu.'], en: ['On the phone too', 'In Notifications tap “Turn on”: a system notification while MARLI is open or in the background. When it is fully closed, everything waits in the bell.'] },
    { i: '🔗', sr: ['Bez linkova u nastavi', 'Pozivnica ostaje link ili QR; posle povezivanja sve ide kroz aplikaciju i Google Drive — nikakvi linkovi između nastavnika i učenika.'], en: ['No links in teaching', 'The invite is still a link or QR; once connected, everything goes through the app and Google Drive — no links between teacher and student.'] },
  ] },
  { v: '1.94.1', date: '2026-11-10', items: [
    { i: '✍️', sr: ['Akord posle kraja reda', 'U „Uredi akorde“ (telefon i tablet) akord može i posle poslednje reči: dodirni desno od teksta → „+ Dodaj akord“, ili prevuci akord (ili ▶) preko kraja reda. Hvala na predlogu!'], en: ['Chord after the end of a line', 'In “Edit chords” (phone and tablet) a chord can also go after the last word: tap to the right of the text → “+ Add chord”, or drag a chord (or ▶) past the end of the line. Thanks for the suggestion!'] },
  ] },
  { v: '1.94', date: '2026-11-10', items: [
    { i: '📥', sr: ['Pesme od nastavnika stižu same', 'Bez imejla i Vibera: šta nastavnik pošalje stiže pravo u aplikaciju, u „Od nastavnika“ (sa oznakom „Novo“). „Sačuvaj u…“ stavlja pesmu u bilo koji folder ili set listu.'], en: ['Songs from your teacher arrive by themselves', 'No email or Viber: what your teacher sends goes straight into the app, in “From teacher” (marked “New”). “Save to…” puts a song in any folder or set list.'] },
    { i: '📈', sr: ['Napredak, želje i snimci — automatski', 'Pri prihvatanju pozivnice „Deli napredak“ je uključeno. Želje, „Imaš li ovu pesmu?“, „Proveri sa nastavnikom“ i snimci stižu nastavniku sami. Potreban je Google nalog — za decu ga odobrava roditelj.'], en: ['Progress, wishes and recordings — automatic', 'When you accept an invite, “Share progress” is on. Wishes, “Do you have this song?”, “Check with teacher” and recordings reach the teacher by themselves. A Google account is needed — for kids a parent approves.'] },
    { i: '▦', sr: ['QR u oba smera', 'Prvi put: učenik skenira nastavnikov QR, pa pokaže svoj QR nastavniku. Za časove preko interneta ostaje „Kopiraj link“. Učenici povezani ranije treba jednom da skeniraju novi QR.'], en: ['QR both ways', 'First time: the student scans the teacher’s QR, then shows their own QR to the teacher. For online lessons there is still “Copy link”. Students connected earlier need to scan the new QR once.'] },
  ] },
  { v: '1.93', date: '2026-11-10', items: [
    { i: '🛡', sr: ['Pouzdanije čuvanje', 'Kad telefon posle dugog rada u pozadini sam zatvori bazu, MARLI je sada odmah ponovo otvori — čuvanje pesama i podešavanja više ne zakaže do ponovnog pokretanja.'], en: ['More reliable saving', 'When the phone closes the database after a long time in the background, MARLI now reopens it at once — saving songs and settings no longer fails until a restart.'] },
    { i: '▦', sr: ['„Podeli MARLI“ opet lepo izgleda', 'QR kod u „Podeli MARLI“ (Podešavanja, gore desno) je na telefonu izlazio iz okvira — ispravljeno.'], en: ['“Share MARLI” looks right again', 'The QR code in “Share MARLI” (Settings, top right) spilled out of its frame on phones — fixed.'] },
    { i: '🧹', sr: ['Mirnija dijagnostika', 'Bezopasna upozorenja pregledača se više ne beleže kao greške, a Google prijava bez interneta nikad ne obara pokretanje aplikacije.'], en: ['Quieter diagnostics', 'Harmless browser warnings are no longer logged as errors, and Google sign-in without internet never stops the app from starting.'] },
  ] },
  { v: '1.92', date: '2026-11-10', items: [
    { i: '▦', sr: ['QR pozivnica', 'Učenik je pored tebe? Pokaži QR (stranica učenika ili posle „Nov učenik“) — učenik ga skenira kamerom telefona i odmah prihvata. Link porukom i dalje radi.'], en: ['QR invite', 'Student sitting next to you? Show the QR (student page or after “New student”) — the student scans it with the phone camera and accepts right away. The link by message still works.'] },
    { i: '↗', sr: ['Pošalji više pesama odjednom (telefon i tablet)', 'Podešavanja → Nastava → Učenici → „Pošalji pesme“: označi pesme, izaberi učenike, pošalji. Vidiš i šta je već poslato. Na telefonu i tabletu nastava je samo slanje, QR i plan (označi nedelju) — pregled je na računaru.'], en: ['Send several songs at once (phone and tablet)', 'Settings → Teaching → Students → “Send songs”: tick songs, pick students, send. You also see what was already sent. On phone and tablet, teaching is just sending, QR and the plan (mark the week) — the overview is on the computer.'] },
    { i: '💻', sr: ['Računar: Poslate pesme', 'U pregledu Učenika sve poslate pesme (ko, kad), filter po učeniku i mesecu; izaberi pesme → „Napravi set listu“ ili „Pošalji drugom učeniku“. „Moji podaci“ za ime i kontakt.'], en: ['Computer: Sent songs', 'In the Students overview, all sent songs (who, when), filter by student and month; pick songs → “Make a set list” or “Send to another student”. “My details” for name and contact.'] },
  ] },
  { v: '1.91', date: '2026-11-10', items: [
    { i: '🎸', sr: ['Lakša verzija u Podešavanjima pesme', 'Prekidač odmah ispod Kapodastera: isti zvuk, lakši hvatovi uz kapodaster (npr. F → kapo 3, samo D, Hm, G, A). I dalje je i u „⋯“.'], en: ['Easier version in Song settings', 'A switch right under Capo: same sound, easier shapes with a capo (e.g. F → capo 3, only D, Bm, G, A). Still in “⋯” too.'] },
    { i: '▶️', sr: ['Jasniji „⋯“ meni', '„Poslušaj“ u meniju je sada „Snimak sa YouTube-a“, da se ne meša sa dugmetom „Poslušaj“ (zvuk gitare) dole desno.'], en: ['Clearer “⋯” menu', '“Listen” in the menu is now “YouTube recording”, so it isn’t confused with the “Listen” button (guitar sound) at the bottom right.'] },
  ] },
  { v: '1.90', date: '2026-11-10', items: [
    { i: '⚡', sr: ['Brže i lakše na starijim telefonima', 'Otvorene pesme se više ne gomilaju u memoriji — posle mnogo pesama (npr. ceo nastup) aplikacija ostaje jednako brza. Telefon i tablet pri pokretanju učitavaju manje (bez delova samo za računar).'], en: ['Faster and lighter on older phones', 'Opened songs no longer pile up in memory — after many songs (e.g. a whole gig) the app stays just as fast. Phones and tablets load less at startup (no computer-only parts).'] },
  ] },
  { v: '1.89', date: '2026-11-10', items: [
    { i: '✍️', sr: ['Akordi prstom (telefon i tablet)', '⋯ ili „Podešavanja pesme“ → „Uredi akorde“ (ili dug pritisak na akord). Prevuci akord levo-desno — lupa pokazuje slovo ispod prsta. Dodir na akord otvara izbor (akordi iz pesme, osnova, vrsta, ◀ ▶, Ukloni), a ‹ › vode na prethodni/sledeći akord bez zatvaranja. Dodir na slovo dodaje akord, ✎ ispravlja tekst reda. Sve se odmah čuva, „Poništi“ vraća korak po korak.'], en: ['Chords by finger (phone and tablet)', '⋯ or “Song settings” → “Edit chords” (or long-press a chord). Drag a chord left or right — a magnifier shows the letter under your finger. Tap a chord to pick another (song chords, root, type, ◀ ▶, Remove); ‹ › go to the previous/next chord without closing. Tap a letter to add a chord, ✎ fixes a line. Everything saves at once, “Undo” steps back.'] },
    { i: '🖥', sr: ['Računar: traka pesme', 'Kad je prozor uži, traka (Uredi · Poslušaj · Uz video · …) prelazi u drugi red umesto da se sakrije iza dijagrama.'], en: ['Computer: song toolbar', 'In a narrower window the toolbar (Edit · Listen · Play along · …) wraps to a second row instead of hiding behind the diagrams.'] },
  ] },
  { v: '1.88', date: '2026-11-10', items: [
    { i: '🎵', sr: ['Mirniji ekran pesme (telefon i tablet)', 'Ispod naslova jedan red: Ton · Kapo · BPM · ritam. Dodir otvara „Podešavanja pesme“ — ton, kapodaster, tempo, ritam, veličina teksta, Uz video i vežbanje na jednom mestu. Ostaje samo tekst i akordi.'], en: ['A calmer song screen (phone and tablet)', 'One line under the title: Key · Capo · BPM · rhythm. Tap it for “Song settings” — key, capo, tempo, rhythm, text size, play along and practice in one place. Just lyrics and chords remain.'] },
    { i: '▶️', sr: ['Poslušaj · Skroluj + mali plejer', 'Dole desno: „Poslušaj“ (pesma svira, tekst ide sam) i „Skroluj“ (ti sviraš). Dok svira — mali plejer sa delom pesme, vremenom, ❚❚ i ✕; dodir na naziv za tempo i deo. PDF i Podeli su na kraju pesme i u „⋯“.'], en: ['Listen · Scroll + mini player', 'Bottom right: “Listen” (the song plays, lyrics follow) and “Scroll” (you play). While playing — a mini player with the part, time, ❚❚ and ✕; tap the name for speed and part. PDF and Share are at the end of the song and in “⋯”.'] },
    { i: '🖥', sr: ['Računar', 'Traka dobija „Poslušaj“, a „Podeli ▾“ nudi link ili PDF. Kontrole ostaju kao pre.'], en: ['Computer', 'The toolbar gets “Listen”, and “Share ▾” offers a link or PDF. Controls stay as before.'] },
  ] },
  { v: '1.87', date: '2026-11-10', items: [
    { i: '📲', sr: ['Lakše instaliranje (telefon i tablet)', 'MARLI kratko predloži da ga instaliraš — posle ~20 s ili posle dobrog trenutka (nova pesma, završena runda, prihvaćena pozivnica), najviše par puta i nikad dok sviraš. Link otvoren u Viberu, WhatsApp-u ili Instagramu nudi „Otvori u Chrome-u / Safariju“. Na računaru samo u Podešavanjima.'], en: ['Easier installing (phone and tablet)', 'MARLI briefly suggests installing — after ~20 s or after a good moment (new song, finished round, accepted invite), only a few times and never while you play. A link opened in Viber, WhatsApp or Instagram offers “Open in Chrome / Safari”. On computers only in Settings.'] },
    { i: '🖨', sr: ['QR kartica za učenike', 'Učenici → „QR kartica za učenike“: list za štampu sa QR kodom i tri koraka za instalaciju. Pozivnica sada savetuje Chrome/Safari i instalaciju.'], en: ['QR card for students', 'Students → “QR card for students”: a printable sheet with a QR code and three install steps. Invites now suggest Chrome/Safari and installing.'] },
  ] },
  { v: '1.86', date: '2026-11-09', items: [
    { i: '📱', sr: ['Tablet: sređen izgled', 'Uspravno: stranice Podešavanja preko cele širine (ne više u gornjem levom uglu), malo veći tekst i razmaci. Položeno: Podešavanja kao na računaru — spisak levo, stranica desno. „O aplikaciji“ uredno centrirano. Telefon i računar isti.'], en: ['Tablet: tidier layout', 'Portrait: Settings pages use the full width (no longer stuck in the top-left corner), slightly larger text and spacing. Landscape: Settings like on a computer — list on the left, page on the right. “About” neatly centred. Phones and computers unchanged.'] },
    { i: '🔊', sr: ['Čistiji zvuk akorda', 'Lakši odjek sobe i malo tiše — manje posla za telefon, da akord ne „pucketa“ dok zvuči (na slabijim telefonima).'], en: ['Cleaner chord sound', 'A lighter room echo and slightly lower level — less work for the phone, so a ringing chord doesn’t crackle (on weaker phones).'] },
    { i: '🛡', sr: ['Rezervna kopija čuva i nastavu', 'Dnevna i ručna kopija sada čuvaju i oznake na pesmama i snimcima (za kog učenika, od nastavnika); vraćanje vraća sve veze, planove i zahteve. Kopija se pravi samo u mirnom trenutku — nikad tokom igre, snimanja ili sviranja.'], en: ['Backups keep your teaching too', 'Daily and manual backups now also keep the labels on songs and recordings (for which student, from the teacher); restoring brings back every connection, plan and request. The backup runs only at a calm moment — never during a game, recording or playback.'] },
  ] },
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

