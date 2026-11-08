// v1.70: Pesme na računaru — upravljač biblioteke (širok ekran + miš). Levo: biblioteka, provera, folderi, set liste
// (broj pesama, prevlačenje pesama na folder / set listu, F2 = preimenuj, desni klik = meni). U sredini: tabela pesama
// (klik na naslov kolone = redosled, Shift/Ctrl+klik = više pesama, traka sa radnjama za izabrane). Desno: otvorena
// pesma ili „Brzo uređivanje“ (taster E). Telefon i tablet ostaju kao ranije (src/songs.js → renderLibrary).
import { t } from './i18n.js';
import { songs as db, settings, events } from './db.js';
import { esc, toast, dialog, confirmDialog } from './ui.js';
import { getFolders, addFolder, renameFolder, deleteFolder, getSetlists, addSetlist, updateSetlist, isSystemFolder, folderLabel } from './collections.js';
import { dn } from './naming.js';
import { keyName } from './chordnames.js';

export const DESK = typeof matchMedia === 'function' ? matchMedia('(min-width: 1200px) and (min-height: 600px) and (hover: hover) and (pointer: fine)') : { matches: false, addEventListener() {} };

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'dj');
const DAY = 864e5;
const hasVideo = (s) => !!(s.yt && (s.yt.listen || s.yt.along));
const hasStrum = (s) => !!s.strum || (s.sections || []).some((x) => x.strum);
const keyOf = (s) => { const k = s.keyN ? keyName({ root: (s.keyN.root + (s.transpose || 0) + 120) % 12, minor: s.keyN.minor }, 'en') : s.key || ''; return k ? dn(k) : ''; }; // kao u listi pesama (sa transpozicijom)

const st = { all: [], folders: [], sets: [], group: 'all', q: '', sort: { col: 'title', dir: 1 }, sel: new Set(), anchor: null, open: null, edit: null, root: null };

function dupeIds(all) {
  const m = new Map();
  for (const s of all) { const k = fold(s.title).replace(/[^a-z0-9]+/g, ' ').trim(); if (!k) continue; (m.get(k) || m.set(k, []).get(k)).push(s.id); }
  return new Set([...m.values()].filter((v) => v.length > 1).flat());
}

function rows() {
  let L = st.all.filter((s) => !s.demo);
  const g = st.group;
  if (g === 'recent') L = L.filter((s) => Date.now() - (s.updatedAt || s.createdAt || 0) < 30 * DAY);
  else if (g === 'novideo') L = L.filter((s) => !hasVideo(s));
  else if (g === 'nostrum') L = L.filter((s) => !hasStrum(s) && s.type !== 'tab');
  else if (g === 'dupes') { const d = dupeIds(L); L = L.filter((s) => d.has(s.id)); }
  else if (g.startsWith('f:')) L = L.filter((s) => (s.folders || []).includes(g.slice(2)));
  if (st.q) { const q = fold(st.q); L = L.filter((s) => fold(s.title + ' ' + (s.artist || '')).includes(q) || fold((s.sections || []).map((x) => (x.lines || []).map((l) => l.text).join(' ')).join(' ')).includes(q)); }
  const { col, dir } = st.sort;
  const val = (s) => (col === 'artist' ? fold(s.artist) : col === 'key' ? keyOf(s) : col === 'date' ? -(s.updatedAt || s.createdAt || 0) : col === 'video' ? (hasVideo(s) ? 0 : 1) : col === 'folder' ? fold(folderNames(s)) : fold(s.title));
  return L.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir || fold(a.title).localeCompare(fold(b.title)); });
}
const folderNames = (s) => (s.folders || []).map((id) => folderLabel(st.folders.find((f) => f.id === id))).filter(Boolean).join(', ');
const groupTitle = () => {
  const g = st.group;
  if (g.startsWith('f:')) return folderLabel(st.folders.find((f) => f.id === g.slice(2))) || t('desk.all');
  return t({ all: 'desk.all', recent: 'desk.recent', novideo: 'desk.noVideo', nostrum: 'desk.noStrum', dupes: 'desk.dupes' }[g] || 'desk.all');
};
const fmtDate = (ts) => { if (!ts) return ''; const d = new Date(ts), n = new Date(); if (d.toDateString() === n.toDateString()) return t('desk.today'); if (n - d < 2 * DAY && n.getDate() - d.getDate() === 1) return t('desk.yesterday'); return `${d.getDate()}. ${d.getMonth() + 1}.`; };

// ---------------- Levo ----------------
const FOLDER_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z"/></svg>';
const SET_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h12v2H3zm0 6h12v2H3zm0 6h8v2H3zm14-6v8l6-4z"/></svg>';
function sideHTML() {
  const L = st.all.filter((s) => !s.demo), cnt = (f) => L.filter(f).length;
  const it = (g, label, n, ico = FOLDER_SVG, extra = '') => `<button type="button" class="ds-it${st.group === g ? ' on' : ''}" data-g="${esc(g)}"${extra}>${ico}<span class="ds-name">${esc(label)}</span><b>${n}</b></button>`;
  const d = dupeIds(L).size;
  return `<div class="ds-sec"><div class="ds-ttl">${t('desk.library')}</div>
      ${it('all', t('desk.all'), L.length)}${it('recent', t('desk.recent'), cnt((s) => Date.now() - (s.updatedAt || s.createdAt || 0) < 30 * DAY))}</div>
    <div class="ds-sec"><div class="ds-ttl">${t('desk.check')}</div>
      ${it('novideo', t('desk.noVideo'), cnt((s) => !hasVideo(s)))}${it('nostrum', t('desk.noStrum'), cnt((s) => !hasStrum(s) && s.type !== 'tab'))}${d ? it('dupes', t('desk.dupes'), d) : ''}</div>
    <div class="ds-sec"><div class="ds-ttl">${t('desk.folders')}<button type="button" class="ds-add" data-a="newFolder" title="${t('desk.newFolder')}" aria-label="${t('desk.newFolder')}">+</button></div>
      ${st.folders.map((f) => it('f:' + f.id, folderLabel(f), cnt((s) => (s.folders || []).includes(f.id)), FOLDER_SVG, ` data-drop="f:${esc(f.id)}"${isSystemFolder(f.id) ? ' data-sys="1"' : ''}`)).join('') || `<p class="ds-empty">${t('desk.noFolders')}</p>`}</div>
    <div class="ds-sec"><div class="ds-ttl">${t('desk.setlists')}<button type="button" class="ds-add" data-a="newSet" title="${t('desk.newSet')}" aria-label="${t('desk.newSet')}">+</button></div>
      ${st.sets.map((x) => `<button type="button" class="ds-it" data-set="${esc(x.id)}" data-drop="s:${esc(x.id)}">${SET_SVG}<span class="ds-name">${esc(x.name)}</span><b>${(x.songIds || []).length}</b></button>`).join('') || `<p class="ds-empty">${t('desk.noSets')}</p>`}</div>
    <div class="ds-conn" id="dsConn" hidden></div>`;
}

// ---------------- Sredina ----------------
function listHTML() {
  const R = rows(), compact = !!(st.open || st.edit);
  const th = (c, label) => `<th${c ? ` data-sort="${c}" class="${st.sort.col === c ? (st.sort.dir > 0 ? 'asc' : 'desc') : ''}"` : ''}>${label}</th>`;
  const head = `<tr><th class="dt-ck"><span class="ck${R.length && R.every((s) => st.sel.has(s.id)) ? ' on' : ''}" data-a="all" role="checkbox" aria-label="${t('desk.selectAll')}"></span></th>${th('title', t('desk.col.title'))}${compact ? '' : th('artist', t('desk.col.artist'))}${th('key', t('desk.col.key'))}${compact ? '' : th('folder', t('desk.col.folder'))}${th('video', t('desk.col.video'))}${compact ? '' : th('date', t('desk.col.date'))}</tr>`;
  const body = R.map((s) => `<tr class="dk-row${st.sel.has(s.id) ? ' sel' : ''}${st.open === s.id ? ' cur' : ''}" data-id="${esc(s.id)}" draggable="true">
      <td class="dt-ck"><span class="ck${st.sel.has(s.id) ? ' on' : ''}" data-a="ck"></span></td>
      <td class="dt-title"><b>${esc(s.title || '—')}</b>${compact && s.artist ? `<span class="muted">${esc(s.artist)}</span>` : ''}${s.type === 'tab' ? ' <span class="chip">TAB</span>' : ''}</td>
      ${compact ? '' : `<td class="muted">${esc(s.artist || '')}</td>`}
      <td class="k">${esc(keyOf(s))}</td>
      ${compact ? '' : `<td>${folderNames(s) ? `<span class="chip">${esc(folderNames(s))}</span>` : ''}</td>`}
      <td><span class="yt${hasVideo(s) ? '' : ' no'}" title="${hasVideo(s) ? t('desk.hasVideo') : t('desk.noVideoOne')}"></span></td>
      ${compact ? '' : `<td class="muted">${fmtDate(s.updatedAt || s.createdAt)}</td>`}</tr>`).join('');
  const n = st.sel.size;
  const bulk = n ? `<div class="dk-bulk" role="toolbar"><b>${t('desk.selected', { n })}</b>
      <button type="button" class="pill" data-a="moveFolder">${FOLDER_SVG}${t('desk.moveFolder')}</button>
      <button type="button" class="pill" data-a="addSet">${SET_SVG}${t('desk.addSet')}</button>
      <button type="button" class="pill" data-a="newSetSel">+ ${t('desk.newSetSel')}</button>
      <button type="button" class="pill" data-a="key">♯ ${t('desk.changeKey')}</button>
      <button type="button" class="pill danger" data-a="del">${t('common.delete')}</button>
      <button type="button" class="pill ghost" data-a="clear">Esc</button></div>` : '';
  const empty = !st.all.filter((s) => !s.demo).length;
  return `<div class="dk-top"><h1 class="dk-h">${esc(groupTitle())}</h1>
      <label class="dk-search"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3a7 7 0 0 1 5.6 11.2l4.6 4.6-1.4 1.4-4.6-4.6A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg><input type="search" id="lSearch" value="${esc(st.q)}" placeholder="${t('desk.search')}" aria-label="${t('desk.search')}"><kbd>/</kbd></label>
      <button type="button" class="btn primary small" id="lAdd">+ ${t('desk.addSongs')}</button></div>
    ${bulk}
    ${empty ? '<div id="lSyncWelcome"></div><div class="dk-empty-add"></div>' : R.length ? `<div class="dk-scroll"><table class="dk-table">${head}${body}</table></div>` : `<p class="muted dk-none">${t('desk.none')}</p>`}
    <div class="dk-keys"><span><kbd>Shift</kbd>/<kbd>Ctrl</kbd>+${t('desk.k.click')}</span><span><kbd>Ctrl</kbd>+<kbd>A</kbd> ${t('desk.k.all')}</span><span><kbd>Enter</kbd> ${t('desk.k.open')}</span><span><kbd>E</kbd> ${t('desk.k.edit')}</span><span><kbd>Del</kbd> ${t('desk.k.del')}</span><span><kbd>F2</kbd> ${t('desk.k.rename')}</span></div>`;
}

// ---------------- Crtanje ----------------
let side = null, list = null, songPane = null, hooks = {};
export async function renderDeskLibrary(sideEl, listEl, songEl, params, h = {}) {
  side = sideEl; list = listEl; songPane = songEl; hooks = h;
  st.root = sideEl.parentElement;
  if (params && params.get('g')) st.group = params.get('g');
  await reload();
  bind();
  connectCard();
  invite();
}
export async function deskReload() { if (side && document.body.contains(side)) await reload(); }
async function reload() {
  [st.all, st.folders, st.sets] = await Promise.all([db.all(), getFolders(), getSetlists()]);
  const ids = new Set(st.all.map((s) => s.id));
  for (const id of [...st.sel]) if (!ids.has(id)) st.sel.delete(id);
  draw();
}
function draw() {
  if (!side || !document.body.contains(side)) return;
  side.innerHTML = sideHTML();
  const q = document.activeElement && document.activeElement.id === 'lSearch' ? document.activeElement.selectionStart : null;
  list.innerHTML = listHTML();
  if (q != null) { const i = list.querySelector('#lSearch'); i.focus(); i.setSelectionRange(q, q); }
  st.root.classList.toggle('dk-has-song', !!(st.open || st.edit));
  if (list.querySelector('#lSyncWelcome')) hooks.emptyState?.(list.querySelector('#lSyncWelcome'), list.querySelector('.dk-empty-add'));
  connectCard();
}
/** Novi desni panel posle promene rute (brzo uređivanje piše u njega). */
export function setSongPane(el) { songPane = el; }
/** Ruta se promenila (otvorena pesma): oznaka u tabeli + uži prikaz. */
export function markOpen(id) {
  st.open = id || null;
  if (id) st.edit = null;
  draw();
}

// ---------------- Radnje ----------------
const ids = () => [...st.sel];
async function pickMenu(title, items) {
  return dialog({ title, buttons: items.map((x) => ({ label: x.label, value: x.value })), className: 'menu-dialog' });
}
async function moveToFolder(list0, fid) {
  for (const id of list0) {
    const s = await db.get(id); if (!s) continue;
    const f = new Set(s.folders || []); f.add(fid); s.folders = [...f];
    await db.put(s);
  }
}
async function addToSet(list0, sid) {
  const sl = st.sets.find((x) => x.id === sid); if (!sl) return 0;
  const have = new Set(sl.songIds || []), add = list0.filter((id) => !have.has(id));
  await updateSetlist(sid, { songIds: [...(sl.songIds || []), ...add] });
  return add.length;
}
async function act(a, btn) {
  if (a === 'clear') { st.sel.clear(); draw(); return; }
  if (a === 'all') { const R = rows(); if (R.every((s) => st.sel.has(s.id))) st.sel.clear(); else R.forEach((s) => st.sel.add(s.id)); draw(); return; }
  if (a === 'newFolder') {
    const name = await askName(t('desk.newFolder'), ''); if (!name) return;
    const f = await addFolder(name); if (!f) return;
    if (st.sel.size) { await moveToFolder(ids(), f.id); toast(t('desk.movedTo', { n: st.sel.size, name: f.name })); }
    await reload(); return;
  }
  if (a === 'newSet' || a === 'newSetSel') {
    const name = await askName(t('desk.newSet'), ''); if (!name) return;
    const sl = await addSetlist(name); const id = sl.id || sl;
    if (a === 'newSetSel' && st.sel.size) await updateSetlist(id, { songIds: rows().filter((s) => st.sel.has(s.id)).map((s) => s.id) });
    toast(t('desk.setCreated', { name }));
    await reload(); return;
  }
  if (!st.sel.size) return;
  if (a === 'moveFolder') {
    const v = await pickMenu(t('desk.moveFolder'), [...st.folders.filter((f) => !isSystemFolder(f.id)).map((f) => ({ label: folderLabel(f), value: f.id })), { label: '+ ' + t('desk.newFolder'), value: '+' }]);
    if (!v) return;
    if (v === '+') return act('newFolder');
    await moveToFolder(ids(), v);
    toast(t('desk.movedTo', { n: st.sel.size, name: folderLabel(st.folders.find((f) => f.id === v)) }));
    await reload(); return;
  }
  if (a === 'addSet') {
    const v = await pickMenu(t('desk.addSet'), [...st.sets.map((x) => ({ label: x.name, value: x.id })), { label: '+ ' + t('desk.newSetSel'), value: '+' }]);
    if (!v) return;
    if (v === '+') return act('newSetSel');
    const n = await addToSet(rows().filter((s) => st.sel.has(s.id)).map((s) => s.id), v);
    toast(t('desk.addedTo', { n, name: st.sets.find((x) => x.id === v).name }));
    await reload(); return;
  }
  if (a === 'key') {
    const v = await pickMenu(t('desk.changeKey'), [{ label: '+1 ' + t('desk.semitone'), value: '1' }, { label: '−1 ' + t('desk.semitone'), value: '-1' }, { label: '+2', value: '2' }, { label: '−2', value: '-2' }, { label: t('desk.keyReset'), value: '0' }]);
    if (v == null) return;
    for (const id of ids()) { const s = await db.get(id); if (!s) continue; const n = Number(v); s.transpose = n === 0 ? 0 : Math.max(-11, Math.min(11, (s.transpose || 0) + n)); await db.put(s); }
    toast(t('desk.keyChanged', { n: st.sel.size }));
    await reload(); return;
  }
  if (a === 'del') {
    const n = st.sel.size;
    if (!(await confirmDialog(t('desk.delTitle', { n }), t('desk.delBody'), t('common.delete'), 'danger'))) return;
    for (const id of ids()) await db.remove(id);
    st.sel.clear();
    toast(t('desk.deleted', { n }));
    if (st.open && !(await db.get(st.open))) location.hash = '#/pesme';
    await reload(); return;
  }
}
async function askName(title, value) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2 class="modal-title">${esc(title)}</h2><input type="text" class="dk-name-in" maxlength="60" value="${esc(value)}"><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-v="0">${t('common.cancel')}</button><button class="btn primary" data-v="1">${t('common.save')}</button></div></div>`;
    const inp = wrap.querySelector('input');
    const done = (ok) => { const v = inp.value.trim(); wrap.remove(); resolve(ok && v ? v : null); };
    wrap.__close = () => done(false);
    wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) done(b.dataset.v === '1'); else if (!e.target.closest('.modal')) done(false); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    document.body.appendChild(wrap);
    inp.focus(); inp.select();
  });
}
async function renameInPlace(btn) {
  const id = btn.dataset.g.slice(2);
  if (isSystemFolder(id)) return;
  const nameEl = btn.querySelector('.ds-name'), old = nameEl.textContent;
  const inp = document.createElement('input');
  inp.className = 'ds-rename'; inp.value = old; inp.maxLength = 60;
  nameEl.replaceWith(inp); inp.focus(); inp.select();
  let fin = false;
  const finish = async (ok) => { if (fin) return; fin = true; const v = inp.value.trim(); if (ok && v && v !== old) { await renameFolder(id, v); toast(t('desk.renamed')); } await reload(); };
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
  inp.addEventListener('click', (e) => e.stopPropagation());
}
async function folderMenu(btn, x, y) {
  document.querySelector('.ds-menu')?.remove();
  const g = btn.dataset.g; const id = g.slice(2);
  const fi = st.folders.findIndex((f) => f.id === id);
  const m = document.createElement('div');
  m.className = 'ds-menu'; m.setAttribute('role', 'menu');
  m.style.left = x + 'px'; m.style.top = y + 'px';
  m.innerHTML = `<button data-m="rename">✎ ${t('desk.rename')}<kbd>F2</kbd></button><button data-m="up"${fi <= 0 ? ' disabled' : ''}>↑ ${t('desk.up')}</button><button data-m="down"${fi >= st.folders.length - 1 ? ' disabled' : ''}>↓ ${t('desk.down')}</button><button data-m="del" class="danger">${t('desk.delFolder')}</button>`;
  document.body.appendChild(m);
  const off = (e) => { if (!m.contains(e.target)) { m.remove(); removeEventListener('pointerdown', off, true); } };
  setTimeout(() => addEventListener('pointerdown', off, true));
  m.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    m.remove(); removeEventListener('pointerdown', off, true);
    if (b.dataset.m === 'rename') return renameInPlace(side.querySelector(`[data-g="${CSS.escape(g)}"]`));
    if (b.dataset.m === 'up' || b.dataset.m === 'down') {
      const L = st.folders.slice(), j = fi + (b.dataset.m === 'up' ? -1 : 1); [L[fi], L[j]] = [L[j], L[fi]];
      await settings.set('folders', L); await reload(); return;
    }
    if (b.dataset.m === 'del') {
      if (!(await confirmDialog(t('desk.delFolderTitle', { name: folderLabel(st.folders[fi]) }), t('desk.delFolderBody'), t('common.delete'), 'danger'))) return;
      await deleteFolder(id); if (st.group === g) st.group = 'all'; await reload();
    }
  });
}

// ---------------- Događaji ----------------
let bound = null;
function bind() {
  if (bound === st.root) return; bound = st.root;
  side.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]'); if (a) { e.stopPropagation(); return act(a.dataset.a, a); }
    const g = e.target.closest('[data-g]'); if (g) { st.group = g.dataset.g; st.sel.clear(); draw(); return; }
    const s = e.target.closest('[data-set]'); if (s) { location.hash = '#/setlista/' + encodeURIComponent(s.dataset.set); return; }
    if (e.target.closest('[data-c="go"]')) return connect();
  });
  side.addEventListener('dblclick', (e) => { const g = e.target.closest('[data-g^="f:"]'); if (g && !g.dataset.sys) renameInPlace(g); });
  side.addEventListener('contextmenu', (e) => { const g = e.target.closest('[data-g^="f:"]'); if (!g || g.dataset.sys) return; e.preventDefault(); folderMenu(g, e.clientX, e.clientY); });
  // prevlačenje pesama na folder / set listu
  side.addEventListener('dragover', (e) => { const d = e.target.closest('[data-drop]'); if (!d || !drag) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; side.querySelectorAll('.drop').forEach((x) => x !== d && x.classList.remove('drop')); d.classList.add('drop'); });
  side.addEventListener('dragleave', (e) => { const d = e.target.closest('[data-drop]'); if (d && !d.contains(e.relatedTarget)) d.classList.remove('drop'); });
  side.addEventListener('drop', async (e) => {
    const d = e.target.closest('[data-drop]'); if (!d || !drag) return;
    e.preventDefault(); e.stopPropagation(); d.classList.remove('drop');
    const L = drag; drag = null;
    const [kind, id] = [d.dataset.drop.slice(0, 1), d.dataset.drop.slice(2)];
    if (kind === 'f') { await moveToFolder(L, id); toast(t('desk.movedTo', { n: L.length, name: folderLabel(st.folders.find((f) => f.id === id)) })); }
    else { const n = await addToSet(L, id); toast(t('desk.addedTo', { n, name: st.sets.find((x) => x.id === id).name })); }
    await reload();
  });
  list.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]');
    if (a && a.dataset.a !== 'ck') return act(a.dataset.a, a);
    if (e.target.id === 'lAdd') return hooks.add?.();
    const th = e.target.closest('[data-sort]');
    if (th) { const c = th.dataset.sort; st.sort = { col: c, dir: st.sort.col === c ? -st.sort.dir : 1 }; draw(); return; }
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const id = tr.dataset.id, R = rows().map((s) => s.id);
    if (e.shiftKey && st.anchor && R.includes(st.anchor)) {
      const [i, j] = [R.indexOf(st.anchor), R.indexOf(id)].sort((x, y) => x - y);
      if (!(e.ctrlKey || e.metaKey)) st.sel.clear();
      R.slice(i, j + 1).forEach((x) => st.sel.add(x));
      draw(); return;
    }
    if (e.ctrlKey || e.metaKey || (a && a.dataset.a === 'ck')) { st.sel.has(id) ? st.sel.delete(id) : st.sel.add(id); st.anchor = id; draw(); return; }
    st.anchor = id;
    st.edit = null;
    location.hash = '#/pesma/' + encodeURIComponent(id);
  });
  list.addEventListener('input', (e) => { if (e.target.id === 'lSearch') { st.q = e.target.value; draw(); } });
  list.addEventListener('dragstart', (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    drag = st.sel.has(tr.dataset.id) ? rows().filter((s) => st.sel.has(s.id)).map((s) => s.id) : [tr.dataset.id];
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', drag.join(','));
    const g = document.createElement('div');
    g.className = 'dk-ghost'; g.textContent = drag.length > 1 ? t('desk.dragN', { n: drag.length }) : (st.all.find((s) => s.id === drag[0]) || {}).title || '';
    document.body.appendChild(g); e.dataTransfer.setDragImage(g, 16, 16); setTimeout(() => g.remove());
  });
  list.addEventListener('dragend', () => { drag = null; side.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop')); });
  document.addEventListener('keydown', onKey);
  // izmene (sinhronizacija, ekran pesme, uvoz): osveži tabelu i brojeve
  let rT = 0; const re = () => { clearTimeout(rT); rT = setTimeout(() => deskReload(), 250); };
  events.addEventListener('songs-changed', re); events.addEventListener('settings-changed', re);
  const off = () => { if (location.hash.startsWith('#/pesm')) return; document.removeEventListener('keydown', onKey); removeEventListener('hashchange', off); bound = null; };
  addEventListener('hashchange', off);
}
let drag = null;
function typingIn(el) { return !!(el && el.closest && el.closest('input, textarea, select, [contenteditable="true"]')); }
async function onKey(e) {
  if (!side || !document.body.contains(side) || document.querySelector('.modal-backdrop, .more-backdrop, .ds-menu')) return;
  if (typingIn(e.target)) { if (e.key === 'Escape' && e.target.id === 'lSearch') { e.target.blur(); } return; }
  const k = e.key;
  if ((e.ctrlKey || e.metaKey) && (k === 'a' || k === 'A')) { e.preventDefault(); rows().forEach((s) => st.sel.add(s.id)); draw(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === 'Escape' && st.sel.size) { st.sel.clear(); draw(); return; }
  if ((k === 'Delete' || k === 'Backspace') && st.sel.size) { e.preventDefault(); return act('del'); }
  if (k === 'Enter' && st.sel.size) { location.hash = '#/pesma/' + encodeURIComponent(rows().find((s) => st.sel.has(s.id)).id); return; }
  if (k === 'e' || k === 'E') { const id = st.sel.size === 1 ? ids()[0] : st.open; if (id) { e.preventDefault(); quickEdit(id); } return; }
  if (k === 'F2' && st.group.startsWith('f:')) { e.preventDefault(); const b = side.querySelector(`[data-g="${CSS.escape(st.group)}"]`); if (b && !b.dataset.sys) renameInPlace(b); }
}

// ---------------- Brzo uređivanje (desno) ----------------
async function quickEdit(id) {
  const s = await db.get(id); if (!s || !songPane) return;
  st.edit = id; st.root.classList.add('dk-has-song');
  const fOpts = st.folders.filter((f) => !isSystemFolder(f.id)).map((f) => `<label class="dk-fchk"><input type="checkbox" value="${esc(f.id)}"${(s.folders || []).includes(f.id) ? ' checked' : ''}> ${esc(f.name)}</label>`).join('');
  songPane.innerHTML = `<div class="dk-edit"><div class="dk-edit-k">${t('desk.quickEdit')}</div><h2>${esc(s.title || '')}</h2>
    <label class="dk-f">${t('desk.col.title')}<input id="qeTitle" value="${esc(s.title || '')}" maxlength="120"></label>
    <label class="dk-f">${t('desk.col.artist')}<input id="qeArtist" value="${esc(s.artist || '')}" maxlength="120"></label>
    <div class="dk-f3"><label class="dk-f">${t('desk.capo')}<input id="qeCapo" type="number" min="0" max="12" value="${Number(s.capo) || 0}"></label><label class="dk-f">BPM<input id="qeBpm" type="number" min="30" max="260" value="${Number(s.bpm) || ''}" placeholder="—"></label><label class="dk-f">${t('desk.col.key')}<input value="${esc(keyOf(s))}" disabled></label></div>
    <label class="dk-f">${t('desk.ytLink')}<input id="qeYt" value="${esc((s.yt && s.yt.listen) || '')}" placeholder="https://youtu.be/…"></label>
    <div class="dk-f">${t('desk.col.folder')}<div class="dk-fl">${fOpts || `<span class="muted small">${t('desk.noFolders')}</span>`}</div></div>
    <div class="row"><button class="btn primary" id="qeSave">${t('common.save')}</button><button class="btn" id="qeOpen">${t('desk.openSong')} ›</button><button class="btn" id="qeX">${t('common.cancel')}</button></div></div>`;
  draw();
  const $ = (x) => songPane.querySelector('#' + x);
  $('qeTitle').focus();
  const close = () => { st.edit = null; if (st.open) location.hash = '#/pesma/' + encodeURIComponent(st.open) + '?r=' + Date.now(); else { songPane.innerHTML = ''; draw(); } };
  $('qeX').onclick = close;
  $('qeOpen').onclick = () => { st.edit = null; location.hash = '#/pesma/' + encodeURIComponent(id); };
  $('qeSave').onclick = async () => {
    const r = await db.get(id); if (!r) return;
    r.title = $('qeTitle').value.trim() || r.title; r.artist = $('qeArtist').value.trim();
    const capo = Math.max(0, Math.min(12, Number($('qeCapo').value) || 0)); if (capo) r.capo = capo; else delete r.capo;
    const bpm = Number($('qeBpm').value); if (bpm >= 30 && bpm <= 260) r.bpm = Math.round(bpm); else delete r.bpm;
    const yt = $('qeYt').value.trim();
    if (yt) { if (!/^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//.test(yt)) { toast(t('desk.ytBad'), 'error'); return; } r.yt = { ...(r.yt || {}), listen: yt }; }
    else if (r.yt) { delete r.yt.listen; if (!r.yt.along) delete r.yt; }
    const fs = [...songPane.querySelectorAll('.dk-fl input:checked')].map((x) => x.value);
    const sys = (r.folders || []).filter((f) => isSystemFolder(f));
    r.folders = [...sys, ...fs]; if (!r.folders.length) delete r.folders;
    r.updatedAt = Date.now();
    await db.put(r);
    toast(t('common.saved'));
    st.edit = null;
    await reload();
    location.hash = '#/pesma/' + encodeURIComponent(id) + '?r=' + Date.now();
  };
  songPane.querySelector('.dk-edit').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') $('qeSave').click(); if (e.key === 'Escape') close(); });
}

// ---------------- Poveži Google (računar) ----------------
async function syncOn() { return !!(((await settings.get('syncCfg', null)) || {}).on); }
async function connect() {
  try { const { connectSync } = await import('./sync.js'); if (await connectSync()) { document.querySelector('.dk-invite')?.remove(); connectCard(); } }
  catch (e) { if (e && e.code !== 'cancelled') toast((e && e.message) || t('common.error'), 'error'); }
}
async function connectCard() {
  const box = side && side.querySelector('#dsConn'); if (!box) return;
  if (await syncOn()) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<button type="button" class="ds-conn-btn" data-c="go"><span class="ds-dot"></span><b>${t('desk.connTitle')}</b><span>${t('desk.connSub')}</span></button>`;
}
/** Prvi put na računaru (pa na 3 dana, najviše 3 puta) dok sinhronizacija nije uključena. */
async function invite() {
  if (await syncOn()) return;
  let s = {}; try { s = JSON.parse(localStorage.getItem('marli-deskinvite') || '{}'); } catch {}
  try { if (navigator.webdriver && !localStorage.getItem('marli-invite-test')) return; } catch {} // automatski testovi
  if ((s.n || 0) >= 3 || (s.at && Date.now() - s.at < 3 * DAY)) return;
  const n = st.all.filter((x) => !x.demo).length;
  setTimeout(() => {
    if (!side || !document.body.contains(side) || document.querySelector('.modal-backdrop')) return;
    try { localStorage.setItem('marli-deskinvite', JSON.stringify({ n: (s.n || 0) + 1, at: Date.now() })); } catch {} // broji se tek kad se zaista prikaže
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop dk-invite';
    wrap.innerHTML = `<div class="modal dk-invite-m" role="dialog" aria-modal="true" aria-label="${t('desk.invTitle')}">
      <img src="icons/icon-192.png" alt="" class="dk-inv-ico"><h2 class="modal-title">${t('desk.invTitle')}</h2>
      <p class="muted">${t('desk.invBody')}</p>
      <ul class="dk-inv-l"><li>${t('desk.inv1')}</li><li>${t('desk.inv2')}</li><li>${t('desk.inv3')}</li></ul>
      <div class="row" style="justify-content:center"><button class="btn" data-i="later">${t('common.later')}</button><button class="btn primary" data-i="go">${t('desk.invBtn')}</button></div>
      <p class="tiny muted">${t('desk.invNote')}</p></div>`;
    const close = () => wrap.remove();
    wrap.__close = close;
    wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { close(); if (b.dataset.i === 'go') connect(); } else if (!e.target.closest('.modal')) close(); });
    document.body.appendChild(wrap);
  }, n ? 1500 : 3200);
}
