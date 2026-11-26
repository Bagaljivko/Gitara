// v2.4.37: „Pronađi tekst“ / „Nalepi“ — tekst pesme ide uz akorde koji već postoje (npr. sa lista akorada bez teksta).
// Tekst se deli na delove (prazan red, oznake „Chorus“, „[Refren]“…), delovi teksta se spajaju sa delovima pesme
// (strofe redom, refren uz refren), pa se akordi dela raspoređuju po redovima — po vremenu reda ako ga ima, inače po slogovima.
// Tekst ostaje samo u pesmi korisnika (uređaj + njegov Drive); MARLI ga nigde ne objavljuje. Čista logika (test u Node-u).

const LABEL = /^\[?\(?\s*(intro|uvod|verse|strofa|chorus|refren|pre-?chorus|pre-?refren|bridge|most|middle ?8|outro|kraj|solo|instrumental|interlude|hook|refrain|coda)(\s*\d+)?\s*[\])]?:?\s*$/i;
const NO_WORDS = /^(intro|uvod|solo|instrumental|interlude|međuigra|outro|kraj|coda|riff|break|turnaround|beleške|notes)/i;
const kind = (name) => { const n = String(name || '').toLowerCase(); return /chorus|refren|refrain|hook/.test(n) && !/pre/.test(n) ? 'c' : /pre-?(chorus|refren)/.test(n) ? 'p' : /bridge|most|middle/.test(n) ? 'b' : /verse|strofa/.test(n) ? 'v' : 'o'; };
const syl = (w) => Math.max(1, (String(w).toLowerCase().match(/[aeiouyąęó\u0430\u0435\u0438\u043e\u0443áéíóúäöüàèìòù]+/g) || []).length);

/** Tekst (obican ili LRC „[00:12.34] red“) → blokovi [{ label?, lines: [{ text, t? }] }]. */
export function lyricBlocks(raw) {
  const blocks = []; let cur = null;
  const push = () => { if (cur && cur.lines.length) blocks.push(cur); cur = null; };
  for (const r of String(raw || '').replace(/\r/g, '').split('\n')) {
    let s = r.trim(), tm;
    const m = /^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/.exec(s);
    if (m) { tm = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number('0.' + m[3]) : 0); s = m[4].trim(); }
    if (!s) { push(); continue; }
    if (LABEL.test(s)) { push(); cur = { label: s.replace(/[[\]():]/g, '').trim(), lines: [] }; continue; }
    if (!cur) cur = { lines: [] };
    cur.lines.push({ text: s.slice(0, 200), ...(tm !== undefined ? { t: tm } : {}) });
  }
  push();
  return blocks;
}

/**
 * song (delovi sa akordima, bez teksta) + tekst → novi delovi: akordi iznad reči. Delovi bez reči (uvod, solo…) ostaju.
 * opts.bpm: tempo (za raspored po vremenu reda). Vraća { sections, matched, blocks } ili null ako nema šta da se spoji.
 */
export function fitLyrics(song, raw, { bpm = 0 } = {}) {
  const blocks = lyricBlocks(raw);
  if (!blocks.length) return null;
  const secs = song.sections || [];
  const target = secs.map((s, i) => ({ s, i })).filter(({ s }) => !NO_WORDS.test(String(s.name || '').trim()) && (s.lines || []).some((l) => (l.chords || []).length));
  // spajanje: blok sa oznakom ide na prvi slobodan deo iste vrste; ponovljen blok (isti tekst) ide na deo iste vrste kao prvi put
  const used = new Set(), map = new Map(); const seen = new Map();
  let k = 0;
  for (const b of blocks) {
    const key = b.lines.map((l) => l.text.toLowerCase()).join('|');
    let want = b.label ? kind(b.label) : seen.has(key) ? seen.get(key) : null;
    let pick = null;
    if (want) pick = target.find((x) => !used.has(x.i) && kind(x.s.name) === want);
    if (!pick) { while (k < target.length && used.has(target[k].i)) k++; pick = target[k] || null; }
    if (!pick) break;
    used.add(pick.i); map.set(pick.i, b);
    if (!seen.has(key)) seen.set(key, kind(pick.s.name));
  }
  if (!map.size) return null;
  const sections = secs.map((s, i) => {
    const b = map.get(i); if (!b) return s;
    const chords = (s.lines || []).flatMap((l) => [...(l.chords || [])].sort((a, c) => a.position - c.position).map((c) => ({ chord: c.chord, ...(c.g ? { g: true } : {}) })));
    return { ...s, lines: placeChords(chords, b.lines, bpm) };
  });
  return { sections, matched: map.size, blocks: blocks.length };
}

/** Akordi (redom) po redovima teksta: svaki akord na početak „svog“ dela reda. */
export function placeChords(chords, lines, bpm = 0) {
  const words = lines.map((l) => l.text.split(/\s+/).filter(Boolean));
  const out = lines.map((l) => ({ text: l.text, chords: [] }));
  if (!chords.length || !lines.length) return out;
  // tačke za akorde: (red, reč) — po vremenu reda ako ga imaju svi redovi i ima tempa, inače po slogovima
  const timed = bpm > 0 && lines.every((l) => typeof l.t === 'number') && lines.length > 1;
  const spots = [];
  if (timed) {
    const bar = (60 / bpm) * 4, t0 = lines[0].t;
    const ends = lines.map((l, i) => (i + 1 < lines.length ? lines[i + 1].t : l.t + Math.max(bar, (l.t - t0) / Math.max(1, i) || bar)));
    chords.forEach((c, ci) => {
      const at = t0 + ci * bar;
      let li = lines.findIndex((l, i) => at < ends[i]); if (li < 0) li = lines.length - 1;
      const frac = Math.max(0, Math.min(0.99, (at - lines[li].t) / Math.max(0.1, ends[li] - lines[li].t)));
      spots.push([li, Math.floor(frac * words[li].length)]);
    });
  } else {
    const flat = []; words.forEach((ws, li) => ws.forEach((w, wi) => { for (let s = 0; s < syl(w); s++) flat.push([li, wi]); }));
    if (!flat.length) return out;
    chords.forEach((c, ci) => spots.push(flat[Math.min(flat.length - 1, Math.floor((ci * flat.length) / chords.length))]));
  }
  chords.forEach((c, ci) => {
    const [li, wi] = spots[ci];
    let pos = 0; for (let w = 0; w < wi; w++) pos += words[li][w].length + 1;
    const line = out[li];
    // dva akorda na istoj reči: drugi ide malo dalje (da se ne preklapaju)
    const last = line.chords[line.chords.length - 1];
    if (last && pos < last.position + last.chord.length + 1) pos = last.position + last.chord.length + 1;
    line.chords.push({ chord: c.chord, position: pos, ...(c.g ? { g: true } : {}) });
  });
  return out;
}

/** Da li pesma ima tekst (reči u nekom delu koji nije „Beleške“). */
export function hasLyrics(song) {
  return (song.sections || []).some((s) => !/^(beleške|beleske|notes)$/i.test(String(s.name || '').trim()) && (s.lines || []).some((l) => /[a-z\u0430-\u044fčćšđž]{2,}/i.test(String(l.text || '')) && String(l.text || '').trim().split(/\s+/).length >= 2));
}
