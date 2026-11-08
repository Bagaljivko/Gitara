// Tab "Podešavanja": Gemini ključ, tuner, rezervna kopija, instalacija.
import { settings, songs as db } from './db.js';
import { testKey, diagnose, explain, GeminiError, cleanModelName, AUTO, getModelSetting, listModels } from './gemini.js';
import { esc, toast, confirmDialog, pickFile, dialog } from './ui.js';
import { parseBackup, SongFormatError } from './songformat.js';
import { APP_VERSION } from './version.js';
import { tunerSettingsHTML, bindTunerSettings, loadTunerSettings } from './tunerSettings.js';
import { t, getLang, setLang } from './i18n.js';
import { canShareNative } from './shareService.js';
import { syncState, onSyncChange, statusText, connectSync, reconnect as syncReconnect, disconnectSync, syncNow, initSync } from './sync.js';
import { driveState, onDriveChange, connect as driveConnect, disconnect as driveDisconnect, reconnect as driveReconnect, backupNow, restoreFlow, formatDate, DriveError } from './drive.js';

import { isStandalone, isIOS, isComputer, canPromptInstall, promptInstall } from './install.js';
import { checkForUpdate, appUrl } from './update.js';
import { WAKE_MODES, WAKE_MINUTES } from './wakelock.js';
import { NOTE_NAMES, noteNamesPref, setNoteNamesPref } from './naming.js';

export async function renderSettings(root) {
  const key = await settings.get('geminiKey', '');
  const keySync = (await settings.get('keySync', true)) !== false; // v1.68: ključ ide na ostale uređaje (uz sinhronizaciju)
  const model = await getModelSetting();
  const lastModel = cleanModelName(await settings.get('geminiLastModel', ''));
  const cachedModels = ((await settings.get('geminiModels', null)) || {}).list || [];
  const tset = await loadTunerSettings();
  const wakeMode = WAKE_MODES.includes(await settings.get('wakeMode', 'songs')) ? await settings.get('wakeMode', 'songs') : 'songs';
  const wakeMin = WAKE_MINUTES.includes(Number(await settings.get('wakeMinutes', 10))) ? Number(await settings.get('wakeMinutes', 10)) : 10;
  const strumOn = (await settings.get('strumSuggest', true)) !== false;
  root.innerHTML = `
  <section class="view settings-view">
    <header class="view-head"><h1>${t('set.title')}</h1>
      <button class="btn small share-app-btn" id="bShareApp" aria-label="${t('appShare.btnLabel')}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h8v8H3zm2 2v4h4V5zm8-2h8v8h-8zm2 2v4h4V5zM3 13h8v8H3zm2 2v4h4v-4zm8-2h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2zm4 0h2v4h-4v-2h2zm0-4h2v2h-2zm2 2h2v2h-2zM6 6h2v2H6zm10 0h2v2h-2zM6 16h2v2H6z"/></svg>${t('appShare.btn')}</button>
    </header>

    <div class="card">
      <h2>${t('set.lang')}</h2>
      <div class="seg-tabs lang-tabs" role="radiogroup" aria-label="${t('set.lang')}">
        <button role="radio" data-lang="sr" class="${getLang() === 'sr' ? 'active' : ''}" aria-checked="${getLang() === 'sr'}">${t('set.langSr')}</button>
        <button role="radio" data-lang="en" class="${getLang() === 'en' ? 'active' : ''}" aria-checked="${getLang() === 'en'}">${t('set.langEn')}</button>
      </div>
      <h3 class="sens-title">${t('nn.title')}</h3>
      <div class="wake-opts" role="radiogroup" aria-label="${t('nn.title')}">
        ${NOTE_NAMES.map((v) => `<button role="radio" class="wake-opt${noteNamesPref() === v ? ' active' : ''}" data-nn="${v}" aria-checked="${noteNamesPref() === v}"><b>${t('nn.' + v)}</b><span class="small muted">${t('nn.note_' + v)}</span></button>`).join('')}
      </div>
    </div>

    <div class="card" id="songsSetCard">
      <h2>${t('set.songsTitle')}</h2>
      <label class="switch set-switch"><input type="checkbox" id="strumSuggestSw"${strumOn ? ' checked' : ''}><span class="switch-track"><span class="switch-thumb"></span></span><span><b>${t('set.strumSuggest')}</b><small class="muted">${t('set.strumSuggestHint')}</small></span></label>
      <a class="btn wide cc-open" href="#/provera">${t('cc.open')}</a>
      <p class="muted small">${t('cc.openNote')}</p>
    </div>

    <div class="card">
      <h2>${t('set.keyTitle')}</h2>
      <p class="muted small">${t('set.keyOnlyFor')}</p>
      <div class="key-row">
        <input type="password" id="kInput" value="${esc(key)}" placeholder="${t('set.keyPh')}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${t('set.keyTitle')}">
        <button class="btn small" id="kShow" aria-label="${t('set.showKey')}">${t('set.show')}</button>
      </div>
      <label class="model-label" for="mSelect">${t('set.model')}</label>
      <div class="model-row">
        <select id="mSelect" aria-label="${t('set.model')}"></select>
        <button class="btn small round" id="mRefresh" type="button" aria-label="${t('set.modelRefresh')}" title="${t('set.modelRefresh')}">↻</button>
      </div>
      <p class="muted small" id="mHint">${t('set.modelAutoHint')}${lastModel ? ' ' + esc(t('set.modelLast', { model: lastModel })) : ''}</p>
      <div class="row wrap">
        <button class="btn primary" id="kSave">${t('common.save')}</button>
        <button class="btn" id="kTest">${t('set.testKey')}</button>
        <button class="btn danger-text" id="kDel" ${key ? '' : 'hidden'}>${t('set.deleteKey')}</button>
      </div>
      <button class="btn small" id="mUseSuggested" hidden></button>
      <button class="btn small" id="kRetry" hidden>${t('common.retry')}</button>
      <p class="status" id="kStatus" role="status">${key ? t('set.keySaved') : t('set.keyMissing')}</p>
      <div class="gdx" id="kDiag" hidden><b class="gdx-t"></b><p class="gdx-b"></p></div>
      <div class="key-lost" id="kLost"${key ? ' hidden' : ''}>
        <b>${t('set.kLostTitle')}</b>
        <p class="muted small">${t('set.kLostBody')}</p>
        <button class="btn primary wide" id="kFromAcct" type="button">${t('set.kFromAcct')}</button>
        <div class="gdx" id="kLostRes" hidden><b class="gdx-t"></b><p class="gdx-b"></p></div>
      </div>
      <label class="switch set-switch key-sync"><input type="checkbox" id="keySyncSw"${keySync ? ' checked' : ''}><span class="switch-track"><span class="switch-thumb"></span></span><span><b>${t('set.keySync')}</b><small class="muted">${t('set.keySyncHint')}</small></span></label>

      <div class="help-box">
        <h3>${t('set.helpTitle')}</h3>
        <ol>
          <li>${t('set.help1')}</li>
          <li>${t('set.help2')}</li>
          <li>${t('set.help3')}</li>
        </ol>
        <a class="btn wide" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">${t('set.openStudio')}</a>
        <p class="muted small">${t('set.keyNote')}</p>
      </div>
    </div>

    <div class="card">
      <h2>${t('set.tunerTitle')}</h2>
      <div id="tsetBox">${tunerSettingsHTML(tset)}</div>
    </div>

    <div class="card">
      <h2>${t('wake.title')}</h2>
      <div class="wake-opts" role="radiogroup" aria-label="${t('wake.title')}">
        ${WAKE_MODES.map((m) => `<button role="radio" class="wake-opt${m === wakeMode ? ' active' : ''}" data-wake="${m}" aria-checked="${m === wakeMode}">
          <b>${t('wake.mode_' + m)}</b><span class="small muted">${t('wake.note_' + m)}</span></button>`).join('')}
      </div>
      <div id="wakeMinBox" ${wakeMode === 'songs' ? '' : 'hidden'}>
        <h3 class="sens-title">${t('wake.minutes')}</h3>
        <div class="seg-tabs sens-tabs" role="radiogroup" aria-label="${t('wake.minutes')}">
          ${WAKE_MINUTES.map((n) => `<button role="radio" data-wmin="${n}" class="${n === wakeMin ? 'active' : ''}" aria-checked="${n === wakeMin}">${t('wake.min', { n })}</button>`).join('')}
        </div>
      </div>
      ${'wakeLock' in navigator ? '' : `<p class="small muted">${t('wake.unsupported')}</p>`}
    </div>

    ${isComputer() ? '' : `<div class="desk-note" id="deskNote"><h2>💻 ${t('pc.title')}</h2><p class="muted small">${t('pc.body', { url: esc(appUrl().replace(/^https?:\/\//, '').replace(/\/$/, '')) })}</p><p class="small" id="deskNoteSync"></p><button class="btn small" id="deskNoteSend">${t('pc.send')}</button></div>`}
    <div class="card drive-card" id="driveCard"></div>

    <div class="card" id="sharedCard">
      <h2>${t('shared.title')}</h2>
      <p class="small muted">${t('shared.intro')}</p>
      <ul class="shared-list" id="sharedList"></ul>
    </div>

    <div class="card" id="bkCard">
      <h2>${t('bk.title')}</h2>
      <p class="bk-conn" id="bkConn"></p>
      <div class="bk-grid">
        <section class="bk-tile bk-full" aria-labelledby="bkFullH">
          <div class="bk-top"><span class="bk-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 3 6v6c0 5 3.8 9.4 9 10 5.2-.6 9-5 9-10V6l-9-4zm-1.2 14.2-3.5-3.5 1.4-1.4 2.1 2.1 4.9-4.9 1.4 1.4z"/></svg></span><div><b id="bkFullH">${t('bk.fullTitle')}</b><small>${t('bk.fullSub')}</small></div><span class="bk-tag">${t('bk.fullTag')}</span></div>
          <ul class="bk-chips" id="bkFullChips"></ul>
          <p class="bk-state" id="bkFullState"></p>
          <div class="bk-actions">
            <button class="btn primary" id="bkFullSave"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 10.2A7 7 0 0 0 6.1 8.1 5 5 0 0 0 6.5 18H11v-4.2l-1.6 1.6L8 14l4-4 4 4-1.4 1.4-1.6-1.6V18h5.5a4 4 0 0 0 .9-7.8z"/></svg><span>${t('bk.fullSave')}</span></button>
            <button class="btn" id="bkFullRestore"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 10.2A7 7 0 0 0 6.1 8.1 5 5 0 0 0 6.5 18h12a4 4 0 0 0 .9-7.8zM12 16.5l-4-4 1.4-1.4 1.6 1.6V8h2v4.7l1.6-1.6 1.4 1.4z"/></svg><span>${t('bk.fullRestore')}</span></button>
          </div>
          <p class="bk-more"><button type="button" class="link-btn" data-bkf="full:save">${t('bk.fileSave')}</button> · <button type="button" class="link-btn" data-bkf="full:open">${t('bk.fileOpen')}</button></p>
          <p class="bk-warn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 9V7a5 5 0 0 0-10 0v2H5v13h14V9zm-8-2a3 3 0 0 1 6 0v2H9z"/></svg><span>${t('bk.fullWarn')}</span></p>
        </section>
        <section class="bk-tile bk-songs" aria-labelledby="bkSongsH">
          <div class="bk-top"><span class="bk-ico"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10.6A4 4 0 1 0 14 17V7h4V3h-6z"/></svg></span><div><b id="bkSongsH">${t('bk.songsTitle')}</b><small>${t('bk.songsSub')}</small></div><span class="bk-tag">${t('bk.songsTag')}</span></div>
          <ul class="bk-chips" id="bkSongsChips"></ul>
          <p class="bk-state" id="bkSongsState"></p>
          <div class="bk-actions">
            <button class="btn" id="bkSongsSave"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 10.2A7 7 0 0 0 6.1 8.1 5 5 0 0 0 6.5 18H11v-4.2l-1.6 1.6L8 14l4-4 4 4-1.4 1.4-1.6-1.6V18h5.5a4 4 0 0 0 .9-7.8z"/></svg><span>${t('bk.songsSave')}</span></button>
            <button class="btn" id="bkSongsRestore"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 10.2A7 7 0 0 0 6.1 8.1 5 5 0 0 0 6.5 18h12a4 4 0 0 0 .9-7.8zM12 16.5l-4-4 1.4-1.4 1.6 1.6V8h2v4.7l1.6-1.6 1.4 1.4z"/></svg><span>${t('bk.songsRestore')}</span></button>
          </div>
          <p class="bk-more"><button type="button" class="link-btn" data-bkf="songs:save">${t('bk.fileSave')}</button> · <button type="button" class="link-btn" data-bkf="songs:open">${t('bk.fileOpen')}</button></p>
        </section>
      </div>
    </div>

    <div class="card" id="installCard" ${isStandalone() ? 'hidden' : ''}>
      <h2>${t('set.installTitle')}</h2>
      ${isIOS()
        ? `<p class="small">${t('set.installIos')}</p>`
        : `<p class="small">${t(isComputer() ? 'set.installPc' : 'set.installAndroid')}</p><button class="btn primary" id="installBtn" hidden>${t('set.install')}</button>`}
    </div>

    <div class="card" id="diagCard">
      <h2>${t('diag.title')}</h2>
      <p class="muted small">${t('diag.note')}</p>
      <p class="small" id="diagSum"></p>
      <div class="row wrap">
        <button class="btn" id="diagCopy">${t('diag.copy')}</button>
        <button class="btn" id="diagClear">${t('diag.clear')}</button>
        <button class="btn" id="diagScan">${t('diag.lastScan')}</button>
      </div>
      <textarea readonly class="diag-report" id="diagOut" rows="8" hidden></textarea>
    </div>

    <div class="card about-card" id="aboutCard">
      <h2>${t('about.title')}</h2>
      <button type="button" class="about-ico" id="aboutIco" aria-label="${t('about.replay')}"><img src="icons/icon-192.png" alt="" width="88" height="88"></button>
      <button type="button" class="about-name" id="aboutName" aria-label="${t('about.replay')}">MARLI</button>
      <p class="about-acr">${t('about.acr')}</p>
      <p class="about-ver" id="aboutVer">${t('about.version', { v: APP_VERSION })}</p>
      <button type="button" class="btn small wn-btn" id="aboutNew">${t('wn.btn', { v: APP_VERSION.split('.').slice(0, 2).join('.') })} ›</button>
      <p class="about-off">${t('about.offline')}</p>
      <p class="about-hint">${t('about.hint')}</p>
    </div>
    <div class="about muted small">
      <div class="card pr-dbg" id="prDbg" hidden>
        <label class="switch-row"><input type="checkbox" id="prDbgOn"> <span>${t('pr.debug.toggle')}</span></label>
        <p class="small">${t('pr.debug.note')}</p>
        <div class="row wrap"><button class="btn small" id="prDbgShow">${t('pr.debug.show')}</button><button class="btn small" id="prDbgCopy">${t('diag.copy')}</button><button class="btn small" id="prDbgClear">${t('diag.clear')}</button></div>
        <textarea readonly class="diag-report" id="prDbgOut" rows="8" hidden></textarea>
      </div>
      <button class="btn small" id="bUpdate">${t('update.check')}</button>
      <button class="btn small keys-btn" id="bKeys">⌨ ${t('keys.title')} <kbd>?</kbd></button>
      <p><a href="privacy.html" target="_blank" rel="noopener">${t('set.privacy')}</a></p>
      <p class="credits">${t('set.credits')}</p>
    </div>
  </section>`;

  const $ = (id) => root.querySelector('#' + id);

  // Skriveno: 5 dodira na verziju → dnevnik slušanja za Vežbe (šta igre čuju za svaku metu)
  let verTaps = 0, verT = 0;
  // Pesme → „Predlaži ritam“ (isto se isključuje i preko „Ne predlaži više“ na samom predlogu)
  $('strumSuggestSw').addEventListener('change', (e) => settings.set('strumSuggest', e.target.checked));
  // v1.70: „Šta je novo“ (zlatna tačka dok se ne pogleda)
  import('./whatsnew.js').then((W) => { if (W.unseen()) $('aboutNew')?.insertAdjacentHTML('beforeend', '<i class="wn-dot" aria-hidden="true"></i>'); });
  $('aboutNew').addEventListener('click', async () => (await import('./whatsnew.js')).showWhatsNew());
  // O aplikaciji: dodir na naslov (ili ikonicu) ponovo pušta uvodnu animaciju
  const replayIntro = () => { if (window.__marliIntro) window.__marliIntro(true); };
  $('aboutName').addEventListener('click', replayIntro);
  $('aboutIco').addEventListener('click', replayIntro);
  $('aboutVer').addEventListener('click', async () => {
    verTaps++; clearTimeout(verT); verT = setTimeout(() => (verTaps = 0), 1500);
    if (verTaps < 5) return;
    verTaps = 0;
    const L = await import('./practiceListen.js');
    $('prDbg').hidden = false;
    $('prDbgOn').checked = L.debugEnabled();
    $('prDbgOn').onchange = () => L.setDebug($('prDbgOn').checked);
    const text = () => L.readDebugLog().map((r) => `${r.t} ${r.game || ''} meta ${r.target} čuje ${r.heard ?? '?'} [${r.score}/${r.nb}] ${r.verdict} (${r.stage})`).join('\n') || t('pr.debug.empty');
    $('prDbgShow').onclick = () => { $('prDbgOut').hidden = false; $('prDbgOut').textContent = text(); };
    $('prDbgCopy').onclick = async () => { try { await navigator.clipboard.writeText(text()); toast(t('diag.copied')); } catch { $('prDbgOut').hidden = false; $('prDbgOut').textContent = text(); } };
    $('prDbgClear').onclick = () => { L.clearDebugLog(); $('prDbgOut').textContent = ''; };
    $('prDbg').scrollIntoView({ block: 'nearest' });
  });

  // Svaka celina podešavanja se otvara/zatvara dodirom na naslov; pamti se šta je otvoreno
  const openSet = (() => { try { return new Set(JSON.parse(localStorage.getItem('gitara-set-open') || '["lang"]')); } catch { return new Set(['lang']); } })();
  const saveOpen = () => { try { localStorage.setItem('gitara-set-open', JSON.stringify([...openSet])); } catch {} };
  const groups = [['lang', 0], ['songs', 1], ['scan', 2], ['tuner', 3], ['screen', 4], ['drive', 5], ['shared', 6], ['file', 7], ['install', 8], ['diag', 9]];
  const cards = [...root.querySelectorAll('.settings-view > .card')];
  groups.forEach(([key, idx]) => {
    const card = cards[idx];
    if (!card) return;
    const det = document.createElement('details');
    det.className = 'card set-group' + (card.id === 'installCard' ? ' install-group' : '');
    det.dataset.g = key;
    if (card.hidden) det.hidden = true;
    det.open = openSet.has(key);
    const sum = document.createElement('summary');
    const h2 = card.querySelector(':scope > h2');
    sum.innerHTML = `<h2>${h2 ? h2.innerHTML : t('sync.group')}</h2>`;
    if (h2) h2.remove();
    card.replaceWith(det);
    det.appendChild(sum);
    if (key === 'drive') { card.classList.remove('card'); det.appendChild(card); } // Drive karta se sama ponovo iscrtava
    else { const body = document.createElement('div'); body.className = 'set-body'; while (card.firstChild) body.appendChild(card.firstChild); det.appendChild(body); for (const a of card.attributes) if (a.name !== 'class' && a.name !== 'hidden') body.setAttribute(a.name, a.value); }
    det.addEventListener('toggle', () => { if (det.open) openSet.add(key); else openSet.delete(key); saveOpen(); });
  });

  // ---- Dijagnostika: greške i brzina pokretanja (samo na uređaju) ----
  const diagSum = () => {
    let log = [], boots = [];
    try { log = JSON.parse(localStorage.getItem('gitara-diag') || '[]'); boots = JSON.parse(localStorage.getItem('gitara-boots') || '[]'); } catch {}
    const errs = log.filter((e) => e.k !== 'discarded' && e.k !== 'repair').length;
    const avg = boots.length ? Math.round(boots.reduce((a, b) => a + b.ms, 0) / boots.length) : 0;
    $('diagSum').textContent = (errs ? t('diag.errors', { n: errs }) : t('diag.noErrors')) + (avg ? ' · ' + t('diag.boot', { ms: avg }) : '');
  };
  diagSum();
  $('diagCopy').addEventListener('click', async () => {
    const { buildReport } = await import('./diag.js');
    const txt = await buildReport();
    $('diagOut').textContent = txt;
    $('diagOut').hidden = false;
    try { await navigator.clipboard.writeText(txt); toast(t('diag.copied')); }
    catch { toast(t('diag.copyManual')); }
  });
  // Poslednje skeniranje (i uspešno): model, trajanje i ishod svakog zahteva — za slanje kad skeniranje traje predugo
  $('diagScan').addEventListener('click', async () => {
    let r = null; try { r = JSON.parse(localStorage.getItem('gitara-lastscan') || 'null'); } catch {}
    const txt = r && r.text ? r.text : t('diag.noScan');
    $('diagOut').textContent = txt;
    $('diagOut').hidden = false;
    if (r && r.text) { try { await navigator.clipboard.writeText(txt); toast(t('diag.copied')); } catch { toast(t('diag.copyManual')); } }
  });
  $('diagClear').addEventListener('click', async () => {
    const { clearDiag } = await import('./diag.js');
    clearDiag(); $('diagOut').hidden = true; diagSum(); toast(t('diag.cleared'));
  });

  // ---- v1.70: „MARLI i na računaru“ (telefon/tablet): stanje sinhronizacije + pošalji link sebi ----
  if ($('deskNote')) {
    const drawNote = async () => {
      const on = !!(((await settings.get('syncCfg', null)) || {}).on), el = $('deskNoteSync'); if (!el) return;
      el.innerHTML = on ? `<span class="ok-txt">✓ ${esc(t('pc.syncOn'))}</span>` : `${esc(t('pc.syncOff'))} <button class="btn small primary" id="deskNoteOn">${esc(t('sync.offerBtn'))}</button>`;
      $('deskNoteOn')?.addEventListener('click', async () => { try { const { connectSync } = await import('./sync.js'); await connectSync(); } catch (e) { if (e && e.code !== 'cancelled') toast((e && e.message) || t('common.error'), 'error'); } drawNote(); });
    };
    drawNote();
    $('deskNoteSend').addEventListener('click', async () => { const ss = await import('./shareService.js'); if (canShareNative()) await ss.shareApp(appUrl()); else await ss.copyAppLink(appUrl()); });
  }

  // ---- Podeli aplikaciju: QR kod koji drugi telefon skenira kamerom ----
  $('bShareApp').addEventListener('click', async () => {
    const url = appUrl();
    const { qrSVG } = await import('./qr.js');
    const canShare = canShareNative();
    const v = await dialog({
      title: t('appShare.title'),
      html: true,
      className: 'qr-modal',
      body: `<div class="qr-box">${qrSVG(url, { label: t('appShare.qrLabel') })}</div>
        <p class="qr-hint">${esc(t('appShare.hint'))}</p>
        <p class="qr-url">${esc(url)}</p>
        <div class="desk-note-sm"><b>💻 ${esc(t('pc.shareTitle'))}</b> ${esc(t('pc.shareBody'))}</div>`,
      buttons: [
        ...(canShare ? [{ label: t('appShare.send'), value: 'share' }] : []),
        { label: t('appShare.copy'), value: 'copy' },
        { label: t('common.close'), value: null, kind: 'primary' },
      ],
    });
    const ss = v ? await import('./shareService.js') : null; // jedini put za deljenje
    if (v === 'share') await ss.shareApp(url);
    else if (v === 'copy') await ss.copyAppLink(url);
  });

  // ---- Imena nota ----
  root.querySelectorAll('[data-nn]').forEach((b) => b.addEventListener('click', () => {
    root.querySelectorAll('[data-nn]').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', String(x === b)); });
    setNoteNamesPref(b.dataset.nn); // ekrani se odmah ponovo iscrtavaju
  }));

  // ---- Ekran ostaje upaljen ----
  root.querySelectorAll('[data-wake]').forEach((b) => b.addEventListener('click', async () => {
    root.querySelectorAll('[data-wake]').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', String(x === b)); });
    $('wakeMinBox').hidden = b.dataset.wake !== 'songs';
    await settings.set('wakeMode', b.dataset.wake);
  }));
  root.querySelectorAll('[data-wmin]').forEach((b) => b.addEventListener('click', async () => {
    root.querySelectorAll('[data-wmin]').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', String(x === b)); });
    await settings.set('wakeMinutes', Number(b.dataset.wmin));
  }));

  $('bKeys').addEventListener('click', () => import('./keys.js').then((m) => m.showShortcuts()));
  // ---- Proveri ažuriranja ----
  $('bUpdate').addEventListener('click', async () => {
    const b = $('bUpdate');
    b.disabled = true;
    b.innerHTML = `<span class="spinner"></span> ${t('update.checking')}`;
    let r = 'unsupported';
    try { r = await checkForUpdate(); } catch {}
    if (r === 'updating') { b.innerHTML = `<span class="spinner"></span> ${t('update.installing')}`; return; }
    b.disabled = false;
    b.textContent = t('update.check');
    toast(r === 'latest' ? t('update.latest', { v: APP_VERSION }) : r === 'offline' ? t('update.offline') : t('update.unsupported'));
  });

  const status = (msg, cls = '') => { const s = $('kStatus'); s.textContent = msg; s.className = 'status ' + cls; };

  $('kShow').addEventListener('click', () => {
    const show = $('kInput').type === 'password';
    $('kInput').type = show ? 'text' : 'password';
    $('kShow').textContent = show ? t('set.hide') : t('set.show');
  });
  // Padajući spisak: „Automatski“ + modeli dostupni za ovaj ključ (najnoviji Flash prvi)
  const fillModels = (list, selected) => {
    const names = [...list];
    if (selected !== AUTO && !names.includes(selected)) names.unshift(selected);
    $('mSelect').innerHTML = `<option value="${AUTO}">${esc(t('set.modelAuto'))}</option>`
      + names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    $('mSelect').value = selected;
  };
  fillModels(cachedModels, model);
  const loadModels = async (force) => {
    const v = $('kInput').value.replace(/\s+/g, ''); $('kInput').value = v;
    if (!v) { $('mHint').textContent = t('set.modelNeedKey'); return; }
    $('mRefresh').disabled = true;
    $('mRefresh').classList.add('spin');
    const keep = $('mSelect').value;
    try {
      const list = await listModels(v, { force });
      fillModels(list, keep);
      $('mHint').textContent = t('set.modelCount', { n: list.length });
    } catch (e) {
      $('mHint').textContent = e instanceof GeminiError ? e.message : t('set.modelLoadFailed');
    } finally {
      $('mRefresh').disabled = false;
      $('mRefresh').classList.remove('spin');
    }
  };
  $('mRefresh').addEventListener('click', () => loadModels(true));
  if (key && !cachedModels.length && navigator.onLine !== false) loadModels(false);
  const readModel = () => $('mSelect').value || AUTO;
  const modelLabel = (m) => (m === AUTO ? t('set.modelAuto') : m);
  $('kSave').addEventListener('click', async () => {
    const v = $('kInput').value.replace(/\s+/g, ''); $('kInput').value = v;
    const m = readModel();
    await settings.set('geminiModelSel', m);
    if (!v) { status(t('set.modelSavedNoKey'), 'err'); return; }
    await settings.set('geminiKey', v);
    $('kDel').hidden = false; $('kLost').hidden = true;
    status(t('set.keyModelSaved', { model: modelLabel(m) }), 'ok');
    toast(t('common.saved'));
    if (!cachedModels.length) loadModels(false);
  });
  $('kRetry').addEventListener('click', () => $('kTest').click());
  // v1.70.1: ključ je nestao (obrisani podaci / nov telefon) → vrati ga sa Google naloga (sinhronizacija), bez kucanja
  $('kFromAcct').addEventListener('click', async () => {
    const btn = $('kFromAcct'), res = $('kLostRes');
    const show = (level, title, body) => { res.hidden = false; res.className = 'gdx ' + level; res.querySelector('.gdx-t').textContent = title; res.querySelector('.gdx-b').textContent = body; };
    btn.disabled = true; res.hidden = true; status(t('set.kFromAcctBusy'));
    try {
      const db = await import('./db.js');
      if ((await settings.get('keySync', true)) === false) { await db.setKeySync(true); $('keySyncSw').checked = true; } // ključ koji je čekao sa strane se odmah primenjuje
      const Y = await import('./sync.js');
      if (!Y.syncState().on) { if (!(await Y.connectSync())) { status(''); btn.disabled = false; return; } } else Y.syncNow();
      let k = '';
      for (let i = 0; i < 50 && !(k = await settings.get('geminiKey', '')); i++) await new Promise((r) => setTimeout(r, 500));
      status('');
      if (k) {
        $('kInput').value = k; $('kDel').hidden = false; $('kLost').hidden = true;
        status(t('set.kFromAcctOk', { last: k.slice(-4) }), 'ok'); toast(t('set.kFromAcctOk', { last: k.slice(-4) }));
      } else show('wait', t('set.kFromAcctNoneTitle'), t('set.kFromAcctNone'));
    } catch (e) {
      status('');
      show('bad', t('set.kFromAcctErrTitle'), (e && e.user && e.message) || t('set.kFromAcctNone'));
    } finally { btn.disabled = false; }
  });
  $('mUseSuggested').addEventListener('click', async () => {
    const m = $('mUseSuggested').dataset.model;
    fillModels([...$('mSelect').options].map((o) => o.value).filter((x) => x !== AUTO), m);
    await settings.set('geminiModelSel', m);
    $('mUseSuggested').hidden = true;
    status(t('set.modelChanged', { model: m }), 'ok');
  });
  $('kTest').addEventListener('click', async () => {
    const v = $('kInput').value.replace(/\s+/g, ''); $('kInput').value = v;
    if (!v) { status(t('set.enterKeyFirst'), 'err'); return; }
    const m = readModel();
    $('kTest').disabled = true;
    $('mUseSuggested').hidden = true;
    $('kRetry').hidden = true;
    $('kDiag').hidden = true;
    status(t('set.checking', { model: modelLabel(m) }));
    const diag = { attempts: [] };
    try {
      // v1.70.1: vidi se koji je pokušaj i koji model, umesto beskrajnog „zauzet, pokušavam ponovo…“
      const used = await testKey(v, m, (kind, model) => {
        if (kind === 'send') status(diag.attempts.length ? t('gdx.try', { n: diag.attempts.length + 1, model }) : t('set.checking', { model }));
        else if (kind === 'switch') status(t('scan.switchModel', { model }));
      }, diag);
      saveKeyCheck('ok', used, diag);
      status(t('set.keyWorksModel', { model: used }), 'ok');
      const saved = await settings.get('geminiKey', '');
      const savedModel = await getModelSetting();
      if (saved !== v || savedModel !== m) status(t('set.keyWorksModel', { model: used }) + ' — ' + t('set.dontForgetSave'), 'ok');
      if (m === AUTO) $('mHint').textContent = t('set.modelAutoHint') + ' ' + t('set.modelLast', { model: used });
    } catch (e) {
      // v1.70.1: jasno — da li je problem u ključu (uradi nešto) ili kod Google-a / dnevni limit (samo sačekaj)
      const dx = diagnose(e, diag), x = explain(dx);
      saveKeyCheck(dx.kind, '', diag);
      status('');
      const box = $('kDiag'); box.hidden = false; box.className = 'gdx ' + x.level;
      box.querySelector('.gdx-t').textContent = x.title; box.querySelector('.gdx-b').textContent = x.body;
      if (e instanceof GeminiError && (e.code === 'BUSY' || e.code === 'TIMEOUT') && dx.kind !== 'daily') $('kRetry').hidden = false;
      if (e instanceof GeminiError && e.suggestedModel && e.suggestedModel !== m) {
        const b = $('mUseSuggested');
        b.dataset.model = e.suggestedModel;
        b.textContent = t('set.useModel', { model: e.suggestedModel });
        b.hidden = false;
      }
    } finally {
      $('kTest').disabled = false;
    }
  });
  $('keySyncSw').addEventListener('change', async (e) => {
    const { setKeySync } = await import('./db.js');
    await setKeySync(e.target.checked);
    const k = await settings.get('geminiKey', '');
    if (k && !$('kInput').value) { $('kInput').value = k; $('kDel').hidden = false; status(t('set.keySaved'), 'ok'); }
    toast(t(e.target.checked ? 'set.keySyncOn' : 'set.keySyncOff'));
  });
  $('kDel').addEventListener('click', async () => {
    if (!(await confirmDialog(t('set.deleteKeyTitle'), t('set.deleteKeyBody'), t('common.delete'), 'danger'))) return;
    await settings.remove('geminiKey');
    $('kInput').value = '';
    $('kDel').hidden = true; $('kLost').hidden = false;
    status(t('set.keyMissing'));
  });

  bindTunerSettings($('tsetBox'), tset); // isto kao panel na tuneru

  // v1.71: Rezervne kopije — „Cela aplikacija“ (sve, i ključ) i „Samo pesme“. Drive radi sam; fajl je dodatna mogućnost.
  const chip = (k, v, ok) => `<li class="${ok === false ? 'no' : ''}"><span>${esc(k)}</span><b>${esc(String(v))}</b></li>`;
  const drawBk = async () => {
    const B = await import('./backups.js');
    const c = await B.counts(), on = await B.isConnected(), L = B.lastBackups();
    if (!$('bkCard')) return;
    const em = (syncState().email || '');
    $('bkConn').innerHTML = on ? `<span class="bk-dot ok"></span>${esc(t('bk.connOn', { email: em || t('drive.account') }))}` : `<span class="bk-dot"></span>${esc(t('bk.connOff'))}`;
    $('bkFullChips').innerHTML = chip(t('bk.cSongs'), c.songs) + chip(t('bk.cSets'), c.sets) + chip(t('bk.cKey'), c.key ? '✓' : '—', c.key) + chip(t('bk.cPractice'), c.practice ? '✓' : '—', c.practice) + chip(t('bk.cSettings'), '✓');
    $('bkSongsChips').innerHTML = chip(t('bk.cSongs'), c.songs) + chip(t('bk.cFolders'), c.folders);
    for (const [kind, id] of [['full', 'bkFullState'], ['songs', 'bkSongsState']]) {
      const el = $(id); if (!el) continue;
      const local = L[kind] ? t('bk.last', { date: formatDate(L[kind].at), where: t(L[kind].where === 'drive' ? 'bk.whereDrive' : 'bk.whereFile') }) : '';
      const show = (cls, txt) => { el.className = 'bk-state ' + cls; el.textContent = txt; };
      show(L[kind] ? 'ok' : 'warn', local || t('bk.never'));
      if (on) B.onDrive(kind).then((d) => { if (d) show('ok', t('bk.onDriveAt', { date: formatDate(d.modified) })); else if (d === null && !(L[kind] && L[kind].where === 'file')) show('warn', t('bk.noneYet')); }).catch(() => {});
    }
  };
  drawBk();
  const bk = (id, fn) => $(id).addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; b.classList.add('busy');
    try { const B = await import('./backups.js'); await B[fn[0]](fn[1]); }
    catch (err) { toast((err && err.message) || t('common.error'), 'error'); }
    finally { b.disabled = false; b.classList.remove('busy'); drawBk(); }
  });
  bk('bkFullSave', ['saveBackup', 'full']); bk('bkSongsSave', ['saveBackup', 'songs']);
  bk('bkFullRestore', ['restoreFull']); bk('bkSongsRestore', ['restoreSongs']);
  $('bkCard').addEventListener('click', async (e) => {
    const l = e.target.closest('[data-bkf]'); if (!l) return;
    const [kind, act] = l.dataset.bkf.split(':'); const B = await import('./backups.js');
    try {
      if (act === 'save') await B.saveFile(kind);
      else if (kind === 'full') await B.restoreFull({ from: 'file' });
      else await B.restoreSongs({ from: 'file' });
    } catch (err) { toast((err && err.message) || t('common.error'), 'error'); }
    drawBk();
  });

  // ---- Google Drive ----
  const driveCard = $('driveCard');
  let driveMsg = '', driveMsgCls = '';
  const drawDrive = () => {
    const d = driveState(), y = syncState();
    // Sinhronizacija između uređaja (skrivena fascikla aplikacije) — glavni način; stara kopija (fajl) ispod
    const pend = y.pending > 0 ? ` · ${esc(t('sync.pending', { n: y.pending }))}` : '';
    const syncHtml = !y.on ? `
        <h3 class="sync-h">${t('sync.title')}</h3>
        <p class="muted small">${t('sync.intro')}</p>
        <button class="btn primary wide" data-d="sync">${t('sync.connect')}</button>`
      : `
        <h3 class="sync-h">${t('sync.title')}</h3>
        <p class="drive-account">${t('sync.account')} <b>${esc(y.email || t('drive.account'))}</b></p>
        <p class="sync-status ${y.status === 'synced' ? 'ok' : y.status === 'error' || y.status === 'quota' || y.status === 'newer' ? 'err' : ''}" role="status">${esc(statusText(y.status) || t('sync.syncing'))}${pend}</p>
        ${y.last ? `<p class="small muted">${t('sync.last')} ${esc(formatDate(y.last))}</p>` : ''}
        ${y.status === 'connect' ? `<button class="btn primary wide" data-d="syncReconnect">${t('sync.connectBtn')}</button>` : ''}
        <div class="row wrap">
          <button class="btn" data-d="syncNow">${t('sync.now')}</button>
          <button class="btn" data-d="versions">${t('ver.title')}</button>
          <button class="btn" data-d="syncSwitch">${t('sync.switch')}</button>
        </div>
        <button class="btn danger-text" data-d="syncOff">${t('sync.off')}</button>`;
    const syncMsg = `<p class="status ${driveMsgCls}" role="status">${esc(driveMsg)}</p>`;
    driveCard.innerHTML = `${syncHtml}${syncMsg}<p class="muted small sync-bk-note">${t('bk.syncNote')}</p>`; // v1.71: kopije su u „Rezervne kopije“
  };
  const setDriveMsg = (m, cls = '') => { driveMsg = m; driveMsgCls = cls; drawDrive(); };
  const driveErr = (e) => (e instanceof DriveError || (e && e.user) ? e.message : t('common.error'));
  drawDrive();
  initSync().catch(() => {}); // stanje (nalog, status) — sama sinhronizacija se ne pokreće ponovo ako već radi
  const unsub = onDriveChange(() => { if (!document.body.contains(driveCard)) return unsub(); drawDrive(); });
  const unsubSync = onSyncChange(() => { if (!document.body.contains(driveCard)) return unsubSync(); drawDrive(); });
  driveCard.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    const a = b.dataset.d;
    if (a === 'sync' || a === 'syncSwitch') {
      setDriveMsg(t('drive.connecting'));
      try { const ok = await connectSync({ pick: a === 'syncSwitch' }); setDriveMsg(ok ? t('sync.okConnected') : '', ok ? 'ok' : ''); }
      catch (err) { setDriveMsg(driveErr(err), 'err'); }
    } else if (a === 'syncReconnect') {
      try { await syncReconnect(); setDriveMsg(''); } catch (err) { setDriveMsg(driveErr(err), 'err'); }
    } else if (a === 'syncNow') { syncNow(); setDriveMsg(''); }
    else if (a === 'versions') { (await import('./versionsView.js')).openVersions(); }
    else if (a === 'syncOff') {
      if (!(await confirmDialog(t('sync.offTitle'), t('sync.offBody'), t('sync.off'), 'danger'))) return;
      await disconnectSync();
      setDriveMsg('');
    } else if (a === 'connect') {
      setDriveMsg(t('drive.connecting'));
      try { await driveConnect(); try { await connectSync(); } catch {} setDriveMsg(t('drive.okConnected'), 'ok'); } // v1.70: sinhronizacija uključena podrazumevano
      catch (err) { setDriveMsg(driveErr(err), 'err'); }
    } else if (a === 'reconnect') {
      try { await driveReconnect(); setDriveMsg(t('drive.okReconnected'), 'ok'); }
      catch (err) { setDriveMsg(driveErr(err), 'err'); }
    } else if (a === 'backup') {
      try { await backupNow(); setDriveMsg(t('drive.okBackup'), 'ok'); }
      catch (err) { setDriveMsg(driveErr(err), 'err'); }
    } else if (a === 'restore') {
      try { if (await restoreFlow()) setDriveMsg(t('drive.okRestore'), 'ok'); }
      catch (err) { setDriveMsg(driveErr(err), 'err'); }
    } else if (a === 'disconnect') {
      if (!(await confirmDialog(t('drive.disconnectTitle'), t('drive.disconnectBody'), t('drive.disconnect'), 'danger'))) return;
      await driveDisconnect();
      setDriveMsg(t('drive.disconnected'));
    }
  });

  // ---- Deljeno: sve što je podeljeno kratkim linkom (Kopiraj link / Prestani da deliš) ----
  const drawShared = async () => {
    const box = $('sharedList');
    if (!box) return;
    const { getShares, copyShareLink, stopSharing } = await import('./shareService.js');
    const list = (await getShares()).slice().sort((a, b) => b.at - a.at);
    box.replaceChildren();
    if (!list.length) { const li = document.createElement('li'); li.className = 'muted small'; li.textContent = t('shared.empty'); box.appendChild(li); return; }
    for (const r of list) {
      const li = document.createElement('li'); li.className = 'shared-item';
      const info = document.createElement('div');
      const b = document.createElement('b'); b.textContent = r.name || '—';
      const sub = document.createElement('span'); sub.className = 'small muted';
      const d = new Date(r.at), p2 = (x) => String(x).padStart(2, '0');
      sub.textContent = `${t('shared.kind.' + (r.what || r.kind) )}${r.frozen ? ' · ' + t('shared.frozen') : ''} · ${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}.`;
      info.append(b, sub);
      const acts = document.createElement('div'); acts.className = 'row';
      const copy = document.createElement('button'); copy.className = 'btn small'; copy.textContent = t('share.copyLink');
      copy.addEventListener('click', () => copyShareLink(r.fileId));
      const stop = document.createElement('button'); stop.className = 'btn small danger-text'; stop.textContent = t('shared.stop');
      stop.addEventListener('click', async () => {
        if (!(await confirmDialog(t('shared.stopTitle'), t('shared.stopBody', { name: r.name }), t('shared.stop'), 'danger'))) return;
        stop.disabled = true;
        try { await stopSharing(r.fileId); toast(t('shared.stopped')); drawShared(); }
        catch (e) { stop.disabled = false; toast((e && e.message) || t('common.error'), 'error'); }
      });
      // „Novi link“: zasebna kopija koja se ne menja sa originalom (ranije u listu posle deljenja — sada ovde, retko treba)
      const fresh = document.createElement('button'); fresh.className = 'btn small'; fresh.textContent = t('share.newLink');
      fresh.hidden = !!r.frozen;
      fresh.addEventListener('click', async () => {
        const ss = await import('./shareService.js');
        const item = await ss.itemFromKey(r.key);
        if (!item) { toast(t('shared.missingItem'), 'error'); return; }
        await ss.shareItem(item, { fresh: true });
        drawShared();
      });
      acts.append(copy, fresh, stop);
      li.append(info, acts);
      box.appendChild(li);
    }
  };
  drawShared();

  // ---- Jezik ----
  root.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

  const ib = $('installBtn');
  if (ib && canPromptInstall()) {
    ib.hidden = false;
    ib.addEventListener('click', async () => { await promptInstall(); ib.hidden = true; });
  }
}

// v1.70.1: poslednja provera ključa ide u dijagnostiku (bez ključa)
function saveKeyCheck(kind, model, diag) {
  try { localStorage.setItem('marli-keycheck', JSON.stringify({ t: Date.now(), kind, model, att: (diag.attempts || []).slice(-12).map((a) => `${a.model} · ${a.status} · ${Math.round(a.ms || 0)} ms${a.message ? ' · ' + String(a.message).slice(0, 160) : ''}`) })); } catch {}
}
