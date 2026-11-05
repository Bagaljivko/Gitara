// Pesme → „Proveri tablaturu“ (posle skeniranja TAB lista) i izmena TAB pesme: naslov, kompozitor, tonalitet, takt,
// tempo; taktovi koji ne odgovaraju zapisu su označeni (ništa se ne nagađa) — dodir na broj ga ispravlja, dodir na
// takt ga pušta polako. Posle skeniranja: izbor vrste (Akordi / TAB) i ista provera duplikata kao za druge pesme.
// Učitava se tek kad zatreba.
import { t } from './i18n.js';
import { useTabTexts } from './tabText.js';
import { esc, toast, dialog, confirmDialog } from './ui.js';
import { songs as db, versions } from './db.js';
import { checkBars, barInfo, cleanTabSong } from './tabSong.js';
import { drawStaff, playBars } from './tabView.js';
import { findExisting } from './songIdentity.js';

useTabTexts();
const SIGS = ['2/4', '3/4', '4/4', '5/4', '6/4', '2/2', '3/8', '6/8', '9/8', '12/8', '7/8'];
// „Zameni“: od postojeće pesme ostaje ovo (sadržaj je novo skeniranje)
const KEEP_ON_REPLACE = ['id', 'createdAt', 'folders', 'bpm', 'yt', 'zoom', 'seen'];

/**
 * opts: { isNew, scanned, images (pregled slika), onType(kind) → Promise (promena vrste posle skeniranja), done(rec),
 *         base (postojeća pesma kod „Skeniraj ponovo“), onRescan() (dugme „Skeniraj ponovo“ za postojeću pesmu) }
 * song: TAB pesma (nova iz skeniranja ili postojeća).
 */
export function renderTabEditor(root, song0, { isNew = false, scanned = false, images = null, onType = null, onCancel, done, base = null, onRescan = null }) {
  const song = JSON.parse(JSON.stringify(song0));
  if (base) {
    // ponovo skenirano u postojeću pesmu: naslov, kompozitor i tempo ostaju njeni (kompozitor sa lista samo ako ga nije bilo)
    song.title = base.title || song.title;
    song.artist = base.artist || song.artist || '';
    if (Number(base.bpm) > 0) song.bpm = base.bpm;
  }
  const tab = song.tab;
  root.innerHTML = `
  <section class="view editor-view tab-view">
    <header class="topbar">
      <button class="back" id="eCancel">${t('edit.cancel')}</button>
      <div class="topbar-actions">${onRescan ? `<button class="btn small" id="eRescan">${t('rescan.btn')}</button>` : ''}<button class="btn primary" id="eSave">${t('common.save')}</button></div>
    </header>
    <h1>${t('tab.editTitle')}</h1>
    ${base ? `<p class="rescan-note small">${esc(t('rescan.tabNote', { title: base.title }))}</p>` : ''}
    ${scanned && onType ? `<div class="tab-type"><span class="small muted">${t('tab.typeQ')}</span>
      <div class="seg-tabs" role="radiogroup"><button role="radio" data-kind="chords">${t('tab.typeChords')}</button><button role="radio" class="active" aria-checked="true" data-kind="tab">${t('tab.typeTab')}</button></div>
      <span class="small muted">${t('tab.typeHint')}</span></div>` : ''}
    ${scanned && song.scanModel ? `<p class="scan-model small muted">${esc(t('edit.scanModel', { model: song.scanModel }))}</p>` : ''}
    ${images ? `<details class="card photo-ref"><summary>${t('edit.showPhoto')}</summary>${images.map((src, i) => `<img src="${src}" alt="${esc(t('scan.page', { n: i + 1 }))}">`).join('')}</details>` : ''}
    <div class="form tab-fields">
      <label>${t('tab.title')}<input id="eTitle" value="${esc(song.title)}" autocomplete="off"></label>
      <label>${t('tab.composer')}<input id="eArtist" value="${esc(song.artist || '')}" autocomplete="off"></label>
      <label>${t('tab.key')}<input id="eKey" value="${esc(tab.key || '')}" placeholder="Em" autocomplete="off"></label>
      <label>${t('tab.sigLabel')}<select id="eSig">${SIGS.map((s) => `<option ${s === tab.sig ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label>${t('song.tempo')} (BPM)<input id="eBpm" type="number" inputmode="numeric" min="30" max="220" value="${Number(song.bpm) || ''}" placeholder="66"></label>
    </div>
    <div id="eFlags"></div>
    <p class="small muted">${t('tab.editHint')}</p>
    <div class="tab-staff2" id="eStaff"></div>
  </section>`;
  const $ = (q) => root.querySelector('#' + q);
  let lastW = 0;
  function drawFlags() {
    const fl = checkBars(tab), info = barInfo(tab);
    $('eFlags').innerHTML = fl.length ? `<div class="card sug-card tab-sug"><div class="sug-title">${t('tab.checkTitle', { n: fl.length })}</div><p class="small muted">${t('tab.checkHint')}</p>
      ${fl.slice(0, 12).map((f) => `<div class="sug-item"><span class="sug-what"><b>${t('tab.bar', { n: f.bar + 1 })}</b> ${esc(t('tab.why.' + f.why, { sig: info[f.bar].sig }))}${f.note ? ` <span class="small muted">— ${esc(f.note)}</span>` : ''}</span>
      <span class="sug-actions"><button class="btn small" data-show="${f.bar}">${t('tab.show')}</button><button class="btn small" data-okbar="${f.bar}">${t('tab.okBar')}</button></span></div>`).join('')}</div>` : '';
  }
  function drawTab() {
    drawStaff($('eStaff'), tab, { flags: new Set(checkBars(tab).map((f) => f.bar)), edit: true });
    lastW = $('eStaff').clientWidth;
  }
  drawFlags();
  requestAnimationFrame(drawTab);
  const ro = new ResizeObserver(() => { if ($('eStaff') && Math.abs($('eStaff').clientWidth - lastW) > 4) drawTab(); });
  ro.observe($('eStaff'));
  $('eSig').addEventListener('change', () => { tab.sig = $('eSig').value; drawFlags(); drawTab(); });

  let stop = null;
  root.querySelector('section').addEventListener('click', async (e) => {
    const kind = e.target.closest('[data-kind]');
    if (kind && kind.dataset.kind === 'chords' && onType) { stop?.(); ro.disconnect(); return onType('chords'); }
    const sh = e.target.closest('[data-show]'), ok = e.target.closest('[data-okbar]');
    if (sh) { const b = $('eStaff').querySelector(`[data-bar="${sh.dataset.show}"]`); b?.scrollIntoView({ block: 'center', behavior: 'smooth' }); b?.classList.add('pulse'); return; }
    if (ok) { tab.bars[+ok.dataset.okbar].ok = 1; drawFlags(); drawTab(); return; }
    const nt = e.target.closest('[data-note]');
    if (nt) { const [bi, ni] = nt.dataset.note.split('-').map(Number); return editNote(bi, ni); }
    const bar = e.target.closest('[data-bar]');
    if (bar) { stop?.(); stop = await playBars(tab, [+bar.dataset.bar], { bpm: 40 }); }
  });
  async function editNote(bi, ni) {
    const n = tab.bars[bi].notes[ni];
    const p = dialog({
      title: t('tab.noteTitle', { n: bi + 1, s: n.s }), html: true,
      body: `<label class="small">${t('tab.fret')} <input id="tnFret" type="number" inputmode="numeric" min="0" max="24" value="${n.f}"></label>`,
      buttons: [{ label: t('tab.removeNote'), value: 'del', kind: 'danger' }, { label: t('common.cancel'), value: null }, { label: t('common.save'), value: 'save', kind: 'primary' }],
    });
    const modal = [...document.querySelectorAll('.modal-backdrop')].pop();
    let v = String(n.f);
    modal.querySelector('#tnFret').addEventListener('input', (ev) => (v = ev.target.value));
    const r = await p;
    if (r === 'del') tab.bars[bi].notes.splice(ni, 1);
    else if (r === 'save') {
      const f = Math.round(Number(v));
      if (!(f >= 0 && f <= 24) || v.trim() === '') { toast(t('tab.badFret'), 'error'); return; }
      n.f = f;
      if (tab.bars[bi].why === 'fret' || tab.bars[bi].why === 'scan') delete tab.bars[bi].why; // ispravljeno
    } else return;
    drawFlags(); drawTab();
  }

  $('eCancel').addEventListener('click', async () => {
    if (isNew && !(await confirmDialog(t('edit.discardTitle'), t('edit.discardScanned'), t('edit.discard'), 'danger'))) return;
    stop?.(); ro.disconnect();
    onCancel?.();
  });
  $('eRescan')?.addEventListener('click', () => onRescan());
  let saving = false;
  $('eSave').addEventListener('click', async () => {
    if (saving) return;
    saving = true; $('eSave').disabled = true;
    try { await saveTab(); } finally { saving = false; if ($('eSave')) $('eSave').disabled = false; }
  });
  async function saveTab() {
    const clean = cleanTabSong({ ...tab, key: $('eKey').value.trim() || tab.key });
    if (!clean) { toast(t('tab.emptyTab'), 'error'); return; }
    const bpm = Math.round(Number($('eBpm').value) || 0);
    let rec = {
      ...(isNew ? {} : song0),
      type: 'tab', title: $('eTitle').value.trim() || t('common.untitled'), artist: $('eArtist').value.trim(),
      key: clean.key, sections: [], tab: clean, transpose: 0,
    };
    if (bpm >= 30 && bpm <= 220) rec.bpm = bpm; else delete rec.bpm;
    delete rec.scanModel; delete rec.sheetKind;
    let msg = t('edit.saved');
    if (base) {
      // isti ID (napredak u Vežbama, set liste, folderi, podešavanja pesme) — menja se samo tablatura
      rec = { ...base, title: rec.title, artist: rec.artist, key: clean.key, tab: clean, type: 'tab', sections: [], transpose: 0, ...(rec.bpm ? { bpm: rec.bpm } : {}) };
      if (!(bpm >= 30 && bpm <= 220)) delete rec.bpm;
      delete rec.__rescanOf; delete rec.__newId;
      await versions.save('song:' + base.id, base, 'rescan'); // stara tablatura ostaje kao „Prethodna verzija“
      msg = t('rescan.tabSaved');
    } else if (isNew) {
      rec.id = song0.__newId || undefined;
      delete rec.__newId;
      const others = (await db.all()).filter((x) => x.id !== rec.id);
      const existing = findExisting(rec, others);
      if (existing) {
        const choice = await dialog({
          title: t('dup.title', { title: existing.title }), body: t('dup.body'),
          buttons: [{ label: t('common.cancel'), value: null }, { label: t('dup.saveNew'), value: 'new' }, { label: t('dup.replace'), value: 'replace', kind: 'primary' }],
        });
        if (!choice) return;
        if (choice === 'replace') {
          const kept = {};
          for (const k of KEEP_ON_REPLACE) if (existing[k] !== undefined) kept[k] = existing[k];
          rec = { ...existing, ...rec, ...kept };
          // pesma sa akordima zamenjena tablaturom: stari tekst i akordi više ne važe
          for (const k of ['capo', 'keyN', 'keyAlt', 'keyAsk', 'naming', 'namingAsk', 'cv', 'original', 'uncertain', 'strum', 'easyCapo', 'shapes']) delete rec[k];
          msg = t('dup.replaced', { title: existing.title });
        }
      }
    }
    stop?.(); ro.disconnect();
    const saved = await db.save(rec);
    toast(msg);
    done?.(saved);
  }
}
