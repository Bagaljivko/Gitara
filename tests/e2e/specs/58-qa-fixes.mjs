// v2.5.64 (QA): obrisana pesma izlazi iz kursa (i vraća se sa „Poništi“), spajanje pomera kurs na pesmu koja ostaje,
// kartica kursa ne kaže „sve spremno“ kad sledeća fali; oštećena kopija ne ruši Učenike; Raspored posle promene vremena;
// Moji snimci se sinhronizuju; prazna pesma / nema pesme / loš link; dugačka reč se prelama; „‹ Pesme“ = korak nazad.
import { open, boot, expect, eq, overflowCheck } from '../lib.mjs';
export const name = 'QA popravke: kurs i brisanje, spajanje, oštećena kopija, raspored (DST), prazna pesma, loš link, nazad';
export const timeout = 150;
export async function run(ctx) {
  const p = await open(ctx, 'phone'); await boot(p, ctx, '#/pesme', 900);
  // kurs: brisanje + Poništi, spajanje
  const r = await p.evaluate(async () => {
    const { songs, settings } = await import('./src/db.js'); const K = await import('./src/courses.js');
    const mk = async (t) => (await songs.save({ title: t, artist: 'A', sections: [{ name: 'S', lines: [{ text: 'tekst ' + t, chords: [{ position: 0, chord: 'G' }] }] }] })).id;
    const a = await mk('Jedan'), b = await mk('Dva'), c = await mk('Tri');
    const crs = await K.addCourse('Kurs', [{ s: a }, { s: b }, { s: c }]);
    const before = await K.dropSongs([a]);
    const after1 = (await K.getCourse(crs.id)).items.map((x) => x.s);
    await K.restoreCourses(before);
    const after2 = (await K.getCourse(crs.id)).items.map((x) => x.s);
    const M = await import('./src/songMerge.js'); const res = await M.mergeSongs(b, c);
    const after3 = (await K.getCourse(crs.id)).items.map((x) => x.s);
    return { a, b, c, after1, after2, after3, kept: res && res.id };
  });
  eq(r.after1, [r.b, r.c], 'obrisana pesma ostala u kursu'); eq(r.after2, [r.a, r.b, r.c], '„Poništi“ ne vraća kurs');
  expect(r.after3.length === 2 && r.after3.includes(r.kept) && r.after3[0] === r.a, 'spajanje: kurs ne pokazuje na pesmu koja ostaje', r);
  // kartica kursa sa obrisanom pesmom (preko sinhronizacije — bez Poništi)
  await p.evaluate(async (id) => { const { songs } = await import('./src/db.js'); await songs.remove(id); }, r.a);
  await p.go('#/vezbe?t=k', 1500);
  const card = await p.evaluate(() => document.querySelector('#prCourses .crs-card')?.innerText.replace(/\s+/g, ' ') || '');
  expect(/sledeća:/.test(card) && !/sve pesme su spremne/.test(card), 'kartica kursa „sve spremno“ iako sledeća fali', card);
  // oštećena kopija: učenici kao tekst → preskače se
  await p.evaluate(async () => { const B = await import('./src/backups.js'); const d = await B.buildFull(); d.settings = { ...d.settings, students: 'x', activity: 'q' }; await B.applyFull(d); });
  await p.go('#/ucenici', 1200);
  const uc = await p.evaluate(async () => ({ h: document.querySelector('.view h1')?.textContent || '', st: typeof (await (await import('./src/db.js')).settings.get('students', [])) }));
  expect(/Učenici/.test(uc.h) && uc.st !== 'string', 'oštećena kopija pokvarila Učenike', uc);
  // Raspored: nedelja od ponedeljka do nedelje (i posle promene vremena — test vremenske zone u lib)
  await p.go('#/raspored?w=1', 1200);
  const wk = await p.evaluate(() => { const h = document.querySelector('.sch-wk b')?.textContent || ''; const days = [...document.querySelectorAll('.sch-days7 button b')].map((b) => +b.textContent); return { h, first: days[0], last: days[6] }; });
  expect(wk.h.startsWith(wk.first + '.') && wk.h.includes('– ' + wk.last + '.'), 'raspored: naslov nedelje i dani se ne slažu', wk);
  // Moji snimci se sinhronizuju; datum dnevne kopije lokalni
  const sy = await p.evaluate(async () => (await import('./src/db.js')).WHOLE_KEYS.includes('freeplayRecs'));
  expect(sy, 'Moji snimci (Samo sviraj) se ne sinhronizuju');
  // prazna pesma, nema pesme
  const empty = await p.evaluate(async () => (await (await import('./src/db.js')).songs.save({ title: '', artist: '', sections: [] })).id);
  await p.go('#/pesma/' + empty, 1500);
  const ep = await p.evaluate(() => ({ h: document.querySelector('.song-h1')?.textContent, card: !!document.querySelector('.song-empty'), path: !!document.querySelector('.sp-line'), bar: document.querySelector('#sScrollBar')?.hidden }));
  expect(ep.h === 'Bez naslova' && ep.card && !ep.path && ep.bar, 'prazna pesma', ep);
  await p.go('#/pesma/nema-je', 1000);
  expect(await p.evaluate(() => /Nema pesme/.test(document.querySelector('.view h1')?.textContent || '') && !!document.querySelector('.view .back')), 'Nema pesme bez izgleda aplikacije');
  // dugačka reč se prelama (bez izlaska van ekrana)
  const lw = await p.evaluate(async () => (await (await import('./src/db.js')).songs.save({ title: 'Duga', artist: 'A', sections: [{ name: 'S', lines: [{ text: 'https://www.primer.com/veoma/dugacak/link/koji/ide/van/ekrana/bez/razmaka/nikako', chords: [{ position: 0, chord: 'G' }] }, { text: 'lalalalalalalalalalalalalalalalalalalalalalalalalalalala', chords: [] }] }] })).id);
  await p.go('#/pesma/' + lw, 1500);
  const ov = await overflowCheck(p); expect(!ov.items.length, 'dugačka reč izlazi van ekrana', ov);
  // „‹ Pesme“ = korak nazad (bez kruga)
  await p.go('#/pesme', 800); await p.go('#/pesma/' + lw, 1200);
  const len0 = await p.evaluate(() => history.length);
  await p.click('.song-view .back'); await p.waitForTimeout(800);
  const nb = await p.evaluate(() => ({ h: location.hash, len: history.length }));
  expect(nb.h.startsWith('#/pesme') && nb.len === len0, '„‹ Pesme“ dodaje korak u istoriju', { len0, nb });
  // loš link
  const url = await p.evaluate(() => location.href.split('#')[0]);
  await p.goto(url + '#zahtev/neispravno'); await p.waitForTimeout(2500);
  expect(await p.evaluate(() => /Link nije ispravan/.test(document.querySelector('.modal-backdrop')?.innerText || '')), 'loš link bez poruke');
  expect(!p.errs.length, 'greške', p.errs);
  await p.close();
}
