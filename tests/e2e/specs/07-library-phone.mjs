// Pesme na telefonu: lista, pretraga (i velika biblioteka 200 pesama — tačno i glatko), sortiranje, „Dodaj pesmu“, set liste.
import { open, boot, addSongs, expect, eq, throttle } from '../lib.mjs';
export const name = 'Pesme (telefon): lista, pretraga 200 pesama, sortiranje, Dodaj pesmu, set liste';
export async function run(ctx) {
  const p = await open(ctx, 'phone');
  await boot(p, ctx);
  await addSongs(p, 200);
  await p.evaluate(async () => { const { songs } = await import('./src/db.js'); await songs.save({ title: 'Zvezdana noć', artist: 'Bajaga', sections: [{ name: 'S', type: 'verse', lines: [{ text: 'aa', chords: [{ pos: 0, position: 0, chord: 'G' }] }] }] }); });
  await p.go('#/pesme', 1800);
  const n = await p.evaluate(() => document.querySelectorAll('#lList .song-item').length);
  expect(n >= 30, 'lista je kratka', n);
  if (await p.$('#lSearchBtn')) { await p.click('#lSearchBtn'); await p.waitForTimeout(300); }
  const cdp = await throttle(p, 6);
  const lag = []; for (const ch of 'zvezd') { const t0 = Date.now(); await p.type('#lSearch', ch); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); lag.push(Date.now() - t0); }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await p.waitForTimeout(800);
  const hits = await p.evaluate(() => [...document.querySelectorAll('#lList .song-item')].map((e) => e.querySelector('b, .si-title, h3')?.textContent.trim() || e.textContent.trim()).filter(Boolean));
  expect(hits.length === 1 && /Zvezdana/.test(hits[0]), 'pretraga ne nalazi tačno jednu pesmu', hits.slice(0, 5));
  expect(Math.max(...lag) < 250, 'kucanje sporo (6× usporen procesor)', lag);
  ctx.note.push('kucanje ≤ ' + Math.max(...lag) + ' ms (6×)');
  await p.fill('#lSearch', ''); await p.waitForTimeout(700);
  // Dodaj pesmu: 4 načina
  await p.click('#lAdd'); await p.waitForTimeout(500);
  const opts = await p.evaluate(() => [...document.querySelectorAll('.sheet button, .add-sheet button, .modal-backdrop button')].map((b) => b.textContent.trim()).filter((s) => s.length > 3));
  expect(opts.some((o) => /Skeniraj/.test(o)) && opts.some((o) => /PDF/.test(o)) && opts.some((o) => /Napiši|Nova/.test(o)), 'Dodaj pesmu: nedostaju opcije', opts);
  await p.keyboard.press('Escape'); await p.evaluate(() => document.querySelectorAll('.modal-backdrop, .sheet-backdrop').forEach((m) => m.remove())); await p.waitForTimeout(300);
  // set liste
  await p.evaluate(async () => { const { settings, songs } = await import('./src/db.js'); const ids = (await songs.all()).slice(0, 5).map((s) => s.id); await settings.set('setlists', [{ id: 'slP', name: 'Subota', songIds: ids, createdAt: Date.now() }]); });
  await p.go('#/pesme?tab=sl', 1200);
  const sl = await p.evaluate(() => document.body.textContent.includes('Subota'));
  expect(sl, 'set lista se ne vidi');
}
