// Setliste (spisak setlista, detalj sa prevlačenjem za redosled) i dijalozi za foldere.
import { songs as db } from './db.js';
import { esc, toast, dialog, confirmDialog } from './ui.js';
import { t, songsCount } from './i18n.js';
import {
  getFolders, addFolder, renameFolder, deleteFolder, setSongFolders,
  getSetlists, getSetlist, addSetlist, updateSetlist, deleteSetlist,
} from './collections.js';

/** Dijalog za unos naziva. Vraća tekst ili null. */
export async function askName(title, value = '') {
  const p = dialog({
    title,
    html: true,
    body: `<input id="nameInput" maxlength="60" value="${esc(value)}" autocomplete="off" aria-label="${esc(title)}">`,
    buttons: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), value: 'ok', kind: 'primary' }],
  });
  const modal = [...document.querySelectorAll('.modal-backdrop')].pop();
  const input = modal.querySelector('#nameInput');
  let val = value;
  input.addEventListener('input', () => (val = input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') modal.querySelector('.btn.primary').click(); });
  setTimeout(() => input.focus(), 50);
  const r = await p;
  return r === 'ok' && val.trim() ? val.trim() : null;
}

/** Izbor više stavki (checkbox lista). Vraća niz izabranih vrednosti ili null. */
export async function pickMany(title, items, selected = [], emptyText = '') {
  const sel = new Set(selected);
  const p = dialog({
    title,
    html: true,
    body: items.length
      ? `<div class="pick-list">${items.map((it) => `<label class="pick-row"><input type="checkbox" value="${esc(it.value)}" ${sel.has(it.value) ? 'checked' : ''}> <span>${esc(it.label)}${it.sub ? ` <small>${esc(it.sub)}</small>` : ''}</span></label>`).join('')}</div>`
      : `<p>${esc(emptyText)}</p>`,
    buttons: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), value: 'ok', kind: 'primary' }],
  });
  const modal = [...document.querySelectorAll('.modal-backdrop')].pop();
  modal.addEventListener('change', (e) => { if (e.target.type === 'checkbox') e.target.checked ? sel.add(e.target.value) : sel.delete(e.target.value); });
  const r = await p;
  return r === 'ok' ? items.map((i) => i.value).filter((v) => sel.has(v)) : null;
}

/** Dodela pesme folderima (pesma može biti u više foldera). */
export async function editSongFolders(song) {
  let folders = await getFolders();
  if (!folders.length) {
    const name = await askName(t('folder.new'));
    if (!name) return false;
    folders = [await addFolder(name)];
  }
  const r = await pickMany(t('folder.forSong', { title: song.title }), folders.map((f) => ({ value: f.id, label: f.name })), song.folders || []);
  if (!r) return false;
  await setSongFolders(song.id, r);
  return true;
}

/** Upravljanje folderima: preimenuj ili obriši. */
export async function manageFolder(folder) {
  const action = await dialog({
    title: folder.name,
    body: t('folder.manageBody'),
    buttons: [{ label: t('common.cancel'), value: null }, { label: t('folder.delete'), value: 'del', kind: 'danger' }, { label: t('folder.rename'), value: 'ren', kind: 'primary' }],
  });
  if (action === 'ren') {
    const n = await askName(t('folder.rename'), folder.name);
    if (n) { await renameFolder(folder.id, n); return 'renamed'; }
  } else if (action === 'del') {
    if (await confirmDialog(t('folder.deleteTitle'), t('folder.deleteBody', { name: folder.name }), t('common.delete'), 'danger')) {
      await deleteFolder(folder.id);
      return 'deleted';
    }
  }
  return null;
}

// ---------------- Spisak setlista (u tabu Pesme) ----------------
export async function renderSetlistsPane(el) {
  const lists = await getSetlists();
  el.innerHTML = `
    <button class="btn primary wide" id="slNew">${t('sl.new')}</button>
    <ul class="song-list">
      ${lists.length ? lists.map((l) => `<li class="song-item"><a class="song-link" href="#/setlista/${encodeURIComponent(l.id)}">
        <span class="song-title">${esc(l.name)}</span><span class="song-sub">${esc(songsCount(l.songIds.length))}</span></a></li>`).join('')
        : `<li class="empty muted">${t('sl.empty')}</li>`}
    </ul>`;
  el.querySelector('#slNew').addEventListener('click', async () => {
    const name = await askName(t('sl.new'));
    if (!name) return;
    const sl = await addSetlist(name);
    location.hash = '#/setlista/' + encodeURIComponent(sl.id);
  });
}

// ---------------- Detalj setliste ----------------
export async function renderSetlist(root, id) {
  const sl = await getSetlist(id);
  if (!sl) { location.hash = '#/pesme'; return; }
  const all = await db.all();
  const byId = new Map(all.map((s) => [s.id, s]));
  let ids = sl.songIds.filter((x) => byId.has(x)); // pesme koje su u međuvremenu obrisane se preskaču

  root.innerHTML = `
  <section class="view setlist-view">
    <header class="topbar">
      <a href="#/pesme?tab=sl" class="back">${t('sl.backToList')}</a>
      <div class="topbar-actions">
        <button class="btn small" id="slRename">${t('folder.rename')}</button>
        <button class="btn small danger-text" id="slDelete">${t('common.delete')}</button>
      </div>
    </header>
    <h1 id="slTitle">${esc(sl.name)}</h1>
    <div class="row">
      <button class="btn" id="slAdd">${t('sl.addSongs')}</button>
      <button class="btn primary" id="slPlay">${t('sl.play')}</button>
    </div>
    <button class="btn wide stage-btn" id="slStage"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v11H3zm2 2v7h14V7zM8 19h8v2H8z"/></svg>${t('stage.start')}</button>
    <p class="hint small">${t('sl.dragHint')}</p>
    <ol class="sl-list" id="slList"></ol>
  </section>`;
  const $ = (q) => root.querySelector('#' + q);
  const save = () => updateSetlist(id, { songIds: ids });

  const draw = () => {
    $('slPlay').disabled = !ids.length;
    $('slStage').disabled = !ids.length;
    $('slList').innerHTML = ids.length ? ids.map((sid, i) => {
      const s = byId.get(sid);
      return `<li class="sl-item" data-id="${esc(sid)}">
        <span class="drag" aria-hidden="true">⋮⋮</span>
        <span class="sl-num">${i + 1}.</span>
        <a class="sl-title" href="#/pesma/${encodeURIComponent(sid)}?sl=${encodeURIComponent(id)}&i=${i}">${esc(s.title)}<small>${esc(s.artist || '')}</small></a>
        <button class="icon-btn" data-up="${i}" aria-label="${t('sl.moveUp')}">▲</button>
        <button class="icon-btn" data-rm="${i}" aria-label="${t('sl.remove')}">✕</button>
      </li>`;
    }).join('') : `<li class="empty muted">${t('sl.noSongs')}</li>`;
  };
  draw();

  $('slList').addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-rm]');
    const up = e.target.closest('[data-up]');
    if (rm) { ids.splice(+rm.dataset.rm, 1); draw(); await save(); }
    else if (up && +up.dataset.up > 0) { const i = +up.dataset.up; [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; draw(); await save(); }
  });

  // Prevlačenje za promenu redosleda (dodir ili miš, za ručicu ⋮⋮)
  let drag = null;
  $('slList').addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.drag');
    if (!h) return;
    const li = h.closest('.sl-item');
    e.preventDefault();
    drag = { li, pointerId: e.pointerId };
    li.classList.add('dragging');
    $('slList').setPointerCapture(e.pointerId);
  });
  $('slList').addEventListener('pointermove', (e) => {
    if (!drag) return;
    const items = [...$('slList').querySelectorAll('.sl-item:not(.dragging)')];
    const after = items.find((it) => { const r = it.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (after) $('slList').insertBefore(drag.li, after); else $('slList').appendChild(drag.li);
  });
  const endDrag = async () => {
    if (!drag) return;
    drag.li.classList.remove('dragging');
    drag = null;
    ids = [...$('slList').querySelectorAll('.sl-item')].map((li) => li.dataset.id);
    draw();
    await save();
  };
  $('slList').addEventListener('pointerup', endDrag);
  $('slList').addEventListener('pointercancel', endDrag);

  $('slAdd').addEventListener('click', async () => {
    const items = [...all].sort((a, b) => String(a.title).localeCompare(String(b.title), 'sr')).map((s) => ({ value: s.id, label: s.title, sub: s.artist }));
    const r = await pickMany(t('sl.addSongs'), items, ids, t('lib.empty'));
    if (!r) return;
    // Zadrži postojeći redosled, nove dodaj na kraj
    ids = [...ids.filter((x) => r.includes(x)), ...r.filter((x) => !ids.includes(x))];
    draw();
    await save();
  });
  $('slPlay').addEventListener('click', () => { if (ids.length) location.hash = `#/pesma/${encodeURIComponent(ids[0])}?sl=${encodeURIComponent(id)}&i=0`; });
  $('slStage').addEventListener('click', async () => { if (ids.length) (await import('./stage.js')).enterStage(id, 0); });
  $('slRename').addEventListener('click', async () => {
    const n = await askName(t('folder.rename'), sl.name);
    if (!n) return;
    sl.name = n;
    await updateSetlist(id, { name: n });
    $('slTitle').textContent = n;
  });
  $('slDelete').addEventListener('click', async () => {
    if (!(await confirmDialog(t('sl.deleteTitle'), t('sl.deleteBody', { name: sl.name }), t('common.delete'), 'danger'))) return;
    await deleteSetlist(id);
    toast(t('sl.deleted'));
    location.hash = '#/pesme?tab=sl';
  });
}

/** Navigacija kroz setlistu za prikaz pesme (Prethodna / Sledeća). */
export async function setlistNav(params) {
  const id = params.get('sl');
  if (!id) return null;
  const sl = await getSetlist(id);
  if (!sl) return null;
  const all = new Set((await db.all()).map((s) => s.id));
  const ids = sl.songIds.filter((x) => all.has(x));
  const i = Math.max(0, Math.min(ids.length - 1, Number(params.get('i')) || 0));
  const href = (k) => `#/pesma/${encodeURIComponent(ids[k])}?sl=${encodeURIComponent(id)}&i=${k}`;
  return {
    title: sl.name, index: i, count: ids.length,
    prevHref: i > 0 ? href(i - 1) : null,
    nextHref: i < ids.length - 1 ? href(i + 1) : null,
    backHref: '#/setlista/' + encodeURIComponent(id),
    backLabel: '‹ ' + sl.name,
  };
}
