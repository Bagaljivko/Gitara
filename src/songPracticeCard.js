// Kartica „Vežbaj ovu pesmu“ na ekranu pesme — isti izgled kao kartice u Vežbama (okvir sa sjajem, mali pregled,
// zvezdice / NOVO), da poziva na vežbu umesto male ikonice pored naslova. Vodi u „Delove pesme“ za ovu pesmu.
import { esc } from './ui.js';
import { t } from './i18n.js';

const PREV = {
  // TAB: šest linija i brojevi koji klize ka liniji (kao u igrama)
  tab: '<g class="sp-lines">' + [16, 26, 36, 46, 56, 66].map((y) => `<line x1="6" y1="${y}" x2="74" y2="${y}"/>`).join('') + '</g><line x1="22" y1="10" x2="22" y2="72" class="sp-hit"/>'
    + '<g class="sp-slide">' + [[34, 16, '7'], [46, 26, '0'], [58, 36, '0'], [70, 16, '5'], [82, 26, '0'], [94, 36, '0']].map(([x, y, n]) => `<text x="${x}" y="${y + 3.5}">${n}</text>`).join('') + '</g>',
  // akordi: blokovi akorda iznad reda teksta, red koji se puni
  chords: '<rect x="10" y="46" width="60" height="5" rx="2.5" class="sp-lyr"/><rect x="10" y="58" width="44" height="5" rx="2.5" class="sp-lyr"/><rect x="10" y="46" width="60" height="5" rx="2.5" class="sp-lyr-on"/>'
    + '<g class="sp-chips"><rect x="10" y="20" width="16" height="15" rx="4"/><rect x="32" y="20" width="16" height="15" rx="4"/><rect x="54" y="20" width="16" height="15" rx="4"/></g>',
};
const stars = (n) => `<span class="sp-stars" aria-label="${n}/3">${[0, 1, 2].map((i) => `<i class="${i < n ? 'on' : ''}">★</i>`).join('')}</span>`;

/** HTML kartice; napredak se upisuje posle (fillPractice), da ekran pesme ne čeka podešavanja. */
export function practiceCardHTML(id, kind, { compact = false } = {}) {
  return `<a class="sp-card${compact ? ' sp-compact' : ''}" href="#/vezbe/pesma/${encodeURIComponent(id)}" aria-label="${esc(t('sp.title'))}">
    <span class="sp-prev" aria-hidden="true"><svg viewBox="0 0 80 80">${PREV[kind] || PREV.chords}</svg></span>
    <span class="sp-body"><b class="sp-name">${t('sp.title')}</b><span class="sp-desc">${t('sp.desc')}</span><span class="sp-meta"><span class="sp-new">${t('sp.new')}</span></span></span>
    <svg class="sp-go" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 7.4 10 6l6 6-6 6-1.4-1.4L13.2 12z"/></svg>
  </a>`;
}
/** Napredak: { good, total, played } → zvezdice i „2 od 4 dela“; bez vežbanja ostaje NOVO. */
export function fillPractice(card, { good = 0, total = 0, played = false, done = false } = {}) {
  const m = card && card.querySelector('.sp-meta');
  if (!m || !played || !total) return;
  const p = done ? 1 : Math.min(1, good / total);
  const n = p >= 1 ? 3 : p >= 0.5 ? 2 : p > 0 ? 1 : 0;
  m.innerHTML = `${stars(n)}<b class="sp-num">${esc(t('sp.parts', { n: Math.min(good, total), total }))}</b>`;
}
