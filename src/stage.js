// „Sviraj set“: set lista preko celog ekrana — veliki čitljiv tekst (A−/A+, pamti se), bez donjih tabova, ekran
// ostaje upaljen (Screen Wake Lock, ponovo posle povratka u aplikaciju). Bez Fullscreen API-ja (Chrome bi poruku
// „Za izlaz iz celog ekrana…“ prikazao preko dugmadi) i bez zvuka (Pusti ostaje na ekranu pojedinačne pesme).
// Svaka pesma u svom tonalitetu i sa svojim kapodasterom; TAB pesme kao tablatura.
// Dole: velika „‹ Prethodna“ / „Sledeća ›“ i „Sledeća: naslov · prvi akord“. Gore: naslov i izvođač (dodir = spisak
// pesama za skok), brojač, automatsko skrolovanje u tempu pesme. Kad pesma dođe do kraja: mirno odbrojavanje do
// sledeće („Odmah“ / „Stani“). Dodir uz desnu/levu ivicu = strana dole/gore; prevlačenje = druga pesma;
// Bluetooth pedala (PageDown/PageUp, strelice). Mesto u setu se pamti („Nastavi od pesme N“).
import { songs as db, settings } from './db.js';
import { getSetlist } from './collections.js';
import { t } from './i18n.js';
import { esc, dialog } from './ui.js';
import { transposeSong } from './songformat.js';
import { renderSectionsHTML, fitLyrics } from './songs.js';
import { layoutTabs } from './tabs.js';
import { keepAwake, allowSleep } from './wakelock.js';
import { cleanTuning } from './tunings.js';
import { dn } from './naming.js';

const ZOOM_KEY = 'gitara-stage-zoom';
const getZoom = () => { try { return Number(localStorage.getItem(ZOOM_KEY)) || 1.3; } catch { return 1.3; } };
const setZoomPref = (z) => { try { localStorage.setItem(ZOOM_KEY, String(z)); } catch {} };
const POS_KEY = (id) => `gitara-set-pos-${id}`;
/** Gde je set lista stala (indeks pesme) — za „Nastavi od pesme N“. */
export const savedPos = (id) => { try { return Number(localStorage.getItem(POS_KEY(id))) || 0; } catch { return 0; } };
const MODE_KEY = 'gitara-stage-mode';
const getMode = () => { try { return JSON.parse(localStorage.getItem(MODE_KEY)) || {}; } catch { return {}; } };
const setMode = (m) => { try { localStorage.setItem(MODE_KEY, JSON.stringify(m)); } catch {} };

/** Uđi u „Sviraj set“. */
export function enterStage(setlistId, index = 0) {
  location.hash = `#/nastup/${encodeURIComponent(setlistId)}?i=${index}`;
}

/** Prvi akord kako se svira (tonalitet + kapo), za „Sledeća: …“. */
function firstChord(s) {
  if (s.type === 'tab') return 'TAB';
  const shapes = transposeSong(s, (s.transpose || 0) - (s.capo || 0));
  for (const sec of shapes.sections || []) for (const l of sec.lines || []) { const c = [...(l.chords || [])].sort((a, b) => a.position - b.position)[0]; if (c) return dn(c.chord); }
  return '';
}

export async function renderStage(root, setlistId, params) {
  const sl = await getSetlist(setlistId);
  if (!sl) { location.hash = '#/pesme?tab=sl'; return; }
  // samo pesme ove set liste (ne cela biblioteka)
  const all = new Map((await Promise.all(sl.songIds.map((id) => db.get(id).catch(() => null)))).filter(Boolean).map((s) => [s.id, s]));
  const ids = sl.songIds.filter((x) => all.has(x));
  if (!ids.length) { location.hash = '#/setlista/' + encodeURIComponent(setlistId); return; }
  let i = Math.max(0, Math.min(ids.length - 1, Number(params.get('i')) || 0));
  let zoom = getZoom();
  // izbor pre početka (pamti se uz set listu); dugmad gore ga menjaju dok svira
  const play = { pause: 5, scroll: false, ...getMode(), ...(sl.play || {}) };
  const mode = { scroll: !!play.scroll };
  const pause = Number(play.pause ?? 5); // sekunde; 0 = odmah; -1 = čekaj mene
  const metBpm = Number(await settings.get('metBpm', 90)) || 90;

  document.body.classList.add('stage-mode');
  keepAwake('stage');
  root.innerHTML = `
  <section class="stage" aria-label="${esc(t('stage.title'))}">
    <header class="stage-bar" id="stBar">
      <button class="icon-btn" id="stExit" aria-label="${t('stage.exit')}" title="${t('stage.exit')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>
      <button class="stage-info" id="stJump" aria-label="${t('stage.jump')}"><b id="stTitle"></b><span><span class="st-counter" id="stCounter"></span><span id="stMeta"></span></span></button>
      <button class="st-tool st-tog" id="stScroll" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="st-play" d="M7 4.5v9l7-4.5z"/><path d="M5 17.5l7 3.5 7-3.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <span class="st-zoom"><button class="st-tool" id="stAa" aria-haspopup="true" aria-expanded="false" aria-label="${t('song.textSize')}">Aa</button>
        <span class="st-zoom-pop" id="stAaPop" role="group" aria-label="${t('song.textSize')}" hidden><button class="st-tool" id="stDown" aria-label="${t('song.fontDown')}">A−</button><button class="st-tool" id="stUp" aria-label="${t('song.fontUp')}">A+</button></span></span>
    </header>
    <div class="stage-body" id="stBody"></div>
    <footer class="stage-foot" id="stFoot">
      <button class="btn big st-prev" id="stPrev" data-go="prev">‹ ${t('stage.prevBtn')}</button>
      <span class="st-next-up" id="stNextUp"></span>
      <button class="btn big primary st-next" id="stNext" data-go="next">${t('stage.nextBtn')} ›</button>
    </footer>
    <div class="st-count" id="stCount" hidden><div class="card"><p class="small muted" id="stCountTitle"></p><b id="stCountN"></b><p id="stCountSong"></p>
      <div class="row"><button class="btn" id="stHold">${t('stage.hold')}</button><button class="btn primary" id="stNow">${t('stage.now')}</button></div></div></div>
  </section>`;
  const $ = (q) => root.querySelector('#' + q);
  let tabView = null;

  function draw() {
    stopFlow();
    const s = all.get(ids[i]);
    const capo = s.capo || 0;
    const tuning = cleanTuning(s.tuning);
    const shapes = s.type === 'tab' ? s : transposeSong(s, (s.transpose || 0) - capo);
    $('stTitle').textContent = s.title;
    $('stMeta').textContent = [s.artist, capo ? t('pdf.capo', { n: capo }) : '', tuning !== 'standard' ? t('tuning.' + tuning) : ''].filter(Boolean).join(' · ');

    $('stCounter').textContent = `${i + 1}/${ids.length}`;
    $('stCounter').setAttribute('aria-label', t('stage.counter', { i: i + 1, n: ids.length }));
    const next = ids[i + 1] ? all.get(ids[i + 1]) : null;
    $('stNextUp').innerHTML = next ? `<small>${esc(t('stage.nextUp', { title: '' }).replace(/[:\s]+$/, ''))}</small><b>${esc(next.title)}</b>${firstChord(next) ? `<span class="st-ch">${esc(firstChord(next))}</span>` : ''}` : `<small>${esc(t('stage.lastSong'))}</small>`;
    $('stPrev').disabled = i === 0; $('stNext').disabled = !next;
    $('stBody').innerHTML = `
      <div class="lyrics stage-lyrics" style="--zoom:${zoom}">${s.type === 'tab' ? '' : renderSectionsHTML(shapes.sections)}</div>
      <div class="stage-end">${next ? '' : `<p class="muted center">${t('stage.end')}</p>`}</div>`;
    if (s.type === 'tab') {
      const l = root.querySelector('.stage-lyrics');
      l.className = 'tab-staff2';
      (tabView ? Promise.resolve(tabView) : import('./tabView.js').then((m) => (tabView = m))).then((tv) => { if (all.get(ids[i]) === s) tv.drawStaff(l, s.tab, { zoom: Math.max(1, zoom) }); });
    } else {
      fitLyrics(root.querySelector('.stage-lyrics'));
      layoutTabs($('stBody'));
    }
    window.scrollTo(0, 0);
    try { localStorage.setItem(POS_KEY(setlistId), String(i)); } catch {}
    history.replaceState(null, '', `#/nastup/${encodeURIComponent(setlistId)}?i=${i}`);
    if (mode.scroll) startFlow(2000);
    padFoot();
  }
  // tekst nikad ne ostaje ispod donje trake: dno stranice = visina trake + bezbedna zona (meri se, menja se sa A−/A+)
  const padFoot = () => { const h = $('stFoot')?.offsetHeight || 0; root.querySelector('.stage')?.style.setProperty('--st-foot', h + 'px'); };
  const go = (d) => { const k = i + d; if (k < 0 || k >= ids.length) return false; i = k; draw(); return true; };
  const barH = () => $('stBar').offsetHeight;
  // kraj pesme = poslednji red je vidljiv iznad donje trake (stranica ima dodatni prostor ispod, da se poslednji red vidi)
  const endVisible = () => { const e = root.querySelector('.stage-end'); const f = $('stFoot'); return !e || e.getBoundingClientRect().top <= (f ? f.getBoundingClientRect().top : window.innerHeight) + 2; };
  const atBottom = () => endVisible() || window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
  function pageDown() { if (atBottom()) go(1); else window.scrollBy({ top: window.innerHeight * 0.82 - barH(), behavior: 'smooth' }); }
  function pageUp() { if (window.scrollY <= 4) { if (go(-1)) requestAnimationFrame(() => window.scrollTo(0, document.documentElement.scrollHeight)); } else window.scrollBy({ top: -(window.innerHeight * 0.82 - barH()), behavior: 'smooth' }); }
  const setZoom = (d) => {
    zoom = Math.min(2.4, Math.max(0.9, +(zoom + d).toFixed(2))); setZoomPref(zoom);
    const s = all.get(ids[i]), l = root.querySelector('.stage-lyrics, .tab-staff2');
    if (!l) return;
    if (s.type === 'tab') tabView?.drawStaff(l, s.tab, { zoom: Math.max(1, zoom) });
    else { l.style.setProperty('--zoom', zoom); fitLyrics(l); layoutTabs($('stBody')); }
    padFoot();
  };

  // ---- Tok pesme: skrolovanje u tempu (trajanje iz pesme) i/ili zvuk; na kraju odbrojavanje do sledeće ----
  let t0Fits = false, raf = 0, flowT = 0, t0 = 0, dur = 0, countT = 0, carry = 0, lastTs = 0, gen = 0;
  async function startFlow(delay = 0) {
    stopFlow();
    const s = all.get(ids[i]), my = ++gen;
    const sp = await import('./songPlay.js');
    if (my !== gen) return;
    const tl = sp.timelineOf(s);
    const bpm = Number(s.bpm) || (s.type === 'tab' ? 66 : metBpm);
    dur = tl.total ? (tl.total / bpm) * 60 : 120; // koliko pesma traje u svom tempu (sekunde)
    flowT = setTimeout(() => {
      if (my !== gen) return;
      t0 = performance.now(); lastTs = 0; carry = 0; t0Fits = window.scrollY <= 4 && endVisible();
      raf = requestAnimationFrame(step);
    }, delay);
  }
  function step(ts) {
    raf = 0;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    // kratka pesma (sve staje na ekran): nema šta da se skroluje — kraj je posle njenog trajanja (ili kraja zvuka)
    const fits = t0Fits; // cela pesma je stala na ekran pri početku: nema šta da se skroluje — kraj posle njenog trajanja
    if (fits && performance.now() - t0 > dur * 1000) { songEnded(); return; }
    if (!fits && max > 0) {
      if (mode.scroll) {
        // stalna brzina, tako da pesma „traje“ koliko i u svom tempu
        const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
        carry += (max / Math.max(20, dur)) * dt;
        if (carry >= 1) { const px = Math.floor(carry); carry -= px; window.scrollBy(0, px); }
        if (atBottom() && performance.now() - t0 > 3000) { songEnded(); return; }
      }
    }
    lastTs = ts;
    raf = requestAnimationFrame(step);
  }
  function stopFlow() {
    gen++;
    clearTimeout(flowT); cancelAnimationFrame(raf); raf = 0; clearInterval(countT);
    if ($('stCount')) $('stCount').hidden = true;
  }
  function songEnded() {
    cancelAnimationFrame(raf); raf = 0;
    const next = ids[i + 1] ? all.get(ids[i + 1]) : null;
    if (!next) return;
    if (pause === 0) { go(1); return; }
    let n = pause;
    const wait = pause < 0; // „Čekaj me“: kartica ostaje dok ne dodirneš „Sledeća“
    $('stCountTitle').textContent = wait ? t('stage.songEnded') : t('stage.countdown', { n: '' }).trim();
    $('stCountN').textContent = wait ? '' : String(n);
    $('stCountN').hidden = wait;
    $('stCountSong').textContent = (wait ? t('stage.nextUp', { title: '' }) : '') + [next.title, firstChord(next)].filter(Boolean).join(' · ');
    $('stNow').textContent = wait ? t('stage.nextBtn') + ' ›' : t('stage.now');
    $('stCount').hidden = false;
    clearInterval(countT);
    if (!wait) countT = setInterval(() => { n--; $('stCountN').textContent = String(n); if (n <= 0) { clearInterval(countT); go(1); } }, 1000);
  }
  $('stNow').addEventListener('click', () => { clearInterval(countT); go(1); });
  $('stHold').addEventListener('click', () => { clearInterval(countT); $('stCount').hidden = true; });
  // Automatsko skrolovanje: narandžasto = uključeno, sivo = isključeno (i za čitač ekrana)
  const showScroll = () => {
    const b = $('stScroll'), on = mode.scroll;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    const label = t(on ? 'stage.scrollOn' : 'stage.scrollOff');
    b.setAttribute('aria-label', label); b.title = label;
  };
  $('stScroll').addEventListener('click', () => {
    mode.scroll = !mode.scroll; setMode(mode);
    import('./collections.js').then((c) => c.updateSetlist(setlistId, { play: { pause, scroll: mode.scroll } })).catch(() => {});
    showScroll();
    if (mode.scroll) startFlow(300); else stopFlow();
  });
  showScroll();

  // Aa: veličina teksta (A− / A+) u malom meniju — zaglavlje ostaje čisto, naslov ima mesta
  const aaOpen = (on) => { $('stAaPop').hidden = !on; $('stAa').setAttribute('aria-expanded', String(on)); $('stAa').classList.toggle('on', on); };
  $('stAa').addEventListener('click', (e) => { e.stopPropagation(); aaOpen($('stAaPop').hidden); });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.st-zoom') && $('stAaPop')) aaOpen(false); }, { capture: true });
  $('stDown').addEventListener('click', () => setZoom(-0.1));
  $('stUp').addEventListener('click', () => setZoom(0.1));
  $('stExit').addEventListener('click', () => { location.hash = '#/setlista/' + encodeURIComponent(setlistId); });
  $('stJump').addEventListener('click', async () => {
    const p = dialog({
      title: t('stage.jump'), html: true,
      body: `<ol class="st-jump">${ids.map((id, k) => `<li><button class="btn wide${k === i ? ' primary' : ''}" data-k="${k}">${k + 1}. ${esc(all.get(id).title)}</button></li>`).join('')}</ol>`,
      buttons: [{ label: t('common.close'), value: null }],
    });
    const modal = [...document.querySelectorAll('.modal-backdrop')].pop();
    modal.querySelector('.st-jump').addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      i = +b.dataset.k;
      modal.__close?.(); // zatvori spisak
      draw();
    });
    await p;
  });
  $('stFoot').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b && !b.disabled) go(b.dataset.go === 'next' ? 1 : -1); });

  // Dodir: ivice listaju strane, sredina sakriva/prikazuje trake. Prevlačenje: druga pesma.
  let sx = 0, sy = 0, st = 0;
  $('stBody').addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; st = performance.now(); });
  $('stBody').addEventListener('pointerup', (e) => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50 && performance.now() - st < 700) go(dx < 0 ? 1 : -1);
  });
  $('stBody').addEventListener('click', (e) => {
    if (e.target.closest('button, a')) return;
    const x = e.clientX / window.innerWidth;
    if (x > 0.78) pageDown(); else if (x < 0.22) pageUp(); else root.querySelector('.stage').classList.toggle('bar-hidden');
  });
  const onKey = (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // pedala koja se drži šalje ponavljanja — jedan pritisak = jedan korak
    if (e.repeat && ['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', ' '].includes(e.key)) { e.preventDefault(); return; }
    // v1.68: Shift + → / ← (ili N / P) = sledeća / prethodna pesma odmah
    if ((e.shiftKey && e.key === 'ArrowRight') || e.key === 'n' || e.key === 'N') { e.preventDefault(); go(1); return; }
    if ((e.shiftKey && e.key === 'ArrowLeft') || e.key === 'p' || e.key === 'P') { e.preventDefault(); go(-1); return; }
    if (e.key === 'Home') { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (['PageDown', 'ArrowDown', 'ArrowRight', ' '].includes(e.key)) { e.preventDefault(); pageDown(); }
    else if (['PageUp', 'ArrowUp', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); pageUp(); }
    else if (e.key === 'Escape') $('stExit').click();
  };
  document.addEventListener('keydown', onKey);
  const onHash = () => {
    if (location.hash.startsWith('#/nastup/')) return;
    stopFlow();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onHash);
    document.body.classList.remove('stage-mode');
    allowSleep('stage');
    window.removeEventListener('resize', padFoot);
  };
  window.addEventListener('resize', padFoot);
  window.addEventListener('hashchange', onHash);
  draw();
}
