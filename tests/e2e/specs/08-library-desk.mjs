// Računar: biblioteka kao tabela, sortiranje, više pesama (Ctrl/Shift), otvaranje pesme u desnom delu sa mekim prelazom,
// Ctrl K pretraga svega, prečice se ne izvršavaju dvaput posle Pesme → pesma → Pesme.
import { open, boot, addSongs, expect } from '../lib.mjs';
export const name = 'Pesme (računar): tabela, sortiranje, izbor više, pesma desno, klizanje, Ctrl K';
export async function run(ctx) {
  const p = await open(ctx, 'desk', { init: () => { const a = Element.prototype.animate; window.__anim = 0; Element.prototype.animate = function (...x) { if (this.id === 'app') window.__anim++; return a.apply(this, x); }; } });
  await boot(p, ctx);
  const ids = await addSongs(p, 40);
  await p.go('#/pesme', 1800);
  const rows = await p.evaluate(() => document.querySelectorAll('.dk-table tr[data-id]').length);
  expect(rows >= 30, 'tabela nema redove', rows);
  await p.click('th[data-sort="artist"]'); await p.waitForTimeout(400);
  const art = await p.evaluate(() => [...document.querySelectorAll('.dk-table tr[data-id] td:nth-child(3)')].slice(0, 40).map((x) => x.textContent));
  expect(art.join() === [...art].sort((a, b) => a.localeCompare(b, 'sr')).join(), 'sortiranje po izvođaču', art.slice(0, 6));
  // otvori pesmu: bočna traka se skupi, sadržaj klizne
  await p.click('.dk-table tr[data-id] .dt-title');
  await p.waitForSelector('.pane-song #sLyrics', { timeout: 5000 }); await p.waitForTimeout(500);
  const anim = await p.evaluate(() => window.__anim);
  expect(anim >= 1, 'sadržaj ne klizne pri otvaranju pesme');
  expect(await p.evaluate(() => document.body.classList.contains('side-mini') && getComputedStyle(document.getElementById('app')).transform === 'none'), 'traka nije skupljena ili sadržaj nije na mestu');
  // više pesama
  const r = await p.$$('.dk-table tr[data-id]');
  await r[0].click({ modifiers: ['Control'] }); await (await p.$$('.dk-table tr[data-id]'))[2].click({ modifiers: ['Shift'] }); await p.waitForTimeout(300);
  const sel = await p.evaluate(() => ({ n: document.querySelectorAll('.dk-table tr.sel').length, bulk: !!document.querySelector('.dk-bulk') }));
  expect(sel.n === 3 && sel.bulk, 'izbor više pesama', sel);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  // Ctrl K
  await p.go('#/tuner', 700);
  await p.keyboard.press('Control+k'); await p.waitForTimeout(500);
  expect(await p.$('.srch input, .dsh-search input, #srchIn'), 'Ctrl K pretraga se nije otvorila');
  await p.keyboard.type('Pesma 007'); await p.waitForTimeout(500);
  const res = await p.evaluate(() => [...document.querySelectorAll('.srch-res [data-i], .srch-it')].map((e) => e.textContent.trim()).slice(0, 3));
  expect(res.some((x) => /Pesma 007/.test(x)), 'Ctrl K ne nalazi pesmu', res);
  await p.keyboard.press('Escape');
  // prečice jednom: Pesme → pesma → Pesme, pa „/“ (pretraga) ne sme da baci grešku ni dupli fokus
  await p.go('#/pesme', 1200); await p.go('#/pesma/' + ids[1], 1200); await p.go('#/pesme', 1200);
  await p.keyboard.press('/'); await p.waitForTimeout(300);
  expect(await p.evaluate(() => document.activeElement && document.activeElement.id === 'lSearch'), '„/“ ne fokusira pretragu');
}
