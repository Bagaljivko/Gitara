// Ručna provera nove verzije (Podešavanja → „Proveri ažuriranja“).
// Vraća: 'updating' (nova verzija se primenjuje, stranica se ponovo učitava), 'latest', 'offline' ili 'unsupported'.
export async function checkForUpdate() {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  if (navigator.onLine === false) return 'offline';
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return 'unsupported';
  if (!reg.waiting) {
    try { await reg.update(); } catch { return 'offline'; }
    const w = reg.installing;
    if (w) {
      // sačekaj da se nova verzija preuzme (najviše 60 s)
      await new Promise((res) => {
        const done = () => { if (w.state !== 'installing') { w.removeEventListener('statechange', done); res(); } };
        w.addEventListener('statechange', done);
        setTimeout(res, 60000);
      });
    }
  }
  const w = reg.waiting;
  if (!w) return navigator.serviceWorker.controller && reg.active ? 'latest' : 'unsupported';
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  w.postMessage('SKIP_WAITING');
  return 'updating';
}

/** Adresa aplikacije za deljenje (bez #putanje), npr. https://bagaljivko.github.io/Gitara/ */
export const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');
