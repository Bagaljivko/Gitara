// v2.4.37: Pesme → „Kursevi“ (treća kartica): MARLI put (ugrađeni kursevi), Moji kursevi, „+ Napravi kurs“;
// stranica kursa (#/kurs/ID): pesme po redu sa napretkom, prazna mesta („još nije uvezena“), predlog za sledeću pesmu.
// Ništa nije zaključano — svaka pesma se otvara dodirom; aplikacija samo predlaže sledeću.
import { t } from './i18n.js';
import { esc, dialog, toast } from './ui.js';
import { songs as db } from './db.js';
import * as K from './courses.js';

const CHEV = '<span class="chev" aria-hidden="true">›</span>';
/** Stanje pesama kursa: { map: id → 'ready'|'work'|'new', next: index prve nespremne stavke } */
async function stateOf(course) {
  const S = await import('./statsView.js');
  const ids = (course.items || []).filter((x) => x.s).map((x) => x.s);
  const r = await S.setReadiness(ids);
  const next = (course.items || []).findIndex((x) => !x.s || r.map[x.s] !== 'ready');
  return { map: r.map, ready: r.ready, next };
}
const barHTML = (course, st) => `<span class="lp-steps" aria-hidden="true">${(course.items || []).map((x, i) => `<i class="${x.s && st.map[x.s] === 'ready' ? 'd' : i === st.next ? 'c' : ''}"></i>`).join('')}</span>`;

async function courseCard(c, href, titles) {
  const st = await stateOf(c);
  const n = (c.items || []).length, nx = (c.items || [])[st.next];
  const nextT = nx ? (nx.s ? titles.get(nx.s) || '' : t('crs.songN', { n: st.next + 1 })) : '';
  const sub = [c.fromT ? t('crs.fromT', { name: c.fromT.name || '' }) : '', t('crs.progress', { n: st.ready, total: n }), nextT ? t('crs.nextIs', { s: nextT }) : t('crs.allDone')].filter(Boolean).join(' · ');
  return `<a class="sp-line lp-entry card crs-card" href="${href}"><span class="sr-ic" aria-hidden="true">${esc(c.ic || '🎓')}</span><span class="lp-et"><b>${esc(c.name)}</b><small class="lp-es">${esc(sub)}</small>${n ? barHTML(c, st) : ''}</span>${CHEV}</a>`;
}

/** MARLI put — ugrađeni kursevi (fajl uz aplikaciju; učitava se tek na ovoj kartici). [] ako ih još nema. */
export async function marliCourses() {
  try { const r = await fetch('./courses/index.json', { cache: 'no-cache' }); if (!r.ok) return []; const j = await r.json(); return Array.isArray(j.courses) ? j.courses : []; } catch { return []; }
}

export async function renderCoursesPane(el) {
  const [list, marli, sums] = await Promise.all([K.getCourses(), marliCourses(), db.list()]);
  const titles = new Map(sums.map((s) => [s.id, s.title]));
  const mine = list.filter((c) => !c.marli);
  const cards = await Promise.all(mine.map((c) => courseCard(c, '#/kurs/' + encodeURIComponent(c.id), titles)));
  el.innerHTML = `
    ${marli.length ? `<div class="tch-sec"><span>${esc(t('crs.marli'))}</span></div><div class="set-grp">${marli.map((m, i) => {
      const have = list.find((c) => c.marli === m.id);
      return `<a class="tch-row" href="${have ? '#/kurs/' + encodeURIComponent(have.id) : '#/kurs/marli:' + encodeURIComponent(m.id)}"><span class="sr-ic crs-n">${i + 1}</span><span><b>${esc(m.name)}</b><small>${esc(have ? t('crs.added') : m.sub || t('crs.songsN', { n: (m.songs || []).length }))}</small></span>${CHEV}</a>`;
    }).join('')}</div>` : ''}
    <div class="tch-sec"><span>${esc(t('crs.mine'))}</span></div>
    ${cards.length ? cards.join('') : `<div class="set-grp"><div class="tch-row crs-empty"><span class="sr-ic">🎓</span><span><b>${esc(t('crs.emptyT'))}</b><small>${esc(t('crs.empty'))}</small></span></div></div>`}
    <p class="muted small crs-open">${esc(t('crs.openNote'))}</p>
    <button class="btn wide" id="cNew">+ ${esc(t('crs.new'))}</button>`;
  el.querySelector('#cNew').addEventListener('click', async () => {
    const { askName } = await import('./setlistsView.js');
    const name = await askName(t('crs.new'));
    if (!name) return;
    const c = await K.addCourse(name, [], { ic: '🎓' });
    if (c) location.hash = '#/kurs/' + encodeURIComponent(c.id);
  });
}

/** MARLI put: kurs se doda (pesme u biblioteku, kurs u „Moji kursevi“). */
async function addMarli(m) {
  const { normalizeSong } = await import('./songformat.js');
  const items = [];
  const all = await db.list();
  for (const s of m.songs || []) {
    const ex = all.find((x) => x.title === s.title && (x.artist || '') === (s.artist || ''));
    if (ex) { items.push({ s: ex.id }); continue; }
    const rec = await db.save({ ...normalizeSong(s), ...(s.shapes ? { shapes: s.shapes } : {}), ...(s.yt ? { yt: s.yt } : {}), marli: m.id });
    items.push({ s: rec.id });
  }
  return K.addCourse(m.name, items, { ic: m.ic || '🎓', marli: m.id });
}

export async function renderCourse(root, id) {
  if (id.startsWith('marli:')) {
    const m = (await marliCourses()).find((x) => x.id === id.slice(6));
    if (!m) { location.hash = '#/vezbe?t=k'; return; }
    const have = (await K.getCourses()).find((c) => c.marli === m.id);
    if (have) { location.replace('#/kurs/' + encodeURIComponent(have.id)); return; }
    root.innerHTML = `<section class="view crs-view"><header class="topbar"><a href="#/vezbe?t=k" class="back">‹ ${esc(t('crs.back'))}</a></header>
      <h1>${esc(m.name)}</h1><p class="muted">${esc(m.about || '')}</p>
      <div class="tch-sec"><span>${esc(t('crs.order'))}</span></div>
      <div class="set-grp">${(m.songs || []).map((s, i) => `<div class="tch-row crs-ro"><span class="sr-ic crs-n">${i + 1}</span><span><b>${esc(s.title)}</b><small>${esc([s.artist, s.what].filter(Boolean).join(' · '))}</small></span></div>`).join('')}</div>
      <button class="btn primary wide crs-add" id="cAddM">${esc(t('crs.addCourse'))}</button></section>`;
    root.querySelector('#cAddM').addEventListener('click', async (e) => { e.target.disabled = true; const c = await addMarli(m); toast(t('crs.addedT')); if (c) location.replace('#/kurs/' + encodeURIComponent(c.id)); });
    return;
  }
  let c = await K.getCourse(id);
  if (!c) { location.hash = '#/vezbe?t=k'; return; }
  let edit = false;
  const own = !c.fromT;
  root.innerHTML = `<section class="view crs-view">
    <header class="topbar"><a href="#/vezbe?t=k" class="back">‹ ${esc(t('crs.back'))}</a>
      ${own ? `<div class="topbar-actions"><button class="btn small" id="cEdit">${esc(t('crs.edit'))}</button></div>` : ''}</header>
    <div id="cBody"></div></section>`;
  const body = root.querySelector('#cBody');
  const draw = async () => {
    c = await K.getCourse(id); if (!c) { location.hash = '#/vezbe?t=k'; return; }
    const sums = await db.list(); const byId = new Map(sums.map((s) => [s.id, s]));
    const items = (c.items || []).map((x) => (x.s && !byId.has(x.s) ? { n: 0, miss: true } : x));
    const st = await stateOf({ ...c, items });
    const firstMiss = items.findIndex((x) => !x.s);
    const row = (x, i) => {
      if (!x.s) return `<div class="tch-row crs-miss"><span class="sr-ic crs-n">${i + 1}</span><span><b>${esc(x.t || t('crs.songN', { n: i + 1 }))}</b><small>${esc(t('crs.missing'))}</small></span>${!edit && i === firstMiss ? `<button class="btn small" data-imp="${i}">${esc(t('crs.importPdf'))}</button>` : ''}${edit ? editBtns(i, items.length) : ''}</div>`;
      const s = byId.get(x.s), r = st.map[x.s];
      const tag = r === 'ready' ? '✓' : String(i + 1);
      return `<a class="tch-row${i === st.next ? ' crs-on' : ''}" ${edit ? '' : `href="#/vezbe/pesma/${encodeURIComponent(x.s)}"`} data-sid="${esc(x.s)}"><span class="sr-ic crs-n${r === 'ready' ? ' ok' : ''}">${tag}</span><span><b>${esc(s.title)}</b><small data-st="${esc(x.s)}">${esc([s.artist, r === 'ready' ? '✓ ' + t('rdy.ready') : r === 'work' ? t('crs.inWork') : t('crs.notStarted')].filter(Boolean).join(' · '))}</small></span>${edit ? editBtns(i, items.length) : CHEV}</a>`;
    };
    const editBtns = (i, n) => `<span class="crs-ed"><button class="icon-btn" data-up="${i}" ${i ? '' : 'disabled'} aria-label="${esc(t('crs.up'))}">▲</button><button class="icon-btn" data-dn="${i}" ${i + 1 < n ? '' : 'disabled'} aria-label="${esc(t('crs.down'))}">▼</button><button class="icon-btn" data-rm="${i}" aria-label="${esc(t('common.delete'))}">✕</button></span>`;
    const nx = items[st.next];
    body.innerHTML = `<h1>${esc(c.name)}</h1>
      <a class="sp-line lp-entry card crs-card" ${nx && nx.s ? `href="#/vezbe/pesma/${encodeURIComponent(nx.s)}"` : ''}><span class="sr-ic">${esc(c.ic || '🎓')}</span><span class="lp-et"><b>${esc(t('crs.progress', { n: st.ready, total: items.length }))}</b><small class="lp-es">${esc(nx ? t('crs.nextIs', { s: nx.s ? byId.get(nx.s).title : t('crs.songN', { n: st.next + 1 }) }) : t('crs.allDone'))}</small>${items.length ? barHTML({ items }, st) : ''}</span>${nx && nx.s ? CHEV : ''}</a>
      <div class="tch-sec"><span>${esc(t('crs.order'))}</span></div>
      ${items.length ? `<div class="set-grp crs-list">${items.map(row).join('')}</div>` : `<p class="muted">${esc(t('crs.noSongs'))}</p>`}
      ${own ? `<div class="crs-btns"><button class="btn" id="cAdd">+ ${esc(t('crs.addSongs'))}</button>${items.filter((x) => x.s).length > 1 ? `<button class="btn" id="cSort">${esc(t('crs.sort'))}</button>` : ''}</div>
      <div id="cSug"></div>` : ''}
      ${edit ? `<div class="crs-btns"><button class="btn" id="cRen">${esc(t('crs.rename'))}</button><button class="btn" id="cDel">${esc(t('common.delete'))}</button></div>` : ''}`;
    if (own) drawSug().catch(() => {});
    fillSteps(items).catch(() => {});
  };
  // korak puta za pesme u radu („korak 3 od 7 · Ritam pesme“)
  const fillSteps = async (items) => {
    const SP = await import('./songPath.js');
    for (const x of items) {
      if (!x.s) continue; const el = body.querySelector(`[data-st="${CSS.escape(x.s)}"]`); if (!el || /✓/.test(el.textContent)) continue;
      const s = await db.get(x.s).catch(() => null); if (!s) continue;
      const ps = await SP.pathState(s).catch(() => null); if (!ps || !ps.done) continue;
      const on = ps.steps.find((q) => q.id === ps.on);
      el.textContent = [s.artist, t('crs.step', { n: ps.done + (on ? 1 : 0), total: ps.total, s: on ? on.game : '' })].filter(Boolean).join(' · ');
    }
  };
  const drawSug = async () => {
    const box = body.querySelector('#cSug'); if (!box) return;
    const sug = await K.suggestNext(c);
    if (!sug.length) { box.innerHTML = ''; return; }
    const why = (x) => [x.fresh.length ? t(x.fresh.length === 1 ? 'crs.new1' : 'crs.newN', { n: x.fresh.length, c: x.fresh.slice(0, 3).join(', ') }) : t('crs.noNew'), x.barre.length ? 'barré: ' + x.barre.slice(0, 2).join(', ') : '', x.capo ? t('capo.title') + ' ' + x.capo : '', x.sameStrum ? t('crs.sameStrum') : ''].filter(Boolean).join(' · ');
    box.innerHTML = `<div class="tch-sec"><span>${esc(t('crs.suggest'))}</span></div><div class="set-grp">${sug.map((x, i) => `<div class="tch-row"><span class="sr-ic">＋</span><span><b>${esc(x.title)}</b><small>${esc(why(x))}</small></span><button class="btn small${i ? '' : ' primary'}" data-sadd="${esc(x.id)}">${esc(t('crs.add'))}</button></div>`).join('')}</div>`;
  };
  const setItems = async (items) => { await K.updateCourse(id, { items }); await draw(); };
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const items = [...((await K.getCourse(id)) || {}).items || []];
    if (b.id === 'cEdit') { edit = !edit; b.textContent = edit ? t('crs.done') : t('crs.edit'); await draw(); return; }
    if (b.dataset.up) { const i = +b.dataset.up; [items[i - 1], items[i]] = [items[i], items[i - 1]]; return setItems(items); }
    if (b.dataset.dn) { const i = +b.dataset.dn; [items[i + 1], items[i]] = [items[i], items[i + 1]]; return setItems(items); }
    if (b.dataset.rm) { items.splice(+b.dataset.rm, 1); return setItems(items); }
    if (b.dataset.sadd) { items.push({ s: b.dataset.sadd }); toast(t('crs.addedSong')); return setItems(items); }
    if (b.id === 'cSort') { const c0 = await K.getCourse(id); return setItems(await K.sortByDifficulty(c0)); }
    if (b.id === 'cAdd') {
      const { pickMany } = await import('./setlistsView.js');
      const sums = (await db.list()).filter((s) => !s.deleted).sort((a, x) => a.title.localeCompare(x.title));
      const have = new Set(items.filter((x) => x.s).map((x) => x.s));
      const picked = await pickMany(t('crs.addSongs'), sums.map((s) => ({ value: s.id, label: s.title, sub: s.artist || '' })), [...have]);
      if (!picked) return;
      const keep = items.filter((x) => !x.s || picked.includes(x.s));
      for (const pid of picked) if (!have.has(pid)) keep.push({ s: pid });
      return setItems(keep);
    }
    if (b.id === 'cRen') { const { askName } = await import('./setlistsView.js'); const n = await askName(t('crs.rename'), c.name); if (n) { await K.updateCourse(id, { name: n }); await draw(); } return; }
    if (b.id === 'cDel') {
      const ok = await dialog({ title: t('crs.delT', { name: c.name }), body: t('crs.delB'), buttons: [{ label: t('common.cancel'), value: false }, { label: t('common.delete'), value: true, kind: 'danger' }] });
      if (ok) { await K.deleteCourse(id); location.hash = '#/vezbe?t=k'; }
      return;
    }
    if (b.dataset.imp) {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.pdf,application/pdf';
      inp.onchange = async () => { const f = inp.files && inp.files[0]; if (f) (await import('./songEditor.js')).importPdf(f); };
      inp.click();
    }
  });
  await draw();
}

/** Za stranicu „Nauči ovu pesmu“: red kursa (gore) i „Sledeća u kursu“ / „Prethodna“ (dole). null ako pesma nije u kursu. */
export async function courseNav(songId) {
  const found = await K.coursesOfSong(songId); if (!found.length) return null;
  const { course, index } = found[0];
  const { prev, next } = K.neighbours(course, index);
  const title = async (x) => (x && x.s ? ((await db.get(x.s).catch(() => null)) || {}).title || '' : '');
  const [pt, nt] = await Promise.all([title(prev), title(next)]);
  const n = (course.items || []).length;
  const top = `<div class="set-grp crs-top"><a class="tch-row" href="#/kurs/${encodeURIComponent(course.id)}"><span class="sr-ic">${esc(course.ic || '🎓')}</span><span><b>${esc(course.name)}</b><small>${esc([t('crs.songOf', { n: index + 1, total: n }), pt ? t('crs.prevIs', { s: pt }) : ''].filter(Boolean).join(' · '))}</small></span>${CHEV}</a></div>`;
  const rowOf = (x, ic, label, title2) => (x ? (x.s ? `<a class="tch-row" href="#/vezbe/pesma/${encodeURIComponent(x.s)}"><span class="sr-ic">${ic}</span><span><b>${esc(label)}: ${esc(title2)}</b><small>${esc(t('crs.songOf', { n: x.index + 1, total: n }))}</small></span>${CHEV}</a>`
    : `<a class="tch-row" href="#/kurs/${encodeURIComponent(course.id)}"><span class="sr-ic">${ic}</span><span><b>${esc(label)}: ${esc(t('crs.songN', { n: x.index + 1 }))}</b><small>${esc(t('crs.missingImp'))}</small></span>${CHEV}</a>`) : '');
  const end = next || prev ? `<div class="tch-sec"><span>${esc(t('crs.secName', { name: course.name }))}</span></div><div class="set-grp">${rowOf(next, '⏭', t('crs.nextInCourse'), nt)}${rowOf(prev, '⏮', t('crs.prev'), pt)}</div>` : '';
  return { top, end };
}
