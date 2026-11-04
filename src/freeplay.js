// Akordi → „Samo sviraj“: živi prikaz sviranja na vratu gitare (pojedinačne note, dve note, akordi), sa
// tragovima koji blede i talasom koji prati jačinu i visinu; snimanje (do 10 min) u „Moji snimci“ kao tablatura,
// ponovno puštanje na vratu (samo slika, bez zvuka), preimenovanje i brisanje. Učitava se tek kad se otvori ovaj
// deo taba Akordi (ništa pri pokretanju aplikacije). Tuner i „Prepoznavanje“ se ne menjaju.
//
// Performanse (kao u igrama): raspored se pravi jednom; tačke su elementi iz bazena (12, najstarija se ponovo
// koristi), pomeraju se samo transform/opacity; jedna requestAnimationFrame petlja (talas + ponavljanje snimka);
// jeftin sjaj (radijalni gradijent / dve linije, bez blura); slušanje 50×/s, a težak deo samo posle trzaja.
import { t, LANGS, onLangChange, getLang } from './i18n.js';
import * as TEXTS from './freeplayText.js';
import { esc, toast } from './ui.js';
import { settings, songs as songsDb } from './db.js';
import { REC_FOLDER, ensureRecFolder } from './collections.js';
import { textToSections } from './songformat.js';
import { upgradeSong } from './songmodel.js';
import { openMic, closeMic, MicError } from './audio.js';
import { keepAwake, allowSleep } from './wakelock.js';
import { getRoom, roomToSensitivity } from './tunerSettings.js';
import { midiName } from './music.js';
import { dn } from './naming.js';
import { getVoicings } from './chords.js';
import { createFreeEngine } from './freeplayListen.js';
import { debugLog } from './practiceListen.js';

// Tekstovi i stilovi se učitavaju tek ovde
function mergeTexts() { Object.assign(LANGS.sr, TEXTS.sr); if (LANGS.en) Object.assign(LANGS.en, TEXTS.en); }
mergeTexts();
onLangChange(mergeTexts);
const cssReady = new Promise((resolve) => {
  if (document.getElementById('freeplayCss')) return resolve();
  const l = document.createElement('link');
  l.id = 'freeplayCss'; l.rel = 'stylesheet';
  l.href = new URL('./freeplay.css' + new URL(import.meta.url).search, import.meta.url).href;
  l.onload = l.onerror = () => resolve();
  document.head.appendChild(l);
  setTimeout(resolve, 1500);
});

const OPEN = [40, 45, 50, 55, 59, 64]; // E A D G H e (0 = debela E, gore)
const FRETS = 12, MAX_DOTS = 12, MAX_MS = 10 * 60 * 1000, REC_KEY = 'freeplayRecs', REC_V = 1;
const noteName = (m) => dn(midiName(m).name);
const sName = (s) => (s === 5 ? dn('E').toLowerCase() : noteName(OPEN[s]));
const pad2 = (n) => String(n).padStart(2, '0');
const clock = (ms) => `${Math.floor(ms / 60000)}:${pad2(Math.floor(ms / 1000) % 60)}`;

// ---------------- Položaj na vratu (nagađanje žice; nota je uvek tačna) ----------------
/** Pragovi 0–12; počinje kod prve pozicije; svaka nova nota u okviru ~4 praga od prethodnih (prati ruku). */
export function createPlacer() {
  let center = 2, lastS = 2;
  function cands(m, avoid = []) {
    const out = [];
    for (let s = 0; s < 6; s++) { const f = m - OPEN[s]; if (f >= 0 && f <= FRETS && !avoid.includes(s)) out.push({ s, f }); }
    return out;
  }
  function cost(c) {
    const d = c.f === 0 ? (center <= 4 ? center * 0.5 : 6) : Math.abs(c.f - center);
    return d + (d > 4 ? 10 : 0) + 0.3 * Math.abs(c.s - lastS);
  }
  return {
    place(m, avoid = []) {
      const cs = cands(m, avoid);
      if (!cs.length) return null;
      const best = cs.reduce((a, b) => (cost(b) < cost(a) ? b : a));
      if (best.f > 0) center = Math.max(1, Math.min(11, center * 0.5 + best.f * 0.5));
      lastS = best.s;
      return best;
    },
    /** Hvat akorda najbliži ruci (pragovi ≤ 12). */
    chord(name) {
      const vs = getVoicings(name).filter((v) => v.frets.every((f) => f <= FRETS));
      if (!vs.length) return null;
      const v = vs.reduce((a, b) => (Math.abs(b.baseFret - center) < Math.abs(a.baseFret - center) ? b : a));
      if (v.baseFret > 1) center = Math.max(1, Math.min(11, v.baseFret + 1));
      return v;
    },
    get center() { return center; },
    reset() { center = 2; lastS = 2; },
  };
}
/** Prst (boja) za prag u odnosu na položaj ruke: 0 = prazna žica, 1–4. */
const fingerAt = (f, center) => (f <= 0 ? 0 : Math.max(1, Math.min(4, f - Math.max(1, Math.round(center) - 1) + 1)));

// ---------------- Snimci (Moji snimci) ----------------
export async function loadRecs() { const r = await settings.get(REC_KEY, null); return Array.isArray(r) ? r : []; }
async function saveRecs(list) { await settings.set(REC_KEY, list); }

/** Jednostavna tablatura: šest linija (gore tanka e), pragovi redom kako su odsvirani. */
export function tabText(rec, width = 48, names = null) {
  const lines = names || ['e', 'H', 'G', 'D', 'A', 'E'].map((x, i) => (i === 0 ? dn('E').toLowerCase() : i === 1 ? dn('B') : x));
  const cols = rec.events.map((e) => {
    const col = ['', '', '', '', '', ''];
    for (const n of e.notes || []) if (n.s >= 0 && n.s < 6) col[5 - n.s] = String(n.f);
    const w = Math.max(1, ...col.map((x) => x.length));
    return col.map((x) => (x || '').padEnd(w, '-') + '-');
  });
  const out = [];
  for (let i = 0; i < Math.max(1, cols.length); i += width) {
    const part = cols.slice(i, i + width);
    out.push(lines.map((l, k) => `${l}|-${part.map((c) => c[k]).join('')}|`).join('\n'));
  }
  return out.join('\n\n');
}

// ---------------- Snimak → pesma u Pesme → „Moji snimci“ ----------------
/** Pesma od snimka: akordi redom (bez ponavljanja zaredom) + tablatura; snimak ostaje na pesmi za „Pusti na vratu“. */
export function recToSong(rec) {
  const chords = [];
  for (const e of rec.events) if (e.chord && chords[chords.length - 1] !== e.chord) chords.push(e.chord);
  const parts = [];
  if (chords.length) {
    const rows = [];
    for (let i = 0; i < chords.length; i += 8) rows.push(chords.slice(i, i + 8).join('   '));
    parts.push(`[${t('fp.chordsSec')}]`, ...rows, '');
  }
  const tabbed = { events: rec.events.filter((e) => (e.notes || []).length) };
  if (tabbed.events.length) parts.push(`[${t('fp.tab')}]`, tabText(tabbed, 32, ['e', 'B', 'G', 'D', 'A', 'E']));
  // akordi su u engleskom zapisu (B = H) → neutralni sloj; prikaz prati podešavanje imena nota
  const song = upgradeSong({ title: rec.name, artist: '', key: '', sections: textToSections(parts.join('\n')), cv: 0 }, { naming: 'en' });
  return { ...song, folders: [REC_FOLDER], recording: { v: REC_V, dur: rec.dur || 0, events: rec.events, recId: rec.id } };
}
/** Sačuvaj snimak kao pesmu (jednom: isti snimak se ne dodaje dvaput). */
async function saveRecAsSong(rec) {
  await ensureRecFolder();
  const have = (await songsDb.all()).find((s) => s.recording && s.recording.recId === rec.id);
  if (have) return have;
  return songsDb.save({ ...recToSong(rec), createdAt: rec.created || Date.now() });
}
/** Stari snimci (v1.36, u podešavanjima) prelaze u pesme; posle toga lista je prazna. */
async function migrateRecs() {
  const old = await loadRecs();
  if (!old.length) return;
  for (const r of old.slice().reverse()) { try { await saveRecAsSong(r); } catch {} }
  await saveRecs([]);
}
/** Pesme iz foldera „Moji snimci“ koje imaju snimak (najnovije prve). */
async function recSongs() {
  return (await songsDb.list()).filter((s) => (s.folders || []).includes(REC_FOLDER)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
/** Ekran pesme → „Pusti na vratu“. */
export async function replaySong(song) {
  await cssReady;
  if (!song || !song.recording || replaying) return;
  replaying = startReplay({ ...song.recording, name: song.title }, { onExit: () => (replaying = null) });
}
let replaying = null;

// ---------------- Pozornica (položeno): ime gore u sredini, vrat centriran, ekvilajzer, talas, snimanje ----------------
const FC = ['#dfe3e8', '#5aa9ff', '#ffd75e', '#ff7cc3', '#b48cff']; // boje prstiju (0 = prazna žica)
const rgba = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
// slabiji telefoni: ekvilajzer 30×/s (talas, tačke i talasanje žice ostaju 60×/s)
const WEAK = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 3;
const EQ_BARS = 28;
// pragovi kao na pravoj gitari, ali blago (55 % prava razdaljina, 45 % jednako) — da i 12. prag ostane dovoljno širok
const REAL = (f) => (1 - Math.pow(2, -f / 12)) / (1 - Math.pow(2, -(FRETS + 0.6) / 12));
const fretPos = (f) => 0.45 * (f / (FRETS + 0.6)) + 0.55 * REAL(f);

function createStage({ mode = 'live', rec = null, onExit, onSaved }) {
  const el = document.createElement('div');
  el.className = 'fpv';
  el.innerHTML = `
    <div class="fpv-top">
      <button class="fpv-x" aria-label="${t('fp.exit')}">✕</button>
      <div class="fpv-tools">
        ${mode === 'live' ? `<button class="fpv-rec" aria-label="${t('fp.record')}"><i></i><span>${t('fp.record')}</span></button>
        <button class="fpv-set" aria-label="${t('fp.settings')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4L10.6 6a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4L4.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg></button>` : `<span class="fpv-replay">${t('fp.replaying')}</span>`}
      </div>
    </div>
    <div class="fpv-band" aria-live="polite"><b></b><small></small><span class="fpv-msg"></span></div>
    <div class="fpv-neck">
      <canvas class="fpv-eq"></canvas>
      <canvas class="fpv-bg"></canvas>
      <canvas class="fpv-wave"></canvas>
      <div class="fpv-dots"></div>
      <div class="fpv-panel" hidden>
        <label>${t('fp.sens')} <input type="range" min="1" max="5" step="1" class="fpv-sens"></label>
        <small>${t('fp.sensHint')}</small>
      </div>
    </div>
    <div class="fpv-rotate"><div class="fpv-phone" aria-hidden="true"><i></i></div><b>${t('fp.rotate')}</b>
      <small>${t('fp.rotateWhy')}</small><small class="fpv-rot-hint" hidden>${t('fp.autoRotate')}</small>
      <button class="btn small fpv-x2">${t('fp.exit')}</button></div>`;
  document.body.appendChild(el);
  document.body.classList.add('fpv-open');
  const q = (s) => el.querySelector(s);
  const neck = q('.fpv-neck'), bg = q('.fpv-bg'), wave = q('.fpv-wave'), eqC = q('.fpv-eq'), dotsL = q('.fpv-dots');
  const band = q('.fpv-band'), nameB = q('.fpv-band b'), nameS = q('.fpv-band small'), msg = q('.fpv-msg');
  q('.fpv-x').addEventListener('click', () => onExit?.());
  q('.fpv-x2').addEventListener('click', () => onExit?.());

  // ---- Raspored (meri se jednom i kad se telefon okrene) ----
  // vrat je centriran i zauzima ~92 % širine: imena žica uz nulti prag, prazne žice (0) između njih i praga
  const G = { W: 0, H: 0, bx: 0, x0: 0, x1: 0, y0: 0, y1: 0, r: 12 };
  const fretX = (f) => G.x0 + fretPos(f) * (G.x1 - G.x0); // linija praga f
  const dotX = (f) => (f === 0 ? G.x0 - G.r * 1.3 : (fretX(f - 1) + fretX(f)) / 2);
  const strY = (s) => G.y0 + (s / 5) * (G.y1 - G.y0);
  function layout() {
    const w = neck.clientWidth, h = neck.clientHeight;
    if (!w || !h) return;
    G.W = w; G.H = h;
    G.r = Math.max(9, Math.min(h / 15, 22));
    G.bx = Math.round(w * 0.04);
    G.x0 = G.bx + G.r * 4; G.x1 = w - G.bx; G.y0 = h * 0.1; G.y1 = h * 0.8;
    neck.style.setProperty('--r', G.r + 'px');
    drawBg();
    sizeFx();
  }
  function drawBg() {
    const dpr = Math.min(2, window.devicePixelRatio || 1), c = bg.getContext('2d');
    bg.width = Math.round(G.W * dpr); bg.height = Math.round(G.H * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, G.W, G.H);
    // drvo vrata: tamno, ali providno — ekvilajzer iza se vidi
    const top = G.y0 - G.r * 1.3, bot = G.y1 + G.r * 1.3;
    const wood = c.createLinearGradient(0, top, 0, bot);
    wood.addColorStop(0, 'rgba(30,20,13,.66)'); wood.addColorStop(0.5, 'rgba(18,12,8,.6)'); wood.addColorStop(1, 'rgba(30,20,13,.66)');
    c.fillStyle = wood; c.fillRect(G.x0, top, G.x1 - G.x0, bot - top);
    // pragovi: metal (kao kod tunera); nulti prag deblji, kao koska
    for (let f = 0; f <= FRETS; f++) {
      const x = fretX(f), g = c.createLinearGradient(x - 2, 0, x + 2, 0);
      g.addColorStop(0, '#5d6168'); g.addColorStop(0.5, f === 0 ? '#f2eee4' : '#d9dce1'); g.addColorStop(1, '#5d6168');
      c.fillStyle = g; c.fillRect(x - (f === 0 ? 3 : 1.5), top, f === 0 ? 6 : 3, bot - top);
    }
    c.fillStyle = 'rgba(232,226,214,.3)';
    const mr = Math.min(G.r * 0.32, (fretX(12) - fretX(11)) * 0.2);
    for (const f of [3, 5, 7, 9]) { c.beginPath(); c.arc(dotX(f), (strY(2) + strY(3)) / 2, mr, 0, Math.PI * 2); c.fill(); }
    for (const yy of [(strY(1) + strY(2)) / 2, (strY(3) + strY(4)) / 2]) { c.beginPath(); c.arc(dotX(12), yy, mr, 0, Math.PI * 2); c.fill(); }
    // žice: čelik, deblje gore; imena žica odmah levo od praznih žica
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const lx = G.x0 - G.r * 3.1;
    for (let s = 0; s < 6; s++) {
      const th = 3.4 - s * 0.45, y = strY(s);
      const g = c.createLinearGradient(0, y - th, 0, y + th);
      g.addColorStop(0, '#8d9198'); g.addColorStop(0.5, '#eceef2'); g.addColorStop(1, '#6d7178');
      c.fillStyle = g; c.fillRect(G.x0 - G.r * 2.2, y - th / 2, G.x1 - G.x0 + G.r * 2.2, th);
      c.fillStyle = '#aab1bc'; c.font = `700 ${Math.round(Math.min(15, G.r * 0.9))}px system-ui, sans-serif`;
      c.fillText(sName(s), lx, y);
    }
    c.fillStyle = '#6b7280'; c.font = `600 ${Math.round(Math.min(11, G.r * 0.7))}px system-ui, sans-serif`;
    for (const f of [3, 5, 7, 9, 12]) c.fillText(String(f), dotX(f), bot + G.r * 0.75);
  }

  // ---- Tačke (bazen od 12; najstarija se ponovo koristi) ----
  const dots = Array.from({ length: MAX_DOTS }, () => { const d = document.createElement('i'); d.className = 'fpd'; d.innerHTML = '<b></b>'; dotsL.appendChild(d); return { el: d, at: -1e9, anim: null }; });
  function light(s, f, finger, strong = 1) {
    const d = dots.reduce((a, b) => (b.at < a.at ? b : a)); // najstarija
    d.at = performance.now();
    d.anim?.cancel();
    d.el.className = `fpd fc${finger}`;
    d.el.firstChild.textContent = String(f);
    const tr = `translate3d(${(dotX(f) - G.r * 1.5).toFixed(1)}px,${(strY(s) - G.r * 1.5).toFixed(1)}px,0)`;
    d.el.style.transform = tr;
    // zasvetli, pa ostavi trag koji bledi ~1 s
    d.anim = d.el.animate([
      { opacity: 1, transform: tr + ' scale(1.35)' },
      { opacity: 1, transform: tr + ' scale(1)', offset: 0.12 },
      { opacity: 0.85 * strong, transform: tr + ' scale(1)', offset: 0.3 },
      { opacity: 0, transform: tr + ' scale(.82)' },
    ], { duration: 1300, easing: 'ease-out', fill: 'forwards' });
    // žica zatitra od prsta do kobilice; ekvilajzer preuzima boju prsta
    ripples.push({ s, xa: f === 0 ? G.x0 - G.r * 2.2 : fretX(f), t0: d.at, col: FC[finger] || FC[0] });
    if (ripples.length > 8) ripples.shift();
    setEqColor(FC[finger] || FC[0]);
    wake();
  }
  let msgOn = false;
  function showName(main, sub = '', unsure = false) {
    if (msgOn) { msgOn = false; band.classList.remove('msg'); }
    if (nameB.textContent !== main) nameB.textContent = main;
    if (nameS.textContent !== sub) nameS.textContent = sub;
    band.classList.toggle('unsure', !!unsure);
    nameB.animate([{ transform: 'scale(1.15)', opacity: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 220, easing: 'ease-out' });
  }

  // ---- Efekti: ekvilajzer iza vrata (boja prsta + narandžasti sjaj), talas preko vrata, titranje žice ----
  let ectx = null, wctx = null;
  function sizeFx() {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    for (const cv of [wave, eqC]) { cv.width = Math.round(G.W * dpr); cv.height = Math.round(G.H * dpr); }
    wctx = wave.getContext('2d'); wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ectx = eqC.getContext('2d'); ectx.setTransform(dpr, 0, 0, dpr, 0, 0);
    eqGrad = null;
  }
  // ekvilajzer: 28 traka (80 Hz – 4 kHz, logaritamski), visina iz mikrofona (ili iz odsviranih nota pri ponavljanju)
  const EQ = { an: null, data: null, bins: [], v: new Float32Array(EQ_BARS), col: FC[1], dirty: false };
  let eqGrad = null, glowGrad = null;
  function setEqColor(c) { if (EQ.col !== c) { EQ.col = c; eqGrad = null; } }
  function grads() {
    const mid = (G.y0 + G.y1) / 2, c = ectx;
    eqGrad = c.createLinearGradient(0, 0, 0, G.H);
    eqGrad.addColorStop(0, rgba(EQ.col, 0)); eqGrad.addColorStop(0.3, rgba(EQ.col, 0.55)); eqGrad.addColorStop(mid / G.H, rgba(EQ.col, 0.95));
    eqGrad.addColorStop(0.7, rgba(EQ.col, 0.55)); eqGrad.addColorStop(1, rgba(EQ.col, 0));
    glowGrad = c.createLinearGradient(0, 0, 0, G.H);
    glowGrad.addColorStop(0, 'rgba(245,165,36,0)'); glowGrad.addColorStop(mid / G.H, 'rgba(245,165,36,.42)'); glowGrad.addColorStop(1, 'rgba(245,165,36,0)');
  }
  function attachEq(an) {
    EQ.an = an;
    EQ.data = new Uint8Array(an.frequencyBinCount);
    const binHz = an.context.sampleRate / an.fftSize;
    EQ.bins = Array.from({ length: EQ_BARS + 1 }, (_, i) => Math.max(1, Math.round((80 * Math.pow(4000 / 80, i / EQ_BARS)) / binHz)));
  }
  function eqPulse(hz, amt = 0.9) { // ponavljanje snimka: traka note (i njeni alikvoti) skoče
    for (const h of [1, 2, 3]) {
      const k = Math.floor((Math.log(hz * h / 80) / Math.log(4000 / 80)) * EQ_BARS);
      if (k >= 0 && k < EQ_BARS) EQ.v[k] = Math.max(EQ.v[k], amt / h);
    }
  }
  let eqSkip = false;
  function drawEq(dt) {
    if (WEAK && (eqSkip = !eqSkip)) return; // 30×/s na slabijim telefonima
    const v = EQ.v;
    let any = false;
    if (EQ.an) {
      EQ.an.getByteFrequencyData(EQ.data);
      for (let i = 0; i < EQ_BARS; i++) {
        let m = 0;
        for (let k = EQ.bins[i], e = Math.max(EQ.bins[i] + 1, EQ.bins[i + 1]); k < e; k++) if (EQ.data[k] > m) m = EQ.data[k];
        const want = Math.max(0, (m / 255 - 0.3) / 0.7);
        v[i] = want > v[i] ? v[i] + (want - v[i]) * 0.6 : v[i] * Math.exp(-dt * (WEAK ? 2 : 1) * 2.4);
        if (v[i] > 0.01) any = true;
      }
    } else for (let i = 0; i < EQ_BARS; i++) { v[i] *= Math.exp(-dt * (WEAK ? 2 : 1) * 2.4); if (v[i] > 0.01) any = true; }
    const c = ectx;
    if (!any) { if (EQ.dirty) { c.clearRect(0, 0, G.W, G.H); EQ.dirty = false; } return; }
    if (!eqGrad) grads();
    c.clearRect(0, 0, G.W, G.H);
    EQ.dirty = true;
    const mid = (G.y0 + G.y1) / 2, ex = G.x0 - G.r * 2.2, step = (G.x1 - ex) / EQ_BARS, bw = step * 0.56; // od praznih žica do kraja (imena žica ostaju čitljiva)
    c.fillStyle = glowGrad;
    for (let i = 0; i < EQ_BARS; i++) if (v[i] > 0.01) { const h = G.H * Math.min(1, 0.12 + v[i]); c.fillRect(ex + i * step + (step - bw) / 2 - 4, mid - h / 2, bw + 8, h); }
    c.fillStyle = eqGrad;
    for (let i = 0; i < EQ_BARS; i++) if (v[i] > 0.01) { const h = G.H * Math.min(1, v[i] * 0.95); c.fillRect(ex + i * step + (step - bw) / 2, mid - h / 2, bw, h); }
  }
  // talas (kao tunerov), sad 2–3× svetliji i preko vrata: jačina = visina, ton = gustina
  const W8 = { amp: 0, want: 0, hz: 3, wantHz: 3, phase: 0 };
  const ripples = [];
  let waveDirty = false;
  function drawWave(dt, now) {
    W8.amp += (W8.want - W8.amp) * (1 - Math.exp(-dt / (W8.want > W8.amp ? 0.08 : 0.5)));
    W8.hz += (W8.wantHz - W8.hz) * (1 - Math.exp(-dt / 0.25));
    W8.phase += dt * (1.2 + W8.amp * 3);
    const c = wctx;
    if (!waveDirty && W8.amp < 0.01 && !ripples.length) return;
    c.clearRect(0, 0, G.W, G.H);
    waveDirty = false;
    if (W8.amp >= 0.01) {
      waveDirty = true;
      const mid = (G.y0 + G.y1) / 2, a = (G.y1 - G.y0) * 0.5 * W8.amp, x0 = G.x0 - G.r * 2.2, w = G.x1 - x0;
      c.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const env = Math.sin((Math.PI * x) / w);
        const y = mid + env * a * Math.sin((x / w) * Math.PI * 2 * W8.hz + W8.phase) * (0.8 + 0.2 * Math.sin(x * 0.013 + W8.phase * 0.7));
        if (x) c.lineTo(x0 + x, y); else c.moveTo(x0, y);
      }
      const k = Math.min(1, W8.amp * 1.6);
      // jeftin sjaj: široka prozirna + srednja + tanka svetla linija (bez blura)
      c.lineWidth = 14; c.strokeStyle = `rgba(245,165,36,${(0.16 * k).toFixed(3)})`; c.stroke();
      c.lineWidth = 6; c.strokeStyle = `rgba(255,190,90,${(0.35 * k).toFixed(3)})`; c.stroke();
      c.lineWidth = 2.2; c.strokeStyle = `rgba(255,236,200,${(0.95 * k).toFixed(3)})`; c.stroke();
    }
    // titranje odsvirane žice (od prsta do kraja vrata), ~0,7 s
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i], k = (now - r.t0) / 700;
      if (k >= 1) { ripples.splice(i, 1); continue; }
      waveDirty = true;
      const y0 = strY(r.s), amp = G.r * 0.5 * (1 - k) * (1 - k), len = G.x1 - r.xa, ph = now * 0.05;
      c.beginPath();
      for (let j = 0; j <= 36; j++) {
        const u = j / 36, y = y0 + amp * Math.sin(Math.PI * u) * Math.sin(u * Math.PI * 6 - ph);
        if (j) c.lineTo(r.xa + u * len, y); else c.moveTo(r.xa, y);
      }
      c.lineWidth = 7; c.strokeStyle = rgba(r.col, (0.3 * (1 - k)).toFixed(3)); c.stroke();
      c.lineWidth = 2; c.strokeStyle = rgba('#ffffff', (0.85 * (1 - k)).toFixed(3)); c.stroke();
    }
  }

  // ---- Jedna petlja: ekvilajzer, talas, žice (+ ponavljanje snimka) ----
  let raf = 0, last = 0, sleeping = false, alive = true, replay = null;
  function frame(ts) {
    raf = 0;
    if (!alive || sleeping) return;
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0.016);
    last = ts;
    const now = performance.now();
    replay?.tick(now);
    if (G.W) { drawEq(dt); drawWave(dt, now); }
    raf = requestAnimationFrame(frame);
  }
  const wake = () => { if (!raf && alive && !sleeping) { last = 0; raf = requestAnimationFrame(frame); } };
  let resizeQ = 0;
  const onResize = () => { cancelAnimationFrame(resizeQ); resizeQ = requestAnimationFrame(() => alive && layout()); };
  window.addEventListener('resize', onResize);

  // ---- Okreni telefon ----
  const mq = window.matchMedia('(orientation: portrait)');
  let rotT = 0;
  const orientSubs = new Set();
  const onMq = () => {
    clearTimeout(rotT); q('.fpv-rot-hint').hidden = true;
    if (mq.matches) rotT = setTimeout(() => { q('.fpv-rot-hint').hidden = false; }, 4000);
    orientSubs.forEach((fn) => fn(mq.matches));
  };
  mq.addEventListener('change', onMq);
  onMq();

  const api = {
    el, light, showName, attachEq, eqPulse,
    /** Poruka u traci sa imenom („Sviraj nešto…“, greška mikrofona); ime se vraća sa sledećom notom. */
    message(text, err = false) {
      msgOn = !!text;
      if (msg.textContent !== (text || '')) msg.textContent = text || '';
      band.classList.toggle('msg', msgOn);
      band.classList.toggle('err', msgOn && err);
    },
    level(lv, hz) {
      const db = lv ? 20 * Math.log10(lv) : -100;
      W8.want = Math.max(0, Math.min(1, (db + 62) / 44));
      if (hz) W8.wantHz = 1.5 + Math.min(5, Math.log2(hz / 80) * 1.4);
    },
    dotPos: { dotX, strY },
    layout, wake,
    sleep(on) { sleeping = !!on; if (!sleeping) wake(); },
    isPortrait: () => mq.matches,
    onOrientation(fn) { orientSubs.add(fn); return () => orientSubs.delete(fn); },
    setReplay(r) { replay = r; },
    q,
    destroy() {
      if (!alive) return;
      alive = false;
      cancelAnimationFrame(raf); cancelAnimationFrame(resizeQ);
      window.removeEventListener('resize', onResize);
      mq.removeEventListener('change', onMq);
      clearTimeout(rotT);
      dots.forEach((d) => d.anim?.cancel());
      orientSubs.clear();
      EQ.an = null;
      el.remove();
      document.body.classList.remove('fpv-open');
    },
  };
  requestAnimationFrame(() => { layout(); wake(); });
  return api;
}

// ---------------- Živo sviranje ----------------
async function startLive({ onExit, onSaved }) {
  const stage = createStage({ mode: 'live', onExit: () => finish(), onSaved });
  const placer = createPlacer();
  let eqAn = null;
  let mic = null, an = null, buf = null, timer = 0, engine = null, alive = true, lastEvent = performance.now(), quietShown = false;
  let recording = null; // { start, events: [], ids: Map }
  let sens = 3;
  try { sens = Math.max(1, Math.min(5, Number(localStorage.getItem('gitara-fp-sens')) || 3)); } catch {}
  const senseInput = stage.q('.fpv-sens');
  senseInput.value = String(sens);
  senseInput.addEventListener('input', () => {
    sens = +senseInput.value;
    engine?.setSensitivity(sens);
    try { localStorage.setItem('gitara-fp-sens', String(sens)); } catch {}
  });
  stage.q('.fpv-set').addEventListener('click', () => { const p = stage.q('.fpv-panel'); p.hidden = !p.hidden; });
  stage.q('.fpv-rec').addEventListener('click', () => (recording ? stopRec(true) : startRec()));
  stage.message(t('fp.quiet'));
  quietShown = true;

  // ---- Snimanje ----
  let recT = 0;
  function startRec() {
    recording = { start: performance.now(), events: [], ids: new Map() };
    stage.el.classList.add('recording');
    const lbl = stage.q('.fpv-rec span');
    const upd = () => {
      if (!recording) return;
      const ms = performance.now() - recording.start;
      lbl.textContent = clock(ms);
      if (ms >= MAX_MS) { stopRec(true); toast(t('fp.maxLen')); return; }
      recT = setTimeout(upd, 500);
    };
    upd();
  }
  async function stopRec(save) {
    if (!recording) return;
    const r = recording; recording = null;
    clearTimeout(recT);
    stage.el.classList.remove('recording');
    stage.q('.fpv-rec span').textContent = t('fp.record');
    if (!save || !r.events.length) { if (save) toast(t('fp.emptyRec')); return; }
    const created = Date.now(), dur = Math.round(performance.now() - r.start);
    const d = new Date(created);
    const rec = { v: REC_V, id: 'r' + created.toString(36), name: t('fp.recName', { d: `${d.getDate()}.${d.getMonth() + 1}. ${pad2(d.getHours())}:${pad2(d.getMinutes())}` }), created, dur, events: r.events.map(({ id, ...e }) => e) };
    try { await saveRecAsSong(rec); toast(t('fp.saved')); } catch { toast(t('fp.saveFail'), 'error'); }
    onSaved?.();
  }
  function recordEvent(ev, notes, chord) {
    if (!recording) return;
    const e = { id: ev.id, t: Math.max(0, Math.round(ev.at - recording.start)), notes: notes.map((n) => ({ m: n.m, s: n.s, f: n.f })) };
    if (chord) e.chord = chord;
    const k = recording.ids.get(ev.id);
    if (k != null) recording.events[k] = e; else { recording.ids.set(ev.id, recording.events.length); recording.events.push(e); }
  }

  // ---- Prikaz događaja ----
  function show(ev) {
    lastEvent = performance.now();
    if (quietShown) { quietShown = false; stage.message(''); }
    let notes = [];
    if (ev.chord) {
      const v = placer.chord(ev.chord);
      if (v) for (let s = 0; s < 6; s++) if (v.frets[s] >= 0) notes.push({ m: OPEN[s] + v.frets[s], s, f: v.frets[s], finger: v.frets[s] === 0 ? 0 : (v.fingers[s] || 1) });
      // „Am?“ (blaža boja) = verovatno taj akord; potvrdi se pri drugom pogledu ili ako se ponovi
      stage.showName(dn(ev.chord) + (ev.sure === false ? '?' : ''), '', ev.sure === false);
    } else {
      const used = [];
      for (const m of ev.midis) {
        const p = placer.place(m, used);
        if (!p) continue;
        used.push(p.s);
        notes.push({ m, s: p.s, f: p.f, finger: fingerAt(p.f, placer.center) });
      }
      if (!notes.length) return;
      stage.showName(notes.map((n) => noteName(n.m)).join(' + '), notes.length === 1 ? t('fp.where', { s: sName(notes[0].s), f: notes[0].f }) : '');
      stage.level(Math.max(0.01, lastLevel), 440 * Math.pow(2, (notes[0].m - 69) / 12));
    }
    notes.forEach((n) => stage.light(n.s, n.f, n.finger));
    recordEvent(ev, notes, ev.chord || null);
    debugLog({ game: 'free', type: ev.type, heard: ev.chord || ev.midis.map((m) => midiName(m).name + midiName(m).octave).join('+'), sure: ev.sure ?? null, ms: Math.round(performance.now() - ev.at) });
  }

  // ---- Mikrofon (zajednički, kao igre; pri izlasku se potpuno pušta) ----
  let lastLevel = 0, paused = false;
  function poll() {
    if (!alive || paused) return;
    an.getFloatTimeDomainData(buf);
    const r = engine.process(buf, performance.now());
    lastLevel = r.level;
    stage.level(r.level);
    for (const ev of r.events) show(ev);
    if (!quietShown && performance.now() - lastEvent > 5000) { quietShown = true; stage.message(t('fp.quiet')); }
  }
  function pause(on) {
    if (paused === on) return;
    paused = on;
    clearInterval(timer); timer = 0;
    stage.sleep(on);
    if (on) allowSleep('freeplay'); else { keepAwake('freeplay'); timer = setInterval(poll, 20); }
  }
  async function begin() {
    try {
      mic = await openMic();
    } catch (e) {
      // jasna poruka (za odbijen mikrofon i kako da se dozvoli — ista kao u tuneru)
      stage.message(e instanceof MicError ? e.message : t('fp.micDenied'), true);
      return;
    }
    if (!alive) { closeMic(); return; }
    an = mic.ctx.createAnalyser();
    an.fftSize = 8192; an.smoothingTimeConstant = 0;
    mic.source.connect(an);
    buf = new Float32Array(an.fftSize);
    // ekvilajzer: poseban mali analizator (2048), čita ga samo petlja crtanja
    eqAn = mic.ctx.createAnalyser();
    eqAn.fftSize = 2048; eqAn.smoothingTimeConstant = 0.5; eqAn.minDecibels = -92; eqAn.maxDecibels = -28;
    mic.source.connect(eqAn);
    stage.attachEq(eqAn);
    // osetljivost sobe iz tunera kao polazna (Auto), pa sopstveno merenje buke pri otvaranju
    const roomSens = roomToSensitivity(await getRoom());
    if (!localStorage.getItem('gitara-fp-sens')) { sens = roomSens === 'high' ? 4 : roomSens === 'low' ? 2 : 3; senseInput.value = String(sens); }
    engine = createFreeEngine({ sr: mic.ctx.sampleRate, a4: Number(await settings.get('a4', 440)) || 440, sensitivity: sens });
    paused = true;
    pause(stage.isPortrait());
  }
  const offOrient = stage.onOrientation((p) => { if (mic) pause(p); });
  const onHide = () => { if (document.hidden) finish(); };
  document.addEventListener('visibilitychange', onHide);

  async function finish() {
    if (!alive) return;
    alive = false;
    if (recording) await stopRec(true);
    clearInterval(timer); clearTimeout(recT);
    offOrient(); document.removeEventListener('visibilitychange', onHide);
    try { if (mic && an) mic.source.disconnect(an); } catch {}
    try { if (mic && eqAn) mic.source.disconnect(eqAn); } catch {}
    eqAn = null;
    if (mic) closeMic();
    mic = null; an = null; buf = null; engine = null;
    allowSleep('freeplay');
    stage.destroy();
    onExit?.();
  }
  begin();
  return { stop: finish };
}

// ---------------- Ponovno puštanje snimka (samo slika, bez zvuka) ----------------
function startReplay(rec, { onExit }) {
  const stage = createStage({ mode: 'replay', rec, onExit: () => finish() });
  const placer = createPlacer();
  let i = 0, t0 = performance.now() + 800, alive = true;
  keepAwake('freeplay');
  stage.message('');
  stage.setReplay({
    tick(now) {
      const tt = now - t0;
      while (i < rec.events.length && rec.events[i].t <= tt) {
        const e = rec.events[i++];
        const notes = e.notes || [];
        notes.forEach((n) => stage.light(n.s, n.f, n.f === 0 ? 0 : fingerAt(n.f, placer.center)));
        if (notes[0]) stage.eqPulse(440 * Math.pow(2, (notes[0].m - 69) / 12));
        if (e.chord) stage.showName(dn(e.chord));
        else if (notes.length) stage.showName(notes.map((n) => noteName(n.m)).join(' + '), notes.length === 1 ? t('fp.where', { s: sName(notes[0].s), f: notes[0].f }) : '');
        if (notes[0]) { placer.place(notes[0].m); stage.level(0.05, 440 * Math.pow(2, (notes[0].m - 69) / 12)); }
      }
      if (i >= rec.events.length && tt > (rec.events.at(-1)?.t || 0) + 1500) { stage.message(t('fp.replayDone')); stage.level(0); }
    },
  });
  const onHide = () => { if (document.hidden) finish(); };
  document.addEventListener('visibilitychange', onHide);
  const offOrient = stage.onOrientation((p) => { stage.sleep(p); if (!p) t0 = performance.now() - ((rec.events[i - 1]?.t) || 0); });
  if (stage.isPortrait()) stage.sleep(true);
  function finish() {
    if (!alive) return;
    alive = false;
    document.removeEventListener('visibilitychange', onHide);
    offOrient();
    allowSleep('freeplay');
    stage.destroy();
    onExit?.();
  }
  return { stop: finish };
}

// ---------------- Deo taba „Akordi“: uvod, „Samo sviraj“ i prečica do Moji snimci (pesme) ----------------
export async function createFreePane(host) {
  await cssReady;
  host.innerHTML = `
    <div class="fp-pane">
      <p class="muted">${t('fp.intro')}</p>
      <button class="btn primary big wide fp-go" id="fpGo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>${t('fp.start')}</button>
      <div class="fp-h"><h3>${t('fp.myRecs')}</h3><a href="#/pesme" id="fpAll" class="small">${t('fp.allInSongs')}</a></div>
      <ul class="fp-recs" id="fpRecs"></ul>
    </div>`;
  const $ = (id) => host.querySelector('#' + id);
  let active = null;

  async function drawList() {
    await migrateRecs().catch(() => {});
    const list = await recSongs();
    $('fpRecs').innerHTML = list.length ? list.slice(0, 20).map((r) => `<li data-id="${esc(r.id)}">
        <a class="fp-open" href="#/pesma/${encodeURIComponent(r.id)}"><b>${esc(r.title)}</b><small>${new Date(r.createdAt || 0).toLocaleDateString(getLang() === 'en' ? 'en' : 'sr-Latn')}${r.hasTabs ? ' · ' + t('fp.tab') : ''}</small></a>
        <button class="icon-btn" data-act="play" aria-label="${t('fp.replay')}" title="${t('fp.replay')}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
      </li>`).join('') : `<li class="muted fp-empty">${t('fp.noRecs')}</li>`;
  }
  $('fpAll').addEventListener('click', () => { try { localStorage.setItem('gitara-folder', REC_FOLDER); } catch {} });
  $('fpRecs').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act="play"]'); if (!b || active) return;
    const song = await songsDb.get(b.closest('li').dataset.id);
    if (song?.recording) active = startReplay({ ...song.recording, name: song.title }, { onExit: () => (active = null) });
  });
  $('fpGo').addEventListener('click', async () => {
    if (active) return;
    active = await startLive({ onExit: () => { active = null; drawList(); }, onSaved: () => drawList() });
  });
  drawList();
  return { stop() { active?.stop(); active = null; } };
}
