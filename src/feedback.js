// v1.76: „Pošalji utisak“ i „Pošalji dijagnostiku“ — idu u autorovu Google tabelu (Apps Script veb-aplikacija:
// kartice „Utisci“ i „Dijagnostika“). Šalje se samo ono što korisnik sam pošalje; bez pesama, ključeva i (osim ako
// v1.76: uz svaki utisak i dijagnostiku ide imejl korisnika (ako ga znamo ili ga upiše) i nasumičan ID uređaja. Bez mreže: čeka u redu na uređaju i pošalje se kasnije.
// Retko pitanje posle runde vežbe: najviše dva puta, ikad (prvi put posle prve runde „Delova pesme“ ili treće runde
// bilo koje igre; drugi put posle bar 14 dana i 5 različitih dana korišćenja) — pa nikad više.
import { t, getLang } from './i18n.js';
import { APP_VERSION } from './version.js';
import { esc, dialog, toast } from './ui.js';

export const FEEDBACK_URL = 'https://script.google.com/macros/s/AKfycbx9Uu-sO1FXPx2RLZQT0uP-Y1Qw6st7AowyorXv-otlDBNysNi55xF0WwmgSiGzcg25/exec';
const QKEY = 'marli-fb-q', AKEY = 'marli-fb-ask', MAXQ = 20;
const url = () => { try { return localStorage.getItem('marli-fb-url-test') || FEEDBACK_URL; } catch { return FEEDBACK_URL; } }; // test: lažna adresa
const rd = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/** Kratko ime uređaja: „Android · Chrome“, „iPhone · Safari“, „Windows · Edge“… (bez punog „user agent“ teksta). */
export function deviceLabel(ua = navigator.userAgent) {
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac OS X|Macintosh/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : '?';
  const br = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /OPR\//.test(ua) ? 'Opera' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '?';
  const inst = (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  return `${os} · ${br}${inst ? ' · instalirana' : ''}`;
}
const screenName = () => { const h = (location.hash || '#/').slice(0, 80); const m = /^#\/vezbe\/(\w+)/.exec(h); return m && t('pr.g.' + m[1]) !== 'pr.g.' + m[1] ? `${t('pr.g.' + m[1])} (${h})` : h; };
// Uz utisak (podrazumevano uključeno): ceo izveštaj dijagnostike, isti kao „Pošalji dijagnostiku“ — bez kraja ključa i
// bez teksta skeniranja. Ako izveštaj iz nekog razloga ne može da se napravi, bar poslednje greške.
async function techReport() {
  try { const { buildReport } = await import('./diag.js'); return (await buildReport({ share: true })).slice(0, 20000); }
  catch { return recentErrors(); }
}
function recentErrors() {
  const L = rd('gitara-diag', []).slice(-10);
  return L.map((e) => { try { return `${new Date(e.t).toISOString().slice(0, 16).replace('T', ' ')} ${e.k}${e.m ? ': ' + String(e.m).slice(0, 200) : ''}`; } catch { return ''; } }).filter(Boolean).join('\n');
}
// Ko je poslao: imejl (Google nalog sinhronizacije ili onaj koji je korisnik upisao — zapamti se) i ID uređaja
// (isti kao za statistiku; nasumičan, bez ličnih podataka) — da se zna ko je šta prijavio i da može da se odgovori.
const syncEmail = () => { try { return (JSON.parse(localStorage.getItem('gitara-sync') || '{}').email) || ''; } catch { return ''; } };
export const userEmail = () => { try { return localStorage.getItem('marli-fb-email') || syncEmail(); } catch { return syncEmail(); } };
const userId = () => { try { let d = localStorage.getItem('marli-dev'); if (!d) { d = 'd' + Math.random().toString(36).slice(2, 10); localStorage.setItem('marli-dev', d); } return d; } catch { return 'd0'; } };

// ---------------- red i slanje ----------------
export const pendingCount = () => rd(QKEY, []).length;
function enqueue(item) {
  const q = rd(QKEY, []);
  q.push({ email: userEmail(), ...item, uid: userId(), version: APP_VERSION, lang: getLang(), device: deviceLabel(), at: Date.now() });
  wr(QKEY, q.slice(-MAXQ));
  return flush();
}
let flushing = null;
/** Pošalji sve što čeka. Vraća broj poslatih. Bez mreže / greška: ostaje u redu za sledeći put. */
export function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    if (!url() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 0;
    for (;;) {
      const q = rd(QKEY, []);
      if (!q.length) break;
      const it = q[0];
      try {
        // „no-cors“: Google odgovara preusmeravanjem; dovoljno je da zahtev stigne (bez ponovnog slanja i duplikata)
        await fetch(url(), { method: 'POST', mode: 'no-cors', body: JSON.stringify(it), keepalive: JSON.stringify(it).length < 60000 });
      } catch { break; }
      wr(QKEY, rd(QKEY, []).filter((x) => x.at !== it.at));
      sent++;
    }
    return sent;
  })().finally(() => { flushing = null; });
  return flushing;
}
/** Pokretanje aplikacije: zapamti dan (za retko pitanje), pošalji ono što čeka, i opet kad se mreža vrati. */
export function initFeedback() {
  const a = rd(AKEY, { n: 0, r: 0, days: [] });
  const d = Math.floor(Date.now() / 864e5);
  if (!a.days.includes(d)) { a.days = [...a.days, d].slice(-10); wr(AKEY, a); }
  if (pendingCount()) flush();
  addEventListener('online', () => { if (pendingCount()) flush(); });
}

// ---------------- „Pošalji utisak“ ----------------
const TYPES = [['bug', '🐞'], ['idea', '💡'], ['like', '❤']];
/** Prozor za utisak. opts: { type, screen } */
export async function openFeedback({ type = 'bug', screen = '' } = {}) {
  const sw = (id, on, label, sub) => `<label class="switch fb-sw"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span class="switch-track"><span class="switch-thumb"></span></span><span><b>${label}</b><small class="muted">${sub}</small></span></label>`;
  const scr = screen || screenName();
  const em = userEmail();
  let cur = type;
  const p = dialog({ title: t('fb.title'), html: true, className: 'fb-dlg', body: `
    <p class="muted small fb-lead">${t('fb.lead')}</p>
    <div class="fb-types">${TYPES.map(([k, i]) => `<button type="button" class="chip${k === cur ? ' on' : ''}" data-fbt="${k}">${i} ${t('fb.t.' + k)}</button>`).join('')}</div>
    <textarea id="fbText" rows="4" maxlength="5000" placeholder="${esc(t('fb.ph.' + cur))}"></textarea>
    ${sw('fbTech', true, t('fb.tech'), esc(t('fb.techSub', { screen: scr.replace(/ \(#.*\)$/, ''), v: APP_VERSION, dev: deviceLabel() })))}
    <label class="fb-email"><b>${t('fb.email')}</b><small class="muted">${t('fb.emailSub')}</small>
      <input type="email" id="fbEmail" autocomplete="email" maxlength="200" placeholder="${esc(t('fb.emailPh'))}" value="${esc(em)}"></label>`,
    buttons: [{ label: t('fb.send'), value: 'send', kind: 'primary' }] });
  const box = document.querySelector('.fb-dlg');
  let vals = null;
  if (box) {
    const ta = box.querySelector('#fbText');
    box.querySelector('.fb-types').addEventListener('click', (e) => {
      const b = e.target.closest('[data-fbt]'); if (!b) return;
      cur = b.dataset.fbt;
      box.querySelectorAll('[data-fbt]').forEach((x) => x.classList.toggle('on', x === b));
      ta.placeholder = t('fb.ph.' + cur);
    });
    const read = () => { vals = { text: ta.value.trim(), tech: box.querySelector('#fbTech').checked, email: box.querySelector('#fbEmail').value.trim() }; };
    box.addEventListener('input', read); box.addEventListener('change', read); read();
    setTimeout(() => ta.focus(), 50);
  }
  const v = await p;
  if (v !== 'send' || !vals) return false;
  if (!vals.text && cur !== 'like') { toast(t('fb.empty')); return openFeedback({ type: cur, screen }); }
  if (vals.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vals.email)) { toast(t('fb.badEmail')); return openFeedback({ type: cur, screen }); }
  try { if (vals.email) localStorage.setItem('marli-fb-email', vals.email); } catch {}
  await sendFeedback({ type: cur, text: vals.text || '❤', screen: scr, tech: vals.tech, email: vals.email });
  return true;
}
/** Utisak u red (i slanje). Tehnički podaci samo ako ih korisnik ostavi uključene. */
export async function sendFeedback({ type, text = '', screen = '', tech = true, email = userEmail() }) {
  const item = { kind: 'feedback', type, text: String(text).slice(0, 5000), screen: screen || screenName(), email: String(email).slice(0, 200), tech: tech ? await techReport() : '' };
  enqueue(item); // šalje se u pozadini (bez mreže čeka u redu)
  toast(t('fb.thanks'));
}

// ---------------- „Pošalji dijagnostiku“ ----------------
export async function sendDiagnostics(note = '') {
  const { buildReport } = await import('./diag.js');
  const report = await buildReport({ share: true });
  enqueue({ kind: 'diag', note: String(note).slice(0, 1000), report: report.slice(0, 45000) });
  toast(t('fb.diagSent'));
}

// ---------------- retko pitanje posle runde ----------------
/** Posle runde vežbe: vraća { text, screen } ako treba pitati (i odmah to zapamti), inače null. */
const gameName = (id) => { const k = 'pr.g.' + id, s = t(k); return s === k ? id : s; };
export function askAfterRound(gameId) {
  const a = rd(AKEY, { n: 0, r: 0, days: [] });
  a.r = (a.r || 0) + 1;
  let ask = null;
  if (a.n === 0 && (gameId === 'pesma' || a.r >= 3)) ask = { text: t('fb.ask1', { g: gameName(gameId) }), screen: gameName(gameId) };
  else if (a.n === 1 && Date.now() - (a.at || 0) >= 14 * 864e5 && (a.days || []).length >= 5) ask = { text: t('fb.ask2'), screen: 'MARLI' };
  if (ask) { a.n += 1; a.at = Date.now(); }
  wr(AKEY, a);
  return ask;
}
/** Red sa pitanjem (👍 / 👎 / Napiši…) ispod dugmadi rezultata. */
export function askRowHTML(ask) {
  return `<div class="fb-ask" data-screen="${esc(ask.screen)}"><span>${esc(ask.text)}</span><button type="button" class="chip" data-fba="up" aria-label="👍">👍</button><button type="button" class="chip" data-fba="down" aria-label="👎">👎</button><button type="button" class="chip fb-ask-w" data-fba="write">${t('fb.write')}</button></div>`;
}
export function bindAskRow(root) {
  const row = root.querySelector('.fb-ask'); if (!row) return;
  row.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fba]'); if (!b) return;
    const screen = row.dataset.screen, k = b.dataset.fba;
    if (k === 'write') { openFeedback({ type: 'idea', screen }); return; }
    sendFeedback({ type: k === 'up' ? 'like' : 'dislike', text: k === 'up' ? '👍' : '👎', screen, tech: false });
    row.innerHTML = k === 'up' ? `<span>${t('fb.thanks')}</span>` : `<span>${t('fb.whyNot')}</span><button type="button" class="chip fb-ask-w" data-fba="write">${t('fb.write')}</button>`;
  });
}
