// v2.4.32: Dolasci na časove po učeniku, po mesecima (nastavnik prati napredak i kroz redovnost).
// Sam se popunjava: časovi iz rasporeda (redovan termin), časovi sa beleškom = održan, otkazan u rasporedu = otkazan.
// Prošli čas iz rasporeda bez oznake se računa kao održan; nastavnik jednim dodirom menja: ✓ bio · ✗ nije došao · otkazan.
// Ručne oznake: st.att = { 'GGGG-M-D': { s: 'y'|'n'|'x', ts? } } (ts za čas van rasporeda, „+ Dodaj čas“).
import { t } from './i18n.js';
import { esc, dialog, toast } from './ui.js';

const DAY = 864e5;
const dkey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const MONTHS = () => t('spf.monthNames').split(',');
const STATES = ['y', 'n', 'x'];

/** Časovi u mesecu: [{ key, ts, s: 'y'|'n'|'x'|'f', auto, extra }] (f = tek dolazi). */
export async function monthLessons(st, y, m) {
  const S = await import('./schedule.js');
  const from = new Date(y, m, 1).getTime(), to = new Date(y, m + 1, 1).getTime(), now = Date.now();
  const att = st.att && typeof st.att === 'object' ? st.att : {};
  const map = new Map();
  for (const o of S.occurrences(st, from, to, { withOff: true })) map.set(o.key, { key: o.key, ts: o.ts, off: !!o.off });
  if (!st.slot && st.next && st.next >= from && st.next < to) map.set(dkey(st.next), { key: dkey(st.next), ts: st.next });
  const noted = new Set((st.notes || []).filter((n) => n && n.at >= from && n.at < to).map((n) => dkey(n.at)));
  for (const n of st.notes || []) if (n && n.at >= from && n.at < to && !map.has(dkey(n.at))) map.set(dkey(n.at), { key: dkey(n.at), ts: n.at, extra: true });
  for (const [k, v] of Object.entries(att)) if (v && v.ts && v.ts >= from && v.ts < to && !map.has(k)) map.set(k, { key: k, ts: v.ts, extra: true });
  return [...map.values()].map((o) => {
    const man = att[o.key] && STATES.includes(att[o.key].s) ? att[o.key].s : null;
    const s = man || (o.off ? 'x' : noted.has(o.key) ? 'y' : o.ts <= now ? 'y' : 'f');
    return { ...o, s, auto: !man };
  }).sort((a, b) => a.ts - b.ts);
}
export const countOf = (ls) => ({ y: ls.filter((x) => x.s === 'y').length, n: ls.filter((x) => x.s === 'n').length, x: ls.filter((x) => x.s === 'x').length, f: ls.filter((x) => x.s === 'f').length });
/** Kratko za profil: „Novembar: 3 od 4 · 1 nije došao“. */
export async function summaryText(st, d = new Date()) {
  const ls = await monthLessons(st, d.getFullYear(), d.getMonth());
  const c = countOf(ls), held = c.y + c.n;
  if (!ls.length) return t('att.none');
  return [t('att.sum', { m: MONTHS()[d.getMonth()], y: c.y, n: held }), c.n ? t('att.sumN', { n: c.n }) : '', c.x ? t('att.sumX', { n: c.x }) : '', c.f ? t('att.sumF', { n: c.f }) : ''].filter(Boolean).join(' · ');
}
export async function setMark(sid, key, s, ts = 0) {
  const T = await import('./teach.js'); const st = await T.getStudent(sid); if (!st) return null;
  const att = { ...(st.att || {}) };
  if (s == null) delete att[key]; else att[key] = { s, ...(ts ? { ts } : att[key] && att[key].ts ? { ts: att[key].ts } : {}) };
  // stare oznake (preko 3 godine) se brišu
  const cut = Date.now() - 3 * 365 * DAY;
  for (const [k, v] of Object.entries(att)) { const [yy, mm, dd] = k.split('-').map(Number); if (new Date(yy, mm - 1, dd).getTime() < cut) delete att[k]; }
  return T.updateStudent(sid, { att });
}

/** Prozor „Dolasci“: mesec ‹ ›, zbir, časovi sa ✓ / ✗ / otkazan, „+ Dodaj čas“, poslednjih 6 meseci. */
export async function attFlow(sid) {
  const T = await import('./teach.js'); const L = await import('./lessons.js');
  let st = await T.getStudent(sid); if (!st) return false;
  const now = new Date(); let y = now.getFullYear(), m = now.getMonth(), changed = false;
  const p = dialog({ title: t('att.title', { name: st.name }), html: true, className: 'tch-dlg att-dlg', body: '<div class="att-body"></div>', buttons: [{ label: t('common.close'), value: null }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop(), body = box.querySelector('.att-body');
  const draw = async () => {
    st = await T.getStudent(sid);
    const ls = await monthLessons(st, y, m), c = countOf(ls);
    const hist = []; for (let k = 5; k >= 0; k--) { const d = new Date(now.getFullYear(), now.getMonth() - k, 1); const l2 = await monthLessons(st, d.getFullYear(), d.getMonth()); const c2 = countOf(l2); hist.push({ y: d.getFullYear(), m: d.getMonth(), c: c2, tot: c2.y + c2.n }); }
    const mx = Math.max(1, ...hist.map((h) => h.tot));
    body.innerHTML = `<div class="att-nav"><button type="button" class="icon-btn" data-mv="-1" aria-label="${esc(t('att.prev'))}">‹</button><b>${esc(MONTHS()[m])} ${y}</b><button type="button" class="icon-btn" data-mv="1" aria-label="${esc(t('att.next'))}"${y === now.getFullYear() && m >= now.getMonth() + 1 ? ' disabled' : ''}>›</button></div>
      <div class="att-sum"><span><b>${c.y}</b><small>${esc(t('att.y'))}</small></span><span class="n"><b>${c.n}</b><small>${esc(t('att.n'))}</small></span><span class="x"><b>${c.x}</b><small>${esc(t('att.x'))}</small></span>${c.f ? `<span class="f"><b>${c.f}</b><small>${esc(t('att.f'))}</small></span>` : ''}</div>
      <div class="set-grp att-list">${ls.length ? ls.map((o) => `<div class="tch-row att-r s-${o.s}" data-k="${esc(o.key)}" data-ts="${o.ts}"><i class="att-ic" aria-hidden="true">${o.s === 'y' ? '✓' : o.s === 'n' ? '✗' : o.s === 'x' ? '–' : '·'}</i><span><b>${esc(L.lessonWhen(o.ts))}</b><small>${esc(o.s === 'f' ? t('att.f1') : t('att.' + o.s + '1'))}${o.auto && o.s !== 'f' ? ' · ' + esc(t('att.auto')) : ''}${o.extra ? ' · ' + esc(t('att.extra')) : ''}</small></span>
        ${o.s === 'f' ? '' : `<span class="att-seg">${STATES.map((s) => `<button type="button" class="${o.s === s ? 'on' : ''}" data-set="${s}" aria-pressed="${o.s === s}" title="${esc(t('att.' + s + '1'))}">${s === 'y' ? '✓' : s === 'n' ? '✗' : '–'}</button>`).join('')}</span>`}</div>`).join('') : `<div class="tch-row"><span><small>${esc(t('att.noneMonth'))}</small></span></div>`}</div>
      <button type="button" class="btn small att-add" data-add="1">+ ${esc(t('att.add'))}</button>
      <div class="tch-sec"><span>${esc(t('att.hist'))}</span></div>
      <div class="att-hist">${hist.map((h) => `<button type="button" class="att-hb${h.y === y && h.m === m ? ' on' : ''}" data-ym="${h.y}-${h.m}"><i style="height:${Math.round((h.c.y / mx) * 100)}%"></i><b>${h.c.y}/${h.tot}</b><small>${esc(MONTHS()[h.m].slice(0, 3))}</small></button>`).join('')}</div>`;
  };
  body.addEventListener('click', async (e) => {
    const mv = e.target.closest('[data-mv]'); if (mv) { m += Number(mv.dataset.mv); if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } await draw(); return; }
    const ym = e.target.closest('[data-ym]'); if (ym) { [y, m] = ym.dataset.ym.split('-').map(Number); await draw(); return; }
    const set = e.target.closest('[data-set]'); if (set) { const r = set.closest('[data-k]'); await setMark(sid, r.dataset.k, set.dataset.set, Number(r.dataset.ts) || 0); changed = true; await draw(); return; }
    if (e.target.closest('[data-add]')) {
      const def = new Date(); const p2 = (n) => String(n).padStart(2, '0');
      const pp = dialog({ title: t('att.add'), html: true, className: 'tch-dlg', body: `<label class="tch-lab">${esc(t('les.when'))}</label><input type="datetime-local" id="attWhen" value="${def.getFullYear()}-${p2(def.getMonth() + 1)}-${p2(def.getDate())}T${p2(def.getHours())}:00">`, buttons: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), value: 'ok', kind: 'primary' }] });
      const b = [...document.querySelectorAll('.modal-backdrop')].pop();
      if ((await pp) !== 'ok') return;
      const ts = new Date(b.querySelector('#attWhen').value).getTime(); if (!ts) return;
      await setMark(sid, dkey(ts), 'y', ts); changed = true; const d = new Date(ts); y = d.getFullYear(); m = d.getMonth(); toast(t('att.added')); await draw();
    }
  });
  await draw();
  await p;
  return changed;
}
