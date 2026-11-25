// v2.4.32: Vežbe → „Barré“: barré akordi korak po korak. Aplikacija sluša žicu po žicu — svaka mora da zazvoni.
//   1 Kažiprst  — samo kažiprst preko svih žica na pragu akorda (prst ravno, blizu žice praga)
//   2 Mali hvat — lakši oblik istog akorda na 4 žice (npr. mali F: xx3211)
//   3 Ceo hvat  — pun barré, žica po žica nagore i nadole
//   4 Promene   — u barré i nazad (C → F, Am → F, G → Bm …) — otvara Promene akorda sa tim nizom
// Iz pesme (#/vezbe/bare?song=ID): barré akordi te pesme. Rezultat se pamti po akordu i koraku.
import { pluck } from './synth.js';
import { OPEN_MIDI } from './practiceBoard.js';
import { createHitLog } from './practiceListen.js';
import { trackGame, noteHint, notePluck } from './practiceTrack.js';
import { getVoicings, easyIndex } from './chords.js';
import { dn } from './naming.js';

export const BARRE = ['F', 'Bm', 'Bb', 'F#m', 'Cm', 'Gm', 'C#m', 'Fm'];
const INTO = { F: ['C', 'F'], Bm: ['G', 'Bm'], Bb: ['F', 'Bb'], 'F#m': ['D', 'F#m'], Cm: ['G', 'Cm'], Gm: ['D', 'Gm'], 'C#m': ['A', 'C#m'], Fm: ['C', 'Fm'] };
const STAGES = ['prst', 'mali', 'ceo', 'prom'];
const midiOf = (it) => OPEN_MIDI[it.s] + it.f;

/** Note za korak: žica po žica nagore pa nadole. */
export function barreNotes(chord, stage) {
  const vs = getVoicings(chord);
  const full = vs.find((v) => v.barre && !v.easy) || vs[0];
  if (!full) return [];
  if (stage === 'prst') { // samo kažiprst na pragu barréa, preko žica koje barré pokriva
    const b = full.barre || { fret: Math.min(...full.frets.filter((f) => f > 0)), from: 0, to: 5 };
    const up = []; for (let s = b.from; s <= b.to; s++) up.push({ s, f: b.fret, finger: 1 });
    return [...up, ...up.slice(0, -1).reverse()];
  }
  const v = stage === 'mali' ? vs[easyIndex(chord)] || full : full;
  const up = []; v.frets.forEach((f, s) => { if (f >= 0) up.push({ s, f, finger: f > 0 ? v.fingers[s] || 1 : 0 }); });
  return [...up, ...up.slice(0, -1).reverse()];
}

export async function createGame(api) {
  const { t, esc } = api;
  let fromSong = [];
  const sid = api.params && api.params.get && api.params.get('song');
  if (sid) {
    try {
      const { songs } = await import('./db.js'); const P = await import('./pSong.js');
      const song = await songs.get(sid);
      const ch = song ? [...new Set(P.songParts(song).flatMap((p) => p.chords.map((c) => c.chord)))] : [];
      fromSong = ch.filter((c) => { const v = getVoicings(c)[0]; return v && v.barre; }).slice(0, 4);
    } catch {}
  }
  const list = fromSong.length ? fromSong : BARRE.slice(0, 4);
  let chord = list.includes(localStorage.getItem('gitara-bare-ch')) ? localStorage.getItem('gitara-bare-ch') : list[0];
  let stage = STAGES.includes(localStorage.getItem('gitara-bare-st')) ? localStorage.getItem('gitara-bare-st') : 'prst';
  const save = () => { try { localStorage.setItem('gitara-bare-ch', chord); localStorage.setItem('gitara-bare-st', stage); } catch {} };
  const draw = () => {
    api.opts.innerHTML = `<div class="pr-optlabel">${esc(t('br.chord'))}${fromSong.length ? ` <span class="muted">· ${esc(t('br.fromSong'))}</span>` : ''}</div>
      <div class="pr-chips">${list.map((c) => `<button class="chip${c === chord ? ' active' : ''}" data-ch="${esc(c)}">${esc(dn(c))}</button>`).join('')}</div>
      <div class="pr-optlabel">${esc(t('br.stage'))}</div>
      <div class="set-grp br-st">${STAGES.map((k, i) => `<button type="button" class="tch-row${k === stage ? ' on' : ''}" data-st="${k}"><span class="sr-ic">${i + 1}</span><span><b>${esc(t('br.s.' + k))}</b><small>${esc(t('br.s.' + k + 'Sub', { c: dn(chord), a: dn((INTO[chord] || ['C'])[0]) }))}</small></span><i class="br-rd" aria-hidden="true"></i></button>`).join('')}</div>`;
  };
  api.opts.addEventListener('click', (e) => {
    if (api.running) return;
    const c = e.target.closest('[data-ch]'); if (c) { chord = c.dataset.ch; save(); draw(); api.restart?.(); return; }
    const s = e.target.closest('[data-st]'); if (!s) return;
    stage = s.dataset.st; save(); draw();
    if (stage === 'prom') { const seq = INTO[chord] || ['C', chord]; location.hash = '#/vezbe/promena?' + (sid ? 'song=' + encodeURIComponent(sid) + '&' : '') + 'ch=' + encodeURIComponent(seq.join('-')); }
  });
  draw();
  api.stage.hidden = true;
  const log = createHitLog();
  return trackGame(api, {
    levels: [{ id: 'beg', label: t('pr.lvl.beg') }, { id: 'normal', label: t('pr.lvl.normal') }],
    bpm: { start: 45, min: 30, max: 120, step: 5 },
    firstBpm: 40,
    round() {
      log.clear();
      const notes = barreNotes(chord, stage === 'prom' ? 'ceo' : stage);
      return { items: notes.map((n, i) => ({ kind: 'note', beat: i, ...n })), lagMs: 180, hintOf: (it) => noteHint(t, it), key: sid ? [sid, 'bare'] : null };
    },
    listen(round, input) { return { onPluck: notePluck(api, log, input, t, 'bare', midiOf) }; },
    demo: {
      bpm: 60,
      intro: t('br.demo1'),
      items: () => barreNotes('F', 'prst').map((n, i) => ({ kind: 'note', beat: i, ...n })),
      play: (it) => pluck(440 * Math.pow(2, (midiOf(it) - 69) / 12), { gain: 0.8, duration: 1.4, group: 'practice' }),
      captions: { 0: t('br.demo2'), 3: t('br.demo3') },
    },
  });
}
