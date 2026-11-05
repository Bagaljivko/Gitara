// Deljenje pesme kao linka: pesma se kompresuje (lz-string) u heš adrese, npr. …/Gitara/#pesma=...
import LZString from './lzstring.js';
import { normalizeSong, songExtras, SongFormatError, cleanRecording } from './songformat.js';
import { t } from './i18n.js';

const PREFIX = '#pesma=';

// TAB pesma u linku: note kao [žica, prag, početak·24, trajanje·24, prst?], uz takt i ostale oznake takta
const packTab = (tab) => ({ g: tab.sig, k: tab.key || undefined, b: tab.bars.map((b) => {
  const x = { n: b.notes.map((n) => [n.s, n.f, Math.round(n.b * 24), Math.round(n.d * 24), ...(n.fi ? [n.fi] : [])]) };
  for (const k of ['sig', 'key', 'rs', 're', 'end', 'barre', 'ok']) if (b[k] != null) x[k] = b[k];
  return x;
}) });
const unpackTab = (o) => ({ sig: o && o.g, key: o && o.k, bars: (o && Array.isArray(o.b) ? o.b : []).map((x) => ({ ...x, notes: (x.n || []).map(([s, f, b, d, fi]) => ({ s, f, b: b / 24, d: d / 24, fi })) })) });

/** Kratki ključevi da link bude što kraći. */
function pack(song) {
  if (song.type === 'tab') {
    const ex = songExtras(song);
    return { v: 1, ty: 't', t: song.title, a: song.artist || undefined, k: song.key || undefined, y: ex.yt, b: ex.bpm, tb: packTab(song.tab) };
  }
  const ex = songExtras(song);
  const o = { v: 1, t: song.title, a: song.artist || undefined, k: song.key || undefined, s: song.sections.map((sec) => {
    const x = { l: sec.lines.map((l) => (l.chords && l.chords.length ? [l.text || '', l.chords.map((c) => [c.chord, c.position])] : [l.text || ''])) };
    if (sec.name) x.n = sec.name;
    if (sec.strum) x.p = sec.strum;
    if (sec.tabs && sec.tabs.length) x.tb = sec.tabs.map((tb) => ({ g: tb.sig, b: tb.bars.map((b) => [b.w, b.notes.map((n) => (n.t ? [n.s, n.f, n.p, n.t] : [n.s, n.f, n.p]))]) }));
    return x;
  }) };
  if (ex.capo) o.c = ex.capo;
  if (ex.strum) o.p = ex.strum;
  if (ex.yt) o.y = ex.yt;
  if (ex.tuning) o.u = ex.tuning;
  if (ex.bpm) o.b = ex.bpm;
  if (song.transpose) o.tr = song.transpose;
  const rc = song.recording && cleanRecording(song.recording); // „Moji snimci“: samo note (nikad zvuk)
  if (rc) o.rc = rc;
  if (song.cv >= 2) { o.cv = song.cv; if (song.keyN) o.kn = [song.keyN.root, song.keyN.minor ? 1 : 0]; } // akordi su u nedvosmislenom engleskom zapisu
  return o;
}

function unpack(o) {
  if (o && o.v === 1 && o.ty === 't') return normalizeSong({ type: 'tab', title: o.t, artist: o.a, key: o.k, yt: o.y, bpm: o.b, tab: unpackTab(o.tb) });
  if (!o || o.v !== 1 || !Array.isArray(o.s)) throw new SongFormatError(t('link.bad'));
  const song = normalizeSong({
    title: o.t, artist: o.a, key: o.k, capo: o.c, strum: o.p, yt: o.y, tuning: o.u, bpm: o.b, transpose: o.tr,
    sections: o.s.map((x) => ({
      name: x.n || '',
      strum: x.p,
      tabs: (x.tb || []).map((tb) => ({ sig: tb.g, bars: (tb.b || []).map(([w, notes]) => ({ w, notes: (notes || []).map(([s, f, p, t]) => ({ s, f, p, t })) })) })),
      lines: (x.l || []).map((l) => ({ text: l[0] || '', chords: (l[1] || []).map(([chord, position]) => ({ chord, position })) })),
    })),
  });
  const rc = cleanRecording(o.rc); // „Moji snimci“: samo note
  if (rc) song.recording = rc;
  return song;
}

// (Pravljenje linka sa celom pesmom u adresi više ne postoji — deli se samo kroz shareService.js; stari linkovi se i dalje otvaraju.)
export const hasSharedSong = (hash = location.hash) => hash.startsWith(PREFIX);

/** Pesma iz linka (ili baca SongFormatError). */
export function songFromHash(hash = location.hash) {
  const data = hash.slice(PREFIX.length);
  let json;
  try { json = LZString.decompressFromEncodedURIComponent(data); } catch { json = null; }
  if (!json) throw new SongFormatError(t('link.bad'));
  let o;
  try { o = JSON.parse(json); } catch { throw new SongFormatError(t('link.bad')); }
  const song = unpack(o);
  // Novi linkovi: akordi su već nedvosmisleni (B = H, Bb = B); primalac ih prikazuje u svom imenovanju
  if (o.cv >= 2) { song.cv = o.cv; if (Array.isArray(o.kn)) song.keyN = { root: Number(o.kn[0]) % 12, minor: !!o.kn[1] }; }
  return song;
}

// Za testove
export const _pack = pack;
export const _unpack = unpack;

/** Isti kratak zapis pesme za deljenje set liste (shareCode.js). */
export { pack as packSong, unpack as unpackSong };
