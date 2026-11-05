// „Prethodna verzija“: izmena koja je izgubila sukob na drugom uređaju, sadržaj pre ponovnog skeniranja…
// Ništa se ne gubi — može se pogledati i vratiti (trenutna verzija tada postaje prethodna).
import { t } from './i18n.js';
import { esc, toast, dialog } from './ui.js';
import { songs as db, settings, versions } from './db.js';

const fmt = (ts) => { const d = new Date(ts), p = (x) => String(x).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}. ${p(d.getHours())}:${p(d.getMinutes())}`; };
const reasonText = (r) => t(r === 'rescan' ? 'ver.rescan' : r === 'restore' ? 'ver.restore' : 'ver.conflict');
const nameOf = (v) => (v.data && (v.data.title || v.data.name)) || '—';

/** Vrati verziju: trenutna se čuva kao prethodna, pa se upisuje stara (isti ID — napredak, set liste i folderi ostaju). */
export async function restoreVersion(v) {
  if (v.key.startsWith('song:')) {
    const id = v.key.slice(5);
    const cur = await db.get(id);
    if (cur) await versions.save(v.key, cur, 'restore');
    const keep = cur ? { folders: cur.folders, seen: cur.seen, zoom: cur.zoom } : {};
    for (const k of Object.keys(keep)) if (keep[k] === undefined) delete keep[k];
    await db.put({ ...v.data, ...keep, id, updatedAt: Date.now() }, { force: true });
  } else if (v.key.startsWith('set:')) {
    const id = v.key.slice(4);
    const list = (await settings.get('setlists', [])) || [];
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) await versions.save(v.key, list[i], 'restore');
    const rec = { ...v.data, id, updatedAt: Date.now() };
    if (i >= 0) list[i] = rec; else list.push(rec);
    await settings.set('setlists', list);
  } else return false;
  await versions.remove(v.n);
  return true;
}

/** Spisak svih prethodnih verzija (Podešavanja). */
export async function openVersions(key = null) {
  const list = await versions.list(key);
  const body = list.length
    ? `<ul class="ver-list">${list.slice(0, 60).map((v) => `<li data-n="${v.n}"><div><b>${esc(nameOf(v))}</b><br><span class="small muted">${esc(reasonText(v.reason))} · ${esc(fmt(v.at))}</span></div><button class="btn small" data-ver="${v.n}">${esc(t('ver.restoreBtn'))}</button></li>`).join('')}</ul>`
    : `<p class="muted">${esc(t('ver.none'))}</p>`;
  const p = dialog({ title: t('ver.title'), html: true, body: `<p class="small muted">${esc(t('ver.intro'))}</p>${body}`, buttons: [{ label: t('common.close'), value: null }] });
  const modal = [...document.querySelectorAll('.modal-backdrop')].pop();
  modal?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ver]');
    if (!b) return;
    const v = list.find((x) => String(x.n) === b.dataset.ver);
    if (!v) return;
    b.disabled = true;
    if (await restoreVersion(v)) {
      toast(t('ver.restored'));
      b.closest('li')?.remove();
      if (v.key.startsWith('song:') && location.hash.startsWith('#/pesma/')) { modal.__close?.(null); dispatchEvent(new HashChangeEvent('hashchange')); }
    }
  });
  return p;
}

/** Mala napomena (posle elementa `after`) kad postoji prethodna verzija. */
export async function versionNote(after, key) {
  const list = await versions.list(key);
  if (!list.length || !after.isConnected || after.parentNode.querySelector(':scope > .ver-note')) return;
  const v = list[0];
  const box = document.createElement('div');
  box.className = 'ver-note';
  box.innerHTML = `<span>${esc(t('ver.note', { when: fmt(v.at), why: reasonText(v.reason) }))}</span><button class="btn small" data-a="see">${esc(t('ver.see'))}</button>`;
  box.querySelector('[data-a="see"]').addEventListener('click', () => openVersions(key));
  after.after(box);
}
