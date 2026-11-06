// Vežbe: zajednička „staza“ (u stilu Guitar Hero-a), položeni ekran — bez celog ekrana i bez zaključavanja.
// Vodoravni vrat gitare, žice kao kad gledaš svoju gitaru dok sviraš (debela E gore, tanka e dole).
// Note (i blokovi akorda / udarci) klize zdesna nalevo do svetle linije. Nota pokazuje samo prag;
// boja note je prst: 1 plavo, 2 žuto, 3 roze, 4 ljubičasto, 0 (prazna žica) belo.
// Pogodak/promašaj = zeleni/crveni prsten oko note (boja note se ne menja).
// Dole desno: providna leva ruka sa obojenim vrhovima prstiju (podsetnik; prst za sledeću notu svetli).
// Crta se na jednom <canvas>-u (requestAnimationFrame) — lagano i za slabije telefone.
//
// runTrack(): zajednički tok runde za sve igre na stazi —
//   „Normalno“: metronom, odbrojavanje 3-2-1, ocena rano/kasno, promašaji;
//   „Čekaj me“ (jedan zajednički mehanizam za sve igre na stazi): staza stane na liniji kod svake note/akorda i
//   čeka da je odsviraš (bez tempa i promašaja; pogrešno → crvena tačka + „To je F, probaj ponovo“; savet + prst).
//   Početnik ga uključuje sam (može da se isključi); Normalno počinje bez njega. Početnik = samo lakši sadržaj;
//   telefon uspravno usred runde → pauza i „Okreni telefon“; položeno → novo odbrojavanje i nastavak;
//   demo: igra sama „svira“ (zvuk + zelene note), bez mikrofona.
import { hitSound, placeOf, quizPluck } from './practiceCommon.js';
import { OPEN_MIDI, noteLabel } from './practiceBoard.js';
import { Metronome } from './rhythm.js';
import { judgeTiming, getLatency, debugLog } from './practiceListen.js';
import { dn } from './naming.js';
import { getVoicings } from './chords.js';
import { audioCtx } from './synth.js';
import { loadNote, nearestNote } from './guitarSamples.js';
import { chordNotes } from './rhythm.js';

/**
 * Zvuci gitare za ono što će se svirati (note, akordi, ritam na Em) učitaju se PRE nego što staza krene —
 * inače se svaki nov ton učitava i dekodira usred animacije (na slabijem telefonu trzaj od ~100 ms).
 * Čeka najviše maxMs; ono što ne stigne, učitava se kao i ranije.
 */
export function warmSounds(items, maxMs = 1500) {
  try {
    const ctx = audioCtx(), set = new Set();
    const addF = (f) => { if (f) set.add(nearestNote(f)); };
    for (const it of items || []) {
      if (it.midi != null) set.add(Math.max(40, Math.min(86, it.midi)));
      for (const g of it.group || []) if (g.midi != null) set.add(g.midi);
      if (it.chord) (chordNotes(it.chord) || []).forEach(addF);
    }
    (chordNotes('Em') || []).forEach(addF); // ritam / metronom bez akorda
    const all = Promise.all([...set].map((m) => loadNote(ctx, m).catch(() => null)));
    return Promise.race([all, new Promise((r) => setTimeout(r, maxMs))]);
  } catch { return Promise.resolve(); }
}

const C = { bg: '#07080a', wood: '#120d09', str: '#b9bdc4', accent: '#f5a524', ok: '#3dd68c', danger: '#ff6b6b', muted: '#9aa1ad' };
const INK = '#0b0c10';
const portraitMq = () => window.matchMedia('(orientation: portrait)');

// Leva ruka (po korisnikovom crtežu): smeđa šaka sa svetlijim obodom, ceo prst u svojoj boji (1 kažiprst plavo,
// 2 srednji žuto, 3 domali roze, 4 mali ljubičasto) sa tamnijom ivicom i velikim brojem. Prst koji svira svetli
// (svetliji prelaz, beli obod, blag oreol — nepomičan sloj, ne animirani blur); ostali su malo prigušeni.
const HAND_SVG = `<svg viewBox="0 0 100 143" aria-hidden="true"><defs><linearGradient id="hl1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fb6ff"/><stop offset="1" stop-color="#3f86e0"/></linearGradient><linearGradient id="hl2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd45a"/><stop offset="1" stop-color="#ffa000"/></linearGradient><linearGradient id="hl3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff86c5"/><stop offset="1" stop-color="#e0458f"/></linearGradient><linearGradient id="hl4" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c39bff"/><stop offset="1" stop-color="#8c5be0"/></linearGradient></defs><g class="h-tip fc4" data-f="4"><g transform="translate(11.1 73.0) rotate(-7.0)"><path class="h-glow" d="M-8.9 2 L-7.5 -33.6 A7.5 7.5 0 0 1 7.5 -33.6 L8.9 2 Z"/><path class="h-f" d="M-8.9 2 L-7.5 -33.6 A7.5 7.5 0 0 1 7.5 -33.6 L8.9 2 Z"/><path class="h-sh" d="M4.3 2 L3.9 -29.1 Q7.5 -32.8 7.5 -29.1 L8.9 2 Z"/></g><text x="7.1" y="45.1" text-anchor="middle">4</text></g><g class="h-tip fc3" data-f="3"><g transform="translate(27.0 68.8) rotate(-1.4)"><path class="h-glow" d="M-8.4 2 L-7.8 -51.5 A7.8 7.8 0 0 1 7.8 -51.5 L8.4 2 Z"/><path class="h-f" d="M-8.4 2 L-7.8 -51.5 A7.8 7.8 0 0 1 7.8 -51.5 L8.4 2 Z"/><path class="h-sh" d="M4.0 2 L4.1 -46.8 Q7.8 -50.7 7.8 -46.8 L8.4 2 Z"/></g><text x="25.8" y="26.1" text-anchor="middle">3</text></g><g class="h-tip fc2" data-f="2"><g transform="translate(43.7 66.2) rotate(0.0)"><path class="h-glow" d="M-7.8 2 L-7.4 -58.4 A7.4 7.4 0 0 1 7.4 -58.4 L7.8 2 Z"/><path class="h-f" d="M-7.8 2 L-7.4 -58.4 A7.4 7.4 0 0 1 7.4 -58.4 L7.8 2 Z"/><path class="h-sh" d="M3.7 2 L3.8 -54.0 Q7.4 -57.7 7.4 -54.0 L7.8 2 Z"/></g><text x="43.7" y="18.3" text-anchor="middle">2</text></g><g class="h-tip fc1" data-f="1"><g transform="translate(60.7 70.2) rotate(4.1)"><path class="h-glow" d="M-8.9 2 L-7.8 -49.6 A7.8 7.8 0 0 1 7.8 -49.6 L8.9 2 Z"/><path class="h-f" d="M-8.9 2 L-7.8 -49.6 A7.8 7.8 0 0 1 7.8 -49.6 L8.9 2 Z"/><path class="h-sh" d="M4.3 2 L4.1 -45.0 Q7.8 -48.9 7.8 -45.0 L8.9 2 Z"/></g><text x="64.0" y="29.1" text-anchor="middle">1</text></g><path class="h-skin" d="M5.2 73.3 Q29.8 64.5 66.1 69.6 C66.4 77.3 65.8 85.1 68.4 88.4 C71.6 91.8 76.6 87.2 83.7 80.4 C89.4 74.8 94.3 71.6 98.6 74.8 C101.4 77.0 100.0 80.4 95.7 84.7 C87.9 92.9 79.4 102.8 70.2 115.6 C65.2 122.7 60.7 127.7 59.6 133.3 L58.9 142.6 L19.3 142.6 L18.7 132.6 C12.8 125.5 6.8 115.6 6.0 101.4 C5.4 90.1 5.0 81.6 5.2 73.3 Z"/></svg>`;

/**
 * Staza preko celog prozora (bez celog ekrana). Raspored se pravi JEDNOM na početku runde i ne menja se tokom
 * runde: pozadina (drvo, žice, linija) se nacrta jednom; note, blokovi akorda, strelice i linije otkucaja su
 * elementi iz „bazena“ koji se pomeraju samo preko CSS transform/opacity, iz jedne requestAnimationFrame petlje.
 * Bez čitanja rasporeda tokom runde, bez pravljenja elemenata po kadru, bez animiranih senki/blura.
 */
export function createTrack({ t, onExit, lookBeats = 4.5, onInfo = null, speed = null }) {
  const el = document.createElement('div');
  el.className = 'trk';
  el.innerHTML = `
    <div class="trk-top">
      <button class="trk-x" aria-label="${t('pr.trk.exit')}">✕</button>${onInfo ? `<button class="trk-i" aria-label="${t('pr.info.what')}">i</button>` : ''}
      ${speed ? `<button class="trk-speed" aria-label="${t('pr.speed.label')}"><small>${t('pr.speed.label')}</small><b>${speed.label()}</b></button>` : ''}
      <div class="trk-prog" aria-hidden="true"><i></i></div>
      <div class="trk-combo"><b>0</b><small>${t('pr.trk.combo')}</small></div>
      <div class="trk-meter" aria-hidden="true"><span class="pr-lvl"><i></i></span><span class="trk-heard"></span></div>
    </div>
    <div class="trk-lyric" aria-live="polite"></div>
    <div class="trk-lane">
      <div class="trk-cw">
        <canvas class="trk-bg"></canvas>
        <div class="trk-layer trk-grid"></div><div class="trk-layer trk-items"></div><div class="trk-layer trk-fx"></div>
        <div class="trk-hand">${HAND_SVG}</div>
        <div class="trk-big"></div>
      </div>
    </div>
    <div class="trk-cap"><span class="trk-captxt" aria-live="polite"></span><span class="trk-pop" aria-live="assertive"></span></div>
    <div class="trk-res" hidden></div>
    <div class="trk-rotate"><div class="trk-phone" aria-hidden="true"><i></i></div><b>${t('pr.trk.rotate')}</b><small>${t('pr.trk.rotateWhy')}</small>
      <small class="trk-rot-hint" hidden>${t('pr.trk.autoRotate')}</small>
      <button class="btn small trk-x2">${t('pr.trk.exit')}</button></div>`;
  document.body.appendChild(el);
  document.body.classList.add('trk-open');
  const q = (s) => el.querySelector(s);
  const cw = q('.trk-cw'), bg = q('.trk-bg'), gridL = q('.trk-grid'), itemsL = q('.trk-items'), fxL = q('.trk-fx'), hand = q('.trk-hand');
  const progI = q('.trk-prog i'), lvlI = q('.pr-lvl i'), heardEl = q('.trk-heard'), comboB = q('.trk-combo b'), comboEl = q('.trk-combo');
  const capEl = q('.trk-captxt'), lyrEl = q('.trk-lyric'), bigEl = q('.trk-big'), popEl = q('.trk-pop');
  const exit = () => onExit?.();
  q('.trk-x').addEventListener('click', exit);
  q('.trk-i')?.addEventListener('click', () => onInfo?.());
  // Brzina tokom igre: dodir menja Sporo → Normalno → Brzo → Izazov → Postepeno; prolaz kreće ispočetka u novoj brzini
  q('.trk-speed')?.addEventListener('click', () => { const b = q('.trk-speed b'); b.textContent = speed.cycle(); });
  q('.trk-x2').addEventListener('click', exit);

  let items = [], grid = null, beatMs = 1000, raf = 0, combo = 0, maxCombo = 0, alive = true, sleeping = false, cur = null;
  let clock = () => performance.now();
  // Geometrija (meri se samo na početku runde i kad se telefon okrene)
  const G = { W: 0, H: 0, padY: 0, gutter: 28, laneH: 0, hitX: 0, ppb: 0, r: 12 };
  const y = (s) => G.padY + (5 - s + 0.5) * G.laneH; // tanka e gore, debela E dole (s: 0 = debela E — zapis se ne menja)

  // ---- „Okreni telefon“ (i savet za automatsko rotiranje posle nekoliko sekundi) ----
  const mq = portraitMq();
  let rotT = 0;
  const orientSubs = new Set();
  function onMq() {
    clearTimeout(rotT);
    q('.trk-rot-hint').hidden = true;
    if (mq.matches) rotT = setTimeout(() => { q('.trk-rot-hint').hidden = false; }, 4000);
    orientSubs.forEach((fn) => fn(mq.matches));
  }
  mq.addEventListener('change', onMq);
  onMq();
  // promena veličine prozora (okretanje telefona) — tada (i samo tada) se raspored meri ponovo
  let resizeQ = 0;
  const onResize = () => { cancelAnimationFrame(resizeQ); resizeQ = requestAnimationFrame(() => alive && layout()); };
  window.addEventListener('resize', onResize);

  function layout() {
    const w = cw.clientWidth, h = cw.clientHeight;
    if (!w || !h) return;
    G.W = w; G.H = h;
    G.padY = Math.max(8, h * 0.05); G.laneH = (h - 2 * G.padY) / 6;
    G.hitX = G.gutter + Math.max(48, w * 0.12); G.ppb = (w - G.hitX) / lookBeats;
    G.r = Math.max(9, Math.min(G.laneH * 0.42, 24));
    cw.style.setProperty('--r', G.r + 'px');
    cw.style.setProperty('--lh', G.laneH + 'px');
    cw.style.setProperty('--py', G.padY + 'px');
    cw.style.setProperty('--hx', G.hitX + 'px');
    // ruka: desno dole, gde note ulaze — nikad preko linije ni preko sledeće dve note
    const free = w - (G.hitX + 2 * G.ppb + G.r * 2) - 8;
    // diskretno: oko 40 % visine vrata (podsetnik u uglu, ne lik na sceni)
    const hw = Math.max(64, Math.min(130, free, (h * 0.56 * 100) / 143));
    hand.style.width = hw + 'px';
    drawBg();
    // svi elementi se ponovo postave (nova veličina)
    for (const it of items) if (it._el) release(it);
  }
  function drawBg() {
    const dpr = Math.min(2, window.devicePixelRatio || 1), ctx = bg.getContext('2d');
    bg.width = Math.round(G.W * dpr); bg.height = Math.round(G.H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, G.W, G.H);
    ctx.fillStyle = C.wood; ctx.fillRect(G.gutter, G.padY, G.W - G.gutter, G.H - 2 * G.padY);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let s = 0; s < 6; s++) {
      ctx.fillStyle = C.str; ctx.globalAlpha = 0.7;
      const th = 3.2 - s * 0.42;
      ctx.fillRect(G.gutter, y(s) - th / 2, G.W - G.gutter, th);
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.muted; ctx.font = `700 ${Math.round(Math.min(15, G.laneH * 0.42))}px system-ui, sans-serif`;
      ctx.fillText(s === 5 ? dn('E').toLowerCase() : noteLabel(OPEN_MIDI[s]), G.gutter / 2, y(s));
    }
    const g = ctx.createLinearGradient(G.hitX - 14, 0, G.hitX + 14, 0);
    g.addColorStop(0, 'rgba(245,165,36,0)'); g.addColorStop(0.5, 'rgba(245,165,36,.3)'); g.addColorStop(1, 'rgba(245,165,36,0)');
    ctx.fillStyle = g; ctx.fillRect(G.hitX - 14, G.padY, 28, G.H - 2 * G.padY);
    ctx.fillStyle = C.accent; ctx.fillRect(G.hitX - 1.5, G.padY, 3, G.H - 2 * G.padY);
    for (let s = 0; s < 6; s++) {
      ctx.beginPath(); ctx.arc(G.hitX, y(s), G.r, 0, Math.PI * 2);
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(236,238,242,.2)'; ctx.stroke();
    }
  }

  // ---- Bazeni elemenata (prave se jednom, posle se samo ponovo koriste) ----
  const pools = { note: [], chord: [], strum: [], grid: [], ring: [], ghost: [], barre: [] };
  function make(kind) {
    const e = document.createElement('div');
    if (kind === 'note') { e.className = 'tn'; e.innerHTML = '<b></b>'; itemsL.appendChild(e); }
    else if (kind === 'chord') {
      e.className = 'tc'; e.innerHTML = `<span class="tc-l"></span>${'<i class="tc-d"><b></b></i>'.repeat(6)}`; itemsL.appendChild(e);
    } else if (kind === 'strum') {
      e.className = 'ts';
      e.innerHTML = '<svg viewBox="0 0 20 100" preserveAspectRatio="none"><path d="M10 4V96"/><path class="ts-h" d="M3 86l7 10 7-10"/></svg>';
      itemsL.appendChild(e);
    } else if (kind === 'grid') { e.className = 'tgl'; gridL.appendChild(e); }
    else if (kind === 'ring') { e.className = 'tr'; fxL.appendChild(e); }
    else if (kind === 'ghost') { e.className = 'tgh'; e.innerHTML = '<b></b>'; fxL.appendChild(e); }
    else if (kind === 'barre') { e.className = 'tbr'; e.innerHTML = '<b></b>'; gridL.appendChild(e); }
    return e;
  }
  function take(kind) { const p = pools[kind]; const e = p.length ? p.pop() : make(kind); e.style.opacity = ''; return e; }
  function give(kind, e) { e.style.transform = 'translate3d(-9999px,0,0)'; e._tx = null; pools[kind].push(e); }
  function release(it) { if (!it._el) return; it._el.classList.remove('cur', 'missed'); give(it.kind, it._el); it._el = null; }
  // nova nota/blok: sadržaj se upiše jednom (pri dodeli), ne po kadru
  function assign(it) {
    const e = take(it.kind);
    if (it.kind === 'note') {
      e.className = `tn fc${it.finger || 0}${it.root ? ' root' : ''}${it.ring ? ' ring' : ''}`;
      e.firstChild.textContent = String(it.f);
      if (it.ring) e.style.setProperty('--len', Math.max(0, it.dur * G.ppb - G.r * 1.5).toFixed(0) + 'px'); // žica zvoni (prebiranje)
    } else if (it.kind === 'chord') {
      e.className = 'tc' + (it.deco ? ' deco' : '');
      const w = Math.max(G.r * 2 + 8, (it.dur || 1) * G.ppb - 6 + G.r * 2 + 8);
      e.style.width = w + 'px';
      e.firstChild.textContent = it.label || '';
      const dots = e.querySelectorAll('.tc-d');
      for (let s = 0; s < 6; s++) {
        const d = dots[s], f = it.frets ? it.frets[s] : -2;
        if (it.deco || f === -2 || f == null) { d.className = 'tc-d off'; continue; }
        d.className = f < 0 ? 'tc-d mute' : `tc-d fc${f === 0 ? 0 : it.fingers?.[s] || 1}`;
        d.firstChild.textContent = f < 0 ? '×' : String(f);
        d.style.transform = `translate3d(0,${(y(s) - G.padY - G.r * 0.82).toFixed(1)}px,0)`;
      }
    } else if (it.kind === 'strum') {
      e.className = `ts ${it.dir === 'U' ? 'up' : 'down'}${it.muted ? ' muted' : ''}`;
    } else if (it.kind === 'barre') {
      // barre: blaga traka preko žica koje prvi prst pritiska (samo prikaz)
      e.style.width = Math.max(G.r * 2, it.dur * G.ppb).toFixed(0) + 'px';
      e.style.height = (Math.abs(y(it.to) - y(it.from)) + G.r * 1.6).toFixed(0) + 'px';
      e.firstChild.textContent = it.label || '';
    }
    if (it === cur) e.classList.add('cur');
    if (it.state === 'miss') e.classList.add('missed');
    it._el = e;
    return e;
  }
  const setX = (e, tx) => { if (e._tx !== tx) { e._tx = tx; e.style.transform = tx; } };

  // ---- Jedna petlja: samo transform (i klase kad se nešto promeni) ----
  const gridEls = [];
  function frame() {
    if (!alive || sleeping) { raf = 0; return; }
    raf = requestAnimationFrame(frame);
    if (!G.W) { layout(); if (!G.W) return; }
    const now = clock(), r = G.r;
    const xOf = (at) => G.hitX + ((at - now) / beatMs) * G.ppb;
    // linije otkucaja
    let gi = 0;
    if (grid && Number.isFinite(grid.t0)) {
      const first = Math.floor((now - grid.t0) / beatMs) - 1;
      for (let b = first; b <= first + lookBeats + 2; b++) {
        const x = xOf(grid.t0 + b * beatMs);
        if (x < G.gutter || x > G.W) continue;
        const e = gridEls[gi] || (gridEls[gi] = take('grid'));
        const cls = ((b % 4) + 4) % 4 === 0 ? 'tgl acc' : 'tgl';
        if (e._cls !== cls) { e._cls = cls; e.className = cls; } // klasa samo kad se promeni (inače stil svake sličice ispočetka)
        setX(e, `translate3d(${x.toFixed(1)}px,0,0)`);
        gi++;
      }
    }
    for (let k = gi; k < gridEls.length; k++) setX(gridEls[k], 'translate3d(-9999px,0,0)');
    for (const it of items) {
      if (it.state === 'hit' && !it.deco) { release(it); continue; }
      if (it.state === 'miss' && it.doneAt && performance.now() - it.doneAt > 700) { release(it); continue; }
      const x = xOf(it.at);
      const x1 = it.dur ? xOf(it.at + it.dur * beatMs) : x;
      if (!Number.isFinite(x) || x1 < -3 * r || x > G.W + 3 * r) { release(it); continue; }
      const e = it._el || assign(it);
      if (it.kind === 'note') setX(e, `translate3d(${(x - r * 1.5).toFixed(1)}px,${(y(it.s) - r * 1.5).toFixed(1)}px,0)`);
      else if (it.kind === 'chord') setX(e, `translate3d(${(x - r - 4).toFixed(1)}px,${G.padY.toFixed(1)}px,0)`);
      else if (it.kind === 'barre') setX(e, `translate3d(${(x - r).toFixed(1)}px,${(Math.min(y(it.from), y(it.to)) - r * 0.8).toFixed(1)}px,0)`);
      else setX(e, `translate3d(${(x - r * 1.1).toFixed(1)}px,${(y(5) - r * 0.7).toFixed(1)}px,0)`); // od gornje žice
    }
  }
  function wake() { if (!raf && alive && !sleeping) raf = requestAnimationFrame(frame); }
  wake();

  // ---- Efekti: samo na meti (prsten / mali prasak), Web Animations (bez čitanja rasporeda) ----
  function ringAt(it, kind, xAt) {
    const e = take('ring'), r = G.r;
    const col = kind === 'hit' ? 'ok' : 'bad';
    let w, h, x, yy;
    if (it.kind === 'note') { w = h = r * 2.5; x = xAt - w / 2; yy = y(it.s) - h / 2; e.className = `tr ${col}`; }
    else if (it.kind === 'chord') { w = r * 2 + 12; h = G.H - 2 * G.padY; x = xAt - w / 2; yy = G.padY; e.className = `tr box ${col}`; }
    else { w = r * 2.6; h = y(0) - y(5) + r * 1.6; x = xAt - w / 2; yy = y(5) - r * 0.8; e.className = `tr box ${col}`; }
    e.style.width = w + 'px'; e.style.height = h + 'px';
    const base = `translate3d(${x.toFixed(1)}px,${yy.toFixed(1)}px,0)`;
    e.style.transform = base;
    const a = e.animate([{ transform: base + ' scale(.85)', opacity: 1 }, { transform: base + ' scale(1.35)', opacity: 0 }], { duration: 450, easing: 'ease-out' });
    a.onfinish = () => give('ring', e);
    if (kind === 'hit') {
      const bst = take('ring');
      bst.className = 'tr burst';
      const bw = it.kind === 'note' ? r * 2.2 : r * 3;
      bst.style.width = bst.style.height = bw + 'px';
      const bb = `translate3d(${(xAt - bw / 2).toFixed(1)}px,${((it.kind === 'note' ? y(it.s) : (y(2) + y(3)) / 2) - bw / 2).toFixed(1)}px,0)`;
      bst.style.transform = bb;
      bst.animate([{ transform: bb + ' scale(.5)', opacity: 0.85 }, { transform: bb + ' scale(1.7)', opacity: 0 }], { duration: 380, easing: 'ease-out' }).onfinish = () => give('ring', bst);
    }
  }
  // Pogrešna nota: bled crveni krug na žici gde je ta nota (sa brojem praga) — nestane posle ~1 s ili kad pogodiš
  let ghostEl = null, ghostAnim = null;
  function ghost(s, f, nextToTarget) {
    clearGhost();
    const e = take('ghost'), r = G.r;
    e.firstChild.textContent = String(f);
    const x = nextToTarget ? G.hitX - r * 2.6 : G.hitX;
    const tr = `translate3d(${(x - r).toFixed(1)}px,${(y(s) - r).toFixed(1)}px,0)`;
    e.style.transform = tr;
    ghostEl = e;
    ghostAnim = e.animate([{ opacity: 0 }, { opacity: 0.75, offset: 0.12 }, { opacity: 0.75, offset: 0.75 }, { opacity: 0 }], { duration: 1100 });
    ghostAnim.onfinish = () => { if (ghostEl === e) { ghostEl = null; give('ghost', e); } };
  }
  function clearGhost() { if (!ghostEl) return; ghostAnim?.cancel(); give('ghost', ghostEl); ghostEl = null; }

  function pop(text, kind) {
    popEl.className = 'trk-pop ' + (kind || '');
    popEl.textContent = text;
    popEl.animate([{ opacity: 0, transform: 'translate3d(0,8px,0) scale(.85)' }, { opacity: 1, transform: 'translate3d(0,0,0) scale(1.1)', offset: 0.2 }, { opacity: 0, transform: 'translate3d(0,-14px,0) scale(1)' }], { duration: 750, easing: 'ease-out' });
  }
  function setCombo(n) {
    combo = n; maxCombo = Math.max(maxCombo, n);
    comboB.textContent = String(n);
    comboEl.classList.toggle('hot', n >= 8);
    if (n > 0) comboB.animate([{ transform: 'scale(1.4)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
  }
  let handAnim = null, lvlT = 0, lastHeard = undefined;

  return {
    el,
    useClock(fn) { clock = fn; },
    setItems(list, ms) { for (const it of items) release(it); items = list; if (ms) beatMs = ms; cur = null; },
    setGrid(gr) { grid = gr; },
    set beatMs(v) { beatMs = v; },
    /** Ocena: kind 'hit' | 'early' | 'late' | 'miss'; text = poruka; sound = cink */
    judge(it, kind, text, { sound = true, quiet = false } = {}) {
      const real = performance.now();
      const x = Math.max(G.hitX, G.hitX + ((it.at - clock()) / beatMs) * G.ppb);
      it.state = kind === 'miss' ? 'miss' : 'hit';
      it.doneAt = real;
      // quiet: nota koja prati drugu u istom napadu (bas uz melodiju) — samo prsten, bez poruke i niza
      if (kind === 'miss') { it._el?.classList.add('missed'); ringAt(it, 'miss', x); if (!quiet) setCombo(0); }
      else { ringAt(it, 'hit', G.hitX); if (!quiet) { clearGhost(); setCombo(combo + 1); if (sound) hitSound(); } }
      if (!quiet) pop(text, kind);
    },
    /** Pogrešno, ali nota i dalje čeka: crveni prsten oko mete (i bled crveni krug na odsviranoj noti). */
    wrong(it, text, heard = null) {
      ringAt(it, 'miss', Math.max(G.hitX, G.hitX + ((it.at - clock()) / beatMs) * G.ppb));
      if (heard != null && it.kind === 'note') {
        const pos = placeOf(heard, it.s);
        if (pos) ghost(pos.s, pos.f, pos.s === it.s);
      }
      pop(text, 'miss');
    },
    big(text) {
      bigEl.textContent = text || '';
      if (text) bigEl.animate([{ opacity: 0, transform: 'scale(1.6)' }, { opacity: 1, transform: 'scale(1)', offset: 0.25 }, { opacity: 0, transform: 'scale(.9)' }], { duration: 700, easing: 'ease-out', fill: 'forwards' });
    },
    pop,
    caption(text) { if (capEl.textContent !== (text || '')) capEl.textContent = text || ''; },
    /** Red teksta: običan tekst ili { pre, cur, post } — reči koje se pevaju uz tekući akord su istaknute. */
    lyric(v) {
      const obj = v && typeof v === 'object';
      const k = obj ? `${v.pre}\u0001${v.cur}\u0001${v.post}` : v || '';
      if (lyrEl._k === k) return;
      lyrEl._k = k;
      if (!obj) { lyrEl.textContent = v || ''; return; }
      const e = (x) => String(x || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      lyrEl.innerHTML = `<span class="ly-pre">${e(v.pre)}</span><b class="ly-cur">${e(v.cur)}</b><span class="ly-post">${e(v.post)}</span>`;
    },
    /** Red teksta iznad vrata (Delovi pesme): odluči se na početku runde, visina je stalna. */
    setLyricMode(on) { el.classList.toggle('with-lyric', !!on); },
    progress(frac) { progI.style.transform = `scaleX(${Math.max(0, Math.min(1, frac)).toFixed(3)})`; },
    level(lv, note) {
      const now = performance.now();
      if (now - lvlT < 66) return; // ~15 puta u sekundi
      lvlT = now;
      const db = lv ? 20 * Math.log10(lv) : -100;
      lvlI.style.transform = `scaleX(${Math.max(0, Math.min(1, (db + 60) / 50)).toFixed(2)})`;
      if (note !== lastHeard) { lastHeard = note; heardEl.textContent = note != null ? `${t('pr.meter.heard')}: ${noteLabel(note)}` : ''; }
    },
    ghost(s, f) { ghost(s, f, false); },
    clearGhost,
    /** Ruka: na početku runde nekoliko puta blago zasvetli (podsetnik za boje), pa se vrati na ~25 %. */
    handPulse() {
      handAnim?.forEach((a) => a.cancel());
      const pulse = (lo, hi) => [lo, hi, lo, hi, lo, hi * 0.9, lo].map((o) => ({ opacity: o }));
      handAnim = [hand.querySelector('.h-skin').animate(pulse(0.55, 0.95), { duration: 3400, easing: 'ease-in-out' }),
        ...[...hand.querySelectorAll('.h-tip')].map((tip) => tip.animate(pulse(0.62, 1), { duration: 3400, easing: 'ease-in-out' }))];
    },
    handLight(fingers = []) {
      hand.querySelectorAll('.h-tip').forEach((tip) => tip.classList.toggle('lit', fingers.includes(+tip.dataset.f)));
    },
    /** Trenutna meta (beli obod) — menja se samo klasa. */
    setCurrent(it) {
      if (cur === it) return;
      cur?._el?.classList.remove('cur');
      cur = it;
      it?._el?.classList.add('cur');
    },
    get combo() { return combo; },
    get maxCombo() { return maxCombo; },
    reset() {
      for (const it of items) release(it);
      items = []; grid = null; combo = 0; maxCombo = 0; cur = null; comboB.textContent = '0'; comboEl.classList.remove('hot');
      clearGhost();
      this.progress(0); this.caption(''); this.lyric(''); bigEl.textContent = ''; this.handLight([]); q('.trk-res').hidden = true;
      clock = () => performance.now();
    },
    /** Raspored za novu rundu (posle podešavanja reda za tekst). */
    relayout() { layout(); },
    /** Uspravno / pauza: petlja crtanja stane. */
    sleep(on) { sleeping = !!on; if (!sleeping) wake(); },
    isPortrait: () => mq.matches,
    whenLandscape() {
      if (!mq.matches) return Promise.resolve();
      return new Promise((res) => {
        const off = this.onOrientation((p) => { if (!p) { off(); res(); } });
      });
    },
    onOrientation(fn) { orientSubs.add(fn); return () => orientSubs.delete(fn); },
    /** Rezultat na stazi; buttons: [{ id, label, primary }] → Promise sa id-jem dugmeta. */
    results({ title, stars = 0, score, lines = [], note = '', buttons = [] }) {
      const box = q('.trk-res');
      box.hidden = false;
      box.innerHTML = `<div class="trk-res-card">
        ${title ? `<h2>${title}</h2>` : ''}
        ${stars != null ? `<div class="trk-stars" aria-label="${stars}/3">${[0, 1, 2].map((i) => `<span class="${i < stars ? 'on' : ''}" style="animation-delay:${0.15 + i * 0.22}s">★</span>`).join('')}</div>` : ''}
        ${score != null ? `<div class="pr-score"><b>${Math.round(score)}</b><small>/100</small></div>` : ''}
        ${lines.length ? `<div class="pr-res-row">${lines.map((l) => `<span><small>${l.label}</small><b>${l.value}</b></span>`).join('')}</div>` : ''}
        ${note ? `<p class="trk-res-note">${note}</p>` : ''}
        <div class="trk-res-btns">${buttons.map((b) => `<button class="btn ${b.primary ? 'primary' : ''}" data-id="${b.id}">${b.label}</button>`).join('')}</div>
      </div>`;
      return new Promise((res) => box.querySelector('.trk-res-btns').addEventListener('click', (e) => {
        const b = e.target.closest('[data-id]');
        if (b) { box.hidden = true; res(b.dataset.id); }
      }));
    },
    destroy() {
      if (!alive) return;
      alive = false;
      cancelAnimationFrame(raf); cancelAnimationFrame(resizeQ);
      window.removeEventListener('resize', onResize);
      mq.removeEventListener('change', onMq);
      clearTimeout(rotT);
      handAnim?.forEach((a) => a.cancel());
      orientSubs.clear();
      el.remove();
      document.body.classList.remove('trk-open');
    },
  };
}

/** Zvezdice iz rezultata (0–100). */
export const starsOf = (score) => (score >= 92 ? 3 : score >= 75 ? 2 : score >= 50 ? 1 : 0);

/**
 * Jedna runda na stazi.
 * items: [{ kind: 'note'|'chord'|'strum', beat, dur?, s?, f?, finger?, frets?, fingers?, label?, dir?, lyric?,
 *           winBeats?, winCap?, deco? (samo za prikaz, ne ocenjuje se) }]
 * wait: true = „Čekaj me“ (čeka na svaku notu/akord, bez tempa); mode: 'beg' je stari naziv za isto
 * lagMs: koliko posle note još može da stigne ocena (provera trzaja ~90 ms, akorda ~350 ms) + kašnjenje mikrofona
 * hintOf(it) → tekst saveta u Početniku; fingersOf(it) → prsti koji svetle na ruci
 * demo: { play(it), early?(i) → true za jednu notu „rano“, captions: { [index]: tekst } }
 * Vraća { input(at, check), stop() }; check(it) → { ok, text? } (text = poruka za pogrešno).
 */
export function runTrack({ api, track, t, items, bpm, wait = null, mode = 'normal', lagMs = 180, hintOf, fingersOf, demo = null, onEnd }) {
  const beg = (wait ?? mode === 'beg') && !demo; // „Čekaj me“
  const beatMs = beg ? 60000 / 66 : 60000 / bpm; // Čekaj me: stalan, spor razmak između nota (bez tempa)
  const judged = items.filter((it) => !it.deco && !it.follow); // follow = ista nota napada kao prethodna (bas uz melodiju)
  // presuda za notu važi i za note koje je prate (isti trzaj)
  const judgeIt = (it, kind, text, o) => {
    track.judge(it, kind, text, o);
    for (const g of it.group || []) track.judge(g, kind, '', { quiet: true });
  };
  const endBeat = Math.max(...items.map((it) => it.beat + (it.dur || 1)));
  let met = null, gen = 0, resumeBeat = 0, paused = false, firstStart = false, ended = false, counting = true, sweepT = 0, lastCur = null, timers = [];
  let vt = -1e9, lastReal = performance.now(); // Početnik: virtuelni sat (staje kod note koja čeka)
  track.setItems(items, beatMs);
  track.progress(0);
  const win = (it) => Math.min(it.winCap || 300, beatMs * (it.winBeats || 0.5));
  const cur = () => judged.find((it) => !it.state);

  if (beg) {
    items.forEach((it) => (it.at = (it.beat + 2) * beatMs));
    track.useClock(() => {
      const n = performance.now();
      if (!paused && !counting) {
        vt += n - lastReal;
        const c = cur();
        if (c && vt > c.at) vt = c.at;
      }
      lastReal = n;
      return vt;
    });
    track.setGrid({ t0: 0 });
  } else track.useClock(() => performance.now());

  function retime(t0) {
    for (const it of items) if (!it.state || it.deco) it.at = t0 + it.beat * beatMs;
    track.setGrid({ t0 });
  }
  const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.push(id); return id; };

  // ---- Normalno / demo: metronom ----
  function startMetronome(first) {
    const my = ++gen;
    met = new Metronome();
    met.bpm = bpm; met.sig = '4/4'; met.countIn = 1;
    let k = 0;
    met.onStep = (slot, beat, accent, info) => {
      if (beat == null || my !== gen) return;
      api.pulse?.(beat, 4, beat === 0);
      if (info.countIn) {
        if (info.countBeat === 0) { retime(info.at + 4 * beatMs - resumeBeat * beatMs); if (first) track.handPulse(); }
        track.big(info.countBeat < 3 ? String(3 - info.countBeat) : t('pr.trk.go'));
        if (info.countBeat === 3) counting = false;
        return;
      }
      if (k === 0) track.big('');
      retime(info.at - (resumeBeat + k) * beatMs); // tačno vreme ovog klika (audio sat)
      if (resumeBeat + k >= endBeat) { met.stop(); later(finish, 900); return; }
      k++;
    };
    met.start();
  }
  // ---- Početnik: odbrojavanje bez metronoma ----
  function startBeginner(first) {
    counting = true;
    const my = ++gen;
    if (first) { vt = 0; track.handPulse(); }
    [3, 2, 1].forEach((n, i) => later(() => my === gen && track.big(String(n)), i * 650));
    later(() => { if (my !== gen) return; track.big(t('pr.trk.go')); counting = false; lastReal = performance.now(); }, 3 * 650);
  }

  function sweep() {
    if (ended) return;
    const c = cur();
    if (c !== lastCur) {
      lastCur = c;
      track.setCurrent(c);
      track.handLight(c ? (fingersOf ? fingersOf(c) : c.finger ? [c.finger] : []) : []);
      if (!demo) track.caption('');
      if (c?.lyric !== undefined) track.lyric(c.lyric);
    }
    if (paused || counting) return;
    const now = beg ? vt : performance.now();
    if (beg) {
      if (c && now >= c.at - 1 && hintOf && !c.hinted) { c.hinted = true; track.caption(hintOf(c)); }
      if (!c) { ended = true; later(finish, 700); }
    } else if (demo) {
      judged.forEach((it, i) => {
        if (it.state || now < it.at) return;
        demo.play?.(it);
        const early = demo.early?.(i);
        judgeIt(it, early ? 'early' : 'hit', early ? t('pr.trk.early') : t('pr.trk.hit'), { sound: false });
        if (demo.captions && demo.captions[i] != null) track.caption(demo.captions[i]);
      });
    } else {
      const lag = lagMs + (getLatency() ?? 60);
      for (const it of judged) if (!it.state && now - it.at > win(it) + lag) { it.score = 0; judgeIt(it, 'miss', t('pr.trk.miss')); }
    }
    track.progress(judged.filter((it) => it.state).length / judged.length);
  }

  function finish() {
    if (ended && !beg) return;
    ended = true;
    clearInterval(sweepT);
    met?.stop();
    off();
    for (const it of judged) if (!it.state) { it.score = 0; it.state = 'miss'; }
    const n = judged.length;
    const score = (judged.reduce((a, it) => a + (it.score || 0), 0) / n) * 100;
    const hits = judged.filter((it) => (it.score || 0) > 0).length;
    const wrongs = judged.reduce((a, it) => a + (it.wrong || 0), 0);
    const onTime = judged.filter((it) => it.kindHit === 'hit').length, offTime = judged.filter((it) => it.kindHit === 'early' || it.kindHit === 'late').length;
    track.caption(''); track.handLight([]); track.clearGhost();
    onEnd?.({ score, accuracy: hits / n, maxCombo: track.maxCombo, wrongs, n, hits, onTime, offTime, misses: n - hits, clean: beg ? wrongs <= Math.max(1, Math.round(n * 0.1)) : hits / n >= 0.85, tempo: bpm, beginner: beg, waited: beg });
  }
  // Ulaz igre (trzaj / udarac): nota najbliža trenutku „at“ (Početnik: nota koja čeka)
  function input(at, check) {
    if (ended || paused || counting) return;
    if (beg) {
      const c = cur();
      if (!c || vt < c.at - beatMs * 0.9) return;
      const r = check(c);
      if (r.pending) return; // nejasno — igra još sluša (stabilno očitavanje), pa javi ponovo
      // Početnik: bez tempa i promašaja — svaki pogrešan pokušaj odnese malo (najviše do 70 %)
      if (r.ok) { c.score = Math.max(0.7, 1 - 0.1 * (c.wrong || 0)); c.kindHit = 'hit'; judgeIt(c, 'hit', t('pr.trk.hit')); }
      else { c.wrong = (c.wrong || 0) + 1; track.wrong(c, r.text ? t('pr.trk.tryAgain', { x: r.text }) : t('pr.trk.notClear'), r.heard ?? null); }
      return;
    }
    let best = null;
    for (const it of judged) if (!it.state && Math.abs(at - it.at) <= win(it) && (!best || Math.abs(at - it.at) < Math.abs(at - best.at))) best = it;
    if (!best) return;
    const r = check(best);
    if (r.pending) return;
    if (!r.ok) { best.wrong = (best.wrong || 0) + 1; track.wrong(best, r.text || t('pr.trk.notClear'), r.heard ?? null); return; }
    const dt = at - best.at, tm = judgeTiming(dt, beatMs * Math.min(1, (best.winBeats || 0.5) * 2));
    best.score = (tm.kind === 'off' ? 0.6 : 0.6 + 0.4 * tm.score) * (best.wrong ? 0.7 : 1);
    const kind = tm.kind === 'hit' ? 'hit' : dt < 0 ? 'early' : 'late';
    best.kindHit = kind;
    judgeIt(best, kind, kind === 'hit' ? t('pr.trk.hit') : t(kind === 'early' ? 'pr.trk.early' : 'pr.trk.late'));
  }

  // Uspravno usred runde → pauza; položeno → novo odbrojavanje
  function pause() {
    if (ended || paused) return;
    paused = true; gen++;
    met?.stop(); met = null;
    const c = cur();
    resumeBeat = c ? Math.max(0, Math.floor(c.beat)) : endBeat;
    track.big('');
    track.sleep(true);
    api.pauseHw?.(true); // mikrofon ne obrađuje, ekran sme da se ugasi
  }
  function resume() {
    if (ended || !paused) return;
    paused = false;
    counting = true;
    track.sleep(false);
    api.pauseHw?.(false);
    const f = firstStart; firstStart = false;
    if (beg) startBeginner(f); else startMetronome(f);
  }
  const offOrient = track.onOrientation((portrait) => (portrait ? pause() : resume()));
  function off() { offOrient(); timers.forEach(clearTimeout); timers = []; }

  sweepT = setInterval(sweep, 30);
  if (track.isPortrait()) { paused = true; resumeBeat = 0; firstStart = true; track.sleep(true); api.pauseHw?.(true); } // počinje tek kad se telefon okrene
  else if (beg) startBeginner(true); else startMetronome(true);

  let held = false;
  return {
    input,
    /** Ručna pauza (npr. otvorena kartica „i“); nastavak ide uz novo odbrojavanje. */
    hold() { if (!paused) { held = true; pause(); } },
    release() { if (held) { held = false; if (!track.isPortrait()) resume(); } },
    stop() { ended = true; gen++; clearInterval(sweepT); met?.stop(); off(); },
    get beatMs() { return beatMs; },
  };
}

/**
 * Rezultat runde na stazi + čuvanje; vraća izbor: 'faster' | 'again' | 'tryNormal' | 'back' | dodatna dugmad.
 * extra: [{ id, label, primary }] (npr. „Sledeći deo“) — idu ispred ostalih.
 */
export async function roundResults({ api, track, t, stats, key = null, extra = [], step = 5 }) {
  const info = await api.finish({ score: stats.score, tempo: stats.tempo, accuracy: stats.accuracy, metric: stats.metric ?? null, quiet: true, noTempoUp: stats.beginner }, key);
  if (!track) return { choice: 'back' };
  const stars = starsOf(stats.score);
  const fixed = api.speed && api.speed !== 'grad';
  const next = stats.beginner ? stats.tempo : fixed ? stats.tempo : info.nextTempo > stats.tempo ? info.nextTempo : stats.tempo + step;
  const fasterBtn = fixed
    ? (api.nextSpeed ? [{ id: 'faster', label: t('pr.speed.try', { s: api.speedLabel(api.nextSpeed) }), primary: stars >= 2 }] : [])
    : [{ id: 'faster', label: t('pr.trk.faster', { bpm: next }), primary: stars >= 2 }];
  // posle „Čekaj me“: bez tempa; posle čistog prolaza nudi se „Sad bez čekanja“
  const buttons = stats.beginner
    ? [...(stats.clean ? [{ id: 'noWait', label: t('pr.wait.tryOff'), primary: true }] : []), ...extra.filter((b) => b.always), { id: 'again', label: t('pr.trk.again'), primary: !stats.clean }, { id: 'back', label: t('pr.trk.back') }]
    // uz „Sledeći deo“ / „Cela pesma“ (pravi tempo pesme je dostignut) nema „Brže“
    : [...extra, ...(extra.length ? [] : fasterBtn), { id: 'again', label: t('pr.trk.again'), primary: !extra.length && (stars < 2 || !fasterBtn.length) }, { id: 'back', label: t('pr.trk.back') }];
  // Zašto je rezultat ovakav: pogođeno, u ritmu / rano-kasno, promašeno, pogrešni pokušaji
  const lines = [{ label: t('pr.why.hit'), value: `${stats.hits}/${stats.n}` }];
  if (!stats.beginner) {
    lines.push({ label: t('pr.why.onTime'), value: String(stats.onTime) });
    if (stats.offTime) lines.push({ label: t('pr.why.offTime'), value: String(stats.offTime) });
    if (stats.misses) lines.push({ label: t('pr.why.missed'), value: String(stats.misses) });
  }
  lines.push({ label: t('pr.why.wrong'), value: String(stats.wrongs) });
  lines.push({ label: t('pr.trk.maxCombo'), value: String(stats.maxCombo) });
  if (!stats.beginner) lines.push({ label: t('pr.tempoReached'), value: `${stats.tempo} BPM` });
  if (stats.metric != null && stats.metricLabel) lines.push({ label: stats.metricLabel, value: t('pr.unit.perMin', { n: stats.metric }) });
  const choice = await track.results({
    title: stats.beginner ? t(stats.clean ? 'pr.lvl.cleanTitle' : 'pr.lvl.notCleanTitle') : t('pr.trk.res' + stars),
    stars, score: stats.score, lines,
    note: [info.newBest ? t('pr.newBest') : '', info.challenge ? t('pr.speed.challengeDone') : '', stats.beginner && stats.clean ? t('pr.wait.cleanNote') : ''].filter(Boolean).join(' '),
    buttons,
  });
  return { choice, next };
}

/** Zajednički odgovor na izbor posle rezultata. Vraća true ako je igra to sama obradila. */
export function handleChoice(api, choice, next, close) {
  if (choice === 'back') { close(); return true; }
  if (choice === 'tryNormal') { api.setWait(false); api.restart(); return true; }
  if (choice === 'noWait') { api.setWait(false); api.restart(); return true; }
  if (choice === 'faster') { if (api.speed && api.speed !== 'grad') { if (api.nextSpeed) api.setSpeed(api.nextSpeed); } else api.setBpm(next); api.restart(); return true; }
  if (choice === 'again') { api.restart(); return true; }
  return false;
}

/** Tekst saveta za notu u Početniku: „Žica A, prag 2“ (prazna žica: „Prazna žica A“). */
export function noteHint(t, it) {
  const sName = it.s === 5 ? dn('E').toLowerCase() : noteLabel(OPEN_MIDI[it.s]);
  return it.f === 0 ? t('pr.hint.open', { s: sName }) : t('pr.hint.note', { s: sName, f: it.f, n: it.finger });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Zajednički okvir za igre na stazi (Pauk, Ritam, Promena akorda, Delovi pesme).
 * cfg.round(level, bpm) → { items, bpm?, lagMs?, hintOf?, fingersOf?, key? , extra?(stats) }
 * cfg.listen(round, input) → opcije za api.listen (onPluck / onOnset …); input(at, check) ide u rundu
 * cfg.onRoundEnd?(stats, round, ctl) → true ako je igra sama nastavila (npr. sledeći prolaz pesme)
 * cfg.onChoice?(choice, round, ctl) — dugmad iz cfg.round().extra
 * cfg.demo: { items(), bpm, play(it), early?(i), captions: {i: tekst}, intro, fingersOf? }
 */
export function trackGame(api, cfg) {
  const { t } = api;
  let track = null, runner = null, unsub = null, gen = 0;
  const ORDER = ['slow', 'normal', 'fast', 'challenge'];
  const speedCtl = {
    label: () => api.speedLabel(),
    cycle() {
      const nx = ORDER[(ORDER.indexOf(api.target ?? api.speed) + 1) % ORDER.length];
      api.setSpeed(nx);
      if (runner && track && api.running) { track.pop(t('pr.speed.now', { s: api.speedLabel() }), 'hit'); startRound(cfg.round(api.level, api.bpm), api.bpm); }
      return api.speedLabel();
    },
  };
  const open = () => { if (track) track.reset(); else track = createTrack({ t, onExit: () => api.stop(), onInfo: cfg.onInfo ? () => cfg.onInfo(ctl) : null, speed: api.wait || cfg.noTempo || !api.setSpeed ? null : speedCtl }); return track; };
  const close = () => { gen++; runner?.stop(); runner = null; track?.destroy(); track = null; };
  const ctl = {
    get track() { return track; },
    close,
    /** Nova runda bez novog dodira (npr. sledeći prolaz): mikrofon ostaje uključen. */
    async next(round) { await startRound(round, api.bpm); },
    /** Pauza / nastavak runde u toku (kartica „i“). */
    hold() { runner?.hold(); },
    release() { runner?.release(); },
  };

  async function startRound(round, bpm) {
    const my = ++gen;
    runner?.stop();
    track.reset();
    track.setLyricMode(round.items.some((it) => it.lyric !== undefined));
    track.relayout(); // raspored se meri jednom, na početku runde
    runner = runTrack({
      api, track, t, items: round.items, bpm: round.bpm || bpm, wait: round.wait ?? api.wait,
      lagMs: round.lagMs ?? 180, hintOf: round.hintOf, fingersOf: round.fingersOf,
      onEnd: (stats) => my === gen && ended(stats, round),
    });
  }
  async function play(bpm) {
    open();
    const round = cfg.round(api.level, bpm);
    await Promise.all([api.listen(cfg.listen(round, (at, check) => runner?.input(at, check))), warmSounds(round.items)]);
    unsub?.(); unsub = api.onLevel((lv, note) => track?.level(lv, note));
    if (!api.running || !track) return;
    await startRound(round, bpm);
  }
  async function ended(stats, round) {
    runner = null;
    if (!api.running || !track) return;
    if (cfg.onRoundEnd && (await cfg.onRoundEnd(stats, round, ctl))) return;
    if (cfg.metric && !stats.beginner) { stats.metric = Math.round(cfg.metric(stats, round)); stats.metricLabel = cfg.metricLabel; }
    const { choice, next } = await roundResults({ api, track, t, stats, key: round.key || null, extra: round.extra ? round.extra(stats) : [] });
    if (handleChoice(api, choice, next, close)) return;
    cfg.onChoice?.(choice, round, ctl);
  }

  // Demo (samo na dugme „Pogledaj demo“; nikad samo od sebe) — bez mikrofona, ništa se ne čuva
  async function demo() {
    open();
    const my = gen;
    await track.whenLandscape();
    if (!track || my !== gen || !api.running) return;
    track.handPulse();
    track.caption(cfg.demo.intro);
    await Promise.all([wait(2800), warmSounds(cfg.demo.items(), 2800)]); // zvuci se učitaju dok traje uvod
    if (!track || my !== gen || !api.running) return;
    const d = cfg.demo, its = d.items();
    track.setLyricMode(its.some((it) => it.lyric !== undefined));
    track.relayout();
    runner = runTrack({
      api, track, t, items: its, bpm: d.bpm, demo: { play: d.play, early: d.early, captions: d.captions },
      fingersOf: d.fingersOf,
      onEnd: async () => {
        runner = null;
        if (!track || !api.running) return;
        track.caption('');
        api.stopNow();
        const choice = await track.results({
          title: t('pr.demo.end'), stars: null,
          note: api.wait ? t('pr.demo.slowBeg') : t('pr.demo.slow', { bpm: cfg.firstBpm || 50 }),
          buttons: [{ id: 'go', label: t('pr.demo.nowYou'), primary: true }, { id: 'replay', label: t('pr.demo.replay') }, { id: 'back', label: t('pr.trk.back') }],
        });
        if (choice === 'back') { close(); return; }
        if (choice === 'replay') { api.startCustom(demo); return; }
        if (api.level !== 'beg' && (!api.speed || api.speed === 'grad')) api.setBpm(cfg.firstBpm || 50);
        api.restart();
      },
    });
  }

  return {
    track: true,
    levels: cfg.levels,
    bpm: cfg.bpm,
    initialTempo: cfg.initialTempo,
    noTempo: cfg.noTempo,
    noStart: cfg.noStart,
    demo,
    start: play,
    onLevel: cfg.onLevel,
    stop() { unsub?.(); unsub = null; close(); },
    destroy() { this.stop(); },
    ctl,
  };
}

/** Blok akorda za stazu: prvi (najlakši) hvat, prsti u bojama. */
export function chordItem(chord, beat, dur, extra = {}) {
  const v = getVoicings(chord)[0];
  return { kind: 'chord', beat, dur, chord, label: dn(chord), frets: v ? v.frets : [-1, -1, -1, -1, -1, -1], fingers: v ? v.fingers.map((f, i) => (v.barre && v.frets[i] === v.barre.fret && i >= v.barre.from && i <= v.barre.to ? 1 : f)) : [], winBeats: 0.45, winCap: 450, ...extra };
}
/** Prsti koje akord koristi (za ruku). */
export const chordFingers = (it) => [...new Set((it.fingers || []).filter((f, i) => f > 0 && it.frets[i] > 0))];

/**
 * Zajednička provera trzaja za igre sa notama (staza): prvo očitavanje; ako je nejasno (susedni prag, mala razlika),
 * sačeka se ustaljen zvuk (~0,2 s) i tek onda presudi. Pogrešna nota → poruka „To je F“ + bled crveni krug.
 */
export function notePluck(api, log, input, t, game, midiOfItem) {
  return (p) => {
    debugLog({ game, pluck: Math.round(p.at) });
    log.onset({ at: p.at }); log.pluck(p);
    const h = log.hits[log.hits.length - 1];
    const run = () => input(h.at, (it) => {
      const v = log.verdict(h, midiOfItem(it), game);
      if (v.ok) return { ok: true };
      if (v.unclear && api.listener) {
        api.listener.steady(p.rawAt ?? p.at, (sg) => { log.steadied(h, sg); run(); });
        return { pending: true };
      }
      return { ok: false, text: v.heard != null ? t('pr.trk.wrong', { n: noteLabel(v.heard) }) : '', heard: v.heard };
    });
    run();
  };
}

// zajednički sitni delovi (i za kvizove) — da Lovac i Sluh ne učitavaju celu stazu
export { hitSound, placeOf, quizPluck };
