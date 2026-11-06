// Izbor ritma (strumming) za pesmu ili deo pesme — panel odozdo:
//  • kartice: strelice su glavne, kratak naziv, težina; dodir = odmah svira (u petlji), „Izaberi“ potvrđuje
//  • filter po taktu (4/4 · 3/4 · 6/8 · 2/4) i „Moji ritmovi“ (sačuvani sopstveni, sinhronizuju se)
//  • „Napravi svoj“: polja ispod „1 i 2 i …“, dodir menja ↓ → ↑ → ✕ → · ; svira u petlji dok se menja;
//    može da se upiše/nalepi kao tekst („D DU UDU“) ili otkuca palcem (prevlačenje dole/gore uz klik)
import { esc } from './ui.js';
import { t } from './i18n.js';
import { PATTERNS, SIGNATURES, Metronome, patternName, countLabels, arrowOf, cleanPattern, slotsPerBeatOf } from './rhythm.js';
import { settings } from './db.js';

const SIGS = ['4/4', '3/4', '6/8', '2/4'];
const GROUPS = ['basic', 'pop', 'ballad', 'rock', 'country', 'blues', 'latin', 'reggae', 'funk', 'waltz'];
const CYCLE = { '-': 'D', D: 'U', U: 'x', x: 'B', B: '-' };
export const slotsOf = (sig, sixteen = false) => { const s = SIGNATURES[sig] || SIGNATURES['4/4']; return s.beats * (sixteen && sig === '4/4' ? 4 : s.slotsPerBeat); };
const shortName = (p) => (p.id && t('patS.' + p.id) !== 'patS.' + p.id ? t('patS.' + p.id) : p.name || t('pat.custom'));
const same = (a, b) => !!a && !!b && a.sig === b.sig && a.steps === b.steps && !!a.swing === !!b.swing;

/** Tekst („D DU UDU“, „↓ ↓↑ ↑↓↑“, „D-DU-UDU“, „d x d u“) → koraci; jedan znak = jedna osmina, razmak = pauza. */
export function parseStrumText(txt, sig = null) {
  const map = { D: 'D', d: 'D', '↓': 'D', V: 'D', v: 'D', U: 'U', u: 'U', '↑': 'U', '^': 'U', X: 'x', x: 'x', '✕': 'x', '×': 'x', B: 'B', b: 'B' };
  let s = String(txt || '').replace(/\s+$/, '').replace(/^\s+/, '');
  if (!s) return null;
  let steps = [...s].map((ch) => map[ch] || '-').join('');
  if (!/[DUxB]/.test(steps)) return null;
  if (steps.length > 8 && steps.length <= 16 && (!sig || sig === '4/4')) { steps = (steps + '-'.repeat(16)).slice(0, 16); return { sig: '4/4', steps, fit: true, sixteen: true }; }
  let useSig = sig;
  if (!useSig || steps.length !== slotsOf(useSig)) {
    // takt po dužini: 16 → 4/4 šesnaestine, 8 → 4/4, 6 → 3/4 (ili 6/8 ako je već izabran), 4 → 2/4; inače zadrži izabrani
    if (steps.length === 8) useSig = '4/4';
    else if (steps.length === 6) useSig = sig === '6/8' ? '6/8' : '3/4';
    else if (steps.length === 4) useSig = '2/4';
    else useSig = sig || '4/4';
  }
  const n = slotsOf(useSig);
  const fit = steps.length === n;
  steps = (steps + '-'.repeat(n)).slice(0, n);
  return { sig: useSig, steps, fit };
}

/** Udarci palcem (vreme + smer) → koraci na mreži osmina; slots: [{ at, i, bar }] trenuci kad se čuje svako mesto. */
export function quantizeTaps(taps, slots, n) {
  const out = Array(n).fill('-');
  if (!slots.length) return out.join('');
  const dur = slots.length > 1 ? (slots[slots.length - 1].at - slots[0].at) / (slots.length - 1) : 300;
  const votes = Array.from({ length: n }, () => ({ D: 0, U: 0, x: 0 }));
  for (const tp of taps) {
    let best = null, bd = Infinity;
    for (const s of slots) { const d = Math.abs(s.at - tp.at); if (d < bd) { bd = d; best = s; } }
    if (best && bd <= dur * 0.5) votes[best.i][tp.dir] += 1;
  }
  votes.forEach((v, i) => { const top = Object.entries(v).sort((a, b) => b[1] - a[1])[0]; if (top[1] > 0) out[i] = top[0]; });
  return out.join('');
}

export async function myRhythms() {
  const l = await settings.get('myRhythms', []);
  return (Array.isArray(l) ? l : []).map((x) => { const c = cleanPattern(x); return c && typeof x.id === 'string' ? { ...c, id: undefined, my: x.id.slice(0, 40), name: c.name || t('pat.custom') } : null; }).filter(Boolean);
}
async function saveMy(p) {
  const l = (await settings.get('myRhythms', [])) || [];
  const id = 'my-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await settings.set('myRhythms', [...l.filter((x) => !(x.sig === p.sig && x.steps === p.steps && !!x.swing === !!p.swing)), { id, name: p.name, sig: p.sig, steps: p.steps, ...(p.swing ? { swing: true } : {}) }].slice(-60));
}
async function removeMy(id) {
  const l = (await settings.get('myRhythms', [])) || [];
  await settings.set('myRhythms', l.filter((x) => x.id !== id));
}

const patHTML = (p, cls = '') => {
  const c = countLabels(p);
  return `<div class="pattern ${cls}${p.steps.length > 8 ? ' p16' : ''}" aria-label="${esc(p.steps)}">${[...p.steps].map((s, i) => `<span class="pstep s-${s === '-' ? 'rest' : s}" data-i="${i}"><b>${arrowOf(s)}</b><i>${c[i]}</i></span>`).join('')}</div>`;
};

/**
 * Otvara izbor ritma. current: trenutni obrazac (ili null); inherit: deo pesme (nudi „Kao cela pesma“).
 * Vraća { pattern } | { none: true } | { inherit: true } | null (odustao).
 */
export function openRhythmPicker({ current = null, title = '', inherit = false, bpm = 90 } = {}) {
  return new Promise(async (resolve) => {
    const mine = await myRhythms();
    const met = new Metronome();
    met.bpm = Math.max(50, Math.min(140, bpm || 90));
    met.clicks = false;
    let filter = current && SIGS.includes(current.sig) ? current.sig : 'all';
    if (current && !current.id && mine.some((m) => same(m, current))) filter = 'mine';
    let sel = current ? { ...current } : null;
    let view = 'list';
    let draft = null; // napravi svoj: { sig, steps, name }
    let playingScope = null;

    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop sheet-backdrop rp-backdrop';
    wrap.innerHTML = `<div class="sheet rp-sheet" role="dialog" aria-modal="true" aria-label="${esc(title || t('strum.title'))}"><div class="sheet-grip"></div><div class="rp-in"></div></div>`;
    const box = wrap.querySelector('.rp-in');
    const stop = () => { met.stop(); playingScope = null; wrap.querySelectorAll('.pstep.now').forEach((x) => x.classList.remove('now')); wrap.querySelectorAll('.rp-card.playing, .rp-play.playing').forEach((x) => x.classList.remove('playing')); };
    const play = (p, scopeSel) => {
      stop();
      if (!p || !/[DUxB]/.test(p.steps)) return;
      met.sig = p.sig; met.pattern = p; met.maxBars = 0; met.countIn = 0; met.onEnd = null;
      playingScope = scopeSel;
      met.onStep = (i) => {
        const sc = wrap.querySelector(playingScope);
        if (!sc) return;
        sc.querySelectorAll('.pstep.now').forEach((x) => x.classList.remove('now'));
        sc.querySelector(`.pstep[data-i="${i}"]`)?.classList.add('now');
      };
      met.start();
    };
    const done = (v) => { stop(); wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    wrap.__close = () => done(null);

    // ---------- lista kartica ----------
    const list = () => {
      const lib = libNow;
      const tabs = ['all', ...SIGS.filter((s) => PATTERNS.some((p) => p.sig === s) || mine.some((m) => m.sig === s)), ...(mine.length ? ['mine'] : [])];
      return `<div class="rp-head"><h2 class="sheet-title">${esc(title || t('strum.title'))}</h2>
        <div class="seg-tabs rp-tabs" role="tablist">${tabs.map((k) => `<button role="tab" class="${k === filter ? 'on' : ''}" data-f="${k}" aria-selected="${k === filter}">${k === 'all' ? t('rp.all') : k === 'mine' ? t('rp.mine') : k}</button>`).join('')}</div>
        <div class="rp-opts">
          ${inherit ? `<button class="rp-chip${sel && sel.inherit ? ' on' : ''}" data-special="inherit">${t('rp.inherit')}</button>` : ''}
          <button class="rp-chip${sel && sel.none ? ' on' : ''}" data-special="none">${t('strum.none')}</button>
        </div></div>
        <div class="rp-grid">${lib.length ? lib.map((p, k) => {
          const on = sel && same(sel, p);
          const lv = p.lv || 0;
          const head = filter !== 'mine' && p.g && (k === 0 || lib[k - 1].g !== p.g) ? `<h3 class="rp-group">${t('rpg.' + p.g)}</h3>` : '';
          return `${head}<div class="rp-card${on ? ' on' : ''}${p.steps.length > 8 ? ' rp-wide' : ''}" data-k="${k}" role="button" tabindex="0" aria-pressed="${on}">
            <div class="rp-card-top"><b>${esc(shortName(p))}</b>${p.swing ? `<span class="rp-tag">${t('rp.swing')}</span>` : ''}${p.steps.length > 8 ? `<span class="rp-tag">${t('rp.sixteenTag')}</span>` : ''}<span class="rp-sig">${p.sig}</span>${p.my ? `<button class="icon-btn rp-del" data-del="${esc(p.my)}" aria-label="${t('common.delete')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button>` : ''}</div>
            ${patHTML(p, 'rp-pat')}
            <div class="rp-card-bot">${lv ? `<span class="rp-lv" aria-label="${t('rp.level' + lv)}">${'●'.repeat(lv)}${'○'.repeat(3 - lv)}</span>` : '<span></span>'}<span class="rp-hear">${on ? t('rp.selected') : t('rp.tapHear')}</span></div>
          </div>`;
        }).join('') : `<p class="small muted rp-empty">${t('rp.mineEmpty')}</p>`}</div>
        <div class="rp-bar">
          <button class="btn" data-act="build">${t('rp.build')}</button>
          <button class="btn primary" data-act="pick"${sel ? '' : ' disabled'}>${t('rp.pick')}</button>
        </div>`;
    };
    const ordered = () => PATTERNS.map((p, i) => ({ p, i })).sort((a, b) => (GROUPS.indexOf(a.p.g) - GROUPS.indexOf(b.p.g)) || (a.i - b.i)).map((x) => x.p);
    let libNow = [];
    const drawList = () => {
      view = 'list';
      libNow = filter === 'mine' ? mine : ordered().filter((p) => filter === 'all' || p.sig === filter);
      box.innerHTML = list();
      const on = box.querySelector('.rp-card.on');
      if (on) on.scrollIntoView({ block: 'nearest' });
    };

    // ---------- napravi svoj ----------
    const drawBuild = () => {
      view = 'build';
      const p = draft;
      const c = countLabels(p);
      box.innerHTML = `<h2 class="sheet-title">${t('rp.buildTitle')}</h2>
        <div class="seg-tabs rp-tabs rp-sigs" role="tablist">${SIGS.map((s) => `<button role="tab" class="${s === p.sig ? 'on' : ''}" data-sig="${s}">${s}</button>`).join('')}</div>
        <div class="rp-opts rp-feel">
          ${p.sig === '4/4' ? `<button class="rp-chip${p.steps.length === 16 ? ' on' : ''}" data-feel="sixteen" aria-pressed="${p.steps.length === 16}">${t('rp.sixteen')}</button>` : ''}
          ${slotsPerBeatOf(p) === 2 && p.sig !== '6/8' ? `<button class="rp-chip${p.swing ? ' on' : ''}" data-feel="swing" aria-pressed="${!!p.swing}">${t('rp.swingOpt')}</button>` : ''}
        </div>
        <p class="small muted rp-help">${t('rp.cellHelp')}</p>
        <div class="rp-cells pattern${p.steps.length > 8 ? ' p16' : ''}" style="--n:${p.steps.length}">${[...p.steps].map((s, i) => `<button class="pstep rp-cell s-${s === '-' ? 'rest' : s}" data-cell="${i}" aria-label="${c[i]}: ${t('rp.s' + (s === '-' ? 'rest' : s))}"><b>${arrowOf(s)}</b><i>${c[i]}</i></button>`).join('')}</div>
        <div class="rp-row">
          <button class="icon-btn rp-play${playingScope === '.rp-cells' ? ' playing' : ''}" data-act="bplay" aria-label="${t('pat.play')}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
          <button class="btn small" data-act="tap"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11.2V7.5a1.5 1.5 0 0 1 3 0v4.7l3.8.7a2 2 0 0 1 1.6 2.3l-.8 4.6A2 2 0 0 1 14.6 21H10a2 2 0 0 1-1.6-.8l-3.1-4.1 1-1a1.5 1.5 0 0 1 2-.1l.7.6V11.2z"/></svg> ${t('rp.tapIn')}</button>
          <button class="btn small" data-act="clear">${t('rp.clear')}</button>
        </div>
        <label class="rp-text"><span class="small muted">${t('rp.typeLabel')}</span>
          <input id="rpText" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${t('rp.typePh')}" value="${esc(p.steps.replace(/-/g, ' ').toUpperCase().replace(/X/g, 'x'))}"></label>
        <p class="small rp-fit" id="rpFit" hidden></p>
        <label class="rp-text"><span class="small muted">${t('rp.nameLabel')}</span>
          <input id="rpName" type="text" maxlength="40" autocomplete="off" placeholder="${esc(t('rp.namePh'))}" value="${esc(p.name || '')}"></label>
        <div class="rp-bar">
          <button class="btn" data-act="back">${t('rp.back')}</button>
          <button class="btn primary" data-act="save"${/[DUxB]/.test(p.steps) ? '' : ' disabled'}>${t('rp.saveUse')}</button>
        </div>`;
    };
    const refreshCells = () => {
      const keepPlay = playingScope === '.rp-cells';
      const f = box.querySelector('#rpText');
      const focus = document.activeElement === f;
      const pos = focus ? f.selectionStart : 0;
      const name = box.querySelector('#rpName')?.value;
      if (name !== undefined) draft.name = name;
      drawBuild();
      if (focus) { const g = box.querySelector('#rpText'); g.focus(); try { g.setSelectionRange(pos, pos); } catch {} }
      if (keepPlay && /[DUxB]/.test(draft.steps)) { met.pattern = { ...draft }; met.sig = draft.sig; playingScope = '.rp-cells'; box.querySelector('.rp-play')?.classList.add('playing'); if (!met.running) play({ ...draft }, '.rp-cells'); }
      else if (keepPlay) stop();
    };

    // ---------- otkucaj palcem ----------
    const drawTap = () => {
      view = 'tap';
      stop();
      const sig = draft.sig, n = draft.steps.length || slotsOf(sig), sp = SIGNATURES[sig];
      box.innerHTML = `<h2 class="sheet-title">${t('rp.tapTitle')}</h2>
        <p class="small muted">${t('rp.tapHelp', { sig })}</p>
        <div class="rp-count" aria-live="polite"><span id="rpBeat">${t('rp.tapReady')}</span></div>
        <div class="rp-pad" id="rpPad" role="button" aria-label="${t('rp.padLabel')}"><span>↓ ↑</span><small>${t('rp.padHint')}</small></div>
        <div class="rp-bar"><button class="btn" data-act="tapback">${t('common.cancel')}</button><button class="btn primary" data-act="tapgo">${t('rp.tapStart')}</button></div>`;
      const taps = [], slots = [];
      let rec = false, startY = 0, startAt = 0;
      const pad = box.querySelector('#rpPad');
      pad.addEventListener('pointerdown', (e) => { startY = e.clientY; startAt = performance.now(); pad.classList.add('hit'); try { pad.setPointerCapture(e.pointerId); } catch {} });
      pad.addEventListener('pointerup', (e) => {
        pad.classList.remove('hit');
        if (!rec) return;
        const dy = e.clientY - startY;
        taps.push({ at: startAt, dir: dy < -18 ? 'U' : 'D' });
      });
      box.querySelector('[data-act="tapgo"]').addEventListener('click', () => {
        const go = box.querySelector('[data-act="tapgo"]'); go.disabled = true;
        const m2 = met;
        m2.sig = sig; m2.pattern = { sig, steps: '-'.repeat(n), swing: draft.swing }; m2.clicks = true; m2.countIn = 1; m2.maxBars = 2; // tihi obrazac = mreža osmina/šesnaestina
        m2.onStep = (i, beat, accent, info) => {
          const el = box.querySelector('#rpBeat');
          if (info.countIn) { if (beat !== null && el) el.textContent = String(sp.beats - beat); return; }
          rec = true;
          slots.push({ at: info.at, i, bar: info.bar });
          if (el && beat !== null) el.textContent = t('rp.tapNow', { b: beat + 1, bar: info.bar + 1 });
        };
        m2.onEnd = () => {
          rec = false; m2.clicks = false;
          const steps = quantizeTaps(taps, slots, n);
          draft = { ...draft, steps };
          drawBuild();
          if (/[DUxB]/.test(steps)) play({ ...draft }, '.rp-cells');
          box.querySelector('.rp-play')?.classList.toggle('playing', /[DUxB]/.test(steps));
          const fit = box.querySelector('#rpFit'); fit.hidden = false; fit.textContent = /[DUxB]/.test(steps) ? t('rp.tapDone') : t('rp.tapNone');
        };
        m2.start();
      });
    };

    // ---------- dodiri ----------
    wrap.addEventListener('click', async (e) => {
      if (!e.target.closest('.sheet')) return done(null);
      const f = e.target.closest('[data-f]');
      if (f) { filter = f.dataset.f; stop(); drawList(); return; }
      const del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        await removeMy(del.dataset.del);
        const k = mine.findIndex((m) => m.my === del.dataset.del);
        if (k >= 0) { if (sel && same(sel, mine[k])) sel = null; mine.splice(k, 1); }
        if (!mine.length && filter === 'mine') filter = 'all';
        stop(); drawList(); return;
      }
      const sp = e.target.closest('[data-special]');
      if (sp) { stop(); sel = sp.dataset.special === 'none' ? { none: true } : { inherit: true }; drawList(); return; }
      const card = e.target.closest('.rp-card');
      if (card) {
        const p = libNow[+card.dataset.k];
        if (!p) return;
        const again = sel && same(sel, p) && playingScope;
        sel = { ...p };
        drawList();
        if (again) { stop(); return; } // drugi dodir na karticu koja svira: tišina
        const k = card.dataset.k;
        play(p, `.rp-card[data-k="${k}"]`);
        wrap.querySelector(`.rp-card[data-k="${k}"]`)?.classList.add('playing');
        return;
      }
      const a = e.target.closest('[data-act]');
      if (!a) {
        const cell = e.target.closest('[data-cell]');
        if (cell && view === 'build') {
          const i = +cell.dataset.cell, s = [...draft.steps];
          s[i] = CYCLE[s[i]] || 'D';
          draft = { ...draft, steps: s.join('') };
          refreshCells();
        }
        return;
      }
      const act = a.dataset.act;
      if (act === 'pick') {
        if (!sel) return;
        if (sel.none) return done({ none: true });
        if (sel.inherit) return done({ inherit: true });
        const c = cleanPattern(sel);
        return done(c ? { pattern: c } : null);
      }
      if (act === 'build') {
        stop();
        const base = sel && !sel.none && !sel.inherit ? sel : { sig: filter !== 'all' && filter !== 'mine' ? filter : '4/4' };
        draft = { sig: base.sig, steps: base.steps || '-'.repeat(slotsOf(base.sig)), swing: base.swing || undefined, name: base.my ? base.name : '' };
        drawBuild();
        if (/[DUxB]/.test(draft.steps)) { play({ ...draft }, '.rp-cells'); box.querySelector('.rp-play')?.classList.add('playing'); }
        return;
      }
      if (act === 'bplay') {
        if (playingScope === '.rp-cells') { stop(); return; }
        play({ ...draft }, '.rp-cells'); a.classList.add('playing'); return;
      }
      if (act === 'clear') { draft = { ...draft, steps: '-'.repeat(draft.steps.length) }; stop(); refreshCells(); return; }
      if (act === 'back') { stop(); drawList(); return; }
      if (act === 'tap') { draft.name = box.querySelector('#rpName')?.value || draft.name; drawTap(); return; }
      if (act === 'tapback') { stop(); met.clicks = false; drawBuild(); return; }
      if (act === 'save') {
        const name = (box.querySelector('#rpName')?.value || '').trim() || t('rp.myN', { n: mine.length + 1 });
        const c = cleanPattern({ sig: draft.sig, steps: draft.steps, swing: !!draft.swing, name });
        if (!c) return;
        await saveMy(c);
        return done({ pattern: c });
      }
    });
    wrap.addEventListener('click', (e) => {
      const s = e.target.closest('[data-sig]');
      if (!s || view !== 'build') return;
      const sig = s.dataset.sig, n = slotsOf(sig);
      const base = draft.steps.length === 16 ? [...draft.steps].filter((_, i) => i % 2 === 0).join('') : draft.steps;
      draft = { ...draft, sig, swing: sig === '6/8' ? undefined : draft.swing, steps: (base + '-'.repeat(n)).slice(0, n) };
      refreshCells();
    });
    wrap.addEventListener('click', (e) => {
      const f = e.target.closest('[data-feel]');
      if (!f || view !== 'build') return;
      if (f.dataset.feel === 'sixteen') {
        // osmine ↔ šesnaestine: svaka osmina postaje osmina + pauza (i nazad: uzmu se mesta na osmini)
        const st = draft.steps.length === 16 ? [...draft.steps].filter((_, i) => i % 2 === 0).join('') : [...draft.steps].map((x) => x + '-').join('');
        draft = { ...draft, steps: st, swing: undefined };
      } else draft = { ...draft, swing: draft.swing ? undefined : true };
      refreshCells();
    });
    wrap.addEventListener('input', (e) => {
      if (e.target.id !== 'rpText' || view !== 'build') return;
      const r = parseStrumText(e.target.value, draft.sig);
      const fit = box.querySelector('#rpFit');
      if (!r) { fit.hidden = !e.target.value.trim(); fit.textContent = t('rp.typeBad'); return; }
      const keep = e.target.value;
      draft = { ...draft, sig: r.sig, steps: r.steps, swing: r.steps.length === slotsOf(r.sig) && slotsPerBeatOf(r) === 2 ? draft.swing : undefined };
      refreshCells();
      const g = box.querySelector('#rpText'); g.value = keep;
      const f2 = box.querySelector('#rpFit');
      f2.hidden = r.fit; f2.textContent = t('rp.typeFit', { n: r.steps.length, sig: r.sig });
    });
    wrap.addEventListener('keydown', (e) => {
      const card = e.target.closest && e.target.closest('.rp-card');
      if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); card.click(); }
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    drawList();
  });
}
