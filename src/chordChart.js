// v2.4.33: PDF „lista akorada“ (chord chart) bez teksta pesme — npr. naslov dela („INTRO“, „CHORUS“) pa redovi samo sa
// akordima (svaka kućica = jedan prolaz ritma), „×2“ na kraju reda, „THE PLAY THROUGH“ (redosled delova), „Capo 7th fret“,
// saveti („WATCH OUT FOR“, „PRACTISE THIS“, „NEW IN THIS SONG“ — i u dve kolone). Pravi se tekst pesme za textToSections:
// delovi redom kako se sviraju (ponavljanja ×N), kapodaster; saveti u deo „Beleške“ na kraju. Čista logika (test u Node-u).

const LABEL = /^((?:before |after |back to |\d(?:st|nd|rd|th) |first |second |third |last )?(?:part [a-f]|intro|uvod|verse|strofa|chorus|refren|pre[- ]?chorus|pre[- ]?refren|bridge|most|middle ?8|outro|kraj|završetak|solo|instrumental|interlude|međuigra|coda|riff|break|tag|turnaround|ending|hook)(?:\s*\d+)?)$/i;
// v2.4.37: naslov dela sa napomenom („VERSE 2 4 times this time“, „BEFORE VERSE 2 This only happens once“)
const LABEL_NOTE = /^((?:before |after |back to |\d(?:st|nd|rd|th) |first |second |third |last )?(?:part [a-f]|intro|uvod|verse|strofa|chorus|refren|pre[- ]?chorus|pre[- ]?refren|bridge|most|middle ?8|outro|kraj|solo|instrumental|interlude|coda|riff|break|ending|hook)(?:\s*\d+)?)\s+([^\d×x].*|\d+\s*(?:times|puta|x|×).*)$/i;
const SONG_HEAD = /^(the song|pesma|song)$/i;
const BY_STRUM = /^(the song,? strum by strum|strum by strum)$/i;
const COUNT_TOK = /^(\d|&|\+|e|a|i)$/;
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
  const HEADS = /^(chords|strum|strumming|watch out for|practi[sc]e this|new in this song|the song|the play ?through|tab|tune|tuning|akordi|ritam)\b/i;
  const isHeading = (x) => x.length <= 40 && /[A-Z]/.test(x) && x === x.toUpperCase() && x.split(' ').length <= 6 && !HEADS.test(x) && !isChord(x.split(' ')[0]);
  const nextIsChords = (i) => { for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) { const n = norm(lines[j]); if (!n) continue; return !!(chordRow(n) || looseRow(n)); } return false; };
  // red sa akordima i kratkom napomenom (najviše 6 reči koje nisu akordi): akordi + ×N, napomena se odbacuje
  const looseRow = (x) => { const tk = x.split(/\s+/).filter(Boolean); const ch = []; let rep = 0, other = 0; for (const t of tk) { const r = repOf(t.replace(/[,.]$/, '')); if (r && !rep) rep = r; else if (isChord(t)) { if (other) break; ch.push(t); } else other++; } return ch.length && other <= 6 && (ch.length >= 2 || tk.length <= 3) ? { ch, rep } : null; };
  const chordRow = (s) => { const tk = s.split(/\s+/).filter(Boolean); if (!tk.length) return null; const ch = []; let rep = 0; for (const t of tk) { const r = repOf(t); if (r) rep = r; else if (t === '|' || t === '/' || t === '%') continue; else if (isChord(t)) ch.push(t); else return null; } return ch.length ? { ch, rep } : null; };
  let inSong = false, last = null; // last: { raw, row } — poslednji red akorada (za brojanje ispod njega)
  for (let i = 0; i < lines.length; i++) {
    const s = norm(lines[i]);
    // v2.4.37: „THE SONG“ (pesma u jednoj petlji, bez naslova dela) i „strum by strum“ (isto, detaljno — preskače se)
    if (SONG_HEAD.test(s)) { inSong = true; cur = null; flushNotes(); continue; }
    if (BY_STRUM.test(s)) { if (defs.some((d) => d.rows.length)) break; inSong = true; cur = null; continue; }
    // red brojanja („1 & 2 & 3 & 4 &“) ispod reda akorada: akordi po dobama → takt po takt ([A B] = dva u jednom taktu)
    const ct = s.split(' ');
    if (ct.length >= 4 && ct[0] === '1' && ct.every((x) => COUNT_TOK.test(x))) {
      if (cur && last && cur.rows[cur.rows.length - 1] === last.row) { const bars = barsFromCounts(last.raw, lines[i], isChord); if (bars) cur.rows[cur.rows.length - 1] = bars; last = null; }
      continue;
    }
    // ×N sam u redu: ceo deo se ponavlja; više ×N ispod akorada: svaki akord toliko puta
    const reps = ct.map(repOf);
    if (ct.length && reps.every((r) => r > 0)) {
      if (cur && reps.length === 1) cur.rep = reps[0];
      else if (cur && last && last.row.length === reps.length) { const row = []; last.row.forEach((c, k) => { for (let r = 0; r < Math.min(8, reps[k]); r++) row.push(c); }); cur.rows[cur.rows.length - 1] = row; last = null; }
      continue;
    }
    if (!s) { if (noteCols && noteCols.some((c) => c.lines.length)) flushNotes(); continue; }
    if (FOOT.test(s) && s.length < 60) { flushNotes(); continue; }
    const cm = /\bcapo\b[^0-9]{0,12}(\d{1,2})(?:st|nd|rd|th)?/i.exec(s) || /\bkapo(?:daster)?\b[^0-9]{0,6}(\d{1,2})/i.exec(s);
    if (cm && !capo) capo = Math.min(12, Number(cm[1]) || 0);
    // redosled delova: naslov pa red sa nazivima delova
    if (ORDER_HEAD.test(s)) {
      let j = i + 1; while (j < lines.length && !norm(lines[j])) j++;
      const names = norm(lines[j] || '').split(' ').filter(Boolean);
      const cn = cols(lines[j] || '');
      if (names.length >= 2 && names.every((w) => LABEL.test(w))) { order = names; i = j; }
      else if (cn.length >= 2 && cn.filter((w) => LABEL.test(w)).length >= 2) { order = cn.filter((w) => LABEL.test(w)); i = j; }
      else inSong = true; // „THE PLAY THROUGH“ sa delovima ispod (naslov pa akordi)
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
    if (LABEL.test(s)) { cur = { name: s, rows: [], rep: 1 }; defs.push(cur); last = null; continue; }
    if (inSong && isHeading(s) && nextIsChords(i)) { cur = { name: s.replace(/,.*$/, ''), rows: [], rep: 1, ...(/,/.test(s) ? { note: s.replace(/^[^,]*,\s*/, '') } : {}) }; defs.push(cur); last = null; continue; }
    const ln = LABEL_NOTE.exec(s);
    if (ln && !chordRow(ln[2])) { const tm = /(\d+)\s*(?:times|puta|x|×)/i.exec(ln[2]); cur = { name: ln[1], rows: [], rep: tm ? Math.min(8, Number(tm[1])) : 1, note: ln[2].trim() }; defs.push(cur); last = null; continue; }
    // naslov dela i akordi u istom redu
    const lm = /^((?:part [a-f]|pre chorus|\S+)(?:\s\d+)?)\s+(.*)$/i.exec(s);
    if (lm && LABEL.test(lm[1])) { const r = chordRow(lm[2]) || looseRow(lm[2]); if (r) { cur = { name: lm[1], rows: [r.ch], rep: r.rep || 1 }; defs.push(cur); continue; } }
    const r = chordRow(s) || (inSong || cur ? looseRow(s) : null);
    if (r && !cur && inSong) { cur = { name: 'Song', rows: [], rep: 1 }; defs.push(cur); }
    if (r) { if (cur) { cur.rows.push(r.ch); last = { raw: lines[i], row: r.ch }; if (r.rep) cur.rep = r.rep; } continue; } // bez dela: dijagrami akorada u zaglavlju
    cur = null; last = null;
    if (defs.length && /[a-zčćšđž]{3,}/i.test(s) && s.split(' ').length >= 4 && !/[.:!?)]$/.test(s)) lyric++; // uputstva (rečenice) nisu tekst pesme
  }
  flushNotes();
  const real = defs.filter((d) => d.rows.length);
  const loop = real.length === 1 && real[0].name === 'Song' && new Set(real[0].rows.flat()).size >= 2; // v2.4.37: cela pesma = jedna petlja
  if ((real.length < 2 && !loop) || lyric > real.length + 3) return null;
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
    for (let r = 0; r < Math.min(8, Math.max(1, d.rep)); r++) for (const row of d.rows) out.push(row.map((c) => c.padEnd(Math.max(7, c.length + 2), ' ')).join('').trimEnd());
    out.push('');
  }
  if (notes.length) { out.push('[Beleške]'); for (const n of notes.slice(0, 12)) out.push(n); }
  return { text: out.join('\n').trim(), capo, order: !!order, notes };
}

/**
 * v2.4.37: red akorada iznad reda brojanja („Em7 … G“ nad „1 & 2 & 3 & 4 &“, može više taktova u redu) → takt po takt:
 * ['Em7 G' u istom taktu] → '[Em7', 'G]' (zagrada = jedan prolaz ritma); akord preko celog takta ostaje sam, a ako traje
 * više taktova — ponavlja se. null ako ne može da se poveže.
 */
export function barsFromCounts(chordRaw, countRaw, isChord) {
  const toks = (str) => { const out = []; const re = /\S+/g; let m; while ((m = re.exec(str))) out.push({ s: m[0], c: m.index }); return out; };
  const ch = toks(chordRaw).filter((x) => isChord(x.s));
  const cn = toks(countRaw).filter((x) => COUNT_TOK.test(x.s));
  if (!ch.length || cn.length < 4) return null;
  // vreme svake oznake (u dobama), taktovi počinju na „1“
  let bar = -1, beat = 0; const B = Math.max(...cn.filter((x) => /^\d$/.test(x.s)).map((x) => Number(x.s)));
  if (!(B >= 2 && B <= 12)) return null;
  for (const x of cn) {
    if (/^\d$/.test(x.s)) { if (x.s === '1') bar++; beat = Number(x.s) - 1; x.t = Math.max(0, bar) * B + beat; }
    else x.t = Math.max(0, bar) * B + beat + (x.s === 'e' ? 0.25 : x.s === 'a' ? 0.75 : 0.5);
  }
  const bars = bar + 1;
  const at = ch.map((x) => { let best = cn[0]; for (const y of cn) if (Math.abs(y.c - x.c) < Math.abs(best.c - x.c)) best = y; return { s: x.s, t: best.t }; }).sort((a, b) => a.t - b.t);
  if (at[0].t > 0) at[0].t = 0; // prvi akord važi od početka reda
  const out = [];
  for (let b = 0; b < bars; b++) {
    const from = b * B, to = from + B;
    const live = at.filter((x, k) => x.t < to && (k + 1 >= at.length || at[k + 1].t > from));
    if (!live.length) continue;
    if (live.length === 1) out.push(live[0].s);
    else live.forEach((x, k) => out.push(k === 0 ? '[' + x.s : k === live.length - 1 ? x.s + ']' : x.s));
  }
  return out.length ? out : null;
}

/** v2.4.37: čitanje serije iz zaglavlja lista: „THE SONG PATH LEVEL 3“ … „Song 6 of 10“ → { name, level, n, of } ili null. */
export function seriesFromLines(lines) {
  let name = '', level = 0, n = 0, of = 0;
  for (const raw of (lines || []).slice(0, 12)) {
    const s = String(raw || '').replace(/\s+/g, ' ').trim();
    const m = /(?:^|\s)(?:song|pesma|lesson|lekcija)\s+(\d{1,2})\s+(?:of|od)\s+(\d{1,2})\b/i.exec(s);
    if (m && !n) { n = Number(m[1]); of = Number(m[2]); }
    const l = /^(.{3,40}?)\s+(?:level|nivo)\s+(\d{1,2})\b/i.exec(s);
    if (l && !name) { name = l[1].trim(); level = Number(l[2]); }
  }
  if (!name || !n || n > of) return null;
  const nice = name.toLowerCase().replace(/(^|\s)\S/g, (x) => x.toUpperCase());
  return { name: nice, level, n, of };
}

