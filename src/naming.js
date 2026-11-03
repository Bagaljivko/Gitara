// Imena nota u prikazu: „Prati jezik“ (podrazumevano), „Srpski (H, Fis, Es)“ ili „English (B, F#, Eb)“.
// Akordi su interno zapisani nedvosmisleno na engleski način (B = H, Bb = B); ovde se samo prevode za prikaz.
import { getLang } from './i18n.js';

export const NOTE_NAMES = ['auto', 'sr', 'en'];
let pref = 'auto';
const listeners = new Set();
try { const v = localStorage.getItem('gitara-notenames'); if (NOTE_NAMES.includes(v)) pref = v; } catch {}

export const noteNamesPref = () => pref;
/** Trenutno imenovanje: 'sr' ili 'en'. */
export const currentNaming = () => (pref === 'auto' ? (getLang() === 'sr' ? 'sr' : 'en') : pref);
export function onNamingChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function setNoteNamesPref(v) {
  if (!NOTE_NAMES.includes(v) || v === pref) return;
  const before = currentNaming();
  pref = v;
  try { localStorage.setItem('gitara-notenames', v); } catch {}
  import('./db.js').then(({ settings }) => settings.set('noteNames', v)).catch(() => {});
  if (currentNaming() !== before) listeners.forEach((fn) => { try { fn(); } catch {} });
}
/** Vraćanje iz rezervne kopije / IndexedDB-a. */
export function loadNoteNamesPref(v) { if (NOTE_NAMES.includes(v) && v !== pref) setNoteNamesPref(v); }

const SR = { 'C#': 'Cis', Db: 'Des', 'D#': 'Dis', Eb: 'Es', 'E#': 'Eis', Fb: 'Fes', 'F#': 'Fis', Gb: 'Ges', 'G#': 'Gis', Ab: 'As', 'A#': 'Ais', Bb: 'B', B: 'H', 'B#': 'His', Cb: 'Ces' };
const note = (n, naming) => (naming === 'sr' ? SR[n] || n : n);

/**
 * Ime akorda ili tona (zapisano na engleski način: „F#m7“, „Bb“, „D/F#“, „E“) u izabranom imenovanju.
 * Sve što nije akord vraća se nepromenjeno.
 */
export function dn(name, naming = currentNaming()) {
  if (naming !== 'sr' || !name) return name;
  return String(name).replace(/^([A-G](?:#|b)?)(.*?)(?:\/([A-G](?:#|b)?))?$/, (m, root, rest, bass) => note(root, 'sr') + rest + (bass ? '/' + note(bass, 'sr') : ''));
}
