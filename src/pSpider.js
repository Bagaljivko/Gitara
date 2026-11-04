// Vežbe → „Pauk“: prsti 1-2-3-4 na četiri susedna praga, žica po žica od debele E do tanke e,
// pa jedan prag više i nazad (4-3-2-1). Jedna nota na svaki klik; igra se na položenoj „stazi“.
import { Metronome } from './rhythm.js';
import { pluck } from './synth.js';
import { OPEN_MIDI, noteLabel } from './practiceBoard.js';
import { judgeTiming, createHitLog, getLatency } from './practiceListen.js';
import { createTrack, enterLandscape, starsOf } from './practiceTrack.js';

const STARTS = [1, 5, 7];
const DEMO_BPM = 72, FIRST_BPM = 50;

/** Niz nota za rundu: [{ s, f, finger }] */
export function spiderSequence(start) {
  const seq = [];
  for (let s = 0; s < 6; s++) for (let k = 0; k < 4; k++) seq.push({ s, f: start + k, finger: k + 1 });
  for (let s = 5; s >= 0; s--) for (let k = 3; k >= 0; k--) seq.push({ s, f: start + 1 + k, finger: k + 1 });
  return seq;
}

export function createGame(api) {
  const { t } = api;
  let start = Number(localStorage.getItem('gitara-pr-pauk-start')) || 1;
  if (!STARTS.includes(start)) start = 1;
  api.opts.innerHTML = `<div class="pr-optlabel">${t('pr.pauk.from')}</div>
    <div class="seg-tabs pr-start" role="radiogroup">${STARTS.map((s) => `<button role="radio" data-st="${s}" class="${s === start ? 'active' : ''}">${t('pr.pauk.fret', { n: s })}</button>`).join('')}</div>`;
  api.opts.addEventListener('click', (e) => {
    const b = e.target.closest('[data-st]');
    if (!b) return;
    start = +b.dataset.st;
    try { localStorage.setItem('gitara-pr-pauk-start', String(start)); } catch {}
    api.opts.querySelectorAll('[data-st]').forEach((x) => x.classList.toggle('active', x === b));
  });
  api.stage.hidden = true; // u uspravnom položaju: samo objašnjenje, izbor i tempo — igra je na stazi

  let track = null, met = null, items = [], timer = 0, unsubLevel = null, runId = 0;
  const log = createHitLog();

  function openTrack() {
    if (track) { track.reset(); return track; }
    track = createTrack({ t, onExit: () => api.stop() });
    return track;
  }
  function closeTrack() { track?.destroy(); track = null; }

  // Nota koja čeka najbliže ovom trzaju (prozor: pola otkucaja, najviše 300 ms)
  const winMs = (beatMs) => Math.min(300, beatMs * 0.5);
  function nearest(at, beatMs) {
    let best = null;
    for (const it of items) if (!it.state && Math.abs(at - it.at) <= winMs(beatMs) && (!best || Math.abs(at - it.at) < Math.abs(at - best.at))) best = it;
    return best;
  }
  function timingText(kind, dt) {
    if (kind === 'hit') return t('pr.trk.hit');
    return dt < 0 ? t('pr.trk.early') : t('pr.trk.late');
  }

  function onPluck(p) {
    if (!api.running || !track) return;
    log.onset({ at: p.at }); log.pluck(p);
    const h = log.hits[log.hits.length - 1];
    const beatMs = 60000 / met.bpm, it = nearest(h.at, beatMs);
    if (!it) return;
    const want = OPEN_MIDI[it.s] + it.f;
    if (!log.matches(h, want)) {
      const m = log.midiOf(h);
      it.wrong = (it.wrong || 0) + 1;
      track.wrong(it, m != null ? t('pr.trk.wrong', { n: noteLabel(m) }) : t('pr.trk.notClear'));
      return; // nota i dalje čeka — može se popraviti u istom prozoru
    }
    const tm = judgeTiming(h.at - it.at, beatMs);
    it.score = (tm.kind === 'off' ? 0.6 : 0.6 + 0.4 * tm.score) * (it.wrong ? 0.7 : 1);
    track.judge(it, tm.kind === 'hit' ? 'hit' : tm.kind === 'off' ? (h.at < it.at ? 'early' : 'late') : tm.kind, timingText(tm.kind, h.at - it.at));
  }
  // Promašaji: nota čiji je prozor prošao (uz kašnjenje mikrofona i ~90 ms provere trzaja)
  function sweep() {
    if (!met || !track) return;
    const beatMs = 60000 / met.bpm, now = performance.now(), lag = winMs(beatMs) + 90 + (getLatency() ?? 60) + 80;
    for (const it of items) if (!it.state && now - it.at > lag) { it.score = 0; track.judge(it, 'miss', t('pr.trk.miss')); }
    const done = items.filter((it) => it.state).length;
    track.progress(done / items.length);
  }

  /** Metronom + staza: count-in 3-2-1, pa note na svaki klik. onBeat(i, it) za svaku notu (demo). */
  function runTrack(bpm, seq, { onBeat, onEnd, demo = false } = {}) {
    const my = ++runId;
    items = seq.map((n) => ({ ...n, at: Infinity }));
    track.setItems(items, 60000 / bpm);
    met = new Metronome();
    met.bpm = bpm; met.sig = '4/4'; met.countIn = 1;
    let k = 0;
    const beats = [];
    track.setBeats(beats);
    met.onStep = (slot, beat, accent, info) => {
      if (my !== runId || beat == null) return;
      const beatMs = 60000 / met.bpm;
      api.pulse(beat, 4, beat === 0);
      if (info.countIn) {
        // prvi klik odbrojavanja: sad znamo kad dolazi svaka nota — note kreću da klize
        if (info.countBeat === 0) {
          items.forEach((it, i) => (it.at = info.at + (4 + i) * beatMs));
          for (let i = 0; i < items.length + 8; i++) beats.push({ at: info.at + i * beatMs, acc: i % 4 === 0 });
        }
        track.big(info.countBeat < 3 ? String(3 - info.countBeat) : t('pr.trk.go'));
        return;
      }
      if (k === 0) track.big('');
      // tačno vreme ovog klika (metronom radi po audio satu) — ostale note se poravnaju na njega
      for (let i = k; i < items.length; i++) items[i].at = info.at + (i - k) * beatMs;
      if (k < items.length) onBeat?.(k, items[k]);
      if (k >= items.length) {
        met.stop();
        setTimeout(() => my === runId && onEnd?.(), demo ? 600 : 900);
        return;
      }
      k++;
    };
    met.start();
  }

  async function play(bpm) {
    enterLandscape(); // mora odmah iz dodira
    openTrack();
    log.clear();
    const lis = await api.listen({ onPluck });
    unsubLevel = api.onLevel((lv, note) => track?.level(lv, note));
    void lis;
    await track.whenLandscape();
    if (!api.running) return;
    timer = setInterval(sweep, 50);
    runTrack(bpm, spiderSequence(start), { onEnd: finish });
  }

  async function finish() {
    if (!api.running || !track) return;
    clearInterval(timer); timer = 0;
    sweep();
    for (const it of items) if (!it.state) { it.score = 0; it.state = 'miss'; }
    const n = items.length, score = (items.reduce((a, it) => a + (it.score || 0), 0) / n) * 100;
    const correct = items.filter((it) => it.score > 0).length, bpm = met.bpm, maxCombo = track.maxCombo;
    const info = await api.finish({ score, tempo: bpm, accuracy: correct / n, quiet: true });
    if (!track) return;
    const stars = starsOf(score);
    const next = info.nextTempo > bpm ? info.nextTempo : bpm + 5;
    const choice = await track.results({
      title: t('pr.trk.res' + stars), stars, score,
      lines: [
        { label: t('pr.accuracy'), value: `${Math.round((correct / n) * 100)}%` },
        { label: t('pr.trk.maxCombo'), value: String(maxCombo) },
        { label: t('pr.tempoReached'), value: `${bpm} BPM` },
      ],
      note: info.newBest ? t('pr.newBest') : '',
      buttons: [
        { id: 'faster', label: t('pr.trk.faster', { bpm: next }), primary: stars >= 2 },
        { id: 'again', label: t('pr.trk.again'), primary: stars < 2 },
        { id: 'back', label: t('pr.trk.back') },
      ],
    });
    if (choice === 'back') { closeTrack(); return; }
    api.setBpm(choice === 'faster' ? next : bpm);
    api.restart();
  }

  // ---------------- Demo (samo na dugme; nikad samo od sebe) ----------------
  async function demo() {
    enterLandscape();
    openTrack();
    await track.whenLandscape();
    if (!api.running) return;
    const my = runId + 1;
    const cap = (k) => track && my === runId && track.caption(t('pr.demo.c' + k));
    track.caption(t('pr.demo.c1'));
    await new Promise((r) => setTimeout(r, 2600));
    if (!api.running || !track) return;
    // tri žice, prsti 1-2-3-4: dovoljno da se vidi kako ide (~20 s ukupno)
    const seq = spiderSequence(1).slice(0, 12);
    runTrack(DEMO_BPM, seq, {
      demo: true,
      onBeat(i, it) {
        if (i === 0) cap(2);
        if (i === 3) cap(3);
        if (i === 5) cap(4);
        if (i === 8) cap(5);
        if (i === 10) cap(6);
        // „svira“ demo: zvuk prave gitare + zelena nota; jedna nota namerno malo rano (da se vidi „Rano“)
        pluck(440 * Math.pow(2, (OPEN_MIDI[it.s] + it.f - 69) / 12), { gain: 0.8, duration: 1.4, group: 'practice' });
        track.judge(it, i === 9 ? 'early' : 'hit', i === 9 ? t('pr.trk.early') : t('pr.trk.hit'), { sound: false });
        track.progress((i + 1) / seq.length);
      },
      onEnd: async () => {
        if (!track || !api.running) return;
        track.caption('');
        api.stopNow(); // demo nije runda: ništa se ne čuva
        const choice = await track.results({
          title: t('pr.demo.end'), stars: null, note: t('pr.demo.slow', { bpm: FIRST_BPM }),
          buttons: [
            { id: 'go', label: t('pr.demo.nowYou'), primary: true },
            { id: 'replay', label: t('pr.demo.replay') },
            { id: 'back', label: t('pr.trk.back') },
          ],
        });
        if (choice === 'back') { closeTrack(); return; }
        if (choice === 'replay') { api.startCustom(demo); return; }
        api.setBpm(FIRST_BPM);
        api.restart();
      },
    });
  }

  return {
    track: true,
    bpm: { start: FIRST_BPM, min: 40, max: 200, step: 5 },
    demo,
    start: (bpm) => play(bpm),
    // zaustavljanje (dugme ✕, izlazak, aplikacija u pozadini): sve se gasi i staza se zatvara
    stop() {
      runId++;
      met?.stop(); met = null;
      clearInterval(timer); timer = 0;
      unsubLevel?.(); unsubLevel = null;
      closeTrack();
    },
    destroy() { this.stop(); },
  };
}
