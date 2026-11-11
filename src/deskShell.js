// v1.98: računar — bočna traka (aplikacija levo, uvek vidljiva) + gornja traka sadržaja: ‹ › nazad/napred, putanja
// (Pesme › Subota u klubu › Lane moje), 🔔 i nalog. Instalirana aplikacija na Windows-u nema dugme nazad pregledača,
// pa je ovde uvek vidljivo. Esc / Backspace = jedan korak nazad (kad nije otvoren prozorčić i ne kucaš);
// Alt + ← / → i bočni tasteri miša rade sami (pregledač). Naslov prozora = gde si („Lane moje — MARLI“).
// Učitava se samo na velikom ekranu sa mišem (telefon i tablet ga nikad ne učitaju).
import { t } from './i18n.js';
import { esc } from './ui.js';

const SECT = { pesme: 'nav.songs', pesma: 'nav.songs', setlista: 'nav.songs', uredi: 'nav.songs', 'od-nastavnika': 'nav.songs', vezbe: 'nav.practice', akordi: 'nav.chords', tuner: 'nav.tuner', podesavanja: 'nav.settings', ucenici: 'nav.students', ucenik: 'nav.students', ritam: 'nav.practice' };
const ROOT = { pesme: '#/pesme', pesma: '#/pesme', setlista: '#/pesme?tab=sl', uredi: '#/pesme', 'od-nastavnika': '#/pesme', vezbe: '#/vezbe', akordi: '#/akordi', tuner: '#/tuner', podesavanja: '#/podesavanja', ucenici: '#/ucenici', ucenik: '#/ucenici', ritam: '#/vezbe' };
// „dubina“: stranice sa kojih Esc / Backspace vraća nazad (ne uređivač — tamo Esc ima svoje značenje)
const DEEP = /^#\/(pesma|setlista|ucenik|od-nastavnika)\//;
const pageOf = () => (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'tuner');

let bar = null;
const lastSet = { id: '', name: '' }; // set lista iz koje je pesma otvorena (za putanju)
function crumbs() {
  const pg = pageOf(), sec = SECT[pg]; if (!sec) return [];
  const out = [{ label: t(sec), href: ROOT[pg] }];
  const h1 = [...document.querySelectorAll('#app h1:not(.lib-h1)')].filter((h) => h.offsetParent !== null && !h.closest('[hidden]')).map((h) => h.textContent.trim()).filter(Boolean).pop() || ''; // samo vidljiv naslov (tuner ostaje u pozadini)
  if (pg === 'setlista') { const nm = h1 || ''; lastSet.id = location.hash.split('/')[2] || ''; lastSet.name = nm; out.push({ label: t('lib.tabSetlists'), href: '#/pesme?tab=sl' }); if (nm) out.push({ label: nm }); }
  else if (pg === 'pesma') { if (lastSet.name && /[?&]set=/.test(location.hash) === false && history.state?.fromSet) out.push({ label: lastSet.name, href: '#/setlista/' + lastSet.id }); if (h1) out.push({ label: h1 }); }
  else if (pg === 'vezbe' && location.hash.split('/')[2]) { const g = location.hash.split('/')[2].split('?')[0]; out.push({ label: t('pr.g.' + g) !== 'pr.g.' + g ? t('pr.g.' + g) : (h1 || g) }); }
  else if (['ucenik', 'od-nastavnika', 'uredi'].includes(pg) && h1) out.push({ label: h1 });
  return out;
}
const canBack = () => { try { if (globalThis.navigation && 'canGoBack' in globalThis.navigation) return globalThis.navigation.canGoBack; } catch {} return history.length > 1; };
const canFwd = () => { try { if (globalThis.navigation && 'canGoForward' in globalThis.navigation) return globalThis.navigation.canGoForward; } catch {} return true; };
function paint() {
  if (!bar) return;
  const c = crumbs();
  bar.querySelector('.dsh-crumb').innerHTML = c.map((x, i) => (i < c.length - 1 && x.href ? `<a href="${esc(x.href)}">${esc(x.label)}</a>` : `<b>${esc(x.label)}</b>`)).join('<span class="dsh-sep" aria-hidden="true">›</span>');
  bar.querySelector('[data-dsh="back"]').disabled = !canBack();
  bar.querySelector('[data-dsh="fwd"]').disabled = !canFwd();
  const last = c.length ? c[c.length - 1].label : '';
  document.title = last && last !== 'MARLI' ? `${last} — MARLI` : 'MARLI';
  document.body.classList.toggle('side-mini', /^#\/(pesma|uredi)\//.test(location.hash));
}
let inited = false;
export function initDeskShell() {
  if (inited) return; inited = true;
  document.body.classList.add('desk-shell');
  bar = document.createElement('header');
  bar.className = 'dsh-bar'; bar.setAttribute('aria-label', t('ds.bar'));
  bar.innerHTML = `<button type="button" class="dsh-nav" data-dsh="back" aria-label="${esc(t('ds.back'))}" title="${esc(t('ds.backTip'))}">‹</button><button type="button" class="dsh-nav" data-dsh="fwd" aria-label="${esc(t('ds.fwd'))}" title="${esc(t('ds.fwdTip'))}">›</button><nav class="dsh-crumb" aria-label="${esc(t('ds.where'))}"></nav><span class="dsh-sp"></span><button type="button" class="dsh-search" data-dsh="search"><span aria-hidden="true">⌕</span><span>${esc(t('srch.btn'))}</span><kbd>Ctrl K</kbd></button>`;
  document.body.appendChild(bar);
  const acct = document.getElementById('navAcct'); if (acct) { bar.appendChild(acct); try { dispatchEvent(new Event('marli-notes')); } catch {} } // nalog (i 🔔 ispred njega) gore desno; v1.99.3: javi zvoncu
  bar.addEventListener('click', (e) => { const b = e.target.closest('[data-dsh]'); if (!b) return; if (b.dataset.dsh === 'search') { import('./deskSearch.js').then((m) => m.openSearch()); return; } if (b.dataset.dsh === 'back') history.back(); else history.forward(); });
  // v1.99: Ctrl K (⌘K) = pretraga svega
  addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); import('./deskSearch.js').then((m) => m.openSearch()); } });
  // Esc / Backspace: jedan korak nazad sa „dubokih“ stranica, kad ništa drugo nije otvoreno i ne kucaš
  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== 'Escape' && e.key !== 'Backspace') return;
    const tg = e.target; if (tg && (tg.closest('input, textarea, select, [contenteditable="true"]'))) return;
    if (document.querySelector('.modal-backdrop, .sheet-backdrop, .qr-inv, .nt-wrap, .te-bar, body.stage-mode, body.pa-on, .track-wrap, .fp-stage')) return;
    if (!DEEP.test(location.hash)) return;
    e.preventDefault(); history.back();
  });
  // pesma otvorena iz set liste → putanja Pesme › Set liste › Ime › Pesma
  document.addEventListener('click', (e) => { const a = e.target.closest('a[href^="#/pesma/"]'); if (a && /^#\/setlista\//.test(location.hash)) setTimeout(() => { try { history.replaceState({ ...(history.state || {}), fromSet: true }, ''); } catch {} paint(); }, 0); }, true);
  // naslov stranice (h1) stiže posle iscrtavanja — osveži putanju još dva puta; bez praćenja celog sadržaja (igre!)
  addEventListener('hashchange', () => { setTimeout(paint, 60); setTimeout(paint, 450); setTimeout(paint, 1400); });
  const app = document.getElementById('app'); let q = 0;
  if (app) new MutationObserver(() => { cancelAnimationFrame(q); q = requestAnimationFrame(paint); }).observe(app, { childList: true });
  import('./i18n.js').then((m) => m.onLangChange?.(() => { bar.querySelector('[data-dsh="back"]').setAttribute('aria-label', t('ds.back')); paint(); })).catch(() => {});
  import('./deskTuner.js').then((m) => m.initDeskTuner()).catch(() => {});
  import('./deskChords.js').then((m) => m.initDeskChords()).catch(() => {}); // v1.99.5: Akordi u karticama
  import('./deskHeads.js').then((m) => m.initDeskHeads()).catch(() => {}); // v1.99.6: Vežbe i Podešavanja — naslov + opis // v1.99.4: Tuner u dve kartice (čipovi u zaglavlju)
  paint();
}
