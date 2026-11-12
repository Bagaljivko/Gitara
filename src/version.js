export const APP_VERSION = '2.3.3';
// v2.3.3: provera „Šta je novo“ bez učitavanja cele liste novosti (52 KB) pri pokretanju
export const wnUnseen = () => { try { return localStorage.getItem('marli-seen-ver') !== APP_VERSION.split('.').slice(0, 2).join('.'); } catch { return false; } };
