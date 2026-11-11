// v1.97: „Moje vežbe“ — sačuvani nizovi akorda sa ritmom (Promena akorda). Sinhronizuju se (settings 'myEx').
// Nastavnik ih šalje učeniku kroz sanduče (bez poruka); kod učenika su označene „Od: Mile“. Ako učenik izmeni
// nastavnikovu vežbu, čuva se kao „Moja kopija“ — nastavnikova ostaje ista.
import { t } from './i18n.js';
import { esc, dialog, toast } from './ui.js';
import { settings } from './db.js';
import { dn } from './naming.js';

const LS = 'gitara-pr-promena';
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clip = (s, n) => String(s || '').trim().slice(0, n);

export async function list() { return ((await settings.get('myEx', [])) || []).filter((x) => x && x.id && Array.isArray(x.seq)); }
async function put(arr) { await settings.set('myEx', arr.slice(0, 200)); }
/** Očisti vežbu (iz fajla, sanduča ili dijaloga). */
export async function cleanEx(x) {
  const CS = await import('./chordSeq.js'); const P = await import('./pChords.js');
  if (!x || typeof x !== 'object') return null;
  const seq = CS.cleanSeq(x.seq, 4).map((c, i) => { const r = x.seq[i] && x.seq[i].r; return P.RHYTHMS.includes(r) ? { ...c, r } : c; });
  if (seq.length < 2) return null;
  return { id: clip(x.id, 30) || uid(), name: clip(x.name, 60) || CS.seqLabel(seq), seq, rhythm: P.RHYTHMS.includes(x.rhythm) ? x.rhythm : 'one', perChord: !!x.perChord,
    ...(Number(x.bpm) > 0 ? { bpm: Math.max(40, Math.min(200, Math.round(Number(x.bpm)))) } : {}),
    ...(x.goal && x.goal.n ? { goal: { n: Math.max(1, Math.min(20, Math.round(Number(x.goal.n) || 1))), bpm: Math.max(40, Math.min(200, Math.round(Number(x.goal.bpm) || 0))) || null } } : {}),
    ...(x.fromT ? { fromT: { tid: clip(x.fromT.tid, 40), name: clip(x.fromT.name, 60) } } : {}), ...(x.copyOf ? { copyOf: clip(x.copyOf, 30) } : {}),
    at: Number(x.at) || Date.now() };
}
/** Trenutno podešavanje Promene akorda (localStorage) → vežba. */
function current() { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch { return {}; } }
/** Učitaj vežbu u Promenu akorda i otvori je. */
export function play(x) {
  try { const o = current(); localStorage.setItem(LS, JSON.stringify({ ...o, seq: x.seq, pair: x.seq.map((c) => c.c), rhythm: x.rhythm || 'one', perChord: !!x.perChord, ex: x.id })); } catch {}
  location.hash = '#/vezbe/promena';
}
/** „Sačuvaj kao vežbu“ — novo ime ili ažuriranje iste (nastavnikova vežba → „Moja kopija“). Vraća vežbu. */
export async function saveCurrent() {
  const o = current(); const all = await list();
  const was = o.ex ? all.find((x) => x.id === o.ex) : null;
  const CS = await import('./chordSeq.js');
  const { askName } = await import('./setlistsView.js');
  const def = was ? (was.fromT ? t('ex.copyName', { name: was.name }) : was.name) : CS.seqLabel(CS.cleanSeq(o.seq || []));
  const name = await askName(t('ex.saveTitle'), def); if (!name) return null;
  const ex = await cleanEx({ id: was && !was.fromT ? was.id : uid(), name, seq: o.seq || [], rhythm: o.rhythm, perChord: o.perChord, bpm: o.bpm, ...(was && was.fromT ? { copyOf: was.id } : {}) });
  if (!ex) { toast(t('cs.min2')); return null; }
  await put([ex, ...all.filter((x) => x.id !== ex.id)]);
  try { localStorage.setItem(LS, JSON.stringify({ ...o, ex: ex.id })); } catch {}
  toast(t(was && was.fromT ? 'ex.savedCopy' : 'ex.saved', { name: ex.name }));
  return ex;
}
export async function remove(id) { await put((await list()).filter((x) => x.id !== id)); }
export async function rename(id) {
  const all = await list(); const x = all.find((y) => y.id === id); if (!x) return;
  const { askName } = await import('./setlistsView.js'); const name = await askName(t('ex.rename'), x.name); if (!name) return;
  await put(all.map((y) => (y.id === id ? { ...y, name: clip(name, 60) } : y)));
}
/** Učenik: vežba stigla kroz sanduče (isti id = ažuriranje). */
export async function receive(raw, fromT) {
  const ex = await cleanEx({ ...raw, fromT }); if (!ex) return null;
  const all = await list();
  await put([ex, ...all.filter((x) => x.id !== ex.id)]);
  return ex;
}

// ---------------- nastavnik: pošalji učeniku ----------------
/** Pošalji vežbu jednom ili više učenika (sanduče), uz cilj. */
export async function sendToStudents(x) {
  const T = await import('./teach.js'); const students = await T.getStudents();
  if (!students.length) { toast(t('tch.emptyBody')); return; }
  const { pickMany } = await import('./setlistsView.js');
  const ids = await pickMany(t('ex.sendTitle', { name: x.name }), students.map((s) => ({ value: s.id, label: s.name })), students.length === 1 ? [students[0].id] : []);
  if (!ids || !ids.length) return;
  let n = 3, bpm = x.bpm || 80;
  const p = dialog({ title: t('ex.goalTitle'), html: true, className: 'tch-dlg', body: `<p class="small muted">${esc(t('ex.goalBody'))}</p>
    <div class="cs-lbl"><span>${esc(t('ex.goalRuns'))}</span></div><div class="seg-tabs" id="exN">${[1, 3, 5].map((k) => `<button type="button" data-n="${k}" class="${k === n ? 'active' : ''}">${k}</button>`).join('')}</div>
    <div class="cs-lbl"><span>${esc(t('ex.goalBpm'))}</span></div><div class="seg-tabs" id="exB">${[60, 80, 90, 100, 120].map((k) => `<button type="button" data-b="${k}" class="${k === bpm ? 'active' : ''}">${k}</button>`).join('')}</div>`,
    buttons: [{ label: t('common.cancel'), value: null }, { label: t('ex.sendBtn'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  box.addEventListener('click', (e) => { const a = e.target.closest('[data-n]'), b = e.target.closest('[data-b]'); if (a) { n = +a.dataset.n; box.querySelectorAll('[data-n]').forEach((y) => y.classList.toggle('active', y === a)); } if (b) { bpm = +b.dataset.b; box.querySelectorAll('[data-b]').forEach((y) => y.classList.toggle('active', y === b)); } });
  if ((await p) !== 'ok') return;
  const B = await import('./teachBox.js');
  const ex = { id: x.id, name: x.name, seq: x.seq, rhythm: x.rhythm, perChord: x.perChord, bpm: x.bpm, goal: { n, bpm }, at: Date.now() };
  const ok = [], wait = [];
  for (const sid of ids) { const st = students.find((s) => s.id === sid); if (!(st.box && st.box.f)) { wait.push(st); continue; } if (await B.boxPut(sid, [{ key: 'ex:' + x.id, kind: 'ex', ex, name: x.name, at: Date.now() }]).catch(() => false)) ok.push(st); }
  if (ok.length) toast(t('ex.sent', { who: ok.map((s) => s.name).join(', ') }));
  if (wait.length) toast(t('box.notConn', { name: wait.map((s) => s.name).join(', ') }), 'error');
}

// ---------------- Vežbe: kartica „Moje vežbe“ ----------------
export async function drawHub(el) {
  if (!el) return;
  const all = (await list()).sort((a, b) => (b.at || 0) - (a.at || 0));
  let teacher = false; try { teacher = !!((await settings.get('teacher', null)) || {}).on; } catch {}
  if (!all.length) { el.innerHTML = ''; return; }
  const CS = await import('./chordSeq.js');
  el.innerHTML = `<div class="ex-card"><div class="ex-head"><b>${esc(t('ex.title'))}</b><span class="muted small">${esc(t('ex.count', { n: all.length }))}</span></div>
    ${all.slice(0, 12).map((x) => `<div class="ex-row"><button type="button" class="ex-play" data-ex="${esc(x.id)}"><span class="ex-ic">▶</span><span class="ex-tx"><b>${esc(x.name)}</b><small>${esc([CS.seqLabel(x.seq), x.fromT ? t('ex.from', { t: x.fromT.name || t('tch.teacher') }) : '', x.goal ? t('ex.goalShort', { n: x.goal.n, bpm: x.goal.bpm || '' }) : ''].filter(Boolean).join(' · '))}</small></span></button><button type="button" class="icon-btn ex-more" data-exm="${esc(x.id)}" aria-label="${esc(t('tch.more'))}">⋯</button></div>`).join('')}</div>`;
  el.onclick = async (e) => {
    const pl = e.target.closest('[data-ex]'), mo = e.target.closest('[data-exm]');
    if (pl) { const x = all.find((y) => y.id === pl.dataset.ex); if (x) play(x); }
    if (mo) {
      const x = all.find((y) => y.id === mo.dataset.exm); if (!x) return;
      const v = await dialog({ title: x.name, buttons: [{ label: t('ex.play'), value: 'play' }, ...(teacher ? [{ label: t('ex.send'), value: 'send' }] : []), { label: t('ex.rename'), value: 'ren' }, { label: t('ex.delete'), value: 'del', kind: 'danger' }, { label: t('common.cancel'), value: null, kind: 'ghost' }] });
      if (v === 'play') play(x);
      if (v === 'send') await sendToStudents(x);
      if (v === 'ren') { await rename(x.id); drawHub(el); }
      if (v === 'del') { await remove(x.id); toast(t('ex.deleted')); drawHub(el); }
    }
  };
}
export const chordsLine = (x) => x.seq.map((c) => dn(c.c)).join(' – ');
