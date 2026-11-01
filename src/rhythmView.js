// Akordi → „Metronom i ritmovi“: metronom (BPM, tap tempo, takt, naglasak, puls) i biblioteka ritmova.
import { Metronome, PATTERNS, SIGNATURES, patternHTML, patternName, makeTapTempo } from './rhythm.js';
import { settings } from './db.js';
import { t } from './i18n.js';
import { keepAwake, allowSleep } from './wakelock.js';

export function createRhythmPane(el) {
  const met = new Metronome();
  let playing = null; // null | 'met' | id obrasca
  const tap = makeTapTempo();

  el.innerHTML = `
    <div class="card metro">
      <div class="metro-top">
        <button class="btn round" id="mMinus" aria-label="${t('met.slower')}">−</button>
        <div class="metro-bpm"><b id="mBpm">90</b><span>BPM</span></div>
        <button class="btn round" id="mPlus" aria-label="${t('met.faster')}">+</button>
      </div>
      <input type="range" id="mRange" min="40" max="220" step="1" value="90" aria-label="BPM">
      <div class="seg-tabs sig-tabs" role="radiogroup" aria-label="${t('met.sig')}">
        ${Object.keys(SIGNATURES).map((s) => `<button role="radio" data-sig="${s}">${s}</button>`).join('')}
      </div>
      <div class="pulse" id="mPulse" aria-hidden="true"></div>
      <div class="row">
        <button class="btn" id="mTap">${t('met.tap')}</button>
        <button class="btn primary" id="mPlay">${t('met.start')}</button>
      </div>
    </div>
    <h2 class="sub-h">${t('pat.title')}</h2>
    <ul class="pat-list" id="mPatterns">
      ${PATTERNS.map((p) => `<li class="pat-item card" data-id="${p.id}">
        <div class="pat-head"><b>${patternName(p)}</b><span class="muted small">${p.sig}</span>
          <button class="icon-btn pat-play" data-play="${p.id}" aria-label="${t('pat.play')}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button></div>
        ${patternHTML(p)}
      </li>`).join('')}
    </ul>
    <p class="hint small">${t('pat.hint')}</p>`;

  const $ = (id) => el.querySelector('#' + id);

  const setSig = (sig) => {
    met.sig = sig;
    el.querySelectorAll('[data-sig]').forEach((b) => { const on = b.dataset.sig === sig; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });
    const sp = SIGNATURES[sig];
    $('mPulse').innerHTML = Array.from({ length: sp.beats }, (_, i) => `<i class="${sp.accents.includes(i) ? 'acc' : ''}"></i>`).join('');
  };
  const setBpm = (v, save = true) => {
    met.bpm = Math.max(40, Math.min(220, Math.round(v)));
    $('mBpm').textContent = met.bpm;
    $('mRange').value = met.bpm;
    if (save) settings.set('metBpm', met.bpm).catch(() => {});
  };
  settings.get('metBpm', 90).then((v) => setBpm(v, false));
  setSig('4/4');

  const dots = () => [...$('mPulse').children];
  met.onStep = (i, beat) => {
    if (beat !== null) dots().forEach((d, k) => d.classList.toggle('on', k === beat));
    if (playing && playing !== 'met') {
      const li = el.querySelector(`.pat-item[data-id="${playing}"]`);
      li?.querySelectorAll('.pstep').forEach((s) => s.classList.toggle('now', +s.dataset.i === i));
    }
  };

  function stopAll() {
    met.stop();
    playing = null;
    allowSleep('metronome');
    $('mPlay').textContent = t('met.start');
    $('mPlay').classList.add('primary');
    el.querySelectorAll('.pstep.now, .pulse i.on').forEach((x) => x.classList.remove('now', 'on'));
    el.querySelectorAll('.pat-play').forEach((b) => b.classList.remove('playing'));
  }
  function startMet(pattern) {
    met.stop();
    met.pattern = pattern;
    if (pattern) setSig(pattern.sig);
    met.start();
    keepAwake('metronome');
    $('mPlay').textContent = t('met.stop');
    $('mPlay').classList.remove('primary');
  }

  $('mMinus').addEventListener('click', () => setBpm(met.bpm - 1));
  $('mPlus').addEventListener('click', () => setBpm(met.bpm + 1));
  $('mRange').addEventListener('input', (e) => setBpm(+e.target.value));
  $('mTap').addEventListener('click', () => { const b = tap(); if (b) setBpm(b); });
  el.querySelectorAll('[data-sig]').forEach((b) => b.addEventListener('click', () => {
    setSig(b.dataset.sig);
    if (playing === 'met') startMet(null);
    else if (playing) stopAll();
  }));
  $('mPlay').addEventListener('click', () => {
    if (playing) return stopAll();
    playing = 'met';
    startMet(null);
  });
  el.querySelectorAll('[data-play]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.play;
    if (playing === id) return stopAll();
    stopAll();
    playing = id;
    b.classList.add('playing');
    startMet(PATTERNS.find((p) => p.id === id));
  }));

  return { stop: stopAll };
}
