// v1.70: više PDF-ova odjednom. PDF sa pravim tekstom (akordi ili tablatura) postaje pesma odmah, bez AI; skenirani PDF
// (samo slike) ide preko besplatnog Gemini-ja, jedan po jedan. Pre početka upozorenje (koliko ide preko Gemini-ja i da
// besplatni dnevni limit može da odloži ostatak za sutra). Red se pamti (Cache Storage) — nastavlja se i posle zatvaranja.
import { t } from './i18n.js';
import { songs as db } from './db.js';
import { esc, toast, dialog } from './ui.js';

const CACHE = 'marli-pdf-queue', LS = 'marli-pdf-queue';
const MAX_PAGES = 10;
let q = [];          // [{ id, name, kind: 'text'|'scan'|'?', st: 'wait'|'run'|'ok'|'dup'|'err'|'later'|'tab', msg, songId }]
let running = false, panel = null, pill = null, hidden = false, retryT = 0;

const save = () => { try { localStorage.setItem(LS, JSON.stringify(q.filter((x) => !['ok', 'dup', 'err', 'tab'].includes(x.st)).map(({ diag, file, ...x }) => x))); } catch {} };
const fileKey = (id) => new Request('./__marli-pdf/' + encodeURIComponent(id));
async function putFile(id, file) { try { const c = await caches.open(CACHE); await c.put(fileKey(id), new Response(file, { headers: { 'content-type': 'application/pdf' } })); } catch {} }
async function getFile(id) { try { const c = await caches.open(CACHE); const r = await c.match(fileKey(id)); return r ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } }
async function dropFile(id) { try { const c = await caches.open(CACHE); await c.delete(fileKey(id)); } catch {} }

/** Iz PDF-a bez AI: pesma (akordi ili tablatura) ili null (sken — samo slike). */
async function textSong(bytes) {
  const m = await import('./pdfTab.js');
  const read = await m.readPdf(bytes);
  try {
    const { fixCaps } = await import('./textCase.js');
    const tabRes = m.pdfToTabText(read.pages) || m.pdfAsciiTab(read.pages);
    if (tabRes) {
      const { parseTabText } = await import('./tabScanText.js');
      const { cleanComposer } = await import('./gemini.js');
      const j = parseTabText(tabRes.text);
      if (j) {
        j.title = fixCaps(j.title); j.composer = fixCaps(cleanComposer(j.composer, j)); j.sig = j.sig || tabRes.sig || '4/4'; j.source = 'pdf';
        const s = (await import('./tabSong.js')).fromScan(j);
        if (s) return { song: s, doc: read.doc };
      }
    }
    const { isChordLine, normalizeSong, textToSections } = await import('./songformat.js');
    const ch = m.pdfChordText(read.pages, isChordLine);
    if (ch) {
      const { snapshotOriginal } = await import('./songmodel.js');
      const song = normalizeSong({ title: fixCaps(ch.title), artist: fixCaps(ch.artist), key: '', sections: textToSections(ch.text) });
      song.original = snapshotOriginal(song);
      return { song, doc: read.doc };
    }
    return { song: null, doc: read.doc };
  } catch (e) { try { read.doc.destroy(); } catch {} throw e; }
}

async function saveSong(song) {
  for (const k of ['__original', '__rescanOf', '__newId', 'sheetKind', 'importedFrom', 'scanModel']) delete song[k];
  const { findExisting } = await import('./songIdentity.js');
  if (findExisting(song, await db.all())) return null; // ista pesma već postoji — ne dupliraj
  return (await db.save(song)).id;
}

async function processOne(it) {
  const bytes = await getFile(it.id);
  if (!bytes) { it.st = 'err'; it.msg = t('pdfq.lost'); return; }
  const { song, doc } = await textSong(bytes.slice());
  try {
    if (song) { it.kind = 'text'; const id = await saveSong(song); it.st = id ? 'ok' : 'dup'; it.songId = id; return; }
    it.kind = 'scan';
    const g = await import('./gemini.js');
    if (!(await g.getApiKey())) { it.st = 'later'; it.msg = t('pdfq.noKey'); return; }
    const files = await (await import('./pdfTab.js')).renderPdfPages(doc, MAX_PAGES, 1600);
    const imgs = [];
    for (const f of files) imgs.push(await g.prepareImage(f));
    const diag = { at: new Date().toISOString(), images: imgs.map((i) => i.info), attempts: [], selection: '', totalMs: 0 };
    it.diag = diag;
    const s = await g.scanSong(imgs, undefined, () => {}, diag);
    if (s.sheetKind === 'tab') { it.st = 'tab'; it.msg = t('pdfq.tabAlone'); return; }
    const { snapshotOriginal } = await import('./songmodel.js');
    s.original = snapshotOriginal(s);
    const id = await saveSong(s);
    it.st = id ? 'ok' : 'dup'; it.songId = id;
  } finally { try { doc.destroy(); } catch {} }
}

async function run() {
  if (running) return; running = true; clearTimeout(retryT);
  try {
    for (const it of q) {
      if (!['wait', 'later'].includes(it.st)) continue;
      if (navigator.onLine === false && it.kind !== 'text') { it.st = 'later'; it.msg = t('pdfq.offline'); continue; }
      it.st = 'run'; it.msg = ''; draw();
      try { await processOne(it); }
      catch (e) {
        const g = await import('./gemini.js');
        if (e instanceof g.GeminiError && (e.code === 'BUSY' || e.code === 'TIMEOUT')) {
          // dnevni limit (429 / kvota) — čeka se duže; samo zauzeto (503) — kratko
          const quota = e.quota || (it.diag && it.diag.attempts.some((x) => /429|quota|exhaust/i.test(String(x.status) + ' ' + (x.message || ''))));
          it.st = 'later'; it.msg = quota ? t('pdfq.limit') : t('pdfq.busy');
          // ostali skenirani čekaju isto: posle dnevnog limita pokušaj ponovo za sat, posle zauzetosti za 2 min
          retryT = setTimeout(run, quota ? 3600e3 : 120e3);
          for (const x of q) if (x.st === 'wait' && x.kind !== 'text') { x.st = 'later'; x.msg = it.msg; }
          if (!q.some((x) => x.st === 'wait')) break;
          continue;
        }
        it.st = 'err'; it.msg = e instanceof g.GeminiError ? e.message : t('pdfq.failed');
        if (!(e instanceof g.GeminiError)) console.warn('PDF red:', e);
      }
      if (['ok', 'dup', 'err', 'tab'].includes(it.st)) await dropFile(it.id);
      save(); draw();
    }
  } finally { running = false; save(); draw(); }
  const done = q.filter((x) => x.st === 'ok').length;
  if (!q.some((x) => ['wait', 'run', 'later'].includes(x.st))) { toast(t('pdfq.allDone', { n: done })); if (!panel) setTimeout(() => { q = []; save(); drawPill(); }, 6000); }
}

// ---------------- Prikaz ----------------
const ST = { wait: ['wait', 'pdfq.st.wait'], run: ['run', 'pdfq.st.run'], ok: ['ok', 'pdfq.st.ok'], dup: ['muted', 'pdfq.st.dup'], err: ['err', 'pdfq.st.err'], later: ['wait', 'pdfq.st.later'], tab: ['muted', 'pdfq.st.tab'] };
function draw() { drawPanel(); drawPill(); }
function drawPanel() {
  if (!panel) return;
  const done = q.filter((x) => ['ok', 'dup', 'err', 'tab'].includes(x.st)).length;
  panel.querySelector('.pq-body').innerHTML = `<h2 class="modal-title">${t('pdfq.title', { a: done, b: q.length })}</h2>
    <div class="pq-bar"><b style="width:${q.length ? Math.round(done / q.length * 100) : 0}%"></b></div>
    <div class="pq-list">${q.map((x) => { const [c, k] = ST[x.st] || ST.wait; return `<div class="pq-row"><span class="pq-pdf">PDF</span><span class="pq-name">${esc(x.name)}</span><span class="pq-st ${c}">${esc(t(k))}${x.kind === 'text' && x.st === 'ok' ? ' · ' + esc(t('pdfq.noAi')) : x.kind === 'scan' && x.st === 'ok' ? ' · Gemini' : ''}${x.msg ? ' — ' + esc(x.msg) : ''}</span></div>`; }).join('')}</div>`;
}
function drawPill() {
  const active = q.length && (hidden || !panel);
  if (!active) { pill?.remove(); pill = null; return; }
  if (!pill) { pill = document.createElement('button'); pill.type = 'button'; pill.className = 'pq-pill'; pill.addEventListener('click', openPanel); document.body.appendChild(pill); }
  const done = q.filter((x) => ['ok', 'dup', 'err', 'tab'].includes(x.st)).length, later = q.some((x) => x.st === 'later');
  pill.innerHTML = `<span class="pq-pdf">PDF</span> ${esc(t('pdfq.pill', { a: done, b: q.length }))}${later ? ' · ' + esc(t('pdfq.waiting')) : ''}`;
}
function openPanel() {
  hidden = false;
  if (panel) return;
  panel = document.createElement('div');
  panel.className = 'modal-backdrop';
  panel.innerHTML = `<div class="modal pq-modal" role="dialog" aria-modal="true"><div class="pq-body"></div><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-p="hide">${t('pdfq.hide')}</button><button class="btn" data-p="stop">${t('pdfq.stop')}</button></div></div>`;
  const close = () => { panel?.remove(); panel = null; hidden = true; drawPill(); };
  panel.__close = close;
  panel.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-p]');
    if (b && b.dataset.p === 'stop') { for (const x of q) if (['wait', 'later'].includes(x.st)) { await dropFile(x.id); } q = q.filter((x) => !['wait', 'later'].includes(x.st)); clearTimeout(retryT); save(); close(); if (!running) { q = []; drawPill(); } return; }
    if (b || !e.target.closest('.modal')) close();
  });
  document.body.appendChild(panel);
  draw();
}

/** Ulaz: više PDF fajlova (prevlačenje ili izbor). Klasifikuje, upozori, pa pokrene red. */
export async function importPdfs(files) {
  const list = [...files].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)).slice(0, 50);
  if (!list.length) return;
  toast(t('pdfq.checking'));
  const items = [];
  let text = 0, scan = 0;
  for (const f of list) {
    if (f.size > 30 * 1024 * 1024) continue;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    let kind = '?';
    try { const r = await textSong(new Uint8Array(await f.arrayBuffer())); kind = r.song ? 'text' : 'scan'; try { r.doc.destroy(); } catch {} } catch { kind = 'scan'; }
    if (kind === 'text') text++; else scan++;
    items.push({ id, name: f.name, kind, st: 'wait', msg: '', file: f });
  }
  if (!items.length) return;
  const ok = await dialog({
    title: t('pdfq.askTitle', { n: items.length }), html: true,
    body: `<div class="pq-row"><span class="pq-pdf">PDF</span><span class="pq-name">${esc(t('pdfq.textN', { n: text }))}</span><span class="pq-st ok">${esc(t('pdfq.textHow'))}</span></div>
      <div class="pq-row"><span class="pq-pdf">PDF</span><span class="pq-name">${esc(t('pdfq.scanN', { n: scan }))}</span><span class="pq-st wait">${esc(t('pdfq.scanHow'))}</span></div>
      ${scan ? `<p class="pq-warn"><b>${esc(t('pdfq.warnTitle', { n: scan }))}</b> ${esc(t('pdfq.warnBody'))}</p>` : ''}`,
    buttons: [{ label: t('common.cancel'), value: false }, { label: t('pdfq.go'), value: true, kind: 'primary' }],
  });
  if (!ok) return;
  for (const it of items) { await putFile(it.id, it.file); delete it.file; }
  q = q.filter((x) => ['wait', 'run', 'later'].includes(x.st)).concat(items);
  save();
  openPanel();
  run();
}

/** Pri pokretanju: nedovršen red (npr. Gemini limit juče) se nastavlja sam. */
export function resumePdfQueue() {
  try { q = JSON.parse(localStorage.getItem(LS) || '[]'); } catch { q = []; }
  q = q.filter((x) => x && x.id).map((x) => ({ ...x, st: x.st === 'run' ? 'wait' : x.st }));
  if (!q.length) return;
  hidden = true; drawPill();
  setTimeout(run, 4000);
}
