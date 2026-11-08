// v1.73: statistika — „Ova nedelja“ (+ nedeljni cilj), „Moje pesme“, „Dugo nisi svirao“, kartica pesme (sve o njoj,
// delovi i napredak tempa), red na ekranu pesme i spremnost set liste. Podaci: activity.js (vreme) + practice (rezultati).
import { t, getLang } from './i18n.js';
import { settings, songs as db } from './db.js';
import { esc, dialog } from './ui.js';
import { loadTotals, dayNum } from './activity.js';

export const fmtDur = (ms) => {
  const m = Math.round((Number(ms) || 0) / 60000);
  if (m < 1) return ms > 0 ? t('st.lt1') : '0 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
};
export const agoText = (ts) => {
  if (!ts) return '';
  const d = dayNum() - dayNum(ts);
  return d <= 0 ? t('st.today') : d === 1 ? t('st.yesterday') : t('st.daysAgo', { n: d });
};
const practice = async () => { const p = (await settings.get('practice', null)) || {}; return { games: p.games || {}, songs: p.songs || {} }; };
const parts = (rec) => Object.entries(rec || {}).filter(([k, r]) => k !== 'all' && r);

/** Spremnost pesme za svirku: ready (svi delovi ≥ 80 ili cela pesma ≥ 80), work (vežba se), new (nije vežbana). */
export function readinessOf(rec) {
  const ps = parts(rec);
  if (rec && rec.all && rec.all.best >= 80) return 'ready';
  if (!ps.length) return rec && rec.all ? 'work' : 'new';
  return ps.every(([, r]) => (r.best || 0) >= 80) ? 'ready' : 'work';
}

// ---------------- Vežbe: ova nedelja ----------------
function weekDays() {
  const today = dayNum(), dow = (new Date().getDay() + 6) % 7, start = today - dow;
  return { today, start, days: Array.from({ length: 7 }, (_, i) => start + i) };
}
function ring(pct) {
  const r = 22, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, pct));
  return `<svg class="st-ring" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="${r}" class="bg"/><circle cx="27" cy="27" r="${r}" class="fg" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 27 27)"/></svg>`;
}
export async function weekHTML() {
  const tot = await loadTotals(), goal = Number(await settings.get('weekGoal', 0)) || 0;
  const { today, start, days } = weekDays();
  const sum = (a, b, k) => { let s = 0; for (let d = a; d <= b; d++) { const v = tot.days[String(d)]; if (v) s += k ? v[k] : v.p + v.x; } return s; };
  const p = sum(start, today, 'p'), x = sum(start, today, 'x'), all = p + x;
  const lastWeekSameTime = sum(start - 7, today - 7);
  const diff = all - lastWeekSameTime;
  const per = days.map((d) => { const v = tot.days[String(d)]; return v ? v.p + v.x : 0; });
  const max = Math.max(...per, 1);
  const names = getLang() === 'en' ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['P', 'U', 'S', 'Č', 'P', 'S', 'N'];
  const goalMs = goal * 60000;
  return `<div class="st-week" id="stWeek">
    <div class="st-wk"><small>${t('st.played')}</small><b>${fmtDur(p)}</b>${diff && lastWeekSameTime ? `<em class="${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '+' : '−'}${fmtDur(Math.abs(diff))} ${t('st.vsLast')}</em>` : `<em>${t('st.thisWeek')}</em>`}</div>
    <div class="st-wk"><small>${t('st.practiced')}</small><b>${fmtDur(x)}</b><em>${t('st.activeDays', { n: days.filter((d) => d <= today && tot.days[String(d)]).length })}</em></div>
    <button type="button" class="st-wk st-goal" id="stGoal" aria-label="${esc(t('st.goal'))}">
      ${goal ? `${ring(all / goalMs)}<span><small>${t('st.goal')}</small><b>${fmtDur(all)}</b><em>${t('st.of', { goal: fmtDur(goalMs) })}</em></span>`
        : `<span class="st-bars" aria-hidden="true">${per.map((v, i) => `<i class="${days[i] === today ? 't' : ''}" style="height:${Math.round((v / max) * 100)}%"></i>`).join('')}</span><span class="st-days">${names.map((n, i) => `<i class="${days[i] === today ? 't' : ''}">${n}</i>`).join('')}</span><small class="st-setgoal">${t('st.setGoal')}</small>`}
    </button>
  </div>`;
}
export function bindWeek(root, redraw) {
  root.querySelector('#stGoal')?.addEventListener('click', async () => {
    const cur = Number(await settings.get('weekGoal', 0)) || 0;
    const opts = [0, 60, 120, 180, 300, 420];
    const v = await dialog({ title: t('st.goalTitle'), body: t('st.goalBody'),
      buttons: opts.map((m) => ({ label: m ? fmtDur(m * 60000) : t('st.noGoal'), value: String(m), kind: m === cur ? 'primary' : '' })) });
    if (v == null || v === false) return;
    await settings.set('weekGoal', Number(v));
    redraw();
  });
}

// ---------------- Vežbe: moje pesme i dugo nisi svirao ----------------
export async function mySongsHTML({ all = false } = {}) {
  const tot = await loadTotals(), pr = await practice();
  const ids = new Set([...Object.keys(tot.songs), ...Object.keys(pr.songs)]);
  const list = [];
  for (const id of ids) {
    const s = await db.get(id).catch(() => null);
    if (!s || s.deleted) continue;
    const a = tot.songs[id] || { p: 0, n: 0, x: 0, last: 0, days: 0 }, rec = pr.songs[id] || {};
    const ps = parts(rec), best = Math.max(0, ...ps.map(([, r]) => r.best || 0), rec.all ? rec.all.best || 0 : 0);
    const lastPr = Math.max(0, ...[...ps, ...(rec.all ? [['all', rec.all]] : [])].map(([, r]) => (r.lastDay ? new Date(r.lastDay.replace(/-(\d)\b/g, '-0$1')).getTime() : 0)));
    const good = ps.filter(([, r]) => (r.best || 0) >= 80).length;
    list.push({ id, s, a, best, last: Math.max(a.last, lastPr), prog: ps.length ? good / ps.length : (rec.all && rec.all.best >= 80 ? 1 : 0), practiced: ps.length > 0 || !!rec.all });
  }
  if (!list.length) return '';
  list.sort((x, y) => y.last - x.last);
  const now = Date.now();
  const neglected = list.filter((x) => x.last && now - x.last > 30 * 864e5).sort((x, y) => x.last - y.last).slice(0, 3);
  const shown = all ? list : list.slice(0, 5);
  const row = (x) => `<button type="button" class="st-song" data-stsong="${esc(x.id)}">
      <span class="st-sh"><b>${esc(x.s.title)}</b><span class="st-ago">${esc(agoText(x.last))}</span></span>
      <span class="st-chips">${x.a.p ? `<span class="ch">${t('st.played')} <b>${fmtDur(x.a.p)}</b></span>` : ''}${x.a.n ? `<span class="ch">${x.a.n}×</span>` : ''}${x.a.x ? `<span class="ch p">${t('st.practiced')} <b>${fmtDur(x.a.x)}</b></span>` : ''}${x.practiced ? `<span class="ch ${x.best >= 80 ? 'g' : ''}">${t('st.best')} <b>${x.best}%</b></span>` : ''}</span>
      ${x.practiced ? `<span class="st-prog"><i style="width:${Math.round(x.prog * 100)}%"></i></span>` : ''}</button>`;
  return `<h2 class="st-sec">${t('st.mySongs')}${list.length > 5 ? `<button type="button" class="link-btn" id="stAll">${all ? t('st.less') : t('st.all', { n: list.length })}</button>` : ''}</h2>
    <div class="st-grp" id="stSongs">${shown.map(row).join('')}</div>
    ${neglected.length ? `<h2 class="st-sec">${t('st.neglected')}</h2><div class="st-grp st-neg">${neglected.map((x) => `<button type="button" class="st-song st-row1" data-stsong="${esc(x.id)}"><span class="st-sh"><b>${esc(x.s.title)}</b><span class="st-ago">${esc(agoText(x.last))}</span></span></button>`).join('')}</div>` : ''}`;
}

// ---------------- kartica pesme ----------------
export async function openSongStats(id) {
  const s = await db.get(id).catch(() => null);
  if (!s) return;
  const tot = (await loadTotals()).songs[id] || { p: 0, n: 0, x: 0, last: 0, days: 0 }, rec = (await practice()).songs[id] || {};
  const { sectionLabel } = await import('./sectionLabel.js');
  const target = Number(s.bpm) || 0;
  const ps = parts(rec).map(([k, r]) => {
    const sec = (s.sections || [])[Number(k)];
    const name = sec && sec.name ? sectionLabel(sec.name) : t('pr.pesma.part', { n: Number(k) + 1 });
    return { k, name, best: r.best || 0, t0: r.t0, t: r.lastTempo };
  }).sort((a, b) => Number(a.k) - Number(b.k));
  if (rec.all) ps.push({ k: 'all', name: t('pr.pesma.whole'), best: rec.all.best || 0, t0: rec.all.t0, t: rec.all.lastTempo });
  const weakest = ps.filter((p) => p.k !== 'all').sort((a, b) => a.best - b.best)[0];
  const streak = Math.max(0, ...parts(rec).map(([, r]) => r.streak || 0), rec.all ? rec.all.streak || 0 : 0);
  const rounds = parts(rec).reduce((n, [, r]) => n + (r.plays || 0), 0) + (rec.all ? rec.all.plays || 0 : 0);
  const tempo = (p) => (p.t ? `<small class="st-tempo">${p.t0 && p.t0 !== p.t ? `${p.t0} → ` : ''}<b>${p.t}</b> BPM${target ? ` · ${t('st.target', { n: target })}` : ''}</small>` : '');
  const html = `<div class="st-sheet">
    <p class="st-sub">${esc(s.artist || '')}${tot.last ? `${s.artist ? ' · ' : ''}${esc(t('st.lastPlayed', { when: agoText(tot.last) }))}` : ''}</p>
    <div class="st-big">
      <div class="st-b"><small>${t('st.played')}</small><b>${fmtDur(tot.p)}</b><em>${t('st.timesDays', { n: tot.n, d: tot.days })}</em></div>
      <div class="st-b p"><small>${t('st.practiced')}</small><b>${fmtDur(tot.x)}</b><em>${t('st.roundsStreak', { n: rounds, s: streak })}</em></div>
    </div>
    ${ps.length ? `<div class="st-parts">${ps.map((p) => `<div class="st-pt"><span class="nm">${esc(p.name)}</span><span class="bar"><i class="${p.best >= 80 ? 'ok' : ''}" style="width:${p.best}%"></i></span><span class="pc">${p.best ? p.best + '%' : '—'}</span>${tempo(p)}</div>`).join('')}</div>`
      : `<p class="muted small">${t('st.notPracticed')}</p>`}
  </div>`;
  const v = await dialog({ title: s.title, html: true, body: html, className: 'st-modal',
    buttons: [{ label: t('st.openSong'), value: 'open' }, { label: weakest && weakest.best < 80 ? t('st.practicePart', { part: weakest.name }) : t('st.practice'), value: 'prac', kind: 'primary' }] });
  if (v === 'open') location.hash = '#/pesma/' + encodeURIComponent(id);
  if (v === 'prac') { if (weakest) try { localStorage.setItem(`gitara-pr-part-${id}`, String(weakest.k)); } catch {} location.hash = '#/vezbe/pesma/' + encodeURIComponent(id); }
}

/** Jedan red na ekranu pesme: „Svirano 3 h 20 min · 14× · Vežbano 45 min · Refren 71%“ (prazno = sakriven). */
export async function songLineText(id, sections = []) {
  const tot = (await loadTotals()).songs[id], rec = (await practice()).songs[id] || {};
  const bits = [];
  if (tot && tot.p >= 60000) bits.push(`<b>${t('st.played')} ${fmtDur(tot.p)}</b>`, `${tot.n}×`);
  if (tot && tot.x >= 60000) bits.push(`<b class="acc">${t('st.practiced')} ${fmtDur(tot.x)}</b>`);
  const ps = parts(rec).sort((a, b) => (a[1].best || 0) - (b[1].best || 0));
  if (ps.length && (ps[0][1].best || 0) < 80) {
    const { sectionLabel } = await import('./sectionLabel.js');
    const sec = sections[Number(ps[0][0])];
    bits.push(`${esc(sec && sec.name ? sectionLabel(sec.name) : t('pr.pesma.part', { n: Number(ps[0][0]) + 1 }))} ${ps[0][1].best || 0}%`);
  }
  return bits.join(' · ');
}

/** Set lista: koliko je pesama spremno (i stanje svake). */
export async function setReadiness(ids) {
  const pr = await practice();
  const map = {}; let ready = 0, work = 0, none = 0;
  for (const id of ids) { const r = readinessOf(pr.songs[id]); map[id] = r; if (r === 'ready') ready++; else if (r === 'work') work++; else none++; }
  return { map, ready, work, none, total: ids.length };
}
