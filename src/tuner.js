// Tab "Tuner": štimer za standardno štimovanje gitare (E A D G B E).
// Kazaljka (♭ — ♯), velika nota, glava gitare sa okruglim dugmićima za žice.
import { openMic, closeMic, MicError } from './audio.js';
import { PitchTracker, GUITAR } from './pitchtrack.js';
import { settings } from './db.js';
import { t } from './i18n.js';
import { midiName } from './music.js';
import { keepAwake, allowSleep } from './wakelock.js';
import { pluck } from './synth.js';
import { dialog } from './ui.js';

// slot 0 = najviši par ključeva
const STRINGS = [
  { id: 0, label: 'E', full: 'E2', side: 'L', slot: 2, num: 6 },
  { id: 1, label: 'A', full: 'A2', side: 'L', slot: 1, num: 5 },
  { id: 2, label: 'D', full: 'D3', side: 'L', slot: 0, num: 4 },
  { id: 3, label: 'G', full: 'G3', side: 'R', slot: 0, num: 3 },
  { id: 4, label: 'B', full: 'B3', side: 'R', slot: 1, num: 2 },
  { id: 5, label: 'E', full: 'E4', side: 'R', slot: 2, num: 1 },
];

const IN_TUNE = 5;       // ±centi
const HOLD_MS = 1000;    // koliko dugo mora biti naštimovano da postane zeleno
const RANGE = 50;        // skala ±50 centi
const LONG_PRESS = 450;  // ms za referentni ton

// Zelene oznake ostaju i kada se ekran ponovo iscrta (npr. promena jezika) — briše ih samo „Resetuj“.
const done = new Set();

// ---------------- Crteži ----------------
function needleSVG() {
  const cx = 160, cy = 150, R = 128;
  const pt = (c, r) => {
    const a = (c / RANGE) * 70 * (Math.PI / 180);
    return [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
  };
  const arc = (c1, c2, r) => { const [x1, y1] = pt(c1, r), [x2, y2] = pt(c2, r); return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`; };
  let ticks = '';
  for (let c = -RANGE; c <= RANGE; c += 5) {
    const major = c % 25 === 0;
    const [x1, y1] = pt(c, major ? R - 16 : c % 10 === 0 ? R - 11 : R - 7);
    const [x2, y2] = pt(c, R);
    ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="nm-tick${major ? ' major' : ''}${c === 0 ? ' zero' : ''}"/>`;
  }
  const [lx, ly] = pt(-RANGE, R + 20), [rx, ry] = pt(RANGE, R + 20);
  return `<svg class="nmeter" viewBox="0 0 320 168" aria-hidden="true">
    <path d="${arc(-RANGE, RANGE, R + 4)}" class="nm-arc"/>
    <path d="${arc(-IN_TUNE * 2, IN_TUNE * 2, R + 4)}" class="nm-zone"/>
    ${ticks}
    <text x="${lx.toFixed(1)}" y="${(ly + 6).toFixed(1)}" class="nm-sym" text-anchor="middle">♭</text>
    <text x="${rx.toFixed(1)}" y="${(ry + 6).toFixed(1)}" class="nm-sym" text-anchor="middle">♯</text>
    <g class="nm-needle" id="tNeedle"><path d="M ${cx - 3} ${cy} L ${cx} ${cy - R + 6} L ${cx + 3} ${cy} Z"/><circle cx="${cx}" cy="${cy}" r="9"/><circle class="nm-cap" cx="${cx}" cy="${cy}" r="3.5"/></g>
  </svg>`;
}

// Geometrija glave (viewBox 0 0 360 480)
const SLOT_Y = [118, 196, 274];
const POST_X = { L: 150, R: 210 };
const EDGE_X = { L: 116, R: 244 };   // ivica glave u visini ključa (približno)
const KEY_X = { L: 88, R: 272 };     // hromirani ključ
const BTN_X = { L: 36, R: 324 };     // okruglo dugme sa nazivom žice
const NUT_Y = 404;
const nutX = (i) => 159 + i * 8.4;

function headstockSVG() {
  let strings = '', posts = '', pegs = '', buttons = '';
  for (const s of STRINGS) {
    const y = SLOT_Y[s.slot];
    const px = POST_X[s.side], ex = EDGE_X[s.side], kx = KEY_X[s.side], bx = BTN_X[s.side];
    const dir = s.side === 'L' ? -1 : 1;
    strings += `<line class="hs-string" data-s="${s.id}" x1="${nutX(s.id)}" y1="${NUT_Y + 2}" x2="${px - dir * 3}" y2="${y}" stroke-width="${(1.9 - s.id * 0.22).toFixed(2)}"/>`;
    posts += `<g class="hs-post" data-s="${s.id}"><circle cx="${px}" cy="${y}" r="9.5" class="post-bush"/><circle cx="${px}" cy="${y}" r="5" class="post-pin"/></g>`;
    // Ključ: kućište uz ivicu, osovina i „krilce“ koje se okreće
    const hx = Math.min(ex, ex + dir * 16);
    pegs += `<g class="peg" data-s="${s.id}">
      <rect class="peg-housing" x="${hx}" y="${y - 9}" width="16" height="18" rx="4"/>
      <rect class="peg-shaft" x="${Math.min(ex + dir * 16, kx)}" y="${y - 3}" width="${Math.abs(kx - (ex + dir * 16))}" height="6" rx="2"/>
      <ellipse class="peg-key" cx="${kx}" cy="${y}" rx="11" ry="17"/>
      <ellipse class="peg-shine" cx="${kx - 3}" cy="${y - 5}" rx="3" ry="7"/>
    </g>`;
    const sx = bx + (s.side === 'L' ? 22 : -22), sy = y + 30;
    buttons += `<g class="sbtn" data-s="${s.id}" tabindex="0" role="button" aria-label="${t('tuner.string', { num: s.num, note: s.full })}">
      <circle class="sbtn-c" cx="${bx}" cy="${y}" r="26"/>
      <text class="sbtn-t" x="${bx}" y="${y + 8}" text-anchor="middle">${s.label}</text>
    </g>
    <g class="spk" data-spk="${s.id}" tabindex="0" role="button" aria-label="${t('tuner.playRef', { note: s.full })}">
      <circle cx="${sx}" cy="${sy}" r="13" class="spk-c"/>
      <path d="M ${sx - 6} ${sy - 3} h 3 l 4 -4 v 14 l -4 -4 h -3 z" class="spk-i"/>
      <path d="M ${sx + 3.5} ${sy - 3.5} q 3 3.5 0 7" class="spk-w"/>
    </g>`;
  }
  // Drvena šara (blago talasaste linije)
  let grain = '';
  for (let i = 0; i < 16; i++) {
    const x = 112 + i * 8.5 + (i % 3) * 1.7;
    const w = 2 + (i % 4);
    grain += `<path d="M ${x} 20 C ${x + w} 120, ${x - w} 240, ${x + w * 0.6} 330 S ${x - 2} 420, ${x + 1} 480" class="grain${i % 3 === 0 ? ' dark' : ''}"/>`;
  }
  const body = 'M 128 404 L 118 92 C 116 50, 128 34, 148 30 Q 180 22 212 30 C 232 34, 244 50, 242 92 L 232 404 Z';
  return `<svg class="headstock" viewBox="0 0 360 480" xmlns="http://www.w3.org/2000/svg" aria-label="${t('tuner.headstock')}">
    <defs>
      <linearGradient id="hsWood" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stop-color="#6b3f22"/><stop offset=".45" stop-color="#a0663a"/><stop offset=".55" stop-color="#9a6036"/><stop offset="1" stop-color="#5f371d"/>
      </linearGradient>
      <linearGradient id="neckWood" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#4a2c19"/><stop offset="1" stop-color="#4a2c19" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="chrome" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#f4f6f8"/><stop offset=".45" stop-color="#a9afb7"/><stop offset=".7" stop-color="#d9dde2"/><stop offset="1" stop-color="#7d838b"/>
      </linearGradient>
      <radialGradient id="postChrome" cx=".35" cy=".35" r=".8">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#b9bec5"/><stop offset="1" stop-color="#6d727a"/>
      </radialGradient>
      <clipPath id="hsClip"><path d="${body}"/></clipPath>
    </defs>
    <rect class="neck" x="133" y="400" width="94" height="80" fill="url(#neckWood)"/>
    <path d="${body}" fill="url(#hsWood)"/>
    <g clip-path="url(#hsClip)">${grain}</g>
    <path d="${body}" class="hs-binding"/>
    ${pegs}
    <rect class="hs-nut" x="130" y="${NUT_Y - 4}" width="100" height="8" rx="2"/>
    ${strings}
    ${posts}
    ${buttons}
  </svg>`;
}

export function createTuner(root) {
  root.innerHTML = `
  <section class="view tuner-view">
    <header class="view-head">
      <h1>${t('tuner.title')}</h1>
      <label class="switch">
        <input type="checkbox" id="tAuto" checked>
        <span class="switch-track"><span class="switch-thumb"></span></span>
        <span>${t('tuner.auto')}</span>
      </label>
    </header>
    <div class="nwrap" id="tMeter" data-state="idle" aria-live="polite">
      ${needleSVG()}
      <div class="nnote" id="tNote">–</div>
    </div>
    <div class="headstock-wrap" id="tHead">${headstockSVG()}</div>
    <div class="tuner-foot"><button class="btn small" id="tReset">${t('tuner.reset')}</button></div>
    <div class="mic-overlay" id="tStart">
      <div class="mic-card">
        <button class="mic-btn" id="tStartBtn" aria-label="${t('tuner.start')}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2z"/></svg>
        </button>
        <p class="mic-label" id="tStartLabel">${t('tuner.start')}</p>
        <p class="err" id="tStartMsg" hidden></p>
      </div>
    </div>
  </section>`;

  const $ = (id) => root.querySelector('#' + id);
  const meter = $('tMeter');
  const needle = $('tNeedle');
  const autoEl = $('tAuto');

  let auto = true;
  let selected = 0;
  let running = false;
  let mic = null, analyser = null, buf = null, timer = 0;
  let a4 = 440;
  const tracker = new PitchTracker({ a4 });
  let shownCents = 0;     // izglađen položaj kazaljke
  let okSince = 0, okSid = -1;
  let lastLocked = 0;
  let popupOpen = false;

  settings.get('a4', 440).then((v) => { a4 = Number(v) || 440; tracker.a4 = a4; });

  const markActive = (id) => root.querySelectorAll('.peg, .sbtn, .hs-string, .hs-post').forEach((el) => el.classList.toggle('active', +el.dataset.s === id));
  const applyDone = () => root.querySelectorAll('.peg, .sbtn, .hs-string, .hs-post').forEach((el) => el.classList.toggle('done', done.has(+el.dataset.s)));
  applyDone();

  function resetAll() {
    done.clear();
    applyDone();
    okSince = 0; okSid = -1;
    tracker.release();
    if (auto) markActive(-1);
    idle();
  }

  function selectString(id) {
    auto = false;
    autoEl.checked = false;
    selected = id;
    tracker.setAllowed([id]);
    markActive(id);
    okSince = 0;
  }

  autoEl.addEventListener('change', () => {
    auto = autoEl.checked;
    tracker.setAllowed(auto ? [0, 1, 2, 3, 4, 5] : [selected]);
    if (auto) markActive(-1); else markActive(selected);
    idle();
  });

  // Dodir = izbor žice; dugi pritisak ili ikonica zvučnika = referentni ton.
  function playRef(id) {
    const f = a4 * Math.pow(2, (GUITAR[id] - 69) / 12);
    const ms = pluck(f);
    tracker.mute(ms + 400, performance.now()); // sopstveni ton ne sme da pokrene tuner
    const btn = root.querySelector(`.sbtn[data-s="${id}"]`);
    btn.classList.add('ringing');
    setTimeout(() => btn.classList.remove('ringing'), ms * 0.6);
  }
  root.querySelectorAll('.sbtn').forEach((el) => {
    const id = +el.dataset.s;
    let pressT = 0, longDone = false;
    el.addEventListener('pointerdown', (e) => {
      longDone = false;
      clearTimeout(pressT);
      pressT = setTimeout(() => { longDone = true; playRef(id); }, LONG_PRESS);
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
    });
    const end = () => { clearTimeout(pressT); if (!longDone) selectString(id); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => clearTimeout(pressT));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectString(id); } });
  });
  root.querySelectorAll('.spk').forEach((el) => {
    const go = (e) => { e.preventDefault(); playRef(+el.dataset.spk); };
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') go(e); });
  });
  $('tReset').addEventListener('click', resetAll);

  function setNeedle(c) {
    const clamped = Math.max(-RANGE * 1.1, Math.min(RANGE * 1.1, c));
    needle.style.transform = `rotate(${((clamped / RANGE) * 70).toFixed(2)}deg)`;
  }

  function idle() {
    meter.dataset.state = 'idle';
    $('tNote').textContent = auto ? '–' : STRINGS[selected].label;
    shownCents = 0;
    setNeedle(0);
    okSince = 0;
    if (auto) root.querySelectorAll('.peg, .sbtn, .hs-string, .hs-post').forEach((el) => el.classList.remove('active'));
  }

  async function allTuned() {
    popupOpen = true;
    await dialog({ body: t('tuner.ready'), buttons: [{ label: t('tuner.readyOk'), value: true, kind: 'primary' }], dismissible: false, className: 'ready-modal' });
    popupOpen = false;
    // Spremno za sledeću gitaru
    auto = true; autoEl.checked = true;
    tracker.setAllowed([0, 1, 2, 3, 4, 5]);
    resetAll();
  }

  function frame() {
    analyser.getFloatTimeDomainData(buf);
    const now = performance.now();
    const r = tracker.process(buf, mic.ctx.sampleRate, now);
    if (r.state === 'locked') {
      lastLocked = now;
      const sid = r.sid;
      if (auto) markActive(sid);
      shownCents = meter.dataset.state === 'idle' ? r.cents : shownCents + (r.cents - shownCents) * 0.3;
      setNeedle(shownCents);
      $('tNote').textContent = midiName(69 + 12 * Math.log2(r.freq / a4)).name;
      const ok = Math.abs(shownCents) <= IN_TUNE;
      meter.dataset.state = ok ? 'ok' : 'off';
      if (ok) {
        if (okSid !== sid || !okSince) { okSid = sid; okSince = now; }
        if (now - okSince >= HOLD_MS && !done.has(sid)) {
          done.add(sid);
          applyDone();
          if (done.size === 6 && !popupOpen) allTuned();
        }
      } else okSince = 0;
    } else if (meter.dataset.state !== 'idle' && r.state === 'idle' && now - lastLocked > 500) {
      idle();
    } else if (r.state !== 'locked') {
      okSince = 0;
    }
  }

  async function start() {
    if (running) return;
    $('tStartBtn').disabled = true;
    try {
      mic = await openMic();
      analyser = mic.ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      mic.source.connect(analyser);
      buf = new Float32Array(analyser.fftSize);
      running = true;
      $('tStart').hidden = true;
      $('tStartMsg').hidden = true;
      a4 = Number(await settings.get('a4', 440)) || 440;
      tracker.a4 = a4;
      tracker.reset();
      tracker.setAllowed(auto ? [0, 1, 2, 3, 4, 5] : [selected]);
      idle();
      keepAwake('tuner');
      timer = setInterval(frame, 20);
    } catch (e) {
      $('tStartMsg').textContent = e instanceof MicError ? e.message : t('mic.failed');
      $('tStartMsg').hidden = false;
      $('tStartLabel').textContent = t('common.retry');
    } finally {
      $('tStartBtn').disabled = false;
    }
  }

  function stop() {
    if (!running) return;
    running = false;
    clearInterval(timer);
    try { mic.source.disconnect(analyser); } catch {}
    closeMic();
    mic = null;
    allowSleep('tuner');
    $('tStart').hidden = false;
    $('tStartLabel').textContent = t('tuner.start');
  }

  $('tStartBtn').addEventListener('click', start);
  idle();

  return {
    // Na mobilnim uređajima mikrofon mora da se pokrene dodirom korisnika.
    show() {},
    hide: stop,
  };
}
