// v1.89 (telefon i tablet): uređivanje akorda prstom, u posebnom režimu (da se pri čitanju ništa ne promeni slučajno).
// Prevuci akord levo-desno (lupa pokazuje slovo ispod prsta) · dodir na akord → list za izbor akorda (‹ › prethodni/sledeći,
// dodir na drugi akord odmah prelazi na njega) · dodir na slovo → „+ Dodaj akord“ · ✎ na kraju reda → ispravi tekst.
// Svaka izmena se odmah čuva; „Poništi“ vraća korak po korak. Akordi su na ekranu u izabranom tonalitetu/kapodasteru —
// pre čuvanja se vraćaju u zapisani tonalitet (isto kao brza izmena na računaru).
import { t } from './i18n.js';
import { esc, toast } from './ui.js';
import { readChord, renderChord } from './chordnames.js';
import { currentNaming, dn } from './naming.js';
import { versions } from './db.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const TYPES = ['', 'm', '7', 'm7', 'maj7', 'sus4', 'sus2', 'dim', 'aug', '6', 'add9', '9'];
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

let cssDone = false;
function css() {
  if (cssDone) return; cssDone = true;
  const st = document.createElement('style');
  st.textContent = `
.te-on .scroll-bar, .te-on #sChips, .te-on .sp-line, .te-on #sStats, .te-on #sAsk, .te-on #sSuggest, .te-on .mini-pl, .te-on .song-end { display: none !important; }
.te-on #sLyrics { padding-bottom: 46vh; }
.te-on #sLyrics .ch { border: 1.5px dashed rgba(245,165,36,.6); border-radius: 7px; padding: 0 3px; background: rgba(245,165,36,.07); touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; cursor: grab; }
.te-on #sLyrics .ch.te-sel { background: var(--accent); color: #1a1203; border-style: solid; box-shadow: 0 0 0 4px rgba(245,165,36,.25); }
.te-on #sLyrics .ch.te-lift { position: relative; z-index: 5; background: var(--accent); color: #1a1203; border-style: solid; box-shadow: 0 10px 20px rgba(0,0,0,.6); }
.te-on #sLyrics .tx, .te-on #sLyrics .tx0 { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.te-bar { position: fixed; z-index: 62; left: 0; right: 0; top: 0; display: flex; align-items: center; gap: 8px; padding: calc(env(safe-area-inset-top) + 8px) 14px 8px; background: linear-gradient(180deg, #241a06, #17130b); border-bottom: 1px solid rgba(245,165,36,.45); }
.te-bar b { flex: 1; min-width: 0; color: var(--accent); font: 800 .98rem var(--sans); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.te-bar button { appearance: none; height: 38px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--text); font: 700 .88rem var(--sans); cursor: pointer; white-space: nowrap; }
.te-bar button:disabled { opacity: .4; }
.te-bar .te-ok { background: linear-gradient(135deg, #ffcc33, #f59e0b); color: #1a1203; border: 0; }
body.te-body { padding-top: calc(env(safe-area-inset-top) + 56px); }
body.te-body .song-view > .topbar { display: none; }
.te-hint { color: var(--muted); font-size: .84rem; margin: 0 0 10px; }
.te-pen { appearance: none; display: inline-grid; place-items: center; width: 30px; height: 30px; margin-left: 8px; border-radius: 50%; border: 0; background: var(--surface-2); color: var(--muted); font-size: 14px; vertical-align: middle; cursor: pointer; }
.te-mag { position: fixed; z-index: 70; padding: 6px 12px; border-radius: 14px; background: #1d1f24; border: 1.5px solid var(--accent); box-shadow: 0 10px 26px rgba(0,0,0,.65); font: 600 1.15rem var(--mono); color: var(--text); white-space: pre; pointer-events: none; transform: translateX(-50%); }
.te-mag i { font-style: normal; color: #1a1203; background: var(--accent); border-radius: 4px; padding: 0 2px; }
.te-plus { position: fixed; z-index: 64; display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 12px 0 6px; border-radius: 999px; border: 0; background: var(--accent); color: #1a1203; font: 800 .88rem var(--sans); box-shadow: 0 8px 20px rgba(0,0,0,.55); cursor: pointer; }
.te-plus i { font-style: normal; width: 24px; height: 24px; border-radius: 50%; background: #1a1203; color: var(--accent); display: grid; place-items: center; font-size: 1rem; }
.te-letter { position: fixed; z-index: 63; border-radius: 3px; outline: 2px solid var(--accent); background: rgba(245,165,36,.3); pointer-events: none; }
.te-sheet { position: fixed; z-index: 66; left: 0; right: 0; bottom: 0; max-width: 620px; margin: 0 auto; background: var(--surface); border: 1px solid var(--line); border-bottom: 0; border-radius: 22px 22px 0 0; padding: 8px 14px calc(14px + env(safe-area-inset-bottom)); box-shadow: 0 -18px 50px rgba(0,0,0,.6); animation: rise .18s ease-out; }
.te-grab { width: 40px; height: 4px; border-radius: 4px; background: var(--line); margin: 0 auto 8px; }
.te-nav { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.te-nav button { appearance: none; flex: none; width: 44px; height: 44px; border-radius: 50%; border: 0; background: var(--surface-2); color: var(--text); font: 800 1.3rem var(--sans); cursor: pointer; }
.te-nav button:disabled { opacity: .3; }
.te-mid { flex: 1; text-align: center; line-height: 1.15; min-width: 0; }
.te-mid b { display: block; color: var(--accent); font-size: 1.5rem; }
.te-mid small { color: var(--muted); font-size: .8rem; }
.te-line { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin-top: 8px; padding-bottom: 2px; }
.te-line::-webkit-scrollbar { display: none; }
.te-line button { appearance: none; flex: none; min-width: 40px; height: 40px; padding: 0 10px; border-radius: 11px; border: 0; background: var(--surface-2); color: var(--text); font: 800 .92rem var(--sans); cursor: pointer; }
.te-line button.on { background: var(--accent); color: #1a1203; }
.te-line.te-song button { border: 1px solid rgba(245,165,36,.45); background: var(--accent-soft); color: var(--accent); }
.te-line.te-song button.on { background: var(--accent); color: #1a1203; }
.te-line.te-song button.key { border-style: dashed; background: none; }
.te-acts { display: flex; gap: 8px; margin-top: 10px; }
.te-acts button { appearance: none; flex: 1; height: 44px; border-radius: 14px; border: 0; background: var(--surface-2); color: var(--text); font: 700 .92rem var(--sans); cursor: pointer; }
.te-acts .te-del { color: #ff6b6b; }
.te-acts .te-done { background: linear-gradient(135deg, #ffcc33, #f59e0b); color: #1a1203; }
.te-acts button:disabled { opacity: .35; }
.te-linebox { display: flex; gap: 8px; margin: 4px 0 10px; }
.te-linebox input { flex: 1; min-width: 0; font: 1rem var(--mono); }
`;
  document.head.appendChild(st);
}

/**
 * opts: { root, lyrics: () => element, stored: () => pesma, setStored(p), shift: () => polutonovi prikaza,
 *         save: () => Promise, redraw: () => void, beforeEnter?: () => void, onExit?: () => void }
 * Vraća { enter(chEl?), exit(), active }.
 */
export function attachTouchEdit(opts) {
  css();
  const L = () => opts.lyrics();
  const view = () => opts.root.querySelector('.song-view');
  let active = false, bar = null, hint = null, sheet = null, plus = null, letter = null, mag = null, versioned = false;
  let sel = null; // { si, li, pos } izabranog akorda ili { add: true, si, li, pos }
  let pend = { type: '' }; // izbor vrste pre osnove (kad se dodaje)
  const undo = [];

  // ---- mapiranje DOM ↔ zapis ----
  const sorted = (line) => [...(line.chords || [])].sort((a, b) => a.position - b.position);
  const where = (el) => {
    const ln = el.closest('.ln'); const sec = ln && ln.closest('.sec'); if (!sec || !L().contains(sec)) return null;
    const si = [...L().querySelectorAll(':scope > .sec')].indexOf(sec);
    const li = [...sec.querySelectorAll(':scope > .ln')].indexOf(ln);
    const line = opts.stored().sections[si] && opts.stored().sections[si].lines[li];
    return si < 0 || li < 0 || !line ? null : { si, li, ln, line };
  };
  const chordRef = (chEl) => { const w = where(chEl); if (!w) return null; const i = [...w.ln.querySelectorAll('.ch')].indexOf(chEl); const c = sorted(w.line)[i]; return c ? { ...w, c, i } : null; };
  const lnEl = (si, li) => L().querySelectorAll(':scope > .sec')[si]?.querySelectorAll(':scope > .ln')[li] || null;
  const chEl = (s) => { if (!s || s.add) return null; const line = opts.stored().sections[s.si]?.lines[s.li]; if (!line) return null; const i = sorted(line).findIndex((c) => c.position === s.pos); const ln = lnEl(s.si, s.li); return i >= 0 && ln ? ln.querySelectorAll('.ch')[i] || null : null; };
  const allCh = () => [...L().querySelectorAll('.ch')];

  // ---- akord: prikaz ↔ zapis ----
  const toStored = (txt) => {
    const p = readChord(String(txt).trim(), 'en') || readChord(String(txt).trim(), currentNaming());
    if (!p) return null;
    const sh = opts.shift();
    const n = { r: (p.r - sh + 120) % 12, s: p.s, b: p.b === null || p.b === undefined ? null : (p.b - sh + 120) % 12 };
    const chord = renderChord(n, 'en', opts.stored().keyN || null);
    return { n, chord, w: chord };
  };
  const shownKey = () => { const k = opts.stored().keyN; return k ? { root: (k.root + opts.shift() + 120) % 12, minor: k.minor } : null; };
  // ime akorda na ekranu → osnova (slovo + ♯/♭) i vrsta
  const parts = (name) => {
    const p = name && readChord(name, 'en'); if (!p) return null;
    const rt = renderChord({ r: p.r, s: '', b: null }, 'en', shownKey());
    return { letter: rt[0], acc: rt.slice(1), type: p.s || '', bass: p.b };
  };
  const wordAt = (text, pos) => {
    text = String(text || ''); if (!text.trim()) return '';
    let a = Math.min(pos, text.length - 1); if (a < 0) a = 0;
    while (a < text.length && /\s/.test(text[a])) a++;
    if (a >= text.length) { a = text.length - 1; while (a > 0 && /\s/.test(text[a])) a--; }
    let s = a, e = a; while (s > 0 && !/\s/.test(text[s - 1])) s--; while (e < text.length && !/\s/.test(text[e])) e++;
    return text.slice(s, e).replace(/^[„“"'(]+|[,.;:!?”"')]+$/g, '');
  };

  // ---- čuvanje + poništavanje ----
  async function commit(mut) {
    const before = clone(opts.stored());
    if (!versioned) { versioned = true; versions.save('song:' + before.id, before, 'quick').catch(() => {}); }
    mut(opts.stored());
    opts.stored().updatedAt = Date.now();
    undo.push(before); if (undo.length > 80) undo.shift();
    await opts.save();
    redraw();
  }
  async function doUndo() {
    const prev = undo.pop(); if (!prev) return;
    opts.setStored(prev); await opts.save(); closeSheet(); redraw(); toast(t('qe.undone'));
  }
  function redraw() {
    opts.redraw();
    decorate();
    if (bar) bar.querySelector('.te-undo').disabled = !undo.length;
    if (sheet) renderSheet(); else markSel();
  }
  function markSel() { L().querySelectorAll('.ch.te-sel').forEach((x) => x.classList.remove('te-sel')); chEl(sel)?.classList.add('te-sel'); }
  // ✎ na kraju svakog reda sa tekstom
  function decorate() {
    if (!active) return;
    L().querySelectorAll(':scope > .sec > .ln').forEach((ln) => {
      if (ln.querySelector(':scope > .te-pen')) return;
      const w = where(ln); if (!w || !w.line.text || !w.line.text.trim()) return;
      const b = document.createElement('button'); b.className = 'te-pen'; b.type = 'button'; b.textContent = '✎'; b.setAttribute('aria-label', t('te.editLine'));
      ln.appendChild(b);
    });
  }

  // ---- ulaz / izlaz ----
  function enter(startCh = null) {
    if (active) return;
    opts.beforeEnter?.();
    active = true;
    view()?.classList.add('te-on'); document.body.classList.add('te-body');
    bar = document.createElement('div'); bar.className = 'te-bar';
    bar.innerHTML = `<b>✎ ${esc(t('te.title'))}</b><button class="te-undo" disabled>↶ ${esc(t('te.undo'))}</button><button class="te-ok">${esc(t('te.done'))}</button>`;
    document.body.appendChild(bar);
    bar.querySelector('.te-undo').addEventListener('click', doUndo);
    bar.querySelector('.te-ok').addEventListener('click', exit);
    hint = document.createElement('p'); hint.className = 'te-hint'; hint.textContent = t('te.hint');
    (opts.root.querySelector('#sHead') || L()).after(hint);
    decorate();
    if (startCh) { const r = chordRef(startCh); if (r) select({ si: r.si, li: r.li, pos: r.c.position }); }
  }
  function exit() {
    if (!active) return;
    active = false;
    closeSheet(); hidePlus(); endDrag();
    bar?.remove(); bar = null; hint?.remove(); hint = null;
    L()?.querySelectorAll('.te-pen, .te-linebox').forEach((x) => x.remove());
    L()?.querySelectorAll('.ch.te-sel').forEach((x) => x.classList.remove('te-sel'));
    view()?.classList.remove('te-on'); document.body.classList.remove('te-body');
    undo.length = 0; versioned = false; sel = null;
    opts.onExit?.();
  }

  // ---- list za izbor akorda ----
  function closeSheet() { sheet?.remove(); sheet = null; sel = null; markSel(); }
  function select(s) {
    sel = s; pend = { type: '' }; hidePlus();
    if (!sheet) { sheet = document.createElement('div'); sheet.className = 'te-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', t('te.chord')); document.body.appendChild(sheet); sheet.addEventListener('click', onSheet); }
    renderSheet();
    reveal();
  }
  // izabrani akord uvek iznad lista (pesma se pomeri sama)
  function reveal() {
    const el = chEl(sel) || (sel && sel.add ? lnEl(sel.si, sel.li) : null); if (!el || !sheet) return;
    const r = el.getBoundingClientRect(), top = (bar?.getBoundingClientRect().bottom || 0) + 12, bottom = innerHeight - sheet.getBoundingClientRect().height - 16;
    if (r.top < top || r.bottom > bottom) window.scrollBy({ top: r.top - (top + (bottom - top) * 0.4), behavior: 'smooth' });
  }
  function renderSheet() {
    if (!sheet || !sel) return;
    markSel();
    const list = allCh(), el = chEl(sel), idx = el ? list.indexOf(el) : -1;
    const line = opts.stored().sections[sel.si]?.lines[sel.li];
    const name = el ? el.dataset.chord : '';
    const pr = parts(name) || { letter: '', acc: '', type: pend.type };
    const songCh = [...new Set(list.map((b) => b.dataset.chord))].slice(0, 10);
    const k = shownKey();
    const keyCh = k ? (k.minor ? [[0, 'm'], [3, ''], [5, 'm'], [7, 'm'], [8, ''], [10, ''], [7, '7']] : [[0, ''], [2, 'm'], [4, 'm'], [5, ''], [7, ''], [9, 'm'], [7, '7']])
      .map(([d, q]) => renderChord({ r: (k.root + d) % 12, s: q, b: null }, 'en', k)).filter((x) => !songCh.includes(x)).slice(0, 4) : [];
    const word = line ? wordAt(line.text, sel.pos) : '';
    sheet.innerHTML = `<div class="te-grab"></div>
      <div class="te-nav"><button data-te="prev" aria-label="${esc(t('te.prev'))}" ${idx > 0 || (sel.add && list.length) ? '' : 'disabled'}>‹</button>
        <span class="te-mid"><b>${el ? esc(dn(name)) : '+'}</b><small>${esc(el ? '' : t('te.newChord') + ' · ')}${word ? esc(t('te.over', { w: word })) : ''}${el ? ` · ${idx + 1} / ${list.length}` : ''}</small></span>
        <button data-te="next" aria-label="${esc(t('te.next'))}" ${idx >= 0 && idx < list.length - 1 ? '' : 'disabled'}>›</button></div>
      <div class="te-line te-song">${songCh.map((c) => `<button data-c="${esc(c)}" class="${c === name ? 'on' : ''}">${esc(dn(c))}</button>`).join('')}${keyCh.map((c) => `<button data-c="${esc(c)}" class="key">${esc(dn(c))}</button>`).join('')}</div>
      <div class="te-line">${LETTERS.map((l) => `<button data-l="${l}" class="${pr.letter === l ? 'on' : ''}">${esc(dn(l))}</button>`).join('')}
        <button data-a="#" class="${pr.acc === '#' ? 'on' : ''}" aria-label="${esc(t('te.sharp'))}">♯</button><button data-a="b" class="${pr.acc === 'b' ? 'on' : ''}" aria-label="${esc(t('te.flat'))}">♭</button></div>
      <div class="te-line">${TYPES.map((q) => `<button data-q="${q}" class="${(el ? pr.type : pend.type) === q ? 'on' : ''}">${q || esc(t('te.major'))}</button>`).join('')}</div>
      <div class="te-acts"><button data-te="left" aria-label="${esc(t('qe.left'))}" ${el ? '' : 'disabled'}>◀</button><button data-te="right" aria-label="${esc(t('qe.right'))}" ${el ? '' : 'disabled'}>▶</button>
        <button data-te="del" class="te-del" ${el ? '' : 'disabled'}>${esc(t('te.remove'))}</button><button data-te="done" class="te-done">${esc(t('te.done'))}</button></div>`;
  }
  // postavi akord (izmena izabranog ili novi na mestu „+“)
  async function setChord(txt) {
    const st = toStored(txt);
    if (!st) { toast(t('qe.unknown', { c: dn(txt) }), 'error'); return; }
    const { si, li, pos } = sel;
    if (sel.add) {
      await commit((s) => { const l = s.sections[si].lines[li]; l.chords = [...(l.chords || []).filter((c) => c.position !== pos), { position: pos, ...st }]; });
      sel = { si, li, pos }; renderSheet(); return;
    }
    await commit((s) => { const c = (s.sections[si].lines[li].chords || []).find((x) => x.position === pos); if (c) Object.assign(c, st); });
  }
  async function move(d) {
    const line = opts.stored().sections[sel.si]?.lines[sel.li]; if (!line) return;
    const c = (line.chords || []).find((x) => x.position === sel.pos); if (!c) return;
    const max = (line.text || '').length + AFTER, np = Math.max(0, Math.min(max, c.position + d));
    if (np === c.position || (line.chords || []).some((x) => x !== c && x.position === np)) return;
    const { si, li, pos } = sel;
    sel = { si, li, pos: np };
    await commit((s) => { const x = (s.sections[si].lines[li].chords || []).find((y) => y.position === pos); if (x) x.position = np; });
  }
  async function remove() {
    const { si, li, pos } = sel;
    const list = allCh(), i = list.indexOf(chEl(sel));
    await commit((s) => { const l = s.sections[si].lines[li]; l.chords = (l.chords || []).filter((x) => x.position !== pos); });
    // sledeći akord (ili prethodni), da se nastavi bez zatvaranja
    const nl = allCh(), n = nl[Math.min(i, nl.length - 1)];
    const r = n && chordRef(n);
    if (r) { sel = { si: r.si, li: r.li, pos: r.c.position }; renderSheet(); reveal(); } else closeSheet();
  }
  function step(d) {
    const list = allCh(); if (!list.length) return;
    let i = sel.add ? list.findIndex((x) => { const r = chordRef(x); return r && (r.si > sel.si || (r.si === sel.si && (r.li > sel.li || (r.li === sel.li && r.c.position > sel.pos)))); }) : list.indexOf(chEl(sel));
    if (sel.add) i = d > 0 ? (i < 0 ? list.length - 1 : i) : (i < 0 ? list.length - 1 : i - 1);
    else i += d;
    const n = list[Math.max(0, Math.min(list.length - 1, i))]; const r = n && chordRef(n);
    if (r) select({ si: r.si, li: r.li, pos: r.c.position });
  }
  function onSheet(e) {
    const b = e.target.closest('button'); if (!b || !sel) return;
    const el = chEl(sel), cur = parts(el ? el.dataset.chord : '');
    if (b.dataset.c) return setChord(b.dataset.c);
    if (b.dataset.l) { const acc = cur ? cur.acc : ''; const type = cur ? cur.type : pend.type; return setChord(b.dataset.l + acc + type); }
    if (b.dataset.a) { if (!cur) return; return setChord(cur.letter + (cur.acc === b.dataset.a ? '' : b.dataset.a) + cur.type); }
    if (b.dataset.q !== undefined) { if (!cur) { pend.type = b.dataset.q; return renderSheet(); } return setChord(cur.letter + cur.acc + b.dataset.q); }
    const a = b.dataset.te;
    if (a === 'prev') step(-1);
    else if (a === 'next') step(1);
    else if (a === 'left') move(-1);
    else if (a === 'right') move(1);
    else if (a === 'del') remove();
    else if (a === 'done') closeSheet();
  }

  // ---- dodir na slovo → „+ Dodaj akord“ ----
  function hidePlus() { plus?.remove(); plus = null; letter?.remove(); letter = null; }
  const caretAt = (x, y) => {
    if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); return p ? { node: p.offsetNode, off: p.offset } : null; }
    if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); return r ? { node: r.startContainer, off: r.startOffset } : null; }
    return null;
  };
  // položaj u tekstu reda (ln) za tačku x na redu teksta najbližem visini y; vraća { pos, rect } ili null
  function textPos(ln, x, y) {
    const spans = [...ln.querySelectorAll('.tx, .tx0')].filter((s) => s.textContent.length);
    if (!spans.length) return null;
    let best = null, bd = Infinity;
    for (const s of spans) { const r = s.getBoundingClientRect(); const d = Math.abs((r.top + r.bottom) / 2 - y) + (x < r.left ? r.left - x : x > r.right ? x - r.right : 0) * 0.02; if (d < bd) { bd = d; best = s; } }
    const r = best.getBoundingClientRect(), cy = (r.top + r.bottom) / 2;
    // v1.94.1: i posle kraja reda (akord posle poslednje reči) — po širini jednog slova, najviše AFTER mesta
    const lr = spans[spans.length - 1].getBoundingClientRect(); // tx0 (reč bez akorda) je viša od tx — porede se donje ivice
    if (x > lr.right && Math.abs(lr.bottom - r.bottom) < r.height) { let total = 0; ln.querySelectorAll('.tx, .tx0').forEach((s) => { total += s.textContent.length; }); const pos = total + Math.min(AFTER, Math.max(0, Math.round((x - r.right) / charW(ln)))); return { pos, rect: letterRect(ln, pos) }; }
    const c = caretAt(Math.max(r.left + 1, Math.min(x, r.right - 1)), cy);
    let pos = -1, acc = 0;
    for (const s of ln.querySelectorAll('.tx, .tx0')) {
      if (c && c.node && c.node.nodeType === 3 && s.contains(c.node)) { pos = acc + c.off; break; }
      acc += s.textContent.length;
    }
    if (pos < 0) return null;
    return { pos, rect: letterRect(ln, pos) };
  }
  const AFTER = 24;
  function charW(ln) { const s = [...ln.querySelectorAll('.tx, .tx0')].filter((x) => x.textContent.length).pop(); if (!s) return 9; const r = s.getBoundingClientRect(); return Math.max(4, r.width / Math.max(1, s.textContent.length)); }
  function letterRect(ln, pos) {
    let acc = 0, last = null;
    for (const s of ln.querySelectorAll('.tx, .tx0')) {
      const len = s.textContent.length;
      if (pos < acc + len && s.firstChild) { const rg = document.createRange(); rg.setStart(s.firstChild, pos - acc); rg.setEnd(s.firstChild, Math.min(len, pos - acc + 1)); return rg.getBoundingClientRect(); }
      acc += len; if (len) last = s;
    }
    if (!last) return undefined; // posle kraja reda: zamišljeno mesto desno od poslednjeg slova
    const r = last.getBoundingClientRect(), cw = charW(ln), left = r.right + (pos - acc) * cw;
    return { left, right: left + cw, top: r.top, bottom: r.bottom, width: cw, height: r.height };
  }
  function showPlus(ln, x, y) {
    const w = where(ln); if (!w) return;
    const tp = textPos(ln, x, y); if (!tp || !tp.rect) return hidePlus();
    const ex = (w.line.chords || []).find((c) => c.position === tp.pos);
    if (ex) { const r = chordRef(chEl({ si: w.si, li: w.li, pos: ex.position }) || ln); if (r) return select({ si: r.si, li: r.li, pos: ex.position }); }
    hidePlus();
    const r = tp.rect;
    letter = document.createElement('div'); letter.className = 'te-letter';
    Object.assign(letter.style, { left: (r.left - 1) + 'px', top: (r.top - 1) + 'px', width: (Math.max(8, r.width) + 2) + 'px', height: (r.height + 2) + 'px' });
    plus = document.createElement('button'); plus.className = 'te-plus'; plus.type = 'button';
    plus.innerHTML = `<i>+</i>${esc(t('te.add'))}`;
    document.body.append(letter, plus);
    const pw = plus.offsetWidth;
    plus.style.left = Math.max(8, Math.min(innerWidth - pw - 8, r.left - 18)) + 'px';
    plus.style.top = Math.max((bar?.getBoundingClientRect().bottom || 0) + 4, r.top - 48) + 'px';
    const at = { add: true, si: w.si, li: w.li, pos: tp.pos };
    plus.addEventListener('click', (e) => { e.stopPropagation(); select(at); });
  }

  // ---- ✎: ispravi tekst reda ----
  function editLine(ln) {
    const w = where(ln); if (!w) return;
    L().querySelectorAll('.te-linebox').forEach((x) => x.remove());
    const box = document.createElement('div'); box.className = 'te-linebox';
    box.innerHTML = `<input value="${esc(w.line.text)}" autocomplete="off" spellcheck="false" aria-label="${esc(t('te.editLine'))}"><button class="btn small primary">${esc(t('common.save'))}</button>`;
    ln.after(box);
    const inp = box.querySelector('input'); inp.focus();
    const done = async () => {
      const v = inp.value.replace(/\s+$/, ''); box.remove();
      if (v === w.line.text) return;
      const { si, li } = w;
      await commit((s) => { const l = s.sections[si].lines[li]; l.text = v; (l.chords || []).forEach((c) => { c.position = Math.min(c.position, Math.max(0, v.length)); }); });
      toast(t('qe.lineSaved'));
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(); if (e.key === 'Escape') box.remove(); });
    box.querySelector('button').addEventListener('click', done);
  }

  // ---- prevlačenje akorda ----
  let drag = null; // { el, ref, x0, y0, moved, pos }
  function endDrag() { if (!drag) return; drag.el.classList.remove('te-lift'); drag.el.style.transform = ''; mag?.remove(); mag = null; drag = null; }
  const onDown = (e) => {
    if (!active) return;
    const ch = e.target.closest('#sLyrics .ch'); if (!ch) return;
    const ref = chordRef(ch); if (!ref) return;
    drag = { el: ch, ref, x0: e.clientX, y0: e.clientY, moved: false, pos: ref.c.position, id: e.pointerId };
    try { ch.setPointerCapture(e.pointerId); } catch {}
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved) { if (Math.hypot(dx, dy) < 8) return; drag.moved = true; drag.el.classList.add('te-lift'); hidePlus(); }
    e.preventDefault();
    drag.el.style.transform = `translate(${dx}px, ${Math.max(-12, Math.min(12, dy * 0.2)) - 6}px) scale(1.2)`;
    const tp = textPos(drag.ref.ln, e.clientX, e.clientY + 24);
    if (!tp) return;
    drag.pos = tp.pos;
    const text = drag.ref.line.text || '', a = Math.max(0, tp.pos - 6);
    if (!mag) { mag = document.createElement('div'); mag.className = 'te-mag'; document.body.appendChild(mag); }
    mag.innerHTML = `${esc(text.slice(a, tp.pos))}<i>${esc(text[tp.pos] || ' ')}</i>${esc(text.slice(tp.pos + 1, tp.pos + 7))}`;
    mag.style.left = Math.max(80, Math.min(innerWidth - 80, e.clientX)) + 'px';
    mag.style.top = Math.max((bar?.getBoundingClientRect().bottom || 0) + 4, drag.el.getBoundingClientRect().top - 58) + 'px';
  };
  const onUp = async (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; endDrag();
    if (!d.moved) { select({ si: d.ref.si, li: d.ref.li, pos: d.ref.c.position }); return; }
    const np = d.pos, { si, li } = d.ref, from = d.ref.c.position;
    if (np === from || (d.ref.line.chords || []).some((x) => x.position === np && x !== d.ref.c)) { redraw(); return; }
    if (sel && !sel.add && sel.si === si && sel.li === li && sel.pos === from) sel = { si, li, pos: np };
    await commit((s) => { const x = (s.sections[si].lines[li].chords || []).find((y) => y.position === from); if (x) x.position = np; });
  };

  // ---- događaji (samo u režimu uređivanja; čitanje pesme radi kao i pre) ----
  const root = opts.root;
  root.addEventListener('pointerdown', onDown, true);
  root.addEventListener('pointermove', onMove, true);
  root.addEventListener('pointerup', onUp, true);
  root.addEventListener('pointercancel', () => endDrag(), true);
  root.addEventListener('click', (e) => {
    if (!active) return;
    if (!e.target.closest('#sLyrics') || e.target.closest('.te-linebox')) return; // polje za tekst reda radi normalno
    e.stopPropagation(); e.preventDefault();
    if (e.target.closest('.ch')) return; // dodir/prevlačenje akorda rešava pointerup
    const pen = e.target.closest('.te-pen'); if (pen) return editLine(pen.closest('.ln'));
    const ln = e.target.closest('.ln');
    if (ln && !ln.classList.contains('blank') && L().contains(ln)) showPlus(ln, e.clientX, e.clientY);
    else hidePlus();
  }, true);
  // dug pritisak na akord dok se čita → režim uređivanja sa tim akordom
  let lpT = 0, lpXY = null;
  root.addEventListener('pointerdown', (e) => {
    if (active || e.pointerType === 'mouse' || !opts.canEnter?.()) return;
    const ch = e.target.closest('#sLyrics .ch'); if (!ch) return;
    lpXY = [e.clientX, e.clientY];
    clearTimeout(lpT); lpT = setTimeout(() => { lpXY = null; navigator.vibrate?.(15); enter(ch); }, 550);
  });
  root.addEventListener('pointermove', (e) => { if (lpXY && Math.hypot(e.clientX - lpXY[0], e.clientY - lpXY[1]) > 10) { clearTimeout(lpT); lpXY = null; } });
  ['pointerup', 'pointercancel'].forEach((ev) => root.addEventListener(ev, () => { clearTimeout(lpT); lpXY = null; }));
  root.addEventListener('contextmenu', (e) => { if (e.target.closest('#sLyrics .ch') && (active || opts.canEnter?.())) e.preventDefault(); });
  const off = () => { if (document.body.contains(root)) return; exit(); removeEventListener('hashchange', off); };
  addEventListener('hashchange', off);
  return { enter, exit, get active() { return active; } };
}
