// Telefon položen: tekst preko cele širine (bez kolone hvatova), − 🔍 + u donjoj traci i radi; uspravno: na vrhu.
import { open, boot, addSong, expect } from '../lib.mjs';
export const name = 'pesma položeno: − 🔍 + u donjoj traci, bez kolone hvatova; tablet bez kolone';
export async function run(ctx) {
  const p = await open(ctx, 'phoneLand');
  await boot(p, ctx);
  const id = await addSong(p, { title: 'Položeno', lines: 10 });
  await p.go('#/pesma/' + id, 1500);
  const st = await p.evaluate(() => ({ inBar: !!document.querySelector('#sScrollBar > .zoom-pill.zp-bar'), shown: !!document.querySelector('.zoom-pill.zp-bar')?.offsetWidth, diag: document.querySelector('.diag-col') ? getComputedStyle(document.querySelector('.diag-col')).display : 'none' }));
  expect(st.inBar && st.shown, '− 🔍 + nije u donjoj traci', st);
  expect(st.diag === 'none', 'kolona hvatova se vidi na položenom telefonu', st);
  const z0 = await p.evaluate(() => getComputedStyle(document.querySelector('#sLyrics')).fontSize);
  await p.click('#sScrollBar .zoom-pill [data-zoom="1"]'); await p.waitForTimeout(400);
  const z1 = await p.evaluate(() => getComputedStyle(document.querySelector('#sLyrics')).fontSize);
  expect(parseFloat(z1) > parseFloat(z0), '+ u traci ne povećava tekst', { z0, z1 });
  // okretanje u uspravno: − 🔍 + se vraća gore
  await p.setViewportSize({ width: 393, height: 851 }); await p.waitForTimeout(600);
  const back = await p.evaluate(() => !!document.querySelector('.zoom-wrap > .zoom-pill') && !document.querySelector('#sScrollBar > .zoom-pill'));
  expect(back, '− 🔍 + se nije vratio gore posle okretanja');
  // tablet: bez kolone hvatova
  const t = await open(ctx, 'tabLand'); await boot(t, ctx); const id2 = await addSong(t, { title: 'Tablet' }); await t.go('#/pesma/' + id2, 1500);
  const d2 = await t.evaluate(() => document.querySelector('.diag-col') ? getComputedStyle(document.querySelector('.diag-col')).display : 'none');
  expect(d2 === 'none', 'kolona hvatova na tabletu', d2);
}
