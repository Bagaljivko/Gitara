// Vežbe → „Pauk“: prsti 1-2-3-4 na četiri susedna praga, žica po žica od debele E do tanke e,
// pa jedan prag više i nazad (4-3-2-1). Jedna nota na svaki klik; igra se na položenoj „stazi“.
// Boja note = prst (1 plavo, 2 žuto, 3 roze, 4 ljubičasto). Početnik: staza čeka na svaku notu.
import { pluck } from './synth.js';
import { OPEN_MIDI } from './practiceBoard.js';
import { createHitLog } from './practiceListen.js';
import { trackGame, noteHint, notePluck } from './practiceTrack.js';

const STARTS = [1, 5, 7];

/** Niz nota za rundu: [{ s, f, finger }] */
export function spiderSequence(start) {
  const seq = [];
  for (let s = 0; s < 6; s++) for (let k = 0; k < 4; k++) seq.push({ s, f: start + k, finger: k + 1 });
  for (let s = 5; s >= 0; s--) for (let k = 3; k >= 0; k--) seq.push({ s, f: start + 1 + k, finger: k + 1 });
  return seq;
}
const toItems = (seq) => seq.map((n, i) => ({ kind: 'note', beat: i, ...n }));
const midiOf = (it) => OPEN_MIDI[it.s] + it.f;

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
  api.stage.hidden = true; // uspravno: objašnjenje, nivo, izbor i tempo — igra je na stazi

  const log = createHitLog();
  return trackGame(api, {
    levels: [{ id: 'beg', label: t('pr.lvl.beg') }, { id: 'normal', label: t('pr.lvl.normal') }],
    bpm: { start: 50, min: 40, max: 200, step: 5 },
    firstBpm: 50,
    round(level) {
      log.clear();
      const seq = spiderSequence(start);
      // Početnik: samo put naviše (24 note) — kraće, jer staza čeka na svaku notu
      return { items: toItems(level === 'beg' ? seq.slice(0, 24) : seq), lagMs: 180, hintOf: (it) => noteHint(t, it) };
    },
    listen(round, input) {
      return { onPluck: notePluck(api, log, input, t, 'pauk', midiOf) };
    },
    demo: {
      bpm: 72,
      intro: t('pr.pauk.demo1'),
      // tri žice, prsti 1-2-3-4 — dovoljno da se vidi kako ide (~20 s ukupno)
      items: () => toItems(spiderSequence(1).slice(0, 12)),
      play: (it) => pluck(440 * Math.pow(2, (midiOf(it) - 69) / 12), { gain: 0.8, duration: 1.4, group: 'practice' }),
      early: (i) => i === 9,
      captions: { 0: t('pr.pauk.demo2'), 2: t('pr.pauk.demo3'), 4: t('pr.pauk.demo4'), 6: t('pr.pauk.demo5'), 9: t('pr.pauk.demo6'), 10: t('pr.pauk.demo7') },
    },
  });
}
