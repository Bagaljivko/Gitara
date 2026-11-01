// Tab "Tuner": štimer za standardno štimovanje gitare (E A D G B E).
// Prikaz: nota, merač (♭ — centar — ♯) i glava gitare sa okruglim dugmićima za žice.
import { openMic, closeMic, yin, rms, MicError } from './audio.js';
import { midiToFreq, freqToMidi, midiName } from './music.js';
import { settings } from './db.js';

// Žice od najdublje: indeks 0 = E2 (6. žica). slot 0 = najviši par ključeva.
const STRINGS = [
  { id: 0, label: 'E', full: 'E2', midi: 40, side: 'L', slot: 2, num: 6 },
  { id: 1, label: 'A', full: 'A2', midi: 45, side: 'L', slot: 1, num: 5 },
  { id: 2, label: 'D', full: 'D3', midi: 50, side: 'L', slot: 0, num: 4 },
  { id: 3, label: 'G', full: 'G3', midi: 55, side: 'R', slot: 0, num: 3 },
  { id: 4, label: 'B', full: 'B3', midi: 59, side: 'R', slot: 1, num: 2 },
  { id: 5, label: 'e', full: 'E4', midi: 64, side: 'R', slot: 2, num: 1 },
];

const IN_TUNE = 5; // ±centi
const HOLD_MS = 1000; // koliko dugo žica mora da bude naštimovana da postane zelena
const RANGE = 50; // merač prikazuje ±50 centi

// Geometrija glave (viewBox 0 0 360 440)
const SLOT_Y = [96, 186, 276];
const POST_X = { L: 148, R: 212 };
const KEY_X = { L: 112, R: 248 };
const BTN_X = { L: 44, R: 316 };
const NUT_Y = 420;
const nutX = (i) => 158 + i * 8.8;

function headstockSVG() {
  let strings = '', pegs = '', buttons = '';
  for (const s of STRINGS) {
    const y = SLOT_Y[s.slot];
    const px = POST_X[s.side], kx = KEY_X[s.side], bx = BTN_X[s.side];
    strings += `<line class="hs-string" data-s="${s.id}" x1="${nutX(s.id)}" y1="${NUT_Y}" x2="${px}" y2="${y}" stroke-width="${(2.6 - s.id * 0.3).toFixed(1)}"/>`;
    pegs += `<g class="peg" data-s="${s.id}">
      <rect class="peg-shaft" x="${Math.min(kx, px)}" y="${y - 4}" width="${Math.abs(kx - px)}" height="8" rx="3"/>
      <rect class="peg-key" x="${kx - 10}" y="${y - 17}" width="20" height="34" rx="9"/>
      <circle class="peg-post" cx="${px}" cy="${y}" r="8"/>
    </g>`;
    buttons += `<g class="sbtn" data-s="${s.id}" tabindex="0" role="button" aria-label="Žica ${s.num} (${s.full})">
      <circle class="sbtn-c" cx="${bx}" cy="${y}" r="29"/>
      <text class="sbtn-t" x="${bx}" y="${y + 8}" text-anchor="middle">${s.label}</text>
    </g>`;
  }
  return `<svg class="headstock" viewBox="0 0 360 440" xmlns="http://www.w3.org/2000/svg" aria-label="Glava gitare">
    <defs>
      <linearGradient id="hsWood" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#3b2c24"/><stop offset="1" stop-color="#211819"/>
      </linearGradient>
    </defs>
    <path class="hs-body" d="M 136 440 L 122 54 Q 124 22 154 16 Q 180 10 206 16 Q 236 22 238 54 L 224 440 Z" fill="url(#hsWood)"/>
    <path class="hs-inlay" d="M 164 42 Q 180 30 196 42 Q 180 54 164 42 Z"/>
    <rect class="hs-nut" x="150" y="${NUT_Y - 4}" width="60" height="8" rx="2"/>
    ${strings}
    ${pegs}
    ${buttons}
  </svg>`;
}

export function createTuner(root) {
  root.innerHTML = `
  <section class="view tuner-view">
    <header class="view-head">
      <h1>Tuner</h1>
      <label class="switch">
        <input type="checkbox" id="tAuto" checked>
        <span class="switch-track"><span class="switch-thumb"></span></span>
        <span>Automatski</span>
      </label>
    </header>
    <div class="tmeter" id="tMeter" data-state="idle" aria-live="polite">
      <div class="tmeter-scale" aria-hidden="true">
        <span class="tmeter-sym">♭</span>
        <div class="tmeter-track">
          ${Array.from({ length: 11 }, (_, i) => `<i class="tick${i === 5 ? ' mid' : ''}" style="left:${i * 10}%"></i>`).join('')}
          <div class="tmeter-center"></div>
          <div class="tmeter-dot" id="tDot"><span id="tNote">–</span></div>
        </div>
        <span class="tmeter-sym">♯</span>
      </div>
    </div>
    <div class="headstock-wrap" id="tHead">${headstockSVG()}</div>
    <div class="tuner-foot"><button class="btn small" id="tReset">Resetuj</button></div>
    <div class="mic-overlay" id="tStart">
      <div class="mic-card">
        <button class="mic-btn" id="tStartBtn" aria-label="Pokreni tuner">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2z"/></svg>
        </button>
        <p class="mic-label" id="tStartLabel">Pokreni tuner</p>
        <p class="err" id="tStartMsg" hidden></p>
      </div>
    </div>
  </section>`;

  const $ = (id) => root.querySelector('#' + id);
  const meter = $('tMeter');
  const dot = $('tDot');
  const autoEl = $('tAuto');

  let auto = true;
  let selected = 0;
  let current = null;
  let running = false;
  let mic = null, analyser = null, buf = null, raf = 0;
  let history = [];
  let smoothCents = 0;
  let lastHeard = 0;
  let candidate = null, candidateCount = 0;
  let a4 = 440;
  let lastProc = 0;
  let okSince = 0, okString = -1;
  const done = new Set();

  settings.get('a4', 440).then((v) => (a4 = Number(v) || 440));

  const strEls = (id) => root.querySelectorAll(`[data-s="${id}"]`);

  function markActive(id) {
    root.querySelectorAll('.peg, .sbtn, .hs-string').forEach((el) => el.classList.toggle('active', +el.dataset.s === id));
  }
  function markDone(id) {
    done.add(id);
    strEls(id).forEach((el) => el.classList.add('done'));
  }
  function resetDone() {
    done.clear();
    okSince = 0; okString = -1;
    root.querySelectorAll('.done').forEach((el) => el.classList.remove('done'));
  }

  function setString(id, manual) {
    if (manual) {
      auto = false;
      autoEl.checked = false;
      selected = id;
    }
    current = id;
    history = [];
    okSince = 0;
    markActive(id);
  }

  autoEl.addEventListener('change', () => {
    auto = autoEl.checked;
    if (!auto) setString(current ?? selected, true);
    else { current = null; idle(); }
  });
  root.querySelectorAll('.sbtn').forEach((el) => {
    const pick = () => setString(+el.dataset.s, true);
    el.addEventListener('click', pick);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  });
  $('tReset').addEventListener('click', resetDone);

  function idle() {
    meter.dataset.state = 'idle';
    $('tNote').textContent = auto || current === null ? '–' : STRINGS[current].label;
    dot.style.left = '50%';
    okSince = 0;
    if (auto) root.querySelectorAll('.peg, .sbtn, .hs-string').forEach((el) => el.classList.remove('active'));
  }

  function nearestString(freq) {
    const m = freqToMidi(freq, a4);
    let best = 0, bd = Infinity;
    for (const s of STRINGS) { const d = Math.abs(m - s.midi); if (d < bd) { bd = d; best = s.id; } }
    return best;
  }

  function show(freq, now) {
    const sorted = [...history].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    let sid;
    if (auto) {
      const n = nearestString(med);
      if (current === null) setString(n, false);
      else if (n !== current) {
        if (candidate === n) candidateCount++; else { candidate = n; candidateCount = 1; }
        if (candidateCount >= 4) { setString(n, false); candidate = null; history = [freq]; }
      } else candidate = null;
      sid = current;
    } else sid = selected;
    const target = midiToFreq(STRINGS[sid].midi, a4);
    const cents = 1200 * Math.log2(med / target);
    smoothCents = meter.dataset.state === 'idle' ? cents : smoothCents + (cents - smoothCents) * 0.35;
    const c = smoothCents;
    $('tNote').textContent = midiName(freqToMidi(med, a4)).name;
    const pos = 50 + (Math.max(-RANGE, Math.min(RANGE, c)) / RANGE) * 50;
    dot.style.left = pos.toFixed(2) + '%';
    const ok = Math.abs(c) <= IN_TUNE;
    meter.dataset.state = ok ? 'ok' : 'off';
    if (ok) {
      if (okString !== sid) { okString = sid; okSince = now; }
      else if (!okSince) okSince = now;
      if (now - okSince >= HOLD_MS && !done.has(sid)) markDone(sid);
    } else okSince = 0;
  }

  function loop(t) {
    raf = requestAnimationFrame(loop);
    if (t - lastProc < 33) return; // ~30 obrada u sekundi
    lastProc = t;
    analyser.getFloatTimeDomainData(buf);
    const level = rms(buf);
    const now = performance.now();
    if (level > 0.006) {
      const r = yin(buf, mic.ctx.sampleRate, { minFreq: 65, maxFreq: 1000 });
      if (r && r.prob > 0.85) {
        const f = r.freq;
        if (history.length) {
          const sorted = [...history].sort((a, b) => a - b);
          const med = sorted[Math.floor(sorted.length / 2)];
          if (Math.abs(1200 * Math.log2(f / med)) > 80) history = [];
        }
        history.push(f);
        if (history.length > 7) history.shift();
        lastHeard = now;
        if (history.length >= 3) show(f, now);
        return;
      }
    }
    if (meter.dataset.state !== 'idle' && now - lastHeard > 1400) { history = []; if (auto) current = null; idle(); }
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
      idle();
      raf = requestAnimationFrame(loop);
    } catch (e) {
      $('tStartMsg').textContent = e instanceof MicError ? e.message : 'Mikrofon nije moguće pokrenuti.';
      $('tStartMsg').hidden = false;
      $('tStartLabel').textContent = 'Pokušaj ponovo';
    } finally {
      $('tStartBtn').disabled = false;
    }
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    try { mic.source.disconnect(analyser); } catch {}
    closeMic();
    mic = null;
    $('tStart').hidden = false;
    $('tStartLabel').textContent = 'Pokreni tuner';
  }

  $('tStartBtn').addEventListener('click', start);
  idle();

  return {
    // Na mobilnim uređajima mikrofon mora da se pokrene dodirom korisnika.
    show() {},
    hide: stop,
  };
}

