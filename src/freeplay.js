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
import { cleanEvents, estimateTempo, beatTabs } from './recTools.js';
import { openMic, closeMic, MicError } from './audio.js';
import { keepAwake, allowSleep } from './wakelock.js';
import { midiName } from './music.js';
import { dn } from './naming.js';
import { createPlacer, fingerAt } from './freeplayPlace.js';
import { createMonoEngine } from './freeplayMono.js';
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

let handLock = null; // zaključana ruka (prag), dok je aplikacija otvorena
// Položaj na vratu: freeplayPlace.js (ruka na jednom mestu; dodir na vrat = zaključaj ruku na tom pragu)

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
  // čišćenje (tišina na početku, „Am?“ bez potvrde, dvostruko očitan akord); original ostaje u `raw`
  const c = cleanEvents(rec.events);
  const events = c.events.length ? c.events : rec.events;
  const tempo = estimateTempo(events);
  const chords = [];
  for (const e of events) if (e.chord && chords[chords.length - 1] !== e.chord) chords.push(e.chord);
  const rows = [];
  for (let i = 0; i < chords.length; i += 8) rows.push(chords.slice(i, i + 8).join('   '));
  const sections = rows.length ? textToSections([`[${t('fp.chordsSec')}]`, ...rows].join('\n')) : [];
  const tabbed = events.filter((e) => (e.notes || []).length);
  if (tabbed.length) {
    // u ritmu (taktovi, osmine) kad se tempo čuje; inače note redom
    const tabs = tempo ? beatTabs(tabbed, tempo) : textToSections(tabText({ events: tabbed }, 32, ['e', 'B', 'G', 'D', 'A', 'E'])).flatMap((x) => x.tabs || []);
    if (tabs.length) sections.push({ name: t('fp.tab'), lines: [], tabs });
  }
  // akordi su u engleskom zapisu (B = H) → neutralni sloj; prikaz prati podešavanje imena nota
  const song = upgradeSong({ title: rec.name, artist: '', key: '', sections, cv: 0 }, { naming: 'en' });
  const recording = { v: REC_V, dur: c.changed ? c.dur : rec.dur || 0, events, recId: rec.id };
  if (c.changed && rec.events.length <= 5000) recording.raw = rec.events;
  return { ...song, ...(tempo && tempo.bpm >= 40 && tempo.bpm <= 220 ? { bpm: tempo.bpm } : {}), folders: [REC_FOLDER], recording };
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
        <button class="fpv-set" aria-label="${t('fp.settings')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4L10.6 6a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4L4.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg></button>` : `<span class="fpv-replay">${t('fp.replaying')}</span><button class="fpv-speed" aria-label="${t('fp.speed')}">1×</button>`}
      </div>
    </div>
    <div class="fpv-band" aria-live="polite"><b></b><small></small><span class="fpv-msg"></span></div>
    <div class="fpv-neck">
      <canvas class="fpv-eq"></canvas>
      <canvas class="fpv-bg"></canvas>
      <canvas class="fpv-wave"></canvas>
      <div class="fpv-hand" hidden><span></span></div>
      <div class="fpv-dots"></div>
      <div class="fpv-panel" hidden>
        <label>${t('fp.sens')} <input type="range" min="1" max="5" step="1" class="fpv-sens"></label>
        <small>${t('fp.sensHint')}</small>
        <small>${t('fp.handHint')}</small>
        <small class="fpv-mic"></small>
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
  const strY = (s) => G.y0 + ((5 - s) / 5) * (G.y1 - G.y0); // tanka e gore, debela E dole (s: 0 = debela E)
  function layout() {
    const w = neck.clientWidth, h = neck.clientHeight;
    if (!w || !h) return;
    G.W = w; G.H = h;
    G.r = Math.max(9, Math.min(h / 15, 22));
    G.bx = Math.round(w * 0.04);
    G.x0 = G.bx + G.r * 4; G.x1 = w - G.bx; G.y0 = h * 0.1; G.y1 = h * 0.8;
    neck.style.setProperty('--r', G.r + 'px');
    drawBg();
    placeHand();
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

  // ---- Zaključana ruka: providna traka preko pragova lo … lo+3 (dodir na vrat zaključava / otključava) ----
  const handEl = q('.fpv-hand');
  let handLo = null;
  function placeHand() {
    if (handLo == null || !G.W) { handEl.hidden = true; return; }
    const xa = handLo <= 1 ? G.x0 - G.r * 2.2 : fretX(handLo - 1), xb = fretX(Math.min(FRETS, handLo + 3));
    handEl.style.transform = `translate3d(${xa.toFixed(1)}px,${(G.y0 - G.r * 1.3).toFixed(1)}px,0)`;
    handEl.style.width = (xb - xa).toFixed(1) + 'px';
    handEl.style.height = (G.y1 - G.y0 + G.r * 2.6).toFixed(1) + 'px';
    handEl.firstChild.textContent = handLo <= 1 ? t('fp.handOpen') : t('fp.handAt', { f: handLo });
    handEl.hidden = false;
  }
  /** Prag ispod tačke x (0 = prazne žice / glava vrata). */
  function fretAtX(x) {
    if (x < G.x0) return 0;
    for (let f = 1; f <= FRETS; f++) if (x <= fretX(f)) return f;
    return FRETS;
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
    const span = (G.y1 - G.y0) * 0.2 / G.H, mm = mid / G.H;
    eqGrad.addColorStop(0, rgba(EQ.col, 0)); eqGrad.addColorStop(Math.max(0, mm - span), rgba(EQ.col, 0.12)); eqGrad.addColorStop(mm, rgba(EQ.col, 0.38));
    eqGrad.addColorStop(Math.min(1, mm + span), rgba(EQ.col, 0.12)); eqGrad.addColorStop(1, rgba(EQ.col, 0));
    glowGrad = c.createLinearGradient(0, 0, 0, G.H);
    glowGrad.addColorStop(0, 'rgba(245,165,36,0)'); glowGrad.addColorStop(mm, 'rgba(245,165,36,.14)'); glowGrad.addColorStop(1, 'rgba(245,165,36,0)');
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
    if (WEAK && (eqSkip = !eqSkip)) return false; // 30×/s na slabijim telefonima
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
    if (!any) { if (EQ.dirty) { c.clearRect(0, 0, G.W, G.H); EQ.dirty = false; } return true; }
    if (!eqGrad) grads();
    c.clearRect(0, 0, G.W, G.H);
    EQ.dirty = true;
    const mid = (G.y0 + G.y1) / 2, ex = G.x0 - G.r * 2.2, step = (G.x1 - ex) / EQ_BARS, bw = step * 0.56; // od praznih žica do kraja (imena žica ostaju čitljiva)
    // niske, diskretne trake (najviše ~1/3 vrata) — tačke na vratu moraju biti najuočljivije
    const maxH = (G.y1 - G.y0) * 0.36;
    c.fillStyle = glowGrad;
    for (let i = 0; i < EQ_BARS; i++) if (v[i] > 0.01) { const h = maxH * Math.min(1, 0.1 + v[i]); c.fillRect(ex + i * step + (step - bw) / 2 - 3, mid - h / 2, bw + 6, h); }
    c.fillStyle = eqGrad;
    for (let i = 0; i < EQ_BARS; i++) if (v[i] > 0.01) { const h = maxH * Math.min(1, v[i]); c.fillRect(ex + i * step + (step - bw) / 2, mid - h / 2, bw, h); }
    return true;
  }
  // talas (kao tunerov), sad 2–3× svetliji i preko vrata: jačina = visina, ton = gustina
  const W8 = { amp: 0, want: 0, hz: 3, wantHz: 3, phase: 0 };
  const ripples = [];
  let waveDirty = false;
  function drawWave(dt, now, eqRan) {
    W8.amp += (W8.want - W8.amp) * (1 - Math.exp(-dt / (W8.want > W8.amp ? 0.08 : 0.5)));
    W8.hz += (W8.wantHz - W8.hz) * (1 - Math.exp(-dt / 0.25));
    W8.phase += dt * (1.2 + W8.amp * 3);
    const c = wctx;
    // talas se crta na donje platno samo kad je ono upravo osveženo (inače bi se tragovi nagomilali)
    if (eqRan && W8.amp >= 0.01) drawWaveLine();
    if (!waveDirty && !ripples.length) return;
    c.clearRect(0, 0, G.W, G.H);
    waveDirty = false;
    drawRipples(now);
  }
  // talas: ISPOD vrata (na donjem platnu, posle traka), tanak i prigušen
  function drawWaveLine() {
    const c = ectx;
    {
      const mid = (G.y0 + G.y1) / 2, a = (G.y1 - G.y0) * 0.5 * W8.amp, x0 = G.x0 - G.r * 2.2, w = G.x1 - x0;
      c.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const env = Math.sin((Math.PI * x) / w);
        const y = mid + env * a * Math.sin((x / w) * Math.PI * 2 * W8.hz + W8.phase) * (0.8 + 0.2 * Math.sin(x * 0.013 + W8.phase * 0.7));
        if (x) c.lineTo(x0 + x, y); else c.moveTo(x0, y);
      }
      const k = Math.min(1, W8.amp * 1.6);
      // jeftin sjaj bez blura: široka prozirna + tanka linija
      c.lineWidth = 6; c.strokeStyle = `rgba(245,165,36,${(0.08 * k).toFixed(3)})`; c.stroke();
      c.lineWidth = 1.4; c.strokeStyle = `rgba(255,214,150,${(0.4 * k).toFixed(3)})`; c.stroke();
      EQ.dirty = true;
    }
  }
  function drawRipples(now) {
    const c = wctx;
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
    if (G.W) { const ran = drawEq(dt); drawWave(dt, now, ran); }
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
    /** Traka zaključane ruke (null = sakrij). */
    hand(lo) { handLo = lo; placeHand(); },
    /** Dodir na vrat → fn(prag). */
    onNeckTap(fn) { neck.addEventListener('click', (e) => { if (e.target.closest('.fpv-panel')) return; const r = neck.getBoundingClientRect(); fn(fretAtX(e.clientX - r.left)); }); },
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

// Osetljivost (1–5) za novi motor: 3 = izmereno najbolje; manje = traži jači/oštriji napad, više = hvata i tiše trzaje
const SENS_MONO = {
  1: { riseDb: 6.5, newDb: 0, aboveBgDb: 11 },
  2: { riseDb: 5.5, newDb: -0.8, aboveBgDb: 10 },
  3: { riseDb: 4.5, newDb: -1.5, aboveBgDb: 9 },
  4: { riseDb: 3.8, newDb: -2.2, aboveBgDb: 8 },
  5: { riseDb: 3.2, newDb: -3, aboveBgDb: 7 },
};

// ---------------- Mikrofon: AudioWorklet (mali blokovi, mala latencija) ----------------
// Procesor samo prosleđuje uzorke (po 256) glavnoj niti; ništa ne pušta na zvučnik.
const WORKLET_SRC = `class FpTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(256); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) { this.buf[this.n++] = ch[i]; if (this.n === 256) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Float32Array(256); this.n = 0; } }
    return true;
  }
}
registerProcessor('fp-tap', FpTap);`;
const workletReady = new WeakMap();
/** Uzorci mikrofona u malim blokovima (AudioWorklet; ako ga nema — ScriptProcessor). Vraća { stop }. */
async function tapMic(mic, onBlock) {
  const ctx = mic.ctx;
  if (ctx.audioWorklet && window.AudioWorkletNode) {
    try {
      if (!workletReady.has(ctx)) {
        const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
        workletReady.set(ctx, ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url)));
      }
      await workletReady.get(ctx);
      const node = new AudioWorkletNode(ctx, 'fp-tap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' });
      node.port.onmessage = (e) => onBlock(e.data);
      mic.source.connect(node);
      return { kind: 'worklet', stop() { try { mic.source.disconnect(node); } catch {} node.port.onmessage = null; } };
    } catch {}
  }
  const sp = ctx.createScriptProcessor(512, 1, 1), sink = ctx.createGain();
  sink.gain.value = 0;
  sp.onaudioprocess = (e) => onBlock(new Float32Array(e.inputBuffer.getChannelData(0)));
  mic.source.connect(sp); sp.connect(sink); sink.connect(ctx.destination);
  return { kind: 'script', stop() { try { mic.source.disconnect(sp); sp.disconnect(); sink.disconnect(); } catch {} sp.onaudioprocess = null; } };
}

// ---------------- Živo sviranje ----------------
async function startLive({ onExit, onSaved }) {
  const stage = createStage({ mode: 'live', onExit: () => finish(), onSaved });
  const placer = createPlacer({ frets: FRETS });
  let eqAn = null, tap = null, mono = null, noisy = false;
  let mic = null, timer = 0, alive = true, lastEvent = performance.now(), quietShown = false;
  // ruka: dodir na vrat zaključa položaj (prst 1 na taj prag), dodir u traku vraća automatski; pamti se dok je aplikacija otvorena
  function setLock(L) {
    placer.lock(L); handLock = placer.locked;
    stage.hand(handLock == null ? null : Math.max(1, handLock));
  }
  setLock(handLock);
  stage.onNeckTap((f) => {
    const L = placer.locked;
    const inBand = L != null && f >= (L <= 1 ? 0 : L) && f <= L + 3;
    setLock(inBand ? null : Math.max(1, f));
    toast(t(inBand ? 'fp.handAuto' : 'fp.handLocked'));
  });
  let recording = null; // { start, events: [], ids: Map }
  // osetljivost: sredina (3) uz automatsko merenje sobe; pamti se samo ako je korisnik pomeri (novi ključ za v2 motor)
  let sens = 3;
  try { sens = Math.max(1, Math.min(5, Number(localStorage.getItem('gitara-fp-sens2')) || 3)); } catch {}
  const senseInput = stage.q('.fpv-sens');
  senseInput.value = String(sens);
  senseInput.addEventListener('input', () => {
    sens = +senseInput.value;
    mono?.setParams(SENS_MONO[sens]);
    try { localStorage.setItem('gitara-fp-sens2', String(sens)); } catch {}
  });
  stage.q('.fpv-set').addEventListener('click', () => { const p = stage.q('.fpv-panel'); p.hidden = !p.hidden; });
  stage.q('.fpv-rec').addEventListener('click', () => (recording ? stopRec(true) : startRec()));
  // prvi put: kratak savet (tiha soba)
  let tipShown = false;
  try { tipShown = localStorage.getItem('gitara-fp-tip') === '1'; localStorage.setItem('gitara-fp-tip', '1'); } catch {}
  stage.message(tipShown ? t('fp.quiet') : t('fp.quiet') + '\n' + t('fp.tipQuiet'));
  // jednom: savet o zaključavanju ruke
  try { if (localStorage.getItem('gitara-fp-handtip') !== '1') { localStorage.setItem('gitara-fp-handtip', '1'); setTimeout(() => alive && toast(t('fp.handHint')), 2500); } } catch {}
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
    if (chord && ev.sure === false) e.u = 1; // „Am?“: pri čuvanju ostaje samo ako se potvrdi
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
        const p = placer.place(m, used, ev.at);
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
  // Sve (note, akordi, jačina za talas) dolazi iz jednog motora (freeplayMono) — blok po blok iz AudioWorklet-a.
  let lastLevel = 0, paused = false;
  function status() {
    if (!alive || paused) return;
    stage.level(lastLevel);
    // buka: previše buke u sobi → poruka umesto nagađanja
    const nowNoisy = mono ? (noisy ? mono.floorDb > -44 : mono.floorDb > -40 && mono.now() > 2000) : false;
    if (nowNoisy !== noisy) { noisy = nowNoisy; stage.message(noisy ? t('fp.noisy') : t('fp.quiet')); quietShown = !noisy; if (noisy) quietShown = false; }
    if (!noisy && !quietShown && performance.now() - lastEvent > 5000) { quietShown = true; stage.message(t('fp.quiet')); }
  }
  function onBlock(block) {
    if (!alive || paused || !mono) return;
    // jačina (RMS bloka, sporo opada) za talas
    let e = 0;
    for (let i = 0; i < block.length; i++) e += block[i] * block[i];
    const rms = Math.sqrt(e / (block.length || 1));
    lastLevel = rms > lastLevel ? rms : lastLevel * 0.97 + rms * 0.03;
    const evs = mono.push(block);
    if (noisy) return;
    for (const ev of evs) {
      // vreme napada u performance.now() skali (za snimak i položaj ruke)
      const at = performance.now() - (mono.now() - ev.at);
      show({ ...ev, at });
      if (ev.type !== 'chord') debugLog({ game: 'free', type: 'mono', heard: midiName(ev.midis[0]).name + midiName(ev.midis[0]).octave, cents: ev.cents, kind: ev.kind, ms: Math.round(ev.t - ev.at) });
    }
  }
  function pause(on) {
    if (paused === on) return;
    paused = on;
    clearInterval(timer); timer = 0;
    stage.sleep(on);
    if (on) allowSleep('freeplay'); else { keepAwake('freeplay'); timer = setInterval(status, 50); }
  }
  async function begin() {
    window.dispatchEvent(new Event('gitara-mic')); // bez sviranja pesme dok mikrofon sluša
    try {
      mic = await openMic();
    } catch (e) {
      // jasna poruka (za odbijen mikrofon i kako da se dozvoli — ista kao u tuneru)
      stage.message(e instanceof MicError ? e.message : t('fp.micDenied'), true);
      return;
    }
    if (!alive) { closeMic(); return; }
    // ekvilajzer: poseban mali analizator (2048), čita ga samo petlja crtanja
    eqAn = mic.ctx.createAnalyser();
    eqAn.fftSize = 2048; eqAn.smoothingTimeConstant = 0.5; eqAn.minDecibels = -92; eqAn.maxDecibels = -28;
    mic.source.connect(eqAn);
    stage.attachEq(eqAn);
    const a4 = Number(await settings.get('a4', 440)) || 440;
    mono = createMonoEngine({ sr: mic.ctx.sampleRate, a4, params: SENS_MONO[sens] });
    tap = await tapMic(mic, onBlock);
    if (!alive) { tap.stop(); return; }
    // šta je telefon zaista dao (eho/šum/pojačanje treba da budu isključeni — inače menjaju ton i napade)
    try {
      const st = mic.stream.getAudioTracks()[0].getSettings();
      const off = (v) => v === false || v === undefined;
      const ok = off(st.echoCancellation) && off(st.noiseSuppression) && off(st.autoGainControl);
      stage.q('.fpv-mic').textContent = t(ok ? 'fp.micOk' : 'fp.micProcessed', { sr: Math.round(mic.ctx.sampleRate / 100) / 10, path: tap.kind === 'worklet' ? 'AudioWorklet' : 'ScriptProcessor' });
      debugLog({ game: 'free', type: 'mic', ec: st.echoCancellation, ns: st.noiseSuppression, agc: st.autoGainControl, sr: mic.ctx.sampleRate, track: st.sampleRate, path: tap.kind, baseLatency: mic.ctx.baseLatency });
    } catch {}
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
    try { if (mic && eqAn) mic.source.disconnect(eqAn); } catch {}
    tap?.stop(); tap = null; mono = null;
    eqAn = null;
    if (mic) closeMic();
    mic = null;
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
  const placer = createPlacer({ frets: FRETS });
  // virtuelno vreme snimka: brzina 1× / 0,75× / 0,5× (sporije, da se prati brz deo)
  let i = 0, vt = -800, lastNow = performance.now(), speed = 1, alive = true;
  const SPEEDS = [1, 0.75, 0.5];
  const spBtn = stage.q('.fpv-speed');
  spBtn.addEventListener('click', () => {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    spBtn.textContent = String(speed).replace('.', getLang() === 'en' ? '.' : ',') + '×';
    spBtn.classList.toggle('slow', speed < 1);
  });
  keepAwake('freeplay');
  stage.message('');
  stage.setReplay({
    tick(now) {
      vt += Math.min(100, now - lastNow) * speed;
      lastNow = now;
      const tt = vt;
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
  const offOrient = stage.onOrientation((p) => { stage.sleep(p); if (!p) lastNow = performance.now(); });
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
