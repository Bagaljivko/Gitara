// Deljenje pesama i set lista — jedan zapis za jednu pesmu i za celu set listu (bez servera).
// Paket: { g: 1, k: 'song' | 'set', n: ime set liste, s: [pesme u kratkom zapisu iz sharelink.js] } — samo sadržaj
// pesama (tekst, akordi, tablatura, kapo, tonalitet, tempo, ritam), nikad rezultati, folderi, Drive ili podešavanja.
// Sažima se ugrađenim „deflate“ (CompressionStream), inače lz-string; ide u deo adrese posle „#“ (ne šalje se nikome)
// ili, kad je predugačak za poruke, u .gitara fajl (isti sadržaj).
import LZString from './lzstring.js';
import { packSong, unpackSong } from './sharelink.js';

export const PREFIX = '#g=';
export const FILE_EXT = '.gitara';
export const FILE_MIME = 'application/vnd.gitara+json';
/** Do ove dužine link sigurno prolazi kroz WhatsApp, Viber, e-poštu i većinu SMS aplikacija (kao link). */
export const LINK_MAX = 7000;

const b64url = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64url = (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
async function pipe(bytes, Stream, mode) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(new Stream(mode)));
  return new Uint8Array(await out.arrayBuffer());
}
const canDeflate = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

/** Paket → kratak tekst (prvo slovo: d = deflate, l = lz-string). */
export async function encode(obj) {
  const json = JSON.stringify(obj);
  if (canDeflate()) {
    try { return 'd' + b64url(await pipe(new TextEncoder().encode(json), CompressionStream, 'deflate-raw')); } catch {}
  }
  return 'l' + LZString.compressToEncodedURIComponent(json);
}
export async function decode(code) {
  const s = String(code || '').trim();
  let json = null;
  if (s[0] === 'd') {
    if (!canDeflate()) throw new Error('nodeflate');
    json = new TextDecoder().decode(await pipe(fromB64url(s.slice(1)), DecompressionStream, 'deflate-raw'));
  } else if (s[0] === 'l') json = LZString.decompressFromEncodedURIComponent(s.slice(1));
  if (!json) throw new Error('bad');
  return JSON.parse(json);
}

/** Pesme (pune) → paket. Za set listu: name + pesme redom. */
export function makePackage(songs, setName = null) {
  return { g: 1, k: setName != null ? 'set' : 'song', ...(setName != null ? { n: String(setName).slice(0, 80) } : {}), s: songs.map(packSong) };
}
/** Paket → { kind, name, songs } (pesme prolaze istu proveru kao uvoz; neispravne se preskaču). */
export function readPackage(o) {
  if (!o || o.g !== 1 || !Array.isArray(o.s)) throw new Error('bad');
  const songs = [];
  for (const x of o.s.slice(0, 300)) { try { songs.push(unpackSong(x)); } catch {} }
  if (!songs.length) throw new Error('empty');
  return { kind: o.k === 'set' ? 'set' : 'song', name: typeof o.n === 'string' ? o.n.slice(0, 80) : '', songs };
}

/** Sadržaj .gitara fajla (čitljiv JSON sa sažetim paketom — isti kao u linku). */
export async function shareFileText(pkg) {
  return JSON.stringify({ app: 'gitara', share: 1, code: await encode(pkg) });
}
/** Iz linka (#g=…) ili teksta fajla → paket. */
export async function packageFrom(text) {
  const s = String(text || '').trim();
  const i = s.indexOf(PREFIX);
  if (i >= 0) return readPackage(await decode(decodeURIComponent(s.slice(i + PREFIX.length).split(/[\s&]/)[0])));
  return parseShareFile(s); // .gitara fajl (stari i novi oblik, ista provera)
}

// ---------------- Deljeni fajl (kratki link #d/<fileId> i .gitara fajl) ----------------
// { app: 'gitara', share: 2, v: verzija šeme, kind: 'song'|'set', name, n: broj pesama, hash: SHA-256(code), code }
// Primalac ga tretira kao nepoznat ulaz: veličina, tačan oblik, verzija, hash, pa ista provera pesama kao uvoz.
export const SHARE_SCHEMA = 1;
export const SHARE_MAX_BYTES = 2 * 1024 * 1024;
const SHARE_KEYS = ['app', 'share', 'v', 'kind', 'name', 'n', 'hash', 'code'];
export class ShareFileError extends Error { constructor(code) { super(code); this.code = code; } } // CORRUPT | NEWER | TOO_BIG

async function sha256hex(str) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}
/** Pesme (i ime set liste) → tekst deljenog fajla + hash sadržaja. */
export async function buildShareFile({ kind, name = '', songs }) {
  const code = await encode(makePackage(songs, kind === 'set' ? name : null));
  const hash = await sha256hex(code);
  const text = JSON.stringify({ app: 'gitara', share: 2, v: SHARE_SCHEMA, kind: kind === 'set' ? 'set' : 'song', name: String(name || '').slice(0, 120), n: songs.length, hash, code });
  return { text, hash };
}
/** Tekst deljenog fajla → paket ({ kind, name, songs }) ili ShareFileError. */
export async function parseShareFile(text) {
  if (typeof text !== 'string' || text.length > SHARE_MAX_BYTES) throw new ShareFileError(typeof text === 'string' ? 'TOO_BIG' : 'CORRUPT');
  let o;
  try { o = JSON.parse(text); } catch { throw new ShareFileError('CORRUPT'); }
  if (!o || typeof o !== 'object' || Array.isArray(o) || o.app !== 'gitara') throw new ShareFileError('CORRUPT');
  if (o.share === 1 && typeof o.code === 'string' && Object.keys(o).every((k) => ['app', 'share', 'code'].includes(k))) return readPackage(await decode(o.code)); // stari .gitara fajl (v1.46)
  if (o.share !== 2 || !Number.isInteger(o.v) || o.v < 1) throw new ShareFileError('CORRUPT');
  if (o.v > SHARE_SCHEMA) throw new ShareFileError('NEWER');
  if (Object.keys(o).some((k) => !SHARE_KEYS.includes(k))) throw new ShareFileError('CORRUPT');
  if (!['song', 'set'].includes(o.kind) || typeof o.name !== 'string' || o.name.length > 120 || !Number.isInteger(o.n) || o.n < 1 || o.n > 300) throw new ShareFileError('CORRUPT');
  if (typeof o.hash !== 'string' || !/^[0-9a-f]{64}$/.test(o.hash) || typeof o.code !== 'string' || !/^[dl][A-Za-z0-9_\-+$]+$/.test(o.code)) throw new ShareFileError('CORRUPT');
  if ((await sha256hex(o.code)) !== o.hash) throw new ShareFileError('CORRUPT');
  let pkg;
  try { pkg = readPackage(await decode(o.code)); } catch { throw new ShareFileError('CORRUPT'); }
  if (pkg.kind !== o.kind || pkg.songs.length !== o.n) throw new ShareFileError('CORRUPT');
  return pkg;
}
