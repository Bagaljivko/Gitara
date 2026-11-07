// Tab "Tuner": štimer za gitaru (standardno E A D G B E, Drop D, pola tona niže, DADGAD, Open G).
// Kazaljka (♭ — ♯), velika nota, glava gitare sa okruglim dugmićima za žice.
import { openMic, closeMic, MicError } from './audio.js';
import { PitchTracker } from './pitchtrack.js';
import { settings } from './db.js';
import { t } from './i18n.js';
import { midiName } from './music.js';
import { keepAwake, allowSleep } from './wakelock.js';
import { pluck } from './synth.js';
import { dialog, esc } from './ui.js';
import { createWave } from './tunerWave.js';
import { tunerSettingsHTML, bindTunerSettings, loadTunerSettings, roomToSensitivity } from './tunerSettings.js';
import { KNOBS, ART_W, ART_H } from './headstockKnobs.js';
import { TUNING_IDS, tuningOf, cleanTuning, tuningNotes } from './tunings.js';
import { dn } from './naming.js';

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
const DONE_AVG = 4;      // žica je gotova čim je stabilan ton unutar ±4 centi (prosek poslednjih ~3 očitavanja) — bez čekanja
const UNDO_CENTS = 10, UNDO_MS = 500; // označena žica koja posle jasno odstupa (preko ±10 c, pola sekunde) — oznaka se skida
const LOST_MS = 500;     // kratak prekid (ruka dodirne žicu, žica se gasi) ne poništava ni kazaljku ni brojanje do „gotovo“
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
    <defs>
      <linearGradient id="nmSteel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5f646c"/><stop offset=".35" stop-color="#e9edf2"/><stop offset=".5" stop-color="#fff"/><stop offset=".65" stop-color="#b9bfc7"/><stop offset="1" stop-color="#4c5158"/></linearGradient>
      <linearGradient id="nmSteelLen" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient>
      <radialGradient id="nmChrome" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".25" stop-color="#dfe3e8"/><stop offset=".6" stop-color="#8d939b"/><stop offset=".85" stop-color="#4a4f56"/><stop offset="1" stop-color="#2a2d32"/></radialGradient>
      <radialGradient id="nmChromeIn" cx=".6" cy=".7" r=".8"><stop offset="0" stop-color="#f4f6f8"/><stop offset=".5" stop-color="#9aa0a8"/><stop offset="1" stop-color="#3d4148"/></radialGradient>
      <filter id="nmShadow" x="-50%" y="-20%" width="200%" height="140%"><feDropShadow dx="1.2" dy="2" stdDeviation="1.4" flood-color="#000" flood-opacity=".6"/></filter>
    </defs>
    <g class="nm-needle" id="tNeedle"><g filter="url(#nmShadow)">
      <path class="nm-blade" d="M ${cx - 3.6} ${cy - 6} L ${cx - 0.9} ${cy - R + 8} L ${cx} ${cy - R + 5} L ${cx + 0.9} ${cy - R + 8} L ${cx + 3.6} ${cy - 6} Z" style="fill:url(#nmSteel)"/>
      <path d="M ${cx - 3.6} ${cy - 6} L ${cx - 0.9} ${cy - R + 8} L ${cx} ${cy - R + 5} L ${cx + 0.9} ${cy - R + 8} L ${cx + 3.6} ${cy - 6} Z" style="fill:url(#nmSteelLen)"/>
      <circle cx="${cx}" cy="${cy}" r="11" style="fill:url(#nmChrome)"/>
      <circle cx="${cx}" cy="${cy}" r="7" style="fill:url(#nmChromeIn)" stroke="rgba(0,0,0,.35)" stroke-width=".8"/>
      <circle cx="${cx}" cy="${cy}" r="2.2" style="fill:#2b2e33"/>
    </g></g>
  </svg>`;
}

// Glava gitare: fotografija (assets/headstock.webp) + SVG sloj sa tačnim obrisima šest ključeva.
// Koordinate su u procentima slike, pa se slojevi poklapaju na svakoj veličini ekrana.
function headstockArt() {
  const sx = ART_W / 100, sy = ART_H / 100;
  const pts = (k) => k.pts.split(' ').map((p) => { const [x, y] = p.split(',').map(Number); return `${(x * sx).toFixed(1)},${(y * sy).toFixed(1)}`; }).join(' ');
  const knobs = KNOBS.map((k) => {
    const s = STRINGS[k.id];
    return `<g class="knob" data-s="${k.id}" tabindex="0" role="button" aria-label="${t('tuner.string', { num: s.num, note: s.full })}">
      <circle class="knob-hit" cx="${(k.cx * sx).toFixed(1)}" cy="${(k.cy * sy).toFixed(1)}" r="62"/>
      <polygon class="knob-shape" points="${pts(k)}"/>
      <text class="knob-label" x="${(k.cx * sx).toFixed(1)}" y="${(k.cy * sy + 17).toFixed(1)}" text-anchor="middle">${s.label === 'e' ? 'E' : s.label}</text>
    </g>`;
  }).join('');
  return `<div class="hs-art">
    <img src="assets/headstock.webp" alt="" width="${ART_W}" height="${ART_H}" decoding="async" draggable="false">
    <svg class="hs-overlay" viewBox="0 0 ${ART_W} ${ART_H}" xmlns="http://www.w3.org/2000/svg" aria-label="${t('tuner.headstock')}">
      <defs>
        <filter id="glowGreen" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur in="SourceAlpha" stdDeviation="9" result="b"/><feFlood flood-color="#3dd68c" flood-opacity=".85"/><feComposite in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <filter id="glowOrange" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur in="SourceAlpha" stdDeviation="9" result="b"/><feFlood flood-color="#f5a524" flood-opacity=".9"/><feComposite in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <filter id="labelShadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000" flood-opacity=".6"/></filter>
      </defs>
      ${knobs}
    </svg>
  </div>`;
}

// Vibracija: Android (navigator.vibrate). iPhone ne dozvoljava vibraciju sajtovima; na iOS 18+ dodir
// skrivenog sistemskog prekidača daje lagani „tap“ — koristi se umesto toga (stariji iPhone: bez vibracije).
let iosTap = null;
function hapticTap() {
  try {
    if (!iosTap) {
      iosTap = document.createElement('label');
      iosTap.setAttribute('aria-hidden', 'true');
      iosTap.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
      iosTap.innerHTML = '<input type="checkbox" switch tabindex="-1">';
      document.body.appendChild(iosTap);
    }
    iosTap.click();
  } catch {}
}
const buzz = (p) => {
  try {
    if (navigator.vibrate && navigator.vibrate(p)) return;
  } catch {}
  // bez navigator.vibrate (iPhone): onoliko „tapova“ koliko ima udara u šablonu
  const taps = Array.isArray(p) ? Math.ceil(p.length / 2) : 1;
  for (let i = 0; i < taps; i++) setTimeout(hapticTap, i * 140);
};
const BUZZ_STRING = [35, 70, 35];            // jedna žica: dva kratka udara
const BUZZ_ALL = [60, 80, 60, 80, 220];        // sve žice: duži šablon

export function createTuner(root) {
  root.innerHTML = `
  <section class="view tuner-view">
    <header class="view-head tuner-head">
      <h1>${t('tuner.title')}</h1>
      <label class="auto-switch" title="${esc(t('tuner.autoHint'))}">
        <input type="checkbox" id="tAuto" checked aria-label="${esc(t('tuner.autoHint'))}">
        <span class="auto-track"><span class="auto-word">AUTO</span><span class="auto-thumb"></span></span>
      </label>
      <button class="icon-btn tuner-set" id="tSet" type="button" aria-haspopup="dialog" aria-label="${esc(t('tuner.settings'))}" title="${esc(t('tuner.settings'))}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><path d="M7.5 3.5c1.6-.9 3-1 4.5-.3 1.5-.7 2.9-.6 4.5.3l-.9 13.3-1.6 3.7h-4l-1.6-3.7z"/><path d="M7.4 7H4.6M7.6 11H4.6M7.8 15H4.6M16.6 7h2.8M16.4 11h2.8M16.2 15h2.8"/><circle cx="4" cy="7" r="1.3"/><circle cx="4" cy="11" r="1.3"/><circle cx="4" cy="15" r="1.3"/><circle cx="20" cy="7" r="1.3"/><circle cx="20" cy="11" r="1.3"/><circle cx="20" cy="15" r="1.3"/></svg></button>
      <div class="tuner-prog" id="tProg" role="group" hidden>
        <span class="prog-dots" id="tProgDots"></span><b class="prog-div" aria-hidden="true"></b>
        <button class="prog-x" id="tProgX" type="button" aria-label="${esc(t('tuner.resetBtn'))}" title="${esc(t('tuner.resetBtn'))}">×</button>
      </div>
    </header>
    <div class="nwrap" id="tMeter" data-state="idle" aria-live="polite">
      ${needleSVG()}
      <div class="nnote" id="tNote">–</div>
      <div class="ncents" id="tCents">&nbsp;</div>
    </div>
    <div class="headstock-wrap" id="tHead">${headstockArt()}</div>
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
  const wave = createWave(meter); // talas preko skale
  const needle = $('tNeedle');
  const autoEl = $('tAuto');

  let auto = true;
  let selected = 0;
  let running = false;
  let mic = null, analyser = null, buf = null, timer = 0;
  let a4 = 440;
  const tracker = new PitchTracker({ a4 });
  let tuning = 'standard';
  const noteOf = (id) => dn(tuningOf(tuning).names[id]);
  let shownCents = 0;     // izglađen položaj kazaljke
  let shownSid = -1;
  let shownCal = false;   // prikazana poruka „merim buku“
  let okSince = 0, okSid = -1, okHist = [], offSince = 0, offSid = -1;
  // jak znak „gotovo“: nota zeleno zasvetli i pulsira (bez teksta)
  let flashT = 0;
  const flashDone = () => { meter.classList.remove('just-done'); void meter.offsetWidth; meter.classList.add('just-done'); clearTimeout(flashT); flashT = setTimeout(() => meter.classList.remove('just-done'), 900); };
  let lastLocked = 0;

  settings.get('a4', 440).then((v) => { a4 = Number(v) || 440; tracker.a4 = a4; });

  const markActive = (id) => root.querySelectorAll('.knob').forEach((el) => el.classList.toggle('active', +el.dataset.s === id));
  const applyDone = () => { root.querySelectorAll('.knob').forEach((el) => el.classList.toggle('done', done.has(+el.dataset.s))); drawProgress(); };
  // „✓ 3/6“: koliko je žica naštimovano; dodir = ispočetka (uz „Poništi“)
  function drawProgress() {
    const b = $('tProg');
    if (!b) return;
    const n = done.size;
    b.hidden = n === 0;
    b.classList.toggle('all', n === 6);
    // jedna tačka po žici, redom E A D G H E — zelene su naštimovane
    $('tProgDots').innerHTML = [0, 1, 2, 3, 4, 5].map((s) => `<i class="${done.has(s) ? 'on' : ''}"></i>`).join('');
    b.setAttribute('aria-label', t('tuner.progress', { n }));
    root.querySelector('.tuner-view').classList.toggle('all-tuned', n === 6);
    if (meter.dataset.state === 'idle') idle();
  }
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
    const f = a4 * Math.pow(2, (tuningOf(tuning).midi[id] - 69) / 12);
    const ms = pluck(f, { duration: 3, gain: 0.95 });
    tracker.mute(ms + 400, performance.now()); // sopstveni ton ne sme da pokrene tuner
    const btn = root.querySelector(`.knob[data-s="${id}"]`);
    btn.classList.add('ringing');
    setTimeout(() => btn.classList.remove('ringing'), ms * 0.6);
  }
  root.querySelectorAll('.knob').forEach((el) => {
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
  $('tProgX').addEventListener('click', resetAll); // samo ✕ počinje ispočetka

  function setNeedle(c) {
    const clamped = Math.max(-RANGE * 1.1, Math.min(RANGE * 1.1, c));
    needle.style.transform = `rotate(${((clamped / RANGE) * 70).toFixed(2)}deg)`;
  }

  function idle() {
    wave.set({ active: false });
    meter.dataset.state = 'idle';
    const ready = done.size === 6;
    meter.classList.toggle('ready', ready);
    $('tNote').textContent = ready ? t('tuner.ready') : auto ? '–' : noteOf(selected);
    $('tCents').innerHTML = '&nbsp;';
    shownCents = 0;
    shownSid = -1;
    shownCal = false;
    setNeedle(0);
    okSince = 0;
    if (auto) root.querySelectorAll('.knob').forEach((el) => el.classList.remove('active'));
  }



  function frame() {
    analyser.getFloatTimeDomainData(buf);
    const now = performance.now();
    const r = tracker.process(buf, mic.ctx.sampleRate, now);
    if (r.state === 'tracking') {
      lastLocked = now;
      const sid = r.sid;
      if (auto) markActive(sid);
      // Prvo očitavanje odmah pomera kazaljku; posle toga lagano izglađivanje:
      // veći pomak → brže praćenje, sitno podrhtavanje (< 0,8 centa) se ignoriše.
      const fresh = meter.dataset.state === 'idle' || sid !== shownSid;
      const d = r.cents - shownCents;
      // Daleko od tona kazaljka brzo stiže; blizu cilja je mirna (sitno podrhtavanje se ne vidi).
      const ad = Math.abs(d);
      if (fresh) shownCents = r.cents;
      else if (ad > 0.6) shownCents += d * (ad > 10 ? 0.8 : ad > 3 ? 0.5 : 0.22);
      shownSid = sid;
      setNeedle(shownCents);
      $('tNote').textContent = dn(midiName(69 + 12 * Math.log2(r.freq / a4)).name);
      const cr = Math.round(shownCents);
      const ac = Math.abs(cr), m10 = ac % 10, m100 = ac % 100;
      const form = m10 === 1 && m100 !== 11 ? 'tuner.cents1' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'tuner.cents2' : 'tuner.cents';
      $('tCents').textContent = t(form, { n: (cr > 0 ? '+' : cr < 0 ? '−' : '±') + ac });
      // Zeleno (i označavanje žice) tek kad je ton stabilan
      // Mala histereza: kad je već zeleno, kratko podrhtavanje do ±8 centi ga ne gasi.
      const lim = meter.dataset.state === 'ok' ? IN_TUNE + 3 : IN_TUNE;
      const ok = r.stable && Math.abs(shownCents) <= lim;
      meter.dataset.state = ok ? 'ok' : 'off';
      // talas: visina prati jačinu žice, klizanje prati koliko je žica daleko od tona
      let e = 0; for (let i = 0; i < buf.length; i += 8) e += buf[i] * buf[i];
      const lvl = Math.sqrt(e / (buf.length / 8));
      wave.set({ active: true, cents: shownCents, ok, level: Math.max(0.35, Math.min(1, 0.35 + Math.log10(Math.max(lvl, 1e-5) / 0.003) * 0.5)) });
      if (ok) {
        // Čim je ton na mestu — žica je gotova (bez čekanja): prosek poslednjih ~3 očitavanja unutar ±4 c.
        if (okSid !== sid || !okSince) { okSid = sid; okSince = now; okHist = []; }
        okHist.push({ t: now, c: r.cents });
        while (okHist.length && now - okHist[0].t > 70) okHist.shift();
        const avg = okHist.reduce((a, x) => a + x.c, 0) / okHist.length;
        if (Math.abs(avg) <= DONE_AVG && !done.has(sid)) {
          done.add(sid);
          applyDone();
          buzz(done.size === 6 ? BUZZ_ALL : BUZZ_STRING);
          drawProgress();
          flashDone();
        }
      } else if (Math.abs(shownCents) > lim) okSince = 0;
      // Označena žica koja posle jasno odstupa (preokrenut ključ) — oznaka se skida, da ne ostane pogrešna kvačica
      if (done.has(sid) && r.stable && Math.abs(shownCents) > UNDO_CENTS) {
        if (offSid !== sid || !offSince) { offSid = sid; offSince = now; }
        else if (now - offSince >= UNDO_MS) { done.delete(sid); offSince = 0; applyDone(); drawProgress(); }
      } else offSince = 0;
    } else if (meter.dataset.state !== 'idle' && now - lastLocked > LOST_MS) {
      idle();
    } else if (meter.dataset.state === 'idle') {
      okSince = 0;
      const cal = tracker.calibrating;
      if (cal !== shownCal) { shownCal = cal; $('tCents').textContent = cal ? t('tuner.calibrating') : '\u00a0'; }
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
      tracker.setSensitivity(roomToSensitivity((await loadTunerSettings()).room));
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
    wave.stop();
    try { mic.source.disconnect(analyser); } catch {}
    closeMic();
    mic = null;
    allowSleep('tuner');
    $('tStart').hidden = false;
    $('tStartLabel').textContent = t('tuner.start');
  }

  // ---- Štimovanje (standardno, Drop D, pola tona niže…) ----
  function applyTuning(id) {
    const next = cleanTuning(id);
    const changed = next !== tuning;
    tuning = next;
    const tu = tuningOf(tuning);
    tracker.setTuning(tu.midi);
    root.querySelectorAll('.knob').forEach((g) => {
      const i = +g.dataset.s;
      g.querySelector('.knob-label').textContent = dn(tu.names[i]);
      g.setAttribute('aria-label', t('tuner.string', { num: STRINGS[i].num, note: dn(tu.names[i]) + (Math.floor(tu.midi[i] / 12) - 1) }));
    });
    if (changed) { done.clear(); applyDone(); okSince = 0; }
    idle();
  }
  // ---- Panel „Podešavanja tunera“ (ikonica klizača): štimovanje, soba, A4 — menja se odmah ----
  $('tSet').addEventListener('click', async () => {
    const st = await loadTunerSettings();
    const p = dialog({ title: t('tuner.settings'), body: tunerSettingsHTML(st), html: true, className: 'tset-modal', buttons: [] });
    const box = [...document.querySelectorAll('.tset-modal')].pop();
    if (box) bindTunerSettings(box, st, (ch) => {
      if (ch.tuning) applyTuning(ch.tuning);
      if (ch.room) tracker.setSensitivity(roomToSensitivity(ch.room));
      if (ch.a4) { a4 = ch.a4; tracker.a4 = a4; }
    });
    await p;
  });
  const loadTuning = async () => applyTuning(await settings.get('tuning', 'standard'));
  applyTuning('standard');
  loadTuning();

  $('tStartBtn').addEventListener('click', start);
  idle();

  return {
    // Na mobilnim uređajima mikrofon mora da se pokrene dodirom korisnika.
    show() { loadTuning(); },
    hide: stop,
  };
}
