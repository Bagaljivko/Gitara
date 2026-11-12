// v2.2: jedno prevlačenje za sve liste u aplikaciji (isti izgled i ponašanje svuda).
// Uhvati ručicu ≡ (ili dugo pritisni stavku, za nizove čipova) → stavka se „podigne“ (zlatni okvir, senka), lista se
// preslaže dok pomeraš prst; kod ivice se lista sama pomera; kratka vibracija na podizanje. Tastatura: Alt + ↑/↓ na stavci.
// Odeljci: elementi sa [data-dl-sep] su fiksni razdelnici — stavka može preći iz jednog odeljka u drugi.
export const GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>';
export const gripHTML = (label = '') => `<span class="dl-grip" role="button" tabindex="0"${label ? ` aria-label="${label}"` : ''}>${GRIP}</span>`;

/**
 * box: kontejner liste. opts: { item: selektor stavke, handle?: selektor ručice (podrazumevano .dl-grip),
 *   longPress?: true = dugo pritisni stavku (bez ručice; kratak dodir ostaje klik), grid?: true = stavke u redovima (čipovi),
 *   onDrop(items[]) — posle spuštanja (i posle Alt+↑/↓), sa novim redosledom stavki }. Vraća funkciju za odjavu.
 */
export function dragList(box, opts) {
  const IT = opts.item, H = opts.handle || '.dl-grip';
  let d = null, lpT = 0;
  const items = () => [...box.querySelectorAll(IT)];
  const scroller = () => { let e = box; while (e && e !== document.body) { const s = getComputedStyle(e); if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight) return e; e = e.parentElement; } return document.scrollingElement; };
  const lift = (el, e) => {
    d = { el, id: e.pointerId, sc: scroller(), y: e.clientY, x: e.clientX, raf: 0, moved: false };
    el.classList.add('dl-lift'); box.classList.add('dl-on');
    try { navigator.vibrate?.(8); } catch {}
    try { box.setPointerCapture(e.pointerId); } catch {}
  };
  // gde ubaciti: sledeći element (stavka ili razdelnik) ispred kog ide podignuta stavka
  const place = (x, y) => {
    const kids = [...box.children].filter((c) => c !== d.el && (c.matches(IT) || c.matches('[data-dl-sep]')));
    let before = null;
    if (opts.grid) {
      for (const c of kids) { const r = c.getBoundingClientRect(); if (y < r.top) { before = c; break; } if (y <= r.bottom && x < r.left + r.width / 2) { before = c; break; } }
    } else {
      for (const c of kids) { const r = c.getBoundingClientRect(); if (y < r.top + r.height / 2) { before = c; break; } }
    }
    if (before) { if (d.el.nextElementSibling !== before) box.insertBefore(d.el, before); }
    else if (box.lastElementChild !== d.el) box.appendChild(d.el);
  };
  const edge = () => { // automatsko pomeranje liste kod ivice
    if (!d) return;
    const sc = d.sc, r = sc === document.scrollingElement ? { top: 0, bottom: innerHeight } : sc.getBoundingClientRect();
    const v = d.y < r.top + 48 ? -8 : d.y > r.bottom - 48 ? 8 : 0;
    if (v) { sc.scrollBy(0, v); place(d.x, d.y); }
    d.raf = requestAnimationFrame(edge);
  };
  const down = (e) => {
    if (e.button > 0 || d) return;
    const h = e.target.closest(H), el = (h || e.target).closest(IT);
    if (!el || !box.contains(el)) return;
    if (h) { e.preventDefault(); lift(el, e); d.raf = requestAnimationFrame(edge); return; }
    if (!opts.longPress) return;
    const sx = e.clientX, sy = e.clientY, ev = e;
    clearTimeout(lpT);
    lpT = setTimeout(() => { lift(el, ev); d.lp = true; d.raf = requestAnimationFrame(edge); }, 380);
    const cancel = (m) => { if (Math.hypot(m.clientX - sx, m.clientY - sy) > 8) { clearTimeout(lpT); off(); } };
    const off = () => { box.removeEventListener('pointermove', cancel); box.removeEventListener('pointerup', off); box.removeEventListener('pointercancel', off); clearTimeout(lpT); };
    box.addEventListener('pointermove', cancel); box.addEventListener('pointerup', off); box.addEventListener('pointercancel', off);
  };
  const move = (e) => { if (!d || e.pointerId !== d.id) return; e.preventDefault(); d.x = e.clientX; d.y = e.clientY; d.moved = true; place(d.x, d.y); };
  const up = (e) => {
    if (!d || (e && e.pointerId !== d.id)) return;
    cancelAnimationFrame(d.raf);
    const el = d.el, lp = d.lp || d.moved; d = null;
    el.classList.remove('dl-lift'); box.classList.remove('dl-on');
    if (lp) { const stop = (c) => { c.stopPropagation(); c.preventDefault(); }; el.addEventListener('click', stop, { capture: true, once: true }); setTimeout(() => el.removeEventListener('click', stop, { capture: true }), 400); } // posle prevlačenja stavka se ne „klikne“
    opts.onDrop?.(items(), el);
  };
  const key = (e) => {
    const el = e.target.closest(IT); if (!el || !box.contains(el)) return;
    const onHandle = e.target.closest(H);
    if (!(e.key === 'ArrowUp' || e.key === 'ArrowDown') || !(e.altKey || onHandle)) return;
    e.preventDefault();
    const kids = [...box.children].filter((c) => c.matches(IT) || c.matches('[data-dl-sep]')), i = kids.indexOf(el);
    const j = e.key === 'ArrowUp' ? i - 1 : i + 1; if (j < 0 || j >= kids.length) return;
    if (e.key === 'ArrowUp') box.insertBefore(el, kids[j]); else box.insertBefore(el, kids[j].nextElementSibling);
    (el.querySelector(H) || el).focus?.();
    opts.onDrop?.(items(), el);
  };
  const noCtx = (e) => { if (d || (opts.longPress && e.target.closest(IT))) e.preventDefault(); };
  box.addEventListener('pointerdown', down); box.addEventListener('pointermove', move); box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  box.addEventListener('keydown', key); box.addEventListener('contextmenu', noCtx);
  return () => { box.removeEventListener('pointerdown', down); box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', up); box.removeEventListener('pointercancel', up); box.removeEventListener('keydown', key); box.removeEventListener('contextmenu', noCtx); };
}
/** Odeljak u kom je stavka: data-dl-sep vrednost poslednjeg razdelnika ispred nje (ili ''). */
export function zoneOf(el) { let p = el.previousElementSibling; while (p) { if (p.matches('[data-dl-sep]')) return p.dataset.dlSep; p = p.previousElementSibling; } return ''; }
