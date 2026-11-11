// v1.96: niz akorda za vežbe (Promena akorda, plan nastavnika) — bilo koji akordi, koliko god, svaki sa svojim trajanjem.
// Unos: kucanje (bilo koji naziv, predlozi dok kucaš), akordi koji pašu u ton, akordi iz tvojih pesama.
// „Najteža promena“: poređenje hvatova (koliko prstiju se pomera, barre) + savet (koji prst ostaje na mestu).
import { t } from './i18n.js';
import { esc, dialog } from './ui.js';
import { dn } from './naming.js';
import { getVoicings } from './chords.js';
import { parseChord } from './music.js';

export const MAX_SEQ = 16;
export const LENS = [2, 4, 8]; // dobe: ½ takta · 1 takt · 2 takta (4/4)
/** Gotovi nizovi: parovi za početnike + česte progresije (svaki akord = 1 takt, parovi 2 dobe). */
export const PRESETS = [
  { id: 'emg', seq: ['Em', 'G'], b: 2 }, { id: 'gc', seq: ['G', 'C'], b: 2 }, { id: 'cam', seq: ['C', 'Am'], b: 2 }, { id: 'da', seq: ['D', 'A'], b: 2 }, { id: 'gd', seq: ['G', 'D'], b: 2 }, { id: 'ame', seq: ['Am', 'E'], b: 2 }, { id: 'cf', seq: ['C', 'F'], b: 2 },
  { id: 'pop', seq: ['G', 'D', 'Em', 'C'], b: 4 }, { id: 'amfcg', seq: ['Am', 'F', 'C', 'G'], b: 4 }, { id: 'c50', seq: ['C', 'Am', 'F', 'G'], b: 4 }, { id: 'dag', seq: ['D', 'A', 'Bm', 'G'], b: 4 },
  { id: 'blues', seq: ['A7', 'A7', 'A7', 'A7', 'D7', 'D7', 'A7', 'A7', 'E7', 'D7', 'A7', 'E7'], b: 4 },
];
export const presetLabel = (p) => (p.seq.length === 2 ? `${dn(p.seq[0])} ↔ ${dn(p.seq[1])}` : p.id === 'blues' ? t('cs.blues') : p.seq.map(dn).join('–'));
export const known = (c) => !!(c && parseChord(c) && getVoicings(c).length);
/** Očisti niz iz bilo kog izvora: [{ c, b }] (ili ['G','D'] sa podrazumevanim trajanjem). */
export function cleanSeq(seq, b = 4) {
  return (Array.isArray(seq) ? seq : []).slice(0, MAX_SEQ).map((x) => (typeof x === 'string' ? { c: x, b } : x)).filter((x) => x && known(x.c)).map((x) => ({ c: String(x.c).slice(0, 10), b: LENS.includes(x.b) ? x.b : b }));
}
export const seqLabel = (seq) => (seq.length === 2 ? `${dn(seq[0].c)} ↔ ${dn(seq[1].c)}` : seq.map((x) => dn(x.c)).join(' – '));
export const lenLabel = (b) => t(b === 2 ? 'cs.half' : b === 8 ? 'cs.two' : 'cs.one');

// ---------------- najteža promena ----------------
function fretted(v) { return (v.frets || []).map((f, s) => (f > 0 ? `${s}:${f}:${v.fingers?.[s] || 0}` : null)).filter(Boolean); }
/** Koliko je teška promena a → b (0 = isti hvat) i koji prsti ostaju. */
export function changeCost(a, b) {
  const va = getVoicings(a)[0], vb = getVoicings(b)[0]; if (!va || !vb) return { cost: 0, stay: [] };
  const A = new Set(fretted(va)), Bf = fretted(vb);
  const stay = Bf.filter((x) => A.has(x)).map((x) => Number(x.split(':')[2])).filter((f) => f > 0);
  const moved = Bf.filter((x) => !A.has(x)).length + [...A].filter((x) => !Bf.includes(x)).length * 0.5;
  return { cost: moved + (vb.barre ? 3 : 0) + (va.barre && !vb.barre ? 1 : 0), stay, barre: !!vb.barre };
}
/** Najteža promena u nizu (uključujući povratak sa kraja na početak). null ako su svi isti. */
export function hardest(seq) {
  if (seq.length < 2) return null;
  let best = null;
  for (let i = 0; i < seq.length; i++) {
    const a = seq[i].c, b = seq[(i + 1) % seq.length].c; if (a === b) continue;
    const r = changeCost(a, b); if (!best || r.cost > best.cost) best = { a, b, ...r };
  }
  return best;
}
export function tipOf(h) {
  if (!h) return '';
  if (h.stay.length) return t('cs.tipStay', { f: [...new Set(h.stay)].join(', ') });
  if (h.barre) return t('cs.tipBarre', { c: dn(h.b) });
  return t('cs.tipAll');
}

// ---------------- predlozi ----------------
const NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, H: 11 };
/** Akordi koji pašu u durski ton (I ii iii IV V vi). */
export function keyChords(key) { const r = PC[key]; if (r == null) return []; return [[0, ''], [2, 'm'], [4, 'm'], [5, ''], [7, ''], [9, 'm']].map(([d, q]) => NOTES[(r + d) % 12] + q).filter(known); }
export const KEYS = ['C', 'G', 'D', 'A', 'E', 'F'];
/** Akordi iz tvojih pesama (najčešći prvi). */
export async function libraryChords(limit = 12) {
  const { songs } = await import('./db.js'); const cnt = new Map();
  for (const s of await (songs.all ? songs.all() : songs.list()).catch(() => [])) { if (s.deleted || s.demo) continue; for (const sec of s.sections || []) for (const l of sec.lines || []) for (const c of l.chords || []) if (c.chord) cnt.set(c.chord, (cnt.get(c.chord) || 0) + 1); }
  return [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).filter(known).slice(0, limit);
}
/** Predlozi dok kucaš: „Am“ → Am, Am7, Asus2, A… (samo akordi koje aplikacija zna da prikaže). */
export function suggest(q) {
  const s = String(q || '').trim(); if (!s) return [];
  const m = /^([A-Ha-h])([#b♯♭]?)(.*)$/.exec(s); if (!m) return [];
  const root = m[1].toUpperCase().replace('H', 'B') + (m[2] || '').replace('♯', '#').replace('♭', 'b'), rest = m[3];
  const quals = ['', 'm', '7', 'm7', 'maj7', 'sus2', 'sus4', 'add9', '6', 'dim', '9', '5'];
  const out = [root + rest, ...quals.filter((x) => x.startsWith(rest)).map((x) => root + x)];
  return [...new Set(out)].filter(known).slice(0, 6);
}

/**
 * Dijalog: izaberi akord (i trajanje). Vraća { c, b } ili null; { del: true } = ukloni.
 * cur = postojeći akord u nizu (izmena) ili null (novi).
 */
export async function askChord({ cur = null, b = 4, title = '' } = {}) {
  const lib = await libraryChords().catch(() => []);
  let key = 'G', val = cur ? cur.c : '', len = cur ? cur.b : b;
  const p = dialog({ title: title || t(cur ? 'cs.edit' : 'cs.add'), html: true, className: 'tch-dlg cs-dlg', body: `
    <input id="csIn" class="cs-in" maxlength="10" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${esc(t('cs.typePh'))}" value="${esc(val)}">
    <div class="cs-sug" id="csSug"></div>
    <div class="cs-lbl"><span>${esc(t('cs.inKey'))}</span></div><div class="cs-keys">${KEYS.map((k) => `<button type="button" class="cs-key${k === key ? ' on' : ''}" data-k="${k}">${esc(dn(k))}</button>`).join('')}</div>
    <div class="pr-chips" id="csKey"></div>
    ${lib.length ? `<div class="cs-lbl"><span>${esc(t('cs.fromSongs'))}</span></div><div class="pr-chips">${lib.map((c) => `<button type="button" class="chip" data-c="${esc(c)}">${esc(dn(c))}</button>`).join('')}</div>` : ''}
    <div class="cs-lbl"><span>${esc(t('cs.len'))}</span></div><div class="seg-tabs" id="csLen">${LENS.map((x) => `<button type="button" data-l="${x}" class="${x === len ? 'active' : ''}">${esc(lenLabel(x))}</button>`).join('')}</div>
    <p class="cs-err" id="csErr" hidden></p>`,
    buttons: [...(cur ? [{ label: t('cs.remove'), value: 'del', kind: 'danger' }] : []), { label: t('common.cancel'), value: null }, { label: t(cur ? 'common.save' : 'cs.addBtn'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  const $ = (s) => box.querySelector(s);
  const drawSug = () => { const s = suggest(val); $('#csSug').innerHTML = s.map((c) => `<button type="button" class="chip${c === val ? ' active' : ''}" data-c="${esc(c)}">${esc(dn(c))}</button>`).join(''); $('#csErr').hidden = true; };
  const drawKey = () => { $('#csKey').innerHTML = keyChords(key).map((c) => `<button type="button" class="chip k" data-c="${esc(c)}">${esc(dn(c))}</button>`).join(''); box.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x.dataset.k === key)); };
  drawSug(); drawKey();
  $('#csIn').addEventListener('input', (e) => { val = e.target.value.trim(); drawSug(); });
  box.addEventListener('click', (e) => {
    const c = e.target.closest('[data-c]'), k = e.target.closest('[data-k]'), l = e.target.closest('[data-l]');
    if (c) { val = c.dataset.c; $('#csIn').value = dn(val); drawSug(); }
    if (k) { key = k.dataset.k; drawKey(); }
    if (l) { len = +l.dataset.l; box.querySelectorAll('[data-l]').forEach((x) => x.classList.toggle('active', x === l)); }
  });
  setTimeout(() => { if (!cur) $('#csIn')?.focus(); }, 60);
  const v = await p;
  if (v === 'del') return { del: true };
  if (v !== 'ok') return null;
  const name = normName(val);
  if (!known(name)) { const { toast } = await import('./ui.js'); toast(t('cs.unknown', { c: val || '?' }), 'error'); return askChord({ cur: cur ? { ...cur } : null, b: len, title }); }
  return { c: name, b: len };
}
/** H → B (interno), ♯/♭, mala slova. */
export function normName(s) {
  const m = /^\s*([A-Ha-h])([#b♯♭]?)(.*)$/.exec(String(s || '')); if (!m) return String(s || '').trim();
  return m[1].toUpperCase().replace('H', 'B') + (m[2] || '').replace('♯', '#').replace('♭', 'b') + m[3].trim();
}
