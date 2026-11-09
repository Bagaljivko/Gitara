// Dijagnostika (Podešavanja): kratak izveštaj o greškama i brzini pokretanja.
// Sve ostaje na uređaju; korisnik ga sam kopira i pošalje ako želi. Nema teksta pesama ni ključeva
// (v1.70.1: od Gemini ključa samo oblik i poslednja 4 znaka — dovoljno za proveru, ne može da se zloupotrebi).
import { APP_VERSION } from './version.js';
import { songs, settings } from './db.js';
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

export async function buildReport({ share = false } = {}) {
  const w = W[getLang()] || W.sr;
  const L = [];
  L.push(`MARLI ${APP_VERSION} · ${getLang()} · ${iso(Date.now())}`);
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
  try { L.push('', ...(await geminiLines(share))); } catch {}
  const boots = bootLog();
  if (boots.length) {
    L.push('', w.boots);
    for (const b of boots) L.push(`  ${iso(b.t)}  ${b.ms} ms  ${b.sw ? 'sw' : w.net}  ${b.nav || ''}${b.html ? `  html ${b.html} ms` : ''}${b.swStart ? `  (sw ${b.swStart} ms)` : ''}${b.src ? '  ' + b.src : ''}${b.disc ? '  ' + w.disc : ''}`);
  }
  const log = diagLog();
  L.push('', log.length ? `${w.logged} (${log.length}):` : w.none);
  for (const e of log) L.push(`  ${iso(e.t)}  ${e.k}${e.ms ? ' ' + e.ms + ' ms' : ''}${e.h ? ' ' + e.h : ''}${e.s ? ' @' + e.s : ''}${e.m ? '\n    ' + String(e.m).replace(/\n/g, '\n    ') : ''}`);
  // „Uz video“ (YouTube): poslednji događaji plejera — šta je YouTube javio (kod greške, stanje, reklama)
  let pa = [];
  try { pa = JSON.parse(localStorage.getItem('gitara-pa-log') || '[]'); } catch {}
  if (pa.length) {
    L.push('', `Uz video (${pa.length}):`);
    for (const x of pa.slice(-40)) { const { t: tt, e, ...rest } = x; L.push(`  ${iso(tt)}  ${e}${Object.keys(rest).length ? '  ' + Object.entries(rest).map(([k, v]) => `${k}=${v}`).join(' ') : ''}`); }
  }
  return L.join('\n');
}

// v1.70.1: Gemini i sinhronizacija — sve što treba za proveru „zašto skeniranje ne radi“, bez samog ključa
async function geminiLines(share = false) {
  const L = ['Gemini:'];
  const key = String((await settings.get('geminiKey', '')) || '');
  // stari oblik AIza… (39 znakova) i noviji Google oblik (npr. „AQ.…“, duži, sa tačkom) su oba u redu
  const shape = !key ? 'nema' : /^AIza[\w-]{35}$/.test(key) ? 'ispravan oblik (AIza…, 39 znakova)' : /^[\w.\-]{20,300}$/.test(key) ? `ispravan oblik (noviji Google format, ${key.length} znakova, „${key.slice(0, 3)}…“)` : `NEOBIČAN oblik (${key.length} znakova, počinje sa „${key.slice(0, 4)}“)`;
  L.push(`  ključ: ${shape}${key && !share ? ' · završava se na …' + key.slice(-4) : ''}${/\s/.test(key) ? ' · IMA RAZMAK/NOVI RED' : ''}`);
  L.push(`  prenos ključa na uređaje: ${(await settings.get('keySync', true)) !== false ? 'uključen' : 'isključen'}`);
  L.push(`  model: ${(await settings.get('geminiModelSel', '')) || 'auto'} · poslednji koji je radio: ${(await settings.get('geminiLastModel', '')) || '—'}`);
  try { const { quotaResetAt } = await import('./gemini.js'); const r = quotaResetAt(); if (r) L.push(`  nov dnevni besplatni limit: ${iso(r)} (UTC)`); } catch {}
  try { const c = JSON.parse(localStorage.getItem('marli-keycheck') || 'null'); if (c) { L.push(`  poslednja provera ključa: ${iso(c.t)} → ${c.kind}${c.model ? ' (' + c.model + ')' : ''}`); for (const a of c.att || []) L.push('    ' + a); } } catch {}
  try { const sc = JSON.parse(localStorage.getItem('gitara-lastscan') || 'null'); if (sc && sc.text) L.push(`  poslednje neuspelo skeniranje ${iso(sc.at)}${share ? ' (tekst nije poslat)' : ':'}`, ...(share ? [] : String(sc.text).split('\n').slice(0, 40).map((x) => '    ' + x))); } catch {}
  try { const q = JSON.parse(localStorage.getItem('marli-pdf-queue') || '[]'); if (q.length) L.push(`  PDF red: ${q.map((x) => x.st).join(', ')}`); } catch {}
  try {
    const y = (await import('./sync.js')).syncState();
    L.push('', `Sinhronizacija: ${y.on ? 'uključena' : 'isključena'} · ${y.status}${y.pending ? ' · čeka ' + y.pending : ''}${y.last ? ' · poslednja ' + iso(y.last) : ''}`);
  } catch {}
  return L;
}
