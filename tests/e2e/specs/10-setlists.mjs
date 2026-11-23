// Set lista: prikaz pesama redom, prevlačenje menja redosled, „Sviraj set“ (nastup) — sledeća pesma, kraj.
import { open, boot, addSongs, expect, eq } from '../lib.mjs';
export const name = 'set liste: redosled, prevlačenje, Sviraj set (sledeća pesma)';
export async function run(ctx) {
  const p = await open(ctx, 'phone');
  await boot(p, ctx);
  const ids = await addSongs(p, 4);
  await p.evaluate(async (ids) => { const { settings } = await import('./src/db.js'); await settings.set('setlists', [{ id: 'slT', name: 'Subota', songIds: ids, createdAt: Date.now() }]); }, ids);
  await p.go('#/setlista/slT', 1500);
  const rows = () => p.evaluate(() => [...document.querySelectorAll('#slList > li, #slList .sl-row')].map((r) => (r.textContent.match(/Pesma \d+/) || [''])[0]).filter(Boolean));
  eq(await rows(), ['Pesma 000', 'Pesma 001', 'Pesma 002', 'Pesma 003'], 'redosled');
  // prevlačenje: prva na treće mesto (ručka ≡)
  const h = await p.$$('#slList [data-dl-handle], #slList .dl-grip, #slList .sl-grip');
  if (h.length >= 3) {
    const a = await h[0].boundingBox(), b = await h[2].boundingBox();
    await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p.mouse.down(); await p.waitForTimeout(250);
    for (let i = 1; i <= 10; i++) { await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + ((b.y - a.y + 8) * i) / 10); await p.waitForTimeout(30); }
    await p.mouse.up(); await p.waitForTimeout(700);
    const order = await p.evaluate(async () => (await (await import('./src/db.js')).settings.get('setlists'))[0].songIds);
    expect(order.length === 4 && order[0] !== ids[0] && new Set(order).size === 4, 'prevlačenje nije promenilo redosled', order);
  }
  // Sviraj set
  await p.click('#slStage'); await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelector('.modal-backdrop .btn.primary')?.click()); await p.waitForTimeout(2500);
  expect(/#\/nastup/.test(await p.evaluate(() => location.hash)), 'Sviraj set nije otvorio nastup', await p.evaluate(() => location.hash));
  const t1 = await p.evaluate(() => document.body.innerText.match(/Pesma \d+/)?.[0]);
  await p.keyboard.press('Shift+ArrowRight'); await p.waitForTimeout(1200);
  const t2 = await p.evaluate(() => document.body.innerText.match(/Pesma \d+/)?.[0]);
  expect(t1 && t2 && t1 !== t2, 'sledeća pesma u nastupu', { t1, t2 });
}
