// Tab "Pesme": biblioteka, prikaz pesme, deljenje i uvoz. Editor i skeniranje su u songEditor.js (učitava se po potrebi).
const loadEditor = () => import('./songEditor.js');
import { sectionLabel } from './sectionLabel.js';
import { practiceLineHTML, fillPractice } from './songPracticeCard.js';
import { MORE_ICON, moreMenu, attachPinch, versionTipOnce, openPanel, zoomPillHTML, bindZoomPill, songMenuItems } from './songChrome.js';
import { paButtonHTML, bindPlayAlong, YT_ICON } from './playAlong.js';
import { songs as db } from './db.js';
import { esc, toast, dialog, confirmDialog, pickFile, pickFiles, closeXHTML } from './ui.js';
import { chordSVG, voicingCount, shapeNavHTML, onShapeSwipe } from './diagram.js';
import { getVoicings } from './chords.js';
import { stopGroup } from './synth.js';
import { parseChord, canonicalName } from './music.js';
import { songChords, progressionSummary, transposeSong, parseSharedFile, safeFileName, SongFormatError, layoutChordLine, songExtras, songMeta, cleanUncertain, cleanYoutubeUrl } from './songformat.js';
// Google Drive se učitava tek kad zatreba (ili odmah, ako je povezan — rezervna kopija kreće kao i ranije)
const driveConnected = async () => !!((await settings.get('drive', null)) || {}).connected;
driveConnected().then((c) => c && import('./drive.js')).catch(() => {});
import { t, getLang } from './i18n.js';
import { tabBlockHTML, layoutTabs, playTab, noteAt, STRING_NAMES } from './tabs.js';
import { easiestCapo, localStrum, patternById } from './suggest.js';
import { isStandalone, isIOS, isComputer, canPromptInstall, promptInstall } from './install.js';
import { settings } from './db.js';
import { PATTERNS, patternHTML, patternName, Metronome } from './rhythm.js';
import { keepAwake, allowSleep, setWakeZone } from './wakelock.js';
import { getFolders, addFolder, folderLabel, isSystemFolder } from './collections.js';
import { renderSetlistsPane, editSongFolders, manageFolder, askName } from './setlistsView.js';
import { seedDemoSong } from './demo.js';
import { dn } from './naming.js';
import { upgradeSong, CV, needsUpgrade } from './songmodel.js';
import { keyName } from './chordnames.js';
const openKeyWheel = (o) => import('./keyWheel.js').then((m) => m.openKeyWheel(o)); // samo kad se otvori točak tonaliteta
import { cleanTuning, tuningNotes } from './tunings.js';
import { srCompare } from './collate.js';

let selectedId = null; // izabrana pesma u prikazu sa dva panela
export function setSelectedSong(id) { selectedId = id; }

// v1.88: mirniji ekran pesme — „Poslušaj“ (nota) i „Skroluj“ (strelica nadole) u donjem desnom uglu
const NOTE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v10.6A3.5 3.5 0 1 0 11 17V7h5V3H9z"/></svg>';
const SET_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/></svg>';
const sPlayHTML = (on) => (on ? '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M11 4h2v12l4-4 1.4 1.4L12 19.8 5.6 13.4 7 12l4 4z"/></svg>')
  + `<span class="sb-lab">${t(on ? 'dock.stop' : 'dock.scroll')}</span>`;
// računar (širok ekran, miš): kontrole ostaju u traci; telefon i tablet: mirna verzija
const DESK_Q = '(min-width: 1100px) and (hover: hover) and (pointer: fine)';
function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

const norm = (s) => String(s || '').trim().toLocaleLowerCase('sr');
const fold = (s) => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'dj');

// ---------------- Biblioteka ----------------
// Tonalitet koji zvuči (sa izabranom transpozicijom) i male oznake: kapodaster, štimovanje, tablatura
const openedMap = () => { try { return JSON.parse(localStorage.getItem('gitara-opened') || '{}'); } catch { return {}; } };
function markOpened(id) {
  const m = openedMap(); m[id] = Date.now();
  const keep = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 300); // ograniči veličinu
  try { localStorage.setItem('gitara-opened', JSON.stringify(Object.fromEntries(keep))); } catch {}
}
// pretraga: naslov i izvođač se „presavijaju“ jednom po pesmi (sažeci iz db.list() se ne menjaju, pa WeakMap)
const foldMemo = new WeakMap();
const folded = (s) => { let f = foldMemo.get(s); if (!f) { f = { t: fold(s.title), a: fold(s.artist) }; foldMemo.set(s, f); } return f; };
const libKey = (s) => (s.keyN ? keyName({ root: (s.keyN.root + (s.transpose || 0) + 120) % 12, minor: s.keyN.minor }, 'en') : s.key);
let STUDENT_NAMES = new Map(); // v1.78: id učenika → ime (za oznaku na snimku)
export async function loadStudentNames() { try { const T = await import('./teach.js'); STUDENT_NAMES = new Map((await T.getStudents()).map((s) => [s.id, s.name])); } catch {} }
function libBadges(s) {
  const b = [];
  if (s.type === 'tab') b.push('<span class="badge-sm tab-badge">TAB</span>');
  if (s.capo) b.push(`<span class="badge-sm" title="${esc(t('capo.title'))}">${esc(t('lib.badgeCapo', { n: s.capo }))}</span>`);
  if (s.tuning && s.tuning !== 'standard') b.push(`<span class="badge-sm">${esc(t('tuning.' + s.tuning))}</span>`);
  if (s.type !== 'tab' && (s.hasTabs ?? (s.sections || []).some((x) => (x.tabs || []).length))) b.push('<span class="badge-sm tab-badge">TAB</span>'); // isti izgled svuda
  // v1.78: nastava — čiji je snimak / od nastavnika
  if (s.student && STUDENT_NAMES.has(s.student)) b.push(`<span class="badge-sm tch-badge">${esc(STUDENT_NAMES.get(s.student))}</span>`);
  if (s.fromT) b.push(`<span class="badge-sm tch-badge">${esc(t('tch.fromTeacherShort'))}</span>`);
  return b.length ? ' ' + b.join(' ') : '';
}
export async function renderLibrary(root, params = new URLSearchParams()) {
  await loadStudentNames(); // v1.78
  const sortPref = localStorageGet('gitara-sort') || 'new';
  const tab = params.get('tab') === 'sl' ? 'sl' : 'songs';
  root.innerHTML = `
  <section class="view lib-view">
    <header class="view-head lib-head"><h1 class="lib-h1"><button class="lib-title" id="lGroup" aria-haspopup="menu" aria-expanded="false"><span id="lGroupName">${t('lib.title')}</span><svg class="lib-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg></button></h1>
      <div class="head-icons">
        <button class="icon-btn" id="lSearchBtn" aria-label="${t('lib.searchLabel')}" title="${t('lib.searchLabel')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3a7 7 0 0 1 5.6 11.2l4.6 4.6-1.4 1.4-4.6-4.6A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg></button>
        <button class="icon-btn" id="lSortBtn" aria-label="${t('lib.sortLabel')}" title="${t('lib.sortLabel')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4 3 8h3v12h2V8h3L7 4zm10 16 4-4h-3V4h-2v12h-3l4 4z"/></svg></button>
      </div>
    </header>
    <div class="seg-tabs lib-tabs" role="tablist">
      <button role="tab" data-lt="songs" class="${tab === 'songs' ? 'active' : ''}">${t('lib.tabSongs')}</button>
      <button role="tab" data-lt="sl" class="${tab === 'sl' ? 'active' : ''}">${t('lib.tabSetlists')}</button>
    </div>
    <div id="lSlPane" ${tab === 'sl' ? '' : 'hidden'}></div>
    <div id="lSongsPane" ${tab === 'sl' ? 'hidden' : ''}>
    <div class="lib-chips" id="lChips" role="toolbar" aria-label="${t('lib.groups')}"></div>
    <div class="lib-search" id="lSearchRow" hidden>
      <input type="search" id="lSearch" placeholder="${t('lib.search')}" aria-label="${t('lib.searchLabel')}" enterkeyhint="search">
      <button class="icon-btn" id="lSearchX" aria-label="${t('common.close')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>
    </div>
    <div hidden>
      <select id="lSort" aria-label="${t('lib.sortLabel')}">
        <option value="new">${t('lib.sortNew')}</option>
        <option value="title">${t('lib.sortTitle')}</option>
        <option value="artist">${t('lib.sortArtist')}</option>
        <option value="recent">${t('lib.sortRecent')}</option>
      </select>
    </div>
    <div id="lNudge"></div>
    <div id="lWelcome"></div>
    <ul class="song-list" id="lList"></ul>
    </div>
    <button class="fab" id="lAdd" aria-label="${t('lib.add')}" title="${t('lib.add')}" ${tab === 'sl' ? 'hidden' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg></button>
  </section>`;
  const $ = (id) => root.querySelector('#' + id);
  $('lSort').value = sortPref;
  await seedDemoSong(getLang()).catch(() => {});
  let all = await db.list(); // brzi indeks (bez akorda) — dovoljan za listu
  let folders = await getFolders();
  // grupa: '' = sve, id foldera, 'artist:<ime>', 'auto:tab', 'auto:recent'
  let folderFilter = localStorageGet('gitara-folder') || '';
  const validGroup = (g) => !g || g === 'auto:tab' || g === 'auto:recent' || folders.some((f) => f.id === g); // izvođači više nisu grupa (pretraga ih nalazi)
  if (!validGroup(folderFilter)) folderFilter = '';

  // Sekcije: Pesme / Setliste
  root.querySelectorAll('[data-lt]').forEach((b) => b.addEventListener('click', () => {
    root.querySelectorAll('[data-lt]').forEach((x) => x.classList.toggle('active', x === b));
    const sl = b.dataset.lt === 'sl';
    $('lSongsPane').hidden = sl;
    $('lSlPane').hidden = !sl;
    $('lAdd').hidden = sl;
    drawFolders();
    history.replaceState(null, '', sl ? '#/pesme?tab=sl' : '#/pesme');
    if (sl) renderSetlistsPane($('lSlPane'));
  }));
  if (tab === 'sl') renderSetlistsPane($('lSlPane'));

  // Grupa pesama u naslovu („Sve pesme ▾“): dodir otvara panel sa grupama (automatske + moji folderi)
  const groupLabel = (g) => !g ? t('lib.groupAll') : g === 'auto:tab' ? t('lib.groupTab') : g === 'auto:recent' ? t('lib.groupRecent')
    : g.startsWith('artist:') ? (all.find((s) => artistKey(s) === g.slice(7))?.artist || g.slice(7)) : folderLabel(folders.find((f) => f.id === g) || { name: '' });
  // v2.0: čipovi grupa ispod naslova (telefon) — Sve, Od nastavnika, folderi (i Moji snimci), TAB; jedan dodir
  let myT = null; import('./teach.js').then((T) => T.getMyTeacher()).then((m) => { myT = m; drawChips(); }).catch(() => {});
  const drawChips = () => {
    const box = $('lChips'); if (!box) return;
    const n = (g) => all.filter((x) => inGroup(x, g)).length;
    const fo = [...folders].sort((a, b) => (isSystemFolder(b.id) ? 1 : 0) - (isSystemFolder(a.id) ? 1 : 0));
    const chips = [['', t('lib.chipAll'), n('')]];
    if (myT && myT.tid) chips.push(['nav:#/od-nastavnika', '🎓 ' + t('tch.fromTeacher'), all.filter((x) => x.fromT).length, 't']);
    for (const f of fo) chips.push([f.id, (isSystemFolder(f.id) ? '' : '📁 ') + folderLabel(f), n(f.id)]);
    const nt = n('auto:tab'); if (nt) chips.push(['auto:tab', t('lib.groupTab'), nt]);
    box.innerHTML = chips.map(([g, label, c, cls]) => `<button type="button" class="lib-chip${g === folderFilter ? ' on' : ''}${cls ? ' ' + cls : ''}" data-chip="${esc(g)}">${esc(label)}${c != null ? `<i>${c}</i>` : ''}</button>`).join('');
  };
  $('lChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-chip]'); if (!b) return;
    const g = b.dataset.chip;
    if (g.startsWith('nav:')) { location.hash = g.slice(4); return; }
    folderFilter = g; localStorageSet('gitara-folder', folderFilter); drawFolders(); draw();
    b.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  });
  const drawFolders = () => {
    const sl = !$('lSlPane').hidden;
    $('lGroupName').textContent = sl ? t('lib.tabSetlists') : groupLabel(folderFilter);
    $('lGroup').disabled = sl;
    drawChips();
  };
  $('lGroup').addEventListener('click', async () => {
    let teach = null;
    try { const T = await import('./teach.js'); const [tc, my, sts] = await Promise.all([T.getTeacher(), T.getMyTeacher(), T.getStudents()]); teach = { on: !!tc.on, n: sts.length, my }; } catch {}
    const r = await openGroupSheet({ all, folders, cur: folderFilter, inGroup, anchor: $('lGroup'), teach });
    if (!r) return;
    if (r.nav) { location.hash = r.nav; return; } // v1.78: Učenici / Od nastavnika
    if (r.manage) {
      const res = await manageFolder(folders.find((f) => f.id === r.manage));
      folders = await getFolders();
      if (res === 'deleted') { all = await db.list(); if (folderFilter === r.manage) folderFilter = ''; }
    } else if (r.add) {
      const name = await askName(t('folder.new'));
      if (!name) return;
      const f = await addFolder(name);
      folders = await getFolders();
      folderFilter = f.id;
    } else folderFilter = r.g;
    localStorageSet('gitara-folder', folderFilter);
    drawFolders();
    draw();
  });
  const recentIds = () => { const op = openedMap(); return new Set(Object.keys(op).sort((x, y) => op[y] - op[x]).slice(0, 30)); };
  function inGroup(s, g = folderFilter, rec = null) {
    if (!g) return !(s.folders || []).some(isSystemFolder);
    if (g === 'auto:tab') return s.type === 'tab' || !!s.hasTabs;
    if (g === 'auto:recent') return (rec || recentIds()).has(s.id);
    if (g.startsWith('artist:')) return artistKey(s) === g.slice(7);
    return (s.folders || []).includes(g);
  }

  const draw = () => {
    const q = fold($('lSearch').value);
    // snimci iz „Samo sviraj“ su samo u folderu „Moji snimci“ (ne u „Sve“)
    const rec = folderFilter === 'auto:recent' ? recentIds() : null;
    let list = all.filter((s) => inGroup(s, folderFilter, rec)).filter((s) => !q || folded(s).t.includes(q) || folded(s).a.includes(q) ||
      (s.find ?? '').includes(q));
    const sort = $('lSort').value;
    const cmp = srCompare; // srpska latinica: C Č Ć … S Š … Z Ž
    if (sort === 'title') list.sort((a, b) => cmp(a.title, b.title));
    else if (sort === 'artist') list.sort((a, b) => cmp(a.artist, b.artist) || cmp(a.title, b.title));
    else if (sort === 'recent' || folderFilter === 'auto:recent') { const op = openedMap(); list.sort((a, b) => (op[b.id] || 0) - (op[a.id] || 0) || (b.updatedAt || 0) - (a.updatedAt || 0)); }
    else list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!all.length || (!folderFilter && !q && all.every((s) => (s.folders || []).some(isSystemFolder)))) {
      $('lList').innerHTML = `<li class="empty">
        <p><b>${t('lib.empty')}</b></p>
        <p class="muted">${t('lib.emptyHint')}</p></li>`;
      return;
    }
    if (!list.length && folderFilter && !q) { $('lList').innerHTML = `<li class="empty muted">${t('folder.emptyFolder')}</li>`; return; }
    if (!list.length) { $('lList').innerHTML = `<li class="empty muted">${esc(t('lib.noResults', { q: $('lSearch').value }))}</li>`; othersFor($('lSearch').value); return; }
    $('lList').innerHTML = list.map((s) => `
      <li class="song-item${s.id === selectedId ? ' selected' : ''}" data-id="${esc(s.id)}">
        <a href="#/pesma/${encodeURIComponent(s.id)}" class="song-link">
          <span class="song-title">${esc(s.title)}</span>
          <span class="song-sub">${[s.artist ? esc(s.artist) : '', ((k) => (k ? `<span class="key">${esc(dn(k))}</span>` : ''))(libKey(s))].filter(Boolean).join(' · ')}${libBadges(s)}</span>
        </a>
        <button class="icon-btn more-btn" data-more="${esc(s.id)}" aria-label="${esc(t('lib.songMenu', { title: s.title }))}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>
        </button>
      </li>`).join('');
    othersFor($('lSearch').value);
  };
  // v2.0: pretraga na telefonu traži i „u ostatku aplikacije“ (set liste, vežbe, igre, delovi aplikacije, podešavanja, učenici)
  let others = [];
  function othersFor(raw) {
    if (!raw || !raw.trim()) return;
    import('./deskSearch.js').then((m) => m.searchOthers(raw)).then((r) => {
      if ($('lSearch').value !== raw || !r.length) return;
      others = r;
      $('lList').insertAdjacentHTML('beforeend', `<li class="lib-others-h">${esc(t('lib.others'))}</li>` + r.map((x, i) => `<li class="lib-other"><a href="${esc(x.href || '#')}" data-oi="${i}"><span class="ic">${esc(x.ic)}</span><span><b>${esc(x.label)}</b><small>${esc(x.group)}${x.sub && x.sub !== x.group ? ' · ' + esc(x.sub) : ''}</small></span></a></li>`).join(''));
    }).catch(() => {});
  }
  $('lList').addEventListener('click', (e) => { const a = e.target.closest('[data-oi]'); if (!a) return; const x = others[+a.dataset.oi]; if (x && x.run) { e.preventDefault(); x.run(); } });

  // kucanje: jedno crtanje po sličici ekrana (bez kašnjenja, samo se spoje pritisci u istom trenutku)
  let searchQ = 0;
  $('lSearch').addEventListener('input', () => { cancelAnimationFrame(searchQ); searchQ = requestAnimationFrame(draw); });
  $('lSort').addEventListener('change', () => { localStorageSet('gitara-sort', $('lSort').value); draw(); });
  $('lList').addEventListener('click', async (e) => {
    // „⋯“ uz pesmu: folderi / brisanje (umesto dve ikonice u svakom redu — manje gužve, teže je obrisati slučajno)
    const mb = e.target.closest('[data-more]');
    if (!mb) return;
    e.preventDefault();
    const s = all.find((x) => x.id === mb.dataset.more);
    if (!s) return;
    const n = (s.folders || []).filter((f) => !isSystemFolder(f)).length;
    const pick = await dialog({ title: s.title, body: s.artist || '', buttons: [
      { label: n ? t('lib.foldersN', { n }) : t('lib.folders'), value: 'fold' },
      { label: t('common.delete'), value: 'del', kind: 'danger' },
    ] });
    if (pick === 'fold') {
      if (await editSongFolders(s)) { all = await db.list(); folders = await getFolders(); drawFolders(); draw(); }
      return;
    }
    if (pick !== 'del') return;
    if (!(await confirmDialog(t('lib.deleteTitle'), t('lib.deleteBody', { title: s.title }), t('common.delete'), 'danger'))) return;
    await db.remove(s.id);
    all = all.filter((x) => x.id !== s.id);
    toast(t('lib.deleted'));
    draw();
  });
  // „+“: jedan ulaz za dodavanje (Skeniraj / Uvezi / Nova) — i na kartici dobrodošlice
  const addAction = async (k) => {
    if (k === 'scan') loadEditor().then((m) => m.startScan());
    else if (k === 'import') { if (await importSongFile()) { all = await db.list(); draw(); } }
    else if (k === 'backup') { if (await (await import('./restore.js')).restoreBackup()) { all = await db.list(); draw(); drawWelcome(); } }
    else if (k === 'new') loadEditor().then((m) => m.newSongDraft());
  };
  $('lAdd').addEventListener('click', () => openAddSheet(addAction));
  root.addEventListener('click', (e) => { const w = e.target.closest('[data-addk]'); if (w && root.contains(w)) addAction(w.dataset.addk); });
  // pretraga: ikonica otvara polje (prazno polje se zatvara samo); redosled: kratak izbor
  const openSearch = (on) => { $('lSearchRow').hidden = !on; $('lSearchBtn').classList.toggle('on', on); if (on) $('lSearch').focus(); else if ($('lSearch').value) { $('lSearch').value = ''; draw(); } };
  $('lSearchBtn').addEventListener('click', () => openSearch($('lSearchRow').hidden));
  $('lSearchX').addEventListener('click', () => openSearch(false));
  $('lSortBtn').addEventListener('click', async () => {
    const cur = $('lSort').value;
    const opts = [...$('lSort').options].map((o) => ({ label: (o.value === cur ? '✓ ' : '') + o.textContent, value: o.value }));
    const v = await dialog({ title: t('lib.sortLabel'), buttons: opts, className: 'menu-dialog' });
    if (v && v !== cur) { $('lSort').value = v; $('lSort').dispatchEvent(new Event('change')); }
  });
  const drawWelcome = () => {
    const mine = all.filter((x) => !x.demo).length;
    $('lWelcome').innerHTML = mine ? '' : `<div id="lSyncWelcome"></div><div class="welcome card"><b>${t('lib.welcomeTitle')}</b><p class="muted small">${t('lib.welcomeBody')}</p>${addOptionsHTML()}</div>`;
    if (!mine) syncWelcome($('lSyncWelcome'));
  };
  drawWelcome();
  oneTimeCapsFix(all).then((n) => { if (n) db.list().then((l) => { all = l; draw(); }); }).catch(() => {});
  drawFolders();
  draw();
  backupNudge($('lNudge'), all.filter((x) => !x.demo).length);
}


// ---------------- Grupe pesama (naslov „Sve pesme ▾“) ----------------
const artistKey = (s) => String(s.artist || '').trim().toLowerCase();
const GRP_ICONS = {
  '': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10.6A4 4 0 1 0 14 17V7h4V3z"/></svg>',
  'auto:recent': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.4 3.5 2.1-1 1.7L11 13V7h2z"/></svg>',
  'auto:tab': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v2H3zm0 4h18v2H3zm0 4h18v2H3zm0 4h18v2H3zM7 4h2v16H7zm8 0h2v16h-2z"/></svg>',
  rec: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1a7 7 0 0 0 6-6.9z"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  students: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 1 9l11 6 9-4.9V17h2V9L12 3zm-7 9.2v4L12 20l7-3.8v-4L12 16l-7-3.8z"/></svg>',
};
/**
 * Izbor grupe — padajući meni ispod naslova: Sve pesme, Nedavno otvorene, TAB pesme, Moji snimci, moji folderi
 * (⋯ = preimenuj/obriši) i + Novi folder. Izvođači se ne nude (pretraga ih nalazi).
 * Vraća { g } | { manage: id } | { add: true } | null.
 */
function openGroupSheet({ all, folders, cur, inGroup, anchor, teach = null }) {
  return new Promise((resolve) => {
    const rec = new Set(Object.entries(openedMap()).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k]) => k));
    const n = (g) => all.filter((s) => inGroup(s, g, rec)).length;
    const row = (g, label, ic, cnt, extra = '') => `<button class="grp-row${cur === g ? ' on' : ''}" role="menuitemradio" aria-checked="${cur === g}" data-g="${esc(g)}">
      <span class="grp-ic">${ic}</span><span class="grp-name">${esc(label)}</span>${cur === g ? `<span class="grp-ck">${GRP_ICONS.check}</span>` : `<span class="grp-n">${cnt}</span>`}${extra}</button>`;
    const own = folders.filter((f) => !isSystemFolder(f.id));
    const sys = folders.filter((f) => isSystemFolder(f.id));
    const wrap = document.createElement('div');
    wrap.className = 'grp-backdrop';
    wrap.innerHTML = `<div class="grp-pop" role="menu" aria-label="${t('lib.groups')}">
      ${row('', t('lib.groupAll'), GRP_ICONS[''], n(''))}
      ${rec.size ? row('auto:recent', t('lib.groupRecent'), GRP_ICONS['auto:recent'], n('auto:recent')) : ''}
      ${n('auto:tab') ? row('auto:tab', t('lib.groupTab'), GRP_ICONS['auto:tab'], n('auto:tab')) : ''}
      ${sys.map((f) => row(f.id, folderLabel(f), GRP_ICONS.rec, n(f.id))).join('')}
      ${teach && teach.my ? `<button class="grp-row" role="menuitem" data-nav="#/od-nastavnika"><span class="grp-ic">${GRP_ICONS.students}</span><span class="grp-name">${esc(t('tch.fromTeacher'))}</span><span class="grp-n">${all.filter((s) => s.fromT).length}</span></button>` : ''}
      <div class="grp-sep"></div>
      <div class="grp-head">${t('lib.groupsFolders')}</div>
      ${own.map((f) => row(f.id, folderLabel(f), GRP_ICONS.folder, n(f.id), `<span class="grp-more" data-gm="${esc(f.id)}" role="button" aria-label="${esc(t('folder.manage', { name: folderLabel(f) }))}">${GRP_ICONS.more}</span>`)).join('') || `<p class="small muted grp-empty">${t('lib.groupsMineEmpty')}</p>`}
      <button class="grp-row grp-add" data-gadd><span class="grp-ic">${GRP_ICONS.plus}</span><span class="grp-name">${t('folder.new')}</span></button>
    </div>`;
    const pop = wrap.querySelector('.grp-pop');
    // ispod naslova (ili gore levo ako nema naslova)
    const r = anchor ? anchor.getBoundingClientRect() : { left: 12, bottom: 64 };
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - 8 - Math.min(340, innerWidth - 16))) + 'px';
    pop.style.top = (r.bottom + 8) + 'px';
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    const done = (v) => { document.removeEventListener('keydown', onKey); anchor?.setAttribute('aria-expanded', 'false'); wrap.remove(); resolve(v); };
    wrap.__close = () => done(null);
    wrap.addEventListener('click', (e) => {
      const m = e.target.closest('[data-gm]'); if (m) { e.stopPropagation(); return done({ manage: m.dataset.gm }); }
      if (e.target.closest('[data-gadd]')) return done({ add: true });
      const nv = e.target.closest('[data-nav]'); if (nv) return done({ nav: nv.dataset.nav });
      const rw = e.target.closest('[data-g]'); if (rw) return done({ g: rw.dataset.g });
      if (!e.target.closest('.grp-pop')) done(null);
    });
    document.addEventListener('keydown', onKey);
    anchor?.setAttribute('aria-expanded', 'true');
    document.body.appendChild(wrap);
    pop.querySelector('.grp-row.on')?.focus({ preventScroll: true });
  });
}

// ---------------- Dodavanje pesme („+“) ----------------
const ADD_ICONS = {
  backup: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3a9 9 0 0 0-9 9H1l3.9 3.9L9 12H6a7 7 0 1 1 2.1 5l-1.4 1.4A9 9 0 1 0 13 3zm-1 5v5l4.3 2.5.7-1.2-3.5-2.1V8z"/></svg>',
  scan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3 7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>',
  import: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5L13 3.5zM11 12v4.2l-1.6-1.6L8 16l4 4 4-4-1.4-1.4-1.6 1.6V12h-2z"/></svg>',
  new: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.2V21h3.8l11-11-3.8-3.8-11 11zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8L20.7 7z"/></svg>',
};
const addOptionsHTML = (ids = false) => ['scan', 'import', 'backup', 'new'].map((k) => `<button class="add-opt" data-addk="${k}"${ids ? ` id="${{ scan: 'lScan', import: 'lImport', backup: 'lBackup', new: 'lNew' }[k]}"` : ''}>
  <span class="add-ico ${k}">${ADD_ICONS[k]}</span><span class="add-txt"><b>${t('lib.add.' + k)}</b><span class="small muted">${t('lib.add.' + k + 'Hint')}</span></span></button>`).join('');
/** v1.70 (računar, upravljač biblioteke): „+ Dodaj pesme“ i prazna biblioteka — isti izbori kao u listi pesama. */
export function openAddDesk(onDone) {
  openAddSheet(async (k) => {
    if (k === 'scan') loadEditor().then((m) => m.startScan());
    else if (k === 'import') { if (await importSongFile()) onDone?.(); }
    else if (k === 'backup') { if (await (await import('./restore.js')).restoreBackup()) onDone?.(); }
    else if (k === 'new') loadEditor().then((m) => m.newSongDraft());
  });
}
export function deskEmptyState(syncBox, addBox, onDone) {
  syncWelcome(syncBox);
  addBox.innerHTML = `<div class="welcome card"><b>${t('lib.welcomeTitle')}</b><p class="muted small">${t('lib.welcomeBody')}</p>${addOptionsHTML()}</div>`;
  addBox.addEventListener('click', async (e) => {
    const w = e.target.closest('[data-addk]'); if (!w) return;
    const k = w.dataset.addk;
    if (k === 'scan') loadEditor().then((m) => m.startScan());
    else if (k === 'import') { if (await importSongFile()) onDone?.(); }
    else if (k === 'backup') { if (await (await import('./restore.js')).restoreBackup()) onDone?.(); }
    else if (k === 'new') loadEditor().then((m) => m.newSongDraft());
  });
}
/** Donji panel sa tri načina dodavanja (zatvara se dodirom van njega, „nazad“ ili izborom). */
function openAddSheet(onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop sheet-backdrop';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${t('lib.add')}"><div class="sheet-grip"></div><h2 class="sheet-title">${t('lib.add')}</h2>${addOptionsHTML(true)}</div>`;
  const close = () => wrap.remove();
  wrap.__close = close;
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-addk]');
    if (b) { close(); onPick(b.dataset.addk); return; }
    if (!e.target.closest('.sheet')) close();
  });
  document.body.appendChild(wrap);
}
/** Jednom: naslovi/izvođači sačuvani SVE VELIKIM SLOVIMA pre ispravke → normalno („IN MY LIFE“ → „In My Life“). */
async function oneTimeCapsFix(all) {
  if (localStorageGet('gitara-capsfix')) return 0;
  const { fixCaps } = await import('./textCase.js');
  let n = 0;
  for (const x of all) {
    if (x.demo || (fixCaps(x.title) === x.title && fixCaps(x.artist || '') === (x.artist || ''))) continue;
    const s = await db.get(x.id);
    if (!s) continue;
    s.title = fixCaps(s.title); if (s.artist) s.artist = fixCaps(s.artist);
    await db.put(s); n++;
  }
  localStorageSet('gitara-capsfix', '1');
  return n;
}

// Podsetnik za rezervnu kopiju: posle 3+ pesama bez Google Drive-a; „Ne sada“ ga sakrije na 30 dana.
/**
 * v1.68: prazna biblioteka (npr. laptop) i sinhronizacija nije uključena: „Već koristiš Gitaru na drugom uređaju?“ —
 * jedan dodir povezuje isti Google nalog; pesme, setliste, podešavanja i Gemini ključ stižu sami (rezime posle prve sinhronizacije).
 */
async function syncWelcome(box) {
  if (!box || ((await settings.get('syncCfg', null)) || {}).on) return;
  box.innerHTML = `<div class="sync-welcome card"><div class="sw-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v10H4zm-2 12h20v2H2zM6 8v6h12V8z"/></svg></div>
    <div class="sw-txt"><b>${t('sw.title')}</b><p class="muted small">${t('sw.body')}</p>
    <button class="btn primary" id="swGo">${t('sw.btn')}</button><p class="muted small sw-note">${t('sw.note')} <button type="button" class="link-btn" id="swFile">${t('sw.fromFile')}</button></p></div></div>`;
  box.querySelector('#swFile').addEventListener('click', async () => { if (await (await import('./restore.js')).restoreFromFile()) dispatchEvent(new HashChangeEvent('hashchange')); });
  box.querySelector('#swGo').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try { const { connectSync } = await import('./sync.js'); if (await connectSync()) box.innerHTML = `<p class="muted small sw-wait">${t('sw.waiting')}</p>`; }
    catch (err) { if (err && err.code !== 'cancelled') toast((err && err.message) || t('common.error'), 'error'); }
    finally { const b = box.querySelector('#swGo'); if (b) b.disabled = false; }
  });
}

/**
 * v1.68: fajl prevučen bilo gde u prozor (računar): slike → skeniranje (strane), PDF / .gitara / .json → uvoz.
 * Vraća true ako je nešto uvezeno (lista se osvežava).
 */
export async function importDropped(files) {
  const list = [...files].filter(Boolean);
  if (!list.length) return false;
  const imgs = list.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
  if (imgs.length) { (await loadEditor()).scanFiles(imgs); return false; }
  // v1.70: više PDF-ova odjednom → red (sa tekstom odmah, skenirani preko Gemini-ja; upozorenje pre početka)
  const pdfs = list.filter((x) => x.type === 'application/pdf' || /\.pdf$/i.test(x.name));
  if (pdfs.length > 1) { (await import('./pdfQueue.js')).importPdfs(pdfs); return false; }
  const f = list.find((x) => /\.(gitara|json|pdf|txt)$/i.test(x.name) || /pdf|json|text/.test(x.type));
  if (!f) { toast(t('drop.unknown'), 'error'); return false; }
  const ok = await importSongFile(f);
  if (ok && /^#\/pesme(\?|$)/.test(location.hash)) dispatchEvent(new HashChangeEvent('hashchange'));
  return ok;
}

const NUDGE_MIN = 3, NUDGE_SNOOZE = 30 * 864e5;
/** v1.70: Drive rezervna kopija je povezana, a sinhronizacija nije — jednom ponudi „Uključi“ (ključ i podešavanja na svim uređajima). */
async function syncOffer(box) {
  if (!(await driveConnected()) || ((await settings.get('syncCfg', null)) || {}).on || localStorageGet('marli-syncoffer')) return false;
  box.innerHTML = `<div class="nudge-bar" role="note"><span class="nudge-txt">${t('sync.offer')}</span>
    <button type="button" class="nudge-link" data-s="on">${t('sync.offerBtn')} ›</button>
    <button class="icon-btn" data-s="x" aria-label="${t('nudge.later')}" title="${t('nudge.later')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button></div>`;
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    localStorageSet('marli-syncoffer', '1');
    if (b.dataset.s === 'on') { try { const { connectSync } = await import('./sync.js'); await connectSync(); } catch (err) { if (err && err.code !== 'cancelled') toast((err && err.message) || t('common.error'), 'error'); } }
    box.innerHTML = '';
  });
  return true;
}
async function backupNudge(box, count) {
  if (await syncOffer(box)) return;
  if (count < NUDGE_MIN || (await driveConnected()) || ((await settings.get('syncCfg', null)) || {}).on) return;
  const st = (await settings.get('backupNudge', null)) || {};
  if (st.snoozedAt && Date.now() - st.snoozedAt < NUDGE_SNOOZE) return;
  if (st.exportedAt && Date.now() - st.exportedAt < NUDGE_SNOOZE) return;
  // kratka traka (ne velika kartica iznad pesama): poruka, „Poveži Drive“, ✕ (= „Ne sada“); izvoz je u Podešavanjima
  const ios = isIOS() && !isStandalone();
  box.innerHTML = `<div class="nudge-bar" role="note">
    <span class="nudge-txt">${t(ios ? 'nudge.shortIos' : 'nudge.short')}</span>
    <button type="button" class="nudge-link" data-n="connect">${t('nudge.drive')} ›</button>
    <button class="icon-btn" data-n="later" aria-label="${t('nudge.later')}" title="${t('nudge.later')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button></div>`;
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-n]');
    if (!b) return;
    if (b.dataset.n === 'connect') {
      try { const { connectSync } = await import('./sync.js'); if (await connectSync()) box.innerHTML = ''; }
      catch (err) { if (err && err.code !== 'cancelled') toast((err && err.message) || t('common.error'), 'error'); }
      return;
    }
    if (b.dataset.n === 'export') {
      await (await import('./backups.js')).saveBackup('full'); // v1.71: cela aplikacija (Drive i/ili fajl)
      await settings.set('backupNudge', { ...st, exportedAt: Date.now() });
    } else await settings.set('backupNudge', { ...st, snoozedAt: Date.now() });
    box.innerHTML = '';
  });
}

// ---------------- Uvoz / deljenje ----------------
async function importSongFile(given = null) {
  let file = given;
  if (!file) {
    const picked = await pickFiles('.gitara,.json,.pdf,application/pdf,application/json,text/plain,application/octet-stream');
    const pdfs = picked.filter((x) => x.type === 'application/pdf' || /\.pdf$/i.test(x.name));
    if (pdfs.length > 1) { (await import('./pdfQueue.js')).importPdfs(pdfs); return false; }
    file = picked[0];
  }
  if (!file) return false;
  // PDF (note, tablatura, akordi): čita se bez AI, pa ekran za proveru; skeniran PDF ide na skeniranje
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > 30 * 1024 * 1024) { await dialog({ title: t('import.invalidTitle'), body: t('import.tooBig') }); return false; }
    return (await loadEditor()).importPdf(file);
  }
  if (file.size > 2 * 1024 * 1024) { await dialog({ title: t('import.invalidTitle'), body: t('import.tooBig') }); return false; }
  const text = await file.text();
  // poslata set lista / pesma (.gitara): isti uvoz kao iz linka
  if (/"app"\s*:\s*"gitara"[^]*"share"/.test(text.slice(0, 200))) {
    location.hash = '#/primljena';
    sessionStorage.setItem('gitara-import', text);
    return false;
  }
  let song;
  try {
    song = parseSharedFile(text);
  } catch (e) {
    await dialog({ title: t('import.invalidTitle'), body: e instanceof SongFormatError ? e.message : t('import.cantRead') });
    return false;
  }
  const existing = (await db.list()).find((s) => norm(s.title) === norm(song.title));
  if (existing) {
    const choice = await dialog({
      title: t('import.existsTitle'),
      body: t('import.existsBody', { title: existing.title }),
      buttons: [{ label: t('common.cancel'), value: null }, { label: t('import.keepBoth'), value: 'both' }, { label: t('import.replace'), value: 'replace', kind: 'primary' }],
    });
    if (!choice) return false;
    if (choice === 'replace') {
      await db.save({ ...song, id: existing.id, createdAt: existing.createdAt });
      toast(t('import.replaced', { title: song.title }));
      return true;
    }
  }
  await db.save(song);
  toast(t('import.added', { title: song.title }));
  return true;
}

/** „Podeli pesmu“: kratak link (shareService.js — jedini put za deljenje). */
async function shareSong(song) {
  await (await import('./shareService.js')).shareSong(song);
}

// ---------------- Pesma iz linka (#pesma=...) ----------------
export async function renderSharedSong(root) {
  setWakeZone('song');
  // novi zapis (#g=…): pesma ili cela set lista — „Uvezi …“ jednim dodirom
  const dq = new URLSearchParams(location.search).get('d');
  if (location.hash.startsWith('#d/') || dq) return (await import('./shareImport.js')).renderDriveShare(root, dq || decodeURIComponent(location.hash.slice(3).split(/[?&#]/)[0]));
  if (location.hash.startsWith('#g=')) return (await import('./shareImport.js')).renderSharedPackage(root, location.hash);
  const fileText = sessionStorage.getItem('gitara-import'); // .gitara fajl iz „Uvezi“
  if (fileText) { sessionStorage.removeItem('gitara-import'); return (await import('./shareImport.js')).renderSharedPackage(root, fileText); }
  let song;
  const { songFromHash } = await import('./sharelink.js');
  try { song = songFromHash(); } catch (e) {
    root.innerHTML = `<section class="view"><div class="card"><h2>${t('link.badTitle')}</h2><p class="muted">${esc(e.message)}</p>
      <a class="btn primary" href="#/pesme">${t('song.back')}</a></div></section>`;
    history.replaceState(null, '', location.pathname + location.search + '#/pesme');
    return;
  }
  if (song.type === 'tab') return renderSharedTab(root, song);
  // Primljena pesma se prikazuje u MOM imenovanju (akordi u linku su nedvosmisleni ili se prepoznaju)
  song = upgradeSong(song);
  const shapes = transposeSong(song, (song.transpose || 0) - (song.capo || 0));
  const chords = songChords(shapes);
  const shownKey = song.keyN ? keyName({ root: (song.keyN.root + (song.transpose || 0) + 120) % 12, minor: song.keyN.minor }, 'en') : song.key; // tonalitet koji zvuči
  root.innerHTML = `
  <section class="view shared-view">
    <div class="card add-card">
      <h2>${t('link.addTitle')}</h2>
      <p class="muted"><b>${esc(song.title)}</b>${song.artist ? ' — ' + esc(song.artist) : ''}</p>
      <div class="row"><button class="btn" id="shCancel">${t('common.cancel')}</button><button class="btn primary" id="shAdd">${t('link.add')}</button></div>
    </div>
    ${isStandalone() ? '' : `<div class="card install-card" id="shInstall">
      <p class="small">${t('link.installHint')}</p>
      ${canPromptInstall() ? `<button class="btn small primary" id="shInstallBtn">${t('set.install')}</button>` : `<p class="small muted">${isIOS() ? t('set.installIos') : t(isComputer() ? 'set.installPc' : 'set.installAndroid')}</p>`}
    </div>`}
    <h1 class="song-h1">${esc(song.title)}</h1>
    <p class="song-meta">${esc(song.artist || '')}${shownKey ? `${song.artist ? ' · ' : ''}${t('song.key')} <b>${esc(dn(shownKey))}</b>` : ''}${song.capo ? ` · ${t('capo.title')} ${song.capo}` : ''}</p>
    ${song.strum ? `<div class="strum-box card"><div class="strum-head"><span class="small muted">${t('strum.label')}</span> <b>${esc(patternName(song.strum))}</b></div>${patternHTML(song.strum)}</div>` : ''}
    ${chords.length ? `<div class="diagram-row">${chords.map((c) => `<div class="diagram-btn">${chordSVG(c, { voicing: (song.shapes || {})[c] || 0 })}</div>`).join('')}</div>` : ''}
    <div class="lyrics">${renderSectionsHTML(shapes.sections)}</div>
  </section>`;
  fitLyrics(root.querySelector('.lyrics'));
  layoutTabs(root);
  const $ = (q) => root.querySelector('#' + q);
  const leave = (hash) => location.replace(location.pathname + location.search + hash); // briše #pesma= iz adrese
  $('shCancel').addEventListener('click', () => leave('#/pesme'));
  $('shInstallBtn')?.addEventListener('click', async () => { await promptInstall(); $('shInstall')?.remove(); });
  $('shAdd').addEventListener('click', async () => {
    const existing = (await db.list()).find((x) => norm(x.title) === norm(song.title));
    let rec;
    if (existing) {
      const choice = await dialog({
        title: t('import.existsTitle'),
        body: t('import.existsBody', { title: existing.title }),
        buttons: [{ label: t('common.cancel'), value: null }, { label: t('link.keepBoth'), value: 'both' }, { label: t('import.replace'), value: 'replace', kind: 'primary' }],
      });
      if (!choice) return;
      rec = choice === 'replace'
        ? await db.save({ ...song, id: existing.id, createdAt: existing.createdAt, folders: existing.folders })
        : await db.save(song);
      toast(choice === 'replace' ? t('import.replaced', { title: song.title }) : t('import.added', { title: song.title }));
    } else {
      rec = await db.save(song);
      toast(t('import.added', { title: song.title }));
    }
    leave('#/pesma/' + encodeURIComponent(rec.id));
  });
}

/** Primljena TAB pesma: pregled tablature i „Dodaj u pesmaricu“ (ista provera duplikata kao za druge pesme). */
async function renderSharedTab(root, song) {
  const tv = await import('./tabView.js');
  root.innerHTML = `<section class="view shared-view tab-view">
    <div class="card add-card"><h2>${t('link.addTitle')}</h2><p class="muted"><b>${esc(song.title)}</b>${song.artist ? ' — ' + esc(song.artist) : ''}</p>
      <div class="row"><button class="btn" id="shCancel">${t('common.cancel')}</button><button class="btn primary" id="shAdd">${t('link.add')}</button></div></div>
    <h1 class="song-h1">${esc(song.title)} <span class="badge-sm tab-badge">TAB</span></h1>
    <p class="song-meta">${tv.tabMeta(song).map(esc).join(' · ')}</p>
    <div class="tab-staff2" id="shStaff"></div></section>`;
  requestAnimationFrame(() => tv.drawStaff(root.querySelector('#shStaff'), song.tab));
  const leave = (hash) => location.replace(location.pathname + location.search + hash);
  root.querySelector('#shCancel').addEventListener('click', () => leave('#/pesme'));
  root.querySelector('#shAdd').addEventListener('click', async () => {
    const { findExisting } = await import('./songIdentity.js');
    const existing = findExisting(song, await db.all());
    let rec;
    if (existing) {
      const choice = await dialog({ title: t('dup.title', { title: existing.title }), body: t('dup.body'), buttons: [{ label: t('common.cancel'), value: null }, { label: t('dup.saveNew'), value: 'new' }, { label: t('dup.replace'), value: 'replace', kind: 'primary' }] });
      if (!choice) return;
      rec = choice === 'replace' ? await db.save({ ...existing, ...song, id: existing.id, createdAt: existing.createdAt, folders: existing.folders, bpm: existing.bpm ?? song.bpm }) : await db.save(song);
    } else rec = await db.save(song);
    toast(t('import.added', { title: song.title }));
    leave('#/pesma/' + encodeURIComponent(rec.id));
  });
}

// ---------------- Prikaz linija sa akordima ----------------
const INVISIBLE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFFF9-\uFFFD]/g;
function chordSpan(c, mark) {
  return `<button class="ch${mark !== undefined ? ' unsure' : ''}" data-chord="${esc(c)}"${mark !== undefined ? ` data-unsure="${mark}"` : ''}>${esc(dn(c).replace(INVISIBLE, ''))}</button>`;
}

/** Mesto reči (indeks u tekstu) najbliže poziciji koju je dao Gemini. */
export function findWord(text, word, near = 0) {
  let best = -1, idx = text.indexOf(word);
  while (idx !== -1) {
    if (best === -1 || Math.abs(idx - near) < Math.abs(best - near)) best = idx;
    idx = text.indexOf(word, idx + 1);
  }
  return best;
}

/** Tekst dela sa podvučenim (nesigurnim) opsezima: ranges = [{from, to, mark}] u koordinatama linije. */
function markText(str, start, ranges) {
  let out = '', i = 0;
  const end = start + str.length;
  for (const r of ranges) {
    const a = Math.max(r.from, start), b = Math.min(r.to, end);
    if (a >= b) continue;
    out += esc(str.slice(i, a - start)) + `<mark class="unsure" data-unsure="${r.mark}">${esc(str.slice(a - start, b - start))}</mark>`;
    i = b - start;
  }
  return out + esc(str.slice(i));
}

/**
 * Jedna linija: akordi iznad slogova. marks = nesigurna mesta za ovu liniju
 * ({ kind, position, text, idx }) — podvlače se žutom.
 */
export function renderLineHTML(line, marks = []) {
  const chords = [...(line.chords || [])].sort((a, b) => a.position - b.position);
  // nevidljivi i kontrolni znaci (često iz skeniranog teksta) bi se na nekim telefonima prikazali kao tamni pravougaonik:
  // zamenjuju se razmakom iste dužine, pa akordi ostaju tačno na svojim slogovima
  const text = (line.text || '').replace(INVISIBLE, ' ');
  const chordMark = (c) => { const m = marks.find((x) => x.kind === 'chord' && x.position === c.position); return m ? m.idx : undefined; };
  const ranges = marks.filter((m) => m.kind === 'word').map((m) => { const from = findWord(text, m.text, m.position); return from < 0 ? null : { from, to: from + m.text.length, mark: m.idx }; })
    .filter(Boolean).sort((a, b) => a.from - b.from);
  if (!chords.length) return text.trim() ? `<div class="ln"><span class="tx">${markText(text, 0, ranges)}</span></div>` : '<div class="ln blank"></div>';
  if (!text.trim()) {
    return `<div class="ln chords-only">${chords.map((c) => chordSpan(c.chord, chordMark(c))).join('<span class="gap"> </span>')}</div>`;
  }
  const lastPos = chords[chords.length - 1].position;
  const tt = text.length < lastPos ? text.padEnd(lastPos, ' ') : text;
  // Delovi: granice na pozicijama akorda i posle svakog razmaka.
  const cuts = new Set([0, tt.length]);
  chords.forEach((c) => cuts.add(Math.min(c.position, tt.length)));
  for (let i = 0; i < tt.length; i++) if (tt[i] === ' ' && i + 1 < tt.length) cuts.add(i + 1);
  const pts = [...cuts].sort((a, b) => a - b);
  const chunks = [];
  for (let i = 0; i < pts.length - 1; i++) chunks.push({ start: pts[i], text: tt.slice(pts[i], pts[i + 1]), chords: [] });
  if (!chunks.length) chunks.push({ start: 0, text: '', chords: [] });
  for (const c of chords) {
    let target = chunks.find((ch) => ch.start === Math.min(c.position, tt.length));
    if (!target) target = chunks[chunks.length - 1];
    target.chords.push(c);
  }
  // Grupisanje u reči (da se reč ne lomi između slogova). Reč bez akorda je jedan element (.tx0, sa praznim mestom
  // za red akorda iznad) umesto četiri — pesma ima ~60 % manje elemenata, pa se brže otvara i uvećava.
  const words = [];
  chunks.forEach((ch, i) => { const prev = chunks[i - 1]; if (!prev || prev.text.endsWith(' ')) words.push([]); words[words.length - 1].push(ch); });
  let html = '<div class="ln">';
  for (const w of words) {
    if (!w.some((ch) => ch.chords.length)) { html += `<span class="tx0">${markText(w.map((ch) => ch.text).join(''), w[0].start, ranges)}</span>`; continue; }
    html += '<span class="w">';
    for (const ch of w) {
      const chordsHtml = ch.chords.map((c) => chordSpan(c.chord, chordMark(c))).join(' ');
      html += `<span class="seg"><span class="cr">${chordsHtml}</span><span class="tx">${markText(ch.text, ch.start, ranges)}</span></span>`;
    }
    html += '</span>';
  }
  return html + '</div>';
}

/**
 * Tekst pesme uvek staje u širinu ekrana: izmeri najduži red (sa akordima) bez prelamanja
 * i smanji slova tako da stane — ali ne ispod ~13 px (tada se izuzetno dugi redovi ipak prelome).
 * Vraća true ako su slova smanjena zbog širine (tada A+ nema smisla).
 */
export function fitLyrics(el, minPx = 13, pre = null) {
  if (!el || !el.isConnected) return false;
  // pre: mere uzete pre ubacivanja teksta (lyricsMetrics) — tada nema nijednog dodatnog preračunavanja
  const m = pre || lyricsMetrics(el);
  const want = m.want, avail = m.avail;
  el.style.fontSize = '';
  if (!avail) return false;
  // Tekst je u fiksnoj širini slova (monospace): širina reda = broj znakova × širina jednog znaka.
  // Računa se iz sadržaja, bez dodatnog merenja ekrana (na sporom telefonu to je bilo 2–3 puna preračunavanja).
  let widest = 0;
  if (/mono/i.test(m.family)) {
    let widestCh = 0;
    for (const ln of el.querySelectorAll('.ln')) widestCh = Math.max(widestCh, lineCh(ln));
    widest = widestCh * chWidth(m.family, want);
  } else {
    // čitljiv (proporcionalan) font, npr. „Sviraj set“: širina iz stvarnih slova (canvas, bez rasporeda stranice);
    // akord je uvek usidren na početak svog sloga, pa poravnanje ne zavisi od fonta
    const ch = el.querySelector('.ch');
    const chScale = ch ? (parseFloat(getComputedStyle(ch).fontSize) || want) / want : 1;
    for (const ln of el.querySelectorAll('.ln')) widest = Math.max(widest, linePx(ln, m.family, want, chScale));
  }
  if (widest <= avail) return false;
  const px = Math.max(minPx, Math.floor(want * (avail / widest) * 0.98 * 10) / 10);
  el.style.fontSize = px + 'px';
  return true;
}

// Širina reda u „ch“ jedinicama (kao kada se red ne bi prelamao)
const ZW = /\u200b/g;
function lineCh(ln) {
  if (ln.classList.contains('blank')) return 0;
  if (ln.classList.contains('chords-only')) {
    const chs = ln.querySelectorAll('.ch');
    let w = 0;
    chs.forEach((c) => { w += c.textContent.length; });
    return w + Math.max(0, chs.length * 2 - 2) * 1.5; // razmak 1.5ch između stavki (akordi i razmaci)
  }
  const segs = ln.querySelectorAll('.seg, .tx0');
  if (!segs.length) return (ln.textContent || '').length;
  let w = 0;
  segs.forEach((sg) => {
    if (sg.classList.contains('tx0')) { w += sg.textContent.replace(ZW, '').length; return; }
    const ct = sg.firstElementChild.textContent.replace(ZW, '').length;
    const tt = sg.lastElementChild.textContent.replace(ZW, '').length;
    w += Math.max(tt, ct + 0.6); // akordi imaju .6ch razmaka desno
  });
  return w;
}

// Širina reda u pikselima za proporcionalan font (tekst normalno, akordi podebljano i manje)
let mctx = null;
function linePx(ln, family, px, chScale) {
  if (ln.classList.contains('blank')) return 0;
  mctx ||= document.createElement('canvas').getContext('2d');
  const tw = (str) => { mctx.font = `${px}px ${family}`; return mctx.measureText(str).width; };
  const cw = (str) => { mctx.font = `800 ${px * chScale}px ${family}`; return mctx.measureText(str).width; };
  if (ln.classList.contains('chords-only')) {
    const chs = [...ln.querySelectorAll('.ch')];
    return chs.reduce((w, c) => w + cw(c.textContent), 0) + Math.max(0, chs.length - 1) * px * 1.1;
  }
  const segs = ln.querySelectorAll('.seg, .tx0');
  if (!segs.length) return tw(ln.textContent || '');
  let w = 0;
  segs.forEach((sg) => {
    if (sg.classList.contains('tx0')) { w += tw(sg.textContent); return; }
    const chs = [...sg.firstElementChild.querySelectorAll('.ch')].map((c) => c.textContent).join(' ');
    w += Math.max(tw(sg.lastElementChild.textContent), chs ? cw(chs) + px * 0.45 : 0);
  });
  return w;
}

// Širina jednog znaka u odnosu na veličinu slova (meri se jednom, bez rasporeda stranice)
const chCache = new Map();
function chWidth(family, px) {
  let r = chCache.get(family);
  if (r === undefined) {
    const c = document.createElement('canvas').getContext('2d');
    c.font = `100px ${family}`;
    r = c.measureText('0000000000').width / 1000;
    if (!r) r = 0.6;
    chCache.set(family, r);
  }
  return r * px;
}

/** Veličina slova, font i raspoloživa širina za tekst pesme (ne zavise od samog teksta). */
const COLS_GAP = 44, COLS_MIN = 760; // v1.68: tekst u dve kolone kad je prostor za tekst bar ovoliko širok (računar)
const colsPref = () => localStorageGet('gitara-cols') !== '0';
export function lyricsMetrics(el, availW = 0) {
  el.style.fontSize = '';
  const cs = getComputedStyle(el);
  let avail = availW || el.clientWidth;
  if (el.classList.contains('cols2')) avail = Math.floor((avail - COLS_GAP) / 2); // v1.68: dve kolone na širokom ekranu
  return { want: parseFloat(cs.fontSize) || 16, family: cs.fontFamily, avail };
}

// Širina teksta pesme po veličini ekrana (ne zavisi od pesme)
const lyrW = new Map();
// (screen.* ne traži preračunavanje rasporeda, za razliku od window.innerWidth)
const lyrWKey = () => `${screen.width}x${screen.height}|${screen.orientation ? screen.orientation.type : ''}|${document.body.classList.contains('two-pane-mode') ? 2 : 1}`;

/** Svi delovi pesme. uncertain = lista nesigurnih mesta (indeksi se odnose na ove sekcije). */
export function renderSectionsHTML(sections, uncertain = [], { edit = false, songStrum = null } = {}) {
  // v1.67 (ekran pesme): ritam dela je dugme (dodir = izmena); deo bez svog ritma prikazuje ritam cele pesme (bleđe);
  // pesma bez ikakvog ritma: „+ Ritam“ uz prvi deo
  const has = (x) => x.lines.length || (x.tabs || []).length;
  const addAt = edit && !songStrum && !(sections || []).some((x) => x.strum) ? (sections || []).findIndex(has) : -1;
  const pat = (s, si) => {
    if (!edit) return s.strum ? patternHTML(s.strum, { compact: true }) : '';
    if (!has(s)) return '';
    if (s.strum) return `<button class="sec-pat" data-strumedit="${si}" aria-label="${esc(t('strum.editPart', { name: s.name ? sectionLabel(s.name) : t('strum.section', { n: si + 1 }) }))}">${patternHTML(s.strum, { compact: true })}</button>`;
    if (songStrum) return `<button class="sec-pat inherited" data-strumedit="${si}" data-inherited="1" aria-label="${esc(t('strum.editPart', { name: s.name ? sectionLabel(s.name) : t('strum.section', { n: si + 1 }) }))}">${patternHTML(songStrum, { compact: true })}</button>`;
    if (si === addAt) return `<button class="sec-pat-add" data-strumedit="song">${t('strum.addShort')}</button>`;
    // neki delovi imaju svoj ritam, a pesma nema zajednički: ostali delovi dobijaju „+ Ritam“ (izbor: ovaj deo ili cela pesma)
    if (addAt < 0 && !songStrum) return `<button class="sec-pat-add" data-strumedit="${si}" data-inherited="1">${t('strum.addShort')}</button>`;
    return '';
  };
  return (sections || []).map((s, si) => { const pt = pat(s, si); return `
    <div class="sec">
      ${s.name || pt ? `<div class="sec-head">${s.name ? `<div class="sec-name">${esc(sectionLabel(s.name))}</div>` : ''}${pt}</div>` : ''}
      ${(s.tabs || []).map((tab, ti) => tabBlockHTML(tab, { si, ti, playLabel: t('tab.play'), marks: uncertain.map((u, idx) => ({ ...u, idx })).filter((u) => u.kind === 'fret' && u.section === si && u.tab === ti).map((u) => ({ string: u.string, col: u.col, idx: u.idx })) })).join('')}
      ${s.lines.map((l, li) => renderLineHTML(l, uncertain.map((u, idx) => ({ ...u, idx })).filter((u) => u.section === si && u.line === li))).join('')}
    </div>`; }).join('');
}

/** Primeni predlog na pesmu (menja originalne akorde/tekst, pomera akorde iza promenjene reči). */
export function applyUncertain(song, u) {
  if (u.kind === 'fret') {
    const tab = song.sections[u.section] && song.sections[u.section].tabs && song.sections[u.section].tabs[u.tab];
    const n = tab && noteAt(tab, u.string, u.col);
    if (!n) return false;
    n.f = u.suggestion;
    return true;
  }
  const line = song.sections[u.section] && song.sections[u.section].lines[u.line];
  if (!line) return false;
  if (u.kind === 'chord') {
    // Akord se traži po onome kako je napisan na papiru (w), ne po internom zapisu
    const wr = (x) => (x.w !== undefined ? x.w : x.chord);
    const c = line.chords.find((x) => x.position === u.position && wr(x) === u.text) || line.chords.find((x) => wr(x) === u.text);
    if (!c) return false;
    c.chord = u.suggestion;
    if (c.w !== undefined) { c.w = u.suggestion; delete c.n; }
    return true;
  }
  const at = findWord(line.text, u.text, u.position);
  if (at < 0) return false;
  const delta = u.suggestion.length - u.text.length;
  line.text = line.text.slice(0, at) + u.suggestion + line.text.slice(at + u.text.length);
  if (delta) line.chords.forEach((c) => { if (c.position > at) c.position = Math.max(at + 1, c.position + delta); });
  return true;
}

// ---------------- YouTube ----------------
const LINK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 13.4a1 1 0 0 1 0-1.4l3.4-3.4a1 1 0 1 1 1.4 1.4L12 13.4a1 1 0 0 1-1.4 0zM8.5 19.5a4 4 0 0 1-2.8-6.8l2.1-2.1 1.4 1.4-2.1 2.1a2 2 0 0 0 2.8 2.8l2.1-2.1 1.4 1.4-2.1 2.1a4 4 0 0 1-2.8 1.2zm7.7-6.1-1.4-1.4 2.1-2.1a2 2 0 0 0-2.8-2.8L12 9.2 10.6 7.8l2.1-2.1a4 4 0 0 1 5.6 5.6z"/></svg>';
const ytSearch = (song, extra) => 'https://www.youtube.com/results?search_query=' + encodeURIComponent([song.title, song.artist, extra].filter(Boolean).join(' '));

/** Dva dugmeta ispod naslova: „Poslušaj“ i „Tutorijal“ (pretraga ili sačuvan link) + „Sačuvaj link“. */
function ytRowHTML(song) {
  const yt = song.yt || {};
  const item = (kind, label, href) => `<div class="yt-item">
    <a class="btn small yt-btn" href="${esc(href)}" target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3z"/></svg>
      ${label}${yt[kind] ? '<span class="yt-saved" aria-hidden="true"></span>' : ''}</a>
    <button class="icon-btn yt-link${yt[kind] ? ' saved' : ''}" data-yt="${kind}" aria-label="${esc(t(yt[kind] ? 'yt.changeLink' : 'yt.saveLink'))}" title="${esc(t(yt[kind] ? 'yt.changeLink' : 'yt.saveLink'))}">${LINK_ICON}</button>
  </div>`;
  return `<div class="yt-row">${item('listen', t('yt.listen'), yt.listen || ytSearch(song))}${item('tutorial', t('yt.tutorial'), yt.tutorial || ytSearch(song, 'guitar tutorial'))}</div>`;
}

// ---------------- Uvećan dijagram ----------------
// opts.voicing: hvat sa kojim se otvara; opts.onPick(i): pamti izabrani hvat za ovu pesmu (pri zatvaranju)
function showChord(name, opts = {}) {
  const n = voicingCount(name);
  const start = n ? ((opts.voicing || 0) % n) : 0;
  let v = start;
  const canon = canonicalName(name);
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  const p = parseChord(name);
  wrap.innerHTML = `<div class="modal chord-modal has-x" role="dialog" aria-modal="true" aria-label="${esc(t('diagram.chord', { name: dn(name) }))}">
      ${closeXHTML('data-a="close"')}
      <div class="chord-big" id="cmBig"></div>
      <div id="cmNav"></div>
      ${dn(canon) !== dn(name) ? `<p class="muted center">${t('chordModal.same')} <b>${esc(dn(canon))}</b></p>` : ''}
      ${p && p.bass !== null ? `<p class="muted center small">${esc(t('chordModal.bass', { bass: dn(name.split('/')[1]) }))}</p>` : ''}
      ${n === 0 ? `<p class="muted center">${t('chordModal.none')}</p>` : `<div class="modal-actions"><button class="btn primary" data-a="play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>${t('dict.play')}</button></div>`}
    </div>`;
  const big = wrap.querySelector('#cmBig'), nav = wrap.querySelector('#cmNav');
  const draw = () => { big.innerHTML = chordSVG(name, { voicing: v }); nav.innerHTML = shapeNavHTML(name, v); };
  const play = () => import('./chordDict.js').then((m) => m.playVoicing(getVoicings(name)[v], 'chordpop'));
  const shift = (d) => { if (n < 2) return; v = (v + d + n) % n; draw(); play(); };
  const close = () => {
    stopGroup('chordpop');
    wrap.remove();
    if (opts.onPick && v !== start) opts.onPick(v);
  };
  draw();
  wrap.__close = close; // dugme „nazad“
  onShapeSwipe(big, shift);
  wrap.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a], [data-shape]');
    if (e.target === wrap || (a && a.dataset.a === 'close')) return close();
    if (!a) return;
    if (a.dataset.shape) return shift(+a.dataset.shape);
    if (a.dataset.a === 'play') play();
  });
  document.body.appendChild(wrap);
}

// ---------------- Prikaz pesme ----------------
let curFitChips = null, fitResizeOn = false; // v2.1: red čipova se ponovo uklapa kad se promeni veličina ekrana
export async function renderSong(root, id, nav = null) {
  let stored = await db.get(id);
  if (!stored) {
    root.innerHTML = `<section class="view"><p>${t('song.notFound')}</p><a class="btn" href="#/pesme">${t('song.back')}</a></section>`;
    return;
  }
  // Pesma još nije prebačena u novi zapis akorda (npr. otvorena pre jednokratne konverzije) — uradi to sada
  if (needsUpgrade(stored)) { stored = upgradeSong(stored); db.put(stored).catch(() => {}); }
  markOpened(stored.id); // za sortiranje „Nedavno otvorene“ (pamti se samo na uređaju, ne pokreće rezervnu kopiju)
  // TAB pesma (prebiranje): poseban ekran (tablatura), učitava se tek sada
  versionTipOnce('song:' + id); // prethodne verzije: samo u „⋯“ (jednom kratko objašnjenje), bez trake iznad pesme
  if (localStorageGet('gitara-shares')) import('./shareService.js').then((m) => m.prewarmShare()).catch(() => {}); // „Podeli“ ne čeka Google
  if (stored.type === 'tab') return (await import('./tabView.js')).renderTabSong(root, stored, nav, { ytRowHTML, shareSong, driveConnected });
  let tp = stored.transpose || 0;
  let capo = stored.capo || 0;
  let zoom = Number(stored.zoom) || (Number(localStorageGet('gitara-font')) || 1);
  let speed = stored.scrollSpeed || 4;
  let strumOn = (await settings.get('strumSuggest', true)) !== false; // predlozi ritma (Podešavanja → Pesme → „Predlaži ritam“)
  let loopSec = -1, loopMet = null, loopBpm = 90; // vežbanje jedne sekcije
  // Tempo pesme: sačuvan uz pesmu (ili, ako ga nema, opšti tempo metronoma)
  const songBpm = async () => Number(stored.bpm) || Number(await settings.get('metBpm', 90)) || 90;
  const backHref = nav ? nav.backHref : '#/pesme';
  root.innerHTML = `
  <section class="view song-view">
    <header class="topbar">
      <a href="${backHref}" class="back" aria-label="${t('song.back')}">${nav ? esc(nav.backLabel) : t('song.backShort')}</a>
      <div class="topbar-actions">
        <button class="icon-btn" id="sMore" aria-haspopup="true" aria-label="${t('song.more')}" title="${t('song.more')}">${MORE_ICON}</button>
      </div>
    </header>
    ${nav ? `<div class="setlist-nav card">
      <a class="btn small ${nav.prevHref ? '' : 'disabled'}" ${nav.prevHref ? `href="${nav.prevHref}"` : 'aria-disabled="true"'}>‹ ${t('sl.prev')}</a>
      <span class="small muted">${esc(nav.title)} · ${nav.index + 1}/${nav.count}</span>
      <a class="btn small ${nav.nextHref ? 'primary' : 'disabled'}" ${nav.nextHref ? `href="${nav.nextHref}"` : 'aria-disabled="true"'}>${t('sl.next')} ›</a>
    </div>` : ''}
    <div class="aa-pop" id="sAaPop" hidden>
      <span class="small">A</span>
      <input type="range" id="sAaRange" min="80" max="180" step="10" aria-label="${t('song.textSize')}">
      <span class="aa-big">A</span>
      <b id="sAaVal"></b>
      <p class="small muted" id="sAaNote" hidden>${t('song.fitNote')}</p>
    </div>
    <div id="sBody">
      <div id="sHead"></div>
      <div class="song-chips" id="sChips"></div>
      ${stored.recording ? '' : `<div class="song-tb" id="sTb" role="toolbar" aria-label="${esc(t('stb.label'))}">
        <button class="btn primary" data-tb="edit" title="${esc(t('stb.editTip'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.2V21h3.8l11-11-3.8-3.8-11 11zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8L20.7 7z"/></svg><span>${t('stb.edit')}</span></button>
        <button class="btn stb-listen" data-tb="listen" title="${esc(t('dock.listenTip'))}">${NOTE_ICON}<span>${t('dock.listen')}</span></button>
        <button class="btn" data-tb="video" title="${esc(t('stb.videoTip'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3L10 15z"/></svg><span>${t('stb.video')}</span></button>
        <button class="btn stb-tog" data-tb="easy" aria-pressed="false" title="${esc(t('song.easySub'))}"><i aria-hidden="true"></i><span>${t('sug.easyBtn')}</span></button>
        <button class="btn" data-tb="share" aria-haspopup="true" title="${esc(t('stb.shareTip'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7l-6.7 3.4a3 3 0 1 0 0 3.2L15 17a3 3 0 1 0 3-1z"/></svg><span>${t('song.shareShort')}</span> ▾</button>
        <button class="btn stb-more" data-tb="more" title="${esc(t('song.more'))}" aria-label="${esc(t('song.more'))}">${MORE_ICON}</button>
      </div>`}
      ${stored.recording ? '' : practiceLineHTML(id)}
      <button type="button" class="st-line" id="sStats" hidden></button>
      <div id="sAsk"></div>
      <div id="sSuggest"></div>
      <div id="sControls"></div>
      <details class="song-details" id="sDet"><summary><span>${t('song.details')}</span><span class="small muted" id="sDetSub"></span></summary><div id="sDetBody"></div></details>
      ${zoomPillHTML()}
      ${paButtonHTML(stored)}
      <button class="icon-btn cols-btn" id="sCols" hidden aria-pressed="false" aria-label="${t('song.cols2')}" title="${t('song.cols2')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h8v16H3zm2 2v12h4V6zm8-2h8v16h-8zm2 2v12h4V6z"/></svg></button>
      <div class="lyrics" id="sLyrics" style="--zoom:${zoom}"></div>
      <div class="diagram-row diag-col" id="sDiagCol" aria-label="${t('song.diagrams')}"></div>
    </div>
    <div class="scroll-bar" id="sScrollBar">
      <div class="loop-row" id="sLoopRow" hidden>
        <span class="loop-name"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z"/></svg><b id="sLoopName"></b></span>
        <span class="loop-bpm" role="group" aria-label="${t('loop.tempo')}">
          <button class="btn round small" id="sBpmDown" aria-label="${t('loop.slower')}">−</button>
          <b id="sBpm"></b>
          <button class="btn round small" id="sBpmUp" aria-label="${t('loop.faster')}">+</button>
        </span>
        <button class="icon-btn" id="sLoopStop" aria-label="${t('loop.stop')}" title="${t('loop.stop')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>
      </div>
      <button class="btn sb-listen" id="sListen" title="${esc(t('dock.listenTip'))}">${NOTE_ICON}<span>${t('dock.listen')}</span></button>
      <button class="btn round small" id="sPlay" aria-label="${t('scroll.play')}">${sPlayHTML(false)}</button>
      <span class="small muted">${t('scroll.slower')}</span>
      <input type="range" id="sSpeed" min="1" max="10" step="1" value="${speed}" aria-label="${t('scroll.speed')}">
      <span class="small muted">${t('scroll.faster')}</span>
      <button class="icon-btn scroll-collapse" id="sCollapse" aria-label="${t('scroll.collapse')}" title="${t('scroll.collapse')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 7.4 10 6l6 6-6 6-1.4-1.4L13.2 12z"/></svg></button>
    </div>
    <div class="song-end">
      <button class="end-chip" id="sPdf"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg> ${t('song.pdfShort')}</button>
      <button class="end-chip" id="sShare"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7l-6.7 3.4a3 3 0 1 0 0 3.2L15 17a3 3 0 1 0 3-1z"/></svg> ${t('song.shareShort')}</button>
    </div>
  </section>`;
  const $ = (q) => root.querySelector('#' + q);

  // Akordi koji se SVIRAJU: zapisani akordi (zvučni tonalitet) + transpozicija − kapodaster.
  const shapesSong = () => transposeSong(stored, tp - capo);
  const keyAt = (n) => (stored.keyN ? keyName({ root: (stored.keyN.root + n + 120) % 12, minor: stored.keyN.minor }, 'en') : '');
  const soundingKey = () => keyAt(tp) || (stored.key ? transposeSong({ key: stored.key, sections: [] }, tp).key : '');

  // Pitanja posle konverzije: nejasno „B“ ili nesiguran tonalitet
  function askHTML() {
    if (stored.namingAsk) {
      const bs = [...new Set(stored.sections.flatMap((s) => s.lines.flatMap((l) => (l.chords || []).map((c) => c.w || '').filter((w) => /^B(?!b)/.test(w)))))].slice(0, 4);
      return `<div class="card ask-card"><b>${t('ask.bTitle', { list: bs.join(', ') || 'B' })}</b><p class="small muted">${t('ask.bHint')}</p>
        <div class="row"><button class="btn small" data-ask="en">${t('ask.bIsH')}</button><button class="btn small" data-ask="sr">${t('ask.bIsBb')}</button></div></div>`;
    }
    if (stored.keyAsk && stored.keyAlt && stored.keyAlt.length) {
      return `<div class="card ask-card"><b>${t('ask.keyTitle')}</b><p class="small muted">${t('ask.keyHint')}</p>
        <div class="row">${stored.keyAlt.map((k, i) => `<button class="btn small" data-askkey="${i}">${esc(dn(keyName(k, 'en')))}</button>`).join('')}<button class="btn small ghost" data-askkey="wheel">${t('ask.keyOther')}</button></div></div>`;
    }
    return '';
  }
  const answerNaming = async (naming) => { stored = upgradeSong(stored, { naming }); await save(); draw(); };
  const answerKey = async (k) => { stored = upgradeSong(stored, { keyN: k }); await save(); draw(); };

  // Ekran pesme je podeljen na delove; menja se samo deo čiji se podaci promenili (brže na dugim pesmama)
  const drawHead = () => {
    // Naslov i (desno, u istom redu) prečica za vežbanje delova ove pesme
    $('sHead').innerHTML = `<div class="song-title-row"><h1 class="song-h1">${esc(stored.title)}</h1></div>
      ${stored.recording ? `<button class="btn small fp-onneck" id="sFpReplay"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>${esc(t('song.playOnNeck'))}</button>` : ''}
      ${stored.artist || cleanTuning(stored.tuning) !== 'standard' ? `<p class="song-meta">${esc(stored.artist || '')}${cleanTuning(stored.tuning) !== 'standard'
        ? `${stored.artist ? ' · ' : ''}<button class="tuning-chip" id="sTune" title="${esc(t('tuning.tuneNow'))}">${esc(t('tuning.' + cleanTuning(stored.tuning)))} · ${esc(tuningNotes(stored.tuning))} ›</button>` : ''}</p>` : ''}`;
    drawPracticeMark();
    // snimak iz „Samo sviraj“: ponovo na vratu (samo slika; modul se učitava tek na dodir)
    $('sFpReplay')?.addEventListener('click', () => import('./freeplay.js').then((m) => m.replaySong(stored)));
  };
  // Mala oznaka napretka pored ikonice vežbe: koliko delova pesme je dobro uvežbano (najbolje ≥ 80)
  // napredak vežbanja ove pesme na kartici „Vežbaj ovu pesmu“: koliko delova je dobro uvežbano (najbolje ≥ 80)
  // v1.73: jedan red „Svirano · Vežbano · najslabiji deo“; dodir → sve o pesmi
  import('./statsView.js').then(async (S) => {
    const b = root.querySelector('#sStats'); if (!b) return;
    const txt = await S.songLineText(stored.id, stored.sections || []);
    if (txt) { b.innerHTML = txt; b.hidden = false; }
    b.addEventListener('click', () => S.openSongStats(stored.id));
  }).catch(() => {});
  const drawPracticeMark = () => settings.get('practice', null).then((st) => {
    const rec = st && st.songs && st.songs[stored.id];
    const card = root.querySelector('.sp-line');
    if (!rec || !card || !Object.keys(rec).length) return;
    const seen = new Set();
    const total = (stored.sections || []).filter((sec) => {
      const ch = (sec.lines || []).flatMap((l) => (l.chords || []).map((c) => c.chord)).filter(Boolean);
      const sig = (sec.name || '') + '|' + ch.join(',');
      if (!ch.length || seen.has(sig)) return false;
      seen.add(sig); return true;
    }).length;
    const good = Object.entries(rec).filter(([k, r]) => k !== 'all' && r && r.best >= 80).length;
    fillPractice(card, { good, total, played: true, done: !!(rec.all && rec.all.best >= 80) });
  }).catch(() => {});
  const drawAsk = () => { $('sAsk').innerHTML = askHTML(); };
  const drawControls = () => {
    const key = soundingKey();
    const shapesKey = capo ? keyAt(tp - capo) : '';
    // v1.62: jedan tanak red — TON − G + | KAPO − bez + | − 90 BPM + (dodir na tonalitet otvara točak tonaliteta)
    $('sControls').innerHTML = `<div class="ctl-slim">
      <div class="cs-cell cs-key" role="group" aria-label="${t('song.key')}">
        ${tp ? `<button class="cs-lab cs-reset" id="tReset" title="${esc(t('song.original'))}" aria-label="${esc(t('song.original'))}">↺ ${tp > 0 ? '+' + tp : '−' + Math.abs(tp)}</button>` : `<span class="cs-lab">${t('ctl.keyShort')}</span>`}
        <button class="cs-b" id="tDown" aria-label="${t('song.transposeDown')}">−</button>
        <button class="cs-v cs-k" id="kOpen" aria-haspopup="dialog" aria-label="${esc(t('kw.open', { k: dn(key) || '?' }))}">${esc(dn(key) || '–')}</button>
        <button class="cs-b" id="tUp" aria-label="${t('song.transposeUp')}">+</button>
      </div>
      <div class="cs-cell" role="group" aria-label="${t('capo.title')}">
        <span class="cs-lab">${t('ctl.capoShort')}</span>
        <button class="cs-b" id="cDown" aria-label="${t('capo.down')}">−</button>
        <b class="cs-v">${capo || t('capo.none')}</b>
        <button class="cs-b" id="cUp" aria-label="${t('capo.up')}">+</button>
      </div>
      <div class="cs-cell" role="group" aria-label="${t('song.tempo')}">
        <button class="cs-b" id="sTempoDown" aria-label="${t('loop.slower')}">−</button>
        <b class="cs-v" id="sTempo">${Number(stored.bpm) || '…'}</b><span class="cs-unit">BPM</span>
        <button class="cs-b" id="sTempoUp" aria-label="${t('loop.faster')}">+</button>
      </div>
    </div>${capo && shapesKey ? `<p class="cs-note">${esc(t('capo.shapesShort', { k: dn(shapesKey) }))}</p>` : ''}`;
    if (!Number(stored.bpm)) songBpm().then((b) => { if ($('sTempo')) $('sTempo').textContent = b; drawChips(); });
    syncEasyTop();
    drawChips();
    if (sheetRefresh) sheetRefresh();
  };
  // v1.88: jedan red sa vrednostima (Ton · Kapo · BPM · ritam · ⚙); dodir otvara „Podešavanja pesme“
  const drawChips = () => {
    const el = $('sChips'); if (!el) return;
    const key = soundingKey();
    const bpm = Number(stored.bpm) || Number($('sTempo')?.textContent) || 0;
    const rh = stored.strum ? patternName(stored.strum) : '';
    const paOn = !!$('paBtn') && !$('paBtn').classList.contains('off'); // v2.0.1: „Uz video“ vidljivo na telefonu (prvi čip)
    el.innerHTML = `${$('paBtn') ? `<button class="sc-chip sc-pa${paOn ? ' on' : ''}" data-pa="1" aria-label="${esc(t(paOn ? 'pa.start' : 'pa.link'))}">${YT_ICON}<span>${esc(t(paOn ? 'pa.btn' : 'pa.chipLink'))}</span></button>` : ''}<button class="sc-chip" data-sheet="key"><small>${t('ctl.keyShort')}</small><b>${esc(dn(key) || '–')}</b>${tp ? `<small>${tp > 0 ? '+' + tp : '−' + Math.abs(tp)}</small>` : ''}</button>
      <button class="sc-chip" data-sheet="capo"><small>${t('ctl.capoShort')}</small>${capo ? `<b>${capo}</b>` : esc(t('capo.none'))}</button>
      ${bpm ? `<button class="sc-chip" data-sheet="tempo">${bpm} <small>BPM</small></button>` : ''}
      ${rh ? `<button class="sc-chip sc-rh" data-sheet="rhythm">♪ ${esc(rh)}</button>` : sugStrum() ? `<button class="sc-chip sc-rh sc-new" data-sheet="rhythm">♪ ${esc(t('ss.rhythmQ'))}</button>` : ''}
      <button class="sc-chip sc-set" data-sheet="all" aria-label="${esc(t('ss.title'))}" title="${esc(t('ss.title'))}">${SET_ICON}</button>`;
    fitChips();
  };
  // v2.1: red uvek staje u jedan red (bez odsečenih čipova): ako ne staje — prvo se skloni ritam (vidi se strelicama
  // iznad svakog dela, a menja se u ⚙), pa „Uz video“ ostaje samo ikonica, pa uži čipovi. ⚙ je uvek vidljiv.
  const fitChips = () => {
    const el = $('sChips'); if (!el || !el.isConnected) return;
    if (!el.clientWidth) { requestAnimationFrame(() => { if (el.isConnected && el.clientWidth) fitChips(); }); return; } // red još nije prikazan
    el.classList.remove('fit1', 'fit2', 'fit3');
    const over = () => el.scrollWidth > el.clientWidth + 1 || [...el.children].some((c) => c.offsetWidth && c.scrollWidth > c.clientWidth + 1); // i čip koji se skratio („♪ P…“)
    for (const c of ['fit1', 'fit2', 'fit3']) { if (!over()) break; el.classList.add(c); }
  };
  curFitChips = fitChips; // jedan zajednički osluškivač veličine ekrana (bez novog po pesmi — memorija ostaje ista)
  if (!fitResizeOn) { fitResizeOn = true; let tm = 0; window.addEventListener('resize', () => { clearTimeout(tm); tm = setTimeout(() => curFitChips?.(), 120); }); window.addEventListener('hashchange', () => { curFitChips = null; }); } // stara pesma se ne drži u memoriji
  // predlog ritma (ako ga ima i nije odbijen)
  const sugStrum = () => (strumOn && !stored.recording && !hasStrum() && !(stored.skipped && stored.skipped.strum) && stored.suggestStrum ? patternById(stored.suggestStrum.id) : null);
  let sheetRefresh = null;
  // „Podešavanja pesme“: ista dugmad kao u traci (ton, kapodaster, tempo), plus ritam, veličina teksta, „Uz video“ i vežbanje
  function openSongSheet() {
    if (sheetRefresh) return;
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop sheet-backdrop ss-backdrop';
    wrap.innerHTML = `<div class="sheet song-sheet" role="dialog" aria-modal="true" aria-label="${esc(t('ss.title'))}"><div class="sheet-grip"></div>
      <h2 class="sheet-title">${t('ss.title')}</h2><div class="ss-rows"></div></div>`;
    const rows = wrap.querySelector('.ss-rows');
    const step = (id, v, dn_, up, lab) => `<span class="ss-st"><button class="ss-b" data-ss="${dn_}" aria-label="${esc(lab)} −">−</button><b id="${id}">${v}</b><button class="ss-b" data-ss="${up}" aria-label="${esc(lab)} +">+</button></span>`;
    const go = (txt, a, cls = '') => `<button class="ss-go${cls}" data-ss="${a}">${txt} <span aria-hidden="true">›</span></button>`;
    const render = () => {
      const key = soundingKey(), shapesKey = capo ? keyAt(tp - capo) : '';
      const ss = sugStrum();
      const pa_ = $('paBtn');
      const sp = root.querySelector('.sp-line');
      rows.innerHTML = `
        <div class="ss-r"><span class="ss-l">${t('ss.key')}${tp ? ` <button class="ss-reset" data-ss="t0">↺ ${esc(t('ss.original'))}</button>` : ''}</span>
          <span class="ss-st"><button class="ss-b" data-ss="t-" aria-label="${esc(t('song.transposeDown'))}">−</button><button class="ss-v" data-ss="wheel" aria-label="${esc(t('kw.open', { k: dn(key) || '?' }))}">${esc(dn(key) || '–')}</button><button class="ss-b" data-ss="t+" aria-label="${esc(t('song.transposeUp'))}">+</button></span></div>
        <div class="ss-r"><span class="ss-l">${t('ss.capo')}${capo && shapesKey ? `<small>${esc(t('capo.shapesShort', { k: dn(shapesKey) }))}</small>` : ''}</span>${step('ssCapo', capo || esc(t('capo.none')), 'c-', 'c+', t('ss.capo'))}</div>
        ${!stored.recording ? `<div class="ss-r"><span class="ss-l">${t('sug.easyBtn')}<small>${esc(easyActive() ? t('ss.easyOn', { n: capo }) : t('song.easySub'))}</small></span><button class="ss-tog${easyActive() ? ' on' : ''}" data-ss="easy" role="switch" aria-checked="${easyActive()}" aria-label="${esc(t('sug.easyBtn'))}"><i></i></button></div>` : ''}
        <div class="ss-r"><span class="ss-l">${t('ss.tempo')}</span>${step('ssBpm', (Number(stored.bpm) || Number($('sTempo')?.textContent) || '…') + ' <small>BPM</small>', 'b-', 'b+', t('ss.tempo'))}</div>
        <div class="ss-r"><span class="ss-l">${t('ss.rhythm')}${!stored.strum && ss ? `<small>${esc(t('ss.suggested'))}</small>` : ''}</span>
          ${stored.strum ? go(esc(patternName(stored.strum)), 'rh-edit')
            : ss ? `<span class="ss-sug"><b>${esc(patternName(ss))}</b><button class="icon-btn pat-play" data-ss="rh-play" aria-label="${t('pat.play')}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button><button class="sug-apply" data-ss="rh-apply">${t('sug.apply')}</button></span>`
            : go(esc(t('ss.add')), 'rh-edit')}</div>
        ${!stored.strum && ss ? `<div class="ss-pat" id="ssPat">${patternHTML(ss, { compact: true })}</div>` : ''}
        <div class="ss-r"><span class="ss-l">${t('ss.size')}</span>${step('ssZoom', Math.round(zoom * 100) + '%', 'z-', 'z+', t('ss.size'))}</div>
        ${pa_ ? `<div class="ss-r"><span class="ss-l">${t('ss.video')}</span>${go(esc(t(pa_.classList.contains('off') ? 'ss.connect' : 'ss.start')), 'video', ' acc')}</div>` : ''}
        ${touchOk() ? `<div class="ss-r"><span class="ss-l">${t('ss.chords')}</span>${go(esc(t('ss.editChords')), 'chords', ' acc')}</div>` : ''}
        ${sp ? `<div class="ss-r"><span class="ss-l">${t('ss.practice')}</span>${go(esc(t('ss.parts')), 'practice', ' acc')}</div>` : ''}`;
    };
    const close = () => { stopStrum(); wrap.remove(); sheetRefresh = null; drawChips(); };
    wrap.__close = close;
    sheetRefresh = render;
    wrap.addEventListener('click', async (e) => {
      if (!e.target.closest('.sheet')) return close();
      const b = e.target.closest('[data-ss]'); if (!b) return;
      const a = b.dataset.ss;
      if (a === 't-') await setT(tp - 1);
      else if (a === 't+') await setT(tp + 1);
      else if (a === 't0') await setT(0);
      else if (a === 'c-') await setCapo(capo - 1);
      else if (a === 'c+') await setCapo(capo + 1);
      else if (a === 'easy') { await toggleEasy(); syncEasyTop(); }
      else if (a === 'b-') await setBpm(-5);
      else if (a === 'b+') await setBpm(5);
      else if (a === 'z-' || a === 'z+') { const z = Math.min(1.8, Math.max(0.8, Math.round((zoom + (a === 'z+' ? 0.1 : -0.1)) * 10) / 10)); if (z !== zoom) { await setZoom(z); await saveZoom(); } }
      else if (a === 'wheel') { close(); return openWheel(false); }
      else if (a === 'rh-edit') { close(); return editStrum(); }
      else if (a === 'rh-play') return playPattern(sugStrum(), '#ssPat');
      else if (a === 'rh-apply') { stopStrum(); const p = sugStrum(); if (p) stored.strum = { id: p.id, sig: p.sig, steps: p.steps, ...(p.swing ? { swing: true } : {}) }; await save(); draw(); }
      else if (a === 'video') { close(); return $('paBtn')?.click(); }
      else if (a === 'practice') { close(); return root.querySelector('.sp-line')?.click(); }
      else if (a === 'chords') { close(); return editChords(); }
      if (sheetRefresh) render();
    });
    render();
    document.body.appendChild(wrap);
  }
  // „Detalji“: ritam, akordi po delovima, dijagrami, YouTube. Crta se tek kada je otvoren.
  let detDirty = true;
  const drawDetails = () => {
    const song = shapesSong();
    const chords = songChords(song);
    $('sDetSub').textContent = [stored.strum ? patternName(stored.strum) : '', chords.length ? chords.slice(0, 6).map((c) => dn(c)).join(' ') + (chords.length > 6 ? ' …' : '') : ''].filter(Boolean).join(' · ');
    if (!$('sDet').open) { detDirty = true; return; }
    detDirty = false;
    const prog = progressionSummary(song);
    $('sDetBody').innerHTML = `
      <div class="det-sec strum-box">
        ${stored.strum ? `<div class="strum-head"><span class="small muted">${t('strum.label')}</span> <b>${esc(patternName(stored.strum))}</b> <span class="small muted">${stored.strum.sig}</span>
          <button class="icon-btn pat-play" id="sStrumPlay" aria-label="${t('pat.play')}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button></div>
          ${patternHTML(stored.strum)}` : ''}
        <button class="btn small" id="sStrumEdit">${stored.strum ? t('strum.change') : t('strum.add')}</button>
        ${secStrumHTML()}
      </div>
      ${prog.length ? `<div class="det-sec prog">${prog.map((p) => `<div class="prog-row"><span class="prog-name">${esc(p.name ? sectionLabel(p.name) : t('song.chordsFallback'))}</span><span class="prog-chords">${p.chords.map((c) => `<button class="ch" data-chord="${esc(c)}">${esc(dn(c))}</button>`).join('<span class="arrow">→</span>')}</span></div>`).join('')}</div>` : ''}
      ${chords.length ? `<div class="diagram-row" aria-label="${t('song.diagrams')}">${chords.map((c) => `<button class="diagram-btn" data-chord="${esc(c)}" aria-label="${esc(t('song.enlarge', { name: dn(c) }))}">${chordSVG(c, { voicing: (stored.shapes || {})[c] || 0 })}</button>`).join('')}</div>` : ''}
`;
  };
  // v1.68 (računar): dve kolone kad ima mesta (dugme ▥ uključuje/isključuje, pamti se); dijagrami akorda u koloni desno
  const setCols = (w) => {
    const l = $('sLyrics'), b = $('sCols');
    const fits = w >= COLS_MIN && !stored.recording && !(stored.type === 'tab');
    const on = fits && colsPref();
    l.classList.toggle('cols2', on);
    if (b) { b.hidden = !fits; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  };
  const drawDiagCol = () => {
    const col = $('sDiagCol'); if (!col) return;
    const chords = songChords(shapesSong());
    col.innerHTML = chords.map((c) => `<button class="diagram-btn" data-chord="${esc(c)}" aria-label="${esc(t('song.enlarge', { name: dn(c) }))}">${chordSVG(c, { voicing: (stored.shapes || {})[c] || 0 })}</button>`).join('');
  };
  const drawLyrics = () => {
    const l = $('sLyrics');
    // Širina teksta: zapamćena za ovu veličinu ekrana (bez merenja); ako se razlikuje, ResizeObserver ispravi
    l.style.setProperty('--zoom', zoom);
    setCols(lyrW.get(lyrWKey()) || l.clientWidth);
    drawDiagCol();
    const pre = lyricsMetrics(l, lyrW.get(lyrWKey()));
    l.innerHTML = renderSectionsHTML(shapesSong().sections, unc(), { edit: !stored.recording, songStrum: stored.strum || null });
    addLoopButtons();
    fitAndTabs(pre);
  };
  // Sve odjednom (otvaranje pesme, odgovor na pitanje, izmena ritma…)
  const draw = () => { drawHead(); drawAsk(); drawSuggest(); drawControls(); drawDetails(); drawLyrics(); };
  // Tonalitet/kapodaster: samo kontrole, predlozi, detalji i akordi u tekstu
  const drawKeyChange = () => { closePlayer(); drawControls(); drawSuggest(); drawDetails(); drawLyrics(); };
  // „Detalji“: zatvoreni posle prvog pregleda pesme; pamti se poslednji izbor
  // tekst pesme je prvi: „Detalji“ zatvoreni, osim ako ih je korisnik sam ostavio otvorene
  // „Akordi i ritam“ (nekadašnji „Detalji“): otvara se iz „⋯“ kao panel; crta se tek kada se otvori
  $('sDet').open = false;
  $('sDet').addEventListener('toggle', () => { if ($('sDet').open && detDirty) drawDetails(); });
  if (!stored.seen) { stored.seen = true; db.put(stored).catch(() => {}); }
  // Prilagodi veličinu slova širini ekrana (pa tek onda rasporedi tablature)
  function fitAndTabs(pre = null) {
    const l = root.querySelector('.lyrics');
    if (!l) return;
    if (pre) roW = pre.avail;
    const shrunk = fitLyrics(l, 13, pre);
    layoutTabs(l);
    fitShrunk = shrunk;
    syncAa();
  }
  let fitShrunk = false;
  let roW = 0; // širina teksta pri poslednjem prilagođavanju (promena veličine ekrana → ponovo)
  function syncAa() {
    if (!$('sAaRange')) return;
    $('sAaRange').value = Math.round(zoom * 100);
    $('sAaVal').textContent = Math.round(zoom * 100) + '%';
    $('sAaNote').hidden = !fitShrunk;
  }

  // ---- Predlozi (nesigurna mesta, lakša verzija, ritam) ----
  const unc = () => cleanUncertain(stored.uncertain, stored.sections);
  const hasStrum = () => !!stored.strum || stored.sections.some((x) => x.strum);
  let strumLoading = false;
  let uncHidden = false; // „✕“ na nesigurnim mestima: sakrij do sledećeg otvaranja pesme
  function suggestHTML() {
    const items = [];
    const u = unc();
    if (u.length && !uncHidden) {
      items.push({ x: 'unc-hide', html: `<div class="sug-title">${t('sug.unsureTitleN', { n: u.length })}</div><p class="small muted">${t('sug.unsureHint')}</p>
        ${u.slice(0, 6).map((x, i) => `<div class="sug-item"><span class="sug-what"><span class="unsure-sample">${esc(x.text)}</span> → <b>${esc(x.suggestion)}</b></span>
          <button class="btn small" data-unc-skip="${i}">${t('sug.keep')}</button><button class="btn small primary" data-unc-apply="${i}">${esc(t('sug.changeTo', { x: x.suggestion }))}</button></div>`).join('')}` });
    }
    // lakša verzija (kapodaster): samo dugme „Lakša verzija“ gore — kartica je bila dupliran predlog iznad teksta
    if (strumOn && !stored.recording && !hasStrum() && !(stored.skipped && stored.skipped.strum)) { // snimci iz „Samo sviraj“: bez predloga ritma
      const ss = stored.suggestStrum && patternById(stored.suggestStrum.id);
      if (ss) items.push({ x: 'strum-skip', mini: ss, html: `<div class="sug-title">${t('sug.strumTitle')}: ${esc(patternName(ss))} <span class="small muted">${ss.sig}</span>
          <button class="icon-btn pat-play" data-sug="strum-play" aria-label="${t('pat.play')}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button></div>
        ${patternHTML(ss, { compact: true })}
        ${stored.suggestStrum.reason ? `<p class="small muted">${esc(stored.suggestStrum.reason)}</p>` : ''}
        <div class="sug-actions"><button class="btn small primary" data-sug="strum-apply">${t('sug.apply')}</button></div>` });
    }
    if (!items.length) return '';
    // Samo jedan predlog odjednom; ✕ ga odbacuje i prikazuje sledeći
    const it = items[0];
    if (it.mini) {
      // Predlog ritma: jedan red (naziv, ▶, Primeni, ✕) — tekst pesme ostaje na prvom ekranu; obrazac i obrazloženje na dodir
      const ss = it.mini;
      const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>';
      // v1.62: tanak red — RITAM naziv ▶ Primeni ✕ (obrazac i obrazloženje na dodir naziva)
      return `<div class="sug-card sug-mini sug-slim"><div class="sug-mini-row">
        <button class="sug-mini-main" data-sug="strum-more" aria-expanded="false"><span class="sug-mini-k">${t('sug.strumShort')}</span><b>${esc(patternName(ss))}</b></button>
        <button class="icon-btn pat-play" data-sug="strum-play" aria-label="${t('pat.play')}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
        <button class="sug-apply" data-sug="strum-apply">${t('sug.apply')}</button>
        <button class="icon-btn sug-x" data-sug="strum-skip" aria-label="${t('sug.dismiss')}" title="${t('sug.dismiss')}">${X}</button></div>
        <div class="sug-mini-body" hidden>${patternHTML(ss, { compact: true })}${stored.suggestStrum.reason ? `<p class="small muted">${esc(stored.suggestStrum.reason)}</p>` : ''}</div></div>`;
    }
    return `<div class="card sug-card"><div class="sug-head"><span>${t('sug.title')}${items.length > 1 ? ` <span class="muted">1/${items.length}</span>` : ''}</span>
      <button class="icon-btn sug-x" data-sug="${it.x}" aria-label="${t('sug.dismiss')}" title="${t('sug.dismiss')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button></div>
      <div class="sug-group">${it.html}</div></div>`;
  }
  const drawSuggest = () => { const el = $('sSuggest'); if (el) el.innerHTML = suggestHTML(); drawChips(); };

  async function loadStrumSuggestion() {
    if (stored.recording || hasStrum() || stored.suggestStrum || (stored.skipped && stored.skipped.strum) || strumLoading) return;
    strumOn = (await settings.get('strumSuggest', true)) !== false; // Podešavanja → Pesme → „Predlaži ritam“ (isključeno: ni Gemini se ne pita)
    if (!strumOn) { drawSuggest(); return; }
    strumLoading = true;
    drawSuggest();
    let res = null;
    const lang = getLang();
    if (navigator.onLine !== false && (await settings.get('geminiKey', ''))) {
      try {
        const { suggestStrumAI } = await import('./gemini.js'); // Gemini se učitava samo kad ima ključa
        res = await suggestStrumAI(stored, PATTERNS.map((p) => ({ id: p.id, sig: p.sig, steps: p.steps, name: patternName(p) })), lang);
      } catch { res = null; }
    }
    if (!res) { const l = localStrum(stored); res = { id: l.id, reason: t(l.reasonKey) }; }
    strumLoading = false;
    stored.suggestStrum = { ...res, lang };
    await save();
    drawSuggest();
  }

  async function resolveUncertain(i, apply) {
    const list = unc();
    const u = list[i];
    if (!u) return;
    if (apply) {
      applyUncertain(stored, u);
      // ponovo pročitaj akorde (ispravljeni akord je zapisan kao na papiru)
      if (stored.cv >= CV) stored = upgradeSong(stored, { naming: stored.naming || 'en', keyN: stored.keyN || undefined });
    }
    stored.uncertain = list.filter((x, k) => k !== i);
    if (!stored.uncertain.length) delete stored.uncertain;
    await save();
    draw();
  }

  async function askUncertain(i) {
    const u = unc()[i];
    if (!u) return;
    const r = await dialog({
      title: t('sug.unsureTitle'),
      body: t(u.kind === 'chord' ? 'sug.unsureChord' : u.kind === 'fret' ? 'sug.unsureFret' : 'sug.unsureWord', { text: u.text, x: u.suggestion, s: STRING_NAMES[(u.string || 1) - 1] }),
      buttons: [{ label: t('sug.keep'), value: 'keep' }, { label: t('sug.changeTo', { x: u.suggestion }), value: 'apply', kind: 'primary' }],
    });
    if (r) await resolveUncertain(i, r === 'apply');
  }

  // ---- YouTube ----
  async function editYt(kind) {
    const cur = (stored.yt && stored.yt[kind]) || '';
    const p = dialog({
      title: t(kind === 'listen' ? 'yt.saveListen' : 'yt.saveTutorial'),
      html: true,
      body: `<p class="small muted">${t('yt.saveHint')}</p><input id="ytInput" type="url" inputmode="url" placeholder="https://youtu.be/…" value="${esc(cur)}" autocomplete="off">`,
      buttons: [...(cur ? [{ label: t('yt.remove'), value: 'remove', kind: 'danger' }] : []), { label: t('common.cancel'), value: null }, { label: t('common.save'), value: 'save', kind: 'primary' }],
    });
    const modal = [...document.querySelectorAll('.modal-backdrop')].pop();
    let val = cur;
    modal.querySelector('#ytInput').addEventListener('input', (e) => (val = e.target.value));
    const r = await p;
    if (r === 'remove') {
      delete stored.yt[kind];
      if (!Object.keys(stored.yt).length) delete stored.yt;
      toast(t('yt.removed'));
    } else if (r === 'save') {
      const u = cleanYoutubeUrl(val);
      if (!u) { toast(t('yt.bad'), 'error'); return; }
      stored.yt = { ...(stored.yt || {}), [kind]: u };
      toast(t('yt.saved'));
    } else return;
    await save();
    draw();
  }

  const save = () => db.put(stored);
  // Točak tonaliteta. pickBase = biranje OSNOVNOG tonaliteta pesme (kada aplikacija nije bila sigurna)
  function openWheel(pickBase) {
    if (pickBase) {
      const base = stored.keyN || { root: 0, minor: false };
      openKeyWheel({ song: { ...stored, keyN: base }, tp: 0, capo: 0, onPick: (o) => { answerKey({ root: (base.root + o + 120) % 12, minor: base.minor }); } });
      return;
    }
    openKeyWheel({ song: stored, tp, capo, onPick: (o, c) => { setT(o); if (c !== undefined && c !== capo) setCapo(c); } });
  }
  draw();
  loadStrumSuggestion();
  const setT = async (n) => { tp = ((n + 17) % 12 + 12) % 12 - 5; stored.transpose = tp; drawKeyChange(); await save(); };
  const setCapo = async (n) => {
    capo = Math.max(0, Math.min(7, n));
    if (capo) stored.capo = capo; else delete stored.capo;
    drawKeyChange();
    await save();
  };

  // ---- Ritam (strumming) ----
  let strumMet = null;
  const stopStrum = () => { strumMet?.stop(); strumMet = null; allowSleep('strum'); root.querySelectorAll('.pstep.now').forEach((x) => x.classList.remove('now')); $('sStrumPlay')?.classList.remove('playing'); };
  const playStrum = () => playPattern(stored.strum, '.strum-box');
  const playPattern = (pattern, scope) => {
    if (strumMet) return stopStrum();
    if (!pattern) return;
    strumMet = new Metronome();
    strumMet.pattern = pattern;
    strumMet.sig = pattern.sig;
    // pregled ritma: dva takta (8 udaraca u 4/4), pa sam stane
    strumMet.maxBars = 2;
    const me = strumMet;
    strumMet.onEnd = () => { if (strumMet === me) stopStrum(); };
    keepAwake('strum');
    songBpm().then((b) => { if (!strumMet) return; strumMet.bpm = b; strumMet.start(); });
    $('sStrumPlay')?.classList.add('playing');
    strumMet.onStep = (i) => root.querySelectorAll(scope + ' .pstep').forEach((s) => s.classList.toggle('now', +s.dataset.i === i));
  };
  // Ritam po delovima: čip uz svaki deo („kao cela pesma“ ili svoj ritam); dodir → izbor samo za taj deo
  function secStrumHTML() {
    const secs = stored.sections.map((x, i) => ({ x, i })).filter(({ x }) => x.lines.length || (x.tabs || []).length);
    if (secs.length < 2) return '';
    const any = secs.some(({ x }) => x.strum);
    return `<details class="sec-strum"${any ? ' open' : ''}><summary>${t('strum.bySection')}</summary>
      ${secs.map(({ x, i }) => `<div class="sec-strum-row"><span>${esc(x.name ? sectionLabel(x.name) : t('strum.section', { n: i + 1 }))}</span>
        <button class="rp-chip${x.strum ? ' on' : ''}" data-secstrum="${i}">${x.strum ? esc(patternName(x.strum)) : t('rp.inherit')}</button></div>`).join('')}</details>`;
  }
  async function editStrum(target = 'song') {
    stopStrum();
    const sec = target === 'song' ? null : stored.sections[+target];
    if (target !== 'song' && !sec) return;
    const cur = sec ? sec.strum : stored.strum;
    const title = sec ? t('strum.forSection', { name: sec.name ? sectionLabel(sec.name) : t('strum.section', { n: +target + 1 }) }) : t('strum.title');
    const { openRhythmPicker } = await import('./rhythmPicker.js');
    const r = await openRhythmPicker({ current: cur || null, title, inherit: !!sec, bpm: await songBpm() });
    if (!r) return;
    const obj = sec || stored;
    if (r.pattern) obj.strum = { ...(r.pattern.id ? { id: r.pattern.id } : {}), ...(r.pattern.name && !r.pattern.id ? { name: r.pattern.name } : {}), sig: r.pattern.sig, steps: r.pattern.steps, ...(r.pattern.swing ? { swing: true } : {}) };
    else delete obj.strum; // „Bez ritma“ / „Kao cela pesma“
    await save();
    draw();
  }

  /** v1.67: dodir na ritam uz deo. Svoj ritam → izbor za taj deo; ritam cele pesme → „samo ovaj deo“ ili „cela pesma“. */
  async function strumTap(btn) {
    const v = btn.dataset.strumedit;
    if (v === 'song' || !btn.dataset.inherited) return editStrum(v);
    const name = (() => { const x = stored.sections[+v]; return x && x.name ? sectionLabel(x.name) : t('strum.section', { n: +v + 1 }); })();
    const c = await moreMenu(null, [
      { value: 'part', label: t('strum.onlyPart', { name }), sub: t('strum.onlyPartSub'), icon: 'edit' },
      { value: 'song', label: t('strum.wholeSong'), sub: stored.strum ? t('strum.wholeSongSub', { name: patternName(stored.strum) }) : t('strum.wholeSongNew'), icon: 'details' },
    ]);
    if (c === 'part') editStrum(v); else if (c === 'song') editStrum('song');
  }

  // ---- Automatsko skrolovanje ----
  let scrolling = false, raf = 0, last = 0, carry = 0;
  const pxPerSec = () => 6 + speed * 7; // 1 → 13 px/s … 10 → 76 px/s
  function step(ts) {
    if (!scrolling) return;
    const dt = last ? (ts - last) / 1000 : 0;
    last = ts;
    carry += pxPerSec() * dt;
    const px = Math.floor(carry);
    if (px >= 1) { carry -= px; window.scrollBy(0, px); }
    const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (loopSec >= 0 && (atEnd || window.scrollY >= loopEndY())) { window.scrollTo(0, loopStartY()); carry = 0; }
    else if (atEnd) return stopScroll();
    raf = requestAnimationFrame(step);
  }
  // Dok pesma skroluje, donja traka se skoro sasvim povuče (dodir je vraća na par sekundi)
  let peekTimer = 0;
  const dimBar = (on) => { const bar = $('sScrollBar'); if (bar) { bar.classList.toggle('dim', on); bar.classList.remove('peek'); clearTimeout(peekTimer); } };
  $('sScrollBar').addEventListener('pointerdown', () => {
    const bar = $('sScrollBar');
    if (!bar.classList.contains('dim')) return;
    bar.classList.add('peek');
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => bar.classList.remove('peek'), 3500);
  });
  let autoOpened = false; // traka je bila skupljena: otvara se dok se lista, posle se opet skupi
  function startScroll() {
    scrolling = true; last = 0; carry = 0;
    const sb = $('sScrollBar'); if (sb && sb.classList.contains('collapsed')) { sb.classList.remove('collapsed'); autoOpened = true; }
    dimBar(true);
    $('sPlay').classList.add('playing');
    $('sPlay').innerHTML = sPlayHTML(true);
    $('sScrollBar')?.classList.add('scrolling');
    $('sPlay').setAttribute('aria-label', t('scroll.pause'));
    keepAwake('autoscroll');
    raf = requestAnimationFrame(step);
  }
  function stopScroll() {
    if (!scrolling) return;
    scrolling = false;
    dimBar(false);
    if (autoOpened) { $('sScrollBar')?.classList.add('collapsed'); autoOpened = false; }
    cancelAnimationFrame(raf);
    allowSleep('autoscroll');
    const b = $('sPlay');
    if (!b) return;
    b.classList.remove('playing');
    b.innerHTML = sPlayHTML(false);
    $('sScrollBar')?.classList.remove('scrolling');
    b.setAttribute('aria-label', t('scroll.play'));
  }
  $('sPlay').addEventListener('click', (e) => {
    e.stopPropagation();
    if (scrolling) { stopScroll(); loopMet?.stop(); }
    else { startScroll(); if (loopSec >= 0) loopMet?.start(); }
  });

  // ---- Vežbanje dela pesme: ponavljaj jednu sekciju (auto-skrol + metronom) ----
  function secEls() { return $('sLyrics') ? [...$('sLyrics').querySelectorAll(':scope > .sec')] : []; }
  function topOffset() { return (root.querySelector('.topbar')?.offsetHeight || 0) + 8; }
  function loopStartY() { const el = secEls()[loopSec]; return el ? Math.max(0, el.getBoundingClientRect().top + window.scrollY - topOffset()) : 0; }
  function loopEndY() { const el = secEls()[loopSec]; if (!el) return Infinity; const h = el.offsetHeight; return loopStartY() + Math.max(h * 0.6, h - window.innerHeight * 0.35); }
  function addLoopButtons() {
    secEls().forEach((el, i) => {
      const sec = stored.sections[i];
      if (!sec || (!sec.lines.length && !(sec.tabs || []).length)) return;
      let head = el.querySelector(':scope > .sec-head');
      if (!head) { head = document.createElement('div'); head.className = 'sec-head'; el.prepend(head); }
      const name = sec.name ? sectionLabel(sec.name) : t('strum.section', { n: i + 1 });
      head.insertAdjacentHTML('beforeend', `<button class="icon-btn loop-btn${i === loopSec ? ' on' : ''}" data-loop="${i}" aria-pressed="${i === loopSec}" aria-label="${esc(t('loop.start', { name }))}" title="${esc(t('loop.start', { name }))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z"/></svg></button>`);
      el.classList.toggle('looping', i === loopSec);
    });
  }
  async function startLoop(i) {
    stopStrum();
    loopMet?.stop();
    loopSec = i;
    const sec = stored.sections[i];
    $('sLoopName').textContent = sec.name ? sectionLabel(sec.name) : t('strum.section', { n: i + 1 });
    $('sLoopRow').hidden = false;
    setCollapsed(false);
    loopBpm = await songBpm();
    $('sBpm').textContent = loopBpm + ' BPM';
    secEls().forEach((el, k) => { el.classList.toggle('looping', k === i); const b = el.querySelector('.loop-btn'); if (b) { b.classList.toggle('on', k === i); b.setAttribute('aria-pressed', String(k === i)); } });
    window.scrollTo(0, loopStartY());
    loopMet = new Metronome();
    const pat = sec.strum || stored.strum;
    if (pat) { loopMet.pattern = pat; loopMet.sig = pat.sig; }
    loopMet.bpm = loopBpm;
    loopMet.start();
    if (!scrolling) startScroll();
  }
  function stopLoop() {
    loopMet?.stop(); loopMet = null;
    if (loopSec < 0) return;
    loopSec = -1;
    $('sLoopRow').hidden = true;
    secEls().forEach((el) => { el.classList.remove('looping'); const b = el.querySelector('.loop-btn'); if (b) { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); } });
    stopScroll();
  }
  // Promena tempa (traka za vežbanje ili kutija „Ritam“) se čuva uz pesmu
  const setBpm = async (d) => {
    const b = Math.max(40, Math.min(220, (loopSec >= 0 ? loopBpm : await songBpm()) + d));
    loopBpm = b;
    stored.bpm = b;
    if ($('sBpm')) $('sBpm').textContent = b + ' BPM';
    if ($('sTempo')) $('sTempo').textContent = b;
    if (loopMet) loopMet.bpm = b;
    if (strumMet) strumMet.bpm = b;
    drawChips();
    await save();
  };
  $('sBpmDown').addEventListener('click', (e) => { e.stopPropagation(); setBpm(-5); });
  $('sBpmUp').addEventListener('click', (e) => { e.stopPropagation(); setBpm(5); });
  $('sLoopStop').addEventListener('click', (e) => { e.stopPropagation(); stopLoop(); });
  $('sBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-loop]');
    if (!b) return;
    e.stopPropagation();
    const i = +b.dataset.loop;
    if (i === loopSec) stopLoop(); else startLoop(i);
  });
  $('sSpeed').addEventListener('input', (e) => { speed = +e.target.value; });
  $('sSpeed').addEventListener('change', async () => { stored.scrollSpeed = speed; await save(); });
  // Dodir bilo gde na tekstu pauzira skrolovanje
  $('sBody').addEventListener('pointerdown', () => { stopScroll(); loopMet?.stop(); });
  // ---- Tablature: reprodukcija u tempu metronoma, ističe svaku notu ----
  let stopTab = null, tabBtn = null;
  const endTab = () => {
    if (stopTab) stopTab();
    stopTab = null;
    allowSleep('tabplay');
    tabBtn?.classList.remove('playing');
    tabBtn = null;
    root.querySelectorAll('.tab-note.now').forEach((x) => x.classList.remove('now'));
  };
  async function toggleTab(btn) {
    const same = tabBtn === btn;
    endTab();
    if (same) return;
    const [si, ti] = btn.dataset.tabplay.split('-').map(Number);
    const tab = stored.sections[si] && stored.sections[si].tabs && stored.sections[si].tabs[ti];
    if (!tab) return;
    tabBtn = btn;
    btn.classList.add('playing');
    keepAwake('tabplay');
    const staff = btn.closest('.tab-block').querySelector('.tab-staff');
    const bpm = await songBpm();
    const a4 = Number(await settings.get('a4', 440)) || 440;
    stopTab = playTab(tab, {
      bpm, a4,
      onNote: (bi, ni) => {
        staff.querySelectorAll('.tab-note.now').forEach((x) => x.classList.remove('now'));
        staff.querySelector(`[data-note="${bi}-${ni}"]`)?.classList.add('now');
      },
      onEnd: endTab,
    });
  }
  const ro = new ResizeObserver(() => {
    const w = root.querySelector('.lyrics')?.clientWidth || 0;
    if (w) lyrW.set(lyrWKey(), w);
    if (w && w !== roW) { roW = w; setCols(w); fitAndTabs(lyricsMetrics(root.querySelector('.lyrics'), w)); }
  });
  ro.observe(root.querySelector('.song-view'));
  { const zw = root.querySelector('.song-view .zoom-wrap'), cb = $('sCols'); if (zw && cb) zw.prepend(cb); } // ▥ odmah levo od − 🔍 +
  $('sCols')?.addEventListener('click', () => { localStorageSet('gitara-cols', colsPref() ? '0' : '1'); const w = $('sLyrics').clientWidth; setCols(w); fitAndTabs(lyricsMetrics($('sLyrics'), w)); });
  // Ekran ostaje upaljen dok koristiš pesmu (Podešavanja → Ekran); ikonica u traci ga isključuje za ovu pesmu
  setWakeZone('song');
  const onHash = () => { stopLoop(); stopScroll(); stopStrum(); endTab(); ro.disconnect(); document.removeEventListener('pointerdown', outsideAa, true); window.removeEventListener('hashchange', onHash); };
  window.addEventListener('hashchange', onHash);

  function easyActive() { return !!stored.easyCapo && capo === stored.easyCapo; }
  function syncEasyTop() { const b = $('sEasyTop'); if (b) { b.classList.toggle('on', easyActive()); b.setAttribute('aria-pressed', String(easyActive())); } }
  // Traka za automatsko skrolovanje: može da se skupi na samo dugme za pokretanje
  const sbar = $('sScrollBar');
  const setCollapsed = (c, remember = true) => { sbar.classList.toggle('collapsed', c); if (remember) localStorageSet('gitara-scrollbar', c ? '1' : '0'); $('sCollapse').setAttribute('aria-label', t(c ? 'scroll.expand' : 'scroll.collapse')); };
  // v1.66: podrazumevano samo ▶ (ne pokriva kraj pesme); ▶ otvara i brzinu, posle zaustavljanja se opet skupi
  setCollapsed(localStorageGet('gitara-scrollbar') !== '0');
  $('sCollapse').addEventListener('click', (e) => { e.stopPropagation(); setCollapsed(!sbar.classList.contains('collapsed')); });
  const toggleEasy = async () => {
    if (easyActive()) { await setCapo(0); toast(t('sug.easyOff')); return; }
    const e = easiestCapo(stored, tp);
    if (!e) { toast(t('sug.alreadyEasiest')); return; }
    stored.easyCapo = e.capo;
    await setCapo(e.capo);
    toast(t('sug.easyText', { n: e.capo, shapes: e.shapes.map((x) => dn(x)).join(', ') }));
  };
  // ---- „Pusti“: pesma zvukom gitare (akordi po ritmu pesme, tonalitet, kapodaster); učitava se tek na dugme ----
  let playerUI = null, plTl = null, plCh = null, plLn = null;
  let plSung = [];
  function plMark(seg) {
    plCh?.classList.remove('playing'); plLn?.classList.remove('playing');
    plSung.forEach((x) => x.classList.remove('sung')); plSung = [];
    plCh = plLn = null;
    if (!seg) return;
    const sec = $('sLyrics').querySelectorAll(':scope > .sec')[seg.ref.si];
    plLn = sec ? sec.querySelectorAll(':scope > .ln')[seg.ref.li] : null;
    plCh = plLn ? plLn.querySelectorAll('.ch')[seg.ref.ci] : null;
    plLn?.classList.add('playing'); plCh?.classList.add('playing');
    // reči koje se pevaju uz ovaj akord: od njegovog dela reda do sledećeg akorda
    const segs = plLn ? [...plLn.querySelectorAll('.seg, .tx0')] : [], at = plCh ? segs.indexOf(plCh.closest('.seg')) : -1;
    if (at >= 0) for (let i = at; i < segs.length && (i === at || !segs[i].querySelector('.ch')); i++) { segs[i].classList.add('sung'); plSung.push(segs[i]); }
  }
  // v1.88: dok svira — mali plejer iznad donje trake (deo pesme, vreme, tanka linija napretka, ❚❚, ✕);
  // dodir na naziv otvara tempo i izbor dela (ista traka „Pusti“ kao ranije)
  let mini = null;
  function closePlayer() {
    if (!playerUI) return;
    playerUI.destroy(); playerUI = null; plMark(null); allowSleep('songplay');
    mini?.remove(); mini = null;
    root.querySelector('.song-view')?.classList.remove('pl-open');
  }
  const fmtT = (sec) => { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
  async function openPlayer() {
    if (playerUI) return playerUI;
    const [sp, pl] = await Promise.all([import('./songPlay.js'), import('./songPlayer.js')]);
    plTl = sp.chordTimeline(stored, { tp, capo });
    if (!plTl.events.length) { toast(t('pr.pesma.noChords'), 'error'); return null; }
    stopScroll();
    const bpm = await songBpm();
    const partName = (p) => (p && p.name ? sectionLabel(p.name) : t('song.chordsFallback'));
    mini = document.createElement('div');
    mini.className = 'mini-pl';
    mini.id = 'sMini';
    mini.innerHTML = `<div class="mp-more" hidden></div><div class="mp-row">
      <button class="mp-info" aria-expanded="false" title="${esc(t('mini.more'))}"><b class="mp-part">♪ ${esc(partName(plTl.parts[0]))}</b><small class="mp-time">0:00 / ${fmtT(plTl.total * 60 / bpm)} · ${bpm} BPM</small></button>
      <span class="mp-pr" aria-hidden="true"><i></i></span>
      <button class="mp-pp" aria-label="${esc(t('play.play'))}"></button>
      <button class="mp-x" aria-label="${esc(t('common.close'))}" title="${esc(t('common.close'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button></div>`;
    root.querySelector('.song-view').appendChild(mini);
    root.querySelector('.song-view').classList.add('pl-open');
    const q = (x) => mini.querySelector(x);
    const PP = { on: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>', off: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' };
    const rate = () => (+(q('.pl-rate')?.value) || 100) / 100;
    let lastSeg = -1, lastPart = null;
    const showAt = (b) => {
      q('.mp-pr i').style.width = Math.min(100, (b / (plTl.total || 1)) * 100).toFixed(1) + '%';
      const k = 60 / bpm / rate();
      q('.mp-time').textContent = `${fmtT(b * k)} / ${fmtT(plTl.total * k)} · ${Math.round(bpm * rate())} BPM`;
      const part = plTl.parts.find((p) => b >= p.from && b < p.to) || null;
      if (part !== lastPart) { lastPart = part; q('.mp-part').textContent = '♪ ' + partName(part || plTl.parts[0]); }
    };
    playerUI = pl.mountPlayerBar(q('.mp-more'), plTl, {
      bpm, partLabel: partName,
      onFrame: (b, si) => {
        showAt(b);
        if (si === lastSeg) return;
        lastSeg = si; plMark(plTl.segs[si]);
        if (plLn) { const d = plLn.getBoundingClientRect().top - window.innerHeight * 0.3; if (Math.abs(d) > 40) window.scrollBy({ top: d, behavior: 'smooth' }); }
      },
      onStop: () => { lastSeg = -1; },
      onSync: (on) => { const b = q('.mp-pp'); if (!b) return; b.innerHTML = on ? PP.on : PP.off; b.classList.toggle('on', on); b.setAttribute('aria-label', t(on ? 'play.pause' : 'play.play')); },
    });
    q('.mp-pp').addEventListener('click', () => q('.pl-play')?.click());
    q('.mp-x').addEventListener('click', closePlayer);
    q('.mp-info').addEventListener('click', () => { const m = q('.mp-more'); m.hidden = !m.hidden; q('.mp-info').setAttribute('aria-expanded', String(!m.hidden)); });
    keepAwake('songplay');
    return playerUI;
  }
  const listen = async () => { const u = await openPlayer(); if (u && !u.playing) u.startAt(0); };
  $('sListen').addEventListener('click', (e) => { e.stopPropagation(); listen(); });
  window.addEventListener('hashchange', function offPl() { closePlayer(); window.removeEventListener('hashchange', offPl); });
  /** Dok je „Pusti“ otvoren: dodir na red ili akord = sviranje odatle (inače akord otvara dijagram, kao i pre). */
  function seekFrom(target) {
    const ln = target.closest('.ln');
    if (!playerUI || !ln || !$('sLyrics').contains(ln)) return false;
    const sec = ln.closest('.sec'), si = [...$('sLyrics').querySelectorAll(':scope > .sec')].indexOf(sec);
    const li = [...sec.querySelectorAll(':scope > .ln')].indexOf(ln);
    const ch = target.closest('.ch'), ci = ch ? [...ln.querySelectorAll('.ch')].indexOf(ch) : -1;
    let k = plTl.segs.findIndex((x) => x.ref.si === si && x.ref.li === li && (ci < 0 || x.ref.ci === ci));
    if (k < 0) k = plTl.segs.findIndex((x) => x.ref.si > si || (x.ref.si === si && x.ref.li >= li));
    if (k < 0) return false;
    playerUI.startAt(plTl.segs[k].beat);
    return true;
  }
  root.querySelector('.song-view').addEventListener('click', (e) => {
    if (seekFrom(e.target)) return;
    const se = e.target.closest('[data-strumedit]');
    if (se) return strumTap(se);
    const tp_ = e.target.closest('[data-tabplay]');
    if (tp_) return toggleTab(tp_);
    const un = e.target.closest('[data-unsure]');
    if (un) { e.preventDefault(); return askUncertain(+un.dataset.unsure); }
    const ua = e.target.closest('[data-unc-apply]'), us = e.target.closest('[data-unc-skip]');
    if (ua) return resolveUncertain(+ua.dataset.uncApply, true);
    if (us) return resolveUncertain(+us.dataset.uncSkip, false);
    const yb = e.target.closest('[data-yt]');
    if (yb) return editYt(yb.dataset.yt);
    const sg = e.target.closest('[data-sug]');
    if (sg) {
      const a = sg.dataset.sug;
      stored.skipped = stored.skipped || {};
      if (a === 'unc-hide') { uncHidden = true; return drawSuggest(); }
      if (a === 'strum-skip') {
        stopStrum(); stored.skipped.strum = true;
        // odmah tu: „Ne predlaži više“ = isključi predloge ritma za sve pesme (vraća se u Podešavanjima → Pesme)
        toast(t('sug.strumHidden'), '', { label: t('sug.noMore'), onClick: async () => { await settings.set('strumSuggest', false); strumOn = false; toast(t('sug.noMoreDone')); } });
        return save().then(drawSuggest);
      }
      if (a === 'strum-apply') {
        stopStrum();
        const p = patternById(stored.suggestStrum && stored.suggestStrum.id);
        if (p) stored.strum = { id: p.id, sig: p.sig, steps: p.steps, ...(p.swing ? { swing: true } : {}) };
        return save().then(draw);
      }
      if (a === 'strum-more' || a === 'strum-play') {
        const body = $('sSuggest').querySelector('.sug-mini-body'), main = $('sSuggest').querySelector('.sug-mini-main');
        if (body) { const open = a === 'strum-play' ? true : body.hidden; body.hidden = !open; main.setAttribute('aria-expanded', String(open)); main.classList.toggle('open', open); }
        if (a === 'strum-more') return;
      }
      if (a === 'strum-play') return playPattern(patternById(stored.suggestStrum.id), '#sSuggest');
    }
    const c = e.target.closest('[data-chord]');
    if (c) {
      // Izabrani hvat se pamti uz pesmu i koristi u dijagramima „Detalja“
      const name = c.dataset.chord;
      return showChord(name, { voicing: (stored.shapes || {})[name] || 0, onPick: (i) => {
        const sh = { ...(stored.shapes || {}) };
        if (i) sh[name] = i; else delete sh[name];
        stored.shapes = sh;
        save().then(() => { detDirty = true; if ($('sDet').open) drawDetails(); });
      } });
    }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.ask) return answerNaming(b.dataset.ask);
    if (b.dataset.askkey !== undefined) {
      if (b.dataset.askkey === 'wheel') return openWheel(true);
      return answerKey(stored.keyAlt[+b.dataset.askkey]);
    }
    if (b.id === 'kOpen') return openWheel(false);
    if (b.id === 'tUp') setT(tp + 1);
    else if (b.id === 'tDown') setT(tp - 1);
    else if (b.id === 'tReset') setT(0);
    else if (b.id === 'cUp') setCapo(capo + 1);
    else if (b.id === 'cDown') setCapo(capo - 1);
    else if (b.id === 'sStrumPlay') playStrum();
    else if (b.id === 'sStrumEdit') editStrum();
    else if (b.dataset.secstrum !== undefined) editStrum(b.dataset.secstrum);
    else if (b.id === 'sTempoDown') setBpm(-5);
    else if (b.id === 'sTempoUp') setBpm(5);
    else if (b.id === 'sTune') { settings.set('tuning', cleanTuning(stored.tuning)).then(() => { location.hash = '#/tuner'; }); }
  });
  // Veličina teksta (Aa): klizač 80–180 %, pamti se po pesmi; tekst nikad ne prelazi širinu ekrana
  const setZoom = async (z) => {
    zoom = Math.min(1.8, Math.max(0.8, Math.round(z * 10) / 10));
    $('sLyrics').style.setProperty('--zoom', zoom);
    fitAndTabs();
  };
  // čuva se tek kad se klizač pusti (dok se vuče, samo prikaz)
  const saveZoom = () => { if (zoom === 1) delete stored.zoom; else stored.zoom = zoom; return save(); };
  const aaPop = $('sAaPop');
  const closeAa = () => { aaPop.hidden = true; document.removeEventListener('pointerdown', outsideAa, true); };
  const outsideAa = (e) => { if (!aaPop.contains(e.target)) closeAa(); };
  // „⋯“: veličina slova (isti klizač kao ranije „Aa“), prethodne verzije; dva prsta = uvećanje teksta
  $('sMore').addEventListener('click', async () => {
    // v1.78: nastava — „Pošalji učeniku…“ (nastavnik) i „Pošalji nastavniku“ (učenik)
    let teachItems = []; // v1.80: i „Proveri sa nastavnikom“ / „Pošalji ispravku“ (zajedničko sa TAB pesmama)
    try { teachItems = await (await import('./teachView.js')).teachMenuItems(stored); } catch {}
    const v = await moreMenu('song:' + id, songMenuItems(stored, [
      { value: 'easy', label: t('sug.easyBtn'), sub: easyActive() ? t('song.easyOnSub') : t('song.easySub'), icon: 'easy', on: easyActive() },
      { value: 'details', label: t('song.detailsMenu'), sub: t('song.detailsSub'), icon: 'details' },
      { value: 'share', label: t('song.share'), sub: t('stb.shareTip'), icon: 'share' },
      { value: 'pdf', label: t('song.pdf'), sub: t('ss.pdfSub'), icon: 'pdf' },
      ...(touchOk() && root.querySelector('.song-view.calm') ? [{ value: 'chords', label: t('te.menu'), sub: t('te.menuSub'), icon: 'edit' }] : []),
      ...teachItems,
    ]));
    if (v && teachItems.some((x) => x.value === v)) { await (await import('./teachView.js')).handleTeachMenu(v, stored); return; }
    if (v && /^(listen|tutorial)/.test(v)) { (await import('./ytPick.js')).ytAction(v.split(':')[0], stored, save, { change: v.endsWith(':change') }).then(() => pa.refresh()); return; }
    if (v === 'edit') { location.hash = '#/uredi/' + encodeURIComponent(id); return; }
    if (v === 'easy') { await toggleEasy(); return; }
    if (v === 'details') { openPanel($('sDet'), t('song.detailsMenu')); }
    if (v === 'share') $('sShare')?.click();
    if (v === 'pdf') $('sPdf')?.click();
    if (v === 'chords') editChords();
  });
  bindZoomPill(root, { get: () => zoom, apply: (z) => setZoom(z), save: () => saveZoom(), min: 0.8, max: 1.8 });
  // v1.82 (računar): traka umesto „⋯“ (Uredi · Uz video · Lakša verzija · Podeli · ⋯) i brza izmena akorda na pesmi
  const tbSync = () => { const b = root.querySelector('[data-tb="easy"]'); if (b) { const on = !!easyActive(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); } };
  root.querySelector('#sTb')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-tb]'); if (!b) return;
    const a = b.dataset.tb;
    if (a === 'edit') location.hash = '#/uredi/' + encodeURIComponent(id);
    else if (a === 'video') $('paBtn')?.click();
    else if (a === 'easy') { await toggleEasy(); tbSync(); }
    else if (a === 'share') {
      // v1.88: „Podeli ▾“ — link ili PDF
      const v = await moreMenu(null, [{ value: 'link', label: t('stb.shareLink'), sub: t('stb.shareTip'), icon: 'share' }, { value: 'pdf', label: t('song.pdf'), sub: t('ss.pdfSub'), icon: 'pdf' }]);
      if (v === 'link') $('sShare')?.click(); else if (v === 'pdf') $('sPdf')?.click();
    }
    else if (a === 'listen') listen();
    else if (a === 'more') $('sMore')?.click();
  });
  // v1.88: mirna verzija na telefonu i tabletu (računar zadržava traku sa kontrolama)
  const deskMq = matchMedia(DESK_Q);
  const setCalm = () => { root.querySelector('.song-view')?.classList.toggle('calm', !deskMq.matches && !globalThis.__marliTest?.classicSong); fitChips(); }; // stari testovi kontrola: ranija traka
  setCalm();
  deskMq.addEventListener?.('change', setCalm);
  window.addEventListener('hashchange', function offMq() { deskMq.removeEventListener?.('change', setCalm); window.removeEventListener('hashchange', offMq); });
  $('sChips').addEventListener('click', (e) => { if (e.target.closest('[data-pa]')) { $('paBtn')?.click(); return; } if (e.target.closest('[data-sheet]')) openSongSheet(); });
  if ($('paBtn')) new MutationObserver(() => drawChips()).observe($('paBtn'), { attributes: true, attributeFilter: ['class'] }); // video povezan / uklonjen → čip se osveži
  // v2.1: „Ritam i promene“ → poslednji korak „Sviraj pesmu uz video“ otvara pesmu i odmah „Uz video“
  try { if ($('paBtn') && sessionStorage.getItem('marli-open-pa') === stored.id) { sessionStorage.removeItem('marli-open-pa'); setTimeout(() => $('paBtn')?.click(), 400); } } catch {}
  // dugmad uz deo pesme („+ Ritam“, ponavljanje) — u mirnoj verziji tek na dodir naziva dela
  $('sLyrics').addEventListener('click', (e) => {
    const n = e.target.closest('.sec-name'); if (!n || !root.querySelector('.song-view.calm')) return;
    n.closest('.sec')?.classList.toggle('tools');
  });
  $('sControls')?.addEventListener('click', () => setTimeout(tbSync, 50));
  tbSync();
  // v1.89 (telefon i tablet): uređivanje akorda prstom — poseban režim (⋯, „Podešavanja pesme“ ili dug pritisak na akord)
  let touch = null;
  const touchOk = () => !stored.recording && stored.type !== 'tab';
  if (touchOk()) import('./songTouchEdit.js').then(({ attachTouchEdit }) => { touch = attachTouchEdit({
    root, lyrics: () => $('sLyrics'), stored: () => stored, setStored: (p) => { for (const k of Object.keys(stored)) delete stored[k]; Object.assign(stored, p); },
    shift: () => tp - capo, save: () => db.put(stored),
    redraw: () => { detDirty = true; drawLyrics(); drawChips(); },
    canEnter: () => !!root.querySelector('.song-view.calm') && !playerUI && !document.body.classList.contains('pa-on') && !document.body.classList.contains('stage-mode'),
    beforeEnter: () => { closePlayer(); stopScroll(); stopLoop(); stopStrum(); },
  }); }).catch(() => {});
  const editChords = () => { if (touch) touch.enter(); };
  if (!stored.recording) import('./songQuick.js').then(({ attachQuickEdit }) => attachQuickEdit({
    root, lyrics: () => $('sLyrics'), stored: () => stored, setStored: (p) => { for (const k of Object.keys(stored)) delete stored[k]; Object.assign(stored, p); },
    shift: () => tp - capo, save: () => db.put(stored), enabled: () => !!$('sLyrics') && !document.body.classList.contains('stage-mode'),
    redraw: () => { detDirty = true; drawLyrics(); if ($('sDet').open) drawDetails(); },
    showChord: (name) => showChord(name, { voicing: (stored.shapes || {})[name] || 0 }),
  })).catch(() => {});
  // „Uz video“: pesma prati YouTube video (automatsko listanje, petlja i „Pusti“ staju)
  const pa = bindPlayAlong({ root, stored, save, content: () => $('sLyrics'), beforeStart: () => { stopScroll(); if (loopSec >= 0) $('sLoopStop')?.click(); loopMet?.stop(); } });
  attachPinch($('sLyrics'), { get: () => zoom, set: async (z) => { await setZoom(z); await saveZoom(); }, min: 0.8, max: 1.8 });
  $('sAaRange').addEventListener('input', (e) => setZoom(+e.target.value / 100));
  $('sAaRange').addEventListener('change', () => saveZoom());

  $('sPdf').addEventListener('click', async () => {
    const btn = $('sPdf');
    btn.disabled = true;
    const old = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span> ${t('song.makingPdf')}`;
    try {
      const { songToPdf } = await import('./pdf.js');
      const song = { ...shapesSong(), key: soundingKey(), strum: stored.strum };
      const blob = await songToPdf(song, {
        transposeLabel: tp ? t('pdf.transpose', { n: (tp > 0 ? '+' : '') + tp }) : '',
        capoLabel: [capo ? t('pdf.capo', { n: capo }) : '', Number(stored.bpm) ? t('pdf.tempo', { n: stored.bpm }) : '', cleanTuning(stored.tuning) !== 'standard' ? t('tuning.song', { name: `${t('tuning.' + cleanTuning(stored.tuning))} (${tuningNotes(stored.tuning)})` }) : ''].filter(Boolean).join('  ·  '),
      });
      const r = await (await import('./shareService.js')).shareFile(blob, safeFileName(song.title) + '.pdf', song.title);
      if (r === 'downloaded') toast(t('song.pdfDownloaded'));
      // Ako je Google Drive povezan, PDF se čuva i u folder „Gitara“ (isti fajl se zamenjuje).
      if (await driveConnected()) {
        const d = await import('./drive.js');
        await d.initDrive();
        if (d.driveState().connected) d.savePdfToDrive(blob, { ...song, id: stored.id })
          .then(() => toast(t('song.pdfDrive')))
          .catch((e) => toast(e instanceof d.DriveError ? t('song.pdfDriveFailed', { msg: e.message }) : t('song.pdfDriveFailedGeneric'), 'error'));
      }
    } catch (e) {
      console.error(e);
      toast(t('song.pdfFailed'), 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = old;
    }
  });
  $('sShare').addEventListener('click', () => shareSong(stored).catch(() => toast(t('share.failed'), 'error')));
}

// Za podešavanja: izvoz/uvoz svih pesama
export async function exportAll() {
  const all = await db.all();
  const data = JSON.stringify({ app: 'gitara', version: 1, backup: true, exportedAt: new Date().toISOString(), songs: all.map((sg) => ({ id: sg.id, createdAt: sg.createdAt, updatedAt: sg.updatedAt, title: sg.title, artist: sg.artist, key: sg.key, sections: sg.sections, transpose: sg.transpose, ...songExtras(sg), ...songMeta(sg) })) }, null, 1);
  return (await import('./shareService.js')).shareFile(new Blob([data], { type: 'application/json' }), `gitara-pesme-${new Date().toISOString().slice(0, 10)}.json`, t('export.allTitle'));
}

export { importSongFile, layoutChordLine };
