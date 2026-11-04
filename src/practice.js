// Vežbe: igre za vežbanje gitare. Ovaj fajl (i igre) se učitava tek kad se otvori tab „Vežbe“
// ili prečica iz pesme — pokretanje tunera i biblioteke se ne menja.
// Ovde: kartice igara, zajednički ekran igre (puls metronoma, „scena“, povratna informacija, tempo,
// start/stop, rezultat) i čuvanje rezultata (najbolji rezultat, niz dana, poslednji tempo).
import { t } from './i18n.js';
import { esc } from './ui.js';
import { settings } from './db.js';
import { keepAwake, allowSleep, setWakeZone } from './wakelock.js';
import { stopGroup } from './synth.js';

// Igre: učitavaju se pojedinačno, tek kad se otvore
export const GAMES = [
  { id: 'pauk', load: () => import('./pSpider.js'), icon: '<path d="M4 18h16M4 14h16M4 10h16M4 6h16" stroke-width="1.4"/><circle cx="7" cy="16" r="1.7" class="f"/><circle cx="10" cy="12" r="1.7" class="f"/><circle cx="13" cy="8" r="1.7" class="f"/><circle cx="16" cy="4.4" r="1.7" class="f"/>' },
  { id: 'lovac', load: () => import('./pHunter.js'), icon: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.3" class="f"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>' },
  { id: 'ritam', load: () => import('./pRhythm.js'), icon: '<path d="M7 4v13"/><path d="M17 4v11"/><path d="M7 4l10-1.5"/><circle cx="5.2" cy="17.5" r="2.4" class="f"/><circle cx="15.2" cy="15.5" r="2.4" class="f"/>' },
  { id: 'promena', load: () => import('./pChords.js'), icon: '<rect x="3" y="4" width="7" height="10" rx="1.5"/><rect x="14" y="10" width="7" height="10" rx="1.5"/><path d="M10 17h3.5l-1.6-1.6M14 7h-3.5l1.6 1.6"/>' },
  { id: 'sluh', load: () => import('./pEar.js'), icon: '<path d="M8 15c-1.6-1.4-2.5-3.4-2.5-5.5A6.5 6.5 0 0 1 18.5 9.5c0 2.4-1.3 3.7-2.5 4.7-1.1.9-1.6 1.8-1.8 3.2A2.9 2.9 0 0 1 11.3 20"/><path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.2-.8 1.9-1.6 2.4"/>' },
  { id: 'pesma', load: () => import('./pSong.js'), icon: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5" class="f"/><circle cx="17.5" cy="16" r="2.5" class="f"/>' },
];

// ---------------- Rezultati (čuvaju se lokalno i u rezervnoj kopiji na Google Drive-u) ----------------
const KEY = 'practice';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const dayNum = (s) => { const [y, m, d] = String(s || '').split('-').map(Number); return y ? Math.round(new Date(y, m - 1, d).getTime() / 864e5) : null; };

export async function loadStats() {
  const s = await settings.get(KEY, null);
  return s && typeof s === 'object' ? { v: 1, games: s.games || {}, songs: s.songs || {} } : { v: 1, games: {}, songs: {} };
}

/** Niz dana: igrano danas ili juče → niz traje; ranije → prekinut (0). */
export function currentStreak(rec) {
  if (!rec || !rec.lastDay) return 0;
  const gap = dayNum(today()) - dayNum(rec.lastDay);
  return gap <= 1 ? rec.streak || 0 : 0;
}

/** Upis rezultata runde. key: npr. id pesme + deo (za „Delovi pesme“). */
export async function saveResult(gameId, res, key = null) {
  const st = await loadStats();
  const upd = (rec = {}) => {
    const day = today(), last = rec.lastDay;
    const gap = last ? dayNum(day) - dayNum(last) : null;
    const streak = gap === 0 ? rec.streak || 1 : gap === 1 ? (rec.streak || 0) + 1 : 1;
    return { best: Math.max(rec.best || 0, res.score), streak, lastDay: day, lastTempo: res.nextTempo || res.tempo, plays: (rec.plays || 0) + 1 };
  };
  st.games[gameId] = upd(st.games[gameId]);
  if (key) {
    const [songId, part] = key;
    const song = st.songs[songId] || {};
    song[part] = upd(song[part]);
    st.songs[songId] = song;
  }
  await settings.set(KEY, st);
  return st;
}

// ---------------- Prikaz ----------------
const ico = (g) => `<svg class="pr-ico-svg" viewBox="0 0 24 24" aria-hidden="true">${g.icon}</svg>`;
let leave = null; // gašenje igre koja je otvorena

export async function renderPractice(root, parts = [], params = new URLSearchParams()) {
  leave?.();
  const id = parts[0] || '';
  const game = GAMES.find((g) => g.id === id);
  if (!game) return renderHub(root);
  return renderGame(root, game, parts.slice(1), params);
}

async function renderHub(root) {
  setWakeZone(null);
  const st = await loadStats();
  root.innerHTML = `
  <section class="view practice-view">
    <header class="view-head"><h1>${t('pr.title')}</h1></header>
    <p class="muted pr-intro">${t('pr.intro')}</p>
    <div class="pr-cards">
      ${GAMES.map((g) => {
        const rec = st.games[g.id] || {};
        const streak = currentStreak(rec);
        return `<a class="card pr-card" href="#/vezbe/${g.id}">
          <span class="pr-ico">${ico(g)}</span>
          <span class="pr-txt"><b>${t('pr.g.' + g.id)}</b><span class="small muted">${t('pr.d.' + g.id)}</span></span>
          <span class="pr-stats">
            <span><small>${t('pr.best')}</small><b>${rec.best ? rec.best : '–'}</b></span>
            <span><small>${t('pr.streak')}</small><b>${streak ? t('pr.days', { n: streak }) : '–'}</b></span>
          </span>
        </a>`;
      }).join('')}
    </div>
  </section>`;
}

/**
 * Zajednički ekran igre. Igra (modul) izvozi createGame(api) i vraća
 * { start(bpm), stop(), bpm: { start, min, max, step } , onTempo?(bpm) }.
 */
async function renderGame(root, game, args, params) {
  root.innerHTML = `
  <section class="view practice-view pr-game" data-game="${game.id}">
    <header class="topbar">
      <a href="#/vezbe" class="back">‹ ${t('pr.title')}</a>
      <span class="pr-gtitle">${ico(game)}<b>${t('pr.g.' + game.id)}</b></span>
    </header>
    <div class="pr-pulse" id="prPulse" aria-hidden="true"></div>
    <div class="pr-stage" id="prStage"><p class="muted center">${t('common.loading')}</p></div>
    <div class="pr-fb" id="prFb" role="status" aria-live="polite">&nbsp;</div>
    <div class="pr-opts" id="prOpts"></div>
    <div class="pr-tempo" id="prTempo">
      <button class="btn round small" id="prSlower" aria-label="${t('pr.slower')}">−</button>
      <span><b id="prBpm">90</b> <small id="prUnit">BPM</small></span>
      <button class="btn round small" id="prFaster" aria-label="${t('pr.faster')}">+</button>
    </div>
    <button class="btn primary big wide" id="prGo">${t('pr.start')}</button>
    <div class="card pr-result" id="prRes" hidden></div>
  </section>`;
  const $ = (q) => root.querySelector('#' + q);

  let mod;
  try { mod = await game.load(); } catch (e) { $('prStage').innerHTML = `<p class="err">${esc(t('err.title'))}</p>`; throw e; }
  const st = await loadStats();
  const rec = st.games[game.id] || {};
  let running = false, bpm = 90, gameObj = null, listener = null;
  const cleanups = new Set();

  const api = {
    stage: $('prStage'),
    opts: $('prOpts'),
    args, params,
    stats: rec,
    allStats: st,
    get running() { return running; },
    get bpm() { return bpm; },
    setBpm(v) { bpm = Math.round(Math.max(B.min, Math.min(B.max, v))); $('prBpm').textContent = B.fmt(bpm); },
    /** Puls metronoma na vrhu: beat = 0..beats-1 (null = osmina između) */
    pulse(beat, beats = 4, accent = false) {
      const p = $('prPulse');
      if (p.childElementCount !== beats) p.innerHTML = '<i></i>'.repeat(beats);
      if (beat == null) return;
      const dot = p.children[beat];
      if (!dot) return;
      dot.classList.remove('on', 'acc'); void dot.offsetWidth; // ponovo pokreni animaciju
      dot.classList.add('on'); if (accent) dot.classList.add('acc');
    },
    /** Trenutna povratna informacija: kind = 'hit' | 'miss' | 'early' | 'late' | '' */
    feedback(kind, text) {
      const f = $('prFb');
      f.className = 'pr-fb' + (kind ? ' ' + kind : '');
      f.textContent = text || ' ';
    },
    /** Slušanje (mikrofon) — zajedničko za sve igre; gasi se automatski pri izlasku. */
    async listen(opts) {
      if (!listener) { const { createListener } = await import('./practiceListen.js'); listener = createListener(); }
      await listener.start(opts);
      return listener;
    },
    onCleanup(fn) { cleanups.add(fn); },
    /** Zaustavi bez rezultata (npr. posle podešavanja kašnjenja). */
    stopNow() { stopRun(false); },
    /** Pokreni posebnu rundu (npr. podešavanje kašnjenja) sa istim gašenjem kao igra. */
    startCustom(fn) { return startRun(fn); },
    /** Kraj runde: rezultat 0–100, tempo, tačnost (0–1). key = [songId, deo] za „Delovi pesme“. */
    async finish(res, key = null) {
      stopRun(false);
      const nextTempo = res.score > 90 ? Math.max(B.min, Math.min(B.max, res.tempo + B.step * B.dir)) : res.tempo;
      await saveResult(game.id, { ...res, nextTempo }, key);
      const prevBest = key ? ((st.songs[key[0]] || {})[key[1]] || {}).best || 0 : rec.best || 0;
      showResult({ ...res, nextTempo, newBest: res.score > prevBest });
      if (nextTempo !== res.tempo) api.setBpm(nextTempo);
      gameObj?.onResult?.(res);
    },
    t, esc,
  };

  gameObj = await mod.createGame(api);
  api.pulse(null, gameObj.beats || 4); // tačke otkucaja odmah (ekran ne „skače“ na startu)
  // Brzina: BPM (više = brže) ili npr. sekunde po noti (dir: -1 → manje = brže)
  const B = { start: 80, min: 40, max: 200, step: 5, dir: 1, fmt: (v) => String(v), unit: 'BPM', ...(gameObj.bpm || {}) };
  $('prUnit').textContent = B.unit;
  api.setBpm(rec.lastTempo || B.start);
  if (gameObj.noTempo) $('prTempo').hidden = true;
  $('prSlower').addEventListener('click', () => api.setBpm(bpm - B.step * B.dir));
  $('prFaster').addEventListener('click', () => api.setBpm(bpm + B.step * B.dir));

  function showResult(r) {
    const box = $('prRes');
    box.hidden = false;
    box.innerHTML = `
      <div class="pr-score"><b>${Math.round(r.score)}</b><small>/100</small></div>
      ${r.newBest ? `<p class="pr-best">${t('pr.newBest')}</p>` : ''}
      <div class="pr-res-row">
        <span><small>${t(B.dir < 0 ? 'pr.speedReached' : 'pr.tempoReached')}</small><b>${B.fmt(r.tempo)} ${B.unit}</b></span>
        <span><small>${t('pr.accuracy')}</small><b>${Math.round((r.accuracy || 0) * 100)}%</b></span>
        ${r.extra ? `<span><small>${esc(r.extra.label)}</small><b>${esc(String(r.extra.value))}</b></span>` : ''}
      </div>
      ${r.nextTempo !== r.tempo ? `<p class="small pr-up">${t('pr.tempoUp', { bpm: B.fmt(r.nextTempo) + ' ' + B.unit })}</p>` : ''}
      <button class="btn primary big wide" id="prAgainFaster">${t('pr.againFaster')}</button>`;
    box.querySelector('#prAgainFaster').addEventListener('click', () => {
      if (r.nextTempo === r.tempo) api.setBpm(bpm + B.step * B.dir);
      box.hidden = true;
      startRun();
    });
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function startRun(custom = null) {
    if (running) return;
    $('prRes').hidden = true;
    running = true;
    root.querySelector('.pr-game').classList.add('running');
    $('prGo').textContent = t('pr.stop');
    $('prGo').classList.remove('primary');
    keepAwake('practice'); // ekran ostaje upaljen samo dok igra traje
    try { await (typeof custom === 'function' ? custom() : gameObj.start(bpm)); }
    catch (e) { api.feedback('miss', e && e.message ? e.message : t('mic.failed')); stopRun(); }
  }
  // Sve se gasi: igra, metronom, tonovi, mikrofon, budnost ekrana
  function stopRun(callGame = true) {
    const was = running;
    running = false;
    root.querySelector('.pr-game')?.classList.remove('running');
    $('prGo').textContent = t('pr.start');
    $('prGo').classList.add('primary');
    if (callGame && was) { try { gameObj.stop(); } catch {} }
    listener?.stop();
    stopGroup('practice');
    allowSleep('practice');
  }
  $('prGo').addEventListener('click', () => (running ? stopRun() : startRun()));
  // „Ponovo, brže“ i slično pozivaju startRun() bez argumenata

  // Izlazak iz igre (druga stranica) ili aplikacija u pozadini → ugasi sve
  const onHide = () => { if (document.hidden) stopRun(); };
  const onHash = () => { if (!location.hash.startsWith('#/vezbe/' + game.id)) leave?.(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('hashchange', onHash);
  leave = () => {
    leave = null;
    stopRun();
    try { gameObj?.destroy?.(); } catch {}
    cleanups.forEach((fn) => { try { fn(); } catch {} });
    listener?.close();
    listener = null;
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('hashchange', onHash);
  };
}
