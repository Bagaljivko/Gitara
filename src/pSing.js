// v2.4.17: Vežbe → „Pevaj uz tekst“: tekst pesme ide red po red, akord stoji tačno iznad reči na kojoj se menja.
// Gore: strelice udaraca pesme (↓ ↑) i brojanje 1 i 2 i 3 i 4 i — svetli trenutni udarac. U sredini: veliki trenutni
// akord i sledeći „za N udaraca“. Reč na kojoj se menja akord ima okvir; trenutna je podvučena. Aplikacija sluša:
// sredinom svakog akorda proveri da li se čuje — reč postane zelena (pogođeno) ili crvena. Na kraju rezultat.
// Jedan akord traje ceo takt (ili pola takta — isto podešavanje kao u „Delovima pesme“).
import { Metronome } from './rhythm.js';
import { dn } from './naming.js';
import { checkChord } from './pChords.js';
import { keepAwake, allowSleep } from './wakelock.js';

const ARROW = { D: '↓', U: '↑', x: '×', B: '↓', '-': '·' };

/** Redovi teksta iz delova pesme: [{ segs: [{ text, ci|null }] }], ci = indeks akorda u nizu. */
export function singLines(chords) {
  const lines = [];
  let cur = null;
  chords.forEach((c, ci) => {
    const L = c.lyric && typeof c.lyric === 'object' ? c.lyric : { pre: '', cur: '', post: '' };
    const full = L.pre + L.cur + L.post;
    // novi red: prvi akord, drugi tekst, ili akord „vraća“ na početak istog teksta (ponovljen red)
    if (!cur || cur.full !== full || L.pre.length < cur.end) {
      cur = { full, end: 0, segs: [] };
      lines.push(cur);
      if (L.pre) cur.segs.push({ text: L.pre, ci: null });
      cur.end = L.pre.length;
    }
    cur.segs.push({ text: L.cur || (full ? '' : ' '), ci });
    cur.end = L.pre.length + L.cur.length;
  });
  for (const l of lines) { const tail = l.full.slice(l.end); if (tail) l.segs.push({ text: tail, ci: null }); }
  return lines;
}

/**
 * api: practice api; song: pesma; o: { parts, label(p,k), startPart, songId, per (2|4), songBpm }
 */
export function createSing(api, song, o) {
  const { t, esc } = api;
  const per = o.per === 2 ? 2 : 4;
  const steps0 = song.strum && song.strum.steps && (!song.strum.sig || song.strum.sig === '4/4') ? song.strum.steps : 'D-DUD-DU';
  const steps = [...Array(8)].map((_, i) => steps0[Math.floor((i * steps0.length) / 8)] || '-');
  const slotsPerChord = per * 2; // 4/4: 2 osmine po dobu
  const whole = { i: 'all', name: '', chords: o.parts.flatMap((p) => p.chords) };
  const all = [...o.parts, whole];
  const nameOf = (p) => (p.i === 'all' ? t('pr.pesma.whole') : o.label(p, o.parts.indexOf(p)));
  const KEY = 'gitara-sing-part-' + o.songId;
  let part = all.find((p) => String(p.i) === (() => { try { return localStorage.getItem(KEY); } catch { return null; } })()) || o.startPart || o.parts[0];
  let chords = [], lines = [], lineOf = [];
  const setPart = (p) => { part = p; chords = p.chords; lines = singLines(chords); lineOf = chords.map((_, ci) => lines.findIndex((l) => l.segs.some((x) => x.ci === ci))); try { localStorage.setItem(KEY, String(p.i)); } catch {} };
  setPart(part);
  let met = null, res = [], cur = -1, screen = null;
  const drawOpts = () => {
    api.head.innerHTML = `<div class="spr-song card"><div class="spr-song-t"><b>${esc(song.title)}</b>${song.artist ? `<span>${esc(song.artist)}</span>` : ''}<small>${esc(t('sg.title'))}</small></div>
      <a class="spr-change" href="#/vezbe/pesma/${encodeURIComponent(o.songId)}">${t('sg.back')}</a></div>`;
    api.opts.innerHTML = `<p class="sg-lead">${esc(t('sg.lead'))}</p><div class="pr-optlabel">${t('sg.part')}</div>
      <div class="pr-chips">${all.map((p) => `<button class="chip${p === part ? ' active' : ''}" data-sp="${esc(String(p.i))}">${esc(nameOf(p))}</button>`).join('')}</div>
      <div class="sg-prev">${lines.slice(0, 2).map((l) => `<p>${l.segs.map((x) => (x.ci == null ? `<span>${esc(x.text)}</span>` : `<span class="sw" data-c="${esc(dn(chords[x.ci].chord))}">${esc(x.text || ' ')}</span>`)).join('')}</p>`).join('')}</div>`;
  };
  api.opts.addEventListener('click', (e) => { const b = e.target.closest('[data-sp]'); if (!b || api.running) return; const p = all.find((x) => String(x.i) === b.dataset.sp); if (p) { setPart(p); drawOpts(); } });
  api.stage.hidden = true;
  drawOpts();
  const opts = { songId: o.songId, get label() { return nameOf(part); } };

  function html() {
    return `<div class="sg" role="dialog" aria-label="${esc(t('sg.title'))}">
      <div class="sg-top"><button class="sg-x" aria-label="${esc(t('common.close'))}">✕</button><span>${esc(t('sg.title'))} · ${esc(opts.label)}</span><b class="sg-bpm">${api.bpm} BPM</b></div>
      <div class="sg-arrows">${steps.map((s, i) => `<i data-s="${i}" class="${s === '-' ? 'rest' : ''}">${ARROW[s] || '·'}</i>`).join('')}</div>
      <div class="sg-count">${['1', 'i', '2', 'i', '3', 'i', '4', 'i'].map((x, i) => `<span data-c="${i}">${x}</span>`).join('')}</div>
      <div class="sg-now"><b class="sg-ch">—</b><span class="sg-nx"><small></small><em></em></span></div>
      <div class="sg-lyr"></div>
      <p class="sg-hint">${esc(t('sg.hint'))}</p>
    </div>`;
  }
  function drawLyrics() {
    const box = screen.querySelector('.sg-lyr');
    const li = Math.max(0, lineOf[Math.max(0, cur)]);
    box.innerHTML = [li, li + 1].filter((k) => lines[k]).map((k, n) => `<p class="${n ? 'dim' : ''}">${lines[k].segs.map((s) => {
      if (s.ci == null) return `<span>${esc(s.text)}</span>`;
      const st = s.ci < cur ? (res[s.ci] === true ? ' ok' : res[s.ci] === false ? ' bad' : '') : s.ci === cur ? ' now' : s.ci === cur + 1 ? ' nx' : '';
      return `<span class="sw${st}" data-c="${esc(dn(chords[s.ci].chord))}">${esc(s.text || ' ')}</span>`;
    }).join('')}</p>`).join('');
  }
  function drawNow(slotInChord) {
    const c = chords[cur], n = chords[cur + 1];
    screen.querySelector('.sg-ch').textContent = c ? dn(c.chord) : '—';
    const left = Math.max(1, Math.ceil((slotsPerChord - slotInChord) / 2));
    screen.querySelector('.sg-nx small').textContent = n ? (n.chord === c?.chord ? t('sg.same') : t(left === 1 ? 'sg.nextIn1' : left < 5 ? 'sg.nextIn2' : 'sg.nextIn', { n: left })) : t('sg.last');
    screen.querySelector('.sg-nx em').textContent = n ? dn(n.chord) : '';
  }
  function finish() {
    const n = res.filter((x) => x !== undefined).length, ok = res.filter((x) => x === true).length;
    const score = n ? Math.round((ok / n) * 100) : 0;
    close();
    api.finish({ score, tempo: api.bpm, accuracy: n ? ok / n : 0 }, [opts.songId, 'sing']).catch(() => {});
  }
  function close() {
    met?.stop(); met = null;
    screen?.remove(); screen = null;
    document.body.classList.remove('sg-open');
    allowSleep('sing');
  }
  return {
    beats: 4,
    bpm: { start: Math.max(45, Math.round((o.songBpm * 0.75) / 5) * 5), min: 40, max: Math.round(o.songBpm * 1.3), step: 5, normal: o.songBpm },
    initialTempo: Math.max(45, Math.round((o.songBpm * 0.75) / 5) * 5),
    levels: [],
    async start(bpm) {
      res = []; cur = -1;
      screen = document.createElement('div'); screen.className = 'sg-wrap'; screen.innerHTML = html();
      document.body.appendChild(screen); document.body.classList.add('sg-open');
      screen.querySelector('.sg-x').addEventListener('click', () => { close(); api.stopNow(); });
      keepAwake('sing');
      drawLyrics();
      try { await api.listen({ chords: true }); } catch {}
      met = new Metronome(); met.bpm = bpm; met.sig = '4/4'; met.countIn = 1;
      const total = chords.length * slotsPerChord;
      met.onStep = (i, beat, acc, info) => {
        if (!screen) return;
        screen.querySelectorAll('.sg-arrows i, .sg-count span').forEach((x) => x.classList.toggle('on', Number(x.dataset.s ?? x.dataset.c) === i));
        if (info.countIn) { screen.querySelector('.sg-ch').textContent = String((info.countBeat ?? 0) + 1); return; }
        const g = info.bar * 8 + i;
        if (g >= total) { finish(); return; }
        const ci = Math.floor(g / slotsPerChord), sl = g % slotsPerChord;
        if (ci !== cur) { cur = ci; drawLyrics(); }
        drawNow(sl);
        // provera: na polovini akorda (vreme da se akord udari i zazvoni)
        if (sl === Math.floor(slotsPerChord / 2)) {
          const want = chords[ci].chord, prev = ci ? chords[ci - 1].chord : null;
          const r = checkChord(api.listener, want, prev && prev !== want ? prev : null);
          res[ci] = !!r.ok;
          const el = screen.querySelector(`.sw.now`); if (el) el.classList.add(r.ok ? 'ok' : 'bad');
        }
      };
      met.start();
    },
    stop() { close(); },
    destroy() { close(); },
  };
}
