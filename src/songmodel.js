// Model pesme: original (kako je skenirano/uneto — nikad se ne menja) i radni sloj sa neutralnim akordima.
// Radni sloj: svaki akord ima { chord: nedvosmislen engleski zapis („Bb7“, „F#m“), n: { r, s, b }, w: kako je napisan, position }.
// Transpozicija, kapodaster i imena nota menjaju samo prikaz.
import { readChord, renderChord, detectNaming, detectKey, keyName, isChordLineAs } from './chordnames.js';

export const CV = 2; // verzija zapisa akorda

/** Da li pesmi treba (ponovo) napraviti neutralni sloj: stara verzija ili akordi bez n (npr. iz linka ili rezervne kopije). */
export function needsUpgrade(song) {
  if (!song || !Array.isArray(song.sections)) return false;
  if (!(song.cv >= CV)) return true;
  return song.sections.some((sec) => (sec.lines || []).some((l) => (l.chords || []).some((c) => !c.n)));
}

const clone = (o) => JSON.parse(JSON.stringify(o));

/** Snimak originala: tekst i akordi tačno kako su pročitani. */
export function snapshotOriginal(song) {
  return clone({
    title: song.title || '', artist: song.artist || '', key: song.key || '',
    sections: (song.sections || []).map((s) => ({ ...s, lines: (s.lines || []).map((l) => ({ text: l.text || '', chords: (l.chords || []).map((c) => ({ chord: c.w ?? c.chord, position: c.position })) })) })),
    ...(song.strum ? { strum: song.strum } : {}),
  });
}

/** Redovi koji su ranije sačuvani kao tekst, a sadrže samo akorde (npr. „Fism  Cis7“) → akordi iznad sledećeg reda. */
function liftLines(sections) {
  return sections.map((sec) => {
    const out = [];
    const src = sec.lines || [];
    for (let i = 0; i < src.length; i++) {
      const l = src[i], next = src[i + 1];
      if (!(l.chords || []).length && l.text && isChordLineAs(l.text, 'sr')) {
        const chords = []; const re = /\S+/g; let m;
        while ((m = re.exec(l.text))) chords.push({ chord: m[0], position: m.index });
        if (next && !(next.chords || []).length && next.text && !isChordLineAs(next.text, 'sr')) { out.push({ text: next.text, chords }); i++; }
        else out.push({ text: '', chords });
      } else out.push(l);
    }
    return { ...sec, lines: out };
  });
}

/** Tonalitet zapisan tekstom („Hm“, „B“, „Fis“, „Am“) → { root, minor }. */
export function readKey(text, naming) {
  const c = readChord(String(text || '').trim(), naming);
  if (!c) return null;
  return { root: c.r, minor: /^m(?!aj)/.test(c.s) };
}

/**
 * Napravi (ili ponovo napravi) radni sloj sa neutralnim akordima.
 * opts.naming: kako čitati napisane akorde ('sr' | 'en') — ako se ne zada, prepoznaje se (i po potrebi pita).
 * opts.keyN: tonalitet koji je korisnik izabrao.
 */
export function upgradeSong(song, opts = {}) {
  if (!song || !Array.isArray(song.sections)) return song;
  if (!needsUpgrade(song) && !opts.naming && !opts.keyN && !opts.force && opts.keyText === undefined) return song;
  const s = clone(song);
  if (!s.original) s.original = snapshotOriginal(song);
  // Već konvertovana pesma bez n (npr. iz rezervne kopije ili linka): akordi su u engleskom zapisu
  const canonicalInput = s.cv >= CV && !opts.naming;
  s.sections = liftLines(s.sections);
  const all = [];
  for (const sec of s.sections) for (const l of sec.lines) for (const c of l.chords || []) all.push(c);
  const written = all.map((c) => (canonicalInput ? c.chord : c.w ?? c.chord));
  let naming = opts.naming || (canonicalInput ? 'en' : null);
  let namingAsk = false;
  if (!naming) {
    const nm = detectNaming(written);
    naming = nm.naming === 'any' ? 'en' : nm.naming;
    namingAsk = nm.confidence === 'ask';
  }
  const ns = written.map((w) => readChord(w, naming));
  // Tonalitet: izabran > upisan > prepoznat
  // keyText: tonalitet upisan u editoru (u imenovanju u kome je i upisan)
  let keyN = opts.keyN || (opts.keyText !== undefined ? readKey(opts.keyText, naming) : null) || (s.cv >= CV && !opts.naming && s.keyN)
    || readKey(canonicalInput ? s.key : (s.original && s.original.key) || s.key, canonicalInput ? 'en' : naming);
  let keyAsk = false;
  if (!keyN) {
    const det = detectKey(ns.filter(Boolean));
    if (det) { keyN = { root: det.root, minor: det.minor }; keyAsk = !det.confident; s.keyAlt = det.ranked.slice(0, 2).map((k) => ({ root: k.root, minor: k.minor })); }
  } else delete s.keyAlt;
  all.forEach((c, i) => {
    const n = ns[i];
    c.w = canonicalInput ? (c.w ?? c.chord) : written[i];
    if (n) { c.n = { r: n.r, s: n.s, b: n.b }; c.chord = renderChord(c.n, 'en', keyN); }
    else { c.n = { t: written[i] }; c.chord = written[i]; }
  });
  s.key = keyN ? keyName(keyN, 'en') : '';
  s.keyN = keyN || null;
  if (!canonicalInput) s.naming = naming;
  s.namingAsk = canonicalInput ? !!s.namingAsk : namingAsk;
  s.keyAsk = opts.keyN ? false : (s.cv >= CV && !opts.naming && !opts.force ? !!s.keyAsk : keyAsk);
  s.cv = CV;
  return s;
}

/** „Vrati na original“: tekst, akordi i naslov tačno kao u originalu, tonalitet +0, bez kapodastera. */
export function restoreOriginal(song) {
  const o = song.original;
  if (!o) return song;
  const s = clone(song);
  s.title = o.title || s.title;
  s.artist = o.artist || '';
  s.key = o.key || '';
  s.sections = clone(o.sections);
  if (o.strum) s.strum = clone(o.strum); else delete s.strum;
  s.transpose = 0;
  s.capo = 0;
  delete s.easyCapo; delete s.uncertain; delete s.keyN; delete s.keyAlt;
  s.cv = 0;
  // Ako je korisnik već odgovorio na pitanje o B/H, zadrži odgovor
  return upgradeSong(s, s.namingAsk === false && s.naming ? { naming: s.naming } : {});
}

/** Da li se pesma razlikuje od originala (tekst, akordi, naslov) — akordi se porede po značenju, ne po zapisu. */
export function differsFromOriginal(song) {
  const o = song.original;
  if (!o) return false;
  const naming = song.naming || 'en';
  const key = (n) => (!n ? '?' : n.t !== undefined ? 't:' + n.t : `${n.r}|${n.s}|${n.b ?? ''}`);
  const sig = (sections, fromText) => JSON.stringify(sections.map((sec) => ({
    n: sec.name || '', tb: sec.tabs || [],
    l: sec.lines.map((l) => [l.text || '', (l.chords || []).map((c) => (fromText ? key(readChord(c.chord, naming) || { t: c.chord }) : key(c.n)) + '@' + c.position)]),
  })));
  if ((song.title || '') !== (o.title || '') || (song.artist || '') !== (o.artist || '')) return true;
  return sig(song.sections || [], false) !== sig(liftLines(o.sections || []), true);
}
