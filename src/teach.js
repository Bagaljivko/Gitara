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
  return `${SHARE_BASE}#poziv/${encodeURIComponent(tc.id)}/${encodeURIComponent(student.id)}?${qs({ n: await teacherName(), c: tc.contact || '' })}`;
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

/** Pozivnica za učenika (poruka od nastavnika, po imenu). */
export async function sendInvite(student) {
  const link = await inviteLink(student);
  const name = await teacherName();
  const text = t(name ? 'tch.inviteMsg' : 'tch.inviteMsgAnon', { s: student.name, t: name, link });
  return compose({ to: student.contact, subject: t('tch.inviteSubject', { t: name || 'MARLI' }), text });
}

/** Dijalog sa porukom koja se može izmeniti; vraća tekst ili null. */
export async function editMessage(title, text, note = '') {
  const p = dialog({ title, html: true, className: 'tch-dlg', body: `<textarea id="tchMsg" rows="5" maxlength="2000">${esc(text)}</textarea>${note ? `<p class="tch-lock">${esc(note)}</p>` : ''}`,
    buttons: [{ label: t('common.cancel'), value: null }, { label: t('tch.sendBtn'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  let v = text;
  box?.querySelector('#tchMsg')?.addEventListener('input', (e) => (v = e.target.value));
  return (await p) === 'ok' ? v : null;
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
export async function logSent(sids, kind) { const tc = await getTeacher(); const at = Date.now(); await setTeacher({ sentLog: [...(tc.sentLog || []), ...sids.map((sid) => ({ sid, kind, at }))].slice(-300) }); }
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
/** Učenik: pošalji nastavniku želju ili pitanje. */
export async function askTeacher({ type, title, artist = '', note = '' }) {
  const m = await getMyTeacher(); if (!m || !REQ_TYPES.includes(type)) return false;
  const req = { id: uid(), type, title: clip(title, 80), artist: clip(artist, 60), note: clip(note, 300), at: Date.now() };
  const { SHARE_BASE } = await import('./shareConfig.js');
  const link = `${SHARE_BASE}#zahtev/${b64e({ v: 1, ft: m.tid, fs: m.sid, ...req })}`;
  const what = req.artist ? `„${req.title}“ — ${req.artist}` : `„${req.title}“`;
  const text = t(type === 'wish' ? 'tch.rq.msgWish' : 'tch.rq.msgAsk', { what, note: req.note ? `\n${req.note}\n` : '', link });
  const final = await editMessage(t(type === 'wish' ? 'tch.rq.wish' : 'tch.rq.ask'), text, t('tch.lockMsg'));
  if (final == null) return false;
  await settings.set('myRequests', [...(await getMyRequests()), { ...req, status: 'sent' }]);
  await compose({ to: m.contact || '', subject: t('tch.rq.subject'), text: final });
  return true;
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
/** Nastavnik: „Nemam“ — poruka učeniku (njegova aplikacija ažurira stanje zahteva). */
export async function answerNone(req) {
  const st = await getStudent(req.sid); if (!st) return false;
  const tc = await setTeacher({});
  const { SHARE_BASE } = await import('./shareConfig.js');
  const link = `${SHARE_BASE}#odgovor/${b64e({ v: 1, tt: tc.id, id: req.id, s: 'none' })}`;
  const text = await editMessage(t('tch.rq.none'), t('tch.rq.msgNone', { s: st.name, title: req.title, link }), t('tch.lockMsg'));
  if (text == null) return false;
  await compose({ to: st.contact, subject: t('tch.subject', { t: (await teacherName()) || 'MARLI' }), text });
  await setRequest(req.id, { status: 'none', doneAt: Date.now() });
  return true;
}
/** Učenik otvara „Nemam“ odgovor. */
export async function receiveAnswer(hash) {
  let d; try { d = b64d(hash.replace(/^#odgovor\//, '').split(/[?#]/)[0]); } catch { return; }
  const m = await getMyTeacher(); if (!m || d.tt !== m.tid) return;
  const st = d.s === 'none' ? 'none' : d.s === 'ok' ? 'ok' : 'answered';
  const r = await setMyRequest(d.id, { status: st, answeredAt: Date.now() });
  if (r) toast(t(st === 'none' ? 'tch.rq.ansNone' : st === 'ok' ? 'chk.ansOk' : 'tch.rq.ansOk', { title: r.title, t: m.name || t('tch.teacher') }));
}
/** Učenik je uvezao pesmu poslatu kao odgovor (rq u linku). */
export async function markAnswered(id, title = '') { const r = await setMyRequest(id, { status: 'answered', answeredAt: Date.now(), gotTitle: clip(title, 80) }); return r; }

// ---------------- v1.80: napredak (link do fajla) i „Proveri pesmu“ ----------------
/** Učenik → nastavnik: link do fajla sa napretkom (samo jednom, kad se uključi). */
export async function sendProgressLink(fileId) {
  const m = await getMyTeacher(); if (!m) return false;
  const { SHARE_BASE } = await import('./shareConfig.js');
  const link = `${SHARE_BASE}#napredak/${b64e({ v: 1, ft: m.tid, fs: m.sid, f: fileId })}`;
  const text = await editMessage(t('prog.sendTitle'), t('prog.msg', { t: m.name || '', link }), t('prog.lockMsg', { t: m.name || t('tch.teacher') }));
  if (text == null) return false;
  await compose({ to: m.contact || '', subject: t('prog.subject'), text });
  return true;
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
/** Učenik: „Proveri sa nastavnikom“ — pesma ide nastavniku (link), uz napomenu. */
export async function askCheck(song, note = '') {
  const m = await getMyTeacher(); if (!m || !song) return false;
  const S = await import('./shareService.js');
  const res = await S.publishOnly(S.songItem(song));
  if (!res) return false;
  const id = uid();
  const link = res.link + (await toTeacherSuffix()) + '&' + qs({ pc: id, ps: song.id, pn: clip(note, 200) });
  const text = await editMessage(t('chk.ask'), t('chk.msg', { name: song.title, note: note ? `\n${clip(note, 300)}\n` : '', link }), t('tch.lockMsg'));
  if (text == null) return false;
  await settings.set('myRequests', [...(await getMyRequests()), { id, type: 'check', title: clip(song.title, 80), artist: clip(song.artist || '', 60), songId: song.id, note: clip(note, 300), at: Date.now(), status: 'sent' }]);
  await compose({ to: m.contact || '', subject: t('chk.subject'), text });
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
/** Nastavnik: „U redu je“ — kratka poruka učeniku. */
export async function answerOk(req) {
  const st = await getStudent(req.sid); if (!st) return false;
  const tc = await setTeacher({});
  const { SHARE_BASE } = await import('./shareConfig.js');
  const link = `${SHARE_BASE}#odgovor/${b64e({ v: 1, tt: tc.id, id: req.id, s: 'ok' })}`;
  const text = await editMessage(t('chk.ok'), t('chk.msgOk', { s: st.name, title: req.title, link }), t('tch.lockMsg'));
  if (text == null) return false;
  await compose({ to: st.contact, subject: t('tch.subject', { t: (await teacherName()) || 'MARLI' }), text });
  await setRequest(req.id, { status: 'ok', doneAt: Date.now() });
  return true;
}

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
