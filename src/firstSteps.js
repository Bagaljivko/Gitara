// v2.4: „Prvi koraci“ na Vežbama — četiri koraka za novog korisnika, štikliraju se sami:
// tuner pokrenut, svoja pesma (ne primer), odigrana igra, povezan Google. Skriva se kad je sve gotovo ili na ×.
// Ne prikazuje se onima koji očigledno nisu novi (10+ pesama ili 5+ odigranih rundi).
import { t } from './i18n.js';
import { esc } from './ui.js';
import { songs, settings } from './db.js';

const OFF = 'marli-fs-off';
const ok = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';

export async function stepsState(stats) {
  let tuner = false; try { tuner = !!localStorage.getItem('marli-fs-tuner'); } catch {}
  const mine = (await songs.all().catch(() => [])).filter((s) => !s.demo && !s.deleted);
  const plays = Object.values((stats && stats.games) || {}).reduce((a, g) => a + (g.plays || 0), 0);
  const sync = await settings.get('syncCfg', null);
  return { tuner, song: mine.length > 0, game: plays > 0, google: !!(sync && sync.on), nSongs: mine.length, plays };
}

export async function drawFirstSteps(box, stats) {
  if (!box) return;
  try { if (localStorage.getItem(OFF)) return; } catch { return; }
  const st = await stepsState(stats);
  const steps = [
    ['tuner', '#/tuner', '🎯'], ['song', '#/pesme', '♪'], ['game', '#/vezbe/pauk', '🎮'], ['google', '#/podesavanja', '☁'],
  ];
  const done = steps.filter(([k]) => st[k]).length;
  if (done === steps.length || st.nSongs >= 10 || st.plays >= 5) { try { localStorage.setItem(OFF, done === steps.length ? 'done' : 'old'); } catch {} return; }
  if (!box.isConnected) return;
  box.innerHTML = `<section class="fs-card" aria-label="${esc(t('fs.title'))}">
    <header class="fs-head"><b>${esc(t('fs.title'))}</b><span class="fs-of">${esc(t('fs.of', { n: done, m: steps.length }))}</span>
      <button type="button" class="fs-x" aria-label="${esc(t('fs.close'))}" title="${esc(t('fs.close'))}">×</button></header>
    <div class="fs-bar" aria-hidden="true"><i style="width:${Math.round((done / steps.length) * 100)}%"></i></div>
    <ol class="fs-list">${steps.map(([k, href, ic]) => `<li><a class="fs-step${st[k] ? ' done' : ''}" href="${href}" data-fs="${k}">
      <span class="fs-ic" aria-hidden="true">${st[k] ? ok : ic}</span><span class="fs-t"><b>${esc(t('fs.' + k))}</b><small>${esc(t('fs.' + k + 'Sub'))}</small></span><span class="sr-chev" aria-hidden="true">›</span></a></li>`).join('')}</ol>
  </section>`;
  box.querySelector('.fs-x').addEventListener('click', () => { try { localStorage.setItem(OFF, 'x'); } catch {} box.innerHTML = ''; });
}
