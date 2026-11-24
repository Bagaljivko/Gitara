// v2.4.3: podsetnik za vežbanje, pregled posle vežbanja (i slanje nastavniku), komentar nastavnika na snimak (tekst + glas).
import { open, boot, expect, fakeDrive, fakeMic } from '../lib.mjs';
export const name = 'podsetnik za vežbanje, pregled posle vežbanja, komentar na snimak (tekst + glas) — telefon i računar';
export const timeout = 400;
const bell = (p) => p.evaluate(async () => ((await (await import('./src/db.js')).settings.get('notes', [])) || []).map((n) => n.t + ' — ' + n.s).join(' | '));
export async function run(ctx) { for (const dev of ['phone', 'desk']) await flow(ctx, dev); }
async function flow(ctx, dev) {
  const drive = {};
  // ---- podsetnik: vreme je prošlo, danas nije vežbano → zvonce; dugme na kartici nedelje ----
  const R = await open(ctx, dev, { init: () => { if (!localStorage.getItem('__remSet')) { localStorage.setItem('__remSet', '1'); indexedDB.deleteDatabase('x'); } } });
  await boot(R, ctx, '#/tuner', 600);
  await R.evaluate(async () => { const { settings } = await import('./src/db.js'); await settings.set('remindCfg', { on: true, h: 0, m: 0 }); (await import('./src/remind.js')).initRemind(); });
  await R.waitForTimeout(1500);
  expect(/Vreme je za gitaru/.test(await bell(R)), dev + ': podsetnik nije stigao u zvonce', await bell(R));
  await R.go('#/vezbe', 1800);
  expect(/Podsetnik u 0:00/.test(await R.evaluate(() => document.getElementById('stRemind')?.textContent || '')), dev + ': nema dugmeta podsetnika na kartici nedelje');
  await R.click('#stRemind'); await R.waitForTimeout(400); await R.fill('#remTime', '19:30'); await R.click('.modal-backdrop .btn.primary'); await R.waitForTimeout(800);
  expect(/19:30/.test(await R.evaluate(() => document.getElementById('stRemind')?.textContent || '')), dev + ': vreme podsetnika se ne čuva');
  // ---- nastavnik + učenik (komentar, pregled) ----
  const T = await open(ctx, dev, { init: () => localStorage.setItem('marli-teach-tour', '1') }); await fakeDrive(T, drive); await boot(T, ctx, '#/tuner', 800);
  const ids = await T.evaluate(async () => { const M = await import('./src/teach.js'); const tc = await M.setTeacher({ on: true, name: 'Profa Mika' }); const s = await M.addStudent({ name: 'Ana' }); await M.updateStudent(s.id, { box: { f: 'BOX_A', at: Date.now() }, prog: { fileId: 'PROG_A' } });
    const { songs } = await import('./src/db.js'); const rec = await songs.save({ title: 'Moj snimak', artist: 'Ana', student: s.id, fromStudent: 1, src: 'RECF:0', sections: [{ name: 'S', type: 'verse', lines: [{ text: 'aa', chords: [{ pos: 0, position: 0, chord: 'G' }] }] }] });
    return { tid: tc.id, sid: s.id, rec: rec.id }; });
  await T.context().grantPermissions(['microphone']); await T.addInitScript(fakeMic); await T.reload(); await T.waitForTimeout(900);
  await T.go('#/pesma/' + ids.rec, 1600);
  expect(await T.$('#sRecCmt #cmNew'), dev + ': nema dugmeta „Komentar za“ na snimku učenika');
  await T.click('#cmNew'); await T.waitForTimeout(400);
  await T.fill('#cmText', 'Ritam je odličan, uspori C–G.');
  await T.click('#cmRec'); await T.evaluate(() => window.__tone && window.__tone(57)); await T.waitForTimeout(1600); await T.evaluate(() => window.__tone && window.__tone(null)); await T.click('#cmRec'); await T.waitForTimeout(600);
  expect(await T.evaluate(() => /Glasovna poruka: \d+ s/.test(document.getElementById('cmState')?.textContent || '')), dev + ': glasovna poruka nije snimljena', await T.evaluate(() => document.getElementById('cmState')?.textContent));
  await T.click('.modal-backdrop .btn.primary'); await T.waitForTimeout(1500);
  const cm = JSON.parse(drive.BOX_A || '{}').items?.find((i) => i.kind === 'cmt');
  expect(cm && cm.text && cm.voice && cm.f === 'RECF' && JSON.parse(drive[cm.voice] || '{}').type === 'voice', dev + ': komentar sa glasom nije u sandučetu', cm);
  // učenik: njegov snimak (poslat kao fajl RECF) → komentar na tom snimku
  const S = await open(ctx, dev); await fakeDrive(S, drive); await boot(S, ctx, '#/tuner', 800);
  const mine = await S.evaluate(async (ids) => { const { songs } = await import('./src/db.js'); const r = await songs.save({ title: 'Moj snimak', artist: 'Ana', sections: [{ name: 'S', type: 'verse', lines: [{ text: 'aa', chords: [] }] }] });
    const M = await import('./src/teach.js'); await M.setMyTeacher({ name: 'Profa Mika', tid: ids.tid, sid: ids.sid, box: 'BOX_A', prog: { on: true, fileId: 'PROG_A' }, out: [{ type: 'file', id: 'f1', f: 'RECF', song: r.id, at: Date.now() }] });
    await (await import('./src/teachBox.js')).checkBox({ force: true }); return r.id; }, ids);
  expect(/komentar na tvoj snimak/.test(await bell(S)), dev + ': učenik nije dobio zvonce za komentar', await bell(S));
  await S.go('#/pesma/' + mine, 1800);
  const card = await S.evaluate(() => document.querySelector('#sRecCmt')?.innerText || '');
  expect(/uspori C–G/.test(card) && /Glasovna poruka/.test(card), dev + ': komentar se ne vidi na snimku', card);
  await S.click('#sRecCmt .cmt-play'); await S.waitForTimeout(800);
  await S.click('#sRecCmt [data-react="like"]'); await S.waitForTimeout(2000);
  // ---- pregled posle vežbanja: 6 min danas → izlaz iz vežbe → pregled → pošalji nastavniku ----
  await S.go('#/vezbe/pauk', 1500);
  await S.evaluate(async () => { const { settings } = await import('./src/db.js'); const A = await import('./src/activity.js'); const a = (await settings.get('activity', null)) || { dev: {} }; a.dev = { ...(a.dev || {}), dTEST: { days: { [A.dayNum()]: { p: 0, x: 6 * 60000 } } } }; await settings.set('activity', a); });
  await S.go('#/tuner', 2000);
  const ses = await S.evaluate(() => document.querySelector('.ses-dlg')?.innerText || '');
  expect(/Danas: 6 min/.test(ses), dev + ': nema pregleda posle vežbanja', ses);
  await S.click('.modal-backdrop .btn.primary'); await S.waitForTimeout(2000);
  const out = JSON.parse(drive.PROG_A || '{}').out || [];
  expect(out.some((o) => o.type === 'session' && o.min === 6) && out.some((o) => o.type === 'react' && o.key === cm.key), dev + ': pregled/odgovor nije u fajlu napretka', out);
  await T.evaluate(async (sid) => { const M = await import('./src/teach.js'); await (await import('./src/progress.js')).studentProgress(await M.getStudent(sid), { fresh: true }); }, ids.sid);
  expect(/6 min vežbanja danas/.test(await bell(T)), dev + ': nastavnik nije dobio pregled', await bell(T));
  await T.go('#/tuner', 300); await T.go('#/pesma/' + ids.rec, 1500);
  expect(/Važi/.test(await T.evaluate(() => document.querySelector('#sRecCmt')?.innerText || '')), dev + ': nastavnik ne vidi odgovor na komentar');
  ctx.note.push(dev + ' ✓');
}
