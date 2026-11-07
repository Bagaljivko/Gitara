// „Pusti“: sviranje pesme zvukom gitare (snimljeni tonovi prave gitare, rezerva: fizički model žice — Karplus-Strong).
// Note zvone i preklapaju se kao na gitari (traju duže od zapisane dužine), akordi se udaraju po ritmu pesme.
// Zakazuje se po zvučnom satu (malo unapred), pa je ritam tačan i kad je ekran zauzet. Učitava se tek na „Pusti“.
//
// Mikrofon i zvuk nikad zajedno: kad igra uključi slušanje (događaj „gitara-mic“), svako sviranje odmah staje.
import { pluck, strum, audioCtx, stopGroup } from './synth.js';
import { createPlayerWith } from './songPlayerCore.js';
import { settings } from './db.js';
import { t } from './i18n.js';
import { useTabTexts } from './tabText.js';

useTabTexts();
const GROUP = 'songplay';
const live = new Set();
window.addEventListener('gitara-mic', () => { for (const p of [...live]) p.stop(); });
/** Zaustavi svako sviranje (npr. pre slušanja). */
export function stopAllPlayback() { for (const p of [...live]) p.stop(); }

/**
 * tl = { events, segs, parts, total } (songPlay.js). bpm = tempo pesme (četvrtine). rate 0,5–1.
 * onEnd() kad pesma (ili deo) završi. Vraća kontrolu sviranja.
 */
export function createPlayer(tl, { bpm = 80, rate = 1, onEnd } = {}) {
  let a4 = 440, iv = 0;
  settings.get('a4', 440).then((v) => { a4 = Number(v) || 440; }).catch(() => {});
  const freq = (m) => a4 * Math.pow(2, (m - 69) / 12);
  const core = createPlayerWith(tl, {
    bpm, rate, onEnd,
    ctx: () => audioCtx(),
    play: (e, when, secs) => {
      if (e.kind === 'note') pluck(freq(e.midi), { when, gain: e.s >= 4 ? 0.42 : e.s === 1 ? 0.58 : 0.4, duration: Math.min(4.5, secs * 1.5 + 0.9), group: GROUP });
      else strum(when, e.dir, { notes: e.freqs, mute: e.mute, accent: e.accent, group: GROUP });
    },
    silence: () => stopGroup(GROUP),
    onState: (on) => { clearInterval(iv); if (on) { live.add(core); iv = setInterval(core.tick, 40); } else live.delete(core); },
  });
  return core;
}

// ---------------- Traka za sviranje (ekran pesme) ----------------
const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>', PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
const SOUND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>';
const MUTED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zm15.6 3 2.1-2.1-1.4-1.4-2.1 2.1-2.1-2.1-1.4 1.4 2.1 2.1-2.1 2.1 1.4 1.4 2.1-2.1 2.1 2.1 1.4-1.4z"/></svg>';
let cssDone = false;
function css() {
  if (cssDone) return; cssDone = true;
  const st = document.createElement('style');
  st.textContent = `.scroll-bar.pl-host{flex-wrap:wrap}
.pl-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%}
.pl-bar .pl-rate{flex:1 1 90px;min-width:80px;accent-color:var(--accent)}
.pl-bar .pl-rv{font-variant-numeric:tabular-nums;min-width:3.2em;color:var(--muted);font-size:.85rem}
.pl-bar select{max-width:42%;padding:4px 6px;font-size:.85rem}
.pl-bar .pl-play.on{background:var(--accent);color:var(--accent-ink)}
.ch.playing{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px;background:var(--accent-soft)}
.ln.playing{background:linear-gradient(90deg,rgba(245,165,36,.08),transparent 70%);border-radius:6px}
.seg.sung .tx,.tx0.sung{color:var(--accent);font-weight:700}`;
  document.head.appendChild(st);
}

/**
 * Traka „Pusti“ u donjoj traci ekrana pesme. host = element trake; tl = događaji; onFrame(beat, segIndex, fired)
 * se zove ~30× u sekundi dok svira (isticanje i skrolovanje radi ekran). Vraća { player, startAt(beat), destroy }.
 */
export function mountPlayerBar(host, tl, { bpm, partLabel = (p) => p.name, allowMute = false, onFrame, onStop, onClose = null }) {
  css();
  const player = createPlayer(tl, { bpm, onEnd: () => { sync(); onStop?.(); } });
  const bar = document.createElement('div');
  bar.className = 'pl-bar';
  bar.innerHTML = `<button class="btn round small pl-play" aria-label="${t('play.play')}">${PLAY}</button>
    <input type="range" class="pl-rate" min="50" max="100" step="5" value="100" aria-label="${t('play.tempo')}"><span class="pl-rv">100%</span>
    ${tl.parts.length ? `<select class="pl-loop" aria-label="${t('play.loop')}"><option value="">${t('play.whole')}</option>${tl.parts.map((p, i) => `<option value="${i}">${t('play.loopPart', { p: partLabel(p) })}</option>`).join('')}</select>` : ''}
    ${allowMute ? `<button class="icon-btn pl-mute" aria-pressed="false" aria-label="${t('play.mute')}" title="${t('play.mute')}">${SOUND}</button>` : ''}
    ${onClose ? `<button class="icon-btn pl-x" aria-label="${t('common.close')}" title="${t('common.close')}">✕</button>` : ''}`;
  host.prepend(bar);
  const q = (s) => bar.querySelector(s);
  let raf = 0, seg = -1;
  const segAt = (b) => { let i = Math.max(0, seg); if (!tl.segs[i] || tl.segs[i].beat > b) i = 0; while (i + 1 < tl.segs.length && tl.segs[i + 1].beat <= b) i++; return i; };
  function frame() {
    raf = 0;
    if (!player.playing) return;
    const b = player.beat;
    seg = segAt(b);
    onFrame?.(b, seg, player.drain());
    raf = requestAnimationFrame(frame);
  }
  function sync() {
    const on = player.playing;
    q('.pl-play').innerHTML = on ? PAUSE : PLAY;
    q('.pl-play').classList.toggle('on', on);
    q('.pl-play').setAttribute('aria-label', t(on ? 'play.pause' : 'play.play'));
    if (on && !raf) raf = requestAnimationFrame(frame);
  }
  q('.pl-play').addEventListener('click', () => {
    if (player.playing) { player.pause(); onStop?.(); } else { if (player.pos >= tl.total - 1e-3) player.pos = 0; player.play(); }
    sync();
  });
  q('.pl-rate').addEventListener('input', (e) => { const v = +e.target.value; q('.pl-rv').textContent = v + '%'; player.setRate(v / 100); });
  q('.pl-loop')?.addEventListener('change', (e) => { const p = e.target.value === '' ? null : tl.parts[+e.target.value]; player.setLoop(p); if (p && !player.playing) { player.pos = p.from; } sync(); });
  q('.pl-mute')?.addEventListener('click', (e) => { const m = !player.muted; player.setMute(m); e.currentTarget.innerHTML = m ? MUTED : SOUND; e.currentTarget.setAttribute('aria-pressed', String(m)); });
  q('.pl-x')?.addEventListener('click', () => onClose());
  // mikrofon uključen negde (igra) → sviranje staje; i traka to pokaže
  const onMic = () => { sync(); onStop?.(); };
  window.addEventListener('gitara-mic', onMic);
  return {
    player,
    /** Sviraj od ove dobe (dodir na takt / red / akord). */
    startAt(beat) { player.stop(); player.play(beat); seg = -1; sync(); },
    get playing() { return player.playing; },
    destroy() { player.destroy(); cancelAnimationFrame(raf); window.removeEventListener('gitara-mic', onMic); bar.remove(); },
  };
}

/** Jednom, deo pesme (Vežbe → „Poslušaj“): od..do (dobe) u datom tempu. Vraća player (stop()). */
export function playOnce(tl, { bpm, from = 0, to = tl.total, onEnd }) {
  const p = createPlayer(tl, { bpm, onEnd });
  p.play(from, { until: to });
  return p;
}
