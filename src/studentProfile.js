// v2.4.23: profil učenika (samo kod nastavnika; beleška je „memo“ — „notes“ su beleške sa časa): slika (aplikacija je sama smanji — kvadrat 256 px, JPEG ~20–50 KB),
// zajedno od, rođendan (godina po želji), beleške, omiljene pesme (najviše svirane — same, + one koje nastavnik doda),
// „želi da nauči“ (iz zahteva). Podsetnici u zvoncu: rođendan i godišnjica saradnje (kad se aplikacija otvori tog dana).
// Ništa od ovoga se ne šalje učeniku — ostaje na uređaju nastavnika i u njegovoj sinhronizaciji (Google Drive).
import { t, countOf, DAYS } from './i18n.js';
import { esc, dialog, toast } from './ui.js';

const PHOTO = 256, MAX_BYTES = 60000;
const fmtDate = (ms) => { const d = new Date(ms); return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}.`; };
export const sinceOf = (s) => Number(s.since) || Number(s.connAt) || Number(s.createdAt) || Date.now();

/** Koliko dugo zajedno: „1 god. 2 mes.“ / „5 mes.“ / „12 dana“. */
export function togetherText(since, now = Date.now()) {
  const a = new Date(since), b = new Date(now);
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()); if (b.getDate() < a.getDate()) m--;
  if (m < 1) return countOf(Math.max(0, Math.floor((now - since) / 864e5)), DAYS);
  const y = Math.floor(m / 12), r = m % 12;
  return [y ? t('spf.years', { n: y }) : '', r ? t('spf.months', { n: r }) : ''].filter(Boolean).join(' ');
}
/** Dana do sledećeg rođendana (0 = danas) i koliko puni (ako je godina poznata). */
export function birthdayInfo(bd, now = new Date()) {
  if (!bd || !bd.d || !bd.m) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), bd.m - 1, bd.d); if (next < today) next = new Date(now.getFullYear() + 1, bd.m - 1, bd.d);
  const days = Math.round((next - today) / 864e5);
  return { days, age: bd.y ? next.getFullYear() - bd.y : 0 };
}

/** Slika → kvadrat PHOTO×PHOTO (izrez: pomeranje x/y u -1..1, uvećanje ≥1), JPEG do ~60 KB. */
export async function makePhoto(img, { x = 0, y = 0, zoom = 1 } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = PHOTO;
  const g = c.getContext('2d');
  const side = Math.min(img.width, img.height) / Math.max(1, zoom);
  const sx = (img.width - side) / 2 + (x * (img.width - side)) / 2, sy = (img.height - side) / 2 + (y * (img.height - side)) / 2;
  g.fillStyle = '#000'; g.fillRect(0, 0, PHOTO, PHOTO);
  g.drawImage(img, Math.max(0, sx), Math.max(0, sy), side, side, 0, 0, PHOTO, PHOTO);
  for (const q of [0.82, 0.7, 0.58, 0.45]) { const u = c.toDataURL('image/jpeg', q); if (u.length * 0.75 <= MAX_BYTES || q === 0.45) return u; }
  return '';
}
const loadImg = (file) => new Promise((res, rej) => { const u = URL.createObjectURL(file); const i = new Image(); i.onload = () => { res(i); setTimeout(() => URL.revokeObjectURL(u), 1000); }; i.onerror = rej; i.src = u; });

/** Izrez slike: prevuci da pomeriš, klizač za uvećanje. Vraća dataURL ili null. */
async function cropFlow(file) {
  let img; try { img = await loadImg(file); } catch { toast(t('spf.photoBad'), 'error'); return null; }
  const st = { x: 0, y: 0, zoom: 1 };
  const p = dialog({ title: t('spf.cropTitle'), html: true, className: 'sp-crop-dlg', body: `<div class="sp-crop"><canvas width="${PHOTO}" height="${PHOTO}"></canvas></div>
    <label class="tch-lab">${t('spf.zoom')}</label><input type="range" id="spZoom" min="1" max="3" step="0.05" value="1"><small class="muted">${t('spf.cropHint')}</small>`,
    buttons: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  const cv = box.querySelector('canvas');
  const draw = async () => { const u = await makePhoto(img, st); const i = new Image(); i.onload = () => cv.getContext('2d').drawImage(i, 0, 0); i.src = u; };
  box.querySelector('#spZoom').addEventListener('input', (e) => { st.zoom = Number(e.target.value) || 1; draw(); });
  let drag = null;
  cv.addEventListener('pointerdown', (e) => { drag = { px: e.clientX, py: e.clientY, x: st.x, y: st.y }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (!drag) return; const w = cv.getBoundingClientRect().width || PHOTO; st.x = Math.max(-1, Math.min(1, drag.x - ((e.clientX - drag.px) / w) * 2)); st.y = Math.max(-1, Math.min(1, drag.y - ((e.clientY - drag.py) / w) * 2)); draw(); });
  cv.addEventListener('pointerup', () => { drag = null; });
  draw();
  if ((await p) !== 'ok') return null;
  return makePhoto(img, st);
}

/** Uređivanje profila (slika, ime, zajedno od, rođendan, kontakt, beleške). Vraća ažuriranog učenika ili null. */
export async function editProfile(s) {
  const T = await import('./teach.js');
  const v = { name: s.name || '', contact: s.contact || '', notes: s.memo || '', photo: s.photo || '', since: sinceOf(s), bd: s.bd || null };
  const iso = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const months = t('spf.monthNames').split(',');
  const ph = () => (v.photo ? `<img class="tch-av sp-ph" src="${esc(v.photo)}" alt="" style="--s:72px">` : T.avatarHTML({ ...s, photo: '' }, 72));
  const p = dialog({ title: t('spf.title'), html: true, className: 'tch-dlg sp-dlg', body: `
    <div class="sp-phrow"><span id="spPh">${ph()}</span><span class="sp-phbtns">
      <label class="btn small">📷 ${t('spf.camera')}<input type="file" accept="image/*" capture="user" id="spCam" hidden></label>
      <label class="btn small">🖼 ${t('spf.gallery')}<input type="file" accept="image/*" id="spGal" hidden></label>
      <button type="button" class="linkish" id="spDel"${v.photo ? '' : ' hidden'}>${t('spf.photoDel')}</button></span></div>
    <label class="tch-lab">${t('tch.name')}</label><input id="spName" maxlength="60" value="${esc(v.name)}" autocomplete="off">
    <label class="tch-lab">${t('spf.since')}</label><input type="date" id="spSince" value="${iso(v.since)}" max="${iso(Date.now())}">
      <label class="tch-lab">${t('spf.bday')} <span class="muted">${t('spf.yearOpt')}</span></label><div class="sp-bd"><select id="spBdD"><option value="">—</option>${Array.from({ length: 31 }, (_, i) => `<option${v.bd && v.bd.d === i + 1 ? ' selected' : ''}>${i + 1}</option>`).join('')}</select><select id="spBdM"><option value="">—</option>${months.map((m, i) => `<option value="${i + 1}"${v.bd && v.bd.m === i + 1 ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select><input id="spBdY" inputmode="numeric" maxlength="4" placeholder="${esc(t('spf.year'))}" value="${v.bd && v.bd.y ? v.bd.y : ''}"></div>
    <label class="tch-lab">${t('tch.contact')} <span class="muted">${t('tch.optional')}</span></label><input id="spContact" maxlength="120" value="${esc(v.contact)}" autocomplete="off">
    <label class="tch-lab">${t('spf.notes')}</label><textarea id="spNotes" maxlength="600" rows="3">${esc(v.notes)}</textarea>
    <p class="tch-lock">🔒 ${t('spf.lock', { name: s.name || '' })}</p>`,
    buttons: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  const pick = async (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return; const u = await cropFlow(f); if (u) { v.photo = u; box.querySelector('#spPh').innerHTML = ph(); box.querySelector('#spDel').hidden = false; } };
  box.querySelector('#spCam').addEventListener('change', pick);
  box.querySelector('#spGal').addEventListener('change', pick);
  box.querySelector('#spDel').addEventListener('click', () => { v.photo = ''; box.querySelector('#spPh').innerHTML = ph(); box.querySelector('#spDel').hidden = true; });
  if ((await p) !== 'ok') return null;
  const q = (id) => box.querySelector('#' + id)?.value ?? '';
  const name = q('spName').trim(); if (!name) { toast(t('tch.needName')); return null; }
  const sd = q('spSince') ? new Date(q('spSince') + 'T12:00:00').getTime() : v.since;
  const d = Number(q('spBdD')), m = Number(q('spBdM')), y = Number(q('spBdY'));
  const bd = d && m ? { d, m, ...(y > 1900 && y <= new Date().getFullYear() ? { y } : {}) } : null;
  return T.updateStudent(s.id, { name, contact: q('spContact'), memo: q('spNotes').slice(0, 600), photo: v.photo, since: Number.isFinite(sd) ? sd : v.since, bd });
}

/** Zaglavlje stranice učenika: slika, ime, „Zajedno …“, čipovi (rođendan, ova nedelja, niz). */
export async function heroHTML(s, pr = null) {
  const T = await import('./teach.js');
  const b = birthdayInfo(s.bd); const chips = [];
  if (b) chips.push(`<span class="sp-chip${b.days <= 14 ? ' hot' : ''}">🎂 <b>${b.days === 0 ? esc(t('spf.bdToday')) : `${s.bd.d}. ${esc(t('spf.monthNames').split(',')[s.bd.m - 1] || '')}`}</b>${b.days ? ' · ' + esc(t('spf.inDays', { n: countOf(b.days, DAYS) })) : ''}</span>`);
  if (pr && !pr.err && !pr.gone) {
    const P = await import('./progress.js'); const w = P.thisWeek(pr); const { fmtDur } = await import('./statsView.js');
    if (w && w.total) chips.push(`<span class="sp-chip">⏱ ${esc(t('spf.week', { d: fmtDur(w.total) }))}</span>`);
    if (w && w.streak) chips.push(`<span class="sp-chip">🔥 ${esc(t('ov.streak', { n: w.streak }))}</span>`);
  }
  return `<div class="tch-hero sp-hero"><button type="button" class="sp-avbtn" id="spEdit" aria-label="${esc(t('spf.title'))}">${T.avatarHTML(s, 76)}<span class="sp-cam" aria-hidden="true">📷</span></button>
    <div><h1>${esc(s.name)}</h1><small class="muted">${esc(t('spf.together', { d: togetherText(sinceOf(s)), from: fmtDate(sinceOf(s)) }))}${s.contact ? ' · ' + esc(s.contact) : ''}</small></div></div>
    ${chips.length ? `<div class="sp-chips">${chips.join('')}</div>` : ''}`;
}

/** Sekcija „Profil“: napredak, želi da nauči, omiljene (najviše svira + ručno), beleške. */
export async function profileHTML(s, pr = null) {
  const T = await import('./teach.js');
  const wishes = (await T.getRequests()).filter((r) => r.sid === s.id && r.type === 'wish').slice(0, 6);
  const auto = pr && pr.ov && Array.isArray(pr.ov.s) ? pr.ov.s.slice(0, 3) : [];
  const man = Array.isArray(s.favs) ? s.favs.slice(0, 12) : [];
  const { fmtDur } = await import('./statsView.js');
  const row = (ic, b, sub, extra, attrs) => `<${attrs.href ? `a href="${attrs.href}"` : `button type="button" data-sp="${attrs.sp}"`} class="tch-row sp-row"><span class="sr-ic" aria-hidden="true">${ic}</span><span><b>${esc(b)}</b><small>${esc(sub)}</small>${extra || ''}</span><span class="chev" aria-hidden="true">›</span></${attrs.href ? 'a' : 'button'}>`;
  const tags = (arr) => (arr.length ? `<span class="sp-tags">${arr.join('')}</span>` : '');
  return `<div class="tch-sec"><span>${esc(t('spf.head'))}</span></div><div class="set-grp sp-grp">
    ${row('📈', t('spf.progress'), s.prog ? t('spf.progressSub') : t('spf.progressOff', { name: s.name }), '', s.prog ? { href: '#/vezbanje/' + encodeURIComponent(s.id) } : { sp: 'prog' })}
    ${row('⭐', t('spf.wishes'), wishes.length ? t('spf.wishesSub') : t('spf.wishesNone'), tags(wishes.map((w) => `<span>${esc(w.title)}</span>`)), { sp: 'wish' })}
    ${row('❤️', t('spf.favs'), t('spf.favsSub'), tags([...auto.map((x) => `<span class="auto">🔥 ${esc(x.t)}${x.ms ? ' · ' + esc(fmtDur(x.ms)) : ''}</span>`), ...man.map((x) => `<span>❤ ${esc(x)}</span>`)]), { sp: 'favs' })}
    ${row('🗒', t('spf.notes'), s.memo ? String(s.memo).slice(0, 140) : t('spf.notesNone'), '', { sp: 'edit' })}
  </div>`;
}

/** Klikovi u zaglavlju i profilu. redraw() posle izmene. */
export function bindProfile(root, s, redraw) {
  root.querySelector('#spEdit')?.addEventListener('click', async () => { if (await editProfile(s)) redraw(); });
  root.querySelectorAll('[data-sp]').forEach((b) => b.addEventListener('click', async () => {
    const k = b.dataset.sp;
    if (k === 'edit') { if (await editProfile(s)) redraw(); }
    else if (k === 'favs') { if (await editFavs(s)) redraw(); }
    else if (k === 'wish') (root.querySelector('.tch-reqs') || root.querySelector('#tMore'))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else if (k === 'prog') toast(t('spf.progressOff', { name: s.name }));
  }));
}

/** Omiljene pesme (ručno): dodaj iz pesmarice ili ukloni. */
async function editFavs(s) {
  const T = await import('./teach.js'); const { songs } = await import('./db.js');
  const cur = Array.isArray(s.favs) ? [...s.favs] : [];
  const v = await dialog({ title: t('spf.favs'), body: t('spf.favsBody', { name: s.name }), className: 'dlg-stack',
    buttons: [{ label: '+ ' + t('spf.favAdd'), value: '+', kind: 'primary' }, ...cur.map((x, i) => ({ label: '✕ ' + x, value: 'r' + i })), { label: t('common.close'), value: null, kind: 'ghost' }] });
  if (!v) return false;
  if (v === '+') {
    const all = (await songs.list()).filter((x) => !x.demo).sort((a, b) => String(a.title).localeCompare(String(b.title), 'sr'));
    const id = await dialog({ title: t('spf.favAdd'), className: 'dlg-stack', buttons: [...all.slice(0, 80).map((x) => ({ label: x.title + (x.artist ? ' — ' + x.artist : ''), value: x.id })), { label: t('common.cancel'), value: null, kind: 'ghost' }] });
    const x = all.find((y) => y.id === id); if (!x) return false;
    if (!cur.includes(x.title)) cur.push(String(x.title).slice(0, 80));
  } else cur.splice(Number(v.slice(1)), 1);
  await T.updateStudent(s.id, { favs: cur.slice(0, 12) }); Object.assign(s, { favs: cur });
  return true;
}

/** Nastavnik: rođendani i godišnjice danas → 🔔 (jednom godišnje po učeniku). */
export async function dateReminders() {
  const T = await import('./teach.js'); const tc = await T.getTeacher(); if (!tc.on) return;
  const N = await import('./notify.js'); const now = new Date(); const yr = now.getFullYear();
  for (const s of await T.getStudents()) {
    const who = (String(s.name || '?')[0] || '?').toUpperCase(), href = '#/ucenik/' + encodeURIComponent(s.id);
    const b = birthdayInfo(s.bd, now);
    if (b && b.days === 0) await N.add({ id: `bd:${s.id}:${yr}`, who: '🎂', c: '#db2777', t: t('spf.ntBd', { name: s.name }), s: b.age ? t('spf.ntBdAge', { n: b.age }) : t('spf.ntBdSub'), href });
    const since = new Date(sinceOf(s)), years = yr - since.getFullYear();
    if (years >= 1 && since.getMonth() === now.getMonth() && since.getDate() === now.getDate()) await N.add({ id: `an:${s.id}:${yr}`, who: '🤝', c: '#f5a524', t: t(years === 1 ? 'spf.ntAn1' : 'spf.ntAn', { name: s.name, n: years }), s: t('spf.ntAnSub', { d: fmtDate(since) }), href });
    void who;
  }
}
