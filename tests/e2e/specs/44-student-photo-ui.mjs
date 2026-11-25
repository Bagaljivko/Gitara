// v2.4.28: slika učenika iz galerije ostaje (prijava nastavnika): izrez se ne zatvara kad se prevlačenje završi van kvadrata,
// slika se čuva odmah (i kad se profil zatvori bez „Sačuvaj“), karton i lista pokazuju sliku umesto slova.
import { open, boot, expect } from '../lib.mjs';
export const name = 'slika učenika: iz galerije → izrez (prevlačenje van kvadrata) → ostaje na kartonu i u listi';
export const timeout = 120;
export async function run(ctx) {
  for (const dev of ['phone', 'desktop']) {
    const p = await open(ctx, dev); await boot(p, ctx, '#/tuner', 900);
    const sid = await p.evaluate(async () => { const M = await import('./src/teach.js'); await M.setTeacher({ on: true, name: 'Mile' }); return (await M.addStudent({ name: 'Ana' })).id; });
    const png = Buffer.from((await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 1200, 900); g.fillStyle = '#3c3'; g.fillRect(300, 200, 500, 500); return c.toDataURL('image/png'); })).split(',')[1], 'base64');
    await p.go('#/ucenik/' + sid, 1500);
    expect(await p.evaluate(() => !document.querySelector('.sp-hero img.tch-ph')), 'slika pre izbora');
    await p.click('#spEdit'); await p.waitForTimeout(400);
    await p.setInputFiles('#spGal', { name: 'ana.png', mimeType: 'image/png', buffer: png }); await p.waitForTimeout(700);
    expect(await p.$('.sp-crop canvas'), 'nema izreza slike');
    // izrez se zaista vidi (iznad profila), dugme „Sačuvaj“ izreza je na vrhu
    const top = await p.evaluate(() => { const c = document.querySelector('.sp-crop canvas').getBoundingClientRect(); const e = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2); const b = [...document.querySelectorAll('.sp-crop-dlg .btn')].find((x) => x.classList.contains('primary')).getBoundingClientRect(); return { canvas: e && e.tagName, btn: document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('.sp-crop-dlg') ? 1 : 0 }; });
    expect(top.canvas === 'CANVAS' && top.btn === 1, 'izrez slike je ispod profila (ne vidi se)', top);
    // prevlačenje: počne na slici, završi se van kvadrata (na tamnoj pozadini)
    const r = await p.evaluate(() => { const b = document.querySelector('.sp-crop canvas').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, bx: 4, by: 4 }; });
    await p.mouse.move(r.x, r.y); await p.mouse.down(); await p.mouse.move(r.x + 40, r.y + 30, { steps: 4 }); await p.mouse.move(r.bx, r.by, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(300);
    expect(await p.$('.sp-crop canvas') && await p.$('.sp-dlg'), 'izrez ili profil se zatvorio posle prevlačenja van kvadrata');
    await p.click('.sp-crop-dlg .btn.primary'); await p.waitForTimeout(600);
    // profil zatvoren BEZ „Sačuvaj“ — slika ipak ostaje
    await p.click('.sp-dlg .modal-actions .btn:not(.primary)'); await p.waitForTimeout(800);
    const st = await p.evaluate(async (sid) => { const M = await import('./src/teach.js'); const s = await M.getStudent(sid); return { has: /^data:image\/jpeg;base64,/.test(s.photo || ''), kb: Math.round((s.photo || '').length * 0.75 / 1024), hero: !!document.querySelector('.sp-hero img.tch-ph') }; }, sid);
    expect(st.has && st.kb <= 60 && st.hero, 'slika nije sačuvana / karton je ne pokazuje', st);
    await p.go('#/ucenici', 1200);
    const list = await p.evaluate(() => document.querySelectorAll('img.tch-ph').length);
    expect(list >= 1, 'lista učenika: slovo umesto slike', list);
    await p.close();
  }
}
