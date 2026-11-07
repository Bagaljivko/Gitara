// „Uz video“: pesma prati YouTube video. Traka gore (video + −10 / pauza / +10 / ✕), pesma se sama pomera po
// vremenu videa (pauza = stoji, skok = skače). Bez ručnog podešavanja: na početku ravnomerno kroz ceo video; kad
// korisnik prstom pomeri pesmu na pravo mesto, to se pamti kao tačka („ovde je ovaj trenutak videa“) i pesma ide
// dalje istim ritmom; od dve tačke na dalje brzina se računa između njih. Tačke se čuvaju uz pesmu (ytSync).
// Prevlačenje prstom preko videa levo-desno premotava (cela širina videa ≈ 60 s), dodir = pauza/pusti.
import { t } from './i18n.js';
import { esc, toast } from './ui.js';
import { keepAwake, allowSleep } from './wakelock.js';
import { youtubeId } from './songformat.js';

export const YT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.6 2.6 0 0 0 2.4 7.2 27 27 0 0 0 2 12a27 27 0 0 0 .4 4.8 2.6 2.6 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8A27 27 0 0 0 22 12a27 27 0 0 0-.4-4.8zM10 15V9l5.2 3z"/></svg>';
const I = {
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>',
  back: '<path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/><text x="12" y="16.2" font-size="6.5" font-weight="800" text-anchor="middle" font-family="system-ui">10</text>',
  fwd: '<path d="M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/><text x="12" y="16.2" font-size="6.5" font-weight="800" text-anchor="middle" font-family="system-ui">10</text>',
  x: '<path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>`;
const SCRUB_SPAN = 60; // s: prevlačenje preko cele širine videa
const HOLD_MS = 1000;  // posle ručnog pomeranja: ovoliko mira, pa se pamti tačka i nastavlja praćenje

// ---------------- Usklađivanje (čiste funkcije, testirane) ----------------
/** Deo pesme (0–1) u trenutku t videa dužine dur, po tačkama [{ t, f }]. */
export function posAt(time, dur, anchors = []) {
  const r0 = dur > 0 ? 1 / dur : 0;
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const a = anchors;
  if (!a.length) return clamp(time * r0);
  const slope = (p, q) => { const s = (q.f - p.f) / (q.t - p.t); return Number.isFinite(s) && s > r0 / 4 && s < r0 * 4 ? s : r0; };
  if (time <= a[0].t) return clamp(a[0].f - (a.length > 1 ? slope(a[0], a[1]) : r0) * (a[0].t - time));
  for (let i = 0; i < a.length - 1; i++) {
    if (time < a[i + 1].t) return clamp(a[i].f + (a[i + 1].f - a[i].f) * (time - a[i].t) / (a[i + 1].t - a[i].t));
  }
  const n = a.length - 1;
  return clamp(a[n].f + (n > 0 ? slope(a[n - 1], a[n]) : r0) * (time - a[n].t));
}
/** Nova tačka: zamenjuje bliske (±3 s) i one koje joj protivreče (ranije vreme, a dalje u pesmi — i obrnuto). */
export function addAnchor(list, time, f) {
  const p = { t: Math.round(time * 10) / 10, f: Math.round(Math.max(0, Math.min(1, f)) * 10000) / 10000 };
  const out = list.filter((x) => Math.abs(x.t - p.t) >= 3 && !(x.t < p.t && x.f >= p.f) && !(x.t > p.t && x.f <= p.f));
  out.push(p);
  out.sort((x, y) => x.t - y.t);
  while (out.length > 40) out.splice(out.length > 2 ? 1 : 0, 1); // najstarije u sredini ne treba toliko
  return out;
}
const fromStore = (ys, id) => (ys && ys.v === id && Array.isArray(ys.a) ? ys.a.map(([t, f]) => ({ t, f })) : []);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------------- YouTube IFrame API (učitava se tek kad zatreba) ----------------
let ytPromise = null;
function loadYT() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytPromise) return ytPromise;
  ytPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (typeof prev === 'function') try { prev(); } catch {} resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => { ytPromise = null; reject(new Error('yt-api')); };
    document.head.appendChild(s);
    setTimeout(() => { if (!(window.YT && window.YT.Player)) { ytPromise = null; reject(new Error('yt-timeout')); } }, 15000);
  });
  return ytPromise;
}

// ---------------- Dugme „Uz video“ ----------------
export function paButtonHTML(stored) {
  const on = !!youtubeId(stored.yt && stored.yt.listen);
  return `<div class="pa-row"><button class="pa-btn${on ? '' : ' off'}" id="paBtn" type="button" aria-label="${esc(t(on ? 'pa.start' : 'pa.link'))}">${YT_ICON}<span>${esc(t('pa.btn'))}</span></button></div>`;
}

let active = null; // trenutno otvorena traka (najviše jedna)
export const playAlongOpen = () => !!active;

/**
 * root: ekran pesme; content(): element sa tekstom/tablaturom (po njemu se meri položaj);
 * beforeStart(): zaustavi drugo (automatsko listanje, petlju, „Pusti“).
 */
export function bindPlayAlong({ root, stored, save, content, beforeStart = () => {} }) {
  const btn = root.querySelector('#paBtn');
  const refresh = () => {
    if (!btn) return;
    const on = !!youtubeId(stored.yt && stored.yt.listen);
    btn.classList.toggle('off', !on);
    btn.setAttribute('aria-label', t(on ? 'pa.start' : 'pa.link'));
  };
  async function link() {
    const { ytAction } = await import('./ytPick.js');
    await ytAction('listen', stored, save, { change: true, open: false });
    refresh();
  }
  btn?.addEventListener('click', () => {
    if (!youtubeId(stored.yt && stored.yt.listen)) { link(); return; }
    openStrip({ stored, save, content, beforeStart, relink: link });
  });
  return { refresh, link, close: () => active?.close() };
}

// ---------------- Traka ----------------
function openStrip({ stored, save, content, beforeStart, relink }) {
  if (active) active.close();
  const id = youtubeId(stored.yt && stored.yt.listen);
  if (!id) return;
  try { beforeStart(); } catch {}
  window.dispatchEvent(new Event('gitara-mic')); // „Pusti“ i slični zvuci staju — svira video

  const el = document.createElement('div');
  el.className = 'pa-strip';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', t('pa.btn'));
  el.innerHTML = `<div class="pa-vid"><div class="pa-player"></div><div class="pa-touch" aria-hidden="true"></div><div class="pa-tip"></div></div>
    <div class="pa-ctl">
      <button class="pa-b" data-pa="back" type="button" aria-label="${esc(t('pa.back10'))}">${svg('back')}</button>
      <button class="pa-b pa-play" data-pa="play" type="button" aria-label="${esc(t('pa.play'))}">${svg('play')}</button>
      <button class="pa-b" data-pa="fwd" type="button" aria-label="${esc(t('pa.fwd10'))}">${svg('fwd')}</button>
    </div>
    <button class="pa-x" data-pa="close" type="button" aria-label="${esc(t('pa.close'))}">${svg('x')}</button>`;
  const q = (s) => el.querySelector(s);
  // pesma ostaje na istom mestu dok se raspored menja (traka ulazi / izlazi)
  const keepPlace = (fn) => { const c = content(); const before = c ? c.getBoundingClientRect().top : 0; fn(); const after = c ? c.getBoundingClientRect().top : 0; if (c) window.scrollBy(0, after - before); };
  keepPlace(() => { document.body.appendChild(el); document.body.classList.add('pa-on'); });
  keepAwake('playalong');

  let player = null, ready = false, playing = false, dur = 0, raf = 0, closed = false;
  let anchors = fromStore(stored.ytSync, id);
  let lastT = 0, lastWall = 0, lastRead = -1;
  let user = false, holdTimer = 0, userStartY = 0, progScroll = 0;

  const setPlayIcon = () => { const b = q('[data-pa="play"]'); b.innerHTML = svg(playing ? 'pause' : 'play'); b.setAttribute('aria-label', t(playing ? 'pa.pause' : 'pa.play')); };
  // vreme videa: YouTube javlja vreme na ~250 ms — između toga se računa samo (glatko listanje)
  const now = () => {
    if (!ready) return 0;
    const v = player.getCurrentTime() || 0;
    const w = performance.now();
    if (v !== lastRead) { lastRead = v; lastT = v; lastWall = w; return v; }
    return playing ? lastT + (w - lastWall) / 1000 * (player.getPlaybackRate?.() || 1) : lastT;
  };
  // geometrija: „linija čitanja“ (gde treba da bude trenutno mesto pesme) — malo ispod trake
  const geo = () => {
    const c = content(); if (!c) return null;
    const r = c.getBoundingClientRect(), s = el.getBoundingClientRect();
    const column = s.height > window.innerHeight * 0.6; // položeno: traka je kolona levo
    const top = column ? 0 : s.bottom;
    const line = top + (window.innerHeight - top) * 0.28;
    return { docTop: r.top + window.scrollY, h: Math.max(1, r.height), line };
  };
  const fNow = () => { const g = geo(); return g ? (window.scrollY + g.line - g.docTop) / g.h : 0; };
  const yFor = (f) => { const g = geo(); return g ? g.docTop + f * g.h - g.line : window.scrollY; };

  function tick() {
    raf = requestAnimationFrame(tick);
    if (!ready || user || !dur) return;
    const target = Math.max(0, Math.min(document.documentElement.scrollHeight - window.innerHeight, yFor(posAt(now(), dur, anchors))));
    const d = target - window.scrollY;
    if (Math.abs(d) < 0.6) return;
    progScroll = performance.now();
    window.scrollTo(0, Math.abs(d) > window.innerHeight * 1.2 ? target : window.scrollY + d * 0.16);
  }

  // ručno pomeranje pesme = ispravka usklađivanja
  const onTouchStart = (e) => { if (el.contains(e.target) || e.target.closest?.('.modal-backdrop')) return; startHold(); };
  const onWheel = (e) => { if (el.contains(e.target)) return; startHold(); armRelease(); };
  const onTouchEnd = (e) => { if (user && !el.contains(e.target)) armRelease(); };
  const onScroll = () => { if (user && holdTimer) armRelease(); }; // zaleteo se — čekaj da stane
  function startHold() { if (!user) { user = true; userStartY = window.scrollY; } clearTimeout(holdTimer); holdTimer = 0; }
  function armRelease() {
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      holdTimer = 0; user = false;
      if (!ready || !dur || Math.abs(window.scrollY - userStartY) < 12) return; // samo dodir, bez pomeranja
      anchors = addAnchor(anchors, now(), fNow());
      stored.ytSync = { v: id, a: anchors.map((a) => [a.t, a.f]) };
      Promise.resolve(save()).catch(() => {});
      toast(t('pa.synced'));
    }, HOLD_MS);
  }
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
  document.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });

  // dugmad
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pa]'); if (!b) return;
    const k = b.dataset.pa;
    if (k === 'close') { close(); return; }
    if (!ready) return;
    if (k === 'play') { if (playing) player.pauseVideo(); else player.playVideo(); }
    if (k === 'back' || k === 'fwd') seek(now() + (k === 'back' ? -10 : 10));
  });
  function seek(s) { s = Math.max(0, Math.min(dur ? dur - 0.5 : s, s)); player.seekTo(s, true); lastRead = -1; lastT = s; lastWall = performance.now(); }

  // prevlačenje preko videa = premotavanje (uživo), dodir = pauza/pusti
  const touch = q('.pa-touch'), tip = q('.pa-tip');
  let drag = null;
  touch.addEventListener('pointerdown', (e) => { if (!ready) return; try { touch.setPointerCapture(e.pointerId); } catch {} drag = { x: e.clientX, t: now(), moved: false, last: 0, target: null }; });
  touch.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 8) return;
    drag.moved = true;
    const w = touch.getBoundingClientRect().width || 150;
    drag.target = Math.max(0, Math.min(dur || 1e9, drag.t + (dx / w) * SCRUB_SPAN));
    tip.textContent = fmt(drag.target);
    const n = performance.now();
    if (n - drag.last > 140) { drag.last = n; seek(drag.target); }
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.moved) { if (drag.target != null) seek(drag.target); }
    else if (playing) player.pauseVideo(); else player.playVideo();
    drag = null; tip.textContent = '';
  };
  touch.addEventListener('pointerup', endDrag);
  touch.addEventListener('pointercancel', () => { drag = null; tip.textContent = ''; });

  const onRoute = () => close();
  window.addEventListener('hashchange', onRoute);

  function close() {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf); clearTimeout(holdTimer);
    document.removeEventListener('touchstart', onTouchStart); document.removeEventListener('touchend', onTouchEnd);
    document.removeEventListener('wheel', onWheel); window.removeEventListener('scroll', onScroll);
    window.removeEventListener('hashchange', onRoute);
    try { player && player.destroy(); } catch {}
    keepPlace(() => { el.remove(); document.body.classList.remove('pa-on'); });
    allowSleep('playalong');
    if (active === api) active = null;
  }
  const api = { close };
  active = api;

  loadYT().then((YT) => {
    if (closed) return;
    player = new YT.Player(q('.pa-player'), {
      width: '100%', height: '100%', videoId: id,
      playerVars: { playsinline: 1, controls: 0, disablekb: 1, rel: 0, modestbranding: 1, fs: 0, iv_load_policy: 3, autoplay: 1, origin: location.origin },
      events: {
        onReady: () => {
          if (closed) return;
          ready = true; dur = player.getDuration() || 0;
          try { player.playVideo(); } catch {}
          raf = requestAnimationFrame(tick);
          try { if (!localStorage.getItem('gitara-pa-tip')) { localStorage.setItem('gitara-pa-tip', '1'); toast(t('pa.tip')); } } catch {}
        },
        onStateChange: (e) => {
          playing = e.data === 1;
          if (!dur) dur = player.getDuration() || 0;
          lastRead = -1;
          setPlayIcon();
        },
        onError: (e) => {
          const blocked = e.data === 101 || e.data === 150 || e.data === 100 || e.data === 2;
          close();
          toast(t(blocked ? 'pa.blocked' : 'pa.failed'), 'error');
          if (blocked) relink();
        },
      },
    });
  }).catch(() => { close(); toast(t('pa.noNet'), 'error'); });
  return api;
}
