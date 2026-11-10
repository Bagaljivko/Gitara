// v1.78: ekrani Nastave — Učenici (#/ucenici), učenik (#/ucenik/<id>), Od nastavnika (#/od-nastavnika, kod učenika),
// slanje učenicima (jednom ili više — svako dobija svoju poruku, ne vide jedni druge) i nastavniku, prihvatanje pozivnice.
import { t, songsCount, getLang, countOf, ROUNDS } from './i18n.js';
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
  if (BIG()) return renderDashboard(root); // v1.79: računar / veliki tablet
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
    <button type="button" class="linkish tch-qrcard" id="tQrCard">🖨 ${t('inst.cardBtn')}</button>
    ${list.length ? `<div class="set-grp">${list.map((s) => `<a class="tch-row" href="#/ucenik/${encodeURIComponent(s.id)}">${T.avatarHTML(s)}<span><b>${esc(s.name)}</b><small>${esc(meta(s))}</small></span>${CHEV}</a>`).join('')}</div>`
      : `<div class="card tch-empty"><p>${t('tch.emptyBody')}</p></div>`}
    <p class="tch-lock">🔒 ${t('tch.lockList')}</p>
  </section>`;
  root.querySelector('#tAdd').addEventListener('click', async () => { const s = await addStudentFlow(); if (s) location.hash = '#/ucenik/' + encodeURIComponent(s.id); });
  root.querySelector('#tQrCard')?.addEventListener('click', printInstallCard);
}

/** v1.87: kartica za štampu (A4 sa 4 kartice A6) — QR do aplikacije i tri koraka za instalaciju, za učionicu. */
export async function printInstallCard() {
  const { qrSVG } = await import('./qr.js'); const { SHARE_BASE } = await import('./shareConfig.js');
  const name = await T.teacherName();
  const qr = qrSVG(SHARE_BASE, { margin: 2 });
  const one = `<div class="c"><div class="h"><img src="${new URL('icons/icon-192.png', location.href).href}" alt=""><div><b>MARLI</b><span>${esc(t('inst.cardSub'))}</span></div></div><div class="q">${qr}</div>
    <ol><li>${esc(t('inst.card1'))}</li><li>${esc(t('inst.card2'))}</li><li>${esc(t('inst.card3'))}</li></ol>${name ? `<p class="t">${esc(t('inst.cardFrom', { t: name }))}</p>` : ''}<p class="u">${esc(SHARE_BASE.replace(/^https:\/\//, ''))}</p></div>`;
  const html = `<!doctype html><html lang="sr"><head><meta charset="utf-8"><title>MARLI — ${esc(t('inst.cardBtn'))}</title><style>
    @page { size: A4; margin: 8mm; } body { margin: 0; font-family: system-ui, sans-serif; color: #111; }
    .g { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; } .c { border: 1px dashed #bbb; border-radius: 4mm; padding: 6mm; height: 128mm; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; text-align: center; break-inside: avoid; }
    .h { display: flex; gap: 3mm; align-items: center; } .h img { width: 14mm; height: 14mm; border-radius: 3mm; } .h b { display: block; font-size: 6mm; letter-spacing: .1em; text-align: left; } .h span { font-size: 3.2mm; color: #555; }
    .q { width: 52mm; margin: 5mm 0 3mm; } .q svg { width: 100%; height: auto; display: block; } ol { text-align: left; font-size: 3.6mm; line-height: 1.45; margin: 2mm 0; padding-left: 5mm; }
    .t { font-size: 3.4mm; margin: auto 0 1mm; font-weight: 600; } .u { font-size: 3mm; color: #666; margin: 0; }
  </style></head><body><div class="g">${one}${one}${one}${one}</div><script>onload = () => setTimeout(() => print(), 300);</` + `script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast(t('inst.cardBlocked'), 'error'); return; }
  w.document.open(); w.document.write(html); w.document.close();
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
  const oo = (r) => (r.status === 'open' || r.status === 'editing' ? 0 : 1);
  const reqs = (await T.getRequests()).filter((r) => r.sid === id).sort((a, b) => oo(a) - oo(b) || b.at - a.at);
  root.innerHTML = `<section class="view tch-view">
    <a class="back tch-back" href="#/ucenici">‹ ${t('tch.students')}</a>
    <div class="tch-hero">${T.avatarHTML(s, 56)}<div><h1>${esc(s.name)}</h1><small class="muted">${esc([s.contact, t('tch.since', { d: ((d) => `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}.`)(new Date(s.createdAt || Date.now())) })].filter(Boolean).join(' · '))}</small></div></div>
    <div class="tch-actions"><button class="btn primary" id="tSend">${t('tch.sendTo', { name: s.name })}</button><button class="btn" id="tMore" aria-label="${esc(t('tch.more'))}">⋯</button></div>
    <div id="tProg">${s.prog ? `<div class="tch-sec"><span>${t('prog.head')}</span></div><p class="muted small tch-none">${t('prog.loading')}</p>` : ''}</div>
    <div id="tPlan" class="pl-tch"></div>
    ${reqs.length ? `<div class="tch-sec"><span>${t('tch.rq.head')}</span></div><div class="set-grp tch-reqs">${reqs.map((r) => reqHTML(r)).join('')}</div>` : ''}
    <div class="tch-sec"><span>${t('tch.setlists')}</span><button class="linkish" id="tNewSet">+ ${t('tch.newSet')}</button></div>
    ${sets.length ? `<div class="set-grp">${sets.map((sl) => `<a class="tch-row" href="#/setlista/${encodeURIComponent(sl.id)}">${ic('list')}<span><b>${esc(sl.name)}</b><small>${songsCount((sl.songIds || []).length)}${(sl.sentTo || {})[id] ? ' · ' + t('tch.sentOn', { d: day(sl.sentTo[id]) }) : ''}</small></span>${CHEV}</a>`).join('')}</div>` : `<p class="muted small tch-none">${t('tch.noSets')}</p>`}
    <div class="tch-sec"><span>${t('tch.recs')}</span></div>
    ${recs.length ? `<div class="set-grp">${recs.map((r) => `<a class="tch-row" href="#/pesma/${encodeURIComponent(r.id)}">${ic('play')}<span><b>${esc(when(r.createdAt))}${r.fromStudent ? ` <em class="tch-from">${esc(t('tch.fromName', { name: s.name }))}</em>` : ''}</b><small>${esc([r.recording ? '' : r.title, chordsOf(r), r.recording ? dur(r.recording.dur) : ''].filter(Boolean).join(' · '))}</small></span>${CHEV}</a>`).join('')}</div>` : `<p class="muted small tch-none">${t('tch.noRecs')}</p>`}
  </section>`;
  root.querySelector('#tSend').addEventListener('click', () => sendMenu([s]));
  bindReqs(root, () => renderStudent(root, id));
  if (s.prog) progressCardHTML(s, true).then((h) => { const box = root.querySelector('#tProg'); if (box) box.innerHTML = h; }).catch(() => {});
  // v1.83: zadaci i plan učenja (stanje iz učenikovog napretka, ako ga deli)
  (async () => {
    const box = root.querySelector('#tPlan'); if (!box) return;
    const V = await import('./planView.js');
    await V.drawTeacherPlan(box, id, null);
    if (s.prog) { const P = await import('./progress.js'); const pr = await P.studentProgress(s, { fresh: true }).catch(() => null); if (pr && !pr.err && !pr.gone && box.isConnected) V.drawTeacherPlan(box, id, pr); }
  })().catch((e) => console.error(e));
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
export async function sendMenu(students, preset = null, { rq = '', rp = '' } = {}) {
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
  const got = await sendEach(students, async (st) => {
    const link = res.link + (await T.toStudentSuffix(st, rq, rp));
    const tn = await T.teacherName();
    return { to: st.contact, subject: t('tch.subject', { t: tn || 'MARLI' }), text: t(item.msgKey || (item.kind === 'set' ? 'tch.msgSet' : item.kind === 'rec' ? 'tch.msgRec' : 'tch.msgSong'), { s: st.name, t: tn, name: item.name, n: songsCount(item.n || 1), link }) };
  });
  if (item.onSent) await item.onSent(students);
  if (got.length) await T.logSent(got, item.kind);
  if (rq && got.length) await T.setRequest(rq, { status: 'sent', doneAt: Date.now(), sentTitle: item.name });
}
/** Svakom učeniku posebna poruka (jedan dodir po učeniku — telefon traži dodir za svako otvaranje). */
async function sendEach(students, build) {
  if (students.length === 1) {
    const m = await build(students[0]);
    const text = await T.editMessage(t('tch.sendTo', { name: students[0].name }), m.text, t('tch.lockMsg'));
    if (text == null) return [];
    await T.compose({ ...m, text });
    return [students[0].id];
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
  return [...done];
}
/** Izbor pesme / set liste / snimka (pretraga). */
async function pickItem(kind, students, query = '') {
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
  const id = await chooseFrom(t(kind === 'rec' ? 'tch.what.rec' : 'tch.what.song'), items.map((s) => ({ id: s.id, label: s.title, sub: s.artist || '' })), query);
  if (!id) return null;
  const song = await db.get(id);
  return { kind, name: song.title, share: S.songItem(song) };
}
async function markSent(sl, students) {
  const c = await import('./collections.js');
  const sentTo = { ...(sl.sentTo || {}) }; students.forEach((s) => (sentTo[s.id] = Date.now()));
  await c.updateSetlist(sl.id, { sentTo, students: [...new Set([...(sl.students || []), ...students.map((s) => s.id)])] });
}
async function chooseFrom(title, items, query = '') {
  if (!items.length) { toast(t('tch.nothingToSend')); return null; }
  const row = (it) => `<button class="tch-row tch-pick" data-id="${esc(it.id)}"><span><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>${CHEV}</button>`;
  let pick = null;
  const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'dj');
  const match = (q) => { const w = fold(q).split(/\s+/).filter(Boolean); return items.filter((it) => { const h = fold(it.label + ' ' + (it.sub || '')); return w.every((x) => h.includes(x)); }); };
  const first = query ? match(query) : items;
  const p = dialog({ title, html: true, className: 'tch-dlg', body: `${items.length > 8 || query ? `<input id="tFind" placeholder="${esc(t('tch.find'))}" autocomplete="off" value="${esc(query)}">` : ''}<div class="set-grp tch-list">${(first.length ? first : items).slice(0, 80).map(row).join('')}</div>`, buttons: [{ label: t('common.cancel'), value: null }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  box.querySelector('#tFind')?.addEventListener('input', (e) => { box.querySelector('.tch-list').innerHTML = match(e.target.value).slice(0, 80).map(row).join(''); });
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
  const mine = (await T.getMyRequests()).sort((a, b) => b.at - a.at).slice(0, 20);
  // v1.80: „Deli napredak“ — šta tačno nastavnik vidi (isti brojevi koji idu u fajl)
  const tn = m.name || t('tch.teacher');
  const progOn = !!(m.prog && m.prog.on);
  let progBody = `<p class="muted small tch-none">${t('prog.offBody', { t: tn })}</p>`;
  if (progOn) {
    const P = await import('./progress.js'), { fmtDur } = await import('./statsView.js');
    await prTexts();
    const w = { ...(await P.buildSummary()), cur: true };
    progBody = m.prog.mode === 'msg'
      ? `${progressBodyHTML(w, fmtDur)}<div class="tch-pmsg"><button class="btn primary" id="tProgSend">📈 ${t('prog.sendNow', { t: tn })}</button><small class="muted">${m.prog.sentAt ? t('prog.sentWhen', { d: when(m.prog.sentAt) }) : t('prog.notSentYet')}</small></div><p class="tch-lock">🔒 ${t('prog.mineMsgNote', { t: tn })} <button class="linkish" id="tProgMode">${t('prog.changeMode')}</button></p>`
      : `${progressBodyHTML(w, fmtDur)}<p class="tch-lock">🔒 ${m.prog.at ? t('prog.mineUpdated', { t: tn, d: when(m.prog.at) }) : t('prog.minePending', { t: tn })} ${t('prog.mineNote', { t: tn })} <button class="linkish" id="tProgMode">${t('prog.changeMode')}</button></p>`;
  }
  root.innerHTML = `<section class="view tch-view">
    <a class="back tch-back" href="#/pesme">‹ ${t('lib.title')}</a>
    <header class="view-head tch-head"><h1>${t('tch.fromTeacher')}</h1></header>
    <div class="card tch-teacher">${T.avatarHTML({ name: m.name || '?', color: '#f5a524' }, 44)}<span><b>${esc(m.name || t('tch.teacher'))}</b><small class="muted">${t('tch.yourTeacher')}${m.contact ? ' · ' + esc(m.contact) : ''}</small></span></div>
    <div id="tMyPlan"></div>
    <div class="tch-ask"><button class="btn" id="tWish">⭐ ${t('tch.rq.wish')}</button><button class="btn" id="tAsk">❓ ${t('tch.rq.ask')}</button></div>
    <div class="tch-sec"><span>${t(progOn ? 'prog.sharing' : 'prog.share')}</span><label class="switch tch-psw"><input type="checkbox" id="tProgSw"${progOn ? ' checked' : ''} aria-label="${esc(t('prog.shareWith', { t: tn }))}"><span class="switch-track"><span class="switch-thumb"></span></span></label></div>
    ${progBody}
    ${mine.length ? `<div class="tch-sec"><span>${t('tch.rq.mine')}</span></div><div class="set-grp">${mine.map((r) => `<div class="tch-row"><span class="sr-ic tch-rq-ic2">${RQ_IC[r.type]}</span><span><b>${esc(r.title)}${r.artist ? ' — ' + esc(r.artist) : ''}</b><small>${esc(when(r.at))}</small></span><span class="tch-st${r.status === 'answered' || r.status === 'ok' ? ' ok' : ''}">${esc(t('tch.rq.my.' + r.status))}</span></div>`).join('')}</div>` : ''}
    <div class="tch-sec"><span>${t('tch.arrived')}</span></div>
    ${sets.length || songsFrom.length ? `<div class="set-grp">${sets.map((sl) => `<a class="tch-row" href="#/setlista/${encodeURIComponent(sl.id)}">${ic('list')}<span><b>${esc(sl.name)}</b><small>${songsCount((sl.songIds || []).length)}</small></span>${CHEV}</a>`).join('')}${songsFrom.map((s) => `<a class="tch-row" href="#/pesma/${encodeURIComponent(s.id)}">${ic('song')}<span><b>${esc(s.title)}</b><small>${esc(s.artist || '')}</small></span>${CHEV}</a>`).join('')}</div>` : `<p class="muted small tch-none">${t('tch.nothingArrived')}</p>`}
    <button class="btn primary wide tch-sendback" id="tBack">🎙 ${t('tch.sendToTeacher')}</button>
    <p class="tch-lock">🔒 ${t('tch.lockStudentSide', { t: m.name || t('tch.teacher') })}</p>
    <button class="btn small tch-disc" id="tDisc">${t('tch.disconnect')}</button>
  </section>`;
  root.querySelector('#tBack').addEventListener('click', () => sendToTeacher());
  // v1.83: plan od nastavnika (osveži pri otvaranju)
  if (m.planFile) import('./planView.js').then(async (V) => {
    const box = root.querySelector('#tMyPlan'); if (!box) return;
    await V.drawMyPlan(box);
    const P = await import('./plan.js'); P.watchTasks();
    if (await P.refreshPlan({ force: true }).catch(() => false) && box.isConnected) V.drawMyPlan(box);
  }).catch(() => {});
  root.querySelector('#tWish').addEventListener('click', async () => { if (await askTeacherFlow('wish')) renderFromTeacher(root); });
  root.querySelector('#tAsk').addEventListener('click', async () => { if (await askTeacherFlow('ask')) renderFromTeacher(root); });
  root.querySelector('#tDisc').addEventListener('click', () => disconnectTeacher());
  root.querySelector('#tProgSend')?.addEventListener('click', async () => { const P = await import('./progress.js'); if (await P.sendProgressMsg().catch(() => false)) { toast(t('prog.sentToast', { t: tn })); renderFromTeacher(root); } });
  root.querySelector('#tProgMode')?.addEventListener('click', async () => { const P = await import('./progress.js'); await P.setProgressShare(false); if (await P.setProgressShare(true).catch(() => false)) toast(t('prog.turnedOn', { t: tn })); renderFromTeacher(root); });
  root.querySelector('#tProgSw').addEventListener('change', async (e) => {
    const on = e.target.checked; e.target.disabled = true;
    const P = await import('./progress.js');
    const ok = await P.setProgressShare(on).catch(() => false);
    if (ok) toast(t(on ? 'prog.turnedOn' : 'prog.turnedOff', { t: tn }));
    renderFromTeacher(root);
  });
}
export async function disconnectTeacher() {
  const m = await T.getMyTeacher(); if (!m) return;
  const ok = await dialog({ title: t('tch.discTitle', { t: m.name || t('tch.teacher') }), body: t('tch.discBody'), buttons: [{ label: t('common.cancel'), value: null }, { label: t('tch.disconnect'), value: 'y', kind: 'danger' }] });
  if (ok !== 'y') return;
  if (m.prog && m.prog.on) await (await import('./progress.js')).setProgressShare(false).catch(() => {}); // v1.80: fajl sa napretkom se briše
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
  let wantProg = false;
  const pInv = dialog({ title: name ? t('tch.inv.title', { t: name }) : t('tch.inv.titleAnon'), html: true, className: 'tch-dlg',
    body: `<p>${esc(t('tch.inv.body', { t: name || t('tch.teacher') }))}</p>
      <label class="switch tch-sw tch-inv-prog"><input type="checkbox" id="invProg"><span class="switch-track"><span class="switch-thumb"></span></span><span><b>${esc(t('prog.shareWithT'))}</b><small class="muted">${esc(t('prog.offerSub'))}</small></span></label>
      <p class="tch-lock">🔒 ${esc(t('tch.inv.lock', { t: name || t('tch.teacher') }))}</p>`,
    buttons: [{ label: t('tch.inv.no'), value: null }, { label: t('tch.inv.yes'), value: 'y', kind: 'primary' }] });
  [...document.querySelectorAll('.modal-backdrop')].pop()?.querySelector('#invProg')?.addEventListener('change', (e) => (wantProg = e.target.checked));
  const ok = await pInv;
  if (ok !== 'y') return;
  await T.setMyTeacher({ tid: decodeURIComponent(mm[1]), sid: decodeURIComponent(mm[2]), name, contact: p.get('c') || '', at: Date.now() });
  toast(t('tch.inv.done', { t: name || t('tch.teacher') }));
  try { dispatchEvent(new Event('marli-invite-ok')); } catch {} // v1.87: posle prihvatanja — poziv „Instaliraj“ (telefon/tablet)
  location.hash = '#/od-nastavnika';
  if (wantProg) { const P = await import('./progress.js'); if (await P.setProgressShare(true).catch(() => false)) toast(t('prog.turnedOn', { t: name || t('tch.teacher') })); location.hash === '#/od-nastavnika' && window.dispatchEvent(new HashChangeEvent('hashchange')); }
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

// ---------------- v1.79: zahtevi (nastavnik) ----------------
const RQ_IC = { wish: '⭐', ask: '❓', check: '🔍' };
function reqHTML(r, who = '') {
  const what = `${esc(r.title)}${r.artist ? ` — ${esc(r.artist)}` : ''}`;
  const st = { open: '', editing: `<span class="tch-st ok">${esc(t('chk.stEditing'))}</span>`, ok: `<span class="tch-st ok">${esc(t('chk.stOk'))}</span>`, copy: `<span class="tch-st">${esc(t('chk.stCopy'))}</span>`, sent: `<span class="tch-st ok">${esc(t('tch.rq.stSent'))}</span>`, none: `<span class="tch-st">${esc(t('tch.rq.stNone'))}</span>`, done: `<span class="tch-st">${esc(t('tch.rq.stDone'))}</span>` }[r.status] || '';
  return `<div class="tch-rq${r.status === 'open' ? '' : ' closed'}" data-rq="${esc(r.id)}"><span class="tch-rq-ic">${RQ_IC[r.type] || '•'}</span><div class="tch-rq-b">
    <b>${who ? esc(who) + ': ' : ''}${esc(t(r.type === 'wish' ? 'tch.rq.wishShort' : r.type === 'check' ? 'chk.short' : 'tch.rq.askShort'))} ${what}</b>
    <small>${r.note ? '„' + esc(r.note) + '“ · ' : ''}${esc(when(r.at))} ${st}</small>
    ${r.type === 'check' && (r.status === 'open' || r.status === 'editing') ? `<div class="tch-rq-acts">${r.status === 'editing' && r.songId ? `<button class="btn small primary" data-ra="fixsend">${esc(t('chk.sendFix'))}</button><a class="btn small" href="#/uredi/${encodeURIComponent(r.songId)}">${esc(t('chk.edit'))}</a>` : `<button class="btn small primary" data-ra="check">${esc(t('chk.view'))}</button>`}<button class="btn small" data-ra="done">${esc(t('tch.rq.done'))}</button></div>`
      : r.status === 'open' ? `<div class="tch-rq-acts"><button class="btn small primary" data-ra="send">${esc(t('tch.rq.sendSong'))}</button>${r.type === 'ask' ? `<button class="btn small" data-ra="none">${esc(t('tch.rq.none'))}</button>` : ''}<button class="btn small" data-ra="done">${esc(t('tch.rq.done'))}</button></div>` : ''}</div></div>`;
}
function bindReqs(root, redraw) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ra]'); if (!b) return;
    const id = b.closest('[data-rq]').dataset.rq;
    const r = (await T.getRequests()).find((x) => x.id === id); if (!r) return;
    const st = await T.getStudent(r.sid); if (!st) return;
    if (b.dataset.ra === 'send') { const item = await pickItem('song', [st], `${r.title} ${r.artist || ''}`.trim()); if (item) await sendMenu([st], item, { rq: r.id }); }
    else if (b.dataset.ra === 'none') await T.answerNone(r);
    else if (b.dataset.ra === 'check') { await checkFlow(r.id); return; }
    else if (b.dataset.ra === 'fixsend') { const song = await db.get(r.songId); if (song) await sendFix(song); }
    else if (b.dataset.ra === 'done') await T.setRequest(r.id, { status: 'done', doneAt: Date.now() });
    redraw();
  });
}

// ---------------- v1.79: pregled za nastavnika (veliki ekran) ----------------
export const BIG = () => matchMedia('(min-width: 1000px)').matches;
export async function renderDashboard(root) {
  const students = await T.getStudents();
  const reqs = (await T.getRequests()).sort((a, b) => b.at - a.at);
  const isOpen = (r) => r.status === 'open' || r.status === 'editing';
  const open = reqs.filter(isOpen);
  const now = Date.now();
  // v1.80: napredak (samo kod učenika koji ga dele) — čita se paralelno, najduže ~5 s
  const P = await import('./progress.js');
  const wait = (pr) => Promise.race([pr, new Promise((r) => setTimeout(() => r({ err: true }), 5000))]);
  const progs = await Promise.all(students.map((s) => (s.prog ? wait(P.studentProgress(s)).catch(() => ({ err: true })) : null)));
  const rows = students.map((s, i) => ({ s, p: progs[i], w: P.thisWeek(progs[i]), open: open.filter((r) => r.sid === s.id).length }));
  const sharing = rows.filter((r) => r.w);
  const practiced = sharing.filter((r) => r.w.total > 0).length, practicedLast = sharing.filter((r) => r.w.lastWeek > 0).length;
  const total = sharing.reduce((a, r) => a + r.w.total, 0), totalLast = sharing.reduce((a, r) => a + r.w.lastWeek, 0);
  const maxT = Math.max(1, ...sharing.map((r) => r.w.total));
  const { fmtDur } = await import('./statsView.js');
  const V = await import('./planView.js');
  const diff = (a, b, fmt) => (a === b || (!a && !b) ? `<em>${t('tch.d.week')}</em>` : `<em class="${a > b ? 'up' : ''}">${a > b ? '+' : '−'}${fmt(Math.abs(a - b))} ${t('st.vsLast')}</em>`);
  const attention = [
    ...rows.filter((r) => r.w && r.w.idle != null && r.w.idle >= 7).map((r) => ({ c: 'tp red', n: '!', txt: t('prog.attIdle', { name: r.s.name, n: r.w.idle }) })),
    ...rows.filter((r) => r.open).map((r) => ({ c: 'tp', n: r.open, txt: t('tch.d.attOpen', { name: r.s.name, n: r.open }) })),
    ...rows.filter((r) => !r.s.prog || (r.p && r.p.gone)).map((r) => ({ c: 'tp gray', n: 'i', txt: t('prog.attNoShare', { name: r.s.name }) })),
    ...rows.filter((r) => !r.s.contact).map((r) => ({ c: 'tp gray', n: 'i', txt: t('tch.d.attNoContact', { name: r.s.name }) })),
  ].slice(0, 8);
  const progCells = (r) => {
    if (!r.s.prog || (r.p && r.p.gone)) return `<td colspan="4"><span class="tp gray">${t('prog.noShare')}</span></td>`;
    if (!r.w) return `<td colspan="4"><span class="muted small">${t('prog.err')}</span></td>`;
    const best = (r.w.songs || []).slice().sort((a, b) => b.to - a.to)[0];
    const last = r.w.idle == null ? '—' : r.w.idle >= 7 ? `<span class="tp red">${day(now - r.w.idle * 864e5)}</span>` : day(now - r.w.idle * 864e5);
    return `<td><span class="db-bar"><i style="width:${Math.round((r.w.total / maxT) * 100)}%"></i></span>${r.w.total ? fmtDur(r.w.total) : '0 min'}</td><td>${r.w.streak || '—'}</td><td>${best ? `${esc(best.title)} <small class="muted">${best.to}%</small>` : '—'}</td><td>${last}</td>`;
  };
  root.innerHTML = `<section class="view tch-view tch-dash">
    <a class="back tch-back" href="#/pesme">‹ ${t('lib.title')}</a>
    <div class="db-h"><div><h1>${t('tch.students')}</h1><small class="muted">${t('prog.dSub')}</small></div><div class="db-h-btns"><button class="btn" id="dQrCard">🖨 ${t('inst.cardBtn')}</button><button class="btn" id="dSendSet">${t('tch.d.sendSet')}</button><button class="btn primary" id="tAdd">+ ${t('tch.student')}</button></div></div>
    <div class="db-kpis">
      <div class="db-kpi"><small>${t('tch.d.kStudents')}</small><b>${students.length}</b><em>${t('prog.kSharing', { n: students.filter((s) => s.prog).length })}</em></div>
      <div class="db-kpi"><small>${t('prog.kPracticed')}</small><b>${practiced} / ${sharing.length}</b>${diff(practiced, practicedLast, (n) => String(n))}</div>
      <div class="db-kpi"><small>${t('prog.kTotal')}</small><b>${fmtDur(total)}</b>${diff(total, totalLast, fmtDur)}</div>
      <div class="db-kpi"><small>${t('tch.d.kOpen')}</small><b>${open.length}</b><em>${t('tch.d.kOpenToday', { n: open.filter((r) => now - r.at < 864e5).length })}</em></div>
    </div>
    <div class="db">
      <div class="db-card"><h2>${t('tch.d.all')}</h2>
        ${students.length ? `<table class="db-tbl"><thead><tr><th>${t('tch.d.cStudent')}</th><th>${t('prog.cWeek')}</th><th>${t('prog.cStreak')}</th><th>${t('prog.cBest')}</th><th>${t('prog.cLast')}</th><th>${t('plan.col')}</th><th>${t('tch.d.cOpen')}</th></tr></thead><tbody>
        ${rows.map((r) => `<tr data-go="${esc(r.s.id)}"><td><div class="who">${T.avatarHTML(r.s, 34)}<span><b>${esc(r.s.name)}</b><small>${esc(r.s.contact || t('tch.noContact'))}</small></span></div></td>${progCells(r)}<td>${esc(V.dashCell(r.s, r.p && !r.p.err && !r.p.gone ? r.p : null))}</td><td>${r.open ? `<span class="tp">${r.open}</span>` : ''}</td></tr>`).join('')}
        </tbody></table>` : `<p class="muted db-empty">${t('tch.emptyBody')}</p>`}
      </div>
      <div class="db-side">
        <div class="db-card"><h2>${t('tch.rq.head')} <span class="muted">${open.length}</span></h2>
          <div class="db-filters"><button class="chip active" data-f="">${t('tch.d.fAll')}</button><button class="chip" data-f="check">${t('chk.filter')}</button><button class="chip" data-f="wish">${t('tch.d.fWish')}</button><button class="chip" data-f="ask">${t('tch.d.fAsk')}</button><button class="chip" data-f="closed">${t('tch.d.fClosed')}</button></div>
          <div class="tch-reqs" id="dReqs"></div></div>
        <div class="db-card"><h2>${t('tch.d.attention')}</h2><div class="att">${attention.length ? attention.map((a) => `<p><span class="${a.c}">${a.n}</span> ${esc(a.txt)}</p>`).join('') : `<p class="muted">${t('tch.d.allGood')}</p>`}</div></div>
      </div>
    </div></section>`;
  const nameOf = (sid) => students.find((s) => s.id === sid)?.name || '?';
  let f = '';
  const drawReqs = () => {
    const list = reqs.filter((r) => (f === 'closed' ? !isOpen(r) : isOpen(r) && (!f || r.type === f)));
    root.querySelector('#dReqs').innerHTML = list.length ? list.map((r) => reqHTML(r, nameOf(r.sid))).join('') : `<p class="muted small db-empty">${t('tch.d.noReqs')}</p>`;
  };
  drawReqs();
  root.querySelector('.db-filters').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; f = b.dataset.f; root.querySelectorAll('.db-filters .chip').forEach((x) => x.classList.toggle('active', x === b)); drawReqs(); });
  bindReqs(root, () => renderDashboard(root));
  root.querySelector('tbody')?.addEventListener('click', (e) => { const tr = e.target.closest('[data-go]'); if (tr) location.hash = '#/ucenik/' + encodeURIComponent(tr.dataset.go); });
  root.querySelector('#tAdd').addEventListener('click', async () => { const s = await addStudentFlow(); if (s) location.hash = '#/ucenik/' + encodeURIComponent(s.id); });
  root.querySelector('#dQrCard').addEventListener('click', printInstallCard);
  root.querySelector('#dSendSet').addEventListener('click', async () => {
    const c2 = await import('./collections.js'); const sets2 = await c2.getSetlists();
    const id = await chooseFrom(t('tch.what.set'), sets2.map((sl) => ({ id: sl.id, label: sl.name, sub: songsCount((sl.songIds || []).length) })));
    const sl = sets2.find((x) => x.id === id); if (sl) { await setlistStudents(sl, { send: true }); renderDashboard(root); }
  });
}

// ---------------- v1.80: napredak (kartica kod nastavnika i kod učenika) ----------------
/** Nazivi igara (pr.g.*) su u practiceText.js — učitaju se samo uz Vežbe; ovde se dodaju po potrebi. */
async function prTexts() { const [{ LANGS }, X] = await Promise.all([import('./i18n.js'), import('./practiceText.js')]); for (const l of ['sr', 'en']) if (LANGS[l] && X[l] && !LANGS[l]['pr.g.pauk']) Object.assign(LANGS[l], X[l]); }
const WD = () => (getLang() === 'en' ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['P', 'U', 'S', 'Č', 'P', 'S', 'N']);
/** Isti izgled kao „Ova nedelja“ u Vežbama: tri pločice + spisak igara i pesama. */
export function progressBodyHTML(w, fmtDur, { who = '' } = {}) {
  const max = Math.max(1, ...w.days);
  const todayIdx = (new Date().getDay() + 6) % 7;
  const gameRows = (w.games || []).filter((g) => !(g.id === 'pesma' && (w.songs || []).length)).slice(0, 4).map((g) => `<div class="tch-pl"><span>${esc(t('pr.g.' + g.id))}</span><small>${esc(countOf(g.n, ROUNDS))}${g.best ? ' · ' + t('prog.best', { n: g.best }) : ''}</small></div>`);
  const songRows = (w.songs || []).slice(0, 3).map((s) => `<div class="tch-pl"><span>${esc(t('prog.song', { title: s.title }))}</span><small>${esc(countOf(s.n, ROUNDS))} · ${s.from !== s.to ? `${s.from}% → ${s.to}%` : `${s.to}%`}</small></div>`);
  return `<div class="st-week tch-pw">
      <div class="st-wk"><small>${t('prog.practiced')}</small><b>${fmtDur(w.total)}</b>${w.lastWeek && w.total !== w.lastWeek ? `<em class="${w.total > w.lastWeek ? 'up' : ''}">${w.total > w.lastWeek ? '+' : '−'}${fmtDur(Math.abs(w.total - w.lastWeek))} ${t('st.vsLast')}</em>` : `<em>${t('st.thisWeek')}</em>`}</div>
      <div class="st-wk"><small>${t('prog.streak')}</small><b>${w.streak || 0}</b><em>${esc(countOf(w.rounds || 0, ROUNDS))}</em></div>
      <div class="st-wk"><span class="st-bars" aria-hidden="true">${w.days.map((v, i) => `<i class="${w.cur && i === todayIdx ? 't' : ''}" style="height:${Math.round((v / max) * 100)}%"></i>`).join('')}</span><span class="st-days">${WD().map((n, i) => `<i class="${w.cur && i === todayIdx ? 't' : ''}">${n}</i>`).join('')}</span></div>
    </div>
    ${gameRows.length + songRows.length ? `<div class="set-grp tch-plist">${[...gameRows, ...songRows].join('')}</div>` : `<p class="muted small tch-none">${who ? t('prog.nothingWeek', { name: who }) : t('prog.nothingMine')}</p>`}`;
}
async function progressCardHTML(s, fresh = false) {
  const P = await import('./progress.js'), { fmtDur } = await import('./statsView.js');
  await prTexts();
  const p = await P.studentProgress(s, { fresh });
  const head = (extra = '') => `<div class="tch-sec"><span>${t('prog.headWeek')}</span>${extra}</div>`;
  if (!p || p.gone) return `${head()}<p class="muted small tch-none">${t('prog.stopped', { name: s.name })}</p>`;
  if (p.err) return `${head()}<p class="muted small tch-none">${t('prog.err')}</p>`;
  const w = P.thisWeek(p);
  return `${head(`<small class="muted">${t(p.via === 'msg' ? 'prog.viaMsg' : 'prog.updated', { d: when(p.at) })}</small>`)}${progressBodyHTML(w, fmtDur, { who: s.name })}<p class="tch-lock">🔒 ${t('prog.lockTeacher', { name: s.name })}</p>`;
}

// ---------------- v1.80: „Proveri pesmu“ ----------------
/** Nastavnik: šta da radi sa pesmom koju učenik želi da proveri (4 izbora). */
export async function checkFlow(reqId, pkg = null) {
  const r = (await T.getRequests()).find((x) => x.id === reqId); if (!r) return;
  const st = await T.getStudent(r.sid); if (!st) return;
  const opts = [['fix', '✏️'], ['mine', '🎸'], ['copy', '📥'], ['ok', '👍']];
  let pick = 'fix';
  const p = dialog({ title: t('chk.tTitle', { name: st.name, title: r.title }), html: true, className: 'tch-dlg', body: `
    ${r.note ? `<p class="small muted">„${esc(r.note)}“</p>` : ''}
    <div class="tch-opts" role="radiogroup">${opts.map(([k, i]) => `<button type="button" class="tch-opt${k === pick ? ' on' : ''}" data-o="${k}" role="radio" aria-checked="${k === pick}"><span class="tch-opt-ic">${i}</span><span><b>${esc(t('chk.o.' + k))}</b><small>${esc(t('chk.o.' + k + 'Sub', { name: st.name }))}</small></span></button>`).join('')}</div>`,
    buttons: [{ label: t('common.cancel'), value: null }, { label: t('tch.next'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  box.querySelector('.tch-opts').addEventListener('click', (e) => { const b = e.target.closest('[data-o]'); if (!b) return; pick = b.dataset.o; box.querySelectorAll('.tch-opt').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }); });
  if ((await p) !== 'ok') return;
  const getPkg = async () => pkg || (await (await import('./shareImport.js')).fetchPackage(r.fileId));
  const importHere = async (extra = {}) => {
    const k = await getPkg(); if (!k || !k.songs.length) { toast(t('share.r.gone'), 'error'); return null; }
    const { importTagged } = await import('./shareImport.js');
    const res = await importTagged(k, r.fileId, () => ({ student: st.id, fromStudent: 1, ...extra }));
    return res.ids[0];
  };
  if (pick === 'fix') {
    const id = await importHere({ chk: { rid: r.id, sid: st.id, ps: r.ps || '' } }); if (!id) return;
    await T.setRequest(r.id, { status: 'editing', songId: id });
    toast(t('chk.editHint', { name: st.name }));
    location.hash = '#/uredi/' + encodeURIComponent(id);
  } else if (pick === 'mine') {
    const item = await pickItem('song', [st], `${r.title} ${r.artist || ''}`.trim());
    if (item) await sendMenu([st], { ...item, msgKey: 'chk.msgMine' }, { rq: r.id, rp: r.ps || '' });
  } else if (pick === 'copy') {
    const id = await importHere(); if (!id) return;
    await T.setRequest(r.id, { status: 'copy', doneAt: Date.now(), songId: id });
    toast(t('tch.got.savedAt', { name: st.name }));
  } else if (pick === 'ok') await T.answerOk(r);
  if (/^#\/ucenik/.test(location.hash) && pick !== 'fix') window.dispatchEvent(new HashChangeEvent('hashchange')); // osveži Učenike / učenika
}
/** Nastavnik: ispravljena pesma nazad učeniku (zamenjuje njegovu; stara ostaje u njegovim Prethodnim verzijama). */
export async function sendFix(song) {
  if (!song || !song.chk) return;
  const st = await T.getStudent(song.chk.sid); if (!st) { toast(t('tch.rq.noStudent')); return; }
  const S = await import('./shareService.js');
  await sendMenu([st], { kind: 'song', name: song.title, share: S.songItem(song), msgKey: 'chk.msgFix' }, { rq: song.chk.rid, rp: song.chk.ps || '' });
}
/** Stavke za „⋯“ pesme (obična i TAB): nastavnik / učenik. */
export async function teachMenuItems(song) {
  const items = [];
  try {
    const [on, my] = await Promise.all([T.isTeacher(), T.getMyTeacher()]);
    const { REC_FOLDER } = await import('./collections.js');
    const isRec = !!song.recording || (song.folders || []).includes(REC_FOLDER);
    if (on && song.chk && song.student) { const st = await T.getStudent(song.chk.sid); if (st) items.push({ value: 'chkSend', label: t('chk.sendFixTo', { name: st.name }), sub: t('chk.sendFixSub'), icon: 'students' }); }
    if (on) items.push({ value: 'toStudent', label: t('tch.sendToStudent'), sub: t('tch.sendToStudentSub'), icon: 'students' });
    if (my) items.push({ value: 'toTeacher', label: t('tch.sendToTeacher'), sub: t('tch.sendToTeacherSub', { t: my.name || t('tch.teacher') }), icon: 'students' });
    if (my && !isRec && !song.fromT) items.push({ value: 'check', label: t('chk.ask'), sub: t('chk.askSub', { t: my.name || t('tch.teacher') }), icon: 'students' });
  } catch {}
  return items;
}
/** Vraća true ako je izbor iz „⋯“ obrađen ovde. */
export async function handleTeachMenu(v, song) {
  if (v === 'toTeacher') { await sendToTeacher(song); return true; }
  if (v === 'toStudent') { await sendSongToStudents(song); return true; }
  if (v === 'chkSend') { await sendFix(song); return true; }
  if (v === 'check') { await askCheckFlow(song); return true; }
  return false;
}
/** Učenik: „Proveri sa nastavnikom“ — napomena (nije obavezna), pa poruka. */
export async function askCheckFlow(song) {
  const m = await T.getMyTeacher(); if (!m) return;
  const p = dialog({ title: t('chk.ask'), html: true, className: 'tch-dlg', body: `
    <p class="small muted">${esc(t('chk.askBody', { t: m.name || t('tch.teacher'), title: song.title }))}</p>
    <label class="tch-lab">${t('tch.rq.note')} <span class="muted">${t('tch.optional')}</span></label><textarea id="chkN" rows="2" maxlength="300" placeholder="${esc(t('chk.notePh'))}"></textarea>
    <p class="tch-lock">🔒 ${t('chk.lock', { t: m.name || t('tch.teacher') })}</p>`, buttons: [{ label: t('common.cancel'), value: null }, { label: t('tch.next'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  let note = ''; box.querySelector('#chkN').addEventListener('input', (e) => (note = e.target.value));
  if ((await p) !== 'ok') return;
  await T.askCheck(song, note);
}

// ---------------- v1.79: učenik — „Pitaj nastavnika“ ----------------
export async function askTeacherFlow(type) {
  const p = dialog({ title: t(type === 'wish' ? 'tch.rq.wish' : 'tch.rq.ask'), html: true, className: 'tch-dlg', body: `
    <label class="tch-lab">${t('tch.rq.title')}</label><input id="rqT" maxlength="80" autocomplete="off">
    <label class="tch-lab">${t('tch.rq.artist')} <span class="muted">${t('tch.optional')}</span></label><input id="rqA" maxlength="60" autocomplete="off">
    <label class="tch-lab">${t('tch.rq.note')} <span class="muted">${t('tch.optional')}</span></label><textarea id="rqN" rows="2" maxlength="300"></textarea>
    <p class="tch-lock">🔒 ${t('tch.rq.lock')}</p>`, buttons: [{ label: t('common.cancel'), value: null }, { label: t('tch.next'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  const v = { t: '', a: '', n: '' };
  box.querySelector('#rqT').addEventListener('input', (e) => (v.t = e.target.value));
  box.querySelector('#rqA').addEventListener('input', (e) => (v.a = e.target.value));
  box.querySelector('#rqN').addEventListener('input', (e) => (v.n = e.target.value));
  setTimeout(() => box.querySelector('#rqT')?.focus(), 50);
  if ((await p) !== 'ok') return false;
  if (!v.t.trim()) { toast(t('tch.rq.needTitle')); return askTeacherFlow(type); }
  return T.askTeacher({ type, title: v.t, artist: v.a, note: v.n });
}
