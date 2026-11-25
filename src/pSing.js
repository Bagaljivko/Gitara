// v2.4.17: Vežbe → „Pevaj uz tekst“: tekst pesme ide red po red, akord stoji tačno iznad reči na kojoj se menja.
// Gore: strelice udaraca pesme (↓ ↑) i brojanje 1 i 2 i 3 i 4 i — svetli trenutni udarac. U sredini: veliki trenutni
// akord i sledeći „za N udaraca“. Reč na kojoj se menja akord ima okvir; trenutna je podvučena. Aplikacija sluša:
// sredinom svakog akorda proveri da li se čuje — reč postane zelena (pogođeno) ili crvena. Na kraju rezultat.
// Jedan akord traje ceo takt (ili pola takta — isto podešavanje kao u „Delovima pesme“).
import { Metronome } from './rhythm.js';
import { dn } from './naming.js';
import { checkChord } from './pChords.js';
import { keepAwake, allowSleep } from './wakelock.js';
import { songParts } from './pSong.js';
import { sectionLabel } from './sectionLabel.js';
import { getReady } from './getReady.js';

const ARROW = { D: '↓', U: '↑', x: '×', B: '↓', '-': '·' };

/** Redovi teksta iz delova pesme: [{ segs: [{ text, ci|null }], head?, ins? }], ci = indeks akorda u nizu.
 *  v2.4.26: akord može da nosi sec (redni broj dela) i head (naziv dela) — novi deo = novi red sa nazivom;
 *  deo bez teksta (instrumental) = red „♪“ sa akordima (najviše 4 u redu). */
export function singLines(chords) {
  const lines = [];
  let cur = null;
  chords.forEach((c, ci) => {
    const L = c.lyric && typeof c.lyric === 'object' ? c.lyric : { pre: '', cur: '', post: '' };
    const full = L.pre + L.cur + L.post;
    const newSec = !cur || cur.sec !== c.sec;
    // novi red: prvi akord, novi deo, drugi tekst, ili akord „vraća“ na početak istog teksta (ponovljen red)
    if (newSec || cur.full !== full || L.pre.length < cur.end || (!full && cur.segs.length >= 4)) {
      cur = { full, end: 0, segs: [], sec: c.sec, ...(newSec && c.head ? { head: c.head } : {}), ...(!full ? { ins: true } : {}) };
      lines.push(cur);
      if (L.pre) cur.segs.push({ text: L.pre, ci: null });
      cur.end = L.pre.length;
    }
    cur.segs.push({ text: L.cur || (full ? '' : '♪'), ci });
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
  // v2.4.26: svi delovi redom (i ponovljeni refren, i instrumental); dugmad samo za delove sa tekstom.
  // Dodir na deo = taj deo; dodir na drugi = sve od prvog do njega (i delovi između); „Cela pesma“ = sve redom.
  const seq = songParts(song, { dedupe: false });
  const hasLyr = (p) => p.chords.some((c) => c.lyric && typeof c.lyric === 'object' && (c.lyric.pre + c.lyric.cur + c.lyric.post).trim());
  const nm = (p) => (p.name ? sectionLabel(p.name) : t('pr.pesma.part', { n: p.i + 1 }));
  const seen = {};
  const names = seq.map((p) => { const n = nm(p); seen[n] = (seen[n] || 0) + 1; return n; });
  const cnt = {};
  const label = seq.map((p, k) => { const n = names[k]; if (seen[n] < 2 || /\d$/.test(n)) return n; cnt[n] = (cnt[n] || 0) + 1; return n + ' ' + cnt[n]; });
  const chips = seq.map((p, k) => k).filter((k) => hasLyr(seq[k]));
  const KEY = 'gitara-sing-sel-' + o.songId;
  const last = seq.length - 1;
  let sel = (() => { try { const m = /^(\d+)-(\d+)$/.exec(localStorage.getItem(KEY) || ''); if (m && +m[2] <= last && +m[1] <= +m[2]) return { a: +m[1], b: +m[2] }; } catch {} return null; })();
  if (!sel) { const k0 = seq.findIndex((p) => o.startPart && p.i === o.startPart.i && hasLyr(p)); const k = k0 >= 0 ? k0 : (chips[0] ?? 0); sel = { a: k, b: k }; }
  // v2.4.30: „▶ odavde“ sa ekrana pesme (&from=redni broj dela u pesmi) — od tog dela do kraja
  const fromSec = api.params && api.params.get && api.params.get('from');
  if (fromSec != null && fromSec !== '') { const k = seq.findIndex((p) => String(p.i) === String(fromSec)); if (k >= 0) sel = { a: k, b: last }; }
  let pendingRange = false; // posle dodira na jedan deo, sledeći dodir pravi raspon (prvi dodir na ekranu = jedan deo)
  const isWhole = () => sel.a === 0 && sel.b === last && last > 0;
  const nameOf = () => (isWhole() ? t('pr.pesma.whole') : sel.a === sel.b ? label[sel.a] : t('sg.range', { a: label[sel.a], b: label[sel.b] }));
  let chords = [], lines = [], lineOf = [];
  const setSel = (a, b) => {
    sel = { a: Math.min(a, b), b: Math.max(a, b) };
    chords = seq.slice(sel.a, sel.b + 1).flatMap((p, k) => p.chords.map((c, j) => ({ ...c, sec: sel.a + k, ...(j === 0 && sel.b > sel.a ? { head: label[sel.a + k] } : {}) })));
    lines = singLines(chords); lineOf = chords.map((_, ci) => lines.findIndex((l) => l.segs.some((x) => x.ci === ci)));
    try { localStorage.setItem(KEY, sel.a + '-' + sel.b); } catch {}
  };
  setSel(sel.a, sel.b);
  // v2.4.29: pregled kao na ekranu pesme — red akorda iznad reda teksta
  const prevLine = (l) => {
    let col = 0, cl = '', end = 0;
    for (const x of l.segs) {
      if (x.ci != null) { const nm = dn(chords[x.ci].chord), at = Math.max(col, end ? end + 1 : 0); cl += ' '.repeat(Math.max(0, at - end)) + `<b class="sw" data-c="${esc(nm)}">${esc(nm)}</b>`; end = at + nm.length; }
      col += (x.text || '').length;
    }
    const text = l.ins ? '' : l.segs.map((x) => x.text).join('');
    return `${l.head ? `<div class="sg-head">${esc(l.head)}</div>` : ''}<div class="pl${l.ins ? ' ins' : ''}"><div class="pc">${cl}</div>${text ? `<div class="pt">${esc(text)}</div>` : ''}</div>`;
  };
  const lineHTML = (l, segHTML) => `${l.head ? `<div class="sg-head">${esc(l.head)}</div>` : ''}<p class="${l.ins ? 'ins' : ''}">${l.segs.map(segHTML).join('')}</p>`;
  const drawOpts = () => {
    const n = sel.b - sel.a + 1;
    const min = Math.max(1, Math.round((chords.length * per) / (api.bpm || o.songBpm) + 0.2));
    const inSel = (k) => k >= sel.a && k <= sel.b;
    api.head.innerHTML = `<div class="spr-song card"><div class="spr-song-t"><b>${esc(song.title)}</b>${song.artist ? `<span>${esc(song.artist)}</span>` : ''}<small>${esc(t('sg.title'))}</small></div>
      <a class="spr-change" href="#/vezbe/pesma/${encodeURIComponent(o.songId)}">${t('sg.back')}</a></div>
      <div class="pr-optlabel">${t('sg.part')}</div>
      <div class="pr-chips sg-chips">${chips.map((k) => `<button class="chip${inSel(k) && !isWhole() ? ' active' : ''}${inSel(k) && sel.a !== sel.b && !isWhole() ? ' in' : ''}" data-sk="${k}">${esc(label[k])}</button>`).join('')}<button class="chip${isWhole() ? ' active' : ''}" data-sk="all">${esc(t('pr.pesma.whole'))}</button></div>
      <div class="set-grp sg-sum"><div class="tch-row"><span class="sr-ic" aria-hidden="true">🎤</span><span><b class="sg-sel">${esc(nameOf())}</b><small>${esc(t(n > 1 ? (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'sg.lenFew' : 'sg.len') : 'sg.len1', { n, m: min }))}</small></span></div></div>
      ${pendingRange && !isWhole() && chips.length > 1 ? `<p class="sg-rhint">${esc(t('sg.rangeHint'))}</p>` : ''}
      <div class="sg-prev">${lines.slice(0, 3).map(prevLine).join('')}</div>`;
    api.opts.innerHTML = `<p class="sg-lead">${esc(t('sg.lead2'))}</p>`;
  };
  api.head.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sk]'); if (!b || api.running) return;
    if (b.dataset.sk === 'all') { setSel(0, last); pendingRange = false; }
    else { const k = +b.dataset.sk; if (pendingRange && k !== sel.a) { setSel(sel.a, k); pendingRange = false; } else { setSel(k, k); pendingRange = true; } }
    drawOpts();
  });
  api.stage.hidden = true;
  drawOpts();
  const opts = { songId: o.songId, get label() { return nameOf(); } };

  let met = null, res = [], cur = -1, screen = null, ready = null;

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
    box.innerHTML = [li, li + 1].filter((k) => lines[k]).map((k, n) => `<div class="${n ? 'dim' : ''}">${lineHTML(lines[k], (s) => {
      if (s.ci == null) return `<span>${esc(s.text)}</span>`;
      const st = s.ci < cur ? (res[s.ci] === true ? ' ok' : res[s.ci] === false ? ' bad' : '') : s.ci === cur ? ' now' : s.ci === cur + 1 ? ' nx' : '';
      return `<span class="sw${st}" data-c="${esc(dn(chords[s.ci].chord))}">${esc(s.text || ' ')}</span>`;
    })}</div>`).join('');
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
    ready?.cancel(); ready = null;
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
      // v2.4.26: „Spremi se“ — 5 s da uzmeš gitaru (prvi akord se vidi); dodir = kreni odmah
      ready = getReady({ first: chords[0] ? chords[0].chord : '' });
      const go = await ready.done; ready = null;
      if (!go || !screen) { if (screen) { close(); api.stopNow(); } return; }
      try { await api.listen({ chords: true }); } catch {}
      if (!screen) return;
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
