// v2.4.23: profil učenika — slika (aplikacija je smanji: kvadrat 256 px, do ~60 KB), zajedno od, rođendan, beleške,
// omiljene (najviše svira + ručno), želje; podsetnici za rođendan i godišnjicu (jednom); telefon i računar.
import { open, boot, expect, overflowCheck } from '../lib.mjs';
export const name = 'profil učenika: slika (smanjena), zajedno od, rođendan, beleške, omiljene, podsetnici';
export const timeout = 200;
const SHOT = process.env.MARLI_SHOTS || '';
export async function run(ctx) {
  for (const dev of ['phone', 'desk']) {
    const t = await open(ctx, dev); await boot(t, ctx, '#/tuner', 900);
    const r = await t.evaluate(async () => {
      const M = await import('./src/teach.js'); await M.setTeacher({ on: true, name: 'Mile' });
      const a = await M.addStudent({ name: 'Ana' });
      // velika fotografija (3000×2000) → aplikacija je smanji
      const c = document.createElement('canvas'); c.width = 3000; c.height = 2000; const g = c.getContext('2d');
      for (let i = 0; i < 4000; i++) { g.fillStyle = `hsl(${(i * 37) % 360},70%,50%)`; g.fillRect(Math.random() * 3000, Math.random() * 2000, 60, 60); }
      const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = c.toDataURL('image/png'); });
      const SP = await import('./src/studentProfile.js');
      const photo = await SP.makePhoto(img, { zoom: 1.4, x: 0.2 });
      const dim = await new Promise((res) => { const i = new Image(); i.onload = () => res([i.width, i.height]); i.src = photo; });
      const now = new Date(); const since = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 12).getTime();
      await M.updateStudent(a.id, { photo, since, bd: { d: now.getDate(), m: now.getMonth() + 1, y: now.getFullYear() - 13 }, memo: 'Voli rok; bez trzalice', favs: ['Bluz za Anu'] });
      await M.addRequest({ id: 'w1', sid: a.id, type: 'wish', title: 'Ruža', at: Date.now() });
      const { settings } = await import('./src/db.js'); await settings.set('notes', []);
      await SP.dateReminders(); await SP.dateReminders(); // drugi put — bez ponavljanja
      const N = await import('./src/notify.js');
      return { id: a.id, bytes: Math.round(photo.length * 0.75), dim, notes: (await N.list()).map((n) => n.t + ' | ' + n.s) };
    });
    expect(r.bytes < 62000 && r.dim[0] === 256 && r.dim[1] === 256, dev + ': slika nije smanjena', r);
    expect(r.notes.filter((x) => /Ana danas slavi rođendan/.test(x) && /Puni 13/.test(x)).length === 1, dev + ': podsetnik za rođendan (jednom)', r.notes);
    expect(r.notes.filter((x) => /Godinu dana radiš sa učenikom Ana/.test(x)).length === 1, dev + ': podsetnik za godišnjicu (jednom)', r.notes);
    await t.go('#/ucenik/' + encodeURIComponent(r.id), 1600);
    const v = await t.evaluate(() => ({ img: !!document.querySelector('.sp-hero img.tch-ph'), sub: document.querySelector('.sp-hero small')?.textContent || '', chips: [...document.querySelectorAll('.sp-chip')].map((c) => c.textContent), prof: document.querySelector('.sp-grp')?.innerText || '' }));
    expect(v.img && /Zajedno 1 god\./.test(v.sub) && v.chips.some((c) => /danas rođendan/.test(c)), dev + ': zaglavlje profila', v);
    expect(/Ruža/.test(v.prof) && /Bluz za Anu/.test(v.prof) && /Voli rok/.test(v.prof), dev + ': sekcija Profil (želje, omiljene, beleške)', v.prof);
    const o = await overflowCheck(t); expect(!o.items.length, dev + ': izlazi van ekrana', o);
    if (SHOT && dev === 'phone') await t.screenshot({ path: SHOT + 'profil.png' });
    // uređivanje: ime i beleška
    await t.click('#spEdit'); await t.waitForTimeout(400);
    expect(await t.$('.sp-dlg #spSince') && await t.$('.sp-dlg #spBdM'), dev + ': uređivanje profila nema polja');
    if (SHOT && dev === 'phone') await t.screenshot({ path: SHOT + 'izmena.png' });
    await t.fill('#spNotes', 'Nova beleška'); await t.click('.modal-backdrop .btn.primary'); await t.waitForTimeout(800);
    expect(/Nova beleška/.test(await t.evaluate(() => document.querySelector('.sp-grp')?.innerText || '')), dev + ': izmena beleške se ne vidi');
    expect(!t.errs.length, dev + ': greške', t.errs);
  }
}
