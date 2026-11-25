// v2.4.25: učenik → nastavnik: pesma („Pošalji nastavniku“, „Proveri sa nastavnikom“) ide u samom fajlu napretka —
// bez deljenog fajla na Drive-u; nastavnik je prima kod tog učenika, a učenik dobija „primio ✓“.
import { open, boot, addSong, expect, fakeDrive } from '../lib.mjs';
export const name = 'učenik → nastavnik: pesma u fajlu napretka (bez deljenog fajla), proveri pesmu, primljeno';
export const timeout = 200;
export async function run(ctx) {
  const drive = {};
  const s = await open(ctx, 'phone'); await fakeDrive(s, drive); await boot(s, ctx, '#/tuner', 900);
  const sid = await addSong(s, { title: 'Moja pesma', artist: 'Ana' });
  await s.evaluate(async (id) => {
    window.__marliTest = { ...(window.__marliTest || {}), publish: async () => { throw new Error('deljeni fajl ne sme da se koristi'); } };
    const M = await import('./src/teach.js'); await M.setMyTeacher({ name: 'Mile', tid: 'T1', sid: 'S1', box: 'BOX', prog: { on: true, fileId: 'PROG', mode: 'drive' } });
    const { songs } = await import('./src/db.js'); const song = await songs.get(id);
    const V = await import('./src/teachView.js'); await V.sendToTeacher(song);
    await M.askCheck(song, 'Da li je refren dobro?');
  }, sid);
  await s.pullDrive?.();
  const prog = JSON.parse(drive.PROG || '{}');
  const out = (prog.out || []);
  expect(out.some((o) => o.type === 'file' && o.d && !o.f) && out.some((o) => o.type === 'check' && o.d && !o.f), 'pesma nije u fajlu napretka (ili je korišćen deljeni fajl)', out.map((o) => ({ type: o.type, f: o.f, d: !!o.d })));
  expect(!s.errs.length, 'učenik: greške', s.errs);
  // ---------- nastavnik ----------
  const t = await open(ctx, 'phone'); await fakeDrive(t, drive); await boot(t, ctx, '#/tuner', 900);
  const r = await t.evaluate(async () => {
    const M = await import('./src/teach.js'); await M.setTeacher({ on: true, name: 'Mile' });
    const a = await M.addStudent({ name: 'Ana' }); await M.updateStudent(a.id, { box: { f: 'BOX' }, prog: { fileId: 'PROG' } });
    const P = await import('./src/progress.js'); await P.studentProgress(await M.getStudent(a.id), { fresh: true });
    const { songs } = await import('./src/db.js'); const got = (await songs.list()).filter((x) => x.title === 'Moja pesma');
    const full = got[0] ? await songs.get(got[0].id) : null;
    const req = (await M.getRequests()).find((q) => q.type === 'check');
    const B = await import('./src/teachBox.js'); const pkg = req && req.d ? await B.readInline(req.d) : null;
    return { n: got.length, student: full && full.student === a.id, req: !!req, note: req && req.note, pkgTitle: pkg && pkg.songs[0].title, notes: (await (await import('./src/notify.js')).list()).map((x) => x.t) };
  });
  expect(r.n === 1 && r.student, 'nastavnik: pesma nije stigla kod učenika', r);
  expect(r.req && r.note === 'Da li je refren dobro?' && r.pkgTitle === 'Moja pesma', 'nastavnik: „proveri pesmu“ nije stiglo', r);
  const box = JSON.parse(drive.BOX || '{}');
  expect((box.items || []).some((x) => x.kind === 'rcv'), 'učenik ne dobija „primio ✓“', box.items);
  expect(await t.evaluate(async () => !((await (await import('./src/teach.js')).getStudents())[0].sent || []).some((x) => x.kind === 'rcv')), 'potvrda „primio“ se vidi kao poslata pesma');
  if (process.env.MARLI_SHOTS) { const id = await t.evaluate(async () => (await (await import('./src/teach.js')).getStudents())[0].id); await t.go('#/ucenik/' + id, 1500); await t.evaluate(() => document.querySelector('.tch-reqs, .tch-sec:last-of-type')?.scrollIntoView({ block: 'start' })); await t.waitForTimeout(300); await t.screenshot({ path: process.env.MARLI_SHOTS + 'nastavnik.png' }); }
  expect(!t.errs.length, 'nastavnik: greške', t.errs);
}
