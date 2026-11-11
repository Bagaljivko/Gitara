// v1.83: ekrani za zadatke i plan učenja — kod učenika (kartica u Vežbama, „Moj plan“ u Od nastavnika)
// i kod nastavnika („Predloži vežbu“, plan po nedeljama na stranici učenika; na računaru nedelje u kolonama,
// zadaci se prevlače mišem). Logika je u plan.js.
import { t, LANGS, countOf, ROUNDS } from './i18n.js';
import { esc, dialog, toast } from './ui.js';
import * as CS from './chordSeq.js';
import { dn } from './naming.js';
import { songs as db } from './db.js';
import * as P from './plan.js';

/** Nazivi igara i koraka skala su u practiceText.js (učitava se uz Vežbe) — ovde po potrebi. */
async function texts() {
  if (LANGS.sr && LANGS.sr['pr.g.pauk'] && LANGS.sr['sk.step.first']) return;
  const X = await import('./practiceText.js');
  for (const l of ['sr', 'en']) if (LANGS[l] && X[l]) for (const [k, v] of Object.entries(X[l])) if (!(k in LANGS[l])) LANGS[l][k] = v;
}
const ICON = { g: '🎯', p: '🎵', s: '🎼', n: '📖' };
const CK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';

// ---------------- učenik ----------------
function progText(x, s) {
  if (s.missing) return t('plan.st.missing');
  const g = x.goal || { t: 'x' };
  if (g.t === 'r') return t('plan.st.r', { v: Math.min(s.v, g.n), n: countOf(g.n, ROUNDS) });
  if (g.t === 'p') return s.v ? t('plan.st.p', { v: s.v, n: g.n }) : t('plan.goal.p', { n: g.n });
  if (g.t === 'm') return t('plan.st.m', { v: Math.min(s.v, g.n), n: g.n });
  return x.k === 'n' ? t('plan.st.learn') : '';
}
function rowHTML(x, s, { lock = false } = {}) {
  const sub = [x.k === 'p' || x.k === 'n' ? t('plan.kind.' + x.k) : '', progText(x, s)].filter(Boolean).join(' · ');
  const manual = x.k === 'n' && (!x.goal || x.goal.t === 'x');
  const btn = lock ? '' : s.done ? (manual && !x.done ? `<button class="btn small pl-undo" data-undo="${esc(x.id)}">${t('plan.undo')}</button>` : '')
    : manual ? `<button class="btn small" data-mine="${esc(x.id)}">${t('plan.learned')}</button><button class="pl-go" data-go="${esc(x.id)}" aria-label="${esc(t('plan.open'))}">›</button>`
    : `<button class="pl-go" data-go="${esc(x.id)}">${t('plan.practice')} ›</button>`;
  return `<div class="pl-tk${s.done ? ' done' : ''}${lock ? ' lock' : ''}"><span class="pl-ck">${s.done ? CK : ''}</span>
    <span class="pl-tb"><b>${esc(P.taskTitle(x))}</b>${sub ? `<small>${esc(sub)}</small>` : ''}${!s.done && !lock && x.goal && x.goal.t !== 'x' && s.v > 0 ? `<span class="pl-bar"><i style="width:${Math.round(s.pct * 100)}%"></i></span>` : ''}</span>${btn}</div>`;
}
function bindRows(el, r, redraw) {
  const all = [...r.loose, ...(r.plan ? r.plan.weeks.flatMap((w) => w.tasks) : [])];
  const find = (id) => all.find((x) => x.id === id);
  el.addEventListener('click', async (e) => {
    const go = e.target.closest('[data-go]'), mine = e.target.closest('[data-mine]'), undo = e.target.closest('[data-undo]');
    if (go) { const x = find(go.dataset.go); if (x) P.openTask(x); }
    if (mine) { await P.markMine(mine.dataset.mine, true); toast(t('plan.doneToast', { what: P.taskTitle(find(mine.dataset.mine)) })); redraw(); }
    if (undo) { await P.markMine(undo.dataset.undo, false); redraw(); }
  });
}
/** Zadaci ove nedelje: tekuća nedelja plana + pojedinačni zadaci (urađeni ostaju vidljivi 3 dana). */
function weekTasks(r) {
  const recent = (x) => { const d = r.m.planDone?.[x.id] || x.done; return !d || Date.now() - d < 3 * 864e5; };
  const loose = r.loose.filter(recent);
  const wk = r.plan && r.cw >= 0 ? r.plan.weeks[r.cw].tasks : [];
  return [...wk, ...loose];
}
/** Vežbe: kartica „Od nastavnika · ove nedelje“. */
export async function drawHubCard(el) {
  await texts();
  const r = await P.myTasks(); if (!r) { el.innerHTML = ''; return; }
  const list = weekTasks(r);
  if (!list.length && !(r.plan && r.cw < 0)) { el.innerHTML = ''; return; }
  const done = list.filter((x) => r.status.get(x.id).done).length;
  const note = [...list].reverse().find((x) => x.note && !r.status.get(x.id).done)?.note;
  const head = r.plan && r.cw >= 0 ? t('plan.weekOf', { n: r.cw + 1, of: r.plan.weeks.length }) : t('plan.thisWeek');
  el.innerHTML = `<div class="pl-card" id="plCard">
    <div class="pl-h"><span class="pl-k">${t('plan.fromT')} · ${esc(head)}</span><small>${list.length ? t('plan.nOf', { d: done, n: list.length }) : ''}</small></div>
    <div class="pl-from">${(await import('./teach.js')).avatarHTML({ name: r.name || '?', color: '#f5a524' }, 22)}<span>${esc(r.name || t('tch.teacher'))}${r.plan ? ` · ${esc(r.plan.title)}` : ''}</span><a href="#/od-nastavnika" class="pl-all">${t('plan.all')} ›</a></div>
    ${list.length ? list.map((x) => rowHTML(x, r.status.get(x.id))).join('') : `<p class="muted small pl-none">${t('plan.allDone')}</p>`}
    ${note ? `<div class="pl-note">„${esc(note)}“</div>` : ''}
  </div>`;
  bindRows(el.firstElementChild, r, () => drawHubCard(el));
}
/** Od nastavnika: ceo plan (tekuća nedelja, sledeća, urađene) + pojedinačni zadaci. */
export async function drawMyPlan(el) {
  await texts();
  const r = await P.myTasks(); if (!r) { el.innerHTML = ''; return; }
  const parts = [];
  if (r.plan) {
    const W = r.plan.weeks, cw = r.cw;
    const seg = W.map((w, i) => `<i class="${cw < 0 || i < cw || (w.done && i !== cw) ? 'd' : i === cw ? 'c' : ''}"></i>`).join('');
    parts.push(`<div class="pl-card"><div class="pl-h"><span class="pl-k">${t('plan.my')}</span><small>${cw < 0 ? t('plan.finished') : t('plan.weekOf', { n: cw + 1, of: W.length })}</small></div>
      <b class="pl-title">${esc(r.plan.title)}</b><div class="pl-seg">${seg}</div>
      ${cw >= 0 ? W[cw].tasks.map((x) => rowHTML(x, r.status.get(x.id))).join('') || `<p class="muted small pl-none">${t('plan.emptyWeek')}</p>` : `<p class="pl-none">🎉 ${t('plan.finishedBody')}</p>`}</div>`);
    if (cw >= 0 && cw + 1 < W.length) parts.push(`<div class="pl-card pl-next"><div class="pl-h"><span class="pl-k">${t('plan.next', { n: cw + 2 })}</span><small>${t('plan.nextWhen')}</small></div>${W[cw + 1].tasks.map((x) => rowHTML(x, r.status.get(x.id), { lock: true })).join('')}</div>`);
    const past = W.map((w, i) => ({ w, i })).filter(({ i }) => cw < 0 || i < cw);
    if (past.length) parts.push(`<div class="pl-card"><div class="pl-h"><span class="pl-k">${t('plan.doneWeeks')}</span></div>${past.map(({ w, i }) => `<div class="pl-tk done"><span class="pl-ck">${CK}</span><span class="pl-tb"><b>${esc(t('plan.weekN', { n: i + 1 }))}</b><small>${esc(w.tasks.map((x) => P.taskTitle(x)).join(' · '))}</small></span></div>`).join('')}</div>`);
  }
  const loose = r.loose.filter((x) => { const d = r.m.planDone?.[x.id] || x.done; return !d || Date.now() - d < 7 * 864e5; });
  if (loose.length) parts.push(`<div class="pl-card"><div class="pl-h"><span class="pl-k">${t('plan.tasks')}</span><small>${t('plan.nOf', { d: loose.filter((x) => r.status.get(x.id).done).length, n: loose.length })}</small></div>${loose.map((x) => rowHTML(x, r.status.get(x.id))).join('')}${loose.filter((x) => x.note).slice(-1).map((x) => `<div class="pl-note">„${esc(x.note)}“</div>`).join('')}</div>`);
  el.innerHTML = parts.length ? `<div><div class="tch-sec"><span>${t('plan.head')}</span></div>${parts.join('')}</div>` : '';
  if (el.firstElementChild) bindRows(el.firstElementChild, r, () => drawMyPlan(el));
}

// ---------------- nastavnik: „Predloži vežbu“ ----------------
const GOALS = { r: [2, 3, 4, 5, 8], p: [70, 75, 80, 85, 90], m: [10, 20, 30, 60] };
/** Dijalog. week: broj nedelje (u plan) ili null. Vraća { task, where: 'loose' | 'plan' } ili null. */
export async function suggestFlow(student, { week = null, hasPlan = false, edit = null } = {}) {
  await texts();
  const lib = (await db.list()).filter((s) => !s.deleted && !s.recording).sort((a, b) => String(a.title).localeCompare(String(b.title)));
  const v = edit ? JSON.parse(JSON.stringify(edit)) : { k: 'g', g: 'promena', pr: ['G', 'C'], goal: { t: 'r', n: 4 }, due: week == null ? 'w' : '', note: '' };
  if (!v.song) v.song = { t: lib[0]?.title || '', a: lib[0]?.artist || '' };
  if (!v.st) v.st = 'first';
  const chip = (on, attrs, label) => `<button type="button" class="chip${on ? ' active' : ''}" ${attrs}>${esc(label)}</button>`;
  const body = () => {
    const rows = [];
    if (v.k === 'g') {
      rows.push([t('plan.f.game'), P.GAME_IDS.map((g) => chip(v.g === g, `data-g="${g}"`, t('pr.g.' + g))).join('')]);
      // v1.96: bilo koji niz akorda (gotovi ili svoj: „G D Em C“)
      if (v.g === 'promena') rows.push([t('plan.f.pair'), CS.PRESETS.map((p) => chip(v.pr && v.pr.join() === p.seq.join(), `data-pr="${p.seq.join()}"`, CS.presetLabel(p))).join('') + `<input id="plSeq" class="pl-seq" maxlength="80" autocomplete="off" spellcheck="false" placeholder="${esc(t('cs.ownPh'))}" value="${esc(v.pr && !CS.PRESETS.some((p) => p.seq.join() === v.pr.join()) ? v.pr.map(dn).join(' ') : '')}">`]);
    }
    if (v.k === 'p') rows.push([t('plan.f.song'), lib.length ? `<select id="plSong">${lib.map((s) => `<option value="${esc(s.id)}"${s.title === v.song.t ? ' selected' : ''}>${esc(s.title)}${s.artist ? ' — ' + esc(s.artist) : ''}</option>`).join('')}</select>` : `<span class="muted small">${t('plan.noLib')}</span>`],
      [t('plan.f.part'), `<input id="plPart" maxlength="40" placeholder="${esc(t('plan.partPh'))}" value="${esc(v.part || '')}">`]);
    if (v.k === 'n') rows.push([t('plan.f.title'), `<input id="plTitle" maxlength="80" value="${esc(v.song.t)}" list="plLib" autocomplete="off"><datalist id="plLib">${lib.slice(0, 300).map((s) => `<option value="${esc(s.title)}">`).join('')}</datalist>`],
      [t('plan.f.artist'), `<input id="plArtist" maxlength="60" value="${esc(v.song.a || '')}">`]);
    if (v.k === 's') rows.push([t('plan.f.step'), P.STEPS.map((s) => chip(v.st === s, `data-st="${s}"`, t('sk.step.' + s))).join('')]);
    const gt = v.goal.t;
    rows.push([t('plan.f.goal'), ['r', 'p', 'm', ...(v.k === 'n' ? ['x'] : [])].map((k) => chip(gt === k, `data-gt="${k}"`, t('plan.gt.' + k))).join('')]);
    if (gt !== 'x') rows.push(['', GOALS[gt].map((n) => chip(v.goal.n === n, `data-gn="${n}"`, P.goalText({ t: gt, n }))).join('')]);
    if (week == null && !edit) rows.push([t('plan.f.due'), chip(v.due === 'w', 'data-due="w"', t('plan.due.w')) + chip(v.due !== 'w', 'data-due=""', t('plan.due.none'))]);
    rows.push([t('plan.f.note'), `<input id="plNote" maxlength="200" placeholder="${esc(t('plan.notePh'))}" value="${esc(v.note || '')}">`]);
    return `<div class="pl-types">${P.KINDS.map((k) => `<button type="button" class="${v.k === k ? 'on' : ''}" data-k="${k}"><span>${ICON[k]}</span>${t('plan.kind.' + k)}</button>`).join('')}</div>
      <div class="pl-form">${rows.map(([l, h]) => `<span>${esc(l)}</span><div class="chips">${h}</div>`).join('')}</div>
      <p class="tch-lock">${esc(t('plan.dlgHint', { name: student.name }))}</p>`;
  };
  const buttons = edit ? [{ label: t('common.cancel'), value: null }, { label: t('common.save'), value: 'plan', kind: 'primary' }]
    : week != null ? [{ label: t('common.cancel'), value: null }, { label: t('plan.addWeek', { n: week + 1 }), value: 'plan', kind: 'primary' }]
    : [{ label: t('common.cancel'), value: null }, ...(hasPlan ? [{ label: t('plan.toPlan'), value: 'plan' }] : []), { label: t('plan.sendTo', { name: student.name }), value: 'loose', kind: 'primary' }];
  const p = dialog({ title: edit ? t('plan.editTask') : t('plan.suggestFor', { name: student.name }), html: true, className: 'tch-dlg pl-dlg', body: `<div id="plBody">${body()}</div>`, buttons });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  const root = box.querySelector('#plBody');
  const read = () => {
    const q = (s) => root.querySelector(s);
    if (q('#plNote')) v.note = q('#plNote').value;
    if (q('#plSeq') && q('#plSeq').value.trim()) { const pr = q('#plSeq').value.split(/[\s,–-]+/).map(CS.normName).filter(CS.known).slice(0, CS.MAX_SEQ); if (pr.length >= 2) v.pr = pr; }
    if (q('#plPart')) v.part = q('#plPart').value;
    if (q('#plSong')) { const s = lib.find((x) => x.id === q('#plSong').value); if (s) v.song = { t: s.title, a: s.artist || '' }; }
    if (q('#plTitle')) { v.song = { t: q('#plTitle').value, a: q('#plArtist')?.value || '' }; const s = lib.find((x) => x.title === v.song.t); if (s && !v.song.a) v.song.a = s.artist || ''; }
  };
  root.addEventListener('input', (e) => { read(); if (e.target.id === 'plSeq') root.querySelectorAll('[data-pr]').forEach((x) => x.classList.toggle('active', !!v.pr && x.dataset.pr === v.pr.join())); });
  root.addEventListener('change', read);
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    read();
    const d = b.dataset;
    if (d.k) { v.k = d.k; if (v.k === 'p' && lib[0] && !lib.some((s) => s.title === v.song.t)) v.song = { t: lib[0].title, a: lib[0].artist || '' }; if (v.goal.t === 'x' && v.k !== 'n') v.goal = { t: 'r', n: 3 }; if (v.k === 'n' && !edit) v.goal = { t: 'x' }; }
    if (d.g) v.g = d.g;
    if (d.pr) v.pr = d.pr.split(',');
    if (d.st) v.st = d.st;
    if (d.gt) v.goal = d.gt === 'x' ? { t: 'x' } : { t: d.gt, n: GOALS[d.gt][d.gt === 'p' ? 2 : 1] };
    if (d.gn) v.goal = { ...v.goal, n: Number(d.gn) };
    if ('due' in d) v.due = d.due;
    root.innerHTML = body();
  });
  const res = await p;
  if (!res) return null;
  read();
  const task = P.cleanTask({ ...v, ...(v.k === 'g' && v.g !== 'promena' ? { pr: null } : {}), id: edit?.id, at: edit?.at || Date.now() });
  if (!task) { toast(t('plan.needSong')); return null; }
  return { task, where: res };
}

// ---------------- nastavnik: plan na stranici učenika ----------------
const week = (n) => t('plan.weekN', { n });
/** Stanje zadatka kod nastavnika (iz učenikovog napretka) → oznaka. */
function tchChip(x, prog) {
  const s = P.teacherStatus(x, prog);
  if (!s) return '';
  if (s.done) return `<span class="pl-st ok">${s.v == null ? '✓' : '✓ ' + esc(stVal(x, s.v))}</span>`;
  return `<span class="pl-st${s.v ? ' mid' : ''}">${esc(stVal(x, s.v))}</span>`;
}
const stVal = (x, v) => { const g = x.goal || {}; return g.t === 'p' ? `${v}%` : g.t === 'r' || g.t === 'm' ? `${Math.min(v, g.n)}/${g.n}` : v ? '✓' : '—'; };

/** Sekcija „Zadaci i plan“ na stranici učenika (kod nastavnika). prog = učenikov napredak (ili null). */
export async function drawTeacherPlan(el, sid, prog = null) {
  await texts();
  const d = await P.getStudentPlan(sid); if (!d) return;
  const { s, tasks, plan } = d;
  const tc = await (await import('./teach.js')).getTeacher();
  const isDone = (x) => !!P.teacherStatus(x, prog)?.done;
  const cw = P.currentWeek(plan, isDone);
  const big = matchMedia('(min-width: 1000px)').matches;
  const looseOpen = tasks.filter((x) => !isDone(x) || Date.now() - x.at < 7 * 864e5);
  const item = (x, where, wi = -1) => `<div class="pl-it" draggable="${big && where === 'plan' ? 'true' : 'false'}" data-it="${esc(x.id)}" data-w="${wi}" tabindex="0">
      ${tchChip(x, prog)}<b>${ICON[x.k]} ${esc(P.taskTitle(x))}</b><small>${esc(P.goalText(x.goal))}${x.note ? ' · „' + esc(x.note) + '“' : ''}</small></div>`;
  const weeksHTML = plan ? plan.weeks.map((w, i) => {
    const done = w.done || (w.tasks.length && w.tasks.every(isDone));
    const n = w.tasks.filter(isDone).length;
    return `<div class="pl-wk${i === cw ? ' cur' : ''}${done ? ' ok' : ''}" data-week="${i}">
      <div class="pl-wh"><b>${week(i + 1)}</b>${done ? `<span class="pl-st ok">✓</span>` : i === cw ? `<span class="pl-st mid">${t('plan.now')}</span>` : ''}</div>
      <small class="muted">${done ? (w.done ? t('plan.markedDone') : t('plan.allTicked')) : prog ? t('plan.nOf', { d: n, n: w.tasks.length }) : t('plan.nTasks', { n: w.tasks.length })}</small>
      ${w.tasks.map((x) => item(x, 'plan', i)).join('')}
      <button class="pl-add" data-addw="${i}">+ ${t('plan.add')}</button>
      ${i === cw && !w.done ? `<button class="btn small pl-mark" data-mark="${i}">${t('plan.markDone')}</button>` : w.done ? `<button class="linkish pl-unmark" data-unmark="${i}">${t('plan.unmark')}</button>` : ''}
    </div>`;
  }).join('') : '';
  const linkInfo = !s.planFile ? (tasks.length || plan ? `<div class="pl-link"><span>${esc(t('plan.noLink', { name: s.name }))}</span><button class="btn small primary" id="plSendLink">${t('plan.sendLink')}</button></div>` : '')
    : !prog ? `<p class="tch-lock">${esc(t('plan.noProg', { name: s.name }))}</p>` : '';
  el.innerHTML = `<div class="tch-sec"><span>${t('plan.tasksAndPlan')}</span><button class="linkish" id="plSuggest">+ ${t('plan.suggest')}</button></div>
    ${linkInfo}
    ${looseOpen.length ? `<div class="pl-loose">${looseOpen.map((x) => item(x, 'loose')).join('')}</div>` : ''}
    ${plan ? `<div class="pl-ph"><b>${esc(plan.title)}</b><span class="pl-st mid">${cw < 0 ? t('plan.finished') : t('plan.weekOf', { n: cw + 1, of: plan.weeks.length })}</span><span class="pl-sp"></span><button class="btn small" id="plMenu" aria-label="${esc(t('tch.more'))}">⋯</button></div>
      <div class="pl-weeks${big ? ' big' : ''}">${weeksHTML}<button class="pl-addwk" id="plAddWeek">+ ${t('plan.addWeekBtn')}</button></div>
      ${big ? `<p class="mk-hint muted small">${t('plan.dragHint')}</p>` : ''}`
      : `<div class="pl-empty"><p class="muted small">${t('plan.noPlan', { name: s.name })}</p><button class="btn" id="plNew">${t('plan.make')}</button></div>`}`;

  el.__prog = prog;
  const save = async (patch) => { await P.saveStudentPlan(sid, { tasks: patch.tasks ?? tasks, plan: 'plan' in patch ? patch.plan : plan }); drawTeacherPlan(el, sid, el.__prog); };
  const findIt = (id) => { for (const [wi, w] of (plan?.weeks || []).entries()) { const k = w.tasks.findIndex((x) => x.id === id); if (k >= 0) return { x: w.tasks[k], wi, k }; } const k = tasks.findIndex((x) => x.id === id); return k >= 0 ? { x: tasks[k], wi: -1, k } : null; };
  const afterAdd = async () => {
    const cur = await (await import('./teach.js')).getStudent(sid);
    if (!cur.planFile) {
      if (await P.sendPlanLink(sid)) toast(t('plan.linkSent', { name: s.name })); // v1.94: sam, kroz sanduče
      drawTeacherPlan(el, sid, prog);
    } else toast(t('plan.willSee', { name: s.name }));
  };
  el.querySelector('#plSuggest').addEventListener('click', async () => {
    const r = await suggestFlow(s, { hasPlan: !!plan }); if (!r) return;
    if (r.where === 'plan' && plan) { const wi = cw >= 0 ? cw : plan.weeks.length - 1; plan.weeks[wi].tasks.push(r.task); await save({ plan }); }
    else { const { due, ...x } = r.task; await save({ tasks: [...tasks, { ...x, ...(due ? { due } : {}) }] }); }
    afterAdd();
  });
  el.querySelector('#plSendLink')?.addEventListener('click', async () => { if (await P.sendPlanLink(sid)) { toast(t('plan.linkSent', { name: s.name })); drawTeacherPlan(el, sid, prog); } });
  el.querySelector('#plNew')?.addEventListener('click', async () => {
    const own = tc.templates || [];
    const v = await dialog({ title: t('plan.makeTitle'), html: true, className: 'tch-dlg', body: `<p class="muted small">${esc(t('plan.makeBody', { name: s.name }))}</p>`,
      buttons: [...P.STARTERS.map((x) => ({ label: `${t('plan.tpl.' + x.id)} · ${t('plan.nWeeks', { n: x.weeks.length })}`, value: 'm:' + x.id })), ...own.map((x) => ({ label: `${x.title} · ${t('plan.nWeeks', { n: x.weeks.length })}`, value: 'o:' + x.id })), { label: t('plan.blank'), value: 'blank' }, { label: t('common.cancel'), value: null }] });
    if (!v) return;
    const nu = v === 'blank' ? P.emptyPlan(t('plan.defaultTitle', { name: s.name })) : P.planFrom(v.startsWith('m:') ? P.STARTERS.find((x) => x.id === v.slice(2)) : own.find((x) => x.id === v.slice(2)));
    await save({ plan: nu });
    afterAdd();
  });
  el.querySelector('#plAddWeek')?.addEventListener('click', async () => { plan.weeks.push({ id: Math.random().toString(36).slice(2, 10), tasks: [] }); await save({ plan }); });
  el.querySelector('#plMenu')?.addEventListener('click', async () => {
    const v = await dialog({ title: plan.title, buttons: [{ label: t('plan.rename'), value: 'ren' }, { label: t('plan.saveTpl'), value: 'tpl' }, { label: t('plan.delPlan'), value: 'del', kind: 'danger' }, { label: t('common.cancel'), value: null }] });
    if (v === 'ren') { const { askName } = await import('./setlistsView.js'); const n = await askName(t('plan.rename'), plan.title); if (n) { plan.title = n.slice(0, 80); await save({ plan }); } }
    if (v === 'tpl') {
      const T = await import('./teach.js');
      const tpl = { id: Math.random().toString(36).slice(2, 10), title: plan.title, weeks: plan.weeks.map((w) => ({ tasks: w.tasks.map(({ id, at, done, ...x }) => x) })) };
      await T.setTeacher({ templates: [...(tc.templates || []).filter((x) => x.title !== tpl.title), tpl].slice(-20) });
      toast(t('plan.tplSaved'));
    }
    if (v === 'del') { const ok = await dialog({ title: t('plan.delTitle'), body: t('plan.delBody', { name: s.name }), buttons: [{ label: t('common.cancel'), value: null }, { label: t('plan.delPlan'), value: 'y', kind: 'danger' }] }); if (ok === 'y') await save({ plan: null }); }
  });
  el.__pl = { s, tasks, plan, save, findIt, afterAdd, big };
  if (el.__plBound) return;
  el.__plBound = true;
  el.addEventListener('click', async (e) => {
    const { s, tasks, plan, save, findIt, afterAdd } = el.__pl;
    const add = e.target.closest('[data-addw]'), mark = e.target.closest('[data-mark]'), unmark = e.target.closest('[data-unmark]'), it = e.target.closest('[data-it]');
    if (add) { const wi = Number(add.dataset.addw); const r = await suggestFlow(s, { week: wi }); if (r) { const { due, ...x } = r.task; plan.weeks[wi].tasks.push(x); await save({ plan }); afterAdd(); } }
    else if (mark) { plan.weeks[Number(mark.dataset.mark)].done = Date.now(); await save({ plan }); toast(t('plan.markedToast', { n: Number(mark.dataset.mark) + 2 })); }
    else if (unmark) { delete plan.weeks[Number(unmark.dataset.unmark)].done; await save({ plan }); }
    else if (it) {
      const f = findIt(it.dataset.it); if (!f) return;
      const moves = plan && f.wi >= 0 ? plan.weeks.map((_, i) => i).filter((i) => i !== f.wi).map((i) => ({ label: t('plan.moveTo', { w: week(i + 1) }), value: 'mv:' + i })) : [];
      const v = await dialog({ title: P.taskTitle(f.x), buttons: [{ label: t('plan.editTask'), value: 'edit' }, ...moves, { label: f.x.done ? t('plan.unmarkTask') : t('plan.markTask'), value: 'done' }, { label: t('plan.remove'), value: 'rm', kind: 'danger' }, { label: t('common.cancel'), value: null }] });
      const list = f.wi >= 0 ? plan.weeks[f.wi].tasks : tasks;
      if (v === 'edit') { const r = await suggestFlow(s, { edit: f.x }); if (r) { list[f.k] = { ...r.task, ...(f.x.due ? { due: f.x.due } : {}) }; await save(f.wi >= 0 ? { plan } : { tasks }); } }
      if (v && v.startsWith('mv:')) { list.splice(f.k, 1); plan.weeks[Number(v.slice(3))].tasks.push(f.x); await save({ plan }); }
      if (v === 'done') { if (f.x.done) delete f.x.done; else f.x.done = Date.now(); await save(f.wi >= 0 ? { plan } : { tasks }); }
      if (v === 'rm') { list.splice(f.k, 1); await save(f.wi >= 0 ? { plan } : { tasks }); }
    }
  });
  // računar: prevlačenje zadatka u drugu nedelju
  {
    let drag = null;
    el.addEventListener('dragstart', (e) => { if (!el.__pl.big || !el.__pl.plan) return; const it = e.target.closest('[data-it]'); if (!it) return; drag = it.dataset.it; it.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', drag); } catch {} });
    el.addEventListener('dragend', (e) => { e.target.closest?.('[data-it]')?.classList.remove('drag'); el.querySelectorAll('.pl-wk.over').forEach((x) => x.classList.remove('over')); });
    el.addEventListener('dragover', (e) => { const wk = e.target.closest('[data-week]'); if (!wk || !drag) return; e.preventDefault(); el.querySelectorAll('.pl-wk.over').forEach((x) => x !== wk && x.classList.remove('over')); wk.classList.add('over'); });
    el.addEventListener('drop', async (e) => {
      const wk = e.target.closest('[data-week]'); if (!wk || !drag) return; e.preventDefault();
      const { plan, save, findIt } = el.__pl;
      const f = findIt(drag); drag = null; if (!f || f.wi < 0) return;
      const to = Number(wk.dataset.week); if (to === f.wi) { drawTeacherPlan(el, sid, el.__prog); return; }
      plan.weeks[f.wi].tasks.splice(f.k, 1); plan.weeks[to].tasks.push(f.x); await save({ plan });
    });
  }
}

/** Pregled (računar): kratko stanje plana učenika za tabelu — „Ned. 2 · 1/3“ ili ''. */
export function dashCell(s, prog) {
  const plan = P.cleanPlan(s.plan); if (!plan) return '';
  const isDone = (x) => !!P.teacherStatus(x, prog)?.done;
  const cw = P.currentWeek(plan, isDone);
  if (cw < 0) return t('plan.finished');
  const w = plan.weeks[cw];
  return `${t('plan.weekShort', { n: cw + 1 })}${prog ? ` · ${w.tasks.filter(isDone).length}/${w.tasks.length}` : ''}`;
}

/** v1.94: ko je delio napredak porukom (pre 1.94) — kartica „Poveži Google“ u Vežbama (poruka više ne postoji). */
export async function drawNudge(el) {
  if (!el) return;
  const P = await import('./progress.js');
  const n = await P.progNudge().catch(() => null);
  if (!n) { el.innerHTML = ''; return; }
  el.innerHTML = `<button class="pl-nudge" id="plNudge"><span class="pl-nudge-t"><span class="pl-k">${esc(t('prog.nudgeK'))}</span><b>${esc(t('prog.nudgeG', { t: n.name }))}</b></span><span class="pl-nudge-go">${t('prog.nudgeGBtn')} ›</span></button>`;
  el.querySelector('#plNudge').addEventListener('click', async () => { if (await P.setProgressShare(true).catch(() => false)) { toast(t('prog.turnedOn', { t: n.name })); el.innerHTML = ''; } });
}
