// Tab "Pesme": biblioteka, prikaz pesme, uređivanje, skeniranje, deljenje i uvoz.
import { songs as db } from './db.js';
import { esc, toast, dialog, confirmDialog, pickFile, shareOrDownload } from './ui.js';
import { chordSVG, voicingCount } from './diagram.js';
import { isChord, parseChord, canonicalName } from './music.js';
import {
  textToSections, sectionsToText, songChords, progressionSummary, transposeSong,
  parseSharedFile, toSharedFile, safeFileName, SongFormatError, layoutChordLine,
} from './songformat.js';
import { scanSong, prepareImage, getApiKey, GeminiError } from './gemini.js';
import { driveState, savePdfToDrive, DriveError } from './drive.js';

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
    <header class="view-head"><h1>Pesme</h1></header>
    <div class="lib-actions">
      <button class="btn primary big" id="lScan">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3 7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>
        Skeniraj pesmu
      </button>
      <div class="row">
        <button class="btn" id="lImport">Uvezi pesmu</button>
        <button class="btn" id="lNew">Nova pesma</button>
      </div>
    </div>
    <div class="lib-tools">
      <input type="search" id="lSearch" placeholder="Pretraži naslov, izvođača ili tekst" aria-label="Pretraga">
      <select id="lSort" aria-label="Sortiranje">
        <option value="new">Najnovije</option>
        <option value="title">Naslov A–Ž</option>
        <option value="artist">Izvođač A–Ž</option>
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
        <p><b>Još nema pesama.</b></p>
        <p class="muted">Slikaj rukom pisanu pesmu sa akordima, uvezi pesmu koju ti je neko poslao ili je unesi ručno.</p></li>`;
      return;
    }
    if (!list.length) { $('lList').innerHTML = `<li class="empty muted">Nema rezultata za „${esc($('lSearch').value)}“.</li>`; return; }
    $('lList').innerHTML = list.map((s) => `
      <li class="song-item">
        <a href="#/pesma/${encodeURIComponent(s.id)}" class="song-link">
          <span class="song-title">${esc(s.title)}</span>
          <span class="song-sub">${esc(s.artist || 'Nepoznat izvođač')}${s.key ? ` · <span class="key">${esc(s.key)}</span>` : ''}</span>
        </a>
        <button class="icon-btn" data-del="${esc(s.id)}" aria-label="Obriši pesmu ${esc(s.title)}">
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
    if (!(await confirmDialog('Obrisati pesmu?', `„${s.title}“ će biti trajno obrisana sa ovog uređaja.`, 'Obriši', 'danger'))) return;
    await db.remove(s.id);
    all = all.filter((x) => x.id !== s.id);
    toast('Pesma je obrisana.');
    draw();
  });
  $('lScan').addEventListener('click', startScan);
  $('lImport').addEventListener('click', async () => { if (await importSongFile()) { all = await db.all(); draw(); } });
  $('lNew').addEventListener('click', () => {
    draft = { title: '', artist: '', key: '', sections: [{ name: 'Strofa 1', lines: [] }] };
    draftImage = null;
    location.hash = '#/uredi/novo';
  });
  draw();
}

// ---------------- Uvoz / deljenje ----------------
async function importSongFile() {
  const file = await pickFile('.json,application/json,text/plain');
  if (!file) return false;
  if (file.size > 2 * 1024 * 1024) { await dialog({ title: 'Fajl nije ispravan', body: 'Fajl je prevelik da bi bio pesma iz aplikacije Gitara.' }); return false; }
  let song;
  try {
    song = parseSharedFile(await file.text());
  } catch (e) {
    await dialog({ title: 'Fajl nije ispravan', body: e instanceof SongFormatError ? e.message : 'Ovaj fajl ne može da se učita. Izaberi .json fajl pesme iz aplikacije Gitara.' });
    return false;
  }
  const existing = (await db.all()).find((s) => norm(s.title) === norm(song.title));
  if (existing) {
    const choice = await dialog({
      title: 'Pesma već postoji',
      body: `U biblioteci već postoji pesma „${existing.title}“. Da li želiš da je zameniš novom ili da zadržiš obe?`,
      buttons: [{ label: 'Otkaži', value: null }, { label: 'Zadrži obe', value: 'both' }, { label: 'Zameni', value: 'replace', kind: 'primary' }],
    });
    if (!choice) return false;
    if (choice === 'replace') {
      await db.save({ ...song, id: existing.id, createdAt: existing.createdAt });
      toast(`Pesma „${song.title}“ je zamenjena.`);
      return true;
    }
  }
  await db.save(song);
  toast(`Pesma „${song.title}“ je dodata.`);
  return true;
}

async function shareSong(song) {
  const blob = new Blob([toSharedFile(song)], { type: 'application/json' });
  const r = await shareOrDownload(blob, safeFileName(song.title) + '.json', song.title);
  if (r === 'downloaded') toast('Fajl pesme je preuzet.');
}

// ---------------- Skeniranje ----------------
async function startScan() {
  const key = await getApiKey();
  if (!key) {
    const go = await dialog({
      title: 'Potreban je Gemini ključ',
      body: 'Za skeniranje pesama potreban je besplatan Google Gemini API ključ. Unesi ga jednom u „Podešavanjima“.',
      buttons: [{ label: 'Kasnije', value: false }, { label: 'Otvori Podešavanja', value: true, kind: 'primary' }],
    });
    if (go) location.hash = '#/podesavanja';
    return;
  }
  if (navigator.onLine === false) {
    await dialog({ title: 'Nema interneta', body: 'Skeniranje pesama radi samo kada si povezan na internet. Ostatak aplikacije radi i bez interneta.' });
    return;
  }
  const how = await dialog({
    title: 'Skeniraj pesmu',
    body: 'Slikaj papir sa pesmom ili izaberi fotografiju iz galerije. Najbolje je da papir bude ravan i dobro osvetljen.',
    buttons: [{ label: 'Iz galerije', value: 'gallery' }, { label: 'Slikaj', value: 'camera', kind: 'primary' }],
  });
  if (!how) return;
  const file = await pickFile('image/*', how === 'camera' ? 'environment' : null);
  if (!file) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `<div class="modal scan-modal" role="dialog" aria-modal="true" aria-label="Skeniranje">
    <div class="scan-preview"><div class="scan-line"></div></div>
    <p class="scan-msg"><span class="spinner"></span> Čitam pesmu… ovo može da potraje 10–30 sekundi.</p>
    <div class="modal-actions"><button class="btn" id="scanCancel">Otkaži</button></div></div>`;
  document.body.appendChild(overlay);
  const ctrl = new AbortController();
  overlay.querySelector('#scanCancel').addEventListener('click', () => ctrl.abort());
  try {
    const img = await prepareImage(file);
    overlay.querySelector('.scan-preview').style.backgroundImage = `url(${img.preview})`;
    const song = await scanSong(img, ctrl.signal);
    draft = song;
    draftImage = img.preview;
    overlay.remove();
    location.hash = '#/uredi/sken';
  } catch (e) {
    overlay.remove();
    if (e && e.name === 'AbortError') return;
    await dialog({ title: 'Skeniranje nije uspelo', body: e instanceof GeminiError ? e.message : 'Došlo je do greške. Pokušaj ponovo.' });
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
      ${s.name ? `<div class="sec-name">${esc(s.name)}</div>` : ''}
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
    wrap.innerHTML = `<div class="modal chord-modal" role="dialog" aria-modal="true" aria-label="Akord ${esc(name)}">
      <div class="chord-big">${chordSVG(name, { voicing: v })}</div>
      ${canon !== name ? `<p class="muted center">Isto što i <b>${esc(canon)}</b></p>` : ''}
      ${p && p.bass !== null ? `<p class="muted center small">Bas ton: ${esc(name.split('/')[1])} (prikazan je osnovni akord)</p>` : ''}
      ${n === 0 ? '<p class="muted center">Za ovaj akord nema dijagrama u biblioteci.</p>' : ''}
      <div class="modal-actions">
        ${n > 1 ? `<button class="btn" data-a="next">Drugi položaj (${(v % n) + 1}/${n})</button>` : ''}
        <button class="btn primary" data-a="close">Zatvori</button>
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
export async function renderSong(root, id) {
  const stored = await db.get(id);
  if (!stored) {
    root.innerHTML = `<section class="view"><p>Pesma nije pronađena.</p><a class="btn" href="#/pesme">Nazad na pesme</a></section>`;
    return;
  }
  let t = stored.transpose || 0;
  root.innerHTML = `
  <section class="view song-view">
    <header class="topbar">
      <a href="#/pesme" class="back" aria-label="Nazad na pesme">‹ Pesme</a>
      <div class="topbar-actions">
        <button class="btn small" id="sFontDown" aria-label="Manja slova">A−</button>
        <button class="btn small" id="sFontUp" aria-label="Veća slova">A+</button>
        <a class="btn small" href="#/uredi/${encodeURIComponent(id)}">Uredi</a>
      </div>
    </header>
    <div id="sBody"></div>
    <div class="song-actions">
      <button class="btn primary" id="sPdf">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg> Skini PDF</button>
      <button class="btn" id="sShare">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7l-6.7 3.4a3 3 0 1 0 0 3.2L15 17a3 3 0 1 0 3-1z"/></svg> Podeli pesmu</button>
    </div>
  </section>`;
  const $ = (q) => root.querySelector('#' + q);

  const draw = () => {
    const song = transposeSong(stored, t);
    const chords = songChords(song);
    const prog = progressionSummary(song);
    $('sBody').innerHTML = `
      <h1 class="song-h1">${esc(song.title)}</h1>
      <p class="song-meta">${esc(song.artist || '')}${song.key ? `${song.artist ? ' · ' : ''}Tonalitet: <b>${esc(song.key)}</b>` : ''}</p>
      <div class="transpose" role="group" aria-label="Transpozicija">
        <button class="btn round" id="tDown" aria-label="Transponuj pola stepena niže">−</button>
        <div class="t-label">Transpozicija<br><b>${t > 0 ? '+' + t : t}</b></div>
        <button class="btn round" id="tUp" aria-label="Transponuj pola stepena više">+</button>
        ${t ? '<button class="btn small" id="tReset">Original</button>' : ''}
      </div>
      ${prog.length ? `<div class="prog card">${prog.map((p) => `<div class="prog-row"><span class="prog-name">${esc(p.name || 'Akordi')}</span><span class="prog-chords">${p.chords.map((c) => `<button class="ch" data-chord="${esc(c)}">${esc(c)}</button>`).join('<span class="arrow">→</span>')}</span></div>`).join('')}</div>` : ''}
      ${chords.length ? `<div class="diagram-row" aria-label="Dijagrami akorda">${chords.map((c) => `<button class="diagram-btn" data-chord="${esc(c)}" aria-label="Uvećaj akord ${esc(c)}">${chordSVG(c)}</button>`).join('')}</div>` : ''}
      <div class="lyrics" style="font-size:${(fontScale * 100).toFixed(0)}%">${renderSectionsHTML(song.sections)}</div>`;
  };
  draw();

  const setT = async (n) => {
    t = ((n + 17) % 12 + 12) % 12 - 5; // opseg −5…+6
    draw();
    stored.transpose = t;
    await db.put(stored);
  };
  root.querySelector('.song-view').addEventListener('click', (e) => {
    const c = e.target.closest('[data-chord]');
    if (c) return showChord(c.dataset.chord);
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'tUp') setT(t + 1);
    else if (b.id === 'tDown') setT(t - 1);
    else if (b.id === 'tReset') setT(0);
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
    btn.innerHTML = '<span class="spinner"></span> Pravim PDF…';
    try {
      const { songToPdf } = await import('./pdf.js');
      const song = transposeSong(stored, t);
      const blob = await songToPdf(song, { transposeLabel: t ? `Transpozicija ${t > 0 ? '+' : ''}${t}` : '' });
      const r = await shareOrDownload(blob, safeFileName(song.title) + '.pdf', song.title);
      if (r === 'downloaded') toast('PDF je preuzet.');
      // Ako je Google Drive povezan, PDF se čuva i u folder „Gitara“ (isti fajl se zamenjuje).
      if (driveState().connected) {
        savePdfToDrive(blob, { ...song, id: stored.id })
          .then(() => toast('PDF je sačuvan i na Google Drive.'))
          .catch((e) => toast(e instanceof DriveError ? `PDF nije sačuvan na Drive: ${e.message}` : 'PDF nije sačuvan na Google Drive.', 'error'));
      }
    } catch (e) {
      console.error(e);
      toast('PDF nije moguće napraviti. Pokušaj ponovo.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = old;
    }
  });
  $('sShare').addEventListener('click', () => shareSong(stored).catch(() => toast('Deljenje nije uspelo.', 'error')));
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
      <button class="back" id="eCancel">‹ Otkaži</button>
      <div class="topbar-actions"><button class="btn primary" id="eSave">Sačuvaj</button></div>
    </header>
    <h1>${scanned ? 'Proveri i ispravi' : isNew ? 'Nova pesma' : 'Uredi pesmu'}</h1>
    ${scanned ? '<p class="muted">Uporedi prepis sa slikom i ispravi tekst i akorde pre čuvanja.</p>' : ''}
    ${draftImage && scanned ? `<details class="card photo-ref"><summary>Prikaži fotografiju</summary><img src="${draftImage}" alt="Skenirana pesma"></details>` : ''}
    <div class="form">
      <label>Naslov<input id="eTitle" value="${esc(song.title)}" placeholder="Naslov pesme" autocomplete="off"></label>
      <div class="row">
        <label class="grow">Izvođač<input id="eArtist" value="${esc(song.artist)}" placeholder="Izvođač" autocomplete="off"></label>
        <label class="key-input">Tonalitet<input id="eKey" value="${esc(song.key)}" placeholder="npr. Am" autocomplete="off"></label>
      </div>
    </div>
    <div class="seg-tabs" role="tablist">
      <button role="tab" class="active" data-tab="edit">Tekst i akordi</button>
      <button role="tab" data-tab="preview">Pregled</button>
    </div>
    <div id="eEditPane">
      <textarea id="eText" class="mono-editor" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="Tekst pesme sa akordima"></textarea>
      <div id="eWarn" class="warn small"></div>
      <details class="help small">
        <summary>Kako se piše?</summary>
        <p>Svaki red sa akordima stoji iznad reda sa tekstom. Akord stoji tačno iznad slova gde se menja. Naslov dela piši u uglastim zagradama.</p>
        <pre>[Refren]
Am        F
Pevam ti pesmu
C         G
ispod tvog prozora</pre>
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
    $('eWarn').textContent = unknown.size ? `Nepoznati akordi: ${[...unknown].join(', ')} — proveri da li su dobro napisani.` : '';
    return secs;
  };
  $('eText').addEventListener('input', () => { autoGrow($('eText')); validate(); });
  validate();

  root.querySelectorAll('.seg-tabs button').forEach((b) => b.addEventListener('click', () => {
    root.querySelectorAll('.seg-tabs button').forEach((x) => x.classList.toggle('active', x === b));
    const preview = b.dataset.tab === 'preview';
    $('eEditPane').hidden = preview;
    $('ePreviewPane').hidden = !preview;
    if (preview) $('ePreviewPane').innerHTML = renderSectionsHTML(validate()) || '<p class="muted">Nema teksta.</p>';
  }));

  const dirty = () => $('eText').value !== sectionsToText(song.sections) || $('eTitle').value !== (song.title || '');
  $('eCancel').addEventListener('click', async () => {
    if (dirty() || scanned) {
      const ok = await confirmDialog('Odbaciti izmene?', scanned ? 'Skenirana pesma neće biti sačuvana.' : 'Izmene neće biti sačuvane.', 'Odbaci', 'danger');
      if (!ok) return;
    }
    draft = null; draftImage = null;
    history.length > 1 ? history.back() : (location.hash = isNew ? '#/pesme' : `#/pesma/${encodeURIComponent(id)}`);
  });
  $('eSave').addEventListener('click', async () => {
    const sections = validate();
    if (!sections.length) { toast('Pesma je prazna — dodaj tekst ili akorde.', 'error'); return; }
    const title = $('eTitle').value.trim() || 'Bez naslova';
    const rec = await db.save({
      ...(isNew ? {} : song),
      title,
      artist: $('eArtist').value.trim(),
      key: $('eKey').value.trim(),
      sections,
    });
    draft = null; draftImage = null;
    toast('Pesma je sačuvana.');
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
  const data = JSON.stringify({ app: 'gitara', version: 1, backup: true, exportedAt: new Date().toISOString(), songs: all.map(({ title, artist, key, sections, transpose }) => ({ title, artist, key, sections, transpose })) }, null, 1);
  return shareOrDownload(new Blob([data], { type: 'application/json' }), `gitara-pesme-${new Date().toISOString().slice(0, 10)}.json`, 'Gitara — sve pesme');
}

export { importSongFile, layoutChordLine };
