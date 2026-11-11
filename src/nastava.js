// v2.0: „Nastava“ — kartica Vežbe postaje Nastava kad si povezan sa nastavnikom (učenik) ili kad predaješ (nastavnik).
// Učenik: nastavnik, novo od njega, Pitaj / Pošalji snimak (zadaci i vežbe od nastavnika su već ispod, u Vežbama).
// Nastavnik: Učenici (zahtevi, plan, napredak), pa sopstvene vežbe. Niko drugi: „Imaš nastavnika?“ — poveži se u aplikaciji
// (QR kamerom gde telefon to ume, ili nalepi link) — radi i u aplikaciji sa početnog ekrana na iPhone-u.
import { t } from './i18n.js';
import { esc, dialog, toast } from './ui.js';
import { settings } from './db.js';

const CAP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 1 9l11 6 9-4.9V17h2V9L12 3zM5 13.2V17c0 1.7 3.1 3 7 3s7-1.3 7-3v-3.8l-7 3.8-7-3.8z"/></svg>';
let navOrig = null;

/** 'student' | 'teacher' | '' — bez učitavanja nastave (brže pokretanje). */
export async function role() {
  try {
    const tc = await settings.get('teacher', null); if (tc && tc.on) return 'teacher';
    const m = await settings.get('myTeacher', null); if (m && m.tid) return 'student';
  } catch {}
  return '';
}
/** Donja / bočna traka: „Vežbe“ ↔ „Nastava“. */
export async function applyNav() {
  const r = await role();
  document.body.classList.toggle('nastava-on', !!r);
  document.body.classList.toggle('nastava-teacher', r === 'teacher');
  const a = document.querySelector('.nav a[data-tab="vezbe"]'); if (!a) return r;
  if (!navOrig) navOrig = { svg: a.querySelector('svg')?.outerHTML || '', key: 'nav.practice' };
  const span = a.querySelector('span');
  if (r) { if (!a.classList.contains('nav-nastava')) { a.querySelector('svg').outerHTML = CAP; a.classList.add('nav-nastava'); } span.textContent = t('nav.teaching'); span.dataset.i18n = 'nav.teaching'; }
  else if (a.classList.contains('nav-nastava')) { a.querySelector('svg').outerHTML = navOrig.svg; a.classList.remove('nav-nastava'); span.textContent = t('nav.practice'); span.dataset.i18n = 'nav.practice'; }
  if (r && /^#\/(ucenici|ucenik|od-nastavnika)(\/|\?|$)/.test(location.hash)) document.querySelectorAll('.nav a').forEach((x) => { const on = x === a; x.classList.toggle('active', on); if (on) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); }); // istaknuta Nastava
  try { dispatchEvent(new Event('marli-teach')); } catch {} // broj zahteva na kartici Nastava
  return r;
}

const go = (hash, click) => { location.hash = hash; if (click) setTimeout(() => document.querySelector(click)?.click(), 450); };

/** Vrh Vežbi (posle nedelje): kartica nastavnika / učenici / „Imaš nastavnika?“. Vraća ulogu. */
export async function drawHub(box, head) {
  const r = await role();
  if (!box || !box.isConnected) return r;
  if (r && head) { const h1 = head.querySelector('h1'); if (h1) h1.textContent = t('nav.teaching'); }
  if (r === 'student') await drawStudent(box);
  else if (r === 'teacher') await drawTeacher(box);
  else await drawConnect(box);
  return r;
}

async function drawStudent(box) {
  const T = await import('./teach.js'); const m = await T.getMyTeacher(); if (!m) return;
  const tn = m.name || t('tch.teacher');
  setIntro(box, t('nas.subStudent', { t: tn }));
  const { songs } = await import('./db.js');
  const fresh = [];
  for (const id of (m.boxNew || []).slice(-6).reverse()) { const s = await songs.get(id).catch(() => null); if (s && !s.deleted) fresh.push(s); }
  box.innerHTML = `<div class="nas-card"><div class="nas-top">${T.avatarHTML({ name: tn, color: '#f5a524' }, 42)}<span><b>${esc(tn)}</b><small>${esc(t('tch.yourTeacher'))}${m.boxAt ? ' · ' + esc(t('nas.last', { d: ago(m.boxAt) })) : ''}</small></span><a href="#/od-nastavnika" class="nas-all">${esc(t('nas.all'))} ›</a></div>
    ${fresh.length ? `<div class="nas-lbl">${esc(t('nas.newFrom', { t: tn, n: fresh.length }))}</div>${fresh.map((s) => `<a class="nas-row" href="#/pesma/${encodeURIComponent(s.id)}"><span class="nas-ic">♪</span><span><b>${esc(s.title)}</b><small>${esc(s.artist || '')}</small></span><em>${esc(t('nas.new'))}</em></a>`).join('')}`
      : `<p class="nas-none">${esc(t('nas.nothingNew', { t: tn }))}</p>`}
    <div class="nas-btns"><button type="button" class="btn" data-nas="ask">❓ ${esc(t('nas.ask'))}</button><button type="button" class="btn" data-nas="rec">🎙 ${esc(t('nas.sendRec'))}</button></div></div>`;
  box.onclick = (e) => { const b = e.target.closest('[data-nas]'); if (!b) return; go('#/od-nastavnika', b.dataset.nas === 'ask' ? '#tAsk' : '#tBack'); };
}

async function drawTeacher(box) {
  const T = await import('./teach.js'); const V = await import('./planView.js');
  setIntro(box, t('nas.subTeacher'));
  const list = await T.getStudents();
  const open = (await T.getRequests()).filter((q) => q.status === 'open' || q.status === 'editing');
  const rows = list.map((s) => {
    const n = open.filter((q) => q.sid === s.id).length;
    const pc = V.dashCell(s, null);
    const sub = [n ? t('nas.reqs', { n }) : '', pc && pc !== '—' ? t('tch.planShort', { p: pc }) : '', s.prog ? t('tch.sharesProg') : ''].filter(Boolean).join(' · ') || t('tch.showQrHint');
    return `<a class="nas-stu" href="#/ucenik/${encodeURIComponent(s.id)}">${T.avatarHTML(s, 38)}<span><b>${esc(s.name)}</b><small>${esc(sub)}</small></span>${n ? `<i class="nas-badge">${n}</i>` : '<i class="nas-chev">›</i>'}</a>`;
  }).join('');
  box.innerHTML = `<div class="nas-sec"><span>${esc(t('nas.students', { n: list.length }))}</span><a href="#/ucenici">${esc(t('nas.allStudents'))} ›</a></div>
    ${rows || `<p class="nas-none">${esc(t('tch.emptyBody'))}</p>`}
    <div class="nas-btns"><button type="button" class="btn" data-nas="add">＋ ${esc(t('tch.newStudent'))}</button><button type="button" class="btn" data-nas="bulk">↗ ${esc(t('bulk.btn'))}</button></div>
    <div class="nas-sec nas-mine"><span>${esc(t('nas.myPractice'))}</span></div>`;
  box.onclick = async (e) => {
    const b = e.target.closest('[data-nas]'); if (!b) return;
    const TV = await import('./teachView.js');
    if (b.dataset.nas === 'add') { const s = await TV.addStudentFlow(); if (s) location.hash = '#/ucenik/' + encodeURIComponent(s.id); }
    else TV.bulkSend?.();
  };
}

const LS_NO = 'marli-nas-no';
async function drawConnect(box) {
  try { if (localStorage.getItem(LS_NO) === '1') { box.innerHTML = ''; return; } } catch {}
  const canScan = 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
  box.innerHTML = `<div class="nas-conn"><span class="nas-ic nas-ic-lg">🎓</span><span><b>${esc(t('nas.haveTeacher'))}</b><small>${esc(t(canScan ? 'nas.connectSub' : 'nas.connectSubPaste'))}</small></span></div>
    <div class="nas-btns nas-conn-btns">${canScan ? `<button type="button" class="btn primary" data-nas="scan">📷 ${esc(t('nas.scan'))}</button>` : ''}<button type="button" class="btn${canScan ? '' : ' primary'}" data-nas="paste">🔗 ${esc(t('nas.paste'))}</button></div>
    <button type="button" class="linkish nas-no" data-nas="no">${esc(t('nas.noThanks'))}</button>`;
  box.onclick = (e) => { const b = e.target.closest('[data-nas]'); if (!b) return; if (b.dataset.nas === 'scan') scanInvite(); else if (b.dataset.nas === 'paste') pasteInvite();
    else { try { localStorage.setItem(LS_NO, '1'); } catch {} box.innerHTML = ''; toast(t('nas.noLater')); } };
}

const setIntro = (box, txt) => { const v = box.closest('.practice-view'); if (!v) return; const i = v.querySelector('.pr-intro'); if (i) i.textContent = txt; const d = v.querySelector('.dhd-sub'); if (d) d.textContent = txt; };
const ago = (ts) => { const d = Math.floor((Date.now() - ts) / 864e5); return d <= 0 ? t('st.today') : d === 1 ? t('st.yesterday') : t('st.daysAgo', { n: d }); };

/** Iz nalepljenog teksta izvuci „#poziv/…“ (ceo link ili samo deo). */
export function inviteFrom(text) { const m = /#poziv\/[^\s"'<>]+/.exec(String(text || '')); return m ? m[0] : ''; }
async function accept(h) { const TV = await import('./teachView.js'); await TV.acceptInvite(h); setTimeout(() => applyNav(), 800); }
export async function pasteInvite() {
  let clip = ''; try { clip = await navigator.clipboard.readText(); } catch {}
  const pre = inviteFrom(clip) ? clip : '';
  const p = dialog({ title: t('nas.pasteTitle'), html: true, className: 'tch-dlg', body: `<p class="muted small">${esc(t('nas.pasteHow'))}</p><input id="nasLink" autocomplete="off" spellcheck="false" placeholder="${esc(t('nas.pastePh'))}" value="${esc(pre)}">`,
    buttons: [{ label: t('common.cancel'), value: null }, { label: t('nas.connect'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop(); let v = pre;
  box.querySelector('#nasLink').addEventListener('input', (e) => (v = e.target.value));
  if ((await p) !== 'ok') return false;
  const h = inviteFrom(v);
  if (!h) { toast(t('nas.badLink'), 'error'); return false; }
  await accept(h); return true;
}
export async function scanInvite() {
  let stream = null;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); } catch { toast(t('nas.noCam'), 'error'); return pasteInvite(); }
  const det = new window.BarcodeDetector({ formats: ['qr_code'] });
  const wrap = document.createElement('div'); wrap.className = 'modal-backdrop nas-scan';
  wrap.innerHTML = `<div class="nas-scan-box"><video playsinline muted></video><i class="nas-frame" aria-hidden="true"></i><p>${esc(t('nas.scanHint'))}</p><button type="button" class="btn">${esc(t('common.cancel'))}</button></div>`;
  document.body.appendChild(wrap);
  const vid = wrap.querySelector('video'); vid.srcObject = stream; await vid.play().catch(() => {});
  let done = false;
  const stop = () => { done = true; stream.getTracks().forEach((x) => x.stop()); wrap.remove(); };
  wrap.querySelector('button').onclick = stop;
  const tick = async () => {
    if (done) return;
    try { const r = await det.detect(vid); const h = r.map((x) => inviteFrom(x.rawValue)).find(Boolean); if (h) { stop(); await accept(h); return; } } catch {}
    setTimeout(tick, 250);
  };
  tick();
}
