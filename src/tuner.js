// Tab "Tuner": hromatski štimer za standardno štimovanje gitare.
import { openMic, closeMic, yin, rms, MicError } from './audio.js';
import { midiToFreq, freqToMidi, midiName } from './music.js';
import { settings } from './db.js';
import { esc } from './ui.js';

// Žice od najdublje: indeks 0 = E2 (6. žica)
const STRINGS = [
  { id: 0, label: 'E', full: 'E2', midi: 40, side: 'L', slot: 2, num: 6 },
  { id: 1, label: 'A', full: 'A2', midi: 45, side: 'L', slot: 1, num: 5 },
  { id: 2, label: 'D', full: 'D3', midi: 50, side: 'L', slot: 0, num: 4 },
  { id: 3, label: 'G', full: 'G3', midi: 55, side: 'R', slot: 0, num: 3 },
  { id: 4, label: 'B', full: 'B3', midi: 59, side: 'R', slot: 1, num: 2 },
  { id: 5, label: 'e', full: 'E4', midi: 64, side: 'R', slot: 2, num: 1 },
];

const IN_TUNE = 5; // ±centi

function headstockSVG() {
  const slotY = [78, 150, 222];
  const postX = { L: 92, R: 148 };
  const keyX = { L: 30, R: 210 };
  const nutY = 318;
  const nutX = (i) => 99 + i * 8.4;
  let pegs = '';
  let strings = '';
  for (const s of STRINGS) {
    const y = slotY[s.slot];
    const px = postX[s.side];
    const kx = keyX[s.side];
    const dir = s.side === 'L' ? -1 : 1;
    strings += `<line class="hs-string" data-s="${s.id}" x1="${nutX(s.id)}" y1="${nutY}" x2="${px - dir * 4}" y2="${y}" stroke-width="${2.2 - s.id * 0.25}"/>`;
    pegs += `<g class="peg" data-s="${s.id}" data-side="${s.side}" tabindex="0" role="button" aria-label="Žica ${s.num} (${s.full})">
      <rect class="peg-hit" x="${Math.min(kx, px) - 26}" y="${y - 26}" width="${Math.abs(kx - px) + 52}" height="52" fill="transparent"/>
      <rect class="peg-shaft" x="${Math.min(kx, px)}" y="${y - 4}" width="${Math.abs(kx - px)}" height="8" rx="3"/>
      <circle class="peg-post" cx="${px}" cy="${y}" r="7"/>
      <ellipse class="peg-key" cx="${kx}" cy="${y}" rx="19" ry="23"/>
      <text class="peg-label" x="${kx}" y="${y + 6}" text-anchor="middle">${s.label}</text>
      <g transform="translate(${kx} ${y})"><g class="peg-arrow">
        <path class="peg-arrow-arc" d="M -27 -6 A 28 28 0 0 1 6 -28" fill="none"/>
        <path class="peg-arrow-head" d="M 6 -28 l -9 -5 l 1 10 z"/>
      </g></g>
    </g>`;
  }
  return `<svg class="headstock" viewBox="0 0 240 340" xmlns="http://www.w3.org/2000/svg" aria-label="Glava gitare">
    <defs>
      <linearGradient id="hsWood" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#3a2a22"/><stop offset="1" stop-color="#22181a"/>
      </linearGradient>
    </defs>
    <path class="hs-body" d="M 74 330 L 64 40 Q 66 14 92 10 Q 120 4 148 10 Q 174 14 176 40 L 166 330 Z" fill="url(#hsWood)"/>
    <path class="hs-inlay" d="M 104 34 Q 120 22 136 34 Q 120 46 104 34 Z"/>
    <rect class="hs-nut" x="90" y="${nutY - 3}" width="60" height="7" rx="2"/>
    ${strings}
    ${pegs}
  </svg>`;
}

function meterSVG() {
  let ticks = '';
  for (let c = -50; c <= 50; c += 5) {
    const a = (c / 50) * 60 * (Math.PI / 180);
    const r1 = c % 25 === 0 ? 84 : c % 10 === 0 ? 89 : 92;
    const x1 = 120 + Math.sin(a) * r1, y1 = 120 - Math.cos(a) * r1;
    const x2 = 120 + Math.sin(a) * 98, y2 = 120 - Math.cos(a) * 98;
    ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="m-tick${c === 0 ? ' zero' : ''}"/>`;
  }
  const arc = (from, to, r) => {
    const a1 = (from / 50) * 60 * Math.PI / 180, a2 = (to / 50) * 60 * Math.PI / 180;
    return `M ${120 + Math.sin(a1) * r} ${120 - Math.cos(a1) * r} A ${r} ${r} 0 0 1 ${120 + Math.sin(a2) * r} ${120 - Math.cos(a2) * r}`;
  };
  return `<svg class="meter" viewBox="0 0 240 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="${arc(-50, 50, 104)}" class="m-arc"/>
    <path d="${arc(-IN_TUNE, IN_TUNE, 104)}" class="m-zone"/>
    ${ticks}
    <text x="22" y="132" class="m-sym">♭</text>
    <text x="206" y="132" class="m-sym">♯</text>
    <g class="m-needle"><line x1="120" y1="120" x2="120" y2="26"/><circle cx="120" cy="120" r="7"/></g>
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
    <div class="tuner-readout" id="tReadout" data-state="idle">
      <div class="t-note"><span id="tNote">–</span><sub id="tOct"></sub></div>
      <div class="t-meta"><span id="tCents">&nbsp;</span><span id="tFreq"></span></div>
      ${meterSVG()}
      <div class="t-instr" id="tInstr">Odsviraj bilo koju žicu</div>
    </div>
    <div class="headstock-wrap" id="tHead">${headstockSVG()}</div>
    <div class="string-row" id="tStrings" role="group" aria-label="Izbor žice">
      ${STRINGS.map((s) => `<button class="string-btn" data-s="${s.id}" aria-label="Žica ${s.num} ${s.full}"><b>${s.label}</b><small>${s.full}</small></button>`).join('')}
    </div>
    <p class="hint small" id="tHint">Smer okretanja je prikazan za klasičnu glavu 3+3 gledano spreda.</p>
    <div class="mic-overlay" id="tStart">
      <div class="mic-card">
        <div class="mic-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2z"/></svg>
        </div>
        <p id="tStartMsg">Tuner koristi mikrofon da čuje gitaru.</p>
        <button class="btn primary big" id="tStartBtn">Pokreni tuner</button>
      </div>
    </div>
  </section>`;

  const $ = (id) => root.querySelector('#' + id);
  const readout = $('tReadout');
  const needle = root.querySelector('.m-needle');
  const autoEl = $('tAuto');

  let auto = true;
  let selected = 0; // ručno izabrana žica
  let current = null; // žica koju trenutno pratimo
  let running = false;
  let mic = null, analyser = null, buf = null, raf = 0;
  let history = [];
  let smoothCents = 0;
  let lastHeard = 0;
  let candidate = null, candidateCount = 0;
  let a4 = 440;
  let lastProc = 0;

  settings.get('a4', 440).then((v) => (a4 = Number(v) || 440));

  function setString(id, manual) {
    if (manual) {
      auto = false;
      autoEl.checked = false;
      selected = id;
    }
    current = id;
    history = [];
    root.querySelectorAll('.peg, .string-btn, .hs-string').forEach((el) => el.classList.toggle('active', +el.dataset.s === id));
  }

  autoEl.addEventListener('change', () => {
    auto = autoEl.checked;
    if (!auto) setString(current ?? selected, true);
    else { current = null; idle(); }
  });
  root.querySelectorAll('.string-btn, .peg').forEach((el) => {
    const pick = () => setString(+el.dataset.s, true);
    el.addEventListener('click', pick);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  });

  function idle() {
    readout.dataset.state = 'idle';
    $('tNote').textContent = auto || current === null ? '–' : STRINGS[current].label;
    $('tOct').textContent = '';
    $('tCents').innerHTML = '&nbsp;';
    $('tFreq').textContent = '';
    $('tInstr').textContent = auto ? 'Odsviraj bilo koju žicu' : `Odsviraj ${STRINGS[current ?? selected].num}. žicu (${STRINGS[current ?? selected].full})`;
    needle.style.transform = 'rotate(0deg)';
    root.querySelectorAll('.peg').forEach((p) => p.classList.remove('up', 'down', 'ok'));
    if (auto) root.querySelectorAll('.peg, .string-btn, .hs-string').forEach((el) => el.classList.remove('active'));
  }

  function nearestString(freq) {
    const m = freqToMidi(freq, a4);
    let best = 0, bd = Infinity;
    for (const s of STRINGS) { const d = Math.abs(m - s.midi); if (d < bd) { bd = d; best = s.id; } }
    return best;
  }

  function show(freq) {
    // Medijana poslednjih očitavanja za stabilnost
    const sorted = [...history].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    let sid;
    if (auto) {
      const n = nearestString(med);
      if (current === null) { setString(n, false); }
      else if (n !== current) {
        if (candidate === n) candidateCount++; else { candidate = n; candidateCount = 1; }
        if (candidateCount >= 4) { setString(n, false); candidate = null; history = [freq]; }
      } else { candidate = null; }
      sid = current;
    } else sid = selected;
    const target = midiToFreq(STRINGS[sid].midi, a4);
    const cents = 1200 * Math.log2(med / target);
    smoothCents = readout.dataset.state === 'idle' ? cents : smoothCents + (cents - smoothCents) * 0.35;
    const c = smoothCents;
    const nn = midiName(freqToMidi(med, a4));
    $('tNote').textContent = nn.name;
    $('tOct').textContent = nn.octave;
    $('tFreq').textContent = med.toFixed(1) + ' Hz';
    const shown = Math.round(c);
    $('tCents').textContent = (shown > 0 ? '+' : shown < 0 ? '−' : '±') + Math.abs(shown) + ' ¢';
    const angle = Math.max(-65, Math.min(65, (c / 50) * 60));
    needle.style.transform = `rotate(${angle}deg)`;
    const s = STRINGS[sid];
    const peg = root.querySelector(`.peg[data-s="${sid}"]`);
    root.querySelectorAll('.peg').forEach((p) => p !== peg && p.classList.remove('up', 'down', 'ok'));
    let state, instr;
    if (Math.abs(c) <= IN_TUNE) { state = 'ok'; instr = 'Naštimovano ✓'; }
    else if (c < 0) { state = 'up'; instr = Math.abs(c) > 100 ? `Zategni ${s.num}. žicu (${s.label}) — dosta je nisko` : `Zategni ${s.num}. žicu (${s.label})`; }
    else { state = 'down'; instr = c > 100 ? `Olabavi ${s.num}. žicu (${s.label}) — dosta je visoko` : `Olabavi ${s.num}. žicu (${s.label})`; }
    readout.dataset.state = state;
    $('tInstr').textContent = instr;
    peg.classList.remove('up', 'down', 'ok');
    peg.classList.add(state);
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
        if (history.length >= 3) show(f);
        return;
      }
    }
    if (readout.dataset.state !== 'idle' && now - lastHeard > 1400) { history = []; if (auto) current = null; idle(); }
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
      a4 = Number(await settings.get('a4', 440)) || 440;
      idle();
      raf = requestAnimationFrame(loop);
    } catch (e) {
      $('tStartMsg').innerHTML = `<span class="err">${esc(e instanceof MicError ? e.message : 'Mikrofon nije moguće pokrenuti.')}</span>`;
      $('tStartBtn').textContent = 'Pokušaj ponovo';
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
    $('tStartBtn').textContent = 'Pokreni tuner';
    $('tStartMsg').textContent = 'Tuner koristi mikrofon da čuje gitaru.';
  }

  $('tStartBtn').addEventListener('click', start);
  idle();

  return {
    // Na mobilnim uređajima pokretanje mikrofona traži dodir korisnika, pa ga ne pokrećemo automatski.
    show() {},
    hide: stop,
  };
}
