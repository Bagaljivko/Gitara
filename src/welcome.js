// v1.74: prvi put na ovom uređaju (nov telefon, računar ili obrisani podaci): „Dobrodošao u MARLI“.
//  • „Prvi put sam ovde“ → kratak obilazak (kao ranije).
//  • „Poveži Google nalog“ → jedna prijava vraća sve: pesme, set liste, podešavanja, Vežbe, statistiku i Gemini ključ
//    (sinhronizacija), a zatim se Drive sam pretraži za rezervne kopije i ponudi se novija (backups.offerAfterConnect).
import { t } from './i18n.js';
import { dialog, toast } from './ui.js';

export async function firstRunWelcome() {
  if (document.querySelector('.welcome-modal, .tour-backdrop')) return;
  const v = await dialog({ title: t('wel.title'), html: true, className: 'welcome-modal', dismissible: false,
    body: `<div class="wel-ico"><img src="icons/marli-192.png" alt="" width="72" height="72"></div>
      <p>${t('wel.body')}</p>
      <ul class="wel-list"><li>${t('wel.l1')}</li><li>${t('wel.l2')}</li><li>${t('wel.l3')}</li></ul>`,
    buttons: [{ label: t('wel.new'), value: 'new' }, { label: t('wel.connect'), value: 'connect', kind: 'primary' }] });
  if (v === 'connect') {
    try { localStorage.setItem('gitara-tour', '1'); } catch {} // vraća se korisnik — bez obilaska
    try { const { connectSync } = await import('./sync.js'); if (await connectSync()) return; }
    catch (e) { if (e && e.code !== 'cancelled') toast((e && e.message) || t('common.error'), 'error'); }
    return;
  }
  const m = await import('./tour2.js'); // v2.3.2: novi obilazak (telefon / računar)
  if (!m.tourSeen()) m.startTour('first');
}
