// v2.4.26: „Spremi se“ — odbrojavanje (5 s) posle „Počni“, da stigneš da uzmeš gitaru i staviš prste na prvi akord.
// Dodir bilo gde = kreni odmah. Vraća { done: Promise<boolean>, cancel() } — false ako je prekinuto (Stop, odlazak).
import { t } from './i18n.js';
import { esc } from './ui.js';

let active = null;
export function cancelReady() { active?.cancel(); }

export function getReady({ secs = 5, first = '' } = {}) {
  active?.cancel();
  let left = Math.max(1, Math.round(secs)), timer = 0, settle;
  const done = new Promise((r) => { settle = r; });
  const el = document.createElement('div');
  el.className = 'gr-dim';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', t('gr.title'));
  el.innerHTML = `<div class="gr"><div class="gr-k">${esc(t('gr.title'))}</div><b class="gr-n" aria-live="assertive">${left}</b>
    <svg class="gr-ring" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54"/><circle class="gr-p" cx="60" cy="60" r="54" style="animation-duration:${left}s"/></svg>
    ${first ? `<p class="gr-first">${esc(t('gr.first'))} <b>${esc(first)}</b></p>` : ''}
    <button type="button" class="btn gr-go">${esc(t('gr.now'))}</button></div>`;
  const end = (ok) => { if (!el.isConnected) return; clearInterval(timer); el.remove(); removeEventListener('hashchange', off); if (active === h) active = null; settle(ok); };
  const off = () => end(false);
  el.addEventListener('click', () => end(true));
  addEventListener('hashchange', off);
  document.body.appendChild(el);
  el.querySelector('.gr-go').focus();
  timer = setInterval(() => { left--; if (left <= 0) end(true); else el.querySelector('.gr-n').textContent = String(left); }, 1000);
  const h = { done, cancel: () => end(false) };
  active = h;
  return h;
}
