// Podešavanja tunera — isti sadržaj na dva mesta: panel na samom tuneru (ikonica klizača) i Podešavanja.
// Štimovanje, soba (Auto / Tiha / Bučna) i A4.
import { settings } from './db.js';
import { t } from './i18n.js';
import { esc } from './ui.js';
import { TUNING_IDS, cleanTuning, tuningNotes } from './tunings.js';

// Soba: novi ključ „tunerRoom“ (stari „tunerSens“ se više ne čita). Svi počinju na „Auto“, a izbor
// napravljen posle ove verzije se pamti; vraćanje stare rezervne kopije ga ne menja.
export const ROOMS = ['auto', 'quiet', 'noisy'];
export const roomToSensitivity = (room) => ({ quiet: 'high', noisy: 'low' }[room] || 'auto');
export async function getRoom() { const r = await settings.get('tunerRoom', 'auto'); return ROOMS.includes(r) ? r : 'auto'; }

export async function loadTunerSettings() {
  return {
    tuning: cleanTuning(await settings.get('tuning', 'standard')),
    room: await getRoom(),
    a4: Number(await settings.get('a4', 440)) || 440,
  };
}

/** HTML panela (bez naslova — naslov daje prozor ili kartica). */
export function tunerSettingsHTML(s) {
  return `<div class="tset">
    <h3 class="tset-h">${t('tuning.label')}</h3>
    <div class="tset-tunings" role="radiogroup" aria-label="${esc(t('tuning.label'))}">
      ${TUNING_IDS.map((id) => `<button role="radio" class="tset-tuning${id === s.tuning ? ' active' : ''}" data-tuning="${id}" aria-checked="${id === s.tuning}">
        <b>${esc(t('tuning.' + id))}</b><span>${esc(tuningNotes(id))}</span></button>`).join('')}
    </div>
    <h3 class="tset-h">${t('room.title')}</h3>
    <div class="seg-tabs tset-room" role="radiogroup" aria-label="${esc(t('room.title'))}">
      ${ROOMS.map((r) => `<button role="radio" data-room="${r}" class="${r === s.room ? 'active' : ''}" aria-checked="${r === s.room}">${t('room.' + r)}</button>`).join('')}
    </div>
    <p class="muted small tset-note" data-room-note>${t('room.note_' + s.room)}</p>
    <div class="a4-row">
      <span>${t('set.a4')}</span>
      <div class="stepper">
        <button class="btn round small" data-a4="-1" aria-label="${t('set.decrease')}">−</button>
        <b data-a4-val>${s.a4} Hz</b>
        <button class="btn round small" data-a4="1" aria-label="${t('set.increase')}">+</button>
      </div>
    </div>
    <p class="muted small">${t('set.a4Note')}</p>
  </div>`;
}

/** Poveži dugmad; svaka promena se odmah čuva i javlja preko onChange({ tuning | room | a4 }). */
export function bindTunerSettings(el, s, onChange = () => {}) {
  el.addEventListener('click', async (e) => {
    const tb = e.target.closest('[data-tuning]');
    const rb = e.target.closest('[data-room]');
    const ab = e.target.closest('[data-a4]');
    if (tb) {
      s.tuning = tb.dataset.tuning;
      el.querySelectorAll('[data-tuning]').forEach((x) => { const on = x === tb; x.classList.toggle('active', on); x.setAttribute('aria-checked', on); });
      await settings.set('tuning', s.tuning);
      onChange({ tuning: s.tuning });
    } else if (rb) {
      s.room = rb.dataset.room;
      el.querySelectorAll('[data-room]').forEach((x) => { const on = x === rb; x.classList.toggle('active', on); x.setAttribute('aria-checked', on); });
      el.querySelector('[data-room-note]').textContent = t('room.note_' + s.room);
      await settings.set('tunerRoom', s.room);
      onChange({ room: s.room });
    } else if (ab) {
      s.a4 = Math.max(430, Math.min(450, s.a4 + Number(ab.dataset.a4)));
      el.querySelector('[data-a4-val]').textContent = s.a4 + ' Hz';
      await settings.set('a4', s.a4);
      onChange({ a4: s.a4 });
    }
  });
}
