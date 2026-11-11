// v1.94: nastava bez poruka.
// Nastavnik → učenik: „sanduče“ — po jedan mali fajl za svakog učenika na NASTAVNIKOVOM Google Drive-u (link ima samo
// taj učenik; čita se bez prijave). U njega idu poslate pesme i set liste (kao link do deljenog fajla), odgovori na
// zahteve i plan. Učenikova aplikacija ga sama proverava i pesme stižu u „Od nastavnika“.
// Učenik → nastavnik: želje, „Proveri sa nastavnikom“ i snimci idu u učenikov fajl napretka (polje „out“), koji
// nastavnikova aplikacija ionako čita. Nijedna poruka (imejl, Viber…) više ne učestvuje.
import { t, songsCount } from './i18n.js';
import { toast } from './ui.js';

const TM = () => import('./teach.js');
const S_ = () => import('./shareService.js');
const MAX_ITEMS = 150, MAX_OUT = 30;

// ---------------- nastavnik: sanduče po učeniku ----------------
/** Id sanduča tog učenika (napravi ga ako ga nema). interactive = sme da traži Google nalog. '' = nije moguće. */
export async function ensureBox(sid, { interactive = false } = {}) {
  const tm = await TM(); const st = await tm.getStudent(sid); if (!st) return '';
  if (st.box && st.box.f) return st.box.f;
  const tc = await tm.setTeacher({});
  const S = await S_();
  let id = '';
  try { id = await S.putData('', JSON.stringify({ app: 'marli', type: 'box', v: 1, tid: tc.id, sid, at: Date.now(), items: [] }), { interactive, name: 'MARLI – za učenika.json' }); }
  catch (e) { if (interactive) throw e; }
  if (id) await tm.updateStudent(sid, { box: { f: id, at: Date.now() } });
  return id;
}
const queues = new Map(); // jedno pisanje po sanduču u isto vreme
/** Dodaj (ili zameni, po ključu) stavke u sanduče učenika. Vraća true ako je upisano. */
export function boxPut(sid, items, { interactive = true } = {}) {
  const run = async () => {
    const tm = await TM(); const st = await tm.getStudent(sid); if (!st || !st.box || !st.box.f) return false;
    const S = await S_(); const tc = await tm.setTeacher({});
    const cur = await S.readData(st.box.f);
    const old = cur && !cur.gone && cur.type === 'box' && Array.isArray(cur.items) ? cur.items : [];
    const map = new Map(old.filter((x) => x && x.key).map((x) => [x.key, x]));
    for (const it of items) map.set(it.key, { ...it, at: it.at || Date.now() });
    const list = [...map.values()].sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-MAX_ITEMS);
    const id = await S.putData(st.box.f, JSON.stringify({ app: 'marli', type: 'box', v: 1, tid: tc.id, sid, at: Date.now(), items: list }), { interactive, name: 'MARLI – za učenika.json' }).catch(() => '');
    return !!id;
  };
  const p = (queues.get(sid) || Promise.resolve()).then(run, run);
  queues.set(sid, p.catch(() => {}));
  return p;
}
/** Učenici koji još nemaju sanduče (povezani pre 1.94) — njima treba jednom pokazati QR. */
export const notConnected = (students) => students.filter((s) => !(s.box && s.box.f));

// ---------------- učenik: proveri sanduče ----------------
let checking = null, lastCheck = 0;
/** Pročitaj nastavnikovo sanduče i primi ono što je novo. Vraća broj novih stavki. */
export function checkBox({ force = false } = {}) {
  if (checking) return checking;
  if (!force && Date.now() - lastCheck < 60000) return Promise.resolve(0);
  lastCheck = Date.now();
  checking = (async () => {
    const tm = await TM(); const m = await tm.getMyTeacher();
    if (!m || !m.box) return 0;
    const S = await S_();
    const d = await S.readData(m.box);
    if (!d || d.gone || d.type !== 'box' || d.tid !== m.tid) return 0;
    const seen = { ...(m.boxSeen || {}) }; const fresh = []; let n = 0; const notes = [];
    const fromT = { tid: m.tid, name: m.name };
    for (const it of (d.items || []).slice(-MAX_ITEMS)) {
      if (!it || !it.key || (seen[it.key] || 0) >= (it.at || 1)) continue;
      try {
        if (it.kind === 'song' || it.kind === 'set') {
          const I = await import('./shareImport.js');
          const pkg = await I.fetchPackage(it.f);
          if (!pkg || !pkg.songs || !pkg.songs.length) continue; // fajl još nije dostupan — sledeći put
          const mine = it.rp && pkg.songs.length === 1 ? await (await import('./db.js')).songs.get(it.rp).catch(() => null) : null;
          if (mine && !mine.deleted) { await tm.replaceWithTeacher(mine, pkg.songs[0]); fresh.push(mine.id); } // ispravka učenikove pesme (stara ostaje u Prethodnim verzijama)
          else { const r = await I.importTagged(pkg, it.f, { fromT }, { fromT }); fresh.push(...(r.ids || [])); }
          if (it.rq) await tm.markAnswered(it.rq, pkg.name || pkg.songs[0].title || '');
        } else if (it.kind === 'ans') await tm.answerFromBox(it.id, it.s);
        else if (it.kind === 'plan') await (await import('./plan.js')).acceptPlanFile(it.f);
        else if (it.kind === 'rp') { if (!(await (await import('./pRP.js')).receive(it.rp, fromT))) continue; } // v2.1: Ritam i promene od nastavnika
        else if (it.kind === 'ex') { if (!(await (await import('./myEx.js')).receive(it.ex, fromT))) continue; } // v1.97: vežba od nastavnika
        seen[it.key] = it.at || Date.now(); n++;
        notes.push(it);
      } catch (e) { console.warn('box', e); }
    }
    if (n) {
      const cur = await tm.getMyTeacher();
      if (cur && cur.tid === m.tid) {
        const keep = Object.fromEntries(Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 400));
        await tm.setMyTeacher({ ...cur, boxSeen: keep, boxNew: [...new Set([...(cur.boxNew || []), ...fresh])].slice(-60), boxAt: Date.now() });
      }
      const songs = (d.items || []).filter((it) => (it.kind === 'song' || it.kind === 'set') && seen[it.key] === it.at && !(m.boxSeen || {})[it.key]).length;
      if (songs) toast(t('box.got', { t: m.name || t('tch.teacher'), n: songs }));
      try { dispatchEvent(new Event('marli-box')); } catch {}
      // v1.95: 🔔 — šta je stiglo (pesme zajedno u jednoj stavci)
      const N = await import('./notify.js'); const tn = m.name || t('tch.teacher'), who = (tn[0] || 'M').toUpperCase();
      const got = notes.filter((x) => x.kind === 'song' || x.kind === 'set');
      if (got.length) await N.add({ id: 'box:' + got.map((x) => x.key + x.at).join('|').slice(-70), who, c: '#f5a524', t: got.length === 1 && got[0].kind === 'set' ? t('nt.gotSet', { t: tn, name: got[0].name || '' }) : t('nt.gotSongs', { t: tn, n: songsCount(got.length) }), s: got.length === 1 && got[0].kind === 'set' ? t('nt.inFrom') : got.map((x) => x.name).filter(Boolean).slice(0, 3).join(', '), href: '#/od-nastavnika' });
      for (const x of notes.filter((y) => y.kind === 'ans')) { const r = (await tm.getMyRequests()).find((q) => q.id === x.id); await N.add({ id: 'ans:' + x.id + ':' + x.at, who, c: '#f5a524', t: t(x.s === 'none' ? 'nt.ansNone' : 'nt.ansOk', { t: tn }), s: r ? r.title : '', href: '#/od-nastavnika' }); }
      for (const x of notes.filter((y) => y.kind === 'ex')) await N.add({ id: 'ex:' + x.key + x.at, who, c: '#f5a524', t: t('nt.ex', { t: tn, name: x.name || '' }), s: x.ex && x.ex.goal ? t('ex.goalShort', { n: x.ex.goal.n, bpm: x.ex.goal.bpm || '' }) : '', href: '#/vezbe' });
      for (const x of notes.filter((y) => y.kind === 'rp')) await N.add({ id: 'rp:' + x.key + x.at, who, c: '#f5a524', t: t('nt.rp', { t: tn, name: x.name || '' }), s: t('nt.rpSub'), href: '#/vezbe/rp?ex=' + encodeURIComponent((x.rp && x.rp.id) || '') });
      for (const x of notes.filter((y) => y.kind === 'plan')) await N.add({ id: 'plan:' + x.at, who, c: '#f5a524', t: t('nt.plan', { t: tn }), s: t('nt.planSub'), href: '#/vezbe' });
    }
    return n;
  })().finally(() => { checking = null; });
  return checking;
}
let inited = false;
/** Učenik: proveri pri pokretanju, pri povratku u aplikaciju i na 10 min dok je otvorena. */
export function initBox() {
  if (inited) return; inited = true;
  setTimeout(() => checkBox().catch(() => {}), 6000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkBox().catch(() => {}); });
  setInterval(() => { if (!document.hidden) checkBox().catch(() => {}); }, 10 * 60000);
}
/** Učenik: pesme koje su stigle a još nisu viđene (za „Novo“ u „Od nastavnika“). */
export async function newFromTeacher() { const m = await (await TM()).getMyTeacher(); return (m && m.boxNew) || []; }
export async function clearNew(ids = null) {
  const tm = await TM(); const m = await tm.getMyTeacher(); if (!m) return;
  await tm.setMyTeacher({ ...m, boxNew: ids ? (m.boxNew || []).filter((x) => !ids.includes(x)) : [] });
}

// ---------------- učenik → nastavnik: kroz fajl napretka ----------------
/** Dodaj stavku za nastavnika (želja, „proveri“, snimak) i odmah osveži fajl napretka. true = stiglo u fajl. */
export async function outPush(item, { interactive = true } = {}) {
  const tm = await TM(); let m = await tm.getMyTeacher(); if (!m) return false;
  const P = await import('./progress.js');
  if (!m.prog || !m.prog.on || !m.prog.fileId) {
    if (!interactive) return false;
    if (!(await P.setProgressShare(true, { quiet: true }))) return false; // Google nalog je potreban (za decu odobrava roditelj)
    m = await tm.getMyTeacher();
  }
  const keepFrom = Date.now() - 60 * 864e5;
  const out = [...(m.out || []).filter((x) => x && x.at > keepFrom && x.id !== item.id), { ...item, at: Date.now() }].slice(-MAX_OUT);
  await tm.setMyTeacher({ ...m, out });
  const id = await P.syncProgress({ force: true, interactive }).catch(() => '');
  return !!id;
}

// ---------------- nastavnik: primi ono što su učenici poslali (iz njihovih fajlova napretka) ----------------
/** Iz učenikovog fajla napretka: želje/pitanja, „proveri“, snimci — svaka stavka samo jednom. Vraća broj novih. */
async function note(st, id, title, sub) { const N = await import('./notify.js'); return N.add({ id: st.id + ':' + id, who: (String(st.name || '?')[0] || '?').toUpperCase(), c: st.color || '', t: title, s: sub, href: '#/ucenik/' + encodeURIComponent(st.id) }); }
/** v1.95: nastavnik — urađeni zadaci iz učenikovog napretka (svaki samo jednom). */
export async function ingestDone(st, d) {
  if (!st || !d || !d.tasks) return;
  const tm = await TM(); const tc = await tm.getTeacher(); const seen = { ...(tc.doneSeen || {}) }; let any = false;
  const P = await import('./plan.js');
  const all = [...(st.tasks || []), ...((st.plan && st.plan.weeks) || []).flatMap((w) => w.tasks || [])];
  for (const [id, v] of Object.entries(d.tasks)) {
    if (!Array.isArray(v) || !v[1] || seen[st.id + ':' + id]) continue;
    const x = all.find((y) => y.id === id); seen[st.id + ':' + id] = Date.now(); any = true;
    if (x) await note(st, 'done:' + id, t('nt.done', { name: st.name }), P.taskTitle(x));
  }
  if (any) await tm.setTeacher({ doneSeen: Object.fromEntries(Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 800)) });
}
export async function ingestOut(st, out) {
  if (!st || !Array.isArray(out) || !out.length) return 0;
  const tm = await TM(); const tc = await tm.getTeacher();
  const seen = { ...(tc.inSeen || {}) }; let n = 0;
  const clip = (s, k) => String(s || '').trim().slice(0, k);
  for (const o of out.slice(-MAX_OUT)) {
    if (!o || !o.id || seen[st.id + ':' + o.id]) continue;
    try {
      if (o.type === 'wish' || o.type === 'ask') await tm.addRequest({ id: clip(o.id, 40), sid: st.id, type: o.type, title: clip(o.title, 80), artist: clip(o.artist, 60), note: clip(o.note, 300), at: Number(o.at) || Date.now() });
      else if (o.type === 'check' && o.f) await tm.addCheckRequest({ id: clip(o.id, 40), sid: st.id, title: clip(o.title, 80), artist: clip(o.artist, 60), note: clip(o.note, 300), fileId: o.f, ps: clip(o.ps, 60) });
      else if (o.type === 'file' && o.f) {
        const I = await import('./shareImport.js');
        const pkg = await I.fetchPackage(o.f);
        if (!pkg || !pkg.songs || !pkg.songs.length) continue;
        const { REC_FOLDER, ensureRecFolder } = await import('./collections.js');
        await ensureRecFolder();
        await I.importTagged(pkg, o.f, (song) => ({ student: st.id, fromStudent: 1, ...(song.recording ? { folders: [REC_FOLDER] } : {}) }));
        toast(t('box.gotRec', { name: st.name }));
        await note(st, 'rec:' + o.id, t('nt.rec', { name: st.name }), o.title || '');
      } else if (o.type === 'rp' && o.ex) { // v2.1: napredak u „Ritam i promene“ (korak n od m)
        const cur = (await tm.getStudent(st.id)) || st; const step = Math.max(0, Math.min(20, Number(o.step) || 0)), of = Math.max(1, Math.min(20, Number(o.of) || 1));
        await tm.updateStudent(st.id, { rp: { ...(cur.rp || {}), [clip(o.ex, 40)]: { step, of, name: clip(o.name, 60), at: Number(o.at) || Date.now() } } });
        if (step >= of) await note(st, 'rp:' + o.id, t('nt.rpDone', { name: st.name }), clip(o.name, 80));
      } else continue;
      if (o.type === 'wish' || o.type === 'ask') await note(st, 'rq:' + o.id, t(o.type === 'wish' ? 'nt.wish' : 'nt.ask', { name: st.name, title: clip(o.title, 80) }), [clip(o.artist, 60), o.note ? '„' + clip(o.note, 80) + '“' : ''].filter(Boolean).join(' · '));
      else if (o.type === 'check') await note(st, 'chk:' + o.id, t('nt.check', { name: st.name }), [clip(o.title, 80), o.note ? '„' + clip(o.note, 80) + '“' : ''].filter(Boolean).join(' · '));
      seen[st.id + ':' + o.id] = Date.now(); n++;
    } catch (e) { console.warn('ingest', e); }
  }
  if (n) await tm.setTeacher({ inSeen: Object.fromEntries(Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 800)) });
  return n;
}
let tInited = false;
/** Nastavnik: pri pokretanju, pri povratku u aplikaciju i na 15 min — pročitaj fajlove napretka (zahtevi stižu sami). */
export function initTeacherPoll() {
  if (tInited) return; tInited = true;
  const run = async () => {
    const tm = await TM(); const tc = await tm.getTeacher(); if (!tc.on) return;
    const P = await import('./progress.js');
    for (const st of await tm.getStudents()) if (st.prog && st.prog.fileId) await P.studentProgress(st, { fresh: true }).catch(() => null);
  };
  let last = 0; const maybe = () => { if (Date.now() - last > 2 * 60000) { last = Date.now(); run().catch(() => {}); } };
  setTimeout(maybe, 8000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) maybe(); });
  setInterval(() => { if (!document.hidden) { last = 0; maybe(); } }, 15 * 60000);
}
