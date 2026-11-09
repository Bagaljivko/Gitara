// Zvuk koji aplikacija sama pravi: referentni ton žice, klik metronoma i udarac za ritmove.
import { pluckedString } from './ks.js';
import { nearestNote, sampleFreq, loadedNote, loadNote, preloadAll } from './guitarSamples.js';
let ctx = null;

export function audioCtx() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    ctx = new C();
    // Snimci gitare se učitavaju u pozadini čim aplikacija prvi put pusti zvuk
    setTimeout(() => preloadAll(ctx), 0);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// ---- Zvuk gitare ----
// Glavni zvuk su snimljeni tonovi prave akustične gitare (src/guitarSamples.js).
// Fizički model žice (src/ks.js) je rezerva ako snimak ne može da se učita (npr. bez interneta pre prvog preuzimanja).
const buses = new WeakMap();
function guitarBus(c) {
  if (buses.has(c)) return buses.get(c);
  // Limiter: akord od 6 žica ne sme da „pucketa“ (izobličenje) ni na glasnom telefonu
  const lim = c.createDynamicsCompressor();
  lim.threshold.value = -10; lim.knee.value = 6; lim.ratio.value = 6; lim.attack.value = 0.003; lim.release.value = 0.25;
  lim.connect(c.destination);
  // Kratak odjek sobe (veštački impuls: šum koji brzo utihne)
  const rev = c.createGain();
  try {
    // v1.86: kraći (0,45 s) i mono odjek — 4× manje posla po noti; slabiji telefoni ne „pucketaju“ dok akord zvuči
    const len = Math.round(c.sampleRate * 0.45), ir = c.createBuffer(1, len, c.sampleRate);
    for (let ch = 0; ch < 1; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) { lp += 0.35 * ((Math.random() * 2 - 1) - lp); d[i] = lp * Math.pow(1 - i / len, 3.2); }
    }
    const conv = c.createConvolver(); conv.buffer = ir;
    rev.connect(conv).connect(lim);
  } catch {}
  // Snimci već imaju telo gitare: direktno + malo prostora
  const sample = c.createGain();
  sample.connect(lim);
  const sampleSend = c.createGain(); sampleSend.gain.value = 0.1;
  sample.connect(sampleSend).connect(rev);
  // Fizički model: rezonance drvenog tela i blago ublažavanje visokih
  const synth = c.createGain();
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 65; hp.Q.value = 0.7;
  const body1 = c.createBiquadFilter(); body1.type = 'peaking'; body1.frequency.value = 105; body1.Q.value = 1.4; body1.gain.value = 5;
  const body2 = c.createBiquadFilter(); body2.type = 'peaking'; body2.frequency.value = 220; body2.Q.value = 1.6; body2.gain.value = 3;
  const mid = c.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 700; mid.Q.value = 0.9; mid.gain.value = -2;
  const air = c.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 4500; air.gain.value = -5;
  synth.connect(hp).connect(body1).connect(body2).connect(mid).connect(air);
  const dry = c.createGain(); dry.gain.value = 0.9;
  air.connect(dry).connect(lim);
  const synthSend = c.createGain(); synthSend.gain.value = 0.16;
  air.connect(synthSend).connect(rev);
  const bus = { synth, sample };
  buses.set(c, bus);
  return bus;
}

const SAMPLE_GAIN = 2.6; // izjednačava glasnoću snimaka sa ranijim zvukom (v1.86: ~1 dB tiše — više rezerve na telefonu)

// ---- Grupe zvukova koje mogu da se prekinu (npr. pregled tonaliteta na kvintnom krugu) ----
const groups = new Map(); // ime → { gen, voices: Set<{ src, g }> }
const groupOf = (name) => { let G = groups.get(name); if (!G) { G = { gen: 0, voices: new Set() }; groups.set(name, G); } return G; };
function track(group, src, g) {
  if (!group) return;
  const G = groupOf(group), v = { src, g };
  G.voices.add(v);
  src.onended = () => G.voices.delete(v);
}
/** Odmah (uz kratko utišavanje) prekini sve zvuke iz grupe, i one zakazane za kasnije. */
export function stopGroup(group, fade = 0.06) {
  const G = groups.get(group);
  if (!G) return;
  G.gen++;
  const c = audioCtx(), now = c.currentTime;
  for (const v of G.voices) {
    try {
      v.g.gain.cancelScheduledValues(now);
      v.g.gain.setValueAtTime(v.g.gain.value, now);
      v.g.gain.linearRampToValueAtTime(0.0001, now + fade);
      v.src.stop(now + fade + 0.02); // zakazani a još nezapočeti zvuk se tako i ne čuje
    } catch {}
  }
  G.voices.clear();
}

/** Pusti snimljeni ton (tačna visina preko brzine reprodukcije). */
function playSample(c, buf, m, freq, t0, { gain, duration, mute, group }) {
  const src = c.createBufferSource();
  src.buffer = buf;
  const rate = freq / sampleFreq(m);
  src.playbackRate.value = rate;
  const g = c.createGain();
  const peak = gain * SAMPLE_GAIN;
  const end = t0 + Math.min(duration, buf.duration / rate);
  g.gain.setValueAtTime(peak, t0);
  let out = g;
  if (mute) {
    // prigušena žica (dlanom): kratak, tup „čik“
    g.gain.setTargetAtTime(0.0001, t0 + 0.012, 0.025);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300;
    g.connect(lp); out = lp;
  } else {
    g.gain.setValueAtTime(peak, Math.max(t0, end - 0.3));
    g.gain.linearRampToValueAtTime(0.0001, end);
  }
  src.connect(g);
  out.connect(guitarBus(c).sample);
  src.start(t0);
  src.stop(mute ? t0 + 0.3 : end + 0.02);
  track(group, src, g);
}

/** Rezerva: fizički model žice. */
function playSynth(c, freq, t0, { gain, duration, mute, brightness, group }) {
  const data = pluckedString(c.sampleRate, freq, mute
    ? { duration: Math.min(duration, 0.25), t60: 0.09, brightness: 0.25, pickPos: 0.2 }
    : { duration, brightness });
  const buf = c.createBuffer(1, data.length, c.sampleRate);
  buf.getChannelData(0).set(data);
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(g).connect(guitarBus(c).synth);
  src.start(t0);
  track(group, src, g);
}

/**
 * Trzaj jedne žice. Vraća trajanje u ms.
 * mute = prigušena žica (dlanom), brightness 0–1 (samo za rezervni, sintetizovani zvuk).
 * Ako snimak još nije učitan, ton se pusti čim stigne (prvi put to traje delić sekunde).
 */
export function pluck(freq, { when = 0, gain = 0.35, duration = 2.6, mute = false, brightness = 0.35, ctx = null, group = null } = {}) {
  const c = ctx || audioCtx();
  const t0 = Math.max(c.currentTime, when || c.currentTime) + 0.01;
  const o = { gain, duration, mute, brightness, group };
  const gen = group ? groupOf(group).gen : 0;
  const stopped = () => group && groupOf(group).gen !== gen; // grupa je prekinuta dok se snimak učitavao
  const m = nearestNote(freq);
  const buf = loadedNote(m);
  if (buf) playSample(c, buf, m, freq, t0, o);
  else {
    loadNote(c, m).then((b) => {
      if (stopped()) return;
      const at = Math.max(t0, c.currentTime + 0.005);
      if (when && at - t0 > 0.15) return; // zakasnio udarac u ritmu — preskoči, da ne „šepa“
      playSample(c, b, m, freq, at, o);
    }).catch(() => { if (!stopped()) playSynth(c, freq, Math.max(t0, c.currentTime + 0.005), o); });
  }
  return duration * 1000;
}

/** Kratak klik metronoma (naglašen za prvu dobu). */
export function click(when, accent = false) {
  const c = audioCtx();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'square';
  o.frequency.value = accent ? 1760 : 1175;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.2, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  o.connect(g).connect(c.destination);
  o.start(when);
  o.stop(when + 0.06);
}

// Akord E-mol (otvorene žice + 2. prag) — neutralan zvuk za vežbanje ritma.
const STRUM_NOTES = [82.41, 123.47, 164.81, 196.0, 246.94, 329.63];

/** Udarac preko žica: dir 'D' (dole) ili 'U' (gore); mute = prigušen „čik“. */
export function strum(when, dir = 'D', { accent = false, mute = false, ctx = null, notes: chord = null, group = null } = {}) {
  // Udarac nadole kreće od debelih žica, nagore od tankih (i obično zahvati samo 4 žice)
  const all = chord && chord.length ? chord : STRUM_NOTES;
  const notes = dir === 'U' ? [...all].reverse().slice(0, 4) : all;
  const spread = dir === 'U' ? 0.009 : 0.011;
  notes.forEach((f, i) => {
    pluck(f, { when: when + i * spread + Math.random() * 0.002, gain: (accent ? 0.25 : 0.19) * (mute ? 0.7 : 1) * (dir === 'U' ? 0.85 : 1), duration: 1.1, mute, brightness: dir === 'U' ? 0.6 : 0.45, ctx, group });
  });
}
