// Snimci iz „Samo sviraj“: čišćenje, tempo i tablatura po taktovima. Čiste funkcije (bez DOM-a) — lako za testove.
// Događaj: { t (ms od početka), notes: [{ m, s (0 = debela E), f }], chord?, u? (akord nije bio siguran) }.

/** Čišćenje pri čuvanju (original ostaje u `raw`): tišina na početku, nesigurni akordi bez potvrde, dvostruka očitavanja. */
export function cleanEvents(events) {
  const src = (events || []).filter((e) => e && ((e.notes || []).length || e.chord));
  // akord „Am?“ ostaje samo ako je isti akord negde u snimku sigurno prepoznat
  const sureChords = new Set(src.filter((e) => e.chord && !e.u).map((e) => e.chord));
  const out = [];
  for (const e of src) {
    if (e.chord && e.u && !sureChords.has(e.chord)) continue;
    const prev = out[out.length - 1];
    // isti akord pročitan dvaput za redom (jedan udarac preko žica) → jedan
    if (prev && e.chord && prev.chord === e.chord && e.t - prev.t < 700) continue;
    const { u, ...rest } = e;
    out.push(rest);
  }
  const t0 = out.length ? out[0].t : 0;
  if (t0 > 0) for (let i = 0; i < out.length; i++) out[i] = { ...out[i], t: out[i].t - t0 };
  const changed = out.length !== (events || []).length || t0 > 0 || (events || []).some((e) => e && e.u);
  return { events: out, changed, dur: out.length ? out[out.length - 1].t + 1500 : 0 };
}

/**
 * Tempo iz razmaka između trzaja: za svaku dužinu udarca (50–200 BPM) koliko se razmaci uklapaju
 * u cele udarce (puna težina) ili polovine (pola težine); blaga sklonost ka ~105 BPM rešava „duplo/pola“.
 * Vraća { bpm, period (ms), phase (ms), conf } ili null kad nema dovoljno ili ritam nije ujednačen.
 */
export function estimateTempo(events) {
  const on = [];
  for (const e of events || []) if (!on.length || e.t - on[on.length - 1] > 60) on.push(e.t);
  if (on.length < 6) return null;
  const pairs = [];
  for (let i = 0; i < on.length; i++) for (let j = i + 1; j < Math.min(on.length, i + 5); j++) { const d = on[j] - on[i]; if (d >= 120 && d <= 2600) pairs.push(d); }
  if (pairs.length < 5) return null;
  const fit = (P) => {
    let s = 0;
    for (const d of pairs) {
      const x = d / P, e1 = Math.abs(x - Math.round(x)), e2 = Math.abs(x - 0.5 - Math.round(x - 0.5));
      s += Math.max(Math.exp(-((e1 / 0.07) ** 2)), 0.45 * Math.exp(-((e2 / 0.07) ** 2)));
    }
    return s / pairs.length;
  };
  let best = null;
  for (let P = 300; P <= 1200; P += 3) {
    const f = fit(P), bpm = 60000 / P;
    const score = f * Math.exp(-(Math.log2(bpm / 105) ** 2) / (2 * 0.55 ** 2));
    if (!best || score > best.score) best = { P, f, score };
  }
  // fino: ±3 ms oko najboljeg
  for (let P = best.P - 3; P <= best.P + 3; P += 0.5) { const f = fit(P); if (f > best.f) best = { ...best, P, f }; }
  if (best.f < 0.55) return null; // nema ujednačenog ritma (slobodno sviranje) → tablatura bez taktova
  const P = best.P;
  // faza: osmine (pola udarca) što bliže trzajima, a celi udarci na što više trzaja
  let ph = 0, phs = -1;
  for (let k = 0; k < 24; k++) {
    const phase = (k / 24) * P;
    let s = 0;
    for (const t of on) {
      const x = (t - phase) / P, e1 = Math.abs(x - Math.round(x)), e2 = Math.abs(x - 0.5 - Math.round(x - 0.5));
      s += Math.exp(-((e1 / 0.08) ** 2)) + 0.45 * Math.exp(-((e2 / 0.08) ** 2));
    }
    if (s > phs) { phs = s; ph = phase; }
  }
  return { bpm: Math.round(60000 / P), period: P, phase: ph, conf: +best.f.toFixed(2) };
}

/**
 * Tablatura po taktovima (4/4, osmine): nota stoji tamo gde je odsvirana u odnosu na udarac, pa je i puštanje
 * tablature u tempu pesme tačno. Vraća niz tablatura (po 8 taktova) u obliku koji koristi tabs.js.
 */
export function beatTabs(events, tempo, barsPerBlock = 8) {
  const half = tempo.period / 2, SL = 8; // 8 osmina u taktu
  const placed = [];
  const taken = new Map(); // slot → Set(žica)
  let first = null;
  for (const e of events) {
    const notes = (e.notes || []).filter((n) => n.s >= 0 && n.s <= 5);
    if (!notes.length) continue;
    let slot = Math.round((e.t - tempo.phase) / half);
    if (first == null) first = Math.floor(slot / 2) * 2; // prvi odsvirani udarac = početak prvog takta
    // dva trzaja u istoj osmini na istoj žici → drugi ide u sledeću osminu
    while (notes.some((n) => taken.get(slot)?.has(n.s))) slot++;
    const set = taken.get(slot) || new Set();
    notes.forEach((n) => set.add(n.s));
    taken.set(slot, set);
    placed.push({ slot: slot - first, notes });
  }
  if (!placed.length) return [];
  const nBars = Math.floor(placed[placed.length - 1].slot / SL) + 1;
  const bars = Array.from({ length: nBars }, () => ({ w: 16, notes: [] }));
  for (const p of placed) {
    const bar = bars[Math.floor(p.slot / SL)];
    for (const n of p.notes) bar.notes.push({ s: 6 - n.s, f: String(n.f), p: (p.slot % SL) * 2 + 1 });
  }
  bars.forEach((b) => b.notes.sort((x, y) => x.p - y.p || x.s - y.s));
  const out = [];
  for (let i = 0; i < bars.length; i += barsPerBlock) {
    const part = bars.slice(i, i + barsPerBlock);
    if (part.some((b) => b.notes.length)) out.push({ sig: '4/4', bars: part });
  }
  return out;
}
