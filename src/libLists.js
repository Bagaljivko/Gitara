// v2.4.38: Pesme · Liste · Kursevi — „Liste“ spaja foldere i setliste u jedno mesto:
//   • Pametne liste (prave se same: Najviše sviram, Spremne, Nedavno, Od nastavnika, Moji snimci, TAB)
//   • Moje liste (setliste — po redu, ▶ Sviraj — i folderi — bez redosleda), „+ Nova lista“
// Na „Pesme“ ostaju „Sve“ i najviše 3 čipa koje korisnik izabere. Dugi pritisak (ili desni klik) na čip ili red liste
// otvara meni: Preimenuj, Prikaži/Sakrij kao čip, Napravi setlistu od ovih pesama, Obriši (samo lista ili lista i pesme).
import { t } from './i18n.js';
import { esc, dialog, toast } from './ui.js';
import { songs as db } from './db.js';
import * as C from './collections.js';

const PIN_KEY = 'marli-chips', MAX_PINS = 3;
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
/** Čipovi na „Pesme“: izabrane grupe (najviše 3). null = još nije biran (podrazumevano: Najviše sviram + nastavnik). */
export function getPins() { try { const v = JSON.parse(ls.get(PIN_KEY) || 'null'); return Array.isArray(v) ? v.slice(0, MAX_PINS) : null; } catch { return null; } }
export function setPins(list) { ls.set(PIN_KEY, JSON.stringify([...new Set(list)].slice(0, MAX_PINS))); }
export function togglePin(g, defaults = []) {
  const cur = getPins() || defaults;
  if (cur.includes(g)) { setPins(cur.filter((x) => x !== g)); return false; }
  if (cur.length >= MAX_PINS) { toast(t('lst.pinMax', { n: MAX_PINS })); return null; }
  setPins([...cur, g]); return true;
}

/** Dugi pritisak (≥ 500 ms) ili desni klik na element sa [data-chip] / [data-lst] → cb(el). Kratki dodir ostaje običan klik. */
export function onLongPress(root, sel, cb) {
  let tm = 0, fired = false, x0 = 0, y0 = 0;
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(sel); if (!el) return;
    fired = false; x0 = e.clientX; y0 = e.clientY;
    clearTimeout(tm); tm = setTimeout(() => { fired = true; cb(el); }, 500);
  });
  const cancel = () => clearTimeout(tm);
  root.addEventListener('pointerup', cancel); root.addEventListener('pointercancel', cancel); root.addEventListener('pointerleave', cancel);
  root.addEventListener('pointermove', (e) => { if (Math.abs(e.clientX - x0) > 8 || Math.abs(e.clientY - y0) > 8) cancel(); });
  root.addEventListener('click', (e) => { if (fired && e.target.closest(sel)) { e.stopPropagation(); e.preventDefault(); fired = false; } }, true);
  root.addEventListener('contextmenu', (e) => { const el = e.target.closest(sel); if (!el) return; e.preventDefault(); cancel(); cb(el); });
}

const row = (k, ic, b, s = '', danger = false) => `<button type="button" class="tch-row" data-m="${k}"><span class="sr-ic"${danger ? ' style="color:var(--danger, #e5484d)"' : ''}>${ic}</span><span><b${danger ? ' style="color:var(--danger, #e5484d)"' : ''}>${esc(b)}</b>${s ? `<small>${esc(s)}</small>` : ''}</span></button>`;
/** Meni liste. it: { kind: 'auto'|'folder'|'set', id, label, pinned, sys } → akcija ili null. */
export async function listMenu(it) {
  let pick = null;
  const rows = [];
  if (it.kind !== 'auto' && !it.sys) rows.push(row('ren', '✎', t('lst.rename')));
  if (it.kind !== 'set') rows.push(row('pin', it.pinned ? '◌' : '◉', it.pinned ? t('lst.unpin') : t('lst.pin'), it.pinned ? t('lst.unpinSub') : t('lst.pinSub')));
  if (it.kind !== 'set') rows.push(row('toSet', '≡', t('lst.toSet')));
  if ((it.kind === 'folder' && !it.sys) || it.kind === 'set') rows.push(row('del', '🗑', it.kind === 'set' ? t('lst.delSet') : t('lst.delList'), t('lst.delSub'), true));
  const p = dialog({ title: it.label, html: true, className: 'yt-ask', body: `<div class="set-grp">${rows.join('')}</div>${it.kind === 'auto' ? `<p class="muted small" style="margin:10px 2px 0">${esc(t('lst.autoNote'))}</p>` : ''}`, buttons: [] });
  const box = [...document.querySelectorAll('.modal-backdrop')].pop();
  box.addEventListener('click', (e) => { const r = e.target.closest('[data-m]'); if (r) { pick = r.dataset.m; box.__close && box.__close(); } });
  await p;
  return pick;
}

/**
 * Brisanje liste (folder ili setlista): „Samo lista“ (pesme ostaju) ili „Lista i pesme (N)“ — pesme koje su i u drugoj
 * listi/kursu su označene i mogu da ostanu. Posle brisanja „Poništi“ vraća sve. true ako je obrisano.
 */
export async function deleteList(it, songIds) {
  const sums = await db.list(); const byId = new Map(sums.map((s) => [s.id, s]));
  const ids = songIds.filter((id) => byId.has(id));
  const v = await dialog({ title: t('lst.delT', { name: it.label }), html: true, className: 'yt-ask', body: `<p class="muted small" style="margin:0 0 8px">${esc(t('lst.delAsk'))}</p>`,
    buttons: [{ label: t('common.cancel'), value: null }, ...(ids.length ? [{ label: t('lst.delWithSongs', { n: ids.length }), value: 'all', kind: 'danger' }] : []), { label: t('lst.delOnly'), value: 'only', kind: 'primary' }] });
  if (!v) return false;
  let rm = [];
  if (v === 'all') {
    // pesme koje su i drugde (drugi folder, setlista, kurs) — ponudi da ostanu
    const sets = await C.getSetlists(); const crs = await (await import('./courses.js')).getCourses().catch(() => []);
    const elsewhere = (id) => { const s = byId.get(id); const f = (s.folders || []).filter((x) => !(it.kind === 'folder' && x === it.id)); return f.length > 0 || sets.some((x) => !(it.kind === 'set' && x.id === it.id) && (x.songIds || []).includes(id)) || crs.some((c) => (c.items || []).some((q) => q.s === id)); };
    const keep = new Set(ids.filter(elsewhere));
    const p = dialog({ title: t('lst.delSongsT', { n: ids.length }), html: true, className: 'yt-ask', body: `<p class="muted small" style="margin:0 0 8px">${esc(t('lst.delSongsSub'))}</p><div class="pick-list">${ids.map((id) => `<label class="pick-row"><input type="checkbox" value="${esc(id)}" ${keep.has(id) ? '' : 'checked'}> <span>${esc(byId.get(id).title)}${keep.has(id) ? ` <small>${esc(t('lst.elsewhere'))}</small>` : ''}</span></label>`).join('')}</div>`,
      buttons: [{ label: t('common.cancel'), value: null }, { label: t('common.delete'), value: 'ok', kind: 'danger' }] });
    const box = [...document.querySelectorAll('.modal-backdrop')].pop();
    const sel = new Set(ids.filter((id) => !keep.has(id)));
    box.addEventListener('change', (e) => { if (e.target.type === 'checkbox') e.target.checked ? sel.add(e.target.value) : sel.delete(e.target.value); });
    if ((await p) !== 'ok') return false;
    rm = [...sel];
  }
  // pamćenje za „Poništi“
  const before = { folders: await C.getFolders(), sets: await C.getSetlists(), songs: [] };
  for (const id of rm) { const s = await db.get(id).catch(() => null); if (s) before.songs.push(s); }
  if (it.kind === 'folder') await C.deleteFolder(it.id); else await C.deleteSetlist(it.id);
  for (const id of rm) await db.remove(id);
  const K = await import('./courses.js'); const crsBefore = await K.dropSongs(rm); // v2.5.64: i iz kurseva
  toast(rm.length ? t('lst.deletedN', { n: rm.length }) : t('lst.deleted'), '', { label: t('common.undo'), onClick: async () => {
    const { settings } = await import('./db.js');
    await K.restoreCourses(crsBefore);
    if (it.kind === 'folder') await settings.set('folders', before.folders); else await settings.set('setlists', before.sets);
    for (const s of before.songs) await db.put(s, { force: true });
    toast(t('lst.restored'));
    dispatchEvent(new HashChangeEvent('hashchange'));
  } });
  return true;
}

/** Folder → nova setlista sa istim pesmama (po naslovu). */
export async function folderToSet(label, ids) {
  const sl = await C.addSetlist(label);
  if (!sl) return null;
  await C.updateSetlist(sl.id, { songIds: ids });
  return sl;
}

/**
 * Kartica „Liste“. ctx: { autos: [{ g, label, ic, n }], folders: [{ id, label, n, sys }], pins: [g], open(g), action(it, m) }
 */
export async function renderListsPane(el, ctx) {
  const sets = await C.getSetlists();
  const R = (attrs, ic, b, s, right = '<span class="chev" aria-hidden="true">›</span>') => `<a class="tch-row" ${attrs}><span class="sr-ic">${ic}</span><span><b>${esc(b)}</b><small>${esc(s)}</small></span>${right}</a>`;
  const MORE = (k) => `<button type="button" class="icon-btn lst-more" data-more="${esc(k)}" aria-label="${esc(t('lst.more'))}">⋯</button>`;
  const pinTag = (g) => (ctx.pins.includes(g) ? ' · ' + t('lst.isChip') : '');
  el.innerHTML = `
    <div class="tch-sec"><span>${esc(t('lst.smart'))}</span></div>
    <div class="set-grp">${ctx.autos.map((a) => R(`href="#" data-lst="a:${esc(a.g)}"`, a.ic, a.label, t('lst.songsN', { n: a.n }) + pinTag(a.g))).join('')}</div>
    ${(ctx.courses || []).length ? `<div class="tch-sec"><span>${esc(t('lst.fromCourses'))}</span></div><div class="set-grp">${ctx.courses.map((a) => R(`href="#" data-lst="a:${esc(a.g)}"`, a.ic, a.label, t('lst.songsN', { n: a.n }) + pinTag(a.g))).join('')}</div>` : ''}
    <div class="tch-sec"><span>${esc(t('lst.mine'))}</span></div>
    <div class="set-grp">${[
      ...sets.map((x) => R(`href="#/setlista/${encodeURIComponent(x.id)}" data-lst="s:${esc(x.id)}"`, '≡', x.name, [t('lst.setSub', { n: (x.songIds || []).length }), x.fromT ? t('tch.fromTeacherShort') : ''].filter(Boolean).join(' · '), MORE('s:' + x.id))),
      ...ctx.folders.map((f) => R(`href="#" data-lst="f:${esc(f.id)}"`, f.sys ? '🎙' : '📁', f.label, t('lst.listSub', { n: f.n }) + pinTag(f.id), MORE('f:' + f.id))),
    ].join('') || `<div class="tch-row"><span class="sr-ic">≡</span><span><b>${esc(t('lst.emptyT'))}</b><small>${esc(t('lst.empty'))}</small></span></div>`}</div>
    <button class="btn wide" id="lstNew" style="margin-top:12px">+ ${esc(t('lst.new'))}</button>
    <p class="muted small" style="margin:10px 4px">${esc(t('lst.note'))}</p>`;
  const itemOf = (k) => {
    const [kind, id] = [k.slice(0, 1), k.slice(2)];
    if (kind === 'a') { const a = [...ctx.autos, ...(ctx.courses || [])].find((x) => x.g === id); return { kind: 'auto', id, label: a ? a.label : id, pinned: ctx.pins.includes(id) }; }
    if (kind === 'f') { const f = ctx.folders.find((x) => x.id === id); return { kind: 'folder', id, label: f ? f.label : id, sys: f && f.sys, pinned: ctx.pins.includes(id) }; }
    const s = sets.find((x) => x.id === id); return { kind: 'set', id, label: s ? s.name : id };
  };
  el.__lst = { ctx, itemOf }; // ponovno crtanje samo menja podatke; slušaoci se vezuju jednom
  if (el.__lstBound) return; el.__lstBound = true;
  el.addEventListener('click', async (e) => {
    const { ctx, itemOf } = el.__lst;
    const m = e.target.closest('[data-more]');
    if (m) { e.preventDefault(); e.stopPropagation(); const it = itemOf(m.dataset.more); const a = await listMenu(it); if (a) await ctx.action(it, a); return; }
    const r = e.target.closest('[data-lst]');
    if (r && !r.dataset.lst.startsWith('s:')) { e.preventDefault(); ctx.open(r.dataset.lst.slice(2)); return; }
    if (e.target.closest('#lstNew')) {
      const { askName } = await import('./setlistsView.js');
      const name = await askName(t('lst.new')); if (!name) return;
      const sl = await C.addSetlist(name); if (sl) location.hash = '#/setlista/' + encodeURIComponent(sl.id);
    }
  });
  onLongPress(el, '[data-lst]', async (r) => { const { ctx, itemOf } = el.__lst; const it = itemOf(r.dataset.lst); const a = await listMenu(it); if (a) await ctx.action(it, a); });
}
