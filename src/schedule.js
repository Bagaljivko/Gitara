// v2.4.24: raspored časova. Učenik (kod nastavnika) ima redovan termin: slot = { dow (0=pon..6=ned), hm 'HH:MM', dur (min),
// every (1 = svake nedelje, 2 = na dve nedelje, 0 = samo jednom), from (dan početka, ms), off: {datum: 1} (otkazano),
// moved: {datum: ms} (pomereno) }. „Sledeći čas“ (st.next) se računa sam iz termina i šalje učeniku (kao i ranije).
// Raspored (#/raspored): nedelja — telefon: dani i lista; računar: mreža po satima. Rođendani i godišnjice na svom danu.
// „Dodaj u kalendar telefona“: .ics fajl (ponavljanje) — telefon podseća i kad je aplikacija zatvorena.
import { t, getLang, countOf, DAYS } from './i18n.js';
import { esc, dialog, toast } from './ui.js';

const DAY = 864e5;
const LES = { sr: ['čas', 'časa', 'časova'], en: ['lesson', 'lessons'] };
const inTxt = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? t('sch.inMin', { n: m }) : t('sch.inH', { n: Math.round(m / 60) }); };
const day0 = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
export const dkey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const monday = (ms) => { const d = new Date(day0(ms)); return day0(d.getTime() - ((d.getDay() + 6) % 7) * DAY); };
const atHm = (dayMs, hm) => { const [h, m] = String(hm || '17:00').split(':').map(Number); const d = new Date(dayMs); d.setHours(h || 0, m || 0, 0, 0); return d.getTime(); };
const hmOf = (ms) => { const d = new Date(ms); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function cleanSlot(x) {
  if (!x || typeof x !== 'object') return null;
  const hm = /^\d{1,2}:\d{2}$/.test(x.hm) ? x.hm : '17:00';
  return { dow: Math.max(0, Math.min(6, Math.round(Number(x.dow) || 0))), hm, dur: Math.max(15, Math.min(240, Math.round(Number(x.dur) || 45))), every: [0, 1, 2].includes(Number(x.every)) ? Number(x.every) : 1, from: day0(Number(x.from) || Date.now()), off: x.off && typeof x.off === 'object' ? x.off : {}, moved: x.moved && typeof x.moved === 'object' ? x.moved : {} };
}

/** Časovi učenika u [fromMs, toMs): [{ ts, dur, sid, key (datum termina), moved, slot }]. */
export function occurrences(st, fromMs, toMs) {
  const out = [];
  const s = cleanSlot(st.slot);
  if (s) {
    // prvi termin: prvi dan „dow“ od s.from
    let first = s.from; while ((new Date(first).getDay() + 6) % 7 !== s.dow) first += DAY;
    const step = s.every === 2 ? 14 : 7;
    const lastDay = s.every === 0 ? first : toMs + 14 * DAY;
    for (let d = first; d <= lastDay; d = day0(d + step * DAY + 3 * 3600e3)) {
      const k = dkey(d);
      if (s.off[k]) { if (s.every === 0) break; continue; }
      const ts = Number(s.moved[k]) || atHm(d, s.hm);
      if (ts >= fromMs && ts < toMs) out.push({ ts, dur: s.dur, sid: st.id, key: k, moved: !!s.moved[k], slot: true });
      if (s.every === 0) break;
    }
  } else if (st.next && st.next >= fromMs && st.next < toMs) out.push({ ts: st.next, dur: 45, sid: st.id, key: dkey(st.next), moved: false, slot: false });
  return out.sort((a, b) => a.ts - b.ts);
}
/** Sledeći čas (posle sada − 1 h). */
export function nextOf(st, now = Date.now()) { const o = occurrences(st, now - 3600e3, now + 120 * DAY)[0]; return o ? o.ts : 0; }

/** Nastavnik: osveži „Sledeći čas“ svim učenicima sa terminom; ako se promenio — pošalji učeniku (tiho). */
export async function refreshNext({ only = null } = {}) {
  const T = await import('./teach.js'); const B = await import('./teachBox.js');
  for (const st of await T.getStudents()) {
    if (only && st.id !== only) continue;
    if (!st.slot) continue;
    const nx = nextOf(st);
    if (nx === (st.next || 0)) continue;
    await T.updateStudent(st.id, { next: nx });
    const s = cleanSlot(st.slot);
    if (st.box && st.box.f) await B.boxPut(st.id, [{ key: 'lesson', kind: 'lesson', next: nx, dur: s.dur, every: s.every, at: Date.now() }], { interactive: false }).catch(() => false);
  }
}

// ---------------- .ics (kalendar telefona) ----------------
const icsDate = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`; };
const icsEsc = (s) => String(s || '').replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
/** Jedan događaj (sa ponavljanjem ako every ≥ 1). */
export function icsFor({ title, start, dur, every = 0, uid }) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MARLI//Gitara//SR', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${uid}@marli`, `DTSTAMP:${icsDate(Date.now())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(start + dur * 60000)}`, `SUMMARY:${icsEsc(title)}`];
  if (every) L.push(`RRULE:FREQ=WEEKLY;INTERVAL=${every}`);
  L.push('BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(title)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR');
  return L.join('\r\n');
}
export function downloadIcs(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar' })); a.download = name.replace(/[^\w.-]+/g, '-') + '.ics';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

// ---------------- nastavnik: redovan termin ----------------
const DOWS = () => (getLang() === 'en' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub', 'Ned']);
const isoDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** Termin učenika (dan, vreme, trajanje, ponavljanje). Čuva, osveži sledeći čas i javi učeniku. */
export async function slotFlow(sid) {
  const T = await import('./teach.js'); const st = await T.getStudent(sid); if (!st) return false;
  const cur = cleanSlot(st.slot) || (() => { const b = st.next && st.next > Date.now() ? st.next : Date.now() + 7 * DAY; return { dow: (new Date(b).getDay() + 6) % 7, hm: st.next ? hmOf(st.next).padStart(5, '0') : '17:00', dur: 45, every: 1, from: day0(Date.now()), off: {}, moved: {} }; })();
  const v = { ...cur, cal: false };
  const p = dialog({ title: t('sch.slotT', { name: st.name }), html: true, className: 'tch-dlg sch-dlg', body: `
    <p class="muted small">${t('sch.slotSub')}</p>
    <label class="tch-lab">${t('sch.day')}</label><div class="sch-days" role="radiogroup">${DOWS().map((d, i) => `<button type="button" role="radio" aria-checked="${i === v.dow}" class="${i === v.dow ? 'on' : ''}" data-dow="${i}">${esc(d)}</button>`).join('')}</div>
    <div class="sch-3"><div><label class="tch-lab">${t('sch.start')}</label><input type="time" id="schHm" value="${esc(v.hm.padStart(5, '0'))}"></div>
      <div><label class="tch-lab">${t('sch.dur')}</label><select id="schDur">${[30, 45, 60, 90].map((m) => `<option value="${m}"${m === v.dur ? ' selected' : ''}>${m} min</option>`).join('')}</select></div></div>
    <label class="tch-lab">${t('sch.from')}</label><input type="date" id="schFrom" value="${isoDay(v.from)}">
    <label class="tch-lab">${t('sch.repeat')}</label><div class="sch-seg">${[[1, 'sch.r1'], [2, 'sch.r2'], [0, 'sch.r0']].map(([k, l]) => `<button type="button" class="${v.every === k ? 'on' : ''}" data-ev="${k}">${esc(t(l))}</button>`).join('')}</div>
    <label class="switch tch-sw sch-sw"><input type="checkbox" id="schCal"><span class="switch-track"><span class="switch-thumb"></span></span><span><b>📅 ${t('sch.cal')}</b><small class="muted">${t('sch.calSub')}</small></span></label>
    ${st.box && st.box.f ? `<p class="tch-lock">🔔 ${t('sch.tells', { name: st.name })}</p>` : `<p class="tch-lock">${t('sch.notConn', { name: st.name })}</p>`}`,
  buttons: [...(st.slot ? [{ label: t('sch.remove'), value: 'rm', kind: 'ghost' }] : []), { label: t('common.cancel'), value: null }, { label: t('common.save'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  box.addEventListener('click', (e) => {
    const d = e.target.closest('[data-dow]'); if (d) { v.dow = Number(d.dataset.dow); box.querySelectorAll('[data-dow]').forEach((x) => { const on = x === d; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); }); }
    const r = e.target.closest('[data-ev]'); if (r) { v.every = Number(r.dataset.ev); box.querySelectorAll('[data-ev]').forEach((x) => x.classList.toggle('on', x === r)); }
  });
  const res = await p;
  if (res === 'rm') { await T.updateStudent(sid, { slot: null, next: 0 }); if (st.box && st.box.f) await (await import('./teachBox.js')).boxPut(sid, [{ key: 'lesson', kind: 'lesson', next: 0, at: Date.now() }]).catch(() => {}); toast(t('sch.removed')); return true; }
  if (res !== 'ok') return false;
  const q = (id) => box.querySelector('#' + id);
  const from = q('schFrom').value ? day0(new Date(q('schFrom').value + 'T12:00:00').getTime()) : day0(Date.now());
  const slot = cleanSlot({ dow: v.dow, hm: q('schHm').value || '17:00', dur: Number(q('schDur').value) || 45, every: v.every, from, off: {}, moved: {} });
  await T.updateStudent(sid, { slot, next: -1 }); // -1: sledeći čas se sigurno preračuna i pošalje
  await refreshNext({ only: sid });
  const nx = nextOf({ ...st, slot });
  if (q('schCal').checked && nx) downloadIcs(t('sch.icsName', { name: st.name }), icsFor({ title: t('sch.icsTitle', { name: st.name }), start: nx, dur: slot.dur, every: slot.every, uid: 'les-' + sid }));
  const L = await import('./lessons.js');
  toast(nx ? t('sch.saved', { name: st.name, w: L.lessonWhen(nx) }) : t('sch.savedNone'));
  return true;
}

/** Pomeri ili otkaži jedan čas. */
async function occFlow(o, st, redraw) {
  const T = await import('./teach.js'); const L = await import('./lessons.js');
  const v = await dialog({ title: `${st.name} · ${L.lessonWhen(o.ts)}`, className: 'dlg-stack', buttons: [{ label: t('sch.openSt'), value: 'open' }, { label: t('sch.move'), value: 'mv' }, { label: t('sch.cancelOne'), value: 'x', kind: 'danger' }, { label: t('common.close'), value: null, kind: 'ghost' }] });
  if (v === 'open') { location.hash = '#/ucenik/' + encodeURIComponent(st.id); return; }
  if (v === 'mv') {
    const loc = (ms) => { const d = new Date(ms); const p2 = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };
    const pp = dialog({ title: t('sch.move'), html: true, className: 'tch-dlg', body: `<label class="tch-lab">${t('les.when')}</label><input type="datetime-local" id="schMv" value="${loc(o.ts)}">`, buttons: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), value: 'ok', kind: 'primary' }] });
    const b = [...document.querySelectorAll('.modal-backdrop')].pop();
    if ((await pp) !== 'ok') return;
    const ts = new Date(b.querySelector('#schMv').value).getTime(); if (!ts) return;
    if (o.slot) { const s = cleanSlot(st.slot); s.moved[o.key] = ts; await T.updateStudent(st.id, { slot: s }); } else await T.updateStudent(st.id, { next: ts, slot: null });
    toast(t('sch.moved', { name: st.name, w: L.lessonWhen(ts) }));
  } else if (v === 'x') {
    if (o.slot) { const s = cleanSlot(st.slot); s.off[o.key] = 1; await T.updateStudent(st.id, { slot: s }); } else await T.updateStudent(st.id, { next: 0 });
    toast(t('sch.cancelled', { name: st.name }));
  } else return;
  if (o.slot) await refreshNext({ only: st.id });
  else if (st.box && st.box.f) { const cur = await T.getStudent(st.id); await (await import('./teachBox.js')).boxPut(st.id, [{ key: 'lesson', kind: 'lesson', next: cur.next || 0, at: Date.now() }], { interactive: false }).catch(() => {}); }
  redraw();
}

// ---------------- Raspored ----------------
export async function renderSchedule(root, params = new URLSearchParams()) {
  const T = await import('./teach.js'); const SP = await import('./studentProfile.js'); const L = await import('./lessons.js');
  let wk = Number(params.get && params.get('w')) || 0;
  const desk = matchMedia('(min-width: 1100px) and (hover: hover) and (pointer: fine)').matches;
  let sel = day0(Date.now());
  const draw = async () => {
    const sts = await T.getStudents();
    const mon = monday(Date.now()) + wk * 7 * DAY, end = mon + 7 * DAY;
    const occ = sts.flatMap((st) => occurrences(st, mon, end).map((o) => ({ ...o, st }))).sort((a, b) => a.ts - b.ts);
    const marks = [];
    for (const st of sts) {
      if (st.bd && st.bd.d && st.bd.m) for (let d = mon; d < end; d += DAY) { const x = new Date(d + 3600e3); if (x.getDate() === st.bd.d && x.getMonth() + 1 === st.bd.m) marks.push({ day: day0(d + 3600e3), st, k: 'bd', age: st.bd.y ? x.getFullYear() - st.bd.y : 0 }); }
      const since = new Date(SP.sinceOf(st));
      for (let d = mon; d < end; d += DAY) { const x = new Date(d + 3600e3); const yrs = x.getFullYear() - since.getFullYear(); if (yrs >= 1 && x.getDate() === since.getDate() && x.getMonth() === since.getMonth()) marks.push({ day: day0(d + 3600e3), st, k: 'an', yrs }); }
    }
    const total = occ.reduce((a, o) => a + o.dur, 0);
    const { fmtDur } = await import('./statsView.js');
    const today = day0(Date.now());
    const dstr = (ms) => { const d = new Date(ms); return `${d.getDate()}. ${d.getMonth() + 1}.`; };
    const head = `<a class="back" href="#/ucenici">‹ ${esc(t('tch.students'))}</a><h1>${esc(t('sch.title'))}</h1>
      <p class="sch-sub">${esc(occ.length ? t('sch.weekSum', { n: countOf(occ.length, LES), d: fmtDur(total * 60000) }) : t('sch.weekNone'))}</p>
      <div class="sch-wk"><button type="button" class="sch-nav" data-w="-1" aria-label="${esc(t('sch.prevWk'))}">‹</button><b>${esc(dstr(mon))} – ${esc(dstr(end - DAY))}</b>${wk ? `<button type="button" class="linkish" data-w="0">${esc(t('sch.thisWk'))}</button>` : ''}<button type="button" class="sch-nav" data-w="1" aria-label="${esc(t('sch.nextWk'))}">›</button></div>`;
    const card = (o) => `<button type="button" class="sch-c${o.ts <= Date.now() && o.ts + o.dur * 60000 > Date.now() ? ' now' : ''}${o.ts + o.dur * 60000 <= Date.now() ? ' past' : ''}" style="--c:${esc(o.st.color || '#f5a524')}" data-occ="${esc(o.sid + '|' + o.key + '|' + o.ts)}">${T.avatarHTML(o.st, 36)}<span><b>${esc(o.st.name)}</b><small>${esc([o.moved ? t('sch.movedTag') : '', o.slot ? t(cleanSlot(o.st.slot).every === 2 ? 'sch.r2' : cleanSlot(o.st.slot).every === 0 ? 'sch.r0' : 'sch.r1') : t('sch.r0'), (o.st.notes || [])[0]?.hw ? t('les.hwShort', { hw: o.st.notes[0].hw }) : ''].filter(Boolean).join(' · '))}</small></span>${o.ts > Date.now() && o.ts - Date.now() < 3 * 3600e3 ? `<em class="sch-tag">${esc(inTxt(o.ts - Date.now()))}</em>` : o.ts + o.dur * 60000 <= Date.now() ? `<em class="sch-tag ok">✓</em>` : ''}</button>`;
    const markHTML = (m) => `<div class="sch-mark ${m.k}">${m.k === 'bd' ? '🎂' : '🤝'} <span>${esc(m.k === 'bd' ? t('sch.bd', { name: m.st.name }) + (m.age ? ` (${m.age})` : '') : t('sch.an', { name: m.st.name, n: m.yrs }))}</span></div>`;
    let body;
    if (!desk) {
      const days = Array.from({ length: 7 }, (_, i) => mon + i * DAY + 3600e3).map(day0);
      if (!days.includes(sel)) sel = days.includes(today) ? today : days[0];
      body = `<div class="sch-days7">${days.map((d, i) => `<button type="button" class="${d === sel ? 'on' : ''}${d === today ? ' today' : ''}" data-day="${d}">${esc(DOWS()[i].slice(0, getLang() === 'en' ? 3 : 3))}<b>${new Date(d).getDate()}</b><i class="${occ.some((o) => day0(o.ts) === d) ? 'dot' : ''}"></i></button>`).join('')}</div>`
        + days.filter((d) => d >= sel).map((d) => { const os = occ.filter((o) => day0(o.ts) === d), ms = marks.filter((m) => m.day === d); if (!os.length && !ms.length && d !== sel) return ''; return `<div class="sch-h${d === today ? ' today' : ''}"><span>${esc(d === today ? t('sch.today') + ' · ' : '')}${esc(DOWS()[(new Date(d).getDay() + 6) % 7])} ${new Date(d).getDate()}.</span><span>${os.length ? esc(countOf(os.length, LES)) : ''}</span></div>${ms.map(markHTML).join('')}${os.map((o) => `<div class="sch-l"><div class="sch-t">${esc(hmOf(o.ts))}<small>${o.dur} min</small></div>${card(o)}</div>`).join('') || `<p class="muted small sch-empty">${esc(t('sch.free'))}</p>`}`; }).join('');
    } else {
      const hrs = occ.map((o) => new Date(o.ts).getHours()); const h0 = Math.min(14, ...hrs), h1 = Math.max(20, ...hrs.map((h) => h + 1));
      const cols = Array.from({ length: 7 }, (_, i) => day0(mon + i * DAY + 3600e3));
      let g = `<div class="sch-gh"></div>${cols.map((d, i) => `<div class="sch-gh${d === today ? ' on' : ''}">${esc(DOWS()[i])}<b>${new Date(d).getDate()}</b>${marks.filter((m) => m.day === d).map((m) => `<span class="sch-gm" title="${esc(m.st.name)}">${m.k === 'bd' ? '🎂' : '🤝'}</span>`).join('')}</div>`).join('')}`;
      for (let h = h0; h < h1; h++) {
        g += `<div class="sch-gt">${h}:00</div>`;
        for (const d of cols) { const os = occ.filter((o) => day0(o.ts) === d && new Date(o.ts).getHours() === h); g += `<div class="sch-gc" data-add="${d + h * 3600e3}">${os.map((o) => `<button type="button" class="sch-ev" style="--c:${esc(o.st.color || '#f5a524')};top:${(new Date(o.ts).getMinutes() / 60) * 100}%;height:${Math.max(40, (o.dur / 60) * 100)}%" data-occ="${esc(o.sid + '|' + o.key + '|' + o.ts)}">${esc(o.st.name)}<small>${esc(hmOf(o.ts))} · ${o.dur} min${o.moved ? ' · ' + esc(t('sch.movedTag')) : ''}</small></button>`).join('')}</div>`; }
      }
      body = `<div class="sch-grid">${g}</div><p class="muted small">${esc(t('sch.deskHint'))}</p>`;
    }
    root.innerHTML = `<section class="view sch-view">${head}${body}<button type="button" class="sch-fab" id="schAdd">+ ${esc(t('sch.add'))}</button></section>`;
  };
  root.addEventListener('click', async (e) => {
    const w = e.target.closest('[data-w]'); if (w) { wk = w.dataset.w === '0' ? 0 : wk + Number(w.dataset.w); await draw(); return; }
    const d = e.target.closest('[data-day]'); if (d) { sel = Number(d.dataset.day); await draw(); return; }
    const o = e.target.closest('[data-occ]');
    if (o) { const [sid, key, ts] = o.dataset.occ.split('|'); const st = await T.getStudent(sid); if (!st) return; const oc = occurrences(st, Number(ts) - 1, Number(ts) + 1)[0] || { ts: Number(ts), key, slot: !!st.slot, dur: 45 }; await occFlow(oc, st, draw); return; }
    if (e.target.closest('#schAdd') || e.target.closest('[data-add]')) {
      const sts = await T.getStudents(); if (!sts.length) { toast(t('tch.emptyBody')); return; }
      const id = sts.length === 1 ? sts[0].id : await dialog({ title: t('sch.whoT'), className: 'dlg-stack', buttons: [...sts.map((s) => ({ label: s.name + (s.slot ? ' · ' + DOWS()[cleanSlot(s.slot).dow] + ' ' + cleanSlot(s.slot).hm : ''), value: s.id })), { label: t('common.cancel'), value: null, kind: 'ghost' }] });
      if (id && await slotFlow(id)) await draw();
    }
  });
  await draw();
}
