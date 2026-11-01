// Deljenje pesme kao linka: pesma se kompresuje (lz-string) u heš adrese, npr. …/Gitara/#pesma=...
import LZString from './lzstring.js';
import { normalizeSong, songExtras, SongFormatError } from './songformat.js';
import { t } from './i18n.js';

const PREFIX = '#pesma=';

/** Kratki ključevi da link bude što kraći. */
function pack(song) {
  const ex = songExtras(song);
  const o = { v: 1, t: song.title, a: song.artist || undefined, k: song.key || undefined, s: song.sections.map((sec) => {
    const x = { l: sec.lines.map((l) => (l.chords && l.chords.length ? [l.text || '', l.chords.map((c) => [c.chord, c.position])] : [l.text || ''])) };
    if (sec.name) x.n = sec.name;
    if (sec.strum) x.p = sec.strum;
    return x;
  }) };
  if (ex.capo) o.c = ex.capo;
  if (ex.strum) o.p = ex.strum;
  if (ex.yt) o.y = ex.yt;
  if (song.transpose) o.tr = song.transpose;
  return o;
}

function unpack(o) {
  if (!o || o.v !== 1 || !Array.isArray(o.s)) throw new SongFormatError(t('link.bad'));
  return normalizeSong({
    title: o.t, artist: o.a, key: o.k, capo: o.c, strum: o.p, yt: o.y, transpose: o.tr,
    sections: o.s.map((x) => ({
      name: x.n || '',
      strum: x.p,
      lines: (x.l || []).map((l) => ({ text: l[0] || '', chords: (l[1] || []).map(([chord, position]) => ({ chord, position })) })),
    })),
  });
}

/** Pun link za deljenje (radi na bilo kojoj adresi gde je aplikacija objavljena). */
export function songLink(song) {
  const base = location.origin + location.pathname;
  return base + PREFIX + LZString.compressToEncodedURIComponent(JSON.stringify(pack(song)));
}

export const hasSharedSong = (hash = location.hash) => hash.startsWith(PREFIX);

/** Pesma iz linka (ili baca SongFormatError). */
export function songFromHash(hash = location.hash) {
  const data = hash.slice(PREFIX.length);
  let json;
  try { json = LZString.decompressFromEncodedURIComponent(data); } catch { json = null; }
  if (!json) throw new SongFormatError(t('link.bad'));
  let o;
  try { o = JSON.parse(json); } catch { throw new SongFormatError(t('link.bad')); }
  return unpack(o);
}

// Za testove
export const _pack = pack;
export const _unpack = unpack;
