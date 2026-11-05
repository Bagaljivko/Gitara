// Pesme → uređivanje i skeniranje (učitava se tek kada zatreba: editor, skeniranje, Gemini).
import { songs as db, newSongId, versions } from './db.js';
import { findExisting } from './songIdentity.js';
import { esc, toast, dialog, confirmDialog, pickFiles, closeXHTML } from './ui.js';
import { textToSections, sectionsToText, songExtras, cleanUncertain } from './songformat.js';
import { scanSong, scanTab, prepareImage, getApiKey, GeminiError } from './gemini.js';
import './tabText.js'; // tekstovi za izbor vrste (Akordi / TAB) — mali modul, ostatak TAB koda se učitava tek kad zatreba
import { t } from './i18n.js';
import { layoutTabs, tabToAscii } from './tabs.js';
import { APP_VERSION } from './version.js';
import { dn, currentNaming } from './naming.js';
import { upgradeSong, needsUpgrade, snapshotOriginal, restoreOriginal, differsFromOriginal } from './songmodel.js';
import { readChord } from './chordnames.js';
import { TUNING_IDS, cleanTuning, tuningNotes } from './tunings.js';
import { renderSectionsHTML, applyUncertain } from './songs.js';

let draft = null; // nesačuvana pesma (npr. posle skeniranja)
let draftImage = null;
// posle skeniranja: obe vrste čitanja iste slike (Akordi / TAB) i slike za drugo čitanje — bez veza između nacrta
let drafts = { chords: null, tab: null }, draftImgs = null;

/** „Nova pesma“ iz biblioteke. */
export function newSongDraft() {
  draft = { title: '', artist: '', key: '', sections: [{ name: t('lib.defaultSection'), lines: [] }], __newId: newSongId() };
  draftImage = null;
  location.hash = '#/uredi/novo';
}

// ---------------- Skeniranje ----------------
export async function startScan() {
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
  const files = await pickFiles('image/*', how === 'camera' ? 'environment' : null);
  if (!files.length) return;
  const pages = await collectPages(files);
  if (pages) await runScan(pages);
}

const MAX_PAGES = 10;

/** Ekran sa stranama: pregled, dodavanje još strana, uklanjanje i redosled — pa skeniranje. */
async function collectPages(initial) {
  let files = initial.slice(0, MAX_PAGES);
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    const urls = new Map();
    const url = (f) => { if (!urls.has(f)) urls.set(f, URL.createObjectURL(f)); return urls.get(f); };
    const done = (v) => { wrap.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); resolve(v); };
    wrap.__close = () => done(null); // dugme „nazad“ = odustani
    const draw = () => {
      wrap.innerHTML = `<div class="modal pages-modal has-x" role="dialog" aria-modal="true" aria-label="${t('scan.pagesTitle')}">
        ${closeXHTML('data-a="cancel"')}
        <h2 class="modal-title">${t('scan.pagesTitle')}</h2>
        <p class="muted small">${t('scan.pagesHint')}</p>
        <div class="pages">${files.map((f, i) => `<div class="page-thumb">
          <img src="${url(f)}" alt="${esc(t('scan.page', { n: i + 1 }))}">
          <span class="page-n">${i + 1}</span>
          <button class="page-x" data-rm="${i}" aria-label="${esc(t('scan.removePage', { n: i + 1 }))}">✕</button>
          ${i > 0 ? `<button class="page-l" data-left="${i}" aria-label="${esc(t('scan.moveLeft'))}">‹</button>` : ''}
        </div>`).join('')}
        ${files.length < MAX_PAGES ? `<div class="page-add"><button class="btn small" data-add="camera">+ ${t('scan.camera')}</button><button class="btn small" data-add="gallery">+ ${t('scan.gallery')}</button></div>` : ''}
        </div>
        <div class="modal-actions">
          <button class="btn" data-a="cancel">${t('common.cancel')}</button>
          <button class="btn primary" data-a="scan" ${files.length ? '' : 'disabled'}>${t('scan.scanN', { n: files.length })}</button>
        </div></div>`;
    };
    wrap.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.rm !== undefined) { files.splice(+b.dataset.rm, 1); draw(); }
      else if (b.dataset.left !== undefined) { const i = +b.dataset.left; [files[i - 1], files[i]] = [files[i], files[i - 1]]; draw(); }
      else if (b.dataset.add) {
        const more = await pickFiles('image/*', b.dataset.add === 'camera' ? 'environment' : null);
        files = [...files, ...more].slice(0, MAX_PAGES);
        draw();
      } else if (b.dataset.a === 'cancel') done(null);
      else if (b.dataset.a === 'scan' && files.length) done(files);
    });
    draw();
    document.body.appendChild(wrap);
  });
}

/** Šalje sliku Geminiju; kada je Gemini zauzet ponavlja automatski, a na kraju nudi „Pokušaj ponovo“. */
async function runScan(files, prepared = null, opts = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `<div class="modal scan-modal" role="dialog" aria-modal="true" aria-label="${t('scan.label')}">
    <div class="scan-preview"><div class="scan-line"></div></div>
    <p class="scan-msg"><span class="spinner"></span> <span id="scanText">${t('scan.stepCompress')}</span> <span class="scan-secs" id="scanSecs"></span></p>
    <div class="modal-actions"><button class="btn" id="scanCancel">${t('common.cancel')}</button></div></div>`;
  overlay.__close = () => overlay.querySelector('#scanCancel')?.click(); // dugme „nazad“ = otkaži skeniranje
  document.body.appendChild(overlay);
  const ctrl = new AbortController();
  let cancelled = false;
  const t0 = performance.now();
  const secsTimer = setInterval(() => { const el = overlay.querySelector('#scanSecs'); if (el) el.textContent = `${Math.round((performance.now() - t0) / 1000)} s`; }, 1000);
  const close = () => { clearInterval(secsTimer); overlay.remove(); };
  overlay.querySelector('#scanCancel').addEventListener('click', () => { cancelled = true; ctrl.abort(); close(); });
  const setText = (txt) => { const el = overlay.querySelector('#scanText'); if (el) el.textContent = txt; };
  const diag = { at: new Date().toISOString(), images: [], attempts: [], selection: '', totalMs: 0 };
  let imgs = prepared;
  try {
    // 1) Smanji svaku sliku u pregledaču (najviše 1600 px, JPEG 0.8, ispod ~500 KB) — jednu po jednu, zbog memorije telefona.
    if (!imgs) {
      imgs = [];
      for (let i = 0; i < files.length; i++) {
        setText(files.length > 1 ? t('scan.stepCompressN', { i: i + 1, n: files.length }) : t('scan.stepCompress'));
        imgs.push(await prepareImage(files[i]));
        if (cancelled) return;
      }
    }
    diag.images = imgs.map((i) => i.info);
    if (cancelled) return;
    overlay.querySelector('.scan-preview').style.backgroundImage = `url(${imgs[0].preview})`;
    // „Skeniraj ponovo“ za TAB pesmu: odmah čitanje tablature (isti tok i isti ekran „Proveri tablaturu“)
    if (opts.rescanTabOf) {
      setText(t('tab.reading'));
      const tabDraft = await readTab(imgs, ctrl.signal, setText, diag);
      if (cancelled) return;
      close();
      if (!tabDraft) { toast(t('gem.noTab'), 'error'); return; }
      tabDraft.__rescanOf = opts.rescanTabOf;
      tabDraft.__newId = opts.rescanTabOf;
      drafts = { chords: null, tab: tabDraft }; draftImgs = null;
      draft = tabDraft;
      draftImage = imgs.map((i) => i.preview);
      location.hash = '#/uredi/sken';
      return;
    }
    // 2) Pošalji i sačekaj odgovor
    const song = await scanSong(imgs, ctrl.signal, (kind, model) => {
      if (kind === 'send') setText(t('scan.stepSend'));
      else if (kind === 'reading') setText(t('scan.stepReading'));
      else if (kind === 'switch') setText(t('scan.switchModel', { model }));
      else setText(t('scan.busy'));
    }, diag);
    // TAB list (prebiranje): Gemini je prepoznao tablaturu → drugo čitanje, taktovi i note sa ritmom
    let tabDraft = null;
    if (song.sheetKind === 'tab' && !opts.onSong && !opts.rescanOf) {
      setText(t('tab.reading'));
      try { tabDraft = await readTab(imgs, ctrl.signal, setText, diag); } catch (e) { if (cancelled || (e && e.name === 'AbortError')) throw e; tabDraft = null; }
      if (cancelled) return;
    }
    diag.totalMs = performance.now() - t0;
    close();
    if (opts.onSong) { opts.onSong(song, imgs); return; }
    await placeUnplacedTabs(song);
    if (opts.rescanOf) song.__rescanOf = opts.rescanOf;
    song.__original = snapshotOriginal(song); // skenirano tačno kako je pročitano — ne menja se nikad
    song.__newId = newSongId(); // ID nove pesme se zna od skeniranja: ponovljeno čuvanje upisuje istu pesmu, ne drugu
    // za promenu vrste (Akordi ↔ TAB) pre čuvanja: oba čitanja i slike
    drafts = { chords: song, tab: tabDraft }; draftImgs = opts.rescanOf ? null : imgs;
    if (tabDraft) tabDraft.__newId = song.__newId;
    draft = tabDraft || song;
    draftImage = imgs.map((i) => i.preview);
    location.hash = '#/uredi/sken';
  } catch (e) {
    diag.totalMs = performance.now() - t0;
    close();
    if (cancelled || (e && e.name === 'AbortError')) { if (opts.onFail) opts.onFail(e); return; }
    const code = e instanceof GeminiError ? e.code : 'ERROR';
    const title = code === 'TIMEOUT' ? t('scan.timeoutTitle') : code === 'BUSY' ? t('scan.busyTitle') : t('scan.failedTitle');
    const report = formatScanDiag(diag, e);
    const canRetry = imgs && imgs.length && code !== 'BAD_KEY';
    const p = dialog({
      title,
      html: true,
      body: `<p>${esc(e instanceof GeminiError ? e.message : t('common.error'))}</p>
        <details class="diag"><summary>${t('scan.details')}</summary><textarea readonly class="diag-text" id="diagText" rows="8">${esc(report)}</textarea>
        <button class="btn small" id="diagCopy" type="button">${t('scan.copyDetails')}</button></details>`,
      buttons: canRetry
        ? [{ label: t('common.cancel'), value: false }, { label: t('common.retry'), value: true, kind: 'primary' }]
        : [{ label: t('common.ok'), value: false, kind: 'primary' }],
    });
    const modal = [...document.querySelectorAll('.modal-backdrop')].pop();
    modal.querySelector('#diagCopy').addEventListener('click', async (ev) => {
      ev.stopPropagation();
      try { await navigator.clipboard.writeText(report); toast(t('scan.copied')); }
      catch { const ta = modal.querySelector('#diagText'); ta.focus(); ta.select(); }
    });
    if (await p) return runScan(files, imgs, opts);
    if (opts.onFail) opts.onFail(e);
  }
}

const kb = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

/** Tekst za „Detalji greške“ (bez API ključa) — korisnik ga može kopirati i poslati. */
function formatScanDiag(d, e) {
  const L = [];
  L.push(`${t('diag.time')}: ${d.at}  ·  ${t('diag.total')}: ${secs(d.totalMs)}  ·  ${t('diag.code')}: ${(e && e.code) || (e && e.name) || '?'}`);
  L.push(`${t('diag.model')}: ${d.selection === 'auto' ? t('set.modelAuto') : d.selection || '?'}`);
  L.push(`${t('diag.images')} (${d.images.length}):`);
  d.images.forEach((i, k) => L.push(`  ${k + 1}) ${t('diag.original')} ${i.ow}×${i.oh}, ${kb(i.origBytes)} → ${t('diag.sent')} ${i.w}×${i.h}, ${kb(i.bytes)} (JPEG ${i.quality})`));
  if (d.images.length) L.push(`  ${t('diag.sentTotal')}: ${kb(d.images.reduce((a, i) => a + i.bytes, 0))}`);
  L.push(`${t('diag.attempts')} (${d.attempts.length}):`);
  if (!d.attempts.length) L.push(`  ${t('diag.noAttempts')}`);
  d.attempts.forEach((a, k) => L.push(`  ${k + 1}. ${a.model} [${a.thinking}] — ${secs(a.ms)} — ${a.status}${a.message ? ': ' + a.message : ''}  (${t('diag.request')} ${kb(a.sentBytes)})`));
  L.push(`${t('diag.message')}: ${(e && e.message) || String(e)}`);
  L.push(`${t('diag.app')}: Gitara ${APP_VERSION} · ${navigator.onLine === false ? 'offline' : 'online'} · ${navigator.userAgent}`);
  return L.join('\n');
}

/** „Skeniraj ponovo“ (Uredi): nove fotografije u postojeću pesmu — isti ID, napredak, set liste i podešavanja. */
async function askRescan(id, isTab) {
  const how = await dialog({
    title: t('rescan.btn'),
    body: t(isTab ? 'rescan.tabBody' : 'rescan.body'),
    buttons: [{ label: t('scan.gallery'), value: 'gallery' }, { label: t('scan.camera'), value: 'camera', kind: 'primary' }],
  });
  if (!how) return;
  if (!(await getApiKey())) { toast(t('scan.needKeyTitle'), 'error'); return; }
  if (navigator.onLine === false) { await dialog({ title: t('scan.offlineTitle'), body: t('scan.offlineBody') }); return; }
  const files = await pickFiles('image/*', how === 'camera' ? 'environment' : null);
  if (!files.length) return;
  const pages = await collectPages(files);
  if (pages) await runScan(pages, null, isTab ? { rescanTabOf: id } : { rescanOf: id });
}

/** Samo tablature sa slika (za „Dodaj tablaturu“ → skeniranje). Vraća niz tablatura ili null. */
function scanTabsFromImages(files) {
  return new Promise((resolve) => {
    runScan(files.slice(0, MAX_PAGES), null, {
      onSong: (song) => {
        const tabs = song.sections.flatMap((x) => x.tabs || []);
        if (!tabs.length) { toast(t('tab.noneFound'), 'error'); resolve(null); } else resolve(tabs);
      },
      onFail: () => resolve(null),
    });
  });
}

/** „Gde da stavim ovu tablaturu?“ — za tablature koje Gemini nije znao gde da smesti. */
async function placeUnplacedTabs(song) {
  const list = (song.unplacedTabs || []).slice().sort((a, b) => b - a);
  delete song.unplacedTabs;
  for (const from of list) {
    const src = song.sections[from];
    if (!src || !src.tabs) continue;
    const others = song.sections.map((x, i) => ({ i, label: x.name || t('strum.section', { n: i + 1 }) })).filter((o) => o.i !== from);
    if (!others.length) continue;
    const p = dialog({
      title: t('tab.where'),
      html: true,
      body: `<p class="small muted">${esc(src.name ? t('tab.whereFrom', { name: src.name }) : t('tab.whereHint'))}</p>
        <select id="tabWhere"><option value="keep">${esc(t('tab.keepSeparate'))}</option>${others.map((o) => `<option value="${o.i}">${esc(o.label)}</option>`).join('')}</select>`,
      buttons: [{ label: t('common.ok'), value: 'ok', kind: 'primary' }],
      dismissible: false,
    });
    const modal = [...document.querySelectorAll('.modal-backdrop')].pop();
    let choice = 'keep';
    modal.querySelector('#tabWhere').addEventListener('change', (e) => (choice = e.target.value));
    await p;
    if (choice === 'keep') continue;
    const to = +choice;
    const dst = song.sections[to];
    const offset = (dst.tabs || []).length;
    dst.tabs = [...(dst.tabs || []), ...src.tabs];
    // premesti i oznake nesigurnih pragova
    for (const u of song.uncertain || []) if (u.kind === 'fret' && u.section === from) { u.section = to; u.tab += offset; }
    delete src.tabs;
    if (!src.lines.length) {
      song.sections.splice(from, 1);
      for (const u of song.uncertain || []) if (u.section > from) u.section--;
    }
  }
}


// ---------------- Uređivanje ("Proveri i ispravi") ----------------
/** Čitanje TAB lista (posle prepoznate tablature ili kad korisnik promeni vrstu). Vraća TAB pesmu ili null. */
async function readTab(imgs, signal, setText, diag) {
  let cur = t('tab.reading'); // strana / taktovi koji se upravo čitaju (ostaje i dok Gemini „čita“)
  const json = await scanTab(imgs, signal, (kind, model, x) => {
    if (kind === 'page') setText((cur = t('tab.readingPage', { i: model, n: x })));
    else if (kind === 'bars') setText((cur = t('tab.readingBars', { a: model, b: x })));
    else if (kind === 'switch') setText(t('scan.switchModel', { model }));
    else if (kind === 'busy') setText(t('scan.busy'));
    else setText(cur);
  }, diag);
  const { fromScan } = await import('./tabSong.js');
  const s = fromScan(json);
  if (s) s.scanModel = json.scanModel;
  return s;
}
/** Promena vrste posle skeniranja (Akordi → TAB): ista slika, drugo čitanje (uz „Otkaži“). */
async function switchToTab(root, chord) {
  if (drafts.tab) { draft = drafts.tab; return renderEditor(root, 'sken'); }
  if (!draftImgs) { toast(t('tab.needPhoto'), 'error'); return; }
  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `<div class="modal scan-modal" role="dialog" aria-modal="true"><p class="scan-msg"><span class="spinner"></span> <span id="tsText">${t('tab.reading')}</span></p>
    <div class="modal-actions"><button class="btn" id="tsCancel">${t('common.cancel')}</button></div></div>`;
  document.body.appendChild(overlay);
  const ctrl = new AbortController();
  overlay.__close = () => overlay.querySelector('#tsCancel')?.click();
  overlay.querySelector('#tsCancel').addEventListener('click', () => { ctrl.abort(); overlay.remove(); });
  try {
    const tab = await readTab(draftImgs, ctrl.signal, (x) => { const e = overlay.querySelector('#tsText'); if (e) e.textContent = x; }, { images: [], attempts: [] });
    overlay.remove();
    if (!tab) { toast(t('gem.noTab'), 'error'); return; }
    tab.__newId = chord.__newId;
    drafts.tab = tab;
    draft = tab;
    renderEditor(root, 'sken');
  } catch (e) {
    overlay.remove();
    if (e && e.name === 'AbortError') return;
    toast(e instanceof GeminiError ? e.message : t('common.error'), 'error');
  }
}
/** TAB pesma: poseban editor (učitava se tek sada). */
async function renderTab(root, song, isNew) {
  const { renderTabEditor } = await import('./tabEditor.js');
  const base = isNew && song.__rescanOf ? await db.get(song.__rescanOf) : null; // „Skeniraj ponovo“: postojeća pesma
  renderTabEditor(root, song, {
    isNew, base, scanned: isNew && drafts.tab === song, images: isNew ? draftImage : null,
    onRescan: isNew ? null : () => askRescan(song.id, true),
    onType: isNew && drafts.tab === song && drafts.chords ? () => { draft = drafts.chords; renderEditor(root, 'sken'); } : null,
    onCancel: () => {
      draft = null; draftImage = null; drafts = { chords: null, tab: null }; draftImgs = null;
      if (!isNew) location.replace(`#/pesma/${encodeURIComponent(song.id)}`);
      else history.length > 1 ? history.back() : (location.hash = '#/pesme');
    },
    done: (rec) => { draft = null; draftImage = null; drafts = { chords: null, tab: null }; draftImgs = null; location.replace(`#/pesma/${encodeURIComponent(rec.id)}`); },
  });
}

export async function renderEditor(root, id) {
  let song;
  let isNew = false;
  let base = null; // postojeća pesma kod „Skeniraj ponovo“
  if (id === 'sken' || id === 'novo') {
    if (!draft) { location.hash = '#/pesme'; return; }
    if (draft.type === 'tab') return renderTab(root, draft, true);
    song = draft;
    isNew = true;
    if (draft.__rescanOf) {
      base = await db.get(draft.__rescanOf);
      if (base) {
        song = { ...draft };
        // naslov/izvođač/tonalitet sa slike, osim ako ih skeniranje nije pročitalo
        if (!song.title || song.title === t('common.untitled')) song.title = base.title;
        if (!song.artist) song.artist = base.artist;
        if (!song.key) song.key = base.key;
      }
    }
  } else {
    song = await db.get(id);
    if (!song) { location.hash = '#/pesme'; return; }
    if (song.type === 'tab') return renderTab(root, song, false);
  }
  const scanned = id === 'sken';
  // Akordi u editoru su u izabranom imenovanju (H/Fis… ili B/F#…); nova skeniranja se prvo pročitaju
  const viewSong = needsUpgrade(song) ? upgradeSong(song) : song;
  const shown = { ...song, key: viewSong.key ? dn(viewSong.key) : song.key || '', sections: viewSong.sections.map((sec) => ({ ...sec, lines: sec.lines.map((l) => ({ ...l, chords: (l.chords || []).map((c) => ({ ...c, chord: dn(c.chord) })) })) })) };
  const canRestore = !isNew && song.original && differsFromOriginal(song);
  root.innerHTML = `
  <section class="view editor-view">
    <header class="topbar">
      <button class="back" id="eCancel">${t('edit.cancel')}</button>
      <div class="topbar-actions">${!isNew ? `<button class="btn small" id="eRescan">${t('rescan.btn')}</button>` : ''}<button class="btn primary" id="eSave">${t('common.save')}</button></div>
    </header>
    <h1>${scanned ? t('edit.titleScanned') : isNew ? t('edit.titleNew') : t('edit.titleEdit')}</h1>
    ${base ? `<p class="rescan-note small">${esc(t('rescan.note', { title: base.title }))}</p>` : ''}
    ${canRestore ? `<div class="restore-row"><button class="btn small" id="eRestore">${t('orig.restore')}</button><span class="small muted">${t('orig.restoreHint')}</span></div>` : ''}
    ${scanned && drafts.chords === song && draftImgs ? `<div class="tab-type" style="display:flex;flex-direction:column;gap:6px;margin:4px 0 10px"><span class="small muted">${t('tab.typeQ')}</span>
      <div class="seg-tabs" role="radiogroup" style="align-self:flex-start"><button role="radio" class="active" aria-checked="true" data-kind="chords">${t('tab.typeChords')}</button><button role="radio" data-kind="tab">${t('tab.typeTab')}</button></div>
      <span class="small muted">${t('tab.typeHint')}</span></div>` : ''}
    ${scanned ? `<p class="muted">${t('edit.scannedHint')}</p>${song.scanModel ? `<p class="scan-model small muted">${esc(t('edit.scanModel', { model: song.scanModel }))}</p>` : ''}` : ''}
    ${draftImage && scanned ? `<details class="card photo-ref"><summary>${t('edit.showPhoto')}</summary>${[].concat(draftImage).map((src, i) => `<img src="${src}" alt="${esc(t('scan.page', { n: i + 1 }))}">`).join('')}</details>` : ''}
    <div class="form">
      <label>${t('edit.fTitle')}<input id="eTitle" value="${esc(song.title)}" placeholder="${t('edit.fTitlePh')}" autocomplete="off"></label>
      <div class="row">
        <label class="grow">${t('edit.fArtist')}<input id="eArtist" value="${esc(song.artist)}" placeholder="${t('edit.fArtist')}" autocomplete="off"></label>
        <label class="key-input">${t('edit.fKey')}<input id="eKey" value="${esc(shown.key)}" placeholder="${t('edit.fKeyPh')}" autocomplete="off"></label>
      </div>
      <label>${t('tuning.label')}<select id="eTuning">${TUNING_IDS.map((id) => `<option value="${id}" ${cleanTuning(song.tuning) === id ? 'selected' : ''}>${esc(t('tuning.' + id))} · ${esc(tuningNotes(id))}</option>`).join('')}</select></label>
    </div>
    <div class="seg-tabs" role="tablist">
      <button role="tab" class="active" data-tab="edit">${t('edit.tabEdit')}</button>
      <button role="tab" data-tab="preview">${t('edit.tabPreview')}</button>
    </div>
    <div id="eSuggest"></div>
    <div id="eEditPane">
      <textarea id="eText" class="mono-editor" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="${t('edit.textLabel')}"></textarea>
      <div id="eWarn" class="warn small"></div>
      <div class="edit-tools"><button class="btn small" id="eAddTab" type="button">${t('tab.add')}</button></div>
      <details class="help small">
        <summary>${t('edit.howTo')}</summary>
        <p>${t('edit.howToBody')}</p>
        <pre>${esc(t('edit.example'))}</pre>
      </details>
    </div>
    <div id ="ePreviewPane" class="lyrics" hidden></div>
  </section>`;
  const $ = (q) => root.querySelector('#' + q);
  root.querySelector('[data-kind="tab"]')?.addEventListener('click', () => switchToTab(root, song));
  const shownText = sectionsToText(shown.sections);
  $('eText').value = shownText;
  autoGrow($('eText'));

  const validate = () => {
    const secs = textToSections($('eText').value);
    const unknown = new Set();
    // Reči koje liče na akorde u redu sa akordima, a nisu prepoznate
    for (const line of $('eText').value.split('\n')) {
      const toks = line.trim().split(/\s+/).filter(Boolean);
      const chordish = toks.filter((t) => /^[A-H]/.test(t));
      const ok = (x) => !!readChord(x.replace(/^\(|\)$/g, ''), currentNaming());
      if (toks.length && chordish.length === toks.length && toks.some(ok)) {
        toks.filter((x) => !ok(x)).forEach((x) => unknown.add(x));
      }
    }
    $('eWarn').textContent = unknown.size ? t('edit.unknownChords', { list: [...unknown].join(', ') }) : '';
    return secs;
  };
  // Predlozi posle skeniranja: mesta koja Gemini nije pouzdano pročitao
  let pendingUnc = isNew ? [...(song.uncertain || [])] : [];
  const drawEditSuggest = () => {
    const list = cleanUncertain(pendingUnc, validate());
    pendingUnc = list;
    $('eSuggest').innerHTML = list.length ? `<div class="card sug-card"><div class="sug-head">${t('sug.title')}</div>
      <div class="sug-group"><div class="sug-title">${t('sug.unsureTitleN', { n: list.length })}</div><p class="small muted">${t('sug.unsureHintEdit')}</p>
      ${list.map((x, i) => `<div class="sug-item"><span class="sug-what"><span class="unsure-sample">${esc(x.text)}</span> → <b>${esc(x.suggestion)}</b></span>
        <button class="btn small" data-eu-skip="${i}">${t('sug.keep')}</button><button class="btn small primary" data-eu-apply="${i}">${esc(t('sug.changeTo', { x: x.suggestion }))}</button></div>`).join('')}</div></div>` : '';
  };
  $('eSuggest').addEventListener('click', (e) => {
    const a = e.target.closest('[data-eu-apply]'), k = e.target.closest('[data-eu-skip]');
    if (!a && !k) return;
    const i = +(a ? a.dataset.euApply : k.dataset.euSkip);
    const u = pendingUnc[i];
    if (a && u) {
      const secs = validate();
      if (applyUncertain({ sections: secs }, u)) { $('eText').value = sectionsToText(secs); autoGrow($('eText')); }
    }
    pendingUnc.splice(i, 1);
    drawEditSuggest();
  });
  drawEditSuggest();

  // „Dodaj tablaturu“: izaberi deo pesme, pa upiši ASCII tablaturu ili je skeniraj sa slike
  const TAB_TEMPLATE = ['e|----------------|----------------|', 'B|----------------|----------------|', 'G|----------------|----------------|',
    'D|----------------|----------------|', 'A|----------------|----------------|', 'E|----------------|----------------|'];
  /** Ubaci redove odmah ispod zaglavlja izabranog dela (ili na kraj kao novi deo). */
  const insertIntoSection = (target, linesToAdd) => {
    const ta = $('eText');
    const rows = ta.value.split('\n');
    let at;
    if (target === '__new') {
      rows.push('', `[${t('tab.newSection')}]`);
      at = rows.length;
    } else {
      const names = textToSections(ta.value).map((x) => x.name);
      const name = names[+target];
      const hi = name ? rows.findIndex((r) => r.trim() === `[${name}]`) : -1;
      at = hi >= 0 ? hi + 1 : 0;
    }
    rows.splice(at, 0, ...linesToAdd, '');
    ta.value = rows.join('\n');
    autoGrow(ta);
    validate();
    // označi prvi takt da korisnik odmah kuca brojeve pragova
    const before = rows.slice(0, at).join('\n').length + (at ? 1 : 0);
    ta.focus();
    ta.setSelectionRange(before + 2, before + 2 + 16);
  };
  $('eAddTab').addEventListener('click', async () => {
    const names = textToSections($('eText').value).map((x, i) => ({ v: String(i), label: x.name || t('strum.section', { n: i + 1 }) }));
    const p = dialog({
      title: t('tab.addTitle'),
      html: true,
      body: `<label class="small">${t('tab.forSection')}
        <select id="tabTarget">${names.map((n) => `<option value="${n.v}">${esc(n.label)}</option>`).join('')}<option value="__new">${esc(t('tab.newSectionOpt'))}</option></select></label>
        <p class="small muted">${t('tab.addHint')}</p>`,
      buttons: [{ label: t('common.cancel'), value: null }, { label: t('tab.scanIt'), value: 'scan' }, { label: t('tab.typeIt'), value: 'type', kind: 'primary' }],
    });
    const modal = [...document.querySelectorAll('.modal-backdrop')].pop();
    let target = names.length ? '0' : '__new';
    modal.querySelector('#tabTarget').value = target;
    modal.querySelector('#tabTarget').addEventListener('change', (e) => (target = e.target.value));
    const mode = await p;
    if (mode === 'type') { insertIntoSection(target, TAB_TEMPLATE); toast(t('tab.typeHint')); }
    else if (mode === 'scan') {
      const files = await pickFiles('image/*');
      if (!files.length) return;
      const res = await scanTabsFromImages(files);
      if (!res || !res.length) return;
      insertIntoSection(target, res.flatMap((tab, i) => [...(i ? [''] : []), ...(tab.sig !== '4/4' ? [tab.sig] : []), ...tabToAscii(tab)]));
      toast(t('tab.scanned', { n: res.length }));
    }
  });
  $('eRescan')?.addEventListener('click', () => askRescan(id, false));
  $('eText').addEventListener('input', () => { autoGrow($('eText')); validate(); });
  validate();

  root.querySelectorAll('.seg-tabs button').forEach((b) => b.addEventListener('click', () => {
    root.querySelectorAll('.seg-tabs button').forEach((x) => x.classList.toggle('active', x === b));
    const preview = b.dataset.tab === 'preview';
    $('eEditPane').hidden = preview;
    $('ePreviewPane').hidden = !preview;
    if (preview) { const secs = validate(); $('ePreviewPane').innerHTML = renderSectionsHTML(secs, cleanUncertain(pendingUnc, secs)) || `<p class="muted">${t('edit.noText')}</p>`; layoutTabs($('ePreviewPane')); }
  }));

  const dirty = () => $('eText').value !== shownText || $('eTitle').value !== (song.title || '');
  $('eCancel').addEventListener('click', async () => {
    if (dirty() || scanned) {
      const ok = await confirmDialog(t('edit.discardTitle'), scanned ? t('edit.discardScanned') : t('edit.discardBody'), t('edit.discard'), 'danger');
      if (!ok) return;
    }
    draft = null; draftImage = null; drafts = { chords: null, tab: null }; draftImgs = null;
    if (base) { location.replace(`#/pesma/${encodeURIComponent(base.id)}`); return; }
    history.length > 1 ? history.back() : (location.hash = isNew ? '#/pesme' : `#/pesma/${encodeURIComponent(id)}`);
  });
  $('eRestore')?.addEventListener('click', async () => {
    if (!(await confirmDialog(t('orig.confirmTitle'), t('orig.confirmBody', { title: song.original.title || song.title }), t('orig.restore'), 'danger'))) return;
    const restored = restoreOriginal(song);
    await db.put({ ...restored, updatedAt: Date.now() });
    draft = null; draftImage = null; drafts = { chords: null, tab: null }; draftImgs = null;
    toast(t('orig.restored'));
    location.replace(`#/pesma/${encodeURIComponent(song.id)}`);
  });
  // Čuvanje tačno jednom: dugme je zaključano dok traje (dupli dodir, spor telefon), a nova pesma ima ID od početka.
  let saving = false;
  $('eSave').addEventListener('click', async () => {
    if (saving) return;
    saving = true; $('eSave').disabled = true;
    try { await saveSong(); } finally { saving = false; if ($('eSave')) $('eSave').disabled = false; }
  });
  async function saveSong() {
    const sections = validate();
    if (!sections.length) { toast(t('edit.empty'), 'error'); return; }
    const title = $('eTitle').value.trim() || t('common.untitled');
    // Zadrži ritam po delovima (po nazivu dela) i ostala podešavanja pesme.
    const oldSecs = song.sections || [];
    sections.forEach((sec, i) => {
      const old = oldSecs.find((o) => o.name === sec.name && o.strum) || (oldSecs[i] && oldSecs[i].name === sec.name ? oldSecs[i] : null);
      if (old && old.strum) sec.strum = old.strum;
    });
    const keyText = $('eKey').value.trim();
    let rec0 = {
      // ponovo skenirana pesma zadržava sve svoje (kapodaster, ritam, YouTube, folderi, setliste — isti id)
      ...(base ? base : isNew ? songExtras(song) : song),
      title,
      artist: $('eArtist').value.trim(),
      tuning: $('eTuning').value === 'standard' ? undefined : $('eTuning').value,
      ...(isNew ? { uncertain: cleanUncertain(pendingUnc, sections) } : {}),
    };
    // Novo skeniranje (i „Skeniraj ponovo“) = novi original, tačno kako je pročitan
    if (isNew) rec0.original = song.__original || undefined;
    if ($('eText').value === shownText && keyText === shown.key) {
      // Tekst i akordi nisu menjani: zadrži pročitane akorde (i eventualno otvoreno pitanje o B/H ili tonalitetu)
      const keep = ['sections', 'key', 'keyN', 'keyAlt', 'keyAsk', 'naming', 'namingAsk', 'cv'];
      for (const k of keep) rec0[k] = viewSong[k];
      rec0.sections = viewSong.sections.map((sec, i) => ({ ...sec, ...(sections[i] && sections[i].strum ? { strum: sections[i].strum } : {}) }));
      if (!rec0.original) rec0.original = viewSong.original;
    } else {
      // Akordi su upisani u izabranom imenovanju → nov neutralni sloj (original ostaje kakav je bio)
      rec0 = upgradeSong({ ...rec0, sections, key: keyText, cv: 0, keyN: undefined, keyAlt: undefined, namingAsk: false, keyAsk: false }, { naming: currentNaming(), keyText });
    }
    const newId = song.__newId;
    delete rec0.__original; delete rec0.__rescanOf; delete rec0.__newId; delete rec0.sheetKind;
    let msg = t('edit.saved');
    if (isNew && !base) {
      rec0.id = newId || undefined;
      // Ista pesma već postoji (isti naslov ili skoro isti tekst i akordi)? — pitaj, nikad ne odlučuj sam
      const others = (await db.all()).filter((x) => x.id !== newId);
      const existing = findExisting(rec0, others);
      if (existing) {
        const choice = await dialog({
          title: t('dup.title', { title: existing.title }),
          body: t('dup.body'),
          buttons: [{ label: t('common.cancel'), value: null }, { label: t('dup.saveNew'), value: 'new' }, { label: t('dup.replace'), value: 'replace', kind: 'primary' }],
        });
        if (!choice) return;
        if (choice === 'replace') {
          // novi tekst i akordi; ID, folderi, kapodaster, tonalitet, ritam, YouTube… (i napredak u Vežbama, po ID-u) ostaju
          const kept = {};
          for (const k of KEEP_ON_REPLACE) if (existing[k] !== undefined) kept[k] = existing[k];
          rec0 = { ...existing, ...rec0, ...kept };
          if (existing.tuning === undefined) delete rec0.tuning;
          msg = t('dup.replaced', { title: existing.title });
        }
      }
    }
    if (base) await versions.save('song:' + base.id, base, 'rescan'); // stari sadržaj ostaje kao „Prethodna verzija“
    const rec = await db.save(rec0);
    draft = null; draftImage = null; drafts = { chords: null, tab: null }; draftImgs = null;
    toast(msg);
    location.replace(`#/pesma/${encodeURIComponent(rec.id)}`);
  }
}
// „Zameni“ posle ponovnog skeniranja: ovo ostaje od postojeće pesme
const KEEP_ON_REPLACE = ['id', 'createdAt', 'folders', 'capo', 'key', 'keyN', 'keyAlt', 'keyAsk', 'transpose', 'strum', 'yt', 'bpm', 'scrollSpeed', 'shapes', 'tuning', 'seen', 'recording'];

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.max(240, el.scrollHeight + 4) + 'px';
}

