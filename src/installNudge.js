// v1.87: poziv da se MARLI instalira — samo telefon i tablet (računar: samo u Podešavanjima).
//  • Ugrađeni pregledač (Viber, WhatsApp, Instagram, Facebook, Messenger…): odmah kartica „Otvori u Chrome-u / Safariju“
//    — iz njih se aplikacija ne može instalirati.
//  • Prozor „Instaliraj MARLI“: ~20 s posle otvaranja (u mirnom trenutku) ili posle dobrog trenutka (sačuvana pesma,
//    završena runda, prihvaćena pozivnica). Najviše 3 puta, bar 3 dana razmaka; posle 2× „Ne sada“ samo tanka traka.
//  • Tanka traka pri ponovnom dolasku (2. i svaki sledeći dan) — ✕ je skriva 7 dana.
//  • Nikad tokom igre, tunera koji sluša, snimanja, sviranja pesme, seta na sceni ili otvorenog prozora.
import { t } from './i18n.js';
import { esc, dialog, toast } from './ui.js';
import { isStandalone, isIOS, isComputer, canPromptInstall, promptInstall, onInstallChange } from './install.js';

const KEY = 'marli-inst';
const DAY = 864e5;
const st = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
const save = (o) => { try { localStorage.setItem(KEY, JSON.stringify({ ...st(), ...o })); } catch {} };
const ua = () => navigator.userAgent || '';

/** Ugrađeni pregledač neke aplikacije (iz njega se ne može instalirati). */
export function inAppBrowser() {
  const u = ua();
  if (/FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|Viber|Snapchat|MicroMessenger|TikTok|musical_ly|Twitter/i.test(u)) return true;
  if (/Android/i.test(u) && /; wv\)/.test(u)) return true; // Android WebView
  if (isIOS() && /AppleWebKit/i.test(u) && !/Safari\//i.test(u) && !/CriOS|FxiOS|EdgiOS/i.test(u)) return true; // iOS ugrađeni prozor
  return false;
}
export const wanted = () => !isStandalone() && !isComputer() && !(navigator.webdriver && !globalThis.__marliTest?.install); // automatski testovi: samo kad ga test uključi

/** Da li korisnik sada nešto radi (ne prekidati). */
function busy() {
  if (document.hidden) return true;
  const h = location.hash || '';
  if (/^#\/vezbe\/[a-z]/.test(h)) return true; // igra
  if ((h === '' || h === '#/' || h.startsWith('#/tuner')) && document.getElementById('tStart')?.hidden) return true; // tuner sluša
  return !!document.querySelector('.modal-backdrop, .recording, .ch.playing, .ln.playing, body.stage-mode, .qe-pop');
}

// ---------------- prozor „Instaliraj MARLI“ ----------------
const SHARE_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 7.5 6.5l1.4 1.4L11 5.8V15h2V5.8l2.1 2.1 1.4-1.4zM5 10v11h14V10h-3v2h1v7H7v-7h1v-2z"/></svg>';
const PLUS_IC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm6 4v4H7v2h4v4h2v-4h4v-2h-4V7z"/></svg>';
function sheetBody() {
  const why = `<ul class="in-why"><li><b>${t('inst.w1')}</b><small>${t('inst.w1s')}</small></li><li><b>${t('inst.w2')}</b><small>${t('inst.w2s')}</small></li><li><b>${t('inst.w3')}</b><small>${t('inst.w3s')}</small></li></ul>`;
  const how = canPromptInstall() ? '' : isIOS()
    ? `<ol class="in-steps"><li><span class="in-ic">${SHARE_IC}</span><span>${t('inst.ios1')}</span></li><li><span class="in-ic">${PLUS_IC}</span><span>${t('inst.ios2')}</span></li></ol>`
    : `<ol class="in-steps"><li><span class="in-ic">⋮</span><span>${t('inst.and1')}</span></li><li><span class="in-ic">${PLUS_IC}</span><span>${t('inst.and2')}</span></li></ol>`;
  return `<div class="in-head"><img src="icons/icon-192.png" alt="" width="56" height="56"><div><b>MARLI</b><small>${t('inst.sub')}</small></div></div>${why}${how}`;
}
let sheetOpen = false;
/** Prikaži prozor. why: 'time' | 'moment' | 'settings'. Vraća true ako je prikazan. */
export async function showInstallSheet(why = 'time') {
  if (!wanted() || sheetOpen) return false;
  if (inAppBrowser()) { showInAppCard(true); return true; }
  sheetOpen = true;
  if (why !== 'settings') save({ n: (st().n || 0) + 1, last: Date.now() });
  const prompt = canPromptInstall();
  const v = await dialog({ title: t('inst.title'), html: true, className: 'tch-dlg dlg-stack in-dlg', body: sheetBody(),
    buttons: prompt ? [{ label: t('inst.btn'), value: 'go', kind: 'primary' }, { label: t('inst.later'), value: 'no', kind: 'ghost' }] : [{ label: t('inst.ok'), value: 'ok', kind: 'primary' }, { label: t('inst.later'), value: 'no', kind: 'ghost' }] });
  sheetOpen = false;
  if (v === 'go') { const ok = await promptInstall(); if (ok) { save({ done: Date.now() }); hideBar(); } return true; }
  if (v === 'no' || v == null) save({ no: (st().no || 0) + 1 });
  return true;
}
function sheetAllowed() {
  const s = st();
  if (s.done || (s.n || 0) >= 3 || (s.no || 0) >= 2) return false;
  return !s.last || Date.now() - s.last > 3 * DAY;
}
/** Pokušaj prikaz u mirnom trenutku (čeka do ~2 min). */
function whenCalm(fn, tries = 0) {
  if (!wanted()) return;
  if (busy()) { if (tries < 24) setTimeout(() => whenCalm(fn, tries + 1), 5000); return; }
  fn();
}

// ---------------- tanka traka (ponovni dolazak) ----------------
let bar = null;
function hideBar() { bar?.remove(); bar = null; }
function showBar() {
  if (bar || !wanted() || inAppBrowser()) return;
  const s = st();
  if (s.done || (s.barNo && Date.now() - s.barNo < 7 * DAY)) return;
  bar = document.createElement('div');
  bar.className = 'in-bar'; bar.setAttribute('role', 'note');
  bar.innerHTML = `<img src="icons/icon-192.png" alt="" width="28" height="28"><span>${t('inst.bar')}</span><button type="button" class="btn small primary" data-i="go">${t('inst.barBtn')}</button><button type="button" class="icon-btn" data-i="x" aria-label="${esc(t('common.close'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>`;
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    if (b.dataset.i === 'x') { save({ barNo: Date.now() }); hideBar(); } else showInstallSheet('settings');
  });
  document.body.appendChild(bar);
}

// ---------------- ugrađeni pregledač: „Otvori u Chrome-u / Safariju“ ----------------
let card = null;
export function showInAppCard(force = false) {
  if (card || isStandalone()) return;
  if (!force) { try { if (sessionStorage.getItem('marli-iab-x')) return; } catch {} }
  const android = /Android/i.test(ua());
  const url = location.href;
  card = document.createElement('div');
  card.className = 'in-iab'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', t('inst.iabTitle'));
  card.innerHTML = `<div class="in-iab-in"><div class="in-head"><img src="icons/icon-192.png" alt="" width="44" height="44"><div><b>${t('inst.iabTitle')}</b><small>${t(android ? 'inst.iabSubA' : 'inst.iabSubI')}</small></div></div>
    ${android ? `<button type="button" class="btn primary wide" data-c="chrome">${t('inst.iabChrome')}</button>`
      : `<ol class="in-steps"><li><span class="in-ic">⋯</span><span>${t('inst.iabI1')}</span></li><li><span class="in-ic">🧭</span><span>${t('inst.iabI2')}</span></li></ol>`}
    <div class="in-iab-row"><button type="button" class="btn" data-c="copy">${t('inst.iabCopy')}</button><button type="button" class="btn ghost-btn" data-c="x">${t('inst.iabStay')}</button></div></div>`;
  card.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    if (b.dataset.c === 'chrome') {
      const u = new URL(url);
      location.href = `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
    } else if (b.dataset.c === 'copy') {
      try { await navigator.clipboard.writeText(url); toast(t('inst.iabCopied')); } catch { toast(url); }
    } else { try { sessionStorage.setItem('marli-iab-x', '1'); } catch {} card.remove(); card = null; }
  });
  document.body.appendChild(card);
}

// ---------------- pokretanje ----------------
let inited = false;
/** Poziva main.js jednom. */
export function initInstallNudge() {
  if (inited) return; inited = true;
  if (!wanted()) return;
  if (inAppBrowser()) { setTimeout(() => showInAppCard(), 1200); return; }
  onInstallChange(() => { if (isStandalone()) { save({ done: Date.now() }); hideBar(); } });
  addEventListener('appinstalled', () => { save({ done: Date.now() }); hideBar(); });
  // dani korišćenja (za traku pri ponovnom dolasku)
  const s = st(), today = new Date().toDateString();
  if (s.day !== today) save({ day: today, days: (s.days || 0) + 1 });
  const shownAt = Date.now();
  const delay = globalThis.__marliTest?.installDelay ?? 20000;
  // 1) posle ~20 s u aplikaciji
  setTimeout(() => whenCalm(() => {
    if (sheetAllowed()) showInstallSheet('time');
    else if ((st().days || 0) >= 2) showBar();
  }), delay);
  // 2) dobri trenuci (ne pre ~20 s, i ne ako je prozor već prikazan u ovoj sesiji)
  const moment = () => {
    if (Date.now() - shownAt < delay || sheetOpen) return;
    const s2 = st(); if (s2.last && Date.now() - s2.last < 10 * 60000) return; // ne odmah posle prethodnog
    setTimeout(() => whenCalm(() => { if (sheetAllowed()) showInstallSheet('moment'); }), 1500);
  };
  addEventListener('marli-act', moment); // završena runda u Vežbama
  addEventListener('marli-song-saved', moment); // sačuvana nova pesma
  addEventListener('marli-invite-ok', () => setTimeout(() => whenCalm(() => { if (!st().done) showInstallSheet('moment'); }), 2500)); // prihvaćena pozivnica
}
