// Tab "Podešavanja": Gemini ključ, tuner, rezervna kopija, instalacija.
import { settings, songs as db } from './db.js';
import { testKey, GeminiError, cleanModelName, AUTO, getModelSetting, listModels } from './gemini.js';
import { esc, toast, confirmDialog, pickFile, dialog } from './ui.js';
import { exportAll } from './songs.js';
import { parseBackup, SongFormatError } from './songformat.js';
import { APP_VERSION } from './version.js';
import { t, getLang, setLang } from './i18n.js';
import { driveState, onDriveChange, connect as driveConnect, disconnect as driveDisconnect, reconnect as driveReconnect, backupNow, restoreFlow, formatDate, DriveError } from './drive.js';

import { isStandalone, isIOS, canPromptInstall, promptInstall } from './install.js';
import { checkForUpdate, appUrl } from './update.js';
import { WAKE_MODES, WAKE_MINUTES } from './wakelock.js';
import { NOTE_NAMES, noteNamesPref, setNoteNamesPref } from './naming.js';

export async function renderSettings(root) {
  const key = await settings.get('geminiKey', '');
  const model = await getModelSetting();
  const lastModel = cleanModelName(await settings.get('geminiLastModel', ''));
  const cachedModels = ((await settings.get('geminiModels', null)) || {}).list || [];
  const a4 = Number(await settings.get('a4', 440)) || 440;
  const sens = await settings.get('tunerSens', 'medium');
  const wakeMode = WAKE_MODES.includes(await settings.get('wakeMode', 'songs')) ? await settings.get('wakeMode', 'songs') : 'songs';
  const wakeMin = WAKE_MINUTES.includes(Number(await settings.get('wakeMinutes', 10))) ? Number(await settings.get('wakeMinutes', 10)) : 10;
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
      <div class="a4-row">
        <span>${t('set.a4')}</span>
        <div class="stepper">
          <button class="btn round small" id="aDown" aria-label="${t('set.decrease')}">−</button>
          <b id="aVal">${a4} Hz</b>
          <button class="btn round small" id="aUp" aria-label="${t('set.increase')}">+</button>
        </div>
      </div>
      <p class="muted small">${t('set.a4Note')}</p>
      <h3 class="sens-title">${t('set.sens')}</h3>
      <div class="seg-tabs sens-tabs" role="radiogroup" aria-label="${t('set.sens')}">
        ${['low', 'medium', 'high'].map((v) => `<button role="radio" data-sens="${v}" class="${sens === v ? 'active' : ''}" aria-checked="${sens === v}">${t('set.sens_' + v)}</button>`).join('')}
      </div>
      <p class="muted small" id="sensNote">${t('set.sensNote_' + sens)}</p>
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

    <div class="card drive-card" id="driveCard"></div>

    <div class="card">
      <h2>${t('set.fileBackupTitle')}</h2>
      <p class="muted small">${t('set.fileBackupNote')}</p>
      <div class="row wrap">
        <button class="btn" id="bExport">${t('set.exportAll')}</button>
        <button class="btn" id="bImport">${t('set.importBackup')}</button>
      </div>
      <a class="btn wide cc-open" href="#/provera">${t('cc.open')}</a>
      <p class="muted small">${t('cc.openNote')}</p>
    </div>

    <div class="card" id="installCard" ${isStandalone() ? 'hidden' : ''}>
      <h2>${t('set.installTitle')}</h2>
      ${isIOS()
        ? `<p class="small">${t('set.installIos')}</p>`
        : `<p class="small">${t('set.installAndroid')}</p><button class="btn primary" id="installBtn" hidden>${t('set.install')}</button>`}
    </div>

    <div class="about muted small">
      <p>${t('set.about', { v: APP_VERSION })}</p>
      <button class="btn small" id="bUpdate">${t('update.check')}</button>
      <p><a href="privacy.html" target="_blank" rel="noopener">${t('set.privacy')}</a></p>
      <p class="credits">${t('set.credits')}</p>
    </div>
  </section>`;

  const $ = (id) => root.querySelector('#' + id);

  // Svaka celina podešavanja se otvara/zatvara dodirom na naslov; pamti se šta je otvoreno
  const openSet = (() => { try { return new Set(JSON.parse(localStorage.getItem('gitara-set-open') || '["lang"]')); } catch { return new Set(['lang']); } })();
  const saveOpen = () => { try { localStorage.setItem('gitara-set-open', JSON.stringify([...openSet])); } catch {} };
  const groups = [['lang', 0], ['scan', 1], ['tuner', 2], ['screen', 3], ['drive', 4], ['file', 5], ['install', 6]];
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
    sum.innerHTML = `<h2>${h2 ? h2.innerHTML : t('drive.title')}</h2>`;
    if (h2) h2.remove();
    card.replaceWith(det);
    det.appendChild(sum);
    if (key === 'drive') { card.classList.remove('card'); det.appendChild(card); } // Drive karta se sama ponovo iscrtava
    else { const body = document.createElement('div'); body.className = 'set-body'; while (card.firstChild) body.appendChild(card.firstChild); det.appendChild(body); for (const a of card.attributes) if (a.name !== 'class' && a.name !== 'hidden') body.setAttribute(a.name, a.value); }
    det.addEventListener('toggle', () => { if (det.open) openSet.add(key); else openSet.delete(key); saveOpen(); });
  });

  // ---- Podeli aplikaciju: QR kod koji drugi telefon skenira kamerom ----
  $('bShareApp').addEventListener('click', async () => {
    const url = appUrl();
    const { qrSVG } = await import('./qr.js');
    const canShare = !!navigator.share;
    const v = await dialog({
      title: t('appShare.title'),
      html: true,
      className: 'qr-modal',
      body: `<div class="qr-box">${qrSVG(url, { label: t('appShare.qrLabel') })}</div>
        <p class="qr-hint">${esc(t('appShare.hint'))}</p>
        <p class="qr-url">${esc(url)}</p>`,
      buttons: [
        ...(canShare ? [{ label: t('appShare.send'), value: 'share' }] : []),
        { label: t('appShare.copy'), value: 'copy' },
        { label: t('common.close'), value: null, kind: 'primary' },
      ],
    });
    if (v === 'share') { try { await navigator.share({ title: 'Gitara', text: t('appShare.shareText'), url }); } catch {} }
    else if (v === 'copy') {
      try { await navigator.clipboard.writeText(url); toast(t('appShare.copied')); }
      catch { toast(url); }
    }
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
    const v = $('kInput').value.trim();
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
    const v = $('kInput').value.trim();
    const m = readModel();
    await settings.set('geminiModelSel', m);
    if (!v) { status(t('set.modelSavedNoKey'), 'err'); return; }
    await settings.set('geminiKey', v);
    $('kDel').hidden = false;
    status(t('set.keyModelSaved', { model: modelLabel(m) }), 'ok');
    toast(t('common.saved'));
    if (!cachedModels.length) loadModels(false);
  });
  $('kRetry').addEventListener('click', () => $('kTest').click());
  $('mUseSuggested').addEventListener('click', async () => {
    const m = $('mUseSuggested').dataset.model;
    fillModels([...$('mSelect').options].map((o) => o.value).filter((x) => x !== AUTO), m);
    await settings.set('geminiModelSel', m);
    $('mUseSuggested').hidden = true;
    status(t('set.modelChanged', { model: m }), 'ok');
  });
  $('kTest').addEventListener('click', async () => {
    const v = $('kInput').value.trim();
    if (!v) { status(t('set.enterKeyFirst'), 'err'); return; }
    const m = readModel();
    $('kTest').disabled = true;
    $('mUseSuggested').hidden = true;
    $('kRetry').hidden = true;
    status(t('set.checking', { model: modelLabel(m) }));
    try {
      const used = await testKey(v, m, (kind, model) => status(kind === 'switch' ? t('scan.switchModel', { model }) : t('scan.busy')));
      status(t('set.keyWorksModel', { model: used }), 'ok');
      const saved = await settings.get('geminiKey', '');
      const savedModel = await getModelSetting();
      if (saved !== v || savedModel !== m) status(t('set.keyWorksModel', { model: used }) + ' — ' + t('set.dontForgetSave'), 'ok');
      if (m === AUTO) $('mHint').textContent = t('set.modelAutoHint') + ' ' + t('set.modelLast', { model: used });
    } catch (e) {
      status(e instanceof GeminiError ? e.message : t('set.checkFailed'), 'err');
      if (e instanceof GeminiError && (e.code === 'BUSY' || e.code === 'TIMEOUT')) $('kRetry').hidden = false;
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
  $('kDel').addEventListener('click', async () => {
    if (!(await confirmDialog(t('set.deleteKeyTitle'), t('set.deleteKeyBody'), t('common.delete'), 'danger'))) return;
    await settings.remove('geminiKey');
    $('kInput').value = '';
    $('kDel').hidden = true;
    status(t('set.keyMissing'));
  });

  let a = a4;
  const setA = async (v) => { a = Math.max(430, Math.min(450, v)); $('aVal').textContent = a + ' Hz'; await settings.set('a4', a); };
  $('aDown').addEventListener('click', () => setA(a - 1));
  $('aUp').addEventListener('click', () => setA(a + 1));
  root.querySelectorAll('[data-sens]').forEach((b) => b.addEventListener('click', async () => {
    const v = b.dataset.sens;
    root.querySelectorAll('[data-sens]').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', x === b); });
    $('sensNote').textContent = t('set.sensNote_' + v);
    await settings.set('tunerSens', v);
  }));

  $('bExport').addEventListener('click', async () => {
    const n = (await db.all()).length;
    if (!n) { toast(t('set.nothingToExport')); return; }
    const r = await exportAll();
    if (r === 'downloaded') toast(t('set.backupDownloaded'));
    settings.set('backupNudge', { ...((await settings.get('backupNudge', null)) || {}), exportedAt: Date.now() });
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
      toast(added ? t('set.restored', { n: added }) : t('set.allExist'));
    } catch (e) {
      await dialog({ title: t('import.invalidTitle'), body: e instanceof SongFormatError ? e.message : t('set.cantRead') });
    }
  });

  // ---- Google Drive ----
  const driveCard = $('driveCard');
  let driveMsg = '', driveMsgCls = '';
  const drawDrive = () => {
    const d = driveState();
    if (!d.connected) {
      driveCard.innerHTML = `
        <h2>${t('drive.title')}</h2>
        <p class="muted small">${t('drive.intro')}</p>
        <button class="btn primary wide" data-d="connect">${t('drive.connect')}</button>
        <p class="status ${driveMsgCls}" role="status">${esc(driveMsg)}</p>`;
      return;
    }
    const status = d.busy ? t('drive.busy')
      : d.needsReconnect ? t('drive.expiredStatus')
      : d.pending ? (d.lastError || t('drive.pending'))
      : driveMsg;
    driveCard.innerHTML = `
      <h2>${t('drive.title')}</h2>
      <p class="drive-account">${t('drive.connected')} <b>${esc(d.email || t('drive.account'))}</b></p>
      <p class="small">${t('drive.last')} <b>${d.lastBackup ? esc(formatDate(d.lastBackup)) : t('drive.never')}</b></p>
      ${d.needsReconnect ? `<button class="btn primary wide" data-d="reconnect">${t('drive.reconnect')}</button>` : ''}
      <div class="row wrap">
        <button class="btn" data-d="backup" ${d.busy ? 'disabled' : ''}>${t('drive.backupNow')}</button>
        <button class="btn" data-d="restore" ${d.busy ? 'disabled' : ''}>${t('drive.restore')}</button>
      </div>
      <p class="status ${d.needsReconnect || (d.pending && d.lastError) ? 'err' : driveMsgCls}" role="status">${esc(status)}</p>
      <p class="muted small">${t('drive.auto')}</p>
      <button class="btn danger-text" data-d="disconnect">${t('drive.disconnect')}</button>`;
  };
  const setDriveMsg = (m, cls = '') => { driveMsg = m; driveMsgCls = cls; drawDrive(); };
  const driveErr = (e) => (e instanceof DriveError ? e.message : t('common.error'));
  drawDrive();
  const unsub = onDriveChange(() => { if (!document.body.contains(driveCard)) return unsub(); drawDrive(); });
  driveCard.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    const a = b.dataset.d;
    if (a === 'connect') {
      setDriveMsg(t('drive.connecting'));
      try { await driveConnect(); setDriveMsg(t('drive.okConnected'), 'ok'); }
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

  // ---- Jezik ----
  root.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

  const ib = $('installBtn');
  if (ib && canPromptInstall()) {
    ib.hidden = false;
    ib.addEventListener('click', async () => { await promptInstall(); ib.hidden = true; });
  }
}
