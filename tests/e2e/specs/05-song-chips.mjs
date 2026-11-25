// Pesma: čipovi na vrhu rade odmah (Aa/Kapo/BPM traka −/+, Tapni za tempo, Ton → krug, Ritam → izbor, ⚙ → panel),
// izbor čipova se pamti za sve pesme, promena tonaliteta menja akorde.
import { open, boot, addSong, expect, eq } from '../lib.mjs';
export const name = 'pesma: čipovi (Aa, Kapo, BPM + Tapni), krug tonaliteta, ritam, ⚙, pamćenje trake';
export async function run(ctx) {
  const p = await open(ctx, 'phone', { init: () => localStorage.setItem('marli-songbar', JSON.stringify(['key', 'size', 'capo', 'tempo', 'rhythm'])) });
  await boot(p, ctx);
  const id = await addSong(p, { title: 'Čipovi', key: 'G', bpm: 86 });
  await p.go('#/pesma/' + id, 1500);
  const pop = () => p.evaluate(() => document.querySelector('.chip-pop b')?.textContent.trim() || null);
  const chip = (k) => p.evaluate((k) => document.querySelector(`#sChips [data-sheet="${k}"]`)?.textContent.trim(), k);
  eq(await chip('size'), 'Aa', 'čip veličine');
  const z0 = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#sLyrics')).getPropertyValue('--zoom')) || 1);
  await p.click('#sChips [data-sheet="size"]'); await p.waitForTimeout(200);
  eq(await pop(), '100%', 'Aa traka');
  await p.click('.chip-pop [data-cp="1"]'); await p.waitForTimeout(250);
  eq(await pop(), '110%', 'Aa +');
  await p.waitForTimeout(2400); expect(!(await pop()), 'Aa traka se ne zatvara sama posle 2 s');
  expect((await p.evaluate(async (id) => (await (await import('./src/db.js')).songs.get(id)).zoom, id)) > z0, 'veličina nije sačuvana');
  // kapo
  await p.click('#sChips [data-sheet="capo"]'); await p.waitForTimeout(200);
  await p.click('.chip-pop [data-cp="1"]'); await p.waitForTimeout(250);
  eq(await pop(), '1', 'kapo +');
  await p.mouse.click(200, 760); await p.waitForTimeout(250); expect(!(await pop()), 'dodir van trake ne zatvara');
  // tempo: − i Tapni (4 tapa po 500 ms ≈ 120)
  await p.click('#sChips [data-sheet="tempo"]'); await p.waitForTimeout(200);
  await p.click('.chip-pop [data-cp="-1"]'); await p.waitForTimeout(250);
  expect(/^81/.test(await pop()), 'BPM −5', await pop());
  for (let i = 0; i < 5; i++) { await p.dispatchEvent('.chip-pop [data-tap]', 'pointerdown'); await p.waitForTimeout(500); }
  const tapped = parseInt(await pop());
  expect(tapped >= 114 && tapped <= 122, 'Tapni: tempo nije ~120', tapped);
  eq(await p.evaluate(async (id) => (await (await import('./src/db.js')).songs.get(id)).bpm, id), tapped, 'tapnut tempo sačuvan');
  await p.waitForTimeout(2300);
  // ton: krug tonaliteta, izaberi drugi ton → akordi se menjaju
  const before = await p.evaluate(() => [...document.querySelectorAll('#sLyrics .chord, #sLyrics [data-chord]')].slice(0, 3).map((e) => e.textContent.trim()).join(' '));
  await p.click('#sChips [data-sheet="key"]'); await p.waitForTimeout(600);
  expect(await p.$('.kw-key'), 'krug tonaliteta se nije otvorio');
  await p.click('.kw-key[data-i="3"]'); await p.waitForTimeout(250); const sel = await p.evaluate(() => document.querySelector('.kw-key.sel')?.dataset.i); expect(sel === '3', 'dodir na ton u krugu ne bira ton', sel); await p.click('#kwUse'); await p.waitForTimeout(700);
  const after = await p.evaluate(() => [...document.querySelectorAll('#sLyrics .chord, #sLyrics [data-chord]')].slice(0, 3).map((e) => e.textContent.trim()).join(' '));
  expect(before && after && before !== after, 'akordi se nisu promenili posle promene tona', { before, after });
  // ritam: izbor ritma
  // v2.4.8: čip Ritam → mala traka (▶ · ime · Promeni…) → ceo izbor ritma
  await p.evaluate(() => document.querySelector('#sChips [data-sheet="rhythm"]')?.click()); await p.waitForTimeout(300);
  expect(await p.$('.chip-pop [data-rp]') && await p.$('.chip-pop [data-rchange]'), 'Ritam: nema male trake');
  await p.click('.chip-pop [data-rchange]'); await p.waitForTimeout(700);
  expect(await p.$('.rp-card, .rp-tabs, .rp-sheet'), 'izbor ritma se nije otvorio');
  await p.keyboard.press('Escape'); await p.evaluate(() => document.querySelectorAll('.modal-backdrop, .sheet-backdrop').forEach((m) => m.remove())); await p.waitForTimeout(300);
  // ⚙: panel sa stavkama i odeljcima
  await p.click('#sChips [data-sheet="all"]'); await p.waitForTimeout(500);
  const items = await p.evaluate(() => document.querySelectorAll('.song-sheet .ss-item').length);
  expect(items >= 7, 'panel ⚙ nema stavke', items); // v2.4.18: bez Uz video, Akordi u pesmi, Vežbaj (sada 7: ton, kapo, tempo, metronom, ritam, lakša, veličina)
  // izbor čipova važi za sve pesme
  const id2 = await addSong(p, { title: 'Druga' });
  await p.go('#/pesma/' + id2, 1300);
  const chips2 = await p.evaluate(() => [...document.querySelectorAll('#sChips .sc-chip:not(.sc-set)')].map((c) => c.dataset.sheet || c.dataset.sca || c.dataset.pa));
  expect(chips2.slice(0, 2).join() === 'key,size', 'traka nije ista na drugoj pesmi', chips2);
}
