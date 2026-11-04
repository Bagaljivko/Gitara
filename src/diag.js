// Dijagnostika (Podešavanja): kratak izveštaj o greškama i brzini pokretanja.
// Sve ostaje na uređaju; korisnik ga sam kopira i pošalje ako želi. Nema teksta pesama ni ključeva.
import { APP_VERSION } from './version.js';
import { songs } from './db.js';
import { getLang } from './i18n.js';

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
export const diagLog = () => read('gitara-diag');
export const bootLog = () => read('gitara-boots');
export function clearDiag() { try { localStorage.removeItem('gitara-diag'); localStorage.removeItem('gitara-boots'); } catch {} }

const iso = (t) => { try { return new Date(t).toISOString().replace('T', ' ').slice(0, 19); } catch { return String(t); } };

// Tekst izveštaja prati izabrani jezik aplikacije
const W = {
  sr: { cache: 'Keš', yes: 'da', no: 'ne', inst: 'Instalirana', screen: 'ekran', cores: 'jezgra', ua: 'Pregledač', space: 'Prostor', of: 'od', persist: 'trajno', songs: 'Pesama', boots: 'Pokretanja (ms do prvog ekrana):', net: 'mreža', disc: '(telefon ju je ugasio u pozadini)', logged: 'Zabeleženo', none: 'Nema zabeleženih grešaka.' },
  en: { cache: 'Cache', yes: 'yes', no: 'no', inst: 'Installed', screen: 'screen', cores: 'cores', ua: 'Browser', space: 'Storage', of: 'of', persist: 'persistent', songs: 'Songs', boots: 'Startups (ms to first screen):', net: 'network', disc: '(the phone closed it in the background)', logged: 'Logged', none: 'No errors logged.' },
};

export async function buildReport() {
  const w = W[getLang()] || W.sr;
  const L = [];
  L.push(`Gitara ${APP_VERSION} · ${getLang()} · ${iso(Date.now())}`);
  try { L.push(`${w.cache}: ${(await caches.keys()).filter((k) => k.startsWith('gitara-')).join(', ') || '—'} · SW: ${navigator.serviceWorker?.controller ? w.yes : w.no}`); } catch {}
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  L.push(`${w.inst}: ${standalone ? w.yes : w.no} · ${w.screen} ${screen.width}×${screen.height} @${devicePixelRatio} · RAM ${navigator.deviceMemory ?? '?'} GB · ${w.cores} ${navigator.hardwareConcurrency ?? '?'}`);
  L.push(`${w.ua}: ${navigator.userAgent}`);
  try {
    const e = await navigator.storage?.estimate?.();
    const p = await navigator.storage?.persisted?.();
    if (e) L.push(`${w.space}: ${(e.usage / 1048576).toFixed(1)} MB ${w.of} ${(e.quota / 1048576).toFixed(0)} MB · ${w.persist}: ${p ? w.yes : w.no}`);
  } catch {}
  try { L.push(`${w.songs}: ${await songs.count()}`); } catch {}
  const boots = bootLog();
  if (boots.length) {
    L.push('', w.boots);
    for (const b of boots) L.push(`  ${iso(b.t)}  ${b.ms} ms  ${b.sw ? 'sw' : w.net}  ${b.nav || ''}${b.disc ? '  ' + w.disc : ''}`);
  }
  const log = diagLog();
  L.push('', log.length ? `${w.logged} (${log.length}):` : w.none);
  for (const e of log) L.push(`  ${iso(e.t)}  ${e.k}${e.ms ? ' ' + e.ms + ' ms' : ''}${e.h ? ' ' + e.h : ''}${e.s ? ' @' + e.s : ''}${e.m ? '\n    ' + String(e.m).replace(/\n/g, '\n    ') : ''}`);
  return L.join('\n');
}
