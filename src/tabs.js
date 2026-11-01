// Tablature: strukturirani podaci, ASCII uvoz/izvoz, crtanje (šest linija, prelom po taktu) i reprodukcija.
//
// Tablatura: { sig: '4/4', bars: [ { w: 16, notes: [ { s: 1..6, f: '3' | '10' | 'x', p: 0..w-1, t?: 'h' } ] } ] }
//   s = žica (1 = visoka e, 6 = niska E), f = prag, p = mesto u taktu (kolona), w = širina takta u kolonama,
//   t = tehnika posle note (h hammer-on, p pull-off, / \ klizanje, b bend, r release, ~ vibrato).
import { pluck, audioCtx } from './synth.js';

export const STRING_NAMES = ['e', 'B', 'G', 'D', 'A', 'E'];
const OPEN_MIDI = [64, 59, 55, 50, 45, 40];
const TECH = new Set(['h', 'p', '/', '\\', 'b', 'r', '~']);
const SIGS = new Set(['2/4', '3/4', '4/4', '6/8', '12/8', '5/4', '7/8']);

// ---------------- ASCII ----------------
const TAB_LINE = /^\s*([eEbBgGdDaAhH]?)\s*[|:]?[-0-9xXhpbr\/\\~|.()]+$/;

/** Da li linija izgleda kao red ASCII tablature (npr. "e|---0---|"). */
export function isTabLine(line) {
  const s = String(line || '');
  if (!TAB_LINE.test(s)) return false;
  const body = s.replace(/^\s*[a-zA-Z]?\s*[|:]?/, '');
  return (body.match(/-/g) || []).length >= Math.max(2, body.length * 0.3);
}

/** Sadržaj reda posle naziva žice i prve crte „|“. */
function lineBody(line) {
  const m = String(line).match(/^\s*[a-zA-Z]?\s*\|?/);
  return String(line).slice(m ? m[0].length : 0).replace(/\s+$/, '');
}

/**
 * Parsira 6 redova ASCII tablature (visoka e gore). Vraća tablaturu ili null.
 * Kolone (p) se čuvaju takve kakve su, pa je prikaz veran originalu.
 */
export function parseAsciiTab(lines, sig = '4/4') {
  if (!Array.isArray(lines) || lines.length < 6) return null;
  const rows = lines.slice(0, 6).map(lineBody);
  const top = rows[0];
  // Granice taktova = položaji „|“ u gornjem redu (ili bilo kom redu ako ih gore nema)
  const ref = rows.reduce((a, r) => ((r.match(/\|/g) || []).length > (a.match(/\|/g) || []).length ? r : a), top);
  const cuts = [];
  for (let i = 0; i < ref.length; i++) if (ref[i] === '|') cuts.push(i);
  const width = Math.max(...rows.map((r) => r.length));
  const bounds = [];
  let start = 0;
  for (const c of cuts) { if (c > start) bounds.push([start, c]); start = c + 1; }
  if (start < width) bounds.push([start, width]);
  if (!bounds.length) return null;
  const bars = bounds.map(([a, b]) => ({ w: b - a, notes: [] }));
  const barOf = (col) => bounds.findIndex(([a, b]) => col >= a && col < b);
  rows.forEach((row, k) => {
    let last = null;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (/\d/.test(ch)) {
        let j = i;
        while (j < row.length && /\d/.test(row[j]) && j - i < 2) j++;
        const bi = barOf(i);
        if (bi >= 0) {
          last = { s: k + 1, f: row.slice(i, j), p: i - bounds[bi][0] };
          bars[bi].notes.push(last);
        }
        i = j - 1;
      } else if (ch === 'x' || ch === 'X') {
        const bi = barOf(i);
        if (bi >= 0) { last = { s: k + 1, f: 'x', p: i - bounds[bi][0] }; bars[bi].notes.push(last); }
      } else if (TECH.has(ch) && last && !last.t) {
        last.t = ch;
      } else if (ch !== '-' && ch !== '(' && ch !== ')') {
        last = null;
      }
    }
  });
  const out = { sig: SIGS.has(sig) ? sig : '4/4', bars: bars.filter((b) => b.w > 0) };
  out.bars.forEach((b) => b.notes.sort((x, y) => x.p - y.p || x.s - y.s));
  return out.bars.some((b) => b.notes.length) ? out : null;
}

/** Tablatura → 6 ASCII redova (sa nazivima žica). */
export function tabToAscii(tab) {
  return STRING_NAMES.map((name, k) => {
    let line = name + '|';
    for (const bar of tab.bars) {
      const cells = new Array(bar.w).fill('-');
      for (const n of bar.notes) {
        if (n.s !== k + 1) continue;
        const txt = n.f + (n.t || '');
        for (let i = 0; i < txt.length && n.p + i < bar.w; i++) cells[n.p + i] = txt[i];
      }
      line += cells.join('') + '|';
    }
    return line;
  });
}

/** Apsolutna kolona note (u sadržaju posle prve „|“), kao u ASCII zapisu. */
export function noteCol(tab, bi, p) {
  let c = 0;
  for (let i = 0; i < bi; i++) c += tab.bars[i].w + 1;
  return c + p;
}

/** Nota na datoj žici i apsolutnoj koloni (za nesigurna mesta). */
export function noteAt(tab, string, col) {
  let c = 0;
  for (const bar of tab.bars) {
    if (col >= c && col < c + bar.w) return bar.notes.find((n) => n.s === string && n.p === col - c) || null;
    c += bar.w + 1;
  }
  return null;
}

/** Provera i čišćenje tablature (iz uvoza, linka, rezervne kopije, Gemini-ja). */
export function cleanTab(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.bars)) return null;
  const bars = raw.bars.slice(0, 64).map((b) => {
    const w = Math.max(1, Math.min(64, Math.round(Number(b && b.w) || 0)));
    const notes = (Array.isArray(b && b.notes) ? b.notes : []).slice(0, 96).map((n) => {
      const s = Math.round(Number(n && n.s));
      const f = String(n && n.f != null ? n.f : '').trim().toLowerCase();
      const p = Math.round(Number(n && n.p));
      if (!(s >= 1 && s <= 6) || !(p >= 0 && p < w) || !/^(x|\d{1,2})$/.test(f) || (f !== 'x' && Number(f) > 24)) return null;
      const o = { s, f, p };
      if (n.t && TECH.has(n.t)) o.t = n.t;
      return o;
    }).filter(Boolean);
    return { w, notes };
  });
  if (!bars.length || !bars.some((b) => b.notes.length)) return null;
  return { sig: SIGS.has(raw.sig) ? raw.sig : '4/4', bars };
}

// ---------------- Crtanje ----------------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Crta sve tablature u okviru (elementi .tab-staff sa data-tab JSON-om), prelamajući takt po takt
 * prema dostupnoj širini — ništa se ne odseca. Poziva se posle prikaza, promene veličine i uvećanja.
 */
export function layoutTabs(root) {
  root.querySelectorAll('.tab-staff').forEach((el) => {
    let tab;
    try { tab = JSON.parse(el.dataset.tab); } catch { return; }
    const marks = el.dataset.marks ? JSON.parse(el.dataset.marks) : [];
    const avail = el.clientWidth;
    if (!avail) return;
    const fs = parseFloat(getComputedStyle(el).fontSize) || 16;
    const cw = fs * 0.62;               // širina kolone
    const sp = fs * 0.95;               // razmak između žica
    const nameW = fs * 1.1;
    const sigW = fs * 1.7;
    const pad = fs * 0.4;
    // Raspored redova: što više taktova u red
    const rows = [];
    let row = [], used = 0;
    tab.bars.forEach((bar, bi) => {
      const lead = rows.length === 0 && row.length === 0 ? sigW : 0;
      const need = (bar.w + 1) * cw;
      const base = nameW + pad + lead;
      if (row.length && base + used + need > avail) { rows.push(row); row = []; used = 0; }
      row.push(bi);
      used += need;
    });
    if (row.length) rows.push(row);
    let html = '';
    rows.forEach((r, ri) => {
      const lead = ri === 0 ? sigW : 0;
      const rawW = r.reduce((a, bi) => a + (tab.bars[bi].w + 1) * cw, 0);
      const x0 = nameW + pad + lead;
      const scale = Math.min(1, (avail - x0 - 2) / rawW); // jedan predug takt se suzi da stane
      const W = Math.min(avail, x0 + rawW * scale + 2);
      const H = sp * 5 + fs * 1.4;
      const y0 = fs * 0.7;
      let svg = `<svg class="tab-row" width="${W.toFixed(1)}" height="${H.toFixed(1)}" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" role="img" aria-label="TAB">`;
      for (let k = 0; k < 6; k++) {
        const y = y0 + k * sp;
        svg += `<text class="tab-name" x="${(nameW * 0.45).toFixed(1)}" y="${(y + fs * 0.32).toFixed(1)}" text-anchor="middle" font-size="${(fs * 0.78).toFixed(1)}">${STRING_NAMES[k]}</text>`;
        svg += `<line class="tab-line" x1="${(nameW + pad * 0.3).toFixed(1)}" x2="${(W - 1).toFixed(1)}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
      }
      // početna linija i oznaka takta
      svg += `<line class="tab-bar" x1="${(nameW + pad * 0.3).toFixed(1)}" x2="${(nameW + pad * 0.3).toFixed(1)}" y1="${y0}" y2="${(y0 + sp * 5).toFixed(1)}"/>`;
      if (ri === 0) {
        const [n, d] = tab.sig.split('/');
        const sx = nameW + pad + sigW * 0.45;
        svg += `<text class="tab-sig" x="${sx.toFixed(1)}" y="${(y0 + sp * 2.1).toFixed(1)}" text-anchor="middle" font-size="${(fs * 1.25).toFixed(1)}">${n}</text>`;
        svg += `<text class="tab-sig" x="${sx.toFixed(1)}" y="${(y0 + sp * 4.3).toFixed(1)}" text-anchor="middle" font-size="${(fs * 1.25).toFixed(1)}">${d}</text>`;
      }
      let x = x0;
      for (const bi of r) {
        const bar = tab.bars[bi];
        const bw = (bar.w + 1) * cw * scale;
        bar.notes.forEach((n, ni) => {
          const nx = x + (n.p + 0.5) * cw * scale + cw * 0.5 * scale;
          const ny = y0 + (n.s - 1) * sp;
          const label = n.f + (n.t || '');
          const tw = label.length * fs * 0.55;
          const col = noteCol(tab, bi, n.p);
          const mk = marks.find((m) => m.string === n.s && m.col === col);
          svg += `<g class="tab-note${mk ? ' unsure' : ''}" data-note="${bi}-${ni}"${mk ? ` data-unsure="${mk.idx}"` : ''}>`
            + `<rect x="${(nx - tw / 2 - 1).toFixed(1)}" y="${(ny - fs * 0.45).toFixed(1)}" width="${(tw + 2).toFixed(1)}" height="${(fs * 0.9).toFixed(1)}" rx="3"/>`
            + `<text x="${nx.toFixed(1)}" y="${(ny + fs * 0.33).toFixed(1)}" text-anchor="middle" font-size="${(fs * 0.86).toFixed(1)}">${esc(label)}</text>`
            + (mk ? `<path class="tab-unsure" d="M ${(nx - tw / 2).toFixed(1)} ${(ny + fs * 0.5).toFixed(1)} q ${(tw / 4).toFixed(1)} 2 ${(tw / 2).toFixed(1)} 0 t ${(tw / 2).toFixed(1)} 0"/>` : '')
            + '</g>';
        });
        x += bw;
        svg += `<line class="tab-bar" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${y0}" y2="${(y0 + sp * 5).toFixed(1)}"/>`;
      }
      svg += '</svg>';
      html += svg;
    });
    el.innerHTML = html;
  });
}

/** HTML okvir za jednu tablaturu (crta je layoutTabs). marks = nesigurni pragovi [{string, col, idx}]. */
export function tabBlockHTML(tab, { si, ti, marks = [], playLabel = 'Play' } = {}) {
  return `<div class="tab-block" data-si="${si}" data-ti="${ti}">
    <button class="icon-btn tab-play" data-tabplay="${si}-${ti}" aria-label="${esc(playLabel)}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
    <div class="tab-staff" data-tab="${esc(JSON.stringify(tab))}" data-marks="${esc(JSON.stringify(marks))}"></div>
  </div>`;
}

// ---------------- Reprodukcija ----------------
/** Trajanje takta u sekundama (broj četvrtina × trajanje četvrtine). */
function barSeconds(sig, bpm) {
  const [n, d] = sig.split('/').map(Number);
  return (n * (4 / d) * 60) / bpm;
}

/**
 * Pušta tablaturu tonom nalik gitari u tempu metronoma.
 * onNote(bi, ni) se poziva kada nota zazvuči; vraća funkciju za zaustavljanje.
 */
export function playTab(tab, { bpm = 90, a4 = 440, onNote, onEnd } = {}) {
  const c = audioCtx();
  const t0 = c.currentTime + 0.12;
  const barDur = barSeconds(tab.sig, bpm);
  // Svi događaji redom; zakazuju se samo malo unapred, pa „stop“ odmah utiša nastavak.
  const events = [];
  tab.bars.forEach((bar, bi) => {
    bar.notes.forEach((n, ni) => events.push({ when: t0 + bi * barDur + (n.p / bar.w) * barDur, n, bi, ni }));
  });
  events.sort((x, y) => x.when - y.when);
  const end = t0 + tab.bars.length * barDur;
  const timers = [];
  let i = 0, stopped = false;
  const tick = () => {
    while (i < events.length && events[i].when < c.currentTime + 0.15) {
      const e = events[i++];
      if (e.n.f !== 'x') {
        const midi = OPEN_MIDI[e.n.s - 1] + Number(e.n.f);
        pluck(a4 * Math.pow(2, (midi - 69) / 12), { when: e.when, gain: 0.3, duration: 1.6 });
      }
      timers.push(setTimeout(() => !stopped && onNote && onNote(e.bi, e.ni), Math.max(0, (e.when - c.currentTime) * 1000)));
    }
    if (i >= events.length && c.currentTime > end) { clearInterval(iv); if (!stopped && onEnd) onEnd(); }
  };
  const iv = setInterval(tick, 25);
  tick();
  return () => { stopped = true; clearInterval(iv); timers.forEach(clearTimeout); };
}
