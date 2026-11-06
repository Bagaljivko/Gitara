// „Pusti“: pesma kao niz zvučnih događaja (bez DOM-a i bez zvuka — testira se u Node-u). Učitava se tek na dugme.
//
// Vreme je u četvrtinama (dobe), od početka pesme. Događaji:
//   { beat, kind: 'note', midi, dur, ref }            — TAB pesma: tačne note iz tablature (bas, melodija, unutrašnje žice)
//   { beat, kind: 'strum', dir, freqs, dur, mute, ref } — pesma sa akordima: udarac akorda po ritmu pesme
// Delovi (za praćenje i petlju): segs = [{ beat, len, ref }] — takt (TAB) ili akord iznad teksta (akordi).
// parts = [{ name, from, to }] (u dobama) — za „Ponavljaj deo“.
import { playOrder, barInfo, midiOf, tabParts, snap } from './tabSong.js';
import { transposeSong } from './songformat.js';
import { chordNotes, bassOf } from './rhythm.js';

const DEFAULT_STEPS = { '4/4': 'D-DU-UDU', '3/4': 'D-DUDU', '6/8': 'D-UD-U', '2/4': 'D-DU' };
const sigBeats = (sig) => { const [a, b] = String(sig || '4/4').split('/').map(Number); return a && b ? (a * 4) / b : 4; };

/** TAB pesma → događaji (sa ponavljanjima i voltama). partName(p) daje ime dela. */
export function tabTimeline(song, partName = (p) => `${p.from + 1}–${p.to + 1}`) {
  const tab = song.tab, info = barInfo(tab), order = playOrder(tab);
  const events = [], segs = [];
  let off = 0;
  order.forEach((bi) => {
    const len = info[bi].len;
    segs.push({ beat: off, len, ref: { bar: bi } });
    tab.bars[bi].notes.forEach((n, ni) => events.push({ beat: off + snap(n.b), kind: 'note', midi: midiOf(n), dur: n.d, s: n.s, ref: { bar: bi, ni } }));
    off += len;
  });
  events.sort((a, b) => a.beat - b.beat || a.s - b.s);
  // delovi: prvo pojavljivanje taktova dela u redosledu sviranja
  const parts = tabParts(tab).filter((p) => p.kind === 'bars' || p.kind === 'key').map((p) => {
    const k0 = order.indexOf(p.from), k1 = order.indexOf(p.to);
    return k0 < 0 || k1 < k0 ? null : { name: partName(p), from: segs[k0].beat, to: segs[k1].beat + segs[k1].len };
  }).filter(Boolean);
  return { events, segs, parts, total: off, sig: tab.sig };
}

/**
 * Dužine akorada u redu, „kako su napisani“: obično takt po akordu; akord iznad dugačkog dela teksta (≥ 1,8 × uobičajen
 * razmak u redu) dva takta, a zbijen (≤ 0,55 ×) pola takta; kratak red (< 20 znakova) — takt po akordu. U polutaktovima.
 */
export function chordHalves(line) {
  const ch = [...(line.chords || [])].sort((a, b) => a.position - b.position);
  if (!ch.length) return [];
  if (!String(line.text || '').trim() || ch.length === 1) return ch.map(() => 2);
  const L = Math.max(String(line.text).length, ch.at(-1).position + String(ch.at(-1).chord).length + 1);
  if (L < 20) return ch.map(() => 2); // kratak red: takt po akordu
  const spans = ch.map((c, i) => Math.max(1, (i + 1 < ch.length ? ch[i + 1].position : L) - c.position));
  const med = spans.slice().sort((a, b) => a - b)[Math.floor((spans.length - 1) / 2)];
  return spans.map((s) => (s >= med * 1.8 ? 4 : s <= med * 0.55 ? 1 : 2));
}

/**
 * Pesma sa akordima → udarci. Svira se ono što zvuči: oblici akorada posle transpozicije i kapodastera (tp − kapo),
 * pa se kapodaster doda visini. Ritam: ritam dela, pa pesme, inače jednostavan za takt.
 */
export function chordTimeline(song, { tp = song.transpose || 0, capo = song.capo || 0 } = {}) {
  const shapes = transposeSong(song, tp - capo);
  const songPat = song.strum && song.strum.steps ? song.strum : null;
  const events = [], segs = [], parts = [];
  const lift = Math.pow(2, capo / 12);
  let off = 0;
  (shapes.sections || []).forEach((sec, si) => {
    const pat = (sec.strum && sec.strum.steps ? sec.strum : null) || songPat || { sig: '4/4', steps: DEFAULT_STEPS['4/4'] };
    const sig = pat.sig || '4/4', bar = sigBeats(sig);
    const steps = pat.steps || DEFAULT_STEPS[sig] || DEFAULT_STEPS['4/4'];
    const slot = bar / steps.length; // jedan znak ritma = osmina (6/8: osmina)
    const start = off;
    (sec.lines || []).forEach((l, li) => {
      const sorted = [...(l.chords || [])].map((c, i) => ({ c, i })).sort((a, b) => a.c.position - b.c.position);
      const halves = chordHalves(l);
      sorted.forEach(({ c }, ci) => {
        const len = (halves[ci] * bar) / 2;
        const notes = chordNotes(c.chord);
        const ref = { si, li, ci };
        segs.push({ beat: off, len, ref, chord: c.chord });
        if (notes) {
          // pozicija u ritmu se nastavlja preko akorada (akord od pola takta nastavlja istim udarcima)
          const strums = [];
          for (let b = 0; b < len - 1e-6; b += slot) {
            const k = Math.round(((off - start + b) / slot)) % steps.length, st = steps[k];
            const sw = pat.swing && steps.length === bar * 2 && k % 2 ? slot / 3 : 0; // šafl: „i“ kasni do 2/3 doba
            if (st === 'D' || st === 'U' || st === 'x') strums.push({ beat: off + b + sw, kind: 'strum', dir: st === 'U' ? 'U' : 'D', mute: st === 'x', accent: k === 0, freqs: notes.map((f) => f * lift), chord: c.chord, ref });
            else if (st === 'B') strums.push({ beat: off + b + sw, kind: 'strum', dir: 'D', mute: false, accent: true, bass: true, freqs: bassOf(notes).map((f) => f * lift), chord: c.chord, ref });
          }
          if (!strums.length) strums.push({ beat: off, kind: 'strum', dir: 'D', mute: false, accent: true, freqs: notes.map((f) => f * lift), chord: c.chord, ref });
          strums.forEach((e, k) => { e.dur = (k + 1 < strums.length ? strums[k + 1].beat : off + len) - e.beat; events.push(e); });
        }
        off += len;
      });
    });
    if (off > start) parts.push({ name: sec.name || '', from: start, to: off, si });
  });
  return { events, segs, parts, total: off, sig: (songPat && songPat.sig) || '4/4' };
}

/** Događaji pesme bilo koje vrste. */
export const timelineOf = (song, opts = {}) => (song.type === 'tab' ? tabTimeline(song, opts.partName) : chordTimeline(song, opts));
