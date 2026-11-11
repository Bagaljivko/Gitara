// v1.99.4: računar — Tuner u dve kartice (merač levo, glava gitare desno). Ovde samo dodaci u zaglavlju:
// kratak opis i čipovi „štimovanje“ / „A4“ (dodir otvara podešavanja tunera). Kod tunera se ne menja —
// raspored je samo CSS (body.desk-shell), a čipovi čitaju ista podešavanja ('tuning', 'a4').
// Učitava se samo na velikom ekranu sa mišem (iz deskShell.js).
import { t } from './i18n.js';
import { esc } from './ui.js';
import { settings, events } from './db.js';
import { tuningOf, cleanTuning } from './tunings.js';
import { dn } from './naming.js';

async function chips() {
  const tu = cleanTuning(await settings.get('tuning', 'standard'));
  const a4 = Number(await settings.get('a4', 440)) || 440;
  return { tuning: `${t('tuning.' + tu)} · ${tuningOf(tu).names.map((n) => dn(n)).join(' ')}`, a4: `A4 = ${a4} Hz` };
}
async function paint() {
  const h = document.querySelector('.tuner-view .tuner-head'); if (!h) return;
  if (!h.querySelector('.dtu-sub')) {
    h.querySelector('h1')?.insertAdjacentHTML('afterend', `<span class="dtu-sub">${esc(t('dtu.sub'))}</span>`);
    h.querySelector('.auto-switch')?.insertAdjacentHTML('beforebegin', `<button type="button" class="dtu-chip" data-dtu="tuning" title="${esc(t('dtu.change'))}"></button><button type="button" class="dtu-chip" data-dtu="a4" title="${esc(t('dtu.change'))}"></button>`);
    h.addEventListener('click', (e) => { if (e.target.closest('[data-dtu]')) document.getElementById('tSet')?.click(); });
  }
  const c = await chips();
  const a = h.querySelector('[data-dtu="tuning"]'), b = h.querySelector('[data-dtu="a4"]');
  if (a) a.textContent = c.tuning; if (b) b.textContent = c.a4;
}
let inited = false;
export function initDeskTuner() {
  if (inited) return; inited = true;
  const later = () => setTimeout(() => paint().catch(() => {}), 0);
  const app = document.getElementById('app');
  if (app) new MutationObserver(later).observe(app, { childList: true });
  addEventListener('hashchange', later);
  events.addEventListener('settings-changed', (e) => { if (['tuning', 'a4', 'noteNames', 'lang'].includes(e.detail)) later(); });
  import('./i18n.js').then((m) => m.onLangChange?.(() => { document.querySelectorAll('.dtu-sub, .dtu-chip').forEach((x) => x.remove()); later(); })).catch(() => {});
  later();
}
