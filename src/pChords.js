// Vežbe → „Promena akorda“: dva akorda, menjaju se u ritmu (svaka 2 otkucaja ili svaki takt).
// Na svaku promenu udari akord; čista promena = na vreme + čuje se većina tonova novog akorda
// (blaga provera, radi i sa mikrofonom telefona). Runda traje minut: rezultat je i „čistih promena u minuti“.
import { Metronome } from './rhythm.js';
import { chordSVG } from './diagram.js';
import { dn } from './naming.js';
import { esc } from './ui.js';
import { judgeTiming } from './practiceListen.js';

export const PAIRS = [['Em', 'G'], ['G', 'C'], ['C', 'Am'], ['D', 'A'], ['G', 'D'], ['Am', 'E'], ['C', 'F']];
const CHOICES = ['C', 'D', 'E', 'F', 'G', 'A', 'Am', 'Dm', 'Em', 'A7', 'D7', 'E7', 'G7', 'C7', 'B7', 'Fmaj7', 'Cadd9', 'Dsus4', 'Asus2'];
const ROUND_MS = 60000;

export function createGame(api) {
  const { t } = api;
  const load = () => { try { return JSON.parse(localStorage.getItem('gitara-pr-promena') || 'null'); } catch { return null; } };
  const saved = load() || {};
  let pair = Array.isArray(saved.pair) && saved.pair.length === 2 ? saved.pair : PAIRS[0];
  let every = saved.every === 4 ? 4 : 2;
  const save = () => { try { localStorage.setItem('gitara-pr-promena', JSON.stringify({ pair, every })); } catch {} };
  const key = (p) => p.join('-');

  function drawOpts() {
    const custom = !PAIRS.some((p) => key(p) === key(pair));
    api.opts.innerHTML = `<div class="pr-optlabel">${t('pr.promena.pairs')}</div>
      <div class="pr-chips">${PAIRS.map((p) => `<button class="chip${key(p) === key(pair) ? ' active' : ''}" data-p="${key(p)}">${esc(dn(p[0]))} – ${esc(dn(p[1]))}</button>`).join('')}
        <button class="chip${custom ? ' active' : ''}" data-own="1">${t('pr.promena.own')}</button></div>
      <div class="pr-own" ${custom ? '' : 'hidden'}>
        ${[0, 1].map((i) => `<select data-i="${i}" aria-label="${t('pr.promena.chord', { n: i + 1 })}">${CHOICES.map((c) => `<option value="${c}"${c === pair[i] ? ' selected' : ''}>${esc(dn(c))}</option>`).join('')}</select>`).join('<span>–</span>')}
      </div>
      <div class="pr-optlabel">${t('pr.promena.when')}</div>
      <div class="seg-tabs" role="radiogroup">
        <button role="radio" data-e="2" class="${every === 2 ? 'active' : ''}">${t('pr.promena.every2')}</button>
        <button role="radio" data-e="4" class="${every === 4 ? 'active' : ''}">${t('pr.promena.every4')}</button>
      </div>`;
  }
  drawOpts();
  api.opts.addEventListener('click', (e) => {
    const p = e.target.closest('[data-p]'), own = e.target.closest('[data-own]'), ev = e.target.closest('[data-e]');
    if (p) { pair = p.dataset.p.split('-'); save(); drawOpts(); drawStage(0); }
    if (own) { api.opts.querySelector('.pr-own').hidden = false; api.opts.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === own)); }
    if (ev) { every = +ev.dataset.e; save(); drawOpts(); }
  });
  api.opts.addEventListener('change', (e) => {
    const s = e.target.closest('select[data-i]');
    if (!s) return;
    const np = pair.slice(); np[+s.dataset.i] = s.value;
    if (np[0] === np[1]) return;
    pair = np; save(); drawStage(0);
  });

  api.stage.innerHTML = `<div class="pc-pair" id="pcPair"></div><div class="small muted" id="pcCount"></div>`;
  const $ = (id) => api.stage.querySelector('#' + id);
  function drawStage(cur) {
    $('pcPair').innerHTML = pair.map((c, i) => `<div class="pc-ch${i === cur ? ' target' : ''}"><div class="chord-big">${chordSVG(c)}</div></div>`).join('<span class="pc-arrow" aria-hidden="true">⇄</span>');
  }
  const setCur = (cur) => $('pcPair').querySelectorAll('.pc-ch').forEach((x, i) => x.classList.toggle('target', i === cur));
  drawStage(0);
  api.feedback('info', t('pr.promena.ready'));

  let met = null, changes = [], onsets = [], t0 = 0, listener = null, beatN = 0, done = false;

  function judge(c) {
    if (c.done) return;
    c.done = true;
    const beatMs = 60000 / api.bpm;
    let best = null;
    for (const o of onsets) if (Math.abs(o.at - c.at) <= beatMs * 0.45 && (!best || Math.abs(o.at - c.at) < Math.abs(best.at - c.at))) best = o;
    if (!best) { c.clean = false; api.feedback('miss', t('pr.missed')); return; }
    const tm = judgeTiming(best.at - c.at, beatMs);
    const res = best.heard || null, want = res ? res[c.chord] : null, other = res ? res[pair.find((x) => x !== c.chord)] : null;
    // blaga provera: većina tonova akorda; ako drugi akord iz para „pristaje“ bolje — to je bio on
    const chordOk = want && want.ok && !(other && other.ok && other.share > want.share + 0.08);
    c.clean = chordOk && tm.kind !== 'off';
    api.feedback(c.clean ? (tm.kind === 'hit' ? 'hit' : tm.kind) : 'miss',
      !chordOk ? t('pr.promena.notClear', { c: dn(c.chord) }) : tm.kind === 'hit' ? t('pr.promena.clean') : tm.kind === 'off' ? t('pr.offBeat') : t(tm.kind === 'early' ? 'pr.early' : 'pr.late', { ms: Math.round(Math.abs(best.at - c.at)) }));
  }

  return {
    bpm: { start: 60, min: 40, max: 160, step: 5 },
    async start(bpm) {
      changes = []; onsets = []; beatN = 0; done = false;
      listener = await api.listen({
        chords: true,
        // akord se proverava ~0,35 s posle udarca (dok se tonovi „skupe“)
        onOnset: (o) => {
          const rec = { at: o.at, heard: null };
          onsets.push(rec);
          // oba akorda iz para se proveravaju; koji je bio na redu odlučuje se pri oceni
          setTimeout(() => { if (listener) rec.heard = { [pair[0]]: listener.chordHeard(pair[0]), [pair[1]]: listener.chordHeard(pair[1]) }; }, 350);
        },
      });
      met = new Metronome();
      met.bpm = bpm; met.sig = '4/4'; met.countIn = 1;
      met.onStep = (slot, beat, accent, info) => {
        if (beat == null) return;
        api.pulse(beat, 4, beat === 0);
        if (info.countIn) { api.feedback('', String(4 - info.countBeat)); return; }
        if (!t0) t0 = info.at;
        if (info.at - t0 >= ROUND_MS) { if (!done) { done = true; met.stop(); setTimeout(finish, 700); } return; }
        if (beatN % every === 0) {
          const idx = (beatN / every) % 2, c = { at: info.at, chord: pair[idx], done: false };
          changes.push(c);
          setCur((idx + 1) % 2); // sledeći akord već svetli — pripremi prste
          setTimeout(() => api.running && judge(c), (60000 / api.bpm) * 0.45 + 420);
          $('pcCount').textContent = t('pr.promena.left', { s: Math.max(0, Math.ceil((ROUND_MS - (info.at - t0)) / 1000)) });
        }
        beatN++;
      };
      t0 = 0;
      setCur(0);
      met.start();
      api.onCleanup(() => met?.stop());
    },
    stop() { met?.stop(); met = null; listener = null; setCur(0); $('pcCount').textContent = ''; },
  };

  function finish() {
    if (!api.running) return;
    changes.forEach(judge);
    const n = changes.length || 1, clean = changes.filter((c) => c.clean).length;
    const perMin = Math.round(clean * 60000 / ROUND_MS);
    listener = null;
    api.finish({ score: (clean / n) * 100, tempo: api.bpm, accuracy: clean / n, extra: { label: t('pr.promena.perMin'), value: perMin } });
  }
}
