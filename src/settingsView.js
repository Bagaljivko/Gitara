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

export async function renderSettings(root) {
  const key = await settings.get('geminiKey', '');
  const model = await getModelSetting();
  const lastModel = cleanModelName(await settings.get('geminiLastModel', ''));
  const cachedModels = ((await settings.get('geminiModels', null)) || {}).list || [];
  const a4 = Number(await settings.get('a4', 440)) || 440;
  const sens = await settings.get('tunerSens', 'medium');
  root.innerHTML = `
  <section class="view settings-view">
    <header class="view-head"><h1>${t('set.title')}</h1></header>

    <div class="card">
      <h2>${t('set.lang')}</h2>
      <div class="seg-tabs lang-tabs" role="radiogroup" aria-label="${t('set.lang')}">
        <button role="radio" data-lang="sr" class="${getLang() === 'sr' ? 'active' : ''}" aria-checked="${getLang() === 'sr'}">${t('set.langSr')}</button>
        <button role="radio" data-lang="en" class="${getLang() === 'en' ? 'active' : ''}" aria-checked="${getLang() === 'en'}">${t('set.langEn')}</button>
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

    <div class="card drive-card" id="driveCard"></div>

    <div class="card">
      <h2>${t('set.fileBackupTitle')}</h2>
      <p class="muted small">${t('set.fileBackupNote')}</p>
      <div class="row wrap">
        <button class="btn" id="bExport">${t('set.exportAll')}</button>
        <button class="btn" id="bImport">${t('set.importBackup')}</button>
      </div>
    </div>

    <div class="card" id="installCard" ${isStandalone() ? 'hidden' : ''}>
      <h2>${t('set.installTitle')}</h2>
      ${isIOS()
        ? `<p class="small">${t('set.installIos')}</p>`
        : `<p class="small">${t('set.installAndroid')}</p><button class="btn primary" id="installBtn" hidden>${t('set.install')}</button>`}
    </div>

    <p class="about muted small">${t('set.about', { v: APP_VERSION })}<br><a href="privacy.html" target="_blank" rel="noopener">${t('set.privacy')}</a></p>
  </section>`;

  const $ = (id) => root.querySelector('#' + id);
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
