// v2.4.27: dve verzije iste pesme (isti naslov i izvođač) — uporedi i izaberi.
// 1) Koji tekst i akorde zadržavaš (kartica levo/desno), „Razlike“ po delovima (dodir = redovi jedan ispod drugog).
// 2) „Spoji u jednu“: izabran tekst + sve tvoje (vežbanje, spremna, ritam, snimak, folderi, setliste) u jednoj pesmi;
//    „Zadrži samo …“: druga se briše; „Ostavi obe“: ne pita više za taj par. Svaka odluka ima „Poništi“.
// Pesma od nastavnika ostaje povezana: nove izmene od nastavnika idu u spojenu pesmu (ili, ako si zadržao svoj tekst,
// stižu kao nova verzija pa te aplikacija pita ponovo).
import { t } from './i18n.js';
import { esc, toast } from './ui.js';
import { songs as db, settings, versions } from './db.js';
import { sectionLabel } from './sectionLabel.js';
import { dn } from './naming.js';

// lično (ostaje sa pesmom koja nosi istoriju; prazno se popuni iz druge)
const PERSONAL = ['id', 'createdAt', 'updatedAt', 'folders', 'seen', 'zoom', 'easyCapo', 'skipped', 'strum', 'suggestStrum', 'bpm', 'yt', 'ytSync', 'scrollSpeed', 'tuning',
  'fromT', 'src', 'student', 'fromStudent', 'chk', 'deleted', 'demo', 'keepMine', 'recording'];
const FILL = ['strum', 'suggestStrum', 'bpm', 'yt', 'ytSync', 'scrollSpeed', 'tuning', 'recording'];

import { IGN, normKey, findDups, dupOf, pairKey } from './songDup.js';
export { normKey, findDups, dupOf };

// ---------- istorija (vežbanje, vreme sa pesmom) ----------
async function practiceOf(id) { const st = (await settings.get('practice', {})) || {}; return (st.songs || {})[id] || null; }
async function activityOf(id) {
  const act = (await settings.get('activity', null)) || { dev: {} };
  let p = 0, n = 0, x = 0, last = 0;
  for (const d of Object.values(act.dev || {})) { const s = (d.s || {})[id]; if (s) { p += s.p || 0; n += s.n || 0; x += s.x || 0; last = Math.max(last, s.last || 0); } }
  return { p, n, x, last };
}
async function historyOf(s) {
  const pr = await practiceOf(s.id), ac = await activityOf(s.id);
  const plays = pr ? Object.values(pr).reduce((a, r) => a + ((r && r.plays) || 0), 0) : 0;
  const best = pr && pr.all ? pr.all.best || 0 : 0;
  let ready = false;
  try { ready = !!pr && (await import('./statsView.js')).readinessOf(pr) === 'ready'; } catch {}
  return { plays, best, ready, visits: ac.n, ms: ac.p + ac.x, weight: plays * 3 + ac.n + (ac.p + ac.x) / 60000 };
}

function mergePractice(st, from, to) {
  const S = st.songs || (st.songs = {});
  const a = S[from]; if (!a) return;
  const b = S[to] || (S[to] = {});
  for (const [k, r] of Object.entries(a)) {
    const q = b[k];
    if (!q) b[k] = r;
    else b[k] = { ...((r.best || 0) > (q.best || 0) ? r : q), plays: (r.plays || 0) + (q.plays || 0) };
  }
  delete S[from];
}
function mergeActivity(act, from, to) {
  for (const d of Object.values(act.dev || {})) {
    const s = d.s || {}; const a = s[from]; if (!a) continue;
    const b = s[to];
    if (!b) s[to] = a;
    else {
      s[to] = { ...b, p: (b.p || 0) + (a.p || 0), n: (b.n || 0) + (a.n || 0), x: (b.x || 0) + (a.x || 0), last: Math.max(b.last || 0, a.last || 0),
        d: [...new Set([...(b.d || []), ...(a.d || [])])].sort((u, v) => u - v).slice(-120),
        ...(a.td && b.td && a.td.d === b.td.d ? { td: { d: a.td.d, ms: (a.td.ms || 0) + (b.td.ms || 0) } } : a.td && (!b.td || a.td.d > b.td.d) ? { td: a.td } : {}) };
    }
    delete s[from];
  }
}
// v2.5.64: kurs pokazuje na pesmu koja ostaje (ranije je ostajao „prazan“ korak sa obrisanom pesmom)
async function repointCourses(from, to) {
  const list = (await settings.get('courses', [])) || []; let ch = false;
  for (const c of list) {
    if (!Array.isArray(c.items) || !c.items.some((x) => x && x.s === from)) continue;
    const has = c.items.some((x) => x && x.s === to);
    c.items = c.items.map((x) => (x && x.s === from ? (has ? null : { ...x, s: to }) : x)).filter(Boolean); c.updatedAt = Date.now(); ch = true;
  }
  if (ch) await settings.set('courses', list);
}
function repoint(sets, from, to) {
  let ch = false;
  for (const sl of sets) {
    if (!Array.isArray(sl.songIds) || !sl.songIds.includes(from)) continue;
    const ids = []; for (const x of sl.songIds) { const y = x === from ? to : x; if (!ids.includes(y)) ids.push(y); }
    sl.songIds = ids; sl.updatedAt = Date.now(); ch = true;
  }
  return ch;
}

const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x))); // v2.4.34: radi i na starijim telefonima (bez structuredClone)
async function snapshot(a, b) {
  return { a, b, practice: clone((await settings.get('practice', {})) || {}), activity: clone((await settings.get('activity', null)) || null), setlists: clone((await settings.get('setlists', [])) || []), courses: clone((await settings.get('courses', [])) || []) };
}
async function restore(snap) {
  await db.put(snap.a, { force: true }); await db.put(snap.b, { force: true });
  await settings.set('practice', snap.practice);
  if (snap.activity) await settings.set('activity', snap.activity);
  await settings.set('setlists', snap.setlists);
  if (snap.courses) await settings.set('courses', snap.courses);
}

/** Izabran tekst (sel) u jednoj pesmi; istorija ide u pesmu koja je ima više (base). */
export async function mergeSongs(selId, otherId) {
  const A = await db.get(selId), B = await db.get(otherId);
  if (!A || !B) return null;
  const snap = await snapshot(A, B);
  const [hA, hB] = [await historyOf(A), await historyOf(B)];
  const base = hA.weight > hB.weight || (hA.weight === hB.weight && !A.fromT) ? A : B;
  const other = base === A ? B : A;
  const rec = { ...base };
  if (base !== A) { // tekst iz izabrane
    for (const k of Object.keys(rec)) if (!PERSONAL.includes(k)) delete rec[k];
    for (const [k, v] of Object.entries(A)) if (!PERSONAL.includes(k)) rec[k] = v;
  }
  for (const k of FILL) if (rec[k] == null && other[k] != null) rec[k] = other[k];
  rec.folders = [...new Set([...(base.folders || []), ...(other.folders || [])])];
  const T = A.fromT ? A : B.fromT ? B : null;
  if (T) { rec.fromT = T.fromT; if (T.src) rec.src = T.src; if (A === T) delete rec.keepMine; else rec.keepMine = true; }
  rec.updatedAt = Date.now();
  await versions.save('song:' + base.id, base, 'merge'); // stari tekst ostaje u „Prethodnim verzijama“
  await db.put(rec);
  const st = (await settings.get('practice', {})) || {}; mergePractice(st, other.id, base.id); await settings.set('practice', st);
  const act = await settings.get('activity', null); if (act) { mergeActivity(act, other.id, base.id); await settings.set('activity', act); }
  const sets = (await settings.get('setlists', [])) || []; if (repoint(sets, other.id, base.id)) await settings.set('setlists', sets);
  await repointCourses(other.id, base.id);
  await db.remove(other.id);
  return { id: base.id, snap };
}
/** Samo izabrana ostaje; druga se briše (njeno vežbanje ostaje neiskorišćeno). */
export async function keepOnly(selId, otherId) {
  const A = await db.get(selId), B = await db.get(otherId);
  if (!A || !B) return null;
  const snap = await snapshot(A, B);
  if (B.fromT && !A.fromT && B.src) await db.put({ ...A, src: B.src, keepMine: true, updatedAt: Date.now() }); // nove izmene od nastavnika — pitaj ponovo
  const sets = (await settings.get('setlists', [])) || []; if (repoint(sets, B.id, A.id)) await settings.set('setlists', sets);
  await repointCourses(B.id, A.id);
  await db.remove(B.id);
  return { id: A.id, snap };
}
export async function ignorePair(a, b) {
  const l = (await settings.get(IGN, [])) || [];
  const k = pairKey(a, b); if (!l.includes(k)) l.push(k);
  await settings.set(IGN, l.slice(-300));
}

// ---------- razlike ----------
const lineSig = (l) => (l.chords || []).map((c) => c.chord).join(' ') + '|' + String(l.text || '').trim();
function sectionsDiff(a, b) {
  const A = a.sections || [], B = b.sections || [];
  const rows = [];
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i], y = B[i];
    const name = sectionLabel((x || y).name || '') || t('mg.part', { n: i + 1 });
    if (!x || !y) { rows.push({ name, st: x ? 'onlyA' : 'onlyB' }); continue; }
    const lx = (x.lines || []).map(lineSig), ly = (y.lines || []).map(lineSig);
    if (lx.join('\n') === ly.join('\n')) { rows.push({ name, st: 'same' }); continue; }
    const tx = (x.lines || []).map((l) => String(l.text || '').trim()).join('\n'), ty = (y.lines || []).map((l) => String(l.text || '').trim()).join('\n');
    const k = lx.findIndex((s, j) => s !== ly[j]);
    rows.push({ name, st: tx === ty ? 'chords' : 'text', la: (x.lines || [])[k >= 0 ? k : 0], lb: (y.lines || [])[k >= 0 ? k : 0] });
  }
  return rows;
}
/** Red sa akordima iznad teksta (monospace); akordi kojih nema u drugom redu su označeni. */
function lineHTML(l, o) {
  if (!l) return '<div class="t">—</div>';
  const text = String(l.text || '');
  const cs = [...(l.chords || [])].sort((p, q) => (p.position ?? p.pos ?? 0) - (q.position ?? q.pos ?? 0));
  const other = new Set(((o && o.chords) || []).map((c) => (c.position ?? c.pos ?? 0) + ':' + c.chord));
  let row = '', col = 0;
  for (const c of cs) {
    const pos = Math.max(col, c.position ?? c.pos ?? 0), name = dn(c.chord);
    row += ' '.repeat(pos - col) + (other.has((c.position ?? c.pos ?? 0) + ':' + c.chord) ? esc(name) : `<mark>${esc(name)}</mark>`);
    col = pos + name.length + 1; row += ' ';
  }
  return `<div class="c">${row}</div><div class="t">${esc(text) || '&nbsp;'}</div>`;
}

// ---------- ekran ----------
const partsTxt = (n) => (n === 1 ? t('mg.parts1') : t(n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'mg.partsFew' : 'mg.parts', { n }));
const fmtDate = (ms) => { if (!ms) return ''; const d = new Date(ms); return `${d.getDate()}. ${d.getMonth() + 1}.`; };
const who = (s, myT) => (s.fromT ? '🎓 ' + t('mg.fromT', { name: (s.fromT && s.fromT.name) || (myT && myT.name) || t('tch.teacher') }) : t('mg.mine'));

/** Ekran „dve verzije“ za par (a, b). onDone(id) posle odluke. */
export async function openMerge(aId, bId, { onDone } = {}) {
  const a = await db.get(aId), b = await db.get(bId);
  if (!a || !b) return;
  const myT = await settings.get('myTeacher', null).catch(() => null);
  const ha = await historyOf(a), hb = await historyOf(b);
  const folders = (await settings.get('folders', [])) || [];
  const { patternName } = await import('./rhythm.js'); const { patternById } = await import('./suggest.js'); // v2.4.30: patternById je u suggest.js (ranije pogrešno → crn ekran)
  let sel = a.id, open = -1;
  const same = (x, y) => (x.fromT ? 1 : 0) === (y.fromT ? 1 : 0);
  const label = (s) => (same(a, b) ? (s === a ? t('mg.v1') : t('mg.v2')) : who(s, myT));
  const shortName = (s) => (s.fromT ? (s.fromT.name || (myT && myT.name) || t('tch.teacher')) : t('mg.mineShort'));
  const rows = sectionsDiff(a, b);
  const wrap = document.createElement('div');
  wrap.className = 'mg-wrap';
  wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', t('mg.title'));
  const card = (s, h) => {
    const st = s.strum || null, sug = !st && s.suggestStrum ? patternById(s.suggestStrum.id) : null;
    const fn = (s.folders || []).map((id) => (folders.find((f) => f.id === id) || {}).name).filter(Boolean);
    const l1 = [s.key ? dn(s.key) : '', s.bpm ? s.bpm + ' BPM' : '', s.capo ? t('capo.title') + ' ' + s.capo : '', partsTxt((s.sections || []).length), s.fromT ? t('mg.came', { d: fmtDate(s.createdAt) }) : t('mg.added', { d: fmtDate(s.createdAt) })].filter(Boolean).join(' · ');
    const l2 = [t('mg.rhythm') + ': ' + (st ? patternName(st) : sug ? patternName(sug) + '?' : '—'), t('mg.practiced') + ': ' + (h.plays || h.visits ? t('mg.times', { n: h.plays + h.visits }) : '—'), s.yt ? '▶ ' + t('mg.video') : '', fn.length ? t('mg.folder', { f: fn.join(', ') }) : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="tch-row mg-v${sel === s.id ? ' on' : ''}" data-v="${esc(s.id)}" role="radio" aria-checked="${sel === s.id}">
      <span class="sr-ic" aria-hidden="true">${s.fromT ? '🎓' : '🎸'}</span>
      <span><b class="who">${esc(label(s).replace(/^🎓 /, ''))}</b><small>${esc(l1)}</small><small>${esc(l2)}${h.ready ? ` · <em class="ok">✓ ${esc(t('rdy.ready'))}</em>` : ''}</small></span>
      <i class="mg-radio" aria-hidden="true"></i></button>`;
  };
  const diffRow = (r, i) => {
    const can = !!(r.la || r.lb);
    const st = r.st === 'same' ? `<small>${esc(t('mg.same'))}</small>` : `<small class="diff">${esc(r.st === 'chords' ? t('mg.dChords') : r.st === 'text' ? t('mg.dText') : t('mg.only', { w: shortName(r.st === 'onlyA' ? a : b) }))}</small>`;
    return `<button type="button" class="tch-row mg-r${r.st === 'same' ? ' same' : ''}" data-r="${i}"${can ? ` aria-expanded="${open === i}"` : ' disabled'}>
      <span class="sr-ic${r.st === 'same' ? ' n' : ''}" aria-hidden="true">${r.st === 'same' ? '✓' : r.st === 'onlyA' || r.st === 'onlyB' ? '＋' : '≠'}</span><span><b>${esc(r.name)}</b>${st}</span>${can ? `<span class="chev" aria-hidden="true">${open === i ? '⌃' : '⌄'}</span>` : ''}</button>
      ${open === i ? `<div class="mg-x"><div class="ln"><span class="tag">${esc(shortName(a))}</span><div>${lineHTML(r.la, r.lb)}</div></div><div class="ln"><span class="tag">${esc(shortName(b))}</span><div>${lineHTML(r.lb, r.la)}</div></div></div>` : ''}`;
  };
  const draw = () => {
    const S = sel === a.id ? a : b, O = S === a ? b : a, hO = O === a ? ha : hb;
    const lose = [hO.plays + hO.visits ? t('mg.times', { n: hO.plays + hO.visits }) : '', hO.ready ? '✓ ' + t('rdy.ready') : ''].filter(Boolean).join(' · ');
    const T = a.fromT ? a : b.fromT ? b : null;
    wrap.innerHTML = `<section class="view mg">
      <button type="button" class="back mg-back" data-x>‹ ${esc(t('nav.songs'))}</button>
      <h1>${esc(a.title || b.title)}</h1><p class="muted mg-sub">${esc([a.artist || b.artist, t('mg.two')].filter(Boolean).join(' · '))}</p>
      <div class="tch-sec"><span>${esc(t('mg.q1'))}</span></div>
      <div class="set-grp" role="radiogroup">${card(a, ha)}${card(b, hb)}</div>
      <div class="tch-sec"><span>${esc(t('mg.diff'))}</span></div>
      <div class="set-grp">${rows.length ? rows.map(diffRow).join('') : `<div class="tch-row"><span><small>${esc(t('mg.same'))}</small></span></div>`}</div>
      <div class="tch-sec"><span>${esc(t('mg.q2'))}</span></div>
      <div class="mg-a">
        <button type="button" class="btn primary wide" data-do="merge">${esc(t('mg.merge'))}</button>
        <p class="mg-why" data-why="merge">${esc(t('mg.mergeSub', { w: S.fromT ? t('mg.textOf', { name: shortName(S) }) : same(a, b) ? t('mg.textOfV', { v: label(S) }) : t('mg.textMine') }))}${T && S !== T ? ' · ' + esc(t('mg.stayLinked', { name: shortName(T) })) : ''}</p>
        <button type="button" class="btn wide" data-do="keep">${esc(t('mg.keep', { w: S.fromT ? shortName(S) : same(a, b) ? label(S) : t('mg.mineShort') }))}</button>
        <p class="mg-why" data-why="keep">${esc(lose ? t('mg.keepLose', { w: label(O), what: lose }) : t('mg.keepSub', { w: label(O) }))}${O.fromT ? ' · ' + esc(t('mg.askAgain', { name: shortName(O) })) : ''}</p>
        <button type="button" class="linkish mg-both" data-do="both">${esc(t('mg.both'))}</button>
      </div></section>`;
  };
  const close = () => { wrap.remove(); removeEventListener('hashchange', close); removeEventListener('keydown', onKey); document.body.classList.remove('mg-open'); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  wrap.addEventListener('click', async (e) => {
    if (e.target.closest('[data-x]')) return close();
    const v = e.target.closest('[data-v]'); if (v) { sel = v.dataset.v; safeDraw(); return; }
    const r = e.target.closest('[data-r]'); if (r) { const i = +r.dataset.r; open = open === i ? -1 : i; safeDraw(); return; }
    const d = e.target.closest('[data-do]')?.dataset.do; if (!d) return;
    const other = sel === a.id ? b.id : a.id;
    let res = null;
    if (d === 'both') { await ignorePair(a.id, b.id); close(); toast(t('mg.keptBoth')); onDone?.(null); return; }
    wrap.querySelectorAll('button').forEach((x) => (x.disabled = true));
    try { res = d === 'merge' ? await mergeSongs(sel, other) : await keepOnly(sel, other); } catch (err) { console.warn(err); }
    close();
    if (!res) { toast(t('err.title'), 'error'); return; }
    toast(t(d === 'merge' ? 'mg.merged' : 'mg.keptOne'), '', { label: t('common.undo'), onClick: async () => { await restore(res.snap); onDone?.(sel); } });
    onDone?.(res.id);
  });
  addEventListener('hashchange', close); addEventListener('keydown', onKey);
  document.body.appendChild(wrap); document.body.classList.add('mg-open');
  // v2.4.30: ako crtanje ne uspe — zatvori (bez crnog ekrana), poruka i zapis za dijagnostiku
  const safeDraw = () => { try { draw(); return true; } catch (e) { close(); toast(t('err.title'), 'error'); import('./teachBox.js').then((B) => B.diag('merge', (e && e.message) || e)).catch(() => {}); return false; } };
  if (!safeDraw()) return;
  wrap.querySelector('.mg-back')?.focus();
}
