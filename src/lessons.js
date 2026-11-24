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

/** Dijalog beleške (jedan ili više učenika). lastHw: „↺ Prošli domaći“ upisuje poslednji domaći. */
async function noteDialog(title, lock, init = {}, lastHw = '') {
  const p = dialog({ title, html: true, className: 'tch-dlg les-dlg', body: `
    <label class="tch-lab">${t('les.did')}</label><textarea id="lnDid" rows="3" maxlength="600" placeholder="${esc(t('les.didPh'))}">${esc(init.did || '')}</textarea>
    <label class="tch-lab les-hw-lab">${t('les.hw')}${lastHw ? ` <button type="button" class="linkish les-copy" id="lnLast">↺ ${esc(t('les.lastHw'))}</button>` : ''}</label><textarea id="lnHw" rows="3" maxlength="600" placeholder="${esc(t('les.hwPh'))}">${esc(init.hw || '')}</textarea>
    <p class="tch-lock">🔒 ${esc(lock)}</p>`,
  buttons: [{ label: t('common.cancel'), value: null }, { label: t('les.send'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  setTimeout(() => box.querySelector(init.hw && !init.did ? '#lnDid' : '#lnDid')?.focus(), 50);
  const val = { did: init.did || '', hw: init.hw || '' };
  box.querySelector('#lnDid').addEventListener('input', (e) => (val.did = e.target.value));
  box.querySelector('#lnHw').addEventListener('input', (e) => (val.hw = e.target.value));
  box.querySelector('#lnLast')?.addEventListener('click', () => { const h = box.querySelector('#lnHw'); h.value = lastHw; val.hw = lastHw; h.focus(); });
  if ((await p) !== 'ok') return null;
  const did = clip(val.did, 600), hw = clip(val.hw, 600);
  return did || hw ? { did, hw } : null;
}
/** Sačuvaj belešku kod učenika i pošalji je u sanduče. */
async function sendNote(sid, n, quiet = false) {
  const tm = await TM(); const st = await tm.getStudent(sid); if (!st) return false;
  const notes = [n, ...((st.notes || []).filter((x) => x.id !== n.id))].sort((a, b) => b.at - a.at).slice(0, 40);
  await tm.updateStudent(sid, { notes });
  if (quiet && !(st.box && st.box.f)) return false;
  return put(sid, { key: 'note:' + n.id, kind: 'note', id: n.id, did: n.did, hw: n.hw, name: t('les.noteName', { d: dShort(n.at) }) });
}
/** Beleška sa časa: šta smo radili + domaći (dijalog). prefill: npr. kopiran domaći sa ranijeg časa. */
export async function noteFlow(sid, edit = null, prefill = null) {
  const tm = await TM(); const st = await tm.getStudent(sid); if (!st) return false;
  const last = (st.notes || []).find((x) => x.hw && (!edit || x.id !== edit.id));
  const v = await noteDialog(t('les.noteT', { name: st.name }), t('les.noteLock', { name: st.name }), edit || prefill || {}, edit ? '' : (last ? last.hw : ''));
  if (!v) return false;
  const { did, hw } = v;
  const n = { id: edit ? edit.id : uid(), at: edit ? edit.at : Date.now(), did, hw };
  if (await sendNote(sid, n)) toast(t('les.noteSent', { name: st.name }));
  return true;
}

/** v2.4.9: sve beleške sa časova (nastavnik) — uredi ili „Kopiraj domaći“ u novu belešku. */
export async function historyFlow(sid) {
  const tm = await TM(); const st = await tm.getStudent(sid); if (!st) return false;
  const notes = st.notes || [];
  const p = dialog({ title: t('les.histT', { name: st.name }), html: true, className: 'tch-dlg les-dlg les-hist', body: notes.length
    ? `<div class="les-hlist">${notes.map((n) => `<div class="les-h"><div class="les-h-top"><b>${esc(dShort(n.at))}</b>${statusHTML(st, 'note:' + n.id)}</div>${n.hw ? `<p class="les-h-hw">📝 ${esc(n.hw)}</p>` : ''}${n.did ? `<p class="muted small">${esc(n.did)}</p>` : ''}
        <div class="les-h-btns"><button type="button" class="btn small" data-hedit="${esc(n.id)}">${esc(t('les.edit'))}</button>${n.hw ? `<button type="button" class="btn small" data-hcopy="${esc(n.id)}">↺ ${esc(t('les.copyHw'))}</button>` : ''}</div></div>`).join('')}</div>`
    : `<p class="muted">${esc(t('les.histEmpty'))}</p>`,
  buttons: [{ label: t('common.close'), value: null }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  let act = null;
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-hedit],[data-hcopy]'); if (!b) return; act = b.dataset.hedit ? { edit: b.dataset.hedit } : { copy: b.dataset.hcopy }; box.__close?.(); box.querySelector('.modal-actions button')?.click(); });
  await p;
  if (!act) return false;
  const n = notes.find((x) => x.id === (act.edit || act.copy)); if (!n) return false;
  return act.edit ? noteFlow(sid, n) : noteFlow(sid, null, { hw: n.hw });
}

/** v2.4.10: paket za čas (PDF) — beleška, domaći, sledeći čas, cilj i izabrane pesme (podrazumevano poslate u poslednje 2 nedelje). */
export async function kitFlow(sid) {
  const tm = await TM(); const st = await tm.getStudent(sid); if (!st) return false;
  const { songs: sdb } = await import('./db.js');
  const sent = (await tm.sentSongs()).filter((e) => e.sids && e.sids[sid]).sort((a, b) => b.sids[sid] - a.sids[sid]);
  const avail = []; for (const e of sent) { const s = await sdb.get(e.id).catch(() => null); if (s && !s.deleted && !s.recording) avail.push({ s, at: e.sids[sid] }); }
  const sel = new Set(avail.filter((x) => Date.now() - x.at < 14 * 864e5).slice(0, 8).map((x) => x.s.id));
  const p = dialog({ title: t('kit.title', { name: st.name }), html: true, className: 'tch-dlg les-dlg les-kit', body: `
    <p class="muted small">${esc(t('kit.sub'))}</p>
    ${avail.length ? `<div class="bulk-list les-glist">${avail.slice(0, 60).map(({ s, at }) => `<button type="button" class="bulk-it${sel.has(s.id) ? ' on' : ''}" data-kid="${esc(s.id)}" role="checkbox" aria-checked="${sel.has(s.id)}"><span class="bulk-cb">${sel.has(s.id) ? '✓' : ''}</span><span class="bulk-t"><b>${esc(s.title || '')}</b><small class="muted">${esc([s.artist, dShort(at)].filter(Boolean).join(' · '))}</small></span></button>`).join('')}</div>` : `<p class="muted small">${esc(t('kit.noSongs'))}</p>`}`,
  buttons: [{ label: t('common.cancel'), value: null }, { label: '🖨 ' + t('kit.make'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-kid]'); if (!b) return; const id = b.dataset.kid; sel.has(id) ? sel.delete(id) : sel.add(id); const on = sel.has(id); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); b.querySelector('.bulk-cb').textContent = on ? '✓' : ''; });
  if ((await p) !== 'ok') return false;
  toast(t('kit.making'));
  const { transposeSong } = await import('./songformat.js');
  const songs = avail.filter((x) => sel.has(x.s.id)).map(({ s }) => ({ ...(s.type === 'tab' ? s : transposeSong(s, (s.transpose || 0) - (s.capo || 0))), title: s.title, artist: s.artist, key: s.key, strum: s.strum }));
  const n = (st.notes || [])[0]; const { fmtDur } = await import('./statsView.js');
  const older = (st.notes || []).slice(1, 4).filter((x) => x.hw).map((x) => `${dShort(x.at)}: ${x.hw}`).join('\n');
  const blocks = [
    st.next && st.next > Date.now() - 3600e3 ? { label: t('les.nextLesson'), text: lessonWhen(st.next) } : null,
    Number(st.goal) ? { label: t('les.goalNo'), text: t('les.goalPer', { d: fmtDur(Number(st.goal) * 60000) }) } : null,
    n && n.hw ? { label: t('les.hw') + ' (' + dShort(n.at) + ')', text: n.hw } : null,
    n && n.did ? { label: t('les.did'), text: n.did } : null,
    older ? { label: t('kit.older'), text: older } : null,
  ].filter(Boolean);
  try {
    const P = await import('./pdf.js'); const tc = await tm.getTeacher();
    const d = new Date(); const date = `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}.`;
    const blob = await P.kitToPdf({ title: t('kit.pdfTitle', { name: st.name }), sub: [tc.name, date].filter(Boolean).join(' · '), blocks, songs });
    const S = await import('./shareService.js');
    const r = await S.shareFile(blob, `MARLI - ${String(st.name || '').replace(/[\\/:*?"<>|]+/g, '')} - ${date}.pdf`, t('kit.pdfTitle', { name: st.name }));
    if (r === 'downloaded') toast(t('song.pdfDownloaded'));
    return false;
  } catch (e) { console.error(e); toast(t('kit.fail'), 'error'); return false; }
}

/** v2.4.9: cilj vežbanja (minuti nedeljno) — učeniku se postavi na kartici „Ova nedelja“. */
export const GOALS = [0, 60, 120, 180, 300, 420];
async function goalDialog(title, cur = 0) {
  const { fmtDur } = await import('./statsView.js');
  const v = await dialog({ title, body: t('les.goalBody'), buttons: GOALS.map((m) => ({ label: m ? t('les.goalPer', { d: fmtDur(m * 60000) }) : t('les.goalNone'), value: String(m), kind: m === cur ? 'primary' : '' })) });
  return v == null || v === false ? null : Number(v);
}
async function sendGoal(sid, min) {
  const tm = await TM();
  await tm.updateStudent(sid, { goal: min });
  return put(sid, { key: 'goal', kind: 'goal', min, name: min ? t('les.goalName', { n: min }) : t('les.goalOff') });
}
export async function goalFlow(sid) {
  const tm = await TM(); const st = await tm.getStudent(sid); if (!st) return false;
  const min = await goalDialog(t('les.goalT', { name: st.name }), Number(st.goal) || 0);
  if (min == null) return false;
  if (await sendGoal(sid, min)) toast(min ? t('les.goalSent', { name: st.name }) : t('les.goalCleared', { name: st.name }));
  return true;
}

/** v2.4.9: više učenika odjednom — ista beleška/domaći, cilj ili podsetnik. */
export async function groupFlow(preSel = []) {
  const tm = await TM(); const sts = await tm.getStudents();
  if (!sts.length) { toast(t('les.groupNone')); return false; }
  const sel = new Set(preSel.length ? preSel : []);
  const p = dialog({ title: t('les.groupT'), html: true, className: 'tch-dlg les-dlg les-group', body: `
    <p class="muted small">${esc(t('les.groupSub'))}</p>
    <div class="les-gtop"><button type="button" class="linkish" id="lgAll">${esc(t('les.groupAll'))}</button></div>
    <div class="bulk-list les-glist">${sts.map((s) => `<button type="button" class="bulk-it${sel.has(s.id) ? ' on' : ''}" data-sid="${esc(s.id)}" role="checkbox" aria-checked="${sel.has(s.id)}"><span class="bulk-cb">${sel.has(s.id) ? '✓' : ''}</span><span class="bulk-t"><b>${esc(s.name)}</b>${s.box && s.box.f ? '' : `<small class="muted">${esc(t('les.groupNoBox'))}</small>`}</span></button>`).join('')}</div>`,
  buttons: [{ label: t('common.cancel'), value: null }, { label: '🔔 ' + t('les.remind'), value: 'nudge' }, { label: '🎯 ' + t('les.goalBtn'), value: 'goal' }, { label: '📝 ' + t('les.addNote'), value: 'note', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  const sync = () => { box.querySelectorAll('[data-sid]').forEach((b) => { const on = sel.has(b.dataset.sid); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); b.querySelector('.bulk-cb').textContent = on ? '✓' : ''; }); box.querySelectorAll('.modal-actions button').forEach((b, i) => { if (i) b.disabled = !sel.size; }); };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sid]'); if (b) { const id = b.dataset.sid; sel.has(id) ? sel.delete(id) : sel.add(id); sync(); return; }
    if (e.target.closest('#lgAll')) { const all = sel.size === sts.length; sts.forEach((s) => (all ? sel.delete(s.id) : sel.add(s.id))); sync(); }
  });
  sync();
  const what = await p;
  if (!what || !sel.size) return false;
  const to = sts.filter((s) => sel.has(s.id));
  let ok = 0;
  if (what === 'note') {
    const v = await noteDialog(t('les.groupNoteT', { n: to.length }), t('les.groupLock')); if (!v) return false;
    const at = Date.now();
    for (const s of to) if (await sendNote(s.id, { id: uid(), at, did: v.did, hw: v.hw }, true)) ok++;
  } else if (what === 'goal') {
    const min = await goalDialog(t('les.groupGoalT', { n: to.length })); if (min == null) return false;
    for (const s of to) if (s.box && s.box.f && await sendGoal(s.id, min)) ok++;
  } else if (what === 'nudge') {
    for (const s of to) if (s.box && s.box.f && await nudge(s.id, true)) ok++;
  }
  toast(ok === to.length ? t('les.groupDone', { n: ok }) : t('les.groupPart', { n: ok, m: to.length }));
  return ok > 0;
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
export async function nudge(sid, quiet = false) {
  const tm = await TM(); const st = await tm.getStudent(sid); if (!st) return false;
  const day = new Date().toISOString().slice(0, 10);
  if (await put(sid, { key: 'nudge:' + day, kind: 'nudge', name: t('les.nudgeName') })) { await tm.updateStudent(sid, { nudged: Date.now() }); if (!quiet) toast(t('les.nudged', { name: st.name })); return true; }
  return false;
}

const CAL = '<svg viewBox="0 0 24 24" aria-hidden="true" class="les-cal"><path d="M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zM5 9h14v10H5zm2 2v3h3v-3z"/></svg>';
const KIND_IC = { song: '♪', set: '☰', note: '📝', lesson: CAL, nudge: '🔔', plan: '🗓', ex: '🎯', rp: '🥁', ans: '💬', cmt: '💬', goal: '🎯' };
/** Status jedne poslate stavke: viđeno / odgovor. */
function statusHTML(st, key) {
  const r = (st.reacts || {})[key], seen = (st.seen || {})[key];
  if (r) return `<em class="les-st les-r" title="${esc(t('les.r.' + r.r))}">${REACT_IC[r.r] || ''} ${esc(t('les.r.' + r.r))}</em>`;
  if (seen) return `<em class="les-st les-seen">✓ ${esc(t('les.seen'))}</em>`;
  return `<em class="les-st les-wait">${esc(t('les.notSeen'))}</em>`;
}

const goalLine = (st) => (Number(st.goal) ? t('les.goalIs', { n: Number(st.goal) }) : t('les.goalNo'));
/** Odeljak „Časovi“ na stranici učenika (nastavnik, telefon i računar). */
export async function drawTeacher(box, sid, rerender) {
  if (!box) return;
  const tm = await TM(); const st = await tm.getStudent(sid); if (!st) return;
  const notes = (st.notes || []).slice(0, 3);
  const sent = (st.sent || []).slice(-8).reverse();
  box.innerHTML = `<div class="tch-sec"><span>${t('les.head')}</span></div>
    <div class="set-grp les-grp">
      <button type="button" class="tch-row les-next" data-l="next"><span class="sr-ic">${CAL}</span><span><b>${st.next && st.next > Date.now() - 3600e3 ? esc(lessonWhen(st.next)) : esc(t('les.noNext'))}</b><small>${esc(t('les.nextSub'))}</small></span><span class="sr-chev" aria-hidden="true">›</span></button>
      <button type="button" class="tch-row les-goal" data-l="goal"><span class="sr-ic">🎯</span><span><b>${esc(goalLine(st))}</b><small id="lesGoalProg">${esc(t('les.goalSub'))}</small></span><span class="sr-chev" aria-hidden="true">›</span></button>
      <button type="button" class="tch-row" data-l="note"><span class="sr-ic">📝</span><span><b>${esc(t('les.addNote'))}</b><small>${esc(t('les.addNoteSub'))}</small></span><span class="sr-chev" aria-hidden="true">›</span></button>
      ${notes.map((n) => `<button type="button" class="tch-row les-note" data-edit="${esc(n.id)}"><span class="sr-ic les-d">${esc(dShort(n.at))}</span><span><b>${esc(n.hw ? t('les.hwShort', { hw: n.hw }) : n.did)}</b>${n.hw && n.did ? `<small>${esc(n.did)}</small>` : ''}</span>${statusHTML(st, 'note:' + n.id)}</button>`).join('')}
      ${(st.notes || []).length > 3 || (st.notes || []).some((n) => n.hw) ? `<button type="button" class="tch-row les-more" data-l="hist"><span class="sr-ic">🗂</span><span><b>${esc(t('les.histBtn', { n: (st.notes || []).length }))}</b><small>${esc(t('les.histSub'))}</small></span><span class="sr-chev" aria-hidden="true">›</span></button>` : ''}
      <button type="button" class="tch-row les-kitrow" data-l="kit"><span class="sr-ic">🖨</span><span><b>${esc(t('kit.btn'))}</b><small>${esc(t('kit.btnSub'))}</small></span><span class="sr-chev" aria-hidden="true">›</span></button>
    </div>
    ${sent.length ? `<div class="tch-sec"><span>${t('les.sentHead')}</span></div><div class="set-grp les-sent">${sent.map((x) => `<div class="tch-row"><span class="sr-ic">${KIND_IC[x.kind] || '•'}</span><span><b>${esc(x.name || t('les.k.' + x.kind))}</b><small>${esc(dShort(x.at))}</small></span>${statusHTML(st, x.key)}</div>`).join('')}</div>` : ''}`;
  // v2.4.11: šta još čeka slanje (Google je usporio)
  (async () => { const B = await BX(); const n = await B.pendingCount(sid); if (n && box.isConnected && !box.querySelector('.les-pend')) box.querySelector('.les-grp')?.insertAdjacentHTML('afterbegin', `<div class="tch-row les-pend"><span class="sr-ic">⏳</span><span><b>${esc(t('box.pending', { n }))}</b><small>${esc(t('box.queued'))}</small></span></div>`); })().catch(() => {});
  // cilj: koliko je ove nedelje (ako učenik deli napredak)
  if (Number(st.goal) && st.prog) (async () => { const P = await import('./progress.js'); const pr = await P.studentProgress(st).catch(() => null); const w = pr && !pr.err ? P.thisWeek(pr) : null; const el = box.querySelector('#lesGoalProg'); if (w && el) { const { fmtDur } = await import('./statsView.js'); el.textContent = t('les.goalProg', { d: fmtDur(w.total), g: fmtDur(Number(st.goal) * 60000) }); } })().catch(() => {});
  box.onclick = async (e) => {
    const b = e.target.closest('[data-l],[data-edit]'); if (!b) return;
    let changed = false;
    if (b.dataset.l === 'next') changed = await nextFlow(sid);
    else if (b.dataset.l === 'goal') changed = await goalFlow(sid);
    else if (b.dataset.l === 'hist') changed = await historyFlow(sid);
    else if (b.dataset.l === 'kit') changed = await kitFlow(sid);
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
  if (it.kind === 'goal') { // v2.4.9: nastavnik postavio cilj — to je i moj cilj na kartici „Ova nedelja“ (mogu da ga promenim)
    const min = Math.max(0, Math.min(1200, Math.round(Number(it.min) || 0)));
    const { settings } = await import('./db.js'); await settings.set('weekGoal', min);
    await tm.setMyTeacher({ ...cur, goal: min });
    const { fmtDur } = await import('./statsView.js');
    return { t: min ? t('les.ntGoal', { t: m.name || t('tch.teacher') }) : t('les.ntGoalOff', { t: m.name || t('tch.teacher') }), s: min ? t('les.goalPer', { d: fmtDur(min * 60000) }) : '', href: '#/vezbe' };
  }
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
    ${(m.notes || []).length > 1 ? `<button type="button" class="linkish les-older" data-lhist>${esc(t('les.older', { n: m.notes.length - 1 }))} ›</button>` : ''}
  </div>`;
}
export async function drawStudent(box) {
  if (!box) return;
  const tm = await TM(); const m = await tm.getMyTeacher(); if (!m) { box.innerHTML = ''; return; }
  box.innerHTML = await studentCardHTML(m);
  if (!box.dataset.bound) { box.dataset.bound = '1'; bindReacts(box); box.addEventListener('click', (e) => { if (e.target.closest('[data-lhist]')) studentHistory(); }); }
  const keys = [(m.notes || [])[0] && ((m.notes[0].key) || 'note:' + m.notes[0].id), m.next ? m.nextKey || 'lesson' : ''].filter(Boolean);
  if (keys.length) markSeen(keys);
}

/** v2.4.9: učenik — ranije beleške sa časova (samo čitanje). */
async function studentHistory() {
  const tm = await TM(); const m = await tm.getMyTeacher(); if (!m) return;
  await dialog({ title: t('les.histMine', { t: m.name || t('tch.teacher') }), html: true, className: 'tch-dlg les-dlg les-hist', body: `<div class="les-hlist">${(m.notes || []).map((n) => `<div class="les-h"><div class="les-h-top"><b>${esc(dShort(n.at))}</b></div>${n.hw ? `<p class="les-h-hw">📝 ${esc(n.hw)}</p>` : ''}${n.did ? `<p class="muted small">${esc(n.did)}</p>` : ''}</div>`).join('')}</div>`, buttons: [{ label: t('common.close'), value: null }] });
}
/** Učenik: podsetnik dan pre časa (jednom). */
export async function studentReminder() {
  const tm = await TM(); const m = await tm.getMyTeacher();
  if (!m || !m.next || m.next < Date.now() || m.next - Date.now() > 26 * 3600e3) return;
  const N = await import('./notify.js');
  await N.add({ id: 'les:me:' + m.next, who: (String(m.name || 'M')[0] || 'M').toUpperCase(), c: '#f5a524', t: t('les.ntSoon', { w: lessonWhen(m.next) }), s: (m.notes || [])[0]?.hw ? t('les.hwShort', { hw: m.notes[0].hw }) : t('les.ntSoonSub'), href: '#/od-nastavnika' });
}
