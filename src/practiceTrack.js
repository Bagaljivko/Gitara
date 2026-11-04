// Vežbe: zajednička „staza“ (u stilu Guitar Hero-a), položeni ekran — bez celog ekrana i bez zaključavanja.
// Vodoravni vrat gitare, žice kao kad gledaš svoju gitaru dok sviraš (debela E gore, tanka e dole).
// Note (i blokovi akorda / udarci) klize zdesna nalevo do svetle linije. Nota pokazuje samo prag;
// boja note je prst: 1 plavo, 2 žuto, 3 roze, 4 ljubičasto, 0 (prazna žica) belo.
// Pogodak/promašaj = zeleni/crveni prsten oko note (boja note se ne menja).
// Dole desno: providna leva ruka sa obojenim vrhovima prstiju (podsetnik; prst za sledeću notu svetli).
// Crta se na jednom <canvas>-u (requestAnimationFrame) — lagano i za slabije telefone.
//
// runTrack(): zajednički tok runde za sve igre na stazi —
//   „Normalno“: metronom, odbrojavanje 3-2-1, ocena rano/kasno, promašaji;
//   „Početnik“: staza stane na liniji kod svake note i čeka da je odsviraš (bez tempa i promašaja);
//   telefon uspravno usred runde → pauza i „Okreni telefon“; položeno → novo odbrojavanje i nastavak;
//   demo: igra sama „svira“ (zvuk + zelene note), bez mikrofona.
import { audioCtx } from './synth.js';
import { OPEN_MIDI, noteLabel, FINGER_COLORS } from './practiceBoard.js';
import { Metronome } from './rhythm.js';
import { judgeTiming, getLatency } from './practiceListen.js';
import { dn } from './naming.js';
import { getVoicings } from './chords.js';

const C = { bg: '#07080a', wood: '#120d09', str: '#b9bdc4', accent: '#f5a524', ok: '#3dd68c', danger: '#ff6b6b', muted: '#9aa1ad' };
const INK = '#0b0c10';
const portraitMq = () => window.matchMedia('(orientation: portrait)');

// Kratak „cink“ za pogodak: kraći od 90 ms, pa ga mikrofon ne računa kao trzaj (vidi practiceListen.js)
export function hitSound() {
  try {
    const c = audioCtx(), t0 = c.currentTime + 0.005;
    for (const [f, g] of [[1568, 0.07], [2349, 0.035]]) {
      const o = c.createOscillator(), a = c.createGain();
      o.type = 'sine'; o.frequency.value = f;
      a.gain.setValueAtTime(0.0001, t0);
      a.gain.exponentialRampToValueAtTime(g, t0 + 0.004);
      a.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
      o.connect(a).connect(c.destination);
      o.start(t0); o.stop(t0 + 0.08);
    }
  } catch {}
}

// Leva ruka (šaka odozgo, prsti nagore; palac desno). Vrhovi prstiju u bojama, sa brojem 1–4.
const TIPS = { 1: [76.5, 25], 2: [58.5, 17], 3: [40.5, 23], 4: [22.5, 39] };
const HAND_SVG = `<svg viewBox="0 0 100 124" aria-hidden="true">
  <g class="h-skin">
    <rect x="14" y="62" width="72" height="56" rx="20"/>
    <rect x="15" y="31" width="15" height="44" rx="7.5"/><rect x="33" y="15" width="15" height="60" rx="7.5"/>
    <rect x="51" y="9" width="15" height="66" rx="7.5"/><rect x="69" y="17" width="15" height="58" rx="7.5"/>
    <rect x="82" y="60" width="14" height="40" rx="7" transform="rotate(-38 89 80)"/>
  </g>
  ${Object.entries(TIPS).map(([f, [x, y]]) => `<g class="h-tip" data-f="${f}"><circle cx="${x}" cy="${y}" r="8.6" style="fill:${FINGER_COLORS[f]};color:${FINGER_COLORS[f]}"/><text x="${x}" y="${y + 3.4}" text-anchor="middle">${f}</text></g>`).join('')}
</svg>`;

/** Napravi stazu preko celog prozora (aplikacija ostaje u svom prozoru; bez celog ekrana). */
export function createTrack({ t, onExit, lookBeats = 4.5 }) {
  const el = document.createElement('div');
  el.className = 'trk';
  el.innerHTML = `
    <div class="trk-top">
      <button class="trk-x" aria-label="${t('pr.trk.exit')}">✕</button>
      <div class="trk-prog" aria-hidden="true"><i></i></div>
      <div class="trk-combo"><b>0</b><small>${t('pr.trk.combo')}</small></div>
      <div class="trk-meter" aria-hidden="true"><span class="pr-lvl"><i></i></span><span class="trk-heard"></span></div>
    </div>
    <div class="trk-lyric" aria-live="polite"></div>
    <div class="trk-lane">
      <div class="trk-cw"><canvas></canvas><div class="trk-big"></div><div class="trk-pop"></div></div>
      <div class="trk-side"><div class="trk-hand">${HAND_SVG}</div></div>
    </div>
    <div class="trk-cap" aria-live="polite"></div>
    <div class="trk-res" hidden></div>
    <div class="trk-rotate"><div class="trk-phone" aria-hidden="true"><i></i></div><b>${t('pr.trk.rotate')}</b><small>${t('pr.trk.rotateWhy')}</small>
      <small class="trk-rot-hint" hidden>${t('pr.trk.autoRotate')}</small>
      <button class="btn small trk-x2">${t('pr.trk.exit')}</button></div>`;
  document.body.appendChild(el);
  document.body.classList.add('trk-open');
  const q = (s) => el.querySelector(s);
  const cv = q('canvas'), ctx = cv.getContext('2d');
  const exit = () => onExit?.();
  q('.trk-x').addEventListener('click', exit);
  q('.trk-x2').addEventListener('click', exit);

  let items = [], grid = null, beatMs = 1000, raf = 0, W = 0, H = 0, dpr = 1, combo = 0, maxCombo = 0, alive = true;
  let clock = () => performance.now();
  const rings = []; // { it, at, kind } — prsten oko note (pogodak/promašaj)

  // „Okreni telefon“: posle nekoliko sekundi uspravno — savet za automatsko rotiranje
  const mq = portraitMq();
  let rotT = 0;
  const orientSubs = new Set();
  function onMq() {
    clearTimeout(rotT);
    q('.trk-rot-hint').hidden = true;
    if (mq.matches) rotT = setTimeout(() => { q('.trk-rot-hint').hidden = false; }, 4000);
    orientSubs.forEach((fn) => fn(mq.matches));
  }
  mq.addEventListener('change', onMq);
  onMq();

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(cv);

  const current = () => items.find((it) => !it.state && !it.deco);
  function glowFill(color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; ctx.fillStyle = color; }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function draw() {
    if (!alive) return;
    raf = requestAnimationFrame(draw);
    if (!W || !H) { resize(); if (!W) return; }
    const now = clock(), real = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    const padY = Math.max(8, H * 0.05), gutter = 28, laneH = (H - 2 * padY) / 6;
    const hitX = gutter + Math.max(48, W * 0.12), ppb = (W - hitX) / lookBeats;
    const y = (s) => padY + (s + 0.5) * laneH;
    const xOf = (at) => hitX + ((at - now) / beatMs) * ppb;
    const r = Math.max(9, Math.min(laneH * 0.42, 24));
    ctx.fillStyle = C.wood; ctx.fillRect(gutter, padY, W - gutter, H - 2 * padY);
    // otkucaji (takt jače) — klize zajedno sa notama
    if (grid) {
      const first = Math.floor((now - grid.t0) / beatMs) - 2, last = first + lookBeats + 4;
      for (let b = first; b <= last; b++) {
        const x = xOf(grid.t0 + b * beatMs);
        if (x < gutter || x > W) continue;
        const acc = ((b % 4) + 4) % 4 === 0;
        ctx.fillStyle = acc ? 'rgba(236,238,242,.2)' : 'rgba(236,238,242,.07)';
        ctx.fillRect(x - (acc ? 1.5 : 0.75), padY, acc ? 3 : 1.5, H - 2 * padY);
      }
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let s = 0; s < 6; s++) {
      ctx.fillStyle = C.str; ctx.globalAlpha = 0.7;
      const th = 3.2 - s * 0.42;
      ctx.fillRect(gutter, y(s) - th / 2, W - gutter, th);
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.muted; ctx.font = `700 ${Math.round(Math.min(15, laneH * 0.42))}px system-ui, sans-serif`;
      ctx.fillText(s === 5 ? dn('E').toLowerCase() : noteLabel(OPEN_MIDI[s]), gutter / 2, y(s));
    }
    // linija pogotka
    const g = ctx.createLinearGradient(hitX - 14, 0, hitX + 14, 0);
    g.addColorStop(0, 'rgba(245,165,36,0)'); g.addColorStop(0.5, 'rgba(245,165,36,.3)'); g.addColorStop(1, 'rgba(245,165,36,0)');
    ctx.fillStyle = g; ctx.fillRect(hitX - 14, padY, 28, H - 2 * padY);
    ctx.fillStyle = C.accent; ctx.fillRect(hitX - 1.5, padY, 3, H - 2 * padY);
    for (let s = 0; s < 6; s++) {
      ctx.beginPath(); ctx.arc(hitX, y(s), r, 0, Math.PI * 2);
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(236,238,242,.2)'; ctx.stroke();
    }
    const cur = current();
    const alphaOf = (it) => (it.state === 'miss' ? Math.max(0, 1 - (real - it.doneAt) / 700) : it.state === 'hit' ? Math.max(0, 1 - (real - it.doneAt) / 260) : 1);

    // obojena nota (samo prag), blagi sjaj
    function noteDot(x, yy, f, finger, a, big = 1) {
      const col = FINGER_COLORS[finger] || FINGER_COLORS[0], rr = r * big;
      ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(x, yy, rr, 0, Math.PI * 2);
      glowFill(col, 9); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = INK; ctx.font = `800 ${Math.round(rr * 1.05)}px system-ui, sans-serif`;
      ctx.fillText(String(f), x, yy + 1);
      ctx.globalAlpha = 1;
    }

    for (const it of items) {
      const a = it.deco ? 0.9 : alphaOf(it);
      if (a <= 0) continue;
      const x = xOf(it.at);
      const x1 = it.dur ? xOf(it.at + it.dur * beatMs) : x;
      if (x1 < -r || x > W + r) continue;
      const isCur = it === cur;
      if (it.kind === 'note') {
        noteDot(x, y(it.s), it.f, it.finger, a);
        if (isCur) { ctx.beginPath(); ctx.arc(x, y(it.s), r + 3, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.stroke(); }
      } else if (it.kind === 'chord') {
        // blok akorda: od početka do kraja trajanja, tačke u bojama prstiju na svakoj žici
        const bx = x - r - 4, bw = Math.max(r * 2 + 8, x1 - x - 6 + r * 2 + 8);
        ctx.globalAlpha = it.deco ? 0.55 : a;
        roundRect(bx, padY + 1, bw, H - 2 * padY - 2, 12);
        ctx.fillStyle = 'rgba(236,238,242,.07)'; ctx.fill();
        ctx.lineWidth = isCur ? 2.5 : 1.5; ctx.strokeStyle = isCur ? 'rgba(255,255,255,.85)' : 'rgba(236,238,242,.3)'; ctx.stroke();
        ctx.globalAlpha = 1;
        if (!it.deco && it.frets) for (let s = 0; s < 6; s++) {
          const f = it.frets[s];
          if (f < 0) { ctx.globalAlpha = a * 0.7; ctx.fillStyle = C.muted; ctx.font = `700 ${Math.round(r * 0.9)}px system-ui, sans-serif`; ctx.fillText('×', x, y(s)); ctx.globalAlpha = 1; }
          else noteDot(x, y(s), f, f === 0 ? 0 : it.fingers?.[s] || 1, a, 0.82);
        }
        // ime akorda iznad (u bloku, pored prvog reda)
        const label = it.label || '';
        if (label) {
          ctx.globalAlpha = it.deco ? 0.7 : a;
          ctx.font = `800 ${Math.round(Math.min(22, laneH * 0.62))}px system-ui, sans-serif`;
          const lx = Math.max(x + r + 8 + ctx.measureText(label).width / 2, x + r + 18);
          ctx.fillStyle = '#fff'; ctx.fillText(label, Math.min(lx, x1 + r - 6 > lx ? lx : lx), y(0));
          ctx.globalAlpha = 1;
        }
      } else if (it.kind === 'strum') {
        // udarac: strelica preko svih žica (dole = ka tankoj e)
        ctx.globalAlpha = a;
        const top = y(0) - r * 0.6, bot = y(5) + r * 0.6, down = it.dir !== 'U';
        ctx.strokeStyle = it.muted ? C.muted : '#e9ecf1'; ctx.lineWidth = Math.max(4, r * 0.45); ctx.lineCap = 'round';
        ctx.shadowColor = '#e9ecf1'; ctx.shadowBlur = it.muted ? 0 : 7;
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot); ctx.stroke();
        const hy = down ? bot : top, sgn = down ? -1 : 1;
        ctx.beginPath(); ctx.moveTo(x - r * 0.8, hy + sgn * r * 0.9); ctx.lineTo(x, hy); ctx.lineTo(x + r * 0.8, hy + sgn * r * 0.9); ctx.stroke();
        ctx.shadowBlur = 0; ctx.lineCap = 'butt';
        if (isCur) { roundRect(x - r * 1.1, top - 6, r * 2.2, bot - top + 12, r); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
    }
    // prstenovi: zeleno = pogodak, crveno = promašaj / pogrešno (oko note, na liniji)
    for (let i = rings.length - 1; i >= 0; i--) {
      const b = rings[i], k = (real - b.at) / 450;
      if (k >= 1) { rings.splice(i, 1); continue; }
      const it = b.it, x = it.state === 'miss' || b.kind === 'wrong' ? Math.max(hitX, xOf(it.at)) : hitX;
      const col = b.kind === 'hit' ? C.ok : C.danger;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 4 * (1 - k) + 1.5; ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 10;
      if (it.kind === 'note') { ctx.beginPath(); ctx.arc(x, y(it.s), r * (1.12 + k * 0.9), 0, Math.PI * 2); ctx.stroke(); }
      else { const grow = k * 10; roundRect(x - r - 6 - grow, padY - grow / 2, r * 2 + 12 + grow * 2, H - 2 * padY + grow, 14); ctx.stroke(); }
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
  }
  raf = requestAnimationFrame(draw);

  let popTimer = 0;
  function pop(text, kind) {
    const p = q('.trk-pop');
    p.className = 'trk-pop ' + (kind || '');
    p.textContent = text;
    void p.offsetWidth; p.classList.add('show');
    clearTimeout(popTimer); popTimer = setTimeout(() => p.classList.remove('show'), 800);
  }
  function flash(kind) {
    el.classList.remove('fl-hit', 'fl-miss'); void el.offsetWidth;
    el.classList.add(kind === 'hit' ? 'fl-hit' : 'fl-miss');
  }
  function setCombo(n) {
    combo = n; maxCombo = Math.max(maxCombo, n);
    const c = q('.trk-combo');
    c.querySelector('b').textContent = String(n);
    c.classList.toggle('hot', n >= 8);
    if (n > 0) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
  }
  let handT = 0;

  return {
    el,
    useClock(fn) { clock = fn; },
    setItems(list, ms) { items = list; if (ms) beatMs = ms; },
    setGrid(gr) { grid = gr; },
    set beatMs(v) { beatMs = v; },
    /** Ocena: kind 'hit' | 'early' | 'late' | 'miss'; text = poruka; sound = cink */
    judge(it, kind, text, { sound = true } = {}) {
      it.state = kind === 'miss' ? 'miss' : 'hit';
      it.doneAt = performance.now();
      rings.push({ it, at: it.doneAt, kind: kind === 'miss' ? 'miss' : 'hit' });
      flash(kind === 'miss' ? 'miss' : 'hit');
      if (kind === 'miss') setCombo(0);
      else { setCombo(combo + 1); if (sound) hitSound(); }
      pop(text, kind);
    },
    /** Pogrešno, ali nota i dalje čeka (može se popraviti). */
    wrong(it, text) { rings.push({ it, at: performance.now(), kind: 'wrong' }); flash('miss'); pop(text, 'miss'); },
    big(text) {
      const b = q('.trk-big');
      b.textContent = text || '';
      b.classList.remove('show'); void b.offsetWidth; if (text) b.classList.add('show');
    },
    pop,
    caption(text) { q('.trk-cap').textContent = text || ''; q('.trk-cap').classList.toggle('on', !!text); },
    lyric(text) { const l = q('.trk-lyric'); l.textContent = text || ''; l.classList.toggle('on', !!text); },
    progress(frac) { q('.trk-prog i').style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`; },
    level(lv, note) {
      const db = lv ? 20 * Math.log10(lv) : -100;
      q('.pr-lvl i').style.width = `${Math.round(Math.max(0, Math.min(1, (db + 60) / 50)) * 100)}%`;
      q('.trk-heard').textContent = note != null ? `${t('pr.meter.heard')}: ${noteLabel(note)}` : '';
    },
    /** Ruka: na početku runde nekoliko puta blago zasvetli (podsetnik za boje), pa polako izbledi. */
    handPulse() {
      const h = q('.trk-hand');
      h.classList.remove('pulse', 'fade'); void h.offsetWidth;
      h.classList.add('pulse');
      clearTimeout(handT); handT = setTimeout(() => { h.classList.remove('pulse'); h.classList.add('fade'); }, 2900);
    },
    /** Prsti koji sviraju sledeću notu/akord blago svetle na ruci. */
    handLight(fingers = []) {
      el.querySelectorAll('.h-tip').forEach((tip) => tip.classList.toggle('lit', fingers.includes(+tip.dataset.f)));
    },
    get combo() { return combo; },
    get maxCombo() { return maxCombo; },
    reset() {
      items = []; grid = null; combo = 0; maxCombo = 0; setCombo(0); q('.trk-combo b').textContent = '0';
      this.progress(0); this.caption(''); this.lyric(''); this.big(''); this.handLight([]); q('.trk-res').hidden = true;
      clock = () => performance.now();
    },
    isPortrait: () => mq.matches,
    /** Čekaj da telefon bude položen (dotle se vidi „Okreni telefon“). */
    whenLandscape() {
      if (!mq.matches) return Promise.resolve();
      return new Promise((res) => {
        const off = this.onOrientation((p) => { if (!p) { off(); res(); } });
      });
    },
    onOrientation(fn) { orientSubs.add(fn); return () => orientSubs.delete(fn); },
    /** Rezultat na stazi; buttons: [{ id, label, primary }] → Promise sa id-jem dugmeta. */
    results({ title, stars = 0, score, lines = [], note = '', buttons = [] }) {
      const box = q('.trk-res');
      box.hidden = false;
      box.innerHTML = `<div class="trk-res-card">
        ${title ? `<h2>${title}</h2>` : ''}
        ${stars != null ? `<div class="trk-stars" aria-label="${stars}/3">${[0, 1, 2].map((i) => `<span class="${i < stars ? 'on' : ''}" style="animation-delay:${0.15 + i * 0.22}s">★</span>`).join('')}</div>` : ''}
        ${score != null ? `<div class="pr-score"><b>${Math.round(score)}</b><small>/100</small></div>` : ''}
        ${lines.length ? `<div class="pr-res-row">${lines.map((l) => `<span><small>${l.label}</small><b>${l.value}</b></span>`).join('')}</div>` : ''}
        ${note ? `<p class="trk-res-note">${note}</p>` : ''}
        <div class="trk-res-btns">${buttons.map((b) => `<button class="btn ${b.primary ? 'primary' : ''}" data-id="${b.id}">${b.label}</button>`).join('')}</div>
      </div>`;
      return new Promise((res) => box.querySelector('.trk-res-btns').addEventListener('click', (e) => {
        const b = e.target.closest('[data-id]');
        if (b) { box.hidden = true; res(b.dataset.id); }
      }));
    },
    destroy() {
      if (!alive) return;
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      mq.removeEventListener('change', onMq);
      clearTimeout(popTimer); clearTimeout(rotT); clearTimeout(handT);
      el.remove();
      document.body.classList.remove('trk-open');
    },
  };
}

/** Zvezdice iz rezultata (0–100). */
export const starsOf = (score) => (score >= 92 ? 3 : score >= 75 ? 2 : score >= 50 ? 1 : 0);

/**
 * Jedna runda na stazi.
 * items: [{ kind: 'note'|'chord'|'strum', beat, dur?, s?, f?, finger?, frets?, fingers?, label?, dir?, lyric?,
 *           winBeats?, winCap?, deco? (samo za prikaz, ne ocenjuje se) }]
 * mode: 'beg' (Početnik: čeka na svaku notu) | 'normal'
 * lagMs: koliko posle note još može da stigne ocena (provera trzaja ~90 ms, akorda ~350 ms) + kašnjenje mikrofona
 * hintOf(it) → tekst saveta u Početniku; fingersOf(it) → prsti koji svetle na ruci
 * demo: { play(it), early?(i) → true za jednu notu „rano“, captions: { [index]: tekst } }
 * Vraća { input(at, check), stop() }; check(it) → { ok, text? } (text = poruka za pogrešno).
 */
export function runTrack({ api, track, t, items, bpm, mode = 'normal', lagMs = 180, hintOf, fingersOf, demo = null, onEnd }) {
  const beg = mode === 'beg' && !demo;
  const beatMs = beg ? 60000 / 66 : 60000 / bpm; // Početnik: stalan, spor razmak između nota (bez tempa)
  const judged = items.filter((it) => !it.deco);
  const endBeat = Math.max(...items.map((it) => it.beat + (it.dur || 1)));
  let met = null, gen = 0, resumeBeat = 0, paused = false, firstStart = false, ended = false, counting = true, sweepT = 0, lastCur = null, timers = [];
  let vt = -1e9, lastReal = performance.now(); // Početnik: virtuelni sat (staje kod note koja čeka)
  track.setItems(items, beatMs);
  track.progress(0);
  const win = (it) => Math.min(it.winCap || 300, beatMs * (it.winBeats || 0.5));
  const cur = () => judged.find((it) => !it.state);

  if (beg) {
    items.forEach((it) => (it.at = (it.beat + 2) * beatMs));
    track.useClock(() => {
      const n = performance.now();
      if (!paused && !counting) {
        vt += n - lastReal;
        const c = cur();
        if (c && vt > c.at) vt = c.at;
      }
      lastReal = n;
      return vt;
    });
    track.setGrid({ t0: 0 });
  } else track.useClock(() => performance.now());

  function retime(t0) {
    for (const it of items) if (!it.state || it.deco) it.at = t0 + it.beat * beatMs;
    track.setGrid({ t0 });
  }
  const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };

  // ---- Normalno / demo: metronom ----
  function startMetronome(first) {
    const my = ++gen;
    met = new Metronome();
    met.bpm = bpm; met.sig = '4/4'; met.countIn = 1;
    let k = 0;
    met.onStep = (slot, beat, accent, info) => {
      if (beat == null || my !== gen) return;
      api.pulse?.(beat, 4, beat === 0);
      if (info.countIn) {
        if (info.countBeat === 0) { retime(info.at + 4 * beatMs - resumeBeat * beatMs); if (first) track.handPulse(); }
        track.big(info.countBeat < 3 ? String(3 - info.countBeat) : t('pr.trk.go'));
        if (info.countBeat === 3) counting = false;
        return;
      }
      if (k === 0) track.big('');
      retime(info.at - (resumeBeat + k) * beatMs); // tačno vreme ovog klika (audio sat)
      if (resumeBeat + k >= endBeat) { met.stop(); later(finish, 900); return; }
      k++;
    };
    met.start();
  }
  // ---- Početnik: odbrojavanje bez metronoma ----
  function startBeginner(first) {
    counting = true;
    const my = ++gen;
    if (first) { vt = 0; track.handPulse(); }
    [3, 2, 1].forEach((n, i) => later(() => my === gen && track.big(String(n)), i * 650));
    later(() => { if (my !== gen) return; track.big(t('pr.trk.go')); counting = false; lastReal = performance.now(); }, 3 * 650);
  }

  function sweep() {
    if (ended) return;
    const c = cur();
    if (c !== lastCur) {
      lastCur = c;
      track.handLight(c ? (fingersOf ? fingersOf(c) : c.finger ? [c.finger] : []) : []);
      if (!demo) track.caption('');
      if (c?.lyric !== undefined) track.lyric(c.lyric);
    }
    if (paused || counting) return;
    const now = beg ? vt : performance.now();
    if (beg) {
      if (c && now >= c.at - 1 && hintOf && !c.hinted) { c.hinted = true; track.caption(hintOf(c)); }
      if (!c) { ended = true; later(finish, 700); }
    } else if (demo) {
      judged.forEach((it, i) => {
        if (it.state || now < it.at) return;
        demo.play?.(it);
        const early = demo.early?.(i);
        track.judge(it, early ? 'early' : 'hit', early ? t('pr.trk.early') : t('pr.trk.hit'), { sound: false });
        if (demo.captions && demo.captions[i] != null) track.caption(demo.captions[i]);
      });
    } else {
      const lag = lagMs + (getLatency() ?? 60);
      for (const it of judged) if (!it.state && now - it.at > win(it) + lag) { it.score = 0; track.judge(it, 'miss', t('pr.trk.miss')); }
    }
    track.progress(judged.filter((it) => it.state).length / judged.length);
  }

  function finish() {
    if (ended && !beg) return;
    ended = true;
    clearInterval(sweepT);
    met?.stop();
    off();
    for (const it of judged) if (!it.state) { it.score = 0; it.state = 'miss'; }
    const n = judged.length;
    const score = (judged.reduce((a, it) => a + (it.score || 0), 0) / n) * 100;
    const hits = judged.filter((it) => (it.score || 0) > 0).length;
    const wrongs = judged.reduce((a, it) => a + (it.wrong || 0), 0);
    track.caption(''); track.handLight([]);
    onEnd?.({ score, accuracy: hits / n, maxCombo: track.maxCombo, wrongs, clean: beg ? wrongs <= Math.max(1, Math.round(n * 0.1)) : hits / n >= 0.85, tempo: bpm, beginner: beg });
  }
  // Ulaz igre (trzaj / udarac): nota najbliža trenutku „at“ (Početnik: nota koja čeka)
  function input(at, check) {
    if (ended || paused || counting) return;
    if (beg) {
      const c = cur();
      if (!c || vt < c.at - beatMs * 0.9) return;
      const r = check(c);
      if (r.ok) { c.score = c.wrong ? 0.6 : 1; track.judge(c, 'hit', t('pr.trk.hit')); }
      else { c.wrong = (c.wrong || 0) + 1; track.wrong(c, r.text ? t('pr.trk.tryAgain', { x: r.text }) : t('pr.trk.notClear')); }
      return;
    }
    let best = null;
    for (const it of judged) if (!it.state && Math.abs(at - it.at) <= win(it) && (!best || Math.abs(at - it.at) < Math.abs(at - best.at))) best = it;
    if (!best) return;
    const r = check(best);
    if (!r.ok) { best.wrong = (best.wrong || 0) + 1; track.wrong(best, r.text || t('pr.trk.notClear')); return; }
    const dt = at - best.at, tm = judgeTiming(dt, beatMs * Math.min(1, (best.winBeats || 0.5) * 2));
    best.score = (tm.kind === 'off' ? 0.6 : 0.6 + 0.4 * tm.score) * (best.wrong ? 0.7 : 1);
    const kind = tm.kind === 'hit' ? 'hit' : dt < 0 ? 'early' : 'late';
    track.judge(best, kind, kind === 'hit' ? t('pr.trk.hit') : t(kind === 'early' ? 'pr.trk.early' : 'pr.trk.late'));
  }

  // Uspravno usred runde → pauza; položeno → novo odbrojavanje
  function pause() {
    if (ended || paused) return;
    paused = true; gen++;
    met?.stop(); met = null;
    const c = cur();
    resumeBeat = c ? Math.max(0, Math.floor(c.beat)) : endBeat;
    track.big('');
  }
  function resume() {
    if (ended || !paused) return;
    paused = false;
    counting = true;
    const f = firstStart; firstStart = false;
    if (beg) startBeginner(f); else startMetronome(f);
  }
  const offOrient = track.onOrientation((portrait) => (portrait ? pause() : resume()));
  function off() { offOrient(); timers.forEach(clearTimeout); timers = []; }

  sweepT = setInterval(sweep, 30);
  if (track.isPortrait()) { paused = true; resumeBeat = 0; firstStart = true; } // počinje tek kad se telefon okrene
  else if (beg) startBeginner(true); else startMetronome(true);

  return {
    input,
    stop() { ended = true; gen++; clearInterval(sweepT); met?.stop(); off(); },
    get beatMs() { return beatMs; },
  };
}

/**
 * Rezultat runde na stazi + čuvanje; vraća izbor: 'faster' | 'again' | 'tryNormal' | 'back' | dodatna dugmad.
 * extra: [{ id, label, primary }] (npr. „Sledeći deo“) — idu ispred ostalih.
 */
export async function roundResults({ api, track, t, stats, key = null, extra = [], step = 5 }) {
  const info = await api.finish({ score: stats.score, tempo: stats.tempo, accuracy: stats.accuracy, quiet: true, noTempoUp: stats.beginner }, key);
  if (!track) return { choice: 'back' };
  const stars = starsOf(stats.score);
  const next = stats.beginner ? stats.tempo : info.nextTempo > stats.tempo ? info.nextTempo : stats.tempo + step;
  const buttons = stats.beginner
    ? [...(stats.clean ? [{ id: 'tryNormal', label: t('pr.lvl.tryNormal'), primary: true }] : []), { id: 'again', label: t('pr.trk.again'), primary: !stats.clean }, { id: 'back', label: t('pr.trk.back') }]
    // uz „Sledeći deo“ / „Cela pesma“ (pravi tempo pesme je dostignut) nema „Brže“
    : [...extra, ...(extra.length ? [] : [{ id: 'faster', label: t('pr.trk.faster', { bpm: next }), primary: stars >= 2 }]), { id: 'again', label: t('pr.trk.again'), primary: !extra.length && stars < 2 }, { id: 'back', label: t('pr.trk.back') }];
  const lines = [{ label: t('pr.accuracy'), value: `${Math.round(stats.accuracy * 100)}%` }, { label: t('pr.trk.maxCombo'), value: String(stats.maxCombo) }];
  if (!stats.beginner) lines.push({ label: t('pr.tempoReached'), value: `${stats.tempo} BPM` });
  const choice = await track.results({
    title: stats.beginner ? t(stats.clean ? 'pr.lvl.cleanTitle' : 'pr.lvl.notCleanTitle') : t('pr.trk.res' + stars),
    stars, score: stats.score, lines,
    note: [info.newBest ? t('pr.newBest') : '', stats.beginner && stats.clean ? t('pr.lvl.cleanNote') : ''].filter(Boolean).join(' '),
    buttons,
  });
  return { choice, next };
}

/** Zajednički odgovor na izbor posle rezultata. Vraća true ako je igra to sama obradila. */
export function handleChoice(api, choice, next, close) {
  if (choice === 'back') { close(); return true; }
  if (choice === 'tryNormal') { api.setLevel('normal'); api.restart(); return true; }
  if (choice === 'faster') { api.setBpm(next); api.restart(); return true; }
  if (choice === 'again') { api.restart(); return true; }
  return false;
}

/** Tekst saveta za notu u Početniku: „Žica A, prag 2“ (prazna žica: „Prazna žica A“). */
export function noteHint(t, it) {
  const sName = it.s === 5 ? dn('E').toLowerCase() : noteLabel(OPEN_MIDI[it.s]);
  return it.f === 0 ? t('pr.hint.open', { s: sName }) : t('pr.hint.note', { s: sName, f: it.f, n: it.finger });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Zajednički okvir za igre na stazi (Pauk, Ritam, Promena akorda, Delovi pesme).
 * cfg.round(level, bpm) → { items, bpm?, lagMs?, hintOf?, fingersOf?, key? , extra?(stats) }
 * cfg.listen(round, input) → opcije za api.listen (onPluck / onOnset …); input(at, check) ide u rundu
 * cfg.onRoundEnd?(stats, round, ctl) → true ako je igra sama nastavila (npr. sledeći prolaz pesme)
 * cfg.onChoice?(choice, round, ctl) — dugmad iz cfg.round().extra
 * cfg.demo: { items(), bpm, play(it), early?(i), captions: {i: tekst}, intro, fingersOf? }
 */
export function trackGame(api, cfg) {
  const { t } = api;
  let track = null, runner = null, unsub = null, gen = 0;
  const open = () => { if (track) track.reset(); else track = createTrack({ t, onExit: () => api.stop() }); return track; };
  const close = () => { gen++; runner?.stop(); runner = null; track?.destroy(); track = null; };
  const ctl = {
    get track() { return track; },
    close,
    /** Nova runda bez novog dodira (npr. sledeći prolaz): mikrofon ostaje uključen. */
    async next(round) { await startRound(round, api.bpm); },
  };

  async function startRound(round, bpm) {
    const my = ++gen;
    runner?.stop();
    track.reset();
    runner = runTrack({
      api, track, t, items: round.items, bpm: round.bpm || bpm, mode: api.level === 'beg' ? 'beg' : 'normal',
      lagMs: round.lagMs ?? 180, hintOf: round.hintOf, fingersOf: round.fingersOf,
      onEnd: (stats) => my === gen && ended(stats, round),
    });
  }
  async function play(bpm) {
    open();
    const round = cfg.round(api.level, bpm);
    await api.listen(cfg.listen(round, (at, check) => runner?.input(at, check)));
    unsub?.(); unsub = api.onLevel((lv, note) => track?.level(lv, note));
    if (!api.running || !track) return;
    await startRound(round, bpm);
  }
  async function ended(stats, round) {
    runner = null;
    if (!api.running || !track) return;
    if (cfg.onRoundEnd && (await cfg.onRoundEnd(stats, round, ctl))) return;
    const { choice, next } = await roundResults({ api, track, t, stats, key: round.key || null, extra: round.extra ? round.extra(stats) : [] });
    if (handleChoice(api, choice, next, close)) return;
    cfg.onChoice?.(choice, round, ctl);
  }

  // Demo (samo na dugme „Pogledaj demo“; nikad samo od sebe) — bez mikrofona, ništa se ne čuva
  async function demo() {
    open();
    const my = gen;
    await track.whenLandscape();
    if (!track || my !== gen || !api.running) return;
    track.handPulse();
    track.caption(cfg.demo.intro);
    await wait(2800);
    if (!track || my !== gen || !api.running) return;
    const d = cfg.demo;
    runner = runTrack({
      api, track, t, items: d.items(), bpm: d.bpm, demo: { play: d.play, early: d.early, captions: d.captions },
      fingersOf: d.fingersOf,
      onEnd: async () => {
        runner = null;
        if (!track || !api.running) return;
        track.caption('');
        api.stopNow();
        const choice = await track.results({
          title: t('pr.demo.end'), stars: null,
          note: api.level === 'beg' ? t('pr.demo.slowBeg') : t('pr.demo.slow', { bpm: cfg.firstBpm || 50 }),
          buttons: [{ id: 'go', label: t('pr.demo.nowYou'), primary: true }, { id: 'replay', label: t('pr.demo.replay') }, { id: 'back', label: t('pr.trk.back') }],
        });
        if (choice === 'back') { close(); return; }
        if (choice === 'replay') { api.startCustom(demo); return; }
        if (api.level !== 'beg') api.setBpm(cfg.firstBpm || 50);
        api.restart();
      },
    });
  }

  return {
    track: true,
    levels: cfg.levels,
    bpm: cfg.bpm,
    initialTempo: cfg.initialTempo,
    noTempo: cfg.noTempo,
    demo,
    start: play,
    onLevel: cfg.onLevel,
    stop() { unsub?.(); unsub = null; close(); },
    destroy() { this.stop(); },
    ctl,
  };
}

/** Blok akorda za stazu: prvi (najlakši) hvat, prsti u bojama. */
export function chordItem(chord, beat, dur, extra = {}) {
  const v = getVoicings(chord)[0];
  return { kind: 'chord', beat, dur, chord, label: dn(chord), frets: v ? v.frets : [-1, -1, -1, -1, -1, -1], fingers: v ? v.fingers.map((f, i) => (v.barre && v.frets[i] === v.barre.fret && i >= v.barre.from && i <= v.barre.to ? 1 : f)) : [], winBeats: 0.45, winCap: 450, ...extra };
}
/** Prsti koje akord koristi (za ruku). */
export const chordFingers = (it) => [...new Set((it.fingers || []).filter((f, i) => f > 0 && it.frets[i] > 0))];
