// „Sviraj set“: set lista preko celog ekrana — veliki tekst (A−/A+, pamti se), bez menija, ekran ostaje upaljen.
// Svaka pesma u svom tonalitetu i sa svojim kapodasterom; TAB pesme kao tablatura.
// Dole: velika „‹ Prethodna“ / „Sledeća ›“ i „Sledeća: naslov · prvi akord“. Gore: naslov (dodir = spisak pesama
// za skok), skrolovanje u tempu pesme, zvuk (Pusti). Kad pesma dođe do kraja (skrolovanje/zvuk): mirno odbrojavanje
// 5 s do sledeće („Odmah“ / „Stani“). Dodir uz desnu/levu ivicu = strana dole/gore; prevlačenje = druga pesma;
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

/** Uđi u „Sviraj set“ (poziva se iz dodira korisnika, da bi ceo ekran bio dozvoljen). */
export function enterStage(setlistId, index = 0) {
  try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch {}
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
  const play = { pause: 5, scroll: false, sound: false, ...getMode(), ...(sl.play || {}) };
  const mode = { scroll: play.scroll, sound: play.sound };
  const pause = Number(play.pause ?? 5); // sekunde; 0 = odmah; -1 = čekaj mene
  const metBpm = Number(await settings.get('metBpm', 90)) || 90;

  document.body.classList.add('stage-mode');
  keepAwake('stage');
  root.innerHTML = `
  <section class="stage" aria-label="${esc(t('stage.title'))}">
    <header class="stage-bar" id="stBar">
      <button class="icon-btn" id="stExit" aria-label="${t('stage.exit')}" title="${t('stage.exit')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>
      <button class="stage-info" id="stJump" aria-label="${t('stage.jump')}"><b id="stTitle"></b><span class="small muted" id="stMeta"></span></button>
      <button class="btn small icon-only st-tog" id="stScroll" aria-pressed="false" aria-label="${t('stage.scroll')}" title="${t('stage.scroll')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v13m0 0-5-5m5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button class="btn small icon-only st-tog" id="stSound" aria-pressed="false" aria-label="${t('stage.sound')}" title="${t('stage.sound')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg></button>
      <button class="btn small icon-only" id="stDown" aria-label="${t('song.fontDown')}">A−</button>
      <button class="btn small icon-only" id="stUp" aria-label="${t('song.fontUp')}">A+</button>
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
    $('stTitle').textContent = `${i + 1}/${ids.length} · ${s.title}`;
    $('stMeta').textContent = [s.artist, capo ? t('pdf.capo', { n: capo }) : '', tuning !== 'standard' ? t('tuning.' + tuning) : ''].filter(Boolean).join(' · ');
    const next = ids[i + 1] ? all.get(ids[i + 1]) : null;
    $('stNextUp').innerHTML = next ? `<small>${esc(t('stage.nextUp', { title: '' }).replace(/[:\s]+$/, ''))}</small><b>${esc(next.title)}</b>${firstChord(next) ? `<span class="st-ch">${esc(firstChord(next))}</span>` : ''}` : `<small>${esc(t('stage.lastSong'))}</small>`;
    $('stPrev').disabled = i === 0; $('stNext').disabled = !next;
    $('stBody').innerHTML = `
      <h1 class="stage-h1">${esc(s.title)}</h1>
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
    if (mode.scroll || mode.sound) startFlow(2000);
  }
  const go = (d) => { const k = i + d; if (k < 0 || k >= ids.length) return false; i = k; draw(); return true; };
  const barH = () => $('stBar').offsetHeight;
  const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
  function pageDown() { if (atBottom()) go(1); else window.scrollBy({ top: window.innerHeight * 0.82 - barH(), behavior: 'smooth' }); }
  function pageUp() { if (window.scrollY <= 4) { if (go(-1)) requestAnimationFrame(() => window.scrollTo(0, document.documentElement.scrollHeight)); } else window.scrollBy({ top: -(window.innerHeight * 0.82 - barH()), behavior: 'smooth' }); }
  const setZoom = (d) => {
    zoom = Math.min(2.4, Math.max(0.9, +(zoom + d).toFixed(2))); setZoomPref(zoom);
    const s = all.get(ids[i]), l = root.querySelector('.stage-lyrics, .tab-staff2');
    if (!l) return;
    if (s.type === 'tab') tabView?.drawStaff(l, s.tab, { zoom: Math.max(1, zoom) });
    else { l.style.setProperty('--zoom', zoom); fitLyrics(l); layoutTabs($('stBody')); }
  };

  // ---- Tok pesme: skrolovanje u tempu (trajanje iz pesme) i/ili zvuk; na kraju odbrojavanje do sledeće ----
  let raf = 0, flowT = 0, player = null, total = 0, t0 = 0, dur = 0, countT = 0, carry = 0, lastTs = 0, gen = 0;
  async function startFlow(delay = 0) {
    stopFlow();
    const s = all.get(ids[i]), my = ++gen;
    const sp = await import('./songPlay.js');
    if (my !== gen) return;
    const tl = sp.timelineOf(s);
    const bpm = Number(s.bpm) || (s.type === 'tab' ? 66 : metBpm);
    total = tl.total;
    dur = tl.total ? (tl.total / bpm) * 60 : 120; // koliko pesma traje u svom tempu (sekunde)
    flowT = setTimeout(async () => {
      if (my !== gen) return;
      if (mode.sound && tl.events.length) {
        const { createPlayer } = await import('./songPlayer.js');
        if (my !== gen) return;
        player = createPlayer(tl, { bpm, onEnd: () => my === gen && songEnded() });
        player.play(0);
      }
      t0 = performance.now(); lastTs = 0; carry = 0;
      raf = requestAnimationFrame(step);
    }, delay);
  }
  function step(ts) {
    raf = 0;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    // kratka pesma (sve staje na ekran): nema šta da se skroluje — kraj je posle njenog trajanja (ili kraja zvuka)
    if (max <= 4 && !player && performance.now() - t0 > dur * 1000) { songEnded(); return; }
    if (max > 0) {
      if (player && total) {
        // sa zvukom: ekran prati mesto u pesmi
        const want = Math.max(0, Math.min(max, (player.beat / total) * max * 1.08 - window.innerHeight * 0.1));
        const d = want - window.scrollY;
        if (Math.abs(d) > 1) window.scrollBy(0, d * 0.06);
      } else if (mode.scroll) {
        // bez zvuka: stalna brzina, tako da pesma „traje“ koliko i u svom tempu
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
    player?.stop(); player = null;
    if ($('stCount')) $('stCount').hidden = true;
  }
  function songEnded() {
    cancelAnimationFrame(raf); raf = 0;
    player?.stop(); player = null;
    const next = ids[i + 1] ? all.get(ids[i + 1]) : null;
    if (!next) return;
    if (pause === 0) { go(1); return; }
    let n = pause;
    const wait = pause < 0; // „Čekaj mene“: kartica ostaje dok ne dodirneš „Sledeća“
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
  const tog = (key, btn) => {
    mode[key] = !mode[key]; setMode(mode);
    import('./collections.js').then((c) => c.updateSetlist(setlistId, { play: { pause, scroll: mode.scroll, sound: mode.sound } })).catch(() => {});
    btn.classList.toggle('on', mode[key]); btn.setAttribute('aria-pressed', String(mode[key]));
    if (mode.scroll || mode.sound) startFlow(300); else stopFlow();
  };
  for (const [k, b] of [['scroll', 'stScroll'], ['sound', 'stSound']]) { $(b).classList.toggle('on', mode[k]); $(b).setAttribute('aria-pressed', String(mode[k])); $(b).addEventListener('click', () => tog(k, $(b))); }

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
    try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch {}
  };
  window.addEventListener('hashchange', onHash);
  draw();
}
