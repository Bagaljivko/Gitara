// v2.4.22: „Moje vežbanje“ (#/vezbanje) — nedelja/mesec/sve, vreme, dani i niz, stubići (pesme + vežbe), pesme sa
// vežbama i zvezdicama, igre; isti pregled kod nastavnika (#/vezbanje/<id>) iz učenikovog sažetka napretka (polje ov);
// bez deljenja — objašnjenje; telefon i računar bez izlaska van ekrana.
import { open, boot, addSong, expect, fakeDrive, overflowCheck } from '../lib.mjs';
export const name = 'Moje vežbanje + pregled kod nastavnika (nedelja/mesec/sve, pesme, igre)';
export const timeout = 200;
const SHOT = process.env.MARLI_SHOTS ? '/tmp/claude-0/-home-user/5acc3b3c-c7ec-5fc4-b0ba-484df35f0a2c/scratchpad/mk11/' : '';
export async function run(ctx) {
  const drive = {};
  const seed = async (p) => {
    const id = await addSong(p, { title: 'Tišina', artist: 'Bajaga' });
    const id2 = await addSong(p, { title: 'Ruža', artist: 'Bajaga' });
    await p.evaluate(async ([id, id2]) => {
      const { settings } = await import('./src/db.js'); const A = await import('./src/activity.js'); const d = A.dayNum();
      const days = {}; for (let k = 0; k < 40; k++) if (k % 3 !== 1) days[d - k] = { p: 600000 + k * 20000, x: 300000 };
      await settings.set('activity', { v: 1, dev: { dX: { s: { [id]: { p: 4800000, x: 900000, n: 9, last: Date.now(), d: [d] }, [id2]: { p: 1200000, x: 0, n: 2, last: Date.now(), d: [d - 2] } }, g: { promena: 1500000 }, days } } });
      const P = await import('./src/practice.js'); await P.saveResult('pesma', { score: 95, tempo: 80 }, [id, '1']); await P.saveResult('promena', { score: 85, tempo: 60 }, [id, 'chg']);
    }, [id, id2]);
  };
  for (const dev of ['phone', 'desk']) {
    const p = await open(ctx, dev); await boot(p, ctx, '#/tuner', 900); await seed(p);
    await p.go('#/vezbanje', 1500);
    const r = await p.evaluate(() => ({ h: document.querySelector('.ov-top h1')?.textContent, bars: document.querySelectorAll('.ov-bars > div').length, songs: [...document.querySelectorAll('.ov-row b')].map((b) => b.textContent), chips: [...document.querySelectorAll('.ov-chip')].map((c) => c.textContent), t: document.querySelector('.ov-st b')?.textContent }));
    expect(r.h === 'Moje vežbanje' && r.bars === 7 && r.songs[0] === 'Tišina' && r.songs[1] === 'Ruža' && r.chips.some((c) => /Promene/.test(c)) && r.chips.some((c) => /Refren/.test(c)), dev + ': pregled (nedelja)', r);
    if (SHOT && dev === 'phone') await p.screenshot({ path: SHOT + 'moje.png' });
    await p.click('[data-ov="m"]'); await p.waitForTimeout(300);
    expect(await p.evaluate(() => document.querySelectorAll('.ov-bars > div').length) === 30, dev + ': mesec = 30 dana');
    await p.click('[data-ov="a"]'); await p.waitForTimeout(300);
    expect(await p.evaluate(() => document.querySelectorAll('.ov-bars > div').length) === 12, dev + ': sve = 12 nedelja');
    const o = await overflowCheck(p); expect(!o.items.length, dev + ': izlazi van ekrana', o);
    await p.click('[data-ov="w"]');
  }
  // ---------- učenik deli napredak → nastavnik vidi isti pregled ----------
  const s = await open(ctx, 'phone'); await fakeDrive(s, drive); await boot(s, ctx, '#/tuner', 900); await seed(s);
  const sum = await s.evaluate(async () => { const P = await import('./src/progress.js'); return P.buildSummary(); });
  expect(sum.ov && sum.ov.s.length === 2 && sum.ov.d.length > 10, 'sažetak napretka nema pregled (ov)', sum.ov);
  drive.PROG = JSON.stringify({ type: 'progress', ...sum });
  const t = await open(ctx, 'phone'); await fakeDrive(t, drive); await boot(t, ctx, '#/tuner', 900);
  const ids = await t.evaluate(async () => { const M = await import('./src/teach.js'); await M.setTeacher({ on: true, name: 'Mile' }); const a = await M.addStudent({ name: 'Ana' }); await M.updateStudent(a.id, { prog: { fileId: 'PROG' }, box: { f: 'BX' } }); const b = await M.addStudent({ name: 'Marko' }); return [a.id, b.id]; });
  await t.go('#/ucenik/' + ids[0], 1200);
  expect(await t.$('a.sp-row[href^="#/vezbanje/"]'), 'nastavnik: na stranici učenika nema „Napredak“ (pregled vežbanja)');
  await t.click('a.sp-row[href^="#/vezbanje/"]'); await t.waitForTimeout(1800);
  const tv = await t.evaluate(() => ({ h: document.querySelector('.ov-top h1')?.textContent, songs: [...document.querySelectorAll('.ov-row b')].map((b) => b.textContent), note: document.querySelector('.ov-share')?.textContent || '' }));
  expect(tv.h === 'Ana — vežbanje' && tv.songs.includes('Tišina') && /deli napredak/.test(tv.note), 'nastavnik: pregled učenika', tv);
  if (SHOT) await t.screenshot({ path: SHOT + 'ana.png' });
  await t.go('#/vezbanje/' + ids[1], 1200);
  expect(/ne deli napredak/.test(await t.evaluate(() => document.querySelector('.ov-share')?.textContent || '')), 'nastavnik: učenik bez deljenja — objašnjenje');
  expect(!s.errs.length && !t.errs.length, 'greške', [s.errs, t.errs]);
}
