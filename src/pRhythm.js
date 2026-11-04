// Vežbe → „Ritam“ na stazi.
// Početnik / Normalno: prazna debela E tačno na udarac (četvrtine, osmine, pauze) — note klize do linije.
// Nivoi 2–4: udaranje akorda po obrascima iz aplikacije (rhythm.js): strelice dole/gore preko bloka akorda.
// Ocenjuje se ritam (rano/kasno); akord se ovde ne proverava. Dugme „Podesi kašnjenje“ važi za sve igre.
import { Metronome, PATTERNS, chordNotes } from './rhythm.js';
import { pluck, strum } from './synth.js';
import { getLatency, setLatency } from './practiceListen.js';
import { trackGame, chordItem } from './practiceTrack.js';

const pat = (id) => PATTERNS.find((p) => p.id === id);
// Početnik/Normalno: osam taktova u osminama (x = udarac, - = pauza)
const L1_BARS = ['x-x-x-x-', 'x-x-x-x-', 'xxxxx-x-', 'x---x-x-', 'xxxxxxxx', 'x-xxx-x-', 'x---x---', 'x-x-x---'];
const LEVELS = {
  2: { pattern: pat('downs'), chords: ['Em', 'Em', 'Em', 'Em', 'Em', 'Em', 'Em', 'Em'] },
  3: { pattern: pat('folk'), chords: ['G', 'G', 'C', 'C', 'G', 'G', 'C', 'G'] },
  4: { pattern: pat('rock'), chords: ['Am', 'Am', 'F', 'F', 'Am', 'Am', 'F', 'Am'] },
};

/** Note na praznoj E po taktovima u osminama. */
function barNotes(bars) {
  const out = [];
  bars.forEach((steps, b) => [...steps].forEach((s, i) => { if (s === 'x') out.push({ kind: 'note', beat: b * 4 + i / 2, s: 0, f: 0, finger: 0, winBeats: 0.25, winCap: 160 }); }));
  return out;
}
/** Udarci po obrascu preko blokova akorda (jedan akord = jedan takt). */
function strumItems({ pattern, chords }, bars = chords.length) {
  const out = [], slot = 4 / pattern.steps.length;
  for (let b = 0; b < bars; b++) {
    out.push(chordItem(chords[b % chords.length], b * 4, 4, { deco: true }));
    [...pattern.steps].forEach((s, i) => {
      if (s === '-') return;
      const it = { kind: 'strum', beat: b * 4 + i * slot, dir: s === 'U' ? 'U' : 'D', winBeats: Math.min(0.5, slot / 2), winCap: 160 };
      if (s === 'x') { it.muted = true; it.deco = true; } // prigušeni udarac: vidi se, ne ocenjuje se
      out.push(it);
    });
  }
  return out;
}

export function createGame(api) {
  const { t } = api;
  api.opts.innerHTML = `<button class="btn small pr-calib" id="rtCalib">${t('pr.calib.btn')}</button>`;
  api.opts.addEventListener('click', (e) => { if (e.target.closest('#rtCalib')) calibrate(); });
  api.stage.hidden = true;

  // ---------------- Podešavanje kašnjenja zvuka (uspravno, 2 takta uz klik) ----------------
  async function calibrate() {
    if (api.running) return;
    api.feedback('info', t('pr.calib.how'));
    await api.startCustom(async () => {
      const onsets = [], expect = [];
      await api.listen({ strums: true, onOnset: (o) => onsets.push(o.at) });
      const met = new Metronome();
      met.bpm = 80; met.sig = '4/4'; met.countIn = 1;
      met.onStep = (slot, beat, accent, info) => {
        if (beat == null) return;
        if (info.countIn) { api.feedback('', String(4 - info.countBeat)); return; }
        if (info.bar >= 2) {
          met.stop();
          setTimeout(() => {
            if (!api.running) return;
            const assumed = getLatency() ?? 60;
            const offs = expect.map((at) => { let b = null; for (const o of onsets) if (Math.abs(o - at) < 300 && (b == null || Math.abs(o - at) < Math.abs(b - at))) b = o; return b == null ? null : b - at; }).filter((x) => x != null).sort((a, b) => a - b);
            if (offs.length < 5) { api.feedback('miss', t('pr.calib.fail')); api.stopNow(); return; }
            const lat = Math.max(0, Math.min(350, assumed + offs[Math.floor(offs.length / 2)]));
            setLatency(lat);
            api.feedback('hit', t('pr.calib.done', { ms: Math.round(lat) }));
            api.stopNow();
          }, 500);
          return;
        }
        expect.push(info.at);
        api.feedback('', '●');
      };
      met.start();
      api.onCleanup(() => met.stop());
    });
  }

  return trackGame(api, {
    levels: [{ id: 'beg', label: t('pr.lvl.beg') }, { id: 'normal', label: t('pr.lvl.normal') }, { id: '2', label: '2' }, { id: '3', label: '3' }, { id: '4', label: '4' }],
    bpm: { start: 70, min: 40, max: 200, step: 5 },
    firstBpm: 60,
    round(level) {
      if (level === 'beg') return { items: barNotes(L1_BARS.slice(0, 4)), hintOf: () => t('pr.ritam.hintE') };
      if (level === 'normal') return { items: barNotes(L1_BARS) };
      const L = LEVELS[level] || LEVELS[2];
      return { items: strumItems(L), fingersOf: () => [] };
    },
    listen(round, input) {
      // ritam: svaki trzaj/udarac se računa (nota i akord se ovde ne proveravaju)
      return { strums: true, onOnset: (o) => input(o.at, () => ({ ok: true })) };
    },
    demo: {
      bpm: 80,
      intro: t('pr.ritam.demo1'),
      items: () => [
        ...barNotes(['x-x-x-x-', 'xxxxx-x-']),
        ...strumItems({ pattern: pat('folk'), chords: ['G', 'C'] }).map((it) => ({ ...it, beat: it.beat + 8 })),
      ],
      fingersOf: (it) => (it.kind === 'note' ? [0] : []),
      play(it) {
        if (it.kind === 'note') pluck(82.41, { gain: 0.8, duration: 0.6, group: 'practice' });
        else strum(0, it.dir, { notes: chordNotes(it.beat < 12 ? 'G' : 'C'), group: 'practice' });
      },
      early: (i) => i === 6,
      captions: { 0: t('pr.ritam.demo2'), 4: t('pr.ritam.demo3'), 6: t('pr.ritam.demo4'), 9: t('pr.ritam.demo5'), 13: t('pr.ritam.demo6') },
    },
  });
}
