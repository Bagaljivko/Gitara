// Konverzija pesme <-> tekst "akordi iznad teksta", validacija i transpozicija pesme.
import { t } from './i18n.js';
import { isChord, transposeChord, transposeKey, parseChord, parseKey, prefersFlats } from './music.js';

const EXTRA_TOKENS = /^(\||\|\||%|-|–|\/|x\d+|\(x\d+\)|\d+x|\(\d+x\)|\.\.\.?|N\.?C\.?)$/i;

export function isChordLine(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  let chords = 0;
  for (const t of tokens) {
    const clean = t.replace(/^\(|\)$/g, '');
    if (isChord(clean)) chords++;
    else if (!EXTRA_TOKENS.test(t)) return false;
  }
  return chords > 0;
}

function headerName(line) {
  const t = line.trim();
  let m = t.match(/^\[(.+)\]$/);
  if (m) return m[1].trim();
  m = t.match(/^\{(?:c|comment|section):\s*(.+)\}$/i);
  if (m) return m[1].trim();
  m = t.match(/^(strofa|refren|ref\.?|most|uvod|intro|outro|kraj|bridge|verse|chorus|pre-?chorus|prerefren|solo|završetak|zavrsetak|interludij|coda)(\s*\d+)?\s*:?$/i);
  if (m) return t.replace(/:$/, '').trim();
  return null;
}

function chordsFromLine(line) {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(line))) {
    const clean = m[0].replace(/^\(|\)$/g, '');
    if (isChord(clean)) out.push({ chord: clean, position: m.index });
  }
  return out;
}

/** Parsira tekst sa akordima iznad reči u sekcije. */
export function textToSections(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const sections = [];
  let cur = null;
  const ensure = () => { if (!cur) { cur = { name: '', lines: [] }; sections.push(cur); } return cur; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '');
    const h = headerName(line);
    if (h !== null && !isChordLine(line)) {
      cur = { name: h, lines: [] };
      sections.push(cur);
      continue;
    }
    if (isChordLine(line)) {
      const next = lines[i + 1] !== undefined ? lines[i + 1].replace(/\s+$/, '') : undefined;
      const chords = chordsFromLine(line);
      if (next !== undefined && next.trim() !== '' && !isChordLine(next) && headerName(next) === null) {
        ensure().lines.push({ chords, text: next });
        i++;
      } else {
        ensure().lines.push({ chords, text: '' });
      }
      continue;
    }
    ensure().lines.push({ chords: [], text: line });
  }
  // Ukloni prazne linije na početku/kraju sekcija i prazne sekcije bez imena.
  for (const s of sections) {
    while (s.lines.length && isBlank(s.lines[0])) s.lines.shift();
    while (s.lines.length && isBlank(s.lines[s.lines.length - 1])) s.lines.pop();
  }
  return sections.filter((s) => s.name || s.lines.length);
}

const isBlank = (l) => !l.text.trim() && !l.chords.length;

/** Pravi liniju akorda tako da akordi ne preklapaju jedan drugi. */
export function layoutChordLine(chords) {
  let s = '';
  for (const c of [...chords].sort((a, b) => a.position - b.position)) {
    let pos = Math.max(c.position | 0, 0);
    if (s.length && pos < s.length + 1) pos = s.length + 1;
    s = s.padEnd(pos, ' ') + c.chord;
  }
  return s;
}

export function sectionsToText(sections) {
  const out = [];
  (sections || []).forEach((sec, idx) => {
    if (idx > 0) out.push('');
    if (sec.name) out.push(`[${sec.name}]`);
    for (const l of sec.lines || []) {
      if (l.chords && l.chords.length) out.push(layoutChordLine(l.chords));
      if (l.text || !(l.chords && l.chords.length)) out.push(l.text || '');
    }
  });
  return out.join('\n');
}

/** Svi jedinstveni akordi u pesmi, redom pojavljivanja. */
export function songChords(song) {
  const seen = new Set();
  const list = [];
  for (const s of song.sections || []) for (const l of s.lines || []) for (const c of l.chords || []) {
    if (!seen.has(c.chord)) { seen.add(c.chord); list.push(c.chord); }
  }
  return list;
}

/** Sažetak progresije po sekcijama (uzastopni duplikati se spajaju). */
export function progressionSummary(song) {
  return (song.sections || []).map((s) => {
    const seq = [];
    for (const l of s.lines || []) for (const c of [...(l.chords || [])].sort((a, b) => a.position - b.position)) {
      if (seq[seq.length - 1] !== c.chord) seq.push(c.chord);
    }
    return { name: s.name, chords: compressRepeats(seq) };
  }).filter((x) => x.chords.length);
}

function compressRepeats(seq) {
  // Ako se cela sekvenca sastoji od ponavljanja kraćeg obrasca, prikaži obrazac.
  for (let len = 1; len <= seq.length / 2; len++) {
    if (seq.length % len) continue;
    let ok = true;
    for (let i = len; i < seq.length && ok; i++) if (seq[i] !== seq[i % len]) ok = false;
    if (ok) return seq.slice(0, len);
  }
  return seq;
}

export function transposeSong(song, n) {
  if (!n) return song;
  const useH = songUsesH(song);
  // Snizilice ili povisilice biramo prema novom tonalitetu (ili prvom akordu ako tonalitet nije zadat).
  const first = songChords(song)[0];
  const k = parseKey(song.key) || (first && parseKey(first.replace(/\/.*/, '').replace(/^([A-H][#b]?m?).*$/, '$1')));
  const flat = k ? prefersFlats((k.root + n + 120) % 12, k.minor) : undefined;
  return {
    ...song,
    key: song.key ? transposeKey(song.key, n, useH) : song.key,
    sections: (song.sections || []).map((s) => ({
      ...s,
      lines: s.lines.map((l) => ({ ...l, chords: l.chords.map((c) => ({ ...c, chord: transposeChord(c.chord, n, { useH, flat }) })) })),
    })),
  };
}

export function songUsesH(song) {
  for (const s of song.sections || []) for (const l of s.lines || []) for (const c of l.chords || []) {
    const p = parseChord(c.chord);
    if (p && p.usesH) return true;
  }
  return false;
}

// ---- Validacija (uvoz, Gemini odgovor) ----
export class SongFormatError extends Error {}

const str = (v, max = 500) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);

/** Validira i normalizuje objekat pesme. Baca SongFormatError sa porukom na srpskom. */
export function normalizeSong(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SongFormatError(t('fmt.noSong'));
  if (!Array.isArray(raw.sections)) throw new SongFormatError(t('fmt.notGitara'));
  if (raw.sections.length > 200) throw new SongFormatError(t('fmt.tooBig'));
  const sections = raw.sections.map((s, si) => {
    if (!s || typeof s !== 'object') throw new SongFormatError(t('fmt.badPart', { n: si + 1 }));
    const lines = Array.isArray(s.lines) ? s.lines : [];
    if (lines.length > 500) throw new SongFormatError(t('fmt.tooBig'));
    return {
      name: str(s.name, 80),
      lines: lines.map((l) => {
        if (typeof l === 'string') return { chords: [], text: str(l, 400) };
        if (!l || typeof l !== 'object') throw new SongFormatError(t('fmt.badLine'));
        const chords = (Array.isArray(l.chords) ? l.chords : [])
          .filter((c) => c && typeof c === 'object' && typeof c.chord === 'string' && c.chord.trim())
          .slice(0, 40)
          .map((c) => ({ chord: str(c.chord.trim(), 20), position: Math.max(0, Math.min(400, Math.round(Number(c.position) || 0))) }));
        return { chords, text: str(l.text, 400).replace(/\s+$/, '') };
      }),
    };
  });
  const totalLines = sections.reduce((n, s) => n + s.lines.length, 0);
  if (!totalLines) throw new SongFormatError(t('fmt.empty'));
  const tr = Math.round(Number(raw.transpose) || 0);
  return {
    title: str(raw.title, 120).trim() || t('common.untitled'),
    artist: str(raw.artist, 120).trim(),
    key: str(raw.key, 12).trim(),
    sections,
    transpose: tr >= -11 && tr <= 11 ? tr : 0,
  };
}

/** Parsira deljeni .json fajl (format { app: 'gitara', song } ili sama pesma). */
export function parseSharedFile(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new SongFormatError(t('fmt.badJsonSong')); }
  if (data && typeof data === 'object' && Array.isArray(data.songs)) {
    throw new SongFormatError(t('fmt.isBackup'));
  }
  if (data && typeof data === 'object' && data.song) {
    if (data.app && data.app !== 'gitara') throw new SongFormatError(t('fmt.otherApp'));
    data = data.song;
  }
  return normalizeSong(data);
}

export function toSharedFile(song) {
  const { title, artist, key, sections, transpose = 0 } = song;
  return JSON.stringify({ app: 'gitara', version: 1, exportedAt: new Date().toISOString(), song: { title, artist, key, sections, transpose } });
}

/** Parsira rezervnu kopiju biblioteke. Vraća niz pesama. */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new SongFormatError(t('fmt.badJson')); }
  if (data && data.song) return [parseSharedFile(text)];
  if (!data || !Array.isArray(data.songs)) throw new SongFormatError(t('fmt.notBackup'));
  const out = [];
  for (const s of data.songs) { try { out.push(normalizeSong(s)); } catch {} }
  if (!out.length) throw new SongFormatError(t('fmt.backupEmpty'));
  return out;
}

export function safeFileName(s) {
  const map = { č: 'c', ć: 'c', š: 's', ž: 'z', đ: 'dj', Č: 'C', Ć: 'C', Š: 'S', Ž: 'Z', Đ: 'Dj' };
  return (String(s || 'pesma').replace(/[čćšžđČĆŠŽĐ]/g, (c) => map[c]).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60)) || 'pesma';
}
