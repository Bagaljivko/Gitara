// Vežbe: zajednička „staza“ (u stilu Guitar Hero-a), položeni ekran.
// Vodoravni vrat gitare, žice kao kad gledaš svoju gitaru dok sviraš (debela E gore, tanka e dole).
// Note klize zdesna nalevo do svetle linije; na noti je broj praga, u kružiću broj prsta.
// Crta se na jednom <canvas>-u (requestAnimationFrame) — lagano i za slabije telefone.
import { audioCtx } from './synth.js';
import { OPEN_MIDI, noteLabel } from './practiceBoard.js';

const C = { bg: '#07080a', wood: '#120d09', str: '#b9bdc4', line: '#262930', accent: '#f5a524', ink: '#1a1203', ok: '#3dd68c', danger: '#ff6b6b', text: '#eceef2', muted: '#9aa1ad' };
const portrait = () => window.matchMedia('(orientation: portrait)').matches;

/** Ceo ekran + položeno (Android); mora da se pozove direktno iz dodira (dugme). Ako ne može — tiho ništa. */
export function enterLandscape() {
  try {
    const de = document.documentElement;
    if (document.fullscreenElement || !de.requestFullscreen) return;
    de.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
      .catch(() => {});
  } catch {}
}
export function exitLandscape() {
  try { screen.orientation?.unlock?.(); } catch {}
  try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch {}
}

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

/**
 * Napravi stazu preko celog ekrana.
 * items: [{ at (performance.now ms), s (0 = debela E), f, finger, state?: 'hit'|'miss', wrong? }]
 */
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
    <div class="trk-lane"><canvas></canvas><div class="trk-big"></div><div class="trk-pop"></div></div>
    <div class="trk-cap" aria-live="polite"></div>
    <div class="trk-res" hidden></div>
    <div class="trk-rotate"><div class="trk-phone" aria-hidden="true"><i></i></div><b>${t('pr.trk.rotate')}</b><small>${t('pr.trk.rotateWhy')}</small>
      <button class="btn small trk-x2">${t('pr.trk.exit')}</button></div>`;
  document.body.appendChild(el);
  document.body.classList.add('trk-open');
  const q = (s) => el.querySelector(s);
  const cv = q('canvas'), ctx = cv.getContext('2d');
  const exit = () => onExit?.();
  q('.trk-x').addEventListener('click', exit);
  q('.trk-x2').addEventListener('click', exit);

  let items = [], beats = [], beatMs = 1000, raf = 0, W = 0, H = 0, dpr = 1, combo = 0, maxCombo = 0, alive = true;
  const bursts = []; // { s, at, kind }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(cv);

  // Trenutni cilj: prva neocenjena nota (svetli njen kružić na liniji — „gde ide prst“)
  const current = () => items.find((it) => !it.state);

  function draw() {
    if (!alive) return;
    raf = requestAnimationFrame(draw);
    if (!W || !H) { resize(); if (!W) return; }
    const now = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    const padY = Math.max(10, H * 0.06), gutter = 30, laneH = (H - 2 * padY) / 6;
    const hitX = gutter + Math.max(52, W * 0.13), ppb = (W - hitX) / lookBeats;
    const y = (s) => padY + (s + 0.5) * laneH; // s = 0 (debela E) gore
    const xOf = (at) => hitX + ((at - now) / beatMs) * ppb;
    // drvo vrata
    ctx.fillStyle = C.wood; ctx.fillRect(gutter, padY, W - gutter, H - 2 * padY);
    // otkucaji (takt jače) — klize zajedno sa notama
    for (const b of beats) {
      const x = xOf(b.at);
      if (x < gutter || x > W) continue;
      ctx.fillStyle = b.acc ? 'rgba(236,238,242,.22)' : 'rgba(236,238,242,.08)';
      ctx.fillRect(x - (b.acc ? 1.5 : 0.75), padY, b.acc ? 3 : 1.5, H - 2 * padY);
    }
    // žice + imena
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let s = 0; s < 6; s++) {
      ctx.fillStyle = C.str; ctx.globalAlpha = 0.75;
      const th = 3.2 - s * 0.42;
      ctx.fillRect(gutter, y(s) - th / 2, W - gutter, th);
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.muted; ctx.font = `700 ${Math.round(Math.min(15, laneH * 0.42))}px system-ui, sans-serif`;
      ctx.fillText(s === 5 ? noteLabel(OPEN_MIDI[s]).toLowerCase() : noteLabel(OPEN_MIDI[s]), gutter / 2, y(s));
    }
    // linija pogotka
    const g = ctx.createLinearGradient(hitX - 14, 0, hitX + 14, 0);
    g.addColorStop(0, 'rgba(245,165,36,0)'); g.addColorStop(0.5, 'rgba(245,165,36,.35)'); g.addColorStop(1, 'rgba(245,165,36,0)');
    ctx.fillStyle = g; ctx.fillRect(hitX - 14, padY, 28, H - 2 * padY);
    ctx.fillStyle = C.accent; ctx.fillRect(hitX - 1.5, padY, 3, H - 2 * padY);
    const r = Math.max(9, Math.min(laneH * 0.44, 26));
    // kružići na liniji; trenutni cilj svetli sa brojem prsta
    const cur = current();
    for (let s = 0; s < 6; s++) {
      ctx.beginPath(); ctx.arc(hitX, y(s), r, 0, Math.PI * 2);
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(236,238,242,.25)'; ctx.stroke();
    }
    if (cur && xOf(cur.at) - hitX < ppb * 1.2) {
      const near = 1 - Math.min(1, Math.max(0, (xOf(cur.at) - hitX) / (ppb * 1.2)));
      ctx.beginPath(); ctx.arc(hitX, y(cur.s), r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(61,214,140,${0.25 + 0.6 * near})`; ctx.fill();
      ctx.shadowColor = C.ok; ctx.shadowBlur = 14 * near;
      ctx.lineWidth = 2.5; ctx.strokeStyle = C.ok; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#06210f'; ctx.font = `800 ${Math.round(r * 0.9)}px system-ui, sans-serif`;
      ctx.fillText(String(cur.finger ?? ''), hitX, y(cur.s) + 1);
    }
    // note
    for (const it of items) {
      if (it.state === 'hit') continue; // pogođena nota „pukne“ (vidi bursts)
      const x = xOf(it.at);
      if (x > W + r || x < -r) continue;
      let a = 1;
      if (it.state === 'miss') a = Math.max(0, 1 - (now - it.doneAt) / 600);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      const isCur = it === cur;
      ctx.beginPath(); ctx.arc(x, y(it.s), r, 0, Math.PI * 2);
      ctx.fillStyle = it.state === 'miss' ? C.danger : C.accent; ctx.fill();
      if (isCur) { ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(); }
      ctx.fillStyle = it.state === 'miss' ? '#1b0606' : C.ink; ctx.font = `800 ${Math.round(r * 1.05)}px system-ui, sans-serif`;
      ctx.fillText(String(it.f), x, y(it.s) + 1);
      if (it.finger) {
        const bx = x + r * 0.78, by = y(it.s) - r * 0.78, br = Math.max(7, r * 0.46);
        ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = C.bg; ctx.stroke();
        ctx.fillStyle = '#111'; ctx.font = `800 ${Math.round(br * 1.2)}px system-ui, sans-serif`;
        ctx.fillText(String(it.finger), bx, by + 0.5);
      }
      ctx.globalAlpha = 1;
    }
    // „prasak“ pogotka / promašaja na liniji
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i], k = (now - b.at) / 420;
      if (k >= 1) { bursts.splice(i, 1); continue; }
      ctx.globalAlpha = 1 - k;
      ctx.beginPath(); ctx.arc(hitX, y(b.s), r * (1 + k * 1.6), 0, Math.PI * 2);
      ctx.lineWidth = 4 * (1 - k) + 1; ctx.strokeStyle = b.kind === 'miss' ? C.danger : C.ok; ctx.stroke();
      if (b.kind !== 'miss') { ctx.fillStyle = 'rgba(61,214,140,.5)'; ctx.fill(); }
      ctx.globalAlpha = 1;
    }
  }
  raf = requestAnimationFrame(draw);

  let popTimer = 0;
  function pop(text, kind) {
    const p = q('.trk-pop');
    p.className = 'trk-pop ' + (kind || '');
    p.textContent = text;
    void p.offsetWidth; p.classList.add('show');
    clearTimeout(popTimer); popTimer = setTimeout(() => p.classList.remove('show'), 700);
  }
  function flash(kind) {
    el.classList.remove('fl-hit', 'fl-miss'); void el.offsetWidth;
    el.classList.add(kind === 'miss' ? 'fl-miss' : 'fl-hit');
  }
  function setCombo(n) {
    combo = n; maxCombo = Math.max(maxCombo, n);
    const c = q('.trk-combo');
    c.querySelector('b').textContent = String(n);
    c.classList.toggle('hot', n >= 8);
    if (n > 0) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
  }

  return {
    el,
    setItems(list, ms) { items = list; if (ms) beatMs = ms; },
    setBeats(list) { beats = list; },
    set beatMs(v) { beatMs = v; },
    /** Ocena note: kind 'hit' | 'early' | 'late' | 'miss'; text = poruka; sound = cink */
    judge(it, kind, text, { sound = true } = {}) {
      it.state = kind === 'miss' ? 'miss' : 'hit';
      it.doneAt = performance.now();
      bursts.push({ s: it.s, at: it.doneAt, kind });
      flash(kind);
      if (kind === 'miss') setCombo(0);
      else { setCombo(combo + 1); if (sound) hitSound(); }
      pop(text, kind);
    },
    /** Pogrešna nota, ali nota još čeka (može se popraviti u istom prozoru). */
    wrong(it, text) { bursts.push({ s: it.s, at: performance.now(), kind: 'miss' }); flash('miss'); pop(text, 'miss'); },
    big(text) {
      const b = q('.trk-big');
      b.textContent = text || '';
      b.classList.remove('show'); void b.offsetWidth; if (text) b.classList.add('show');
    },
    caption(text) { q('.trk-cap').textContent = text || ''; q('.trk-cap').classList.toggle('on', !!text); },
    progress(frac) { q('.trk-prog i').style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`; },
    level(lv, note) {
      const db = lv ? 20 * Math.log10(lv) : -100;
      q('.pr-lvl i').style.width = `${Math.round(Math.max(0, Math.min(1, (db + 60) / 50)) * 100)}%`;
      q('.trk-heard').textContent = note != null ? `${t('pr.meter.heard')}: ${noteLabel(note)}` : '';
    },
    get combo() { return combo; },
    get maxCombo() { return maxCombo; },
    reset() { items = []; beats = []; combo = 0; maxCombo = 0; setCombo(0); q('.trk-combo b').textContent = '0'; this.progress(0); this.caption(''); this.big(''); q('.trk-res').hidden = true; },
    /** Čekaj da telefon bude položen (dotle se vidi „Okreni telefon“). */
    whenLandscape() {
      if (!portrait()) return Promise.resolve();
      return new Promise((res) => {
        const mq = window.matchMedia('(orientation: portrait)');
        const on = () => { if (!mq.matches) { mq.removeEventListener('change', on); res(); } };
        mq.addEventListener('change', on);
      });
    },
    /**
     * Rezultat na stazi: zvezdice, poeni, tačnost, najduži niz; buttons: [{ id, label, primary }].
     * Vraća Promise sa id-jem dugmeta.
     */
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
      clearTimeout(popTimer);
      el.remove();
      document.body.classList.remove('trk-open');
      exitLandscape();
    },
  };
}

/** Zvezdice iz rezultata (0–100). */
export const starsOf = (score) => (score >= 92 ? 3 : score >= 75 ? 2 : score >= 50 ? 1 : 0);
