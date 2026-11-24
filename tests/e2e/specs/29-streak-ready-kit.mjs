// v2.4.10: dani zaredom sa štitom (Vežbe), spremne pesme (oznaka i grupa, telefon i računar), poređenje snimaka,
// paket za čas (PDF) za nastavnika.
import { open, boot, addSong, expect } from '../lib.mjs';
export const name = 'niz sa štitom, spremne pesme, poređenje snimaka, paket za čas (PDF)';
export const timeout = 240;
export async function run(ctx) {
  const p = await open(ctx, 'phone'); await boot(p, ctx);
  // niz: 8 dana zaredom (→ 1 štit), juče propušteno, danas ništa → štit čuva niz
  await p.evaluate(async () => {
    const A = await import('./src/activity.js'); const { settings } = await import('./src/db.js'); const today = A.dayNum();
    const days = {}; for (let d = today - 9; d <= today - 2; d++) days[d] = { p: 300000, x: 300000 };
    await settings.set('activity', { dev: { dTEST: { days, s: {}, g: {} } } });
  });
  await p.go('#/vezbe', 1800);
  const sk = await p.evaluate(() => document.querySelector('.st-streak')?.innerText || '');
  expect(/8 dana zaredom/.test(sk) && /Štit je sačuvao niz/.test(sk), 'niz sa štitom', sk);
  // spremne pesme
  const a = await addSong(p, { title: 'Spremna' }); await addSong(p, { title: 'Nije' });
  await p.evaluate(async (id) => { const { settings } = await import('./src/db.js'); await settings.set('practice', { songs: { [id]: { all: { best: 92 } } } }); }, a);
  await p.go('#/pesme', 1500);
  const badge = await p.evaluate(() => [...document.querySelectorAll('.song-item')].map((x) => x.innerText.replace(/\s+/g, ' ')).join(' | '));
  expect(/Spremna.*spremna/.test(badge) && !/Nije[^|]*spremna/.test(badge), 'oznaka „spremna“ u spisku', badge);
  expect(await p.$('[data-chip="auto:ready"]'), 'nema grupe „Spremne za svirku“');
  await p.click('[data-chip="auto:ready"]'); await p.waitForTimeout(400);
  expect(await p.evaluate(() => document.querySelectorAll('.song-item').length) === 1, 'grupa „Spremne“ ne filtrira');
  await p.go('#/pesma/' + a, 1500);
  expect(/Spremna za svirku/.test(await p.evaluate(() => document.querySelector('.sp-line')?.innerText || '')), 'pesma ne kaže „Spremna za svirku“');
  // poređenje snimaka
  const recIds = await p.evaluate(async () => {
    const { songs } = await import('./src/db.js'); const mk = (bpm, j) => { const P = 60000 / bpm, ev = []; for (let i = 0; i < 32; i++) ev.push({ t: Math.round(500 + i * P + (i % 2 ? j : -j)), chord: ['G', 'C', 'D', 'Em'][i % 4], notes: [] }); return { v: 1, dur: Math.round(500 + 32 * P), events: ev }; };
    const r1 = await songs.save({ title: 'Snimak 1', sections: [], recording: mk(80, 12), createdAt: Date.now() - 864e5 });
    const r2 = await songs.save({ title: 'Snimak 2', sections: [], recording: mk(100, 0), createdAt: Date.now() });
    return [r1.id, r2.id];
  });
  await p.go('#/pesma/' + recIds[1], 1800);
  expect(await p.$('#rcGo'), 'snimak: nema „Uporedi“');
  await p.click('#rcGo'); await p.waitForTimeout(400);
  await p.click('.modal-backdrop:last-of-type .btn.primary'); await p.waitForTimeout(600);
  const tbl = await p.evaluate(() => document.querySelector('.rc-tbl')?.innerText || '');
  expect(/Tempo/.test(tbl) && /100 BPM/.test(tbl) && /80 BPM/.test(tbl), 'tabela poređenja', tbl);
  // ---- nastavnik: paket za čas ----
  const q = await open(ctx, 'desk', { init: () => localStorage.setItem('marli-teach-tour', '1') }); await boot(q, ctx, '#/tuner', 900);
  const sid = await q.evaluate(async () => {
    const M = await import('./src/teach.js'); const { songs } = await import('./src/db.js');
    const tc = await M.setTeacher({ on: true, name: 'Profa Mika' });
    const s = await M.addStudent({ name: 'Ana' });
    const song = await songs.save({ title: 'Pesma za čas', artist: 'Bajaga', sections: [{ name: 'Strofa', lines: [{ text: 'La la', chords: [{ pos: 0, position: 0, chord: 'G' }] }] }] });
    await M.updateStudent(s.id, { notes: [{ id: 'n1', at: Date.now(), did: 'G i C', hw: 'Pauk 10 min' }], goal: 120, next: Date.now() + 3 * 864e5 });
    await M.setTeacher({ ...tc, sentLog: [{ sid: s.id, at: Date.now(), songs: [{ id: song.id, t: song.title, a: song.artist }] }] });
    return s.id;
  });
  await q.go('#/ucenik/' + sid, 1800);
  await q.click('#tLes [data-l="kit"]'); await q.waitForTimeout(500);
  expect(await q.evaluate(() => document.querySelectorAll('.les-kit .bulk-it.on').length) === 1, 'paket: poslata pesma nije izabrana');
  const dl = q.waitForEvent('download', { timeout: 30000 });
  await q.click('.modal-backdrop:last-of-type .btn.primary');
  const file = await dl;
  expect(/\.pdf$/.test(file.suggestedFilename()) && /Ana/.test(file.suggestedFilename()), 'paket: PDF', file.suggestedFilename());
  const pages = await q.evaluate(async () => { const P = await import('./src/pdf.js'); const b = await P.kitToPdf({ title: 'T', blocks: [{ label: 'X', text: 'Y' }], songs: [{ title: 'A', sections: [] }, { title: 'B', sections: [] }] }); return (await b.text()).match(/\/Type\s*\/Page[^s]/g)?.length || 0; });
  expect(pages === 3, 'paket: prva strana + strana po pesmi', pages);
}
