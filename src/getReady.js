// v2.4.26: „Spremi se“ — odbrojavanje posle „Počni“, da stigneš da uzmeš gitaru i staviš prste na prvi akord.
// v2.4.29: kartica kao ostatak aplikacije — broj, traka, hvat prvog akorda, izbor 3 / 5 / 10 s (pamti se), „Kreni odmah“.
// Dodir van kartice = kreni odmah. Vraća { done: Promise<boolean>, cancel() } — false ako je prekinuto (Stop, odlazak).
import { t } from './i18n.js';
import { esc } from './ui.js';
import { dn } from './naming.js';

const KEY = 'marli-ready-secs';
const OPTS = [3, 5, 10];
let active = null;
export function cancelReady() { active?.cancel(); }
export function setReadySecs(n) { if (OPTS.includes(Number(n))) try { localStorage.setItem(KEY, String(n)); } catch {} }
export const READY_OPTS = OPTS;
export const readySecs = () => { try { const v = Number(localStorage.getItem(KEY)); return OPTS.includes(v) ? v : 5; } catch { return 5; } };

/** first = akord (zapis kao u pesmi) — prikazuje se hvat i ime. */
export function getReady({ first = '' } = {}) {
  active?.cancel();
  let secs = readySecs(), left = secs, timer = 0, settle;
  const done = new Promise((r) => { settle = r; });
  const el = document.createElement('div');
  el.className = 'gr-dim';
  el.innerHTML = `<div class="gr" role="dialog" aria-modal="true" aria-label="${esc(t('gr.title'))}">
    <div class="tch-sec"><span>${esc(t('gr.title'))}</span></div>
    <div class="gr-main"><b class="gr-n" aria-live="assertive">${left}</b>${first ? `<div class="gr-ch"><span class="gr-chd"></span><small>${esc(t('gr.first'))} <b>${esc(dn(first))}</b></small></div>` : ''}</div>
    <div class="gr-bar" aria-hidden="true"><i></i></div>
    <div class="seg-tabs gr-secs" role="radiogroup" aria-label="${esc(t('gr.len'))}">${OPTS.map((n) => `<button type="button" role="radio" data-s="${n}" class="${n === secs ? 'active' : ''}" aria-checked="${n === secs}">${n} s</button>`).join('')}</div>
    <button type="button" class="btn primary wide gr-go">${esc(t('gr.now'))}</button></div>`;
  if (first) import('./diagram.js').then((D) => { const box = el.querySelector('.gr-chd'); if (box) box.innerHTML = D.chordSVG(first, { colorFingers: true }); }).catch(() => {});
  const bar = () => { const i = el.querySelector('.gr-bar i'); i.style.transition = 'none'; i.style.transform = 'scaleX(1)'; void i.offsetWidth; i.style.transition = `transform ${left}s linear`; i.style.transform = 'scaleX(0)'; };
  const tick = () => { clearInterval(timer); timer = setInterval(() => { left--; if (left <= 0) end(true); else el.querySelector('.gr-n').textContent = String(left); }, 1000); };
  const end = (ok) => { if (!el.isConnected) return; clearInterval(timer); el.remove(); removeEventListener('hashchange', off); if (active === h) active = null; settle(ok); };
  const off = () => end(false);
  el.addEventListener('click', (e) => {
    const sb = e.target.closest('[data-s]');
    if (sb) { secs = Number(sb.dataset.s); try { localStorage.setItem(KEY, String(secs)); } catch {} left = secs; el.querySelector('.gr-n').textContent = String(left); el.querySelectorAll('[data-s]').forEach((b) => { const on = b === sb; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); }); bar(); tick(); return; }
    if (e.target.closest('.gr-go') || !e.target.closest('.gr')) end(true);
  });
  addEventListener('hashchange', off);
  document.body.appendChild(el);
  el.querySelector('.gr-go').focus();
  bar(); tick();
  const h = { done, cancel: () => end(false) };
  active = h;
  return h;
}
