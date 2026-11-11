import { createTuner } from './tuner.js';
import { t, getLang, setLang, onLangChange, i18nReady } from './i18n.js';
import { settings, songs as songsDb, events as dbEvents } from './db.js';
import { setWakeZone } from './wakelock.js';
import { onNamingChange, loadNoteNamesPref } from './naming.js';
import { needsUpgrade, CV } from './songmodel.js';
// v1.81: kartica „Učenici“ (prva) — samo nastavnik i samo na računaru; broj = otvoreni zahtevi
const DESK_NAV = matchMedia('(min-width: 1100px) and (hover: hover) and (pointer: fine)');
let teachNavT = 0;
function refreshTeachNav() {
  clearTimeout(teachNavT);
  teachNavT = setTimeout(async () => {
    try {
      const tc = (await settings.get('teacher', null)) || {};
      document.body.classList.toggle('teach-nav', !!tc.on);
      const n = tc.on ? ((await settings.get('requests', [])) || []).filter((r) => r && (r.status === 'open' || r.status === 'editing')).length : 0;
      const b = document.getElementById('navTeachN'); if (b) { b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n); }
      // v2.0: nastavnik — broj otvorenih zahteva i na kartici Nastava (Učenici su sada tamo)
      const v = document.querySelector('.nav a[data-tab="vezbe"]');
      if (v) { let vb = v.querySelector('.nav-badge'); const on = !!n && document.body.classList.contains('nastava-teacher'); if (!vb && on) { vb = document.createElement('b'); vb.className = 'nav-badge'; v.appendChild(vb); } if (vb) { vb.hidden = !on; vb.textContent = n > 99 ? '99+' : String(n); } }
      const a = document.querySelector('.nav a[data-tab="ucenici"]'); if (a) a.classList.toggle('active', /^#\/(ucenici|ucenik)(\/|\?|$)/.test(location.hash) && DESK_NAV.matches);
      if (/^#\/(ucenici|ucenik)(\/|\?|$)/.test(location.hash) && DESK_NAV.matches && tc.on) document.querySelectorAll('.nav a[data-tab="pesme"], .nav a[data-tab="podesavanja"]').forEach((x) => x.classList.remove('active')); // v1.93: na računaru samo Učenici
    } catch {}
  }, 30);
}
addEventListener('marli-teach', refreshTeachNav);

await i18nReady; // engleski prevod (ako je izabran) mora biti učitan pre prvog prikaza

// Ekrani osim tunera se učitavaju tek kad zatrebaju (brže prvo otvaranje).
const lazy = (load) => { let p; return () => (p ||= load()); };
const loadSongs = lazy(() => import('./songs.js'));
const loadSetlists = lazy(() => import('./setlistsView.js'));
const loadSettings = lazy(() => import('./settingsView.js'));
const loadChordRec = lazy(() => import('./chordrec.js'));
const loadStage = lazy(() => import('./stage.js'));
const loadChordCheck = lazy(() => import('./chordCheck.js'));
const loadPractice = lazy(() => import('./practice.js')); // Vežbe: učitava se tek kad se otvori
// poslata pesma / set lista (shareImport.js): stari dugi linkovi, kratak link #d/<fileId> i ?d=<fileId> (Android intent iz
// „Otvori u aplikaciji Gitara“ — tamo # zauzima intent)
// Novi korisnik: još nijedan zapis aplikacije u pregledaču → posle prvog ekrana kratak obilazak (v1.60)
// (ne i u automatizovanom pregledaču — testovi ekrana ne smeju da dobiju panel preko ekrana)
const FIRST_RUN = (() => { try { return !navigator.webdriver && !Object.keys(localStorage).some((k) => k.startsWith('gitara-')); } catch { return false; } })();
const hasSharedSong = () => location.hash.startsWith('#pesma=') || location.hash.startsWith('#g=') || location.hash.startsWith('#d/') || /[?&]d=/.test(location.search);

// Osećaj prave aplikacije: dugi pritisak ne otvara meni pregledača („Kopiraj / Potraži / Sačuvaj sliku“), ništa se ne
// označava i ne prevlači — osim u poljima za unos (gde se kuca i lepi tekst).
const editable = (el) => !!(el && el.closest && el.closest('input, textarea, [contenteditable]:not([contenteditable="false"])'));
for (const ev of ['contextmenu', 'selectstart', 'dragstart']) document.addEventListener(ev, (e) => { if (!editable(e.target) && !(ev === 'dragstart' && e.target.closest && e.target.closest('[draggable="true"]'))) e.preventDefault(); }, { capture: true }); // v1.83: namerno prevlačenje (plan, pesme u folder na računaru) radi

const app = document.getElementById('app');
const views = {};
let activeLive = null; // tuner/akordi koriste mikrofon — gasimo ga pri promeni taba

async function liveView(name) {
  const factory = name === 'tuner' ? createTuner : (await loadChordRec()).createChordRec;
  if (!views[name]) {
    const el = document.createElement('div');
    el.className = 'live';
    views[name] = { el, ctl: factory(el) };
  }
  return views[name];
}

// Tablet u položenom režimu: lista i pesma jedna pored druge
const TWO_PANE = window.matchMedia('(min-width: 900px) and (min-height: 600px) and (orientation: landscape)');
TWO_PANE.addEventListener('change', () => { app.querySelector(':scope > .page')?.remove(); route(); });
// v1.90: isti upit kao libDesk.DESK — sam modul (34 KB) se učitava tek kad zatreba (telefon ga nikad ne učita)
const DESK_MQ = window.matchMedia('(min-width: 1200px) and (min-height: 600px) and (hover: hover) and (pointer: fine)');
DESK_MQ.addEventListener('change', () => { if (document.body.classList.contains('two-pane-mode')) { app.querySelector(':scope > .page')?.remove(); route(); } });

// ---- Zaštita od praznog ekrana ----
// index.html beleži greške pre pokretanja i prikazuje „Pokušaj ponovo / Popravi aplikaciju“ ako se aplikacija
// uopšte ne pokrene. Ovde: kada se aplikacija pokrene, ukloni ekran za učitavanje; ako crtanje nekog ekrana
// ne uspe, umesto praznine prikaži poruku sa istim dugmadima. Sve se beleži samo na uređaju (Dijagnostika).
const boot = window.__gBoot || { add() {}, done: false, start: Date.now() };
function bootDone() {
  if (boot.done) return;
  boot.done = true;
  document.getElementById('boot')?.remove();
  document.getElementById('bootFail')?.remove();
  if (/[?&]r=\d/.test(location.search)) history.replaceState(history.state, '', location.pathname + location.hash); // posle „Popravi aplikaciju“
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    const k = 'gitara-boots';
    const a = JSON.parse(localStorage.getItem(k) || '[]');
    a.push({ t: Date.now(), ms: Math.round(performance.now()), sw: !!navigator.serviceWorker?.controller, nav: nav ? nav.type : '', disc: !!document.wasDiscarded,
      html: nav ? Math.round(nav.responseStart) : 0, swStart: nav && nav.workerStart ? Math.round(nav.responseStart - nav.workerStart) : 0, src: nav ? nav.deliveryType || '' : '' }); // html: ms do stizanja početne strane
    localStorage.setItem(k, JSON.stringify(a.slice(-12)));
  } catch {}
}
function showRouteError(e) {
  boot.add({ k: 'screen', m: String((e && (e.stack || e.message)) || e).slice(0, 400), h: location.hash.slice(0, 60) });
  app.querySelector(':scope > .page')?.remove();
  app.querySelectorAll(':scope > .live').forEach((el) => (el.hidden = true));
  const el = document.createElement('div');
  el.className = 'page';
  el.innerHTML = `<section class="view route-err">
    <h1>${t('err.title')}</h1>
    <p class="muted">${t('err.body')}</p>
    <button class="btn primary big wide" data-a="retry">${t('err.retry')}</button>
    <button class="btn wide" data-a="repair">${t('err.repair')}</button>
  </section>`;
  el.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-a]')?.dataset.a;
    if (a === 'retry') location.reload();
    if (a === 'repair') (boot.repair ? boot.repair() : location.reload());
  });
  app.appendChild(el);
}

let routeId = 0;
async function route() {
  try { await routeInner(); }
  catch (e) { console.error(e); showRouteError(e); }
  finally { bootDone(); }
}
async function routeInner() {
  const myRoute = ++routeId;
  // v1.78: pozivnica nastavnika (#poziv/…): pita učenika da li prihvata, pa nastavlja na Pesme
  if (location.hash.startsWith('#poziv/')) { const h = location.hash; history.replaceState(null, '', location.pathname + '#/pesme'); import('./teachView.js').then((m) => m.acceptInvite(h)).catch((e) => console.error(e)); }
  // v1.79: zahtev učenika (kod nastavnika) i odgovor „Nemam“ (kod učenika)
  if (location.hash.startsWith('#zahtev/')) { const h = location.hash; history.replaceState(null, '', location.pathname + '#/ucenici'); const st = await (await import('./teach.js')).receiveRequest(h).catch(() => null); if (st) history.replaceState(null, '', location.pathname + '#/ucenici'); }
  if (location.hash.startsWith('#napredak/')) { const h = location.hash; history.replaceState(null, '', location.pathname + '#/ucenici'); const st = await (await import('./teach.js')).receiveProgress(h).catch(() => null); if (st) history.replaceState(null, '', location.pathname + '#/ucenik/' + encodeURIComponent(st.id)); } // v1.80
  if (location.hash.startsWith('#plan/')) { const h = location.hash; history.replaceState(null, '', location.pathname + '#/vezbe'); await (await import('./plan.js')).receivePlanLink(h).catch(() => {}); } // v1.83: plan od nastavnika
  if (location.hash.startsWith('#odgovor/')) { const h = location.hash; history.replaceState(null, '', location.pathname + '#/od-nastavnika'); await (await import('./teach.js')).receiveAnswer(h).catch(() => {}); }
  setWakeZone(null); // ekrani koji računaju aktivnost (pesma, setlista, rečnik) je ponovo uključe
  const shared = hasSharedSong();
  const hash = shared ? '#/primljena' : location.hash || '#/tuner';
  const [, page, arg] = hash.match(/^#\/([^/?]*)\/?(.*)$/) || [, 'tuner', ''];
  const tab = { tuner: 'tuner', akordi: 'akordi', pesme: 'pesme', pesma: 'pesme', uredi: 'pesme', setlista: 'pesme', nastup: 'pesme', primljena: 'pesme', podesavanja: 'podesavanja', provera: 'podesavanja', vezbe: 'vezbe', ucenici: 'podesavanja', ucenik: 'podesavanja', 'od-nastavnika': 'pesme' }[page] || 'tuner';
  const tabT = document.body.classList.contains('nastava-on') && (page === 'ucenici' || page === 'ucenik' || page === 'od-nastavnika') ? 'vezbe' // v2.0: Nastava
    : (page === 'ucenici' || page === 'ucenik') && document.body.classList.contains('teach-nav') && DESK_NAV.matches ? 'ucenici' : tab; // v1.81
  if (!shared) { try { localStorage.setItem('marli-last-tab', '#/' + tab); } catch {} } // v2.0: sledeći put otvori ovde
  refreshTeachNav();
  document.body.classList.toggle('tuner-screen', tab === 'tuner');
  document.querySelectorAll('.nav a').forEach((a) => {
    const on = a.dataset.tab === tabT;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });

  if (activeLive && activeLive !== tab) { views[activeLive].ctl.hide(); }
  app.querySelectorAll(':scope > .live').forEach((el) => (el.hidden = true));
  if (!(TWO_PANE.matches && (page === 'pesme' || page === 'pesma'))) app.querySelector(':scope > .page')?.remove();
  if (tab !== 'pesme') document.body.classList.remove('two-pane-mode', 'desk-lib-mode');

  if (tab === 'tuner' || tab === 'akordi') {
    const name = page === 'akordi' ? 'akordi' : 'tuner';
    const v = await liveView(name);
    if (routeId !== myRoute) return;
    if (!v.el.parentNode) app.appendChild(v.el);
    v.el.hidden = false;
    v.ctl.show();
    activeLive = name;
  } else if (tab === 'vezbe') {
    // Vežbe: posebna stranica, bez učitavanja pesmarice (osim kad igra „Delovi pesme“ sama zatraži pesmu)
    activeLive = null;
    const { renderPractice } = await loadPractice();
    if (routeId !== myRoute) return;
    const el = document.createElement('div');
    el.className = 'page';
    app.appendChild(el);
    const [rest, query = ''] = (arg || '').split('?');
    await renderPractice(el, rest.split('/').map(decodeURIComponent), new URLSearchParams(query));
  } else {
    activeLive = null;
    const [rawId, query = ''] = (arg || '').split('?');
    const dec = decodeURIComponent(rawId || '');
    const params = new URLSearchParams(query);
    const { renderLibrary, renderSong, renderSharedSong, setSelectedSong } = await loadSongs();
    const { renderEditor } = page === 'uredi' ? await import('./songEditor.js') : {};
    const { renderSetlist, setlistNav } = await loadSetlists();
    const { renderSettings } = page === 'podesavanja' ? await loadSettings() : {};
    const { renderStage } = page === 'nastup' ? await loadStage() : {};
    const { renderChordCheck } = page === 'provera' ? await loadChordCheck() : {};
    if (routeId !== myRoute) return;
    // Tablet položeno: dva panela — lista pesama levo, izabrana pesma desno
    const twoPane = TWO_PANE.matches && (page === 'pesme' || page === 'pesma') && params.get('tab') !== 'sl';
    document.body.classList.toggle('two-pane-mode', twoPane);
    // v1.70: računar (širok ekran + miš) — upravljač biblioteke: folderi/set liste levo, tabela, pesma desno
    const desk = twoPane && DESK_MQ.matches; // tablet položeno: bez učitavanja upravljača za računar
    document.body.classList.toggle('desk-lib-mode', desk);
    if (desk) {
      const D = await import('./libDesk.js');
      const S = await loadSongs();
      if (routeId !== myRoute) return;
      let tp = app.querySelector(':scope > .page.two-pane.desk-lib');
      if (!tp) {
        app.querySelector(':scope > .page')?.remove();
        tp = document.createElement('div');
        tp.className = 'page two-pane desk-lib';
        tp.innerHTML = '<aside class="pane-side"></aside><div class="pane-list"></div><div class="pane-song"></div>';
        app.appendChild(tp);
        const refresh = () => D.deskReload();
        await D.renderDeskLibrary(tp.querySelector('.pane-side'), tp.querySelector('.pane-list'), tp.querySelector('.pane-song'), params, {
          add: () => S.openAddDesk(refresh),
          emptyState: (a, b) => S.deskEmptyState(a, b, refresh),
        });
      }
      D.markOpen(page === 'pesma' ? dec : null);
      const right = document.createElement('div');
      tp.querySelector('.pane-song').replaceWith(right);
      right.className = 'pane-song';
      D.setSongPane(right);
      if (page === 'pesma') await renderSong(right, dec, await setlistNav(params));
      return;
    }
    if (twoPane) {
      setSelectedSong(page === 'pesma' ? dec : null);
      let tp = app.querySelector(':scope > .page.two-pane');
      if (!tp) {
        app.querySelector(':scope > .page')?.remove();
        tp = document.createElement('div');
        tp.className = 'page two-pane';
        tp.innerHTML = '<div class="pane-list"></div><div class="pane-song"></div>';
        app.appendChild(tp);
        await renderLibrary(tp.querySelector('.pane-list'), params);
      } else {
        // samo osveži oznaku izabrane pesme u listi
        tp.querySelectorAll('.song-item').forEach((li) => li.classList.toggle('selected', li.dataset.id === dec && page === 'pesma'));
      }
      const right = document.createElement('div');
      tp.querySelector('.pane-song').replaceWith(right);
      right.className = 'pane-song';
      if (page === 'pesma') await renderSong(right, dec, await setlistNav(params));
      else right.innerHTML = `<div class="pane-empty muted">${t('lib.selectSong')}</div>`;
      return;
    }
    app.querySelector(':scope > .page')?.remove();
    const el = document.createElement('div');
    el.className = 'page';
    app.appendChild(el);
    if (page === 'pesme') await renderLibrary(el, params);
    else if (page === 'pesma') await renderSong(el, dec, await setlistNav(params));
    else if (page === 'setlista') await renderSetlist(el, dec);
    else if (page === 'nastup') await renderStage(el, dec, params);
    else if (page === 'primljena') await renderSharedSong(el);
    else if (page === 'uredi') await renderEditor(el, dec);
    else if (page === 'podesavanja') await renderSettings(el);
    else if (page === 'provera') await renderChordCheck(el);
    else if (page === 'ucenici' || page === 'ucenik' || page === 'od-nastavnika') { // v1.78: nastava
      const V = await import('./teachView.js');
      if (page === 'ucenici') await V.renderStudents(el);
      else if (page === 'ucenik') await V.renderStudent(el, dec);
      else await V.renderFromTeacher(el);
    }
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
// Otvaranje aplikacije dok već radi (ikonica, deljeni link): pregledač samo vrati otvorenu aplikaciju (launch_handler
// „focus-existing“ u manifestu), bez ponovnog učitavanja i belog ekrana. Deljeni link se otvori ovde, na licu mesta.
if ('launchQueue' in window) {
  window.launchQueue.setConsumer((params) => {
    try {
      if (!params || !params.targetURL) return;
      const u = new URL(params.targetURL);
      const shared = /^#(pesma=|g=|d\/)/.test(u.hash) || /[?&]d=/.test(u.search);
      if (!shared && !(u.hash && u.hash.startsWith('#/'))) return; // obična ikonica: ostani gde si bio
      if (u.search === location.search && u.hash === location.hash) return; // prvo otvaranje — već prikazano
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
      route();
    } catch {}
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && activeLive) views[activeLive].ctl.hide();
});

const offline = document.getElementById('offline');
const updateOnline = () => (offline.hidden = navigator.onLine !== false);
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);
updateOnline();

// Service worker — relativna putanja "sw.js" (scope = /Gitara/).
// Nova verzija se preuzme u pozadini; traka „Osveži“ je primenjuje jednim dodirom.
if ('serviceWorker' in navigator) {
  let updating = false;
  // ponovno učitavanje tek kad je nova verzija potpuno aktivna — inače stranica čeka aktivaciju (beo ekran)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updating) return;
    const c = navigator.serviceWorker.controller;
    if (!c || c.state === 'activated') { location.reload(); return; }
    const go = () => { if (c.state === 'activated' || c.state === 'redundant') location.reload(); };
    c.addEventListener('statechange', go);
    setTimeout(() => location.reload(), 5000); // u svakom slučaju
  });
  const offerUpdate = (w) => {
    const bar = document.getElementById('updateBar');
    if (!bar || !navigator.serviceWorker.controller) return;
    bar.hidden = false;
    bar.querySelector('button').onclick = () => { updating = true; bar.querySelector('button').disabled = true; w.postMessage('SKIP_WAITING'); };
  };
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').then((reg) => {
    if (reg.waiting) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed') offerUpdate(w); });
    });
    // Instalirana aplikacija se često samo vrati iz pozadine — tada proveri ima li nove verzije.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {}));
}

// Zamoli pregledač da ne briše pesme kad ponestane prostora (ili posle 7 dana na iPhone-u).
async function persistStorage() {
  try {
    if (!navigator.storage?.persist || await navigator.storage.persisted()) return;
    if (await songsDb.count()) await navigator.storage.persist();
  } catch {}
}
persistStorage();
dbEvents.addEventListener('songs-changed', persistStorage, { once: true });

// ---- Jezik ----
function applyStaticText() {
  document.documentElement.lang = getLang() === 'en' ? 'en' : 'sr-Latn';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
}
function rerenderAll() {
  for (const name of Object.keys(views)) {
    views[name].ctl.hide();
    views[name].el.remove();
    delete views[name];
  }
  activeLive = null;
  app.querySelector(':scope > .page')?.remove();
  route();
}
// Odmah ponovo iscrtaj sve ekrane na novom jeziku ili sa novim imenima nota (bez ponovnog učitavanja stranice).
onLangChange(() => { applyStaticText(); rerenderAll(); });
onNamingChange(() => rerenderAll());
// Imena nota iz IndexedDB-a (npr. posle vraćanja iz rezervne kopije)
settings.get('noteNames', null).then((v) => { if (v) loadNoteNamesPref(v); }).catch(() => {});
dbEvents.addEventListener('settings-changed', (e) => { if (e.detail === 'noteNames') settings.get('noteNames', null).then((v) => v && loadNoteNamesPref(v)); });
applyStaticText();
// Jezik iz IndexedDB (npr. posle vraćanja iz rezervne kopije) ima prednost.
settings.get('lang', null).then((v) => { if (v && v !== getLang()) setLang(v, { save: false }); }).catch(() => {});

// Podeljeno iz YouTube aplikacije (Android, „Podeli“ → Gitara): izbor pesme uz koju ide video
const ytShare = (() => { try { const p = new URLSearchParams(location.search); return p.get('yt-share') ? p : null; } catch { return null; } })();
if (ytShare) { history.replaceState(null, '', location.pathname + '#/pesme'); }
// v2.0: otvori gde si poslednji put bio (Akordi, Pesme, Vežbe/Nastava, Podešavanja); inače Tuner kao do sada
if (!location.hash && !location.search) { try { const l = localStorage.getItem('marli-last-tab'); if (l && /^#\/(akordi|pesme|vezbe|podesavanja)$/.test(l)) history.replaceState(null, '', location.pathname + l); } catch {} }
// v2.0: „Vežbe“ → „Nastava“ (učenik povezan sa nastavnikom ili nastavnik); modul se učitava samo kad treba
const nastavaNav = () => Promise.all([settings.get('teacher', null), settings.get('myTeacher', null)]).then(([tc, m]) => { if ((tc && tc.on) || (m && m.tid) || document.body.classList.contains('nastava-on')) return import('./nastava.js').then((N) => N.applyNav()); }).catch(() => {});
nastavaNav();
dbEvents.addEventListener('settings-changed', (e) => { if (e.detail === 'teacher' || e.detail === 'myTeacher') nastavaNav(); });
route();
if (ytShare) import('./ytShare.js').then((m) => m.linkShared(ytShare)).catch(() => {});
// v1.74: prvi put na ovom uređaju → „Dobrodošao u MARLI“: Poveži Google (vraća sve) ili Prvi put sam ovde (obilazak)
const WELCOME_TEST = (() => { try { return navigator.webdriver && !!localStorage.getItem('marli-welcome-test'); } catch { return false; } })();
if ((FIRST_RUN || WELCOME_TEST) && !hasSharedSong() && !ytShare) setTimeout(() => import('./welcome.js').then((m) => m.firstRunWelcome()).catch(() => {}), WELCOME_TEST ? 600 : 3200);
// Drive (automatska rezervna kopija) se učitava malo kasnije, kad se prvi ekran već prikaže.
const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1200));
// v1.68: tastatura i miš (računar): prečice, Ctrl + točkić, „?“ = spisak prečica
idle(() => import('./keys.js').then((m) => m.initKeys()).catch(() => {}));
// v1.70: „Šta je novo“ — zlatna tačka na Podešavanjima posle ažuriranja
idle(() => import('./whatsnew.js').then((m) => m.navDot()).catch(() => {}));
idle(() => import('./activity.js').then((m) => m.startActivity()).catch(() => {})); // v1.73: svirano / vežbano
idle(() => import('./feedback.js').then((m) => m.initFeedback()).catch(() => {})); // v1.76: utisci koji čekaju se pošalju
idle(() => import('./db.js').then(async ({ settings }) => { const m = await settings.get('myTeacher', null); if (m && m.prog && m.prog.on) (await import('./progress.js')).initProgress(); if (m && m.planFile) { const P = await import('./plan.js'); P.watchTasks(); P.refreshPlan().catch(() => {}); } if (m && m.box) (await import('./teachBox.js')).initBox(); const tc = await settings.get('teacher', null); if (tc && tc.on) (await import('./teachBox.js')).initTeacherPoll(); if (m || (tc && tc.on) || ((await settings.get('notes', [])) || []).length) (await import('./notify.js')).initBell(); }).catch(() => {})); // v1.94: sanduče (učenik) i zahtevi iz fajlova napretka (nastavnik) // v1.80: napredak za nastavnika (samo ako je uključeno)
const DESK = matchMedia('(min-width: 1100px) and (hover: hover) and (pointer: fine)');
const deskAcct = () => { if (DESK.matches) { import('./navAcct.js').then((m) => m.initNavAcct()).catch(() => {}); import('./deskShell.js').then((m) => m.initDeskShell()).catch(() => {}); } }; // v1.98: bočna traka + ‹ › putanja
deskAcct(); DESK.addEventListener?.('change', deskAcct); // v1.77: nalog u gornjoj traci (samo računar)
// v1.70.1: jednom — „Prenesi ključ na moje uređaje“ uključeno i model „Automatski“ (i na već instaliranim; stari ručni izbor modela se ne vraća preko sinhronizacije)
idle(async () => {
  try { if (localStorage.getItem('marli-def1701') || (navigator.webdriver && !localStorage.getItem('marli-def-test'))) return; } catch { return; } // testovi biraju model namerno
  try {
    if ((await settings.get('geminiModelSel')) !== 'auto') await settings.set('geminiModelSel', 'auto');
    if ((await settings.get('keySync', true)) === false) await (await import('./db.js')).setKeySync(true);
    localStorage.setItem('marli-def1701', '1');
  } catch {}
});
// v1.70: nedovršen red PDF-ova (npr. Gemini dnevni limit) se nastavlja sam
idle(() => { try { if (localStorage.getItem('marli-pdf-queue') && localStorage.getItem('marli-pdf-queue') !== '[]') import('./pdfQueue.js').then((m) => m.resumePdfQueue()); } catch {} });
// Jednokratna konverzija postojećih pesama u novi zapis akorda (original ostaje netaknut)
// Radi se samo dok ima šta da se prebaci: posle uspešnog prolaza se pamti, da se pri svakom
// pokretanju ne čita cela biblioteka (na sporom telefonu to je pola sekunde zauzetog ekrana).
const UPG_KEY = 'gitara-upgraded';
let upgDone = false; try { upgDone = localStorage.getItem(UPG_KEY) === String(CV); } catch {}
if (!upgDone) idle(() => songsDb.all().then((list) => Promise.all(list.filter(needsUpgrade).map((x) => songsDb.put(x))))
  .then(() => { try { localStorage.setItem(UPG_KEY, String(CV)); } catch {} }).catch(() => {}));
// Jednokratno: ukloni tačne duplikate pesama (ista pesma sačuvana dvaput) i kratko javi koliko ih je bilo
idle(() => import('./songSync.js').then((m) => m.cleanupDuplicates({ settings })).then(async (n) => {
  if (n) (await import('./ui.js')).toast(t('dup.cleaned', { n }));
}).catch(() => {}));
// Google Drive (~25 KB) se učitava samo ako je rezervna kopija uključena; inače tek kad se otvore Podešavanja
idle(() => settings.get('drive', null).then((d) => { if (d && d.connected) return import('./drive.js').then((m) => m.initDrive()); }).catch(() => {}));
idle(() => import('./backups.js').then(async (B) => { if (await B.isConnected()) B.initAutoBackup(); }).catch(() => {})); // v1.85: dnevna rezervna kopija
idle(() => import('./installNudge.js').then((m) => m.initInstallNudge()).catch(() => {})); // v1.87: poziv „Instaliraj“ (samo telefon/tablet)
// Već podeljene pesme / set liste: posle izmene isti link tiho dobija novi sadržaj (sledeće „Podeli“ je trenutno)
{
  let shareT = 0;
  const sharedSomething = () => { try { return Number(localStorage.getItem('gitara-shares')) > 0; } catch { return false; } };
  const onEdit = (e) => {
    if (e.type === 'settings-changed' && e.detail !== 'setlists') return;
    if (!sharedSomething()) return;
    clearTimeout(shareT);
    shareT = setTimeout(() => import('./shareService.js').then((m) => m.refreshShared()).catch(() => {}), 20000);
  };
  dbEvents.addEventListener('songs-changed', onEdit);
  dbEvents.addEventListener('settings-changed', onEdit);
}
// Deljenje: fajlovi u „Gitara – deljeno“ bez zapisa (prekinuto deljenje) se tiho brišu — samo ako je nešto deljeno
idle(() => settings.get('shareFolder', '').then((f) => f && import('./shareService.js').then((m) => m.cleanupOrphans())).catch(() => {}));
// Sinhronizacija između uređaja: tek posle prvog ekrana (nikad ne usporava pokretanje), samo ako je uključena
idle(() => settings.get('syncCfg', null).then(async (c) => {
  let ls = null; try { ls = JSON.parse(localStorage.getItem('gitara-sync') || 'null'); } catch {}
  if ((c && c.on) || (!c && ls && ls.on)) return (await import('./sync.js')).initSync();
  // stara rezervna kopija je povezana: jednom ponudi sinhronizaciju (isti Google nalog, jedan dodir)
  const d = await settings.get('drive', null);
  if (!c && d && d.connected && !(await settings.get('syncOffered', false))) {
    await settings.set('syncOffered', true);
    (await import('./ui.js')).toast(t('sync.offer'), '', { label: t('sync.connectBtn'), onClick: () => import('./sync.js').then((m) => m.connectSync()).catch(() => { location.hash = '#/podesavanja'; }) });
  }
}).catch(() => {}));
