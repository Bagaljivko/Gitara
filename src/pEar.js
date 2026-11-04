// Vežbe → „Sluh“: aplikacija odsvira ton (ili akord) postojećim zvukom gitare; ti ga nađi i odsviraj.
// Tri pokušaja po pitanju; posle se pokaže gde je. Preko 90 poena → manje vremena po pitanju.
import { audioCtx, pluck, strum, stopGroup } from './synth.js';
import { chordNotes } from './rhythm.js';
import { chordSVG } from './diagram.js';
import { createBoard, OPEN_MIDI, noteLabel } from './practiceBoard.js';
import { sameNote, createHitLog } from './practiceListen.js';
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
    if (!b) return;
    mode = b.dataset.m;
    try { localStorage.setItem('gitara-pr-sluh-mode', mode); } catch {}
    api.opts.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('active', x === b));
    reveal(null);
  });
  api.stage.innerHTML = `<div class="ear-q" id="eaQ">?</div>
    <div class="ear-reveal" id="eaRev"></div>
    <button class="btn small" id="eaAgain" hidden>${t('pr.sluh.again')}</button>
    <div class="pr-timer" aria-hidden="true"><i id="eaBar"></i></div>
    <div class="small muted" id="eaCount"></div>`;
  const $ = (id) => api.stage.querySelector('#' + id);
  api.feedback('info', t('pr.sluh.ready'));

  let n = 0, cur = null, tries = 0, results = [], quietUntil = 0, timer = 0, t0 = 0, listener = null, lastWrong = -1e9;
  const log = createHitLog();
  const limitMs = () => api.bpm * 100; // desetinke sekunde po pitanju
  const secs = (ms) => (ms / 1000).toLocaleString(getLang() === 'en' ? 'en' : 'sr-Latn', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function reveal(q) {
    if (!q) { $('eaRev').innerHTML = ''; $('eaQ').textContent = '?'; return; }
    if (q.chord) $('eaRev').innerHTML = `<div class="chord-big ear-chord">${chordSVG(q.chord)}</div>`;
    else { $('eaRev').innerHTML = '<div class="pr-board"></div>'; createBoard($('eaRev').querySelector('.pr-board'), { from: 0, to: 5 }).target(q.s, q.f, noteLabel(q.midi)); }
    $('eaQ').textContent = q.chord ? dn(q.chord) : noteLabel(q.midi);
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
    while (cur && (q.chord ? q.chord === cur.chord : q.midi === cur.midi));
    cur = q; n++; tries = 0; lastWrong = -1e9;
    reveal(null);
    $('eaAgain').hidden = false;
    $('eaCount').textContent = `${n} / ${ROUND}`;
    play(q);
    const bar = $('eaBar');
    bar.style.transition = 'none'; bar.style.width = '100%'; void bar.offsetWidth;
    bar.style.transition = `width ${limitMs() + 1700}ms linear`; bar.style.width = '0%';
    t0 = performance.now();
    timer = setTimeout(() => answer(false, true), limitMs() + 1700);
  }
  function answer(ok, timeout = false) {
    if (!cur) return;
    const q = cur;
    if (ok) {
      const took = performance.now() - t0;
      results.push({ ok: true, score: [1, 0.7, 0.4][tries] ?? 0.4 });
      api.feedback('hit', t('pr.sluh.right', { s: secs(took) }));
    } else if (timeout || tries + 1 >= TRIES) {
      results.push({ ok: false, score: 0 });
      api.feedback('miss', t('pr.sluh.was', { x: q.chord ? dn(q.chord) : noteLabel(q.midi) }));
    } else {
      // jedan trzaj = najviše jedan pokušaj (zvuk jedne žice ponekad izgleda kao dva udarca)
      if (performance.now() - lastWrong < 700) return;
      lastWrong = performance.now();
      tries++;
      api.feedback('miss', t('pr.sluh.tryAgain', { n: TRIES - tries }));
      return;
    }
    clearTimeout(timer);
    cur = null;
    reveal(q);
    setTimeout(() => api.running && next(), 1600);
  }
  function onOnset(o) {
    if (!cur || performance.now() < quietUntil) return;
    log.onset(o);
    const h = log.hits[log.hits.length - 1], q = cur;
    setTimeout(() => {
      if (!api.running || cur !== q) return;
      if (q.chord) answer(listener.chordHeard(q.chord).ok);
      else { const m = log.midiOf(h); if (m != null) answer(sameNote(m, q.midi)); }
    }, q.chord ? 380 : 320);
  }
  $('eaAgain').addEventListener('click', () => { if (cur) play(cur); });

  function finish() {
    clearTimeout(timer); cur = null;
    $('eaAgain').hidden = true;
    const sum = results.reduce((a, r) => a + r.score, 0), ok = results.filter((r) => r.ok).length;
    api.finish({ score: (sum / ROUND) * 100, tempo: api.bpm, accuracy: ok / ROUND });
  }

  return {
    beats: 0,
    // „tempo“ = vreme za odgovor (desetinke sekunde); manje = brže
    bpm: { start: 150, min: 40, max: 200, step: 10, dir: -1, unit: 's', label: t('pr.sluh.timeLabel'), fmt: (v) => (v / 10).toLocaleString(getLang() === 'en' ? 'en' : 'sr-Latn', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) },
    async start() {
      n = 0; results = []; cur = null; log.clear();
      listener = await api.listen({ chords: mode === 'chord', onOnset, onNote: (nt) => log.note(nt) });
      next();
    },
    stop() { clearTimeout(timer); cur = null; listener = null; stopGroup('practice'); $('eaAgain').hidden = true; $('eaBar').style.transition = 'none'; },
  };
}
