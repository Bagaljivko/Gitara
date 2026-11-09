// v1.82 (samo računar): uređivač pesme kao radni prozor — tekst levo, pregled desno (uživo), jedna traka alata,
// Ctrl+S čuva, nacrt se pamti dok kucaš (ništa se ne gubi ako se prozor slučajno zatvori). Telefon i tablet bez promene.
import { t } from './i18n.js';
import { esc, dialog, toast } from './ui.js';
import { readChord, renderChord } from './chordnames.js';
import { currentNaming } from './naming.js';
import { isChordLine } from './songformat.js';

const SECTIONS = ['Strofa', 'Refren', 'Pre-refren', 'Most', 'Uvod', 'Solo', 'Kraj'];
const SECTIONS_EN = ['Verse', 'Chorus', 'Pre-chorus', 'Bridge', 'Intro', 'Solo', 'Outro'];

/** Transponuje jedan red akorda, a kolone ostaju na mestu (duži akord pomera sledeći tek koliko mora). */
export function transposeChordLine(line, n, naming = currentNaming()) {
  const toks = []; const re = /\S+/g; let m;
  while ((m = re.exec(line))) toks.push({ s: m.index, w: m[0] });
  let out = '';
  for (const tk of toks) {
    const bare = tk.w.replace(/^\(|\)$/g, '');
    const p = readChord(bare, naming);
    let w = tk.w;
    if (p) {
      const nn = { r: (p.r + n + 120) % 12, s: p.s, b: p.b === null || p.b === undefined ? null : (p.b + n + 120) % 12 };
      w = tk.w.replace(bare, renderChord(nn, naming, null));
    }
    const at = Math.max(tk.s, out.length ? out.length + 1 : 0);
    out = out.padEnd(at, ' ') + w;
  }
  return out;
}

/**
 * Pojačava postojeći uređivač (songEditor.js) na računaru.
 * o: { root, ta, keyInput, validate, renderPreview(el), save(), draftKey, original }
 */
export function enhanceEditor(o) {
  const view = o.root.querySelector('.editor-view'); if (!view) return;
  view.classList.add('ed-desk');
  const ta = o.ta, prev = o.root.querySelector('#ePreviewPane'), edit = o.root.querySelector('#eEditPane');
  // dve kolone: tekst | pregled
  const split = document.createElement('div'); split.className = 'ed-split';
  edit.before(split); split.append(edit, prev);
  prev.hidden = false;
  edit.insertAdjacentHTML('afterbegin', `<p class="ed-pane-h">${t('ed.textHead')}</p>`);
  const prevBody = document.createElement('div'); prevBody.className = 'ed-prev-body lyrics';
  prev.classList.remove('lyrics'); prev.innerHTML = `<p class="ed-pane-h">${t('ed.prevHead')}</p>`; prev.appendChild(prevBody);
  // traka alata
  const tools = document.createElement('div'); tools.className = 'ed-tools'; tools.setAttribute('role', 'toolbar');
  tools.innerHTML = `<button class="btn small" data-et="sec" title="${esc(t('ed.secTip'))}">+ ${t('ed.section')} ▾</button>
    <span class="ed-grp" title="${esc(t('ed.trTip'))}">${t('ed.transpose')} <button class="btn small" data-et="tr-">−</button><button class="btn small" data-et="tr+">+</button></span>
    <button class="btn small" data-et="find" title="Ctrl+H">${t('ed.find')}</button>
    <span class="ed-grp"><button class="btn small ed-ic" data-et="undo" title="${esc(t('ed.undo'))} (Ctrl+Z)">↶</button><button class="btn small ed-ic" data-et="redo" title="${esc(t('ed.redo'))} (Ctrl+Y)">↷</button></span>
    <span class="ed-sp"></span>
    <span class="ed-seg"><button data-et="v-both" class="on">${t('ed.vBoth')}</button><button data-et="v-text">${t('ed.vText')}</button></span>`;
  split.before(tools);
  const findBar = document.createElement('div'); findBar.className = 'ed-find'; findBar.hidden = true;
  findBar.innerHTML = `<input id="edFind" placeholder="${esc(t('ed.findPh'))}" autocomplete="off" spellcheck="false"><input id="edRepl" placeholder="${esc(t('ed.replPh'))}" autocomplete="off" spellcheck="false">
    <button class="btn small" data-ef="next">${t('ed.next')}</button><button class="btn small" data-ef="one">${t('ed.replace')}</button><button class="btn small" data-ef="all">${t('ed.replaceAll')}</button><span class="small muted" id="edFindN"></span><button class="btn small ed-ic" data-ef="close" aria-label="${esc(t('common.close'))}">✕</button>`;
  tools.after(findBar);

  // pregled uživo
  let pT = 0;
  const draw = () => { clearTimeout(pT); pT = setTimeout(() => { o.renderPreview(prevBody); }, 150); };
  draw();
  ta.addEventListener('input', () => { draw(); saveDraft(); });
  // pregled prati položaj teksta
  ta.addEventListener('scroll', () => { const r = ta.scrollTop / Math.max(1, ta.scrollHeight - ta.clientHeight); prev.scrollTop = r * (prev.scrollHeight - prev.clientHeight); });

  // izmena teksta kroz „undo“ istoriju pregledača (Ctrl+Z radi i posle alata)
  const replaceAll = (text) => { ta.focus(); ta.select(); if (!document.execCommand('insertText', false, text)) { ta.value = text; } ta.dispatchEvent(new Event('input', { bubbles: true })); };
  const insertAtLineStart = (txt) => {
    const v = ta.value, at = v.lastIndexOf('\n', Math.max(0, ta.selectionStart - 1)) + 1;
    ta.focus(); ta.setSelectionRange(at, at);
    if (!document.execCommand('insertText', false, txt)) { ta.value = v.slice(0, at) + txt + v.slice(at); }
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const transpose = (n) => {
    const nm = currentNaming();
    const lines = ta.value.split('\n').map((l) => (l.trim() && !/^\[.*\]$/.test(l.trim()) && isChordLine(l) ? transposeChordLine(l, n, nm) : l));
    const sel = [ta.selectionStart, ta.selectionEnd];
    replaceAll(lines.join('\n')); ta.setSelectionRange(sel[0], sel[1]);
    if (o.keyInput && o.keyInput.value.trim()) { const k = transposeChordLine(o.keyInput.value.trim(), n, nm); if (k) o.keyInput.value = k; }
    toast(t(n > 0 ? 'ed.trUp' : 'ed.trDown'));
  };
  tools.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-et]'); if (!b) return;
    const a = b.dataset.et;
    if (a === 'sec') {
      const names = document.documentElement.lang === 'en' ? SECTIONS_EN : SECTIONS;
      const v = await dialog({ title: t('ed.secTitle'), buttons: names.map((n) => ({ label: n, value: n })) });
      if (v) insertAtLineStart(`[${v}]\n`);
    } else if (a === 'tr-' || a === 'tr+') transpose(a === 'tr+' ? 1 : -1);
    else if (a === 'find') openFind();
    else if (a === 'undo' || a === 'redo') { ta.focus(); document.execCommand(a); }
    else if (a === 'v-both' || a === 'v-text') {
      view.classList.toggle('ed-text-only', a === 'v-text');
      tools.querySelectorAll('.ed-seg button').forEach((x) => x.classList.toggle('on', x === b));
    }
  });

  // pronađi i zameni
  const fIn = findBar.querySelector('#edFind'), rIn = findBar.querySelector('#edRepl'), fN = findBar.querySelector('#edFindN');
  const count = () => { const q = fIn.value; const n = q ? ta.value.split(q).length - 1 : 0; fN.textContent = q ? t('ed.found', { n }) : ''; return n; };
  function openFind() { findBar.hidden = false; const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd); if (sel && !sel.includes('\n')) fIn.value = sel; fIn.focus(); fIn.select(); count(); }
  const next = () => { const q = fIn.value; if (!q) return false; let i = ta.value.indexOf(q, ta.selectionEnd); if (i < 0) i = ta.value.indexOf(q); if (i < 0) return false; ta.focus(); ta.setSelectionRange(i, i + q.length); const lh = ta.scrollHeight / Math.max(1, ta.value.split('\n').length); ta.scrollTop = Math.max(0, ta.value.slice(0, i).split('\n').length * lh - ta.clientHeight / 2); return true; };
  findBar.addEventListener('input', count);
  findBar.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); next(); } if (e.key === 'Escape') { findBar.hidden = true; ta.focus(); } });
  findBar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ef]'); if (!b) return;
    const q = fIn.value;
    if (b.dataset.ef === 'close') { findBar.hidden = true; ta.focus(); return; }
    if (!q) return;
    if (b.dataset.ef === 'next') next();
    else if (b.dataset.ef === 'one') { if (ta.value.slice(ta.selectionStart, ta.selectionEnd) !== q && !next()) return; ta.focus(); document.execCommand('insertText', false, rIn.value); ta.dispatchEvent(new Event('input', { bubbles: true })); next(); count(); }
    else if (b.dataset.ef === 'all') { const n = count(); if (!n) return; replaceAll(ta.value.split(q).join(rIn.value)); count(); toast(t('ed.replacedN', { n })); }
  });

  // prečice
  const onKey = (e) => {
    if (!document.body.contains(ta)) { document.removeEventListener('keydown', onKey); return; }
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); o.save(); }
    else if ((e.ctrlKey || e.metaKey) && (k === 'h' || k === 'f')) { e.preventDefault(); openFind(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y' && e.target === ta) { e.preventDefault(); document.execCommand('redo'); }
  };
  document.addEventListener('keydown', onKey);

  // nacrt: pamti se dok kucaš; posle čuvanja ili „Otkaži“ se briše
  const get = () => { try { return JSON.parse(localStorage.getItem(o.draftKey) || 'null'); } catch { return null; } };
  function saveDraft() { try { if (ta.value === o.original) localStorage.removeItem(o.draftKey); else localStorage.setItem(o.draftKey, JSON.stringify({ text: ta.value, base: o.original, at: Date.now() })); } catch {} }
  const clearDraft = () => { try { localStorage.removeItem(o.draftKey); } catch {} };
  o.root.querySelector('#eSave')?.addEventListener('click', clearDraft, true);
  o.root.querySelector('#eCancel')?.addEventListener('click', () => setTimeout(() => { if (!document.body.contains(ta)) clearDraft(); }, 300), true);
  const d = get();
  if (d && d.text && d.text !== ta.value && d.base === o.original && Date.now() - d.at < 14 * 864e5) {
    dialog({ title: t('ed.draftTitle'), body: t('ed.draftBody'), buttons: [{ label: t('ed.draftDiscard'), value: 'no' }, { label: t('ed.draftUse'), value: 'yes', kind: 'primary' }] }).then((v) => {
      if (v === 'yes') { ta.value = d.text; ta.dispatchEvent(new Event('input', { bubbles: true })); } else clearDraft();
    });
  }
  return { transpose };
}
