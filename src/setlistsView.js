// Setliste (spisak setlista, detalj sa prevlačenjem za redosled) i dijalozi za foldere.
import { songs as db } from './db.js';
import { setWakeZone } from './wakelock.js';
import { esc, toast, dialog, confirmDialog } from './ui.js';
import { t, songsCount } from './i18n.js';
import { srCompare } from './collate.js';
import {
  getFolders, addFolder, renameFolder, deleteFolder, setSongFolders, folderLabel, isSystemFolder,
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
  const r = await pickMany(t('folder.forSong', { title: song.title }), folders.map((f) => ({ value: f.id, label: folderLabel(f) })), song.folders || []);
  if (!r) return false;
  await setSongFolders(song.id, r);
  return true;
}

/** Upravljanje folderima: preimenuj ili obriši. */
export async function manageFolder(folder) {
  if (isSystemFolder(folder.id)) { toast(t('folder.systemNote')); return null; }
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
      ${lists.length ? lists.map((l) => `<li class="song-item slp-item"><a class="song-link" href="#/setlista/${encodeURIComponent(l.id)}">
        <span class="sl-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h12v2H3zm0 5h12v2H3zm0 5h8v2H3zm14-3v-3h2v3h3v2h-3v3h-2v-3h-3v-2z"/></svg></span><span class="sl-txt"><span class="song-title">${esc(l.name)}</span><span class="song-sub">${esc(songsCount(l.songIds.length))}</span></span></a></li>`).join('')
        : `<li class="empty sl-empty-big"><span class="sl-ico big"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h12v2H3zm0 5h12v2H3zm0 5h8v2H3zm14-3v-3h2v3h3v2h-3v3h-2v-3h-3v-2z"/></svg></span><b>${t('sl.emptyTitle')}</b><span class="muted">${t('sl.empty')}</span></li>`}
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
  setWakeZone('setlist');
  const sl = await getSetlist(id);
  if (!sl) { location.hash = '#/pesme'; return; }
  const all = await db.list();
  const byId = new Map(all.map((s) => [s.id, s]));
  let ids = sl.songIds.filter((x) => byId.has(x)); // pesme koje su u međuvremenu obrisane se preskaču

  const ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    add: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7l-6.7 3.4a3 3 0 1 0 0 3.2L15 17a3 3 0 1 0 3-1z"/></svg>',
    grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.3 7.1 16.9 5.7 12 10.6 7.1 5.7 5.7 7.1 10.6 12l-4.9 4.9 1.4 1.4 4.9-4.9 4.9 4.9 1.4-1.4-4.9-4.9z"/></svg>',
  };
  root.innerHTML = `
  <section class="view setlist-view">
    <header class="topbar">
      <a href="#/pesme?tab=sl" class="back">${t('sl.backToList')}</a>
      <div class="topbar-actions">
        <button class="btn small" id="slRename">${t('folder.rename')}</button>
        <button class="btn small danger-text" id="slDelete">${t('common.delete')}</button>
      </div>
    </header>
    <div class="sl-hero">
      <h1 id="slTitle">${esc(sl.name)}</h1>
      <p class="sl-sub" id="slSub"></p>
      <button class="btn sl-play-btn" id="slStage">${ICON.play}<span>${t('stage.playSet')}</span></button>
      <div class="sl-actions">
        <button class="btn sl-sec" id="slAdd">${ICON.add}<span>${t('sl.addSongs')}</span></button>
        <button class="btn sl-sec" id="slShare">${ICON.share}<span>${t('share.btn')}</span></button>
      </div>
    </div>
    <div class="sl-list-head"><h2>${t('sl.songsHead')}</h2><p class="sl-hint">${t('sl.rowHint')}</p></div>
    <ol class="sl-list" id="slList"></ol>
  </section>`;
  const $ = (q) => root.querySelector('#' + q);
  const save = () => updateSetlist(id, { songIds: ids });
  try { if (localStorage.getItem('gitara-shares')) import('./shareService.js').then((m) => m.prewarmShare()).catch(() => {}); } catch {} // „Podeli“ ne čeka Google

  const resumeAt = () => { try { return Number(localStorage.getItem(`gitara-set-pos-${id}`)) || 0; } catch { return 0; } };
  const draw = () => {
    $('slStage').disabled = !ids.length;
    $('slSub').textContent = songsCount(ids.length);
    $('slList').innerHTML = ids.length ? ids.map((sid, i) => {
      const s = byId.get(sid);
      // dodir na pesmu = ta pesma sa „‹ Prethodna / Sledeća ›“ kroz set (umesto posebnog dugmeta „Pesma po pesma“)
      return `<li class="sl-item" data-id="${esc(sid)}">
        <span class="sl-num" aria-hidden="true">${i + 1}</span>
        <a class="sl-title" href="#/pesma/${encodeURIComponent(sid)}?sl=${encodeURIComponent(id)}&i=${i}"><b>${esc(s.title)}</b>${s.artist ? `<small>${esc(s.artist)}</small>` : ''}</a>
        <button class="sl-handle drag" data-move="${i}" aria-label="${esc(t('sl.dragLabel', { title: s.title }))}">${ICON.grip}</button>
        <button class="sl-rm" data-rm="${i}" aria-label="${esc(t('sl.removeLabel', { title: s.title }))}">${ICON.x}</button>
      </li>`;
    }).join('') : `<li class="sl-empty"><p>${t('sl.noSongs')}</p><button class="btn sl-sec" data-add="1">${ICON.add}<span>${t('sl.addSongs')}</span></button></li>`;
  };
  draw();

  $('slList').addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { ids.splice(+rm.dataset.rm, 1); draw(); await save(); return; }
    if (e.target.closest('[data-add]')) $('slAdd').click();
  });
  // Tastatura (i čitač ekrana): strelice gore/dole na ručici pomeraju pesmu
  $('slList').addEventListener('keydown', async (e) => {
    const h = e.target.closest('[data-move]');
    if (!h || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const i = +h.dataset.move, k = e.key === 'ArrowUp' ? i - 1 : i + 1;
    if (k < 0 || k >= ids.length) return;
    [ids[i], ids[k]] = [ids[k], ids[i]];
    draw();
    $('slList').querySelector(`[data-move="${k}"]`)?.focus();
    await save();
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
    // pomeri samo ako se mesto promenilo (inače bez nepotrebnog preračunavanja rasporeda)
    if (after ? drag.li.nextElementSibling !== after : drag.li !== $('slList').lastElementChild) { if (after) $('slList').insertBefore(drag.li, after); else $('slList').appendChild(drag.li); }
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
    const items = [...all].sort((a, b) => srCompare(a.title, b.title)).map((s) => ({ value: s.id, label: s.title, sub: s.artist }));
    const r = await pickMany(t('sl.addSongs'), items, ids, t('lib.empty'));
    if (!r) return;
    // Zadrži postojeći redosled, nove dodaj na kraj
    ids = [...ids.filter((x) => r.includes(x)), ...r.filter((x) => !ids.includes(x))];
    draw();
    await save();
  });
  // „Sviraj set“: kratko pitanje pre početka (pauza, skrolovanje, od koje pesme) — pamti se uz set listu
  $('slStage').addEventListener('click', async () => {
    if (!ids.length) return;
    const cur = (await getSetlist(id)) || sl;
    const play = { pause: 5, scroll: true, ...(cur.play || {}) };
    const r = resumeAt(), canResume = r > 0 && r < ids.length;
    let from = canResume ? r : 0;
    const opt = (v, val, label, sub = '') => `<button type="button" role="radio" data-v="${v}" class="pl-opt${String(v) === String(val) ? ' active' : ''}" aria-checked="${String(v) === String(val)}"><span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
    const group = (name, q, opts, val, cls = '') => `<fieldset class="pl-group"><legend class="pl-q">${esc(q)}</legend><div class="pl-seg ${cls}" role="radiogroup" aria-label="${esc(q)}" data-name="${name}">${opts.map(([v, l, sub]) => opt(v, val, l, sub)).join('')}</div></fieldset>`;
    const [autoMain, autoSub] = splitParen(t('stage.scrollAuto'));
    const p = dialog({
      title: t('stage.sheetTitle'), html: true, className: 'play-sheet',
      body: `${group('pause', t('stage.pauseQ'), [[0, t('stage.pauseNone')], [5, t('stage.secs', { n: 5 })], [10, t('stage.secs', { n: 10 })], [20, t('stage.secs', { n: 20 })], [-1, t('stage.pauseWait')]], play.pause, 'pl-5')}
        ${group('scroll', t('stage.scrollQ'), [[1, autoMain, autoSub], [0, t('stage.scrollHand')]], play.scroll ? 1 : 0, 'pl-2')}
        ${canResume ? group('from', t('stage.startQ'), [[0, t('stage.fromStart')], [r, t('stage.resume', { n: r + 1 })]], from, 'pl-2') : ''}
        <p class="pl-hint">${t('stage.sheetHint')}</p>`,
      buttons: [{ label: t('common.cancel'), value: null }, { label: t('stage.go'), value: 'go', kind: 'primary' }],
    });
    const modal = [...document.querySelectorAll('.modal-backdrop')].pop();
    modal.classList.add('sheet-backdrop'); // donji list preko cele širine — pokriva i donje tabove
    modal.addEventListener('click', (e) => {
      const b = e.target.closest('.pl-seg [data-v]');
      if (!b) return;
      const g = b.parentElement, v = Number(b.dataset.v);
      g.querySelectorAll('[data-v]').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', String(x === b)); });
      if (g.dataset.name === 'pause') play.pause = v; else if (g.dataset.name === 'scroll') play.scroll = !!v; else from = v;
    });
    if ((await p) !== 'go') return;
    await updateSetlist(id, { play: { pause: play.pause, scroll: play.scroll } });
    (await import('./stage.js')).enterStage(id, Math.min(from, ids.length - 1));
  });
  // Podeli celu set listu (sve pesme, pun sadržaj) — link ili .gitara fajl kroz meni telefona
  $('slShare').addEventListener('click', async () => {
    if (!ids.length) { toast(t('sl.noSongs'), 'error'); return; }
    const b = $('slShare'); b.disabled = true;
    try { await (await import('./shareService.js')).shareSetlist({ ...((await getSetlist(id)) || sl), name: sl.name }); /* obrisane pesme se preskaču i to se kaže */ } catch { toast(t('share.failed'), 'error'); } finally { b.disabled = false; }
  });
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

/** „Automatski (u tempu pesme)“ → glavni deo i sitniji dodatak u zagradi (isti tekst, čitljivije u dugmetu). */
function splitParen(s) { const m = /^(.*?)\s*(\(.*\))$/.exec(s); return m ? [m[1], m[2]] : [s, '']; }

/** Navigacija kroz setlistu za prikaz pesme (Prethodna / Sledeća). */
export async function setlistNav(params) {
  const id = params.get('sl');
  if (!id) return null;
  const sl = await getSetlist(id);
  if (!sl) return null;
  const all = new Set((await db.list()).map((s) => s.id));
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
