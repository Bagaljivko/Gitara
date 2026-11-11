// v1.99: računar — jedna pretraga za sve (Ctrl K): pesme (naslov, izvođač, tekst), set liste, Moje vežbe, igre i
// delovi aplikacije (Tuner, Akordi, podešavanja…). ↑ ↓ biraju, Enter otvara, Esc zatvara. Učitava se tek na Ctrl K.
import { t } from './i18n.js';
import { esc } from './ui.js';

const fold = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'dj');
let open = false;

async function sources() {
  const out = [];
  const { songs } = await import('./db.js');
  const all = (await songs.all().catch(() => [])).filter((s) => !s.deleted && !s.demo);
  for (const s of all) {
    const text = (s.sections || []).flatMap((x) => (x.lines || []).map((l) => l.text || '')).join(' ');
    out.push({ k: 'song', ic: '♪', label: s.title, sub: s.artist || '', href: '#/pesma/' + encodeURIComponent(s.id), hay: fold(s.title + ' ' + (s.artist || '')), body: fold(text) });
  }
  try { const c = await import('./collections.js'); for (const sl of await c.getSetlists()) out.push({ k: 'set', ic: '≡', label: sl.name, sub: t('srch.set', { n: (sl.songIds || []).length }), href: '#/setlista/' + encodeURIComponent(sl.id), hay: fold(sl.name) }); } catch {}
  try { const X = await import('./myEx.js'); for (const x of await X.list()) out.push({ k: 'ex', ic: '🎸', label: x.name, sub: X.chordsLine(x), run: () => X.play(x), hay: fold(x.name + ' ' + X.chordsLine(x)) }); } catch {}
  try { const P = await import('./practice.js'); for (const g of P.GAMES) out.push({ k: 'game', ic: '▶', label: t('pr.g.' + g.id), sub: t('nav.practice'), href: '#/vezbe/' + g.id, hay: fold(t('pr.g.' + g.id)) }); } catch {}
  for (const [href, key] of [['#/tuner', 'nav.tuner'], ['#/akordi', 'nav.chords'], ['#/pesme', 'nav.songs'], ['#/pesme?tab=sl', 'lib.tabSetlists'], ['#/vezbe', 'nav.practice'], ['#/podesavanja', 'nav.settings']]) out.push({ k: 'page', ic: '›', label: t(key), sub: t('srch.page'), href, hay: fold(t(key)) });
  for (const [open, key] of [['tuner', 'set.tunerTitle'], ['songs', 'set.songsTitle'], ['screen', 'set.g.screen'], ['lang', 'set.g.lang'], ['scan', 'set.g.key'], ['drive', 'set.g.sync'], ['file', 'bk.title'], ['teach', 'tch.sectionRow'], ['diag', 'diag.title']]) out.push({ k: 'set-row', ic: '⚙', label: t(key), sub: t('nav.settings'), run: () => { location.hash = '#/podesavanja'; setTimeout(() => document.querySelector(`[data-open="${open}"]`)?.click(), 400); }, hay: fold(t(key)) });
  try { const T = await import('./teach.js'); if ((await T.getTeacher()).on) for (const st of await T.getStudents()) out.push({ k: 'student', ic: '👤', label: st.name, sub: t('nav.students'), href: '#/ucenik/' + encodeURIComponent(st.id), hay: fold(st.name) }); } catch {}
  return out;
}
function rank(items, q) {
  const w = fold(q).split(/\s+/).filter(Boolean); if (!w.length) return [];
  const res = [];
  for (const it of items) {
    let sc = 0, inBody = false;
    for (const x of w) { if (it.hay.startsWith(x)) sc += 3; else if (it.hay.includes(' ' + x)) sc += 2; else if (it.hay.includes(x)) sc += 1; else if (it.body && it.body.includes(x)) { sc += 0.5; inBody = true; } else { sc = -1; break; } }
    if (sc > 0) res.push({ ...it, sc: sc + (it.k === 'page' || it.k === 'game' ? 0.3 : 0), inBody });
  }
  return res.sort((a, b) => b.sc - a.sc || a.label.localeCompare(b.label, 'sr')).slice(0, 30);
}
const GROUP = { song: 'srch.g.songs', set: 'srch.g.sets', ex: 'srch.g.ex', game: 'srch.g.games', page: 'srch.g.pages', 'set-row': 'srch.g.settings', student: 'srch.g.students' };

export async function openSearch(q0 = '') {
  if (open) return; open = true;
  const items = await sources();
  const wrap = document.createElement('div');
  wrap.className = 'srch-wrap'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', t('srch.title'));
  wrap.innerHTML = `<div class="srch"><div class="srch-in"><span aria-hidden="true">⌕</span><input type="search" autocomplete="off" spellcheck="false" placeholder="${esc(t('srch.ph'))}" value="${esc(q0)}"><kbd>Esc</kbd></div><div class="srch-res" role="listbox"></div><div class="srch-foot">${esc(t('srch.foot'))}</div></div>`;
  document.body.appendChild(wrap);
  const inp = wrap.querySelector('input'), box = wrap.querySelector('.srch-res');
  let list = [], sel = 0;
  const draw = () => {
    const q = inp.value.trim();
    list = q ? rank(items, q) : items.filter((x) => x.k === 'page').concat(items.filter((x) => x.k === 'song').slice(0, 6));
    sel = Math.min(sel, Math.max(0, list.length - 1));
    let last = '';
    box.innerHTML = list.length ? list.map((x, i) => { const g = x.k !== last ? `<div class="srch-g">${esc(t(GROUP[x.k]))}</div>` : ''; last = x.k; return `${g}<button type="button" class="srch-it${i === sel ? ' on' : ''}" data-i="${i}" role="option" aria-selected="${i === sel}"><span class="srch-ic">${esc(x.ic)}</span><span class="srch-tx"><b>${esc(x.label)}</b><small>${esc(x.inBody ? t('srch.inText') : x.sub)}</small></span></button>`; }).join('')
      : `<p class="srch-none">${esc(t('srch.none', { q }))}</p>`;
    box.querySelector('.srch-it.on')?.scrollIntoView({ block: 'nearest' });
  };
  const close = () => { wrap.remove(); open = false; removeEventListener('keydown', onKey, true); };
  const go = (x) => { if (!x) return; close(); if (x.run) x.run(); else location.hash = x.href; };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % Math.max(1, list.length); draw(); return; }
    if (e.key === 'Enter') { e.preventDefault(); go(list[sel]); }
  };
  addEventListener('keydown', onKey, true);
  inp.addEventListener('input', () => { sel = 0; draw(); });
  wrap.addEventListener('click', (e) => { if (!e.target.closest('.srch')) return close(); const b = e.target.closest('[data-i]'); if (b) go(list[+b.dataset.i]); });
  wrap.addEventListener('mousemove', (e) => { const b = e.target.closest('[data-i]'); if (b && +b.dataset.i !== sel) { sel = +b.dataset.i; box.querySelectorAll('.srch-it').forEach((x) => x.classList.toggle('on', +x.dataset.i === sel)); } });
  draw(); inp.focus();
}
