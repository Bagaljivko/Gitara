// v1.77: računar — nalog i sinhronizacija desno u gornjoj traci. Dodir otvara Podešavanja → nalog.
// Učitava se samo na velikom ekranu sa mišem (telefon ga nikad ne učita).
import { t } from './i18n.js';

const LS = 'gitara-sync';
const lsSync = () => { try { return JSON.parse(localStorage.getItem(LS) || 'null') || {}; } catch { return {}; } };

export function initNavAcct() {
  const el = document.getElementById('navAcct');
  if (!el) return;
  const draw = (s) => {
    const c = s || lsSync();
    const on = !!c.on, email = c.email || '';
    el.querySelector('i').textContent = (email[0] || 'M').toUpperCase();
    el.querySelector('b').textContent = on && email ? email : t('nav.acct.connect');
    let sub = t('nav.acct.off');
    if (on) { sub = t('nav.acct.on'); try { if (s && s.status) sub = ({ synced: t('sync.synced'), syncing: t('sync.syncing'), offline: t('sync.offline'), connect: t('nav.acct.reconnect'), error: t('nav.acct.reconnect') })[s.status] || sub; } catch {} }
    el.querySelector('small').textContent = sub;
    el.classList.toggle('warn', !on || (s && (s.status === 'connect' || s.status === 'error')));
    el.title = on && email ? `${email} · ${sub}` : t('nav.acct.connect');
    el.hidden = false;
  };
  draw(null);
  el.addEventListener('click', () => {
    if (location.hash !== '#/podesavanja') location.hash = '#/podesavanja';
    setTimeout(() => document.querySelector('.set-hero[data-open="drive"]')?.click(), 350);
  });
  import('./sync.js').then((m) => { if (lsSync().on) draw(m.syncState()); m.onSyncChange((s) => draw(s)); }).catch(() => {});
  import('./i18n.js').then((m) => m.onLangChange?.(() => draw(null))).catch(() => {});
}
