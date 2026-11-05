// Nazivi delova pesme na jeziku aplikacije — samo pri prikazu (sačuvane pesme se ne menjaju).
// „Verse 2“, „2. strofa“, „STROFA II“, „Ref.“, „R:“, „Pre-chorus“… → „Strofa 2“, „Refren“, „Pre-refren“ (ili engleski).
import { getLang } from './i18n.js';

const NAMES = {
  sr: { intro: 'Uvod', verse: 'Strofa', pre: 'Pre-refren', chorus: 'Refren', bridge: 'Most', solo: 'Solo', instr: 'Instrumental', outro: 'Kraj' },
  en: { intro: 'Intro', verse: 'Verse', pre: 'Pre-chorus', chorus: 'Chorus', bridge: 'Bridge', solo: 'Solo', instr: 'Instrumental', outro: 'Outro' },
};
// redosled je bitan: „pre-refren“ pre „refren“
const KINDS = [
  ['pre', /^(pre[\s-]?(chorus|refren)|predrefren|pred[\s-]refren|prechorus)$/],
  ['intro', /^(intro|uvod|uvodni deo)$/],
  ['verse', /^(verse|strofa|kitica|stih|vers|s|v)$/],
  ['chorus', /^(chorus|refren|ref|r|pripev|refrain)$/],
  ['bridge', /^(bridge|most|middle 8|middle eight)$/],
  ['solo', /^(solo|gitarski solo|guitar solo)$/],
  ['instr', /^(instrumental|instrumentalni deo|instr|interlude|međuigra|medjuigra)$/],
  ['outro', /^(outro|kraj|coda|koda|završetak|zavrsetak|end|ending)$/],
];
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

/** Prepoznaj vrstu i broj ({ kind, n } ili null). */
export function parseSection(raw) {
  let s = String(raw || '').trim().toLocaleLowerCase('sr').replace(/[.:)\]]+$/g, '').replace(/^[(\[]+/, '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 30) return null;
  let n = 0;
  // „2. strofa“, „2 strofa“
  let m = /^(\d{1,2})\.?\s*(.+)$/.exec(s);
  if (m) { n = +m[1]; s = m[2]; }
  // „strofa 2“, „verse 2:“, „strofa ii“, „ref2“
  m = /^(.*?)[\s.-]*(\d{1,2}|i{1,3}|iv|vi{0,3}|ix|x)$/.exec(s);
  if (m && m[1] && (/\d/.test(m[2]) || /\s/.test(s))) { const k = m[1].replace(/[.\s-]+$/, ''); if (KINDS.some(([, re]) => re.test(k))) { s = k; n = /\d/.test(m[2]) ? +m[2] : ROMAN[m[2]] || n; } }
  s = s.replace(/[.\s]+$/, '');
  for (const [kind, re] of KINDS) if (re.test(s)) return { kind, n };
  return null;
}

/** Naziv dela za prikaz, na jeziku aplikacije (nepoznat naziv ostaje kakav jeste). */
export function sectionLabel(raw, lang = getLang()) {
  const p = parseSection(raw);
  if (!p) return String(raw || '');
  const name = (NAMES[lang] || NAMES.sr)[p.kind];
  return p.n ? `${name} ${p.n}` : name;
}
