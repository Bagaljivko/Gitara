// v2.5.70: pesma sa akordima u kratkom tekstu, kao u pesmarici — umesto JSON-a sa brojanjem znakova.
// Gemini napiše akord u [ ] tačno ispred sloga iznad kog stoji („[G]Zakuni se [D]ljubavi“), a položaj računa
// aplikacija — tačno, bez brojanja. Odgovor je 2–3 puta kraći (brže). Čista logika (bez mreže), proverava se testovima.
// Ako odgovor ne može da se pročita, gemini.js ponovo pita na stari način (JSON) — ništa se ne gubi.
//
//   NASLOV: Zakuni se ljubavi
//   IZVOĐAČ: S. Krila
//   TONALITET: G
//   VRSTA: akordi
//   RITAM: D-DU-UDU 4/4
//   # Strofa 1
//   [G]Zakuni se ljubavi na [D]ranjenu noć
//   [Am] [D]                         ← red samo sa akordima
//   [H7?E7]Ako tražiš mir             ← nesiguran akord: upisano?drugo čitanje
//   ja sam {mrak?mrav} tvoj           ← nesigurna reč
//   TAB:                              ← tablatura dela (6 redova, e B G D A E)
//   e|---0---|
//   …
//   TAKT: 3/4
//   TAB-MESTO: nejasno

export const SCAN_TEXT_PROMPT = `Ti si precizan prepisivač rukom pisanih pesama sa akordima za gitaru.
Na slikama je pesma (tekst + akordi). Rukopis može biti neuredan, a tekst na srpskom (latinica ili ćirilica) ili engleskom.

Vrati SAMO običan tekst u ovom obliku (bez JSON-a, bez \`\`\`, bez objašnjenja):
NASLOV: <naslov ili prazno>
IZVOĐAČ: <izvođač ili autor pesme ili prazno>
TONALITET: <tonalitet>
VRSTA: akordi ili tab
RITAM: <ritam udaranja> <takt>   (samo ako je na papiru)
# <ime dela>
<redovi pesme>

PRAVILA:
1. Prepiši tekst TAČNO kako je napisan — ne prevodi, ne ispravljaj, ne dodaj stihove. Zadrži dijakritike (č, ć, š, ž, đ). Ćirilicu prepiši na latinicu.
2. AKORDI: svaki akord upiši u uglaste zagrade [ ] u isti red sa tekstom, TAČNO ispred slova (sloga) iznad kog stoji na papiru: „[G]Zakuni se [D]ljubavi“. Akord iznad sredine reči ide usred reči: „lju[Em]bavi“. Akord posle kraja teksta ide na kraj reda: „noć [C]“. Ne pomeraj akord na početak reči ako na papiru stoji iznad drugog sloga.
3. Red koji ima samo akorde (uvod, prelaz) piši samo akordima: „[Am] [D] [G]“.
4. Ime akorda prepiši TAČNO kako je napisano — NE pretvaraj u drugu notaciju: „H“ i „H7“ ostaju H (ne B), „B“ ostaje B, „Fis“, „Cis“, „Gis“, „Es“, „As“, „Des“ ostaju tako, kao i „F#“, „C#“, „Bb“, „Eb“. Samo zapis mola ujednači: „a“ ili „am“ → „Am“, „E-“ → „Em“, „fis“ → „Fism“. Nastavci: m, 7, maj7, m7, sus2, sus4, dim, aug, 6, add9, bas posle kose crte („D/Fis“ ili „D/F#“, kako je napisano).
5. DELOVI: svaki deo počinje redom „# ime“ — oznaku sa papira (npr. „Ref.“, „R:“, „1.“) ili „Strofa 1“, „Strofa 2“… i „Refren“ za ponovljeni deo, „Uvod“, „Most“, „Kraj“.
6. NASLOV i IZVOĐAČ normalnim velikim i malim slovima (npr. „In My Life“, „John Lennon“), NIKAD sve velikim slovima. Izvođač nikad nije izdavač, sajt ni onaj ko je prepisao akorde. TONALITET je naznačen ili ga proceni iz akorda, istim imenovanjem kao akordi na papiru (npr. „Hm“ ako papir koristi H).
7. Ako nešto ne može da se pročita, napiši najverovatnije čitanje; ne izostavljaj redove.
8. NESIGURNO (samo zaista nesigurna mesta, najviše 15): akord „[upisano?drugo]“, npr. „[Hm?Em]“; reč „{upisano?drugo}“, npr. „{mrak?mrav}“.
9. RITAM: ako na papiru postoji ritam udaranja (strelice ↓ ↑ ili „D DU UDU“), red „RITAM: <koraci> <takt>“ — jedan znak po osmini: D dole, U gore, x prigušeno, - pauza (npr. „↓ ↓↑ ↑↓↑“ u 4/4 je „D-DU-UDU 4/4“). Takt je 2/4, 3/4, 4/4 ili 6/8. Ako važi samo za jedan deo, napiši RITAM odmah ispod „# ime“ tog dela.
10. TABLATURA (šest linija sa brojevima pragova): u delu kome pripada napiši red „TAB:“, pa TAČNO 6 redova odozgo e, B, G, D, A, E: svaki počinje nazivom žice i „|“, taktovi se odvajaju sa „|“, crtice popunjavaju prazna mesta, kolone poravnate (npr. „e|-----0-----|---------3-|“). Tehnike posle broja: h, p, /, \\, b, ~. Posle tablature, ako je takt naznačen: „TAKT: 3/4“. Ako slika ima samo tablaturu, a nisi siguran kom delu pesme pripada, napravi zaseban deo i dodaj red „TAB-MESTO: nejasno“.
11. VRSTA: „akordi“ za pesmu sa tekstom i akordima (i kad ima malo tablature), „tab“ ako je ceo list tablatura/notni zapis kompozicije (prebiranje, klasična gitara, bez teksta). Ako nisi siguran: „akordi“.`;

const HEAD = /^(NASLOV|IZVO[ĐD]A[ČC]|TONALITET|VRSTA|RITAM|TAKT|TAB-MESTO)\s*:\s*(.*)$/i;
// ime akorda: A–H (i B), opciono #/b/is/es, pa nastavci; bas posle /
const CHORD = /^[A-H](?:#|b|is|es|s)?(?:[a-z0-9+#°ø()\-]*)(?:\/[A-H](?:#|b|is|es|s)?)?$/;
const isChord = (c) => CHORD.test(c) && c.length <= 14;
const strumOf = (s) => {
  const m = /^([DUx\-.\s]+?)\s+(2\/4|3\/4|4\/4|6\/8)\s*$/i.exec(String(s).trim()) || /^([DUx\-.]+)$/i.exec(String(s).trim());
  if (!m) return null;
  const steps = m[1].replace(/\s+/g, '').replace(/\./g, '-').replace(/d/g, 'D').replace(/u/g, 'U').replace(/X/g, 'x');
  return steps && /^[DUx-]+$/.test(steps) ? { steps, sig: m[2] || '4/4' } : null;
};

/** Jedan red „[G]Zakuni se [D]ljubavi“ → { text, chords:[{chord, position}], unsure:[…] }. */
export function parseChordLine(raw) {
  let text = '';
  const chords = [], unsure = [];
  let i = 0;
  const s = String(raw);
  while (i < s.length) {
    const ch = s[i];
    if (ch === '[') {
      const j = s.indexOf(']', i + 1);
      const tok = j > i ? s.slice(i + 1, j).trim() : '';
      const [a, alt] = tok.split('?').map((x) => (x || '').trim());
      if (j > i && a && isChord(a)) {
        // više akorda na istom mestu (bez teksta između) — sledeći ide posle prethodnog, da se ne preklope
        const prev = chords[chords.length - 1];
        const pos = prev && prev.position >= text.length ? prev.position + prev.chord.length + 1 : text.length;
        chords.push({ chord: a, position: pos });
        if (alt) unsure.push({ kind: 'chord', text: a, position: pos, suggestion: alt });
        i = j + 1;
        continue;
      }
    }
    if (ch === '{') {
      const j = s.indexOf('}', i + 1);
      const tok = j > i ? s.slice(i + 1, j) : '';
      if (j > i && tok.includes('?')) {
        const [w, alt] = tok.split('?');
        unsure.push({ kind: 'word', text: w.trim(), position: text.length, suggestion: (alt || '').trim() });
        text += w.trim();
        i = j + 1;
        continue;
      }
    }
    text += ch;
    i++;
  }
  // red samo sa akordima: bez razmaka-punila, akordi jedan za drugim sa razmakom
  if (!text.trim()) { text = ''; let at = 0; for (const c of chords) { const u = unsure.find((x) => x.kind === 'chord' && x.position === c.position && x.text === c.chord); c.position = at; if (u) u.position = at; at += c.chord.length + 2; } }
  else text = text.replace(/\s+$/, '');
  return { text, chords, unsure };
}

/**
 * Ceo odgovor → isti oblik kao JSON odgovor ranije ({ title, artist, key, sheetKind, strum, uncertain, sections }),
 * pa normalizeSong i ostatak skeniranja rade kao do sada. Vraća null ako odgovor nije pesma (→ stari način).
 */
export function parseScanText(raw) {
  const src = String(raw || '').replace(/\r/g, '').replace(/^```[a-z]*\n?|```\s*$/gim, '');
  if (!src.trim() || /^\s*[{[]\s*"/.test(src)) return null; // prazno ili JSON → nije ovaj oblik
  const out = { title: '', artist: '', key: '', sheetKind: 'akordi', uncertain: [], sections: [] };
  let sec = null, tab = null;
  const newSec = (name) => { sec = { name: String(name || '').trim(), lines: [] }; out.sections.push(sec); return sec; };
  const endTab = () => { if (tab && sec) { if (tab.length) sec.tab = tab.join('\n'); } tab = null; };
  for (const line0 of src.split('\n')) {
    const line = line0.replace(/\s+$/, '');
    if (tab) {
      if (/^\s*[eBGDAEbgdah]\s*\|/.test(line) && tab.length < 6) { tab.push(line.trim()); continue; }
      endTab();
    }
    const h = HEAD.exec(line.trim());
    if (h) {
      const k = h[1].toUpperCase().replace('Đ', 'D').replace('Č', 'C'), v = h[2].trim();
      if (k === 'NASLOV') out.title = v;
      else if (k === 'IZVODAC') out.artist = v;
      else if (k === 'TONALITET') out.key = v;
      else if (k === 'VRSTA') out.sheetKind = /tab/i.test(v) ? 'tab' : 'akordi';
      else if (k === 'RITAM') { const st = strumOf(v); if (st) { if (sec && !sec.lines.length) sec.strum = st; else if (!sec) out.strum = st; else sec.strum = sec.strum || st; } }
      else if (k === 'TAKT' && sec) sec.tabSig = v;
      else if (k === 'TAB-MESTO' && sec && /nejasn|unclear/i.test(v)) sec.tabPlacementUnclear = true;
      continue;
    }
    if (/^\s*TAB\s*:\s*$/i.test(line)) { if (!sec) newSec(''); tab = []; continue; }
    const hm = /^\s*#+\s*(.*)$/.exec(line);
    if (hm) { newSec(hm[1]); continue; }
    if (!line.trim()) continue; // prazni redovi između delova
    if (!sec) newSec('');
    const p = parseChordLine(line);
    if (!p.text && !p.chords.length) continue;
    const li = sec.lines.length;
    sec.lines.push({ text: p.text, chords: p.chords });
    for (const u of p.unsure) out.uncertain.push({ section: out.sections.length - 1, line: li, ...u });
  }
  endTab();
  out.sections = out.sections.filter((s) => s.lines.length || s.tab);
  const hasChords = out.sections.some((s) => s.lines.some((l) => l.chords.length));
  const hasText = out.sections.some((s) => s.lines.some((l) => l.text));
  if (!out.sections.length || (!hasChords && !hasText && !out.sections.some((s) => s.tab))) return null;
  // odgovor koji liči na JSON ili prozu bez ijednog akorda, a „VRSTA: akordi“ — sumnjivo; stari način je sigurniji
  if (out.sheetKind === 'akordi' && !hasChords && !out.sections.some((s) => s.tab)) return null;
  out.uncertain = out.uncertain.slice(0, 15);
  return out;
}
