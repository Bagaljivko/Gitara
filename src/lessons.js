// v2.4.2: časovi i komunikacija nastavnik ↔ učenik (bez poruka; isti put kao pesme: sanduče i fajl napretka).
// Nastavnik → učenik (sanduče): beleška sa časa (šta smo radili + domaći), sledeći čas, podsetnik za vežbanje.
// Učenik → nastavnik (fajl napretka, „out“): brz odgovor (👍 / ✔ vežbaću / ❓ ne razumem) i „viđeno“.
// Nastavnik vidi stanje svega što je poslao: viđeno i odgovor, bez ijedne poruke.
import { t } from './i18n.js';
import { esc, toast, dialog } from './ui.js';

const TM = () => import('./teach.js');
const BX = () => import('./teachBox.js');
const clip = (s, k) => String(s || '').trim().slice(0, k);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const REACTS = [['like', '👍'], ['ok', '✔'], ['q', '❓']];
const REACT_IC = Object.fromEntries(REACTS);

// ---------------- datumi ----------------
const DAYS = () => t('les.days').split(',');
export function lessonWhen(ts) {
  const d = new Date(ts), now = new Date();
  const day0 = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day0(d) - day0(now)) / 864e5);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const day = diff === 0 ? t('les.today') : diff === 1 ? t('les.tomorrow') : `${DAYS()[(d.getDay() + 6) % 7]} ${d.getDate()}. ${d.getMonth() + 1}.`;
  return t('les.at', { day, hm });
}
const dShort = (ts) => { const d = new Date(ts); return `${d.getDate()}. ${d.getMonth() + 1}.`; };
const localInput = (ts) => { const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

// ================= nastavnik =================
/** Pošalji stavku u sanduče i zapamti je u „poslato“ (za viđeno/odgovor). */
async function put(sid, item) {
  const B = await BX(); const tm = await TM(); const st = await tm.getStudent(sid);
  if (!st) return false;
  if (!(st.box && st.box.f)) { toast(t('les.noBox', { name: st.name }), 'error'); return false; }
  const ok = await B.boxPut(sid, [item]);
  if (!ok) { toast(t('box.failed'), 'error'); return false; }
  return true;
}

/** Beleška sa časa: šta smo radili + domaći (dijalog). */
export async function noteFlow(sid, edit = null) {
  const tm = await TM(); const st = await tm.getStudent(sid); if (!st) return false;
  const p = dialog({ title: t('les.noteT', { name: st.name }), html: true, className: 'tch-dlg les-dlg', body: `
    <label class="tch-lab">${t('les.did')}</label><textarea id="lnDid" rows="3" maxlength="600" placeholder="${esc(t('les.didPh'))}">${esc(edit ? edit.did : '')}</textarea>
    <label class="tch-lab">${t('les.hw')}</label><textarea id="lnHw" rows="3" maxlength="600" placeholder="${esc(t('les.hwPh'))}">${esc(edit ? edit.hw : '')}</textarea>
    <p class="tch-lock">🔒 ${esc(t('les.noteLock', { name: st.name }))}</p>`,
  buttons: [{ label: t('common.cancel'), value: null }, { label: t('les.send'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  setTimeout(() => box.querySelector('#lnDid')?.focus(), 50);
  const val = { did: edit ? edit.did : '', hw: edit ? edit.hw : '' };
  box.querySelector('#lnDid').addEventListener('input', (e) => (val.did = e.target.value));
  box.querySelector('#lnHw').addEventListener('input', (e) => (val.hw = e.target.value));
  if ((await p) !== 'ok') return false;
  const did = clip(val.did, 600), hw = clip(val.hw, 600);
  if (!did && !hw) return false;
  const n = { id: edit ? edit.id : uid(), at: edit ? edit.at : Date.now(), did, hw };
  const notes = [n, ...((st.notes || []).filter((x) => x.id !== n.id))].sort((a, b) => b.at - a.at).slice(0, 40);
  await tm.updateStudent(sid, { notes });
  if (await put(sid, { key: 'note:' + n.id, kind: 'note', id: n.id, did, hw, name: t('les.noteName', { d: dShort(n.at) }) })) toast(t('les.noteSent', { name: st.name }));
  return true;
}

/** Sledeći čas (datum i vreme) — oboje vide, podsetnik dan ranije. */
export async function nextFlow(sid) {
  const tm = await TM(); const st = await tm.getStudent(sid); if (!st) return false;
  const def = st.next && st.next > Date.now() ? st.next : (() => { const d = new Date(Date.now() + 7 * 864e5); d.setMinutes(0, 0, 0); return d.getTime(); })();
  const p = dialog({ title: t('les.nextT', { name: st.name }), html: true, className: 'tch-dlg les-dlg', body: `
    <label class="tch-lab">${t('les.when')}</label><input type="datetime-local" id="lnWhen" value="${localInput(def)}">
    <p class="muted small">${t('les.nextNote')}</p>`,
  buttons: [...(st.next ? [{ label: t('les.clear'), value: 'clr', kind: 'ghost' }] : []), { label: t('common.cancel'), value: null }, { label: t('common.save'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  let v = localInput(def); box.querySelector('#lnWhen').addEventListener('input', (e) => (v = e.target.value));
  const r = await p;
  if (r === 'clr') { await tm.updateStudent(sid, { next: 0 }); await put(sid, { key: 'lesson', kind: 'lesson', next: 0 }); return true; }
  if (r !== 'ok') return false;
  const ts = new Date(v).getTime(); if (!ts || ts < Date.now() - 3600e3) { toast(t('les.badDate')); return false; }
  await tm.updateStudent(sid, { next: ts });
  if (await put(sid, { key: 'lesson', kind: 'lesson', next: ts })) toast(t('les.nextSet', { name: st.name, w: lessonWhen(ts) }));
  return true;
}

/** Podsetnik za vežbanje (jedan po danu po učeniku). */
export async function nudge(sid) {
  const tm = await TM(); const st = await tm.getStudent(sid); if (!st) return false;
  const day = new Date().toISOString().slice(0, 10);
  if (await put(sid, { key: 'nudge:' + day, kind: 'nudge', name: t('les.nudgeName') })) { await tm.updateStudent(sid, { nudged: Date.now() }); toast(t('les.nudged', { name: st.name })); return true; }
  return false;
}

const CAL = '<svg viewBox="0 0 24 24" aria-hidden="true" class="les-cal"><path d="M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zM5 9h14v10H5zm2 2v3h3v-3z"/></svg>';
const KIND_IC = { song: '♪', set: '☰', note: '📝', lesson: CAL, nudge: '🔔', plan: '🗓', ex: '🎯', rp: '🥁', ans: '💬', cmt: '💬' };
/** Status jedne poslate stavke: viđeno / odgovor. */
function statusHTML(st, key) {
  const r = (st.reacts || {})[key], seen = (st.seen || {})[key];
  if (r) return `<em class="les-st les-r" title="${esc(t('les.r.' + r.r))}">${REACT_IC[r.r] || ''} ${esc(t('les.r.' + r.r))}</em>`;
  if (seen) return `<em class="les-st les-seen">✓ ${esc(t('les.seen'))}</em>`;
  return `<em class="les-st les-wait">${esc(t('les.notSeen'))}</em>`;
}

/** Odeljak „Časovi“ na stranici učenika (nastavnik, telefon i računar). */
export async function drawTeacher(box, sid, rerender) {
  if (!box) return;
  const tm = await TM(); const st = await tm.getStudent(sid); if (!st) return;
  const notes = (st.notes || []).slice(0, 3);
  const sent = (st.sent || []).slice(-8).reverse();
  box.innerHTML = `<div class="tch-sec"><span>${t('les.head')}</span></div>
    <div class="set-grp les-grp">
      <button type="button" class="tch-row les-next" data-l="next"><span class="sr-ic">${CAL}</span><span><b>${st.next && st.next > Date.now() - 3600e3 ? esc(lessonWhen(st.next)) : esc(t('les.noNext'))}</b><small>${esc(t('les.nextSub'))}</small></span><span class="sr-chev" aria-hidden="true">›</span></button>
      <button type="button" class="tch-row" data-l="note"><span class="sr-ic">📝</span><span><b>${esc(t('les.addNote'))}</b><small>${esc(t('les.addNoteSub'))}</small></span><span class="sr-chev" aria-hidden="true">›</span></button>
      ${notes.map((n) => `<button type="button" class="tch-row les-note" data-edit="${esc(n.id)}"><span class="sr-ic les-d">${esc(dShort(n.at))}</span><span><b>${esc(n.hw ? t('les.hwShort', { hw: n.hw }) : n.did)}</b>${n.hw && n.did ? `<small>${esc(n.did)}</small>` : ''}</span>${statusHTML(st, 'note:' + n.id)}</button>`).join('')}
    </div>
    ${sent.length ? `<div class="tch-sec"><span>${t('les.sentHead')}</span></div><div class="set-grp les-sent">${sent.map((x) => `<div class="tch-row"><span class="sr-ic">${KIND_IC[x.kind] || '•'}</span><span><b>${esc(x.name || t('les.k.' + x.kind))}</b><small>${esc(dShort(x.at))}</small></span>${statusHTML(st, x.key)}</div>`).join('')}</div>` : ''}`;
  box.onclick = async (e) => {
    const b = e.target.closest('[data-l],[data-edit]'); if (!b) return;
    let changed = false;
    if (b.dataset.l === 'next') changed = await nextFlow(sid);
    else if (b.dataset.l === 'note') changed = await noteFlow(sid);
    else if (b.dataset.edit) { const n = (st.notes || []).find((x) => x.id === b.dataset.edit); if (n) changed = await noteFlow(sid, n); }
    if (changed) (rerender || (() => drawTeacher(box, sid)))();
  };
}

/** „Ko nije vežbao ove nedelje“ (nastavnik): učenici koji dele napredak, a 7+ dana ništa. */
export async function idleStudents() {
  const tm = await TM(); const P = await import('./progress.js'); const A = await import('./activity.js');
  const today = A.dayNum(); const out = [];
  for (const st of await tm.getStudents()) {
    if (!st.prog || !st.prog.fileId) continue;
    const pr = await P.studentProgress(st).catch(() => null); if (!pr || pr.err || pr.gone) continue;
    const last = Number(pr.lastDay) || 0, days = last ? today - last : null; // null = još nije vežbao u aplikaciji
    if (days == null || days >= 7) out.push({ st, days, nudged: st.nudged && Date.now() - st.nudged < 3 * 864e5 });
  }
  return out.sort((a, b) => (b.days ?? 1e4) - (a.days ?? 1e4));
}
export async function drawIdle(box) {
  if (!box) return;
  const list = await idleStudents().catch(() => []);
  if (!list.length || !box.isConnected) { box.innerHTML = ''; return; }
  const tm = await TM();
  box.innerHTML = `<div class="tch-sec"><span>${t('les.idleHead')}</span></div><div class="set-grp les-idle">${list.map(({ st, days, nudged }) => `<div class="tch-row">${tm.avatarHTML(st, 34)}<span><b>${esc(st.name)}</b><small>${esc(days == null ? t('les.idleNever') : t('les.idleDays', { n: days }))}</small></span>${nudged ? `<em class="les-st les-seen">${esc(t('les.nudgedShort'))}</em>` : `<button type="button" class="btn small" data-nudge="${esc(st.id)}">🔔 ${esc(t('les.nudge'))}</button>`}</div>`).join('')}</div>`;
  box.closest('.db-card')?.querySelector('.att > p.muted')?.remove(); // računar: „Sve je u redu“ ne stoji iznad ovog spiska
  box.onclick = async (e) => { const b = e.target.closest('[data-nudge]'); if (b && await nudge(b.dataset.nudge)) drawIdle(box); };
}

/** Nastavnik: stigli su „viđeno“ / odgovor iz učenikovog fajla napretka. Vraća true ako je nešto novo. */
export async function ingestFromStudent(st, o) {
  const tm = await TM(); const cur = (await tm.getStudent(st.id)) || st;
  if (o.type === 'seen' && Array.isArray(o.keys)) {
    const seen = { ...(cur.seen || {}) }; let any = false;
    for (const k of o.keys.slice(0, 40)) { const key = clip(k, 80); if (!seen[key]) { seen[key] = Number(o.at) || Date.now(); any = true; } }
    if (any) await tm.updateStudent(st.id, { seen: Object.fromEntries(Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 200)) });
    return any;
  }
  if (o.type === 'session') { // v2.4.3: učenik poslao pregled vežbanja
    const S = await import('./session.js'); const sum = { min: Math.max(0, Math.min(600, Number(o.min) || 0)), games: (Array.isArray(o.games) ? o.games : []).slice(0, 4).map((g) => ({ id: clip(g.id, 20), n: Number(g.n) || 0, best: Number(g.best) || 0 })), songs: (Array.isArray(o.songs) ? o.songs : []).slice(0, 4).map((x) => clip(x, 60)) };
    await tm.updateStudent(st.id, { sessions: [{ at: Number(o.at) || Date.now(), ...sum }, ...(cur.sessions || [])].slice(0, 14) });
    const N = await import('./notify.js');
    await N.add({ id: st.id + ':' + clip(o.id, 40), who: (String(st.name || '?')[0] || '?').toUpperCase(), c: st.color || '', t: t('ses.nt', { name: st.name, n: sum.min }), s: S.summaryLine(sum), href: '#/ucenik/' + encodeURIComponent(st.id) });
    return true;
  }
  if (o.type === 'react' && o.key && REACT_IC[o.r]) {
    const key = clip(o.key, 80);
    await tm.updateStudent(st.id, { reacts: { ...(cur.reacts || {}), [key]: { r: o.r, at: Number(o.at) || Date.now() } }, seen: { ...(cur.seen || {}), [key]: Number(o.at) || Date.now() } });
    const N = await import('./notify.js');
    await N.add({ id: st.id + ':re:' + key + ':' + o.r, who: (String(st.name || '?')[0] || '?').toUpperCase(), c: st.color || '', t: t('les.nt.' + o.r, { name: st.name }), s: clip(o.title, 80), href: '#/ucenik/' + encodeURIComponent(st.id) });
    return true;
  }
  return false;
}

/** Nastavnik: sutrašnji časovi u zvonce (jednom po času). */
export async function teacherReminders() {
  const tm = await TM(); const N = await import('./notify.js');
  for (const st of await tm.getStudents()) {
    if (!st.next || st.next < Date.now() || st.next - Date.now() > 26 * 3600e3) continue;
    await N.add({ id: 'les:' + st.id + ':' + st.next, who: (String(st.name || '?')[0] || '?').toUpperCase(), c: st.color || '', t: t('les.ntTeacher', { name: st.name, w: lessonWhen(st.next) }), s: t('les.ntTeacherSub'), href: '#/ucenik/' + encodeURIComponent(st.id) });
  }
}

// ================= učenik =================
/** Primi belešku / sledeći čas / podsetnik iz sanduča. Vraća stavku za zvonce ili null. */
export async function receive(it, m) {
  const tm = await TM(); const cur = (await tm.getMyTeacher()) || m;
  if (it.kind === 'note') {
    const n = { id: clip(it.id, 40), at: Number(it.at) || Date.now(), did: clip(it.did, 600), hw: clip(it.hw, 600), key: it.key };
    const notes = [n, ...(cur.notes || []).filter((x) => x.id !== n.id)].sort((a, b) => b.at - a.at).slice(0, 30);
    await tm.setMyTeacher({ ...cur, notes });
    return { t: t('les.ntNote', { t: m.name || t('tch.teacher') }), s: n.hw ? t('les.hwShort', { hw: n.hw }) : n.did };
  }
  if (it.kind === 'lesson') {
    await tm.setMyTeacher({ ...cur, next: Number(it.next) || 0, nextKey: it.key });
    return Number(it.next) ? { t: t('les.ntNext', { t: m.name || t('tch.teacher') }), s: lessonWhen(Number(it.next)) } : null;
  }
  if (it.kind === 'nudge') return { t: t('les.ntNudge', { t: m.name || t('tch.teacher') }), s: t('les.ntNudgeSub'), href: '#/vezbe' };
  return null;
}

/** Učenik: zapamti da je stavku video (šalje se tiho, grupno). */
let seenQ = new Set(), seenT = 0;
export function markSeen(keys) {
  for (const k of [].concat(keys || [])) if (k) seenQ.add(String(k));
  clearTimeout(seenT);
  seenT = setTimeout(flushSeen, 1500);
}
async function flushSeen() {
  if (!seenQ.size) return;
  const tm = await TM(); const m = await tm.getMyTeacher(); if (!m) return;
  const done = new Set(m.seenSent || []);
  const keys = [...seenQ].filter((k) => !done.has(k)); seenQ = new Set();
  if (!keys.length) return;
  await tm.setMyTeacher({ ...m, seenSent: [...done, ...keys].slice(-300) });
  const B = await BX();
  await B.outPush({ type: 'seen', id: 'seen:' + uid(), keys }, { interactive: false }).catch(() => false);
}

/** Učenik: brz odgovor nastavniku na stavku. */
export async function react(key, r, title = '') {
  const tm = await TM(); const m = await tm.getMyTeacher(); if (!m) return false;
  const B = await BX();
  const ok = await B.outPush({ type: 'react', id: 're:' + key + ':' + r, key, r, title: clip(title, 80) }).catch(() => false);
  await tm.setMyTeacher({ ...((await tm.getMyTeacher()) || m), myReacts: { ...(m.myReacts || {}), [key]: r } });
  toast(ok ? t('les.reactSent', { t: m.name || t('tch.teacher') }) : t('les.reactLater'));
  return true;
}
/** Dugmad za brz odgovor (HTML). */
export function reactsHTML(key, title, chosen = '') {
  return `<div class="les-reacts" role="group" aria-label="${esc(t('les.replyTo'))}">${REACTS.map(([r, ic]) => `<button type="button" class="les-rb${chosen === r ? ' on' : ''}" data-react="${r}" data-key="${esc(key)}" data-title="${esc(title)}" aria-pressed="${chosen === r}">${ic} <span>${esc(t('les.r.' + r))}</span></button>`).join('')}</div>`;
}
export function bindReacts(root, after) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-react]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    await react(b.dataset.key, b.dataset.react, b.dataset.title);
    b.closest('.les-reacts')?.querySelectorAll('.les-rb').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
    after && after();
  });
}

/** Kartica za učenika: sledeći čas + poslednja beleška (domaći) + brz odgovor. */
export async function studentCardHTML(m) {
  const n = (m.notes || [])[0];
  const next = m.next && m.next > Date.now() - 3600e3 ? m.next : 0;
  if (!n && !next) return '';
  return `<div class="card les-card">
    ${next ? `<div class="les-row"><span class="les-ic">${CAL}</span><span><small>${esc(t('les.nextLesson'))}</small><b>${esc(lessonWhen(next))}</b></span></div>` : ''}
    ${n ? `<div class="les-row les-hw"><span class="les-ic">📝</span><span><small>${esc(t('les.fromLesson', { d: dShort(n.at) }))}</small>${n.hw ? `<b>${esc(t('les.hwShort', { hw: n.hw }))}</b>` : ''}${n.did ? `<p>${esc(n.did)}</p>` : ''}</span></div>
    ${reactsHTML(n.key || 'note:' + n.id, n.hw || n.did, (m.myReacts || {})[n.key || 'note:' + n.id])}` : ''}
  </div>`;
}
export async function drawStudent(box) {
  if (!box) return;
  const tm = await TM(); const m = await tm.getMyTeacher(); if (!m) { box.innerHTML = ''; return; }
  box.innerHTML = await studentCardHTML(m);
  if (!box.dataset.bound) { box.dataset.bound = '1'; bindReacts(box); }
  const keys = [(m.notes || [])[0] && ((m.notes[0].key) || 'note:' + m.notes[0].id), m.next ? m.nextKey || 'lesson' : ''].filter(Boolean);
  if (keys.length) markSeen(keys);
}

/** Učenik: podsetnik dan pre časa (jednom). */
export async function studentReminder() {
  const tm = await TM(); const m = await tm.getMyTeacher();
  if (!m || !m.next || m.next < Date.now() || m.next - Date.now() > 26 * 3600e3) return;
  const N = await import('./notify.js');
  await N.add({ id: 'les:me:' + m.next, who: (String(m.name || 'M')[0] || 'M').toUpperCase(), c: '#f5a524', t: t('les.ntSoon', { w: lessonWhen(m.next) }), s: (m.notes || [])[0]?.hw ? t('les.hwShort', { hw: m.notes[0].hw }) : t('les.ntSoonSub'), href: '#/od-nastavnika' });
}
