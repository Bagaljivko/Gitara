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
async function askDuplicate(existing, more, single = false) {
  // jedna pesma: „Ova pesma već postoji“ — Otkaži / Sačuvaj kao novu / Zameni; više pesama: Preskoči (+ „Primeni na sve“)
  const p = dialog({
    title: t('dup.title', { title: existing.title }), html: true,
    body: `<p class="small muted">${esc(t('share.dupBody'))}</p>${more ? `<label class="check-row"><input type="checkbox" id="dupAll"> ${esc(t('share.applyAll'))}</label>` : ''}`,
    buttons: [single ? { label: t('common.cancel'), value: null } : { label: t('share.skip'), value: 'skip' }, { label: t('dup.saveNew'), value: 'new' }, { label: t('dup.replace'), value: 'replace', kind: 'primary' }],
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

// ---------------- Kratak link #d/<fileId> (fajl na Drive-u pošiljaoca) ----------------
// Primalac ne treba nalog: javni fajl se preuzima sa javnim API ključem. Sadržaj je nepoznat ulaz: veličina, oblik,
// verzija i hash se proveravaju (parseShareFile), a tekst se prikazuje samo kao tekst. Posle uvoza ili otkazivanja
// deo adrese posle # se briše (osvežavanje ne uvozi ponovo).
const IN_APP = /(FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Viber|Line\/|Telegram|Snapchat|TikTok|musical_ly|Twitter|LinkedInApp|GSA\/|; wv\))/i;
const standalone = () => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; } };
/** Da li je link otvoren u pregledaču unutar druge aplikacije (WhatsApp, Viber…) ili van instalirane Gitare. */
export async function wrongContext(ua = navigator.userAgent) {
  if (IN_APP.test(ua)) return 'inapp';
  if (!standalone() && navigator.getInstalledRelatedApps) {
    try { if ((await navigator.getInstalledRelatedApps()).length) return 'browser'; } catch {}
  }
  return '';
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (label, cls, on) => { const b = el('button', 'btn ' + cls, label); b.addEventListener('click', on); return b; };
const clearHash = (to = '#/pesme') => location.replace(location.pathname + to);

export async function renderDriveShare(root, fileId) {
  const { SHARE_API_KEY, SHARE_BASE } = await import('./shareConfig.js');
  const { parseShareFile, SHARE_MAX_BYTES } = await import('./shareCode.js');
  const view = el('section', 'view shared-view');
  const card = el('div', 'card add-card');
  view.appendChild(card);
  root.replaceChildren(view);
  const show = (title, text, buttons = []) => {
    card.replaceChildren(el('h2', '', title));
    if (text) card.appendChild(el('p', 'muted', text));
    if (buttons.length) { const r = el('div', 'row wrap'); buttons.forEach((b) => r.appendChild(b)); card.appendChild(r); }
  };
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(fileId)) { show(t('share.r.gone'), t('share.r.goneBody'), [btn(t('song.back'), 'primary', () => clearHash())]); history.replaceState(null, '', location.pathname + '#/pesme'); return; }
  // pogrešno mesto (WhatsApp/Viber… ili drugi pregledač): ne uvozi tiho u to skladište
  const ctx = await wrongContext();
  if (ctx && !sessionStorage.getItem('gitara-here-' + fileId)) {
    const { shareLinkOf, copyShareLinkText } = await import('./shareService.js');
    const link = shareLinkOf(fileId);
    const sync = (() => { try { return !!(JSON.parse(localStorage.getItem('gitara-sync') || 'null') || {}).on; } catch { return false; } })();
    show(t('share.r.openTitle'), t(ctx === 'inapp' ? 'share.r.openInApp' : 'share.r.openBrowser'), [
      btn(t('share.r.importHere'), '', () => { sessionStorage.setItem('gitara-here-' + fileId, '1'); renderDriveShare(root, fileId); }),
      btn(t('share.r.openApp'), 'primary', async () => {
        if (/Android/i.test(navigator.userAgent)) {
          const u = new URL(SHARE_BASE);
          location.href = `intent://${u.host}${u.pathname}?d=${encodeURIComponent(fileId)}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(link)};end`;
        } else copyShareLinkText(link);
      }),
    ]);
    if (sync) card.appendChild(el('p', 'small muted', t('share.r.syncNote')));
    return;
  }
  show(t('share.r.loading'), '');
  if (!SHARE_API_KEY) { show(t('share.r.devTitle'), t('share.r.devBody')); console.error('Gitara: SHARE_API_KEY nije podešen u src/shareConfig.js'); return; }
  let text;
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&key=${encodeURIComponent(SHARE_API_KEY)}`);
    if (res.status === 404 || res.status === 403 || res.status === 410 || res.status === 401) throw Object.assign(new Error('gone'), { code: 'GONE' });
    if (res.status === 400) throw Object.assign(new Error('key'), { code: (await res.text()).includes('API key') ? 'KEY' : 'GONE' });
    if (!res.ok) throw Object.assign(new Error('net'), { code: 'OFFLINE' });
    if (Number(res.headers.get('content-length') || 0) > SHARE_MAX_BYTES) throw Object.assign(new Error('big'), { code: 'CORRUPT' });
    text = await res.text();
  } catch (e) {
    const code = (e && e.code) || 'OFFLINE';
    if (code === 'OFFLINE') { show(t('share.r.offline'), '', [btn(t('common.retry'), 'primary', () => renderDriveShare(root, fileId)), btn(t('common.cancel'), '', () => clearHash())]); return; }
    if (code === 'KEY') { show(t('share.r.devTitle'), t('share.r.devBody')); return; }
    show(t('share.r.gone'), t('share.r.goneBody'), [btn(t('song.back'), 'primary', () => clearHash())]);
    history.replaceState(null, '', location.pathname + '#/pesme');
    return;
  }
  let pkg;
  try { pkg = await parseShareFile(text); }
  catch (e) {
    const newer = e && e.code === 'NEWER';
    show(newer ? t('share.r.newer') : t('share.r.corrupt'), '', [btn(t('song.back'), 'primary', () => clearHash())]);
    history.replaceState(null, '', location.pathname + '#/pesme');
    return;
  }
  // pregled (samo tekst) i pitanje „Uvezi …?“
  const isSet = pkg.kind === 'set';
  const q = isSet ? t('share.r.askSet', { name: pkg.name, n: songsCount(pkg.songs.length) }) : t('share.r.askSong', { title: pkg.songs[0].title });
  const list = el('ol', 'share-list');
  for (const s of pkg.songs.slice(0, 60)) { const li = el('li'); li.appendChild(el('b', '', s.title)); if (s.artist) li.appendChild(el('span', 'small muted', ' — ' + s.artist)); list.appendChild(li); }
  show(q, '', [btn(t('common.cancel'), '', () => clearHash()), btn(t('share.r.import'), 'primary', go)]);
  card.insertBefore(list, card.lastChild);
  let busy = false;
  async function go() {
    if (busy) return;
    busy = true;
    try {
      const single = pkg.songs.length === 1;
      let left = 0;
      const r = await importPackage(pkg, (existing) => askDuplicate(existing, !single && ++left < pkg.songs.length, single));
      if (!r) return; // otkazano kod duplikata — ništa nije promenjeno
      toast(t('share.imported', { a: r.added, r: r.replaced, s: r.skipped }));
      clearHash(r.setId ? '#/setlista/' + encodeURIComponent(r.setId) : '#/pesma/' + encodeURIComponent(r.ids[0]));
    } finally { busy = false; }
  }
}
