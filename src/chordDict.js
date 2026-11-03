// Tab "Akordi" → "Rečnik": izaberi osnovni ton i vrstu akorda, vidi hvat i čuj kako zvuči.
import { t } from './i18n.js';
import { chordSVG } from './diagram.js';
import { getVoicings } from './chords.js';
import { QUALITIES, parseChord, pcName } from './music.js';
import { pluck, audioCtx } from './synth.js';
import { esc } from './ui.js';
import { dn } from './naming.js';

const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const QUALS = ['', 'm', '7', 'm7', 'maj7', 'sus2', 'sus4', 'add9', '6', 'm6', '9', 'dim', 'aug'];
const OPEN_MIDI = [40, 45, 50, 55, 59, 64]; // E A D G B e

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

/** Odsviraj hvat kao blagi trzaj odozdo nagore. */
export function playVoicing(v) {
  if (!v) return;
  const ctx = audioCtx();
  const t0 = ctx.currentTime + 0.03;
  let k = 0;
  v.frets.forEach((f, i) => {
    if (f < 0) return;
    const midi = OPEN_MIDI[i] + f;
    pluck(440 * Math.pow(2, (midi - 69) / 12), { when: t0 + k++ * 0.028 + Math.random() * 0.004, gain: 0.6, duration: 3 });
  });
}

export function createChordDict(root) {
  let rootName = localGet('gitara-dict-root') || 'C';
  let qual = localGet('gitara-dict-q') ?? '';
  if (!ROOTS.includes(rootName)) rootName = 'C';
  if (!QUALS.includes(qual)) qual = '';
  let voicing = 0;

  root.innerHTML = `
    <p class="muted">${t('dict.intro')}</p>
    <div class="dict-roots" role="radiogroup" aria-label="${t('dict.root')}">
      ${ROOTS.map((r) => `<button role="radio" class="chip" data-r="${r}">${esc(dn(r))}</button>`).join('')}
    </div>
    <div class="dict-quals chips" role="radiogroup" aria-label="${t('dict.quality')}">
      ${QUALS.map((q) => `<button role="radio" class="chip" data-q="${q}">${esc(q === '' ? t('q.') : q === 'm' ? t('q.m') : q)}</button>`).join('')}
    </div>
    <div class="card dict-card">
      <div class="dict-name" id="dName"></div>
      <div class="dict-sub muted small" id="dSub"></div>
      <div class="chord-big" id="dDiagram"></div>
      <div class="dict-actions">
        <button class="btn primary" id="dPlay">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>${t('dict.play')}</button>
        <button class="btn" id="dNext"></button>
      </div>
    </div>`;
  const $ = (id) => root.querySelector('#' + id);

  function draw() {
    const name = rootName + qual;
    const list = getVoicings(name);
    const n = list.length;
    const v = list[voicing % Math.max(n, 1)];
    root.querySelectorAll('[data-r]').forEach((b) => { const on = b.dataset.r === rootName; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });
    root.querySelectorAll('[data-q]').forEach((b) => { const on = b.dataset.q === qual; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); });
    $('dName').textContent = dn(name);
    const p = parseChord(name);
    const notes = p ? QUALITIES[qual].intervals.map((iv) => dn(pcName((p.root + iv) % 12, { flat: /b/.test(rootName) || ['Eb', 'Ab', 'Bb'].includes(rootName) }))) : [];
    $('dSub').textContent = `${t('q.' + qual)} · ${t('dict.notes')}: ${notes.join(' – ')}${v && v.approx ? ' · ' + t('dict.approx') : ''}`;
    $('dDiagram').innerHTML = chordSVG(name, { voicing, showName: false });
    $('dNext').hidden = n < 2;
    $('dNext').textContent = t('chordModal.next', { i: (voicing % Math.max(n, 1)) + 1, n });
    $('dPlay').disabled = !v;
  }

  root.addEventListener('click', (e) => {
    const r = e.target.closest('[data-r]'), q = e.target.closest('[data-q]');
    if (r) { rootName = r.dataset.r; voicing = 0; localSet('gitara-dict-root', rootName); draw(); }
    else if (q) { qual = q.dataset.q; voicing = 0; localSet('gitara-dict-q', qual); draw(); }
  });
  $('dNext').addEventListener('click', () => { voicing++; draw(); playVoicing(getVoicings(rootName + qual)[voicing % getVoicings(rootName + qual).length]); });
  $('dPlay').addEventListener('click', () => { const l = getVoicings(rootName + qual); playVoicing(l[voicing % Math.max(l.length, 1)]); });
  draw();
  return { stop() {} };
}
