// v1.95: 🔔 Obaveštenja u aplikaciji — šta je stiglo kroz nastavu (sanduče / fajl napretka), bez poruka i linkova.
// Čuva se na uređaju (settings 'notes'). Zvonce se pokazuje samo nastavniku, učeniku povezanom sa nastavnikom
// ili kad ima obaveštenja. „Obaveštenja i na telefonu“ = sistemsko obaveštenje dok je aplikacija otvorena ili u
// pozadini (bez servera nema obaveštenja dok je potpuno zatvorena — tada sve čeka ovde).
import { t } from './i18n.js';
import { esc } from './ui.js';
import { settings } from './db.js';

const MAX = 100;
const LS_OS = 'marli-notify-os';
export const osOn = () => { try { return localStorage.getItem(LS_OS) === '1' && 'Notification' in window && Notification.permission === 'granted'; } catch { return false; } };

export async function list() { return ((await settings.get('notes', [])) || []).filter((n) => n && n.id); }
export async function unread() { return (await list()).filter((n) => !n.read).length; }
const changed = () => { try { dispatchEvent(new Event('marli-notes')); } catch {} };

/** Dodaj obaveštenje { id, who?, c? (boja), t: naslov, s?: detalj, href?: kuda vodi }. Isti id = ne ponavlja se. */
export async function add(n) {
  if (!n || !n.id || !n.t) return false;
  const all = await list();
  if (all.some((x) => x.id === n.id)) return false;
  const item = { id: String(n.id).slice(0, 80), t: String(n.t).slice(0, 120), s: String(n.s || '').slice(0, 160), who: String(n.who || '').slice(0, 2), c: n.c || '', href: n.href || '', at: Date.now(), read: false };
  await settings.set('notes', [item, ...all].slice(0, MAX));
  initBell(); // ako zvonce još nije uključeno (npr. prva veza u ovoj sesiji)
  changed();
  if (document.hidden && osOn()) showOS(item).catch(() => {});
  return true;
}
async function showOS(n) {
  const opts = { body: n.s, tag: n.id, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { href: n.href || '' } };
  const sw = navigator.serviceWorker; const reg = sw ? await sw.getRegistration().catch(() => null) : null;
  if (reg && reg.showNotification) return reg.showNotification(n.t, opts);
  const x = new Notification(n.t, opts); x.onclick = () => { focus(); if (n.href) location.hash = n.href; x.close(); };
}
export async function markRead(id = null) {
  const all = await list(); let any = false;
  for (const n of all) if (!n.read && (!id || n.id === id)) { n.read = true; any = true; }
  if (any) { await settings.set('notes', all); changed(); }
}
/** Uključi/isključi sistemska obaveštenja (pita pregledač za dozvolu). */
export async function setOS(on) {
  if (!on) { try { localStorage.setItem(LS_OS, '0'); } catch {} return false; }
  if (!('Notification' in window)) return false;
  let p = Notification.permission;
  if (p === 'default') { try { p = await Notification.requestPermission(); } catch { p = 'denied'; } }
  try { localStorage.setItem(LS_OS, p === 'granted' ? '1' : '0'); } catch {}
  return p === 'granted';
}

// ---------------- zvonce ----------------
const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2z"/></svg>';
async function relevant() {
  try { const tc = await settings.get('teacher', null); if ((tc && tc.on) || (await settings.get('myTeacher', null))) return true; } catch {} // bez učitavanja nastave (brže pokretanje)
  return (await list()).length > 0;
}
function bellBtn() {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'icon-btn nt-bell'; b.setAttribute('aria-label', t('nt.title'));
  b.innerHTML = BELL + '<i class="nt-badge" hidden></i>';
  b.addEventListener('click', (e) => { e.stopPropagation(); openPanel(b); });
  return b;
}
async function paint() {
  const n = await unread();
  document.querySelectorAll('.nt-bell').forEach((b) => {
    const i = b.querySelector('.nt-badge'); i.hidden = !n; i.textContent = n > 9 ? '9+' : String(n);
    b.classList.toggle('on', !!n); b.setAttribute('aria-label', n ? t('nt.titleN', { n }) : t('nt.title'));
  });
}
const DESK = () => matchMedia('(min-width: 1100px) and (hover: hover) and (pointer: fine)').matches;
// gde ide zvonce: računar = gornja traka pored naloga; telefon/tablet = zaglavlje ekrana (Pesme, Vežbe, Učenici, Od nastavnika)
async function mount() {
  if (!(await relevant())) { document.querySelectorAll('.nt-bell').forEach((b) => b.remove()); return; }
  if (DESK()) {
    const acct = document.getElementById('navAcct');
    if (acct && !acct.previousElementSibling?.classList.contains('nt-bell')) acct.before(bellBtn());
  } else {
    const h = document.querySelector('#app .lib-head .head-icons, #app .pr-hub-head, #app .tch-head');
    if (h && !h.querySelector('.nt-bell')) { const b = bellBtn(); b.classList.add('nt-in'); h.appendChild(b); }
  }
  paint();
}
let inited = false;
export function initBell() {
  if (inited) return; inited = true;
  const app = document.getElementById('app');
  let q = 0; const later = () => { cancelAnimationFrame(q); q = requestAnimationFrame(() => mount().catch(() => {})); };
  if (app) new MutationObserver(later).observe(app, { childList: true });
  addEventListener('hashchange', later);
  addEventListener('marli-notes', () => { later(); });
  later();
  // klik na sistemsko obaveštenje (sw.js šalje poruku sa adresom)
  try { navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data && e.data.type === 'marli-open' && e.data.href) location.hash = e.data.href; }); } catch {}
  // nastavnik i učenik: provera odmah kad se aplikacija otvori (sanduče / fajlovi napretka)
}

const ago = (ts) => {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return t('nt.now'); if (m < 60) return t('nt.min', { n: m });
  const d = new Date(ts), td = new Date(); const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === td.toDateString()) return t('nt.today', { t: hm });
  const y = new Date(Date.now() - 864e5); if (d.toDateString() === y.toDateString()) return t('nt.yesterday');
  return `${d.getDate()}. ${d.getMonth() + 1}.`;
};
async function openPanel(btn) {
  if (document.querySelector('.nt-wrap')) { document.querySelector('.nt-wrap').__close(); return; }
  const desk = DESK();
  const wrap = document.createElement('div');
  wrap.className = 'nt-wrap' + (desk ? ' desk' : ' modal-backdrop sheet-backdrop');
  const draw = async () => {
    const all = await list();
    const nw = all.filter((n) => !n.read), old = all.filter((n) => n.read).slice(0, 30);
    const row = (n) => `<button type="button" class="nt-row${n.read ? '' : ' new'}" data-id="${esc(n.id)}"><span class="nt-av" style="${n.c ? `--c:${esc(n.c)}` : ''}">${esc(n.who || '•')}</span><span class="nt-tx"><b>${esc(n.t)}</b><small>${esc([n.s, ago(n.at)].filter(Boolean).join(' · '))}</small></span>${n.read ? '' : '<span class="nt-dot"></span>'}</button>`;
    const os = 'Notification' in window;
    wrap.querySelector('.nt-body').innerHTML = `${!all.length ? `<p class="muted nt-empty">${esc(t('nt.empty'))}</p>` : ''}
      ${nw.length ? `<div class="nt-lbl">${esc(t('nt.new'))}</div>${nw.map(row).join('')}` : ''}${old.length ? `<div class="nt-lbl">${esc(t('nt.earlier'))}</div>${old.map(row).join('')}` : ''}
      ${os ? `<div class="nt-os"><span class="nt-os-ic">📳</span><span><b>${esc(t('nt.os'))}</b><small>${esc(t(osOn() ? 'nt.osOn' : Notification.permission === 'denied' ? 'nt.osDenied' : 'nt.osSub'))}</small></span>${Notification.permission === 'denied' ? '' : `<button type="button" class="${osOn() ? 'linkish' : 'btn small primary'}" data-nt="os">${esc(t(osOn() ? 'nt.osOff' : 'nt.osOnBtn'))}</button>`}</div>` : ''}`;
    wrap.querySelector('[data-nt="all"]').hidden = !nw.length;
  };
  wrap.innerHTML = `<div class="${desk ? 'nt-dd' : 'sheet nt-sheet'}" role="dialog" aria-modal="${desk ? 'false' : 'true'}" aria-label="${esc(t('nt.title'))}">${desk ? '' : '<div class="sheet-grip"></div>'}
    <div class="nt-head"><h2>${esc(t('nt.title'))}</h2><button type="button" class="linkish" data-nt="all">${esc(t('nt.allRead'))}</button></div><div class="nt-body"></div></div>`;
  const close = () => { wrap.remove(); removeEventListener('keydown', onKey); document.removeEventListener('click', outside, true); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const outside = (e) => { if (desk && !e.target.closest('.nt-dd') && !e.target.closest('.nt-bell')) close(); };
  wrap.__close = close;
  wrap.addEventListener('click', async (e) => {
    if (!desk && !e.target.closest('.sheet')) return close();
    const b = e.target.closest('[data-nt]');
    if (b && b.dataset.nt === 'all') { await markRead(); return draw(); }
    if (b && b.dataset.nt === 'os') { await setOS(!osOn()); return draw(); }
    const r = e.target.closest('.nt-row'); if (!r) return;
    const n = (await list()).find((x) => x.id === r.dataset.id);
    await markRead(r.dataset.id); close();
    if (n && n.href) { if (location.hash === n.href) dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = n.href; }
  });
  addEventListener('keydown', onKey); document.addEventListener('click', outside, true);
  (desk ? document.body : document.body).appendChild(wrap);
  if (desk) { const r = btn.getBoundingClientRect(); const dd = wrap.querySelector('.nt-dd'); dd.style.top = (r.bottom + 8) + 'px'; dd.style.right = Math.max(12, innerWidth - r.right - 8) + 'px'; }
  await draw();
}
