// TAB list u kratkom tekstu (umesto velikog JSON-a): Gemini samo prepiše brojeve iz tablature, kolonu po kolonu,
// a ritam izračuna aplikacija. To je lak zadatak (čitanje brojeva) i odgovor je ~10 puta kraći — brže i bez
// „zaglavljivanja“. Čista logika (bez mreže), proverava se testovima.
//
//   NASLOV: Romance D'Amour
//   KOMPOZITOR: Anonymous
//   TAKT: 3/4
//   TONALITET: Em
//   TEMPO: 0
//   PRVI: 1
//   BROJ: 16
//   T1: 6/0+1/7^4 2/0 3/0 1/7 2/0 3/0 1/7 2/0 3/0
//   T7: 5/0+1/8 2/5 3/5 1/7 2/5 3/5 1/5 2/5 3/5 [1/2 BV]
//   T16: 6/0+3/0+2/0+1/0 [:|]
//
// Kolona = note koje se sviraju zajedno (žica/prag, „+“ između njih), ^k = prst leve ruke, *d = trajanje kolone u
// četvrtinama (samo kad takt nije ravnomeran). Oznake u [ ]: |: :| V1 V2 barre (BV, BVII, 1/2 BV…) TAKT=… TON=… ?

export const TAB_TEXT_PROMPT = `Ti si precizan prepisivač gitarskih tablatura. Na slici je list sa notnim sistemom i tablaturom (šest linija sa brojevima pragova). Prepiši SAMO brojeve iz tablature — notni sistem ne treba da čitaš.

Vrati ISKLJUČIVO običan tekst (ne JSON, bez objašnjenja), ovim redom:
NASLOV: naslov kompozicije, normalnim velikim i malim slovima (npr. In My Life), nikad sve velikim slovima
KOMPOZITOR: kompozitor tačno kako je odštampan (npr. "Anonymous", "Trad.", "F. Tárrega"); NIKAD izdavač, sajt, aranžer ni onaj ko je prepisao; ako ga nema, ostavi prazno
TAKT: takt na početku (npr. 3/4)
TONALITET: tonalitet na početku (npr. Em)
TEMPO: broj uz četvrtinu ako je odštampan, inače 0
PRVI: broj prvog takta na ovoj strani
BROJ: koliko taktova ima na ovoj strani (prebroj sve redove do kraja strane)
zatim JEDAN RED PO TAKTU, redom, bez preskakanja:
T<broj takta>: kolone

PRAVILA ZA KOLONE:
1. Kolona = brojevi koji stoje jedan iznad drugog (sviraju se zajedno), redom sleva nadesno.
2. Svaki broj piši kao žica/prag. Žica 1 = gornja linija tablature (tanka e), žica 6 = donja linija (debela E). Brojeve iz iste kolone spoji znakom „+“, npr. 6/0+1/7. Kolone razdvoji razmakom.
3. Prst leve ruke (mali broj 1–4 odštampan uz notu) dodaj kao ^broj: 1/7^4. Slova p, i, m, a ignoriši.
4. Ako kolone u taktu NISU ravnomerno raspoređene u vremenu (npr. četvrtina pa dve osmine), posle svake kolone dodaj trajanje u četvrtinama: *1, *0.5, *2. Ako su ravnomerne (najčešće), NE dodaj ništa.
5. Na kraj reda, u uglastim zagradama, samo ono što postoji: |: (početak ponavljanja), :| (kraj ponavljanja), V1 ili V2 (prva/druga volta), barre tačno kako piše (npr. BVII ili 1/2 BV — i u svakom taktu dokle se proteže crta), TAKT=6/8 (promena takta), TON=E (promena tonaliteta), ? (ako takt nisi mogao pouzdano da pročitaš). Primer: T9: 5/2+1/7 2/7 3/8 [BVII]
6. Ne izmišljaj note koje ne vidiš; ne prepisuj ništa drugo (izdavač, broj strane, reklame).`;

export const TAB_TEXT_PAGE = (i, n, firstExpected) => `\n\nSTRANA ${i} od ${n}. Ako na strani nema odštampanog broja prvog takta, PRVI je ${firstExpected}.`;
export const TAB_TEXT_BARS = (list) => `\n\nPAŽLJIVO PONOVO PROČITAJ SAMO TAKTOVE ${list.join(', ')} sa ove strane (po jedan red T<broj>: …, broj po broj, kolonu po kolonu); zaglavlje (NASLOV…BROJ) ipak napiši.`;
export const TAB_TEXT_RANGE = (a, b) => `\n\nPREPIŠI SAMO TAKTOVE ${a}–${b} sa ove strane (redovi T${a} … T${b}); zaglavlje (NASLOV…BROJ) ipak napiši.`;

const sigBeats = (sig) => { const m = /^(\d{1,2})\/(\d{1,2})$/.exec(String(sig || '').trim()); return m ? (Number(m[1]) * 4) / Number(m[2]) : 3; };
const r3 = (x) => Math.round(x * 1000) / 1000;
// 0,333 + 0,333 + 0,333 = 0,999 → 1 (triole i šesnaestine na tačnu mrežu)
const grid = (x) => { for (const d of [12, 16]) { const r = Math.round(x * d) / d; if (Math.abs(r - x) < 0.004) return r3(r); } return r3(x); };

/** Jedna kolona „6/0+1/7^4*0.5“ → { notes: [{s,f,finger}], dur } ili null. */
function parseColumn(tok) {
  let dur = null;
  const dm = /\*(\d+(?:[.,]\d+)?)$/.exec(tok);
  if (dm) { dur = Number(dm[1].replace(',', '.')); tok = tok.slice(0, dm.index); }
  const notes = [];
  for (const part of tok.split('+')) {
    const m = /^([1-6])\/(\d{1,2})(?:\^([1-4]))?$/.exec(part.trim());
    if (!m) return null;
    const f = Number(m[2]);
    if (f > 24) return null;
    notes.push({ s: Number(m[1]), f, ...(m[3] ? { finger: Number(m[3]) } : {}) });
  }
  return notes.length ? { notes, dur: dur > 0 && dur <= 16 ? dur : null } : null;
}

/** Oznake iz [ … ] → polja takta (i da li je nesiguran). */
function parseMarks(str) {
  const o = {};
  for (let m of String(str || '').split(/[\s,;]+/).filter(Boolean)) {
    if (m === '|:') o.repeatStart = true;
    else if (m === ':|') { o.repeatEnd = true; o.times = 2; }
    else if (m === '|:|' || m === ':|:') { o.repeatStart = true; o.repeatEnd = true; o.times = 2; }
    else if (/^V[12]$/i.test(m)) o.ending = Number(m[1]);
    else if (/^TAKT=\d{1,2}\/\d{1,2}$/i.test(m)) o.sig = m.slice(5);
    else if (/^TON=[A-H][#b]?m?$/i.test(m)) o.key = m.slice(4);
    else if (m === '?') o.unsure = true;
  }
  // barre: „BVII“, „CII“, „1/2 BV“, „½ CV“ (oznaka može imati razmak)
  const bm = /((?:1\/2|½)\s*)?([BC])(X{0,1}(?:IX|IV|V?I{0,3})|\d{1,2})\b/.exec(String(str || ''));
  if (bm && bm[3]) {
    const roman = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
    const fret = /^\d+$/.test(bm[3]) ? Number(bm[3]) : roman[bm[3]];
    if (fret >= 1 && fret <= 19) o.barre = [{ label: bm[0].trim(), fret, ...(bm[1] ? { half: true } : {}) }];
  }
  return o;
}

/**
 * Tekst odgovora → isti oblik kao JSON čitanje ({ title, composer, key, sig, bpm, firstBar, pageBars, bars, unsure }),
 * ili null ako nema nijednog takta. Ritam: kolone ravnomerno kroz takt (osim kad su trajanja data), a svaka nota
 * zvuči do sledeće note na istoj žici ili do kraja takta (kao na gitari). truncated: poslednji red se odbacuje
 * (odgovor je presečen).
 */
export function parseTabText(text, { truncated = false, loop = false } = {}) {
  if (typeof text !== 'string' || text.length > 200000) return null;
  const lines = text.replace(/```[a-z]*|```/g, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (truncated && lines.length) lines.pop();
  const head = (k) => { const l = lines.find((x) => x.toUpperCase().startsWith(k + ':')); return l ? l.slice(k.length + 1).trim().replace(/^["„“]|["“”]$/g, '') : ''; };
  const out = { title: head('NASLOV'), composer: head('KOMPOZITOR'), sig: head('TAKT'), key: head('TONALITET'), bpm: Number(head('TEMPO')) || 0, bars: [], unsure: [] };
  const first = parseInt(head('PRVI'), 10), count = parseInt(head('BROJ'), 10);
  if (first > 0) out.firstBar = first;
  if (count > 0 && count <= 80) out.pageBars = count;
  if (!/^\d{1,2}\/\d{1,2}$/.test(out.sig)) out.sig = '';
  if (!/^[A-H][#b]?m?$/.test(out.key)) out.key = '';
  let sig = out.sig || '3/4';
  const seen = new Set();
  for (const l of lines) {
    const m = /^T\s*(\d{1,3})\s*[:.]\s*(.*)$/i.exec(l);
    if (!m) continue;
    const n = Number(m[1]);
    if (seen.has(n)) { if (loop) break; continue; } // isti takt dvaput (odgovor se vrteo u krug): važi prvi
    seen.add(n);
    let body = m[2];
    const markStr = (body.match(/\[([^\]]*)\]/g) || []).map((x) => x.slice(1, -1)).join(' ');
    body = body.replace(/\[[^\]]*\]/g, ' ').trim();
    const marks = parseMarks(markStr);
    if (marks.sig) sig = marks.sig;
    const cols = [];
    let bad = false;
    let clash = false;
    for (const tok of body.split(/\s+/).filter(Boolean)) {
      const c = parseColumn(tok);
      if (!c) { bad = true; continue; }
      // dve note na istoj žici u istoj koloni ne mogu da se sviraju: zadrži prvu, takt je za proveru
      const on = new Set();
      c.notes = c.notes.filter((x) => (on.has(x.s) ? ((clash = true), false) : (on.add(x.s), true)));
      cols.push(c);
    }
    if (!cols.length) continue;
    // vreme: data trajanja, ostatak takta ravnomerno na kolone bez trajanja
    const total = sigBeats(sig);
    const given = cols.reduce((a, c) => a + (c.dur || 0), 0), free = cols.filter((c) => !c.dur).length;
    // data trajanja ne staju u takt → ponovo pročitati; takt koji nije pun (pauza, predtakt ili pogrešno pročitano)
    // samo dobija napomenu „proveri“ (bez dodatnog zahteva)
    const offBeat = given > total + 0.01, short = !free && given < total - 0.01;
    const each = free ? Math.max(0, total - given) / free : 0;
    let tpos = 0;
    const notes = [];
    cols.forEach((c) => { const d = c.dur || each || total / cols.length; for (const x of c.notes) notes.push({ ...x, start: grid(tpos) }); tpos += d; });
    // trajanje: do sledeće note na istoj žici, ili do kraja takta
    const end = Math.max(total, grid(tpos));
    for (const x of notes) {
      const nextOn = notes.filter((y) => y.s === x.s && y.start > x.start).map((y) => y.start);
      x.len = r3((nextOn.length ? Math.min(...nextOn) : end) - x.start);
    }
    const bar = { n, notes, ...(marks.repeatStart ? { repeatStart: true } : {}), ...(marks.repeatEnd ? { repeatEnd: true, times: 2 } : {}),
      ...(marks.ending ? { ending: marks.ending } : {}), ...(marks.barre ? { barre: marks.barre } : {}), ...(marks.sig ? { sig: marks.sig } : {}), ...(marks.key ? { key: marks.key } : {}) };
    out.bars.push(bar);
    const why = bad ? 'neki brojevi nisu jasni' : clash ? 'dve note na istoj žici' : offBeat ? 'trajanja ne odgovaraju taktu' : marks.unsure ? 'Gemini nije bio siguran' : '';
    if (why) { bar.doubt = why; out.unsure.push({ bar: n, why }); }
    else if (short) out.unsure.push({ bar: n, why: 'takt nije pun — proveri trajanja' });
  }
  return out.bars.length ? out : null;
}
