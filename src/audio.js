// Mikrofon (getUserMedia + Web Audio) i detekcija visine tona (YIN).

let shared = null; // { ctx, stream, source, users }

export class MicError extends Error {}

export async function openMic() {
  if (shared) { shared.users++; if (shared.ctx.state === 'suspended') await shared.ctx.resume(); return shared; }
  if (!window.isSecureContext) throw new MicError('Mikrofon radi samo preko sigurne (https) veze.');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new MicError('Ovaj pregledač ne podržava mikrofon. Probaj Safari (iPhone) ili Chrome (Android).');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
  } catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError' || e.name === 'PermissionDeniedError')) {
      throw new MicError('Pristup mikrofonu je odbijen. Dozvoli mikrofon za ovu aplikaciju (iPhone: Podešavanja → Safari → Mikrofon; Android: Chrome → Podešavanja sajta → Mikrofon) i pokušaj ponovo.');
    }
    if (e && (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError')) throw new MicError('Mikrofon nije pronađen na ovom uređaju.');
    if (e && e.name === 'NotReadableError') throw new MicError('Mikrofon trenutno koristi druga aplikacija. Zatvori je i pokušaj ponovo.');
    throw new MicError('Mikrofon nije moguće pokrenuti. Pokušaj ponovo.');
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  if (ctx.state === 'suspended') await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  shared = { ctx, stream, source, users: 1 };
  return shared;
}

export function closeMic() {
  if (!shared) return;
  shared.users--;
  if (shared.users > 0) return;
  shared.stream.getTracks().forEach((t) => t.stop());
  shared.ctx.close().catch(() => {});
  shared = null;
}

export function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

/**
 * YIN detekcija osnovne frekvencije.
 * @returns {{freq:number, prob:number}|null}
 */
export function yin(buf, sampleRate, { minFreq = 65, maxFreq = 1100, threshold = 0.12 } = {}) {
  const tauMin = Math.floor(sampleRate / maxFreq);
  const tauMax = Math.min(Math.ceil(sampleRate / minFreq), Math.floor(buf.length / 2));
  const W = buf.length - tauMax;
  if (W < tauMax) return null;
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < W; i++) {
      const diff = buf[i] - buf[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  // Kumulativna normalizovana razlika
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running ? (d[tau] * tau) / running : 1;
  }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) {
    // Nema ispod praga: uzmi globalni minimum ako je dovoljno dobar.
    let best = tauMin;
    for (let t = tauMin; t <= tauMax; t++) if (cmnd[t] < cmnd[best]) best = t;
    if (cmnd[best] > 0.3) return null;
    tau = best;
  }
  // Parabolična interpolacija
  let betterTau = tau;
  if (tau > 1 && tau < tauMax) {
    const s0 = cmnd[tau - 1], s1 = cmnd[tau], s2 = cmnd[tau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom) betterTau = tau + (s2 - s0) / denom;
  }
  return { freq: sampleRate / betterTau, prob: 1 - cmnd[tau] };
}
