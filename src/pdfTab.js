// Uvoz PDF-a bez AI: PDF iz programa za note (MuseScore, Guitar Pro, LilyPond, sajtovi sa tablaturama, „Skini PDF“
// iz ove aplikacije) sadrži brojeve pragova kao TEKST sa tačnim položajem i linije kao crteže. Odatle se čita:
// šest linija tablature, taktne crte, ponavljanja, broj na kojoj žici i gde, barre oznake, naslov i kompozitor —
// pa se svaki takt zapiše u istom kratkom obliku koji daje i Gemini („T7: 5/0+1/8 2/5 …“) i dalje ide istim putem.
// PDF sa akordima i tekstom → tekst sa razmacima (isti uvoz kao nalepljen tekst). Skeniran PDF (samo slike) → null,
// pa se strane šalju na obično skeniranje.
// readPdf koristi pdf.js (učitava se tek kad korisnik izabere PDF); ostalo je čista logika (testovi u Node-u).

const PDFJS = () => new URL('../vendor/pdfjs/pdf.min.mjs', import.meta.url).href;
const WORKER = () => new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
let pdfjsP = null;
export function loadPdfjs() {
  if (!pdfjsP) pdfjsP = import(PDFJS()).then((m) => { m.GlobalWorkerOptions.workerSrc = WORKER(); return m; }).catch((e) => { pdfjsP = null; throw e; });
  return pdfjsP;
}

const MAX_PAGES = 12;
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const app = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/**
 * PDF (ArrayBuffer/Uint8Array) → { doc, pages: [{ w, h, items: [{ str, x, y, w, size }], segs: [{ x0, y0, x1, y1 }], dots: [{ x, y }] }] }.
 * Koordinate su u tačkama strane, y raste naniže; x/y teksta je početak osnovne linije.
 */
const rgbOf = (a) => {
  if (typeof a[0] === 'string') { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(a[0]); return m ? [1, 2, 3].map((k) => parseInt(m[k], 16)) : null; }
  const v = [a[0], a[1], a[2]].map(Number); return v.some((x) => x > 1) ? v : v.map((x) => x * 255);
};
/**
 * v2.4.37: tekst koji je posle nacrtan prekriven svetlim (pozadinskim) pravougaonikom se izbacuje. Stavke teksta se vežu
 * za naredbe crtanja redom (showText ↔ stavka), pa se zna šta je nacrtano pre zakrpe.
 */
export function hideCovered(items, shows, fills) {
  const light = fills.filter((f) => f.rgb && f.rgb.every((x) => x >= 225) && f.x1 - f.x0 > 4 && f.y1 - f.y0 > 4);
  if (!light.length || !shows.length) return items;
  const nz = (x) => String(x || '').replace(/\s+/g, '');
  let j = 0, rem = nz(shows[0].s);
  for (const it of items) {
    const t = nz(it.str); if (!t) continue;
    let k = j, r = rem, ok = false;
    for (let g = 0; g < 40 && k < shows.length; g++) {
      if (r.startsWith(t)) { ok = true; break; }
      k++; r = k < shows.length ? nz(shows[k].s) : '';
    }
    if (!ok) continue; // ne zna se — stavka ostaje
    it.op = shows[k].i; j = k; rem = r.slice(t.length);
    if (!rem) { j++; rem = j < shows.length ? nz(shows[j].s) : ''; }
  }
  return items.filter((it) => {
    if (it.op === undefined) return true;
    const cx = it.x + (it.w || 0) / 2, cy = it.y - it.size * 0.35;
    return !light.some((f) => f.i > it.op && cx >= f.x0 - 1 && cx <= f.x1 + 1 && cy >= f.y0 - 1 && cy <= f.y1 + 1);
  });
}
/** v2.4.37: tekst koji kasniji tekst prekriva (isto mesto) se izbacuje — vidi se samo onaj nacrtan poslednji. */
export function dropCovered(items) {
  const box = (it) => ({ x0: it.x, x1: it.x + (it.w || it.size * 0.5 * it.str.length), y0: it.y - it.size * 0.8, y1: it.y + it.size * 0.2 });
  const keep = items.map(() => true), B = items.map(box);
  for (let j = 1; j < items.length; j++) {
    const b = B[j];
    for (let i = 0; i < j; i++) {
      if (!keep[i]) continue;
      const a = B[i], ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ix > 0 && iy > 0 && ix * iy > 0.3 * Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0))) keep[i] = false;
    }
  }
  let k = 0; for (let i = 0; i < items.length; i++) if (keep[i]) items[k++] = items[i];
  items.length = k;
  return items;
}
export async function readPdf(data, pdfjs = null) {
  const lib = pdfjs || (await loadPdfjs());
  const doc = await lib.getDocument({ data, verbosity: 0, isEvalSupported: false }).promise;
  const OPS = lib.OPS, pages = [];
  for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGES); p++) {
    const page = await doc.getPage(p), vp = page.getViewport({ scale: 1 });
    const V = vp.transform;
    const tc = await page.getTextContent();
    let items = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const [x, y] = app(V, it.transform[4], it.transform[5]);
      const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      items.push({ str: it.str, x, y, w: it.width * Math.abs(V[0] || V[1] || 1), size });
    }
    const ol = await page.getOperatorList();
    const segs = [], dots = [];
    // v2.4.37: tekst koji je kasnije prekriven svetlim pravougaonikom (izmenjen list: stari tekst ispod zakrpe) se ne vidi
    const shows = [], fills = []; let fillRGB = null, lastRects = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i], a = ol.argsArray[i];
      if (fn === OPS.showText) shows.push({ i, s: (a[0] || []).map((g) => (g && typeof g === 'object' ? g.unicode || '' : '')).join('') });
      else if (fn === OPS.setFillRGBColor) fillRGB = rgbOf(a);
      else if (fn === OPS.setFillGray) fillRGB = [a[0] * 255, a[0] * 255, a[0] * 255];
      else if (fn === OPS.fill || fn === OPS.eoFill || fn === OPS.fillStroke || fn === OPS.eoFillStroke) { for (const r of lastRects) fills.push({ ...r, i, rgb: fillRGB }); lastRects = []; }
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.transform) ctm = mul(ctm, a);
      else if (fn === OPS.constructPath) {
        const M = mul(V, ctm), sub = a[0], c = a[1];
        lastRects = [];
        let k = 0, cx = 0, cy = 0, sx = 0, sy = 0, curve = false;
        const pts = [];
        const line = (x0, y0, x1, y1) => { const [X0, Y0] = app(M, x0, y0), [X1, Y1] = app(M, x1, y1); segs.push({ x0: X0, y0: Y0, x1: X1, y1: Y1 }); };
        for (const op of sub) {
          if (op === OPS.moveTo) { cx = sx = c[k++]; cy = sy = c[k++]; pts.push([cx, cy]); }
          else if (op === OPS.lineTo) { const x = c[k++], y = c[k++]; line(cx, cy, x, y); cx = x; cy = y; pts.push([cx, cy]); }
          else if (op === OPS.curveTo) { pts.push([c[k], c[k + 1]], [c[k + 2], c[k + 3]]); cx = c[k + 4]; cy = c[k + 5]; k += 6; curve = true; pts.push([cx, cy]); }
          else if (op === OPS.curveTo2 || op === OPS.curveTo3) { pts.push([c[k], c[k + 1]]); cx = c[k + 2]; cy = c[k + 3]; k += 4; curve = true; pts.push([cx, cy]); }
          else if (op === OPS.closePath) { if (cx !== sx || cy !== sy) line(cx, cy, sx, sy); cx = sx; cy = sy; }
          else if (op === OPS.rectangle) {
            const x = c[k++], y = c[k++], w = c[k++], h = c[k++];
            const [X0, Y0] = app(M, x, y), [X1, Y1] = app(M, x + w, y + h);
            const bw = Math.abs(X1 - X0), bh = Math.abs(Y1 - Y0);
            lastRects.push({ x0: Math.min(X0, X1), x1: Math.max(X0, X1), y0: Math.min(Y0, Y1), y1: Math.max(Y0, Y1) });
            if (bh <= 2.5 && bw > bh) segs.push({ x0: Math.min(X0, X1), y0: (Y0 + Y1) / 2, x1: Math.max(X0, X1), y1: (Y0 + Y1) / 2 });
            else if (bw <= 4 && bh > bw) segs.push({ x0: (X0 + X1) / 2, y0: Math.min(Y0, Y1), x1: (X0 + X1) / 2, y1: Math.max(Y0, Y1) });
            else if (bw <= 4.5 && bh <= 4.5) dots.push({ x: (X0 + X1) / 2, y: (Y0 + Y1) / 2 });
          }
        }
        if (curve && pts.length) { // mali zaokružen oblik (tačka ponavljanja)
          const P = pts.map(([x, y]) => app(M, x, y)), xs = P.map((q) => q[0]), ys = P.map((q) => q[1]);
          const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
          if (bw <= 4.5 && bh <= 4.5 && bw > 0.8) dots.push({ x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 });
        }
      }
    }
    // v2.4.36: linkovi (npr. YouTube lekcija) — klikabilne oblasti na strani
    const links = [];
    try { for (const a of await page.getAnnotations()) { const u = a && (a.url || a.unsafeUrl); if (u && a.rect) { const [x, y] = app(V, (a.rect[0] + a.rect[2]) / 2, (a.rect[1] + a.rect[3]) / 2); links.push({ url: String(u), x, y }); } } } catch {}
    items = hideCovered(items, shows, fills);
    dropCovered(items); // i bez zakrpe: tekst preko teksta na istom mestu — ostaje kasniji
    pages.push({ w: vp.width, h: vp.height, items, segs, dots, links });
    page.cleanup();
  }
  return { doc, pages, numPages: doc.numPages };
}

// ---------------- Tablatura ----------------
const med = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

/** Horizontalne linije (spojeni delovi) jedne strane. */
function hLines(segs) {
  const hs = segs.filter((s) => Math.abs(s.y0 - s.y1) < 0.6 && Math.abs(s.x1 - s.x0) > 4)
    .map((s) => ({ y: (s.y0 + s.y1) / 2, x0: Math.min(s.x0, s.x1), x1: Math.max(s.x0, s.x1) }))
    .sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const out = [];
  for (const s of hs) {
    // isti y i nastavak (programi prekidaju liniju oko brojeva) → jedna linija
    const l = out.find((o) => Math.abs(o.y - s.y) < 0.5 && s.x0 <= o.x1 + 14 && s.x1 >= o.x0 - 14);
    if (l) { l.x0 = Math.min(l.x0, s.x0); l.x1 = Math.max(l.x1, s.x1); } else out.push({ ...s });
  }
  return out.filter((l) => l.x1 - l.x0 > 60);
}

/** Šest jednako razmaknutih linija iste širine = tablatura (pet = notni sistem, preskače se). */
export function findStaves(segs) {
  const lines = hLines(segs);
  const used = new Set(), staves = [];
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    const same = [i];
    for (let j = i + 1; j < lines.length; j++) if (!used.has(j) && Math.abs(lines[j].x0 - lines[i].x0) < 6 && Math.abs(lines[j].x1 - lines[i].x1) < 6) same.push(j);
    // nizovi sa jednakim razmakom
    let run = [same[0]];
    const flush = () => {
      const L = run.length;
      const take = L === 6 ? [run] : L === 11 ? [run.slice(5)] : L === 12 ? [run.slice(0, 6), run.slice(6)] : [];
      for (const r of take) {
        const ys = r.map((k) => lines[k].y), sp = (ys[5] - ys[0]) / 5;
        if (sp >= 2.5 && sp <= 25) { staves.push({ top: ys[0], sp, bottom: ys[5], x0: lines[r[0]].x0, x1: lines[r[0]].x1 }); r.forEach((k) => used.add(k)); }
      }
    };
    for (let q = 1; q < same.length; q++) {
      const a = lines[same[q - 1]], b = lines[same[q]], g = b.y - a.y;
      const g0 = run.length > 1 ? lines[run[1]].y - lines[run[0]].y : g;
      if (g > 1.5 && g < 30 && Math.abs(g - g0) <= Math.max(0.6, g0 * 0.12)) run.push(same[q]);
      else { flush(); run = [same[q]]; }
    }
    flush();
  }
  return staves.sort((a, b) => a.top - b.top);
}

/** Taktne crte jedne tablature: x položaji granica (spojene duple crte) i da li je dupla / sa tačkama. */
function barLines(st, segs, dots, glyphs = []) {
  const H = st.bottom - st.top;
  const xs = segs.filter((s) => Math.abs(s.x0 - s.x1) < 1 && Math.min(s.y0, s.y1) <= st.top + H * 0.15 && Math.max(s.y0, s.y1) >= st.bottom - H * 0.15
    && s.x0 >= st.x0 - 3 && s.x0 <= st.x1 + 3).map((s) => (s.x0 + s.x1) / 2).sort((a, b) => a - b);
  const groups = [];
  for (const x of xs) { const g = groups[groups.length - 1]; if (g && x - g.xs[g.xs.length - 1] < 7) g.xs.push(x); else groups.push({ xs: [x] }); }
  for (const g of groups) {
    g.l = Math.min(...g.xs); g.r = Math.max(...g.xs); g.x = (g.l + g.r) / 2;
    const near = g.xs.length >= 2 ? [...dots, ...glyphs].filter((d) => d.y > st.top + H * 0.15 && d.y < st.bottom - H * 0.15) : [];
    // ponavljanje = dve tačke jedna iznad druge, odmah levo ili desno od duple crte
    const two = (arr) => arr.length >= 2 && Math.max(...arr.map((d) => d.y)) - Math.min(...arr.map((d) => d.y)) > st.sp * 0.8;
    g.dotsL = two(near.filter((d) => d.x < g.l && d.x > g.l - 9));
    g.dotsR = two(near.filter((d) => d.x > g.r && d.x < g.r + 9));
  }
  // početak i kraj reda su uvek granice
  if (!groups.length || groups[0].x > st.x0 + 6) groups.unshift({ x: st.x0, l: st.x0, r: st.x0 });
  if (groups[groups.length - 1].x < st.x1 - 6) groups.push({ x: st.x1, l: st.x1, r: st.x1 });
  return groups;
}

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
const BARRE = /^(?:(1\/2|½)\s*)?([BC])\s*(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I|\d{1,2})\b/;
const r3 = (x) => Math.round(x * 1000) / 1000;
const SNAP = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1, 1.5, 2, 3, 4];

/** Brojevi u tekstu: „12“, „(7)“, „<12>“, i više brojeva u jednom komadu („0 2 2“). */
function fretTokens(it) {
  const s = it.str;
  if (!/^[\s\d()<>[\]]+$/.test(s) || !/\d/.test(s)) return [];
  const cw = it.w / Math.max(1, s.length), out = [];
  const re = /\d{1,2}/g;
  let m;
  while ((m = re.exec(s))) out.push({ f: Number(m[0]), x: it.x + cw * (m.index + m[0].length / 2), y: it.y, size: it.size, w: cw * m[0].length });
  return out;
}

/**
 * Taktovi ({ cols: [{ x, notes: [{ s, f }] }], end, mk: ['|:', ':|', 'BVII'] }) → tekst u obliku Gemini odgovora
 * (NASLOV… / T<n>: kolone [oznake]). Ritam: ravnomerno kad broj kolona ravnomerno deli takt (npr. 9 u 3/4),
 * po razmaku kad ne deli ili su razlike velike; mnogo praznog posle poslednje note = pauza do kraja takta.
 */
export function barsToText(bars, { title = '', composer = '', sig = '' } = {}) {
  if (!bars.some((b) => b.cols.length)) return null;
  const counts = bars.map((b) => b.cols.length).filter(Boolean);
  const mode = med(counts);
  if (!/^\d{1,2}\/\d{1,2}$/.test(sig)) sig = mode && mode % 3 === 0 && mode % 4 !== 0 ? '3/4' : '4/4';
  const [bn, bd] = sig.split('/').map(Number), total = (bn * 4) / bd;
  const snap = (q) => SNAP.reduce((best, v) => (Math.abs(v - q) < Math.abs(best - q) ? v : best), SNAP[0]);
  const uneven = [];
  const out = bars.map((b, i) => {
    const n = i + 1;
    const cells = b.cols.map((c) => c.notes.sort((p, q) => q.s - p.s).filter((x, k, arr) => !arr.slice(0, k).some((y) => y.s === x.s)).map((x) => `${x.s}/${x.f}`).join('+'));
    let body = cells;
    if (b.cols.length >= 2) {
      const gaps = b.cols.slice(1).map((c, k) => c.x - b.cols[k].x), ratio = Math.max(...gaps) / Math.min(...gaps), mg = med(gaps);
      // broj kolona koji ravnomerno deli takt → ravnomerno (programi za note pomeraju razmake zbog predznaka i sl.)
      const grid = [0.25, 1 / 3, 0.5, 1, 2, 3, 4].some((v) => Math.abs(total / b.cols.length - v) < 0.01);
      const tail = b.end - b.cols[b.cols.length - 1].x;
      if (tail > mg * 2.6 && ratio < 1.35) { // pauza do kraja takta
        const span = b.end - b.cols[0].x;
        body = cells.map((c, k) => `${c}*${r3(snap(((k + 1 < b.cols.length ? b.cols[k + 1].x - b.cols[k].x : mg) / span) * total))}`);
        uneven.push(n);
      } else if (grid ? ratio > 2.2 : ratio > 1.35) {
        const last = Math.min(mg, Math.max(0, tail)) || mg;
        const all = [...gaps, last], sum = all.reduce((p, q) => p + q, 0);
        body = cells.map((c, k) => `${c}*${r3(snap((all[k] / sum) * total))}`);
        uneven.push(n);
      }
    }
    return `T${n}: ${body.join(' ')}${b.mk.length ? ` [${b.mk.join(' ')}]` : ''}`;
  });
  const head = [`NASLOV: ${title}`, `KOMPOZITOR: ${composer}`, `TAKT: ${sig}`, 'TONALITET: ', 'TEMPO: 0', 'PRVI: 1', `BROJ: ${bars.length}`];
  return { text: [...head, ...out].join('\n'), bars: bars.length, title, composer, sig, uneven };
}

/** Strane sa nacrtanom tablaturom (šest linija) → barsToText(...) ili null. */
export function pdfToTabText(pages) {
  let title = '', composer = '', sig = '';
  const bars = [];
  pages.forEach((pg, pi) => {
    const staves = findStaves(pg.segs);
    if (!staves.length) return;
    if (pi === 0 || !title) {
      // naslov: najveći tekst iznad prve tablature; kompozitor: desno poravnat tekst ispod naslova
      const above = pg.items.filter((it) => it.y < staves[0].top - 20 && /\p{L}/u.test(it.str));
      const big = above.reduce((b, it) => (!b || it.size > b.size + 0.5 ? it : b), null);
      if (big && big.size >= 12) title = above.filter((it) => Math.abs(it.y - big.y) < 2 && Math.abs(it.size - big.size) < 1).sort((a, b) => a.x - b.x).map((it) => it.str.trim()).join(' ').replace(/\s+/g, ' ').trim();
      const right = above.filter((it) => it !== big && it.x + it.w > pg.w * 0.62 && it.x > pg.w * 0.45 && (!big || it.y > big.y) && it.size < (big ? big.size : 99));
      if (right.length) composer = right.sort((a, b) => a.y - b.y)[0].str.trim();
    }
    const digits = pg.items.flatMap(fretTokens);
    const glyphs = pg.items.filter((it) => it.str.trim().length === 1 && !/[\p{L}\d]/u.test(it.str)).map((it) => ({ x: it.x + it.w / Math.max(1, it.str.length) / 2, y: it.y - it.size * 0.15 }));
    const used = new Set();
    for (const st of staves) {
      // tačke ponavljanja kao znak iz notnog fonta (jedan znak koji nije slovo ni cifra), samo uz duplu crtu
      const groups = barLines(st, pg.segs, pg.dots, glyphs);
      const fretSize = med(digits.filter((d) => d.y > st.top - st.sp && d.y < st.bottom + st.sp && d.size < st.sp * 2.2).map((d) => d.size)) || st.sp * 1.2;
      if (!sig) { // takt na početku: veliki brojevi „3“ iznad „4“
        const bigD = digits.filter((d) => d.size > fretSize * 1.6 && d.x < groups[0].x + (groups[1] ? (groups[1].x - groups[0].x) * 0.4 : 40) && d.y > st.top - st.sp && d.y < st.bottom + st.sp * 2).sort((a, b) => a.y - b.y);
        if (bigD.length >= 2 && [2, 3, 4, 6, 9, 12].includes(bigD[0].f) && [2, 4, 8].includes(bigD[1].f)) sig = `${bigD[0].f}/${bigD[1].f}`;
      }
      const notes = [];
      for (const d of digits) {
        if (used.has(d) || d.size > fretSize * 1.6 || d.f > 24) continue;
        const cy = d.y - d.size * 0.35; // sredina cifre (x, y je osnovna linija)
        const idx = Math.round((cy - st.top) / st.sp);
        if (idx < 0 || idx > 5 || Math.abs(cy - (st.top + idx * st.sp)) > st.sp * 0.45 || d.x < st.x0 - 2 || d.x > st.x1 + 2) continue;
        used.add(d); notes.push({ s: idx + 1, f: d.f, x: d.x, w: d.w });
      }
      const marks = pg.items.filter((it) => BARRE.test(it.str.trim()) && it.y < st.top && it.y > st.top - st.sp * 12);
      const widths = [];
      for (let g = 0; g + 1 < groups.length; g++) if (notes.some((x) => x.x > groups[g].r && x.x < groups[g + 1].l)) widths.push(groups[g + 1].l - groups[g].r);
      const wMed = med(widths) || 100;
      for (let g = 0; g + 1 < groups.length; g++) {
        const a = groups[g], b = groups[g + 1];
        if (b.l - a.r < 8) continue;
        const inBar = notes.filter((x) => x.x > a.r && x.x < b.l);
        // prazno mesto bez nota (početak reda sa ključem, promena tonaliteta posle ponavljanja) nije takt;
        // prazan takt pune širine (pauza) jeste
        if (!inBar.length && b.l - a.r < wMed * 0.75) continue;
        const cols = [];
        for (const x of inBar.sort((p, q) => p.x - q.x)) {
          const c = cols[cols.length - 1];
          if (c && Math.abs(x.x - c.x) < Math.max(2.5, x.w * 0.9)) { c.notes.push(x); c.x = (c.x * (c.notes.length - 1) + x.x) / c.notes.length; }
          else cols.push({ x: x.x, notes: [x] });
        }
        const bm = marks.filter((it) => it.x >= a.r - 6 && it.x < b.l - 4).map((it) => it.str.trim().match(BARRE)[0].replace(/\s+/g, ' '));
        bars.push({ cols, end: b.l, mk: [a.dotsR ? '|:' : '', b.dotsL ? ':|' : '', ...bm.slice(0, 1)].filter(Boolean) });
      }
    }
  });
  return barsToText(bars, { title, composer, sig });
}

// ---------------- Tablatura kao tekst (e|--7--0--|) ----------------
const STR_ROW = /^\s*([eEbBhHgGdDaA])\s*\|(.*)$/;
/**
 * Tekst sa ASCII tablaturom (blokovi od 6 redova e| B| G| D| A| E|) → taktovi za barsToText ili [].
 * Položaj note u taktu = kolona znaka; više cifara = jedan prag; „|“ deli taktove; „:“ uz „|“ = ponavljanje.
 */
export function asciiTabBars(text) {
  const lines = String(text || '').split(/\r?\n/), bars = [];
  for (let i = 0; i + 5 < lines.length; i++) {
    const six = lines.slice(i, i + 6).map((l) => STR_ROW.exec(l));
    if (!six.every(Boolean)) continue;
    const names = six.map((m) => m[1].toLowerCase()).join('');
    if (!/^e[bh]gdae$/.test(names)) continue;
    const rows = six.map((m) => m[2].replace(/\s+$/, ''));
    const parts = rows.map((r) => r.split('|'));
    const nb = Math.min(...parts.map((p) => p.length));
    for (let k = 0; k < nb; k++) {
      const segs = parts.map((p) => p[k]);
      if (segs.every((x) => !x.replace(/[-:\s]/g, '').length) && k === nb - 1) continue; // posle poslednje „|“
      const notes = [];
      segs.forEach((seg, si) => { const re = /\d{1,2}/g; let m; while ((m = re.exec(seg))) if (Number(m[0]) <= 24) notes.push({ s: si + 1, f: Number(m[0]), x: m.index }); });
      const cols = [];
      for (const x of notes.sort((p, q) => p.x - q.x)) { const c = cols[cols.length - 1]; if (c && x.x - c.x < 1) c.notes.push(x); else cols.push({ x: x.x, notes: [x] }); }
      const end = Math.max(...segs.map((x) => x.length));
      const mk = [segs.some((x) => /^\s*:/.test(x)) ? '|:' : '', segs.some((x) => /:\s*$/.test(x)) ? ':|' : ''].filter(Boolean);
      if (!cols.length && end < 4) continue;
      bars.push({ cols, end, mk });
    }
    i += 5;
  }
  return bars;
}

/** PDF bez nacrtane tablature, ali sa ASCII tablaturom u tekstu (npr. „Skini PDF“ iz ove aplikacije, sajtovi). */
export function pdfAsciiTab(pages) {
  const text = pdfToPlainText(pages);
  const bars = asciiTabBars(text);
  if (!bars.length) return null;
  const top = pages[0].items.reduce((b, it) => (!b || it.size > b.size + 0.5 ? it : b), null);
  const title = top ? pages[0].items.filter((it) => Math.abs(it.y - top.y) < 2 && Math.abs(it.size - top.size) < 1).sort((a, b) => a.x - b.x).map((it) => it.str.trim()).join(' ').replace(/\s+/g, ' ').trim() : '';
  const sig = (/\b(?:Takt|Time|TAKT)\s*:?\s*(\d{1,2}\/\d{1,2})/.exec(text) || [])[1] || '';
  // red ispod naslova: „Kompozitor · Tonalitet … · Takt 3/4“ (izvoz iz aplikacije) → prvi deo ako nije oznaka
  const after = text.split('\n').map((l) => l.trim()).filter(Boolean)[1] || '';
  const first = after.split(/\s+·\s+/)[0].trim();
  const composer = first && !/:|\|/.test(first) && first.length <= 60 && !STR_ROW.test(first) ? first : '';
  return barsToText(bars, { title, composer, sig });
}

// ---------------- Akordi i tekst ----------------
/** Strane bez tablature → tekst sa razmacima (akordi iznad reči ostaju iznad istih reči) ili '' ako nema teksta. */
export function pdfToPlainText(pages) {
  const out = [];
  for (const pg of pages) {
    const items = pg.items.filter((it) => it.str.trim());
    if (!items.length) continue;
    const cws = items.filter((it) => it.str.length >= 3).map((it) => it.w / it.str.length).filter((x) => x > 0.5);
    const cw = med(cws) || 5;
    const left = Math.min(...items.map((it) => it.x));
    const rows = [];
    for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const r = rows[rows.length - 1];
      if (r && Math.abs(r.y - it.y) < Math.max(2, it.size * 0.3)) r.items.push(it); else rows.push({ y: it.y, size: it.size, items: [it] });
    }
    let prevY = null;
    for (const r of rows) {
      if (prevY !== null && r.y - prevY > r.size * 2.2) out.push(''); // prazan red između strofa
      let s = '', prev = null;
      for (const it of r.items.sort((a, b) => a.x - b.x)) {
        const col = Math.max(0, Math.round((it.x - left) / cw));
        if (s.length < col) s += ' '.repeat(col - s.length);
        else if (prev && it.x - (prev.x + prev.w) > cw * 0.3 && !s.endsWith(' ')) s += ' '; // vidljiv razmak, a kolona „zauzeta“ (proporcionalan font)
        s += it.str.replace(/\s+$/, '');
        prev = it;
      }
      out.push(s.replace(/\s+$/, ''));
      prevY = r.y;
    }
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Prve strane PDF-a kao JPEG slike (za skeniran PDF → obično skeniranje). */
export async function renderPdfPages(doc, max = 10, width = 1600) {
  const files = [];
  for (let p = 1; p <= Math.min(doc.numPages, max); p++) {
    const page = await doc.getPage(p);
    const vp0 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: width / vp0.width });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    files.push(new File([blob], `pdf-${p}.jpg`, { type: 'image/jpeg' }));
    c.width = c.height = 0;
    page.cleanup();
  }
  return files;
}

// ---------------- Akordi i tekst → pesma ----------------
const SECTION = /^\[?\s*((?:strofa|refren|pre-?refren|most|uvod|kraj|solo|međuigra|verse|chorus|pre-?chorus|bridge|intro|outro|interlude|instrumental|coda)\b[^\]]{0,18})\]?:?\s*$/i;
const FOOTER = /(—|-)\s*\d+\s*\/\s*\d+\s*$|^\s*(strana|page)\s*\d+(\s*(od|of)\s*\d+)?\s*$|^\s*\d+\s*\/\s*\d+\s*$/i;

/**
 * Strane sa akordima iznad teksta → { title, artist, text } (text za textToSections) ili null ako nije pesma sa
 * akordima. isChordLine: iz songformat.js (prosleđuje se, da ovaj modul ostane bez zavisnosti).
 */
export function pdfChordText(pages, isChordLine) {
  const raw = pdfToPlainText(pages);
  if (!raw) return null;
  let lines = raw.split('\n');
  const top = pages[0].items.reduce((b, it) => (!b || it.size > b.size + 0.5 ? it : b), null);
  let title = top ? pages[0].items.filter((it) => Math.abs(it.y - top.y) < 2 && Math.abs(it.size - top.size) < 1).sort((a, b) => a.x - b.x).map((it) => it.str.trim()).join(' ').replace(/\s+/g, ' ').trim() : '';
  let artist = '';
  const by = /^(.*?)\s+(?:chords|tabs?|ukulele chords|akordi|tekst)\s+(?:by|-|–)\s+(.+)$/i.exec(title);
  if (by) { title = by[1].trim(); artist = by[2].trim(); }
  // zaglavlje: red sa naslovom, red „izvođač · tonalitet …“, red sa svim akordima (dijagrami); podnožje strane
  const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const firstLyric = lines.findIndex((l) => l.trim() && !isChordLine(l) && !SECTION.test(l.trim()) && norm(l) !== norm(title) && !/·/.test(l) && norm(l) !== norm(top ? title : ''));
  lines = lines.filter((l, i) => {
    const s = l.trim();
    if (FOOTER.test(s)) return false;
    if (i < Math.max(0, firstLyric) || firstLyric < 0) {
      if (norm(s) === norm(title) || (top && norm(s) === norm(pages[0].items.filter((it) => Math.abs(it.y - top.y) < 2).map((it) => it.str).join(' ')))) return false;
      if (/·/.test(s)) { if (!artist) { const a = s.split(/\s+·\s+/)[0].trim(); if (a && !/:/.test(a) && a.length <= 60) artist = a; } return false; }
      if (isChordLine(l) && !(lines[i + 1] || '').trim()) return false; // red sa dijagramima akorda
    }
    return true;
  }).map((l) => { const m = SECTION.exec(l.trim()); return m && !isChordLine(l) ? `[${m[1].trim()}]` : l; });
  const chordRows = lines.filter((l) => l.trim() && isChordLine(l)).length;
  const lyricRows = lines.filter((l) => l.trim() && !isChordLine(l) && !/^\[.*\]$/.test(l.trim())).length;
  if (chordRows < 2 || lyricRows < 1) return null;
  return { title, artist, text: lines.join('\n').replace(/^\n+/, '').trim() };
}

/** v2.4.33: PDF „lista akorada“ (delovi sa kućicama akorada, ×N, redosled, kapodaster, saveti) → { title, artist, capo, text } ili null. */
export async function pdfChordChart(pages, isChordLine) {
  const raw = pdfToPlainText(pages);
  if (!raw) return null;
  const { chordChartFromLines } = await import('./chordChart.js');
  const lines = raw.split('\n');
  const r = chordChartFromLines(lines, (tok) => isChordLine(tok));
  if (!r) return null;
  const top = pages[0].items.reduce((b, it) => (!b || it.size > b.size + 0.5 ? it : b), null);
  const title = top ? pages[0].items.filter((it) => Math.abs(it.y - top.y) < 2 && Math.abs(it.size - top.size) < 1).sort((a, b) => a.x - b.x).map((it) => it.str.trim()).join(' ').replace(/\s+/g, ' ').trim() : '';
  // izvođač: prva kolona prvog sledećeg reda ispod naslova (bez „Capo …“, „Standard tuning“, „Song 6 of 10“)
  let artist = '';
  const ti = lines.findIndex((l) => title && l.replace(/\s+/g, ' ').trim() === title);
  for (let j = ti + 1; ti >= 0 && j < Math.min(lines.length, ti + 4) && !artist; j++) {
    const c = lines[j].trim().split(/\s{3,}/)[0] || '';
    if (c && !/capo|kapo|tuning|štim|song \d|pesma \d|level/i.test(c) && c.length <= 60) artist = c;
  }
  // v2.4.35: i ono što je nacrtano — hvatovi iz dijagrama (indeks hvata po akordu) i ritam iz strelica
  const X = (await import('./sheetExtras.js')).sheetExtras(pages);
  const { matchVoicing } = await import('./chords.js');
  const shapes = {};
  for (const [name, v] of Object.entries(X.shapes)) { const i = matchVoicing(name, v.frets); if (i > 0) shapes[name] = i; }
  let strum = null;
  if (X.strum) {
    const { PATTERNS } = await import('./rhythm.js');
    const same = PATTERNS.find((p) => p.sig === X.strum.sig && p.steps === X.strum.steps && !p.swing);
    strum = same ? { id: same.id, sig: same.sig, steps: same.steps } : { sig: X.strum.sig, steps: X.strum.steps, ...(X.strum.name ? { name: X.strum.name } : {}) };
  }
  const { seriesFromLines } = await import('./chordChart.js');
  const series = seriesFromLines(lines); // v2.4.37: „THE SONG PATH LEVEL 3 … Song 6 of 10“ → kurs
  return { title, artist, capo: r.capo, text: r.text, ...(Object.keys(shapes).length ? { shapes } : {}), ...(strum ? { strum } : {}), ...(series ? { series } : {}) };
}

/** v2.4.36: YouTube linkovi sa lista → { tutorial?, listen? } (ili null). */
export async function pdfVideos(pages) {
  const [{ sheetVideos }, { cleanYoutubeUrl }] = await Promise.all([import('./sheetExtras.js'), import('./songformat.js')]);
  const v = sheetVideos(pages, cleanYoutubeUrl);
  return Object.keys(v).length ? v : null;
}
