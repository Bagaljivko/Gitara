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
  if (!m || !m.prog || !m.prog.on || m.prog.mode === 'msg') return ''; // v1.84: „porukom“ = šalje učenik, ručno
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

/**
 * Učenik: uključi ili isključi „Deli napredak“.
 * v1.84: dva načina — „automatski“ (fajl na učenikovom Google Drive-u, nastavnik vidi sam) ili „porukom“ (bez Google
 * naloga: učenik šalje brojeve linkom kad hoće — npr. deca, kod kojih Google traži roditelja ili ne dozvoljava).
 * Ako Google prijava ne uspe (ili zapne), nudi se „porukom“. Veza sa nastavnikom ostaje u svakom slučaju.
 */
export async function setProgressShare(on, { mode = '' } = {}) {
  const tm = await T();
  const m = await tm.getMyTeacher(); if (!m) return false;
  const S = await import('./shareService.js');
  const { dialog, toast, esc } = await import('./ui.js');
  const tn = m.name || t('tch.teacher');
  if (!on) {
    const fid = m.prog && m.prog.fileId;
    await tm.setMyTeacher({ ...m, prog: { on: false, ...(m.prog && m.prog.mode ? { mode: m.prog.mode } : {}) } });
    if (fid) await S.deleteData(fid).catch(() => {});
    return true;
  }
  if (!mode) mode = await chooseMode(tn);
  if (!mode) return false;
  if (mode === 'msg') {
    const cur = await tm.getMyTeacher();
    if (cur.prog && cur.prog.fileId) await S.deleteData(cur.prog.fileId).catch(() => {});
    await tm.setMyTeacher({ ...cur, prog: { on: true, mode: 'msg', sentAt: (cur.prog && cur.prog.sentAt) || 0 } });
    await sendProgressMsg();
    return true;
  }
  for (;;) {
    const cur = await tm.getMyTeacher();
    await tm.setMyTeacher({ ...cur, prog: { ...(cur.prog || {}), on: true, mode: 'drive' } });
    let id = '', err = null;
    try { id = await syncProgress({ force: true, interactive: true }); } catch (e) { err = e; id = ''; }
    if (id) { await tm.sendProgressLink(id); initProgress(); return true; }
    const now = await tm.getMyTeacher(); await tm.setMyTeacher({ ...now, prog: { on: false } });
    if (!err || err.code === 'cancelled') { if (!err) toast(t('prog.failed'), 'error'); return false; }
    const v = await dialog({ title: t('prog.gFailTitle'), html: true, className: 'tch-dlg', body: `<p>${esc(err.code === 'stuck' ? t('drive.e.stuck') : t('prog.gFailBody'))}</p><p class="small muted">${esc(t('prog.gFailKids'))}</p>`,
      buttons: [{ label: t('common.cancel'), value: null }, { label: t('prog.gFailMsg'), value: 'msg' }, { label: t('prog.gFailRetry'), value: 'retry', kind: 'primary' }] });
    if (v === 'msg') return setProgressShare(true, { mode: 'msg' });
    if (v !== 'retry') return false;
  }
}
async function chooseMode(tn) {
  const { dialog } = await import('./ui.js');
  let google = false; try { const d = await import('./drive.js'); const st = d.driveState(); google = !!(st.connected || st.email); } catch {}
  return dialog({ title: t('prog.modeTitle', { t: tn }), html: true, className: 'tch-dlg', body: `<p class="small muted">${t('prog.modeBody')}</p>`,
    buttons: [{ label: t('common.cancel'), value: null }, { label: t('prog.modeMsg'), value: 'msg', kind: google ? '' : 'primary' }, { label: t('prog.modeDrive'), value: 'drive', kind: google ? 'primary' : '' }] });
}

/** Učenik („porukom“): brojevi ove nedelje u linku, kroz učenikovu aplikaciju za poruke. */
export async function sendProgressMsg() {
  const tm = await T(); const m = await tm.getMyTeacher(); if (!m) return false;
  const sum = await buildSummary();
  const z = await (await import('./shareService.js')).packLinkData({ v: 2, ft: m.tid, fs: m.sid, at: Date.now(), d: sum });
  const { SHARE_BASE } = await import('./shareConfig.js');
  const link = `${SHARE_BASE}#napredak/z.${z}`;
  const text = await tm.editMessage(t('prog.sendTitle'), t('prog.msgNow', { t: m.name || '', link }), t('prog.lockMsgNow', { t: m.name || t('tch.teacher') }));
  if (text == null) return false;
  await tm.compose({ to: m.contact || '', subject: t('prog.subject'), text });
  const cur = await tm.getMyTeacher();
  if (cur && cur.tid === m.tid) await tm.setMyTeacher({ ...cur, prog: { ...(cur.prog || {}), on: true, mode: 'msg', sentAt: Date.now() } });
  return true;
}
/** Treba li podsetnik „Pošalji napredak“ (porukom, a poslednje slanje je starije od 6 dana i od tad je vežbano)? */
export async function progNudge() {
  const tm = await T(); const m = await tm.getMyTeacher();
  if (!m || !m.prog || !m.prog.on || m.prog.mode !== 'msg') return null;
  const since = m.prog.sentAt || 0;
  if (Date.now() - since < 6 * 864e5) return null;
  const tot = await loadTotals(); const from = since ? dayNum(since) : dayNum() - 7;
  const any = Object.entries(tot.days || {}).some(([k, v]) => Number(k) > from && ((v.p || 0) + (v.x || 0)) > 60000);
  return any ? { name: m.name || t('tch.teacher') } : null;
}
/** Nastavnik: sažetak iz poruke — samo poznata polja i brojevi. */
export function cleanSummary(d) {
  if (!d || typeof d !== 'object') return null;
  const n = (v, max = 1e9) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  const str = (v, k) => String(v || '').slice(0, k);
  const tasks = {}; for (const [k, v] of Object.entries(d.tasks || {}).slice(0, 80)) if (/^[\w-]{1,24}$/.test(k) && Array.isArray(v)) tasks[k] = [n(v[0], 9999), v[1] ? 1 : 0];
  return { type: 'progress', via: 'msg', start: n(d.start), today: n(d.today), days: Array.from({ length: 7 }, (_, i) => n((d.days || [])[i], 864e5)), total: n(d.total, 7 * 864e5), lastWeek: n(d.lastWeek, 7 * 864e5), streak: n(d.streak, 3650), lastDay: n(d.lastDay), rounds: n(d.rounds, 1e5),
    games: (Array.isArray(d.games) ? d.games : []).slice(0, 6).filter((g) => g && /^[a-z]{2,12}$/.test(g.id)).map((g) => ({ id: g.id, n: n(g.n, 1e5), best: n(g.best, 100) })),
    songs: (Array.isArray(d.songs) ? d.songs : []).slice(0, 4).map((x) => ({ title: str(x && x.title, 80), n: n(x && x.n, 1e5), from: n(x && x.from, 100), to: n(x && x.to, 100) })),
    ...(Object.keys(tasks).length ? { tasks } : {}) };
}

// ---------------- nastavnik ----------------
const cache = new Map(); // id učenika → { at, data }
/** Sažetak učenika (keš 5 min u ovoj sesiji). null = ne deli; { gone } = isključio; { err } = nije moglo da se pročita. */
export async function studentProgress(st, { fresh = false } = {}) {
  if (st && st.prog && st.prog.msg) return st.progData ? { ...st.progData, at: st.prog.at || 0 } : null; // v1.84: poslato porukom
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
