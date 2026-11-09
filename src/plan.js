// v1.83: zadaci i plan učenja od nastavnika.
// Nastavnik predlaže vežbe (igra, deo pesme, skala, nova pesma) — pojedinačno („ove nedelje“) ili u planu po nedeljama.
// Sve ide u jedan mali fajl na NASTAVNIKOVOM Google Drive-u (samo zadaci: bez imena učenika, bez biblioteke);
// učenik ima link i aplikacija ga sama čita. Zadatak se kod učenika štiklira sam, iz rezultata Vežbi.
// Sledeća nedelja plana se otvara kad su svi zadaci urađeni ili kad nastavnik označi nedelju kao urađenu.
import { settings, songs as db } from './db.js';
import { t, countOf, ROUNDS } from './i18n.js';
import { dayNum, loadTotals } from './activity.js';
import { toast } from './ui.js';

export const GAME_IDS = ['promena', 'ritam', 'pauk', 'lovac', 'sluh'];
export const PAIRS = [['Em', 'G'], ['G', 'C'], ['C', 'Am'], ['D', 'A'], ['G', 'D'], ['Am', 'E'], ['C', 'F']];
export const STEPS = ['first', 'home', 'move', 'thirds', 'blues', 'majpent', 'minor', 'major', 'seq'];
export const KINDS = ['g', 'p', 's', 'n']; // igra · deo pesme · skala · nova pesma
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clip = (s, n) => String(s || '').trim().slice(0, n);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'dj').replace(/[^a-z0-9]+/g, ' ').trim();

// ---------------- zadatak ----------------
/** Očisti zadatak (iz fajla ili iz dijaloga) — samo poznata polja. */
export function cleanTask(x) {
  if (!x || typeof x !== 'object' || !KINDS.includes(x.k)) return null;
  const o = { id: clip(x.id, 24) || uid(), k: x.k, at: Number(x.at) || Date.now() };
  if (x.k === 'g') { if (!GAME_IDS.includes(x.g)) return null; o.g = x.g; if (x.g === 'promena' && Array.isArray(x.pr) && x.pr.length === 2) o.pr = x.pr.map((c) => clip(c, 8)); }
  if (x.k === 'p' || x.k === 'n') { const s = x.song || {}; if (!clip(s.t, 80)) return null; o.song = { t: clip(s.t, 80), a: clip(s.a, 60) }; if (x.part) o.part = clip(x.part, 40); }
  if (x.k === 's') { if (!STEPS.includes(x.st)) return null; o.st = x.st; }
  const g = x.goal || {};
  o.goal = ['r', 'p', 'm'].includes(g.t) ? { t: g.t, n: Math.max(1, Math.min(g.t === 'p' ? 100 : 600, Math.round(Number(g.n) || 1))) } : { t: 'x' };
  if (x.note) o.note = clip(x.note, 200);
  if (x.due === 'w') o.due = 'w';
  if (Number(x.done) > 0) o.done = Number(x.done); // nastavnik označio
  return o;
}
export function cleanPlan(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.weeks)) return null;
  const weeks = p.weeks.slice(0, 26).map((w) => ({ id: clip(w && w.id, 24) || uid(), tasks: (Array.isArray(w && w.tasks) ? w.tasks : []).slice(0, 12).map(cleanTask).filter(Boolean), ...(Number(w && w.done) > 0 ? { done: Number(w.done) } : {}) }));
  if (!weeks.length) return null;
  return { id: clip(p.id, 24) || uid(), title: clip(p.title, 80) || t('plan.untitled'), weeks, ...(p.tpl ? { tpl: clip(p.tpl, 24) } : {}) };
}

/** Naziv zadatka (za oba kraja). */
export function taskTitle(x) {
  if (x.k === 'g') return t('pr.g.' + x.g) + (x.pr ? `: ${x.pr[0]} ⇄ ${x.pr[1]}` : '');
  if (x.k === 's') return `${t('pr.g.skale')}: ${t('sk.step.' + x.st)}`;
  return x.song.t + (x.part ? ` — ${x.part}` : '');
}
export function goalText(g) {
  if (!g || g.t === 'x') return t('plan.goal.x');
  return t('plan.goal.' + g.t, { n: g.t === 'r' ? countOf(g.n, ROUNDS) : g.n });
}

// ---------------- šabloni (MARLI ih donosi; nastavnik može da sačuva svoje) ----------------
const G = (g, n, pr) => ({ k: 'g', g, ...(pr ? { pr } : {}), goal: { t: 'r', n } });
const GP = (g, n, pr) => ({ k: 'g', g, ...(pr ? { pr } : {}), goal: { t: 'p', n } });
const SK = (st, n) => ({ k: 's', st, goal: { t: 'r', n } });
export const STARTERS = [
  { id: 'first', weeks: [[G('promena', 4, ['Em', 'G']), G('ritam', 3), G('pauk', 2)], [G('promena', 4, ['G', 'C']), G('promena', 3, ['C', 'Am']), G('ritam', 3)], [G('promena', 4, ['G', 'D']), G('lovac', 3), GP('ritam', 75)], [G('promena', 4, ['D', 'A']), SK('first', 3), G('sluh', 3)]] },
  { id: 'rhythm', weeks: [[G('ritam', 4), G('promena', 3, ['Em', 'G'])], [GP('ritam', 75), G('promena', 3, ['G', 'C'])], [GP('ritam', 85), G('promena', 4, ['G', 'D']), G('sluh', 3)]] },
  { id: 'fingers', weeks: [[G('pauk', 4), SK('first', 3)], [GP('pauk', 80), SK('home', 3)], [SK('move', 3), G('lovac', 3)], [SK('blues', 3), SK('thirds', 3)]] },
];
/** Nov plan iz šablona (MARLI ili nastavnikov). */
export function planFrom(tpl) {
  const weeks = tpl.weeks.map((w) => ({ id: uid(), tasks: (Array.isArray(w) ? w : w.tasks || []).map((x) => cleanTask({ ...x, id: uid(), at: Date.now(), done: 0 })).filter(Boolean) }));
  return cleanPlan({ id: uid(), title: tpl.title || t('plan.tpl.' + tpl.id), weeks, tpl: tpl.id });
}
export function emptyPlan(title) { return cleanPlan({ id: uid(), title: title || t('plan.untitled'), weeks: [{ id: uid(), tasks: [] }] }); }

// ---------------- stanje zadatka kod učenika (iz rezultata Vežbi) ----------------
async function ctxNow() {
  const [st, sk, tot, lib] = await Promise.all([settings.get('practice', null), settings.get('skale', null), loadTotals(), db.list().catch(() => [])]);
  return { st: st || { games: {}, songs: {} }, sk: sk || { items: {} }, tot, lib: lib.filter((s) => !s.deleted) };
}
export function findSong(lib, song) {
  const nt = norm(song.t), na = norm(song.a);
  const hits = lib.filter((s) => norm(s.title) === nt);
  return hits.find((s) => !na || norm(s.artist) === na) || hits[0] || null;
}
const sinceRows = (wk, from) => Object.entries(wk || {}).filter(([k]) => Number(k) >= from);
export const pairKey = (pr) => [...pr].sort().join('-');
const totalMs = (c) => Object.values(c.tot.days || {}).reduce((a, d) => a + (d.p || 0) + (d.x || 0), 0);
/** Ukupan broj odigranih rundi za taj zadatak do sada (za početnu vrednost). null = još se ne može (nema pesme). */
function cumOf(x, c) {
  if (x.k === 'g') return x.pr ? Number((c.pairs || {})[pairKey(x.pr)]) || 0 : c.st.games?.[x.g]?.plays || 0;
  if (x.k === 'p' || x.k === 'n') { const s = findSong(c.lib, x.song); return s ? Object.values(c.st.songs?.[s.id] || {}).reduce((a, r) => a + ((r && r.plays) || 0), 0) : null; }
  if (x.k === 's') return Object.entries(c.sk.items || {}).filter(([k]) => stepKeys(x.st).includes(k)).reduce((a, [, r]) => a + ((r && r.plays) || 0), 0);
  return 0;
}
/** Početak zadatka: [runde do sada, dan, ms vežbanja do sada] — broji se samo ono posle ovoga. */
export const baseOf = (x, c) => { const n = cumOf(x, c); return n == null ? null : [n, dayNum(), totalMs(c)]; };
/**
 * { v, of, done, pct } — v = koliko je urađeno (runde / % / min) od početka zadatka (b), of = cilj.
 * Zadatak bez početka (nedelja još nije otvorena) = 0, osim ako je nastavnik / učenik označio.
 */
export function taskStatus(x, c, b = null, doneMap = {}) {
  const goal = x.goal || { t: 'x' };
  const res = (v, extra = {}) => {
    const of = goal.t === 'x' ? 1 : goal.n;
    const done = !!(x.done || doneMap[x.id] || (b && goal.t !== 'x' && v >= of));
    return { v, of, done, pct: Math.max(0, Math.min(1, done ? 1 : v / of)), ...extra };
  };
  const song = x.k === 'p' || x.k === 'n' ? findSong(c.lib, x.song) : null;
  const extra = x.k === 'p' || x.k === 'n' ? (song ? { songId: song.id } : { missing: true }) : {};
  if (!b || goal.t === 'x') return res(0, extra);
  if (goal.t === 'm') return res(Math.max(0, Math.floor((totalMs(c) - b[2]) / 60000)), extra);
  if (goal.t === 'r') return res(Math.max(0, (cumOf(x, c) ?? b[0]) - b[0]), extra);
  // najbolji rezultat od početka zadatka
  if (x.k === 'g') return res(Math.max(0, ...sinceRows(c.st.games?.[x.g]?.wk, b[1]).map(([, v]) => v[1] || 0)), extra);
  if (song) return res(Math.max(0, ...Object.values(c.st.songs?.[song.id] || {}).flatMap((r) => sinceRows(r && r.wk, b[1])).map(([, v]) => v[1] || 0)), extra);
  if (x.k === 's') return res(Math.max(0, ...Object.entries(c.sk.items || {}).filter(([k]) => stepKeys(x.st).includes(k)).map(([, r]) => (r && r.best) || 0)), extra);
  return res(0, extra);
}
let PATH = null;
const stepKeys = (id) => { const p = (PATH || []).find((s) => s.id === id); return p ? p.patterns.map((pt) => `${p.key}-${p.scale}-${p.pos}-${pt}`) : []; };
async function loadPath() { if (!PATH) PATH = (await import('./skalePath.js')).PATH; }

/** Trenutna nedelja plana: prva koja nije urađena (svi zadaci ili nastavnik). -1 = ceo plan urađen. */
export function currentWeek(plan, isDone) {
  if (!plan) return -1;
  for (let i = 0; i < plan.weeks.length; i++) {
    const w = plan.weeks[i];
    if (w.done) continue;
    if (w.tasks.length && w.tasks.every((x) => isDone(x))) continue;
    return i;
  }
  return -1;
}

// ---------------- učenik ----------------
async function TM() { return import('./teach.js'); }
/** Zadaci kod učenika sa stanjem. Vraća null ako nema nastavnika / plana. */
export async function myTasks() {
  const tm = await TM(); const m = await tm.getMyTeacher();
  if (!m || !m.plan) return null;
  await loadPath();
  const c = { ...(await ctxNow()), pairs: m.planPairs || {} };
  const base = { ...(m.planBase || {}) }, doneMap = { ...(m.planDone || {}) };
  const plan = m.plan.plan || null;
  const loose = m.plan.tasks || [];
  const all = [...loose, ...(plan ? plan.weeks.flatMap((w) => w.tasks) : [])];
  let dirty = false;
  const status = new Map();
  // zadatak počinje kad ga učenik prvi put vidi (pojedinačni) ili kad se otvori njegova nedelja (plan)
  const start = (x) => { if (!Array.isArray(base[x.id])) { const b = baseOf(x, c); if (b) { base[x.id] = b; dirty = true; } } };
  const calc = (x) => { const s = taskStatus(x, c, base[x.id] || null, doneMap); status.set(x.id, s); if (s.done && !doneMap[x.id]) { doneMap[x.id] = Date.now(); dirty = true; } return s; };
  loose.forEach((x) => { start(x); calc(x); });
  let cw = -1;
  if (plan) {
    for (let i = 0; i < plan.weeks.length; i++) {
      const w = plan.weeks[i];
      if (cw < 0) w.tasks.forEach(start);
      const st = w.tasks.map(calc);
      if (cw < 0 && !w.done && !(w.tasks.length && st.every((s) => s.done))) cw = i;
    }
  }
  if (dirty) { const cur = await tm.getMyTeacher(); if (cur && cur.tid === m.tid) await tm.setMyTeacher({ ...cur, planBase: pruneMap(base, all), planDone: pruneMap(doneMap, all) }); }
  const isDone = (x) => status.get(x.id)?.done;
  return { m, loose, plan, cw, status, isDone, name: m.plan.name || m.name || '' };
}
const pruneMap = (map, all) => { const ids = new Set(all.map((x) => x.id)); const o = {}; for (const [k, v] of Object.entries(map)) if (ids.has(k)) o[k] = v; return o; };

/** Za nastavnika (u sažetku napretka): stanje zadataka — samo id i brojevi. */
export async function summaryTasks() {
  const r = await myTasks().catch(() => null); if (!r) return null;
  const o = {}; for (const [id, s] of r.status) o[id] = [Math.min(9999, Math.round(s.v)), s.done ? 1 : 0];
  return Object.keys(o).length ? o : null;
}

/** Učenik otvara link plana (#plan/<…>): zapamti fajl i odmah pročitaj. */
export async function receivePlanLink(hash) {
  const tm = await TM();
  let d; try { d = tm.decodeLink(hash.replace(/^#plan\//, '').split(/[?#]/)[0]); } catch { toast(t('tch.rq.bad')); return false; }
  const m = await tm.getMyTeacher();
  if (!m || d.tt !== m.tid || d.ts !== m.sid) { toast(t('plan.notYours')); return false; }
  if (!d.f || !/^[\w-]{6,}$/.test(d.f)) { toast(t('tch.rq.bad')); return false; }
  await tm.setMyTeacher({ ...m, planFile: d.f });
  watchTasks();
  const ok = await refreshPlan({ force: true });
  toast(ok ? t('plan.gotLink', { t: m.name || t('tch.teacher') }) : t('plan.readLater'));
  return true;
}
let lastRead = 0;
/** Pročitaj nastavnikov fajl (najviše jednom u 5 min, osim force). Vraća true ako je nešto stiglo. */
export async function refreshPlan({ force = false } = {}) {
  const tm = await TM(); const m = await tm.getMyTeacher();
  if (!m || !m.planFile) return false;
  if (!force && Date.now() - lastRead < 5 * 60000) return false;
  lastRead = Date.now();
  const S = await import('./shareService.js');
  const d = await S.readData(m.planFile);
  if (!d) return false;
  const cur = await tm.getMyTeacher(); if (!cur || cur.tid !== m.tid) return false;
  if (d.gone) { if (cur.plan) { await tm.setMyTeacher({ ...cur, plan: null, planFile: '' }); return true; } return false; }
  if (d.type !== 'plan' || d.tid !== m.tid || d.sid !== m.sid) return false;
  const plan = { at: Number(d.at) || Date.now(), name: clip(d.name, 60), tasks: (Array.isArray(d.tasks) ? d.tasks : []).slice(0, 20).map(cleanTask).filter(Boolean), plan: cleanPlan(d.plan) };
  const changed = JSON.stringify(plan) !== JSON.stringify(cur.plan || null);
  if (changed) {
    const before = new Set([...(cur.plan?.tasks || []), ...((cur.plan?.plan?.weeks) || []).flatMap((w) => w.tasks)].map((x) => x.id));
    const nu = [...plan.tasks, ...((plan.plan?.weeks) || []).flatMap((w) => w.tasks)].filter((x) => !before.has(x.id)).length;
    await tm.setMyTeacher({ ...cur, plan });
    if (nu && cur.plan) toast(t('plan.newTasks', { n: nu, t: cur.name || t('tch.teacher') }));
    try { dispatchEvent(new Event('marli-plan')); } catch {}
  }
  return changed;
}

/** Promena akorda: runde po paru akorda (da se dva para u istoj nedelji ne broje zajedno). */
async function countPair() {
  if (!/^#\/vezbe\/promena/.test(location.hash)) return;
  let pr = null; try { pr = JSON.parse(localStorage.getItem('gitara-pr-promena') || '{}').pair; } catch {}
  if (!Array.isArray(pr) || pr.length !== 2) return;
  const tm = await TM(); const m = await tm.getMyTeacher(); if (!m || !m.plan) return;
  const k = pairKey(pr), map = { ...(m.planPairs || {}) }; map[k] = (Number(map[k]) || 0) + 1;
  await tm.setMyTeacher({ ...m, planPairs: map });
}
/** Posle svake runde: zadatak urađen → kratka poruka (jednom). */
let watching = false;
export function watchTasks() {
  if (watching) return; watching = true;
  let q = Promise.resolve();
  addEventListener('marli-act', () => { q = q.then(countPair).catch(() => {}); });
  addEventListener('marli-act', () => setTimeout(async () => {
    const tm = await TM(); const m0 = await tm.getMyTeacher(); if (!m0 || !m0.plan) return;
    const before = { ...(m0.planDone || {}) };
    const r = await myTasks().catch(() => null); if (!r) return;
    const all = [...r.loose, ...(r.plan ? r.plan.weeks.flatMap((w) => w.tasks) : [])];
    const fresh = all.filter((x) => r.status.get(x.id)?.done && !before[x.id] && !x.done);
    if (fresh.length) toast(t('plan.doneToast', { what: taskTitle(fresh[0]) }));
  }, 900));
}

/** Učenik: „Vežbaj“ — otvori tačno tu vežbu. */
export async function openTask(x) {
  if (x.k === 'g') {
    if (x.g === 'promena' && x.pr) { try { const o = JSON.parse(localStorage.getItem('gitara-pr-promena') || '{}') || {}; localStorage.setItem('gitara-pr-promena', JSON.stringify({ ...o, pair: x.pr })); } catch {} }
    location.hash = '#/vezbe/' + x.g; return;
  }
  if (x.k === 's') {
    await loadPath(); const p = PATH.find((s) => s.id === x.st);
    if (p) try { localStorage.setItem('gitara-pr-skale-sel', JSON.stringify({ step: p.id, key: p.key, scale: p.scale, pos: p.pos, pattern: p.patterns[0], roots: !!p.roots })); } catch {}
    location.hash = '#/vezbe/skale'; return;
  }
  const lib = (await db.list().catch(() => [])).filter((s) => !s.deleted);
  const s = findSong(lib, x.song);
  if (!s) { toast(t('plan.noSong', { title: x.song.t })); return; }
  location.hash = x.k === 'n' && (!x.goal || x.goal.t === 'x') ? '#/pesma/' + encodeURIComponent(s.id) : '#/vezbe/pesma/' + encodeURIComponent(s.id);
}
/** Učenik: ručno „Naučio/la sam“ (nova pesma bez cilja). */
export async function markMine(id, on = true) {
  const tm = await TM(); const m = await tm.getMyTeacher(); if (!m) return;
  const map = { ...(m.planDone || {}) }; if (on) map[id] = Date.now(); else delete map[id];
  await tm.setMyTeacher({ ...m, planDone: map });
  try { dispatchEvent(new Event('marli-act')); } catch {}
}

// ---------------- nastavnik ----------------
/** Plan i zadaci učenika (kod nastavnika, u zapisu učenika). */
export async function getStudentPlan(sid) {
  const tm = await TM(); const s = await tm.getStudent(sid);
  return s ? { s, tasks: (s.tasks || []).map(cleanTask).filter(Boolean), plan: cleanPlan(s.plan) } : null;
}
const timers = new Map();
/** Sačuvaj kod nastavnika i (ako učenik već ima link) tiho osveži fajl. */
export async function saveStudentPlan(sid, { tasks, plan }) {
  const tm = await TM();
  const old = Date.now() - 30 * 864e5;
  const keep = (tasks || []).filter((x) => !(x.done && x.done < Date.now() - 14 * 864e5) && x.at > old);
  const s = await tm.updateStudent(sid, { tasks: keep, plan: plan || null });
  if (s && s.planFile) { clearTimeout(timers.get(sid)); timers.set(sid, setTimeout(() => publishPlan(sid).catch(() => {}), 1500)); }
  return s;
}
async function fileText(s) {
  const tm = await TM(); const tc = await tm.setTeacher({});
  return JSON.stringify({ app: 'marli', type: 'plan', v: 1, tid: tc.id, sid: s.id, at: Date.now(), name: await tm.teacherName(), tasks: (s.tasks || []).map(cleanTask).filter(Boolean), plan: cleanPlan(s.plan) });
}
/** Upiši fajl (tiho). interactive = može da traži Google nalog. Vraća id ili ''. */
export async function publishPlan(sid, { interactive = false } = {}) {
  const tm = await TM(); const s = await tm.getStudent(sid); if (!s) return '';
  const S = await import('./shareService.js');
  let id = '';
  try { id = await S.putData(s.planFile || '', await fileText(s), { interactive, name: 'MARLI – plan.json' }); } catch (e) { if (interactive) throw e; }
  if (id && id !== s.planFile) await tm.updateStudent(sid, { planFile: id });
  return id;
}
/** Prvi put: napravi fajl i pošalji učeniku link (poruka iz nastavnikove aplikacije). */
export async function sendPlanLink(sid) {
  const tm = await TM(); const s = await tm.getStudent(sid); if (!s) return false;
  let id = ''; try { id = await publishPlan(sid, { interactive: true }); } catch { id = ''; }
  if (!id) { toast(t('plan.failed'), 'error'); return false; }
  const tc = await tm.setTeacher({});
  const { SHARE_BASE } = await import('./shareConfig.js');
  const link = `${SHARE_BASE}#plan/${tm.encodeLink({ v: 1, tt: tc.id, ts: s.id, f: id })}`;
  const text = await tm.editMessage(t('plan.sendTitle'), t('plan.msg', { s: s.name, link }), t('plan.lockMsg'));
  if (text == null) return false;
  await tm.compose({ to: s.contact, subject: t('tch.subject', { t: (await tm.teacherName()) || 'MARLI' }), text });
  await tm.updateStudent(sid, { planSent: Date.now() });
  return true;
}
/** Nastavnik prekida (učenik obrisan / plan obrisan i nema zadataka): fajl se briše. */
export async function dropPlanFile(s) {
  if (!s || !s.planFile) return;
  const S = await import('./shareService.js');
  await S.deleteData(s.planFile).catch(() => {});
}
/** Stanje zadataka kod nastavnika — iz učenikovog sažetka napretka (ako ga deli). */
export function teacherStatus(x, prog) {
  if (x.done) return { done: true, v: null };
  const r = prog && prog.tasks && prog.tasks[x.id];
  if (!r) return null;
  return { v: r[0], done: !!r[1] };
}
