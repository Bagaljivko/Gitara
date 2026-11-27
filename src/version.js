export const APP_VERSION = '2.5.67';
// v2.3.3: provera „Šta je novo“ bez učitavanja cele liste novosti (52 KB) pri pokretanju
export const wnUnseen = () => { try { return localStorage.getItem('marli-seen-ver') !== APP_VERSION.split('.').slice(0, 2).join('.'); } catch { return false; } };
// v2.5.65: tačka „novo“ na Podešavanjima bez učitavanja cele liste novosti (112 KB)
export function navDot() {
  if (!wnUnseen()) return;
  const a = document.querySelector('.nav a[data-tab="podesavanja"]');
  if (a && !a.querySelector('.wn-dot')) a.insertAdjacentHTML('beforeend', '<i class="wn-dot" aria-hidden="true"></i>');
}
