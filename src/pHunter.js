// Vežbe → „Lovac na note“: pojavi se nota i žica; nađi je i odsviraj pre nego što istekne vreme.
// Što si bolji, vreme po noti je kraće (preko 90 poena → sledeća runda brža).
import { createBoard, OPEN_MIDI, noteLabel } from './practiceBoard.js';
import { getLang } from './i18n.js';
import { sameNote, createHitLog } from './practiceListen.js';

const ROUND = 12;
const RANGES = { low: [0, 5], mid: [0, 9], all: [0, 12] };

export function createGame(api) {
  const { t } = api;
  let range = localStorage.getItem('gitara-pr-lovac-range') || 'low';
  if (!RANGES[range]) range = 'low';
  api.opts.innerHTML = `<div class="pr-optlabel">${t('pr.lovac.range')}</div>
    <div class="seg-tabs" role="radiogroup">${Object.keys(RANGES).map((k) => `<button role="radio" data-r="${k}" class="${k === range ? 'active' : ''}">${t('pr.lovac.r_' + k)}</button>`).join('')}</div>`;
  api.opts.addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    range = b.dataset.r;
    try { localStorage.setItem('gitara-pr-lovac-range', range); } catch {}
    api.opts.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('active', x === b));
    board.setRange(...RANGES[range]);
  });
  api.stage.innerHTML = `<div class="pr-board"></div>
    <div class="pr-now" id="lvNow">–</div>
    <div class="pr-timer" aria-hidden="true"><i id="lvBar"></i></div>
    <div class="small muted" id="lvCount"></div>`;
  const board = createBoard(api.stage.querySelector('.pr-board'), { from: RANGES[range][0], to: RANGES[range][1] });
  const $ = (id) => api.stage.querySelector('#' + id);
  api.feedback('info', t('pr.lovac.ready'));

  let n = 0, cur = null, t0 = 0, timer = 0, results = [];
  const secs = (ms) => (ms / 1000).toLocaleString(getLang() === 'en' ? 'en' : 'sr-Latn', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const limitMs = () => api.bpm * 100; // tempo ovde = desetinke sekunde po noti

  function pick() {
    const [lo, hi] = RANGES[range];
    let s, f;
    do { s = Math.floor(Math.random() * 6); f = lo + Math.floor(Math.random() * (hi - lo + 1)); } while (cur && cur.s === s && cur.f === f);
    return { s, f, midi: OPEN_MIDI[s] + f };
  }
  function next() {
    clearTimeout(timer);
    if (n >= ROUND) return finish();
    cur = pick(); n++;
    board.target(cur.s, cur.f, noteLabel(cur.midi));
    $('lvNow').innerHTML = `${noteLabel(cur.midi)}<small>${t('pr.lovac.onString', { n: 6 - cur.s, s: noteLabel(OPEN_MIDI[cur.s]) })}</small>`;
    $('lvCount').textContent = `${n} / ${ROUND}`;
    const bar = $('lvBar');
    bar.style.transition = 'none'; bar.style.width = '100%'; void bar.offsetWidth;
    bar.style.transition = `width ${limitMs()}ms linear`; bar.style.width = '0%';
    t0 = performance.now();
    timer = setTimeout(() => {
      results.push({ ok: false, score: 0 });
      board.mark(cur.s, cur.f, 'miss', noteLabel(cur.midi));
      api.feedback('miss', t('pr.lovac.timeUp', { n: noteLabel(cur.midi) }));
      setTimeout(() => api.running && next(), 650);
    }, limitMs());
  }
  // Svaki trzaj posle pojave cilja: 0,3 s kasnije uzmi notu koja se najčešće čula (prvi delić sekunde
  // posle trzaja ume da „preskoči“ na prizvuk), pa odluči: tačno ili druga nota.
  const log = createHitLog();
  function onOnset(o) {
    if (!cur || !api.running || o.at < t0 - 20) return;
    log.onset(o);
    const h = log.hits[log.hits.length - 1], target = cur;
    setTimeout(() => judgePluck(h, target), 320);
  }
  function judgePluck(h, target) {
    if (!api.running || cur !== target) return;
    const midi = log.midiOf(h);
    if (midi == null) return;
    if (sameNote(midi, target.midi)) {
      clearTimeout(timer);
      const took = Math.max(0, h.at - t0), rest = Math.max(0, 1 - took / limitMs());
      results.push({ ok: true, score: 0.55 + 0.45 * rest });
      board.mark(target.s, target.f, 'hit', noteLabel(target.midi));
      api.feedback('hit', t('pr.lovac.found', { s: secs(took) }));
      cur = null;
      setTimeout(() => api.running && !cur && next(), 450);
    } else api.feedback('miss', t('pr.lovac.thatIs', { n: noteLabel(midi) }));
  }

  function finish() {
    clearTimeout(timer); cur = null;
    board.target(null);
    const sum = results.reduce((a, r) => a + r.score, 0), ok = results.filter((r) => r.ok).length;
    api.finish({ score: (sum / ROUND) * 100, tempo: api.bpm, accuracy: ok / ROUND });
  }

  return {
    noTempoBeat: true,
    beats: 0,
    // „tempo“ = vreme po noti u desetinkama sekunde: 8,0 s na početku, najkraće 1,5 s; manje = brže
    bpm: { start: 80, min: 15, max: 120, step: 5, dir: -1, unit: 's', fmt: (v) => (v / 10).toLocaleString(getLang() === 'en' ? 'en' : 'sr-Latn', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
    async start() {
      n = 0; results = []; cur = null;
      log.clear();
      await api.listen({ onOnset, onNote: (nt) => log.note(nt) });
      next();
    },
    stop() { clearTimeout(timer); cur = null; board.target(null); $('lvBar').style.transition = 'none'; },
  };
}
