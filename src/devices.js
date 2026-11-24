// v2.4.4: „Uređaji“ — koji uređaji su povezani na isti Google nalog i kad je koji poslednji put sinhronizovan.
// Svaki uređaj upisuje samo svoju stavku (settings 'devices' → 'dev:<id>' u sinhronizaciji), najviše jednom u 6 sati,
// da ne pravi dodatne zahteve ka Google Drive-u.
import { t } from './i18n.js';
import { settings } from './db.js';
import { esc } from './ui.js';

const DEV_KEY = 'marli-dev', BEAT = 6 * 3600e3;
export const myId = () => { try { let d = localStorage.getItem(DEV_KEY); if (!d) { d = 'd' + Math.random().toString(36).slice(2, 10); localStorage.setItem(DEV_KEY, d); } return d; } catch { return 'd0'; } };
export function deviceName(ua = navigator.userAgent || '') {
  const touch = navigator.maxTouchPoints > 1;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? t('dev.androidPhone') : t('dev.androidTab');
  if (/Windows/.test(ua)) return t('dev.win');
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Linux/.test(ua)) return t('dev.linux');
  return t('dev.other');
}
/** Posle uspešne sinhronizacije: osveži svoju stavku (najviše jednom u 6 h). */
export async function beat({ force = false } = {}) {
  const id = myId(), list = (await settings.get('devices', [])) || [];
  const me = list.find((x) => x && x.id === id);
  if (!force && me && Date.now() - (me.at || 0) < BEAT) return false;
  const { APP_VERSION } = await import('./version.js');
  const row = { id, name: deviceName(), at: Date.now(), ver: APP_VERSION, inst: !!(matchMedia('(display-mode: standalone)').matches || navigator.standalone) };
  await settings.set('devices', [...list.filter((x) => x && x.id !== id), row].slice(-20));
  return true;
}
const ago = (ts) => { const m = Math.round((Date.now() - ts) / 60000); if (m < 2) return t('dev.now'); if (m < 60) return t('dev.min', { n: m }); const h = Math.round(m / 60); if (h < 36) return t('dev.h', { n: h }); return t('dev.d', { n: Math.round(h / 24) }); };
/** Spisak za Podešavanja → Sinhronizacija. */
export async function listHTML() {
  const id = myId(); const list = ((await settings.get('devices', [])) || []).filter((x) => x && x.id).sort((a, b) => (b.id === id) - (a.id === id) || (b.at || 0) - (a.at || 0));
  if (!list.length) return '';
  return `<div class="dev-list"><h4 class="dev-h">${esc(t('dev.title'))}</h4>${list.map((d) => `<div class="dev-row${d.id === id ? ' me' : ''}"><span class="dev-ic">${/iPhone|telefon|phone/i.test(d.name) ? '📱' : /iPad|tablet/i.test(d.name) ? '📲' : '💻'}</span><span><b>${esc(d.name || t('dev.other'))}${d.id === id ? ` <em>${esc(t('dev.this'))}</em>` : ''}</b><small>${esc(t('dev.last', { w: ago(d.at || 0) }))}${d.ver ? ' · MARLI ' + esc(d.ver) : ''}</small></span></div>`).join('')}<p class="muted small">${esc(t('dev.note'))}</p></div>`;
}
