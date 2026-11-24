// v2.4.3: komentar nastavnika na učenikov snimak — tekst i/ili glasovna poruka (do 60 s).
// Nastavnik: na snimku koji je učenik poslao → „Komentar za …“. Glas ide kao mali fajl na nastavnikov Drive (link ima samo učenik).
// Učenik: komentar se vidi na tom snimku (tekst + ▶), sa brzim odgovorom; nastavnik vidi „viđeno“.
import { t } from './i18n.js';
import { esc, toast, dialog } from './ui.js';
import { songs as db } from './db.js';

const MAX_SEC = 60;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clip = (s, k) => String(s || '').trim().slice(0, k);
const dShort = (ts) => { const d = new Date(ts); return `${d.getDate()}. ${d.getMonth() + 1}.`; };

// ---------------- glas: snimanje i čuvanje ----------------
const b64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
function pickMime() { for (const m of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']) if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m; return ''; }
/** Pusti glasovnu poruku iz Drive fajla. */
async function playVoice(fileId, btn) {
  btn.disabled = true;
  try {
    const S = await import('./shareService.js'); const d = await S.readData(fileId);
    if (!d || d.type !== 'voice' || !d.data) { toast(t('cmt.voiceGone')); return; }
    const url = URL.createObjectURL(new Blob([unb64(d.data)], { type: d.mime || 'audio/webm' }));
    const a = new Audio(url); a.onended = () => { URL.revokeObjectURL(url); btn.classList.remove('playing'); };
    btn.classList.add('playing'); await a.play();
  } catch { toast(t('cmt.voiceFail'), 'error'); } finally { btn.disabled = false; }
}

// ---------------- nastavnik ----------------
async function commentFlow(song, st) {
  let rec = null, chunks = [], blob = null, mime = '', stream = null, startedAt = 0, tick = 0;
  const canRec = !!pickMime() && !!navigator.mediaDevices?.getUserMedia;
  const p = dialog({ title: t('cmt.title', { name: st.name }), html: true, className: 'tch-dlg cmt-dlg', body: `
    <p class="muted small">${esc(t('cmt.on', { title: song.title || '' }))}</p>
    <label class="tch-lab">${t('cmt.text')}</label><textarea id="cmText" rows="3" maxlength="600" placeholder="${esc(t('cmt.textPh'))}"></textarea>
    ${canRec ? `<div class="cmt-voice"><button type="button" class="btn" id="cmRec">🎙 ${esc(t('cmt.rec'))}</button><span id="cmState" class="muted small"></span><button type="button" class="btn small" id="cmPlay" hidden>▶</button><button type="button" class="btn small" id="cmDel" hidden>✕</button></div>` : ''}
    <p class="tch-lock">🔒 ${esc(t('les.noteLock', { name: st.name }))}</p>`,
  buttons: [{ label: t('common.cancel'), value: null }, { label: t('les.send'), value: 'ok', kind: 'primary' }] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  let text = ''; box.querySelector('#cmText').addEventListener('input', (e) => (text = e.target.value));
  const $ = (id) => box.querySelector('#' + id);
  const stop = () => { if (rec && rec.state !== 'inactive') rec.stop(); clearInterval(tick); };
  if (canRec) {
    $('cmRec').addEventListener('click', async () => {
      if (rec && rec.state === 'recording') { stop(); return; }
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { toast(t('mic.denied'), 'error'); return; }
      mime = pickMime(); chunks = []; blob = null;
      rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 24000 });
      rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
      rec.onstop = () => { stream.getTracks().forEach((x) => x.stop()); blob = new Blob(chunks, { type: mime }); $('cmRec').textContent = '🎙 ' + t('cmt.again'); $('cmState').textContent = t('cmt.recorded', { s: Math.round((Date.now() - startedAt) / 1000) }); $('cmPlay').hidden = $('cmDel').hidden = false; };
      rec.start(); startedAt = Date.now(); $('cmRec').textContent = '■ ' + t('cmt.stop'); $('cmPlay').hidden = $('cmDel').hidden = true;
      tick = setInterval(() => { const s = Math.round((Date.now() - startedAt) / 1000); $('cmState').textContent = t('cmt.recording', { s, max: MAX_SEC }); if (s >= MAX_SEC) stop(); }, 250);
    });
    $('cmPlay').addEventListener('click', () => { if (blob) new Audio(URL.createObjectURL(blob)).play().catch(() => {}); });
    $('cmDel').addEventListener('click', () => { blob = null; $('cmState').textContent = ''; $('cmPlay').hidden = $('cmDel').hidden = true; $('cmRec').textContent = '🎙 ' + t('cmt.rec'); });
  }
  const r = await p; stop();
  if (r !== 'ok' || (!clip(text, 600) && !blob)) return false;
  const S = await import('./shareService.js');
  let voice = '';
  if (blob) {
    voice = await S.putData('', JSON.stringify({ app: 'marli', type: 'voice', v: 1, mime: blob.type, data: b64(await blob.arrayBuffer()) }), { interactive: true, name: 'MARLI – glasovni komentar.json' }).catch(() => '');
    if (!voice) { toast(t('box.failed'), 'error'); return false; }
  }
  const id = uid(), f = String(song.src || '').split(':')[0];
  const item = { key: 'cmt:' + id, kind: 'cmt', id, f, text: clip(text, 600), ...(voice ? { voice } : {}), name: t('cmt.name', { title: clip(song.title, 60) }) };
  const B = await import('./teachBox.js');
  if (!(await B.boxPut(st.id, [item]))) { toast(t('box.failed'), 'error'); return false; }
  const cur = await db.get(song.id); await db.put({ ...cur, cmts: [{ id, at: Date.now(), text: item.text, voice, key: item.key }, ...(cur.cmts || [])].slice(0, 20) });
  toast(t('cmt.sent', { name: st.name }));
  return true;
}

// ---------------- prikaz na snimku ----------------
export async function attach(box, song) {
  if (!box || !song) return;
  const tm = await import('./teach.js');
  // nastavnik: snimak koji je učenik poslao
  if (song.fromStudent && song.student && song.src) {
    const st = await tm.getStudent(song.student); if (!st) return;
    const cur = await db.get(song.id) || song;
    const statusOf = (k) => { const r = (st.reacts || {})[k]; return r ? `<em class="les-st les-r">${{ like: '👍', ok: '✔', q: '❓' }[r.r] || ''} ${esc(t('les.r.' + r.r))}</em>` : (st.seen || {})[k] ? `<em class="les-st les-seen">✓ ${esc(t('les.seen'))}</em>` : `<em class="les-st les-wait">${esc(t('les.notSeen'))}</em>`; };
    box.innerHTML = `<div class="card cmt-card"><button type="button" class="btn primary wide" id="cmNew">💬 ${esc(t('cmt.btn', { name: st.name }))}</button>
      ${(cur.cmts || []).slice(0, 3).map((c) => `<div class="cmt-row"><span class="les-d">${esc(dShort(c.at))}</span><span>${c.text ? esc(c.text) : ''}${c.voice ? ` <button type="button" class="btn small cmt-play" data-voice="${esc(c.voice)}">▶ ${esc(t('cmt.voice'))}</button>` : ''}</span>${statusOf(c.key)}</div>`).join('')}</div>`;
    box.onclick = async (e) => {
      const v = e.target.closest('[data-voice]'); if (v) return playVoice(v.dataset.voice, v);
      if (e.target.closest('#cmNew') && await commentFlow(cur, st)) attach(box, await db.get(song.id));
    };
    return;
  }
  // učenik: komentari nastavnika na moj snimak
  const m = await tm.getMyTeacher(); const list = m && m.cmts && m.cmts[song.id];
  if (!list || !list.length) { box.innerHTML = ''; return; }
  const L = await import('./lessons.js');
  box.innerHTML = `<div class="card les-card cmt-card"><div class="les-row"><span class="les-ic">💬</span><span><small>${esc(t('cmt.fromT', { t: m.name || t('tch.teacher') }))}</small>
    ${list.slice(0, 3).map((c) => `<div class="cmt-msg">${c.text ? `<p>${esc(c.text)}</p>` : ''}${c.voice ? `<button type="button" class="btn small cmt-play" data-voice="${esc(c.voice)}">▶ ${esc(t('cmt.voice'))}</button>` : ''}</div>`).join('')}</span></div>
    ${L.reactsHTML(list[0].key, song.title || '', (m.myReacts || {})[list[0].key])}</div>`;
  L.bindReacts(box);
  box.addEventListener('click', (e) => { const v = e.target.closest('[data-voice]'); if (v) playVoice(v.dataset.voice, v); });
  L.markSeen(list.map((c) => c.key));
}

/** Učenik: stigao komentar (iz sanduča) — nađi moj snimak po fajlu kojim je poslat. */
export async function receive(it, m) {
  const tm = await import('./teach.js'); const cur = (await tm.getMyTeacher()) || m;
  let songId = ((cur.out || []).find((o) => o && o.type === 'file' && o.f === it.f) || {}).song || (cur.recF || {})[it.f] || '';
  if (!songId) { try { const S = await import('./shareService.js'); const sh = (await S.getShares()).find((x) => x && x.fileId === it.f && String(x.key || '').startsWith('song:')); if (sh) songId = sh.key.slice(5); } catch {} }
  if (!songId) return null;
  const c = { id: clip(it.id, 40), at: Number(it.at) || Date.now(), text: clip(it.text, 600), voice: clip(it.voice, 120), key: it.key };
  const cm = { ...(cur.cmts || {}) }; cm[songId] = [c, ...(cm[songId] || []).filter((x) => x.id !== c.id)].slice(0, 10);
  await tm.setMyTeacher({ ...cur, cmts: Object.fromEntries(Object.entries(cm).slice(-60)) });
  const s = await db.get(songId).catch(() => null);
  return { t: t('cmt.nt', { t: m.name || t('tch.teacher') }), s: (c.text || (c.voice ? '🎙 ' + t('cmt.voice') : '')) + (s ? ' — ' + (s.title || '') : ''), href: '#/pesma/' + encodeURIComponent(songId) };
}
