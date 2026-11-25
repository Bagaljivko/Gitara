// Vežbe → „Delovi pesme“ (akordi i TAB): zajednički raspored ekrana.
//  • kartica pesme (naslov, izvođač, takt/tempo, „Promeni pesmu“)
//  • veliko dugme „Sviraj celu pesmu“
//  • „Vežbaj deo“: redovi po delovima (napredak ★, „Najteže“, „Sledeće“, ▶ poslušaj), grupisani po celinama
//  • dodir na red → panel tog dela: Poslušaj, (opcije dela), Počni
const STAR = (score) => (score >= 92 ? 3 : score >= 75 ? 2 : score >= 50 ? 1 : 0);
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h12v12H6z"/></svg>';
const CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6-1.4-1.4 4.6-4.6-4.6-4.6z"/></svg>';

/**
 * opts: { api, head: { title, artist, meta }, groups: [{ title?, rows: [{ id, label, sub, hard }] }],
 *   recOf(id) → { best, lastTempo }, wholeId, listeningId() → id|null, onListen(id), onStart(id), sheetExtra?(id) → html,
 *   onSheetClick?(e, id), plan?() → [{ id, title, min, what, sub, done }], onPlan?(id), direct? }
 * v2.4.17: plan — „Predlog za danas“ (koraci redom: promene, ritam, pevanje uz tekst, cela pesma); direct — dodir na deo
 * odmah počinje (bez iskačućeg panela), a opcije dela (sheetExtra) su u „Kako vežbaš“.
 */
export function songPracticeUI(o) {
  const { api } = o, { t, esc } = api;
  const rows = o.groups.flatMap((g) => g.rows);
  // „Sledeće“: prvi deo (redom) koji još nije pređen (ispod 80); ako su svi pređeni — nema oznake
  const nextId = () => { const r = rows.find((x) => !x.noNext && ((o.recOf(x.id) || {}).best || 0) < 80); return r ? r.id : null; };
  const prog = (id) => {
    const r = o.recOf(id) || {};
    if (!r.best) return `<span class="spr-none">${t('pr.pesma.notYet')}</span>`;
    const s = STAR(r.best);
    return `<span class="spr-stars" aria-label="${s}/3">${[0, 1, 2].map((i) => `<i class="${i < s ? 'on' : ''}">★</i>`).join('')}</span>${r.lastTempo ? `<span class="spr-bpm">${r.lastTempo} BPM</span>` : ''}`;
  };
  function draw() {
    const nx = nextId(), L = o.listeningId();
    api.head.innerHTML = `<div class="spr-song card">
      <div class="spr-song-t"><b>${esc(o.head.title)}</b>${o.head.artist ? `<span>${esc(o.head.artist)}</span>` : ''}<small>${esc(o.head.meta)}</small></div>
      <a class="spr-change" href="#/vezbe/pesma">${t('pr.pesma.change')}</a></div>`;
    const plan = o.plan ? o.plan() : null;
    const on = plan ? (plan.find((x) => !x.done) || {}).id : null;
    api.opts.innerHTML = plan ? `
      <div class="spr-sec-h">${t('pl.head', { n: plan.reduce((a, x) => a + (x.min || 0), 0) })}<small>${t('pl.headSub')}</small></div>
      <div class="pl-steps">${plan.map((x, i) => `<div class="pl-step${x.done ? ' done' : ''}${x.id === on ? ' on' : ''}" data-plan="${x.id}" role="button" tabindex="0">
        <span class="pl-n">${x.done ? '✓' : plan[0].id === 'tut' ? i : i + 1}</span>
        <span class="pl-b"><b>${esc(x.title)}${x.min ? `<i class="pl-min">${t('pl.min', { n: x.min })}</i>` : ''}</b><small class="pl-what">${esc(x.what)}</small>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span>
        <span class="pl-btn${x.id === on ? ' pri' : ''}">${x.done ? t('pl.again') : x.btn || t('pr.start')}</span></div>`).join('')}</div>
      <div class="spr-sec-h">${t('pr.pesma.practicePart')}<small>${t('pr.pesma.pickHint')}</small></div>
      ${groupsHTML(nx, L)}` : `
      <button class="btn primary big wide spr-whole" data-start="${o.wholeId}">${PLAY}<span>${t('pr.pesma.wholeBtn')}</span>${prog(o.wholeId).includes('spr-stars') ? `<small class="spr-whole-prog">${prog(o.wholeId)}</small>` : ''}</button>
      <div class="spr-sec-h">${t('pr.pesma.practicePart')}<small>${t('pr.pesma.pickHint')}</small></div>
      ${groupsHTML(nx, L)}`;
    if (o.direct && o.sheetExtra) { const ex = api.opts.parentElement.querySelector('.spr-extra'); if (ex) ex.innerHTML = o.sheetExtra(null); }
  }
  function groupsHTML(nx, L) {
    return `${o.groups.map((g) => `${g.title ? `<div class="spr-grp">${esc(g.title)}</div>` : ''}<div class="spr-rows">${g.rows.map((r) => `
        <div class="spr-row${r.id === nx ? ' next' : ''}" data-row="${r.id}" role="button" tabindex="0">
          <div class="spr-main"><div class="spr-name">${esc(r.label)}${r.hard ? ` <span class="pr-hard">${t('pr.pesma.hardest')}</span>` : ''}${r.id === nx ? ` <span class="spr-next">${t('pr.pesma.next')}</span>` : ''}</div>
            ${r.sub ? `<div class="spr-sub">${esc(r.sub)}</div>` : ''}<div class="spr-prog">${prog(r.id)}</div></div>
          <button class="icon-btn spr-listen${L === r.id ? ' on' : ''}" data-listen="${r.id}" aria-label="${t('pr.listen')}" title="${t('pr.listen')}">${L === r.id ? STOP : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z"/></svg>'}</button>
          <span class="spr-go">${t('pr.pesma.practiceBtn')}${CHEV}</span>
        </div>`).join('')}</div>`).join('')}`;
  }
  // Panel dela: Poslušaj, opcije, Počni
  let sheet = null;
  function openSheet(id) {
    const r = rows.find((x) => String(x.id) === String(id));
    if (!r) return;
    closeSheet();
    const L = o.listeningId();
    sheet = document.createElement('div');
    sheet.className = 'modal-backdrop sheet-backdrop spr-backdrop';
    sheet.innerHTML = `<div class="sheet spr-sheet" role="dialog" aria-modal="true" aria-label="${esc(r.label)}"><div class="sheet-grip"></div>
      <h2 class="sheet-title">${esc(r.label)}${r.hard ? ` <span class="pr-hard">${t('pr.pesma.hardest')}</span>` : ''}</h2>
      ${r.sub ? `<p class="spr-sheet-sub">${esc(r.sub)}</p>` : ''}
      <div class="spr-sheet-prog">${prog(r.id)}</div>
      ${o.sheetExtra ? o.sheetExtra(r.id) : ''}
      <div class="spr-sheet-bar">
        <button class="btn" data-sl="${r.id}">${L === r.id ? STOP + t('pr.listenStop') : PLAY + t('pr.listen')}</button>
        <button class="btn primary" data-sgo="${r.id}">${t('pr.start')}</button>
      </div></div>`;
    sheet.__close = closeSheet;
    sheet.addEventListener('click', (e) => {
      if (!e.target.closest('.sheet')) return closeSheet();
      const go = e.target.closest('[data-sgo]');
      if (go) { closeSheet(); o.onStart(go.dataset.sgo); return; }
      const sl = e.target.closest('[data-sl]');
      if (sl) { o.onListen(sl.dataset.sl); return; }
      o.onSheetClick?.(e, id);
    });
    document.body.appendChild(sheet);
  }
  function closeSheet() { sheet?.remove(); sheet = null; }
  const refreshSheet = () => { if (!sheet) return; const id = sheet.querySelector('[data-sgo]')?.dataset.sgo; if (id != null) openSheet(id); };
  api.onCleanup?.(closeSheet);
  api.opts.addEventListener('click', (e) => {
    if (api.running) return;
    const li = e.target.closest('[data-listen]');
    if (li) { e.stopPropagation(); o.onListen(li.dataset.listen); return; }
    const st = e.target.closest('[data-start]');
    if (st) { o.onStart(st.dataset.start); return; }
    const pl = e.target.closest('[data-plan]');
    if (pl) { o.onPlan?.(pl.dataset.plan); return; }
    const row = e.target.closest('[data-row]');
    if (row) { if (o.direct) o.onStart(row.dataset.row); else openSheet(row.dataset.row); }
  });
  api.opts.addEventListener('keydown', (e) => {
    const pl = e.target.closest?.('[data-plan]'); if (pl && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); o.onPlan?.(pl.dataset.plan); return; }
    const row = e.target.closest?.('[data-row]'); if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (o.direct) o.onStart(row.dataset.row); else openSheet(row.dataset.row); }
  });
  // podešavanja vežbe (Čekaj me + brzina) idu ispod delova: prvo se bira šta, pa kako
  const host = api.opts.parentElement;
  const wb = host.querySelector('#prWaitBox'), spd = host.querySelector('#prSpeed');
  const lab = document.createElement('div'); lab.className = 'spr-sec-h spr-how'; lab.textContent = t('pr.pesma.howHead');
  api.opts.after(lab); lab.after(wb); wb.after(spd);
  if (o.direct && o.sheetExtra) { const ex = document.createElement('div'); ex.className = 'spr-extra'; spd.after(ex); ex.addEventListener('click', (e) => o.onSheetClick?.(e, null)); }
  host.classList.add('spr-layout');
  draw();
  return { draw: () => { draw(); refreshSheet(); }, closeSheet };
}
