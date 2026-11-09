// v1.82 (samo računar): brza izmena pesme na samom ekranu pesme.
// Klik na akord → mali panel (promeni / pomeri / ukloni); prelaz mišem iznad teksta → „+“ (dodaj akord);
// dvoklik na red teksta → prepravi tekst. Svaka izmena se odmah čuva; Ctrl+Z poništava (i dugme u traci dole).
// Akordi su na ekranu u izabranom tonalitetu/kapodasteru — pre čuvanja se vraćaju u zapisani tonalitet.
import { t } from './i18n.js';
import { esc, toast } from './ui.js';
import { readChord, renderChord } from './chordnames.js';
import { currentNaming, dn } from './naming.js';
import { versions } from './db.js';

export const DESK_Q = matchMedia('(min-width: 1100px) and (hover: hover) and (pointer: fine)');
const TIP_KEY = 'marli-qe-tip';
const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * opts: { root, lyrics: () => element, stored: () => pesma, setStored(p), shift: () => polutonovi prikaza,
 *         save: () => Promise, redraw: () => void, enabled: () => bool, showChord(name) }
 */
export function attachQuickEdit(opts) {
  const undo = [];
  let pop = null, plus = null, bar = null, barT = 0, versioned = false;
  const L = () => opts.lyrics();
  const on = () => DESK_Q.matches && opts.enabled();

  // ---- mapiranje DOM → zapis pesme ----
  const where = (el) => {
    const ln = el.closest('.ln'); const sec = ln && ln.closest('.sec'); if (!sec) return null;
    const si = [...L().querySelectorAll(':scope > .sec')].indexOf(sec);
    const li = [...sec.querySelectorAll(':scope > .ln')].indexOf(ln);
    const s = opts.stored(); const line = s.sections[si] && s.sections[si].lines[li];
    return si < 0 || li < 0 || !line ? null : { si, li, ln, line };
  };
  const sorted = (line) => [...(line.chords || [])].sort((a, b) => a.position - b.position);
  const chordObj = (chEl) => { const w = where(chEl); if (!w) return null; const i = [...w.ln.querySelectorAll('.ch')].indexOf(chEl); const c = sorted(w.line)[i]; return c ? { ...w, c } : null; };

  // ---- akord: prikaz ↔ zapis ----
  const toStored = (txt) => {
    const p = readChord(String(txt).trim(), currentNaming()) || readChord(String(txt).trim(), 'en');
    if (!p) return null;
    const sh = opts.shift();
    const n = { r: (p.r - sh + 120) % 12, s: p.s, b: p.b === null || p.b === undefined ? null : (p.b - sh + 120) % 12 };
    const keyN = opts.stored().keyN || null;
    const chord = renderChord(n, 'en', keyN);
    return { n, chord, w: chord };
  };
  const shown = (c) => dn(c);

  // ---- predlozi: akordi iz pesme pa uobičajeni u tonalitetu ----
  const suggestions = () => {
    const songCh = [...new Set([...L().querySelectorAll('.ch')].map((b) => b.dataset.chord))].slice(0, 8);
    const s = opts.stored(), k = s.keyN;
    let keyCh = [];
    if (k) {
      const root = (k.root + opts.shift() + 120) % 12;
      const deg = k.minor ? [[0, 'm'], [3, ''], [5, 'm'], [7, 'm'], [8, ''], [10, ''], [7, '7']] : [[0, ''], [2, 'm'], [4, 'm'], [5, ''], [7, ''], [9, 'm'], [7, '7']];
      const key = { root, minor: k.minor };
      keyCh = deg.map(([d, q]) => renderChord({ r: (root + d) % 12, s: q, b: null }, 'en', key)).filter((x) => !songCh.includes(x));
    }
    return { songCh, keyCh: keyCh.slice(0, 6) };
  };

  // ---- čuvanje + poništavanje ----
  async function commit(mut, label) {
    const before = clone(opts.stored());
    if (!versioned) { versioned = true; versions.save('song:' + before.id, before, 'quick').catch(() => {}); } // jednom po otvaranju
    mut(opts.stored());
    opts.stored().updatedAt = Date.now();
    undo.push(before); if (undo.length > 50) undo.shift();
    await opts.save();
    opts.redraw();
    showBar(label);
  }
  async function doUndo() {
    const prev = undo.pop(); if (!prev) return;
    opts.setStored(prev); await opts.save(); opts.redraw(); closePop();
    showBar(t('qe.undone'), false);
  }
  function showBar(label, canUndo = true) {
    bar?.remove(); clearTimeout(barT);
    bar = document.createElement('div'); bar.className = 'qe-bar'; bar.setAttribute('role', 'status');
    bar.innerHTML = `<span>✓ ${esc(label)}</span>${canUndo && undo.length ? `<button class="btn small" data-qe="undo">${t('qe.undo')} <kbd>Ctrl Z</kbd></button>` : ''}`;
    document.body.appendChild(bar);
    bar.querySelector('[data-qe="undo"]')?.addEventListener('click', doUndo);
    barT = setTimeout(() => { bar?.remove(); bar = null; }, 6000);
  }

  // ---- panel ----
  function closePop() { pop?.remove(); pop = null; L()?.querySelectorAll('.ch.qe-sel').forEach((x) => x.classList.remove('qe-sel')); }
  function openPop(anchorEl, { edit = null, add = null } = {}) {
    closePop(); hidePlus();
    const ar = anchorEl.getBoundingClientRect(), lnEl = (anchorEl.closest && anchorEl.closest('.ln')) || anchorEl.__ln;
    const lr = lnEl ? lnEl.getBoundingClientRect() : ar;
    const r = { left: ar.left, top: ar.top, bottom: lr.bottom }; // ispod celog reda — tekst ostaje vidljiv
    const { songCh, keyCh } = suggestions();
    const cur = edit ? shown(anchorEl.dataset.chord) : '';
    pop = document.createElement('div'); pop.className = 'qe-pop'; pop.setAttribute('role', 'dialog');
    pop.innerHTML = `<input class="qe-in" value="${esc(cur)}" placeholder="${esc(t('qe.ph'))}" aria-label="${esc(t('qe.chord'))}" autocomplete="off" spellcheck="false">
      <div class="qe-chips">${songCh.map((c) => `<button data-c="${esc(c)}" class="${c === (edit && anchorEl.dataset.chord) ? 'on' : ''}">${esc(dn(c))}</button>`).join('')}${keyCh.length ? '<i></i>' : ''}${keyCh.map((c) => `<button data-c="${esc(c)}" class="key">${esc(dn(c))}</button>`).join('')}</div>
      <div class="qe-row">${edit ? `<button class="btn small qe-ic" data-qe="left" title="${esc(t('qe.left'))} (←)">◀</button><button class="btn small qe-ic" data-qe="right" title="${esc(t('qe.right'))} (→)">▶</button><button class="btn small qe-ic qe-del" data-qe="del" title="${esc(t('qe.del'))} (Del)" aria-label="${esc(t('qe.del'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9zm4 2v8h1.5v-8H10zm3.5 0v8H15v-8h-1.5z"/></svg></button><button class="btn small qe-ic" data-qe="shape" title="${esc(t('qe.shape'))}">♪</button>` : ''}
        <span class="qe-sp"></span><button class="qe-help" title="${esc(t('qe.keys'))}">?</button><button class="btn small primary" data-qe="ok">${t('common.save')}</button></div>
      <p class="qe-err" hidden></p>`;
    document.body.appendChild(pop);
    const pw = 300, x = Math.min(innerWidth - pw - 12, Math.max(12, r.left - 10)), below = r.bottom + 8 + 190 < innerHeight;
    pop.style.left = x + 'px'; pop.style.top = (below ? r.bottom + 8 : Math.max(70, r.top - 198)) + 'px';
    if (edit) anchorEl.classList.add('qe-sel');
    const inp = pop.querySelector('.qe-in'); inp.focus(); inp.select();
    const err = pop.querySelector('.qe-err');
    const apply = async (val) => {
      const v = String(val || '').trim();
      if (!v) { if (edit) return remove(); closePop(); return; }
      const st = toStored(v);
      if (!st) { err.hidden = false; err.textContent = t('qe.unknown', { c: v }); inp.focus(); return; }
      if (edit) {
        const prevName = shown(anchorEl.dataset.chord);
        const ref = chordObj(anchorEl); if (!ref) return closePop();
        const { si, li } = ref, idx = sorted(ref.line).indexOf(ref.c), pos = ref.c.position;
        closePop();
        await commit((s) => { const c = sorted(s.sections[si].lines[li])[idx]; if (c && c.position === pos) Object.assign(c, st); }, `${prevName} → ${dn(st.chord ? renderAt(st) : v)}`);
      } else {
        const { si, li, pos } = add;
        closePop();
        await commit((s) => { const l = s.sections[si].lines[li]; l.chords = [...(l.chords || []).filter((c) => c.position !== pos), { position: pos, ...st }]; }, t('qe.added', { c: dn(renderAt(st)) }));
      }
    };
    const renderAt = (st) => renderChord({ r: (st.n.r + opts.shift() + 120) % 12, s: st.n.s, b: st.n.b === null ? null : (st.n.b + opts.shift() + 120) % 12 }, 'en', null);
    const remove = async () => {
      const ref = chordObj(anchorEl); if (!ref) return closePop();
      const { si, li } = ref, idx = sorted(ref.line).indexOf(ref.c), name = shown(anchorEl.dataset.chord);
      closePop();
      await commit((s) => { const l = s.sections[si].lines[li]; const c = sorted(l)[idx]; l.chords = l.chords.filter((x) => x !== c); }, t('qe.removed', { c: name }));
    };
    const move = async (d) => {
      const ref = chordObj(anchorEl); if (!ref) return;
      const { si, li } = ref, idx = sorted(ref.line).indexOf(ref.c), max = Math.max((ref.line.text || '').length, ref.c.position + 1);
      const np = Math.max(0, Math.min(max, ref.c.position + d)); if (np === ref.c.position) return;
      if ((ref.line.chords || []).some((x) => x !== ref.c && x.position === np)) return;
      await commit((s) => { const c = sorted(s.sections[si].lines[li])[idx]; if (c) c.position = np; }, t('qe.moved'));
      // panel ostaje na istom akordu
      const ln = L().querySelectorAll(':scope > .sec')[si]?.querySelectorAll(':scope > .ln')[li];
      const nc = ln && [...ln.querySelectorAll('.ch')][sorted(opts.stored().sections[si].lines[li]).findIndex((c) => c.position === np)];
      if (nc) openPop(nc, { edit: true });
    };
    pop.addEventListener('click', (e) => {
      const c = e.target.closest('[data-c]'); if (c) return apply(dn(c.dataset.c));
      const b = e.target.closest('[data-qe]'); if (!b) return;
      const a = b.dataset.qe;
      if (a === 'ok') apply(inp.value);
      else if (a === 'del') remove();
      else if (a === 'left') move(-1);
      else if (a === 'right') move(1);
      else if (a === 'shape') { const n = anchorEl.dataset.chord; closePop(); opts.showChord(n); }
    });
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); apply(inp.value); }
      else if (e.key === 'Escape') { e.preventDefault(); closePop(); }
      else if (edit && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (e.altKey || inp.value === cur)) { e.preventDefault(); move(e.key === 'ArrowLeft' ? -1 : 1); }
      else if (edit && e.key === 'Delete' && inp.value === cur) { e.preventDefault(); remove(); }
    });
    inp.addEventListener('input', () => { err.hidden = true; });
  }

  // ---- „+“ iznad teksta ----
  function hidePlus() { plus?.remove(); plus = null; }
  const textOffset = (ln, x, y) => {
    let node = null, off = 0;
    if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) { node = p.offsetNode; off = p.offset; } }
    else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); if (r) { node = r.startContainer; off = r.startOffset; } }
    if (!node || node.nodeType !== 3) return -1;
    const span = node.parentElement; if (!span || !span.matches('.tx, .tx0') || !ln.contains(span)) return -1;
    let pos = 0; for (const s of ln.querySelectorAll('.tx, .tx0')) { if (s === span) return pos + off; pos += s.textContent.length; }
    return -1;
  };
  function onMove(e) {
    if (!on() || pop || (plus && e.target === plus)) return;
    const ln = e.target.closest && e.target.closest('#sLyrics .ln'); if (!ln || ln.classList.contains('blank') || ln.classList.contains('chords-only')) return hidePlus();
    // traka akorda tog reda (prvi .cr sa akordom) i tekst ispod nje
    const cr = [...ln.querySelectorAll('.cr')].find((x) => x.querySelector('.ch')); const tx = cr && cr.parentElement.querySelector('.tx');
    if (!cr || !tx) return hidePlus();
    const rr = cr.getBoundingClientRect(), tr = tx.getBoundingClientRect();
    if (e.clientY < rr.top - 4 || e.clientY > rr.bottom + 2) return hidePlus(); // samo iznad teksta
    const pos = textOffset(ln, e.clientX, tr.top + tr.height / 2);
    const w = where(ln); if (pos < 0 || !w) return hidePlus();
    if ((w.line.chords || []).some((c) => Math.abs(c.position - pos) < 1)) return hidePlus();
    const rng = document.createRange();
    let acc = 0, xPos = e.clientX;
    for (const s of ln.querySelectorAll('.tx, .tx0')) { const len = s.textContent.length; if (pos < acc + len && s.firstChild) { rng.setStart(s.firstChild, pos - acc); rng.setEnd(s.firstChild, Math.min(len, pos - acc + 1)); xPos = rng.getBoundingClientRect().left; break; } acc += len; }
    if (!plus) { plus = document.createElement('button'); plus.className = 'qe-plus'; plus.textContent = '+'; plus.title = t('qe.addHere'); document.body.appendChild(plus);
      plus.addEventListener('click', (ev) => { ev.stopPropagation(); const d = plus.__at; if (d) openPop(plus, { add: d }); }); }
    plus.__at = { si: w.si, li: w.li, pos }; plus.__ln = ln;
    plus.style.left = (xPos - 9) + 'px'; plus.style.top = (rr.top + (rr.height - 18) / 2) + 'px';
  }

  // ---- dvoklik: prepravi red teksta ----
  async function editLine(ln) {
    const w = where(ln); if (!w || !w.line.text) return;
    const r = ln.getBoundingClientRect();
    const box = document.createElement('div'); box.className = 'qe-line';
    box.style.left = r.left + 'px'; box.style.top = (r.bottom - 34) + 'px'; box.style.width = Math.max(320, r.width) + 'px';
    box.innerHTML = `<input value="${esc(w.line.text)}" autocomplete="off" spellcheck="false"><button class="btn small primary">${t('common.save')}</button>`;
    document.body.appendChild(box);
    const inp = box.querySelector('input'); inp.focus();
    const done = async (ok) => {
      const v = inp.value.replace(/\s+$/, ''); box.remove();
      if (!ok || v === w.line.text) return;
      const { si, li } = w;
      await commit((s) => { const l = s.sections[si].lines[li]; l.text = v; (l.chords || []).forEach((c) => { c.position = Math.min(c.position, Math.max(0, v.length)); }); }, t('qe.lineSaved'));
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    box.querySelector('button').addEventListener('click', () => done(true));
    inp.addEventListener('blur', () => setTimeout(() => { if (document.body.contains(box)) done(true); }, 120));
  }

  // ---- događaji ----
  const root = opts.root;
  root.addEventListener('click', (e) => {
    if (!on()) return;
    const ch = e.target.closest('#sLyrics .ch'); if (!ch) return;
    e.stopPropagation(); e.preventDefault();
    openPop(ch, { edit: true });
    try { if (!localStorage.getItem(TIP_KEY)) localStorage.setItem(TIP_KEY, '1'); } catch {}
  }, true);
  root.addEventListener('dblclick', (e) => { if (!on()) return; const ln = e.target.closest('#sLyrics .ln'); if (ln && !e.target.closest('.ch')) { e.preventDefault(); editLine(ln); } });
  root.addEventListener('mousemove', onMove);
  root.addEventListener('mouseleave', (e) => { if (!plus || e.relatedTarget !== plus) hidePlus(); });
  document.addEventListener('mousemove', (e) => { if (plus && e.target !== plus && !root.contains(e.target)) hidePlus(); });
  const outside = (e) => { if (pop && !pop.contains(e.target) && !e.target.closest('.ch')) closePop(); };
  document.addEventListener('pointerdown', outside, true);
  const onKey = (e) => {
    if (!on() || !document.body.contains(root)) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey && undo.length && !e.target.closest('input, textarea')) { e.preventDefault(); doUndo(); }
    if (e.key === 'Escape' && pop) closePop();
  };
  document.addEventListener('keydown', onKey);
  const off = () => { if (document.body.contains(root)) return; document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', outside, true); closePop(); hidePlus(); bar?.remove(); removeEventListener('hashchange', off); };
  addEventListener('hashchange', off);
  // jednom: kratak savet
  try { if (on() && !localStorage.getItem(TIP_KEY)) setTimeout(() => { if (document.body.contains(root)) toast(t('qe.tip')); }, 1200); } catch {}
  return { close: closePop };
}
