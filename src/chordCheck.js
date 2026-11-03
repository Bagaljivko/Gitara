// Podešavanja → „Provera akorda“: SAMO PREGLED (ništa se ne menja ni ne čuva).
// Za svaku pesmu pokazuje kako bi je pročitalo novo imenovanje akorda (srpsko H/B/Fis/Es ili englesko B/Bb/F#/Eb),
// koji tonalitet je prepoznat i šta treba proveriti: dvosmisleno „B“, akorde koji su danas sačuvani kao tekst
// (npr. „Fism Cis7“) i redove sa usamljenim malim slovom („e“, „a“) — da vidiš da li ih tvoji papiri koriste.
import { songs as db } from './db.js';
import { t } from './i18n.js';
import { esc } from './ui.js';
import { readChord, renderChord, detectNaming, detectKey, keyName, isChordLineAs } from './chordnames.js';

const EXTRA = /^(\||x\d+|\d+x|N\.?C\.?|%|\.{2,}|-+|\(|\))$/i;

/** Red sa akordima u kome postoji usamljeno malo slovo (npr. „e   a   D“). */
export function lowercaseChordLine(text) {
  const toks = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (toks.length < 1) return false;
  let lower = 0;
  for (const tk of toks) {
    if (/^[a-h]$/.test(tk)) { lower++; continue; }
    if (readChord(tk, 'sr') || readChord(tk, 'en') || EXTRA.test(tk)) continue;
    return false;
  }
  // Samo jedno slovo bez ijednog drugog akorda je verovatnije reč („a“, „i“) — traži bar 2 tokena
  return lower > 0 && toks.length >= 2;
}

/** Analiza jedne pesme (bez menjanja). */
export function analyzeSong(song) {
  const sections = (song.sections || []).map((sec) => {
    const lines = [];
    const src = sec.lines || [];
    for (let i = 0; i < src.length; i++) {
      const l = src[i], next = src[i + 1];
      // Red koji danas nije prepoznat kao akordi (npr. „Fism   Cis7“), a ispod je tekst
      if (!(l.chords || []).length && isChordLineAs(l.text, 'sr')) {
        const chords = []; const re = /\S+/g; let m;
        while ((m = re.exec(l.text))) chords.push({ chord: m[0], position: m.index });
        if (next && !(next.chords || []).length && !isChordLineAs(next.text, 'sr')) { lines.push({ text: next.text, chords, lifted: true }); i++; }
        else lines.push({ text: '', chords, lifted: true });
        continue;
      }
      lines.push({ text: l.text || '', chords: (l.chords || []).map((c) => ({ chord: c.chord, position: c.position })), lower: lowercaseChordLine(l.text) });
    }
    return { name: sec.name || '', lines };
  });
  const tokens = sections.flatMap((s) => s.lines.flatMap((l) => l.chords.map((c) => c.chord)));
  const naming = detectNaming(tokens);
  const readAs = naming.naming === 'any' ? 'en' : naming.naming;
  for (const s of sections) for (const l of s.lines) for (const c of l.chords) {
    c.n = readChord(c.chord, readAs);
    c.isB = !!c.n && /^B(?!b)/.test(c.chord) && naming.reason === 'B';
    c.unknown = !c.n;
  }
  const all = sections.flatMap((s) => s.lines.flatMap((l) => l.chords.map((c) => c.n).filter(Boolean)));
  const key = detectKey(all);
  const flags = {
    b: naming.reason === 'B' || naming.confidence === 'ask' ? naming.confidence : null, // 'guess' | 'ask'
    lifted: sections.reduce((n, s) => n + s.lines.filter((l) => l.lifted).length, 0),
    lower: sections.reduce((n, s) => n + s.lines.filter((l) => l.lower).length, 0),
    keyUnsure: key && !key.confident,
    unknown: sections.reduce((n, s) => n + s.lines.reduce((k, l) => k + l.chords.filter((c) => c.unknown).length, 0), 0),
  };
  flags.any = !!(flags.b || flags.lifted || flags.lower || flags.keyUnsure || flags.unknown);
  return { sections, naming, key, flags };
}

/** Red akorda kao HTML (monospace), sa istaknutim akordima. */
function chordLineHTML(chords, naming, key) {
  let out = '', col = 0;
  for (const c of chords) {
    const txt = c.n ? renderChord(c.n, naming, key) : c.chord;
    if (col > c.position) { out += ' '; col++; }
    out += ' '.repeat(Math.max(0, c.position - col));
    col = Math.max(col, c.position);
    const cls = c.unknown ? 'cc-unknown' : c.isB ? 'cc-b' : '';
    out += cls ? `<mark class="${cls}">${esc(txt)}</mark>` : esc(txt);
    col += txt.length;
  }
  return out;
}

function songHTML(a, naming) {
  return a.sections.map((s) => `${s.name ? `<div class="cc-sec">${esc(s.name)}</div>` : ''}${s.lines.map((l) => {
    const cls = l.lifted ? ' cc-lifted' : l.lower ? ' cc-lower' : '';
    const chords = l.chords.length ? `<div class="cc-chords">${chordLineHTML(l.chords, naming, a.key)}</div>` : '';
    return `<div class="cc-line${cls}">${chords}${l.text ? `<div class="cc-text">${esc(l.text)}</div>` : ''}</div>`;
  }).join('')}`).join('');
}

/** Za dvosmisleno „B“: kako bi isti akordi glasili uz drugo značenje. */
function altHTML(a) {
  const other = a.naming.naming === 'sr' ? 'en' : 'sr';
  const seen = new Map();
  for (const s of a.sections) for (const l of s.lines) for (const c of l.chords) {
    if (!c.isB || seen.has(c.chord)) continue;
    const alt = readChord(c.chord, other);
    if (alt) seen.set(c.chord, `${renderChord(alt, 'sr', null)} / ${renderChord(alt, 'en', null)}`);
  }
  if (!seen.size) return '';
  const pairs = [...seen].map(([from, to]) => `<mark class="cc-b">${esc(from)}</mark> → ${esc(to)}`).join(', ');
  return `<p class="small cc-alt">${t('cc.alt', { which: t(other === 'sr' ? 'cc.altBb' : 'cc.altH') })} ${pairs}</p>`;
}

export async function renderChordCheck(root) {
  const songs = (await db.all()).sort((x, y) => String(x.title).localeCompare(String(y.title), 'sr'));
  const results = songs.map((s) => ({ song: s, a: analyzeSong(s) }));
  const flagged = results.filter((r) => r.a.flags.any);
  let showAll = !flagged.length;
  root.innerHTML = `
  <section class="view cc-view">
    <header class="topbar"><a href="#/podesavanja" class="back">${t('cc.back')}</a></header>
    <h1>${t('cc.title')}</h1>
    <p class="cc-note">${t('cc.readOnly')}</p>
    <div class="cc-legend small">
      <span><mark class="cc-b">B</mark> ${t('cc.legendB')}</span>
      <span><i class="cc-sw cc-lifted"></i> ${t('cc.legendLifted')}</span>
      <span><i class="cc-sw cc-lower"></i> ${t('cc.legendLower')}</span>
      <span><mark class="cc-unknown">?</mark> ${t('cc.legendUnknown')}</span>
    </div>
    <p class="small muted">${t('cc.summary', { n: songs.length, f: flagged.length })}</p>
    <div class="seg-tabs" role="tablist">
      <button role="tab" data-f="flag">${t('cc.flagged', { n: flagged.length })}</button>
      <button role="tab" data-f="all">${t('cc.all', { n: songs.length })}</button>
    </div>
    <div id="ccList"></div>
  </section>`;
  const list = root.querySelector('#ccList');
  const draw = () => {
    root.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('active', (b.dataset.f === 'all') === showAll));
    const items = showAll ? results : flagged;
    if (!items.length) { list.innerHTML = `<p class="muted center">${t(songs.length ? 'cc.nothing' : 'cc.noSongs')}</p>`; return; }
    list.innerHTML = items.map(({ song, a }, i) => {
      const nm = a.naming;
      const namingTxt = t('cc.naming_' + (nm.naming === 'any' ? 'any' : nm.naming)) + ' · ' + t('cc.reason_' + nm.reason) + (nm.naming === 'any' ? '' : ' · ' + t('cc.conf_' + nm.confidence));
      const keyTxt = a.key ? `${keyName(a.key, 'sr')} / ${keyName(a.key, 'en')}${a.key.confident ? '' : ' · ' + t('cc.keyAsk', { a: keyName(a.key.ranked[0], 'sr'), b: keyName(a.key.ranked[1], 'sr') })}` : '—';
      const chips = [
        a.flags.b === 'ask' ? `<span class="cc-chip warn">${t('cc.chipAsk')}</span>` : a.flags.b === 'guess' ? `<span class="cc-chip">${t('cc.chipGuess')}</span>` : '',
        a.flags.lifted ? `<span class="cc-chip info">${t('cc.chipLifted', { n: a.flags.lifted })}</span>` : '',
        a.flags.lower ? `<span class="cc-chip lower">${t('cc.chipLower', { n: a.flags.lower })}</span>` : '',
        a.flags.unknown ? `<span class="cc-chip warn">${t('cc.chipUnknown', { n: a.flags.unknown })}</span>` : '',
        a.flags.keyUnsure ? `<span class="cc-chip">${t('cc.chipKey')}</span>` : '',
      ].join('');
      return `<details class="card cc-song"${!showAll && i < 3 ? ' open' : ''}>
        <summary><b>${esc(song.title)}</b><span class="small muted">${esc(song.artist || '')}</span><span class="cc-chips">${chips}</span></summary>
        <p class="small"><b>${t('cc.sheet')}</b> ${esc(namingTxt)}<br><b>${t('cc.key')}</b> ${esc(keyTxt)}${song.key ? ` · ${t('cc.keyWritten', { k: song.key })}` : ''}</p>
        ${a.flags.b ? altHTML(a) : ''}
        <div class="cc-cols">
          <div><div class="cc-h">${t('cc.showSr')}</div><div class="cc-song-body">${songHTML(a, 'sr')}</div></div>
          <div><div class="cc-h">${t('cc.showEn')}</div><div class="cc-song-body">${songHTML(a, 'en')}</div></div>
        </div>
      </details>`;
    }).join('');
  };
  root.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { showAll = b.dataset.f === 'all'; draw(); }));
  draw();
}
