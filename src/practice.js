// Vežbe: igre za vežbanje gitare. Ovaj fajl (i igre) se učitava tek kad se otvori tab „Vežbe“
// ili prečica iz pesme — pokretanje tunera i biblioteke se ne menja.
// Ovde: kartice igara, zajednički ekran igre (puls metronoma, „scena“, povratna informacija, tempo,
// start/stop, rezultat) i čuvanje rezultata (najbolji rezultat, niz dana, poslednji tempo).
import { t, LANGS, onLangChange } from './i18n.js';
import * as TEXTS from './practiceText.js';
import { esc } from './ui.js';
import { settings } from './db.js';
import { keepAwake, allowSleep, setWakeZone } from './wakelock.js';
import { stopGroup } from './synth.js';
import { noteLabel } from './practiceBoard.js';
const starsOf = (score) => (score >= 92 ? 3 : score >= 75 ? 2 : score >= 50 ? 1 : 0);

// Tekstovi i stilovi Vežbi se učitavaju tek ovde (ne pri pokretanju aplikacije)
function mergeTexts() { Object.assign(LANGS.sr, TEXTS.sr); if (LANGS.en) Object.assign(LANGS.en, TEXTS.en); }
mergeTexts();
onLangChange(mergeTexts);
const cssReady = new Promise((resolve) => {
  if (document.getElementById('practiceCss')) return resolve();
  const l = document.createElement('link');
  l.id = 'practiceCss'; l.rel = 'stylesheet';
  l.href = new URL('./practice.css' + new URL(import.meta.url).search, import.meta.url).href; // ista verzija kao ovaj fajl
  l.onload = l.onerror = () => resolve();
  document.head.appendChild(l);
  setTimeout(resolve, 1500); // nikad ne čekaj večno (npr. bez interneta pre keširanja)
});

// Igre: učitavaju se pojedinačno, tek kad se otvore
// color = boja kartice (blagi sjaj, kao boje prstiju); prev = mali animirani pregled igre (SVG + CSS, bez zvuka)
const LINES = '<path class="pv-str" d="M4 22h72M4 34h72M4 46h72M4 58h72"/>';
const HIT = '<path class="pv-hit" d="M17 14v52"/>';
export const GAMES = [
  { id: 'pauk', color: '#b48cff', load: () => import('./pSpider.js'),
    icon: '<path d="M4 18h16M4 14h16M4 10h16M4 6h16" stroke-width="1.4"/><circle cx="7" cy="16" r="1.7" class="f"/><circle cx="10" cy="12" r="1.7" class="f"/><circle cx="13" cy="8" r="1.7" class="f"/><circle cx="16" cy="4.4" r="1.7" class="f"/>',
    prev: `${LINES}${HIT}<g class="pv-slide">${[0, 1].map((k) => [[22, 1], [34, 2], [46, 3], [58, 4]].map(([y, f], i) => `<circle cx="${30 + i * 14 + k * 56}" cy="${y}" r="5" class="pv-f${f}"/>`).join('')).join('')}</g>` },
  { id: 'skale', color: '#9be15d', load: () => import('./pScales.js'),
    // stepenice skale: note se penju po žicama
    icon: '<path d="M4 20h4v-4h4v-4h4V8h4" stroke-width="1.6"/><circle cx="6" cy="17" r="1.6" class="f"/><circle cx="10" cy="13" r="1.6" class="f"/><circle cx="14" cy="9" r="1.6" class="f"/><circle cx="18" cy="5" r="1.6" class="f"/>',
    prev: `${LINES}${HIT}<g class="pv-slide">${[0, 1].map((k) => [[58, 1], [58, 3], [46, 1], [46, 3], [34, 1], [34, 3], [22, 1], [22, 4]].map(([y, f], i) => `<circle cx="${28 + i * 7 + k * 56}" cy="${y}" r="4" class="pv-f${f}"/>`).join('')).join('')}</g>` },
  { id: 'lovac', color: '#ff7cc3', load: () => import('./pHunter.js'),
    icon: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.3" class="f"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>',
    prev: '<circle cx="40" cy="40" r="24" class="pv-ring"/><circle cx="40" cy="40" r="14" class="pv-ring"/><path class="pv-ring" d="M40 8v10M40 62v10M8 40h10M62 40h10"/><circle cx="40" cy="40" r="5" class="pv-dot pv-hunt"/><circle cx="40" cy="40" r="24" class="pv-ping"/>' },
  { id: 'ritam', color: '#ffd75e', load: () => import('./pRhythm.js'),
    // metronom
    icon: '<path d="M7.5 21 10.3 3.5h3.4L16.5 21z"/><path d="M6.5 21h11"/><path d="M12 16.5 17.5 6.5"/><circle cx="17.6" cy="6.4" r="1.5" class="f"/>',
    prev: `${HIT}<g class="pv-slide">${[0, 1].map((k) => [[30, 'n'], [44, 'd'], [58, 'u'], [72, 'n']].map(([x, w]) => { const X = x + k * 56; return w === 'n' ? `<circle cx="${X}" cy="40" r="5" class="pv-f0"/>` : w === 'd' ? `<path class="pv-arrow" d="M${X} 24v32M${X - 5} 50l5 6 5-6"/>` : `<path class="pv-arrow" d="M${X} 56V24M${X - 5} 30l5-6 5 6"/>`; }).join('')).join('')}</g><circle cx="17" cy="40" r="7" class="pv-beat"/>` },
  { id: 'promena', color: '#5aa9ff', load: () => import('./pChords.js'),
    icon: '<rect x="3" y="4" width="7" height="10" rx="1.5"/><rect x="14" y="10" width="7" height="10" rx="1.5"/><path d="M10 17h3.5l-1.6-1.6M14 7h-3.5l1.6 1.6"/>',
    prev: `${LINES}${HIT}<g class="pv-slide pv-slow">${[0, 1].map((k) => [28, 56].map((x, i) => { const X = x + k * 56; return `<rect x="${X - 7}" y="15" width="22" height="50" rx="6" class="pv-block"/><circle cx="${X}" cy="${i ? 22 : 34}" r="4" class="pv-f1"/><circle cx="${X + 8}" cy="${i ? 46 : 46}" r="4" class="pv-f2"/><circle cx="${X}" cy="${i ? 58 : 58}" r="4" class="pv-f3"/>`; }).join('')).join('')}</g>` },
  { id: 'sluh', color: '#4fd1c5', load: () => import('./pEar.js'),
    icon: '<path d="M8 15c-1.6-1.4-2.5-3.4-2.5-5.5A6.5 6.5 0 0 1 18.5 9.5c0 2.4-1.3 3.7-2.5 4.7-1.1.9-1.6 1.8-1.8 3.2A2.9 2.9 0 0 1 11.3 20"/><path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.2-.8 1.9-1.6 2.4"/>',
    prev: '<g transform="translate(2 14) scale(2.1)"><path class="pv-ear" d="M8 15c-1.6-1.4-2.5-3.4-2.5-5.5A6.5 6.5 0 0 1 18.5 9.5c0 2.4-1.3 3.7-2.5 4.7-1.1.9-1.6 1.8-1.8 3.2A2.9 2.9 0 0 1 11.3 20"/></g><path class="pv-wave pv-w1" d="M60 30q6 10 0 20"/><path class="pv-wave pv-w2" d="M66 24q10 16 0 32"/><path class="pv-wave pv-w3" d="M72 18q14 22 0 44"/>' },
  { id: 'pesma', color: '#f5a524', load: () => import('./pSong.js'),
    // list sa tekstom i notom
    icon: '<rect x="3.5" y="3" width="12.5" height="18" rx="2"/><path d="M6.5 8h6.5M6.5 11.5h6.5M6.5 15h3.5"/><path d="M20.5 8.5v9"/><circle cx="18.6" cy="17.6" r="2" class="f"/>',
    prev: '<rect x="10" y="44" width="60" height="5" rx="2.5" class="pv-lyr"/><rect x="10" y="56" width="44" height="5" rx="2.5" class="pv-lyr"/><rect x="10" y="44" width="60" height="5" rx="2.5" class="pv-lyr-on"/><g class="pv-chords"><rect x="10" y="20" width="16" height="14" rx="4" class="pv-chip"/><rect x="32" y="20" width="16" height="14" rx="4" class="pv-chip"/><rect x="54" y="20" width="16" height="14" rx="4" class="pv-chip"/></g>' },
];

// ---------------- Rezultati (čuvaju se lokalno i u rezervnoj kopiji na Google Drive-u) ----------------
const KEY = 'practice';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const dayNum = (s) => { const [y, m, d] = String(s || '').split('-').map(Number); return y ? Math.round(new Date(y, m - 1, d).getTime() / 864e5) : null; };

export async function loadStats() {
  const s = await settings.get(KEY, null);
  const st = s && typeof s === 'object' ? { v: 1, games: s.games || {}, songs: s.songs || {} } : { v: 1, games: {}, songs: {} };
  // stari zapisi su ponekad imali decimale (npr. 23.33333) — uvek celi brojevi
  const fix = (r) => { if (r && typeof r === 'object') { r.best = Math.round(Number(r.best) || 0); if (r.bestMetric != null) r.bestMetric = Math.round(Number(r.bestMetric) || 0); if (r.lastTempo) r.lastTempo = Math.round(r.lastTempo); } };
  Object.values(st.games).forEach(fix);
  Object.values(st.songs).forEach((parts) => parts && Object.values(parts).forEach(fix));
  return st;
}

/** Niz dana: igrano danas ili juče → niz traje; ranije → prekinut (0). */
export function currentStreak(rec) {
  if (!rec || !rec.lastDay) return 0;
  const gap = dayNum(today()) - dayNum(rec.lastDay);
  return gap <= 1 ? rec.streak || 0 : 0;
}

/** Upis rezultata runde. key: npr. id pesme + deo (za „Delovi pesme“). */
export async function saveResult(gameId, res, key = null) {
  try { dispatchEvent(new Event('marli-act')); } catch {} // v1.73: završena runda = aktivno vežbanje
  const st = await loadStats();
  const upd = (rec = {}) => {
    const day = today(), last = rec.lastDay;
    const gap = last ? dayNum(day) - dayNum(last) : null;
    const streak = gap === 0 ? rec.streak || 1 : gap === 1 ? (rec.streak || 0) + 1 : 1;
    const tNow = Math.round(res.tempo || res.nextTempo || 0) || undefined;
    const out = { best: Math.round(Math.max(rec.best || 0, Number(res.score) || 0)), streak, lastDay: day, lastTempo: Math.round(res.nextTempo || res.tempo || 0) || undefined, plays: (rec.plays || 0) + 1 };
    const t0 = rec.t0 || rec.lastTempo || tNow; if (t0) out.t0 = Math.round(t0); // v1.73: od kog tempa je krenulo (napredak tempa)
    const bm = Math.max(rec.bestMetric ?? -1, res.metric != null ? Math.round(res.metric) : -1);
    if (bm >= 0) out.bestMetric = bm; // npr. Promena akorda: čistih promena u minuti
    if (rec.challenge || res.challenge) out.challenge = true; // „Izazov“ (najveća brzina) odsviran sa 90+
    return out;
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
  await cssReady;
  const id = parts[0] || '';
  const game = GAMES.find((g) => g.id === id);
  if (!game) return renderHub(root);
  return renderGame(root, game, parts.slice(1), params);
}

/** „1 dan“, „2 dana“, „5 dana“ (sr) / „1 day“, „2 days“ (en) */
const daysText = (n) => t(n % 10 === 1 && n % 100 !== 11 ? 'pr.day1' : 'pr.dayN', { n });
const starsHTML = (n) => `<span class="pr-stars" aria-label="${n}/3">${[0, 1, 2].map((i) => `<i class="${i < n ? 'on' : ''}">★</i>`).join('')}</span>`;
function levelOf(id) {
  let l = 'normal', sp = 'normal', gr = true;
  try {
    l = localStorage.getItem('gitara-pr-level-' + id) || 'normal';
    sp = localStorage.getItem('gitara-pr-speed-' + id) || 'normal';
    const g = localStorage.getItem('gitara-pr-grad-' + id);
    gr = g == null ? sp === 'grad' || !localStorage.getItem('gitara-pr-speed-' + id) : g === '1';
  } catch {}
  if (l === 'beg') return t('pr.wait.chip');
  if (sp === 'grad') sp = 'normal';
  return (/^\d$/.test(l) ? t('pr.lvl.n', { n: l }) + ' · ' : '') + (gr ? t('pr.speed.grad') : t('pr.speed.' + sp));
}
/** Najbolji rezultat kao kratak broj sa jedinicom (bez decimala). */
function bestText(g, rec, st, sk = null) {
  // Skale: trenutni korak puta i najbolji tempo
  if (g.id === 'skale' && sk) {
    const total = sk.total, n = Math.min(total, sk.step + 1), bpm = Math.max(0, ...Object.values(sk.items || {}).map((r) => r.bpm || 0));
    return t('sk.stepOf', { n, total }) + (bpm ? ` · ${bpm} BPM` : '');
  }
  if (g.id === 'promena' && rec.bestMetric != null) return t('pr.unit.perMin', { n: rec.bestMetric });
  if (g.id === 'pesma') {
    let all = 0, good = 0;
    for (const parts of Object.values(st.songs || {})) for (const [k, r] of Object.entries(parts || {})) if (k !== 'all' && r) { all++; if (r.best >= 80) good++; }
    if (all) return t('pr.unit.parts', { n: good, total: all });
  }
  return t('pr.unit.points', { n: Math.round(rec.best || 0) });
}

// „Danas“: jedan predlog vežbe za danas + niz dana.
// 1) pesma koja se vežba, a neki deo još nije čist (≥ 80) — nastavi tu; 2) igra koja se najduže nije vežbala;
// 3) ništa još nije vežbano — Pauk (zagrevanje prstiju).
const FLAME = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c.6 3.2-1.2 5-2.6 6.6C8 10.2 7 11.6 7 14a5 5 0 0 0 10 0c0-1.6-.6-3-1.6-4.1.1 1.4-.4 2.6-1.4 3.1.4-2.9-.6-6.6-2-11z"/></svg>';
async function todaySuggestion(st) {
  const songIds = Object.entries(st.songs || {})
    .map(([id, parts]) => ({ id, parts: Object.entries(parts || {}).filter(([k, r]) => k !== 'all' && r) }))
    .filter((s) => s.parts.length && s.parts.some(([, r]) => (r.best || 0) < 80))
    .map((s) => ({ ...s, last: Math.max(...s.parts.map(([, r]) => dayNum(r.lastDay) || 0)) }))
    .sort((a, b) => b.last - a.last);
  for (const s of songIds.slice(0, 3)) {
    try {
      const { songs } = await import('./db.js');
      const song = await songs.get(s.id);
      if (song && !song.deleted) return { href: `#/vezbe/pesma/${encodeURIComponent(s.id)}`, title: song.title || t('pr.g.pesma'), sub: t('pr.today.song'), g: GAMES.find((g) => g.id === 'pesma') };
    } catch {}
  }
  const played = GAMES.filter((g) => g.id !== 'pesma' && (st.games[g.id]?.plays || 0) > 0 && st.games[g.id].lastDay !== today());
  if (played.length) {
    const g = played.sort((a, b) => (dayNum(st.games[a.id].lastDay) || 0) - (dayNum(st.games[b.id].lastDay) || 0))[0];
    return { href: `#/vezbe/${g.id}`, title: t('pr.g.' + g.id), sub: t('pr.today.again'), g };
  }
  const fresh = GAMES.find((g) => g.id !== 'pesma' && !(st.games[g.id]?.plays)) || GAMES[0];
  return { href: `#/vezbe/${fresh.id}`, title: t('pr.g.' + fresh.id), sub: t(fresh.id === 'pauk' ? 'pr.today.warm' : 'pr.today.new'), g: fresh };
}
function todayCardHTML(sug, streak, doneToday) {
  return `<a class="pr-today" href="${sug.href}" id="prToday">
    <span class="td-top"><span class="td-k">${t('pr.today.k')}</span><span class="td-streak${streak ? ' on' : ''}" title="${esc(t('pr.streakTitle'))}">${FLAME}${streak ? `${t('pr.streak')}: ${daysText(streak)}` : t('pr.today.startStreak')}${doneToday ? ` · ${t('pr.today.done')}` : ''}</span></span>
    <span class="td-main"><span class="td-txt"${sug.g ? ` style="--gc:${sug.g.color}"` : ''}>${sug.g ? ico(sug.g) : ''}<b>${esc(sug.title)}</b><small>${esc(sug.sub)}</small></span><span class="td-go">${t('pr.today.go')} ›</span></span>
  </a>`;
}

async function renderHub(root) {
  setWakeZone(null);
  const st = await loadStats();
  // Skale: napredak puta (mali zapis; bez učitavanja koda igre)
  const skRaw = await settings.get('skale', null);
  const sk = skRaw && typeof skRaw === 'object' ? { items: skRaw.items || {}, step: (await import('./skalePath.js')).PATH.findIndex((p) => !(skRaw.path?.done || {})[p.id]), total: 0 } : null;
  if (sk) { const { PATH } = await import('./skalePath.js'); sk.total = PATH.length; if (sk.step < 0) sk.step = PATH.length - 1; }
  const streak = Math.max(0, ...GAMES.map((g) => currentStreak(st.games[g.id])));
  const doneToday = GAMES.some((g) => st.games[g.id]?.lastDay === today());
  const sug = await todaySuggestion(st);
  root.innerHTML = `
  <section class="view practice-view">
    <header class="view-head pr-hub-head"><h1>${t('pr.title')}</h1></header>
    <p class="muted pr-intro">${t('pr.intro')}</p>
    <div id="stWeekBox"></div>
    ${todayCardHTML(sug, streak, doneToday)}
    <div class="pr-cards">
      ${GAMES.map((g) => {
        const rec = st.games[g.id] || {};
        const played = (rec.plays || 0) > 0;
        return `<a class="pr-card" href="#/vezbe/${g.id}" style="--gc:${g.color}">
          <span class="pr-prev" aria-hidden="true"><svg viewBox="0 0 80 80">${g.prev}</svg></span>
          <span class="pr-body">
            <span class="pr-name">${ico(g)}<b>${t('pr.g.' + g.id)}</b></span>
            <span class="pr-desc">${t('pr.d.' + g.id)}</span>
            <span class="pr-meta">${played
              ? `${starsHTML(starsOf(rec.best || 0))}<b class="pr-num">${bestText(g, rec, st, g.id === 'skale' ? sk : null)}</b><span class="pr-lvchip">${levelOf(g.id)}</span>${rec.challenge ? `<span class="pr-chal" title="${esc(t('pr.speed.challengeDone'))}">${t('pr.speed.challenge')} ✓</span>` : ''}`
              : `<span class="pr-new">${t('pr.new')}</span>`}</span>
          </span>
        </a>`;
      }).join('')}
    </div>
    <div id="stSongsBox"></div>
  </section>`;
  // v1.73: ova nedelja (+ cilj), moje pesme, dugo nisi svirao — posle prvog prikaza, da hub ne čeka
  import('./statsView.js').then(async (S) => {
    let all = false;
    const drawWeek = async () => { const b = root.querySelector('#stWeekBox'); if (!b) return; b.innerHTML = await S.weekHTML(); S.bindWeek(b, drawWeek); };
    const drawSongs = async () => { const b = root.querySelector('#stSongsBox'); if (!b) return; b.innerHTML = await S.mySongsHTML({ all }); };
    await (await import('./activity.js')).flush().catch(() => {});
    drawWeek(); drawSongs();
    root.querySelector('#stSongsBox')?.addEventListener('click', (e) => {
      if (e.target.closest('#stAll')) { all = !all; drawSongs(); return; }
      const b = e.target.closest('[data-stsong]'); if (b) S.openSongStats(b.dataset.stsong);
    });
  }).catch(() => {});
}

/**
 * Zajednički ekran igre. Igra (modul) izvozi createGame(api) i vraća
 * { start(bpm), stop(), bpm: { start, min, max, step } , onTempo?(bpm) }.
 */
async function renderGame(root, game, args, params) {
  root.innerHTML = `
  <section class="view practice-view pr-game" data-game="${game.id}" style="--gc:${game.color}">
    <header class="topbar">
      <a href="#/vezbe" class="back">‹ ${t('pr.title')}</a>
      <span class="pr-gtitle">${ico(game)}<b>${t('pr.g.' + game.id)}</b></span>
    </header>
    <div class="pr-explain" id="prExplain" hidden></div>
    <div class="pr-pulse" id="prPulse" aria-hidden="true"></div>
    <div class="pr-meter" id="prMeter" aria-hidden="true"><span class="pr-lvl"><i></i></span><span class="pr-heard" id="prHeard">${t('pr.meter.idle')}</span></div>
    <div class="pr-stage" id="prStage"><p class="muted center">${t('common.loading')}</p></div>
    <div class="pr-fb" id="prFb" role="status" aria-live="polite">&nbsp;</div>
    <div class="pr-head" id="prHead"></div>
    <div class="pr-wait" id="prWaitBox">
      <label class="switch"><input type="checkbox" id="prWait"><span class="switch-track"><span class="switch-thumb"></span></span><span>${t('pr.wait.beg')}</span></label>
      <small class="muted" id="prWaitHint"></small>
    </div>
    <div class="pr-level" id="prLevel" hidden></div>
    <div class="pr-speed" id="prSpeed">
      <div class="pr-optlabel">${t('pr.speed.label')}</div>
      <div class="pr-speeds" id="prSpeeds" role="radiogroup"></div>
      <label class="switch pr-grad"><input type="checkbox" id="prGrad"><span class="switch-track"><span class="switch-thumb"></span></span><span><b>${t('pr.grad.label')}</b><small>${t('pr.grad.hint')}</small></span></label>
      <div class="pr-tempo" id="prTempo">
        <button class="btn round tiny" id="prSlower" aria-label="${t('pr.slower')}">−</button>
        <span><b id="prBpm">90</b> <small id="prUnit">BPM</small></span>
        <button class="btn round tiny" id="prFaster" aria-label="${t('pr.faster')}">+</button>
      </div>
    </div>
    <div class="pr-opts" id="prOpts"></div>
    <button class="btn primary big wide" id="prGo">${t('pr.start')}</button>
    <div class="card pr-result" id="prRes" hidden></div>
  </section>`;
  const $ = (q) => root.querySelector('#' + q);

  let mod;
  try { mod = await game.load(); } catch (e) { $('prStage').innerHTML = `<p class="err">${esc(t('err.title'))}</p>`; throw e; }
  const st = await loadStats();
  const rec = st.games[game.id] || {};
  let running = false, bpm = 90, gameObj = null, listener = null;
  // Jedan prekidač „Čekaj me — početnik sam“ (umesto nivoa Početnik/Normalno): uključen = igra čeka na svaku
  // notu/akord (Početnik: kraće, sa savetima, bez štoperice); isključen = uz metronom, brzina se bira ispod.
  // Ritam ima i težinu ritma (1–4) — vidi se samo kad je prekidač isključen.
  const LKEY = 'gitara-pr-level-' + game.id, L2KEY = 'gitara-pr-level2-' + game.id;
  let level = (() => { try { return localStorage.getItem(LKEY) || 'normal'; } catch { return 'normal'; } })();
  const cleanups = new Set(), levelSubs = new Set();
  const waitHint = () => { const k = `pr.wait.onHint.${game.id}`; return t(k) !== k ? t(k) : t('pr.wait.onHint'); };
  const syncTempo = () => { $('prSpeed').hidden = !!gameObj?.noTempo || (level === 'beg' && !gameObj?.tempoInBeg); };
  function drawWait() {
    const LV = gameObj?.levels || [];
    $('prWaitBox').hidden = !LV.some((l) => l.id === 'beg');
    $('prWait').checked = level === 'beg';
    $('prWaitHint').textContent = level === 'beg' ? waitHint() : t('pr.wait.offHintShort');
    const extra = LV.filter((l) => l.id !== 'beg');
    $('prLevel').hidden = level === 'beg' || extra.length < 2;
  }
  // Brzina: Sporo / Normalno / Brzo / Izazov (u odnosu na „normalan“ tempo igre ili pesme) + poseban prekidač
  // „Postepeno ubrzavaj“: počni sporije i posle svakog čistog prolaza malo ubrzaj — do izabrane brzine.
  // Pamti se po igri; menja se i tokom igre. api.speed je 'grad' dok je prekidač uključen (kao ranije).
  const SPEEDS = [{ id: 'slow', f: 0.7 }, { id: 'normal', f: 1 }, { id: 'fast', f: 1.15 }, { id: 'challenge', f: 1.3 }];
  const SKEY = 'gitara-pr-speed-' + game.id, GKEY = 'gitara-pr-grad-' + game.id;
  let target = 'normal', gradOn = true;
  try {
    const v = localStorage.getItem(SKEY), g = localStorage.getItem(GKEY);
    if (SPEEDS.some((x) => x.id === v)) target = v;
    gradOn = g == null ? v == null || v === 'grad' : g === '1'; // ranije je „Postepeno“ bila jedna od brzina
  } catch {}
  let speed = gradOn ? 'grad' : target;
  // Jačina ulaza + poslednja čuta nota: na svakom ekranu igre (da se odmah vidi da li mikrofon čuje gitaru)
  let lastHeard = null, meterAt = 0;
  function onLevel(ev) {
    const lvlI = root.querySelector('#prMeter .pr-lvl i');
    if (!ev) { if (lvlI) lvlI.style.transform = 'scaleX(0)'; return; }
    if (ev.note != null) lastHeard = ev.note;
    levelSubs.forEach((fn) => fn(ev.level, lastHeard));
    const now = performance.now();
    if (now - meterAt < 66 || !lvlI) return; // najviše ~15 osvežavanja u sekundi
    meterAt = now;
    if (document.body.classList.contains('trk-open')) return; // staza je preko ekrana igre (ima svoj merač)
    const db = ev.level ? 20 * Math.log10(ev.level) : -100;
    lvlI.style.transform = `scaleX(${Math.max(0, Math.min(1, (db + 60) / 50)).toFixed(2)})`;
    const txt = lastHeard != null ? `${t('pr.meter.heard')}: ${noteLabel(lastHeard)}` : t('pr.meter.listening');
    if ($('prHeard').textContent !== txt) $('prHeard').textContent = txt;
  }

  const api = {
    gameId: game.id,
    stage: $('prStage'),
    opts: $('prOpts'),
    head: $('prHead'),
    args, params,
    stats: rec,
    allStats: st,
    get running() { return running; },
    get bpm() { return bpm; },
    get level() { return level; },
    get listener() { return listener; },
    /** „Čekaj me — početnik sam“ uključen. */
    get wait() { return level === 'beg'; },
    setWait(on) {
      if (!!on === (level === 'beg')) return;
      if (on) { try { if (level !== 'beg') localStorage.setItem(L2KEY, level); } catch {} api.setLevel('beg'); }
      else { let l = 'normal'; try { l = localStorage.getItem(L2KEY) || 'normal'; } catch {} api.setLevel(l === 'beg' ? 'normal' : l); }
      gameObj?.onWait?.(level === 'beg');
    },
    setLevel(l) {
      level = l;
      try { localStorage.setItem(LKEY, l); if (l !== 'beg') localStorage.setItem(L2KEY, l); } catch {}
      $('prLevel').querySelectorAll('[data-lv]').forEach((x) => x.classList.toggle('active', x.dataset.lv === l));
      drawWait(); syncTempo();
      gameObj?.onLevel?.(l);
    },
    get speed() { return speed; },
    /** Izabrana brzina (Sporo/Normalno/Brzo/Izazov) — i kad je „Postepeno ubrzavaj“ uključeno (tada je to cilj). */
    get target() { return target; },
    get gradual() { return gradOn; },
    /** Najviši tempo za „Postepeno ubrzavaj“: tempo izabrane brzine. */
    get gradCap() { try { return tempoForSpeed(target); } catch { return undefined; } }, // pre podešavanja tempa igre: nema ograničenja (igra koristi svoje)
    /** Sledeća brzina posle dobrog prolaza (Sporo → Normalno → Brzo → Izazov); null = već Izazov / Postepeno. */
    get nextSpeed() { const k = ['slow', 'normal', 'fast', 'challenge'].indexOf(speed); return k >= 0 && k < 3 ? ['slow', 'normal', 'fast', 'challenge'][k + 1] : null; },
    speedLabel: (id) => t('pr.speed.' + (id || target)),
    setSpeed(id) {
      if (id === 'grad') { api.setGradual(true); return; }
      if (!SPEEDS.some((x) => x.id === id)) return;
      target = id;
      try { localStorage.setItem(SKEY, id); } catch {}
      speed = gradOn ? 'grad' : target;
      api.setBpm(tempoForSpeed(speed));
      drawSpeeds();
      gameObj?.onSpeed?.(speed);
    },
    setGradual(on) {
      gradOn = !!on;
      try { localStorage.setItem(GKEY, gradOn ? '1' : '0'); } catch {}
      speed = gradOn ? 'grad' : target;
      api.setBpm(tempoForSpeed(speed));
      drawSpeeds();
      gameObj?.onSpeed?.(speed);
    },
    /** Sačuvaj rezultat bez zaustavljanja (npr. svaki prolaz u „Delovi pesme“). */
    async save(res, key = null) { const fresh = await saveResult(game.id, { ...res, nextTempo: res.tempo }, key); Object.assign(rec, fresh.games[game.id]); Object.assign(st.songs, fresh.songs); },
    setBpm(v) { bpm = Math.round(Math.max(B.min, Math.min(B.max, v))); $('prBpm').textContent = B.fmt(bpm); },
    /** Normalan tempo igre (ili pesme) — osnova za Sporo/Brzo/Izazov. */
    get normalTempo() { return B.normal; },
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
      window.dispatchEvent(new Event('gitara-mic')); // sviranje pesme („Pusti“, „Poslušaj“) staje — igra ne sme da čuje sebe
      if (!listener) { const { createListener } = await import('./practiceListen.js'); listener = createListener(); }
      const gameLevel = opts.onLevel;
      await listener.start({ ...opts, onLevel: (ev) => { onLevel(ev); gameLevel?.(ev); } });
      return listener;
    },
    /** Pretplata na jačinu ulaza (lv, poslednja nota); vraća odjavu. */
    onLevel(fn) { levelSubs.add(fn); return () => levelSubs.delete(fn); },
    /** Pauza (telefon uspravno): mikrofon ne obrađuje, ekran sme da se ugasi; false = nastavi. */
    pauseHw(on) { listener?.pause?.(on); if (on) allowSleep('practice'); else if (running) keepAwake('practice'); },
    onCleanup(fn) { cleanups.add(fn); },
    /** Zaustavi bez rezultata (npr. posle podešavanja kašnjenja). */
    stopNow() { stopRun(false); },
    /** Potpuno zaustavi (i zatvori ekran igre, npr. stazu) — i kad runda već nije u toku. */
    stop() { stopRun(false); try { gameObj?.stop(); } catch {} },
    /** Nova runda sa trenutnim tempom (pozvati iz dodira, npr. dugme na stazi). */
    restart() { stopRun(false); return startRun(); },
    /** Pokreni posebnu rundu (npr. podešavanje kašnjenja) sa istim gašenjem kao igra. */
    startCustom(fn) { return startRun(fn); },
    /** Kraj runde: rezultat 0–100, tempo, tačnost (0–1). key = [songId, deo] za „Delovi pesme“. */
    async finish(res0, key = null) {
      let res = res0;
      stopRun(false);
      const nextTempo = speed === 'grad' && res.score > 90 && !res.noTempoUp ? gradStep(res.tempo) : res.tempo; // Postepeno: najviše do izabrane brzine
      if (speed === 'challenge' && level !== 'beg' && res.score >= 90) res = { ...res, challenge: true };
      const prevBest = key ? ((st.songs[key[0]] || {})[key[1]] || {}).best || 0 : rec.best || 0;
      const fresh = await saveResult(game.id, { ...res, score: Math.round(res.score), nextTempo }, key);
      Object.assign(rec, fresh.games[game.id]); Object.assign(st.songs, fresh.songs);
      const info = { ...res, nextTempo, newBest: res.score > prevBest };
      if (!res.quiet) showResult(info); // „staza“ prikazuje rezultat sama
      if (nextTempo !== res.tempo) api.setBpm(nextTempo);
      gameObj?.onResult?.(res);
      return info;
    },
    t, esc,
  };

  gameObj = await mod.createGame(api);
  api.pulse(null, gameObj.beats ?? 4); // tačke otkucaja odmah (ekran ne „skače“ na startu)
  // Objašnjenje (2–3 rečenice) i „Pogledaj demo“ — demo se pušta samo na dugme, nikad sam
  const explain = t('pr.x.' + game.id);
  if (explain !== 'pr.x.' + game.id || gameObj.demo) {
    // Objašnjenje ceo tekst samo prvi put; posle toga mali red „ⓘ Kako se igra“ (otvara tekst) i „Demo“
    const IKEY = 'gitara-pr-intro-' + game.id;
    let seen = false;
    try { seen = !!localStorage.getItem(IKEY); localStorage.setItem(IKEY, '1'); } catch {}
    const hasText = explain !== 'pr.x.' + game.id;
    const demoBtn = gameObj.demo ? `<button class="btn small pr-demo" id="prDemo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>${t('pr.demo')}</button>` : '';
    $('prExplain').hidden = false;
    $('prExplain').classList.toggle('compact', seen);
    $('prExplain').innerHTML = seen
      ? `<div class="pr-ex-row">${hasText ? `<button class="pr-ex-how" id="prHow" aria-expanded="false"><span class="pr-ex-i">i</span>${t('pr.howTo')}</button>` : '<span></span>'}${demoBtn}</div>${hasText ? `<p id="prHowTxt" hidden>${explain}</p>` : ''}`
      : `${hasText ? `<p>${explain}</p>` : ''}${demoBtn}`;
    $('prHow')?.addEventListener('click', () => { const p = $('prHowTxt'); p.hidden = !p.hidden; $('prHow').setAttribute('aria-expanded', String(!p.hidden)); });
    $('prDemo')?.addEventListener('click', () => { if (!running) startRun(() => gameObj.demo()); });
  }
  if (gameObj.track) $('prPulse').hidden = true;
  const LV = gameObj.levels || [];
  if (LV.length && !LV.some((l) => l.id === level)) level = LV.some((l) => l.id === 'normal') ? 'normal' : LV[0].id;
  const extraLv = LV.filter((l) => l.id !== 'beg');
  if (extraLv.length >= 2) { // Ritam: težina ritma 1–4 („Normalno“ = 1)
    $('prLevel').innerHTML = `<div class="pr-optlabel">${t('pr.lvl.difficulty')}</div><div class="seg-tabs pr-diff" role="radiogroup">${extraLv.map((l) => `<button role="radio" data-lv="${l.id}" class="${l.id === level ? 'active' : ''}">${l.id === 'normal' ? '1' : esc(l.label)}</button>`).join('')}</div>`;
    $('prLevel').addEventListener('click', (e) => { const b = e.target.closest('[data-lv]'); if (b && !running) api.setLevel(b.dataset.lv); });
  }
  // Brzina: BPM (više = brže) ili npr. sekunde po noti (dir: -1 → manje = brže)
  const B = { start: 80, min: 40, max: 200, step: 5, dir: 1, fmt: (v) => String(v), unit: 'BPM', ...(gameObj.bpm || {}) };
  if (!B.normal) B.normal = B.start;
  $('prUnit').textContent = B.unit;
  // Jedan korak „Postepeno ubrzavaj“: malo brže, ali ne preko izabrane brzine
  function gradStep(tempo) {
    const cap = tempoForSpeed(target), nx = tempo + B.step * B.dir;
    return Math.max(B.min, Math.min(B.max, B.dir < 0 ? Math.max(cap, nx) : Math.min(cap, nx)));
  }
  function tempoForSpeed(id) {
    if (id === 'grad') {
      // počni od poslednjeg tempa (ili sporije), nikad brže od izabrane brzine
      const v = gameObj.initialTempo || rec.lastTempo || B.start, cap = tempoForSpeed(target);
      return B.dir < 0 ? Math.max(cap, v) : Math.min(cap, v);
    }
    const sp = SPEEDS.find((x) => x.id === id);
    if (!sp) return gameObj.initialTempo || rec.lastTempo || B.start;
    const v = B.dir < 0 ? B.normal / sp.f : B.normal * sp.f; // sekunde po noti: brže = kraće
    return Math.max(B.min, Math.min(B.max, Math.round(v / B.step) * B.step));
  }
  function drawSpeeds() {
    $('prSpeeds').innerHTML = SPEEDS.map((x) => `<button role="radio" aria-checked="${x.id === target}" class="pr-sp${x.id === target ? ' on' : ''}" data-sp="${x.id}">${t('pr.speed.' + x.id)}</button>`).join('');
    $('prGrad').checked = gradOn;
  }
  drawSpeeds();
  api.setBpm(tempoForSpeed(speed));
  if (LV.length) api.setLevel(level); else { drawWait(); syncTempo(); }
  $('prSpeeds').addEventListener('click', (e) => { const b = e.target.closest('[data-sp]'); if (b) api.setSpeed(b.dataset.sp); });
  $('prGrad').addEventListener('change', (e) => api.setGradual(e.target.checked));
  $('prWait').addEventListener('change', async (e) => {
    if (running) { e.target.checked = level === 'beg'; return; }
    const on = e.target.checked;
    api.setWait(on);
    // prvi put: kratko objašnjenje šta prekidač radi
    let shown = false;
    try { shown = !!localStorage.getItem('gitara-pr-waittip'); if (on) localStorage.setItem('gitara-pr-waittip', '1'); } catch {}
    if (on && !shown) { const { dialog } = await import('./ui.js'); dialog({ title: t('pr.wait.tipTitle'), body: t('pr.wait.tip'), buttons: [{ label: t('common.ok'), value: true, kind: 'primary' }] }); }
  });
  if (gameObj.noStart) $('prGo').hidden = true; // npr. izbor pesme pre igre
  // fino podešavanje (mali −/+ uz broj): brzina ostaje izabrana, samo tempo malo drugačiji
  $('prSlower').addEventListener('click', () => api.setBpm(bpm - B.step * B.dir));
  $('prFaster').addEventListener('click', () => api.setBpm(bpm + B.step * B.dir));

  function showResult(r) {
    const box = $('prRes');
    box.hidden = false;
    box.innerHTML = `
      <div class="trk-stars" aria-label="${starsOf(r.score)}/3">${[0, 1, 2].map((i) => `<span class="${i < starsOf(r.score) ? 'on' : ''}" style="animation-delay:${0.15 + i * 0.22}s">★</span>`).join('')}</div>
      <div class="pr-score"><b>${Math.round(r.score)}</b><small>/100</small></div>
      ${r.newBest ? `<p class="pr-best">${t('pr.newBest')}</p>` : ''}
      <div class="pr-res-row">
        ${r.beginner ? '' : `<span><small>${B.label || t(B.dir < 0 ? 'pr.speedReached' : 'pr.tempoReached')}</small><b>${B.fmt(r.tempo)} ${B.unit}</b></span>`}
        <span><small>${t('pr.accuracy')}</small><b>${Math.round((r.accuracy || 0) * 100)}%</b></span>
        ${r.extra ? `<span><small>${esc(r.extra.label)}</small><b>${esc(String(r.extra.value))}</b></span>` : ''}
        ${(r.lines || []).map((l) => `<span><small>${esc(l.label)}</small><b>${esc(String(l.value))}</b></span>`).join('')}
      </div>
      ${r.nextTempo !== r.tempo ? `<p class="small pr-up">${t('pr.tempoUp', { bpm: B.fmt(r.nextTempo) + ' ' + B.unit })}</p>` : ''}
      ${r.beginner && r.clean ? `<p class="pr-up">${t('pr.wait.cleanNote')}</p><button class="btn primary big wide" id="prTryNormal">${t('pr.wait.tryOff')}</button>` : ''}
      ${r.challenge ? `<p class="pr-up">${t('pr.speed.challengeDone')}</p>` : ''}
      <button class="btn ${r.beginner && r.clean ? '' : 'primary'} big wide" id="prAgainFaster">${r.beginner || (speed !== 'grad' && !api.nextSpeed) ? t('pr.trk.again') : speed !== 'grad' ? t('pr.speed.try', { s: t('pr.speed.' + api.nextSpeed) }) : t('pr.againFaster')}</button>`;
    box.querySelector('#prTryNormal')?.addEventListener('click', () => { box.hidden = true; api.setWait(false); startRun(); });
    box.querySelector('#prAgainFaster').addEventListener('click', () => {
      if (!r.beginner && speed !== 'grad') { if (api.nextSpeed) api.setSpeed(api.nextSpeed); }
      else if (r.nextTempo === r.tempo && !r.beginner) api.setBpm(bpm + B.step * B.dir);
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
    lastHeard = null;
    if ($('prHeard')) $('prHeard').textContent = t('pr.meter.idle');
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
