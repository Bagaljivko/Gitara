// Konverzija pesme <-> tekst "akordi iznad teksta", validacija i transpozicija pesme.
import { t } from './i18n.js';
import { cleanPattern } from './rhythm.js';
import { cleanTuning } from './tunings.js';
import { isTabLine, parseAsciiTab, tabToAscii, cleanTab, noteAt } from './tabs.js';
import { cleanTabSong } from './tabData.js';
import { isChord as isEnglishChord, transposeChord, transposeKey, parseChord, parseKey, prefersFlats } from './music.js';
import { readChord, renderChord, keyName } from './chordnames.js';

// Akord u bilo kom imenovanju (G, Hm, Fism, Es, Bb, D/Fis…) — značenje „B“ određuje se kasnije, za celu pesmu
const isChord = (tok) => !!readChord(tok, 'sr') || isEnglishChord(tok);

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
    // Tablatura: 6 uzastopnih ASCII redova (opciono red sa taktom, npr. „3/4“, iznad)
    const sigM = line.trim().match(/^(\d{1,2}\/\d{1,2})$/);
    const tStart = sigM ? i + 1 : i;
    if (tStart + 5 < lines.length && lines.slice(tStart, tStart + 6).every(isTabLine)) {
      const tab = parseAsciiTab(lines.slice(tStart, tStart + 6), sigM ? sigM[1] : '4/4');
      if (tab) { const sec = ensure(); (sec.tabs = sec.tabs || []).push(tab); i = tStart + 5; continue; }
    }
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
  return sections.filter((s) => s.name || s.lines.length || (s.tabs && s.tabs.length));
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
    (sec.tabs || []).forEach((tab, ti) => {
      if (tab.sig && tab.sig !== '4/4') out.push(tab.sig);
      out.push(...tabToAscii(tab));
      if (ti < sec.tabs.length - 1 || (sec.lines && sec.lines.length)) out.push('');
    });
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
  }).filter((x) => x.chords.length).filter((x, i, all) => {
    // isti deo sa istim akordima (refren tri puta) — samo jednom
    const k = (y) => `${(y.name || '').trim().toLowerCase().replace(/\s*\d+$/, '')}|${y.chords.join(' ')}`;
    return all.findIndex((y) => k(y) === k(x)) === i;
  });
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
  const hasN = (song.sections || []).some((s) => s.lines.some((l) => (l.chords || []).some((c) => c.n)));
  if (hasN || song.keyN) {
    // Neutralni akordi: pomeri koren i bas, a povisilice/snizilice odredi prema NOVOM tonalitetu i ulozi akorda
    const key = song.keyN ? { root: (song.keyN.root + n + 120) % 12, minor: song.keyN.minor } : null;
    const shiftTab = (tab) => ({ ...tab, bars: tab.bars.map((b) => ({ ...b, notes: b.notes.map((x) => {
      if (!/^\d+$/.test(String(x.f))) return x; // npr. „x“ (prigušeno) ostaje
      let f = Number(x.f) + n;
      while (f < 0) f += 12;
      while (f > 24) f -= 12;
      return { ...x, f: typeof x.f === 'number' ? f : String(f) };
    }) })) });
    return {
      ...song,
      keyN: key || song.keyN,
      key: key ? keyName(key, 'en') : song.key,
      sections: (song.sections || []).map((s) => ({
        ...s,
        ...(s.tabs ? { tabs: s.tabs.map(shiftTab) } : {}),
        lines: s.lines.map((l) => ({ ...l, chords: (l.chords || []).map((c) => (c.n && c.n.t === undefined
          ? { ...c, chord: renderChord(c.n, 'en', key, n), n: { ...c.n, r: (c.n.r + n + 120) % 12, b: c.n.b === null || c.n.b === undefined ? null : (c.n.b + n + 120) % 12 } }
          : c)) })),
      })),
    };
  }
  const useH = songUsesH(song);
  // Stari zapis (bez neutralnih akorda): snizilice ili povisilice prema novom tonalitetu (ili prvom akordu).
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
  // TAB pesma (prebiranje): taktovi i note umesto teksta i akorada
  if (raw.type === 'tab') {
    const tab = cleanTabSong(raw.tab);
    if (!tab) throw new SongFormatError(t('fmt.empty'));
    return { type: 'tab', title: str(raw.title, 120).trim() || t('common.untitled'), artist: str(raw.artist, 120).trim(), key: str(raw.key || tab.key, 12).trim(), sections: [], transpose: 0, tab, ...songExtras(raw) };
  }
  if (!Array.isArray(raw.sections)) throw new SongFormatError(t('fmt.notGitara'));
  if (raw.sections.length > 200) throw new SongFormatError(t('fmt.tooBig'));
  const sections = raw.sections.map((s, si) => {
    if (!s || typeof s !== 'object') throw new SongFormatError(t('fmt.badPart', { n: si + 1 }));
    const lines = Array.isArray(s.lines) ? s.lines : [];
    if (lines.length > 500) throw new SongFormatError(t('fmt.tooBig'));
    const sec = {
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
    const sp = cleanPattern(s.strum);
    if (sp) sec.strum = sp;
    const tabs = (Array.isArray(s.tabs) ? s.tabs : []).slice(0, 12).map(cleanTab).filter(Boolean);
    if (tabs.length) sec.tabs = tabs;
    return sec;
  });
  const totalLines = sections.reduce((n, s) => n + s.lines.length + (s.tabs ? s.tabs.length : 0), 0);
  if (!totalLines) throw new SongFormatError(t('fmt.empty'));
  const tr = Math.round(Number(raw.transpose) || 0);
  return {
    title: str(raw.title, 120).trim() || t('common.untitled'),
    artist: str(raw.artist, 120).trim(),
    key: str(raw.key, 12).trim(),
    sections,
    transpose: tr >= -11 && tr <= 11 ? tr : 0,
    ...songExtras(raw),
    ...(Array.isArray(raw.uncertain) ? { uncertain: cleanUncertain(raw.uncertain, sections) } : {}),
  };
}

/** Podešavanja po pesmi: kapodaster, brzina skrolovanja, ritam (strumming). */
export function songExtras(raw) {
  const out = {};
  const capo = Math.round(Number(raw.capo) || 0);
  if (capo >= 1 && capo <= 7) out.capo = capo;
  const sp = Number(raw.scrollSpeed);
  if (sp >= 1 && sp <= 10) out.scrollSpeed = Math.round(sp);
  const strum = cleanPattern(raw.strum);
  if (strum) out.strum = strum;
  const yt = cleanYt(raw.yt);
  if (yt) out.yt = yt;
  const bpm = Math.round(Number(raw.bpm) || 0);
  if (bpm >= 40 && bpm <= 220) out.bpm = bpm;
  const tuning = cleanTuning(raw.tuning);
  if (tuning !== 'standard') out.tuning = tuning;
  return out;
}

/** YouTube adresa (video ili kratki link) ili '' ako nije ispravna. */
export function cleanYoutubeUrl(u) {
  let url;
  try { url = new URL(String(u || '').trim()); } catch { return ''; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  if (host !== 'youtube.com' && host !== 'youtu.be' && host !== 'youtube-nocookie.com') return '';
  url.protocol = 'https:';
  return url.toString().slice(0, 300);
}

function cleanYt(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const k of ['listen', 'tutorial']) { const u = cleanYoutubeUrl(raw[k]); if (u) out[k] = u; }
  return Object.keys(out).length ? out : null;
}

/** Keš YouTube pretrage po pesmi: { listen|tutorial: { q, v: [{ id, t, c, d }] } } — samo ID-jevi i tekst, bez adresa. */
export function cleanYtFound(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const k of ['listen', 'tutorial']) {
    const e = raw[k];
    if (!e || typeof e !== 'object' || typeof e.q !== 'string' || !Array.isArray(e.v)) continue;
    out[k] = { q: e.q.slice(0, 300), v: e.v.filter((x) => x && /^[\w-]{6,20}$/.test(x.id)).slice(0, 5).map((x) => ({ id: x.id, t: String(x.t || '').slice(0, 200), c: String(x.c || '').slice(0, 100), d: String(x.d || '').slice(0, 12) })) };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Stanje predloga (samo za ovaj uređaj i rezervnu kopiju, ne deli se):
 * uncertain — mesta koja Gemini nije pouzdano pročitao; easyCapo — primenjena „lakša verzija“;
 * skipped — preskočeni predlozi; suggestStrum — keširan predlog ritma.
 */
export function songMeta(raw) {
  const out = {};
  if (raw.type === 'tab') { const tab = cleanTabSong(raw.tab); if (tab) { out.type = 'tab'; out.tab = tab; } }
  // Nov zapis akorda (neutralni sloj) i original — čuvaju se u rezervnoj kopiji
  if (Number(raw.cv) >= 2) out.cv = Number(raw.cv);
  if (raw.naming === 'sr' || raw.naming === 'en') out.naming = raw.naming;
  if (raw.keyN && Number.isInteger(raw.keyN.root) && raw.keyN.root >= 0 && raw.keyN.root < 12) out.keyN = { root: raw.keyN.root, minor: !!raw.keyN.minor };
  if (raw.keyAsk) out.keyAsk = true;
  if (raw.namingAsk) out.namingAsk = true;
  if (Array.isArray(raw.keyAlt)) out.keyAlt = raw.keyAlt.filter((k) => k && Number.isInteger(k.root) && k.root >= 0 && k.root < 12).slice(0, 2).map((k) => ({ root: k.root, minor: !!k.minor }));
  if (raw.original && typeof raw.original === 'object') {
    try {
      const o = normalizeSong({ ...raw.original, transpose: 0 });
      out.original = { title: o.title, artist: o.artist, key: o.key, sections: o.sections, ...(o.strum ? { strum: o.strum } : {}) };
    } catch {}
  }
  const unc = cleanUncertain(raw.uncertain, raw.sections);
  if (unc.length) out.uncertain = unc;
  const z = Number(raw.zoom);
  if (z >= 0.8 && z <= 1.8 && z !== 1) out.zoom = Math.round(z * 100) / 100;
  const ec = Math.round(Number(raw.easyCapo) || 0);
  if (ec >= 1 && ec <= 7) out.easyCapo = ec;
  if (raw.skipped && typeof raw.skipped === 'object') {
    const sk = {};
    for (const k of ['easy', 'strum']) if (raw.skipped[k]) sk[k] = true;
    if (Object.keys(sk).length) out.skipped = sk;
  }
  const yf = cleanYtFound(raw.ytFound);
  if (yf) out.ytFound = yf; // keširani rezultati YouTube pretrage (da se ista pesma nikad ne traži dvaput)
  const rc = cleanRecording(raw.recording);
  if (rc) out.recording = rc; // „Moji snimci“: ponovo na vratu
  const ss = raw.suggestStrum;
  if (ss && typeof ss === 'object' && typeof ss.id === 'string' && ss.id.length < 30) out.suggestStrum = { id: ss.id, reason: String(ss.reason || '').slice(0, 300), lang: ss.lang === 'en' ? 'en' : 'sr' };
  return out;
}

/** Snimak iz „Samo sviraj“ na pesmi (za „Pusti na vratu“): {v, dur, events:[{t, notes:[{m,s,f}], chord?}]}. */
export function cleanRecording(r) {
  if (!r || typeof r !== 'object' || !Array.isArray(r.events)) return null;
  const events = cleanRecEvents(r.events);
  if (!events.length) return null;
  const out = { v: 1, dur: Math.max(0, Math.min(600000, Math.round(Number(r.dur) || 0))), events };
  if (typeof r.recId === 'string') out.recId = r.recId.slice(0, 40);
  // neočišćen original (za „vrati“) — samo ako postoji i nije prevelik
  if (Array.isArray(r.raw) && r.raw.length <= 5000) { const raw = cleanRecEvents(r.raw); if (raw.length) out.raw = raw; }
  return out;
}
function cleanRecEvents(list) {
  const events = [];
  for (const e of list.slice(0, 20000)) {
    if (!e || typeof e !== 'object') continue;
    const notes = (Array.isArray(e.notes) ? e.notes : []).slice(0, 6).map((n) => ({ m: Math.round(Number(n && n.m)), s: Math.round(Number(n && n.s)), f: Math.round(Number(n && n.f)) }))
      .filter((n) => n.m >= 40 && n.m <= 88 && n.s >= 0 && n.s <= 5 && n.f >= 0 && n.f <= 12);
    const ev = { t: Math.max(0, Math.min(600000, Math.round(Number(e.t) || 0))), notes };
    if (typeof e.chord === 'string' && /^[A-G][#b]?[a-z0-9]{0,6}$/.test(e.chord)) { ev.chord = e.chord; if (e.u) ev.u = 1; }
    if (notes.length || ev.chord) events.push(ev);
  }
  return events;
}

/** Proverava listu nesigurnih mesta: {section, line, kind: 'chord'|'word', text, position, suggestion}. */
export function cleanUncertain(raw, sections) {
  if (!Array.isArray(raw) || !Array.isArray(sections)) return [];
  const out = [];
  for (const u of raw.slice(0, 60)) {
    if (!u || typeof u !== 'object') continue;
    const si = Math.round(Number(u.section)), li = Math.round(Number(u.line));
    const sec = sections[si];
    if (u.kind === 'fret') {
      const ti = Math.round(Number(u.tab) || 0), string = Math.round(Number(u.string)), col = Math.round(Number(u.col));
      const tab = sec && sec.tabs && sec.tabs[ti];
      const n = tab && noteAt(tab, string, col);
      const text = String(u.text ?? '').trim(), suggestion = String(u.suggestion ?? '').trim();
      if (!n || n.f !== text || !/^(x|\d{1,2})$/.test(suggestion) || suggestion === text) continue;
      out.push({ section: si, kind: 'fret', tab: ti, string, col, text, suggestion, line: 0, position: col });
      continue;
    }
    const line = sec && sec.lines && sec.lines[li];
    if (!line) continue;
    const kind = u.kind === 'chord' ? 'chord' : 'word';
    const text = String(u.text || '').trim().slice(0, 40);
    const suggestion = String(u.suggestion || '').trim().slice(0, 40);
    if (!text || !suggestion || text === suggestion) continue;
    if (kind === 'chord' && !(line.chords || []).some((c) => c.chord === text || c.w === text)) continue; // w = kako je napisano na papiru
    if (kind === 'word' && !(line.text || '').includes(text)) continue;
    const position = Math.max(0, Math.round(Number(u.position) || 0));
    out.push({ section: si, line: li, kind, text, suggestion, position });
  }
  return out;
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
  return JSON.stringify({ app: 'gitara', version: 1, exportedAt: new Date().toISOString(), song: { title, artist, key, sections, transpose, ...songExtras(song) } });
}

/** Parsira rezervnu kopiju biblioteke. Vraća niz pesama. */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new SongFormatError(t('fmt.badJson')); }
  if (data && data.song) return [parseSharedFile(text)];
  if (!data || !Array.isArray(data.songs)) throw new SongFormatError(t('fmt.notBackup'));
  const out = [];
  // ID i vremena ostaju (spajanje po ID-u: ista pesma se ne dodaje dvaput, novija verzija pobeđuje)
  const keep = (s) => ({ ...(typeof s.id === 'string' && s.id && s.id.length <= 80 ? { id: s.id } : {}), ...(Number(s.createdAt) > 0 ? { createdAt: Number(s.createdAt) } : {}), ...(Number(s.updatedAt) > 0 ? { updatedAt: Number(s.updatedAt) } : {}) });
  for (const s of data.songs) { try { const n = normalizeSong(s); out.push({ ...n, ...songMeta({ ...s, sections: n.sections }), ...keep(s) }); } catch {} }
  if (!out.length) throw new SongFormatError(t('fmt.backupEmpty'));
  return out;
}

export function safeFileName(s) {
  const map = { č: 'c', ć: 'c', š: 's', ž: 'z', đ: 'dj', Č: 'C', Ć: 'C', Š: 'S', Ž: 'Z', Đ: 'Dj' };
  return (String(s || 'pesma').replace(/[čćšžđČĆŠŽĐ]/g, (c) => map[c]).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60)) || 'pesma';
}
