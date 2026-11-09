// Spajanje podataka koji se ne „pobeđuju“ nego sabiraju (rezervna kopija i sinhronizacija između uređaja):
// rezultati iz Vežbi i Skala (uvek ostaje najbolje), folderi (unija). Bez DOM-a — radi i u Web Worker-u i u Node-u.
/** Rezultati iz Vežbi: samo brojevi i datumi u očekivanom obliku (ništa drugo se ne prepisuje). */
const wkOf = (wk) => {
  if (!wk || typeof wk !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(wk).slice(-30)) if (/^\d{4,6}$/.test(k) && Array.isArray(v)) out[k] = [Math.max(0, Math.min(999, Math.round(Number(v[0]) || 0))), Math.max(0, Math.min(100, Math.round(Number(v[1]) || 0)))];
  return Object.keys(out).length ? out : null;
};
export function cleanPractice(p) {
  if (!p || typeof p !== 'object') return null;
  const rec = (r) => (r && typeof r === 'object' ? {
    best: Math.round(Math.max(0, Math.min(100, Number(r.best) || 0))),
    bestMetric: Number.isFinite(Number(r.bestMetric)) && r.bestMetric != null ? Math.max(0, Math.min(1000, Math.round(Number(r.bestMetric)))) : undefined,
    streak: Math.max(0, Math.round(Number(r.streak) || 0)),
    lastDay: typeof r.lastDay === 'string' && /^\d{4}-\d{1,2}-\d{1,2}$/.test(r.lastDay) ? r.lastDay : '',
    lastTempo: Math.max(0, Math.min(400, Math.round(Number(r.lastTempo) || 0))) || undefined,
    t0: Math.max(0, Math.min(400, Math.round(Number(r.t0) || 0))) || undefined, // v1.73: prvi zabeleženi tempo (napredak)
    plays: Math.max(0, Math.round(Number(r.plays) || 0)),
    ...(r.challenge === true ? { challenge: true } : {}), // „Izazov ✓“ (v1.57)
    ...(wkOf(r.wk) ? { wk: wkOf(r.wk) } : {}), // v1.80: runde i najbolji rezultat po danu (najviše 30 dana)
  } : null);
  const games = {}, songs = {};
  for (const [k, v] of Object.entries(p.games || {})) if (/^[a-z]{2,12}$/.test(k)) { const r = rec(v); if (r) games[k] = r; }
  for (const [id, parts] of Object.entries(p.songs || {})) {
    if (typeof id !== 'string' || id.length > 80 || !parts || typeof parts !== 'object') continue;
    const o = {};
    for (const [pk, v] of Object.entries(parts)) if (/^(\d{1,3}|all)$/.test(pk)) { const r = rec(v); if (r) o[pk] = r; }
    if (Object.keys(o).length) songs[id] = o;
  }
  return { v: 1, games, songs };
}

/** Vežbe → Skale (v1): napredak po tonalitet-skala-pozicija-obrazac + put (pređeni koraci, otkrivene kartice). */
const SK_SCALES = ['minPent', 'majPent', 'major', 'minor', 'blues', 'chromatic'], SK_PATS = ['updown', 'thirds', 'seq3', 'seq4'];
export function cleanSkale(p) {
  if (!p || typeof p !== 'object') return null;
  const items = {}, done = {}, cards = {};
  for (const [k, r] of Object.entries(p.items || {}).slice(0, 2000)) {
    const m = /^(\d{1,2})-([a-zA-Z]{4,10})-(\d{1,2})-([a-z0-9]{4,7})$/.exec(k);
    if (!m || +m[1] > 11 || !SK_SCALES.includes(m[2]) || +m[3] > 12 || !SK_PATS.includes(m[4]) || !r || typeof r !== 'object') continue;
    const n = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
    const o = { best: n(r.best, 100), stars: n(r.stars, 3), plays: n(r.plays, 1e6) };
    if (n(r.bpm, 400)) o.bpm = n(r.bpm, 400);
    if (n(r.lastTempo, 400)) o.lastTempo = n(r.lastTempo, 400);
    if (r.learned) o.learned = true;
    if (r.passed) o.passed = true;
    items[k] = o;
  }
  for (const [k, v] of Object.entries(p.path?.done || {})) if (/^[a-z0-9]{2,16}$/.test(k)) done[k] = Number(v) || 1;
  for (const [k, v] of Object.entries(p.path?.cards || {})) if (/^[a-zA-Z]{2,16}$/.test(k)) cards[k] = Number(v) || 1;
  return { v: 1, items, path: { done, cards } };
}
export function mergeSkale(a, b) {
  if (!a) return b;
  const out = { v: 1, items: { ...(a.items || {}) }, path: { done: { ...(a.path?.done || {}), ...(b.path?.done || {}) }, cards: { ...(a.path?.cards || {}), ...(b.path?.cards || {}) } } };
  for (const [k, r] of Object.entries(b.items || {})) {
    const x = out.items[k];
    out.items[k] = !x ? r : { ...x, best: Math.max(x.best || 0, r.best || 0), stars: Math.max(x.stars || 0, r.stars || 0), plays: Math.max(x.plays || 0, r.plays || 0),
      bpm: Math.max(x.bpm || 0, r.bpm || 0) || undefined, lastTempo: Math.max(x.lastTempo || 0, r.lastTempo || 0) || undefined, learned: !!(x.learned || r.learned) || undefined, passed: !!(x.passed || r.passed) || undefined };
  }
  return out;
}

/** Spajanje rezultata (dva uređaja ili telefon + kopija): veći najbolji rezultat; niz i tempo sa skorije korišćenog. */
export function mergePractice(a, b) {
  if (!a) return b;
  const day = (r) => { const [y, m, d] = String(r && r.lastDay || '').split('-').map(Number); return y ? y * 400 + m * 32 + d : 0; };
  const one = (x, y) => {
    if (!x) return y; if (!y) return x;
    const newer = day(y) > day(x) ? y : x;
    const bm = Math.max(x.bestMetric ?? -1, y.bestMetric ?? -1);
    const t0 = Math.min(...[x.t0, y.t0].filter((v) => v > 0)); // v1.73: prvi tempo = manji od dva
    const wk = { ...(x.wk || {}) }; // v1.80: po danu — više rundi i bolji rezultat
    for (const [k, v] of Object.entries(y.wk || {})) { const a = wk[k] || [0, 0]; wk[k] = [Math.max(a[0], v[0] || 0), Math.max(a[1], v[1] || 0)]; }
    return { ...newer, ...(Object.keys(wk).length ? { wk } : {}), best: Math.max(x.best || 0, y.best || 0), plays: Math.max(x.plays || 0, y.plays || 0), ...(bm >= 0 ? { bestMetric: bm } : {}), ...(x.challenge || y.challenge ? { challenge: true } : {}), ...(Number.isFinite(t0) ? { t0 } : {}) };
  };
  const out = { v: 1, games: { ...(a.games || {}) }, songs: { ...(a.songs || {}) } };
  for (const [k, r] of Object.entries(b.games || {})) out.games[k] = one(out.games[k], r);
  for (const [id, parts] of Object.entries(b.songs || {})) {
    const o = { ...(out.songs[id] || {}) };
    for (const [pk, r] of Object.entries(parts)) o[pk] = one(o[pk], r);
    out.songs[id] = o;
  }
  return out;
}

/** Folderi sa dva uređaja: unija po ID-u (isti ID: ime sa novije strane, b). */
export function mergeFolders(a, b) {
  const map = new Map((Array.isArray(a) ? a : []).map((f) => [f.id, f]));
  for (const f of Array.isArray(b) ? b : []) if (f && f.id) map.set(f.id, { ...(map.get(f.id) || {}), ...f });
  return [...map.values()];
}

// v1.73: svirano/vežbano (activity) — /** Unija uređaja; za isti uređaj pobeđuje noviji zapis (at). */
export function mergeActivity(a, b) {
  const out = { v: 1, dev: {} };
  for (const src of [a, b]) {
    if (!src || typeof src !== 'object' || !src.dev) continue;
    for (const [id, d] of Object.entries(src.dev)) if (d && typeof d === 'object' && (!out.dev[id] || (Number(d.at) || 0) >= (Number(out.dev[id].at) || 0))) out.dev[id] = d;
  }
  return out;
}
