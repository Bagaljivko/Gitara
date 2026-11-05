// TAB pesme (prebiranje, klasična gitara): podaci, provera taktova, ponavljanja, delovi za vežbu i note za stazu.
// Bez DOM-a (testira se u Node-u). Učitava se tek uz Pesme / Vežbe — nikad pri pokretanju aplikacije.
//
// Pesma: { type: 'tab', title, artist (kompozitor), key, bpm?, sections: [], tab }
// tab (v1): { v: 1, sig: '3/4', key: 'Em', bars: [bar] }
// bar: { notes: [{ s: 1–6 (1 = visoka e), f: 0–24, b: početak, d: trajanje, fi?: prst 1–4 }],
//        sig?: novi takt, key?: novi tonalitet, rs?: 1 (početak ponavljanja), re?: broj prolaza (kraj ponavljanja),
//        end?: 1 | 2 (volta), barre?: [{ fret, from, to, half?, b?, d? }], why?: razlog provere, ok?: 1 (korisnik potvrdio) }
// b i d su u četvrtinama (3/4 = 3 četvrtine u taktu), na mreži od 1/24 četvrtine (triole i šesnaestine tačno).
import { TAB_V, snap, barLen, EPS, parseBarre, cleanTabSong } from './tabData.js';
export { TAB_V, snap, barLen, parseBarre, cleanTabSong };
const OPEN = [64, 59, 55, 50, 45, 40]; // žica 1 (e) … 6 (E)
export const midiOf = (n) => OPEN[n.s - 1] + n.f;

/** Takt i tonalitet koji važe u svakom taktu (promene se nastavljaju). */
export function barInfo(tab) {
  let sig = tab.sig, key = tab.key || '';
  return tab.bars.map((b) => { if (b.sig) sig = b.sig; if (b.key) key = b.key; return { sig, key, len: barLen(sig) }; });
}

/**
 * Taktovi koje treba proveriti: [{ bar, why }]. why: 'long' (više od takta), 'short' (manje od takta), 'empty',
 * ili razlog iz skeniranja ('fret', 'string', 'scan'). Taktovi koje je korisnik potvrdio („U redu je“) se ne javljaju.
 */
export function checkBars(tab) {
  const info = barInfo(tab), out = [];
  tab.bars.forEach((b, i) => {
    if (b.ok) return;
    const len = info[i].len;
    let why = b.why || '';
    if (!why) {
      if (!b.notes.length) why = 'empty';
      else {
        const end = Math.max(...b.notes.map((n) => n.b + n.d));
        if (b.notes.some((n) => n.b >= len - EPS) || end > len + EPS) why = 'long';
        else if (end < len - EPS) why = 'short';
      }
    }
    if (why) out.push({ bar: i, why, note: b.note || '' });
  });
  return out;
}

/** Odgovor Gemini-ja (TAB) → pesma. Strane se spajaju po broju takta (preklapanje snimaka se izbacuje). */
export function fromScan(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.bars)) return null;
  let raw = json.bars.filter((b) => b && typeof b === 'object');
  // isti broj takta dva puta (preklapanje dve slike): ostaje onaj sa više nota
  if (raw.every((b) => Number.isInteger(b.n) && b.n > 0)) {
    const byN = new Map();
    for (const b of raw) { const o = byN.get(b.n); if (!o || (b.notes || []).length > (o.notes || []).length) byN.set(b.n, b); }
    raw = [...byN.values()].sort((a, b) => a.n - b.n);
  }
  const unsure = new Map((Array.isArray(json.unsure) ? json.unsure : []).map((u) => [Math.round(Number(u && u.bar)), String((u && u.why) || '')]));
  const bars = raw.map((b, i) => {
    const all = Array.isArray(b.notes) ? b.notes : [];
    const notes = all.map((n) => ({ s: n.s, f: n.f, b: n.start ?? n.b, d: n.len ?? n.d, fi: n.finger ?? n.fi }));
    const badString = all.some((n) => !(Math.round(Number(n.s)) >= 1 && Math.round(Number(n.s)) <= 6));
    const badFret = all.some((n) => !(Math.round(Number(n.f)) >= 0 && Math.round(Number(n.f)) <= 24) || String(n.f).trim() === '');
    const num = Number.isInteger(b.n) ? b.n : i + 1;
    const o = {
      notes, sig: b.sig, key: b.key, rs: b.repeatStart ? 1 : 0, re: b.repeatEnd ? Math.max(2, Number(b.times) || 2) : 0,
      end: b.ending === 1 || b.ending === 2 ? b.ending : undefined, barre: b.barre,
    };
    if (badString) o.why = 'string'; else if (badFret) o.why = 'fret';
    else if (unsure.has(num)) { o.why = 'scan'; o.note = unsure.get(num); }
    return o;
  });
  const tab = cleanTabSong({ sig: json.sig, key: json.key, bars });
  if (!tab) return null;
  // prvi takt nosi početni takt/tonalitet (ne kao „promenu“)
  if (tab.bars[0].sig) { tab.sig = tab.bars[0].sig; delete tab.bars[0].sig; }
  if (tab.bars[0].key) { tab.key = tab.key || tab.bars[0].key; delete tab.bars[0].key; }
  // „promena“ u isti tonalitet / takt nije promena
  let curKey = tab.key, curSig = tab.sig;
  for (const b of tab.bars) {
    if (b.key) { if (b.key === curKey) delete b.key; else curKey = b.key; }
    if (b.sig) { if (b.sig === curSig) delete b.sig; else curSig = b.sig; }
  }
  const bpm = Math.round(Number(json.bpm) || 0);
  return {
    type: 'tab',
    title: String(json.title || '').trim().slice(0, 120),
    artist: String(json.composer || json.artist || '').trim().slice(0, 120),
    key: tab.key,
    ...(bpm >= 30 && bpm <= 240 ? { bpm } : {}),
    sections: [],
    tab,
  };
}

/** Redosled sviranja sa ponavljanjima i voltama: indeksi taktova. */
export function playOrder(tab) {
  const out = [], bars = tab.bars, pass = new Map();
  let i = 0, start = 0, guard = 0;
  while (i < bars.length && guard++ < 4000) {
    const b = bars[i];
    if (b.rs && !pass.has(i)) start = i;
    const p = pass.get(start) || 1;
    if (b.end && b.end !== Math.min(p, 2)) { i++; continue; }
    out.push(i);
    if (b.re && p < b.re) { pass.set(start, p + 1); i = start; continue; }
    if (b.re) { pass.delete(start); start = i + 1; }
    i++;
  }
  return out;
}

/**
 * Delovi za vežbu (po strukturi): fraze od ~4 takta (granice: ponavljanja i promena tonaliteta) i, kad se tonalitet
 * menja, ceo deo u svakom tonalitetu. [{ id, kind: 'bars'|'key', from, to, key?, ord? }] (from/to = indeksi taktova)
 */
export function tabParts(tab) {
  const info = barInfo(tab), n = tab.bars.length, cuts = new Set([0]);
  tab.bars.forEach((b, i) => {
    if (b.rs) cuts.add(i);
    if (b.re && i + 1 < n) cuts.add(i + 1);
    if (i && info[i].key !== info[i - 1].key) cuts.add(i);
  });
  const starts = [...cuts].sort((a, b) => a - b);
  const parts = [];
  starts.forEach((s, k) => {
    const e = (starts[k + 1] ?? n) - 1, len = e - s + 1;
    if (len <= 5) { parts.push({ from: s, to: e }); return; }
    for (let a = s; a <= e; a += 4) {
      const b = Math.min(e, a + 3);
      if (e - b === 1) { parts.push({ from: a, to: e }); break; } // jedan takt na kraju → uz prethodnu frazu
      parts.push({ from: a, to: b });
    }
  });
  const out = parts.map((p, i) => ({ id: i, kind: 'bars', ...p }));
  // celi delovi po tonalitetu (npr. „Drugi deo (E-dur)“)
  const keyCuts = [0];
  for (let i = 1; i < n; i++) if (info[i].key !== info[i - 1].key) keyCuts.push(i);
  if (keyCuts.length > 1) keyCuts.forEach((s, k) => out.push({ id: out.length, kind: 'key', from: s, to: (keyCuts[k + 1] ?? n) - 1, key: info[s].key, ord: k }));
  return out;
}

/** Težina dela: skokovi ruke (promena položaja), barre, visoki pragovi — po taktu. */
export function partDifficulty(tab, part) {
  let cost = 0, prev = null;
  for (let i = part.from; i <= part.to; i++) {
    const b = tab.bars[i];
    for (const br of b.barre || []) cost += br.half ? 2 : 3;
    for (const n of b.notes) {
      if (!n.f) continue;
      if (prev != null) { const j = Math.abs(n.f - prev); if (j > 2) cost += 0.5 + (j - 2) * 0.35; }
      if (n.f > 7) cost += 0.08;
      prev = n.f;
    }
  }
  return cost / (part.to - part.from + 1);
}

/** Prst (boja) za notu: odštampan prst, barre = 1, inače po položaju ruke u taktu. */
function fingerFor(n, bar) {
  if (!n.f) return 0;
  if (n.fi) return n.fi;
  const br = (bar.barre || []).find((x) => n.s >= x.from && n.s <= x.to && (x.b == null || n.b >= x.b - EPS) && (x.d == null || n.b < (x.b || 0) + x.d));
  if (br && n.f === br.fret) return 1;
  const fretted = bar.notes.filter((x) => x.f > 0).map((x) => x.f);
  const pos = br ? br.fret : Math.max(1, Math.min(...fretted, n.f)); // ruka: prvi prst na najnižem pragu u taktu
  return Math.max(1, Math.min(4, n.f - pos + 1));
}

/**
 * Note za stazu (Delovi pesme): tačna žica i prag, pravo vreme. Note koje počinju zajedno (bas + melodija) su jedan
 * napad: prva (najviša) se ocenjuje, ostale je prate. Barre = blaga traka preko žica (samo prikaz).
 * Staza: žica 0 = debela E (gore) … 5 = tanka e; s = 6 − žica iz tablature.
 * bars: indeksi taktova redom (za „Celu pesmu“ sa ponavljanjima: playOrder).
 */
export function practiceItems(tab, bars) {
  const items = [];
  let off = 0;
  const info = barInfo(tab);
  bars.forEach((bi, k) => {
    const bar = tab.bars[bi], len = info[bi].len;
    const groups = new Map();
    for (const n of bar.notes) { const key = snap(n.b); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(n); }
    let first = true;
    for (const [b, ns] of [...groups].sort((x, y) => x[0] - y[0])) {
      const sorted = ns.slice().sort((x, y) => midiOf(y) - midiOf(x));
      const mk = (n) => ({ kind: 'note', beat: off + b, dur: n.d, s: 6 - n.s, f: n.f, finger: fingerFor(n, bar), midi: midiOf(n), bar: bi, barNo: bi + 1, winBeats: 0.32, winCap: 260 });
      const head = mk(sorted[0]);
      head.group = sorted.slice(1).map((n) => ({ ...mk(n), follow: true }));
      if (first) { head.lyric = String(bi + 1); first = false; }
      items.push(head, ...head.group);
    }
    for (const br of bar.barre || []) items.push({ kind: 'barre', deco: true, beat: off + (br.b || 0), dur: br.d || len - (br.b || 0), from: 6 - br.to, to: 6 - br.from, fret: br.fret, half: !!br.half, bar: bi });
    off += len;
    if (k === bars.length - 1) items.endBeat = off;
  });
  return items;
}

/** Sve note pesme kao niz „žica:prag“ (za poređenje „skoro ista pesma“). */
export const noteTokens = (tab) => (tab && Array.isArray(tab.bars) ? tab.bars.flatMap((b) => (b.notes || []).map((n) => n.s + ':' + n.f)) : []);
/** Kanonski sadržaj tablature (za tačne duplikate). */
export const tabKey = (tab) => (tab && Array.isArray(tab.bars) ? JSON.stringify([tab.sig, tab.key, tab.bars.map((b) => [(b.notes || []).map((n) => [n.s, n.f, snap(n.b), snap(n.d)]), b.sig || '', b.key || '', b.rs || 0, b.re || 0, b.end || 0])]) : '');

/** Tablatura → stari zapis po kolonama (za PDF i ASCII): svaki početak note je kolona. */
export function toColumns(tab, from = 0, to = tab.bars.length - 1) {
  const bars = [];
  for (let i = from; i <= to; i++) {
    const b = tab.bars[i];
    const starts = [...new Set(b.notes.map((n) => snap(n.b)))].sort((x, y) => x - y);
    const col = new Map(starts.map((s, k) => [s, 1 + k * 3]));
    bars.push({ w: Math.max(4, starts.length * 3 + 1), notes: b.notes.map((n) => ({ s: n.s, f: String(n.f), p: col.get(snap(n.b)) })) });
  }
  return { sig: tab.sig, bars };
}
