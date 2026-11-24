// v2.4.8: metronom kao čip (podrazumevano, ikonica sa klatnom), Ritam kao mala traka; Sviraj/nastup: tekst popunjava širinu
// (A−/A+ faktor), akordi sa strane na širokom ekranu (sakrij/prikaži se pamti, istaknut akord prati skrol), metronom u traci.
import { open, boot, addSong, expect, overflowCheck } from '../lib.mjs';
export const name = 'metronom (čip i nastup), Ritam traka, Sviraj: tekst preko širine i akordi sa strane';
export async function run(ctx) {
  // telefon: metronom je podrazumevano u redu čipova; uključi/isključi; tempo traka bez metronoma
  const p = await open(ctx, 'phone'); await boot(p, ctx);
  const id = await addSong(p, { title: 'Metro', bpm: 96 });
  await p.go('#/pesma/' + id, 1500);
  const chip = () => p.evaluate(() => { const c = document.querySelector('#sChips [data-sca="metro"]'); return c && !c.classList.contains('sc-ov') && c.offsetWidth ? { on: c.classList.contains('on'), icon: !!c.querySelector('svg.met-ic') } : null; });
  expect((await chip())?.icon, 'telefon: nema čipa metronoma (sa ikonicom) u podrazumevanom redu', await chip());
  await p.evaluate(() => document.querySelector('#sChips [data-sca="metro"]').click()); await p.waitForTimeout(300);
  expect((await chip())?.on, 'metronom se ne uključuje');
  await p.evaluate(() => document.querySelector('#sChips [data-sca="metro"]').click()); await p.waitForTimeout(300);
  expect(!(await chip())?.on, 'metronom se ne isključuje');
  await p.evaluate(() => document.querySelector('#sChips [data-sheet="tempo"]').click()); await p.waitForTimeout(300);
  expect(await p.$('.chip-pop [data-tap]') && !(await p.$('.chip-pop [data-met]')), 'traka tempa');
  { const o = await overflowCheck(p); expect(!o.page && !o.items.length, 'telefon: nešto izlazi van ekrana', o); }

  // računar: Sviraj iz set liste — akordi sa strane, tekst preko širine, metronom prati tempo pesme
  const q = await open(ctx, 'desk'); await boot(q, ctx);
  const a = await addSong(q, { title: 'Prva', bpm: 96, lines: 7, sections: 6, chords: ['G', 'D', 'Em', 'C', 'Am'] });
  const b = await addSong(q, { title: 'Druga', bpm: 120, chords: ['A', 'E'] });
  const sid = await q.evaluate(async ([a, b]) => { const C = await import('./src/collections.js'); const s = await C.addSetlist('Svirka'); await C.updateSetlist(s.id, { songIds: [a, b] }); return s.id; }, [a, b]);
  await q.go('#/nastup/' + sid + '?i=0', 2500);
  const st = () => q.evaluate(() => { const l = document.querySelector('.stage-lyrics'); const r = document.querySelector('.st-rail'); return { fs: parseFloat(getComputedStyle(l).fontSize), lw: l.getBoundingClientRect().width, rail: !!(r && r.offsetParent), n: document.querySelectorAll('.st-rail .st-d').length, now: document.querySelector('.st-d.now')?.dataset.c || '', sw: document.documentElement.scrollWidth }; });
  const s1 = await st();
  expect(s1.rail && s1.n === 5 && s1.now, 'akordi sa strane', s1);
  expect(s1.fs >= 30 && s1.sw <= 1440, 'tekst ne popunjava širinu / izlazi van ekrana', s1);
  // istaknuti akord prati skrol
  await q.mouse.move(600, 500); await q.mouse.wheel(0, 560); await q.waitForTimeout(500);
  const s2 = await st();
  expect(s2.now && s2.now !== s1.now, 'istaknut akord ne prati skrol', [s1.now, s2.now]);
  // sakrij → šire, pamti se; dugme vraća
  await q.click('#stRailHide'); await q.waitForTimeout(300);
  const s3 = await st();
  expect(!s3.rail && s3.lw > s1.lw + 150, 'sakrij akorde ne širi tekst', s3);
  expect(await q.evaluate(() => localStorage.getItem('marli-stage-rail')) === '0', 'skrivanje akorda se ne pamti');
  await q.click('#stRailBtn'); await q.waitForTimeout(300);
  expect((await st()).rail, 'dugme ne vraća akorde');
  // A− / A+: faktor na popunjenu širinu
  const f0 = (await st()).fs;
  await q.click('#stAa'); await q.click('#stDown'); await q.waitForTimeout(200);
  const f1 = (await st()).fs;
  expect(f1 < f0 * 0.95, 'A− ne smanjuje', [f0, f1]);
  await q.click('#stUp'); await q.click('#stUp'); await q.waitForTimeout(200);
  expect((await st()).fs > f1 * 1.1 && (await st()).sw <= 1440, 'A+ ne povećava (ili izlazi van ekrana)');
  // metronom: tempo pesme, − / +, sledeća pesma → njen tempo
  await q.click('#stMet'); await q.waitForTimeout(200);
  const bpm = () => q.evaluate(() => ({ on: document.getElementById('stMet').classList.contains('on'), b: document.getElementById('stMetBpm').textContent }));
  expect((await bpm()).on && (await bpm()).b === '96', 'metronom u nastupu', await bpm());
  await q.click('#stMetUp'); await q.waitForTimeout(100);
  expect((await bpm()).b === '101', 'metronom +', await bpm());
  await q.keyboard.press('n'); await q.waitForTimeout(800);
  expect((await bpm()).on && (await bpm()).b === '120', 'metronom ne prelazi na tempo sledeće pesme', await bpm());
  await q.click('#stMet'); await q.waitForTimeout(100);
  expect(!(await bpm()).on, 'metronom se ne gasi');
}
