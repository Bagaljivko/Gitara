// v2.4.11: zajednička „pauza“ za Google Drive. Kad Google kaže „uspori“ (403 rateLimitExceeded / 429), svi pozadinski
// poslovi (sinhronizacija, rezervna kopija, sanduče nastavnika, napredak, plan) sačekaju — umesto da svaki za sebe
// pokušava i dodatno troši zajednički limit aplikacije. Pauza raste (1, 2, 4… do 15 min) i važi i posle ponovnog
// otvaranja aplikacije (localStorage). Uspešan poziv je smanjuje. Radnje koje korisnik sam pokrene ne čekaju.
const KEY = 'marli-drive-cool';
const BASE = 60000, MAX = 15 * 60000;
const rd = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || { until: 0, n: 0 }; } catch { return { until: 0, n: 0 }; } };
const wr = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };

/** Google je usporio: produži pauzu (eksponencijalno, sa malim slučajnim pomakom). */
export function noteRate(now = Date.now()) {
  const c = rd(); const n = Math.min((c.n || 0) + 1, 8);
  const ms = Math.min(MAX, BASE * 2 ** (n - 1)) * (0.85 + Math.random() * 0.3);
  wr({ until: Math.max(c.until || 0, now + ms), n });
  return ms;
}
/** Uspešan poziv: pauza se smanjuje (sledeći „uspori“ opet kreće od kraće). */
export function noteOk() { const c = rd(); if (c.n || c.until) wr({ until: 0, n: Math.max(0, (c.n || 0) - 1) }); }
/** Koliko ms još traje pauza (0 = može). */
export function coolLeft(now = Date.now()) { return Math.max(0, (rd().until || 0) - now); }
export const cooling = (now = Date.now()) => coolLeft(now) > 0;
/** Da li je odgovor Google-a „uspori“ (a ne pun Drive ili zabranjen pristup). */
export const isRate = (status, reason = '') => status === 429 || (status === 403 && /rate ?limit|userRateLimitExceeded|rateLimitExceeded|RESOURCE_EXHAUSTED/i.test(reason));

/** Poslednje pokretanje pozadinskog posla (preživi ponovno otvaranje): da brzo ponovno otvaranje ne pokreće sve iznova. */
export function ranRecently(name, ms, now = Date.now()) {
  const k = 'marli-last-' + name; let t = 0; try { t = Number(localStorage.getItem(k)) || 0; } catch {}
  return now - t < ms;
}
export function markRan(name, now = Date.now()) { try { localStorage.setItem('marli-last-' + name, String(now)); } catch {} }
