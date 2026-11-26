// v2.5.2: „Saveti sa lista“ — umesto dela „Beleške“ (engleski tekst sa strelicama ritma) jedna kartica u izgledu
// aplikacije: ✨ Novo u pesmi · ⚠ Pazi na (→ Promene sa tom promenom) · 🎯 Vežbaj (→ vežba „Sa lista“) · ＋ Još N saveta.
// Izvor: song.tips (MARLI put: sr i en) ili deo „Beleške“ uvezenog lista (New in this song / Watch out for / Practise this).
import { t, getLang } from './i18n.js';
import { esc } from './ui.js';
import { dn } from './naming.js';

const NOTES_SEC = /^(beleške|beleske|notes|napomene|saveti|tips)$/i;
const CH = /^[A-H][#b]?(m|maj7|maj9|m7|m9|m6|mmaj7|7|9|6|sus2|sus4|7sus4|add9|dim|dim7|aug|m7b5|5)?(\/[A-H][#b]?)?$/;
export const notesIndex = (song) => (song.sections || []).findIndex((x) => NOTES_SEC.test(String(x.name || '').trim()));

/** Saveti pesme: { new, sub, watch[], practise[], other[], fromNotes } ili null. */
export function tipsOf(song) {
  if (song.tips && typeof song.tips === 'object') {
    const x = song.tips[getLang()] || song.tips.en || song.tips.sr;
    if (x) return { new: x.new || '', sub: x.sub || '', watch: x.watch || [], practise: x.practise || [], other: x.other || [], fromNotes: false };
  }
  const i = notesIndex(song); if (i < 0) return null;
  const out = { new: '', sub: '', watch: [], practise: [], other: [], fromNotes: true };
  for (const l of song.sections[i].lines || []) {
    const s = String(l.text || '').trim(); if (!s) continue;
    const body = s.replace(/^[^:]*:\s*/, '');
    if (/^(new in this song|novo u pesmi)\s*:/i.test(s)) { const [a, ...b] = body.split(/\.\s+/); out.new = a.replace(/\.$/, ''); out.sub = b.join('. '); }
    else if (/^(watch out for|pazi na)\s*:/i.test(s)) out.watch.push(...body.split(/(?:^|\s)\d\.\s+/).map((x) => x.trim()).filter(Boolean));
    else if (/^(practi[sc]e this|vežbaj ovo|vezbaj ovo)\s*:/i.test(s)) out.practise.push(body);
    else out.other.push(s);
  }
  return out.new || out.watch.length || out.practise.length || out.other.length ? out : null;
}

// akordi u tekstu saveta u izabranim imenima (H umesto B…)
const chordsIn = (s) => esc(s).replace(/(^|[\s(,→])([A-H][#b]?[^\s,.;:)]*)/g, (m, a, c) => (CH.test(c) ? a + esc(dn(c)) : m));
const row = (ic, b, s, tap = '') => `<${tap ? `button type="button" data-tip="${tap}"` : 'div'} class="tch-row"><span class="sr-ic" aria-hidden="true">${ic}</span><span><b>${esc(b)}</b><small>${s}</small></span>${tap ? '<span class="chev" aria-hidden="true">›</span>' : ''}</${tap ? 'button' : 'div'}>`;

/** HTML kartice. can: { chg: bool, pt: bool } — da li red vodi u vežbu. open: prikazani svi saveti. */
export function tipsCardHTML(tp, can = {}, open = false) {
  if (!tp) return '';
  const rows = [];
  if (tp.new) rows.push(row('✨', t('tips.new'), chordsIn(tp.new)));
  if (tp.watch[0]) rows.push(row('⚠', t('tips.watch'), chordsIn(tp.watch[0]), can.chg ? 'chg' : ''));
  if (tp.practise[0]) rows.push(row('🎯', t('tips.practise'), chordsIn(tp.practise[0]), can.pt ? 'pt' : ''));
  const more = [...(tp.sub ? [tp.sub] : []), ...tp.watch.slice(1), ...tp.practise.slice(1), ...tp.other];
  if (more.length && !open) rows.push(`<button type="button" class="tch-row" data-tip="more"><span class="sr-ic" aria-hidden="true">＋</span><span><b>${esc(t('tips.more', { n: more.length }))}</b><small>${chordsIn(more[0])}</small></span><span class="chev" aria-hidden="true">›</span></button>`);
  if (more.length && open) rows.push(`<div class="tch-row tips-all"><ul>${more.map((x) => `<li>${chordsIn(x)}</li>`).join('')}</ul></div>`);
  if (!rows.length) return '';
  return `<div class="tch-sec"><span>${esc(t('tips.title'))}</span></div><div class="set-grp tips-grp">${rows.join('')}</div>`;
}
