// Instalacija aplikacije (PWA): Android/Chrome nudi „Instaliraj“, iPhone se uputi na „Dodaj na početni ekran“.
let deferred = null;
const listeners = new Set();
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; listeners.forEach((f) => f()); });
window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((f) => f()); });

export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
/** v1.68: računar (miš/touchpad, nije iPhone/iPad) — za uputstva i ponašanje na računaru. */
export const isComputer = () => typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches && !/android|iphone|ipad|ipod/i.test(navigator.userAgent) && !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const canPromptInstall = () => !!deferred;
export const onInstallChange = (f) => { listeners.add(f); return () => listeners.delete(f); };

export async function promptInstall() {
  if (!deferred) return false;
  const d = deferred;
  deferred = null;
  d.prompt();
  const r = await d.userChoice.catch(() => null);
  listeners.forEach((f) => f());
  return !!r && r.outcome === 'accepted';
}
