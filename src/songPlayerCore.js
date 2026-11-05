// „Pusti“ — raspored sviranja (bez zvuka i DOM-a, testira se u Node-u): događaji se zakazuju po zvučnom satu ~0,3 s
// unapred; tempo 25–100 %, petlja dela (bez rupe u ritmu), sviranje od bilo koje dobe, „deo jednom“ (until).
// opts: { bpm, rate, ctx() → AudioContext (currentTime), play(e, when, sekunde), silence(), onState(on), onEnd() }
export function createPlayerWith(tl, { bpm = 80, rate = 1, ctx, play, silence, onState, onEnd } = {}) {
  let c = null, playing = false, mute = false;
  let t0 = 0, beat0 = 0, prev = null, bps = (bpm * rate) / 60, sched = 0, loop = null, until = null, idx = 0;
  const fired = []; // događaji koji su zazvučali (za isticanje na ekranu)
  const dbg = () => (typeof window !== 'undefined' && window.__plDebug) || null;
  const timeOf = (beat) => t0 + (beat - beat0) / bps;
  const beatAt = (time) => beat0 + (time - t0) * bps;
  const find = (beat) => { let i = 0; while (i < tl.events.length && tl.events[i].beat < beat - 1e-6) i++; return i; };

  function tick() {
    if (!playing) return;
    let ahead = beatAt(c.currentTime + 0.3);
    const end = until ?? loop?.to ?? tl.total;
    while (sched < ahead) {
      if (sched >= end - 1e-6) {
        if (loop) { // nazad na početak dela, bez rupe u ritmu
          prev = { t0, beat0, until: timeOf(loop.to) };
          t0 = timeOf(loop.to); beat0 = loop.from; sched = loop.from; idx = find(loop.from);
          ahead = beatAt(c.currentTime + 0.3); // novo sidro — inače bi se deo zakazivao u krug
          continue;
        }
        if (c.currentTime > timeOf(end) + 0.2) { stop(); onEnd?.(); }
        return;
      }
      while (idx < tl.events.length && tl.events[idx].beat < Math.min(ahead, end) - 1e-6) {
        const e = tl.events[idx++];
        if (e.beat < sched - 1e-6) continue;
        const when = timeOf(e.beat);
        if (!mute) play(e, when, (e.dur || 1) / bps);
        fired.push({ e, when });
        dbg()?.push({ beat: e.beat, when, kind: e.kind, midi: e.midi, chord: e.chord, dir: e.dir, f0: e.freqs && Math.min(...e.freqs), ref: e.ref, mute });
      }
      sched = Math.min(ahead, end);
    }
  }
  function start(fromBeat) {
    c = ctx();
    if (c.state === 'suspended') c.resume?.().catch?.(() => {});
    playing = true; prev = null;
    t0 = c.currentTime + 0.12; beat0 = fromBeat; sched = fromBeat; idx = find(fromBeat); fired.length = 0;
    onState?.(true);
    tick();
  }
  function stop() {
    if (!playing) return;
    const b = api.beat;
    playing = false;
    onState?.(false);
    silence?.();
    dbg()?.push({ stopAt: c.currentTime });
    api.pos = Math.min(b, tl.total);
  }
  const api = {
    pos: 0,
    tick,
    /** Sviraj od dobe (podrazumevano: gde je stalo). until = stani na toj dobi (deo jednom). */
    play(fromBeat = api.pos, { until: u = null } = {}) { until = u; start(Math.max(0, Math.min(fromBeat, tl.total - 1e-3))); },
    pause: stop,
    stop() { stop(); api.pos = 0; },
    get playing() { return playing; },
    /** Trenutna doba (po zvučnom satu; posle skoka petlje se do skoka računa po starom sidru). */
    get beat() {
      if (!playing) return api.pos;
      const now = c.currentTime;
      if (prev && now < prev.until) return prev.beat0 + (now - prev.t0) * bps;
      return Math.max(beat0, beatAt(now));
    },
    /** Događaji koji su upravo zazvučali (svaki se vraća jednom). */
    drain() { if (!c) return []; const now = c.currentTime, out = []; while (fired.length && fired[0].when <= now) out.push(fired.shift().e); return out; },
    setRate(r) {
      const nb = (Math.max(0.25, Math.min(1, r)) * bpm) / 60;
      if (playing) { const now = c.currentTime + 0.05; beat0 = api.beat; t0 = now; prev = null; }
      bps = nb;
    },
    setLoop(part) { loop = part ? { from: part.from, to: part.to } : null; if (loop && playing && (api.beat < loop.from || api.beat >= loop.to)) { stop(); api.play(loop.from); } },
    setMute(m) { mute = !!m; if (mute) silence?.(); },
    get muted() { return mute; },
    destroy() { stop(); },
  };
  return api;
}
