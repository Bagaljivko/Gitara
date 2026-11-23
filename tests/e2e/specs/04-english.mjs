// Engleski: svi ekrani bez ključeva umesto teksta i bez srpskih naslova u meniju; prebacivanje jezika u hodu.
import { open, boot, addSong, rawKeys, expect, appModule } from '../lib.mjs';
export const name = 'engleski jezik: svi ekrani prevedeni, promena jezika u hodu';
export async function run(ctx) {
  const bad = [];
  for (const dev of ['phone', 'desk']) {
    const p = await open(ctx, dev, { lang: 'en' });
    await boot(p, ctx);
    const id = await addSong(p, { title: 'English' });
    for (const h of ['#/tuner', '#/akordi', '#/pesme', '#/pesma/' + id, '#/vezbe', '#/vezbe/pauk', '#/vezbe/rp', '#/podesavanja']) {
      await p.go(h, 1000); const k = await rawKeys(p); if (k.length) bad.push(dev + ' ' + h + ': ' + k.join(','));
    }
    const nav = await p.evaluate(() => [...document.querySelectorAll('.nav a')].map((a) => a.textContent.trim()).join('|'));
    if (!/Songs/.test(nav) || /Pesme|Podešavanja/.test(nav)) bad.push(dev + ' meni nije na engleskom: ' + nav);
    // nazad na srpski u hodu
    const i18n = await appModule(p, 'i18n.js'); await p.evaluate((m) => m.setLang('sr'), i18n);
    await p.go('#/pesme', 900);
    const nav2 = await p.evaluate(() => [...document.querySelectorAll('.nav a')].map((a) => a.textContent.trim()).join('|'));
    if (!/Pesme/.test(nav2)) bad.push(dev + ' meni se nije vratio na srpski: ' + nav2);
  }
  expect(!bad.length, 'problemi sa prevodom', bad);
}
