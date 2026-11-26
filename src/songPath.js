// v2.4.30: „Nauči ovu pesmu“ — put kroz pesmu, sastavljen iz onoga što je u pesmi.
// Koraci (svaki otvara postojeću vežbu sa sadržajem ove pesme; NIŠTA nije zaključano — aplikacija samo predlaže):
//   ak   Upoznaj akorde      → Promene akorda sa akordima pesme (novi akordi uz poznat susedni)
//   chg  Promene             → najteže promene iz pesme
//   rp   Ritam pesme         → obrazac udaranja pesme, od sporog do tempa pesme
//   deo  Deo po deo          → delovi pesme na stazi, sledeći koji nije pređen
//   sing Pevaj i sviraj      → tekst sa akordom iznad reči na kojoj se menja
//   all  Cela pesma          → ceo tok pesme u tempu (čisto → spremna ✓)
//   tut  Tutorijal           → po želji (YouTube)
// „Urađeno“ = najbolji rezultat ≥ 80 (trajno). „Predlog“ = prvi neurađen korak. „Prošli put“ = poslednja vežba iz ove pesme.
import { t } from './i18n.js';
import { settings } from './db.js';
import { dn } from './naming.js';

export const DONE_AT = 80;
const KNOWN_KEY = 'knownChords';

/** Akordi koje korisnik zna (čist prolaz u Promenama / Delovima pesme sa tim akordom). */
export async function knownChords() { const l = await settings.get(KNOWN_KEY, []); return new Set(Array.isArray(l) ? l : []); }
export async function addKnown(chords) {
  const cur = await knownChords(); let ch = false;
  for (const c of chords || []) if (c && !cur.has(c)) { cur.add(c); ch = true; }
  if (ch) await settings.set(KNOWN_KEY, [...cur].slice(-300));
}

/** Analiza pesme: delovi, akordi (kako se sviraju), novi akordi, najteža promena, ritam. */
export async function analyze(song) {
  const P = await import('./songParts.js');
  const parts = P.songParts(song);
  const seq = parts.flatMap((p) => p.chords.map((c) => c.chord)).filter((c, k, a) => !k || c !== a[k - 1]);
  const chords = [...new Set(seq)];
  const known = await knownChords();
  const fresh = chords.filter((c) => !known.has(c));
  const pairs = [];
  for (let k = 1; k < seq.length; k++) if (seq[k - 1] !== seq[k]) pairs.push({ a: seq[k - 1], b: seq[k], c: P.changeCost(seq[k - 1], seq[k]) });
  pairs.sort((x, y) => y.c - x.c);
  const hard = []; for (const p of pairs) if (!hard.some((h) => h.a === p.a && h.b === p.b) && hard.length < 2) hard.push(p);
  // novi akordi uz poznat susedni iz pesme (vežba ulaska u novi akord); bez novih — svi akordi pesme
  const akSeq = (() => {
    const out = [];
    for (const f of (fresh.length ? fresh : chords).slice(0, 4)) {
      const k = seq.indexOf(f), nb = seq[k - 1] && seq[k - 1] !== f ? seq[k - 1] : seq[k + 1];
      if (nb && !out.includes(nb)) out.push(nb);
      if (!out.includes(f)) out.push(f);
    }
    return out.slice(0, 6);
  })();
  const C = await import('./chords.js');
  const barre = chords.filter((c) => C.isBarre(c)); // v2.4.33: barré akordi pesme (lakši hvat + igra Barré)
  return { parts, seq, chords, known, fresh, hard, akSeq, barre };
}

const ARW = { D: '↓', U: '↑', x: '×', B: '↓', '-': '·' };
export const strumArrows = (song) => (song.strum && song.strum.steps ? [...song.strum.steps].map((x) => ARW[x] || '·').join(' ') : '');

/** Stanje puta: koraci sa urađeno/sub, predlog, poslednja vežba. rec = practice.songs[id]. */
export async function pathState(song, rec = null, a = null) {
  a = a || (await analyze(song));
  if (!rec) { const st = (await settings.get('practice', {})) || {}; rec = (st.songs || {})[song.id] || {}; }
  const best = (k) => ((rec[k] || {}).best || 0);
  const bpm = Number(song.bpm) || 90;
  const partIds = a.parts.map((p) => String(p.i));
  const partsDone = partIds.filter((k) => best(k) >= DONE_AT).length;
  const chip = (c, isNew) => ({ c: dn(c), isNew });
  const steps = [
    { id: 'ak', game: t('lp.g.ak'), title: t('lp.ak'), sub: a.fresh.length ? t('lp.akSub', { n: a.fresh.map((c) => dn(c)).join(', ') }) : t('lp.akKnown'),
      chips: a.chords.slice(0, 8).map((c) => chip(c, !a.known.has(c))), done: best('ak') >= DONE_AT || (!a.fresh.length && a.chords.length > 0) },
    ...(a.barre && a.barre.length ? [{ id: 'bare', game: t('lp.g.bare'), title: t('lp.bare', { c: a.barre.map((c) => dn(c)).join(', ') }), sub: t('lp.bareSub'), done: best('bare') >= DONE_AT }] : []),
    { id: 'chg', game: t('lp.g.chg'), title: t('lp.chg'), sub: a.hard.length ? a.hard.map((h) => `${dn(h.a)} → ${dn(h.b)}`).join(' · ') : t('lp.chgNone'), done: best('chg') >= DONE_AT, score: best('chg') },
    { id: 'rp', game: t('lp.g.rp'), title: t('lp.rp'), sub: t('lp.rpSub', { a: Math.max(45, Math.round((bpm * 0.6) / 5) * 5), b: bpm }), arrows: strumArrows(song), done: best('rp') >= DONE_AT, score: best('rp') },
    { id: 'deo', game: t('lp.g.deo'), title: t('lp.deo'), sub: t('lp.deoSub', { n: partsDone, total: partIds.length }), done: partIds.length > 0 && partsDone >= partIds.length },
    { id: 'sing', game: t('lp.g.sing'), title: t('lp.sing'), sub: t('lp.singSub'), done: best('sing') >= DONE_AT, score: best('sing') },
    { id: 'all', game: t('lp.g.all'), title: t('lp.all', { bpm }), sub: t('lp.allSub'), done: best('all') >= DONE_AT, score: best('all'), star: true },
    { id: 'tut', game: t('lp.g.tut'), title: t('lp.tut'), sub: t('lp.tutSub'), optional: true, done: (() => { try { return !!localStorage.getItem('gitara-tut-' + song.id); } catch { return false; } })() }, // otvoren tutorijal = ✓
  ];
  const main = steps.filter((s) => !s.optional);
  const on = (main.find((s) => !s.done) || {}).id || null;
  // poslednja vežba iz ove pesme (po vremenu)
  let last = null;
  for (const [k, r] of Object.entries(rec || {})) if (r && r.at && (!last || r.at > last.at)) last = { key: k, at: r.at, score: r.last ?? r.best ?? 0, tempo: r.lastTempo || 0 };
  if (last) {
    const step = /^\d+$/.test(last.key) ? 'deo' : last.key;
    const part = /^\d+$/.test(last.key) ? a.parts.find((p) => String(p.i) === last.key) : null;
    last.step = step; last.part = part;
    last.name = part ? t('lp.lastPart', { p: part.name || t('lp.g.deo') }) : (steps.find((s) => s.id === step) || {}).game || '';
  }
  return { steps, on, done: main.filter((s) => s.done).length, total: main.length, last, analysis: a };
}

/** Kad je pređen (≥ 80) korak sa akordima — ti akordi se računaju kao poznati. */
export async function noteRound(chords, score) { if (score >= DONE_AT && chords && chords.length) await addKnown(chords); }
