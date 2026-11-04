// Vežbe → „Delovi pesme“ na stazi: pesma iz tvoje pesmarice, podeljena na delove (Strofa 1, Refren, Most…).
// Deo sa najtežim promenama akorda je označen „Najteže“; može i „Cela pesma“.
// Blokovi akorda klize u redosledu pesme (tonalitet, kapodaster i transpozicija uračunati), iznad vrata je
// red teksta. Normalno: počinje sporije od pesme, deo se vrti u petlji i posle svakog čistog prolaza malo ubrza —
// do pravog tempa; tada se nudi „Sledeći deo“ ili „Cela pesma“. Početnik: staza čeka na svaku promenu akorda.
// Najbolji rezultat i tempo se pamte po delu (i oznaka napretka pored ikonice vežbe na ekranu pesme).
import { strum } from './synth.js';
import { chordNotes } from './rhythm.js';
import { getVoicings } from './chords.js';
import { dn } from './naming.js';
import { songs as db, settings } from './db.js';
import { transposeSong } from './songformat.js';
import { trackGame, chordItem, chordFingers } from './practiceTrack.js';
import { checkChord } from './pChords.js';

const MAX_PASSES = 6;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Delovi pesme onako kako se sviraju (transpozicija i kapodaster uračunati): [{ i, name, chords:[{chord, lyric}] }] */
export function songParts(song) {
  const shapes = transposeSong(song, (song.transpose || 0) - (song.capo || 0));
  const seen = new Set();
  return (shapes.sections || []).map((sec, i) => ({
    i, name: sec.name || '',
    chords: (sec.lines || []).flatMap((l) => [...(l.chords || [])].sort((a, b) => a.position - b.position).map((c) => ({ chord: c.chord, lyric: (l.text || '').trim() }))).filter((c) => c.chord),
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
  const startTempo = (p) => Math.min(songBpm, (stats()[String(p.i)] || {}).lastTempo || Math.max(40, Math.round((songBpm * 0.6) / 5) * 5));
  const label = (p, k) => (p.i === 'all' ? t('pr.pesma.whole') : p.name || t('pr.pesma.part', { n: k + 1 }));

  function drawOpts() {
    const st = stats();
    api.opts.innerHTML = `
      <div class="pr-song-head"><b>${esc(song.title)}</b>${song.artist ? `<span class="small muted">${esc(song.artist)}</span>` : ''}
        <span class="small muted">${t('pr.pesma.songTempo', { bpm: songBpm })}${song.capo ? ' · ' + t('capo.title') + ' ' + song.capo : ''}</span>
        <a class="small" href="#/vezbe/pesma">${t('pr.pesma.other')}</a></div>
      <div class="pr-optlabel">${t('pr.pesma.whichPart')}</div>
      <div class="pr-chips">${all.map((p, k) => {
        const rec = st[String(p.i)] || {};
        return `<button class="chip${p === part ? ' active' : ''}" data-part="${p.i}">${esc(label(p, k))}${k === hardest ? ` <span class="pr-hard">${t('pr.pesma.hardest')}</span>` : ''}${rec.best ? ` <small>${Math.round(rec.best)} · ${rec.lastTempo} BPM</small>` : ''}</button>`;
      }).join('')}</div>
      <p class="small muted center">${part.chords.map((c) => esc(dn(c.chord))).join(' · ')}</p>
      <div class="pr-optlabel">${t('pr.pesma.per')}</div>
      <div class="seg-tabs" role="radiogroup">
        <button role="radio" data-per="4" class="${per === 4 ? 'active' : ''}">${t('pr.pesma.perBar')}</button>
        <button role="radio" data-per="2" class="${per === 2 ? 'active' : ''}">${t('pr.pesma.per2')}</button>
      </div>`;
  }
  function choose(p) {
    part = p;
    try { localStorage.setItem(partKey, String(part.i)); } catch {}
    api.setBpm(startTempo(part));
    drawOpts();
  }
  drawOpts();
  api.opts.addEventListener('click', (e) => {
    const b = e.target.closest('[data-part]'), pb = e.target.closest('[data-per]');
    if (b && !api.running) choose(all.find((p) => String(p.i) === b.dataset.part) || part);
    if (pb) {
      per = +pb.dataset.per;
      try { localStorage.setItem('gitara-pr-pesma-per', String(per)); } catch {}
      drawOpts();
    }
  });
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
      extra: (st) => (st.clean && st.tempo >= songBpm
        ? [...(part.i !== 'all' ? [{ id: 'nextPart', label: t('pr.pesma.nextPart'), primary: true }] : []), { id: 'whole', label: t('pr.pesma.whole'), primary: part.i === 'all' }]
        : []),
    };
  };

  return trackGame(api, {
    levels: [{ id: 'beg', label: t('pr.lvl.beg') }, { id: 'normal', label: t('pr.lvl.normal') }],
    bpm: { start: startTempo(part), min: 40, max: songBpm, step: 5 },
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
    // Normalno: prolaz za prolazom; posle čistog prolaza malo brže (do tempa pesme)
    async onRoundEnd(st, round, ctl) {
      if (st.beginner) return false;
      passes++;
      if ((st.clean && st.tempo >= songBpm) || passes >= MAX_PASSES) return false; // rezultat (i čuvanje) na kraju
      await api.save({ score: st.score, tempo: st.tempo, accuracy: st.accuracy }, round.key);
      const nb = st.clean ? Math.min(songBpm, st.tempo + 5) : st.tempo;
      api.setBpm(nb);
      ctl.track.pop(st.clean ? t('pr.pesma.faster', { bpm: nb }) : t('pr.pesma.again', { n: passes + 1 }), st.clean ? 'hit' : 'late');
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
  const list = (await db.list()).sort((a, b) => String(a.title).localeCompare(String(b.title), 'sr'));
  api.stage.innerHTML = list.length
    ? `<p class="pr-optlabel">${t('pr.pesma.pick')}</p><ul class="ps-list">${list.map((s) => `<li><a href="#/vezbe/pesma/${encodeURIComponent(s.id)}"><b>${esc(s.title)}</b><span class="small muted">${esc(s.artist || '')}</span></a></li>`).join('')}</ul>`
    : `<p class="muted center">${t('pr.pesma.empty')}</p>`;
  return { noTempo: true, noStart: true, beats: 0, start() { api.stopNow(); }, stop() {} };
}
