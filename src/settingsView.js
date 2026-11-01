// Tab "Podešavanja": Gemini ključ, tuner, rezervna kopija, instalacija.
import { settings, songs as db } from './db.js';
import { testKey, GeminiError } from './gemini.js';
import { esc, toast, confirmDialog, pickFile, dialog } from './ui.js';
import { exportAll } from './songs.js';
import { parseBackup, SongFormatError } from './songformat.js';
import { APP_VERSION } from './version.js';

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function renderSettings(root) {
  const key = await settings.get('geminiKey', '');
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
      <div class="row wrap">
        <button class="btn primary" id="kSave">Sačuvaj</button>
        <button class="btn" id="kTest">Proveri ključ</button>
        <button class="btn danger-text" id="kDel" ${key ? '' : 'hidden'}>Obriši ključ</button>
      </div>
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

    <div class="card">
      <h2>Rezervna kopija</h2>
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
  $('kSave').addEventListener('click', async () => {
    const v = $('kInput').value.trim();
    if (!v) { status('Unesi ključ pre čuvanja.', 'err'); return; }
    await settings.set('geminiKey', v);
    $('kDel').hidden = false;
    status('Ključ je sačuvan na ovom uređaju.', 'ok');
    toast('Ključ je sačuvan.');
  });
  $('kTest').addEventListener('click', async () => {
    const v = $('kInput').value.trim();
    if (!v) { status('Prvo unesi ključ.', 'err'); return; }
    $('kTest').disabled = true;
    status('Proveravam ključ…');
    try {
      await testKey(v);
      status('Ključ radi ✓', 'ok');
      const saved = await settings.get('geminiKey', '');
      if (saved !== v) status('Ključ radi ✓ — ne zaboravi da klikneš „Sačuvaj“.', 'ok');
    } catch (e) {
      status(e instanceof GeminiError ? e.message : 'Provera nije uspela. Pokušaj ponovo.', 'err');
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

  const ib = $('installBtn');
  if (ib && deferredInstall) {
    ib.hidden = false;
    ib.addEventListener('click', async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; ib.hidden = true; });
  }
}
