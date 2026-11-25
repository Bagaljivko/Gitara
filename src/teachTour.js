// v2.4.21: kratka tura posle povezivanja nastavnika i učenika — 4 kartice „šta sad možeš“, jednom po uređaju
// (ponovo: obaveštenje „Povezan si…“ vodi na #/od-nastavnika?tura=1). Učenik: 's', nastavnik: 't'.
import { t } from './i18n.js';
import { esc } from './ui.js';

const KEY = 'marli-tour-conn';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
const write = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch {} };

/** Zabeleži da tura treba da se pokaže (posle novog povezivanja). */
export function pending(role, sid = '') { const o = read(); o[role] = { sid, at: Date.now() }; write(o); }

const CARDS = {
  s: [
    { ic: '🎓', h: 'tour.s1h', p: 'tour.s1p', list: [['📥', 'tour.s1a', 'tour.s1aS'], ['✅', 'tour.s1b', 'tour.s1bS'], ['🎙', 'tour.s1c', 'tour.s1cS'], ['📈', 'tour.s1d', 'tour.s1dS']] },
    { ic: '📥', h: 'tour.s2h', p: 'tour.s2p' },
    { ic: '🎙', h: 'tour.s3h', p: 'tour.s3p' },
    { ic: '📈', h: 'tour.s4h', p: 'tour.s4p' },
  ],
  t: [
    { ic: '🤝', h: 'tour.t1h', p: 'tour.t1p', list: [['📤', 'tour.t1a', 'tour.t1aS'], ['📝', 'tour.t1b', 'tour.t1bS'], ['🎙', 'tour.t1c', 'tour.t1cS'], ['📈', 'tour.t1d', 'tour.t1dS']] },
    { ic: '📤', h: 'tour.t2h', p: 'tour.t2p' },
    { ic: '📝', h: 'tour.t3h', p: 'tour.t3p' },
    { ic: '📈', h: 'tour.t4h', p: 'tour.t4p' },
  ],
};

/** Pokaži turu ako je na redu (ili force). name = ime druge strane. */
export async function maybe(role, name = '', { force = false, sid = '' } = {}) {
  const o = read();
  if (!force && (!o[role] || (sid && o[role].sid && o[role].sid !== sid))) return false;
  if (document.querySelector('.tr-dim')) return false;
  delete o[role]; write(o);
  show(role, name);
  return true;
}

function show(role, name) {
  const cards = CARDS[role]; let i = 0;
  const wrap = document.createElement('div');
  wrap.className = 'tr-dim';
  const v = { t: name || t('tch.teacher'), name: name || '' };
  const draw = () => {
    const c = cards[i];
    wrap.innerHTML = `<div class="tr" role="dialog" aria-modal="true" aria-label="${esc(t(c.h, v))}">
      <div class="tr-ic" aria-hidden="true">${c.ic}</div>
      <div class="tr-k">${esc(t(role === 's' ? 'tour.kS' : 'tour.kT', { ...v, n: i + 1, of: cards.length }))}</div>
      <h3>${esc(t(c.h, v))}</h3><p>${esc(t(c.p, v))}</p>
      ${c.list ? `<ul>${c.list.map(([ic, b, s]) => `<li><span aria-hidden="true">${ic}</span><div>${esc(t(b, v))}<small>${esc(t(s, v))}</small></div></li>`).join('')}</ul>` : ''}
      <div class="tr-ft"><div class="tr-dots" aria-hidden="true">${cards.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
        <div>${i < cards.length - 1 ? `<button type="button" class="tr-skip" data-tr="x">${esc(t('tour.skip'))}</button>` : ''}<button type="button" class="tr-go" data-tr="n">${esc(t(i < cards.length - 1 ? 'tour.next' : 'tour.done'))}</button></div></div></div>`;
    wrap.querySelector('.tr-go').focus();
  };
  const close = () => { wrap.remove(); removeEventListener('keydown', onKey); removeEventListener('hashchange', close); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  wrap.__close = close;
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tr]');
    if (!b) { if (e.target === wrap) close(); return; }
    if (b.dataset.tr === 'x' || i >= cards.length - 1) return close();
    i++; draw();
  });
  addEventListener('keydown', onKey); addEventListener('hashchange', close);
  document.body.appendChild(wrap);
  draw();
}
