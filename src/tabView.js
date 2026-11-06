// Pesme → TAB pesma (prebiranje): čitljiva tablatura (šest linija, pragovi, brojevi taktova, ponavljanja, barre,
// promena tonaliteta), dodir na takt = taj takt polako (referentni tonovi), automatsko skrolovanje u tempu pesme,
// prečica za Vežbe → Delovi pesme, YouTube, Podeli, „Skini PDF“. Kapodaster i transpozicija se ne prikazuju.
// Učitava se tek kad se otvori TAB pesma (ili njen pregled posle skeniranja).
import { t, getLang } from './i18n.js';
import { practiceCardHTML, fillPractice } from './songPracticeCard.js';
import { MORE_ICON, moreMenu, attachPinch, versionTipOnce, zoomPillHTML, bindZoomPill, songMenuItems } from './songChrome.js';
import { useTabTexts } from './tabText.js';
import { esc, toast, dialog } from './ui.js';
import { songs as db, settings } from './db.js';
import { dn } from './naming.js';
import { parseKey } from './music.js';
import { pluck, audioCtx } from './synth.js';
import { keepAwake, allowSleep, setWakeZone } from './wakelock.js';
import { barInfo, checkBars, playOrder, tabParts, midiOf, toColumns, snap } from './tabSong.js';
import { safeFileName, cleanYoutubeUrl } from './songformat.js';

useTabTexts();
const cssReady = new Promise((resolve) => {
  if (document.getElementById('tabCss')) return resolve();
  const l = document.createElement('link');
  l.id = 'tabCss'; l.rel = 'stylesheet';
  l.href = new URL('./tab.css' + new URL(import.meta.url).search, import.meta.url).href;
  l.onload = l.onerror = () => resolve();
  document.head.appendChild(l);
  setTimeout(resolve, 1500);
});

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX'];
const NOTE_EN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** „e-mol“ / „E-dur“ (engleski: „E minor“ / „E major“), u izabranom imenovanju (H ili B). */
export function keyLabel(k) {
  const p = parseKey(k);
  if (!p) return k || '';
  let name = dn(NOTE_EN[p.root]);
  if (p.minor && getLang() !== 'en') name = name.toLowerCase();
  return t(p.minor ? 'tab.minor' : 'tab.major', { k: name });
}
const ORD = (n) => (n <= 3 ? t('tab.ord' + n) : t('tab.ordN', { n }));
/** Ime dela za vežbu: „Takt 1–4“ ili „Drugi deo (E-dur)“. */
export function partName(p) {
  return p.kind === 'key' ? `${ORD(p.ord + 1)} (${keyLabel(p.key)})` : t('tab.bars', { a: p.from + 1, b: p.to + 1 });
}
export const barreLabel = (br) => (br.half ? '½' : '') + 'B' + (ROMAN[br.fret] || br.fret);
const stringNames = () => ['E', 'B', 'G', 'D', 'A', 'E'].map((x, i) => (i === 0 ? dn('E').toLowerCase() : dn(x)));

// ---------------- Crtanje tablature ----------------
/**
 * Crta tablaturu u okvir (SVG po redu, taktovi se prelamaju prema širini ekrana; ništa se ne odseca).
 * opts: { flags: Set(indeksa taktova za proveru), edit: dodir na broj, zoom }. Vraća { rows: [{ el, bars }] }.
 */
export function drawStaff(box, tab, { flags = new Set(), edit = false, zoom = 1 } = {}) {
  const avail = box.clientWidth;
  if (!avail) return { rows: [] };
  const fs = 15 * zoom, cw = fs * 0.62, sp = fs * 1.02, names = stringNames();
  const nameW = fs * 1.1, sigW = fs * 1.6, top = fs * 2.5, H = top + sp * 5 + fs * 0.9;
  const info = barInfo(tab);
  // širina takta: po broju različitih početaka nota (gušći takt = širi), najmanje za 3 broja
  const want = tab.bars.map((b) => {
    const starts = new Set(b.notes.map((n) => snap(n.b))).size;
    return Math.max(fs * 5, starts * cw * 1.72 + fs * 1.3); // telefon uspravno: dva takta prebiranja u redu
  });
  const rows = [];
  let row = [], used = 0;
  tab.bars.forEach((b, i) => {
    const lead = nameW + (rows.length === 0 && row.length === 0 ? sigW : 0);
    if (row.length && lead + used + want[i] > avail - 2) { rows.push(row); row = []; used = 0; }
    row.push(i); used += want[i];
  });
  if (row.length) rows.push(row);
  const out = [];
  let html = '';
  rows.forEach((r, ri) => {
    const lead = nameW + (ri === 0 ? sigW : 0);
    const raw = r.reduce((a, i) => a + want[i], 0);
    const last = ri === rows.length - 1;
    const k = Math.min(last ? 1.25 : 4, (avail - lead - 2) / raw); // poravnaj red do ivice (poslednji red manje)
    const W = Math.min(avail, lead + raw * k + 2);
    const y0 = top, ys = (s) => y0 + (s - 1) * sp;
    let svg = `<svg class="tb-row" data-row="${ri}" width="${W.toFixed(1)}" height="${H.toFixed(1)}" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" role="img" aria-label="TAB">`;
    for (let s = 1; s <= 6; s++) {
      svg += `<text class="tb-name" x="${(nameW * 0.42).toFixed(1)}" y="${(ys(s) + fs * 0.32).toFixed(1)}" text-anchor="middle" font-size="${(fs * 0.78).toFixed(1)}">${names[s - 1]}</text>`;
      svg += `<line class="tb-line" x1="${nameW.toFixed(1)}" x2="${(W - 1).toFixed(1)}" y1="${ys(s).toFixed(1)}" y2="${ys(s).toFixed(1)}"/>`;
    }
    svg += `<line class="tb-barline" x1="${nameW.toFixed(1)}" x2="${nameW.toFixed(1)}" y1="${y0}" y2="${ys(6).toFixed(1)}"/>`;
    if (ri === 0) {
      const [a, b] = tab.sig.split('/');
      const sx = nameW + sigW * 0.5;
      svg += `<text class="tb-sig" x="${sx.toFixed(1)}" y="${(ys(3) + fs * 0.1).toFixed(1)}" text-anchor="middle" font-size="${(fs * 1.45).toFixed(1)}">${a}</text>`;
      svg += `<text class="tb-sig" x="${sx.toFixed(1)}" y="${(ys(5) + fs * 0.35).toFixed(1)}" text-anchor="middle" font-size="${(fs * 1.45).toFixed(1)}">${b}</text>`;
    }
    let x = lead;
    for (const bi of r) {
      const bar = tab.bars[bi], w = want[bi] * k, len = info[bi].len;
      const padL = fs * 0.9, inner = w - padL - fs * 0.5;
      const xOf = (beat) => x + padL + (beat / len) * inner;
      svg += `<g class="tb-bar${flags.has(bi) ? ' flag' : ''}" data-bar="${bi}">`;
      svg += `<rect class="tb-hit" x="${x.toFixed(1)}" y="${(y0 - fs * 1.9).toFixed(1)}" width="${w.toFixed(1)}" height="${(sp * 5 + fs * 2.5).toFixed(1)}" rx="6"/>`;
      // broj takta, promena takta/tonaliteta, volta, barre (iznad linija)
      svg += `<text class="tb-num" x="${(x + 3).toFixed(1)}" y="${(y0 - fs * 0.55).toFixed(1)}" font-size="${(fs * 0.62).toFixed(1)}">${bi + 1}</text>`;
      let lab = x + fs * 1.3;
      if (bar.key) { svg += `<text class="tb-key" x="${lab.toFixed(1)}" y="${(y0 - fs * 1.3).toFixed(1)}" font-size="${(fs * 0.78).toFixed(1)}">${esc(keyLabel(bar.key))}</text>`; lab += fs * 4.4; }
      if (bar.sig) svg += `<text class="tb-key" x="${lab.toFixed(1)}" y="${(y0 - fs * 1.3).toFixed(1)}" font-size="${(fs * 0.78).toFixed(1)}">${bar.sig}</text>`;
      if (bar.end) svg += `<path class="tb-volta" d="M ${(x + 2).toFixed(1)} ${(y0 - fs * 0.4).toFixed(1)} V ${(y0 - fs * 1.85).toFixed(1)} H ${(x + w - 4).toFixed(1)}"/><text class="tb-num" x="${(x + 5).toFixed(1)}" y="${(y0 - fs * 1.05).toFixed(1)}" font-size="${(fs * 0.7).toFixed(1)}">${bar.end}.</text>`;
      for (const br of bar.barre || []) {
        const bx = xOf(br.b || 0), ex = xOf(Math.min(len, (br.b || 0) + (br.d || len)));
        const by = y0 - fs * (bar.key || bar.end ? 0.55 : 1.15);
        svg += `<text class="tb-barre" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" font-size="${(fs * 0.72).toFixed(1)}">${barreLabel(br)}</text>`
          + `<line class="tb-barre-l" x1="${(bx + fs * 2).toFixed(1)}" x2="${(ex - 2).toFixed(1)}" y1="${(by - fs * 0.25).toFixed(1)}" y2="${(by - fs * 0.25).toFixed(1)}"/>`;
      }
      if (bar.rs) {
        svg += `<rect class="tb-thick" x="${(x + 1).toFixed(1)}" y="${y0}" width="${(fs * 0.22).toFixed(1)}" height="${(sp * 5).toFixed(1)}"/>`;
        for (const yy of [(ys(2) + ys(3)) / 2, (ys(4) + ys(5)) / 2]) svg += `<circle class="tb-dot" cx="${(x + fs * 0.62).toFixed(1)}" cy="${yy.toFixed(1)}" r="${(fs * 0.14).toFixed(1)}"/>`;
      }
      bar.notes.forEach((n, ni) => {
        const nx = xOf(n.b), ny = ys(n.s), lbl = String(n.f), tw = lbl.length * fs * 0.56;
        svg += `<g class="tb-n" data-note="${bi}-${ni}">`
          + `<rect x="${(nx - tw / 2 - 1.5).toFixed(1)}" y="${(ny - fs * 0.46).toFixed(1)}" width="${(tw + 3).toFixed(1)}" height="${(fs * 0.92).toFixed(1)}" rx="3"/>`
          + `<text x="${nx.toFixed(1)}" y="${(ny + fs * 0.33).toFixed(1)}" text-anchor="middle" font-size="${(fs * 0.86).toFixed(1)}">${lbl}</text>`
          + (n.fi ? `<text class="tb-fi fc${n.fi}" x="${(nx + tw / 2 + fs * 0.2).toFixed(1)}" y="${(ny - fs * 0.22).toFixed(1)}" font-size="${(fs * 0.55).toFixed(1)}">${n.fi}</text>` : '')
          + '</g>';
      });
      x += w;
      if (bar.re) {
        for (const yy of [(ys(2) + ys(3)) / 2, (ys(4) + ys(5)) / 2]) svg += `<circle class="tb-dot" cx="${(x - fs * 0.62).toFixed(1)}" cy="${yy.toFixed(1)}" r="${(fs * 0.14).toFixed(1)}"/>`;
        svg += `<rect class="tb-thick" x="${(x - fs * 0.22 - 1).toFixed(1)}" y="${y0}" width="${(fs * 0.22).toFixed(1)}" height="${(sp * 5).toFixed(1)}"/>`;
      }
      const nextKey = tab.bars[bi + 1] && tab.bars[bi + 1].key;
      svg += `<line class="tb-barline" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${y0}" y2="${ys(6).toFixed(1)}"/>`;
      if (nextKey && !bar.re) svg += `<line class="tb-barline" x1="${(x - 3).toFixed(1)}" x2="${(x - 3).toFixed(1)}" y1="${y0}" y2="${ys(6).toFixed(1)}"/>`; // dupla crta pred novi tonalitet
      svg += '</g>';
    }
    svg += '</svg>';
    html += svg;
    out.push({ bars: r });
  });
  box.innerHTML = html;
  box.classList.toggle('tb-edit', !!edit);
  box.querySelectorAll('.tb-row').forEach((el, i) => { out[i].el = el; });
  return { rows: out };
}

// ---------------- Zvuk: takt(ovi) polako, referentni tonovi ----------------
/** Pusti taktove (indeksi redom) u tempu bpm; onNote(bi, ni) kad nota zazvuči. Vraća stop(). */
export async function playBars(tab, bars, { bpm = 50, onNote, onEnd } = {}) {
  const a4 = Number(await settings.get('a4', 440)) || 440;
  const c = audioCtx();
  if (c.state === 'suspended') { try { await c.resume(); } catch {} }
  const q = 60 / bpm, info = barInfo(tab), t0 = c.currentTime + 0.15, ev = [];
  let off = 0;
  for (const bi of bars) {
    tab.bars[bi].notes.forEach((n, ni) => ev.push({ when: t0 + (off + n.b) * q, n, bi, ni }));
    off += info[bi].len;
  }
  ev.sort((a, b) => a.when - b.when);
  const end = t0 + off * q;
  let i = 0, stopped = false;
  const timers = [];
  const tick = () => {
    while (i < ev.length && ev[i].when < c.currentTime + 0.2) {
      const e = ev[i++];
      pluck(a4 * Math.pow(2, (midiOf(e.n) - 69) / 12), { when: e.when, gain: e.n.s >= 4 ? 0.5 : 0.62, duration: Math.min(3.2, Math.max(1.2, e.n.d * q * 1.6)), group: 'tabplay' });
      timers.push(setTimeout(() => !stopped && onNote?.(e.bi, e.ni), Math.max(0, (e.when - c.currentTime) * 1000)));
    }
    if (i >= ev.length && c.currentTime > end + 0.3) { clearInterval(iv); if (!stopped) onEnd?.(); }
  };
  const iv = setInterval(tick, 40);
  tick();
  return () => { stopped = true; clearInterval(iv); timers.forEach(clearTimeout); };
}

// ---------------- Ekran TAB pesme ----------------
const PLAY_SM = '<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
export const DEFAULT_TAB_BPM = 66;

/** Zajednički opis: „Anonymous · Takt 3/4 · e-mol → E-dur“. */
export function tabMeta(song) {
  const info = barInfo(song.tab), keys = [];
  info.forEach((x, i) => { if (x.key && (!i || x.key !== info[i - 1].key)) keys.push(keyLabel(x.key)); });
  return [song.artist, t('tab.sig', { s: song.tab.sig }), keys.join(' → ')].filter(Boolean);
}

// „Dodirni takt…“: prva tri otvaranja TAB pesme, posle toga se zna
function tapHintOnce() {
  try { const n = Number(localStorage.getItem('gitara-taphint')) || 0; if (n >= 3) return false; localStorage.setItem('gitara-taphint', String(n + 1)); return true; } catch { return false; }
}

export async function renderTabSong(root, stored, nav, { ytRowHTML, shareSong, driveConnected }) {
  await cssReady;
  setWakeZone('song');
  const id = stored.id, backHref = nav ? nav.backHref : '#/pesme';
  let bpm = Number(stored.bpm) || DEFAULT_TAB_BPM;
  let zoom = Number(stored.zoom) || 1;
  root.innerHTML = `
  <section class="view song-view tab-view">
    <header class="topbar">
      <a href="${backHref}" class="back" aria-label="${t('song.back')}">${nav ? esc(nav.backLabel) : t('song.backShort')}</a>
      <div class="topbar-actions">
        <button class="icon-btn" id="tMore" aria-haspopup="true" aria-label="${t('song.more')}" title="${t('song.more')}">${MORE_ICON}</button>
      </div>
    </header>
    ${nav ? `<div class="setlist-nav card">
      <a class="btn small ${nav.prevHref ? '' : 'disabled'}" ${nav.prevHref ? `href="${nav.prevHref}"` : 'aria-disabled="true"'}>‹ ${t('sl.prev')}</a>
      <span class="small muted">${esc(nav.title)} · ${nav.index + 1}/${nav.count}</span>
      <a class="btn small ${nav.nextHref ? 'primary' : 'disabled'}" ${nav.nextHref ? `href="${nav.nextHref}"` : 'aria-disabled="true"'}>${t('sl.next')} ›</a>
    </div>` : ''}
    <div id="tHead"></div>
    ${practiceCardHTML(id, 'tab')}
    <div id="tSug"></div>
    ${tapHintOnce() ? `<p class="small muted tab-tap">${t('play.tapHint')}</p>` : ''}
    ${zoomPillHTML()}
    <div class="tab-staff2" id="tStaff"></div>
    <div class="scroll-bar tab-bar" id="tScrollBar">
      <button class="btn small primary" id="tPlay">${PLAY_SM} ${t('play.open')}</button>
      <a class="btn small" id="tPractice" href="#/vezbe/pesma/${encodeURIComponent(id)}">${t('song.practiceBtn')}</a>
      <span class="bar-tempo" role="group" aria-label="${t('song.tempo')}">
        <button class="btn round small" id="tTempoDown" aria-label="${t('loop.slower')}">−</button>
        <b id="tTempo">${bpm}</b>
        <button class="btn round small" id="tTempoUp" aria-label="${t('loop.faster')}">+</button>
      </span>
    </div>
    <div class="song-actions">
      <button class="btn primary" id="tPdf"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg> ${t('song.pdf')}</button>
      <button class="btn" id="tShare"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7l-6.7 3.4a3 3 0 1 0 0 3.2L15 17a3 3 0 1 0 3-1z"/></svg> ${t('song.share')}</button>
    </div>
  </section>`;
  const $ = (q) => root.querySelector('#' + q);
  const save = () => db.put(stored);

  // ---- Naslov, prečica za vežbu (sa oznakom napretka), opis ----
  function drawHead() {
    $('tHead').innerHTML = `<div class="song-title-row"><h1 class="song-h1">${esc(stored.title)} <span class="badge-sm tab-badge">${t('tab.badge')}</span></h1></div>
      <p class="song-meta">${tabMeta(stored).map(esc).join(' · ')}</p>`;
    // napredak vežbanja ove pesme na kartici „Vežbaj ovu pesmu“
    settings.get('practice', null).then((st) => {
      const rec = st && st.songs && st.songs[id];
      if (!rec || !Object.keys(rec).length) return;
      const total = tabParts(stored.tab).filter((p) => p.kind === 'bars').length;
      const good = Object.entries(rec).filter(([k, r]) => k !== 'all' && r && r.best >= 80 && Number(k) < total).length;
      fillPractice(root.querySelector('.sp-card'), { good, total, played: true, done: !!(rec.all && rec.all.best >= 80) });
    }).catch(() => {});
  }
  // ---- Predlozi: taktovi koje treba proveriti (ništa se ne nagađa) ----
  function drawSug() {
    const fl = checkBars(stored.tab), info = barInfo(stored.tab);
    // kratko: jedan red „N takt(ova) za proveru“; dodir otvara spisak (Pokaži / U redu je)
    $('tSug').innerHTML = fl.length ? `<details class="card sug-card tab-sug tab-check"><summary><span class="tc-dot"></span><b>${t('tab.checkLine', { n: fl.length })}</b><span class="tc-more">${t('tab.show')}</span></summary>
      <p class="small muted">${t('tab.checkHint')}</p>
      ${fl.slice(0, 8).map((f) => `<div class="sug-item"><span class="sug-what"><b>${t('tab.bar', { n: f.bar + 1 })}</b> ${esc(t('tab.why.' + f.why, { sig: info[f.bar].sig }))}${f.note ? ` <span class="small muted">— ${esc(f.note)}</span>` : ''}</span>
        <span class="sug-actions"><button class="btn small" data-show="${f.bar}">${t('tab.show')}</button><button class="btn small" data-okbar="${f.bar}">${t('tab.okBar')}</button></span></div>`).join('')}</details>` : '';
  }
  // ---- Detalji: YouTube ----

  // ---- Tablatura ----
  let lastW = 0;
  function drawTab() {
    const fl = new Set(checkBars(stored.tab).map((f) => f.bar));
    drawStaff($('tStaff'), stored.tab, { flags: fl, zoom });
    lastW = $('tStaff').clientWidth;
  }
  const ro = new ResizeObserver(() => { if ($('tStaff') && Math.abs($('tStaff').clientWidth - lastW) > 4) drawTab(); });
  ro.observe($('tStaff'));
  const barEl = (bi) => $('tStaff')?.querySelector(`[data-bar="${bi}"]`);
  const mark = (bi, cls, on) => barEl(bi)?.classList.toggle(cls, on);
  const flash = (bi) => { const e = barEl(bi); if (!e) return; e.scrollIntoView({ block: 'center', behavior: 'smooth' }); e.classList.remove('pulse'); void e.getBBox(); e.classList.add('pulse'); };

  drawHead(); drawSug(); drawTab();
  if (!stored.seen) { stored.seen = true; save().catch(() => {}); }

  // ---- „Pusti“: cela pesma zvukom gitare (modul se učitava tek na dugme); tekuća nota i takt se ističu, ekran prati ----
  let ui = null, tlP = null, nowBar = -1;
  const markNow = (bi) => { if (nowBar === bi) return; if (nowBar >= 0) mark(nowBar, 'now', false); nowBar = bi; if (bi >= 0) mark(bi, 'now', true); };
  function onFrame(beat, si, fired) {
    const seg = tlP.segs[si];
    if (seg) markNow(seg.ref.bar);
    for (const e of fired) {
      const n = $('tStaff')?.querySelector(`[data-note="${e.ref.bar}-${e.ref.ni}"]`);
      if (n) { n.classList.remove('on'); void n.getBBox(); n.classList.add('on'); }
    }
    const row = barEl(nowBar)?.closest('.tb-row');
    if (row) { const d = row.getBoundingClientRect().top - window.innerHeight * 0.28; if (Math.abs(d) > 1) window.scrollBy(0, d * 0.08); }
  }
  async function ensurePlayer() {
    if (ui) return ui;
    const [sp, pl] = await Promise.all([import('./songPlay.js'), import('./songPlayer.js')]);
    if (!$('tScrollBar')) return null;
    tlP = sp.tabTimeline(stored, partName);
    $('tScrollBar').innerHTML = '';
    $('tScrollBar').classList.add('pl-host');
    ui = pl.mountPlayerBar($('tScrollBar'), tlP, { bpm, allowMute: true, onFrame, onStop: () => markNow(-1) });
    keepAwake('songplay');
    return ui;
  }
  /** Sviraj od takta bi (prvo pojavljivanje u redosledu sviranja). */
  async function playFromBar(bi) {
    const u = await ensurePlayer();
    if (!u) return;
    const k = tlP.segs.findIndex((x) => x.ref.bar === bi);
    u.startAt(k >= 0 ? tlP.segs[k].beat : 0);
  }
  $('tPlay').addEventListener('click', () => playFromBar(0));

  // ---- Tempo ----
  async function setBpm(v) {
    bpm = Math.max(30, Math.min(220, v));
    if ($('tTempo')) $('tTempo').textContent = bpm;
    if (ui) { ui.destroy(); ui = null; markNow(-1); ensurePlayer(); } // nov tempo pesme: traka iznova (zaustavljena)
    stored.bpm = bpm;
    await save();
  }
  $('tTempoDown').addEventListener('click', () => setBpm(bpm - 2));
  $('tTempoUp').addEventListener('click', () => setBpm(bpm + 2));
  // ---- Veličina ----
  const setZoom = async (z) => {
    zoom = Math.min(1.6, Math.max(0.8, Math.round(z * 10) / 10));
    if (zoom === 1) delete stored.zoom; else stored.zoom = zoom;
    drawTab(); await save();
  };
  // „⋯“: veličina slova (klizač), prethodne verzije; dva prsta = uvećanje
  $('tMore').addEventListener('click', async () => {
    const v = await moreMenu('song:' + id, songMenuItems(stored));
    if (v && /^(listen|tutorial)/.test(v)) { (await import('./ytPick.js')).ytAction(v.split(':')[0], stored, save, { change: v.endsWith(':change') }); return; }
    if (v === 'edit') location.hash = '#/uredi/' + encodeURIComponent(id);
  });
  bindZoomPill(root, { get: () => zoom, apply: (z) => { zoom = z; drawTab(); }, save: () => setZoom(zoom), min: 0.8, max: 1.6 });
  attachPinch($('tStaff'), { get: () => zoom, set: setZoom, min: 0.8, max: 1.6 });
  versionTipOnce('song:' + id);

  // ---- Dodiri ----
  root.addEventListener('click', async (e) => {
    const sh = e.target.closest('[data-show]'), ok = e.target.closest('[data-okbar]');
    if (sh) { flash(+sh.dataset.show); return; }
    if (ok) { stored.tab.bars[+ok.dataset.okbar].ok = 1; await save(); drawSug(); drawTab(); return; }
    const bar = e.target.closest('[data-bar]');
    if (bar && $('tStaff').contains(bar)) playFromBar(+bar.dataset.bar); // sviranje od tog takta
  });
  // ---- PDF i deljenje ----
  $('tPdf').addEventListener('click', async () => {
    const btn = $('tPdf'), old = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${t('song.makingPdf')}`;
    try {
      const { songToPdf } = await import('./pdf.js');
      const blob = await songToPdf(tabPdfSong(stored), { capoLabel: [t('tab.sig', { s: stored.tab.sig }), Number(stored.bpm) ? t('pdf.tempo', { n: stored.bpm }) : ''].filter(Boolean).join('  ·  ') });
      const r = await (await import('./shareService.js')).shareFile(blob, safeFileName(stored.title) + '.pdf', stored.title);
      if (r === 'downloaded') toast(t('song.pdfDownloaded'));
      if (await driveConnected()) {
        const d = await import('./drive.js');
        await d.initDrive();
        if (d.driveState().connected) d.savePdfToDrive(blob, stored).then(() => toast(t('song.pdfDrive'))).catch(() => toast(t('song.pdfDriveFailedGeneric'), 'error'));
      }
    } catch (err) { console.error(err); toast(t('song.pdfFailed'), 'error'); }
    finally { btn.disabled = false; btn.innerHTML = old; }
  });
  $('tShare').addEventListener('click', () => shareSong(stored).catch(() => toast(t('share.failed'), 'error')));

  // ---- Odlazak sa ekrana: zvuk i skrolovanje staju ----
  const onHash = () => { ui?.destroy(); ui = null; allowSleep('songplay'); ro.disconnect(); window.removeEventListener('hashchange', onHash); };
  window.addEventListener('hashchange', onHash);
}

/** TAB pesma za PDF: delovi po tonalitetu, tablatura po kolonama (pdf.js je već crta za pesme sa tablaturom). */
export function tabPdfSong(song) {
  const info = barInfo(song.tab), sections = [];
  let from = 0;
  for (let i = 1; i <= song.tab.bars.length; i++) {
    if (i === song.tab.bars.length || info[i].key !== info[i - 1].key) {
      sections.push({ name: `${t('tab.bars', { a: from + 1, b: i })}${info[from].key ? ' · ' + keyLabel(info[from].key) : ''}`, lines: [], tabs: [toColumns(song.tab, from, i - 1)] });
      from = i;
    }
  }
  return { title: song.title, artist: song.artist, key: info[0].key ? keyLabel(info[0].key) : '', sections };
}
