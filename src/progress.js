// v1.80: „Deli napredak sa nastavnikom“ — samo brojevi (podrazumevano isključeno).
// Učenik: sažetak nedelje (vreme, dani zaredom, runde po igri, pesme u „Delovima pesme“) ide u jedan mali fajl na
// njegovom Google Drive-u; link do fajla ima samo nastavnik. Isključi → fajl se briše.
// Nastavnik: čita taj fajl (bez prijave) kad otvori Učenike / učenika.
import { settings, songs as db } from './db.js';
import { t } from './i18n.js';
import { dayNum, loadTotals } from './activity.js';

const MIN_GAP = 15 * 60000; // najviše jednom u 15 min (posle vežbe / pri pokretanju)

export function weekStart(today = dayNum()) { const dow = (new Date().getDay() + 6) % 7; return today - dow; }

/** Sažetak za nastavnika — bez pesama (osim naslova onih koje vežba u „Delovima pesme“), bez snimaka. */
export async function buildSummary() {
  const tot = await loadTotals();
  const today = dayNum(), start = weekStart(today);
  const ms = (d) => { const v = tot.days[String(d)]; return v ? Math.round((v.p || 0) + (v.x || 0)) : 0; };
  const days = Array.from({ length: 7 }, (_, i) => (start + i <= today ? ms(start + i) : 0));
  let lastWeek = 0; for (let d = start - 7; d <= today - 7; d++) lastWeek += ms(d);
  let d = today; if (!ms(d)) d--; let streak = 0; while (ms(d) > 0) { streak++; d--; }
  let lastDay = 0; for (let k = today; k > today - 400; k--) if (ms(k)) { lastDay = k; break; }
  const st = (await settings.get('practice', null)) || {};
  const inWeek = (wk) => Object.entries(wk || {}).filter(([k]) => Number(k) >= start && Number(k) <= today).sort((a, b) => a[0] - b[0]);
  const games = [];
  for (const [id, rec] of Object.entries(st.games || {})) {
    const w = inWeek(rec && rec.wk); if (!w.length) continue;
    games.push({ id, n: w.reduce((s, [, v]) => s + (v[0] || 0), 0), best: Math.max(...w.map(([, v]) => v[1] || 0)) });
    lastDay = Math.max(lastDay, ...w.map(([k]) => Number(k)));
  }
  games.sort((a, b) => b.n - a.n);
  const songs = [];
  for (const [sid, parts] of Object.entries(st.songs || {})) {
    const w = Object.values(parts || {}).flatMap((r) => inWeek(r && r.wk)); if (!w.length) continue;
    w.sort((a, b) => a[0] - b[0]);
    const s = await db.get(sid).catch(() => null); if (!s || s.deleted) continue;
    songs.push({ title: String(s.title || '').slice(0, 80), n: w.reduce((x, [, v]) => x + (v[0] || 0), 0), from: w[0][1][1] || 0, to: Math.max(...w.map(([, v]) => v[1] || 0)) });
  }
  songs.sort((a, b) => b.n - a.n);
  const tasks = await (await import('./plan.js')).summaryTasks().catch(() => null); // v1.83: stanje zadataka od nastavnika (samo brojevi)
  return { v: 1, ...(tasks ? { tasks } : {}), start, today, days, total: days.reduce((a, b) => a + b, 0), lastWeek, streak, lastDay, rounds: games.reduce((s, g) => s + g.n, 0), games: games.slice(0, 6), songs: songs.slice(0, 4) };
}

const hashOf = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h >>> 0); };
async function T() { return import('./teach.js'); }

/** Učenik: pošalji sažetak (tiho). force = odmah (uključivanje). Vraća id fajla ili ''. */
export async function syncProgress({ force = false, interactive = false } = {}) {
  const tm = await T();
  const m = await tm.getMyTeacher();
  if (!m || !m.prog || !m.prog.on) return '';
  const sum = await buildSummary();
  const hash = hashOf(JSON.stringify(sum));
  if (!force && m.prog.fileId && (m.prog.hash === hash || Date.now() - (m.prog.at || 0) < MIN_GAP)) return m.prog.fileId;
  const text = JSON.stringify({ app: 'marli', type: 'progress', tid: m.tid, sid: m.sid, at: Date.now(), ...sum });
  const S = await import('./shareService.js');
  let id = '';
  try { id = await S.putData(m.prog.fileId || '', text, { interactive, name: 'MARLI – napredak.json' }); } catch (e) { if (interactive) throw e; }
  if (!id) return '';
  const cur = await tm.getMyTeacher();
  if (cur && cur.tid === m.tid) await tm.setMyTeacher({ ...cur, prog: { ...(cur.prog || {}), on: true, fileId: id, at: Date.now(), hash } });
  return id;
}

let timer = 0, inited = false;
/** Pri pokretanju i posle svake runde vežbe (marli-act) — tiho, sa razmakom. */
export function initProgress() {
  if (inited) return; inited = true;
  const later = (ms) => { clearTimeout(timer); timer = setTimeout(() => syncProgress().catch(() => {}), ms); };
  addEventListener('marli-act', () => later(20000));
  later(8000);
}

/** Učenik: uključi (napravi fajl i pošalji nastavniku link) ili isključi (obriši fajl). */
export async function setProgressShare(on) {
  const tm = await T();
  const m = await tm.getMyTeacher(); if (!m) return false;
  const S = await import('./shareService.js');
  if (!on) {
    const fid = m.prog && m.prog.fileId;
    await tm.setMyTeacher({ ...m, prog: { on: false } });
    if (fid) await S.deleteData(fid).catch(() => {});
    return true;
  }
  await tm.setMyTeacher({ ...m, prog: { ...(m.prog || {}), on: true } });
  let id = '';
  try { id = await syncProgress({ force: true, interactive: true }); } catch { id = ''; }
  if (!id) { const now = await tm.getMyTeacher(); await tm.setMyTeacher({ ...now, prog: { on: false } }); const { toast } = await import('./ui.js'); toast(t('prog.failed'), 'error'); return false; }
  await tm.sendProgressLink(id);
  initProgress();
  return true;
}

// ---------------- nastavnik ----------------
const cache = new Map(); // id učenika → { at, data }
/** Sažetak učenika (keš 5 min u ovoj sesiji). null = ne deli; { gone } = isključio; { err } = nije moglo da se pročita. */
export async function studentProgress(st, { fresh = false } = {}) {
  if (!st || !st.prog || !st.prog.fileId) return null;
  const c = cache.get(st.id);
  if (!fresh && c && Date.now() - c.at < 5 * 60000) return c.data;
  const S = await import('./shareService.js');
  const d = await S.readData(st.prog.fileId);
  const data = !d ? { err: true } : d.gone ? { gone: true } : d.type === 'progress' ? d : { err: true };
  cache.set(st.id, { at: Date.now(), data });
  return data;
}
/** Brojevi „ove nedelje“ kod nastavnika: stari sažetak (od prošle nedelje) = ništa ove nedelje. */
export function thisWeek(p) {
  if (!p || p.gone || p.err) return null;
  const cur = p.start === weekStart();
  return { cur, days: cur ? p.days : [0, 0, 0, 0, 0, 0, 0], total: cur ? p.total : 0, lastWeek: cur ? p.lastWeek : (p.start === weekStart() - 7 ? p.total : 0),
    streak: dayNum() - (p.lastDay || 0) <= 1 ? p.streak : 0, rounds: cur ? p.rounds : 0, games: cur ? p.games : [], songs: cur ? p.songs : [],
    idle: p.lastDay ? dayNum() - p.lastDay : null, at: p.at };
}
