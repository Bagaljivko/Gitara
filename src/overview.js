// v2.4.22: „Moje vežbanje“ (#/vezbanje) i isti pregled kod nastavnika (#/vezbanje/<id učenika>, ako učenik deli napredak).
// Sve se beleži samo (activity.js: vreme po danu i po pesmi; practice: rezultati vežbi). Nedelja / Mesec / Sve:
// ukupno vreme (i razlika prema prethodnom periodu), dani vežbanja i niz, stubići po danu (sviranje pesama + vežbe),
// pesme (vreme ukupno, vežbe sa zvezdicama) i igre. Kod učenika se ovo pakuje u sažetak napretka (polje „ov“).
import { t, getLang, countOf, DAYS, ROUNDS } from './i18n.js';
import { esc } from './ui.js';

const STARS = (b) => (b >= 92 ? '★★★' : b >= 75 ? '★★' : b >= 50 ? '★' : '☆');
const n = (v, max = 1e10) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
const str = (v, k) => String(v || '').slice(0, k);

/** Podaci za pregled — sa ovog uređaja (i sinhronizovanih). */
export async function myOverviewData() {
  const A = await import('./activity.js'); const { settings, songs: db } = await import('./db.js');
  const tot = await A.loadTotals(); const today = A.dayNum();
  const d = Object.entries(tot.days || {}).map(([k, v]) => [Number(k), n(v.p), n(v.x)]).filter(([k, p, x]) => k > today - 400 && p + x > 0).sort((a, b) => a[0] - b[0]);
  const st = (await settings.get('practice', null)) || {};
  const { sectionLabel } = await import('./sectionLabel.js');
  const s = [];
  for (const [id, o] of Object.entries(tot.songs || {})) {
    const ms = (o.p || 0) + (o.x || 0); if (ms < 60000) continue;
    const song = await db.get(id).catch(() => null); if (!song || song.deleted) continue;
    const rec = (st.songs || {})[id] || {};
    const ex = Object.entries(rec).filter(([, r]) => r && (r.plays || r.best)).map(([k, r]) => {
      const sec = /^\d+$/.test(k) ? (song.sections || [])[Number(k)] : null;
      const label = k === 'all' ? t('pr.pesma.whole') : k === 'chg' ? t('st.ex.chg') : k === 'rp' ? t('st.ex.rp') : k === 'sing' ? t('st.ex.sing') : sec && sec.name ? sectionLabel(sec.name) : t('pr.pesma.part', { n: Number(k) + 1 });
      return [str(label, 30), n(r.best, 100)];
    }).slice(0, 5);
    s.push({ t: str(song.title, 80), a: str(song.artist, 60), ms: n(ms), w: n(o.today), last: n(o.last), ex });
  }
  s.sort((a, b) => b.ms - a.ms);
  const g = Object.entries(st.games || {}).filter(([id]) => /^[a-z]{2,12}$/.test(id)).map(([id, r]) => ({ id, ms: n((tot.games || {})[id]), n: n(r && r.plays), best: n(r && r.best, 100) })).filter((x) => x.ms || x.n).sort((a, b) => b.ms - a.ms || b.n - a.n);
  return { v: 1, today, d: d.slice(-120), s: s.slice(0, 15), g: g.slice(0, 10) };
}

/** Očisti pregled koji je stigao od učenika (fajl napretka). */
export function cleanOv(o) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.d)) return null;
  return {
    v: 1, today: n(o.today, 1e6),
    d: o.d.slice(-120).filter((x) => Array.isArray(x)).map((x) => [n(x[0], 1e6), n(x[1], 864e5), n(x[2], 864e5)]),
    s: (Array.isArray(o.s) ? o.s : []).slice(0, 15).map((x) => ({ t: str(x && x.t, 80), a: str(x && x.a, 60), ms: n(x && x.ms), w: n(x && x.w), last: n(x && x.last), ex: (Array.isArray(x && x.ex) ? x.ex : []).slice(0, 5).map((e) => [str(e && e[0], 30), n(e && e[1], 100)]) })),
    g: (Array.isArray(o.g) ? o.g : []).slice(0, 10).filter((x) => x && /^[a-z]{2,12}$/.test(x.id)).map((x) => ({ id: x.id, ms: n(x.ms), n: n(x.n, 1e6), best: n(x.best, 100) })),
  };
}

const RANGES = ['w', 'm', 'a'];
function bucket(data, range, today) {
  const map = new Map(data.d.map(([k, p, x]) => [k, [p, x]]));
  const day = (k) => map.get(k) || [0, 0];
  if (range === 'w') {
    const dow = (new Date().getDay() + 6) % 7, start = today - dow;
    const names = getLang() === 'en' ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['P', 'U', 'S', 'Č', 'P', 'S', 'N'];
    const bars = Array.from({ length: 7 }, (_, i) => ({ k: start + i, l: names[i] || '', v: day(start + i), cur: start + i === today, fut: start + i > today }));
    return { bars, from: start, to: today, prevFrom: start - 7, prevTo: today - 7, len: 7 };
  }
  if (range === 'm') {
    const bars = Array.from({ length: 30 }, (_, i) => { const k = today - 29 + i; const dt = new Date(Date.now() - (today - k) * 864e5); return { k, l: i % 7 === 2 ? String(dt.getDate()) : '', v: day(k), cur: k === today }; });
    return { bars, from: today - 29, to: today, prevFrom: today - 59, prevTo: today - 30, len: 30 };
  }
  // sve: poslednjih 12 nedelja, po nedelji
  const dow = (new Date().getDay() + 6) % 7, wk = today - dow;
  const bars = Array.from({ length: 12 }, (_, i) => { const s = wk - (11 - i) * 7; let p = 0, x = 0; for (let k = s; k < s + 7; k++) { const [a, b] = day(k); p += a; x += b; } const dt = new Date(Date.now() - (today - s) * 864e5); return { k: s, l: i % 2 ? '' : `${dt.getDate()}.${dt.getMonth() + 1}.`, v: [p, x], cur: i === 11 }; });
  return { bars, from: data.d.length ? data.d[0][0] : today, to: today, prevFrom: 0, prevTo: -1, len: 0 };
}

/**
 * Nacrtaj pregled. opts: { title, sub, back: { href, label }, teacher: bool, tasks?: { done, total }, who? (ime) }
 */
export async function renderOverview(root, data, opts) {
  const { fmtDur } = await import('./statsView.js');
  const { streakOf } = await import('./streak.js');
  try { const [{ LANGS }, X] = await Promise.all([import('./i18n.js'), import('./practiceText.js')]); for (const l of ['sr', 'en']) if (LANGS[l] && X[l] && !LANGS[l]['pr.g.pauk']) Object.assign(LANGS[l], X[l]); } catch {}
  let range = (() => { try { const v = localStorage.getItem('marli-ov-range'); return RANGES.includes(v) ? v : 'w'; } catch { return 'w'; } })();
  const today = (await import('./activity.js')).dayNum();
  const sum = (from, to) => data.d.filter(([k]) => k >= from && k <= to).reduce((a, [, p, x]) => a + p + x, 0);
  const streak = streakOf(Object.fromEntries(data.d.map(([k, p, x]) => [k, p + x])), today).streak;
  const draw = () => {
    const b = bucket(data, range, today);
    const total = sum(b.from, b.to), prev = b.len ? sum(b.prevFrom, b.prevTo) : 0, diff = total - prev;
    const active = data.d.filter(([k, p, x]) => k >= b.from && k <= b.to && p + x > 0).length;
    const max = Math.max(1, ...b.bars.map((x) => x.v[0] + x.v[1]));
    const H = 110;
    const third = opts.tasks ? `<div class="ov-st"><small>${esc(t('ov.tasks'))}</small><b>${opts.tasks.done} / ${opts.tasks.total}</b><em>${esc(opts.tasks.total - opts.tasks.done ? t('ov.tasksLeft', { n: opts.tasks.total - opts.tasks.done }) : t('ov.tasksAll'))}</em></div>`
      : `<div class="ov-st"><small>${esc(t('ov.songs'))}</small><b>${data.s.length}</b><em>${esc(t('ov.songsSub'))}</em></div>`;
    root.querySelector('.ov-body').innerHTML = `
      <div class="ov-seg" role="tablist">${RANGES.map((r) => `<button type="button" role="tab" aria-selected="${r === range}" class="${r === range ? 'on' : ''}" data-ov="${r}">${esc(t('ov.r.' + r))}</button>`).join('')}</div>
      <div class="ov-big">
        <div class="ov-st"><small>${esc(t('ov.time.' + range))}</small><b>${esc(fmtDur(total))}</b>${b.len && prev + total ? `<em class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '▲' : '▼'} ${esc(fmtDur(Math.abs(diff)))}</em>` : '<em>&nbsp;</em>'}</div>
        <div class="ov-st"><small>${esc(t('ov.days'))}</small><b>${b.len ? `${active} / ${range === 'w' ? Math.min(7, today - b.from + 1) : b.len}` : active}</b><em>${streak ? `🔥 ${esc(t('ov.streak', { n: streak }))}` : '&nbsp;'}</em></div>
        ${third}
      </div>
      <div class="ov-chart" aria-label="${esc(t('ov.chart'))}">
        <div class="ov-bars ${range}">${b.bars.map((x) => `<div class="${x.cur ? 'cur' : ''}${x.fut ? ' fut' : ''}" title="${esc(fmtDur(x.v[0] + x.v[1]))}"><span class="ov-col" style="height:${H}px"><i class="x" style="height:${Math.round((x.v[1] / max) * H)}px"></i><i class="p" style="height:${Math.round((x.v[0] / max) * H)}px"></i></span><span class="ov-l">${esc(x.l)}</span></div>`).join('')}</div>
        <div class="ov-leg"><span><i class="p"></i>${esc(t('ov.legSongs'))}</span><span><i class="x"></i>${esc(t('ov.legEx'))}</span></div>
      </div>
      <div class="ov-h">${esc(t('ov.songsHead'))}<small>${esc(t('ov.allTime'))}</small></div>
      ${data.s.length ? `<div class="ov-list">${data.s.map((x) => `<div class="ov-row"><div class="n"><b>${esc(x.t)}</b>${x.a ? `<small>${esc(x.a)}</small>` : ''}${x.ex.length ? `<div class="ov-ex">${x.ex.map(([l, best]) => `<span class="ov-chip">${esc(l)} <i class="${best >= 80 ? 'ok' : ''}">${STARS(best)}</i></span>`).join('')}</div>` : ''}</div><div class="t">${esc(fmtDur(x.ms))}</div></div>`).join('')}</div>` : `<p class="muted small ov-empty">${esc(t('ov.noSongs'))}</p>`}
      ${data.g.length ? `<div class="ov-h">${esc(t('ov.games'))}</div><div class="ov-list">${data.g.map((g) => `<div class="ov-row"><div class="n"><b>${esc(t('pr.g.' + g.id))}</b><small>${esc([g.n ? countOf(g.n, ROUNDS) : '', g.best ? t('prog.best', { n: g.best }) : ''].filter(Boolean).join(' · '))}</small></div><div class="t">${g.ms ? esc(fmtDur(g.ms)) : ''}</div></div>`).join('')}</div>` : ''}
      ${opts.foot || ''}`;
  };
  root.innerHTML = `<section class="view ov-view">
    <a class="back" href="${esc(opts.back.href)}">‹ ${esc(opts.back.label)}</a>
    <div class="ov-top">${opts.avatar || ''}<div><h1>${esc(opts.title)}</h1><p class="ov-sub">${esc(opts.sub || '')}</p></div></div>
    <div class="ov-body"></div>
  </section>`;
  root.querySelector('.ov-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ov]'); if (!b) return;
    range = b.dataset.ov; try { localStorage.setItem('marli-ov-range', range); } catch {}
    draw();
  });
  draw();
}

/** #/vezbanje (ja) ili #/vezbanje/<id učenika> (nastavnik). */
export async function renderPracticeOverview(root, sid = '') {
  if (!sid) {
    await (await import('./activity.js')).flush().catch(() => {});
    const data = await myOverviewData();
    const T = await import('./teach.js'); const m = await T.getMyTeacher();
    const foot = m ? `<p class="ov-share">${m.prog && m.prog.on ? '👁 ' + esc(t('ov.sharedOn', { t: m.name || t('tch.teacher') })) : '🔒 ' + esc(t('ov.sharedOff', { t: m.name || t('tch.teacher') }))}</p>` : '';
    return renderOverview(root, data, { title: t('ov.title'), sub: t('ov.sub'), back: m ? { href: '#/od-nastavnika', label: t('tch.fromTeacher') } : { href: '#/vezbe', label: t('pr.title') }, foot });
  }
  const T = await import('./teach.js'); const st = await T.getStudent(sid);
  if (!st) { location.replace('#/ucenici'); return; }
  const back = { href: '#/ucenik/' + encodeURIComponent(sid), label: st.name };
  const avatar = T.avatarHTML ? T.avatarHTML(st, 52) : '';
  root.innerHTML = `<section class="view ov-view"><a class="back" href="${esc(back.href)}">‹ ${esc(back.label)}</a><p class="muted">${esc(t('common.loading'))}</p></section>`;
  const P = await import('./progress.js');
  const pr = await P.studentProgress(st, { fresh: true }).catch(() => null);
  const ov = pr && !pr.err && !pr.gone ? cleanOv(pr.ov) : null;
  if (!ov) {
    const why = !pr ? t('ov.noShare', { name: st.name }) : pr.gone ? t('ov.gone', { name: st.name }) : pr.err ? t('ov.err') : t('ov.old', { name: st.name });
    root.innerHTML = `<section class="view ov-view"><a class="back" href="${esc(back.href)}">‹ ${esc(back.label)}</a><div class="ov-top">${avatar}<div><h1>${esc(t('ov.titleT', { name: st.name }))}</h1></div></div><p class="ov-share">${esc(why)}</p></section>`;
    return;
  }
  const tasks = pr.tasks ? (() => { const v = Object.values(pr.tasks); return v.length ? { total: v.length, done: v.filter((x) => x[1]).length } : null; })() : null;
  const { fmtDur } = await import('./statsView.js');
  const last = pr.lastDay ? (await import('./activity.js')).dayNum() - pr.lastDay : null;
  const sub = last == null ? '' : last <= 0 ? t('ov.lastToday') : last === 1 ? t('ov.lastYesterday') : t('ov.lastAgo', { n: countOf(last, DAYS) });
  return renderOverview(root, ov, { title: t('ov.titleT', { name: st.name }), sub, back, avatar, tasks, foot: `<p class="ov-share">🔒 ${esc(t('ov.teacherNote', { name: st.name }))}</p>`, fmtDur });
}
