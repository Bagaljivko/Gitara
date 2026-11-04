// Snimljeni tonovi akustične gitare (assets/guitar/40.mp3 … 86.mp3 = E2 … D6).
// Izvor: FluidR3_GM (Frank Wen), MP3 iz projekta MIDI.js Soundfonts — CC BY 3.0 (vidi assets/guitar/LICENSE.txt).
// Svaki snimak je izmeren; ovde je njegovo odstupanje u centima, da bi pušteni ton bio tačan (važno za tuner).

export const MIN_MIDI = 40, MAX_MIDI = 86;
const TUNE = {
  40: 2.3, 41: 1.8, 42: 1.6, 43: 0.9, 44: 2.2, 45: 2.3, 46: 2.1, 47: 2.1, 48: 2.1, 49: 1.4, 50: 1.1, 51: 0.7, 52: 0.4,
  53: 0.3, 54: 0.7, 55: 0.5, 56: 0.6, 57: 0.4, 58: 0.4, 59: 1.4, 60: 1.2, 61: 1.2, 62: 1.1, 63: 1.2, 64: 0.8, 65: 0.8,
  66: 0.6, 67: 0.4, 68: 0.4, 69: 0.2, 70: 0, 71: 1.2, 72: 1.2, 73: 1, 74: 0.5, 75: 0.1, 76: 0, 77: 0.1, 78: 0, 79: 0.2,
  80: 0.3, 81: 0.4, 82: 0.8, 83: 0.4, 84: -0.7, 85: -0.8, 86: -1.2,
};

const pending = new Map(); // midi → Promise<AudioBuffer>
const ready = new Map();   // midi → AudioBuffer
const url = (m) => new URL(`../assets/guitar/${m}.mp3`, import.meta.url).href;

const decode = (ctx, data) => new Promise((res, rej) => {
  try { const p = ctx.decodeAudioData(data, res, rej); if (p && p.then) p.then(res, rej); } catch (e) { rej(e); }
});

// Snimci su mono (levi i desni kanal su potpuno isti), a dekodirani su kao stereo: čuva se samo jedan kanal.
// Zvuk je identičan (mono se pušta na oba zvučnika), a memorija je upola manja (~28 MB umesto ~57 MB za sve tonove)
// — na telefonima sa malo memorije Android tada ređe gasi aplikaciju u pozadini.
function toMono(ctx, buf) {
  if (buf.numberOfChannels !== 2) return buf;
  const l = buf.getChannelData(0), r = buf.getChannelData(1);
  for (let i = 0; i < l.length; i += 97) if (l[i] !== r[i]) return buf; // pravi stereo — ostavi kako jeste
  try {
    const mono = ctx.createBuffer(1, buf.length, buf.sampleRate);
    mono.copyToChannel ? mono.copyToChannel(l, 0) : mono.getChannelData(0).set(l);
    return mono;
  } catch { return buf; }
}

/** Najbliži snimljeni ton za frekvenciju (MIDI broj). */
export function nearestNote(freq) {
  const m = Math.round(69 + 12 * Math.log2(freq / 440));
  return Math.max(MIN_MIDI, Math.min(MAX_MIDI, m));
}

/** Stvarna frekvencija snimka (sa izmerenim odstupanjem). */
export const sampleFreq = (m) => 440 * Math.pow(2, (m - 69 + (TUNE[m] || 0) / 100) / 12);

export const loadedNote = (m) => ready.get(m) || null;

export function loadNote(ctx, m) {
  if (ready.has(m)) return Promise.resolve(ready.get(m));
  if (!pending.has(m)) {
    pending.set(m, fetch(url(m))
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then((b) => decode(ctx, b))
      .then((buf) => toMono(ctx, buf))
      .then((buf) => { ready.set(m, buf); return buf; })
      .catch((e) => { pending.delete(m); throw e; }));
  }
  return pending.get(m);
}

/** Učitaj sve tonove u pozadini (najpre one koji su najčešći: otvorene žice i prvi pragovi). */
export function preloadAll(ctx) {
  const order = [40, 45, 50, 55, 59, 64];
  for (let m = MIN_MIDI; m <= MAX_MIDI; m++) if (!order.includes(m)) order.push(m);
  let i = 0;
  const next = () => { if (i >= order.length) return; const m = order[i++]; loadNote(ctx, m).catch(() => {}).finally(next); };
  for (let k = 0; k < 4; k++) next(); // 4 paralelna preuzimanja
}
