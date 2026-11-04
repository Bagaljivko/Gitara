// Vežbe: mali zajednički delovi za sve igre (staza i kvizovi). Lovac na note i Sluh učitavaju samo ovo,
// ne celu stazu (practiceTrack.js).
import { audioCtx } from './synth.js';
import { OPEN_MIDI } from './practiceBoard.js';

// Kratak „cink“ za pogodak: kraći od 90 ms, pa ga mikrofon ne računa kao trzaj (vidi practiceListen.js)
export function hitSound() {
  try {
    const c = audioCtx(), t0 = c.currentTime + 0.005;
    for (const [f, g] of [[1568, 0.07], [2349, 0.035]]) {
      const o = c.createOscillator(), a = c.createGain();
      o.type = 'sine'; o.frequency.value = f;
      a.gain.setValueAtTime(0.0001, t0);
      a.gain.exponentialRampToValueAtTime(g, t0 + 0.004);
      a.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
      o.connect(a).connect(c.destination);
      o.start(t0); o.stop(t0 + 0.08);
    }
  } catch {}
}

/** Gde je odsvirana nota: na žici mete ako može (prag 0–15), inače na najbližoj žici gde može. */
export function placeOf(midi, s0) {
  const fits = (s) => midi - OPEN_MIDI[s] >= 0 && midi - OPEN_MIDI[s] <= 15;
  if (fits(s0)) return { s: s0, f: midi - OPEN_MIDI[s0] };
  for (let d = 1; d < 6; d++) for (const s of [s0 - d, s0 + d]) if (s >= 0 && s < 6 && fits(s)) return { s, f: midi - OPEN_MIDI[s] };
  return null;
}

/** Isto za kvizove (Lovac, Sluh): onRight(h) / onWrong(heardMidi|null, h). */
export function quizPluck(api, log, p, midi, game, onRight, onWrong) {
  log.onset({ at: p.at }); log.pluck(p);
  const h = log.hits[log.hits.length - 1];
  const decide = () => {
    const v = log.verdict(h, midi, game);
    if (v.ok) return onRight(h);
    if (v.unclear && api.listener) { api.listener.steady(p.rawAt ?? p.at, (sg) => { log.steadied(h, sg); decide(); }); return; }
    onWrong(v.heard, h);
  };
  decide();
}
