// v1.78: Nastava — „Ja sam nastavnik“ (podrazumevano isključeno), učenici, slanje učenicima i nazad.
// Privatnost: biblioteke se nikad ne dele; razmenjuje se samo ono što neko namerno pošalje, uvek preko
// sopstvene aplikacije za poruke (imejl / Viber / WhatsApp) — MARLI sam nikome ništa ne šalje. Podaci o
// učenicima (ime, opcioni kontakt) su samo kod nastavnika: uređaj + njegova Google sinhronizacija.
// Učenik je običan korisnik: veza sa nastavnikom nastaje kad otvori pozivnicu i može da je prekine.
import { settings } from './db.js';
import { t } from './i18n.js';
import { esc, dialog, toast } from './ui.js';

export const COLORS = ['#ff7cc3', '#5aa9ff', '#9be15d', '#ffd75e', '#b48cff', '#4fd1c5', '#ff9f5a', '#f472b6'];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clip = (s, n) => String(s || '').trim().slice(0, n);
const pingNav = () => { try { dispatchEvent(new Event('marli-teach')); } catch {} }; // v1.81: kartica „Učenici“ (broj zahteva)

// ---------------- nastavnik ----------------
export async function getTeacher() { return (await settings.get('teacher', null)) || { on: false }; }
export async function setTeacher(patch) {
  const cur = await getTeacher();
  const next = { ...cur, ...patch };
  if (!next.id) next.id = uid();
  await settings.set('teacher', next);
  if ('on' in patch) pingNav();
  return next;
}
export const isTeacher = async () => !!(await getTeacher()).on;
/** Ime za poruke: upisano u Nastavi, inače ime Google naloga (deljenje), inače prazno. */
export async function teacherName() {
  const tc = await getTeacher();
  if (tc.name) return tc.name;
  try { const n = await settings.get('shareName', ''); if (n) return n; } catch {}
  return '';
}

// ---------------- učenici ----------------
export async function getStudents() { return ((await settings.get('students', [])) || []).filter((s) => s && s.id); }
export async function getStudent(id) { return (await getStudents()).find((s) => s.id === id) || null; }
export async function addStudent({ name, contact = '' }) {
  const list = await getStudents();
  const s = { id: uid(), name: clip(name, 60), contact: clip(contact, 120), color: COLORS[list.length % COLORS.length], createdAt: Date.now() };
  await settings.set('students', [...list, s]);
  return s;
}
export async function updateStudent(id, patch) {
  const list = await getStudents();
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...patch, name: clip(patch.name ?? list[i].name, 60), contact: clip(patch.contact ?? list[i].contact, 120) };
  await settings.set('students', list);
  return list[i];
}
/** Brisanje učenika: ime i kontakt nestaju; njegovi snimci ostaju („Bez učenika“), set liste ostaju (bez njega). */
export async function removeStudent(id) {
  const gone = await getStudent(id); if (gone && gone.planFile) await (await import('./plan.js')).dropPlanFile(gone).catch(() => {}); // v1.83: i fajl sa planom
  await settings.set('students', (await getStudents()).filter((s) => s.id !== id));
  const { songs } = await import('./db.js');
  for (const s of await songs.all()) if (s.student === id) { const { student, ...rest } = s; await songs.save(rest); }
  const c = await import('./collections.js');
  for (const sl of await c.getSetlists()) if ((sl.students || []).includes(id)) await c.updateSetlist(sl.id, { students: sl.students.filter((x) => x !== id) });
  // v1.79: i njegovi zahtevi i zapis poslatog
  await settings.set('requests', ((await settings.get('requests', [])) || []).filter((r) => r && r.sid !== id));
  const tc = await getTeacher(); if ((tc.sentLog || []).some((e) => e.sid === id)) await setTeacher({ sentLog: tc.sentLog.filter((e) => e.sid !== id) });
}
export const initialOf = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();
export const avatarHTML = (s, size = 40) => `<span class="tch-av" style="--c:${esc(s.color || COLORS[0])};--s:${size}px" aria-hidden="true">${esc(initialOf(s.name))}</span>`;

// ---------------- učenik: moj nastavnik ----------------
export async function getMyTeacher() { return (await settings.get('myTeacher', null)) || null; }
export async function setMyTeacher(v) { await settings.set('myTeacher', v); }

// ---------------- linkovi (dodatak iza #d/<fajl> stari ignorišu) ----------------
const qs = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
/** Pozivnica: #poziv/<id nastavnika>/<id učenika>?n=<ime>&c=<kontakt> */
export async function inviteLink(student) {
  const { SHARE_BASE } = await import('./shareConfig.js');
  const tc = await setTeacher({});
  const st = (await getStudent(student.id)) || student; // v1.94: b = sanduče (pesme stižu same, bez poruka)
  return `${SHARE_BASE}#poziv/${encodeURIComponent(tc.id)}/${encodeURIComponent(student.id)}?${qs({ n: await teacherName(), c: tc.contact || '', b: (st.box && st.box.f) || '' })}`;
}
/** Nastavnik → učenik: dodatak linku poslatog fajla. */
export async function toStudentSuffix(student, rq = '', rp = '') {
  const tc = await setTeacher({});
  return '?' + qs({ tt: tc.id, ts: student.id, tn: await teacherName(), tc: tc.contact || '', rq, rp }); // v1.80: rp = učenikova pesma koju ovo zamenjuje
}
/** Učenik → nastavnik. */
export async function toTeacherSuffix() {
  const m = await getMyTeacher();
  return m ? '?' + qs({ ft: m.tid, fs: m.sid }) : '';
}
/** Parametri iz linka (posle #d/<fajl>?…). */
export function linkParams(hash = location.hash) {
  const i = hash.indexOf('?');
  const p = i < 0 ? new URLSearchParams() : new URLSearchParams(hash.slice(i + 1));
  // Android „Otvori u aplikaciji“ (?d=<fajl>&tt=…): parametri su u adresi, ne iza #
  try { for (const [k, v] of new URLSearchParams(location.search)) if (k !== 'd' && !p.has(k)) p.set(k, v); } catch {}
  return p;
}

// ---------------- otvaranje poruke (uvek preko korisnikove aplikacije) ----------------
/** Otvori poruku za jednu osobu — preko shareService.composeMessage (jedino mesto koje otvara meni za deljenje). */
export async function compose(m) { return (await import('./shareService.js')).composeMessage(m); }

/** v1.94: pozivnica bez poruke — sanduče (ako može), pa link za kopiranje (za časove preko interneta). */
export async function copyInvite(student) {
  try { await (await import('./teachBox.js')).ensureBox(student.id, { interactive: true }); } catch {}
  const link = await inviteLink(student);
  try { await navigator.clipboard.writeText(link); toast(t('qr.copied')); } catch { toast(link); }
  return link;
}

// ---------------- uvoz označenih linkova (poziva ga shareImport.renderDriveShare) ----------------
/** Vraća true ako je link od nastavnika (kod učenika) ili od učenika (kod nastavnika) i obrađen je ovde. */
export async function handleTaggedImport({ pkg, fileId, show, btn, card, clearHash, el }) {
  const p = linkParams();
  const { importTagged } = await import('./shareImport.js');
  const list = () => { const ol = el('ol', 'share-list'); for (const s of pkg.songs.slice(0, 60)) { const li = el('li'); li.appendChild(el('b', '', s.title)); if (s.artist) li.appendChild(el('span', 'small muted', ' — ' + s.artist)); ol.appendChild(li); } return ol; };
  // od nastavnika → kod učenika: „Od nastavnika“, isti link = ažuriranje (bez duplikata)
  if (p.get('tt')) {
    const me = await getTeacher();
    if (me.id && me.id === p.get('tt')) return false; // nastavnik je otvorio sopstveni link — običan uvoz
    const info = { tid: p.get('tt'), sid: p.get('ts') || '', name: p.get('tn') || '', contact: p.get('tc') || '' };
    const my = await getMyTeacher();
    const fresh = !my || my.tid !== info.tid;
    const name = info.name || t('tch.teacher');
    // v1.80: ispravka učenikove pesme (rp) — prikaži izmene: „Zameni moju“ (stara ide u Prethodne verzije) ili „Zadrži obe“
    const rp = p.get('rp');
    const mine = rp && pkg.songs.length === 1 ? await (await import('./db.js')).songs.get(rp).catch(() => null) : null;
    if (mine && !mine.deleted) {
      const nu = pkg.songs[0];
      show(t('chk.gotTitle', { t: name, name: mine.title }), t('chk.gotBody'), [
        btn(t('chk.keepBoth'), '', async () => {
          const r = await importTagged(pkg, fileId, { fromT: { tid: info.tid, name: info.name } }, { fromT: { tid: info.tid, name: info.name } });
          if (p.get('rq')) await markAnswered(p.get('rq'), nu.title);
          toast(t('tch.got.saved')); clearHash('#/pesma/' + encodeURIComponent(r.ids[0]));
        }),
        btn(t('chk.replace'), 'primary', async () => {
          await replaceWithTeacher(mine, nu);
          if (p.get('rq')) await markAnswered(p.get('rq'), nu.title);
          toast(t('chk.replaced')); clearHash('#/pesma/' + encodeURIComponent(mine.id));
        }),
      ]);
      card.insertBefore(diffEl(mine, nu, el), card.lastChild);
      return true;
    }
    show(t(pkg.kind === 'set' ? 'tch.got.set' : 'tch.got.song', { t: name, name: pkg.name || pkg.songs[0]?.title || '' }), fresh ? t('tch.got.connect', { t: name }) : t('tch.got.update'), [
      btn(t('common.cancel'), '', () => clearHash()),
      btn(t('tch.got.save'), 'primary', async () => {
        if (fresh) await setMyTeacher({ ...info, at: Date.now() });
        else if (my.name !== info.name || my.contact !== info.contact) await setMyTeacher({ ...my, name: info.name || my.name, contact: info.contact || my.contact });
        const fromT = { tid: info.tid, name: info.name };
        const r = await importTagged(pkg, fileId, { fromT }, { fromT });
        if (p.get('rq')) await markAnswered(p.get('rq'), pkg.name || pkg.songs[0]?.title || ''); // v1.79: odgovor na zahtev
        toast(r.updated && !r.added ? t('tch.got.updated') : t('tch.got.saved'));
        clearHash(r.setId ? '#/setlista/' + encodeURIComponent(r.setId) : '#/pesma/' + encodeURIComponent(r.ids[0]));
      }),
    ]);
    card.insertBefore(list(), card.lastChild);
    return true;
  }
  // od učenika → kod nastavnika: snimak ide pravo kod tog učenika
  if (p.get('ft')) {
    const me = await getTeacher();
    if (!me.on || me.id !== p.get('ft')) return false;
    const st = await getStudent(p.get('fs'));
    if (!st) return false;
    const { REC_FOLDER, ensureRecFolder } = await import('./collections.js');
    // v1.80: „Proveri pesmu“ — zahtev kod učenika, pa izbor (Ispravi i vrati / Moja verzija / Kopija / U redu je)
    if (p.get('pc') && pkg.songs.length === 1) {
      const s0 = pkg.songs[0];
      const req = await addCheckRequest({ id: p.get('pc'), sid: st.id, title: s0.title, artist: s0.artist || '', note: p.get('pn') || '', fileId, ps: p.get('ps') || '' });
      clearHash('#/ucenik/' + encodeURIComponent(st.id));
      setTimeout(() => import('./teachView.js').then((V) => V.checkFlow(req.id, pkg)).catch(() => {}), 350);
      return true;
    }
    show(t('tch.got.fromStudent', { name: st.name }), t('tch.got.fromStudentBody', { name: st.name }), [
      btn(t('common.cancel'), '', () => clearHash()),
      btn(t('tch.got.saveAt', { name: st.name }), 'primary', async () => {
        await ensureRecFolder();
        const r = await importTagged(pkg, fileId, (song) => ({ student: st.id, fromStudent: 1, ...(song.recording ? { folders: [REC_FOLDER] } : {}) }));
        toast(t('tch.got.savedAt', { name: st.name }));
        clearHash('#/ucenik/' + encodeURIComponent(st.id));
      }),
    ]);
    card.insertBefore(list(), card.lastChild);
    return true;
  }
  return false;
}

// ---------------- v1.79: zahtevi učenika (želja / „Imaš li ovu pesmu?“) — bez Google naloga ----------------
// Učenik → nastavnik: link #zahtev/<podaci> u poruci (preko učenikove aplikacije). Nastavnik → učenik: odgovor je
// poslata pesma (link sa rq=<id>) ili „Nemam“ (link #odgovor/<podaci>) — tada i učenik vidi stanje zahteva.
const b64e = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = (s) => JSON.parse(decodeURIComponent(escape(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')))));
export const encodeLink = b64e, decodeLink = b64d; // v1.83: i za link plana
export const REQ_TYPES = ['wish', 'ask'];
/** Nastavnik: kratak zapis poslatog (za pregled) — samo kod nastavnika, najviše 300 poslednjih. */
// v1.92: pamti i koje pesme su poslate (za „Poslate pesme“ na računaru i „već poslato“ pri slanju)
export async function logSent(sids, kind, songs = []) {
  const tc = await getTeacher(); const at = Date.now();
  const ss = (songs || []).filter((x) => x && x.id).slice(0, 60).map((x) => ({ id: x.id, t: clip(x.title || '', 80), a: clip(x.artist || '', 60) }));
  await setTeacher({ sentLog: [...(tc.sentLog || []), ...sids.map((sid) => ({ sid, kind, at, ...(ss.length ? { songs: ss } : {}) }))].slice(-600) });
}
/** Sve poslate pesme: { id, title, artist, sids: { [učenik]: kad }, last } — iz dnevnika slanja i poslatih set lista. */
export async function sentSongs() {
  const tc = await getTeacher(); const map = new Map();
  const add = (id, title, artist, sid, at) => { if (!id || !sid) return; const e = map.get(id) || { id, title, artist, sids: {}, last: 0 }; if (title) e.title = title; if (artist) e.artist = artist; e.sids[sid] = Math.max(e.sids[sid] || 0, at); e.last = Math.max(e.last, at); map.set(id, e); };
  for (const e of tc.sentLog || []) for (const x of e.songs || []) add(x.id, x.t, x.a, e.sid, e.at);
  try { const c = await import('./collections.js'); for (const sl of await c.getSetlists()) for (const [sid, at] of Object.entries(sl.sentTo || {})) for (const id of sl.songIds || []) add(id, '', '', sid, at); } catch {}
  return [...map.values()];
}
export async function getRequests() { return ((await settings.get('requests', [])) || []).filter((r) => r && r.id); }
export async function setRequest(id, patch) {
  const list = await getRequests(); const i = list.findIndex((r) => r.id === id); if (i < 0) return null;
  list[i] = { ...list[i], ...patch }; await settings.set('requests', list); pingNav(); return list[i];
}
export async function getMyRequests() { return ((await settings.get('myRequests', [])) || []).filter((r) => r && r.id); }
async function setMyRequest(id, patch) {
  const list = await getMyRequests(); const i = list.findIndex((r) => r.id === id); if (i < 0) return null;
  list[i] = { ...list[i], ...patch }; await settings.set('myRequests', list); return list[i];
}
/** Učenik: želja ili pitanje — v1.94: ide kroz fajl napretka (nastavnikova aplikacija ga sama pročita), bez poruke. */
export async function askTeacher({ type, title, artist = '', note = '' }) {
  const m = await getMyTeacher(); if (!m || !REQ_TYPES.includes(type)) return false;
  const req = { id: uid(), type, title: clip(title, 80), artist: clip(artist, 60), note: clip(note, 300), at: Date.now() };
  const B = await import('./teachBox.js');
  if (!(await B.outPush(req))) return false;
  await settings.set('myRequests', [...(await getMyRequests()), { ...req, status: 'sent' }]);
  toast(t('box.wishSent', { t: m.name || t('tch.teacher') }));
  return true;
}
/** Nastavnik: zahtev iz učenikovog fajla napretka (v1.94). */
export async function addRequest(r) {
  const list = await getRequests();
  if (list.some((x) => x.id === r.id)) return;
  const st = await getStudent(r.sid);
  list.push({ ...r, status: 'open' }); await settings.set('requests', list); pingNav();
  if (st) toast(t(r.type === 'wish' ? 'tch.rq.gotWish' : 'tch.rq.gotAsk', { name: st.name }));
}
/** Nastavnik otvara link zahteva → zahtev ide u spisak (kod tog učenika). Vraća učenika ili null. */
export async function receiveRequest(hash) {
  let d; try { d = b64d(hash.replace(/^#zahtev\//, '').split(/[?#]/)[0]); } catch { toast(t('tch.rq.bad')); return null; }
  const me = await getTeacher();
  if (!me.on || d.ft !== me.id) { toast(t('tch.rq.notMine')); return null; }
  const st = await getStudent(d.fs); if (!st) { toast(t('tch.rq.noStudent')); return null; }
  if (!REQ_TYPES.includes(d.type) || !d.id || !d.title) { toast(t('tch.rq.bad')); return null; }
  const list = await getRequests();
  if (!list.some((r) => r.id === d.id)) {
    list.push({ id: clip(d.id, 40), sid: st.id, type: d.type, title: clip(d.title, 80), artist: clip(d.artist, 60), note: clip(d.note, 300), at: Number(d.at) || Date.now(), status: 'open' });
    await settings.set('requests', list); pingNav();
  }
  toast(t(d.type === 'wish' ? 'tch.rq.gotWish' : 'tch.rq.gotAsk', { name: st.name }));
  return st;
}
/** v1.94: kratak odgovor učeniku kroz sanduče („Nemam“ / „U redu je“). false = učenik još nije povezan (QR). */
async function boxAnswer(req, s) {
  const st = await getStudent(req.sid); if (!st) return false;
  const B = await import('./teachBox.js');
  if (!(st.box && st.box.f)) { toast(t('box.notConn', { name: st.name }), 'error'); return false; }
  if (!(await B.boxPut(st.id, [{ key: 'ans:' + req.id, kind: 'ans', id: req.id, s }]))) { toast(t('box.failed'), 'error'); return false; }
  await setRequest(req.id, { status: s, doneAt: Date.now() });
  toast(t('box.answered', { name: st.name }));
  return true;
}
/** Nastavnik: „Nemam“. */
export const answerNone = (req) => boxAnswer(req, 'none');
/** Učenik otvara „Nemam“ odgovor. */
export async function receiveAnswer(hash) {
  let d; try { d = b64d(hash.replace(/^#odgovor\//, '').split(/[?#]/)[0]); } catch { return; }
  const m = await getMyTeacher(); if (!m || d.tt !== m.tid) return;
  const st = d.s === 'none' ? 'none' : d.s === 'ok' ? 'ok' : 'answered';
  const r = await setMyRequest(d.id, { status: st, answeredAt: Date.now() });
  if (r) toast(t(st === 'none' ? 'tch.rq.ansNone' : st === 'ok' ? 'chk.ansOk' : 'tch.rq.ansOk', { title: r.title, t: m.name || t('tch.teacher') }));
}
/** Učenik: odgovor stigao kroz sanduče. */
export async function answerFromBox(id, s) {
  const m = await getMyTeacher(); if (!m) return;
  const st = s === 'none' ? 'none' : s === 'ok' ? 'ok' : 'answered';
  const r = await setMyRequest(id, { status: st, answeredAt: Date.now() });
  if (r) toast(t(st === 'none' ? 'tch.rq.ansNone' : st === 'ok' ? 'chk.ansOk' : 'tch.rq.ansOk', { title: r.title, t: m.name || t('tch.teacher') }));
}
/** Učenik je uvezao pesmu poslatu kao odgovor (rq u linku). */
export async function markAnswered(id, title = '') { const r = await setMyRequest(id, { status: 'answered', answeredAt: Date.now(), gotTitle: clip(title, 80) }); return r; }

// ---------------- v1.80: napredak (link do fajla) i „Proveri pesmu“ ----------------
/** Učenik → nastavnik: link do fajla sa napretkom — v1.94: prikazuje se kao QR (jednom), nastavnik ga skenira. */
export async function progressLink(fileId) {
  const m = await getMyTeacher(); if (!m) return '';
  const { SHARE_BASE } = await import('./shareConfig.js');
  return `${SHARE_BASE}#napredak/${b64e({ v: 1, ft: m.tid, fs: m.sid, f: fileId })}`;
}
/** Nastavnik otvara link napretka → zapamti fajl kod tog učenika. */
export async function receiveProgress(hash) {
  const raw = hash.replace(/^#napredak\//, '').split(/[?#]/)[0];
  if (raw.startsWith('z.')) return receiveProgressMsg(raw.slice(2)); // v1.84: napredak poslat porukom (bez Google naloga)
  let d; try { d = b64d(raw); } catch { toast(t('tch.rq.bad')); return null; }
  const me = await getTeacher();
  if (!me.on || d.ft !== me.id) { toast(t('tch.rq.notMine')); return null; }
  const st = await getStudent(d.fs); if (!st) { toast(t('tch.rq.noStudent')); return null; }
  if (!d.f || !/^[\w-]{6,}$/.test(d.f)) { toast(t('tch.rq.bad')); return null; }
  await updateStudent(st.id, { prog: { fileId: d.f, since: Date.now() } });
  toast(t('prog.got', { name: st.name }));
  return st;
}
async function receiveProgressMsg(z) {
  let d; try { const LZ = (await import('./lzstring.js')).default; d = JSON.parse(LZ.decompressFromEncodedURIComponent(z) || 'null'); } catch { d = null; }
  if (!d || d.v !== 2) { toast(t('tch.rq.bad')); return null; }
  const me = await getTeacher();
  if (!me.on || d.ft !== me.id) { toast(t('tch.rq.notMine')); return null; }
  const st = await getStudent(d.fs); if (!st) { toast(t('tch.rq.noStudent')); return null; }
  const at = Math.min(Date.now(), Number(d.at) || Date.now());
  if (st.prog && st.prog.msg && (st.prog.at || 0) > at) { toast(t('prog.olderMsg')); return st; } // stariji link: ne prepisuj noviji
  const data = (await import('./progress.js')).cleanSummary(d.d);
  if (!data) { toast(t('tch.rq.bad')); return null; }
  await updateStudent(st.id, { prog: { msg: true, at, since: (st.prog && st.prog.since) || Date.now() }, progData: data });
  toast(t('prog.gotMsg', { name: st.name }));
  return st;
}
/** Učenik: „Proveri sa nastavnikom“ — pesma se podeli (fajl), a zahtev ide kroz fajl napretka. v1.94: bez poruke. */
export async function askCheck(song, note = '') {
  const m = await getMyTeacher(); if (!m || !song) return false;
  const S = await import('./shareService.js');
  const res = await S.publishOnly(S.songItem(song));
  if (!res) return false;
  const id = uid();
  const B = await import('./teachBox.js');
  if (!(await B.outPush({ id, type: 'check', f: res.fileId, ps: song.id, title: clip(song.title, 80), artist: clip(song.artist || '', 60), note: clip(note, 300) }))) return false;
  await settings.set('myRequests', [...(await getMyRequests()), { id, type: 'check', title: clip(song.title, 80), artist: clip(song.artist || '', 60), songId: song.id, note: clip(note, 300), at: Date.now(), status: 'sent' }]);
  toast(t('box.checkSent', { t: m.name || t('tch.teacher') }));
  return true;
}
/** Nastavnik: zahtev „proveri“ iz linka (fajl ostaje kod učenika; nastavnik bira šta će). */
export async function addCheckRequest({ id, sid, title, artist, note, fileId, ps }) {
  const list = await getRequests();
  if (!list.some((r) => r.id === id)) {
    list.push({ id: clip(id, 40), sid, type: 'check', title: clip(title, 80), artist: clip(artist, 60), note: clip(note, 300), at: Date.now(), status: 'open', fileId, ps: clip(ps, 60) });
    await settings.set('requests', list); pingNav();
  }
  return (await getRequests()).find((r) => r.id === id);
}
/** Nastavnik: „U redu je“. */
export const answerOk = (req) => boxAnswer(req, 'ok');

/** Učenik: zameni svoju pesmu nastavnikovom ispravkom — isti id, folderi i podešavanja; stara ide u Prethodne verzije. */
export async function replaceWithTeacher(mine, nu) {
  const { songs, versions } = await import('./db.js');
  await versions.save('song:' + mine.id, mine, 'teacher');
  const { id, folders, createdAt, src, fromT, student, fromStudent, chk, deleted, ...content } = nu;
  await songs.save({ ...mine, ...content, id: mine.id, updatedAt: Date.now() });
}
/** Kratak prikaz izmena (redovi akorda i teksta): crveno staro, zeleno novo; najviše 8 redova. */
export function diffLines(a, b) {
  const n = a.length, m = b.length;
  if (n * m > 250000) return [{ k: '=', s: '…' }];
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { out.push({ k: '=', s: a[i] }); i++; j++; }
    else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) out.push({ k: '-', s: a[i++] }); // staro pa novo
    else out.push({ k: '+', s: b[j++] });
  }
  return out;
}
function diffEl(mine, nu, el) {
  const lines = (s) => (s.sections || []).flatMap((sec) => [sec.name ? `[${sec.name}]` : '', ...(sec.lines || []).map((l) => [(l.chords || []).map((c) => c.chord).join('  '), l.text || ''].filter(Boolean).join('  |  '))]).filter(Boolean);
  const d = diffLines(lines(mine), lines(nu));
  const changed = d.filter((x) => x.k !== '=');
  const box = el('div', 'chk-diff');
  if (mine.title !== nu.title) { const p = el('p', 'chk-t'); p.appendChild(el('del', '', mine.title)); p.appendChild(document.createTextNode(' → ')); p.appendChild(el('ins', '', nu.title)); box.appendChild(p); }
  if (!changed.length && mine.title === nu.title) box.appendChild(el('p', 'muted small', t('chk.noDiff')));
  for (const x of changed.slice(0, 8)) box.appendChild(el(x.k === '+' ? 'ins' : 'del', '', (x.k === '+' ? '+ ' : '− ') + x.s));
  if (changed.length > 8) box.appendChild(el('p', 'muted small', t('chk.more', { n: changed.length - 8 })));
  box.appendChild(el('p', 'muted small', t('chk.history')));
  return box;
}
