// Tab "Akordi": prepoznavanje odsviranog akorda preko hromagrama (beta).
import { openMic, closeMic, MicError } from './audio.js';
import { QUALITIES, pcName } from './music.js';
import { chordSVG } from './diagram.js';
import { esc } from './ui.js';

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
  }
  return { chroma, bass, energy };
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
      <h1>Akordi <span class="badge">beta</span></h1>
    </header>
    <p class="muted">Odsviraj akord nekoliko puta (udaranjem preko svih žica). Aplikacija sluša i pogađa koji je akord.</p>
    <div class="card cr-result" id="crResult" data-state="idle">
      <div class="cr-name" id="crName">–</div>
      <div class="cr-sub" id="crSub">Pritisni „Slušaj“ i odsviraj akord</div>
      <div class="cr-diagram" id="crDiagram"></div>
      <div class="cr-alt" id="crAlt"></div>
    </div>
    <div class="chroma" id="crChroma" aria-hidden="true">
      ${Array.from({ length: 12 }, (_, i) => `<div class="chroma-col"><div class="chroma-bar"></div><span>${pcName(i)}</span></div>`).join('')}
    </div>
    <button class="btn primary big wide" id="crBtn">Slušaj</button>
    <p class="err" id="crErr" hidden></p>
    <p class="hint small">Beta funkcija: najbolje radi u tihoj prostoriji, sa jasno odsviranim akordom. Prepoznaje dur, mol, 7, maj7, m7, sus2 i sus4 u svim tonalitetima.</p>
  </section>`;

  const $ = (id) => root.querySelector('#' + id);
  const bars = [...root.querySelectorAll('.chroma-bar')];
  let running = false, mic = null, analyser = null, spec = null, timer = 0;
  let acc = new Float32Array(12), accBass = new Float32Array(12);
  let shownName = null, shownAt = 0, stable = null, stableCount = 0;

  function frame() {
    analyser.getFloatFrequencyData(spec);
    const { chroma, bass, energy } = chromaFromSpectrum(spec, mic.ctx.sampleRate, analyser.fftSize);
    const decay = 0.82;
    for (let i = 0; i < 12; i++) { acc[i] = acc[i] * decay + chroma[i]; accBass[i] = accBass[i] * decay + bass[i]; }
    const max = Math.max(...acc) || 1;
    bars.forEach((b, i) => (b.style.transform = `scaleY(${(acc[i] / max).toFixed(3)})`));
    const total = acc.reduce((a, b) => a + b, 0);
    const now = performance.now();
    if (energy < 0.5 && total < 3) {
      if (shownName && now - shownAt > 4000) setIdle('Odsviraj akord');
      return;
    }
    const res = matchChord(acc, accBass);
    const best = res[0];
    const name = nice(best);
    if (best.score < 0.72) return;
    if (stable === name) stableCount++; else { stable = name; stableCount = 1; }
    if (stableCount >= 3 && name !== shownName) {
      shownName = name;
      const conf = Math.round(Math.min(1, Math.max(0, (best.score - 0.7) / 0.3)) * 100);
      $('crResult').dataset.state = 'found';
      $('crName').textContent = name;
      $('crSub').textContent = `${QUALITIES[best.quality].label} · sigurnost ${conf}%`;
      $('crDiagram').innerHTML = chordSVG(name, { showName: false });
      const alts = res.slice(1, 4).map(nice);
      $('crAlt').innerHTML = `Možda: ${alts.map((a) => `<b>${esc(a)}</b>`).join(', ')}`;
    }
    if (name === shownName) shownAt = now;
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
      acc.fill(0); accBass.fill(0);
      running = true;
      timer = setInterval(frame, 90);
      $('crBtn').textContent = 'Zaustavi';
      $('crBtn').classList.remove('primary');
      setIdle('Slušam… odsviraj akord');
    } catch (e) {
      $('crErr').textContent = e instanceof MicError ? e.message : 'Mikrofon nije moguće pokrenuti.';
      $('crErr').hidden = false;
    } finally {
      $('crBtn').disabled = false;
    }
  }

  function stop() {
    if (!running) return;
    running = false;
    clearInterval(timer);
    try { mic.source.disconnect(analyser); } catch {}
    closeMic();
    mic = null;
    $('crBtn').textContent = 'Slušaj';
    $('crBtn').classList.add('primary');
    bars.forEach((b) => (b.style.transform = 'scaleY(0)'));
    if (!shownName) setIdle('Pritisni „Slušaj“ i odsviraj akord');
  }

  $('crBtn').addEventListener('click', () => (running ? stop() : start()));
  return { show() {}, hide: stop };
}
