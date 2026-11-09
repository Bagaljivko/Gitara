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

// ---------------- nastavnik ----------------
export async function getTeacher() { return (await settings.get('teacher', null)) || { on: false }; }
export async function setTeacher(patch) {
  const cur = await getTeacher();
  const next = { ...cur, ...patch };
  if (!next.id) next.id = uid();
  await settings.set('teacher', next);
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
  await settings.set('students', (await getStudents()).filter((s) => s.id !== id));
  const { songs } = await import('./db.js');
  for (const s of await songs.all()) if (s.student === id) { const { student, ...rest } = s; await songs.save(rest); }
  const c = await import('./collections.js');
  for (const sl of await c.getSetlists()) if ((sl.students || []).includes(id)) await c.updateSetlist(sl.id, { students: sl.students.filter((x) => x !== id) });
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
export async function toStudentSuffix(student) {
  const tc = await setTeacher({});
  return '?' + qs({ tt: tc.id, ts: student.id, tn: await teacherName(), tc: tc.contact || '' });
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
    show(t(pkg.kind === 'set' ? 'tch.got.set' : 'tch.got.song', { t: name, name: pkg.name || pkg.songs[0]?.title || '' }), fresh ? t('tch.got.connect', { t: name }) : t('tch.got.update'), [
      btn(t('common.cancel'), '', () => clearHash()),
      btn(t('tch.got.save'), 'primary', async () => {
        if (fresh) await setMyTeacher({ ...info, at: Date.now() });
        else if (my.name !== info.name || my.contact !== info.contact) await setMyTeacher({ ...my, name: info.name || my.name, contact: info.contact || my.contact });
        const fromT = { tid: info.tid, name: info.name };
        const r = await importTagged(pkg, fileId, { fromT }, { fromT });
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
