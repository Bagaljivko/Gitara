// v2.4.3: podsetnik za vežbanje — svaki dan u izabrano vreme, samo ako danas još nisi vežbao/svirao.
// Dok je aplikacija otvorena: tačno u to vreme (zvonce + sistemsko obaveštenje ako je dozvoljeno).
// Pri otvaranju posle tog vremena: jednom u zvonce. Instalirana aplikacija na Androidu (Chrome): i kad je zatvorena,
// preko „periodične sinhronizacije“ service worker-a — pregledač sam bira kada (zato ne baš u minut).
import { t } from './i18n.js';
import { settings } from './db.js';
import { esc, dialog, toast } from './ui.js';

const KEY = 'remindCfg'; // po uređaju (obaveštenja su po uređaju) — ne sinhronizuje se
const SHOWN = 'marli-remind-shown';
const pad = (n) => String(n).padStart(2, '0');
const num = (v, d, max) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? Math.floor(n) : d; }; // 0 (ponoć) je ispravno vreme
export async function getCfg() { const c = await settings.get(KEY, null); return c && typeof c === 'object' ? { on: !!c.on, h: num(c.h, 18, 23), m: num(c.m, 0, 59) } : { on: false, h: 18, m: 0 }; }
export const timeText = (c) => `${c.h}:${pad(c.m)}`;

async function practicedToday() {
  const A = await import('./activity.js'); const tot = await A.loadTotals(); const v = tot.days[String(A.dayNum())];
  return !!v && (v.p + v.x) >= 60000;
}
const todayKey = () => new Date().toISOString().slice(0, 10);
function due(c, now = new Date()) { return now.getHours() * 60 + now.getMinutes() >= c.h * 60 + c.m; }

async function fire() {
  try { if (localStorage.getItem(SHOWN) === todayKey()) return; } catch {}
  if (await practicedToday()) return;
  try { localStorage.setItem(SHOWN, todayKey()); } catch {}
  const N = await import('./notify.js');
  await N.add({ id: 'remind:' + todayKey(), who: '♪', c: '#f5a524', t: t('rem.nt'), s: t('rem.ntSub'), href: '#/vezbe' });
  if (!document.hidden && N.osOn && N.osOn()) { try { const reg = await navigator.serviceWorker?.getRegistration(); reg?.showNotification?.(t('rem.nt'), { body: t('rem.ntSub'), tag: 'remind', icon: 'icons/icon-192.png', data: { href: '#/vezbe' } }); } catch {} }
}

let timer = 0;
/** Pokreće se pri pokretanju aplikacije i posle svake promene podešavanja. */
export async function initRemind() {
  clearTimeout(timer);
  const c = await getCfg();
  writeForSW(c).catch(() => {}); // u pozadini — nikad ne sme da zaustavi podsetnik (npr. bez service worker-a)
  if (!c.on) return;
  if (due(c)) { fire().catch(() => {}); return; }
  const now = new Date(), at = new Date(now); at.setHours(c.h, c.m, 0, 0);
  timer = setTimeout(() => fire().catch(() => {}), Math.min(at - now, 2 ** 31 - 1));
}
/** Service worker (zatvorena aplikacija): vreme i da li je danas vežbano — u keš koji on čita. */
async function writeForSW(c) {
  if (!('caches' in window)) return;
  const body = JSON.stringify({ ...c, practiced: (await practicedToday()) ? todayKey() : '', t: t('rem.nt'), s: t('rem.ntSub') });
  const cache = await caches.open('marli-meta'); await cache.put('./__remind', new Response(body, { headers: { 'content-type': 'application/json' } }));
  if (c.on) { try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg && reg.periodicSync) await reg.periodicSync.register('marli-remind', { minInterval: 6 * 3600e3 }); } catch {} } // getRegistration: ne čeka zauvek ako ga nema
}

/** Dugme na kartici „Ova nedelja“ (Vežbe). */
export async function buttonHTML() {
  const c = await getCfg();
  return `<button type="button" class="st-remind${c.on ? ' on' : ''}" id="stRemind">🔔 ${esc(c.on ? t('rem.at', { t: timeText(c) }) : t('rem.off'))}</button>`;
}
export async function openDialog() {
  const c = await getCfg();
  const p = dialog({ title: t('rem.title'), html: true, className: 'tch-dlg rem-dlg', body: `
    <p class="muted small">${esc(t('rem.body'))}</p>
    <label class="tch-lab">${esc(t('rem.time'))}</label><input type="time" id="remTime" value="${pad(c.h)}:${pad(c.m)}">
    <p class="muted small">${esc(t('rem.note'))}</p>`,
  buttons: [...(c.on ? [{ label: t('rem.turnOff'), value: 'off', kind: 'ghost' }] : []), { label: t('common.cancel'), value: null }, { label: t('rem.turnOn'), value: 'on', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  let v = `${pad(c.h)}:${pad(c.m)}`; box.querySelector('#remTime').addEventListener('input', (e) => (v = e.target.value || v));
  const r = await p;
  if (r === 'off') { await settings.set(KEY, { ...c, on: false }); await initRemind(); toast(t('rem.offDone')); return true; }
  if (r !== 'on') return false;
  const [h, m] = v.split(':').map(Number);
  await settings.set(KEY, { on: true, h: num(h, 18, 23), m: num(m, 0, 59) });
  const N = await import('./notify.js'); if (!N.osOn()) await N.setOS(true).catch(() => false); // sistemsko obaveštenje (ako dozvoliš)
  await initRemind();
  toast(t('rem.onDone', { t: `${h}:${pad(m || 0)}` }));
  return true;
}
