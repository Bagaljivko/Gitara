// v2.4: savet pri prvoj poseti ekranu — jedna kratka kartica, jednom po ekranu, posle obilaska (nikad usred njega).
// Kartica lebdi iznad donje trake (ne pomera sadržaj); „U redu“ ili prelazak na drugi ekran je sklanja.
import { t } from './i18n.js';
import { esc } from './ui.js';

const KEYS = ['pesme', 'pesma', 'vezbe', 'akordi', 'podesavanja'];
const SEEN = (k) => 'marli-hint-' + k;
let cur = null;

function close() { if (!cur) return; const el = cur; cur = null; el.classList.add('out'); setTimeout(() => el.remove(), 200); }

export function maybeHint(page) {
  close();
  if (!KEYS.includes(page) || globalThis.__marliTest?.noHints) return;
  try {
    if (!localStorage.getItem('gitara-tour')) return; // prvo obilazak (ili „Preskoči“)
    if (localStorage.getItem(SEEN(page))) return;
    if (document.querySelector('.tg-panel, .modal-backdrop, .wel-backdrop')) return; // ne preko obilaska ili prozora
    localStorage.setItem(SEEN(page), '1'); // jednom — i ako se ne zatvori
  } catch { return; }
  const el = document.createElement('div');
  el.className = 'hint-card' + (page === 'pesma' ? ' on-song' : '');
  el.setAttribute('role', 'note');
  el.innerHTML = `<span class="hint-ic" aria-hidden="true">💡</span><p><b>${esc(t('hint.label'))}</b> ${esc(t('hint.' + page))}</p><button type="button" class="btn small hint-ok">${esc(t('hint.ok'))}</button>`;
  el.querySelector('.hint-ok').addEventListener('click', close);
  document.body.appendChild(el);
  cur = el;
  addEventListener('hashchange', close, { once: true });
}
