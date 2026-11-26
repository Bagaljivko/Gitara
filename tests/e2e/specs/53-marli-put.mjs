// v2.5.2: MARLI put stiže sam — 30 pesama u Pesme (MARLI znak, čip „MARLI put“), 3 nivoa u Kursevi; stranica pesme:
// red kursa i „Saveti sa lista“ (Pazi na → Promene); spisak bez tonaliteta/kapodastera; dvaput pokrenuto = bez duplikata;
// obrisana pesma se ne vraća.
import { open, boot, expect, eq } from '../lib.mjs';
export const name = 'MARLI put: pesme i nivoi stižu sami, čip, red kursa, Saveti, bez duplikata, obrisana se ne vraća';
export const timeout = 120;

export async function run(ctx) {
  const p = await open(ctx, 'phone', { marli: true }); await boot(p, ctx, '#/pesme', 900);
  let n = 0;
  for (let i = 0; i < 40 && n < 30; i++) { await p.waitForTimeout(500); n = await p.evaluate(async () => (await (await import('./src/db.js')).songs.all()).filter((s) => /^marli-L/.test(s.id)).length); }
  eq(n, 30, 'MARLI put pesme u Pesme');
  await p.go('#/pesme', 1500);
  const lst = await p.evaluate(() => ({ chip: !!document.querySelector('[data-chip="course:marli"]'), keys: document.querySelectorAll('.song-item .key').length, capo: [...document.querySelectorAll('.song-item .badge-sm')].filter((b) => /kapo|capo/i.test(b.textContent)).length, logos: document.querySelectorAll('.song-item .marli-mark').length }));
  expect(lst.chip && lst.keys === 0 && lst.capo === 0 && lst.logos >= 5, 'spisak: čip MARLI put, bez tonaliteta i kapodastera, MARLI znak', lst);
  await p.click('[data-chip="course:marli"]'); await p.waitForTimeout(600);
  eq(await p.evaluate(() => document.querySelectorAll('.song-item').length), 30, 'čip MARLI put prikazuje samo te pesme');
  // Kursevi
  await p.go('#/vezbe?t=k', 1800);
  const crs = await p.evaluate(() => [...document.querySelectorAll('#prCourses .crs-card b')].map((b) => b.textContent));
  eq(crs.slice(0, 3), ['MARLI put · Nivo 1', 'MARLI put · Nivo 2', 'MARLI put · Nivo 3'], 'tri nivoa u Kursevi');
  // stranica pesme
  await p.go('#/pesma/marli-L1-07', 2500);
  const sp = await p.evaluate(() => ({ row: document.querySelector('#sCourseRow')?.innerText.replace(/\s+/g, ' ') || '', tips: document.querySelector('#sTips')?.innerText.replace(/\s+/g, ' ') || '', notes: [...document.querySelectorAll('#sLyrics > .sec:not([hidden])')].some((s) => /beleške/i.test(s.innerText)) }));
  expect(/MARLI put · Nivo 1/.test(sp.row) && /pesma 7 od 10/.test(sp.row), 'red kursa na pesmi', sp.row);
  expect(/Saveti sa lista/i.test(sp.tips) && /Pazi na/.test(sp.tips) && /Novo u pesmi/.test(sp.tips) && !sp.notes, 'Saveti sa lista (srpski), bez „Beleške“', sp);
  await p.click('#sTips [data-tip="chg"]'); await p.waitForTimeout(800);
  expect(/#\/vezbe\/promena\?song=marli-L1-07&ch=D-Am&k=chg/.test(await p.evaluate(() => location.hash)), 'Pazi na → Promene D → Am', await p.evaluate(() => location.hash));
  // dvaput = bez duplikata; obrisana pesma se ne vraća (ni kad se nivo doda ponovo)
  const r = await p.evaluate(async () => {
    const { songs, settings } = await import('./src/db.js'); const C = await import('./src/coursesView.js'); const K = await import('./src/courses.js');
    await C.ensureMarli(); const c1 = (await K.getCourses()).length;
    await songs.remove('marli-L1-01');
    await settings.set('marliAdded', []); await settings.set('courses', []);
    await C.ensureMarli();
    const all = await songs.all();
    return { c1, c2: (await K.getCourses()).length, back: all.some((s) => s.id === 'marli-L1-01'), n: all.filter((s) => s.marli).length, dup: all.length - new Set(all.map((s) => s.title + '|' + s.artist)).size };
  });
  expect(r.c1 === 3 && r.c2 === 3 && !r.back && r.n === 29 && r.dup === 0, 'bez duplikata, obrisana se ne vraća', r);
  await p.close();
}
