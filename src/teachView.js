// v1.78: ekrani Nastave — Učenici (#/ucenici), učenik (#/ucenik/<id>), Od nastavnika (#/od-nastavnika, kod učenika),
// slanje učenicima (jednom ili više — svako dobija svoju poruku, ne vide jedni druge) i nastavniku, prihvatanje pozivnice.
import { t, songsCount } from './i18n.js';
import { esc, dialog, toast } from './ui.js';
import { songs as db } from './db.js';
import * as T from './teach.js';

const CHEV = '<span class="chev" aria-hidden="true">›</span>';
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M4 6h12v2H4zm0 5h12v2H4zm0 5h8v2H4zm14-2v-4h-2v4h-4v2h4v4h2v-4h4v-2z"/></svg>',
  song: '<svg viewBox="0 0 24 24"><path d="M12 3v10.6A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>',
};
const ic = (k) => `<span class="sr-ic">${ICON[k]}</span>`;
const day = (ts) => { if (!ts) return ''; const d = Math.floor((Date.now() - ts) / 864e5); return d <= 0 ? t('st.today') : d === 1 ? t('st.yesterday') : t('st.daysAgo', { n: d }); };
const when = (ts) => { const d = new Date(ts || Date.now()); const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; const a = Math.floor((Date.now() - ts) / 864e5); return a <= 0 ? t('tch.todayAt', { hm }) : a === 1 ? t('tch.yesterdayAt', { hm }) : `${d.getDate()}. ${d.getMonth() + 1}. ${hm}`; };
const dur = (ms) => { const s = Math.round((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

async function setlistsOf(id) { const c = await import('./collections.js'); return (await c.getSetlists()).filter((sl) => (sl.students || []).includes(id)); }
async function recsOf(id) { return (await db.all()).filter((s) => s.student === id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); }

// ---------------- Učenici ----------------
export async function renderStudents(root) {
  const list = await T.getStudents();
  const all = await db.list();
  const c = await import('./collections.js');
  const sets = await c.getSetlists();
  const meta = (s) => {
    const recs = all.filter((x) => x.student === s.id);
    const last = Math.max(0, ...recs.map((x) => x.createdAt || 0));
    const nSets = sets.filter((sl) => (sl.students || []).includes(s.id)).length;
    return [recs.length ? t('tch.nRecs', { n: recs.length }) : '', nSets ? t('tch.nSets', { n: nSets }) : '', last ? day(last) : ''].filter(Boolean).join(' · ') || t('tch.nothingYet');
  };
  root.innerHTML = `<section class="view tch-view">
    <a class="back tch-back" href="#/pesme">‹ ${t('lib.title')}</a>
    <header class="view-head tch-head"><h1>${t('tch.students')}</h1><button class="btn small" id="tAdd">+ ${t('tch.student')}</button></header>
    ${list.length ? `<div class="set-grp">${list.map((s) => `<a class="tch-row" href="#/ucenik/${encodeURIComponent(s.id)}">${T.avatarHTML(s)}<span><b>${esc(s.name)}</b><small>${esc(meta(s))}</small></span>${CHEV}</a>`).join('')}</div>`
      : `<div class="card tch-empty"><p>${t('tch.emptyBody')}</p></div>`}
    <p class="tch-lock">🔒 ${t('tch.lockList')}</p>
  </section>`;
  root.querySelector('#tAdd').addEventListener('click', async () => { const s = await addStudentFlow(); if (s) location.hash = '#/ucenik/' + encodeURIComponent(s.id); });
}

/** „Nov učenik“: ime, opcioni imejl/telefon, „Pošalji pozivnicu“. */
export async function addStudentFlow(edit = null) {
  const sw = `<label class="switch tch-sw"><input type="checkbox" id="tInv"${edit ? '' : ' checked'}><span class="switch-track"><span class="switch-thumb"></span></span><span><b>${t('tch.invite')}</b><small class="muted">${t('tch.inviteSub')}</small></span></label>`;
  const p = dialog({ title: edit ? t('tch.editStudent') : t('tch.newStudent'), html: true, className: 'tch-dlg', body: `
    <label class="tch-lab">${t('tch.name')}</label><input id="tName" maxlength="60" value="${esc(edit?.name || '')}" autocomplete="off">
    <label class="tch-lab">${t('tch.contact')} <span class="muted">${t('tch.optional')}</span></label>
    <small class="muted tch-hint">${t('tch.contactWhy')}</small>
    <input id="tContact" maxlength="120" value="${esc(edit?.contact || '')}" autocomplete="off" inputmode="email">
    ${edit ? '' : sw}
    <p class="tch-lock">🔒 ${t('tch.lockStudent')}</p>`,
    buttons: [{ label: t('common.cancel'), value: null }, { label: edit ? t('common.save') : t('tch.addStudent'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  const v = { name: edit?.name || '', contact: edit?.contact || '', inv: !edit };
  box.querySelector('#tName').addEventListener('input', (e) => (v.name = e.target.value));
  box.querySelector('#tContact').addEventListener('input', (e) => (v.contact = e.target.value));
  box.querySelector('#tInv')?.addEventListener('change', (e) => (v.inv = e.target.checked));
  setTimeout(() => box.querySelector('#tName')?.focus(), 50);
  if ((await p) !== 'ok') return null;
  if (!v.name.trim()) { toast(t('tch.needName')); return addStudentFlow(edit); }
  if (edit) return T.updateStudent(edit.id, { name: v.name, contact: v.contact });
  const s = await T.addStudent({ name: v.name, contact: v.contact });
  if (v.inv) await T.sendInvite(s);
  return s;
}

// ---------------- jedan učenik ----------------
export async function renderStudent(root, id) {
  const s = await T.getStudent(id);
  if (!s) { location.replace('#/ucenici'); return; }
  const sets = await setlistsOf(id), recs = await recsOf(id);
  root.innerHTML = `<section class="view tch-view">
    <a class="back tch-back" href="#/ucenici">‹ ${t('tch.students')}</a>
    <div class="tch-hero">${T.avatarHTML(s, 56)}<div><h1>${esc(s.name)}</h1><small class="muted">${esc([s.contact, t('tch.since', { d: ((d) => `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}.`)(new Date(s.createdAt || Date.now())) })].filter(Boolean).join(' · '))}</small></div></div>
    <div class="tch-actions"><button class="btn primary" id="tSend">${t('tch.sendTo', { name: s.name })}</button><button class="btn" id="tMore" aria-label="${esc(t('tch.more'))}">⋯</button></div>
    <div class="tch-sec"><span>${t('tch.setlists')}</span><button class="linkish" id="tNewSet">+ ${t('tch.newSet')}</button></div>
    ${sets.length ? `<div class="set-grp">${sets.map((sl) => `<a class="tch-row" href="#/setlista/${encodeURIComponent(sl.id)}">${ic('list')}<span><b>${esc(sl.name)}</b><small>${songsCount((sl.songIds || []).length)}${(sl.sentTo || {})[id] ? ' · ' + t('tch.sentOn', { d: day(sl.sentTo[id]) }) : ''}</small></span>${CHEV}</a>`).join('')}</div>` : `<p class="muted small tch-none">${t('tch.noSets')}</p>`}
    <div class="tch-sec"><span>${t('tch.recs')}</span></div>
    ${recs.length ? `<div class="set-grp">${recs.map((r) => `<a class="tch-row" href="#/pesma/${encodeURIComponent(r.id)}">${ic('play')}<span><b>${esc(when(r.createdAt))}${r.fromStudent ? ` <em class="tch-from">${esc(t('tch.fromName', { name: s.name }))}</em>` : ''}</b><small>${esc([r.recording ? '' : r.title, chordsOf(r), r.recording ? dur(r.recording.dur) : ''].filter(Boolean).join(' · '))}</small></span>${CHEV}</a>`).join('')}</div>` : `<p class="muted small tch-none">${t('tch.noRecs')}</p>`}
  </section>`;
  root.querySelector('#tSend').addEventListener('click', () => sendMenu([s]));
  root.querySelector('#tNewSet').addEventListener('click', async () => {
    const { askName } = await import('./setlistsView.js');
    const name = await askName(t('tch.newSet'), t('tch.forNextLesson'));
    if (!name) return;
    const c = await import('./collections.js');
    const sl = await c.addSetlist(name); await c.updateSetlist(sl.id, { students: [s.id] });
    location.hash = '#/setlista/' + encodeURIComponent(sl.id);
  });
  root.querySelector('#tMore').addEventListener('click', async () => {
    const v = await dialog({ title: s.name, buttons: [{ label: t('tch.editStudent'), value: 'edit' }, { label: t('tch.reinvite'), value: 'inv' }, { label: t('tch.delStudent'), value: 'del', kind: 'danger' }] });
    if (v === 'edit') { await addStudentFlow(s); renderStudent(root, id); }
    if (v === 'inv') await T.sendInvite(s);
    if (v === 'del') {
      const ok = await dialog({ title: t('tch.delTitle', { name: s.name }), body: t('tch.delBody'), buttons: [{ label: t('common.cancel'), value: null }, { label: t('tch.delStudent'), value: 'y', kind: 'danger' }] });
      if (ok === 'y') { await T.removeStudent(s.id); toast(t('tch.deleted')); location.hash = '#/ucenici'; }
    }
  });
}
function chordsOf(song) {
  const seen = [];
  for (const sec of song.sections || []) for (const l of sec.lines || []) for (const c of l.chords || []) { const n = c.chord || c.name || c.c; if (n && !seen.includes(n)) seen.push(n); if (seen.length >= 4) return seen.join(' · '); }
  return seen.join(' · ');
}

// ---------------- slanje učenicima ----------------
/** Šta poslati (pesmu / set listu / snimak) — za jednog ili više učenika. */
export async function sendMenu(students, preset = null) {
  let item = preset;
  if (!item) {
    const v = await dialog({ title: students.length === 1 ? t('tch.sendTo', { name: students[0].name }) : t('tch.sendToN', { n: students.length }), html: true, className: 'tch-dlg',
      body: `<p class="tch-lock">🔒 ${t('tch.lockSend')}</p>`,
      buttons: [{ label: t('tch.what.song'), value: 'song' }, { label: t('tch.what.set'), value: 'set' }, { label: t('tch.what.rec'), value: 'rec' }] });
    if (!v) return;
    item = await pickItem(v, students);
    if (!item) return;
  }
  const S = await import('./shareService.js');
  const res = await S.publishOnly(item.share);
  if (!res) return;
  await sendEach(students, async (st) => {
    const link = res.link + (await T.toStudentSuffix(st));
    const tn = await T.teacherName();
    return { to: st.contact, subject: t('tch.subject', { t: tn || 'MARLI' }), text: t(item.kind === 'set' ? 'tch.msgSet' : item.kind === 'rec' ? 'tch.msgRec' : 'tch.msgSong', { s: st.name, t: tn, name: item.name, n: songsCount(item.n || 1), link }) };
  });
  if (item.onSent) await item.onSent(students);
}
/** Svakom učeniku posebna poruka (jedan dodir po učeniku — telefon traži dodir za svako otvaranje). */
async function sendEach(students, build) {
  if (students.length === 1) {
    const m = await build(students[0]);
    const text = await T.editMessage(t('tch.sendTo', { name: students[0].name }), m.text, t('tch.lockMsg'));
    if (text != null) await T.compose({ ...m, text });
    return;
  }
  const done = new Set();
  const draw = () => students.map((st) => `<div class="tch-row">${T.avatarHTML(st, 34)}<span><b>${esc(st.name)}</b><small>${esc(st.contact || t('tch.noContact'))}</small></span><button class="btn small ${done.has(st.id) ? '' : 'primary'}" data-sid="${esc(st.id)}">${done.has(st.id) ? '✓ ' + t('tch.sent') : t('tch.sendBtn')}</button></div>`).join('');
  const p = dialog({ title: t('tch.sendToN', { n: students.length }), html: true, className: 'tch-dlg', body: `<p class="small muted">${t('tch.eachOwn')}</p><div class="set-grp tch-each">${draw()}</div>`, buttons: [{ label: t('common.close'), value: null }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  box.querySelector('.tch-each').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sid]'); if (!b) return;
    const st = students.find((x) => x.id === b.dataset.sid);
    const m = await build(st);
    if (await T.compose(m)) { done.add(st.id); box.querySelector('.tch-each').innerHTML = draw(); }
  });
  await p;
}
/** Izbor pesme / set liste / snimka (pretraga). */
async function pickItem(kind, students) {
  const S = await import('./shareService.js');
  if (kind === 'set') {
    const c = await import('./collections.js');
    const sets = (await c.getSetlists()).sort((a, b) => ((b.students || []).some((x) => students.some((s) => s.id === x)) ? 1 : 0) - ((a.students || []).some((x) => students.some((s) => s.id === x)) ? 1 : 0));
    const id = await chooseFrom(t('tch.what.set'), sets.map((sl) => ({ id: sl.id, label: sl.name, sub: songsCount((sl.songIds || []).length) })));
    const sl = sets.find((x) => x.id === id); if (!sl) return null;
    const share = await S.setlistItem(sl); if (!share) { toast(t('sl.noSongs'), 'error'); return null; }
    return { kind: 'set', name: sl.name, n: share.songs.length, share, onSent: (sts) => markSent(sl, sts) };
  }
  const all = (await db.list()).filter((s) => !s.demo);
  const { REC_FOLDER } = await import('./collections.js');
  const items = (kind === 'rec' ? all.filter((s) => (s.folders || []).includes(REC_FOLDER)) : all.filter((s) => !(s.folders || []).includes(REC_FOLDER))).sort((a, b) => (kind === 'rec' ? (b.createdAt || 0) - (a.createdAt || 0) : a.title.localeCompare(b.title)));
  const id = await chooseFrom(t(kind === 'rec' ? 'tch.what.rec' : 'tch.what.song'), items.map((s) => ({ id: s.id, label: s.title, sub: s.artist || '' })));
  if (!id) return null;
  const song = await db.get(id);
  return { kind, name: song.title, share: S.songItem(song) };
}
async function markSent(sl, students) {
  const c = await import('./collections.js');
  const sentTo = { ...(sl.sentTo || {}) }; students.forEach((s) => (sentTo[s.id] = Date.now()));
  await c.updateSetlist(sl.id, { sentTo, students: [...new Set([...(sl.students || []), ...students.map((s) => s.id)])] });
}
async function chooseFrom(title, items) {
  if (!items.length) { toast(t('tch.nothingToSend')); return null; }
  const row = (it) => `<button class="tch-row tch-pick" data-id="${esc(it.id)}"><span><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>${CHEV}</button>`;
  let pick = null;
  const p = dialog({ title, html: true, className: 'tch-dlg', body: `${items.length > 8 ? `<input id="tFind" placeholder="${esc(t('tch.find'))}" autocomplete="off">` : ''}<div class="set-grp tch-list">${items.slice(0, 80).map(row).join('')}</div>`, buttons: [{ label: t('common.cancel'), value: null }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  box.querySelector('#tFind')?.addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); box.querySelector('.tch-list').innerHTML = items.filter((it) => (it.label + ' ' + (it.sub || '')).toLowerCase().includes(q)).slice(0, 80).map(row).join(''); });
  box.querySelector('.tch-list').parentElement.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) { pick = b.dataset.id; box.querySelector('[data-x], .modal-actions .btn')?.click(); } });
  await p;
  return pick;
}

/** Set lista → „Za učenike“ (dodaj / ukloni) i „Pošalji učenicima“. */
export async function setlistStudents(sl, { send = false } = {}) {
  const students = await T.getStudents();
  if (!students.length) { const s = await addStudentFlow(); if (!s) return null; return setlistStudents(sl, { send }); }
  const { pickMany } = await import('./setlistsView.js');
  const r = await pickMany(send ? t('tch.sendSetTo') : t('tch.forStudents'), students.map((s) => ({ value: s.id, label: s.name, sub: (sl.sentTo || {})[s.id] ? t('tch.sentOn', { d: day(sl.sentTo[s.id]) }) : '' })), sl.students || [], '', '+ ' + t('tch.student'));
  if (!r) return null;
  if (r.extra) { const s = await addStudentFlow(); if (s) sl = { ...sl, students: [...(r.selected || []), s.id] }; return setlistStudents(sl, { send }); }
  const c = await import('./collections.js');
  await c.updateSetlist(sl.id, { students: r });
  if (send && r.length) {
    const S = await import('./shareService.js');
    const share = await S.setlistItem(sl);
    if (!share) { toast(t('sl.noSongs'), 'error'); return r; }
    await sendMenu(students.filter((s) => r.includes(s.id)), { kind: 'set', name: sl.name, n: share.songs.length, share, onSent: (sts) => markSent({ ...sl, students: r }, sts) });
  }
  return r;
}

// ---------------- „Za koga je snimak?“ (posle snimanja, samo nastavnik) ----------------
export async function askStudentFor(song) {
  if (!(await T.isTeacher())) return;
  const students = await T.getStudents();
  let last = null; try { last = localStorage.getItem('marli-last-student'); } catch {}
  let sel = students.some((s) => s.id === last) ? last : '';
  const chip = (id, label, s) => `<button type="button" class="chip tch-chip${sel === id ? ' on' : ''}" data-st="${esc(id)}">${s ? T.avatarHTML(s, 22) : ''}${esc(label)}</button>`;
  const draw = () => [...students.map((s) => chip(s.id, s.name, s)), chip('+', '+ ' + t('tch.newStudentShort')), chip('', t('tch.noStudent'))].join('');
  const p = dialog({ title: t('tch.recSaved'), html: true, className: 'tch-dlg', body: `<p class="tch-q">${t('tch.forWhom')}</p><div class="tch-chips">${draw()}</div><p class="muted small">${t('tch.remembers')}</p>`, buttons: [{ label: t('common.save'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  box.querySelector('.tch-chips').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-st]'); if (!b) return;
    if (b.dataset.st === '+') { const s = await addStudentFlow(); if (s) { students.push(s); sel = s.id; } }
    else sel = b.dataset.st;
    box.querySelector('.tch-chips').innerHTML = draw();
  });
  await p;
  try { if (sel) localStorage.setItem('marli-last-student', sel); } catch {}
  if (sel && song && song.id) { const cur = await db.get(song.id); if (cur) await db.save({ ...cur, student: sel }); }
}

// ---------------- učenik: Od nastavnika ----------------
export async function renderFromTeacher(root) {
  const m = await T.getMyTeacher();
  if (!m) { location.replace('#/pesme'); return; }
  const all = await db.list();
  const songsFrom = all.filter((s) => s.fromT).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const c = await import('./collections.js');
  const sets = (await c.getSetlists()).filter((sl) => sl.fromT);
  root.innerHTML = `<section class="view tch-view">
    <a class="back tch-back" href="#/pesme">‹ ${t('lib.title')}</a>
    <header class="view-head tch-head"><h1>${t('tch.fromTeacher')}</h1></header>
    <div class="card tch-teacher">${T.avatarHTML({ name: m.name || '?', color: '#f5a524' }, 44)}<span><b>${esc(m.name || t('tch.teacher'))}</b><small class="muted">${t('tch.yourTeacher')}</small></span></div>
    <div class="tch-sec"><span>${t('tch.arrived')}</span></div>
    ${sets.length || songsFrom.length ? `<div class="set-grp">${sets.map((sl) => `<a class="tch-row" href="#/setlista/${encodeURIComponent(sl.id)}">${ic('list')}<span><b>${esc(sl.name)}</b><small>${songsCount((sl.songIds || []).length)}</small></span>${CHEV}</a>`).join('')}${songsFrom.map((s) => `<a class="tch-row" href="#/pesma/${encodeURIComponent(s.id)}">${ic('song')}<span><b>${esc(s.title)}</b><small>${esc(s.artist || '')}</small></span>${CHEV}</a>`).join('')}</div>` : `<p class="muted small tch-none">${t('tch.nothingArrived')}</p>`}
    <button class="btn primary wide tch-sendback" id="tBack">🎙 ${t('tch.sendToTeacher')}</button>
    <p class="tch-lock">🔒 ${t('tch.lockStudentSide', { t: m.name || t('tch.teacher') })}</p>
    <button class="btn small tch-disc" id="tDisc">${t('tch.disconnect')}</button>
  </section>`;
  root.querySelector('#tBack').addEventListener('click', () => sendToTeacher());
  root.querySelector('#tDisc').addEventListener('click', () => disconnectTeacher());
}
export async function disconnectTeacher() {
  const m = await T.getMyTeacher(); if (!m) return;
  const ok = await dialog({ title: t('tch.discTitle', { t: m.name || t('tch.teacher') }), body: t('tch.discBody'), buttons: [{ label: t('common.cancel'), value: null }, { label: t('tch.disconnect'), value: 'y', kind: 'danger' }] });
  if (ok !== 'y') return;
  await T.setMyTeacher(null);
  toast(t('tch.disconnected'));
  location.hash = '#/pesme';
}
/** Učenik → nastavnik: snimak (ili pesma) jednim dodirom; nastavnikova aplikacija ga sama stavi kod tog učenika. */
export async function sendToTeacher(song = null) {
  const m = await T.getMyTeacher();
  if (!m) return;
  const S = await import('./shareService.js');
  if (!song) {
    const { REC_FOLDER } = await import('./collections.js');
    const recs = (await db.list()).filter((s) => (s.folders || []).includes(REC_FOLDER) && !s.fromT).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const id = await chooseFrom(t('tch.what.rec'), recs.map((s) => ({ id: s.id, label: s.title, sub: day(s.createdAt) })));
    if (!id) return;
    song = await db.get(id);
  }
  const res = await S.publishOnly(S.songItem(song));
  if (!res) return;
  const link = res.link + (await T.toTeacherSuffix());
  const text = await T.editMessage(t('tch.sendToTeacher'), t('tch.msgToTeacher', { t: m.name || '', name: song.title, link }), t('tch.lockMsg'));
  if (text != null) await T.compose({ to: m.contact || '', subject: t('tch.subjectToTeacher'), text });
}

// ---------------- pozivnica (kod učenika) ----------------
export async function acceptInvite(hash) {
  const mm = /^#poziv\/([^/?]+)\/([^/?]+)/.exec(hash);
  history.replaceState(null, '', location.pathname + '#/pesme');
  if (!mm) return;
  const p = T.linkParams(hash);
  const me = await T.getTeacher();
  if (me.id && me.id === decodeURIComponent(mm[1])) { toast(t('tch.ownInvite')); return; } // nastavnik otvorio svoj link
  const name = p.get('n') || '';
  const ok = await dialog({ title: name ? t('tch.inv.title', { t: name }) : t('tch.inv.titleAnon'), html: true, className: 'tch-dlg',
    body: `<p>${esc(t('tch.inv.body', { t: name || t('tch.teacher') }))}</p><p class="tch-lock">🔒 ${esc(t('tch.inv.lock', { t: name || t('tch.teacher') }))}</p>`,
    buttons: [{ label: t('tch.inv.no'), value: null }, { label: t('tch.inv.yes'), value: 'y', kind: 'primary' }] });
  if (ok !== 'y') return;
  await T.setMyTeacher({ tid: decodeURIComponent(mm[1]), sid: decodeURIComponent(mm[2]), name, contact: p.get('c') || '', at: Date.now() });
  toast(t('tch.inv.done', { t: name || t('tch.teacher') }));
  location.hash = '#/od-nastavnika';
}

// ---------------- Podešavanja → Nastava ----------------
export async function renderTeachSettings(body, setRowValue) {
  if (!body) return;
  const tc = await T.getTeacher();
  const my = await T.getMyTeacher();
  const n = (await T.getStudents()).length;
  const sw = `<label class="switch tch-sw"><input type="checkbox" id="tOn"${tc.on ? ' checked' : ''}><span class="switch-track"><span class="switch-thumb"></span></span><span><b>${t('tch.iAmTeacher')}</b><small class="muted">${t('tch.iAmTeacherSub')}</small></span></label>`;
  body.innerHTML = `${sw}
    ${tc.on ? `<div class="tch-fields">
      <label class="tch-lab">${t('tch.myName')}</label><small class="muted tch-hint">${t('tch.myNameWhy')}</small><input id="tMyName" maxlength="60" value="${esc(tc.name || (await T.teacherName()) || '')}" autocomplete="name">
      <label class="tch-lab">${t('tch.myContact')} <span class="muted">${t('tch.optional')}</span></label><small class="muted tch-hint">${t('tch.myContactWhy')}</small><input id="tMyContact" maxlength="120" value="${esc(tc.contact || '')}" autocomplete="email">
      <a class="btn primary wide tch-go" href="#/ucenici">${t('tch.students')} (${n}) ›</a></div>` : ''}
    <div class="tch-sec"><span>${t('tch.whenOn')}</span></div>
    <ul class="tch-feats"><li><b>${t('tch.students')}</b> — ${t('tch.f1')}</li><li><b>${t('tch.forWhom')}</b> — ${t('tch.f2')}</li><li><b>${t('tch.forStudents')}</b> — ${t('tch.f3')}</li></ul>
    <p class="tch-lock">🔒 ${t('tch.lockSettings')}</p>
    ${my ? `<div class="tch-sec"><span>${t('tch.myTeacher')}</span></div><div class="set-grp"><a class="tch-row" href="#/od-nastavnika">${T.avatarHTML({ name: my.name || '?', color: '#f5a524' }, 36)}<span><b>${esc(my.name || t('tch.teacher'))}</b><small>${t('tch.fromTeacher')}</small></span>${CHEV}</a></div><button class="btn small tch-disc" id="tDisc">${t('tch.disconnect')}</button>` : ''}`;
  setRowValue?.(tc.on ? t('tch.on', { n }) : my ? (my.name || t('tch.teacher')) : t('tch.off'));
  body.querySelector('#tOn').addEventListener('change', async (e) => {
    await T.setTeacher({ on: e.target.checked });
    toast(e.target.checked ? t('tch.turnedOn') : t('tch.turnedOff'));
    renderTeachSettings(body, setRowValue);
  });
  body.querySelector('#tMyName')?.addEventListener('change', (e) => T.setTeacher({ name: e.target.value.trim().slice(0, 60) }));
  body.querySelector('#tMyContact')?.addEventListener('change', (e) => T.setTeacher({ contact: e.target.value.trim().slice(0, 120) }));
  body.querySelector('#tDisc')?.addEventListener('click', async () => { await disconnectTeacher(); renderTeachSettings(body, setRowValue); });
}

/** Ekran pesme → „Pošalji učeniku…“: izbor jednog ili više učenika (snimak: njegov učenik je unapred izabran). */
export async function sendSongToStudents(song) {
  const students = await T.getStudents();
  if (!students.length) { const s = await addStudentFlow(); if (!s) return; return sendSongToStudents(song); }
  let chosen = song.student && students.some((s) => s.id === song.student) ? [song.student] : [];
  if (students.length > 1 || !chosen.length) {
    const { pickMany } = await import('./setlistsView.js');
    const r = await pickMany(t('tch.sendTo', { name: song.title }), students.map((s) => ({ value: s.id, label: s.name })), chosen.length ? chosen : students.length === 1 ? [students[0].id] : []);
    if (!r || !r.length) return;
    chosen = r;
  }
  const S = await import('./shareService.js');
  const isRec = !!song.recording;
  await sendMenu(students.filter((s) => chosen.includes(s.id)), { kind: isRec ? 'rec' : 'song', name: song.title, share: S.songItem(song) });
}
