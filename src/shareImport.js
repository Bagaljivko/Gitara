// Uvoz poslatog paketa (link #g=… ili .gitara fajl): „Uvezi set listu: ime, N pesama“ → jedan dodir.
// Pesma koja već postoji: Zameni / Sačuvaj kao novu / Preskoči (uz „Primeni na sve“) — ništa se ne prepisuje bez pitanja.
// Nove pesme dobijaju nov ID; set lista pokazuje na pesme u biblioteci (preskočena = postojeća pesma).
import { t, songsCount } from './i18n.js';
import { esc, toast, dialog } from './ui.js';
import { songs as db } from './db.js';
import { findExisting } from './songIdentity.js';
import { getSetlists, addSetlist, updateSetlist } from './collections.js';
import { packageFrom } from './shareCode.js';

const KEEP_ON_REPLACE = ['id', 'createdAt', 'folders', 'seen', 'zoom', 'easyCapo', 'skipped'];

/** Uvoz paketa; ask(existing, song) → 'replace' | 'new' | 'skip' (+ all). Vraća { setId, ids, added, replaced, skipped }. */
export async function importPackage(pkg, ask) {
  const all = await db.all(); // samo pesme koje su postojale pre uvoza (pesme iz istog paketa se ne porede međusobno)
  const ids = [];
  let added = 0, replaced = 0, skipped = 0, always = null;
  for (const s0 of pkg.songs) {
    const song = { ...s0 };
    delete song.id;
    const existing = findExisting(song, all);
    let choice = 'new';
    if (existing) {
      if (always) choice = always;
      else { const r = await ask(existing, song); if (!r) return null; choice = r.choice; if (r.all) always = r.choice; }
    }
    if (choice === 'skip') { ids.push(existing.id); skipped++; continue; }
    if (choice === 'replace') {
      const kept = {};
      for (const k of KEEP_ON_REPLACE) if (existing[k] !== undefined) kept[k] = existing[k];
      const rec = await db.save({ ...song, ...kept });
      Object.assign(existing, rec);
      ids.push(rec.id); replaced++;
      continue;
    }
    const rec = await db.save(song); // nov, stabilan ID
    ids.push(rec.id); added++;
  }
  let setId = null;
  if (pkg.kind === 'set') {
    // isto ime već postoji → „ime (2)“; set lista se nikad ne spaja sa postojećom
    const names = new Set((await getSetlists()).map((x) => x.name.toLowerCase()));
    let name = pkg.name || t('share.setDefault'), k = 2;
    const base = name;
    while (names.has(name.toLowerCase())) name = `${base} (${k++})`;
    const sl = await addSetlist(name);
    await updateSetlist(sl.id, { songIds: [...new Set(ids)] });
    setId = sl.id;
  }
  return { setId, ids, added, replaced, skipped };
}

/** Pitanje za postojeću pesmu (sa „Primeni na sve“ kad ima još pesama). */
async function askDuplicate(existing, more) {
  const p = dialog({
    title: t('dup.title', { title: existing.title }), html: true,
    body: `<p class="small muted">${esc(t('share.dupBody'))}</p>${more ? `<label class="check-row"><input type="checkbox" id="dupAll"> ${esc(t('share.applyAll'))}</label>` : ''}`,
    buttons: [{ label: t('share.skip'), value: 'skip' }, { label: t('dup.saveNew'), value: 'new' }, { label: t('dup.replace'), value: 'replace', kind: 'primary' }],
  });
  const modal = [...document.querySelectorAll('.modal-backdrop')].pop();
  let all = false;
  modal.querySelector('#dupAll')?.addEventListener('change', (e) => (all = e.target.checked));
  const choice = await p;
  return choice ? { choice, all } : null;
}

/** Ekran „Uvezi …“ za link #g=… (ili tekst fajla). */
export async function renderSharedPackage(root, text) {
  let pkg;
  try { pkg = await packageFrom(text); } catch {
    root.innerHTML = `<section class="view"><div class="card"><h2>${t('link.badTitle')}</h2><p class="muted">${t('share.bad')}</p><a class="btn primary" href="#/pesme">${t('song.back')}</a></div></section>`;
    history.replaceState(null, '', location.pathname + location.search + '#/pesme');
    return;
  }
  const isSet = pkg.kind === 'set';
  root.innerHTML = `
  <section class="view shared-view">
    <div class="card add-card">
      <h2>${esc(isSet ? t('share.importSet', { name: pkg.name, n: songsCount(pkg.songs.length) }) : t('link.addTitle'))}</h2>
      <ol class="share-list">${pkg.songs.map((s) => `<li><b>${esc(s.title)}</b>${s.artist ? ` <span class="small muted">— ${esc(s.artist)}</span>` : ''}${s.type === 'tab' ? ' <span class="badge-sm">TAB</span>' : ''}</li>`).join('')}</ol>
      <div class="row"><button class="btn" id="shCancel">${t('common.cancel')}</button><button class="btn primary" id="shAdd">${isSet ? t('share.importBtn') : t('link.add')}</button></div>
      <p class="small muted">${t('share.privacy')}</p>
    </div>
  </section>`;
  const leave = (hash) => location.replace(location.pathname + location.search + hash);
  root.querySelector('#shCancel').addEventListener('click', () => leave('#/pesme'));
  let busy = false;
  root.querySelector('#shAdd').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    try {
      let left = 0;
      const r = await importPackage(pkg, (existing) => askDuplicate(existing, pkg.songs.length > 1 && ++left < pkg.songs.length));
      if (!r) return;
      toast(t('share.imported', { a: r.added, r: r.replaced, s: r.skipped }));
      leave(r.setId ? '#/setlista/' + encodeURIComponent(r.setId) : '#/pesma/' + encodeURIComponent(r.ids[0]));
    } finally { busy = false; }
  });
}
