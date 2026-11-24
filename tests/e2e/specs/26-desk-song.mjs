// v2.4.7: pesma na računaru — lista | razdelnik | pesma (širina se pamti), fokus (F / Esc / prevuci do kraja / dugme),
// mirno zaglavlje (Fokus · Uredi · Sviraj · ⋯ + čipovi), jedna kolona, PageDown lista stranu, „Sviraj“ = ceo ekran za jednu pesmu.
import { open, boot, addSong, addSongs, expect, overflowCheck } from '../lib.mjs';
export const name = 'pesma na računaru: razdelnik, fokus, mirno zaglavlje, strana dole, Sviraj';
export async function run(ctx) {
  const q = await open(ctx, 'desk'); await boot(q, ctx);
  await addSongs(q, 8);
  const id = await addSong(q, { title: 'Kad bi bio sad', artist: 'Bajaga', lines: 7, sections: 6 });
  await q.go('#/pesma/' + id, 2000);
  const box = (s) => q.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.offsetParent && getComputedStyle(e).position !== 'fixed') return null; const r = e.getBoundingClientRect(); return { x: r.x, w: r.width, h: r.height }; }, s);
  expect(!(await box('.desk-lib > .pane-side')), 'bočna traka se ne sklanja kad je pesma otvorena');
  expect(await box('.dk-div'), 'nema razdelnika');
  { const o = await overflowCheck(q); expect(!o.page && !o.items.length, 'nešto izlazi van ekrana', o); }
  // zaglavlje: samo Fokus · Uredi · Sviraj · ⋯ (ostalo su čipovi i plutajuća traka)
  const tb = await q.evaluate(() => [...document.querySelectorAll('#sTb > *')].filter((b) => b.offsetParent).map((b) => b.dataset.tb));
  expect(JSON.stringify(tb) === JSON.stringify(['focus', 'edit', 'stage', 'more']), 'traka pesme', tb);
  expect(await q.evaluate(() => document.querySelectorAll('#sChips .sc-chip').length >= 3), 'nema čipova na računaru');
  expect(await q.evaluate(() => !document.getElementById('sLyrics').classList.contains('cols2')), 'tekst nije u jednoj koloni');
  // razdelnik: prevuci na 480 px → lista 480; pamti se posle ponovnog otvaranja
  const lx = (await box('.desk-lib > .pane-list')).x, d = await box('.dk-div');
  await q.mouse.move(d.x + 6, 450); await q.mouse.down(); await q.mouse.move(lx + 300, 450, { steps: 5 }); await q.mouse.move(lx + 480, 450, { steps: 5 }); await q.mouse.up(); await q.waitForTimeout(300);
  const w1 = (await box('.desk-lib > .pane-list')).w;
  expect(Math.abs(w1 - 480) < 6, 'razdelnik ne menja širinu liste', w1);
  await q.reload(); await q.waitForTimeout(2000);
  expect(Math.abs((await box('.desk-lib > .pane-list')).w - 480) < 6, 'širina liste se ne pamti', (await box('.desk-lib > .pane-list')).w);
  // F → fokus; Esc → lista (pesma ostaje otvorena)
  const songW = (await box('.desk-lib > .pane-song')).w;
  await q.keyboard.press('f'); await q.waitForTimeout(400);
  expect(!(await box('.desk-lib > .pane-list')) && (await box('.desk-lib > .pane-song')).w > songW + 300, 'F ne uključuje fokus');
  expect((await box('.stb-list')) && !(await box('.stb-focus')), 'u fokusu nema dugmeta „Lista“');
  await q.keyboard.press('Escape'); await q.waitForTimeout(400);
  expect(await box('.desk-lib > .pane-list') && /#\/pesma\//.test(await q.evaluate(() => location.hash)), 'Esc ne vraća listu (ili zatvara pesmu)');
  // prevuci razdelnik do kraja levo → fokus; dugme „Lista“ vraća, širina ostaje
  const d2 = await box('.dk-div');
  await q.mouse.move(d2.x + 6, 450); await q.mouse.down(); await q.mouse.move(lx + 60, 450, { steps: 8 }); await q.mouse.up(); await q.waitForTimeout(400);
  expect(await q.evaluate(() => document.body.classList.contains('dk-focus')), 'prevlačenje do kraja ne uključuje fokus');
  await q.click('.stb-list'); await q.waitForTimeout(400);
  expect(Math.abs((await box('.desk-lib > .pane-list')).w - 480) < 6, 'posle fokusa lista nema zapamćenu širinu');
  // PageDown: strana dole, red na kome si stao zasvetli
  const y0 = await q.evaluate(() => scrollY);
  await q.mouse.move(800, 500); await q.keyboard.press('PageDown'); await q.waitForTimeout(700);
  const pg = await q.evaluate(() => ({ y: scrollY, mark: !!document.querySelector('#sLyrics .ln.pg-mark') }));
  expect(pg.y - y0 > 300 && pg.mark, 'PageDown ne lista stranu / ne označava red', { y0, ...pg });
  // Sviraj: ceo ekran za jednu pesmu, bez donje trake; Esc → nazad na pesmu
  await q.click('#sTb [data-tb="stage"]'); await q.waitForTimeout(1500);
  const st = await q.evaluate(() => ({ h: location.hash, one: !!document.querySelector('.stage.st-one'), foot: !!document.getElementById('stFoot')?.offsetParent, title: document.getElementById('stTitle')?.textContent }));
  expect(/#\/nastup\/pesma%3A/.test(st.h) && st.one && !st.foot && st.title === 'Kad bi bio sad', 'Sviraj ne otvara pesmu preko celog ekrana', st);
  await q.keyboard.press('Escape'); await q.waitForTimeout(1500);
  expect(/#\/pesma\//.test(await q.evaluate(() => location.hash)), 'izlaz iz „Sviraj“ ne vraća na pesmu', await q.evaluate(() => location.hash));
  // vreme u „Sviraj“ se računa pesmi
  expect(await q.evaluate(async (id) => { const A = await import('./src/activity.js'); return typeof A.ping === 'function'; }, id), 'activity');
}
