// Vežbe → „Sluh“ (uspravno, brz kviz): aplikacija odsvira ton (ili akord) postojećim zvukom gitare;
// ti ga nađi i odsviraj. Normalno: tri pokušaja i vreme po pitanju. Početnik: bez vremena, pokušaja
// koliko hoćeš; posle dva pogrešna pokaže se gde je (u bojama prstiju), a „Dalje“ preskače pitanje.
import { audioCtx, pluck, strum, stopGroup } from './synth.js';
import { chordNotes } from './rhythm.js';
import { chordSVG } from './diagram.js';
import { createBoard, OPEN_MIDI, noteLabel, fingerOf } from './practiceBoard.js';
import { createHitLog } from './practiceListen.js';
import { hitSound, quizPluck, placeOf } from './practiceCommon.js';
import { getLang } from './i18n.js';
import { dn } from './naming.js';

const ROUND = 10, TRIES = 3;
const CHORDS = ['C', 'G', 'D', 'A', 'E', 'Am', 'Em', 'Dm'];
// Note u prvoj poziciji (prazne žice i pragovi 0–3): sve što početnik lako nađe
const NOTE_POOL = [];
for (let s = 0; s < 6; s++) for (let f = 0; f <= 3; f++) NOTE_POOL.push({ s, f, midi: OPEN_MIDI[s] + f });

export function createGame(api) {
  const { t } = api;
  let mode = localStorage.getItem('gitara-pr-sluh-mode') === 'chord' ? 'chord' : 'note';
  api.opts.innerHTML = `<div class="pr-optlabel">${t('pr.sluh.what')}</div>
    <div class="seg-tabs" role="radiogroup">
      <button role="radio" data-m="note" class="${mode === 'note' ? 'active' : ''}">${t('pr.sluh.note')}</button>
      <button role="radio" data-m="chord" class="${mode === 'chord' ? 'active' : ''}">${t('pr.sluh.chord')}</button>
    </div>`;
  api.opts.addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b || api.running) return;
    mode = b.dataset.m;
    try { localStorage.setItem('gitara-pr-sluh-mode', mode); } catch {}
    api.opts.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('active', x === b));
    reveal(null);
  });
  api.stage.innerHTML = `<div class="pr-qwrap"><div class="ear-q" id="eaQ">?</div><i class="pr-qring" id="eaRing"></i></div>
    <div class="pr-hint" id="eaHint"></div>
    <div class="ear-reveal" id="eaRev"></div>
    <div class="row-btns"><button class="btn small" id="eaAgain" hidden>${t('pr.sluh.again')}</button>
      <button class="btn small" id="eaSkip" hidden>${t('pr.lovac.skip')}</button></div>
    <div class="pr-timer" id="eaTimer" aria-hidden="true"><i id="eaBar"></i></div>
    <div class="pr-quiz-streak" id="eaStreak"></div>
    <div class="small muted" id="eaCount"></div>`;
  const $ = (id) => api.stage.querySelector('#' + id);
  const beg = () => api.level === 'beg';
  const ready = () => { $('eaTimer').hidden = beg(); api.feedback('info', t(beg() ? 'pr.sluh.readyBeg' : 'pr.sluh.ready')); };
  ready();

  let n = 0, cur = null, prev = null, tries = 0, results = [], quietUntil = 0, timer = 0, t0 = 0, listener = null, lastWrong = -1e9, streak = 0;
  const log = createHitLog();
  const limitMs = () => api.bpm * 100; // desetinke sekunde po pitanju
  const secs = (ms) => (ms / 1000).toLocaleString(getLang() === 'en' ? 'en' : 'sr-Latn', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const flash = (k) => { const r = $('eaRing'); r.className = 'pr-qring' + (k === 'miss' ? ' bad' : ''); r.animate([{ opacity: 1, transform: 'scale(.92)' }, { opacity: 0, transform: 'scale(1.12)' }], { duration: 480, easing: 'ease-out' }); };
  let revBoard = null; // vrat kad je prikazan (posle saveta) — tu se pokaže i pogrešna nota
  const nameOf = (q) => (q.chord ? dn(q.chord) : noteLabel(q.midi));

  // Gde je: vrat (nota, u boji prsta) ili dijagram akorda (tačke u bojama prstiju)
  function reveal(q, kind = 'show') {
    if (!q) { $('eaRev').innerHTML = ''; revBoard = null; $('eaQ').textContent = '?'; $('eaHint').textContent = ''; return; }
    if (q.chord) $('eaRev').innerHTML = `<div class="chord-big ear-chord">${chordSVG(q.chord, { colorFingers: true })}</div>`;
    else {
      $('eaRev').innerHTML = '<div class="pr-board"></div>';
      revBoard = createBoard($('eaRev').querySelector('.pr-board'), { from: 0, to: 5 });
      revBoard.mark(q.s, q.f, kind, String(q.f), fingerOf(q.f), 0);
    }
    $('eaQ').textContent = nameOf(q);
  }
  // Odsviraj zadatak; mikrofon za to vreme ne sluša (inače bi „čuo“ sopstveni zvuk iz zvučnika)
  function play(q) {
    const c = audioCtx(), when = c.currentTime + 0.05;
    stopGroup('practice');
    if (q.chord) strum(when, 'D', { notes: chordNotes(q.chord), group: 'practice' });
    else pluck(440 * Math.pow(2, (q.midi - 69) / 12), { when, gain: 0.9, duration: 1.6, group: 'practice' });
    quietUntil = performance.now() + 1700;
    listener?.mute(1700);
  }
  function next() {
    clearTimeout(timer);
    if (n >= ROUND) return finish();
    let q;
    do { q = mode === 'chord' ? { chord: CHORDS[Math.floor(Math.random() * CHORDS.length)] } : NOTE_POOL[Math.floor(Math.random() * NOTE_POOL.length)]; }
    while (prev && (q.chord ? q.chord === prev.chord : q.midi === prev.midi)); // isto pitanje nikad dva puta zaredom
    cur = { ...q }; prev = cur; n++; tries = 0; lastWrong = -1e9;
    reveal(null);
    $('eaAgain').hidden = false;
    $('eaSkip').hidden = !beg();
    $('eaCount').textContent = `${n} / ${ROUND}`;
    play(cur);
    t0 = performance.now();
    if (beg()) return; // Početnik: bez vremena
    const bar = $('eaBar');
    bar.style.transition = 'none'; bar.style.width = '100%'; void bar.offsetWidth;
    bar.style.transition = `width ${limitMs() + 1700}ms linear`; bar.style.width = '0%';
    timer = setTimeout(() => answer(false, true), limitMs() + 1700);
  }
  function answer(ok, timeout = false, heardName = '') {
    if (!cur) return;
    const q = cur;
    if (ok) {
      const took = performance.now() - t0;
      results.push({ ok: true, score: beg() ? Math.max(0.7, 1 - 0.1 * tries) : [1, 0.7, 0.4][tries] ?? 0.4, hinted: tries >= 2, wrong: tries });
      streak++;
      $('eaStreak').textContent = streak >= 2 ? t('pr.lovac.streak', { n: streak }) : '';
      $('eaStreak').classList.toggle('hot', streak >= 5);
      flash('hit'); hitSound();
      api.feedback('hit', t('pr.sluh.right', { s: secs(took) }));
      reveal(q, 'hit');
    } else if (timeout || (!beg() && tries + 1 >= TRIES)) {
      results.push({ ok: false, score: 0, wrong: tries + (timeout ? 0 : 1), timeout });
      streak = 0; $('eaStreak').textContent = '';
      flash('miss');
      api.feedback('miss', t('pr.sluh.was', { x: nameOf(q) }));
      reveal(q, 'miss');
    } else {
      // jedan trzaj = najviše jedan pokušaj (zvuk jedne žice ponekad izgleda kao dva udarca)
      if (performance.now() - lastWrong < 700) return;
      lastWrong = performance.now();
      tries++;
      flash('miss'); streak = 0; $('eaStreak').textContent = '';
      if (beg()) {
        api.feedback('miss', heardName ? t('pr.trk.tryAgain', { x: heardName }) : t('pr.trk.notClear'));
        // posle dva pogrešna: pokaži gde je (i šta je), pa sviraj dok ne pogodiš
        if (tries === 2) { reveal(q, 'show'); $('eaHint').textContent = q.chord ? t('pr.lovac.hintChord', { c: dn(q.chord) }) : t('pr.hint.note', { s: q.s === 5 ? dn('E').toLowerCase() : noteLabel(OPEN_MIDI[q.s]), f: q.f }); }
      } else api.feedback('miss', t('pr.sluh.tryAgain', { n: TRIES - tries }));
      return;
    }
    clearTimeout(timer);
    cur = null;
    $('eaSkip').hidden = true;
    setTimeout(() => api.running && next(), 1600);
  }
  function onPluck(p) {
    if (!cur || cur.chord || performance.now() < quietUntil) return;
    const q = cur;
    quizPluck(api, log, p, q.midi, 'sluh', () => cur === q && answer(true),
      (m) => {
        if (cur !== q || m == null) return;
        if (revBoard) { const pos = placeOf(m, q.s); if (pos && pos.f <= 5) revBoard.ghost(pos.s, pos.f); }
        answer(false, false, t('pr.trk.wrong', { n: noteLabel(m) }));
      });
  }
  function onOnset(o) {
    if (!cur || !cur.chord || performance.now() < quietUntil) return;
    const q = cur;
    setTimeout(() => { if (api.running && cur === q && listener) answer(listener.chordHeard(q.chord).ok, false, t('pr.promena.notClearShort', { c: dn(q.chord) })); }, 380);
  }
  $('eaAgain').addEventListener('click', () => { if (cur) play(cur); });
  $('eaSkip').addEventListener('click', () => {
    if (!cur) return;
    const q = cur; cur = null;
    results.push({ ok: false, score: 0, wrong: tries, skipped: true }); streak = 0;
    reveal(q, 'show'); $('eaSkip').hidden = true;
    setTimeout(() => api.running && next(), 1400);
  });

  function finish() {
    clearTimeout(timer); cur = null;
    $('eaAgain').hidden = true; $('eaSkip').hidden = true;
    const sum = results.reduce((a, r) => a + r.score, 0), ok = results.filter((r) => r.ok).length;
    const wrongs = results.reduce((a, r) => a + (r.wrong || 0), 0), timeouts = results.filter((r) => r.timeout).length, skipped = results.filter((r) => r.skipped).length;
    const lines = [{ label: t('pr.why.hit'), value: `${ok}/${ROUND}` }, { label: t('pr.why.wrong'), value: String(wrongs) }];
    if (timeouts) lines.push({ label: t('pr.why.timeUp'), value: String(timeouts) });
    if (skipped) lines.push({ label: t('pr.why.skipped'), value: String(skipped) });
    api.finish({ score: (sum / ROUND) * 100, tempo: api.bpm, accuracy: ok / ROUND, beginner: beg(), clean: results.every((r) => r.ok && !r.hinted), noTempoUp: beg(), lines });
  }

  return {
    beats: 0,
    levels: [{ id: 'beg', label: t('pr.lvl.beg') }, { id: 'normal', label: t('pr.lvl.normal') }],
    onLevel: () => ready(),
    // „tempo“ = vreme za odgovor (desetinke sekunde); manje = brže
    bpm: { start: 150, min: 40, max: 200, step: 10, dir: -1, unit: 's', label: t('pr.sluh.timeLabel'), fmt: (v) => (v / 10).toLocaleString(getLang() === 'en' ? 'en' : 'sr-Latn', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) },
    async start() {
      n = 0; results = []; cur = null; streak = 0; log.clear();
      ready();
      listener = await api.listen({ chords: mode === 'chord', onPluck, onOnset });
      next();
    },
    stop() { clearTimeout(timer); cur = null; listener = null; stopGroup('practice'); $('eaAgain').hidden = true; $('eaSkip').hidden = true; $('eaBar').style.transition = 'none'; },
  };
}
