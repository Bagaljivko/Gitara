// v1.70: „Šta je novo“ — kratak pregled po verziji (Podešavanja → O aplikaciji). „Saznaj više“ otvara stranicu sa
// detaljima i snimcima ekrana (docs/novosti/). Posle ažuriranja zlatna tačka (na „Podešavanja“ i pored dugmeta) dok se ne pogleda.
import { t, getLang } from './i18n.js';
import { esc, dialog } from './ui.js';
import { APP_VERSION } from './version.js';

export const NOTES = [
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
