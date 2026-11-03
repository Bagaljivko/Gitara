// Ekran ostaje upaljen samo dok nešto radiš (Screen Wake Lock).
// 1) „Vlasnici“: dok tuner/prepoznavanje akorda slušaju, svira metronom ili ritam, pesma skroluje, nastup…
// 2) Aktivnost: dok je otvorena pesma, setlista ili rečnik akorda, ekran ostaje upaljen još X minuta
//    posle poslednjeg dodira ili skrolovanja (podešava se u Podešavanjima; podrazumevano 10 min).
// Podešavanje „Ekran ostaje upaljen“: 'songs' (podrazumevano) | 'active' (samo dok nešto radi) | 'never'.
import { settings, events } from './db.js';

const owners = new Set();
let lock = null;
let pending = null;
let mode = 'songs';
let minutes = 10;
let zone = null;        // npr. 'song', 'setlist', 'dict' — gde se računa aktivnost
let paused = false;     // korisnik je za ovu pesmu isključio (ikonica u traci)
let actTimer = 0;
const listeners = new Set();

export const WAKE_MODES = ['songs', 'active', 'never'];
export const WAKE_MINUTES = [5, 10, 20];

function emit() { const s = wakeState(); listeners.forEach((fn) => { try { fn(s); } catch {} }); }
/** Stanje za prikaz: da li je ekran trenutno „zadržan“ i da li zbog aktivnosti. */
export function wakeState() {
  return { mode, minutes, zone, paused, locked: !!lock, byActivity: owners.has('activity'), owners: [...owners] };
}
export function onWakeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

async function acquire() {
  if (mode === 'never' || lock || pending || !owners.size || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    pending = navigator.wakeLock.request('screen');
    lock = await pending;
    lock.addEventListener('release', () => { lock = null; emit(); });
  } catch {
    lock = null; // npr. baterija je slaba ili pregledač ne dozvoljava — tiho ignorišemo
  } finally {
    pending = null;
  }
  if ((!owners.size || mode === 'never') && lock) release();
  emit();
}

function release() {
  const l = lock;
  lock = null;
  if (l) l.release().catch(() => {});
  emit();
}

export function keepAwake(owner) { owners.add(owner); acquire(); emit(); }
export function allowSleep(owner) { owners.delete(owner); if (!owners.size) release(); emit(); }

// ---- Aktivnost (pesma, setlista, rečnik akorda) ----
function bump() {
  if (!zone || paused || mode !== 'songs') return;
  clearTimeout(actTimer);
  if (!owners.has('activity')) keepAwake('activity');
  actTimer = setTimeout(() => allowSleep('activity'), minutes * 60000);
}
/** Uđi u deo aplikacije gde se aktivnost računa (ili null kad ga napustiš). */
export function setWakeZone(z) {
  if (z === zone) return;
  zone = z;
  paused = false;
  clearTimeout(actTimer);
  if (z) bump(); else allowSleep('activity');
  emit();
}
/** Ikonica u traci: privremeno isključi / ponovo uključi za ovu pesmu. */
export function toggleWakePause() {
  paused = !paused;
  if (paused) { clearTimeout(actTimer); allowSleep('activity'); } else bump();
  emit();
  return paused;
}

if (typeof document !== 'undefined') {
  const onAct = () => bump();
  document.addEventListener('pointerdown', onAct, { passive: true });
  document.addEventListener('keydown', onAct, { passive: true });
  window.addEventListener('scroll', onAct, { passive: true });
  // Sistem automatski oslobađa zaključavanje kada aplikacija ode u pozadinu — vraćamo ga po povratku.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { bump(); acquire(); } });
  // Rotacija ekrana: neki uređaji tada otpuste zaključavanje — zatraži ga ponovo.
  const again = () => setTimeout(acquire, 300);
  window.addEventListener('orientationchange', again);
  if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', again);

  const load = async () => {
    const m = await settings.get('wakeMode', 'songs').catch(() => 'songs');
    mode = WAKE_MODES.includes(m) ? m : 'songs';
    const n = Number(await settings.get('wakeMinutes', 10).catch(() => 10));
    minutes = WAKE_MINUTES.includes(n) ? n : 10;
    if (mode === 'never') release();
    else if (mode !== 'songs') allowSleep('activity');
    else if (zone) bump();
    acquire();
    emit();
  };
  load();
  events.addEventListener('settings-changed', (e) => { if (e.detail === 'wakeMode' || e.detail === 'wakeMinutes') load(); });
}
