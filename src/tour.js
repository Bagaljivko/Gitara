// Prvi put: kratak obilazak u tri koraka (Tuner → Pesme → Vežbe). Iza panela se vidi pravi ekran.
// Prikazuje se samo novom korisniku (nijedan zapis aplikacije u pregledaču); „Preskoči“ ga zatvara zauvek.
import { t } from './i18n.js';

const KEY = 'gitara-tour';
const ICONS = {
  tuner: '<path d="M12 4a9 9 0 0 0-9 9h2a7 7 0 0 1 14 0h2a9 9 0 0 0-9-9zm4.3 4.3-5.4 4.3a1.6 1.6 0 1 0 2.3 2.2l3.8-5.8-.7-.7z"/>',
  pesme: '<path d="M12 3v10.6A4 4 0 1 0 14 17V7h4V3h-6z"/>',
  vezbe: '<path fill-rule="evenodd" d="M12 2.2c-4.9 0-8.6 2-8.6 5.6 0 4.6 4.2 10.2 8.6 14 4.4-3.8 8.6-9.4 8.6-14 0-3.6-3.7-5.6-8.6-5.6zM10 7.6v6.2l5.2-3.1z"/>',
};
const STEPS = ['tuner', 'pesme', 'vezbe'];

export function tourSeen() {
  try { return !!localStorage.getItem(KEY); } catch { return true; }
}

export function startTour() {
  if (document.querySelector('.tour-backdrop')) return;
  let i = 0;
  const back = document.createElement('div');
  back.className = 'tour-backdrop';
  back.innerHTML = `<div class="tour" role="dialog" aria-modal="true" aria-labelledby="tourTitle">
    <div class="tour-dots" aria-hidden="true">${STEPS.map(() => '<i></i>').join('')}</div>
    <span class="tour-ico" aria-hidden="true"><svg viewBox="0 0 24 24"></svg></span>
    <h2 id="tourTitle"></h2>
    <p class="tour-txt"></p>
    <div class="tour-bar"><button class="btn tour-skip" type="button"></button><button class="btn primary tour-next" type="button"></button></div>
  </div>`;
  const q = (s) => back.querySelector(s);
  const done = (go) => {
    try { localStorage.setItem(KEY, '1'); } catch {}
    back.remove();
    if (go) location.hash = '#/' + go;
  };
  function draw() {
    const id = STEPS[i], last = i === STEPS.length - 1;
    if (location.hash !== '#/' + id) location.hash = '#/' + id;
    back.querySelectorAll('.tour-dots i').forEach((d, k) => d.classList.toggle('on', k <= i));
    q('.tour-ico svg').innerHTML = ICONS[id];
    q('h2').textContent = t(`tour.${id}.title`);
    q('.tour-txt').textContent = t(`tour.${id}.text`);
    q('.tour-skip').textContent = t('tour.skip');
    q('.tour-skip').hidden = last;
    q('.tour-next').textContent = last ? t('tour.start') : t('tour.next') + ' ›';
    q('.tour-next').focus({ preventScroll: true });
  }
  q('.tour-skip').addEventListener('click', () => done('tuner'));
  q('.tour-next').addEventListener('click', () => { if (i < STEPS.length - 1) { i++; draw(); } else done('tuner'); });
  back.addEventListener('keydown', (e) => { if (e.key === 'Escape') done('tuner'); });
  document.body.appendChild(back);
  draw();
}
