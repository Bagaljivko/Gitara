// Tab "Pesme": biblioteka, prikaz pesme, uređivanje, skeniranje, deljenje i uvoz.
import { songs as db } from './db.js';
import { esc, toast, dialog, confirmDialog, pickFile, shareOrDownload } from './ui.js';
import { chordSVG, voicingCount } from './diagram.js';
import { isChord, parseChord, canonicalName } from './music.js';
import {
  textToSections, sectionsToText, songChords, progressionSummary, transposeSong,
  parseSharedFile, toSharedFile, safeFileName, SongFormatError, layoutChordLine, songExtras,
} from './songformat.js';
import { scanSong, prepareImage, getApiKey, GeminiError } from './gemini.js';
import { driveState, savePdfToDrive, DriveError } from './drive.js';
import { t } from './i18n.js';
import { settings } from './db.js';
import { PATTERNS, patternHTML, patternName, Metronome } from './rhythm.js';
import { keepAwake, allowSleep } from './wakelock.js';

let draft = null; // nesačuvana pesma (npr. posle skeniranja)
let draftImage = null;
let fontScale = Number(localStorageGet('gitara-font') || 1);

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

const norm = (s) => String(s || '').trim().toLocaleLowerCase('sr');
const fold = (s) => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'dj');

// ---------------- Biblioteka ----------------
export async function renderLibrary(root) {
  const sortPref = localStorageGet('gitara-sort') || 'new';
  root.innerHTML = `
  <section class="view lib-view">
    <header class="view-head"><h1>${t('lib.title')}</h1></header>
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
      </select>
    </div>
    <ul class="song-list" id="lList"></ul>
  </section>`;
  const $ = (id) => root.querySelector('#' + id);
  $('lSort').value = sortPref;
  let all = await db.all();

  const draw = () => {
    const q = fold($('lSearch').value);
    let list = all.filter((s) => !q || fold(s.title).includes(q) || fold(s.artist).includes(q) ||
      (s.sections || []).some((sec) => sec.lines.some((l) => fold(l.text).includes(q))));
    const sort = $('lSort').value;
    const cmp = (a, b) => String(a || '').localeCompare(String(b || ''), 'sr', { sensitivity: 'base' });
    if (sort === 'title') list.sort((a, b) => cmp(a.title, b.title));
    else if (sort === 'artist') list.sort((a, b) => cmp(a.artist, b.artist) || cmp(a.title, b.title));
    else list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!all.length) {
      $('lList').innerHTML = `<li class="empty">
        <p><b>${t('lib.empty')}</b></p>
        <p class="muted">${t('lib.emptyHint')}</p></li>`;
      return;
    }
    if (!list.length) { $('lList').innerHTML = `<li class="empty muted">${esc(t('lib.noResults', { q: $('lSearch').value }))}</li>`; return; }
    $('lList').innerHTML = list.map((s) => `
      <li class="song-item">
        <a href="#/pesma/${encodeURIComponent(s.id)}" class="song-link">
          <span class="song-title">${esc(s.title)}</span>
          <span class="song-sub">${esc(s.artist || t('lib.unknownArtist'))}${s.key ? ` · <span class="key">${esc(s.key)}</span>` : ''}</span>
        </a>
        <button class="icon-btn" data-del="${esc(s.id)}" aria-label="${esc(t('lib.deleteSong', { title: s.title }))}">
          <svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9zm4 2v8h2v-8h-2zm4 0v8h2v-8h-2z"/></svg>
        </button>
      </li>`).join('');
  };

  $('lSearch').addEventListener('input', draw);
  $('lSort').addEventListener('change', () => { localStorageSet('gitara-sort', $('lSort').value); draw(); });
  $('lList').addEventListener('click', async (e) => {
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
  $('lScan').addEventListener('click', startScan);
  $('lImport').addEventListener('click', async () => { if (await importSongFile()) { all = await db.all(); draw(); } });
  $('lNew').addEventListener('click', () => {
    draft = { title: '', artist: '', key: '', sections: [{ name: t('lib.defaultSection'), lines: [] }] };
    draftImage = null;
    location.hash = '#/uredi/novo';
  });
  draw();
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
  const existing = (await db.all()).find((s) => norm(s.title) === norm(song.title));
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

async function shareSong(song) {
  const blob = new Blob([toSharedFile(song)], { type: 'application/json' });
  const r = await shareOrDownload(blob, safeFileName(song.title) + '.json', song.title);
  if (r === 'downloaded') toast(t('share.downloaded'));
}

// ---------------- Skeniranje ----------------
async function startScan() {
  const key = await getApiKey();
  if (!key) {
    const go = await dialog({
      title: t('scan.needKeyTitle'),
      body: t('scan.needKeyBody'),
      buttons: [{ label: t('common.later'), value: false }, { label: t('scan.openSettings'), value: true, kind: 'primary' }],
    });
    if (go) location.hash = '#/podesavanja';
    return;
  }
  if (navigator.onLine === false) {
    await dialog({ title: t('scan.offlineTitle'), body: t('scan.offlineBody') });
    return;
  }
  const how = await dialog({
    title: t('scan.title'),
    body: t('scan.howBody'),
    buttons: [{ label: t('scan.gallery'), value: 'gallery' }, { label: t('scan.camera'), value: 'camera', kind: 'primary' }],
  });
  if (!how) return;
  const file = await pickFile('image/*', how === 'camera' ? 'environment' : null);
  if (!file) return;

  await runScan(file);
}

/** Šalje sliku Geminiju; kada je Gemini zauzet ponavlja automatski, a na kraju nudi „Pokušaj ponovo“. */
async function runScan(file, prepared = null) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `<div class="modal scan-modal" role="dialog" aria-modal="true" aria-label="${t('scan.label')}">
    <div class="scan-preview"><div class="scan-line"></div></div>
    <p class="scan-msg"><span class="spinner"></span> <span id="scanText">${t('scan.reading')}</span></p>
    <div class="modal-actions"><button class="btn" id="scanCancel">${t('common.cancel')}</button></div></div>`;
  document.body.appendChild(overlay);
  const ctrl = new AbortController();
  overlay.querySelector('#scanCancel').addEventListener('click', () => ctrl.abort());
  let img = prepared;
  try {
    if (!img) img = await prepareImage(file);
    overlay.querySelector('.scan-preview').style.backgroundImage = `url(${img.preview})`;
    const song = await scanSong(img, ctrl.signal, () => {
      overlay.querySelector('#scanText').textContent = t('scan.busy');
    });
    draft = song;
    draftImage = img.preview;
    overlay.remove();
    location.hash = '#/uredi/sken';
  } catch (e) {
    overlay.remove();
    if (e && e.name === 'AbortError') return;
    const busy = e instanceof GeminiError && e.code === 'BUSY';
    const again = await dialog({
      title: busy ? t('scan.busyTitle') : t('scan.failedTitle'),
      body: e instanceof GeminiError ? e.message : t('common.error'),
      buttons: busy && img
        ? [{ label: t('common.cancel'), value: false }, { label: t('common.retry'), value: true, kind: 'primary' }]
        : [{ label: t('common.ok'), value: false, kind: 'primary' }],
    });
    if (again) return runScan(file, img);
  }
}

// ---------------- Prikaz linija sa akordima ----------------
function chordSpan(c) {
  return `<button class="ch" data-chord="${esc(c)}">${esc(c)}</button>`;
}

export function renderLineHTML(line) {
  const chords = [...(line.chords || [])].sort((a, b) => a.position - b.position);
  const text = line.text || '';
  if (!chords.length) return text.trim() ? `<div class="ln"><span class="tx">${esc(text)}</span></div>` : '<div class="ln blank"></div>';
  if (!text.trim()) {
    return `<div class="ln chords-only">${chords.map((c) => chordSpan(c.chord)).join('<span class="gap"> </span>')}</div>`;
  }
  const lastPos = chords[chords.length - 1].position;
  const t = text.length < lastPos ? text.padEnd(lastPos, ' ') : text;
  // Delovi: granice na pozicijama akorda i posle svakog razmaka.
  const cuts = new Set([0, t.length]);
  chords.forEach((c) => cuts.add(Math.min(c.position, t.length)));
  for (let i = 0; i < t.length; i++) if (t[i] === ' ' && i + 1 < t.length) cuts.add(i + 1);
  const pts = [...cuts].sort((a, b) => a - b);
  const chunks = [];
  for (let i = 0; i < pts.length - 1; i++) chunks.push({ start: pts[i], text: t.slice(pts[i], pts[i + 1]), chords: [] });
  if (!chunks.length) chunks.push({ start: 0, text: '', chords: [] });
  for (const c of chords) {
    let target = chunks.find((ch) => ch.start === Math.min(c.position, t.length));
    if (!target) target = chunks[chunks.length - 1];
    target.chords.push(c.chord);
  }
  // Grupisanje u reči (da se reč ne lomi između slogova)
  let html = '<div class="ln">';
  let open = false;
  chunks.forEach((ch, i) => {
    const prev = chunks[i - 1];
    const newWord = !prev || prev.text.endsWith(' ');
    if (newWord) { if (open) html += '</span>'; html += '<span class="w">'; open = true; }
    const chordsHtml = ch.chords.map(chordSpan).join(' ');
    html += `<span class="seg"><span class="cr">${chordsHtml || '&#8203;'}</span><span class="tx">${esc(ch.text) || '&#8203;'}</span></span>`;
  });
  if (open) html += '</span>';
  return html + '</div>';
}

export function renderSectionsHTML(sections) {
  return (sections || []).map((s) => `
    <div class="sec">
      ${s.name || s.strum ? `<div class="sec-head">${s.name ? `<div class="sec-name">${esc(s.name)}</div>` : ''}${s.strum ? patternHTML(s.strum, { compact: true }) : ''}</div>` : ''}
      ${s.lines.map(renderLineHTML).join('')}
    </div>`).join('');
}

// ---------------- Uvećan dijagram ----------------
function showChord(name) {
  const n = voicingCount(name);
  let v = 0;
  const canon = canonicalName(name);
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  const p = parseChord(name);
  const draw = () => {
    wrap.innerHTML = `<div class="modal chord-modal" role="dialog" aria-modal="true" aria-label="${esc(t('diagram.chord', { name }))}">
      <div class="chord-big">${chordSVG(name, { voicing: v })}</div>
      ${canon !== name ? `<p class="muted center">${t('chordModal.same')} <b>${esc(canon)}</b></p>` : ''}
      ${p && p.bass !== null ? `<p class="muted center small">${esc(t('chordModal.bass', { bass: name.split('/')[1] }))}</p>` : ''}
      ${n === 0 ? `<p class="muted center">${t('chordModal.none')}</p>` : ''}
      <div class="modal-actions">
        ${n > 1 ? `<button class="btn" data-a="next">${t('chordModal.next', { i: (v % n) + 1, n })}</button>` : ''}
        <button class="btn primary" data-a="close">${t('common.close')}</button>
      </div></div>`;
  };
  draw();
  wrap.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]');
    if (e.target === wrap || (a && a.dataset.a === 'close')) return wrap.remove();
    if (a && a.dataset.a === 'next') { v++; draw(); }
  });
  document.body.appendChild(wrap);
}

// ---------------- Prikaz pesme ----------------
export async function renderSong(root, id, nav = null) {
  const stored = await db.get(id);
  if (!stored) {
    root.innerHTML = `<section class="view"><p>${t('song.notFound')}</p><a class="btn" href="#/pesme">${t('song.back')}</a></section>`;
    return;
  }
  let tp = stored.transpose || 0;
  let capo = stored.capo || 0;
  let speed = stored.scrollSpeed || 4;
  const backHref = nav ? nav.backHref : '#/pesme';
  root.innerHTML = `
  <section class="view song-view">
    <header class="topbar">
      <a href="${backHref}" class="back" aria-label="${t('song.back')}">${nav ? esc(nav.backLabel) : t('song.backShort')}</a>
      <div class="topbar-actions">
        <button class="btn small" id="sFontDown" aria-label="${t('song.fontDown')}">A−</button>
        <button class="btn small" id="sFontUp" aria-label="${t('song.fontUp')}">A+</button>
        <a class="btn small" href="#/uredi/${encodeURIComponent(id)}">${t('song.edit')}</a>
      </div>
    </header>
    ${nav ? `<div class="setlist-nav card">
      <a class="btn small ${nav.prevHref ? '' : 'disabled'}" ${nav.prevHref ? `href="${nav.prevHref}"` : 'aria-disabled="true"'}>‹ ${t('sl.prev')}</a>
      <span class="small muted">${esc(nav.title)} · ${nav.index + 1}/${nav.count}</span>
      <a class="btn small ${nav.nextHref ? 'primary' : 'disabled'}" ${nav.nextHref ? `href="${nav.nextHref}"` : 'aria-disabled="true"'}>${t('sl.next')} ›</a>
    </div>` : ''}
    <div id="sBody"></div>
    <div class="scroll-bar" id="sScrollBar">
      <button class="btn round small" id="sPlay" aria-label="${t('scroll.play')}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
      <span class="small muted">${t('scroll.slower')}</span>
      <input type="range" id="sSpeed" min="1" max="10" step="1" value="${speed}" aria-label="${t('scroll.speed')}">
      <span class="small muted">${t('scroll.faster')}</span>
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
  const soundingKey = () => (stored.key ? transposeSong({ key: stored.key, sections: [] }, tp).key : '');

  const draw = () => {
    const song = shapesSong();
    const chords = songChords(song);
    const prog = progressionSummary(song);
    const key = soundingKey();
    $('sBody').innerHTML = `
      <h1 class="song-h1">${esc(song.title)}</h1>
      <p class="song-meta">${esc(song.artist || '')}${key ? `${song.artist ? ' · ' : ''}${t('song.key')} <b>${esc(key)}</b>` : ''}${capo && key ? ` · ${t('capo.shapes')} <b>${esc(song.key)}</b>` : ''}</p>
      <div class="song-controls">
        <div class="transpose" role="group" aria-label="${t('song.transpose')}">
          <button class="btn round small" id="tDown" aria-label="${t('song.transposeDown')}">−</button>
          <div class="t-label">${t('song.transpose')}<br><b>${tp > 0 ? '+' + tp : tp}</b></div>
          <button class="btn round small" id="tUp" aria-label="${t('song.transposeUp')}">+</button>
          ${tp ? `<button class="btn small" id="tReset">${t('song.original')}</button>` : ''}
        </div>
        <div class="transpose" role="group" aria-label="${t('capo.title')}">
          <button class="btn round small" id="cDown" aria-label="${t('capo.down')}">−</button>
          <div class="t-label">${t('capo.title')}<br><b>${capo || t('capo.none')}</b></div>
          <button class="btn round small" id="cUp" aria-label="${t('capo.up')}">+</button>
        </div>
      </div>
      ${capo ? `<p class="capo-note small">${t('capo.note', { n: capo })}</p>` : ''}
      <div class="strum-box card">
        ${stored.strum ? `<div class="strum-head"><span class="small muted">${t('strum.label')}</span> <b>${esc(patternName(stored.strum))}</b> <span class="small muted">${stored.strum.sig}</span>
          <button class="icon-btn pat-play" id="sStrumPlay" aria-label="${t('pat.play')}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button></div>
          ${patternHTML(stored.strum)}` : ''}
        <button class="btn small" id="sStrumEdit">${stored.strum || stored.sections.some((x) => x.strum) ? t('strum.change') : t('strum.add')}</button>
      </div>
      ${prog.length ? `<div class="prog card">${prog.map((p) => `<div class="prog-row"><span class="prog-name">${esc(p.name || t('song.chordsFallback'))}</span><span class="prog-chords">${p.chords.map((c) => `<button class="ch" data-chord="${esc(c)}">${esc(c)}</button>`).join('<span class="arrow">→</span>')}</span></div>`).join('')}</div>` : ''}
      ${chords.length ? `<div class="diagram-row" aria-label="${t('song.diagrams')}">${chords.map((c) => `<button class="diagram-btn" data-chord="${esc(c)}" aria-label="${esc(t('song.enlarge', { name: c }))}">${chordSVG(c)}</button>`).join('')}</div>` : ''}
      <div class="lyrics" id="sLyrics" style="font-size:${(fontScale * 100).toFixed(0)}%">${renderSectionsHTML(song.sections)}</div>`;
  };
  draw();

  const save = () => db.put(stored);
  const setT = async (n) => { tp = ((n + 17) % 12 + 12) % 12 - 5; stored.transpose = tp; draw(); await save(); };
  const setCapo = async (n) => {
    capo = Math.max(0, Math.min(7, n));
    if (capo) stored.capo = capo; else delete stored.capo;
    draw();
    await save();
  };

  // ---- Ritam (strumming) ----
  let strumMet = null;
  const stopStrum = () => { strumMet?.stop(); strumMet = null; root.querySelectorAll('.strum-box .pstep.now').forEach((x) => x.classList.remove('now')); $('sStrumPlay')?.classList.remove('playing'); };
  const playStrum = () => {
    if (strumMet) return stopStrum();
    strumMet = new Metronome();
    strumMet.pattern = stored.strum;
    strumMet.sig = stored.strum.sig;
    settings.get('metBpm', 90).then((b) => { if (!strumMet) return; strumMet.bpm = b; strumMet.start(); });
    $('sStrumPlay')?.classList.add('playing');
    strumMet.onStep = (i) => root.querySelectorAll('.strum-box .pstep').forEach((s) => s.classList.toggle('now', +s.dataset.i === i));
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
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) return stopScroll();
    raf = requestAnimationFrame(step);
  }
  function startScroll() {
    scrolling = true; last = 0; carry = 0;
    $('sPlay').classList.add('playing');
    $('sPlay').innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
    $('sPlay').setAttribute('aria-label', t('scroll.pause'));
    keepAwake('autoscroll');
    raf = requestAnimationFrame(step);
  }
  function stopScroll() {
    if (!scrolling) return;
    scrolling = false;
    cancelAnimationFrame(raf);
    allowSleep('autoscroll');
    const b = $('sPlay');
    if (!b) return;
    b.classList.remove('playing');
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    b.setAttribute('aria-label', t('scroll.play'));
  }
  $('sPlay').addEventListener('click', (e) => { e.stopPropagation(); scrolling ? stopScroll() : startScroll(); });
  $('sSpeed').addEventListener('input', (e) => { speed = +e.target.value; });
  $('sSpeed').addEventListener('change', async () => { stored.scrollSpeed = speed; await save(); });
  // Dodir bilo gde na tekstu pauzira skrolovanje
  $('sBody').addEventListener('pointerdown', () => stopScroll());
  const onHash = () => { stopScroll(); stopStrum(); window.removeEventListener('hashchange', onHash); };
  window.addEventListener('hashchange', onHash);

  root.querySelector('.song-view').addEventListener('click', (e) => {
    const c = e.target.closest('[data-chord]');
    if (c) return showChord(c.dataset.chord);
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'tUp') setT(tp + 1);
    else if (b.id === 'tDown') setT(tp - 1);
    else if (b.id === 'tReset') setT(0);
    else if (b.id === 'cUp') setCapo(capo + 1);
    else if (b.id === 'cDown') setCapo(capo - 1);
    else if (b.id === 'sStrumPlay') playStrum();
    else if (b.id === 'sStrumEdit') editStrum();
  });
  const setFont = (d) => {
    fontScale = Math.min(1.8, Math.max(0.7, +(fontScale + d).toFixed(2)));
    localStorageSet('gitara-font', fontScale);
    root.querySelector('.lyrics').style.fontSize = (fontScale * 100).toFixed(0) + '%';
  };
  $('sFontUp').addEventListener('click', () => setFont(0.1));
  $('sFontDown').addEventListener('click', () => setFont(-0.1));

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
        capoLabel: capo ? t('pdf.capo', { n: capo }) : '',
      });
      const r = await shareOrDownload(blob, safeFileName(song.title) + '.pdf', song.title);
      if (r === 'downloaded') toast(t('song.pdfDownloaded'));
      // Ako je Google Drive povezan, PDF se čuva i u folder „Gitara“ (isti fajl se zamenjuje).
      if (driveState().connected) {
        savePdfToDrive(blob, { ...song, id: stored.id })
          .then(() => toast(t('song.pdfDrive')))
          .catch((e) => toast(e instanceof DriveError ? t('song.pdfDriveFailed', { msg: e.message }) : t('song.pdfDriveFailedGeneric'), 'error'));
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

// ---------------- Uređivanje ("Proveri i ispravi") ----------------
export async function renderEditor(root, id) {
  let song;
  let isNew = false;
  if (id === 'sken' || id === 'novo') {
    if (!draft) { location.hash = '#/pesme'; return; }
    song = draft;
    isNew = true;
  } else {
    song = await db.get(id);
    if (!song) { location.hash = '#/pesme'; return; }
  }
  const scanned = id === 'sken';
  root.innerHTML = `
  <section class="view editor-view">
    <header class="topbar">
      <button class="back" id="eCancel">${t('edit.cancel')}</button>
      <div class="topbar-actions"><button class="btn primary" id="eSave">${t('common.save')}</button></div>
    </header>
    <h1>${scanned ? t('edit.titleScanned') : isNew ? t('edit.titleNew') : t('edit.titleEdit')}</h1>
    ${scanned ? `<p class="muted">${t('edit.scannedHint')}</p>` : ''}
    ${draftImage && scanned ? `<details class="card photo-ref"><summary>${t('edit.showPhoto')}</summary><img src="${draftImage}" alt="${t('edit.photoAlt')}"></details>` : ''}
    <div class="form">
      <label>${t('edit.fTitle')}<input id="eTitle" value="${esc(song.title)}" placeholder="${t('edit.fTitlePh')}" autocomplete="off"></label>
      <div class="row">
        <label class="grow">${t('edit.fArtist')}<input id="eArtist" value="${esc(song.artist)}" placeholder="${t('edit.fArtist')}" autocomplete="off"></label>
        <label class="key-input">${t('edit.fKey')}<input id="eKey" value="${esc(song.key)}" placeholder="${t('edit.fKeyPh')}" autocomplete="off"></label>
      </div>
    </div>
    <div class="seg-tabs" role="tablist">
      <button role="tab" class="active" data-tab="edit">${t('edit.tabEdit')}</button>
      <button role="tab" data-tab="preview">${t('edit.tabPreview')}</button>
    </div>
    <div id="eEditPane">
      <textarea id="eText" class="mono-editor" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="${t('edit.textLabel')}"></textarea>
      <div id="eWarn" class="warn small"></div>
      <details class="help small">
        <summary>${t('edit.howTo')}</summary>
        <p>${t('edit.howToBody')}</p>
        <pre>${esc(t('edit.example'))}</pre>
      </details>
    </div>
    <div id ="ePreviewPane" class="lyrics" hidden></div>
  </section>`;
  const $ = (q) => root.querySelector('#' + q);
  $('eText').value = sectionsToText(song.sections);
  autoGrow($('eText'));

  const validate = () => {
    const secs = textToSections($('eText').value);
    const unknown = new Set();
    // Reči koje liče na akorde u redu sa akordima, a nisu prepoznate
    for (const line of $('eText').value.split('\n')) {
      const toks = line.trim().split(/\s+/).filter(Boolean);
      const chordish = toks.filter((t) => /^[A-H]/.test(t));
      if (toks.length && chordish.length === toks.length && toks.some((t) => isChord(t))) {
        toks.filter((t) => !isChord(t.replace(/^\(|\)$/g, ''))).forEach((t) => unknown.add(t));
      }
    }
    $('eWarn').textContent = unknown.size ? t('edit.unknownChords', { list: [...unknown].join(', ') }) : '';
    return secs;
  };
  $('eText').addEventListener('input', () => { autoGrow($('eText')); validate(); });
  validate();

  root.querySelectorAll('.seg-tabs button').forEach((b) => b.addEventListener('click', () => {
    root.querySelectorAll('.seg-tabs button').forEach((x) => x.classList.toggle('active', x === b));
    const preview = b.dataset.tab === 'preview';
    $('eEditPane').hidden = preview;
    $('ePreviewPane').hidden = !preview;
    if (preview) $('ePreviewPane').innerHTML = renderSectionsHTML(validate()) || `<p class="muted">${t('edit.noText')}</p>`;
  }));

  const dirty = () => $('eText').value !== sectionsToText(song.sections) || $('eTitle').value !== (song.title || '');
  $('eCancel').addEventListener('click', async () => {
    if (dirty() || scanned) {
      const ok = await confirmDialog(t('edit.discardTitle'), scanned ? t('edit.discardScanned') : t('edit.discardBody'), t('edit.discard'), 'danger');
      if (!ok) return;
    }
    draft = null; draftImage = null;
    history.length > 1 ? history.back() : (location.hash = isNew ? '#/pesme' : `#/pesma/${encodeURIComponent(id)}`);
  });
  $('eSave').addEventListener('click', async () => {
    const sections = validate();
    if (!sections.length) { toast(t('edit.empty'), 'error'); return; }
    const title = $('eTitle').value.trim() || t('common.untitled');
    // Zadrži ritam po delovima (po nazivu dela) i ostala podešavanja pesme.
    const oldSecs = song.sections || [];
    sections.forEach((sec, i) => {
      const old = oldSecs.find((o) => o.name === sec.name && o.strum) || (oldSecs[i] && oldSecs[i].name === sec.name ? oldSecs[i] : null);
      if (old && old.strum) sec.strum = old.strum;
    });
    const rec = await db.save({
      ...(isNew ? songExtras(song) : song),
      title,
      artist: $('eArtist').value.trim(),
      key: $('eKey').value.trim(),
      sections,
    });
    draft = null; draftImage = null;
    toast(t('edit.saved'));
    location.replace(`#/pesma/${encodeURIComponent(rec.id)}`);
  });
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.max(240, el.scrollHeight + 4) + 'px';
}

// Za podešavanja: izvoz/uvoz svih pesama
export async function exportAll() {
  const all = await db.all();
  const data = JSON.stringify({ app: 'gitara', version: 1, backup: true, exportedAt: new Date().toISOString(), songs: all.map((sg) => ({ title: sg.title, artist: sg.artist, key: sg.key, sections: sg.sections, transpose: sg.transpose, ...songExtras(sg) })) }, null, 1);
  return shareOrDownload(new Blob([data], { type: 'application/json' }), `gitara-pesme-${new Date().toISOString().slice(0, 10)}.json`, t('export.allTitle'));
}

export { importSongFile, layoutChordLine };
