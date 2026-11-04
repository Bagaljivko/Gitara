// Vežbe → „Ritam“. Nivo 1: jedna prazna žica tačno na udarac (četvrtine, osmine, pauze).
// Nivo 2+: udaranje akorda po obrascima iz aplikacije (rhythm.js), uz metronom. Za svaki udarac: rano/kasno.
// Prvi put se nudi kratko podešavanje kašnjenja zvuka na telefonu (važi za sve igre).
import { Metronome, PATTERNS, patternHTML, patternName, arrowOf } from './rhythm.js';
import { chordSVG } from './diagram.js';
import { createBoard } from './practiceBoard.js';
import { judgeTiming, getLatency, setLatency } from './practiceListen.js';
import { dn } from './naming.js';

const pat = (id) => PATTERNS.find((p) => p.id === id);
// Nivo 1: osam taktova u osminama (x = udarac, - = pauza)
const L1_BARS = ['x-x-x-x-', 'x-x-x-x-', 'xxxxx-x-', 'x---x-x-', 'xxxxxxxx', 'x-xxx-x-', 'x---x---', 'x-x-x---'];
const LEVELS = {
  1: { bars: L1_BARS.map((steps) => ({ steps, chord: null })), bpm: 70 },
  2: { pattern: pat('downs'), chords: ['Em', 'Em', 'Em', 'Em', 'Em', 'Em', 'Em', 'Em'], bpm: 70 },
  3: { pattern: pat('folk'), chords: ['G', 'G', 'C', 'C', 'G', 'G', 'C', 'G'], bpm: 70 },
  4: { pattern: pat('rock'), chords: ['Am', 'Am', 'F', 'F', 'Am', 'Am', 'F', 'Am'], bpm: 80 },
};

export function createGame(api) {
  const { t } = api;
  let level = Number(localStorage.getItem('gitara-pr-ritam-level')) || 1;
  if (!LEVELS[level]) level = 1;
  api.opts.innerHTML = `<div class="pr-optlabel">${t('pr.ritam.level')}</div>
    <div class="seg-tabs" role="radiogroup">${Object.keys(LEVELS).map((k) => `<button role="radio" data-l="${k}" class="${+k === level ? 'active' : ''}">${k}</button>`).join('')}</div>
    <button class="btn small pr-calib" id="rtCalib">${t('pr.calib.btn')}</button>`;
  api.opts.addEventListener('click', (e) => {
    const b = e.target.closest('[data-l]');
    if (b) {
      level = +b.dataset.l;
      try { localStorage.setItem('gitara-pr-ritam-level', String(level)); } catch {}
      api.opts.querySelectorAll('[data-l]').forEach((x) => x.classList.toggle('active', x === b));
      draw(0);
    }
    if (e.target.closest('#rtCalib')) calibrate();
  });
  api.stage.innerHTML = `<div class="rt-visual" id="rtVis"></div><div class="rt-row" id="rtRow"></div>`;
  const $ = (id) => api.stage.querySelector('#' + id);
  let board = null;

  const L = () => LEVELS[level];
  const barSteps = (b) => (L().bars ? L().bars[b % L().bars.length].steps : L().pattern.steps);
  // prikaz jednog takta: nivo 1 = tačke (udarac/pauza), nivo 2+ = strelice obrasca
  function draw(bar, now = -1) {
    const lv = L();
    if (lv.bars) {
      if (!board) { $('rtVis').innerHTML = '<div class="pr-board"></div>'; board = createBoard($('rtVis').querySelector('.pr-board'), { from: 0, to: 5 }); }
      board.target(0, 0, dn('E'));
      const steps = barSteps(bar);
      $('rtRow').innerHTML = `<div class="pattern" aria-label="${steps}">${[...steps].map((s, i) => `<span class="pstep ${s === 'x' ? 's-D' : 's-rest'}${i === now ? ' now' : ''}"><b>${s === 'x' ? '●' : arrowOf('-')}</b><i>${i % 2 ? t('pat.and') : i / 2 + 1}</i></span>`).join('')}</div>`;
      $('rtVis').dataset.lv = 1;
    } else {
      board = null;
      const ch = lv.chords[bar % lv.chords.length];
      $('rtVis').innerHTML = `<div class="rt-chord"><div class="chord-big">${chordSVG(ch)}</div><span class="small muted">${t('pr.ritam.pattern')}: ${patternName(lv.pattern)}</span></div>`;
      $('rtRow').innerHTML = patternHTML(lv.pattern);
      if (now >= 0) $('rtRow').querySelector(`[data-i="${now}"]`)?.classList.add('now');
    }
  }
  const markNow = (i) => { $('rtRow').querySelectorAll('.pstep').forEach((x, k) => x.classList.toggle('now', k === i)); };
  draw(0);
  api.feedback('info', getLatency() == null ? t('pr.calib.first') : t('pr.ritam.ready'));

  let met = null, expect = [], onsets = [], calibMode = false, lastBar = -1;
  const timingText = (tm, dt) => tm.kind === 'hit' ? t('pr.onBeat') : tm.kind === 'early' ? t('pr.early', { ms: Math.round(-dt) }) : tm.kind === 'late' ? t('pr.late', { ms: Math.round(dt) }) : t('pr.offBeat');

  function judge(e) {
    if (e.done) return;
    e.done = true;
    const win = Math.min(160, e.slotMs * 0.5);
    let best = null;
    for (const o of onsets) if (!o.used && Math.abs(o.at - e.at) <= win && (!best || Math.abs(o.at - e.at) < Math.abs(best.at - e.at))) best = o;
    if (!best) { e.score = 0; api.feedback('miss', t('pr.missed')); return; }
    best.used = true;
    const tm = judgeTiming(best.at - e.at, e.slotMs * 2);
    e.score = tm.score; e.ok = tm.score > 0;
    api.feedback(tm.kind === 'off' ? 'miss' : tm.kind, timingText(tm, best.at - e.at));
  }
  // udarac koji ne pripada nijednom očekivanom (npr. u pauzi) — višak
  function checkExtras(upTo) {
    for (const o of onsets) if (!o.used && !o.extraChecked && o.at < upTo) {
      o.extraChecked = true;
      if (!expect.some((e) => Math.abs(o.at - e.at) <= Math.min(160, e.slotMs * 0.5))) { o.extra = true; api.feedback('miss', t('pr.ritam.extra')); }
    }
  }

  async function run(bpm, { calib = false } = {}) {
    calibMode = calib; expect = []; onsets = []; lastBar = -1;
    await api.listen({ strums: true, onOnset: (o) => onsets.push({ at: o.at }) });
    met = new Metronome();
    met.bpm = calib ? 80 : bpm; met.sig = '4/4'; met.countIn = 1;
    const bars = calib ? 2 : 8;
    met.onStep = (slot, beat, accent, info) => {
      if (beat != null) api.pulse(beat, 4, beat === 0);
      if (info.countIn) { if (beat != null) api.feedback('', String(4 - info.countBeat)); return; }
      if (info.bar >= bars) { met.stop(); setTimeout(() => finish(), 450); return; }
      const slotMs = 60000 / met.bpm / 2;
      if (info.bar !== lastBar) { lastBar = info.bar; if (!calib) draw(info.bar, slot); }
      markNow(slot);
      const s = calib ? (slot % 2 === 0 ? 'x' : '-') : barSteps(info.bar)[slot];
      if (s === 'x' || s === 'D' || s === 'U') { // „x“ u obrascu (prigušeno) se ne broji obavezno
        const e = { at: info.at, slotMs, done: false, muted: L().pattern && s === 'x' };
        if (!(L().pattern && s === 'x')) { expect.push(e); setTimeout(() => api.running && judge(e), Math.min(160, slotMs * 0.5) + 170); }
      }
      checkExtras(info.at - 400);
    };
    met.start();
    api.onCleanup(() => met?.stop());
  }

  function finish() {
    if (!api.running) return;
    expect.forEach(judge);
    if (calibMode) {
      // kašnjenje = medijana (čuveni trzaj − klik), uz trenutno pretpostavljeno kašnjenje vraćeno nazad
      const assumed = getLatency() ?? 60;
      const offs = expect.map((e) => { let b = null; for (const o of onsets) if (Math.abs(o.at - e.at) < 300 && (!b || Math.abs(o.at - e.at) < Math.abs(b.at - e.at))) b = o; return b ? b.at - e.at : null; }).filter((x) => x != null).sort((a, b) => a - b);
      if (offs.length < 5) { api.feedback('miss', t('pr.calib.fail')); api.stopNow(); return; }
      const lat = Math.max(0, Math.min(350, assumed + offs[Math.floor(offs.length / 2)]));
      setLatency(lat);
      api.feedback('hit', t('pr.calib.done', { ms: Math.round(lat) }));
      api.stopNow();
      return;
    }
    checkExtras(Infinity);
    const n = expect.length || 1, sum = expect.reduce((a, e) => a + (e.score || 0), 0);
    const extras = onsets.filter((o) => o.extra).length;
    const score = Math.max(0, (sum - extras * 0.5) / n) * 100;
    const ok = expect.filter((e) => e.ok).length;
    api.finish({ score, tempo: api.bpm, accuracy: ok / n, extra: extras ? { label: t('pr.ritam.extras'), value: extras } : null });
  }

  async function calibrate() {
    if (api.running) return;
    api.feedback('info', t('pr.calib.how'));
    await api.startCustom(() => run(80, { calib: true }));
  }

  return {
    bpm: { start: L().bpm, min: 40, max: 200, step: 5 },
    async start(bpm) {
      if (getLatency() == null) { api.feedback('info', t('pr.calib.how')); return run(80, { calib: true }); }
      return run(bpm);
    },
    stop() { met?.stop(); met = null; markNow(-1); },
  };
}
