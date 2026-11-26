// v2.5.4 (Mile): učenik ima stalni termin (ponedeljak 20:00); „+ Čas“ pita — dodatni čas samo jednom (stalni ostaje),
// još jedan stalni termin (npr. četvrtak), ili promena. Dodatni čas se vidi u Rasporedu sa oznakom „dodatni čas“,
// otkazivanje dodatnog ne dira stalni, i sve ide u spisak učenika (sinhronizacija i kopija).
import { open, boot, expect, eq } from '../lib.mjs';
export const name = 'dodatni čas (stalni termin ostaje), drugi stalni termin, otkazivanje dodatnog (Mile)';
export const timeout = 150;

export async function run(ctx) {
  const t = await open(ctx, 'phone'); await boot(t, ctx, '#/tuner', 900);
  const sid = await t.evaluate(async () => {
    const M = await import('./src/teach.js'); await M.setTeacher({ on: true, name: 'Mile' });
    const a = await M.addStudent({ name: 'Ana' });
    const DAY = 864e5, d = new Date(); d.setHours(0, 0, 0, 0);
    await M.updateStudent(a.id, { slot: { dow: 0, hm: '20:00', dur: 45, every: 1, from: d.getTime() - 14 * DAY, off: {}, moved: {} } });
    return a.id;
  });
  const p2 = (n) => String(n).padStart(2, '0');
  const x = new Date(Date.now() + 2 * 864e5); const xd = `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`;
  // 1) + Čas → pitanje → dodatni čas
  await t.go('#/raspored', 1500);
  await t.click('#schAdd'); await t.waitForSelector('.sch-pick');
  const opts = await t.evaluate(() => [...document.querySelectorAll('.sch-pick [data-k]')].map((b) => b.dataset.k + (b.classList.contains('on') ? '*' : '')));
  eq(opts, ['x*', 's', 'c'], 'pitanje: dodatni (izabran) / drugi termin / promena');
  await t.click('.modal-backdrop .btn.primary'); await t.waitForSelector('#schXd');
  await t.fill('#schXd', xd); await t.fill('#schXt', '18:30');
  await t.click('.modal-backdrop:last-child .btn.primary'); await t.waitForTimeout(1200);
  const st1 = await t.evaluate(async (sid) => (await import('./src/teach.js')).getStudent(sid), sid);
  expect(st1.slot && st1.slot.dow === 0 && st1.slot.hm === '20:00' && (st1.extra || []).length === 1, 'stalni termin ostaje + dodatni čas', st1);
  // u rasporedu: dan dodatnog časa ima Anu sa oznakom „dodatni čas“
  await t.go('#/raspored', 1500);
  await t.evaluate((day) => { const b = [...document.querySelectorAll('.sch-days7 button')].find((x) => Number(x.dataset.day) === day); b && b.click(); }, new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime());
  await t.waitForTimeout(500);
  const cards = await t.evaluate(() => [...document.querySelectorAll('.sch-c')].map((c) => c.innerText.replace(/\s+/g, ' ')));
  expect(cards.some((c) => /Ana/.test(c) && /dodatni čas/.test(c)), 'dodatni čas u rasporedu', cards);
  // 2) drugi stalni termin: četvrtak 18:00
  await t.click('#schAdd'); await t.waitForSelector('.sch-pick');
  await t.click('.sch-pick [data-k="s"]'); await t.click('.modal-backdrop .btn.primary'); await t.waitForSelector('.sch-dlg [data-dow="3"]');
  await t.click('.sch-dlg [data-dow="3"]'); await t.fill('#schHm', '18:00');
  await t.click('.modal-backdrop:last-child .btn.primary'); await t.waitForTimeout(1200);
  const st2 = await t.evaluate(async (sid) => (await import('./src/teach.js')).getStudent(sid), sid);
  expect(st2.slot.dow === 0 && (st2.slots2 || []).length === 1 && st2.slots2[0].dow === 3 && st2.slots2[0].hm === '18:00', 'drugi stalni termin, prvi ostaje', st2);
  // 3) otkaži dodatni čas — stalni i drugi ostaju
  await t.go('#/raspored', 1200);
  await t.evaluate((day) => { const b = [...document.querySelectorAll('.sch-days7 button')].find((x) => Number(x.dataset.day) === day); b && b.click(); }, new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime());
  await t.waitForTimeout(500);
  await t.evaluate(() => { const c = [...document.querySelectorAll('.sch-c')].find((b) => /dodatni čas/.test(b.innerText)); c && c.click(); });
  await t.waitForSelector('.modal-backdrop .btn.danger'); await t.click('.modal-backdrop .btn.danger'); await t.waitForTimeout(1200);
  const st3 = await t.evaluate(async (sid) => (await import('./src/teach.js')).getStudent(sid), sid);
  expect(!(st3.extra || []).length && st3.slot.hm === '20:00' && (st3.slots2 || []).length === 1, 'otkazan dodatni, termini ostaju', st3);
  await t.close();
}
