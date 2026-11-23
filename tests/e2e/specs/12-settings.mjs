// Podešavanja: svaka grupa se otvara i zatvara, O aplikaciji (verzija, Šta je novo sa tačkom, tri obilaska), jezik.
import { open, boot, expect, eq } from '../lib.mjs';
export const name = 'Podešavanja: sve grupe, O aplikaciji (verzija, Šta je novo + tačka, obilasci)';
export async function run(ctx) {
  for (const dev of ['phone', 'desk']) {
    const p = await open(ctx, dev, { init: () => localStorage.removeItem('marli-seen-ver') });
    await boot(p, ctx, '#/podesavanja', 1500);
    const navDot = await p.evaluate(() => !!document.querySelector('.nav a[data-tab="podesavanja"] .wn-dot'));
    expect(navDot, dev + ': nema zlatne tačke posle ažuriranja');
    const groups = await p.evaluate(() => [...document.querySelectorAll('[data-open]')].map((b) => b.dataset.open));
    expect(groups.length >= 6, dev + ': premalo grupa', groups);
    for (const g of [...new Set(groups)]) {
      await p.evaluate((g) => document.querySelector(`[data-open="${g}"]`)?.click(), g); await p.waitForTimeout(350);
      const opened = await p.evaluate((g) => !!document.querySelector(`details[data-g="${g}"][open]`), g);
      expect(opened, `${dev}: grupa ${g} se ne otvara`);
      if (dev === 'phone') { await p.evaluate(() => history.back()); await p.waitForTimeout(350); }
    }
    await p.evaluate(() => document.querySelector('[data-open="about"]')?.click()); await p.waitForTimeout(400);
    const ab = await p.evaluate(() => ({ ver: document.getElementById('aboutVer')?.textContent, tours: [...document.querySelectorAll('#aboutTour, #aboutTourT, #aboutTourS')].length, dot: !!document.querySelector('#aboutNew .wn-dot') }));
    expect(ab.ver && ab.ver.includes(ctx.ver) && ab.tours === 3 && ab.dot, dev + ': O aplikaciji', ab);
    await p.click('#aboutNew'); await p.waitForTimeout(600);
    const wn = await p.evaluate(() => ({ title: document.querySelector('.modal h2, .dialog h2, [role="dialog"] h2')?.textContent || '', items: document.querySelectorAll('.wn-it').length }));
    expect(wn.title.includes(ctx.ver.split('.').slice(0, 2).join('.')) && wn.items >= 1, dev + ': Šta je novo', wn);
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    eq(await p.evaluate(() => !!document.querySelector('.nav a[data-tab="podesavanja"] .wn-dot')), false, dev + ': tačka posle gledanja');
  }
}
