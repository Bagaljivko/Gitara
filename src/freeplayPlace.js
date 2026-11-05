// Samo sviraj: gde je nota na vratu. Mikrofon čuje samo visinu tona, ne žicu — ista nota postoji na 2–4 mesta.
// Pravilo kao kod gitariste: ruka stoji na jednom mestu (jedan prst na prag: lo … lo+3, malo istezanje do lo+4)
// i pomera se tek kad nota tu ne može da se odsvira; prednost ima ista ili susedna žica; prazne žice samo blizu
// glave vrata. Posle pauze ruka se lakše pomera. (Testovi: tests/freeplayPlace.test.mjs; sa zaključanom rukom ~99 % tačno.)
import { getVoicings } from './chords.js';

export const OPEN = [40, 45, 50, 55, 59, 64]; // E A D G H e (0 = debela E)

export function createPlacer({ frets = 12, recent: useRecent = false } = {}) {
  const P = { recent: useRecent };
  let lo = null, lastS = 2, lastT = -1e9, locked = null;
  const recent = []; // poslednje note (visina, vreme) — ruka je tamo gde se većina njih može odsvirati
  const cands = (m, avoid) => { const out = []; for (let s = 0; s < 6; s++) { const f = m - OPEN[s]; if (f >= 0 && f <= frets && !avoid.includes(s)) out.push({ s, f }); } return out; };
  function cost(c, t) {
    if (lo == null) return c.f * 0.15 + (c.f === 0 ? 0.2 : 0) + 0.1 * Math.abs(c.s - lastS);
    const pause = t - lastT > 2000 ? 0.5 : 1; // posle pauze lakše na drugo mesto
    let out;
    if (c.f === 0) out = lo <= 1 ? 0 : 2 + lo * 0.25;
    else if (c.f < lo) out = lo - c.f;
    else if (c.f > lo + 3) out = c.f === lo + 4 ? 0.6 : c.f - lo - 3;
    else out = 0;
    return out * 2.2 * pause + 0.35 * Math.abs(c.s - lastS) + 0.03 * c.f;
  }
  const fits = (m, L) => OPEN.some((o) => { const f = m - o; return (f === 0 && L <= 1) || (f >= Math.max(1, L) && f <= L + 3); });
  /** Najbolje mesto ruke za skorašnje note (najviše ih staje u kutiju), najbliže sadašnjem. */
  function bestWindow(t) {
    const rec = recent.filter((x) => t - x.t < 4000);
    if (rec.length < 3) return null;
    let best = null;
    for (let L = 0; L <= frets - 3; L++) {
      const n = rec.reduce((a, x) => a + (fits(x.m, L) ? 1 : 0), 0);
      const d = lo == null ? L : Math.abs(L - lo);
      if (!best || n > best.n || (n === best.n && d < best.d)) best = { L, n, d };
    }
    return best;
  }
  function moveTo(f) {
    if (f <= 0) return;
    if (lo == null) lo = Math.max(1, f - 1);
    else if (f < lo) lo = f;
    else if (f > lo + 4) lo = f - 3;
  }
  return {
    /** Mesto za notu m: { s, f } (avoid = žice već zauzete u istom trenutku). */
    place(m, avoid = [], t = performance.now()) {
      const cs = cands(m, avoid);
      if (!cs.length) return null;
      if (locked != null) lo = locked;
      else if (P.recent) {
        // ako skorašnje note (sa ovom) bolje staju u neku drugu kutiju — ruka je tamo
        recent.push({ m, t }); if (recent.length > 8) recent.shift();
        const w = bestWindow(t);
        if (w && (lo == null || !fits(m, lo)) ) lo = Math.max(0, w.L);
      }
      const best = cs.reduce((a, b) => (cost(b, t) < cost(a, t) ? b : a));
      if (locked == null) moveTo(best.f);
      lastS = best.s; lastT = t;
      return best;
    },
    /** Hvat akorda najbliži ruci (pragovi ≤ frets). */
    chord(name) {
      const vs = getVoicings(name).filter((v) => v.frets.every((f) => f <= frets));
      if (!vs.length) return null;
      const here = lo ?? 1;
      const v = vs.reduce((a, b) => (Math.abs(b.baseFret - here) < Math.abs(a.baseFret - here) ? b : a));
      lo = v.baseFret > 1 ? v.baseFret : 1;
      return v;
    },
    /** Sredina ruke (za boju prsta). */
    get center() { return lo == null ? 2 : lo + 1.5; },
    get lo() { return lo; },
    /** Zaključaj ruku na kutiji od praga L (null = automatski). */
    lock(L) { locked = L == null ? null : Math.max(0, Math.min(frets - 3, L)); if (locked != null) lo = locked; },
    get locked() { return locked; },
    reset() { lo = null; lastS = 2; lastT = -1e9; recent.length = 0; },
  };
}
/** Prst (boja) za prag u odnosu na položaj ruke: 0 = prazna žica, 1–4. */
export const fingerAt = (f, center) => (f <= 0 ? 0 : Math.max(1, Math.min(4, f - Math.max(1, Math.round(center - 1.5)) + 1)));
