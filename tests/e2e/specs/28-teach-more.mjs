// v2.4.9: nastava — sve beleške + kopiraj domaći (prošli domaći), cilj vežbanja od nastavnika (učeniku na „Ova nedelja“),
// više učenika odjednom (beleška / cilj / podsetnik), prečice na stranici učenika na računaru.
import { open, boot, expect, fakeDrive } from '../lib.mjs';
export const name = 'nastava: sve beleške i kopiraj domaći, cilj vežbanja, više učenika odjednom, prečice (telefon i računar)';
export const timeout = 300;
const primary = (p) => p.click('.modal-backdrop:last-of-type .btn.primary');
export async function run(ctx) {
  for (const dev of ['phone', 'desk']) await flow(ctx, dev);
}
async function flow(ctx, dev) {
  const drive = {};
  const T = await open(ctx, dev, { init: () => localStorage.setItem('marli-teach-tour', '1') });
  await fakeDrive(T, drive);
  await boot(T, ctx, '#/tuner', 900);
  const ids = await T.evaluate(async () => {
    const M = await import('./src/teach.js'); const tc = await M.setTeacher({ on: true, name: 'Profa Mika' });
    const a = await M.addStudent({ name: 'Ana' }); await M.updateStudent(a.id, { box: { f: 'BOX_ANA', at: Date.now() } });
    const b = await M.addStudent({ name: 'Boris' }); await M.updateStudent(b.id, { box: { f: 'BOX_BOR', at: Date.now() } });
    const c = await M.addStudent({ name: 'Ceca' }); // nije povezana (nema sanduče)
    return { tid: tc.id, a: a.id, b: b.id, c: c.id };
  });
  await T.go('#/ucenik/' + ids.a, 1500);
  // prva beleška
  await T.click('#tLes [data-l="note"]'); await T.waitForTimeout(400);
  expect(!(await T.$('#lnLast')), dev + ': „prošli domaći“ bez ijednog domaćeg');
  await T.fill('#lnDid', 'Akordi G i C'); await T.fill('#lnHw', 'Pauk 10 min dnevno'); await primary(T); await T.waitForTimeout(900);
  // druga beleška: „↺ prošli domaći“ upisuje prethodni
  await T.click('#tLes [data-l="note"]'); await T.waitForTimeout(400);
  await T.click('#lnLast'); await T.waitForTimeout(100);
  expect(await T.inputValue('#lnHw') === 'Pauk 10 min dnevno', dev + ': „prošli domaći“ ne upisuje domaći');
  await T.fill('#lnDid', 'Ritam D-DU'); await primary(T); await T.waitForTimeout(900);
  // sve beleške → kopiraj domaći → nova beleška sa tim domaćim
  await T.click('#tLes [data-l="hist"]'); await T.waitForTimeout(400);
  expect(await T.evaluate(() => document.querySelectorAll('.les-hist .les-h').length) === 2, dev + ': sve beleške');
  await T.click('.les-hist [data-hcopy]'); await T.waitForTimeout(500);
  expect(await T.inputValue('#lnHw') === 'Pauk 10 min dnevno', dev + ': kopiraj domaći');
  await T.fill('#lnDid', 'Treći čas'); await primary(T); await T.waitForTimeout(900);
  expect(await T.evaluate(async (id) => ((await (await import('./src/teach.js')).getStudent(id)).notes || []).length, ids.a) === 3, dev + ': kopija nije nova beleška');
  // cilj vežbanja
  await T.click('#tLes [data-l="goal"]'); await T.waitForTimeout(400);
  await T.click('.modal-backdrop:last-of-type .btn:has-text("2 h")'); await T.waitForTimeout(900);
  expect(/120 min/.test(await T.evaluate(() => document.querySelector('#tLes [data-l="goal"]')?.innerText || '')), dev + ': cilj se ne vidi na stranici učenika');
  await T.pullDrive();
  expect(JSON.parse(drive.BOX_ANA).items.some((i) => i.kind === 'goal' && i.min === 120), dev + ': cilj nije u sandučetu');
  // prečice (računar): N otvara belešku, → sledeći učenik
  if (dev === 'desk') {
    expect(await T.$('.tch-keys'), 'računar: nema spiska prečica');
    await T.mouse.click(5, 300); await T.keyboard.press('n'); await T.waitForTimeout(400);
    expect(await T.$('#lnDid'), 'N ne otvara belešku'); await T.keyboard.press('Escape'); await T.waitForTimeout(300);
    await T.keyboard.press('ArrowRight'); await T.waitForTimeout(1200);
    expect(decodeURIComponent(await T.evaluate(() => location.hash)).includes(ids.b), '→ ne vodi na sledećeg učenika', await T.evaluate(() => location.hash));
  }
  // više učenika: beleška za Anu, Borisa i Cecu (Ceca nije povezana)
  await T.go('#/ucenici', 2000);
  await T.click(dev === 'desk' ? '#dGroup' : '#tGroup'); await T.waitForTimeout(400);
  await T.click('#lgAll'); await T.waitForTimeout(100);
  await T.click('.modal-backdrop:last-of-type .btn.primary'); await T.waitForTimeout(400); // 📝 Beleška
  await T.fill('#lnHw', 'Svi: skala C-dur'); await primary(T); await T.waitForTimeout(1500);
  expect(/2 od 3/.test(await T.evaluate(() => document.getElementById('toast')?.textContent || '')), dev + ': poruka posle slanja grupi', await T.evaluate(() => document.getElementById('toast')?.textContent));
  await T.pullDrive();
  expect(JSON.parse(drive.BOX_BOR).items.some((i) => i.kind === 'note' && i.hw === 'Svi: skala C-dur') && JSON.parse(drive.BOX_ANA).items.some((i) => i.kind === 'note' && i.hw === 'Svi: skala C-dur'), dev + ': grupna beleška nije stigla u sanduče');
  // ---- učenik (Ana): cilj na „Ova nedelja“ + ranije beleške ----
  const S = await open(ctx, dev);
  await fakeDrive(S, drive);
  await boot(S, ctx, '#/tuner', 900);
  await S.evaluate(async (ids) => { const M = await import('./src/teach.js'); await M.setMyTeacher({ name: 'Profa Mika', tid: ids.tid, sid: ids.a, box: 'BOX_ANA' }); const B = await import('./src/teachBox.js'); await B.checkBox({ force: true }); }, ids);
  expect(await S.evaluate(async () => (await import('./src/db.js')).settings.get('weekGoal', 0)) === 120, dev + ': učenik nema cilj od nastavnika');
  await S.go('#/vezbe', 1800);
  expect(/od nastavnika/.test(await S.evaluate(() => document.querySelector('#stWeek')?.innerText || '')), dev + ': „Ova nedelja“ ne kaže da je cilj od nastavnika', await S.evaluate(() => document.querySelector('#stWeek')?.innerText));
  await S.go('#/od-nastavnika', 1800);
  await S.click('.les-card [data-lhist]'); await S.waitForTimeout(400);
  expect(await S.evaluate(() => document.querySelectorAll('.les-hist .les-h').length) >= 3, dev + ': učenik ne vidi ranije beleške');
  ctx.note.push(dev + ' ✓');
}
