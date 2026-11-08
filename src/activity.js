// v1.73: koliko se svira i vežba — po pesmi, po igri i po danu.
// Meri se samo aktivno vreme: ekran upaljen, aplikacija vidljiva i nešto se dešava (dodir, skrol, taster, sviranje
// pesme / videa, završena runda vežbe). Posle 60 s (pesma) / 120 s (vežba) bez ičega sat stane.
// Zapis je po uređaju (settings 'activity' → dev[id]), pa se sinhronizacijom zbir telefona i računara ne duplira.
import { settings } from './db.js';

const KEY = 'activity';
const DEV_KEY = 'marli-dev';
const TICK = 5000, IDLE_SONG = 60000, IDLE_PRAC = 120000, FLUSH = 60000, COUNT_AFTER = 30000;
const MAX_DAYS = 400;

export const dayNum = (ts = Date.now()) => { const d = new Date(ts); return Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 864e5); };
const devId = () => { try { let d = localStorage.getItem(DEV_KEY); if (!d) { d = 'd' + Math.random().toString(36).slice(2, 10); localStorage.setItem(DEV_KEY, d); } return d; } catch { return 'd0'; } };

// ---------------- spajanje (sinhronizacija) i zbir ----------------
export { mergeActivity } from './syncMerge.js';
/** Zbir svih uređaja: { songs: {id: {p, n, x, last, days}}, games: {id: ms}, days: {dayNum: {p, x}} } */
export function totals(act) {
  const songs = {}, games = {}, days = {};
  for (const d of Object.values((act && act.dev) || {})) {
    for (const [id, s] of Object.entries(d.s || {})) {
      const o = songs[id] || (songs[id] = { p: 0, n: 0, x: 0, last: 0, days: new Set() });
      o.p += Number(s.p) || 0; o.n += Number(s.n) || 0; o.x += Number(s.x) || 0; o.last = Math.max(o.last, Number(s.last) || 0);
      (s.d || []).forEach((x) => o.days.add(x));
    }
    for (const [g, ms] of Object.entries(d.g || {})) games[g] = (games[g] || 0) + (Number(ms) || 0);
    for (const [k, v] of Object.entries(d.days || {})) { const o = days[k] || (days[k] = { p: 0, x: 0 }); o.p += Number(v.p) || 0; o.x += Number(v.x) || 0; }
  }
  for (const o of Object.values(songs)) o.days = o.days.size;
  return { songs, games, days };
}
export async function loadTotals() { return totals(await settings.get(KEY, null)); }

// ---------------- merenje ----------------
let ctx = null, lastSig = 0, acc = null, started = false, flushT = 0, setCache = null;
const signal = () => { lastSig = Date.now(); };
/** Igrači (Pusti, Uz video, metronom…) i vežbe javljaju da se nešto dešava i bez dodira. */
export const ping = () => signal();

async function stageSong(hash) { // #/nastup/<setlista>?i=N → pesma na tom mestu
  const m = /^#\/nastup\/([^?]+)\?i=(\d+)/.exec(hash); if (!m) return null;
  try {
    if (!setCache || Date.now() - setCache.at > 30000) setCache = { at: Date.now(), list: (await settings.get('setlists', [])) || [] };
    const sl = setCache.list.find((x) => x.id === decodeURIComponent(m[1]));
    const ids = (sl && (sl.songIds || (sl.items || []).map((x) => x.id))) || [];
    return ids[Number(m[2])] || null;
  } catch { return null; }
}
async function contextOf() {
  const h = location.hash || '';
  let m;
  if ((m = /^#\/pesma\/([^/?]+)/.exec(h))) return { kind: 'song', id: decodeURIComponent(m[1]) };
  if (h.startsWith('#/nastup/')) { const id = await stageSong(h); return id ? { kind: 'song', id } : null; }
  if ((m = /^#\/vezbe\/pesma\/([^/?]+)/.exec(h))) return { kind: 'prac', game: 'pesma', id: decodeURIComponent(m[1]) };
  if ((m = /^#\/vezbe\/([a-z]+)/.exec(h))) return { kind: 'prac', game: m[1] };
  return null;
}
const sameCtx = (a, b) => !!a && !!b && a.kind === b.kind && a.id === b.id && a.game === b.game;

async function tick() {
  const c = await contextOf();
  if (!sameCtx(c, ctx)) { await flush(); ctx = c; acc = c ? { ms: 0, counted: false, ...c } : null; if (c) signal(); }
  if (!acc || document.visibilityState !== 'visible') return;
  if (Date.now() - lastSig > (acc.kind === 'song' ? IDLE_SONG : IDLE_PRAC)) return;
  acc.ms += TICK; acc.pend = (acc.pend || 0) + TICK;
  if (acc.kind === 'song' && !acc.counted && acc.ms >= COUNT_AFTER) { acc.counted = true; acc.newVisit = true; }
  if (acc.kind === 'song' && Date.now() - flushT > FLUSH) flush(); // vežba: upis tek pri izlasku iz igre (ne usred runde)
}

/** Upis nakupljenog vremena (posle minut aktivnosti, pri promeni ekrana i kad aplikacija ode u pozadinu). */
export async function flush() {
  flushT = Date.now();
  if (!acc || !acc.pend) return;
  const add = acc.pend, a = acc; acc.pend = 0;
  const visit = a.newVisit; a.newVisit = false;
  const act = (await settings.get(KEY, null)) || { v: 1, dev: {} };
  const id = devId(), d = act.dev[id] || (act.dev[id] = { s: {}, g: {}, days: {} });
  d.s = d.s || {}; d.g = d.g || {}; d.days = d.days || {};
  const today = dayNum(), dk = String(today);
  const day = d.days[dk] || (d.days[dk] = { p: 0, x: 0 });
  if (a.kind === 'song' || (a.kind === 'prac' && a.id)) {
    const s = d.s[a.id] || (d.s[a.id] = { p: 0, n: 0, x: 0, last: 0, d: [] });
    if (a.kind === 'song') { s.p = (s.p || 0) + add; if (visit) s.n = (s.n || 0) + 1; } else s.x = (s.x || 0) + add;
    s.last = Date.now();
    if (!(s.d || []).includes(today)) s.d = [...(s.d || []), today].slice(-MAX_DAYS);
  }
  if (a.kind === 'prac') { d.g[a.game] = (d.g[a.game] || 0) + add; day.x += add; } else day.p += add;
  for (const k of Object.keys(d.days)) if (Number(k) < today - MAX_DAYS) delete d.days[k];
  d.at = Date.now();
  await settings.set(KEY, act);
}

/** Pokreće merenje (jednom, posle prvog ekrana). */
export function startActivity() {
  if (started) return; started = true;
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(ev, signal, { passive: true, capture: true });
  addEventListener('scroll', signal, { passive: true, capture: true });
  addEventListener('marli-act', signal);
  addEventListener('hashchange', () => { tick(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); else signal(); });
  addEventListener('pagehide', () => { flush(); });
  setInterval(tick, TICK);
  signal(); tick();
}
