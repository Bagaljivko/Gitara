// Vežbe → „Delovi pesme“ na stazi: pesma iz tvoje pesmarice, podeljena na delove (Strofa 1, Refren, Most…).
// Deo sa najtežim promenama akorda je označen „Najteže“; može i „Cela pesma“.
// Blokovi akorda klize u redosledu pesme (tonalitet, kapodaster i transpozicija uračunati), iznad vrata je
// red teksta. Normalno: počinje sporije od pesme, deo se vrti u petlji i posle svakog čistog prolaza malo ubrza —
// do pravog tempa; tada se nudi „Sledeći deo“ ili „Cela pesma“. Početnik: staza čeka na svaku promenu akorda.
// Najbolji rezultat i tempo se pamte po delu (i oznaka napretka pored ikonice vežbe na ekranu pesme).
import { sectionLabel } from './sectionLabel.js';
import { strum } from './synth.js';
import { chordNotes } from './rhythm.js';
import { dn } from './naming.js';
import { songs as db, settings } from './db.js';
import { trackGame, chordItem, chordFingers } from './practiceTrack.js';
import { checkChord } from './pChords.js';
import { songPracticeUI } from './songPracticeUI.js';
import { srCompare } from './collate.js';

const MAX_PASSES = 6;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export { songParts, changeCost, partDifficulty } from './songParts.js'; // v2.4.34: lagan modul
import { songParts, changeCost, partDifficulty } from './songParts.js';

export async function createGame(api) {
  const { t, esc } = api;
  const songId = api.args[0] ? decodeURIComponent(api.args[0]) : '';
  if (!songId) return pickSong(api);
  const song = await db.get(songId);
  const empty = (msg) => { api.stage.innerHTML = `<p class="muted center">${msg}</p>`; return { noTempo: true, noStart: true, beats: 0, start() { api.stopNow(); }, stop() {} }; };
  if (!song) return empty(t('song.notFound'));
  if (song.type === 'tab') return (await import('./pTab.js')).createTabGame(api, song, songId); // TAB pesma (prebiranje)
  const parts = songParts(song);
  if (!parts.length) return empty(t('pr.pesma.noChords'));
  const songBpm = Number(song.bpm) || Number(await settings.get('metBpm', 90)) || 90;
  const stats = () => (api.allStats.songs || {})[songId] || {};
  const diffs = parts.map(partDifficulty);
  const hardest = parts.length > 1 ? diffs.indexOf(Math.max(...diffs)) : -1;
  const whole = { i: 'all', name: t('pr.pesma.whole'), chords: parts.flatMap((p) => p.chords) };
  const all = [...parts, whole];
  const partKey = `gitara-pr-part-${songId}`;
  let part = all.find((p) => String(p.i) === localStorage.getItem(partKey)) || parts[hardest >= 0 ? hardest : 0];
  let per = Number(localStorage.getItem('gitara-pr-pesma-per')) === 2 ? 2 : 4;
  const startTempo = (p) => Math.min(api.gradCap ?? songBpm, (stats()[String(p.i)] || {}).lastTempo || Math.max(40, Math.round((songBpm * 0.6) / 5) * 5));
  const label = (p, k) => (p.i === 'all' ? t('pr.pesma.whole') : (p.name ? sectionLabel(p.name) : t('pr.pesma.part', { n: k + 1 })));

  // v2.4.17: „Pevaj uz tekst“ (#/vezbe/pesma/ID?m=sing): tekst ide, akord stoji iznad reči na kojoj se menja
  if (api.params && api.params.get && api.params.get('m') === 'sing') {
    const { createSing } = await import('./pSing.js');
    return createSing(api, song, { parts, label, startPart: part, songId, per, songBpm });
  }
  const grad = () => api.speed === 'grad';
  const cap = () => api.gradCap ?? songBpm; // „Postepeno ubrzavaj“: najviše do izabrane brzine
  const findPart = (id) => all.find((p) => String(p.i) === String(id));
  function choose(p) {
    part = p;
    try { localStorage.setItem(partKey, String(part.i)); } catch {}
    if (grad()) api.setBpm(startTempo(part));
  }
  // „Poslušaj“: deo jednom, u trenutnom tempu vežbe (zvuk gitare; staje čim igra uključi mikrofon)
  let listening = null, listenId = null;
  async function listenPart(id) {
    const was = listenId;
    if (listening) { listening.stop(); listening = null; listenId = null; ui.draw(); if (String(was) === String(id)) return; }
    const p = findPart(id); if (!p) return;
    const [sp, pl] = await Promise.all([import('./songPlay.js'), import('./songPlayer.js')]);
    const tl = sp.chordTimeline(song);
    const pt = p.i === 'all' ? { from: 0, to: tl.total } : tl.parts.find((x) => x.si === p.i);
    if (!pt) return;
    listenId = p.i;
    listening = pl.playOnce(tl, { bpm: api.bpm || songBpm, from: pt.from, to: pt.to, onEnd: () => { listening = null; listenId = null; ui.draw(); } });
    ui.draw();
  }
  const onMic = () => { if (listening) { listening = null; listenId = null; ui.draw(); } }; // v2.4.34: skida se pri izlasku (ranije se gomilalo)
  window.addEventListener('gitara-mic', onMic);
  api.onCleanup?.(() => window.removeEventListener('gitara-mic', onMic));
  api.onCleanup?.(() => { listening?.stop(); listening = null; });
  // v2.4.30: „Nauči ovu pesmu“ — put kroz pesmu (akordi, promene, ritam, deo po deo, pevanje, cela pesma; tutorijal po želji).
  // Ništa nije zaključano: aplikacija predlaže korak, a svaki korak se otvara dodirom.
  const SP = await import('./songPath.js');
  let pathSt = null;
  let courseNav = null; // v2.4.37
  import('./coursesView.js').then((m) => m.courseNav(songId)).then((c) => { courseNav = c; if (c) ui?.draw(); }).catch(() => {});
  const refreshPath = async () => { try { pathSt = await SP.pathState(song, stats()); } catch (e) { console.warn(e); } ui?.draw(); };
  try { pathSt = await SP.pathState(song, stats()); } catch {}
  const enc = encodeURIComponent;
  const openStep = (id) => {
    if (id === 'tut') { try { localStorage.setItem('gitara-tut-' + songId, String(Date.now())); } catch {} import('./songPath.js').then((P) => P.markTutorial(songId)).then(refreshPath).catch(() => {}); import('./ytPick.js').then((Y) => Y.ytAction('tutorial', song, () => db.save(song))).catch(() => {}); refreshPath(); return; }
    if (id === 'ak') location.hash = '#/vezbe/promena?song=' + enc(songId) + '&ch=' + enc(((pathSt && pathSt.analysis.akSeq) || []).join('-'));
    else if (id === 'bare') location.hash = '#/vezbe/bare?song=' + enc(songId); // v2.4.33
    else if (id === 'chg') { const sh = ((pathSt && pathSt.analysis.hard) || []).find((h) => h.sheet); location.hash = '#/vezbe/promena?song=' + enc(songId) + (sh ? '&ch=' + enc(sh.a + '-' + sh.b) + '&k=chg' : ''); } // v2.4.35: promena sa lista
    else if (id === 'pt') { const x = pathSt && pathSt.analysis.sheet && pathSt.analysis.sheet.practice[0]; if (x) location.hash = '#/vezbe/promena?song=' + enc(songId) + '&ch=' + enc(x.ch.join('-')) + '&k=pt'; }
    else if (id === 'rp') location.hash = '#/vezbe/rp?song=' + enc(songId);
    else if (id === 'sing') location.hash = '#/vezbe/pesma/' + enc(songId) + '?m=sing';
    else if (id === 'deo') { const nx = parts.find((p) => ((stats()[String(p.i)] || {}).best || 0) < SP.DONE_AT) || parts[0]; listening?.stop(); listening = null; listenId = null; choose(nx); api.restart(); }
    else if (id === 'all') { listening?.stop(); listening = null; listenId = null; choose(whole); api.restart(); }
  };
  let ui = null;
  ui = songPracticeUI({
    api,
    path: () => pathSt,
    course: () => courseNav,
    direct: true,
    onPlan: (id) => {
      if (id === 'again') { const L = pathSt && pathSt.last; if (!L) return; if (L.part) { listening?.stop(); listening = null; listenId = null; choose(L.part); api.restart(); } else openStep(L.step); return; }
      openStep(id);
    },
    head: { title: song.title, artist: song.artist, meta: [t('pr.pesma.songTempo', { bpm: songBpm }), song.capo ? t('capo.title') + ' ' + song.capo : ''].filter(Boolean).join(' · ') },
    groups: [{ rows: parts.map((p, k) => ({ id: p.i, label: label(p, k), sub: [...new Set(p.chords.map((c) => dn(c.chord)))].join(' · '), hard: k === hardest })) }],
    wholeId: 'all',
    recOf: (id) => stats()[String(id)],
    listeningId: () => listenId,
    onListen: listenPart,
    onStart: (id) => { const p = findPart(id); if (!p) return; listening?.stop(); listening = null; listenId = null; choose(p); api.restart(); },
    // jedan akord traje ceo takt ili pola takta
    sheetExtra: () => `<div class="pr-optlabel">${t('pr.pesma.per')}</div><div class="seg-tabs" role="radiogroup">
        <button role="radio" data-per="4" class="${per === 4 ? 'active' : ''}">${t('pr.pesma.perBar')}</button>
        <button role="radio" data-per="2" class="${per === 2 ? 'active' : ''}">${t('pr.pesma.per2')}</button></div>`,
    onSheetClick: (e) => {
      const pb = e.target.closest('[data-per]');
      if (!pb) return;
      per = +pb.dataset.per;
      try { localStorage.setItem('gitara-pr-pesma-per', String(per)); } catch {}
      pb.parentElement.querySelectorAll('[data-per]').forEach((x) => x.classList.toggle('active', x === pb));
    },
  });
  const drawOpts = () => ui.draw();
  api.stage.hidden = true;

  let passes = 0;
  const build = () => {
    const chords = part.chords;
    return {
      items: chords.map((c, k) => chordItem(c.chord, k * per, per, { lyric: c.lyric, voicing: (song.shapes || {})[c.chord] || 0 })), // v2.4.33: izabran (i lakši) hvat
      key: [songId, String(part.i)],
      lagMs: 350 + 90 + 80,
      fingersOf: chordFingers,
      hintOf: (it) => t('pr.promena.hint', { c: it.label }),
      extra: (st) => (st.clean && (st.tempo >= cap() || !grad())
        ? [...(part.i !== 'all' ? [{ id: 'nextPart', label: t('pr.pesma.nextPart'), primary: true }] : []), { id: 'whole', label: t('pr.pesma.whole'), primary: part.i === 'all' }]
        : []),
    };
  };

  const g = trackGame(api, {
    levels: [{ id: 'beg', label: t('pr.lvl.beg') }, { id: 'normal', label: t('pr.lvl.normal') }],
    bpm: { start: startTempo(part), min: 40, max: Math.round(songBpm * 1.35), step: 5, normal: songBpm, gradMax: songBpm },
    noStart: true, // počinje se iz „Sviraj celu pesmu“ ili iz panela dela
    initialTempo: startTempo(part),
    firstBpm: startTempo(part),
    round() { passes = 0; return build(); },
    listen(round, input) {
      const set = [...new Set(part.chords.map((c) => c.chord))];
      return {
        chords: true,
        onOnset: (o) => setTimeout(() => input(o.at, (it) => {
          // drugi akord iz dela koji bi „pristajao“ bolje (npr. susedni) — onda to nije bio traženi
          const others = set.filter((c) => c !== it.chord);
          const best = others.map((c) => ({ c, h: api.listener?.chordHeard(c) })).filter((x) => x.h && x.h.ok).sort((a, b) => b.h.share - a.h.share)[0];
          const r = checkChord(api.listener, it.chord, best ? best.c : null);
          return r.ok ? r : { ok: false, text: t('pr.promena.notClearShort', { c: it.label }) };
        }), 350),
      };
    },
    // Postepeno: prolaz za prolazom; posle čistog prolaza malo brže (do tempa pesme).
    // Izabrana brzina (Sporo…Izazov): isti tempo, prolazi dok ne bude čisto.
    async onRoundEnd(st, round, ctl) {
      if (st.beginner) return false;
      passes++;
      if ((st.clean && (st.tempo >= cap() || !grad())) || passes >= MAX_PASSES) return false; // rezultat (i čuvanje) na kraju
      await api.save({ score: st.score, tempo: st.tempo, accuracy: st.accuracy }, round.key);
      const nb = st.clean && grad() ? Math.min(cap(), st.tempo + 5) : st.tempo;
      api.setBpm(nb);
      ctl.track.pop(st.clean && nb > st.tempo ? t('pr.pesma.faster', { bpm: nb }) : t('pr.pesma.again', { n: passes + 1 }), st.clean ? 'hit' : 'late');
      await wait(1500);
      if (!api.running || !ctl.track) return true;
      await ctl.next(build());
      return true;
    },
    onChoice(choice, round, ctl) {
      if (choice === 'nextPart') {
        const k = parts.findIndex((p) => p.i === part.i);
        choose(parts[(k + 1) % parts.length]);
        api.restart();
      } else if (choice === 'whole') { choose(whole); api.restart(); }
      else ctl.close();
    },
    onLevel: () => drawOpts(),
    demo: {
      bpm: 72,
      intro: t('pr.pesma.demo1'),
      items: () => part.chords.slice(0, 6).map((c, k) => chordItem(c.chord, k * 2, 2, { lyric: c.lyric })),
      fingersOf: chordFingers,
      play: (it) => strum(0, 'D', { notes: chordNotes(it.chord), group: 'practice' }),
      captions: { 0: t('pr.pesma.demo2'), 1: t('pr.pesma.demo3'), 3: t('pr.pesma.demo4'), 5: t('pr.pesma.demo5') },
    },
  });
  return Object.assign(await g, { firstChord: () => (part.chords[0] ? part.chords[0].chord : ''), onResult: () => { refreshPath(); } }); // v2.4.26: „Spremi se“ · v2.4.30: put se osveži posle runde
}

// Bez izabrane pesme: lista pesama iz biblioteke (brzi indeks, bez učitavanja celih pesama)
async function pickSong(api) {
  const { t, esc } = api;
  const list = (await db.list()).sort((a, b) => srCompare(a.title, b.title));
  api.stage.innerHTML = list.length
    ? `<p class="pr-optlabel">${t('pr.pesma.pick')}</p><ul class="ps-list">${list.map((s) => `<li><a href="#/vezbe/pesma/${encodeURIComponent(s.id)}"><b>${esc(s.title)}</b><span class="small muted">${esc(s.artist || '')}</span></a></li>`).join('')}</ul>`
    : `<p class="muted center">${t('pr.pesma.empty')}</p>`;
  return { noTempo: true, noStart: true, beats: 0, start() { api.stopNow(); }, stop() {} };
}
