// v2.4.3: kratak pregled posle vežbanja — kad izađeš iz vežbe/pesme posle bar 5 minuta: „Danas: 18 min · Pauk 92 · 2 pesme“,
// i (ako imaš nastavnika) „Pošalji nastavniku“ — stiže mu u zvonce, bez poruke.
import { t } from './i18n.js';
import { settings } from './db.js';
import { esc, dialog, toast } from './ui.js';

const MIN_MS = 5 * 60000, GAP = 90 * 60000, LS = 'marli-session-shown';
const busy = (h) => /^#\/(vezbe\/[^/?]+|pesma\/|nastup\/)/.test(h);
let startMs = -1;

async function todayMs() { const A = await import('./activity.js'); const v = (await A.loadTotals()).days[String(A.dayNum())]; return v ? v.p + v.x : 0; }

/** Šta je danas urađeno (za pregled i za nastavnika). */
export async function todaySummary() {
  const A = await import('./activity.js'); const tot = await A.loadTotals(); const today = A.dayNum();
  const v = tot.days[String(today)]; const ms = v ? v.p + v.x : 0;
  const st = (await settings.get('practice', null)) || {};
  const games = [];
  for (const [id, rec] of Object.entries(st.games || {})) { const w = rec && rec.wk && rec.wk[String(today)]; if (w && w[0]) games.push({ id, n: w[0], best: Math.round(w[1] || 0) }); }
  games.sort((a, b) => b.best - a.best);
  const { songs } = await import('./db.js'); const start = new Date(); start.setHours(0, 0, 0, 0);
  const played = [];
  for (const [id, s] of Object.entries(tot.songs)) if (s.last >= start.getTime()) { const x = await songs.get(id).catch(() => null); if (x && !x.deleted) played.push(String(x.title || '').slice(0, 60)); }
  return { day: today, min: Math.round(ms / 60000), games: games.slice(0, 4), songs: played.slice(0, 6) };
}
const gName = (id) => { const k = 'pr.g.' + id, v = t(k); return v === k ? id : v; };
export function summaryLine(s) { return [...s.games.map((g) => `${gName(g.id)} ${g.best}`), s.songs.length ? t('ses.songs', { n: s.songs.length }) : ''].filter(Boolean).join(' · '); }

async function show() {
  const s = await todaySummary(); if (s.min < 5) return;
  try { localStorage.setItem(LS, String(Date.now())); } catch {}
  const tm = await import('./teach.js'); const m = await tm.getMyTeacher();
  const v = await dialog({ title: t('ses.title', { n: s.min }), html: true, className: 'ses-dlg', body: `
    <div class="ses-big">🎉</div>
    ${s.games.length ? `<div class="ses-list">${s.games.map((g) => `<div class="ses-row"><span>${esc(gName(g.id))}</span><b>${g.best}</b><small>${esc(t('ses.rounds', { n: g.n }))}</small></div>`).join('')}</div>` : ''}
    ${s.songs.length ? `<p class="ses-songs">♪ ${esc(s.songs.join(', '))}</p>` : ''}
    <p class="muted small">${esc(t('ses.keep'))}</p>`,
  buttons: [{ label: t('common.close'), value: null, kind: m ? '' : 'primary' }, ...(m ? [{ label: t('ses.send', { t: m.name || t('tch.teacher') }), value: 'send', kind: 'primary' }] : [])] });
  if (v === 'send') {
    const B = await import('./teachBox.js');
    const ok = await B.outPush({ type: 'session', id: 'ses:' + s.day, min: s.min, games: s.games, songs: s.songs.slice(0, 4) }).catch(() => false);
    toast(ok ? t('ses.sent', { t: m.name || t('tch.teacher') }) : t('les.reactLater'));
  }
}

/** Prati prelaze: ulaz u vežbu/pesmu → početak; izlaz posle 5+ min → pregled (najviše jednom u 90 min). */
export function initSession() {
  const onRoute = async () => {
    const h = location.hash;
    if (busy(h)) { if (startMs < 0) startMs = await todayMs(); return; }
    if (startMs < 0) return;
    const was = startMs; startMs = -1;
    let last = 0; try { last = Number(localStorage.getItem(LS)) || 0; } catch {}
    if (Date.now() - last < GAP) return;
    if ((await todayMs()) - was >= MIN_MS) show().catch(() => {});
  };
  addEventListener('hashchange', () => { onRoute().catch(() => {}); });
  onRoute().catch(() => {});
}
