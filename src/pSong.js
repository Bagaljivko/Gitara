// Vežbe → „Delovi pesme“ na stazi: pesma iz tvoje pesmarice, podeljena na delove (Strofa 1, Refren, Most…).
// Deo sa najtežim promenama akorda je označen „Najteže“; može i „Cela pesma“.
// Blokovi akorda klize u redosledu pesme (tonalitet, kapodaster i transpozicija uračunati), iznad vrata je
// red teksta. Normalno: počinje sporije od pesme, deo se vrti u petlji i posle svakog čistog prolaza malo ubrza —
// do pravog tempa; tada se nudi „Sledeći deo“ ili „Cela pesma“. Početnik: staza čeka na svaku promenu akorda.
// Najbolji rezultat i tempo se pamte po delu (i oznaka napretka pored ikonice vežbe na ekranu pesme).
import { sectionLabel } from './sectionLabel.js';
import { strum } from './synth.js';
import { chordNotes } from './rhythm.js';
import { getVoicings } from './chords.js';
import { dn } from './naming.js';
import { songs as db, settings } from './db.js';
import { transposeSong } from './songformat.js';
import { trackGame, chordItem, chordFingers } from './practiceTrack.js';
import { checkChord } from './pChords.js';
import { songPracticeUI } from './songPracticeUI.js';
import { srCompare } from './collate.js';

const MAX_PASSES = 6;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Delovi pesme onako kako se sviraju (transpozicija i kapodaster uračunati): [{ i, name, chords:[{chord, lyric}] }] */
export function songParts(song) {
  const shapes = transposeSong(song, (song.transpose || 0) - (song.capo || 0));
  const seen = new Set();
  return (shapes.sections || []).map((sec, i) => ({
    i, name: sec.name || '',
    // uz svaki akord: reči koje se pevaju dok on traje (od njega do sledećeg akorda u redu), ostatak reda bleđe
    chords: (sec.lines || []).flatMap((l) => {
      const text = l.text || '', cs = [...(l.chords || [])].sort((a, b) => a.position - b.position);
      return cs.map((c, k) => {
        if (!text.trim()) return { chord: c.chord, lyric: '' };
        const a = Math.min(c.position, text.length), b = k + 1 < cs.length ? Math.min(cs[k + 1].position, text.length) : text.length;
        return { chord: c.chord, lyric: { pre: text.slice(0, a), cur: text.slice(a, Math.max(a, b)), post: text.slice(Math.max(a, b)) } };
      });
    }).filter((c) => c.chord),
  })).filter((p) => {
    if (!p.chords.length) return false;
    const sig = p.name + '|' + p.chords.map((c) => c.chord).join(',');
    if (seen.has(sig)) return false; // isti refren ponovljen više puta = jedan deo
    seen.add(sig);
    return true;
  });
}

/** Težina promene akorda: koliko žica menja prag + barre. */
function changeCost(a, b) {
  if (a === b) return 0;
  const va = getVoicings(a)[0], vb = getVoicings(b)[0];
  if (!va || !vb) return 2;
  let moves = 0;
  for (let s = 0; s < 6; s++) if (va.frets[s] !== vb.frets[s]) moves++;
  return 1 + moves * 0.5 + (vb.barre ? 3 : 0) + (Math.max(...vb.frets) > 4 ? 1 : 0);
}
/** Prosečna težina promena u delu (uključujući povratak na početak, jer se deo vrti u petlji). */
export function partDifficulty(p) {
  const c = p.chords.map((x) => x.chord);
  if (c.length < 2) return 0;
  let sum = 0;
  for (let k = 0; k < c.length; k++) sum += changeCost(c[k], c[(k + 1) % c.length]);
  return sum / c.length;
}

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
  window.addEventListener('gitara-mic', () => { if (listening) { listening = null; listenId = null; ui.draw(); } });
  api.onCleanup?.(() => { listening?.stop(); listening = null; });
  const ui = songPracticeUI({
    api,
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
      items: chords.map((c, k) => chordItem(c.chord, k * per, per, { lyric: c.lyric })),
      key: [songId, String(part.i)],
      lagMs: 350 + 90 + 80,
      fingersOf: chordFingers,
      hintOf: (it) => t('pr.promena.hint', { c: it.label }),
      extra: (st) => (st.clean && (st.tempo >= cap() || !grad())
        ? [...(part.i !== 'all' ? [{ id: 'nextPart', label: t('pr.pesma.nextPart'), primary: true }] : []), { id: 'whole', label: t('pr.pesma.whole'), primary: part.i === 'all' }]
        : []),
    };
  };

  return trackGame(api, {
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
