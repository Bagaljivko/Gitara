// Vežbe → „Pauk“: prsti 1-2-3-4 na četiri susedna praga, žica po žica od debele E do tanke e,
// pa jedan prag više i nazad (4-3-2-1). Jedna nota po udarcu; proverava se nota i ritam.
import { Metronome } from './rhythm.js';
import { createBoard, OPEN_MIDI, noteLabel } from './practiceBoard.js';
import { judgeTiming, createHitLog } from './practiceListen.js';

const STARTS = [1, 5, 7];

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
    preview();
  });
  api.stage.innerHTML = '<div class="pr-board"></div><div class="pr-now" id="pkNow"></div>';
  const board = createBoard(api.stage.querySelector('.pr-board'), { from: 0, to: 9 });
  const now = api.stage.querySelector('#pkNow');

  let seq = [], met = null, beatAt = [], results = [], idx = 0;
  const log = createHitLog();
  const show = (i) => {
    const n = seq[i];
    if (!n) { board.target(null); now.innerHTML = ''; return; }
    board.target(n.s, n.f, String(n.finger));
    now.innerHTML = `${noteLabel(OPEN_MIDI[n.s] + n.f)}<small>${t('pr.pauk.finger', { n: n.finger })}</small>`;
  };
  function preview() {
    seq = spiderSequence(start);
    board.setRange(Math.max(0, start - 1), start + 5);
    show(0);
    api.feedback('info', t('pr.pauk.ready'));
  }
  preview();

  // Ocena cilja i (pošto je njegov prozor prošao): udarac najbliži otkucaju, prava nota?
  function judge(i) {
    const n = seq[i], at = beatAt[i];
    if (!n || at == null || results[i]) return;
    const beatMs = 60000 / api.bpm, want = OPEN_MIDI[n.s] + n.f;
    const cand = log.hits.filter((h) => Math.abs(h.at - at) <= beatMs / 2 && !h.used);
    cand.sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at));
    const h = cand[0];
    let r;
    if (!h) r = { score: 0, ok: false, kind: 'miss', text: t('pr.missed') };
    else {
      h.used = true;
      const midi = log.midiOf(h), noteOk = midi === want;
      const tm = judgeTiming(h.at - at, beatMs);
      r = noteOk
        ? { score: 0.6 + 0.4 * tm.score, ok: true, kind: tm.kind === 'hit' ? 'hit' : tm.kind === 'off' ? 'miss' : tm.kind, text: timingText(tm.kind, h.at - at) }
        : { score: 0, ok: false, kind: 'miss', text: midi ? t('pr.wrongNote', { n: noteLabel(midi) }) : t('pr.missed') };
    }
    results[i] = r;
    board.mark(n.s, n.f, r.ok ? 'hit' : 'miss', String(n.finger));
    api.feedback(r.kind, r.text);
  }
  const timingText = (kind, dt) => kind === 'hit' ? t('pr.onBeat') : kind === 'early' ? t('pr.early', { ms: Math.round(-dt) }) : kind === 'late' ? t('pr.late', { ms: Math.round(dt) }) : t('pr.offBeat');

  return {
    bpm: { start: 60, min: 40, max: 200, step: 5 },
    async start(bpm) {
      seq = spiderSequence(start); beatAt = []; results = []; idx = 0; log.clear();
      await api.listen({ onOnset: (o) => log.onset(o), onNote: (nt) => log.note(nt) });
      met = new Metronome();
      met.bpm = bpm; met.sig = '4/4'; met.countIn = 1;
      met.onStep = (slot, beat, accent, info) => {
        if (beat == null) return;
        api.pulse(beat, 4, beat === 0);
        if (info.countIn) { api.feedback('', String(4 - info.countBeat)); show(0); return; }
        // otkucaj za notu „idx“; prethodnu ocenjujemo malo kasnije (da stigne i očitavanje note)
        beatAt[idx] = info.at;
        const prev = idx - 1;
        if (prev >= 0) setTimeout(() => api.running && judge(prev), 320); // posle prozora za očitavanje note
        show(idx + 1); // nota „idx“ se svira sada — zeleno svetli sledeća, da stigneš da se pripremiš
        if (idx >= seq.length) { met.stop(); setTimeout(finish, 200); return; }
        idx++;
      };
      met.start();
      api.onCleanup(() => met?.stop());
    },
    stop() { met?.stop(); met = null; show(0); },
  };

  function finish() {
    if (!api.running) return;
    for (let i = 0; i < seq.length; i++) if (!results[i]) judge(i);
    const n = seq.length, sum = results.reduce((a, r) => a + (r ? r.score : 0), 0);
    const correct = results.filter((r) => r && r.ok).length;
    show(0);
    api.finish({ score: (sum / n) * 100, tempo: api.bpm, accuracy: correct / n });
  }
}
