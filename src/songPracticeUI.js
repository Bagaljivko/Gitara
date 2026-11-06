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
 *   onSheetClick?(e, id) }
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
    api.opts.innerHTML = `
      <button class="btn primary big wide spr-whole" data-start="${o.wholeId}">${PLAY}<span>${t('pr.pesma.wholeBtn')}</span>${prog(o.wholeId).includes('spr-stars') ? `<small class="spr-whole-prog">${prog(o.wholeId)}</small>` : ''}</button>
      <div class="spr-sec-h">${t('pr.pesma.practicePart')}<small>${t('pr.pesma.pickHint')}</small></div>
      ${o.groups.map((g) => `${g.title ? `<div class="spr-grp">${esc(g.title)}</div>` : ''}<div class="spr-rows">${g.rows.map((r) => `
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
    const row = e.target.closest('[data-row]');
    if (row) openSheet(row.dataset.row);
  });
  api.opts.addEventListener('keydown', (e) => { const row = e.target.closest?.('[data-row]'); if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openSheet(row.dataset.row); } });
  // podešavanja vežbe (Čekaj me + brzina) idu ispod delova: prvo se bira šta, pa kako
  const host = api.opts.parentElement;
  const wb = host.querySelector('#prWaitBox'), spd = host.querySelector('#prSpeed');
  const lab = document.createElement('div'); lab.className = 'spr-sec-h spr-how'; lab.textContent = t('pr.pesma.howHead');
  api.opts.after(lab); lab.after(wb); wb.after(spd);
  host.classList.add('spr-layout');
  draw();
  return { draw: () => { draw(); refreshSheet(); }, closeSheet };
}
