// v2.4.33: PDF „lista akorada“ (chord chart) bez teksta pesme — npr. naslov dela („INTRO“, „CHORUS“) pa redovi samo sa
// akordima (svaka kućica = jedan prolaz ritma), „×2“ na kraju reda, „THE PLAY THROUGH“ (redosled delova), „Capo 7th fret“,
// saveti („WATCH OUT FOR“, „PRACTISE THIS“, „NEW IN THIS SONG“ — i u dve kolone). Pravi se tekst pesme za textToSections:
// delovi redom kako se sviraju (ponavljanja ×N), kapodaster; saveti u deo „Beleške“ na kraju. Čista logika (test u Node-u).

const LABEL = /^(intro|uvod|verse|strofa|chorus|refren|pre-?chorus|pre-?refren|bridge|most|middle ?8|outro|kraj|završetak|solo|instrumental|interlude|međuigra|coda|riff|break|tag|turnaround|ending|hook)(\s*\d+)?$/i;
const REPEAT = /^\(?(?:[×x](\d{1,2})|(\d{1,2})[×x])\)?$/i;
const NOTE_HEAD = /^(new in this song|watch out for|practi[sc]e this|tips?|napomen[ae]|pazi na|vežbaj ovo|saveti?)$/i;
const ORDER_HEAD = /^(the )?(play[ -]?through|song (form|structure|order)|arrangement|form|structure|struktura|redosled)$/i;
const FOOT = /(is on the next page|next page|strana \d|page \d)/i;

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const cols = (s) => s.trim().split(/\s{3,}/).map((x) => x.trim()).filter(Boolean);
const repOf = (t) => { const r = REPEAT.exec(t); return r ? Number(r[1] || r[2]) : 0; };

/**
 * lines: redovi teksta (pdfToPlainText); isChord(tok) → bool.
 * Vraća { text, capo, order, notes } ili null ako list nije „lista akorada“ (mora bar 2 dela sa akordima i bez teksta pesme).
 */
export function chordChartFromLines(lines, isChord) {
  const defs = []; // [{ name, rows: [[chords]], rep }]
  let cur = null, order = null, capo = 0, lyric = 0;
  const notes = []; let noteCols = null;
  const flushNotes = () => { if (noteCols) { for (const c of noteCols) if (c.lines.length) notes.push((c.head ? c.head + ': ' : '') + c.lines.join(' ').replace(/\s+/g, ' ').trim()); noteCols = null; } };
  const chordRow = (s) => { const tk = s.split(/\s+/).filter(Boolean); if (!tk.length) return null; const ch = []; let rep = 0; for (const t of tk) { const r = repOf(t); if (r) rep = r; else if (t === '|' || t === '/' || t === '%') continue; else if (isChord(t)) ch.push(t); else return null; } return ch.length ? { ch, rep } : null; };
  for (let i = 0; i < lines.length; i++) {
    const s = norm(lines[i]);
    if (!s) { if (noteCols && noteCols.some((c) => c.lines.length)) flushNotes(); continue; }
    if (FOOT.test(s) && s.length < 60) { flushNotes(); continue; }
    const cm = /\bcapo\b[^0-9]{0,12}(\d{1,2})(?:st|nd|rd|th)?/i.exec(s) || /\bkapo(?:daster)?\b[^0-9]{0,6}(\d{1,2})/i.exec(s);
    if (cm && !capo) capo = Math.min(12, Number(cm[1]) || 0);
    // redosled delova: naslov pa red sa nazivima delova
    if (ORDER_HEAD.test(s)) {
      let j = i + 1; while (j < lines.length && !norm(lines[j])) j++;
      const names = norm(lines[j] || '').split(' ').filter(Boolean);
      if (names.length >= 2 && names.every((w) => LABEL.test(w))) { order = names; i = j; }
      cur = null; flushNotes(); continue;
    }
    // saveti (i dve kolone u istom redu)
    const hc = cols(lines[i]);
    if (hc.length && hc.every((c) => NOTE_HEAD.test(c))) { flushNotes(); cur = null; noteCols = hc.map((h) => ({ head: h.charAt(0) + h.slice(1).toLowerCase(), lines: [] })); continue; }
    if (noteCols) {
      if (noteCols.length > 1) { const parts = cols(lines[i]); const startCol = parts.length < noteCols.length && /^\s{20,}/.test(lines[i]) ? 1 : 0; parts.forEach((p, k) => { const c = noteCols[Math.min(noteCols.length - 1, k + startCol)]; c.lines.push(p); }); }
      else noteCols[0].lines.push(s);
      continue;
    }
    // naslov dela (sam u redu) — akordi u sledećim redovima
    if (LABEL.test(s)) { cur = { name: s, rows: [], rep: 1 }; defs.push(cur); continue; }
    // naslov dela i akordi u istom redu
    const lm = /^(\S+(?:\s\d+)?)\s+(.*)$/.exec(s);
    if (lm && LABEL.test(lm[1])) { const r = chordRow(lm[2]); if (r) { cur = { name: lm[1], rows: [r.ch], rep: r.rep || 1 }; defs.push(cur); continue; } }
    const r = chordRow(s);
    if (r) { if (cur) { cur.rows.push(r.ch); if (r.rep) cur.rep = r.rep; } continue; } // bez dela: dijagrami akorada u zaglavlju
    cur = null;
    if (defs.length && /[a-zčćšđž]{3,}/i.test(s) && s.split(' ').length >= 4) lyric++;
  }
  flushNotes();
  const real = defs.filter((d) => d.rows.length);
  if (real.length < 2 || lyric > real.length + 3) return null;
  const key = (n) => n.toLowerCase().replace(/\s+/g, ' ');
  const byName = new Map(); for (const d of real) if (!byName.has(key(d.name))) byName.set(key(d.name), d);
  const seq = order ? order.map((n) => byName.get(key(n))).filter(Boolean) : real;
  const used = seq.length >= 2 ? seq : real;
  const total = {}; for (const d of used) total[key(d.name)] = (total[key(d.name)] || 0) + 1;
  const seen = {}, out = [];
  for (const d of used) {
    const k = key(d.name); seen[k] = (seen[k] || 0) + 1;
    const nm = d.name.charAt(0).toUpperCase() + d.name.slice(1).toLowerCase();
    out.push(`[${nm}${total[k] > 1 && !/\d$/.test(nm) ? ' ' + seen[k] : ''}]`);
    for (let r = 0; r < Math.min(8, Math.max(1, d.rep)); r++) for (const row of d.rows) out.push(row.map((c) => c.padEnd(7, ' ')).join('').trimEnd());
    out.push('');
  }
  if (notes.length) { out.push('[Beleške]'); for (const n of notes.slice(0, 12)) out.push(n); }
  return { text: out.join('\n').trim(), capo, order: !!order, notes };
}
