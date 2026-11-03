// Tab "Akordi": prepoznavanje odsviranog akorda preko hromagrama (beta).
import { t } from './i18n.js';
import { openMic, closeMic, MicError } from './audio.js';
import { QUALITIES, pcName } from './music.js';
import { chordSVG } from './diagram.js';
import { esc } from './ui.js';
import { keepAwake, allowSleep, setWakeZone } from './wakelock.js';
import { createRhythmPane } from './rhythmView.js';
import { createChordDict } from './chordDict.js';
import { SENSITIVITY } from './pitchtrack.js';
import { settings } from './db.js';

const MATCH_QUALITIES = ['', 'm', '7', 'maj7', 'm7', 'sus2', 'sus4'];
// Blaga prednost jednostavnijim akordima (trozvuci su najčešći).
const PRIOR = { '': 0.03, m: 0.03, '7': 0, maj7: -0.005, m7: 0, sus2: -0.02, sus4: -0.02 };

const TEMPLATES = [];
for (let root = 0; root < 12; root++) {
  for (const q of MATCH_QUALITIES) {
    const v = new Float32Array(12);
    QUALITIES[q].intervals.forEach((iv, k) => { v[(root + iv) % 12] += k === 0 ? 1.15 : k === 3 ? 0.8 : 1; });
    TEMPLATES.push({ root, quality: q, v: normalize(v) });
  }
}

function normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

/** Računa hromagram iz FFT spektra (dB). Vraća { chroma, bass, energy }. */
export function chromaFromSpectrum(db, sampleRate, fftSize, a4 = 440) {
  const chroma = new Float32Array(12);
  const bass = new Float32Array(12);
  const binHz = sampleRate / fftSize;
  const kMin = Math.ceil(70 / binHz), kMax = Math.min(Math.floor(2000 / binHz), db.length - 2);
  let peak = -Infinity;
  for (let k = kMin; k <= kMax; k++) if (db[k] > peak) peak = db[k];
  const floor = Math.max(peak - 45, -95);
  let energy = 0;
  const peaks = [];
  for (let k = kMin; k <= kMax; k++) {
    const y1 = db[k];
    if (y1 < floor || y1 < db[k - 1] || y1 < db[k + 1]) continue;
    // Parabolična interpolacija pika
    const y0 = db[k - 1], y2 = db[k + 1];
    const d = (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1);
    const f = (k + d) * binHz;
    const midi = 69 + 12 * Math.log2(f / a4);
    const nearest = Math.round(midi);
    if (Math.abs(midi - nearest) > 0.35) continue;
    const mag = Math.pow(10, (y1 - floor) / 20) - 1;
    const w = mag * (f < 400 ? 1 : 400 / f); // viši harmonici imaju manji uticaj
    const pc = ((nearest % 12) + 12) % 12;
    chroma[pc] += w;
    if (f < 220) bass[pc] += w;
    energy += w;
    peaks.push({ f, w: mag });
  }
  return { chroma, bass, energy, peaks };
}

/**
 * Koliki deo energije objašnjava JEDAN niz harmonika (jedan glas/jedan ton).
 * Akord na gitari ima više osnovnih tonova, pa je ovaj odnos manji; govor/pevanje daju vrednost blizu 1.
 */
export function singleSourceRatio(peaks) {
  const total = peaks.reduce((a, p) => a + p.w, 0);
  if (!total) return 0;
  const cands = peaks.filter((p) => p.f >= 70 && p.f < 400).sort((a, b) => b.w - a.w).slice(0, 4);
  let best = 0;
  for (const c of cands) {
    let explained = 0;
    for (const p of peaks) {
      const h = p.f / c.f;
      const n = Math.round(h);
      if (n >= 1 && Math.abs(h - n) / n < 0.025) explained += p.w;
    }
    best = Math.max(best, explained / total);
  }
  return best;
}

/** Deo frekvencijskih opsega (100–5000 Hz) koji su naglo pojačani — znak udarca preko žica. */
export function broadbandRise(prev, cur, binHz) {
  const k0 = Math.ceil(100 / binHz), k1 = Math.min(Math.floor(5000 / binHz), cur.length - 1);
  let rise = 0, n = 0;
  for (let k = k0; k <= k1; k++) {
    if (cur[k] < -90 && prev[k] < -90) continue;
    n++;
    if (cur[k] - prev[k] > 8) rise++;
  }
  return n ? rise / n : 0;
}

/** Koliko jasno prisutnih tonova (≥ 20 % najjačeg) pripada akordu. */
export function presentChordNotes(acc, root, quality) {
  const max = Math.max(...acc) || 1;
  const tones = new Set(QUALITIES[quality].intervals.map((iv) => (root + iv) % 12));
  let n = 0;
  acc.forEach((x, pc) => { if (x >= 0.2 * max && tones.has(pc)) n++; });
  return n;
}

export function matchChord(chroma, bass) {
  const c = normalize(Float32Array.from(chroma));
  let bassPc = -1, bmax = 0;
  bass.forEach((x, i) => { if (x > bmax) { bmax = x; bassPc = i; } });
  const scored = TEMPLATES.map((t) => {
    let s = 0;
    for (let i = 0; i < 12; i++) s += c[i] * t.v[i];
    s += PRIOR[t.quality];
    if (t.root === bassPc) s += 0.06;
    return { root: t.root, quality: t.quality, score: s };
  }).sort((a, b) => b.score - a.score);
  return scored;
}

const nice = (r) => pcName(r.root, { flat: [3, 8, 10].includes(r.root) }) + r.quality;

export function createChordRec(root) {
  root.innerHTML = `
  <section class="view chordrec-view">
    <header class="view-head">
      <h1>${t('chords.title')}</h1>
    </header>
    <div class="seg-tabs seg3" role="tablist">
      <button role="tab" class="active" data-pane="rec">${t('chords.tabRecognize')} <span class="badge">${t('chords.beta')}</span></button>
      <button role="tab" data-pane="dict">${t('chords.tabDict')}</button>
      <button role="tab" data-pane="rhythm">${t('chords.tabRhythm')}</button>
    </div>
    <div id="crPane">
    <p class="muted">${t('chords.intro')}</p>
    <div class="card cr-result" id="crResult" data-state="idle">
      <div class="cr-name" id="crName">–</div>
      <div class="cr-sub" id="crSub">${t('chords.pressListen')}</div>
      <div class="cr-diagram" id="crDiagram"></div>
      <div class="cr-alt" id="crAlt"></div>
    </div>
    <div class="chroma" id="crChroma" aria-hidden="true">
      ${Array.from({ length: 12 }, (_, i) => `<div class="chroma-col"><div class="chroma-bar"></div><span>${pcName(i)}</span></div>`).join('')}
    </div>
    <button class="btn primary big wide" id="crBtn">${t('chords.listen')}</button>
    <p class="err" id="crErr" hidden></p>
    <p class="hint small">${t('chords.hint')}</p>
    </div>
    <div id="rhPane" hidden></div>
    <div id="dictPane" hidden></div>
  </section>`;

  const $ = (id) => root.querySelector('#' + id);
  const bars = [...root.querySelectorAll('.chroma-bar')];
  let running = false, mic = null, analyser = null, fast = null, spec = null, fspec = null, fprev = null, tbuf = null;
  let timer = 0, onsetTimer = 0;
  const acc = new Float32Array(12), accBass = new Float32Array(12);
  let shownName = null, stable = null, stableSince = 0;
  let lastOnset = -1e9, levels = [];
  let floor = 0, calib = [], calibStart = 0, sens = SENSITIVITY.medium;
  const WINDOW = 1600;     // analiziraj ovoliko ms posle udarca
  const STABLE_MS = 300;   // rezultat mora biti stabilan pre prikaza

  // Brza provera: da li je upravo odsviran akord (nagli skok glasnoće preko celog spektra)?
  function onsetFrame() {
    fast.getFloatFrequencyData(fspec);
    fast.getFloatTimeDomainData(tbuf);
    let sum = 0;
    for (let i = 0; i < tbuf.length; i++) sum += tbuf[i] * tbuf[i];
    const level = Math.sqrt(sum / tbuf.length);
    const prevLevel = levels.length ? levels.reduce((x, y) => x + y, 0) / levels.length : level;
    levels.push(level);
    if (levels.length > 5) levels.shift();
    const now = performance.now();
    const rise = fprev ? broadbandRise(fprev, fspec, mic.ctx.sampleRate / fast.fftSize) : 0;
    fprev = Float32Array.from(fspec);
    // Prag prati buku u prostoriji (prva sekunda = merenje, posle sporo prilagođavanje), kao u tuneru.
    if (now - calibStart < 1000) { calib.push(level); const c = [...calib].sort((a, b) => a - b); floor = c[Math.floor(c.length * 0.6)]; }
    else if (now - lastOnset > WINDOW) floor = level < floor ? floor * 0.9 + level * 0.1 : floor * 0.997 + level * 0.003;
    const onLevel = Math.max(sens.minLevel * 2, floor * sens.onMult);
    if (now - calibStart > 300 && rise > 0.3 && level > Math.max(onLevel, prevLevel * 2) && now - lastOnset > 150) {
      lastOnset = now;
      acc.fill(0); accBass.fill(0);
      stable = null;
    }
  }

  function frame() {
    analyser.getFloatFrequencyData(spec);
    const now = performance.now();
    const inWindow = now - lastOnset < WINDOW;
    if (!inWindow || now - lastOnset < 60) {
      // Bez udarca nema analize (govor i buka se ignorišu); poslednji akord ostaje prikazan.
      bars.forEach((b) => (b.style.transform = `scaleY(${(parseFloat(b.style.transform.slice(7)) * 0.85 || 0).toFixed(3)})`));
      return;
    }
    const { chroma, bass, peaks } = chromaFromSpectrum(spec, mic.ctx.sampleRate, analyser.fftSize);
    const decay = 0.82;
    for (let i = 0; i < 12; i++) { acc[i] = acc[i] * decay + chroma[i]; accBass[i] = accBass[i] * decay + bass[i]; }
    const max = Math.max(...acc) || 1;
    bars.forEach((b, i) => (b.style.transform = `scaleY(${(acc[i] / max).toFixed(3)})`));
    if (singleSourceRatio(peaks) > 0.88) { stable = null; return; } // jedan glas/ton, ne akord
    const res = matchChord(acc, accBass);
    const best = res[0];
    if (best.score < 0.75 || presentChordNotes(acc, best.root, best.quality) < 3) { stable = null; return; }
    const name = nice(best);
    if (stable !== name) { stable = name; stableSince = now; return; }
    if (now - stableSince >= STABLE_MS && name !== shownName) {
      shownName = name;
      const conf = Math.round(Math.min(1, Math.max(0, (best.score - 0.7) / 0.3)) * 100);
      $('crResult').dataset.state = 'found';
      $('crName').textContent = name;
      $('crSub').textContent = t('chords.confidence', { quality: t('q.' + best.quality), pct: conf });
      $('crDiagram').innerHTML = chordSVG(name, { showName: false });
      const alts = res.slice(1, 4).map(nice);
      $('crAlt').innerHTML = `${t('chords.maybe')} ${alts.map((a) => `<b>${esc(a)}</b>`).join(', ')}`;
    }
  }

  function setIdle(msg) {
    shownName = null;
    $('crResult').dataset.state = 'idle';
    $('crName').textContent = '–';
    $('crSub').textContent = msg;
    $('crDiagram').innerHTML = '';
    $('crAlt').textContent = '';
  }

  async function start() {
    $('crErr').hidden = true;
    $('crBtn').disabled = true;
    try {
      mic = await openMic();
      analyser = mic.ctx.createAnalyser();
      analyser.fftSize = 16384;
      analyser.smoothingTimeConstant = 0.5;
      mic.source.connect(analyser);
      spec = new Float32Array(analyser.frequencyBinCount);
      fast = mic.ctx.createAnalyser();
      fast.fftSize = 2048;
      fast.smoothingTimeConstant = 0;
      mic.source.connect(fast);
      fspec = new Float32Array(fast.frequencyBinCount);
      tbuf = new Float32Array(fast.fftSize);
      fprev = null; levels = []; lastOnset = -1e9;
      sens = SENSITIVITY[await settings.get('tunerSens', 'medium')] || SENSITIVITY.medium;
      floor = 0; calib = []; calibStart = performance.now();
      acc.fill(0); accBass.fill(0);
      running = true;
      timer = setInterval(frame, 90);
      onsetTimer = setInterval(onsetFrame, 30);
      keepAwake('chords');
      $('crBtn').textContent = t('chords.stop');
      $('crBtn').classList.remove('primary');
      setIdle(t('chords.listening'));
    } catch (e) {
      $('crErr').textContent = e instanceof MicError ? e.message : t('mic.failed');
      $('crErr').hidden = false;
    } finally {
      $('crBtn').disabled = false;
    }
  }

  function stop() {
    if (!running) return;
    running = false;
    clearInterval(timer);
    clearInterval(onsetTimer);
    try { mic.source.disconnect(analyser); mic.source.disconnect(fast); } catch {}
    allowSleep('chords');
    closeMic();
    mic = null;
    $('crBtn').textContent = t('chords.listen');
    $('crBtn').classList.add('primary');
    bars.forEach((b) => (b.style.transform = 'scaleY(0)'));
    if (!shownName) setIdle(t('chords.pressListen'));
  }

  $('crBtn').addEventListener('click', () => (running ? stop() : start()));

  // Druga sekcija: metronom i ritmovi
  let rhythm = null, dict = null;
  root.querySelectorAll('[data-pane]').forEach((b) => b.addEventListener('click', () => {
    root.querySelectorAll('[data-pane]').forEach((x) => x.classList.toggle('active', x === b));
    const pane = b.dataset.pane;
    $('crPane').hidden = pane !== 'rec';
    $('rhPane').hidden = pane !== 'rhythm';
    $('dictPane').hidden = pane !== 'dict';
    if (pane !== 'rec') stop();
    if (pane === 'rhythm' && !rhythm) rhythm = createRhythmPane($('rhPane'));
    if (pane !== 'rhythm') rhythm?.stop();
    if (pane === 'dict' && !dict) dict = createChordDict($('dictPane'));
    setWakeZone(pane === 'dict' ? 'dict' : null);
  }));
  return {
    show() { if (!$('dictPane').hidden) setWakeZone('dict'); },
    hide() { stop(); rhythm?.stop(); setWakeZone(null); },
  };
}
