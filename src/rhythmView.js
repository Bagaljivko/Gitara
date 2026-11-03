// Akordi → „Ritam“: jedan ekran za vežbanje ritma.
// Tempo (± / klizač / tapni u ritmu) → ritam (samo metronom ili obrazac sa velikim strelicama)
// → akordi (jedan ili progresija, menja se svaki takt) → odbrojavanje i postepeno ubrzavanje → Pokreni.
import { Metronome, PATTERNS, SIGNATURES, patternHTML, patternName, makeTapTempo, TAP_NEEDED } from './rhythm.js';
import { settings } from './db.js';
import { t } from './i18n.js';
import { esc } from './ui.js';
import { isChord } from './music.js';
import { keepAwake, allowSleep } from './wakelock.js';

export const PROGRESSIONS = [
  { id: 'em', chords: ['Em'] },
  { id: 'g-c-d-g', chords: ['G', 'C', 'D', 'G'] },
  { id: 'am-f-c-g', chords: ['Am', 'F', 'C', 'G'] },
  { id: 'c-g-am-f', chords: ['C', 'G', 'Am', 'F'] },
  { id: 'g-em-c-d', chords: ['G', 'Em', 'C', 'D'] },
  { id: 'd-a-bm-g', chords: ['D', 'A', 'Bm', 'G'] },
  { id: 'a-d-e-a', chords: ['A', 'D', 'E', 'A'] },
  { id: 'e-a-b7-e', chords: ['E', 'A', 'B7', 'E'] },
];

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

/** „G C D“ / „G-C-D“ / „G, C, D“ → ['G','C','D'] (samo ispravni akordi, najviše 16). */
export function parseProgression(text) {
  return String(text || '').split(/[\s,;|–—-]+/).map((x) => x.trim()).filter((x) => x && isChord(x)).slice(0, 16);
}

export function createRhythmPane(el) {
  const met = new Metronome();
  const tap = makeTapTempo();
  let running = false;
  let patId = lsGet('gitara-rh-pattern', 'folk');
  if (patId !== 'met' && !PATTERNS.some((p) => p.id === patId)) patId = 'folk';
  let progId = lsGet('gitara-rh-prog', 'em');
  let custom = lsGet('gitara-rh-custom', 'G Em C D');
  let sig = '4/4';
  let countIn = lsGet('gitara-rh-countin', '1') === '1';
  let trainer = { on: false, step: 5, every: 4, target: 120 };
  try { trainer = { ...trainer, ...JSON.parse(lsGet('gitara-rh-trainer', '{}')) }; } catch {}
  let startBpm = 90;

  const pattern = () => (patId === 'met' ? null : PATTERNS.find((p) => p.id === patId));
  const chords = () => (progId === 'custom' ? parseProgression(custom) : (PROGRESSIONS.find((p) => p.id === progId) || PROGRESSIONS[0]).chords);

  el.innerHTML = `
    <div class="card metro">
      <div class="metro-top">
        <button class="btn round" id="mMinus" aria-label="${t('met.slower')}">−</button>
        <div class="metro-bpm"><b id="mBpm">90</b><span>BPM</span></div>
        <button class="btn round" id="mPlus" aria-label="${t('met.faster')}">+</button>
      </div>
      <input type="range" id="mRange" min="40" max="220" step="1" value="90" aria-label="BPM">
      <button class="btn wide tap-btn" id="mTap">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11.2V7.5a1.5 1.5 0 0 1 3 0v4.3l3.9.6a2 2 0 0 1 1.7 2.2l-.6 4.6A2 2 0 0 1 15 21h-4.6a2 2 0 0 1-1.5-.7l-3.4-4a1.4 1.4 0 0 1 2-1.9L9 15.8zM10.5 2a5.5 5.5 0 0 1 5 7.8l-1.8-.9a3.5 3.5 0 1 0-6.4 0l-1.8.9A5.5 5.5 0 0 1 10.5 2z"/></svg>
        ${t('rh.tap')}</button>
      <p class="tap-hint small muted" id="mTapHint" aria-live="polite">${t('rh.tapHint', { n: TAP_NEEDED })}</p>
    </div>

    <div class="card rh-card">
      <label class="rh-field">${t('rh.pattern')}
        <select id="mPattern">
          <option value="met">${t('rh.onlyClick')}</option>
          ${PATTERNS.map((p) => `<option value="${p.id}">${esc(patternName(p))} · ${p.sig}</option>`).join('')}
        </select>
      </label>
      <div class="seg-tabs sig-tabs" id="mSigs" role="radiogroup" aria-label="${t('met.sig')}">
        ${Object.keys(SIGNATURES).map((s) => `<button role="radio" data-sig="${s}">${s}</button>`).join('')}
      </div>
      <div class="rh-stage" id="mStage" aria-live="off">
        <div class="rh-chord" id="mChord"><b id="mChordNow"></b><span id="mChordNext"></span></div>
        <div class="rh-big" id="mBig"></div>
      </div>
      <div id="mChordsBox">
        <label class="rh-field">${t('rh.chords')}
          <select id="mProg">
            ${PROGRESSIONS.map((p) => `<option value="${p.id}">${esc(p.chords.join(' – '))}</option>`).join('')}
            <option value="custom">${t('rh.customProg')}</option>
          </select>
        </label>
        <input id="mCustom" class="rh-custom" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${t('rh.customPh')}" aria-label="${t('rh.customProg')}">
      </div>
      <label class="switch rh-switch"><input type="checkbox" id="mCount"><span class="switch-track"><span class="switch-thumb"></span></span><span>${t('rh.countIn')}</span></label>
      <label class="switch rh-switch"><input type="checkbox" id="mTrain"><span class="switch-track"><span class="switch-thumb"></span></span><span>${t('rh.trainer')}</span></label>
      <div class="rh-trainer" id="mTrainBox" hidden>
        <div class="rh-step"><span>${t('rh.trStep')}</span><button class="btn round small" data-tr="step:-1" aria-label="−">−</button><b id="trStep"></b><button class="btn round small" data-tr="step:1" aria-label="+">+</button></div>
        <div class="rh-step"><span>${t('rh.trEvery')}</span><button class="btn round small" data-tr="every:-1" aria-label="−">−</button><b id="trEvery"></b><button class="btn round small" data-tr="every:1" aria-label="+">+</button></div>
        <div class="rh-step"><span>${t('rh.trTarget')}</span><button class="btn round small" data-tr="target:-5" aria-label="−">−</button><b id="trTarget"></b><button class="btn round small" data-tr="target:5" aria-label="+">+</button></div>
      </div>
      <button class="btn primary big wide" id="mPlay">${t('rh.start')}</button>
    </div>
    <p class="hint small">${t('pat.hint')}</p>`;

  const $ = (id) => el.querySelector('#' + id);

  // ---- Tempo ----
  const setBpm = (v, save = true) => {
    met.bpm = Math.max(40, Math.min(220, Math.round(v)));
    $('mBpm').textContent = met.bpm;
    $('mRange').value = met.bpm;
    if (save) settings.set('metBpm', met.bpm).catch(() => {});
  };
  settings.get('metBpm', 90).then((v) => setBpm(Number(v) || 90, false));
  $('mMinus').addEventListener('click', () => setBpm(met.bpm - 1));
  $('mPlus').addEventListener('click', () => setBpm(met.bpm + 1));
  $('mRange').addEventListener('input', (e) => setBpm(+e.target.value));
  let hintTimer = 0;
  $('mTap').addEventListener('pointerdown', (e) => {
    e.preventDefault(); // pointerdown je tačniji od click (bez kašnjenja)
    const r = tap();
    const b = $('mTap');
    b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
    clearTimeout(hintTimer);
    if (r.bpm) { setBpm(r.bpm); $('mTapHint').textContent = t('rh.tapSet', { bpm: r.bpm }); }
    else $('mTapHint').textContent = t('rh.tapMore', { n: TAP_NEEDED - r.count });
    hintTimer = setTimeout(() => { $('mTapHint').textContent = t('rh.tapHint', { n: TAP_NEEDED }); }, 4000);
  });
  $('mTap').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('mTap').dispatchEvent(new PointerEvent('pointerdown')); } });

  // ---- Ritam, takt, akordi ----
  function drawStage() {
    const p = pattern();
    $('mSigs').hidden = !!p;
    $('mChordsBox').hidden = !p;
    $('mChord').hidden = !p;
    if (p) sig = p.sig;
    el.querySelectorAll('[data-sig]').forEach((b) => { const on = b.dataset.sig === sig; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });
    const sp = SIGNATURES[sig];
    $('mBig').innerHTML = p ? patternHTML(p).replace('class="pattern"', 'class="pattern big"')
      : `<div class="pulse big">${Array.from({ length: sp.beats }, (_, i) => `<i class="${sp.accents.includes(i) ? 'acc' : ''}"><span>${i + 1}</span></i>`).join('')}</div>`;
    const ch = chords();
    $('mChordNow').textContent = ch[0] || '';
    $('mChordNext').textContent = ch.length > 1 ? t('rh.next', { c: ch[1] }) : '';
    $('mCustom').hidden = progId !== 'custom';
  }
  $('mPattern').value = patId;
  $('mProg').value = PROGRESSIONS.some((p) => p.id === progId) || progId === 'custom' ? progId : 'em';
  $('mCustom').value = custom;
  $('mCount').checked = countIn;
  $('mTrain').checked = trainer.on;
  const drawTrainer = () => {
    $('mTrainBox').hidden = !trainer.on;
    $('trStep').textContent = `+${trainer.step} BPM`;
    const n = trainer.every, n10 = n % 10, n100 = n % 100;
    $('trEvery').textContent = t(n === 1 ? 'rh.bars1' : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? 'rh.bars2' : 'rh.bars5', { n });
    $('trTarget').textContent = `${trainer.target} BPM`;
  };
  drawTrainer();
  drawStage();
  const restartIfRunning = () => { if (running) { stop(); start(); } };
  $('mPattern').addEventListener('change', (e) => { patId = e.target.value; lsSet('gitara-rh-pattern', patId); drawStage(); restartIfRunning(); });
  $('mProg').addEventListener('change', (e) => { progId = e.target.value; lsSet('gitara-rh-prog', progId); drawStage(); restartIfRunning(); if (progId === 'custom') $('mCustom').focus(); });
  $('mCustom').addEventListener('input', (e) => { custom = e.target.value; lsSet('gitara-rh-custom', custom); drawStage(); if (running) met.chords = chords(); });
  el.querySelectorAll('[data-sig]').forEach((b) => b.addEventListener('click', () => { sig = b.dataset.sig; drawStage(); restartIfRunning(); }));
  $('mCount').addEventListener('change', (e) => { countIn = e.target.checked; lsSet('gitara-rh-countin', countIn ? '1' : '0'); });
  $('mTrain').addEventListener('change', (e) => { trainer.on = e.target.checked; lsSet('gitara-rh-trainer', JSON.stringify(trainer)); drawTrainer(); if (running) met.trainer = trainer.on ? trainer : null; });
  el.querySelectorAll('[data-tr]').forEach((b) => b.addEventListener('click', () => {
    const [k, d] = b.dataset.tr.split(':');
    const lim = { step: [1, 20], every: [1, 16], target: [45, 220] }[k];
    trainer[k] = Math.max(lim[0], Math.min(lim[1], trainer[k] + Number(d)));
    lsSet('gitara-rh-trainer', JSON.stringify(trainer));
    drawTrainer();
  }));

  // ---- Reprodukcija ----
  met.onStep = (i, beat, accent, info) => {
    const p = pattern();
    if (info.countIn) {
      if (info.countBeat !== null) $('mChordNow').textContent = String(info.countBeat + 1);
      $('mChordNow').classList.add('count');
      $('mChordNext').textContent = t('rh.getReady');
    } else if (p) {
      const ch = chords();
      $('mChordNow').classList.remove('count');
      $('mChordNow').textContent = info.chord || '';
      $('mChordNext').textContent = ch.length > 1 ? t('rh.next', { c: ch[(info.bar + 1) % ch.length] }) : '';
    }
    if (p) el.querySelectorAll('#mBig .pstep').forEach((s) => s.classList.toggle('now', !info.countIn && +s.dataset.i === i));
    if (beat !== null) el.querySelectorAll('#mBig .pulse i').forEach((d, k) => d.classList.toggle('on', k === beat));
  };
  met.onTempo = (b) => { $('mBpm').textContent = b; $('mRange').value = b; };

  function start() {
    const p = pattern();
    met.pattern = p;
    met.sig = sig;
    met.chords = p ? chords() : null;
    met.countIn = countIn ? 1 : 0;
    met.trainer = trainer.on ? { ...trainer } : null;
    startBpm = met.bpm;
    met.start();
    running = true;
    keepAwake('metronome');
    $('mPlay').textContent = t('met.stop');
    $('mPlay').classList.remove('primary');
  }
  function stop() {
    met.stop();
    running = false;
    allowSleep('metronome');
    $('mPlay').textContent = t('rh.start');
    $('mPlay').classList.add('primary');
    el.querySelectorAll('#mBig .now, #mBig .on').forEach((x) => x.classList.remove('now', 'on'));
    $('mChordNow').classList.remove('count');
    // Posle treninga brzine vrati početni tempo (dostignuti tempo se ne pamti kao podrazumevani)
    if (met.trainer && met.bpm !== startBpm) setBpm(startBpm, false);
    drawStage();
  }
  $('mPlay').addEventListener('click', () => (running ? stop() : start()));

  return { stop: () => { if (running) stop(); } };
}
