// Screen Wake Lock: drži ekran upaljenim dok tuner/akordi slušaju ili dok pesma sama skroluje.
// Više „vlasnika“ može istovremeno da traži zaključavanje; oslobađa se kada ga niko više ne traži.
const owners = new Set();
let lock = null;
let pending = null;

async function acquire() {
  if (lock || pending || !owners.size || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    pending = navigator.wakeLock.request('screen');
    lock = await pending;
    lock.addEventListener('release', () => { lock = null; });
  } catch {
    lock = null; // npr. baterija je slaba ili pregledač ne dozvoljava — tiho ignorišemo
  } finally {
    pending = null;
  }
  if (!owners.size && lock) release();
}

function release() {
  const l = lock;
  lock = null;
  if (l) l.release().catch(() => {});
}

export function keepAwake(owner) { owners.add(owner); acquire(); }
export function allowSleep(owner) { owners.delete(owner); if (!owners.size) release(); }

// Sistem automatski oslobađa zaključavanje kada aplikacija ode u pozadinu — vraćamo ga po povratku.
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') acquire(); });
// Rotacija ekrana: neki uređaji tada otpuste zaključavanje — zatraži ga ponovo.
if (typeof window !== 'undefined') {
  const again = () => setTimeout(acquire, 300);
  window.addEventListener('orientationchange', again);
  if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', again);
}
