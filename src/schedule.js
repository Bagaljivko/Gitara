// v2.4.24: raspored časova. Učenik (kod nastavnika) ima redovan termin: slot = { dow (0=pon..6=ned), hm 'HH:MM', dur (min),
// every (1 = svake nedelje, 2 = na dve nedelje, 0 = samo jednom), from (dan početka, ms), off: {datum: 1} (otkazano),
// moved: {datum: ms} (pomereno) }. „Sledeći čas“ (st.next) se računa sam iz termina i šalje učeniku (kao i ranije).
// Raspored (#/raspored): nedelja — telefon: dani i lista; računar: mreža po satima. Rođendani i godišnjice na svom danu.
// „Dodaj u kalendar“: Google kalendar (popunjen događaj) ili .ics fajl (v2.5.61) — telefon podseća i kad je aplikacija zatvorena.
// v2.5.4 (Mile): uz stalni termin i drugi stalni termin (slots2: [slot…], npr. ponedeljak i četvrtak) i dodatni čas samo jednom
// (extra: [{ ts, dur }]) — stalni termin ostaje. Dodavanje časa učeniku koji već ima termin pita šta je.
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
export const slotsOf = (st) => [cleanSlot(st.slot), ...(Array.isArray(st.slots2) ? st.slots2 : []).map(cleanSlot)].map((x, si) => (x ? { ...x, si } : null)).filter(Boolean);
export const cleanExtra = (list) => (Array.isArray(list) ? list : []).filter((x) => x && Number(x.ts) > 0).map((x) => ({ ts: Number(x.ts), dur: Math.max(15, Math.min(240, Math.round(Number(x.dur) || 45))) })).sort((a, b) => a.ts - b.ts).slice(-60);
export function occurrences(st, fromMs, toMs, { withOff = false } = {}) { // v2.4.32: withOff — i otkazani (za dolaske)
  const out = [];
  for (const s of slotsOf(st)) { const sk = (k) => (s.si ? k + '#' + s.si : k);
    // prvi termin: prvi dan „dow“ od s.from
    let first = s.from; while ((new Date(first).getDay() + 6) % 7 !== s.dow) first += DAY;
    const step = s.every === 2 ? 14 : 7;
    const lastDay = s.every === 0 ? first : toMs + 14 * DAY;
    for (let d = first; d <= lastDay; d = day0(d + step * DAY + 3 * 3600e3)) {
      const k = dkey(d);
      if (s.off[k]) { if (withOff) { const ts0 = atHm(d, s.hm); if (ts0 >= fromMs && ts0 < toMs) out.push({ ts: ts0, dur: s.dur, sid: st.id, key: sk(k), moved: false, slot: true, si: s.si, dk: k, off: true }); } if (s.every === 0) break; continue; }
      const ts = Number(s.moved[k]) || atHm(d, s.hm);
      if (ts >= fromMs && ts < toMs) out.push({ ts, dur: s.dur, sid: st.id, key: sk(k), moved: !!s.moved[k], slot: true, si: s.si, dk: k });
      if (s.every === 0) break;
    }
  }
  for (const x of cleanExtra(st.extra)) if (x.ts >= fromMs && x.ts < toMs) out.push({ ts: x.ts, dur: x.dur, sid: st.id, key: dkey(x.ts) + '+' + hmOf(x.ts), moved: false, slot: false, extra: true, xts: x.ts }); // dodatni čas
  if (!st.slot && st.next && st.next >= fromMs && st.next < toMs && !out.some((o) => o.ts === st.next)) out.push({ ts: st.next, dur: 45, sid: st.id, key: dkey(st.next), moved: false, slot: false });
  return out.sort((a, b) => a.ts - b.ts);
}
/** Sledeći čas (posle sada − 1 h). */
export function nextOf(st, now = Date.now()) { const o = occurrences(st, now - 3600e3, now + 120 * DAY)[0]; return o ? o.ts : 0; }

/** Nastavnik: osveži „Sledeći čas“ svim učenicima sa terminom; ako se promenio — pošalji učeniku (tiho). */
export async function refreshNext({ only = null } = {}) {
  const T = await import('./teach.js'); const B = await import('./teachBox.js');
  for (const st of await T.getStudents()) {
    if (only && st.id !== only) continue;
    if (!st.slot && !cleanExtra(st.extra).length) continue;
    const nx = nextOf(st);
    if (nx === (st.next || 0)) continue;
    await T.updateStudent(st.id, { next: nx });
    const o = occurrences(st, nx - 1, nx + 1)[0] || {}; // dodatni čas → bez „svake nedelje“
    const s = o.extra ? { dur: o.dur, every: 0 } : (slotsOf(st).find((x) => x.si === (o.si || 0)) || cleanSlot(st.slot) || { dur: 45, every: 0 });
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

// v2.5.61: „Dodaj u kalendar“ → Google kalendar (otvara se popunjen događaj — naslov, vreme, trajanje, ponavljanje; samo
// „Sačuvaj“; bez novih dozvola) ili „Drugi kalendar“ (.ics za Apple, Outlook…). Ništa se ne čuva u aplikaciji.
export function gcalUrl({ title, start, dur, every = 0, details = '' }) {
  let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
  const q = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${icsDate(start)}/${icsDate(start + dur * 60000)}` });
  if (details) q.set('details', details);
  if (every) q.set('recur', `RRULE:FREQ=WEEKLY;INTERVAL=${every}`);
  if (tz) q.set('ctz', tz);
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}
/** Izbor kalendara za jedan čas (ev: { title, start, dur, every, uid }, file: ime .ics fajla). */
export async function calFlow(ev, file) {
  const L = await import('./lessons.js');
  const when = [L.lessonWhen(ev.start), ev.dur + ' min', ev.every === 2 ? t('sch.r2') : ev.every === 1 ? t('sch.r1') : ''].filter(Boolean).join(' · ');
  const url = gcalUrl({ ...ev, details: t('sch.calDetails') });
  const row = (k, ic, b, sub, href) => `<${href ? `a href="${esc(href)}" target="_blank" rel="noopener"` : 'button type="button"'} class="tch-row" data-cal="${k}"><span class="sr-ic" aria-hidden="true">${ic}</span><span><b>${esc(b)}</b><small>${esc(sub)}</small></span><span class="chev" aria-hidden="true">›</span></${href ? 'a' : 'button'}>`;
  const p = dialog({ title: t('sch.calT'), html: true, className: 'tch-dlg cal-dlg', buttons: [], body: `<p class="small muted">${esc(ev.title)}<br>${esc(when)}</p>
    <div class="set-grp">${row('g', '📅', t('sch.gcal'), t('sch.gcalSub'), url)}${row('ics', '📥', t('sch.icsOpt'), t('sch.icsOptSub'))}</div>` });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  box.addEventListener('click', (e) => {
    const r = e.target.closest('[data-cal]'); if (!r) return;
    if (r.dataset.cal === 'ics') downloadIcs(file, icsFor(ev));
    setTimeout(() => box.__close && box.__close(), 0); // link se otvara, pa se prozor zatvara
  });
  return p;
}

// ---------------- nastavnik: redovan termin ----------------
const DOWS = () => (getLang() === 'en' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub', 'Ned']);
const isoDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** Termin učenika (dan, vreme, trajanje, ponavljanje). Čuva, osveži sledeći čas i javi učeniku. */
/** v2.5.4: „+ Čas“ / dodir u rasporedu / „Sledeći čas“: učenik bez termina → stalni termin (kao ranije); sa terminom → pitanje. */
export async function addFlow(sid, at = 0) {
  const T = await import('./teach.js'); const st = await T.getStudent(sid); if (!st) return false;
  const slots = slotsOf(st);
  if (!slots.length) return slotFlow(sid, { at });
  const desc = slots.map((x) => `${DOWS()[x.dow].toLowerCase()} ${x.hm}`).join(', ');
  const opt = (k, ic, b, sub, on) => `<button type="button" class="tch-opt${on ? ' on' : ''}" data-k="${k}" role="radio" aria-checked="${on}"><span class="tch-opt-ic" aria-hidden="true">${ic}</span><span><b>${esc(b)}</b><small>${esc(sub)}</small></span></button>`;
  let pick = 'x';
  const p = dialog({ title: t('sch.newT', { name: st.name }), html: true, className: 'tch-dlg', body: `<p class="small muted">${esc(t('sch.hasSlot', { name: st.name, w: desc }))}</p><div class="tch-opts sch-pick" role="radiogroup">
    ${opt('x', '＋', t('sch.extraOpt'), t('sch.extraOptSub'), true)}${slots.length < 3 ? opt('s', '↻', t('sch.secondOpt'), t('sch.secondOptSub'), false) : ''}${opt('c', '✎', t('sch.changeOpt'), t('sch.changeOptSub', { w: desc }), false)}</div>`,
  buttons: [{ label: t('common.cancel'), value: null }, { label: t('sch.nextBtn'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  box.querySelector('.sch-pick').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; pick = b.dataset.k; box.querySelectorAll('.sch-pick [data-k]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }); });
  if ((await p) !== 'ok') return false;
  if (pick === 'x') return extraFlow(sid, at);
  if (pick === 's') return slotFlow(sid, { si: 'new', at });
  return slotFlow(sid, { at: 0 });
}
/** Dodatni čas — samo jednom; stalni termin ostaje. */
export async function extraFlow(sid, at = 0) {
  const T = await import('./teach.js'); const L = await import('./lessons.js'); const st = await T.getStudent(sid); if (!st) return false;
  const base = at > Date.now() ? at : (() => { const d = new Date(Date.now() + DAY); d.setHours(17, 0, 0, 0); return d.getTime(); })();
  const slot0 = cleanSlot(st.slot);
  const p2 = (n) => String(n).padStart(2, '0'); const bd = new Date(base);
  const p = dialog({ title: t('sch.extraT', { name: st.name }), html: true, className: 'tch-dlg sch-dlg', body: `
    <p class="muted small">${esc(slot0 ? t('sch.extraSub', { w: `${DOWS()[slot0.dow].toLowerCase()} ${slot0.hm}` }) : t('sch.extraSub0'))}</p>
    <div class="sch-3"><div><label class="tch-lab">${t('sch.day')}</label><input type="date" id="schXd" value="${bd.getFullYear()}-${p2(bd.getMonth() + 1)}-${p2(bd.getDate())}"></div>
      <div><label class="tch-lab">${t('sch.start')}</label><input type="time" id="schXt" value="${p2(bd.getHours())}:${p2(bd.getMinutes())}"></div></div>
    <label class="tch-lab">${t('sch.dur')}</label><select id="schXdur">${[30, 45, 60, 90].map((m) => `<option value="${m}"${m === (slot0 ? slot0.dur : 45) ? ' selected' : ''}>${m} min</option>`).join('')}</select>
    <label class="switch tch-sw sch-sw"><input type="checkbox" id="schXcal"><span class="switch-track"><span class="switch-thumb"></span></span><span><b>📅 ${t('sch.cal')}</b><small class="muted">${t('sch.calOne')}</small></span></label>
    ${st.box && st.box.f ? `<p class="tch-lock">🔔 ${t('sch.tells', { name: st.name })}</p>` : ''}`,
  buttons: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  if ((await p) !== 'ok') return false;
  const ts = new Date(`${box.querySelector('#schXd').value}T${box.querySelector('#schXt').value || '17:00'}:00`).getTime();
  if (!ts) return false;
  const dur = Number(box.querySelector('#schXdur').value) || 45;
  await T.updateStudent(sid, { extra: cleanExtra([...(st.extra || []).filter((x) => x && x.ts > Date.now() - 120 * DAY), { ts, dur }]) });
  await refreshNext({ only: sid });
  toast(t('sch.extraSaved', { name: st.name, w: L.lessonWhen(ts) }));
  if (box.querySelector('#schXcal').checked) calFlow({ title: t('sch.icsTitle', { name: st.name }), start: ts, dur, every: 0, uid: 'les-x-' + sid + '-' + ts }, t('sch.icsName', { name: st.name }));
  return true;
}
/** Stalni termin. si: 0 = glavni, 1… = drugi (slots2), 'new' = novi drugi termin. at: dan/sat iz dodira u rasporedu. */
export async function slotFlow(sid, { si = 0, at = 0 } = {}) {
  const T = await import('./teach.js'); const st = await T.getStudent(sid); if (!st) return false;
  const isNew = si === 'new', idx = isNew ? (st.slots2 || []).length + 1 : si;
  const existing = idx === 0 ? cleanSlot(st.slot) : isNew ? null : cleanSlot((st.slots2 || [])[idx - 1]);
  const fromAt = at > 0 ? { dow: (new Date(at).getDay() + 6) % 7, hm: hmOf(at).padStart(5, '0'), dur: 45, every: 1, from: day0(Date.now()), off: {}, moved: {} } : null;
  const cur = existing || fromAt || (() => { const b = st.next && st.next > Date.now() ? st.next : Date.now() + 7 * DAY; return { dow: (new Date(b).getDay() + 6) % 7, hm: st.next ? hmOf(st.next).padStart(5, '0') : '17:00', dur: 45, every: 1, from: day0(Date.now()), off: {}, moved: {} }; })();
  const v = { ...cur, cal: false };
  const p = dialog({ title: isNew || idx > 0 ? t('sch.slot2T', { name: st.name }) : t('sch.slotT', { name: st.name }), html: true, className: 'tch-dlg sch-dlg', body: `
    <p class="muted small">${t('sch.slotSub')}</p>
    <label class="tch-lab">${t('sch.day')}</label><div class="sch-days" role="radiogroup">${DOWS().map((d, i) => `<button type="button" role="radio" aria-checked="${i === v.dow}" class="${i === v.dow ? 'on' : ''}" data-dow="${i}">${esc(d)}</button>`).join('')}</div>
    <div class="sch-3"><div><label class="tch-lab">${t('sch.start')}</label><input type="time" id="schHm" value="${esc(v.hm.padStart(5, '0'))}"></div>
      <div><label class="tch-lab">${t('sch.dur')}</label><select id="schDur">${[30, 45, 60, 90].map((m) => `<option value="${m}"${m === v.dur ? ' selected' : ''}>${m} min</option>`).join('')}</select></div></div>
    <label class="tch-lab">${t('sch.from')}</label><input type="date" id="schFrom" value="${isoDay(v.from)}">
    <label class="tch-lab">${t('sch.repeat')}</label><div class="sch-seg">${[[1, 'sch.r1'], [2, 'sch.r2'], [0, 'sch.r0']].map(([k, l]) => `<button type="button" class="${v.every === k ? 'on' : ''}" data-ev="${k}">${esc(t(l))}</button>`).join('')}</div>
    <label class="switch tch-sw sch-sw"><input type="checkbox" id="schCal"><span class="switch-track"><span class="switch-thumb"></span></span><span><b>📅 ${t('sch.cal')}</b><small class="muted">${t('sch.calSub')}</small></span></label>
    ${st.box && st.box.f ? `<p class="tch-lock">🔔 ${t('sch.tells', { name: st.name })}</p>` : `<p class="tch-lock">${t('sch.notConn', { name: st.name })}</p>`}`,
  buttons: [...(existing ? [{ label: t('sch.remove'), value: 'rm', kind: 'ghost' }] : []), { label: t('common.cancel'), value: null }, { label: t('common.save'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  box.addEventListener('click', (e) => {
    const d = e.target.closest('[data-dow]'); if (d) { v.dow = Number(d.dataset.dow); box.querySelectorAll('[data-dow]').forEach((x) => { const on = x === d; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); }); }
    const r = e.target.closest('[data-ev]'); if (r) { v.every = Number(r.dataset.ev); box.querySelectorAll('[data-ev]').forEach((x) => x.classList.toggle('on', x === r)); }
  });
  const res = await p;
  if (res === 'rm' && (idx > 0 || (st.slots2 || []).length)) { // drugi termin (ili glavni kad postoji drugi — drugi postaje glavni)
    const rest = (st.slots2 || []).slice(); let main = st.slot;
    if (idx > 0) rest.splice(idx - 1, 1); else main = rest.shift();
    await T.updateStudent(sid, { slot: main, slots2: rest, next: -1 }); await refreshNext({ only: sid }); toast(t('sch.removed')); return true;
  }
  if (res === 'rm') { await T.updateStudent(sid, { slot: null, next: 0 }); if (st.box && st.box.f) await (await import('./teachBox.js')).boxPut(sid, [{ key: 'lesson', kind: 'lesson', next: 0, at: Date.now() }]).catch(() => {}); toast(t('sch.removed')); return true; }
  if (res !== 'ok') return false;
  const q = (id) => box.querySelector('#' + id);
  const from = q('schFrom').value ? day0(new Date(q('schFrom').value + 'T12:00:00').getTime()) : day0(Date.now());
  const slot = cleanSlot({ dow: v.dow, hm: q('schHm').value || '17:00', dur: Number(q('schDur').value) || 45, every: v.every, from, off: {}, moved: {} });
  if (idx > 0) { const rest = (st.slots2 || []).slice(); rest[idx - 1] = slot; await T.updateStudent(sid, { slots2: rest, next: -1 }); }
  else await T.updateStudent(sid, { slot, next: -1 }); // -1: sledeći čas se sigurno preračuna i pošalje
  await refreshNext({ only: sid });
  const nx = nextOf(await T.getStudent(sid));
  const L = await import('./lessons.js');
  toast(nx ? t('sch.saved', { name: st.name, w: L.lessonWhen(nx) }) : t('sch.savedNone'));
  if (q('schCal').checked && nx) calFlow({ title: t('sch.icsTitle', { name: st.name }), start: nx, dur: slot.dur, every: slot.every, uid: 'les-' + sid }, t('sch.icsName', { name: st.name }));
  return true;
}

/** Pomeri ili otkaži jedan čas. */
async function setSlotPart(T, st, si, fn) {
  if (!si) { const s = cleanSlot(st.slot); fn(s); return T.updateStudent(st.id, { slot: s }); }
  const rest = (st.slots2 || []).slice(); const s = cleanSlot(rest[si - 1]); if (!s) return null; fn(s); rest[si - 1] = s; return T.updateStudent(st.id, { slots2: rest });
}
async function occFlow(o, st, redraw) {
  const T = await import('./teach.js'); const L = await import('./lessons.js');
  const past = o.ts + (o.dur || 45) * 60000 <= Date.now(); // v2.4.32: prošao čas — da li je bio
  const v = await dialog({ title: `${st.name} · ${L.lessonWhen(o.ts)}`, className: 'dlg-stack', buttons: [
    ...(past ? [{ label: '✓ ' + t('att.y1'), value: 'att:y', kind: 'primary' }, { label: '✗ ' + t('att.n1'), value: 'att:n' }] : []),
    { label: t('sch.openSt'), value: 'open' }, ...(past ? [] : [{ label: t('sch.move'), value: 'mv' }, { label: t('sch.cancelOne'), value: 'x', kind: 'danger' }]), { label: t('common.close'), value: null, kind: 'ghost' }] });
  if (v === 'open') { location.hash = '#/ucenik/' + encodeURIComponent(st.id); return; }
  if (v && v.startsWith('att:')) { await (await import('./attendance.js')).setMark(st.id, o.key, v.slice(4), o.slot && !o.si ? 0 : o.ts); toast(t('att.saved')); redraw(); return; }
  if (v === 'mv') {
    const loc = (ms) => { const d = new Date(ms); const p2 = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };
    const pp = dialog({ title: t('sch.move'), html: true, className: 'tch-dlg', body: `<label class="tch-lab">${t('les.when')}</label><input type="datetime-local" id="schMv" value="${loc(o.ts)}">`, buttons: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), value: 'ok', kind: 'primary' }] });
    const b = [...document.querySelectorAll('.modal-backdrop')].pop();
    if ((await pp) !== 'ok') return;
    const ts = new Date(b.querySelector('#schMv').value).getTime(); if (!ts) return;
    if (o.extra) await T.updateStudent(st.id, { extra: cleanExtra((st.extra || []).map((x) => (x && Number(x.ts) === o.xts ? { ...x, ts } : x))) });
    else if (o.slot) await setSlotPart(T, st, o.si, (s) => { s.moved[o.dk] = ts; });
    else await T.updateStudent(st.id, { next: ts, slot: null });
    toast(t('sch.moved', { name: st.name, w: L.lessonWhen(ts) }));
  } else if (v === 'x') {
    if (o.extra) { const left = cleanExtra((st.extra || []).filter((x) => !(x && Number(x.ts) === o.xts))); await T.updateStudent(st.id, { extra: left, ...(st.slot || left.length ? {} : { next: 0 }) }); }
    else if (o.slot) await setSlotPart(T, st, o.si, (s) => { s.off[o.dk] = 1; });
    else await T.updateStudent(st.id, { next: 0 });
    toast(t('sch.cancelled', { name: st.name }));
  } else return;
  const now = await T.getStudent(st.id);
  if (now && (now.slot || cleanExtra(now.extra).length)) await refreshNext({ only: st.id });
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
    const card = (o) => `<button type="button" class="sch-c${o.ts <= Date.now() && o.ts + o.dur * 60000 > Date.now() ? ' now' : ''}${o.ts + o.dur * 60000 <= Date.now() ? ' past' : ''}" style="--c:${esc(o.st.color || '#f5a524')}" data-occ="${esc(o.sid + '|' + o.key + '|' + o.ts)}">${T.avatarHTML(o.st, 36)}<span><b>${esc(o.st.name)}</b><small>${esc([o.extra ? t('sch.extraTag') : '', o.moved ? t('sch.movedTag') : '', o.extra ? '' : o.slot ? t(((slotsOf(o.st).find((x) => x.si === (o.si || 0)) || {}).every) === 2 ? 'sch.r2' : ((slotsOf(o.st).find((x) => x.si === (o.si || 0)) || {}).every) === 0 ? 'sch.r0' : 'sch.r1') : t('sch.r0'), (o.st.notes || [])[0]?.hw ? t('les.hwShort', { hw: o.st.notes[0].hw }) : ''].filter(Boolean).join(' · '))}</small></span>${o.ts > Date.now() && o.ts - Date.now() < 3 * 3600e3 ? `<em class="sch-tag">${esc(inTxt(o.ts - Date.now()))}</em>` : o.ts + o.dur * 60000 <= Date.now() ? `<em class="sch-tag ok">✓</em>` : ''}</button>`;
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
        for (const d of cols) { const os = occ.filter((o) => day0(o.ts) === d && new Date(o.ts).getHours() === h); g += `<div class="sch-gc" data-add="${d + h * 3600e3}">${os.map((o) => `<button type="button" class="sch-ev" style="--c:${esc(o.st.color || '#f5a524')};top:${(new Date(o.ts).getMinutes() / 60) * 100}%;height:${Math.max(40, (o.dur / 60) * 100)}%" data-occ="${esc(o.sid + '|' + o.key + '|' + o.ts)}">${esc(o.st.name)}<small>${esc(hmOf(o.ts))} · ${o.dur} min${o.moved ? ' · ' + esc(t('sch.movedTag')) : ''}${o.extra ? ' · ' + esc(t('sch.extraTag')) : ''}</small></button>`).join('')}</div>`; }
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
      const cell = e.target.closest('[data-add]'); const at = cell ? Number(cell.dataset.add) : 0;
      if (id && await addFlow(id, at)) await draw();
    }
  });
  await draw();
}
