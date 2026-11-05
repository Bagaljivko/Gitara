// Vežbe → „Skale“: put korak po korak (pentatonika → blues → dur/mol → sekvence) + slobodan izbor
// (tonalitet, skala, pozicija, obrazac). Igra je ista staza kao Pauk (note u bojama prstiju, ruka, prstenovi,
// crvena tačka, „Čekaj me“, tempo, rezultat). Kartice sa teorijom (kratko → „Saznaj više“ → „Teorija“) se
// učitavaju tek kad se otvore. Napredak: najbolji tempo i zvezdice po tonalitetu + skali + poziciji + obrascu.
import { pluck } from './synth.js';
import { settings } from './db.js';
import { t as tt, LANGS, onLangChange } from './i18n.js';
import { dn } from './naming.js';
import { createHitLog } from './practiceListen.js';
import { createBoard } from './practiceBoard.js';
import { trackGame, noteHint, notePluck, starsOf } from './practiceTrack.js';
import { OPEN, SCALE_IDS, PATTERNS, POSITIONS, keyName, patternNotes, boxNotes, progressKey } from './scales.js';
import { PATH, SCALE_CARD, PATTERN_CARD } from './skalePath.js';

const STORE = 'skale';
const midiOf = (it) => OPEN[it.s] + it.f;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- Napredak (lokalno + rezervna kopija na Drive-u; ključ „skale“, verzija 1) ----------------
export async function loadSkale() {
  const s = await settings.get(STORE, null);
  const o = s && typeof s === 'object' ? s : {};
  return { v: 1, items: o.items && typeof o.items === 'object' ? o.items : {}, path: { done: { ...(o.path?.done || {}) }, cards: { ...(o.path?.cards || {}) } } };
}
const saveSkale = (st) => settings.set(STORE, st);
/** Korak puta na kom je igrač (prvi nezavršen), 0-based; PATH.length = sve pređeno. */
export const nextStepIndex = (st) => { const i = PATH.findIndex((p) => !st.path.done[p.id]); return i < 0 ? PATH.length : i; };

// ---------------- Teorija: tekstovi tek na zahtev ----------------
let theory = null;
async function loadTheory() {
  if (theory) return theory;
  theory = await import('./skaleTheory.js');
  const merge = () => { Object.assign(LANGS.sr, theory.sr); if (LANGS.en) Object.assign(LANGS.en, theory.en); };
  merge(); onLangChange(merge);
  return theory;
}

/** Donji list (kartica / biblioteka): blago klizi odozdo; zatvara se dodirom van njega ili povlačenjem nadole. */
function sheet(html, { onClose } = {}) {
  const el = document.createElement('div');
  el.className = 'sk-sheet-wrap';
  el.innerHTML = `<div class="sk-sheet" role="dialog" aria-modal="true"><i class="sk-grip" aria-hidden="true"></i>${html}</div>`;
  document.body.appendChild(el);
  const box = el.firstChild;
  requestAnimationFrame(() => el.classList.add('on'));
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    el.classList.remove('on');
    setTimeout(() => el.remove(), 260);
    onClose?.();
  };
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) close(); });
  let y0 = null;
  box.addEventListener('pointerdown', (e) => { if (!e.target.closest('button,a')) y0 = e.clientY; });
  box.addEventListener('pointermove', (e) => { if (y0 == null) return; const dy = Math.max(0, e.clientY - y0); box.style.transform = `translate3d(0,${dy}px,0)`; });
  const up = (e) => { if (y0 == null) return; const dy = e.clientY - y0; y0 = null; box.style.transform = ''; if (dy > 60) close(); };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  return { el, box, close };
}

export async function createGame(api) {
  const { t, esc } = api;
  let st = await loadSkale(); // napredak pre prvog crtanja (lokalno, brzo)
  let shellReady = false;   // tempo se menja tek kad je ekran igre spreman
  const log = createHitLog();
  // izbor: { step?: id, key, scale, pos, pattern, roots? }
  let sel = (() => { try { const s = JSON.parse(localStorage.getItem('gitara-pr-skale-sel') || 'null'); return s && SCALE_IDS.includes(s.scale) ? s : null; } catch { return null; } })();
  const fromStep = (p, k = 0) => ({ step: p.id, key: p.key, scale: p.scale, pos: p.pos, pattern: p.patterns[k], roots: !!p.roots });
  if (!sel) sel = fromStep(PATH[0]);
  const keepSel = () => { try { localStorage.setItem('gitara-pr-skale-sel', JSON.stringify(sel)); } catch {} };
  const patOf = () => (api.level === 'beg' ? 'updown' : sel.pattern);
  const pk = (pat = patOf()) => progressKey(sel.key, sel.scale, sel.pos, pat);
  const recOf = (k) => st.items[k] || {};
  const tempoOf = () => recOf(pk()).lastTempo || 60;
  const stepName = (p) => t('sk.step.' + p.id);
  const scaleName = (s) => t('sk.sc.' + s);
  const keyLabel = (k) => dn(keyName(k));
  const selTitle = () => `${keyLabel(sel.key)} · ${scaleName(sel.scale)} · ${t('sk.posN', { n: sel.pos })}`;

  // ---------------- Ekran: put + slobodan izbor + pregled kutije ----------------
  api.stage.hidden = true;
  let board = null;
  function draw() {
    const nx = nextStepIndex(st), first = nx === 0 && !Object.keys(st.items).length;
    const beg = api.level === 'beg';
    const stepRec = (p) => {
      const recs = p.patterns.map((pt) => st.items[progressKey(p.key, p.scale, p.pos, pt)] || {});
      return { stars: Math.max(0, ...recs.map((r) => r.stars || 0)), bpm: Math.max(0, ...recs.map((r) => r.bpm || 0)) };
    };
    const pathHTML = first
      ? `<button class="sk-hero" data-hero="1"><span class="sk-hero-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
          <span><b>${t('sk.first')}</b><small>${t('sk.firstSub')}</small></span></button>`
      : `<ol class="sk-path">${PATH.map((p, i) => {
          const r = stepRec(p), done = !!st.path.done[p.id], cls = done ? 'done' : i === nx ? 'next' : i > nx ? 'later' : '';
          return `<li class="sk-step ${cls}${sel.step === p.id ? ' sel' : ''}"><button data-step="${p.id}">
            <span class="sk-num">${done ? '✓' : i + 1}</span>
            <span class="sk-sname"><b>${esc(stepName(p))}</b><small>${esc(keyLabel(p.key))} · ${esc(scaleName(p.scale))}</small></span>
            <span class="sk-sres">${r.stars ? `<span class="pr-stars">${[0, 1, 2].map((k) => `<i class="${k < r.stars ? 'on' : ''}">★</i>`).join('')}</span>` : ''}${r.bpm ? `<small>${r.bpm} BPM</small>` : ''}</span>
          </button></li>`;
        }).join('')}</ol>
        <p class="small muted sk-later-note" id="skLater" hidden>${t('sk.earlier')}</p>
        ${nx < PATH.length ? `<button class="btn primary wide sk-cont" data-cont="1">${t('sk.continue', { s: stepName(PATH[nx]) })}</button>` : `<p class="small muted center">${t('sk.allDone')}</p>`}`;
    const pats = PATTERNS.map((p) => {
      const locked = beg && p !== 'updown';
      return `<button role="radio" data-pat="${p}" class="${p === sel.pattern ? 'active' : ''}${locked ? ' locked' : ''}" ${locked ? 'aria-disabled="true"' : ''}>${t('sk.pt.' + p)}</button>`;
    }).join('');
    const rec = recOf(pk());
    api.opts.innerHTML = `
      <div class="sk-head"><b>${t('sk.path')}</b><span class="sk-head-r"><button class="btn small sk-lib" data-lib="1">${t('sk.theory')}</button><button class="sk-i" data-info="1" aria-label="${t('pr.info.what')}" title="${t('pr.info.what')}">i</button></span></div>
      ${pathHTML}
      <div class="sk-free">
        <div class="sk-head"><b>${t('sk.free')}</b></div>
        <div class="pr-optlabel">${t('sk.scale')}</div>
        <div class="sk-scales">${SCALE_IDS.map((s) => `<button class="chip${s === sel.scale ? ' active' : ''}" data-scale="${s}"><b>${t('sk.sc.' + s)}</b><small>${t('sk.sch.' + s)}</small></button>`).join('')}</div>
        <div class="pr-optlabel">${t('sk.key')}</div>
        <div class="sk-keys">${Array.from({ length: 12 }, (_, k) => `<button class="chip${k === sel.key ? ' active' : ''}" data-key="${k}">${esc(keyLabel(k))}</button>`).join('')}</div>
        <div class="pr-optlabel">${t('sk.pos')}</div>
        <div class="sk-keys sk-pos">${POSITIONS.map((p) => `<button class="chip${p === sel.pos ? ' active' : ''}" data-pos="${p}">${p}</button>`).join('')}</div>
        <div class="pr-optlabel">${t('sk.pattern')}</div>
        <div class="seg-tabs sk-pats" role="radiogroup">${pats}</div>
        ${beg ? `<p class="small muted center">${t('sk.lockedBeg')}</p>` : ''}
      </div>
      <div class="sk-preview">
        <div class="sk-ptitle"><b>${esc(sel.step ? stepName(PATH.find((p) => p.id === sel.step)) : t('sk.free'))}</b><small>${esc(selTitle())} · ${t('sk.pt.' + patOf())}${rec.bpm ? ' · ' + t('sk.best', { n: rec.bpm }) : ''}</small></div>
        <div class="pr-board sk-board"></div>
        <small class="muted">${t('sk.rootsNote')}</small>
      </div>`;
    // pregled kutije (pre početka): sve note pozicije u bojama prstiju, tonike sa narandžastim krugom
    const holder = api.opts.querySelector('.sk-board');
    board = createBoard(holder, { from: sel.pos, to: sel.pos + 4 });
    for (const n of boxNotes(sel.key, sel.scale, sel.pos)) board.mark(n.s, n.f, n.root ? 'show root' : 'show', String(n.f), n.finger, 0);
    if (shellReady) api.setBpm(tempoOf());
  }

  function select(next, { start = false } = {}) {
    sel = next; keepSel(); draw();
    if (start) api.restart();
  }
  api.opts.addEventListener('click', async (e) => {
    if (api.running) return;
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.hero) return select(fromStep(PATH[0]), { start: true });
    if (d.cont) { const nx = nextStepIndex(st); const p = PATH[nx]; const k = Math.max(0, p.patterns.findIndex((pt) => !(st.items[progressKey(p.key, p.scale, p.pos, pt)] || {}).passed)); return select(fromStep(p, k), { start: true }); }
    if (d.step) {
      const i = PATH.findIndex((p) => p.id === d.step);
      select(fromStep(PATH[i]));
      if (i > nextStepIndex(st)) api.opts.querySelector('#skLater').hidden = false;
      return;
    }
    if (d.scale) return select({ ...sel, step: null, roots: false, scale: d.scale });
    if (d.key) return select({ ...sel, step: null, roots: false, key: +d.key });
    if (d.pos) return select({ ...sel, step: null, roots: false, pos: +d.pos });
    if (d.pat) { if (b.classList.contains('locked')) return; return select({ ...sel, step: null, pattern: d.pat }); }
    if (d.lib) return library();
    if (d.info) return showCard(cardNow());
  });

  // ---------------- Kartice ----------------
  const cardNow = () => (sel.step ? PATH.find((p) => p.id === sel.step).card : PATTERN_CARD[patOf()] || SCALE_CARD[sel.scale]);
  async function showCard(id, { first = false, onClose } = {}) {
    if (!id) return;
    await loadTheory();
    const s = sheet(`
      <div class="sk-card-kicker">${first ? t('sk.newCard') : t('pr.info.what')}</div>
      <h3>${tt('sk.card.' + id + '.t')}</h3>
      <p>${tt('sk.card.' + id + '.s')}</p>
      <div class="sk-more" hidden><p>${tt('sk.card.' + id + '.m')}</p></div>
      <div class="row-btns"><button class="btn small" data-more="1">${t('sk.more')}</button><button class="btn small primary" data-close="1">${t('sk.close')}</button></div>`, { onClose });
    s.box.querySelector('[data-more]').addEventListener('click', (e) => {
      const m = s.box.querySelector('.sk-more'); m.hidden = !m.hidden;
      e.currentTarget.textContent = m.hidden ? t('sk.more') : t('sk.less');
    });
    return s;
  }
  async function library() {
    const th = await loadTheory();
    const unlocked = Object.keys(st.path.cards).filter((id) => th.CARDS[id]);
    const groups = th.TOPICS.map((tp) => ({ tp, ids: unlocked.filter((id) => th.CARDS[id].topic === tp) })).filter((g) => g.ids.length);
    const s = sheet(`<h3>${t('sk.theory')}</h3>
      ${groups.length ? groups.map((g) => `<div class="pr-optlabel sk-lib-h">${tt('sk.topic.' + g.tp)}</div><div class="sk-lib-list">${g.ids.map((id) => `<button class="sk-lib-item" data-card="${id}"><b>${tt('sk.card.' + id + '.t')}</b><small>${tt('sk.card.' + id + '.s')}</small></button>`).join('')}</div>`).join('')
        : `<p class="muted">${t('sk.theoryEmpty')}</p>`}
      <div class="row-btns"><button class="btn small" data-close="1">${t('sk.close')}</button></div>`);
    s.box.addEventListener('click', (e) => { const c = e.target.closest('[data-card]'); if (c) { s.close(); showCard(c.dataset.card); } });
  }

  // ---------------- Igra ----------------
  function buildRound(level) {
    const pat = level === 'beg' ? 'updown' : sel.pattern;
    const k = progressKey(sel.key, sel.scale, sel.pos, pat);
    const notes = patternNotes(sel.key, sel.scale, sel.pos, pat);
    // Normalno, prvi put ovaj obrazac: jedan prolaz sa „Čekaj me“ (da prsti nauče put), pa uz tempo
    const learnPass = level !== 'beg' && !api.wait && !recOf(k).learned;
    const nx = PATH.findIndex((p) => p.id === sel.step);
    return {
      pat, k, learnPass,
      wait: learnPass ? true : undefined,
      items: notes.map((n, i) => ({ kind: 'note', beat: i, s: n.s, f: n.f, finger: n.finger, root: !!(sel.roots && n.root) })),
      lagMs: 180,
      hintOf: (it) => noteHint(t, it),
      extra: (stt) => (nx >= 0 && stt.score >= 50 && st.path.done[sel.step] && nx + 1 < PATH.length ? [{ id: 'nextStep', label: t('sk.nextStep'), primary: true, always: true }] : []),
    };
  }

  const game = trackGame(api, {
    levels: [{ id: 'beg', label: t('pr.lvl.beg') }, { id: 'normal', label: t('pr.lvl.normal') }],
    bpm: { start: 60, min: 40, max: 200, step: 5 },
    initialTempo: tempoOf(),
    firstBpm: 60,
    round(level) { log.clear(); return buildRound(level); },
    listen(round, input) { return { onPluck: notePluck(api, log, input, t, 'skale', midiOf) }; },
    async onRoundEnd(stats, round, ctl) {
      const rec = { ...(st.items[round.k] || {}) };
      if (round.learnPass) {
        // naučen put → odmah uz tempo (isti obrazac)
        rec.learned = true; st.items[round.k] = rec; await saveSkale(st);
        ctl.track.pop(t('sk.nowTempo'), 'hit');
        await wait(1500);
        if (!api.running || !ctl.track) return true;
        await ctl.next(buildRound(api.level));
        return true;
      }
      const stars = starsOf(stats.score);
      rec.best = Math.max(rec.best || 0, Math.round(stats.score));
      rec.stars = Math.max(rec.stars || 0, stars);
      rec.plays = (rec.plays || 0) + 1;
      if (stats.waited) { if (stats.clean) rec.learned = true; }
      else {
        // čist prolaz → sledeći put +5 BPM; neuredan → isti tempo
        rec.lastTempo = stats.clean ? stats.tempo + 5 : stats.tempo;
        if (stats.clean) rec.bpm = Math.max(rec.bpm || 0, stats.tempo);
        rec.learned = true;
      }
      if (stats.score >= 50) rec.passed = true;
      st.items[round.k] = rec;
      // put: korak je gotov posle poslednjeg obrasca (uz bar jednu zvezdicu); prvi put → kartica
      let card = null;
      const step = PATH.find((p) => p.id === sel.step);
      if (step && stats.score >= 50) {
        const at = step.patterns.indexOf(round.pat);
        if (at >= 0 && at < step.patterns.length - 1) { sel = { ...sel, pattern: step.patterns[at + 1] }; keepSel(); }
        else if (at === step.patterns.length - 1 && !st.path.done[step.id]) { st.path.done[step.id] = Date.now(); card = step.card; }
      }
      // slobodan izbor: kartica skale/obrasca kad se prvi put pređe
      if (!step && stats.score >= 50) card = [PATTERN_CARD[round.pat], SCALE_CARD[sel.scale]].find((c) => c && !st.path.cards[c]) || null;
      if (card && st.path.cards[card]) card = null;
      if (card) st.path.cards[card] = Date.now();
      await saveSkale(st);
      if (!stats.waited) api.setBpm(rec.lastTempo);
      draw();
      // kartica tek kad je runda gotova (preko rezultata, nikad tokom sviranja)
      if (card) setTimeout(() => { if (api.running || document.body.classList.contains('trk-open')) showCard(card, { first: true }); }, 700);
      return false;
    },
    onChoice(choice, round, ctl) {
      if (choice === 'nextStep') {
        const i = PATH.findIndex((p) => p.id === sel.step);
        select(fromStep(PATH[Math.min(PATH.length - 1, i + 1)]));
        api.restart();
      } else ctl.close();
    },
    // „i“ na stazi: pauza + kartica trenutnog koraka/skale; zatvaranje → nastavak uz odbrojavanje
    onInfo(ctl) { ctl.hold(); showCard(cardNow(), { onClose: () => ctl.release() }); },
    onLevel: () => { shellReady = true; draw(); },
    demo: {
      bpm: 76,
      intro: t('sk.demo1'),
      items: () => patternNotes(9, 'minPent', 5, 'updown').slice(0, 9).map((n, i) => ({ kind: 'note', beat: i, s: n.s, f: n.f, finger: n.finger, root: n.root })),
      play: (it) => pluck(440 * Math.pow(2, (midiOf(it) - 69) / 12), { gain: 0.8, duration: 1.2, group: 'practice' }),
      early: (i) => i === 6,
      captions: { 0: t('sk.demo2'), 2: t('sk.demo3'), 5: t('sk.demo4'), 6: t('sk.demo5'), 8: t('sk.demo6') },
    },
  });

  draw();
  return game;
}
