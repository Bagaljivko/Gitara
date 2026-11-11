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
  if (!m || !m.prog || !m.prog.on || m.prog.mode === 'msg') return ''; // stari način „porukom“ (pre 1.94) — više se ne šalje
  const sum = await buildSummary();
  const out = (m.out || []).slice(-30); // v1.94: želje, „proveri“, snimci — nastavnik ih sam pročita
  const hash = hashOf(JSON.stringify([sum, out]));
  if (!force && m.prog.fileId && (m.prog.hash === hash || Date.now() - (m.prog.at || 0) < MIN_GAP)) return m.prog.fileId;
  const text = JSON.stringify({ app: 'marli', type: 'progress', tid: m.tid, sid: m.sid, at: Date.now(), ...sum, ...(out.length ? { out } : {}) });
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
 * v1.94: samo preko Google naloga (mali fajl na učenikovom Drive-u; za decu Google traži da roditelj odobri) — bez
 * poruka. Kad se fajl napravi prvi put, prikaže se QR koji nastavnik skenira (jednom), ili „Kopiraj link“.
 */
export async function setProgressShare(on, { quiet = false } = {}) {
  const tm = await T();
  const m = await tm.getMyTeacher(); if (!m) return false;
  const S = await import('./shareService.js');
  const { dialog, toast, esc } = await import('./ui.js');
  if (!on) {
    const fid = m.prog && m.prog.fileId;
    await tm.setMyTeacher({ ...m, prog: { on: false } });
    if (fid) await S.deleteData(fid).catch(() => {});
    return true;
  }
  for (;;) {
    const cur = await tm.getMyTeacher();
    const had = cur.prog && cur.prog.mode !== 'msg' && cur.prog.fileId ? cur.prog.fileId : '';
    await tm.setMyTeacher({ ...cur, prog: { ...(had ? cur.prog : {}), on: true, mode: 'drive' } });
    let id = '', err = null;
    try { id = await syncProgress({ force: true, interactive: true }); } catch (e) { err = e; id = ''; }
    if (id) {
      initProgress();
      if (id !== had || !(cur.prog && cur.prog.shown)) await showBackQR(id);
      return true;
    }
    const now = await tm.getMyTeacher(); await tm.setMyTeacher({ ...now, prog: { on: false } });
    if (!err || err.code === 'cancelled') { if (!err && !quiet) toast(t('prog.failed'), 'error'); return false; }
    try { (await import('./drive.js')).logAuth('napredak: greška', `${err.code || ''} ${err.message || ''}`.trim()); } catch {}
    const why = err.code === 'stuck' ? t('drive.e.stuck') : t('prog.gFailBody'); // tačan razlog ide u red ispod i u Dijagnostiku
    const v = await dialog({ title: t('prog.gFailTitle'), html: true, className: 'tch-dlg dlg-stack', body: `<p>${esc(why)}</p><div class="tch-todo"><b>${esc(t('prog.todo'))}</b><ol><li>${esc(t('prog.todo1'))}</li><li>${esc(t('prog.todo2'))}</li></ol></div>${err.code && err.code !== 'stuck' ? `<p class="small muted">${esc(t('prog.gFailCode', { c: err.code }))}</p>` : ''}`,
      buttons: [{ label: t('prog.gFailRetry'), value: 'retry', kind: 'primary' }, { label: t('prog.later'), value: null, kind: 'ghost' }] });
    if (v !== 'retry') return false;
  }
}
/** Učenik: QR za nastavnika (jednom) — kad ga skenira, vidi napredak i želje stižu same. Na daljinu: „Kopiraj link“. */
export async function showBackQR(fileId) {
  const tm = await T(); const m = await tm.getMyTeacher(); if (!m) return;
  const link = await tm.progressLink(fileId);
  const { qrSVG } = await import('./qr.js');
  const { esc, toast } = await import('./ui.js');
  const tn = m.name || t('tch.teacher');
  await new Promise((resolve) => {
    const o = document.createElement('div');
    o.className = 'qr-inv qr-back';
    o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-label', t('prog.qrTitle', { t: tn }));
    o.innerHTML = `<div class="qr-card"><button class="qr-x" aria-label="${esc(t('common.close'))}">✕</button>
      <div class="qr-steps"><span class="ok">✓ ${esc(t('prog.qrS1'))}</span><span class="ok">✓ ${esc(t('prog.qrS2'))}</span><span class="cur">3 ${esc(t('prog.qrS3', { t: tn }))}</span></div>
      <h2>${esc(t('prog.qrTitle', { t: tn }))}</h2>
      <div class="qr-box">${qrSVG(link, { margin: 1 })}</div>
      <p><b>${esc(t('prog.qrScan', { t: tn }))}</b><br>${esc(t('prog.qrThen'))}</p>
      <div class="qr-row"><button class="btn primary" data-q="done">${esc(t('qr.done'))}</button></div>
      <button class="linkish qr-copy" data-q="copy">${esc(t('prog.qrCopy'))}</button></div>`;
    const close = () => { o.remove(); document.removeEventListener('keydown', onKey); resolve(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    o.__close = close;
    document.addEventListener('keydown', onKey);
    o.addEventListener('click', async (e) => {
      if (e.target === o || e.target.closest('.qr-x')) return close();
      const b = e.target.closest('[data-q]'); if (!b) return;
      if (b.dataset.q === 'done') return close();
      if (b.dataset.q === 'copy') { try { await navigator.clipboard.writeText(link); toast(t('qr.copied')); } catch { toast(link); } }
    });
    document.body.appendChild(o);
  });
  const cur = await tm.getMyTeacher();
  if (cur && cur.prog) await tm.setMyTeacher({ ...cur, prog: { ...cur.prog, shown: Date.now() } });
}
/** v1.94: učenik je delio napredak porukom (pre 1.94) → treba da poveže Google. */
export async function progNudge() {
  const tm = await T(); const m = await tm.getMyTeacher();
  return m && m.prog && m.prog.mode === 'msg' ? { name: m.name || t('tch.teacher') } : null;
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
  if (d && d.type === 'progress' && Array.isArray(d.out) && d.out.length) await (await import('./teachBox.js')).ingestOut(st, d.out).catch(() => 0); // v1.94
  if (d && d.type === 'progress' && d.tasks) await (await import('./teachBox.js')).ingestDone(st, d).catch(() => {}); // v1.95: 🔔 urađeni zadaci
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
