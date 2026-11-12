// Vežbe → „Promena akorda“ na stazi: blokovi akorda klize do linije; kad blok stigne, udari taj akord.
// Tačke u bloku su u bojama prstiju. Čista promena = na vreme + čuje se većina tonova novog akorda
// (blaga provera, radi i sa mikrofonom telefona). Normalno: runda traje oko minut. Početnik: staza čeka na svaki akord.
import { strum } from './synth.js';
import { chordNotes, PATTERNS, patternName } from './rhythm.js';
import { chordSVG } from './diagram.js';
import { dn } from './naming.js';
import { esc } from './ui.js';
import { trackGame, chordItem, chordFingers } from './practiceTrack.js';
import * as CS from './chordSeq.js';
import { dragList, gripHTML } from './dragList.js';

export const PAIRS = [['Em', 'G'], ['G', 'C'], ['C', 'Am'], ['D', 'A'], ['G', 'D'], ['Am', 'E'], ['C', 'F']];
const ROUND_MS = 60000;

/** Blaga provera akorda: većina tonova + osnovni ton; ako drugi akord iz para „pristaje“ bolje — to je bio on. */
export function checkChord(listener, want, other) {
  if (!listener) return { ok: false };
  const w = listener.chordHeard(want), o = other ? listener.chordHeard(other) : null;
  return { ok: !!(w.ok && !(o && o.ok && o.share > w.share + 0.08)) };
}

const PAT = (id) => PATTERNS.find((p) => p.id === id && p.sig === '4/4');
export const RHYTHMS = ['one', 'downs', 'eighths', 'slowpop', 'folk', 'pop', 'ballad44', 'rock', 'reggae', 'boomchick'].filter((id) => id === 'one' || PAT(id));
export const rhythmLabel = (t, id) => (id === 'one' ? t('cs.r.one') : patternName(PAT(id)));
/** Udarci obrasca preko akorda (prvi udarac takta je sam akord — ocenjuje se akord; ostali samo vreme). */
export function strumsFor(id, beat, beats) {
  const p = PAT(id); if (!p) return [];
  const slot = 4 / p.steps.length, out = [];
  for (let k = 0; k * 4 < beats; k++) [...p.steps].forEach((st, i) => {
    const b = k * 4 + i * slot; if (b >= beats || st === '-' || b === 0) return;
    const it = { kind: 'strum', beat: beat + b, dir: st === 'U' ? 'U' : 'D', winBeats: Math.min(0.5, slot / 2), winCap: 160 };
    if (st === 'x') { it.muted = true; it.deco = true; }
    out.push(it);
  });
  return out;
}
export function createGame(api) {
  const { t } = api;
  const load = () => { try { return JSON.parse(localStorage.getItem('gitara-pr-promena') || 'null'); } catch { return null; } };
  const saved = load() || {};
  // v1.96: niz bilo kojih akorda (koliko god), svaki sa svojim trajanjem; stari zapis { pair, every } radi i dalje
  const every0 = saved.every === 4 ? 4 : 2;
  let seq = CS.cleanSeq(saved.seq && saved.seq.length ? saved.seq : (Array.isArray(saved.pair) && saved.pair.length >= 2 ? saved.pair : PAIRS[0]), every0);
  if (seq.length < 2) seq = CS.cleanSeq(PAIRS[0], 2);
  // v1.97: ritam — „Samo na 1“ (udari na promenu) ili obrazac udaranja; „Ritam po akordu“ = svaki akord svoj obrazac
  let rhythm = typeof saved.rhythm === 'string' && (saved.rhythm === 'one' || PAT(saved.rhythm)) ? saved.rhythm : 'one';
  let perChord = !!saved.perChord;
  const save = () => { try { const o = load() || {}; localStorage.setItem('gitara-pr-promena', JSON.stringify({ ...o, seq, pair: seq.map((x) => x.c), rhythm, perChord })); } catch {} };
  const key = (q) => q.map((x) => x.c + '/' + x.b).join(' ');
  const pkey = (pr) => key(CS.cleanSeq(pr.seq, pr.b));

  function drawOpts() {
    const h = CS.hardest(seq);
    const allLen = seq.every((x) => x.b === seq[0].b) ? seq[0].b : 0;
    api.opts.innerHTML = `<div class="pr-optlabel cs-head"><span>${t('cs.order')}</span><span class="muted small">${t('cs.tapToEdit')}</span></div>
      <div class="cs-seq">${seq.map((x, i) => `<button type="button" class="cs-cb dl-it${h && x.c === h.b && seq[(i - 1 + seq.length) % seq.length].c === h.a ? ' hard' : ''}" data-i="${i}">${gripHTML(esc(t('dl.drag')))}<b>${esc(dn(x.c))}</b><small>${esc(CS.lenLabel(x.b))}</small></button>`).join('')}${seq.length < CS.MAX_SEQ ? `<button type="button" class="cs-cb add" data-add="1">+ ${t('cs.chord')}</button>` : ''}</div>
      ${seq.length <= 4 ? `<div class="pc-pair cs-dg">${[...new Set(seq.map((x) => x.c))].slice(0, 4).map((c) => `<div class="pc-ch target"><div class="chord-big">${chordSVG(c, { colorFingers: true })}</div></div>`).join('')}</div>` : ''}
      <div class="pr-optlabel">${t('cs.ready')}</div>
      <div class="pr-chips">${CS.PRESETS.map((pr) => `<button class="chip${pkey(pr) === key(seq) ? ' active' : ''}" data-pr="${pr.id}">${esc(CS.presetLabel(pr))}</button>`).join('')}</div>
      <div class="pr-optlabel">${t('cs.eachLen')}</div>
      <div class="seg-tabs" role="radiogroup">${CS.LENS.map((b) => `<button role="radio" data-all="${b}" class="${allLen === b ? 'active' : ''}">${esc(CS.lenLabel(b))}</button>`).join('')}</div>
      <div class="pr-optlabel cs-head"><span>${t('cs.rhythm')}</span><label class="cs-per"><input type="checkbox" id="csPer"${perChord ? ' checked' : ''}> ${t('cs.perChord')}</label></div>
      ${perChord ? `<div class="cs-perlist">${seq.map((x, i) => `<button type="button" class="cs-perrow" data-ri="${i}"><b>${esc(dn(x.c))}</b><span>${esc(rhythmLabel(t, x.r || rhythm))} ▾</span></button>`).join('')}</div>`
        : `<div class="pr-chips">${RHYTHMS.map((id) => `<button class="chip${rhythm === id ? ' active' : ''}" data-rh="${id}">${esc(rhythmLabel(t, id))}</button>`).join('')}</div>`}
      ${h ? `<div class="cs-hard"><b>${esc(t('cs.hardest', { a: dn(h.a), b: dn(h.b) }))}</b><small>${esc(CS.tipOf(h))}</small></div>` : ''}
      <div class="cs-acts"><button type="button" class="btn small" data-act="song">♪ ${t('ex.fromSong')}</button><button type="button" class="btn small" data-act="save">💾 ${t('ex.saveBtn')}</button>${teacher ? `<button type="button" class="btn small" data-act="send">↗ ${t('ex.send')}</button>` : ''}</div>`;
    // v2.2: redosled akorda — prevuci ≡ (isto kao u svim listama)
    const box = api.opts.querySelector('.cs-seq');
    if (box) dragList(box, { item: '.cs-cb[data-i]', grid: true, onDrop: (els) => { const q = els.map((el) => seq[+el.dataset.i]).filter(Boolean); if (q.length === seq.length && q.some((x, k) => x !== seq[k])) { seq = q; save(); } drawOpts(); } });
  }
  let teacher = false;
  drawOpts();
  import('./db.js').then(async ({ settings }) => { teacher = !!((await settings.get('teacher', null)) || {}).on; if (teacher) drawOpts(); }).catch(() => {});
  api.opts.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]');
    if (act) {
      const X = await import('./myEx.js');
      if (act.dataset.act === 'save') await X.saveCurrent();
      if (act.dataset.act === 'send') { const ex = await X.saveCurrent(); if (ex) await X.sendToStudents(ex); }
      if (act.dataset.act === 'song') { const q = await fromSong(); if (q) { seq = q; save(); drawOpts(); } }
      return;
    }
    const rh = e.target.closest('[data-rh]'), ri = e.target.closest('[data-ri]');
    if (rh) { rhythm = rh.dataset.rh; save(); drawOpts(); return; }
    if (ri) { const i = +ri.dataset.ri; const v = await pickRhythm(seq[i].r || rhythm); if (v) { seq = seq.map((x, k) => (k === i ? { ...x, r: v } : x)); save(); drawOpts(); } return; }
    const pr = e.target.closest('[data-pr]'), all = e.target.closest('[data-all]'), cb = e.target.closest('[data-i]'), add = e.target.closest('[data-add]');
    if (pr) { const x = CS.PRESETS.find((y) => y.id === pr.dataset.pr); seq = CS.cleanSeq(x.seq, x.b); try { const o = load() || {}; delete o.ex; localStorage.setItem('gitara-pr-promena', JSON.stringify(o)); } catch {} save(); drawOpts(); }
    if (all) { const b = +all.dataset.all; seq = seq.map((x) => ({ ...x, b })); save(); drawOpts(); }
    if (add) { const r = await CS.askChord({ b: seq[seq.length - 1]?.b || 4 }); if (r && !r.del) { seq = [...seq, r]; save(); drawOpts(); } }
    if (cb) {
      const i = +cb.dataset.i; const r = await CS.askChord({ cur: seq[i] });
      if (!r) return;
      if (r.del) { if (seq.length <= 2) { (await import('./ui.js')).toast(t('cs.min2')); return; } seq = seq.filter((_, k) => k !== i); }
      else seq = seq.map((x, k) => (k === i ? r : x));
      save(); drawOpts();
    }
  });
  api.opts.addEventListener('change', (e) => { if (e.target.id === 'csPer') { perChord = e.target.checked; save(); drawOpts(); } });
  // „Iz pesme…“: izaberi pesmu, pa deo → akordi tog dela redom (uzastopni isti se spajaju)
  async function fromSong() {
    const { songs } = await import('./db.js'); const { dialog } = await import('./ui.js');
    const lib = (await songs.all()).filter((s) => !s.deleted && !s.demo && (s.sections || []).some((x) => (x.lines || []).some((l) => (l.chords || []).length))).sort((a, b) => String(a.title).localeCompare(String(b.title), 'sr'));
    if (!lib.length) { (await import('./ui.js')).toast(t('ex.noSongs')); return null; }
    const id = await dialog({ title: t('ex.pickSong'), className: 'dlg-stack', buttons: [...lib.slice(0, 40).map((s) => ({ label: s.title + (s.artist ? ' — ' + s.artist : ''), value: s.id })), { label: t('common.cancel'), value: null, kind: 'ghost' }] });
    const song = lib.find((s) => s.id === id); if (!song) return null;
    const secs = (song.sections || []).map((sec, i) => ({ i, name: sec.name || t('ex.part', { n: i + 1 }), ch: (sec.lines || []).flatMap((l) => [...(l.chords || [])].sort((a, b) => a.position - b.position).map((c) => c.chord)).filter(CS.known) })).filter((x) => x.ch.length >= 2);
    if (!secs.length) { (await import('./ui.js')).toast(t('ex.noChords')); return null; }
    const si = secs.length === 1 ? 0 : await dialog({ title: song.title, className: 'dlg-stack', buttons: [...secs.map((x, k) => ({ label: `${x.name}: ${x.ch.slice(0, 6).map(dn).join(' ')}${x.ch.length > 6 ? ' …' : ''}`, value: k })), { label: t('common.cancel'), value: null, kind: 'ghost' }] });
    if (si == null) return null;
    const ch = secs[si].ch.filter((c, k, a) => !k || c !== a[k - 1]).slice(0, CS.MAX_SEQ);
    return ch.length >= 2 ? CS.cleanSeq(ch, 4) : null;
  }
  async function pickRhythm(cur) {
    const { dialog } = await import('./ui.js');
    return dialog({ title: t('cs.rhythm'), buttons: [...RHYTHMS.map((id) => ({ label: (id === cur ? '✓ ' : '') + rhythmLabel(t, id), value: id })), { label: t('common.cancel'), value: null, kind: 'ghost' }] });
  }
  api.stage.hidden = true;
  // posle runde: najteža promena u ovoj rundi (najviše promašaja / kašnjenja) → „Vežbaj samo X → Y“
  let lastItems = [];
  const worst = () => {
    const m = new Map();
    const ch = lastItems.filter((x) => x.kind === 'chord');
    ch.forEach((it, i) => { if (!i || it.chord === ch[i - 1].chord) return; const k = ch[i - 1].chord + '>' + it.chord; const e = (it.state === 'miss' ? 2 : 0) + (it.kindHit === 'late' || it.kindHit === 'early' ? 1 : 0) + (it.wrong || 0); const o = m.get(k) || { e: 0, n: 0 }; o.e += e; o.n++; m.set(k, o); });
    let best = null; for (const [k, o] of m) { const v = o.e / o.n; if (v > 0.25 && (!best || v > best.v)) best = { k, v }; }
    return best ? best.k.split('>') : null;
  };
  const beatsOf = () => seq.reduce((a, x) => a + x.b, 0);
  // niz se ponavlja dok runda traje; svaki akord traje svoje dobe
  const items = (n) => { const out = []; let beat = 0; for (let i = 0; i < n; i++) { const x = seq[i % seq.length]; out.push(chordItem(x.c, beat, x.b)); const r = perChord ? x.r || rhythm : rhythm; if (r !== 'one') out.push(...strumsFor(r, beat, x.b)); beat += x.b; } return out; };
  const otherOf = (c, i) => { const q = seq.map((x) => x.c); const k = q.indexOf(c); return q[(k - 1 + q.length) % q.length] !== c ? q[(k - 1 + q.length) % q.length] : q.find((x) => x !== c); };
  return trackGame(api, {
    levels: [{ id: 'beg', label: t('pr.lvl.beg') }, { id: 'normal', label: t('pr.lvl.normal') }],
    bpm: { start: 60, min: 40, max: 160, step: 5 },
    firstBpm: 50,
    round(level, bpm) {
      const avg = beatsOf() / seq.length;
      const n = level === 'beg' ? Math.max(8, seq.length * 2) : Math.max(8, seq.length, Math.floor(ROUND_MS / ((60000 / bpm) * avg)));
      const its = items(n); lastItems = its; const chordsN = its.filter((x) => x.kind === 'chord').length;
      return { items: its, lagMs: 350 + 90 + 80, fingersOf: chordFingers, hintOf: (it) => t('pr.promena.hint', { c: it.label }),
        key: seq.length > 2 ? 'seq:' + seq.map((x) => x.c).join('-') : null,
        lines: () => { const w = worst(); return w ? [{ label: t('cs.slowest'), value: `${dn(w[0])} → ${dn(w[1])}` }] : []; },
        extra: () => { const w = worst(); return w && seq.length > 2 ? [{ id: 'drill', label: t('cs.drill', { a: dn(w[0]), b: dn(w[1]) }), primary: true }] : []; } };
    },
    // čistih promena u minuti (Normalno): u minuti ima bpm/every promena, od toga je deo bio čist
    metric: (st) => (st.accuracy * st.tempo) / (beatsOf() / seq.length),
    metricLabel: t('pr.promena.perMin'),
    listen(round, input) {
      // akord se proverava ~0,35 s posle udarca (dok se tonovi „skupe“)
      return {
        chords: true,
        onOnset: (o) => setTimeout(() => input(o.at, (it) => {
          if (it.kind === 'strum') return { ok: true }; // udarci obrasca: samo vreme
          const r = checkChord(api.listener, it.chord, otherOf(it.chord));
          return r.ok ? r : { ok: false, text: t('pr.promena.notClearShort', { c: it.label }) };
        }), 350),
      };
    },
    onChoice(choice, round, ctl) {
      if (choice !== 'drill') return;
      const w = worst(); if (!w) return;
      seq = CS.cleanSeq(w, 2); save(); drawOpts(); api.restart();
    },
    demo: {
      bpm: 70,
      intro: t('pr.promena.demo1'),
      items: () => Array.from({ length: 6 }, (_, i) => chordItem(['G', 'C'][i % 2], i * 2, 2)),
      fingersOf: chordFingers,
      play: (it) => strum(0, 'D', { notes: chordNotes(it.chord), group: 'practice' }),
      early: (i) => i === 4,
      captions: { 0: t('pr.promena.demo2'), 1: t('pr.promena.demo3'), 2: t('pr.promena.demo4'), 4: t('pr.promena.demo5'), 5: t('pr.promena.demo6') },
    },
  });
}
