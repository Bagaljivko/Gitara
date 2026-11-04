// Akordi → „Samo sviraj“: živi prikaz sviranja na vratu gitare (pojedinačne note, dve note, akordi), sa
// tragovima koji blede i talasom koji prati jačinu i visinu; snimanje (do 10 min) u „Moji snimci“ kao tablatura,
// ponovno puštanje na vratu (samo slika, bez zvuka), preimenovanje i brisanje. Učitava se tek kad se otvori ovaj
// deo taba Akordi (ništa pri pokretanju aplikacije). Tuner i „Prepoznavanje“ se ne menjaju.
//
// Performanse (kao u igrama): raspored se pravi jednom; tačke su elementi iz bazena (12, najstarija se ponovo
// koristi), pomeraju se samo transform/opacity; jedna requestAnimationFrame petlja (talas + ponavljanje snimka);
// jeftin sjaj (radijalni gradijent / dve linije, bez blura); slušanje 50×/s, a težak deo samo posle trzaja.
import { t, LANGS, onLangChange } from './i18n.js';
import * as TEXTS from './freeplayText.js';
import { esc, toast, dialog, confirmDialog } from './ui.js';
import { settings } from './db.js';
import { openMic, closeMic, MicError } from './audio.js';
import { keepAwake, allowSleep } from './wakelock.js';
import { getRoom, roomToSensitivity } from './tunerSettings.js';
import { midiName } from './music.js';
import { dn } from './naming.js';
import { getVoicings } from './chords.js';
import { createFreeEngine } from './freeplayListen.js';

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
export function tabText(rec, width = 48) {
  const lines = ['e', 'H', 'G', 'D', 'A', 'E'].map((x, i) => (i === 0 ? dn('E').toLowerCase() : i === 1 ? dn('B') : x));
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

// ---------------- Pozornica (položeno): vrat, tačke, talas, snimanje ----------------
function createStage({ mode = 'live', rec = null, onExit, onSaved }) {
  const el = document.createElement('div');
  el.className = 'fpv';
  el.innerHTML = `
    <div class="fpv-top">
      <button class="fpv-x" aria-label="${t('fp.exit')}">✕</button>
      <div class="fpv-name" aria-live="polite"><b></b><small></small></div>
      <div class="fpv-tools">
        ${mode === 'live' ? `<button class="fpv-rec" aria-label="${t('fp.record')}"><i></i><span>${t('fp.record')}</span></button>
        <button class="fpv-set" aria-label="${t('fp.settings')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4L10.6 6a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4L4.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg></button>` : `<span class="fpv-replay">${t('fp.replaying')}</span>`}
      </div>
    </div>
    <div class="fpv-neck">
      <canvas class="fpv-wave"></canvas>
      <canvas class="fpv-bg"></canvas>
      <div class="fpv-dots"></div>
      <div class="fpv-msg"></div>
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
  const neck = q('.fpv-neck'), bg = q('.fpv-bg'), wave = q('.fpv-wave'), dotsL = q('.fpv-dots'), msg = q('.fpv-msg');
  const nameB = q('.fpv-name b'), nameS = q('.fpv-name small');
  q('.fpv-x').addEventListener('click', () => onExit?.());
  q('.fpv-x2').addEventListener('click', () => onExit?.());

  // ---- Raspored (meri se jednom i kad se telefon okrene) ----
  const G = { W: 0, H: 0, x0: 0, x1: 0, y0: 0, y1: 0, r: 12 };
  const fretX = (f) => G.x0 + (f / (FRETS + 0.6)) * (G.x1 - G.x0); // linija praga f
  const dotX = (f) => (f === 0 ? G.x0 - G.r * 1.25 : (fretX(f - 1) + fretX(f)) / 2);
  const strY = (s) => G.y0 + (s / 5) * (G.y1 - G.y0);
  function layout() {
    const w = neck.clientWidth, h = neck.clientHeight;
    if (!w || !h) return;
    G.W = w; G.H = h;
    G.r = Math.max(9, Math.min(h / 16, 22));
    // levo: imena žica, pa prazne žice (0) ispred nultog praga, pa vrat
    G.x0 = Math.max(70, G.r * 4.4); G.x1 = w - 14; G.y0 = h * 0.16; G.y1 = h * 0.86;
    neck.style.setProperty('--r', G.r + 'px');
    drawBg();
    sizeWave();
  }
  function drawBg() {
    const dpr = Math.min(2, window.devicePixelRatio || 1), c = bg.getContext('2d');
    bg.width = Math.round(G.W * dpr); bg.height = Math.round(G.H * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, G.W, G.H);
    // drvo vrata (tamno, prozirno — talas se vidi iza)
    const top = G.y0 - G.r * 1.3, bot = G.y1 + G.r * 1.3;
    const wood = c.createLinearGradient(0, top, 0, bot);
    wood.addColorStop(0, 'rgba(26,18,12,.82)'); wood.addColorStop(0.5, 'rgba(18,12,8,.82)'); wood.addColorStop(1, 'rgba(26,18,12,.82)');
    c.fillStyle = wood; c.fillRect(G.x0, top, G.x1 - G.x0, bot - top);
    // pragovi: metal (kao kod tunera)
    for (let f = 0; f <= FRETS; f++) {
      const x = fretX(f), g = c.createLinearGradient(x - 2, 0, x + 2, 0);
      g.addColorStop(0, '#5d6168'); g.addColorStop(0.5, f === 0 ? '#f2eee4' : '#d9dce1'); g.addColorStop(1, '#5d6168');
      c.fillStyle = g; c.fillRect(x - (f === 0 ? 3 : 1.5), top, f === 0 ? 6 : 3, bot - top);
    }
    c.fillStyle = 'rgba(232,226,214,.28)';
    for (const f of [3, 5, 7, 9]) { c.beginPath(); c.arc(dotX(f), (strY(2) + strY(3)) / 2, G.r * 0.32, 0, Math.PI * 2); c.fill(); }
    for (const yy of [(strY(1) + strY(2)) / 2, (strY(3) + strY(4)) / 2]) { c.beginPath(); c.arc(dotX(12), yy, G.r * 0.32, 0, Math.PI * 2); c.fill(); }
    // žice: čelik, deblje gore
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let s = 0; s < 6; s++) {
      const th = 3.4 - s * 0.45, y = strY(s);
      const g = c.createLinearGradient(0, y - th, 0, y + th);
      g.addColorStop(0, '#8d9198'); g.addColorStop(0.5, '#eceef2'); g.addColorStop(1, '#6d7178');
      c.fillStyle = g; c.fillRect(G.x0 - 4, y - th / 2, G.x1 - G.x0 + 4, th);
      c.fillStyle = '#9aa1ad'; c.font = `700 ${Math.round(Math.min(15, G.r * 0.9))}px system-ui, sans-serif`;
      c.fillText(sName(s), 12, y);
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
  }
  function showName(main, sub = '') {
    if (nameB.textContent !== main) nameB.textContent = main;
    if (nameS.textContent !== sub) nameS.textContent = sub;
    nameB.animate([{ transform: 'scale(1.15)', opacity: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 220, easing: 'ease-out' });
  }

  // ---- Talas (kao tunerov: svetla talasasta linija; ovde iza vrata, kao ekvilajzer: jačina = visina talasa, ton = gustina) ----
  let wctx = null, wdpr = 1;
  function sizeWave() {
    wdpr = Math.min(1.5, window.devicePixelRatio || 1);
    wave.width = Math.round(G.W * wdpr); wave.height = Math.round(G.H * wdpr);
    wctx = wave.getContext('2d'); wctx.setTransform(wdpr, 0, 0, wdpr, 0, 0);
  }
  const W8 = { amp: 0, want: 0, hz: 3, wantHz: 3, phase: 0 };
  function drawWave(dt) {
    W8.amp += (W8.want - W8.amp) * (1 - Math.exp(-dt / (W8.want > W8.amp ? 0.08 : 0.5)));
    W8.hz += (W8.wantHz - W8.hz) * (1 - Math.exp(-dt / 0.25));
    W8.phase += dt * (1.2 + W8.amp * 3);
    const c = wctx;
    c.clearRect(0, 0, G.W, G.H);
    if (W8.amp < 0.01) return;
    const mid = (G.y0 + G.y1) / 2, a = (G.y1 - G.y0) * 0.45 * W8.amp;
    c.beginPath();
    for (let x = 0; x <= G.W; x += 4) {
      const env = Math.sin((Math.PI * x) / G.W);
      const y = mid + env * a * Math.sin((x / G.W) * Math.PI * 2 * W8.hz + W8.phase) * (0.8 + 0.2 * Math.sin(x * 0.013 + W8.phase * 0.7));
      if (x) c.lineTo(x, y); else c.moveTo(x, y);
    }
    // jeftin sjaj: široka prozirna + tanka svetla linija (bez blura)
    c.lineWidth = 9; c.strokeStyle = `rgba(245,165,36,${(0.12 * Math.min(1, W8.amp * 1.5)).toFixed(3)})`; c.stroke();
    c.lineWidth = 2; c.strokeStyle = `rgba(255,214,140,${(0.55 * Math.min(1, W8.amp * 1.5)).toFixed(3)})`; c.stroke();
  }

  // ---- Jedna petlja: talas (+ ponavljanje snimka) ----
  let raf = 0, last = 0, sleeping = false, alive = true, replay = null;
  function frame(ts) {
    raf = 0;
    if (!alive || sleeping) return;
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0.016);
    last = ts;
    if (G.W) drawWave(dt);
    replay?.tick(performance.now());
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
    el, light, showName,
    message(text) { if (msg.textContent !== (text || '')) msg.textContent = text || ''; msg.classList.toggle('on', !!text); },
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
    const list = await loadRecs();
    list.unshift(rec);
    await saveRecs(list);
    toast(t('fp.saved'));
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
      stage.showName(dn(ev.chord), notes.length ? '' : '');
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
      stage.message('');
      stage.q('.fpv-msg').classList.add('err');
      // jasna poruka (za odbijen mikrofon i kako da se dozvoli — ista kao u tuneru)
      stage.message(e instanceof MicError ? e.message : t('fp.micDenied'));
      return;
    }
    if (!alive) { closeMic(); return; }
    an = mic.ctx.createAnalyser();
    an.fftSize = 8192; an.smoothingTimeConstant = 0;
    mic.source.connect(an);
    buf = new Float32Array(an.fftSize);
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

// ---------------- Deo taba „Akordi“: uvod, „Sviraj“ i Moji snimci ----------------
export async function createFreePane(host) {
  await cssReady;
  host.innerHTML = `
    <div class="fp-pane">
      <p class="muted">${t('fp.intro')}</p>
      <button class="btn primary big wide fp-go" id="fpGo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>${t('fp.start')}</button>
      <h3 class="fp-h">${t('fp.myRecs')}</h3>
      <ul class="fp-recs" id="fpRecs"></ul>
      <div class="card fp-view" id="fpView" hidden></div>
    </div>`;
  const $ = (id) => host.querySelector('#' + id);
  let active = null;

  async function drawList() {
    const list = await loadRecs();
    $('fpRecs').innerHTML = list.length ? list.map((r) => `<li data-id="${esc(r.id)}">
        <button class="fp-open" data-act="open"><b>${esc(r.name)}</b><small>${clock(r.dur || 0)} · ${t('fp.nNotes', { n: (r.events || []).length })}</small></button>
        <button class="icon-btn" data-act="ren" aria-label="${t('fp.rename')}" title="${t('fp.rename')}"><svg viewBox="0 0 24 24"><path d="M4 17.3V20h2.7l8-8-2.7-2.7-8 8zM18.7 8c.4-.4.4-1 0-1.4l-1.3-1.3a1 1 0 0 0-1.4 0l-1 1 2.7 2.7z"/></svg></button>
        <button class="icon-btn" data-act="del" aria-label="${t('fp.delete')}" title="${t('fp.delete')}"><svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/></svg></button>
      </li>`).join('') : `<li class="muted fp-empty">${t('fp.noRecs')}</li>`;
  }
  function openRec(rec) {
    $('fpView').hidden = false;
    $('fpView').innerHTML = `<div class="fp-view-head"><b>${esc(rec.name)}</b><small class="muted">${clock(rec.dur || 0)}</small></div>
      <pre class="fp-tab" aria-label="${t('fp.tab')}">${esc(tabText(rec))}</pre>
      <div class="row-btns"><button class="btn primary" id="fpReplay">${t('fp.replay')}</button><button class="btn" id="fpClose">${t('fp.close')}</button></div>`;
    $('fpReplay').addEventListener('click', () => { if (!active) active = startReplay(rec, { onExit: () => (active = null) }); });
    $('fpClose').addEventListener('click', () => { $('fpView').hidden = true; });
    $('fpView').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  $('fpRecs').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.closest('li').dataset.id, list = await loadRecs(), rec = list.find((r) => r.id === id);
    if (!rec) return;
    if (b.dataset.act === 'open') openRec(rec);
    if (b.dataset.act === 'ren') {
      let val = rec.name;
      const p = dialog({ title: t('fp.rename'), html: true, body: `<input id="fpName" maxlength="60" value="${esc(rec.name)}" autocomplete="off" aria-label="${esc(t('fp.rename'))}">`,
        buttons: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), value: 'ok', kind: 'primary' }] });
      const inp = [...document.querySelectorAll('.modal-backdrop')].pop()?.querySelector('#fpName');
      inp?.addEventListener('input', () => (val = inp.value));
      setTimeout(() => inp?.focus(), 50);
      if ((await p) === 'ok' && val.trim()) { rec.name = val.trim().slice(0, 60); await saveRecs(list); drawList(); if (!$('fpView').hidden) openRec(rec); }
    }
    if (b.dataset.act === 'del') {
      if (!(await confirmDialog(t('fp.delete'), t('fp.deleteQ', { n: rec.name }), t('fp.delete'), 'danger'))) return;
      await saveRecs(list.filter((r) => r.id !== id));
      $('fpView').hidden = true;
      drawList();
    }
  });
  $('fpGo').addEventListener('click', async () => {
    if (active) return;
    active = await startLive({ onExit: () => { active = null; drawList(); }, onSaved: () => drawList() });
  });
  drawList();
  return { stop() { active?.stop(); active = null; } };
}
