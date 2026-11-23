// 2.4: saveti pri prvoj poseti (jednom, posle obilaska, ne preko obilaska), Prvi koraci (štikliraju se sami, × skriva,
// ne vide ih stari korisnici), kostur ekrana samo kad čekanje potraje.
import { open, boot, addSong, addSongs, expect, eq, throttle } from '../lib.mjs';
export const name = 'novo u 2.4: saveti na ekranima, Prvi koraci, kostur pri sporom učitavanju';
export async function run(ctx) {
  // saveti
  const p = await open(ctx, 'phone', { hints: true, init: () => localStorage.removeItem('marli-fs-off') });
  await boot(p, ctx, '#/tuner', 1200);
  const id = await addSong(p, { title: 'Savet' });
  const hint = () => p.evaluate(() => document.querySelector('.hint-card p')?.textContent || null);
  for (const [h, k] of [['#/pesme', 'pesme'], ['#/pesma/' + id, 'pesma'], ['#/vezbe', 'vezbe'], ['#/akordi', 'akordi'], ['#/podesavanja', 'podesavanja']]) {
    await p.go(h, 1700); const txt = await hint();
    expect(txt && txt.length > 30, 'nema saveta na ' + k, txt);
    await p.click('.hint-ok'); await p.waitForTimeout(300); expect(!(await hint()), 'U redu ne zatvara savet (' + k + ')');
  }
  await p.go('#/tuner', 500); await p.go('#/pesme', 1700); expect(!(await hint()), 'savet se ponavlja');
  // ne preko obilaska; ne pre obilaska
  const f = await open(ctx, 'phone', { fresh: true, hints: true }); await boot(f, ctx, '#/pesme', 2200);
  expect(!(await f.evaluate(() => !!document.querySelector('.hint-card'))), 'savet pre obilaska');
  // Prvi koraci
  await p.go('#/vezbe', 1800);
  eq(await p.evaluate(() => document.querySelector('.fs-of')?.textContent), '1 od 4', 'Prvi koraci posle jedne pesme');
  await p.go('#/tuner', 700); await p.evaluate(() => document.getElementById('tStartBtn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))); await p.waitForTimeout(400);
  await p.go('#/vezbe', 1800);
  eq(await p.evaluate(() => [...document.querySelectorAll('.fs-step.done')].map((e) => e.dataset.fs)), ['tuner', 'song'], 'štiklirani koraci');
  await p.click('.fs-x'); await p.waitForTimeout(300); await p.go('#/tuner', 500); await p.go('#/vezbe', 1600);
  expect(!(await p.$('.fs-card')), '× ne skriva Prve korake');
  const old = await open(ctx, 'phone', { init: () => localStorage.removeItem('marli-fs-off') }); await boot(old, ctx); await addSongs(old, 12);
  await old.go('#/vezbe', 1800); expect(!(await old.$('.fs-card')), 'stari korisnik (12 pesama) vidi Prve korake');
  // kostur: brz uređaj — ne pojavljuje se; spor (statistika kasni) — pojavi se i nestane
  const k = await open(ctx, 'phone'); await boot(k, ctx, '#/tuner', 1200);
  await k.evaluate(() => { window.__sk = 0; new MutationObserver(() => { if (document.querySelector('.pr-skel')) window.__sk++; }).observe(document.body, { subtree: true, childList: true }); });
  await k.go('#/vezbe', 1500); eq(await k.evaluate(() => window.__sk), 0, 'kostur na brzom uređaju');
  const s = await open(ctx, 'phone'); await s.route(/\/src\/statsView\.js(\?.*)?$/, async (r) => { await new Promise((x) => setTimeout(x, 400)); r.continue(); });
  await boot(s, ctx, '#/tuner', 1200); await s.go('#/vezbe', 0);
  const seen = await s.waitForSelector('.pr-skel', { timeout: 2000 }).then(() => true).catch(() => false);
  await s.waitForTimeout(1500);
  expect(seen && !(await s.$('.pr-skel')) && (await s.evaluate(() => getComputedStyle(document.querySelector('.practice-view')).visibility)) === 'visible', 'kostur pri sporom učitavanju', { seen });
}
