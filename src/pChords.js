// Vežbe → „Promena akorda“ na stazi: blokovi akorda klize do linije; kad blok stigne, udari taj akord.
// Tačke u bloku su u bojama prstiju. Čista promena = na vreme + čuje se većina tonova novog akorda
// (blaga provera, radi i sa mikrofonom telefona). Normalno: runda traje oko minut. Početnik: staza čeka na svaki akord.
import { strum } from './synth.js';
import { chordNotes } from './rhythm.js';
import { chordSVG } from './diagram.js';
import { dn } from './naming.js';
import { esc } from './ui.js';
import { trackGame, chordItem, chordFingers } from './practiceTrack.js';

export const PAIRS = [['Em', 'G'], ['G', 'C'], ['C', 'Am'], ['D', 'A'], ['G', 'D'], ['Am', 'E'], ['C', 'F']];
const CHOICES = ['C', 'D', 'E', 'F', 'G', 'A', 'Am', 'Dm', 'Em', 'A7', 'D7', 'E7', 'G7', 'C7', 'B7', 'Fmaj7', 'Cadd9', 'Dsus4', 'Asus2'];
const ROUND_MS = 60000;

/** Blaga provera akorda: većina tonova + osnovni ton; ako drugi akord iz para „pristaje“ bolje — to je bio on. */
export function checkChord(listener, want, other) {
  if (!listener) return { ok: false };
  const w = listener.chordHeard(want), o = other ? listener.chordHeard(other) : null;
  return { ok: !!(w.ok && !(o && o.ok && o.share > w.share + 0.08)) };
}

export function createGame(api) {
  const { t } = api;
  const load = () => { try { return JSON.parse(localStorage.getItem('gitara-pr-promena') || 'null'); } catch { return null; } };
  const saved = load() || {};
  let pair = Array.isArray(saved.pair) && saved.pair.length === 2 ? saved.pair : PAIRS[0];
  let every = saved.every === 4 ? 4 : 2;
  const save = () => { try { localStorage.setItem('gitara-pr-promena', JSON.stringify({ pair, every })); } catch {} };
  const key = (p) => p.join('-');

  function drawOpts() {
    const custom = !PAIRS.some((p) => key(p) === key(pair));
    api.opts.innerHTML = `<div class="pc-pair">${pair.map((c) => `<div class="pc-ch target"><div class="chord-big">${chordSVG(c, { colorFingers: true })}</div></div>`).join('<span class="pc-arrow" aria-hidden="true">⇄</span>')}</div>
      <div class="pr-optlabel">${t('pr.promena.pairs')}</div>
      <div class="pr-chips">${PAIRS.map((p) => `<button class="chip${key(p) === key(pair) ? ' active' : ''}" data-p="${key(p)}">${esc(dn(p[0]))} – ${esc(dn(p[1]))}</button>`).join('')}
        <button class="chip${custom ? ' active' : ''}" data-own="1">${t('pr.promena.own')}</button></div>
      <div class="pr-own" ${custom ? '' : 'hidden'}>
        ${[0, 1].map((i) => `<select data-i="${i}" aria-label="${t('pr.promena.chord', { n: i + 1 })}">${CHOICES.map((c) => `<option value="${c}"${c === pair[i] ? ' selected' : ''}>${esc(dn(c))}</option>`).join('')}</select>`).join('<span>–</span>')}
      </div>
      <div class="pr-optlabel">${t('pr.promena.when')}</div>
      <div class="seg-tabs" role="radiogroup">
        <button role="radio" data-e="2" class="${every === 2 ? 'active' : ''}">${t('pr.promena.every2')}</button>
        <button role="radio" data-e="4" class="${every === 4 ? 'active' : ''}">${t('pr.promena.every4')}</button>
      </div>`;
  }
  drawOpts();
  api.opts.addEventListener('click', (e) => {
    const p = e.target.closest('[data-p]'), own = e.target.closest('[data-own]'), ev = e.target.closest('[data-e]');
    if (p) { pair = p.dataset.p.split('-'); save(); drawOpts(); }
    if (own) { api.opts.querySelector('.pr-own').hidden = false; api.opts.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === own)); }
    if (ev) { every = +ev.dataset.e; save(); drawOpts(); }
  });
  api.opts.addEventListener('change', (e) => {
    const s = e.target.closest('select[data-i]');
    if (!s) return;
    const np = pair.slice(); np[+s.dataset.i] = s.value;
    if (np[0] === np[1]) return;
    pair = np; save(); drawOpts();
  });
  api.stage.hidden = true;

  const items = (n) => Array.from({ length: n }, (_, i) => chordItem(pair[i % 2], i * every, every));
  return trackGame(api, {
    levels: [{ id: 'beg', label: t('pr.lvl.beg') }, { id: 'normal', label: t('pr.lvl.normal') }],
    bpm: { start: 60, min: 40, max: 160, step: 5 },
    firstBpm: 50,
    round(level, bpm) {
      const n = level === 'beg' ? 8 : Math.max(8, Math.floor(ROUND_MS / ((60000 / bpm) * every)));
      return { items: items(n), lagMs: 350 + 90 + 80, fingersOf: chordFingers, hintOf: (it) => t('pr.promena.hint', { c: it.label }) };
    },
    listen(round, input) {
      // akord se proverava ~0,35 s posle udarca (dok se tonovi „skupe“)
      return {
        chords: true,
        onOnset: (o) => setTimeout(() => input(o.at, (it) => {
          const r = checkChord(api.listener, it.chord, pair.find((c) => c !== it.chord));
          return r.ok ? r : { ok: false, text: t('pr.promena.notClearShort', { c: it.label }) };
        }), 350),
      };
    },
    demo: {
      bpm: 70,
      intro: t('pr.promena.demo1'),
      items: () => Array.from({ length: 6 }, (_, i) => chordItem(['G', 'C'][i % 2], i * 2, 2)),
      fingersOf: chordFingers,
      play: (it) => strum(0, 'D', { notes: chordNotes(it.chord), group: 'practice' }),
      early: (i) => i === 4,
      captions: { 0: t('pr.promena.demo2'), 1: t('pr.promena.demo3'), 2: t('pr.promena.demo4'), 4: t('pr.promena.demo5'), 5: t('pr.promena.demo6') },
    },
  });
}
