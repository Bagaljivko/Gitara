// Časovi (v2.4.2): nastavnik zakaže čas i pošalje belešku sa domaćim → učenik vidi karticu i brzo odgovori →
// nastavnik vidi „viđeno“ i odgovor (zvonce); „Ne vežba nedelju dana“ + „Podseti“ → podsetnik stiže učeniku.
import { open, boot, expect, fakeDrive } from '../lib.mjs';
export const name = 'časovi: sledeći čas, beleška + domaći, brz odgovor, viđeno, „ne vežba“ + Podseti (nastavnik ↔ učenik), telefon i računar';
export const timeout = 300;
export async function run(ctx) {
  for (const dev of ['phone', 'desk']) await flow(ctx, dev);
}
async function flow(ctx, dev) {
  const drive = {};
  // ---- nastavnik ----
  const T = await open(ctx, dev, { init: () => localStorage.setItem('marli-teach-tour', '1') });
  await fakeDrive(T, drive);
  await boot(T, ctx, '#/tuner', 900);
  const ids = await T.evaluate(async () => { const M = await import('./src/teach.js'); const tc = await M.setTeacher({ on: true, name: 'Profa Mika' }); const s = await M.addStudent({ name: 'Ana' }); await M.updateStudent(s.id, { box: { f: 'BOX_ANA', at: Date.now() }, prog: { fileId: 'PROG_ANA' } }); return { tid: tc.id, sid: s.id }; });
  await T.go('#/ucenik/' + ids.sid, 1500);
  expect(await T.$('#tLes [data-l="next"]'), dev + ': nema odeljka Časovi na stranici učenika');
  // sledeći čas: za 20 sati (podsetnik dan ranije)
  await T.click('#tLes [data-l="next"]'); await T.waitForTimeout(400);
  const when = await T.evaluate(() => { const d = new Date(Date.now() + 20 * 3600e3); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; });
  await T.fill('#lnWhen', when); await T.click('.modal-backdrop .btn.primary'); await T.waitForTimeout(800);
  // beleška sa časa
  await T.click('#tLes [data-l="note"]'); await T.waitForTimeout(400);
  await T.fill('#lnDid', 'G–C promene, strum D-DU'); await T.fill('#lnHw', 'Pauk 10 min dnevno'); await T.click('.modal-backdrop .btn.primary'); await T.waitForTimeout(1200);
  await T.pullDrive();
  const box = JSON.parse(drive.BOX_ANA || '{}');
  expect((box.items || []).some((i) => i.kind === 'note' && i.hw === 'Pauk 10 min dnevno') && (box.items || []).some((i) => i.kind === 'lesson' && i.next > Date.now()), 'sanduče nema belešku i čas', box.items);
  expect(await T.evaluate(() => /nije viđeno/.test(document.querySelector('#tLes')?.innerText || '')), 'beleška bez statusa „nije viđeno“');
  // ---- učenik ----
  const S = await open(ctx, dev);
  await fakeDrive(S, drive);
  await boot(S, ctx, '#/tuner', 900);
  await S.evaluate(async (ids) => { const M = await import('./src/teach.js'); await M.setMyTeacher({ name: 'Profa Mika', tid: ids.tid, sid: ids.sid, box: 'BOX_ANA', prog: { on: true, fileId: 'PROG_ANA' } }); const B = await import('./src/teachBox.js'); await B.checkBox({ force: true }); }, ids);
  await S.go('#/od-nastavnika', 1800);
  const card = await S.evaluate(() => document.querySelector('.les-card')?.innerText || '');
  expect(/Sledeći čas/.test(card) && /Pauk 10 min dnevno/.test(card), 'učenik ne vidi sledeći čas i domaći', card);
  await S.click('.les-card [data-react="ok"]'); await S.waitForTimeout(2500);
  const bell = await S.evaluate(async () => ((await (await import('./src/db.js')).settings.get('notes', [])) || []).map((n) => n.t).join(' | '));
  expect(/beleška sa časa/.test(bell), 'učenik nije dobio zvonce za belešku', bell);
  // Vežbe: ista kartica u Nastavi
  await S.go('#/vezbe', 1800);
  expect(await S.evaluate(() => /Pauk 10 min/.test(document.querySelector('#prTeach')?.innerText || '')), 'domaći se ne vidi na Vežbama');
  await S.pullDrive();
  const prog = JSON.parse(drive.PROG_ANA || '{}');
  expect((prog.out || []).some((o) => o.type === 'react' && o.r === 'ok') && (prog.out || []).some((o) => o.type === 'seen'), 'fajl napretka nema odgovor i viđeno', prog.out);
  // ---- nastavnik čita napredak ----
  await T.evaluate(async (sid) => { const M = await import('./src/teach.js'); const st = await M.getStudent(sid); await (await import('./src/progress.js')).studentProgress(st, { fresh: true }); }, ids.sid);
  await T.go('#/tuner', 400); await T.go('#/ucenik/' + ids.sid, 1500);
  const st = await T.evaluate(() => document.querySelector('#tLes')?.innerText || '');
  expect(/Vežbaću/.test(st), 'nastavnik ne vidi odgovor „Vežbaću“', st);
  const tbell = await T.evaluate(async () => ((await (await import('./src/db.js')).settings.get('notes', [])) || []).map((n) => n.t).join(' | '));
  expect(/vežbaće/.test(tbell), 'nastavnik nije dobio zvonce za odgovor', tbell);
  // ---- ne vežba nedelju dana → Podseti ----
  drive.PROG_ANA = JSON.stringify({ ...prog, lastDay: (prog.today || 20000) - 9, out: [] });
  await T.evaluate(async (sid) => { const M = await import('./src/teach.js'); const st = await M.getStudent(sid); await (await import('./src/progress.js')).studentProgress(st, { fresh: true }); }, ids.sid);
  await T.go('#/ucenici', 2500);
  expect(await T.$('#tIdle [data-nudge]'), dev + ': nema „Ne vežba nedelju dana“ sa dugmetom Podseti', await T.evaluate(() => document.querySelector('#tIdle')?.innerText));
  if (dev === 'desk') expect(!(await T.evaluate(() => /Sve je u redu/.test(document.querySelector('#tIdle')?.closest('.db-card')?.innerText || ''))), 'računar: „Sve je u redu“ iznad spiska ko ne vežba');
  await T.click('#tIdle [data-nudge]'); await T.waitForTimeout(1200);
  await T.pullDrive();
  expect(JSON.parse(drive.BOX_ANA).items.some((i) => i.kind === 'nudge'), 'podsetnik nije u sandučetu');
  await S.evaluate(async () => { const B = await import('./src/teachBox.js'); await B.checkBox({ force: true }); });
  const sb = await S.evaluate(async () => ((await (await import('./src/db.js')).settings.get('notes', [])) || []).map((n) => n.t).join(' | '));
  expect(/podseća da vežbaš/.test(sb), 'učenik nije dobio podsetnik', sb);
  ctx.note.push(dev + ' ✓');
}
