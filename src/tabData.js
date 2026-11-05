// TAB pesme — samo zapis i provera (cleanTabSong): koristi ga songformat.js (uvoz, link, rezervna kopija), pa je
// namerno mali. Sve ostalo (taktovi, delovi, vežba) je u tabSong.js i učitava se tek uz TAB pesmu.
export const TAB_V = 1;
const Q = 24;
const SIGS = new Set(['2/4', '3/4', '4/4', '5/4', '6/4', '2/2', '3/8', '6/8', '9/8', '12/8', '7/8']);
export const snap = (x) => Math.round(Number(x) * Q) / Q;
const r4 = (x) => Math.round(x * 10000) / 10000;
export const EPS = 1 / 48;
export function barLen(sig) { const [a, b] = String(sig).split('/').map(Number); return a && b ? (a * 4) / b : 4; }
const cleanSig = (s) => { const x = String(s || '').replace(/\s/g, '').replace('C|', '2/2').replace(/^C$/, '4/4'); return SIGS.has(x) ? x : ''; };
const cleanKey = (k) => (typeof k === 'string' && /^[A-H][#b♯♭]?(is|es|s)?\s*(m|mol|-mol|min|minor|dur|-dur|major)?$/i.test(k.trim()) ? k.trim().replace('♯', '#').replace('♭', 'b').slice(0, 10) : '');

const ROMAN = { I: 1, V: 5, X: 10 };
function roman(s) { let n = 0; for (let i = 0; i < s.length; i++) { const v = ROMAN[s[i]], w = ROMAN[s[i + 1]] || 0; n += v < w ? -v : v; } return n; }
/** Barre iz oznake („BV“, „1/2 BV“, „CVII“, „B2“) ili iz polja; vraća { fret, from, to, half } ili null. */
export function parseBarre(x) {
  if (!x || typeof x !== 'object') return null;
  const label = String(x.label || '').toUpperCase().replace(/\s+/g, ' ');
  const m = label.match(/(1\/2|½|C ?1\/2|H)?\s*[BC]\s*([IVX]+|\d{1,2})\b/);
  let fret = Math.round(Number(x.fret) || 0), half = !!x.half;
  if (m) { fret = fret || (/\d/.test(m[2]) ? Number(m[2]) : roman(m[2])); half = half || !!m[1]; }
  if (!(fret >= 1 && fret <= 19)) return null;
  let from = Math.round(Number(x.from) || 0), to = Math.round(Number(x.to) || 0);
  if (!(from >= 1 && from <= 6 && to >= from && to <= 6)) { from = 1; to = half ? 3 : 6; }
  const o = { fret, from, to };
  if (half) o.half = 1;
  const b = Number(x.b ?? x.start), d = Number(x.d ?? x.len);
  if (b > 0) o.b = r4(snap(b));
  if (d > 0) o.d = r4(snap(d));
  return o;
}

/** Provera i čišćenje TAB zapisa (uvoz, link, rezervna kopija, skeniranje). Vraća tab ili null. */
export function cleanTabSong(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.bars)) return null;
  const sig = cleanSig(raw.sig) || '4/4';
  const bars = raw.bars.slice(0, 400).map((b0) => {
    const b = b0 && typeof b0 === 'object' ? b0 : {};
    const notes = (Array.isArray(b.notes) ? b.notes : []).slice(0, 96).map((n) => {
      const s = Math.round(Number(n && n.s)), f = Math.round(Number(n && n.f));
      const st = snap(n && n.b), d = snap(n && n.d);
      if (!(s >= 1 && s <= 6) || !(f >= 0 && f <= 24) || !(st >= 0 && st < 16) || !(d > 0 && d <= 16)) return null;
      const o = { s, f, b: r4(st), d: r4(d) };
      const fi = Math.round(Number(n.fi));
      if (fi >= 1 && fi <= 4 && f > 0) o.fi = fi; // prazna žica nema prst
      return o;
    }).filter(Boolean).sort((x, y) => x.b - y.b || x.s - y.s);
    const o = { notes };
    const bs = cleanSig(b.sig), bk = cleanKey(b.key);
    if (bs) o.sig = bs;
    if (bk) o.key = bk;
    if (b.rs) o.rs = 1;
    const re = Math.round(Number(b.re) || 0);
    if (re >= 2 && re <= 8) o.re = re;
    if (b.end === 1 || b.end === 2) o.end = b.end;
    const barre = (Array.isArray(b.barre) ? b.barre : []).slice(0, 4).map(parseBarre).filter(Boolean);
    if (barre.length) o.barre = barre;
    if (typeof b.why === 'string' && /^[a-z]{2,10}$/.test(b.why)) o.why = b.why;
    if (typeof b.note === 'string' && b.note.trim()) o.note = b.note.trim().slice(0, 140);
    if (b.ok) o.ok = 1;
    return o;
  });
  if (!bars.some((b) => b.notes.length)) return null;
  return { v: TAB_V, sig, key: cleanKey(raw.key), bars };
}

