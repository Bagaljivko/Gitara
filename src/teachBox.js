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
// v2.4.14: pesme u samom sanduču — do 300 pesama po slanju; sanduče ostaje ispod ~1,5 MB (najstarijim stavkama se skidaju pesme)
export const INLINE_MAX_SONGS = 300, INLINE_MAX_CHARS = 600000, BOX_BUDGET = 1500000;
const iid = () => 'inl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
/** Stavka sanduča sa pesmama unutra ({ key, kind, name, d, n, _ids }) ili null (preveliko / nema pesama → stari način). */
export async function inlineItem(item) {
  const songs = ((item && item.share && item.share.songs) || []).filter(Boolean);
  if (!songs.length || songs.length > INLINE_MAX_SONGS) return null;
  const C = await import('./shareCode.js'); const tm = await TM(); const tc = await tm.setTeacher({});
  const kind = item.kind === 'set' ? 'set' : 'song';
  const d = await C.encode(C.makePackage(songs, kind === 'set' ? (item.name || '') : null));
  if (d.length > INLINE_MAX_CHARS) return null;
  return { key: kind + ':' + iid(), kind, name: clipN(item.name, 80), d, n: songs.length, by: clipN(tc.name, 60), _ids: songs.map((s) => s.id).filter(Boolean).slice(0, 300) };
}
/** Sanduče ispod budžeta: najstarijim stavkama sa pesmama unutra skidaju se pesme (učenik ih je verovatno već primio). */
function fitBudget(list) {
  let size = JSON.stringify(list).length; if (size <= BOX_BUDGET) return list;
  const out = list.map((x) => ({ ...x }));
  for (const x of out) { if (size <= BOX_BUDGET) break; if (x.d) { size -= x.d.length; delete x.d; x.gone = 1; } }
  return out;
}

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
/** Jedno pisanje u sanduče. 'ok' | 'retry' (Google usporio / nema mreže — pokušaj kasnije) | 'no' (nema sanduča). */
async function writeBox(sid, items, interactive) {
  const tm = await TM(); const st = await tm.getStudent(sid); if (!st || !st.box || !st.box.f) return 'no';
  const S = await S_(); const tc = await tm.setTeacher({});
  const cur = await S.readData(st.box.f);
  // v2.4.11: sanduče nije moglo da se pročita (Google usporio, mreža) → NE prepisuj ga samo novim stavkama
  // (ranije je tako nestajalo sve što učenik još nije preuzeo — pesme, beleške, čas); sačekaj i pošalji kasnije.
  if (cur === null) { diag('box', 'čitanje sanduča nije uspelo — čeka'); return 'retry'; }
  const old = cur && !cur.gone && cur.type === 'box' && Array.isArray(cur.items) ? cur.items : [];
  const map = new Map(old.filter((x) => x && x.key).map((x) => [x.key, x]));
  for (const it of items) { const { _ids, ...clean } = it; map.set(it.key, { ...clean, at: it.at || Date.now() }); } // _ids ostaje samo kod nastavnika (za „Pošalji ponovo“)
  const list = fitBudget([...map.values()].sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-MAX_ITEMS));
  const id = await S.putData(st.box.f, JSON.stringify({ app: 'marli', type: 'box', v: 1, tid: tc.id, sid, at: Date.now(), items: list }), { interactive, name: 'MARLI – za učenika.json' }).catch(() => '');
  diag('box', `${id ? 'upisano' : 'upis nije uspeo'} · ${items.map((i) => i.kind + (i.n ? '×' + i.n : '')).join(',')} · ${Math.round(JSON.stringify(list).length / 1024)} KB`);
  if (!id) return 'retry';
  // v2.4.2: šta je poslato ovom učeniku (za „viđeno“ i odgovor) — novije zamenjuje starije sa istim ključem
  { const cur2 = (await tm.getStudent(sid)) || st; const keys = new Set(items.map((i) => i.key)); await tm.updateStudent(sid, { sent: [...(cur2.sent || []).filter((x) => !keys.has(x.key)), ...items.filter((i) => i.kind !== 'ans').map((i) => ({ key: i.key, kind: i.kind, name: clipN(i.name, 80), at: i.at || Date.now(), ...(i._ids ? { ids: i._ids.slice(0, 300) } : {}) }))].slice(-40) }); }
  return 'ok';
}
const clipN = (x, n) => String(x || '').slice(0, n);
/** v2.4.14: koraci slanja/primanja u dijagnostiku (kratko, bez sadržaja pesama). */
export function diag(k, m) { try { const L = JSON.parse(localStorage.getItem('gitara-diag') || '[]'); L.push({ t: Date.now(), k, m: String(m).slice(0, 200) }); localStorage.setItem('gitara-diag', JSON.stringify(L.slice(-80))); } catch {} }
/** v2.4.14: „Pošalji kao link“ — pesme u samom linku (do ~7 pesama) ili .gitara fajl; ide preko Viber/WhatsApp, bez Google-a. */
export async function sendAsLink(sid, key) {
  const tm = await TM(); const st = await tm.getStudent(sid); const e = st && (st.sent || []).find((x) => x.key === key);
  if (!e || !e.ids) return false;
  const { songs } = await import('./db.js');
  const list = (await Promise.all(e.ids.map((id) => songs.get(id).catch(() => null)))).filter((s) => s && !s.deleted);
  return shareSongsAsLink(list, e.kind === 'set' ? e.name : null, st.name);
}
export async function shareSongsAsLink(list, setName = null, who = '') {
  if (!list.length) return false;
  const tm = await TM(); const tc = await tm.setTeacher({});
  const title = setName || (list.length === 1 ? list[0].title : t('les.nSongs', { n: list.length }));
  const S = await import('./shareService.js');
  const r = await S.shareSongsLink(list, { setName, title, text: t('les.linkText', { t: tc.name || '', what: title }), pkgExtra: { ft: { tid: tc.id, name: clipN(tc.name, 60) } } });
  if (r === 'copied') toast(t('les.linkCopied', { name: who }));
  if (r) diag('box', `poslato kao ${r === 'file' ? 'fajl' : 'link'} (${list.length})`);
  return !!r;
}
/** v2.4.14: „Pošalji ponovo“ — iste pesme (po id-jevima sa prvog slanja) kao nova stavka. */
export async function resend(sid, key) {
  const tm = await TM(); const st = await tm.getStudent(sid); const e = st && (st.sent || []).find((x) => x.key === key);
  if (!e || !e.ids || !e.ids.length) return false;
  const { songs } = await import('./db.js');
  const list = (await Promise.all(e.ids.map((id) => songs.get(id).catch(() => null)))).filter((s) => s && !s.deleted);
  if (!list.length) return false;
  const box = await inlineItem({ kind: e.kind, name: e.name, share: { songs: list } }); if (!box) return false;
  return boxPut(sid, [{ ...box, at: Date.now() }]);
}
// ---------------- v2.4.11: odlazno (šalje se čim Google dozvoli) ----------------
const OUTBOX = 'boxOutbox';
async function outbox() { const { settings } = await import('./db.js'); return (await settings.get(OUTBOX, null)) || {}; }
async function setOutbox(o) { const { settings } = await import('./db.js'); await settings.set(OUTBOX, o); }
async function enqueue(sid, items) {
  const o = await outbox(); const map = new Map((o[sid] || []).map((x) => [x.key, x]));
  for (const it of items) map.set(it.key, { ...it, at: it.at || Date.now() });
  o[sid] = [...map.values()].slice(-MAX_ITEMS); await setOutbox(o);
}
/** Koliko stavki čeka slanje (za tog učenika ili ukupno). */
export async function pendingCount(sid = null) { const o = await outbox(); return sid ? (o[sid] || []).length : Object.values(o).reduce((a, l) => a + l.length, 0); }
let flushing = null;
/** Pošalji sve što čeka (ćutke). Vraća broj poslatih stavki. */
export function flushOutbox() {
  if (flushing) return flushing;
  flushing = (async () => {
    const o = await outbox(); let sent = 0; const done = [];
    for (const [sid, items] of Object.entries(o)) {
      if (!items || !items.length) continue;
      if ((await import('./driveGate.js')).cooling()) break;
      const p = (queues.get(sid) || Promise.resolve()).then(() => writeBox(sid, items, false));
      queues.set(sid, p.catch(() => {}));
      const r = await p.catch(() => 'retry');
      if (r === 'ok') { sent += items.length; done.push(sid); }
      else if (r === 'no') done.push(sid);
      else break; // Google još traži pauzu — sledeći put
    }
    if (done.length) { const cur = await outbox(); for (const sid of done) delete cur[sid]; await setOutbox(cur); }
    if (sent) {
      const N = await import('./notify.js'); const tm = await TM();
      const names = (await Promise.all(done.map((sid) => tm.getStudent(sid)))).filter(Boolean).map((x) => x.name).slice(0, 3).join(', ');
      await N.add({ id: 'outbox:' + Date.now(), who: '✓', c: '#3dd68c', t: t('box.flushed', { n: sent }), s: names }).catch(() => {});
    }
    return sent;
  })().finally(() => { flushing = null; });
  return flushing;
}
/** Dodaj (ili zameni, po ključu) stavke u sanduče učenika. Vraća true ako je upisano ili čeka slanje (šalje se samo čim Google dozvoli). */
export function boxPut(sid, items, { interactive = true } = {}) {
  const run = async () => {
    const r = await writeBox(sid, items, interactive);
    if (r === 'ok') return true;
    if (r === 'no') return false;
    await enqueue(sid, items); boxPut.queued = (boxPut.queued || 0) + 1; // v2.4.11: ne gubi se — šalje se kasnije
    try { const L = JSON.parse(localStorage.getItem('gitara-diag') || '[]'); L.push({ t: Date.now(), k: 'box', m: 'queued ' + items.length }); localStorage.setItem('gitara-diag', JSON.stringify(L.slice(-80))); } catch {}
    return true;
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
  // v2.4.11: posle ponovnog otvaranja aplikacije ne odmah (najviše jednom u 2 min) i nikad dok Google traži pauzu
  if (!force) { let last = 0; try { last = Number(localStorage.getItem('marli-last-box')) || 0; } catch {} let cool = 0; try { cool = (JSON.parse(localStorage.getItem('marli-drive-cool') || 'null') || {}).until || 0; } catch {} if (Date.now() - last < 120000 || cool > Date.now()) return Promise.resolve(0); }
  lastCheck = Date.now();
  try { localStorage.setItem('marli-last-box', String(lastCheck)); } catch {}
  checking = (async () => {
    const tm = await TM(); const m = await tm.getMyTeacher();
    if (!m || !m.box) return 0;
    const S = await S_();
    const d = await S.readData(m.box);
    const note = (o) => { try { localStorage.setItem('marli-box-last', JSON.stringify({ at: Date.now(), ...o })); } catch {} }; // v2.4.14: za „Proveri sada“
    if (!d) { const G = await import('./driveGate.js'); note({ ok: false, why: G.cooling() ? 'rate' : 'net' }); diag('box', 'sanduče nastavnika nije moglo da se pročita'); return 0; }
    if (d.gone || d.type !== 'box' || d.tid !== m.tid) { note({ ok: false, why: 'gone' }); return 0; }
    note({ ok: true });
    const seen = { ...(m.boxSeen || {}) }; const fresh = []; let n = 0; const notes = []; const fmap = {}; const les = []; const got = [];
    const fromT = { tid: m.tid, name: m.name };
    for (const it of (d.items || []).slice(-MAX_ITEMS)) {
      if (!it || !it.key || (seen[it.key] || 0) >= (it.at || 1)) continue;
      try {
        if (it.kind === 'note' || it.kind === 'lesson' || it.kind === 'nudge' || it.kind === 'goal') { // v2.4.9: i cilj vežbanja // v2.4.2: beleška sa časa, sledeći čas, podsetnik
          const L = await import('./lessons.js'); const r = await L.receive(it, m); if (r) les.push({ it, r });
        } else if (it.kind === 'cmt') { // v2.4.3: komentar na moj snimak
          const C = await import('./recComments.js'); const r = await C.receive(it, m); if (!r) continue; les.push({ it, r });
        } else if (it.kind === 'song' || it.kind === 'set') {
          const I = await import('./shareImport.js');
          // v2.4.14: pesme u samom sanduču (it.d) — bez drugog preuzimanja; inače deljeni fajl (it.f)
          const src = it.d ? String(it.key).split(':')[1] : it.f;
          if (!src) continue;
          fmap[src] = it.key; // v2.4.2: pesma/set lista ↔ stavka (za „viđeno“ i odgovor)
          let pkg = null;
          if (it.d) { try { const C = await import('./shareCode.js'); pkg = C.readPackage(await C.decode(it.d)); } catch (e) { diag('box', 'paket u sanduču nije ispravan: ' + ((e && e.message) || e)); seen[it.key] = it.at || Date.now(); continue; } }
          else pkg = await I.fetchPackage(it.f);
          if (!pkg || !pkg.songs || !pkg.songs.length) { diag('box', 'paket još nije dostupan (' + (it.d ? 'unutra' : 'fajl') + ')'); continue; } // fajl još nije dostupan — sledeći put
          const mine = it.rp && pkg.songs.length === 1 ? await (await import('./db.js')).songs.get(it.rp).catch(() => null) : null;
          if (mine && !mine.deleted) { await tm.replaceWithTeacher(mine, pkg.songs[0]); fresh.push(mine.id); } // ispravka učenikove pesme (stara ostaje u Prethodnim verzijama)
          else { const r = await I.importTagged(pkg, src, { fromT }, { fromT }); fresh.push(...(r.ids || [])); }
          got.push(it.key); diag('box', `primljeno ${pkg.songs.length} pesama`); // v2.4.14: potvrda „stiglo“ nastavniku
          if (it.rq) await tm.markAnswered(it.rq, pkg.name || pkg.songs[0].title || '');
        } else if (it.kind === 'ans') await tm.answerFromBox(it.id, it.s);
        else if (it.kind === 'plan') await (await import('./plan.js')).acceptPlanFile(it.f);
        else if (it.kind === 'rp') { if (!(await (await import('./pRP.js')).receive(it.rp, fromT))) continue; } // v2.1: Ritam i promene od nastavnika
        else if (it.kind === 'ex') { if (!(await (await import('./myEx.js')).receive(it.ex, fromT))) continue; } // v1.97: vežba od nastavnika
        else if (it.kind !== 'rcv') continue; // v2.4.21: „rcv“ = nastavnik je primio moj snimak (samo obaveštenje)
        seen[it.key] = it.at || Date.now(); n++;
        notes.push(it);
      } catch (e) { console.warn('box', e); }
    }
    if (got.length) (await import('./lessons.js')).markGot(got); // v2.4.14
    if (n) {
      const cur = await tm.getMyTeacher();
      if (cur && cur.tid === m.tid) {
        const keep = Object.fromEntries(Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 400));
        await tm.setMyTeacher({ ...cur, boxSeen: keep, boxNew: [...new Set([...(cur.boxNew || []), ...fresh])].slice(-60), boxAt: Date.now(), boxF: Object.fromEntries(Object.entries({ ...(cur.boxF || {}), ...fmap }).slice(-200)) });
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
      for (const { it: x, r } of les) await N.add({ id: 'les:' + x.key + ':' + x.at, who, c: '#f5a524', t: r.t, s: r.s || '', href: r.href || '#/od-nastavnika' }); // v2.4.2
      for (const x of notes.filter((y) => y.kind === 'rcv')) await N.add({ id: 'rcv:' + x.key, who, c: '#3dd68c', t: t('nt.rcv', { t: tn }), s: x.name || '', href: '#/od-nastavnika' }); // v2.4.21
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
  // v2.4.2: učenik otvori pesmu ili set listu od nastavnika → nastavnik vidi „viđeno“; podsetnik dan pred čas
  const seenOpen = async () => {
    const mm = /^#\/(pesma|setlista)\/([^/?]+)/.exec(location.hash); if (!mm) return;
    const id = decodeURIComponent(mm[2]); const tm = await TM(); const me = await tm.getMyTeacher(); if (!me || !me.boxF) return;
    let src = '';
    if (mm[1] === 'pesma') { const sg = await (await import('./db.js')).songs.get(id).catch(() => null); if (sg && sg.fromT && sg.src) src = String(sg.src).split(':')[0]; }
    else { const sl = (await (await import('./collections.js')).getSetlists()).find((x) => x.id === id); if (sl && sl.fromT && sl.src) src = sl.src; }
    const key = src && me.boxF[src]; if (key) (await import('./lessons.js')).markSeen(key);
  };
  addEventListener('hashchange', () => { seenOpen().catch(() => {}); });
  setTimeout(() => import('./lessons.js').then((L) => L.studentReminder()).catch(() => {}), 9000);
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
/** v2.4.21: nastavnik — „Ana se povezala s tobom“ (jednom) i kratka tura. */
export async function connNote(st) {
  await note(st, 'conn', t('nt.conn', { name: st.name }), t('nt.connSub2'));
  (await import('./teachTour.js')).pending('t', st.id);
}
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
        boxPut(st.id, [{ key: 'rcv:' + String(o.id).slice(0, 40), kind: 'rcv', name: String(o.title || '').slice(0, 80), at: Date.now() }], { interactive: false }).catch(() => {}); // v2.4.21: učenik vidi „primio tvoj snimak ✓“
      } else if (o.type === 'rp' && o.ex) { // v2.1: napredak u „Ritam i promene“ (korak n od m)
        const cur = (await tm.getStudent(st.id)) || st; const step = Math.max(0, Math.min(20, Number(o.step) || 0)), of = Math.max(1, Math.min(20, Number(o.of) || 1));
        await tm.updateStudent(st.id, { rp: { ...(cur.rp || {}), [clip(o.ex, 40)]: { step, of, name: clip(o.name, 60), at: Number(o.at) || Date.now() } } });
        if (step >= of) await note(st, 'rp:' + o.id, t('nt.rpDone', { name: st.name }), clip(o.name, 80));
      } else if (o.type === 'cant' && o.ts) { // v2.4.24: „Ne mogu da dođem“
        const L = await import('./lessons.js');
        await note(st, 'cant:' + o.ts, t('sch.ntCant', { name: st.name }), L.lessonWhen(Number(o.ts)));
        seen[st.id + ':' + o.id] = Date.now(); n++; continue;
      } else if (o.type === 'hello') { // v2.4.21: učenik se upravo povezao
        const cur = (await tm.getStudent(st.id)) || st;
        if (!cur.connAt) { await tm.updateStudent(st.id, { connAt: Number(o.at) || Date.now() }); await connNote(st); }
        seen[st.id + ':' + o.id] = Date.now(); n++; continue;
      } else if (o.type === 'seen' || o.type === 'react' || o.type === 'session' || o.type === 'got') { await (await import('./lessons.js')).ingestFromStudent(st, o); seen[st.id + ':' + o.id] = Date.now(); n++; continue; } // v2.4.2
      else continue;
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
    await flushOutbox().catch(() => 0); // v2.4.11: prvo ono što čeka slanje
    const P = await import('./progress.js');
    for (const st of await tm.getStudents()) if (st.prog && st.prog.fileId) await P.studentProgress(st, { fresh: true }).catch(() => null);
    await (await import('./lessons.js')).teacherReminders().catch(() => {}); // v2.4.2: sutrašnji časovi u zvonce
    await (await import('./studentProfile.js')).dateReminders().catch(() => {}); // v2.4.23: rođendani i godišnjice
    await (await import('./schedule.js')).refreshNext().catch(() => {}); // v2.4.24: sledeći čas iz redovnog termina
  };
  let last = 0; const maybe = () => { if (Date.now() - last > 2 * 60000) { last = Date.now(); run().catch(() => {}); } };
  setTimeout(maybe, 8000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) maybe(); });
  setInterval(() => { if (!document.hidden) { last = 0; maybe(); } }, 15 * 60000);
  setInterval(() => { if (!document.hidden) pendingCount().then((n) => n && flushOutbox()).catch(() => {}); }, 3 * 60000); // v2.4.11
  addEventListener('online', () => setTimeout(() => flushOutbox().catch(() => {}), 5000));
}
