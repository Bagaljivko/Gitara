// Tab "Podešavanja": Gemini ključ, tuner, rezervna kopija, instalacija.
import { settings, songs as db } from './db.js';
import { testKey, GeminiError, DEFAULT_MODEL, cleanModelName } from './gemini.js';
import { esc, toast, confirmDialog, pickFile, dialog } from './ui.js';
import { exportAll } from './songs.js';
import { parseBackup, SongFormatError } from './songformat.js';
import { APP_VERSION } from './version.js';
import { driveState, onDriveChange, connect as driveConnect, disconnect as driveDisconnect, reconnect as driveReconnect, backupNow, restoreFlow, formatDate, DriveError } from './drive.js';

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function renderSettings(root) {
  const key = await settings.get('geminiKey', '');
  const model = cleanModelName(await settings.get('geminiModel', DEFAULT_MODEL)) || DEFAULT_MODEL;
  const a4 = Number(await settings.get('a4', 440)) || 440;
  root.innerHTML = `
  <section class="view settings-view">
    <header class="view-head"><h1>Podešavanja</h1></header>

    <div class="card">
      <h2>Gemini API ključ</h2>
      <p class="muted small">Potreban je samo za „Skeniraj pesmu“.</p>
      <div class="key-row">
        <input type="password" id="kInput" value="${esc(key)}" placeholder="Nalepi ključ ovde" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Gemini API ključ">
        <button class="btn small" id="kShow" aria-label="Prikaži ključ">Prikaži</button>
      </div>
      <label class="model-label">Gemini model
        <input id="mInput" value="${esc(model)}" placeholder="${DEFAULT_MODEL}" autocomplete="off" autocapitalize="off" spellcheck="false">
      </label>
      <p class="muted small">Podrazumevano: <b>${DEFAULT_MODEL}</b>. Promeni samo ako Google ukine ovaj model. <button class="linklike" id="mReset" type="button">Vrati podrazumevani</button></p>
      <div class="row wrap">
        <button class="btn primary" id="kSave">Sačuvaj</button>
        <button class="btn" id="kTest">Proveri ključ</button>
        <button class="btn danger-text" id="kDel" ${key ? '' : 'hidden'}>Obriši ključ</button>
      </div>
      <button class="btn small" id="mUseSuggested" hidden></button>
      <button class="btn small" id="kRetry" hidden>Pokušaj ponovo</button>
      <p class="status" id="kStatus" role="status">${key ? 'Ključ je sačuvan na ovom uređaju.' : 'Ključ nije unet.'}</p>

      <div class="help-box">
        <h3>Kako da dobijem besplatan ključ?</h3>
        <ol>
          <li>Otvori <b>aistudio.google.com</b> i prijavi se svojim Google nalogom.</li>
          <li>Klikni „Get API key“, pa „Create API key“.</li>
          <li>Kopiraj ključ i nalepi ga ovde, pa klikni „Sačuvaj“.</li>
        </ol>
        <a class="btn wide" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Otvori Google AI Studio ↗</a>
        <p class="muted small">Ključ se čuva samo na ovom telefonu. Besplatna verzija ima ograničenja, ali je dovoljna za skeniranje pesama.</p>
      </div>
    </div>

    <div class="card">
      <h2>Tuner</h2>
      <div class="a4-row">
        <span>Referentni ton A4</span>
        <div class="stepper">
          <button class="btn round small" id="aDown" aria-label="Smanji">−</button>
          <b id="aVal">${a4} Hz</b>
          <button class="btn round small" id="aUp" aria-label="Povećaj">+</button>
        </div>
      </div>
      <p class="muted small">Standardno je 440 Hz. Menjaj samo ako sviraš uz instrument koji je drugačije naštimovan.</p>
    </div>

    <div class="card drive-card" id="driveCard"></div>

    <div class="card">
      <h2>Rezervna kopija (fajl)</h2>
      <p class="muted small">Sve pesme se čuvaju samo na ovom uređaju. Napravi rezervnu kopiju pre brisanja aplikacije ili prelaska na novi telefon.</p>
      <div class="row wrap">
        <button class="btn" id="bExport">Izvezi sve pesme</button>
        <button class="btn" id="bImport">Vrati rezervnu kopiju</button>
      </div>
    </div>

    <div class="card" id="installCard" ${isStandalone() ? 'hidden' : ''}>
      <h2>Instaliraj aplikaciju</h2>
      ${isIOS()
        ? '<p class="small">U Safariju dodirni <b>Podeli</b> (kvadrat sa strelicom), pa <b>Dodaj na početni ekran</b>.</p>'
        : '<p class="small">U Chrome-u otvori meni (⋮) i izaberi <b>Instaliraj aplikaciju</b>.</p><button class="btn primary" id="installBtn" hidden>Instaliraj</button>'}
    </div>

    <p class="about muted small">Gitara · verzija ${APP_VERSION}<br>Radi bez interneta (osim skeniranja pesama).</p>
  </section>`;

  const $ = (id) => root.querySelector('#' + id);
  const status = (msg, cls = '') => { const s = $('kStatus'); s.textContent = msg; s.className = 'status ' + cls; };

  $('kShow').addEventListener('click', () => {
    const show = $('kInput').type === 'password';
    $('kInput').type = show ? 'text' : 'password';
    $('kShow').textContent = show ? 'Sakrij' : 'Prikaži';
  });
  const readModel = () => {
    const raw = $('mInput').value.trim();
    if (!raw) return DEFAULT_MODEL;
    return cleanModelName(raw);
  };
  $('mReset').addEventListener('click', () => { $('mInput').value = DEFAULT_MODEL; });
  $('kSave').addEventListener('click', async () => {
    const v = $('kInput').value.trim();
    const m = readModel();
    if (!m) { status('Ime modela nije ispravno (npr. ' + DEFAULT_MODEL + ').', 'err'); return; }
    $('mInput').value = m;
    await settings.set('geminiModel', m);
    if (!v) { status('Model je sačuvan. Unesi i ključ da bi skeniranje radilo.', 'err'); return; }
    await settings.set('geminiKey', v);
    $('kDel').hidden = false;
    status(`Ključ i model (${m}) su sačuvani na ovom uređaju.`, 'ok');
    toast('Sačuvano.');
  });
  $('kRetry').addEventListener('click', () => $('kTest').click());
  $('mUseSuggested').addEventListener('click', async () => {
    const m = $('mUseSuggested').dataset.model;
    $('mInput').value = m;
    await settings.set('geminiModel', m);
    $('mUseSuggested').hidden = true;
    status(`Model je promenjen na ${m}. Klikni „Proveri ključ“.`, 'ok');
  });
  $('kTest').addEventListener('click', async () => {
    const v = $('kInput').value.trim();
    if (!v) { status('Prvo unesi ključ.', 'err'); return; }
    const m = readModel();
    if (!m) { status('Ime modela nije ispravno (npr. ' + DEFAULT_MODEL + ').', 'err'); return; }
    $('kTest').disabled = true;
    $('mUseSuggested').hidden = true;
    $('kRetry').hidden = true;
    status(`Proveravam ključ (model ${m})…`);
    try {
      await testKey(v, m, () => status('Gemini je zauzet, pokušavam ponovo…'));
      status('Ključ radi ✓', 'ok');
      const saved = await settings.get('geminiKey', '');
      const savedModel = await settings.get('geminiModel', DEFAULT_MODEL);
      if (saved !== v || savedModel !== m) status('Ključ radi ✓ — ne zaboravi da klikneš „Sačuvaj“.', 'ok');
    } catch (e) {
      status(e instanceof GeminiError ? e.message : 'Provera nije uspela. Pokušaj ponovo.', 'err');
      if (e instanceof GeminiError && e.code === 'BUSY') $('kRetry').hidden = false;
      if (e instanceof GeminiError && e.suggestedModel && e.suggestedModel !== m) {
        const b = $('mUseSuggested');
        b.dataset.model = e.suggestedModel;
        b.textContent = `Koristi ${e.suggestedModel}`;
        b.hidden = false;
      }
    } finally {
      $('kTest').disabled = false;
    }
  });
  $('kDel').addEventListener('click', async () => {
    if (!(await confirmDialog('Obrisati ključ?', 'Ključ će biti obrisan sa ovog uređaja. Skeniranje neće raditi dok ne uneseš novi.', 'Obriši', 'danger'))) return;
    await settings.remove('geminiKey');
    $('kInput').value = '';
    $('kDel').hidden = true;
    status('Ključ nije unet.');
  });

  let a = a4;
  const setA = async (v) => { a = Math.max(430, Math.min(450, v)); $('aVal').textContent = a + ' Hz'; await settings.set('a4', a); };
  $('aDown').addEventListener('click', () => setA(a - 1));
  $('aUp').addEventListener('click', () => setA(a + 1));

  $('bExport').addEventListener('click', async () => {
    const n = (await db.all()).length;
    if (!n) { toast('Nema pesama za izvoz.'); return; }
    const r = await exportAll();
    if (r === 'downloaded') toast('Rezervna kopija je preuzeta.');
  });
  $('bImport').addEventListener('click', async () => {
    const file = await pickFile('.json,application/json,text/plain');
    if (!file) return;
    try {
      const list = parseBackup(await file.text());
      const existing = await db.all();
      const sig = (s) => JSON.stringify([s.title, s.artist, s.sections]);
      const have = new Set(existing.map(sig));
      let added = 0;
      for (const s of list) if (!have.has(sig(s))) { await db.save(s); added++; }
      toast(added ? `Vraćeno pesama: ${added}` : 'Sve pesme iz kopije već postoje.');
    } catch (e) {
      await dialog({ title: 'Fajl nije ispravan', body: e instanceof SongFormatError ? e.message : 'Fajl ne može da se učita.' });
    }
  });

  // ---- Google Drive ----
  const driveCard = $('driveCard');
  let driveMsg = '', driveMsgCls = '';
  const drawDrive = () => {
    const d = driveState();
    if (!d.connected) {
      driveCard.innerHTML = `
        <h2>Google Drive</h2>
        <p class="muted small">Automatska rezervna kopija pesama u folder „Gitara“ na tvom Google Drive-u. Aplikacija vidi samo fajlove koje sama napravi. Gemini ključ se ne šalje na Drive.</p>
        <button class="btn primary wide" data-d="connect">Poveži Google Drive</button>
        <p class="status ${driveMsgCls}" role="status">${esc(driveMsg)}</p>`;
      return;
    }
    const status = d.busy ? 'Pravim rezervnu kopiju…'
      : d.needsReconnect ? 'Veza je istekla — dodirni „Ponovo poveži“.'
      : d.pending ? (d.lastError || 'Izmene čekaju na rezervnu kopiju…')
      : driveMsg;
    driveCard.innerHTML = `
      <h2>Google Drive</h2>
      <p class="drive-account">Povezano: <b>${esc(d.email || 'Google nalog')}</b></p>
      <p class="small">Poslednja rezervna kopija: <b>${d.lastBackup ? esc(formatDate(d.lastBackup)) : 'još nije napravljena'}</b></p>
      ${d.needsReconnect ? '<button class="btn primary wide" data-d="reconnect">Ponovo poveži</button>' : ''}
      <div class="row wrap">
        <button class="btn" data-d="backup" ${d.busy ? 'disabled' : ''}>Napravi rezervnu kopiju</button>
        <button class="btn" data-d="restore" ${d.busy ? 'disabled' : ''}>Vrati iz Drive-a</button>
      </div>
      <p class="status ${d.needsReconnect || (d.pending && d.lastError) ? 'err' : driveMsgCls}" role="status">${esc(status)}</p>
      <p class="muted small">Kopija se automatski ažurira posle svake izmene pesama. PDF iz „Skini PDF“ se čuva i u folder „Gitara“.</p>
      <button class="btn danger-text" data-d="disconnect">Prekini vezu</button>`;
  };
  const setDriveMsg = (m, cls = '') => { driveMsg = m; driveMsgCls = cls; drawDrive(); };
  const driveErr = (e) => (e instanceof DriveError ? e.message : 'Došlo je do greške. Pokušaj ponovo.');
  drawDrive();
  const unsub = onDriveChange(() => { if (!document.body.contains(driveCard)) return unsub(); drawDrive(); });
  driveCard.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    const a = b.dataset.d;
    if (a === 'connect') {
      setDriveMsg('Povezujem…');
      try { await driveConnect(); setDriveMsg('Google Drive je povezan ✓', 'ok'); }
      catch (err) { setDriveMsg(driveErr(err), 'err'); }
    } else if (a === 'reconnect') {
      try { await driveReconnect(); setDriveMsg('Google Drive je ponovo povezan ✓', 'ok'); }
      catch (err) { setDriveMsg(driveErr(err), 'err'); }
    } else if (a === 'backup') {
      try { await backupNow(); setDriveMsg('Rezervna kopija je sačuvana ✓', 'ok'); }
      catch (err) { setDriveMsg(driveErr(err), 'err'); }
    } else if (a === 'restore') {
      try { if (await restoreFlow()) setDriveMsg('Pesme su vraćene sa Drive-a ✓', 'ok'); }
      catch (err) { setDriveMsg(driveErr(err), 'err'); }
    } else if (a === 'disconnect') {
      if (!(await confirmDialog('Prekinuti vezu?', 'Automatska rezervna kopija na Google Drive se gasi. Fajlovi koji su već na Drive-u ostaju tamo.', 'Prekini vezu', 'danger'))) return;
      await driveDisconnect();
      setDriveMsg('Veza sa Google Drive-om je prekinuta.');
    }
  });

  const ib = $('installBtn');
  if (ib && deferredInstall) {
    ib.hidden = false;
    ib.addEventListener('click', async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; ib.hidden = true; });
  }
}
