// v2.4.35: Sa lista akorada (PDF) uzima i ono što je nacrtano, ne samo tekst:
//   • dijagrami akorada — prsti (brojevi) na žicama i pragovima, × = prigušena žica → hvat sa lista
//   • ritam — strelice ↓ ↑ iznad „1 2 & 3 & 4 &“ (crtica bez strelice = pauza) → obrazac udaranja
// Čista logika nad onim što čita readPdf (items sa x/y, segs = duži). Test u Node-u (tests/sheetextras.test.mjs).

const near = (a, b, d) => Math.abs(a - b) <= d;
const cx = (it) => it.x + (it.w || it.size * 0.5) / 2;

/** Mreže dijagrama: šest uspravnih linija jednako razmaknutih, iste visine. */
function grids(segs) {
  const vs = segs.filter((s) => near(s.x0, s.x1, 0.6) && Math.abs(s.y1 - s.y0) > 30)
    .map((s) => ({ x: (s.x0 + s.x1) / 2, y0: Math.min(s.y0, s.y1), y1: Math.max(s.y0, s.y1) }))
    .sort((a, b) => a.y0 - b.y0 || a.x - b.x);
  const used = new Set(), out = [];
  for (let i = 0; i < vs.length; i++) {
    if (used.has(i)) continue;
    const row = vs.map((v, k) => ({ v, k })).filter(({ v, k }) => !used.has(k) && near(v.y0, vs[i].y0, 1) && near(v.y1, vs[i].y1, 1)).sort((a, b) => a.v.x - b.v.x);
    // grupe od 6 susednih sa istim razmakom
    for (let j = 0; j + 5 < row.length; j++) {
      const six = row.slice(j, j + 6), d = six[1].v.x - six[0].v.x;
      if (d < 6 || d > 40 || !six.every((s, k) => !k || near(s.v.x - six[k - 1].v.x, d, 1))) continue;
      six.forEach((s) => used.add(s.k));
      const x0 = six[0].v.x, x1 = six[5].v.x, top = six[0].v.y0, bot = six[0].v.y1;
      const hs = [...new Set(segs.filter((s) => near(s.y0, s.y1, 0.6) && s.y0 > top + 2 && s.y0 <= bot + 1 && Math.min(s.x0, s.x1) <= x0 + 1 && Math.max(s.x0, s.x1) >= x1 - 1).map((s) => Math.round(s.y0)))].sort((a, b) => a - b);
      const fs = hs.length ? (hs[hs.length - 1] - top) / hs.length : (bot - top) / 4;
      out.push({ x0, x1, ss: d, top, bot, fs });
      j += 5;
    }
  }
  return out;
}

/** Dijagrami akorada sa strane → { 'D': { frets:[6], fingers:[6] } } (oblici kako su nacrtani, bez kapodastera). */
export function sheetShapes(page) {
  const { items = [], segs = [] } = page || {};
  const out = {};
  for (const g of grids(segs)) {
    // naziv: krupan tekst iznad mreže, po sredini
    const mid = (g.x0 + g.x1) / 2;
    const name = items.filter((it) => it.y < g.top && it.y > g.top - 50 && it.size >= 10 && near(cx(it), mid, (g.x1 - g.x0) * 0.6) && /^[A-H][#b♯♭]?[^\s]{0,8}$/.test(it.str.trim()))
      .sort((a, b) => b.y - a.y)[0];
    if (!name) continue;
    // početni prag („5fr“) levo od mreže
    const pos = items.find((it) => /^(\d{1,2})\s*(fr|pr)?\.?$/i.test(it.str.trim()) && it.x < g.x0 - 2 && it.x > g.x0 - 30 && it.y >= g.top - 2 && it.y <= g.top + g.fs * 1.5);
    const base = pos ? Number(/\d+/.exec(pos.str)[0]) - 1 : 0;
    const frets = [0, 0, 0, 0, 0, 0], fingers = [0, 0, 0, 0, 0, 0];
    let n = 0;
    for (const it of items) {
      if (!/^[1-4T]$/.test(it.str.trim())) continue;
      const c = cx(it);
      if (c < g.x0 - g.ss / 2 || c > g.x1 + g.ss / 2 || it.y <= g.top || it.y >= g.bot) continue;
      const s = Math.round((c - g.x0) / g.ss);
      const f = Math.floor((it.y - g.top) / g.fs) + 1 + base;
      if (s < 0 || s > 5) continue;
      if (frets[s] < f) { frets[s] = f; fingers[s] = it.str.trim() === 'T' ? 0 : Number(it.str.trim()); n++; }
    }
    // × iznad mreže = prigušena žica (dve kose crte koje se seku)
    for (let s = 0; s < 6; s++) {
      const x = g.x0 + s * g.ss;
      const diag = segs.filter((q) => !near(q.x0, q.x1, 0.6) && !near(q.y0, q.y1, 0.6) && q.y0 < g.top && q.y1 < g.top && q.y0 > g.top - 20 && near((q.x0 + q.x1) / 2, x, g.ss / 2));
      if (diag.length >= 2 && !frets[s]) frets[s] = -1;
    }
    if (n) out[name.str.trim()] = { frets, fingers };
  }
  return out;
}

const BEAT = /^(\d|&|\+|e|a|i)$/;
/** Ritam sa strane: oznake doba u redu i strelice iznad njih → { sig, steps, name } ili null. */
export function sheetStrum(page) {
  const { items = [], segs = [] } = page || {};
  const head = items.find((it) => /^(strum(ming)?( pattern)?|rhythm|ritam|udaranje)$/i.test(it.str.trim()));
  if (!head) return null;
  // red oznaka: najbliži red ispod naslova sa bar 4 oznake doba
  const rows = new Map();
  for (const it of items) if (it.y > head.y && it.y < head.y + 120 && BEAT.test(it.str.trim())) { const k = Math.round(it.y); rows.set(k, [...(rows.get(k) || []), it]); }
  const row = [...rows.entries()].sort((a, b) => a[0] - b[0]).map((r) => r[1].sort((a, b) => a.x - b.x)).find((r) => r.length >= 4 && /^\d$/.test(r[0].str.trim()));
  let steps = null, sig = '4/4';
  if (row) {
    const sixteen = row.some((it) => /^(e|a)$/.test(it.str.trim()));
    const per = sixteen ? 4 : 2;
    const beats = Math.max(...row.filter((it) => /^\d$/.test(it.str.trim())).map((it) => Number(it.str.trim())));
    if (beats < 2 || beats > 4) return null;
    sig = beats + '/4';
    const slots = Array(beats * per).fill('-');
    const ly = row[0].y;
    const stems = segs.filter((s) => near(s.x0, s.x1, 0.6) && Math.abs(s.y1 - s.y0) > 8 && Math.max(s.y0, s.y1) < ly && Math.max(s.y0, s.y1) > ly - 60)
      .map((s) => ({ x: s.x0, top: Math.min(s.y0, s.y1), bot: Math.max(s.y0, s.y1) }));
    let beat = 0;
    for (const it of row) {
      const s = it.str.trim();
      let slot;
      if (/^\d$/.test(s)) { beat = Number(s); slot = (beat - 1) * per; } else if (s === 'e') slot = (beat - 1) * per + 1; else if (s === 'a') slot = (beat - 1) * per + 3; else slot = (beat - 1) * per + per / 2;
      if (!beat || slot < 0 || slot >= slots.length) continue;
      const st = stems.find((q) => near(q.x, cx(it), 7));
      if (!st) continue;
      // vrh strelice: kose crte koje dodiruju dno (↓) ili vrh (↑) drške
      const tip = (y) => segs.some((q) => !near(q.x0, q.x1, 0.6) && !near(q.y0, q.y1, 0.6) && ((near(q.x0, st.x, 1) && near(q.y0, y, 3)) || (near(q.x1, st.x, 1) && near(q.y1, y, 3))));
      const down = tip(st.bot + 2) || tip(st.bot), up = tip(st.top - 2) || tip(st.top);
      slots[slot] = down && !up ? 'D' : up && !down ? 'U' : '-';
    }
    steps = slots.join('');
    // strelice kao tekst (↓ ↑) iznad oznaka
    if (!/[DU]/.test(steps)) {
      const ar = items.filter((it) => /^[↓↑]$/.test(it.str.trim()) && it.y < ly && it.y > ly - 60);
      if (ar.length) { beat = 0; for (const it of row) { const s = it.str.trim(); let slot; if (/^\d$/.test(s)) { beat = Number(s); slot = (beat - 1) * per; } else slot = (beat - 1) * per + (s === 'e' ? 1 : s === 'a' ? 3 : per / 2); const a = ar.find((q) => near(cx(q), cx(it), 7)); if (a && slot >= 0 && slot < slots.length) slots[slot] = a.str.trim() === '↓' ? 'D' : 'U'; } steps = slots.join(''); }
    }
  } else {
    // ritam slovima: „D D U U D U“ / „↓ ↓ ↑ ↑ ↓ ↑“ u redu ispod naslova
    const line = items.filter((it) => it.y > head.y && it.y < head.y + 60).sort((a, b) => a.y - b.y || a.x - b.x).map((it) => it.str).join(' ');
    const m = /((?:[DU↓↑x-]\s*){4,16})/.exec(line.replace(/↓/g, 'D').replace(/↑/g, 'U'));
    if (m) steps = m[1].replace(/\s+/g, '');
  }
  if (!steps || !/[DU]/.test(steps) || steps.replace(/-/g, '').length < 2) return null;
  // naziv: rečenica ispod („The Stand By Me strum, light and bouncy.“) — deo do zareza ako pominje ritam
  const below = items.filter((it) => it.y > (row ? row[0].y : head.y) && it.y < (row ? row[0].y : head.y) + 40 && it.str.trim().length > 8).sort((a, b) => a.y - b.y)[0];
  const nm = below && /^(the )?(.{3,36}?\b(strum|ritam|rhythm))\b/i.exec(below.str.trim().split(/[,.]/)[0]);
  return { sig, steps, ...(nm ? { name: nm[2].trim() } : {}) };
}

/** Sve sa strana: hvatovi (iz prve strane koja ih ima) i ritam. */
export function sheetExtras(pages) {
  let shapes = {}, strum = null;
  for (const p of pages || []) {
    if (!Object.keys(shapes).length) shapes = sheetShapes(p);
    if (!strum) strum = sheetStrum(p);
  }
  return { shapes, strum };
}

// v2.4.36: YouTube linkovi sa lista (klikabilni ili ispisani) → { tutorial?, listen? }. Tekst oko linka odlučuje:
// lekcija/tutorijal/„learn it with me“ → tutorial; snimak/original/„play along with the record“ → listen (Uz video).
const YT = /(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch\?[^\s]*v=|shorts\/|live\/)|youtu\.be\/)[\w-]{6,}[^\s)\]]*/i;
const TUT = /\b(learn|lesson|tutorial|watch|how to|lekcij|nauči|nauci|tutorijal|objašnj)/i;
const LIS = /\b(record|original|listen|play ?along|official|audio|poslušaj|poslusaj|snimak|uz video)/i;
export function sheetVideos(pages, clean = (u) => u) {
  const found = [];
  for (const p of pages || []) {
    const ctx = (y) => (p.items || []).filter((it) => Math.abs(it.y - y) < 40).map((it) => it.str).join(' ');
    for (const l of p.links || []) if (YT.test(l.url)) found.push({ url: l.url, ctx: ctx(l.y) });
    for (const it of p.items || []) { const m = YT.exec(it.str); if (m) found.push({ url: /^https?:/.test(m[0]) ? m[0] : 'https://' + m[0], ctx: ctx(it.y) }); }
  }
  const out = {}, seen = new Set();
  const list = found.map((f) => ({ ...f, url: clean(f.url) })).filter((f) => f.url && !seen.has(f.url) && seen.add(f.url));
  for (const f of list) { const k = LIS.test(f.ctx) && !TUT.test(f.ctx) ? 'listen' : TUT.test(f.ctx) ? 'tutorial' : null; if (k && !out[k]) { out[k] = f.url; f.used = true; } }
  for (const f of list) if (!f.used) { const k = !out.tutorial ? 'tutorial' : !out.listen ? 'listen' : null; if (k) out[k] = f.url; }
  return out;
}
