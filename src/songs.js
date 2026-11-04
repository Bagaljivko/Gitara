// Tab "Pesme": biblioteka, prikaz pesme, deljenje i uvoz. Editor i skeniranje su u songEditor.js (učitava se po potrebi).
const loadEditor = () => import('./songEditor.js');
import { songs as db } from './db.js';
import { esc, toast, dialog, confirmDialog, pickFile, shareOrDownload, closeXHTML } from './ui.js';
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
import { isStandalone, isIOS, canPromptInstall, promptInstall } from './install.js';
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

let selectedId = null; // izabrana pesma u prikazu sa dva panela
export function setSelectedSong(id) { selectedId = id; }

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
function libBadges(s) {
  const b = [];
  if (s.capo) b.push(`<span class="badge-sm" title="${esc(t('capo.title'))}">${esc(t('lib.badgeCapo', { n: s.capo }))}</span>`);
  if (s.tuning && s.tuning !== 'standard') b.push(`<span class="badge-sm">${esc(t('tuning.' + s.tuning))}</span>`);
  if (s.hasTabs ?? (s.sections || []).some((x) => (x.tabs || []).length)) b.push(`<span class="badge-sm">${esc(t('lib.badgeTab'))}</span>`);
  return b.length ? ' ' + b.join(' ') : '';
}
export async function renderLibrary(root, params = new URLSearchParams()) {
  const sortPref = localStorageGet('gitara-sort') || 'new';
  const tab = params.get('tab') === 'sl' ? 'sl' : 'songs';
  root.innerHTML = `
  <section class="view lib-view">
    <header class="view-head"><h1>${t('lib.title')}</h1></header>
    <div class="seg-tabs" role="tablist">
      <button role="tab" data-lt="songs" class="${tab === 'songs' ? 'active' : ''}">${t('lib.tabSongs')}</button>
      <button role="tab" data-lt="sl" class="${tab === 'sl' ? 'active' : ''}">${t('lib.tabSetlists')}</button>
    </div>
    <div id="lSlPane" ${tab === 'sl' ? '' : 'hidden'}></div>
    <div id="lSongsPane" ${tab === 'sl' ? 'hidden' : ''}>
    <div class="lib-actions">
      <button class="btn primary big" id="lScan">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3 7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>
        ${t('lib.scan')}
      </button>
      <div class="row">
        <button class="btn" id="lImport">${t('lib.import')}</button>
        <button class="btn" id="lNew">${t('lib.new')}</button>
      </div>
    </div>
    <div class="lib-tools">
      <input type="search" id="lSearch" placeholder="${t('lib.search')}" aria-label="${t('lib.searchLabel')}">
      <select id="lSort" aria-label="${t('lib.sortLabel')}">
        <option value="new">${t('lib.sortNew')}</option>
        <option value="title">${t('lib.sortTitle')}</option>
        <option value="artist">${t('lib.sortArtist')}</option>
        <option value="recent">${t('lib.sortRecent')}</option>
      </select>
    </div>
    <div class="chips" id="lFolders" role="group" aria-label="${t('folder.title')}"></div>
    <div id="lNudge"></div>
    <ul class="song-list" id="lList"></ul>
    </div>
  </section>`;
  const $ = (id) => root.querySelector('#' + id);
  $('lSort').value = sortPref;
  await seedDemoSong(getLang()).catch(() => {});
  let all = await db.list(); // brzi indeks (bez akorda) — dovoljan za listu
  let folders = await getFolders();
  let folderFilter = localStorageGet('gitara-folder') || '';
  if (folderFilter && !folders.some((f) => f.id === folderFilter)) folderFilter = '';

  // Sekcije: Pesme / Setliste
  root.querySelectorAll('[data-lt]').forEach((b) => b.addEventListener('click', () => {
    root.querySelectorAll('[data-lt]').forEach((x) => x.classList.toggle('active', x === b));
    const sl = b.dataset.lt === 'sl';
    $('lSongsPane').hidden = sl;
    $('lSlPane').hidden = !sl;
    history.replaceState(null, '', sl ? '#/pesme?tab=sl' : '#/pesme');
    if (sl) renderSetlistsPane($('lSlPane'));
  }));
  if (tab === 'sl') renderSetlistsPane($('lSlPane'));

  // Folderi kao „čipovi“ za filtriranje
  const drawFolders = () => {
    $('lFolders').innerHTML = `<button class="chip ${folderFilter ? '' : 'active'}" data-f="">${t('folder.all')}</button>`
      + folders.map((f) => `<button class="chip ${folderFilter === f.id ? 'active' : ''}" data-f="${esc(f.id)}">${esc(folderLabel(f))}${folderFilter === f.id && !isSystemFolder(f.id) ? ' <span class="chip-edit" aria-hidden="true">⋯</span>' : ''}</button>`).join('')
      + `<button class="chip add" data-f="__new">${t('folder.add')}</button>`;
  };
  $('lFolders').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    const id = b.dataset.f;
    if (id === '__new') {
      const name = await askName(t('folder.new'));
      if (!name) return;
      const f = await addFolder(name);
      folders = await getFolders();
      folderFilter = f.id;
    } else if (id && id === folderFilter) {
      // Drugi dodir na izabrani folder: preimenuj / obriši
      const r = await manageFolder(folders.find((f) => f.id === id));
      folders = await getFolders();
      if (r === 'deleted') { folderFilter = ''; all = await db.list(); }
    } else folderFilter = id;
    localStorageSet('gitara-folder', folderFilter);
    drawFolders();
    draw();
  });

  const draw = () => {
    const q = fold($('lSearch').value);
    // snimci iz „Samo sviraj“ su samo u folderu „Moji snimci“ (ne u „Sve“)
    let list = all.filter((s) => (folderFilter ? (s.folders || []).includes(folderFilter) : !(s.folders || []).some(isSystemFolder))).filter((s) => !q || folded(s).t.includes(q) || folded(s).a.includes(q) ||
      (s.find ?? '').includes(q));
    const sort = $('lSort').value;
    const cmp = (a, b) => String(a || '').localeCompare(String(b || ''), 'sr', { sensitivity: 'base' });
    if (sort === 'title') list.sort((a, b) => cmp(a.title, b.title));
    else if (sort === 'artist') list.sort((a, b) => cmp(a.artist, b.artist) || cmp(a.title, b.title));
    else if (sort === 'recent') { const op = openedMap(); list.sort((a, b) => (op[b.id] || 0) - (op[a.id] || 0) || (b.updatedAt || 0) - (a.updatedAt || 0)); }
    else list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!all.length || (!folderFilter && !q && all.every((s) => (s.folders || []).some(isSystemFolder)))) {
      $('lList').innerHTML = `<li class="empty">
        <p><b>${t('lib.empty')}</b></p>
        <p class="muted">${t('lib.emptyHint')}</p></li>`;
      return;
    }
    if (!list.length && folderFilter && !q) { $('lList').innerHTML = `<li class="empty muted">${t('folder.emptyFolder')}</li>`; return; }
    if (!list.length) { $('lList').innerHTML = `<li class="empty muted">${esc(t('lib.noResults', { q: $('lSearch').value }))}</li>`; return; }
    $('lList').innerHTML = list.map((s) => `
      <li class="song-item${s.id === selectedId ? ' selected' : ''}" data-id="${esc(s.id)}">
        <a href="#/pesma/${encodeURIComponent(s.id)}" class="song-link">
          <span class="song-title">${esc(s.title)}</span>
          <span class="song-sub">${esc(s.artist || t('lib.unknownArtist'))}${((k) => (k ? ` · <span class="key">${esc(dn(k))}</span>` : ''))(libKey(s))}${libBadges(s)}</span>
        </a>
        <button class="icon-btn" data-fold="${esc(s.id)}" aria-label="${esc(t('folder.forSong', { title: s.title }))}">
          <svg viewBox="0 0 24 24"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>${(s.folders || []).length ? `<span class="fold-count">${s.folders.length}</span>` : ''}
        </button>
        <button class="icon-btn" data-del="${esc(s.id)}" aria-label="${esc(t('lib.deleteSong', { title: s.title }))}">
          <svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9zm4 2v8h2v-8h-2zm4 0v8h2v-8h-2z"/></svg>
        </button>
      </li>`).join('');
  };

  // kucanje: jedno crtanje po sličici ekrana (bez kašnjenja, samo se spoje pritisci u istom trenutku)
  let searchQ = 0;
  $('lSearch').addEventListener('input', () => { cancelAnimationFrame(searchQ); searchQ = requestAnimationFrame(draw); });
  $('lSort').addEventListener('change', () => { localStorageSet('gitara-sort', $('lSort').value); draw(); });
  $('lList').addEventListener('click', async (e) => {
    const fb = e.target.closest('[data-fold]');
    if (fb) {
      e.preventDefault();
      const song = all.find((x) => x.id === fb.dataset.fold);
      if (await editSongFolders(song)) { all = await db.list(); folders = await getFolders(); drawFolders(); draw(); }
      return;
    }
    const b = e.target.closest('[data-del]');
    if (!b) return;
    e.preventDefault();
    const s = all.find((x) => x.id === b.dataset.del);
    if (!(await confirmDialog(t('lib.deleteTitle'), t('lib.deleteBody', { title: s.title }), t('common.delete'), 'danger'))) return;
    await db.remove(s.id);
    all = all.filter((x) => x.id !== s.id);
    toast(t('lib.deleted'));
    draw();
  });
  $('lScan').addEventListener('click', () => loadEditor().then((m) => m.startScan()));
  $('lImport').addEventListener('click', async () => { if (await importSongFile()) { all = await db.list(); draw(); } });
  $('lNew').addEventListener('click', () => loadEditor().then((m) => m.newSongDraft()));
  drawFolders();
  draw();
  backupNudge($('lNudge'), all.filter((x) => !x.demo).length);
}

// Podsetnik za rezervnu kopiju: posle 3+ pesama bez Google Drive-a; „Ne sada“ ga sakrije na 30 dana.
const NUDGE_MIN = 3, NUDGE_SNOOZE = 30 * 864e5;
async function backupNudge(box, count) {
  if (count < NUDGE_MIN || (await driveConnected())) return;
  const st = (await settings.get('backupNudge', null)) || {};
  if (st.snoozedAt && Date.now() - st.snoozedAt < NUDGE_SNOOZE) return;
  if (st.exportedAt && Date.now() - st.exportedAt < NUDGE_SNOOZE) return;
  box.innerHTML = `<div class="card nudge" role="note">
    <b>${t('nudge.title')}</b>
    <p class="muted small">${t(isIOS() && !isStandalone() ? 'nudge.bodyIos' : 'nudge.body')}</p>
    <div class="row">
      <a class="btn small primary" href="#/podesavanja">${t('nudge.drive')}</a>
      <button class="btn small" data-n="export">${t('nudge.export')}</button>
      <button class="btn small ghost" data-n="later">${t('nudge.later')}</button>
    </div></div>`;
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-n]');
    if (!b) return;
    if (b.dataset.n === 'export') {
      const r = await exportAll();
      if (r === 'downloaded') toast(t('set.backupDownloaded'));
      await settings.set('backupNudge', { ...st, exportedAt: Date.now() });
    } else await settings.set('backupNudge', { ...st, snoozedAt: Date.now() });
    box.innerHTML = '';
  });
}

// ---------------- Uvoz / deljenje ----------------
async function importSongFile() {
  const file = await pickFile('.json,application/json,text/plain');
  if (!file) return false;
  if (file.size > 2 * 1024 * 1024) { await dialog({ title: t('import.invalidTitle'), body: t('import.tooBig') }); return false; }
  let song;
  try {
    song = parseSharedFile(await file.text());
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

/** „Podeli pesmu“: link sa celom pesmom (kompresovano u adresi) preko sistemskog menija za deljenje. */
async function shareSong(song) {
  const { songLink } = await import('./sharelink.js'); // učitava se tek pri deljenju
  const url = songLink(song);
  const text = song.artist ? t('link.shareTextArtist', { title: song.title, artist: song.artist }) : t('link.shareText', { title: song.title });
  if (navigator.share) {
    try { await navigator.share({ title: song.title, text, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; /* u suprotnom: kopiraj link */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(t('link.copied'));
  } catch {
    // Poslednja mogućnost: prikaži link da ga korisnik ručno kopira
    await dialog({ title: t('link.copyTitle'), html: true, body: `<textarea class="link-box" readonly rows="4">${esc(url)}</textarea>` });
  }
}

// ---------------- Pesma iz linka (#pesma=...) ----------------
export async function renderSharedSong(root) {
  setWakeZone('song');
  let song;
  const { songFromHash } = await import('./sharelink.js');
  try { song = songFromHash(); } catch (e) {
    root.innerHTML = `<section class="view"><div class="card"><h2>${t('link.badTitle')}</h2><p class="muted">${esc(e.message)}</p>
      <a class="btn primary" href="#/pesme">${t('song.back')}</a></div></section>`;
    history.replaceState(null, '', location.pathname + location.search + '#/pesme');
    return;
  }
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
      ${canPromptInstall() ? `<button class="btn small primary" id="shInstallBtn">${t('set.install')}</button>` : `<p class="small muted">${isIOS() ? t('set.installIos') : t('set.installAndroid')}</p>`}
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

// ---------------- Prikaz linija sa akordima ----------------
function chordSpan(c, mark) {
  return `<button class="ch${mark !== undefined ? ' unsure' : ''}" data-chord="${esc(c)}"${mark !== undefined ? ` data-unsure="${mark}"` : ''}>${esc(dn(c))}</button>`;
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
  const text = line.text || '';
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
  // Grupisanje u reči (da se reč ne lomi između slogova)
  let html = '<div class="ln">';
  let open = false;
  chunks.forEach((ch, i) => {
    const prev = chunks[i - 1];
    const newWord = !prev || prev.text.endsWith(' ');
    if (newWord) { if (open) html += '</span>'; html += '<span class="w">'; open = true; }
    const chordsHtml = ch.chords.map((c) => chordSpan(c.chord, chordMark(c))).join(' ');
    html += `<span class="seg"><span class="cr">${chordsHtml || '&#8203;'}</span><span class="tx">${markText(ch.text, ch.start, ranges) || '&#8203;'}</span></span>`;
  });
  if (open) html += '</span>';
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
  let widestCh = 0;
  for (const ln of el.querySelectorAll('.ln')) widestCh = Math.max(widestCh, lineCh(ln));
  const widest = widestCh * chWidth(m.family, want);
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
  const segs = ln.querySelectorAll('.seg');
  if (!segs.length) return (ln.textContent || '').length;
  let w = 0;
  segs.forEach((sg) => {
    const ct = sg.firstElementChild.textContent.replace(ZW, '').length;
    const tt = sg.lastElementChild.textContent.replace(ZW, '').length;
    w += Math.max(tt, ct + 0.6); // akordi imaju .6ch razmaka desno
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
export function lyricsMetrics(el, availW = 0) {
  el.style.fontSize = '';
  const cs = getComputedStyle(el);
  return { want: parseFloat(cs.fontSize) || 16, family: cs.fontFamily, avail: availW || el.clientWidth };
}

// Širina teksta pesme po veličini ekrana (ne zavisi od pesme)
const lyrW = new Map();
// (screen.* ne traži preračunavanje rasporeda, za razliku od window.innerWidth)
const lyrWKey = () => `${screen.width}x${screen.height}|${screen.orientation ? screen.orientation.type : ''}|${document.body.classList.contains('two-pane-mode') ? 2 : 1}`;

/** Svi delovi pesme. uncertain = lista nesigurnih mesta (indeksi se odnose na ove sekcije). */
export function renderSectionsHTML(sections, uncertain = []) {
  return (sections || []).map((s, si) => `
    <div class="sec">
      ${s.name || s.strum ? `<div class="sec-head">${s.name ? `<div class="sec-name">${esc(s.name)}</div>` : ''}${s.strum ? patternHTML(s.strum, { compact: true }) : ''}</div>` : ''}
      ${(s.tabs || []).map((tab, ti) => tabBlockHTML(tab, { si, ti, playLabel: t('tab.play'), marks: uncertain.map((u, idx) => ({ ...u, idx })).filter((u) => u.kind === 'fret' && u.section === si && u.tab === ti).map((u) => ({ string: u.string, col: u.col, idx: u.idx })) })).join('')}
      ${s.lines.map((l, li) => renderLineHTML(l, uncertain.map((u, idx) => ({ ...u, idx })).filter((u) => u.section === si && u.line === li))).join('')}
    </div>`).join('');
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
export async function renderSong(root, id, nav = null) {
  let stored = await db.get(id);
  if (!stored) {
    root.innerHTML = `<section class="view"><p>${t('song.notFound')}</p><a class="btn" href="#/pesme">${t('song.back')}</a></section>`;
    return;
  }
  // Pesma još nije prebačena u novi zapis akorda (npr. otvorena pre jednokratne konverzije) — uradi to sada
  if (needsUpgrade(stored)) { stored = upgradeSong(stored); db.put(stored).catch(() => {}); }
  markOpened(stored.id); // za sortiranje „Nedavno otvorene“ (pamti se samo na uređaju, ne pokreće rezervnu kopiju)
  let tp = stored.transpose || 0;
  let capo = stored.capo || 0;
  let zoom = Number(stored.zoom) || (Number(localStorageGet('gitara-font')) || 1);
  let speed = stored.scrollSpeed || 4;
  let loopSec = -1, loopMet = null, loopBpm = 90; // vežbanje jedne sekcije
  // Tempo pesme: sačuvan uz pesmu (ili, ako ga nema, opšti tempo metronoma)
  const songBpm = async () => Number(stored.bpm) || Number(await settings.get('metBpm', 90)) || 90;
  const backHref = nav ? nav.backHref : '#/pesme';
  root.innerHTML = `
  <section class="view song-view">
    <header class="topbar">
      <a href="${backHref}" class="back" aria-label="${t('song.back')}">${nav ? esc(nav.backLabel) : t('song.backShort')}</a>
      <div class="topbar-actions">
        <button class="btn small" id="sEasyTop" aria-pressed="false" aria-label="${t('sug.easyBtn')}"><span class="lbl-long">${t('sug.easyBtn')}</span><span class="lbl-short" aria-hidden="true">${t('sug.easyBtnShort')}</span></button>
        <button class="btn small aa-btn" id="sAa" aria-haspopup="true" aria-expanded="false" aria-label="${t('song.textSize')}">Aa</button>
        <a class="btn small" href="#/uredi/${encodeURIComponent(id)}">${t('song.edit')}</a>
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
      <div id="sAsk"></div>
      <div id="sSuggest"></div>
      <div id="sControls"></div>
      <details class="song-details" id="sDet"><summary><span>${t('song.details')}</span><span class="small muted" id="sDetSub"></span></summary><div id="sDetBody"></div></details>
      <div class="lyrics" id="sLyrics" style="--zoom:${zoom}"></div>
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
      <button class="btn round small" id="sPlay" aria-label="${t('scroll.play')}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
      <span class="small muted">${t('scroll.slower')}</span>
      <input type="range" id="sSpeed" min="1" max="10" step="1" value="${speed}" aria-label="${t('scroll.speed')}">
      <span class="small muted">${t('scroll.faster')}</span>
      <button class="icon-btn scroll-collapse" id="sCollapse" aria-label="${t('scroll.collapse')}" title="${t('scroll.collapse')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 7.4 10 6l6 6-6 6-1.4-1.4L13.2 12z"/></svg></button>
    </div>
    <div class="song-actions">
      <button class="btn primary" id="sPdf">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg> ${t('song.pdf')}</button>
      <button class="btn" id="sShare">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7l-6.7 3.4a3 3 0 1 0 0 3.2L15 17a3 3 0 1 0 3-1z"/></svg> ${t('song.share')}</button>
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
    $('sHead').innerHTML = `<div class="song-title-row"><h1 class="song-h1">${esc(stored.title)}</h1><a class="icon-btn pr-shortcut" href="#/vezbe/pesma/${encodeURIComponent(stored.id)}" aria-label="${esc(t('pr.songShortcut'))}" title="${esc(t('pr.songShortcut'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M12 2.2c-4.9 0-8.6 2-8.6 5.6 0 4.6 4.2 10.2 8.6 14 4.4-3.8 8.6-9.4 8.6-14 0-3.6-3.7-5.6-8.6-5.6zM10 7.6v6.2l5.2-3.1z"/></svg></a></div>
      ${stored.recording ? `<button class="btn small fp-onneck" id="sFpReplay"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>${esc(t('song.playOnNeck'))}</button>` : ''}
      ${stored.artist || cleanTuning(stored.tuning) !== 'standard' ? `<p class="song-meta">${esc(stored.artist || '')}${cleanTuning(stored.tuning) !== 'standard'
        ? `${stored.artist ? ' · ' : ''}<button class="tuning-chip" id="sTune" title="${esc(t('tuning.tuneNow'))}">${esc(t('tuning.' + cleanTuning(stored.tuning)))} · ${esc(tuningNotes(stored.tuning))} ›</button>` : ''}</p>` : ''}`;
    drawPracticeMark();
    // snimak iz „Samo sviraj“: ponovo na vratu (samo slika; modul se učitava tek na dodir)
    $('sFpReplay')?.addEventListener('click', () => import('./freeplay.js').then((m) => m.replaySong(stored)));
  };
  // Mala oznaka napretka pored ikonice vežbe: koliko delova pesme je dobro uvežbano (najbolje ≥ 80)
  const drawPracticeMark = () => settings.get('practice', null).then((st) => {
    const rec = st && st.songs && st.songs[stored.id];
    const a = $('sHead')?.querySelector('.pr-shortcut');
    if (!rec || !a) return;
    const seen = new Set();
    const total = (stored.sections || []).filter((sec) => {
      const ch = (sec.lines || []).flatMap((l) => (l.chords || []).map((c) => c.chord)).filter(Boolean);
      const sig = (sec.name || '') + '|' + ch.join(',');
      if (!ch.length || seen.has(sig)) return false;
      seen.add(sig); return true;
    }).length;
    if (!total) return;
    const good = Object.entries(rec).filter(([k, r]) => k !== 'all' && r && r.best >= 80).length;
    const p = rec.all && rec.all.best >= 80 ? 1 : Math.min(1, good / total);
    const played = Object.keys(rec).length;
    if (!played) return;
    a.querySelector('.pr-mark')?.remove();
    a.insertAdjacentHTML('beforeend', `<span class="pr-mark${p >= 1 ? ' done' : ''}" style="--p:${Math.round(p * 100)}" title="${esc(t('pr.songMark', { n: Math.min(good, total), total }))}"></span>`);
    a.setAttribute('aria-label', `${t('pr.songShortcut')} — ${t('pr.songMark', { n: Math.min(good, total), total })}`);
  }).catch(() => {});
  const drawAsk = () => { $('sAsk').innerHTML = askHTML(); };
  const drawControls = () => {
    const key = soundingKey();
    const shapesKey = capo ? keyAt(tp - capo) : '';
    $('sControls').innerHTML = `<div class="ctl-row">
      <div class="ctl ctl-key" role="group" aria-label="${t('song.key')}">
        <span class="ctl-label">${t('song.key').replace(/:$/, '')}${tp ? ` <span class="ctl-delta">${tp > 0 ? '+' + tp : '−' + Math.abs(tp)}</span>` : ''}</span>
        <div class="ctl-step">
          <button class="btn round small" id="tDown" aria-label="${t('song.transposeDown')}">−</button>
          <button class="key-btn" id="kOpen" aria-haspopup="dialog" aria-label="${esc(t('kw.open', { k: dn(key) || '?' }))}"><b>${esc(dn(key) || '–')}</b></button>
          <button class="btn round small" id="tUp" aria-label="${t('song.transposeUp')}">+</button>
        </div>
        ${tp ? `<button class="ctl-link" id="tReset">${t('song.original')}</button>` : ''}
      </div>
      <div class="ctl" role="group" aria-label="${t('capo.title')}">
        <span class="ctl-label">${t('capo.title')}</span>
        <div class="ctl-step">
          <button class="btn round small" id="cDown" aria-label="${t('capo.down')}">−</button>
          <b class="ctl-val">${capo || t('capo.none')}</b>
          <button class="btn round small" id="cUp" aria-label="${t('capo.up')}">+</button>
        </div>
        ${capo && shapesKey ? `<span class="ctl-sub">${esc(t('capo.shapesShort', { k: dn(shapesKey) }))}</span>` : ''}
      </div>
      <div class="ctl" role="group" aria-label="${t('song.tempo')}">
        <span class="ctl-label">${t('song.tempo')}</span>
        <div class="ctl-step">
          <button class="btn round small" id="sTempoDown" aria-label="${t('loop.slower')}">−</button>
          <b class="ctl-val" id="sTempo">${Number(stored.bpm) || '…'}</b>
          <button class="btn round small" id="sTempoUp" aria-label="${t('loop.faster')}">+</button>
        </div>
        <span class="ctl-sub">BPM</span>
      </div>
    </div>`;
    if (!Number(stored.bpm)) songBpm().then((b) => { if ($('sTempo')) $('sTempo').textContent = b; });
    syncEasyTop();
  };
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
        <button class="btn small" id="sStrumEdit">${stored.strum || stored.sections.some((x) => x.strum) ? t('strum.change') : t('strum.add')}</button>
      </div>
      ${prog.length ? `<div class="det-sec prog">${prog.map((p) => `<div class="prog-row"><span class="prog-name">${esc(p.name || t('song.chordsFallback'))}</span><span class="prog-chords">${p.chords.map((c) => `<button class="ch" data-chord="${esc(c)}">${esc(dn(c))}</button>`).join('<span class="arrow">→</span>')}</span></div>`).join('')}</div>` : ''}
      ${chords.length ? `<div class="diagram-row" aria-label="${t('song.diagrams')}">${chords.map((c) => `<button class="diagram-btn" data-chord="${esc(c)}" aria-label="${esc(t('song.enlarge', { name: dn(c) }))}">${chordSVG(c, { voicing: (stored.shapes || {})[c] || 0 })}</button>`).join('')}</div>` : ''}
      <div class="det-sec">${ytRowHTML(stored)}</div>`;
  };
  const drawLyrics = () => {
    const l = $('sLyrics');
    // Širina teksta: zapamćena za ovu veličinu ekrana (bez merenja); ako se razlikuje, ResizeObserver ispravi
    l.style.setProperty('--zoom', zoom);
    const pre = lyricsMetrics(l, lyrW.get(lyrWKey()));
    l.innerHTML = renderSectionsHTML(shapesSong().sections, unc());
    addLoopButtons();
    fitAndTabs(pre);
  };
  // Sve odjednom (otvaranje pesme, odgovor na pitanje, izmena ritma…)
  const draw = () => { drawHead(); drawAsk(); drawSuggest(); drawControls(); drawDetails(); drawLyrics(); };
  // Tonalitet/kapodaster: samo kontrole, predlozi, detalji i akordi u tekstu
  const drawKeyChange = () => { drawControls(); drawSuggest(); drawDetails(); drawLyrics(); };
  // „Detalji“: zatvoreni posle prvog pregleda pesme; pamti se poslednji izbor
  const detInit = !stored.seen || localStorageGet('gitara-details') === '1';
  $('sDet').open = detInit;
  let detAuto = detInit; // prvo otvaranje je automatsko — ne pamti ga kao izbor korisnika
  $('sDet').addEventListener('toggle', () => {
    if (detAuto) { detAuto = false; } else localStorageSet('gitara-details', $('sDet').open ? '1' : '');
    if ($('sDet').open && detDirty) drawDetails();
  });
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
    if (!(stored.skipped && stored.skipped.easy) && !stored.easyCapo && !capo) {
      const e = easiestCapo(stored, tp);
      if (e) items.push({ x: 'easy-skip', html: `<div class="sug-title">${t('sug.easyTitle')}</div>
        <p class="small">${esc(t('sug.easyText', { n: e.capo, shapes: e.shapes.map((x) => dn(x)).join(', ') }))}</p>
        <div class="sug-actions"><button class="btn small primary" data-sug="easy-apply" data-capo="${e.capo}">${t('sug.apply')}</button></div>` });
    }
    if (!stored.recording && !hasStrum() && !(stored.skipped && stored.skipped.strum)) { // snimci iz „Samo sviraj“: bez predloga ritma
      const ss = stored.suggestStrum && patternById(stored.suggestStrum.id);
      if (ss) items.push({ x: 'strum-skip', html: `<div class="sug-title">${t('sug.strumTitle')}: ${esc(patternName(ss))} <span class="small muted">${ss.sig}</span>
          <button class="icon-btn pat-play" data-sug="strum-play" aria-label="${t('pat.play')}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button></div>
        ${patternHTML(ss, { compact: true })}
        ${stored.suggestStrum.reason ? `<p class="small muted">${esc(stored.suggestStrum.reason)}</p>` : ''}
        <div class="sug-actions"><button class="btn small primary" data-sug="strum-apply">${t('sug.apply')}</button></div>` });
    }
    if (!items.length) return '';
    // Samo jedan predlog odjednom; ✕ ga odbacuje i prikazuje sledeći
    const it = items[0];
    return `<div class="card sug-card"><div class="sug-head"><span>${t('sug.title')}${items.length > 1 ? ` <span class="muted">1/${items.length}</span>` : ''}</span>
      <button class="icon-btn sug-x" data-sug="${it.x}" aria-label="${t('sug.dismiss')}" title="${t('sug.dismiss')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button></div>
      <div class="sug-group">${it.html}</div></div>`;
  }
  const drawSuggest = () => { const el = $('sSuggest'); if (el) el.innerHTML = suggestHTML(); };

  async function loadStrumSuggestion() {
    if (stored.recording || hasStrum() || stored.suggestStrum || (stored.skipped && stored.skipped.strum) || strumLoading) return;
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
  async function editStrum() {
    stopStrum();
    const targets = [{ v: 'song', label: t('strum.wholeSong') }, ...stored.sections.map((s, i) => ({ v: String(i), label: s.name || t('strum.section', { n: i + 1 }) }))];
    const current = (target) => (target === 'song' ? stored.strum : stored.sections[+target]?.strum);
    const body = `
      <label class="small">${t('strum.for')}
        <select id="stTarget">${targets.map((x) => `<option value="${x.v}">${esc(x.label)}</option>`).join('')}</select>
      </label>
      <div class="strum-pick" id="stList">
        <label class="strum-opt"><input type="radio" name="st" value=""> <span>${t('strum.none')}</span></label>
        ${PATTERNS.map((p) => `<label class="strum-opt"><input type="radio" name="st" value="${p.id}"> <span><b>${patternName(p)}</b> <small>${p.sig}</small>${patternHTML(p, { compact: true })}</span></label>`).join('')}
      </div>`;
    const wrapPromise = dialog({ title: t('strum.title'), body, html: true, buttons: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), value: 'save', kind: 'primary' }] });
    const modal = [...document.querySelectorAll('.modal-backdrop')].pop();
    const sync = () => {
      const cur = current(modal.querySelector('#stTarget').value);
      const val = cur ? (cur.id || '') : '';
      modal.querySelectorAll('input[name=st]').forEach((r) => (r.checked = r.value === val));
    };
    let chosen = { target: 'song', id: '' };
    modal.querySelector('#stTarget').addEventListener('change', sync);
    modal.addEventListener('change', () => {
      chosen = { target: modal.querySelector('#stTarget').value, id: (modal.querySelector('input[name=st]:checked') || {}).value || '' };
    });
    sync();
    chosen = { target: 'song', id: (stored.strum && stored.strum.id) || '' };
    if (stored.strum && !stored.strum.id) chosen.id = '__keep';
    const r = await wrapPromise;
    if (r !== 'save') return;
    const p = PATTERNS.find((x) => x.id === chosen.id);
    const apply = (obj) => { if (chosen.id === '__keep') return; if (p) obj.strum = { id: p.id, sig: p.sig, steps: p.steps }; else delete obj.strum; };
    if (chosen.target === 'song') apply(stored); else apply(stored.sections[+chosen.target]);
    await save();
    draw();
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
  function startScroll() {
    scrolling = true; last = 0; carry = 0;
    dimBar(true);
    $('sPlay').classList.add('playing');
    $('sPlay').innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
    $('sPlay').setAttribute('aria-label', t('scroll.pause'));
    keepAwake('autoscroll');
    raf = requestAnimationFrame(step);
  }
  function stopScroll() {
    if (!scrolling) return;
    scrolling = false;
    dimBar(false);
    cancelAnimationFrame(raf);
    allowSleep('autoscroll');
    const b = $('sPlay');
    if (!b) return;
    b.classList.remove('playing');
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
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
      const name = sec.name || t('strum.section', { n: i + 1 });
      head.insertAdjacentHTML('beforeend', `<button class="icon-btn loop-btn${i === loopSec ? ' on' : ''}" data-loop="${i}" aria-pressed="${i === loopSec}" aria-label="${esc(t('loop.start', { name }))}" title="${esc(t('loop.start', { name }))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z"/></svg></button>`);
      el.classList.toggle('looping', i === loopSec);
    });
  }
  async function startLoop(i) {
    stopStrum();
    loopMet?.stop();
    loopSec = i;
    const sec = stored.sections[i];
    $('sLoopName').textContent = sec.name || t('strum.section', { n: i + 1 });
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
    if (w && w !== roW) { roW = w; fitAndTabs(lyricsMetrics(root.querySelector('.lyrics'), w)); }
  });
  ro.observe(root.querySelector('.song-view'));
  // Ekran ostaje upaljen dok koristiš pesmu (Podešavanja → Ekran); ikonica u traci ga isključuje za ovu pesmu
  setWakeZone('song');
  const onHash = () => { stopLoop(); stopScroll(); stopStrum(); endTab(); ro.disconnect(); document.removeEventListener('pointerdown', outsideAa, true); window.removeEventListener('hashchange', onHash); };
  window.addEventListener('hashchange', onHash);

  function easyActive() { return !!stored.easyCapo && capo === stored.easyCapo; }
  function syncEasyTop() { const b = $('sEasyTop'); if (b) { b.classList.toggle('on', easyActive()); b.setAttribute('aria-pressed', String(easyActive())); } }
  // Traka za automatsko skrolovanje: može da se skupi na samo dugme za pokretanje
  const sbar = $('sScrollBar');
  const setCollapsed = (c) => { sbar.classList.toggle('collapsed', c); localStorageSet('gitara-scrollbar', c ? '1' : ''); $('sCollapse').setAttribute('aria-label', t(c ? 'scroll.expand' : 'scroll.collapse')); };
  setCollapsed(localStorageGet('gitara-scrollbar') === '1');
  $('sCollapse').addEventListener('click', (e) => { e.stopPropagation(); setCollapsed(!sbar.classList.contains('collapsed')); });
  $('sEasyTop').addEventListener('click', async () => {
    if (easyActive()) { await setCapo(0); toast(t('sug.easyOff')); return; }
    const e = easiestCapo(stored, tp);
    if (!e) { toast(t('sug.alreadyEasiest')); return; }
    stored.easyCapo = e.capo;
    await setCapo(e.capo);
    toast(t('sug.easyText', { n: e.capo, shapes: e.shapes.map((x) => dn(x)).join(', ') }));
  });
  root.querySelector('.song-view').addEventListener('click', (e) => {
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
      if (a === 'easy-apply') { stored.easyCapo = +sg.dataset.capo; return setCapo(stored.easyCapo); }
      if (a === 'unc-hide') { uncHidden = true; return drawSuggest(); }
      if (a === 'easy-skip') { stored.skipped.easy = true; return save().then(drawSuggest); }
      if (a === 'strum-skip') { stopStrum(); stored.skipped.strum = true; return save().then(drawSuggest); }
      if (a === 'strum-apply') {
        stopStrum();
        const p = patternById(stored.suggestStrum && stored.suggestStrum.id);
        if (p) stored.strum = { id: p.id, sig: p.sig, steps: p.steps };
        return save().then(draw);
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
  const closeAa = () => { aaPop.hidden = true; $('sAa').setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outsideAa, true); };
  const outsideAa = (e) => { if (!aaPop.contains(e.target) && e.target !== $('sAa')) closeAa(); };
  $('sAa').addEventListener('click', () => {
    if (!aaPop.hidden) return closeAa();
    syncAa();
    aaPop.hidden = false;
    $('sAa').setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outsideAa, true);
  });
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
      const r = await shareOrDownload(blob, safeFileName(song.title) + '.pdf', song.title);
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
  const data = JSON.stringify({ app: 'gitara', version: 1, backup: true, exportedAt: new Date().toISOString(), songs: all.map((sg) => ({ title: sg.title, artist: sg.artist, key: sg.key, sections: sg.sections, transpose: sg.transpose, ...songExtras(sg), ...songMeta(sg) })) }, null, 1);
  return shareOrDownload(new Blob([data], { type: 'application/json' }), `gitara-pesme-${new Date().toISOString().slice(0, 10)}.json`, t('export.allTitle'));
}

export { importSongFile, layoutChordLine };
