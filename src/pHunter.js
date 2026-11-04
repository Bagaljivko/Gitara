// Vežbe → „Lovac na note“ (uspravno, brz kviz): pojavi se nota (i žica) ili akord — nađi i odsviraj.
// Normalno: vreme po zadatku (što si bolji, kraće); položaj se vidi tek posle odgovora.
// Početnik: bez vremena; posle dva pogrešna pokušaja pokaže se gde je (u bojama prstiju).
import { createBoard, OPEN_MIDI, noteLabel, fingerOf } from './practiceBoard.js';
import { chordSVG } from './diagram.js';
import { dn } from './naming.js';
import { getLang } from './i18n.js';
import { createHitLog } from './practiceListen.js';
import { hitSound } from './practiceTrack.js';

const ROUND = 12;
const RANGES = { low: [0, 5], mid: [0, 9], all: [0, 12] };
const CHORD_SETS = { open: ['Em', 'Am', 'C', 'G', 'D', 'E', 'A', 'Dm'], sev: ['Em', 'Am', 'C', 'G', 'D', 'E7', 'A7', 'D7', 'G7', 'B7'], barre: ['F', 'Bm', 'Fm', 'Bb', 'C', 'G', 'Am', 'Em'] };

export function createGame(api) {
  const { t } = api;
  let what = localStorage.getItem('gitara-pr-lovac-what') === 'chord' ? 'chord' : 'note';
  let range = localStorage.getItem('gitara-pr-lovac-range') || 'low';
  if (!RANGES[range]) range = 'low';
  let cset = localStorage.getItem('gitara-pr-lovac-chords') || 'open';
  if (!CHORD_SETS[cset]) cset = 'open';
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  function drawOpts() {
    api.opts.innerHTML = `<div class="pr-optlabel">${t('pr.lovac.what')}</div>
      <div class="seg-tabs" role="radiogroup">
        <button role="radio" data-w="note" class="${what === 'note' ? 'active' : ''}">${t('pr.sluh.note')}</button>
        <button role="radio" data-w="chord" class="${what === 'chord' ? 'active' : ''}">${t('pr.sluh.chord')}</button>
      </div>
      ${what === 'note'
        ? `<div class="pr-optlabel">${t('pr.lovac.range')}</div><div class="seg-tabs" role="radiogroup">${Object.keys(RANGES).map((k) => `<button role="radio" data-r="${k}" class="${k === range ? 'active' : ''}">${t('pr.lovac.r_' + k)}</button>`).join('')}</div>`
        : `<div class="pr-optlabel">${t('pr.lovac.chords')}</div><div class="seg-tabs" role="radiogroup">${Object.keys(CHORD_SETS).map((k) => `<button role="radio" data-c="${k}" class="${k === cset ? 'active' : ''}">${t('pr.lovac.c_' + k)}</button>`).join('')}</div>`}`;
  }
  drawOpts();
  api.opts.addEventListener('click', (e) => {
    const w = e.target.closest('[data-w]'), r = e.target.closest('[data-r]'), c = e.target.closest('[data-c]');
    if (api.running) return;
    if (w) { what = w.dataset.w; store('gitara-pr-lovac-what', what); }
    if (r) { range = r.dataset.r; store('gitara-pr-lovac-range', range); }
    if (c) { cset = c.dataset.c; store('gitara-pr-lovac-chords', cset); }
    if (w || r || c) { drawOpts(); idle(); }
  });

  api.stage.innerHTML = `<div class="pr-quiz-big" id="lvNow">?</div>
    <div class="pr-quiz-sub" id="lvSub"></div>
    <div class="pr-hint" id="lvHint"></div>
    <div class="pr-board" id="lvBoard"></div>
    <div class="ear-reveal" id="lvChord"></div>
    <div class="pr-timer" id="lvTimer" aria-hidden="true"><i id="lvBar"></i></div>
    <div class="pr-quiz-streak" id="lvStreak"></div>
    <div class="small muted" id="lvCount"></div>
    <button class="btn small" id="lvSkip" hidden>${t('pr.lovac.skip')}</button>`;
  const $ = (id) => api.stage.querySelector('#' + id);
  let board = null;
  function idle() {
    $('lvBoard').hidden = what !== 'note';
    $('lvChord').hidden = what !== 'chord';
    if (what === 'note') { board = createBoard($('lvBoard'), { from: RANGES[range][0], to: RANGES[range][1] }); }
    $('lvChord').innerHTML = '';
    $('lvNow').textContent = '?'; $('lvSub').textContent = ''; $('lvHint').textContent = ''; $('lvStreak').textContent = '';
    $('lvTimer').hidden = api.level === 'beg';
    api.feedback('info', t(api.level === 'beg' ? 'pr.lovac.readyBeg' : 'pr.lovac.ready'));
  }
  idle();

  let n = 0, cur = null, prev = null, t0 = 0, timer = 0, results = [], streak = 0, listener = null;
  const beg = () => api.level === 'beg';
  const secs = (ms) => (ms / 1000).toLocaleString(getLang() === 'en' ? 'en' : 'sr-Latn', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const limitMs = () => api.bpm * 100; // tempo ovde = desetinke sekunde po zadatku
  const flash = (k) => { const s = api.stage; s.classList.remove('flash-hit', 'flash-miss'); void s.offsetWidth; s.classList.add('flash-' + k); };
  const nameOf = (q) => (q.chord ? dn(q.chord) : noteLabel(q.midi));
  const sName = (s) => (s === 5 ? dn('E').toLowerCase() : noteLabel(OPEN_MIDI[s]));

  function pick() {
    let q;
    do {
      if (what === 'chord') { const set = CHORD_SETS[cset]; q = { chord: set[Math.floor(Math.random() * set.length)] }; }
      else { const [lo, hi] = RANGES[range], s = Math.floor(Math.random() * 6), f = lo + Math.floor(Math.random() * (hi - lo + 1)); q = { s, f, midi: OPEN_MIDI[s] + f }; }
    } while (prev && nameOf(prev) === nameOf(q)); // isti zadatak nikad dva puta zaredom
    q.wrong = 0;
    return q;
  }
  // Gde je (u bojama prstiju): na vratu za notu, dijagram za akord
  function reveal(q, kind = 'show') {
    if (q.chord) $('lvChord').innerHTML = `<div class="chord-big ear-chord">${chordSVG(q.chord, { colorFingers: true })}</div>`;
    else board.mark(q.s, q.f, kind, String(q.f), fingerOf(q.f), kind === 'show' ? 0 : 1200);
  }
  function next() {
    clearTimeout(timer);
    if (n >= ROUND) return finish();
    cur = pick(); prev = cur; n++;
    if (board) board.clear();
    $('lvChord').innerHTML = '';
    $('lvHint').textContent = '';
    const big = $('lvNow');
    big.textContent = nameOf(cur);
    big.classList.remove('pop'); void big.offsetWidth; big.classList.add('pop');
    $('lvSub').textContent = cur.chord ? t('pr.lovac.playChord') : t('pr.lovac.onString', { n: 6 - cur.s, s: sName(cur.s) });
    $('lvCount').textContent = `${n} / ${ROUND}`;
    $('lvSkip').hidden = !beg();
    t0 = performance.now();
    if (beg()) return; // Početnik: bez vremena
    const bar = $('lvBar');
    bar.style.transition = 'none'; bar.style.width = '100%'; void bar.offsetWidth;
    bar.style.transition = `width ${limitMs()}ms linear`; bar.style.width = '0%';
    const q = cur;
    timer = setTimeout(() => {
      if (cur !== q) return;
      results.push({ ok: false, score: 0 });
      reveal(q, 'miss'); flash('miss'); streak = 0; $('lvStreak').textContent = '';
      api.feedback('miss', t('pr.lovac.timeUp', { n: nameOf(q) }));
      cur = null;
      setTimeout(() => api.running && next(), 1300);
    }, limitMs());
  }
  function right(q, took) {
    clearTimeout(timer);
    const score = beg() ? (q.wrong === 0 ? 1 : q.wrong <= 2 ? 0.7 : 0.4) : 0.55 + 0.45 * Math.max(0, 1 - took / limitMs());
    results.push({ ok: true, score, hinted: q.wrong >= 2 });
    streak++;
    $('lvStreak').textContent = streak >= 2 ? t('pr.lovac.streak', { n: streak }) : '';
    $('lvStreak').classList.toggle('hot', streak >= 5);
    reveal(q, 'hit'); flash('hit'); hitSound();
    api.feedback('hit', t('pr.lovac.found', { s: secs(took) }));
    cur = null;
    setTimeout(() => api.running && !cur && next(), 900);
  }
  function wrong(q, text) {
    q.wrong++;
    flash('miss'); streak = 0; $('lvStreak').textContent = '';
    api.feedback('miss', beg() ? t('pr.trk.tryAgain', { x: text }) : text);
    // Početnik: posle dva pogrešna pokušaja — savet i položaj
    if (beg() && q.wrong === 2) {
      reveal(q, 'show');
      $('lvHint').textContent = q.chord ? t('pr.lovac.hintChord', { c: dn(q.chord) }) : t('pr.hint.note', { s: sName(q.s), f: q.f });
    }
  }
  const log = createHitLog();
  function onPluck(p) {
    if (!cur || cur.chord || !api.running || p.at < t0 - 20) return;
    log.onset({ at: p.at }); log.pluck(p);
    const h = log.hits[log.hits.length - 1], q = cur;
    if (log.matches(h, q.midi)) right(q, Math.max(0, h.at - t0));
    else { const m = log.midiOf(h); wrong(q, m != null ? t('pr.trk.wrong', { n: noteLabel(m) }) : t('pr.trk.notClear')); }
  }
  let lastChordTry = 0;
  function onOnset(o) {
    if (!cur || !cur.chord || !api.running || o.at < t0 - 20) return;
    const q = cur;
    setTimeout(() => {
      if (cur !== q || !api.running || !listener) return;
      if (listener.chordHeard(q.chord).ok) right(q, Math.max(0, o.at - t0));
      else if (performance.now() - lastChordTry > 700) { lastChordTry = performance.now(); wrong(q, t('pr.promena.notClearShort', { c: dn(q.chord) })); }
    }, 380);
  }
  $('lvSkip').addEventListener('click', () => {
    if (!cur) return;
    const q = cur; cur = null;
    results.push({ ok: false, score: 0 });
    reveal(q, 'show'); streak = 0;
    setTimeout(() => api.running && next(), 1200);
  });

  function finish() {
    clearTimeout(timer); cur = null;
    $('lvSkip').hidden = true;
    const sum = results.reduce((a, r) => a + r.score, 0), ok = results.filter((r) => r.ok).length;
    const clean = results.every((r) => r.ok && !r.hinted);
    api.finish({ score: (sum / ROUND) * 100, tempo: api.bpm, accuracy: ok / ROUND, beginner: beg(), clean, noTempoUp: beg() });
  }

  return {
    beats: 0,
    levels: [{ id: 'beg', label: t('pr.lvl.beg') }, { id: 'normal', label: t('pr.lvl.normal') }],
    onLevel: () => idle(),
    // „tempo“ = vreme po zadatku u desetinkama sekunde: 8,0 s na početku, najkraće 1,5 s; manje = brže
    bpm: { start: 80, min: 15, max: 120, step: 5, dir: -1, unit: 's', label: t('pr.lovac.timeLabel'), fmt: (v) => (v / 10).toLocaleString(getLang() === 'en' ? 'en' : 'sr-Latn', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
    async start() {
      n = 0; results = []; cur = null; streak = 0;
      log.clear();
      idle();
      listener = await api.listen({ chords: what === 'chord', onPluck, onOnset });
      next();
    },
    stop() { clearTimeout(timer); cur = null; listener = null; $('lvSkip').hidden = true; $('lvBar').style.transition = 'none'; },
  };
}
