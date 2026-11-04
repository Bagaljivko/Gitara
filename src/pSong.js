// Vežbe → „Delovi pesme“: izaberi pesmu iz svoje biblioteke i njen deo. Akordi tog dela se vrte u petlji
// uz metronom (jedan akord po taktu ili po 2 otkucaja), polako; aplikacija proverava akorde (blago:
// većina tonova). Kad prolaz ide dobro, tempo raste — do tempa pesme. Rezultati se pamte po pesmi i delu.
import { Metronome } from './rhythm.js';
import { chordSVG } from './diagram.js';
import { dn } from './naming.js';
import { songs as db, settings } from './db.js';
import { transposeSong } from './songformat.js';

const PASSES = 4;

/** Akordi po delovima pesme (onako kako se sviraju: transpozicija i kapodaster uračunati). */
export function songParts(song) {
  const shapes = transposeSong(song, (song.transpose || 0) - (song.capo || 0));
  return (shapes.sections || []).map((sec, i) => ({
    i, name: sec.name || '',
    chords: (sec.lines || []).flatMap((l) => [...(l.chords || [])].sort((a, b) => a.position - b.position).map((c) => c.chord)).filter(Boolean),
  })).filter((p) => p.chords.length);
}

export async function createGame(api) {
  const { t, esc } = api;
  const songId = api.args[0] ? decodeURIComponent(api.args[0]) : '';
  if (!songId) return pickSong(api);
  const song = await db.get(songId);
  if (!song) { api.stage.innerHTML = `<p class="muted center">${t('song.notFound')}</p>`; return { noTempo: true, beats: 0, start() { api.stopNow(); }, stop() {} }; }
  const parts = songParts(song);
  const songBpm = Number(song.bpm) || Number(await settings.get('metBpm', 90)) || 90;
  const stats = (api.allStats.songs || {})[songId] || {};
  const partKey = `gitara-pr-part-${songId}`;
  let part = parts.find((p) => String(p.i) === localStorage.getItem(partKey)) || parts[0];
  let per = Number(localStorage.getItem('gitara-pr-pesma-per')) === 2 ? 2 : 4;
  const startTempo = (p) => (stats[String(p.i)] || {}).lastTempo || Math.max(40, Math.round(songBpm * 0.6 / 5) * 5);
  const partLabel = (p, k) => p.name || t('pr.pesma.part', { n: k + 1 });

  if (!parts.length) {
    api.stage.innerHTML = `<p class="muted center">${t('pr.pesma.noChords')}</p>`;
    return { noTempo: true, beats: 0, start() { api.stopNow(); }, stop() {} };
  }
  api.opts.innerHTML = `
    <div class="pr-song-head"><b>${esc(song.title)}</b>${song.artist ? `<span class="small muted">${esc(song.artist)}</span>` : ''}
      <a class="small" href="#/vezbe/pesma">${t('pr.pesma.other')}</a></div>
    <div class="pr-optlabel">${t('pr.pesma.whichPart')}</div>
    <div class="pr-chips">${parts.map((p, k) => `<button class="chip${p === part ? ' active' : ''}" data-part="${p.i}">${esc(partLabel(p, k))}${(stats[String(p.i)] || {}).best ? ` <small>${Math.round(stats[String(p.i)].best)}</small>` : ''}</button>`).join('')}</div>
    <div class="pr-optlabel">${t('pr.pesma.per')}</div>
    <div class="seg-tabs" role="radiogroup">
      <button role="radio" data-per="4" class="${per === 4 ? 'active' : ''}">${t('pr.pesma.perBar')}</button>
      <button role="radio" data-per="2" class="${per === 2 ? 'active' : ''}">${t('pr.pesma.per2')}</button>
    </div>`;
  api.opts.addEventListener('click', (e) => {
    const b = e.target.closest('[data-part]'), pb = e.target.closest('[data-per]');
    if (b) {
      part = parts.find((p) => String(p.i) === b.dataset.part) || part;
      try { localStorage.setItem(partKey, String(part.i)); } catch {}
      api.opts.querySelectorAll('[data-part]').forEach((x) => x.classList.toggle('active', x === b));
      api.setBpm(startTempo(part));
      draw(0);
    }
    if (pb) {
      per = +pb.dataset.per;
      try { localStorage.setItem('gitara-pr-pesma-per', String(per)); } catch {}
      api.opts.querySelectorAll('[data-per]').forEach((x) => x.classList.toggle('active', x === pb));
    }
  });

  api.stage.innerHTML = `<div class="ps-now"><div class="chord-big ps-cur" id="psCur"></div><div class="ps-next"><small>${t('pr.pesma.next')}</small><div class="chord-big" id="psNext"></div></div></div>
    <div class="ps-strip" id="psStrip"></div><div class="small muted" id="psPass"></div>`;
  const $ = (id) => api.stage.querySelector('#' + id);
  function draw(k) {
    const ch = part.chords;
    $('psCur').innerHTML = chordSVG(ch[k % ch.length]);
    $('psNext').innerHTML = chordSVG(ch[(k + 1) % ch.length], { showName: true });
    $('psStrip').innerHTML = ch.map((c, j) => `<span class="ps-c${j === k % ch.length ? ' now' : ''}">${esc(dn(c))}</span>`).join('');
  }
  draw(0);
  api.feedback('info', t('pr.pesma.ready', { bpm: songBpm }));

  let met = null, units = [], onsets = [], listener = null, k = 0, beatInUnit = 0, pass = 0, passOk = 0, passN = 0, maxBpm = 0;

  function judge(u) {
    if (u.done) return;
    u.done = true;
    const beatMs = 60000 / met.bpm, win = beatMs * per * 0.5;
    const cand = onsets.filter((o) => o.at >= u.at - beatMs * 0.45 && o.at <= u.at + win && o.heard);
    const good = cand.find((o) => o.heard[u.chord] && o.heard[u.chord].ok);
    if (!cand.length) { u.score = 0; api.feedback('miss', t('pr.missed')); }
    else if (!good) { u.score = 0; api.feedback('miss', t('pr.promena.notClear', { c: dn(u.chord) })); }
    else {
      const onTime = Math.abs(good.at - u.at) <= Math.min(150, beatMs * 0.4);
      u.score = onTime ? 1 : 0.7; u.ok = true;
      api.feedback(onTime ? 'hit' : 'late', onTime ? t('pr.pesma.good', { c: dn(u.chord) }) : t('pr.pesma.late', { c: dn(u.chord) }));
    }
    passN++; if (u.ok) passOk++;
  }

  return {
    initialTempo: startTempo(part),
    bpm: { start: startTempo(part), min: 40, max: songBpm, step: 5 },
    async start(bpm) {
      units = []; onsets = []; k = 0; beatInUnit = 0; pass = 0; passOk = 0; passN = 0; maxBpm = bpm;
      listener = await api.listen({
        chords: true,
        onOnset: (o) => {
          const rec = { at: o.at, heard: null };
          onsets.push(rec); if (onsets.length > 40) onsets.shift();
          const want = [...new Set(part.chords)];
          setTimeout(() => { if (listener) { rec.heard = {}; want.forEach((c) => (rec.heard[c] = listener.chordHeard(c))); } }, 350);
        },
      });
      met = new Metronome();
      met.bpm = bpm; met.sig = '4/4'; met.countIn = 1;
      $('psPass').textContent = t('pr.pesma.pass', { n: 1, total: PASSES });
      met.onStep = (slot, beat, accent, info) => {
        if (beat == null) return;
        api.pulse(beat, 4, beat === 0);
        if (info.countIn) { api.feedback('', String(4 - info.countBeat)); draw(0); return; }
        if (beatInUnit === 0) {
          // novi akord: na kraju prolaza kroz deo — ako je išlo dobro, malo brže (najviše do tempa pesme)
          if (k > 0 && k % part.chords.length === 0) {
            pass++;
            const okRate = passN ? passOk / passN : 0;
            if (pass >= PASSES) { met.stop(); setTimeout(finish, 700); return; }
            if (okRate >= 0.85 && met.bpm < songBpm) { met.bpm = Math.min(songBpm, met.bpm + 5); maxBpm = Math.max(maxBpm, met.bpm); api.setBpm(met.bpm); api.feedback('hit', t('pr.pesma.faster', { bpm: met.bpm })); }
            passOk = 0; passN = 0;
            $('psPass').textContent = t('pr.pesma.pass', { n: pass + 1, total: PASSES });
          }
          const u = { at: info.at, chord: part.chords[k % part.chords.length], done: false };
          units.push(u);
          draw(k);
          setTimeout(() => api.running && judge(u), (60000 / met.bpm) * per * 0.5 + 450);
          k++;
        }
        beatInUnit = (beatInUnit + 1) % per;
      };
      met.start();
      api.onCleanup(() => met?.stop());
    },
    stop() { met?.stop(); met = null; listener = null; draw(0); },
  };

  function finish() {
    if (!api.running) return;
    units.forEach(judge);
    const n = units.length || 1, sum = units.reduce((a, u) => a + (u.score || 0), 0), ok = units.filter((u) => u.ok).length;
    listener = null;
    api.finish({ score: (sum / n) * 100, tempo: maxBpm, accuracy: ok / n }, [songId, String(part.i)]);
  }
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
