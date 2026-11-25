// v2.4.18: ⋯ i ⚙ bez ponavljanja. ⋯ = šta radiš sa pesmom (Uredi, Dijagrami akorda, Podeli, Nastavnik; v2.4.20 bez videa);
// ⚙ = kako zvuči/izgleda (bez „Uz video“, „Akordi u pesmi“, „Vežbaj ovu pesmu“). Čip videa: snimak (u aplikaciji, „Promeni“)
// ili tutorijal (otvara YouTube). „Vežbaj pesmu“: na kraju „Treba ti tutorijal?“ otvara YouTube i dobija ✓.
import { open, boot, addSong, expect } from '../lib.mjs';
export const name = 'meniji pesme bez ponavljanja (⋯, ⚙), čip videa (snimak / tutorijal), tutorijal po želji na kraju plana';
const SHOT = process.env.MARLI_SHOTS ? '/tmp/claude-0/-home-user/5acc3b3c-c7ec-5fc4-b0ba-484df35f0a2c/scratchpad/mk3/' : '';
export async function run(ctx) {
  const p = await open(ctx, 'phone', { init: () => { window.open = (u) => { (window.__opened = window.__opened || []).push(String(u)); return null; }; } });
  await boot(p, ctx, '#/tuner', 900);
  const id = await addSong(p, { title: 'Tišina', artist: 'Bajaga', chords: ['Am', 'C', 'G', 'F'], extra: { yt: { listen: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', tutorial: 'https://www.youtube.com/watch?v=bbbbbbbbbbb' } } });
  await p.evaluate(async () => { const M = await import('./src/teach.js'); await M.setMyTeacher({ name: 'Mile', tid: 'T1', sid: 'S1' }); });
  await p.go('#/pesma/' + id, 1500);
  // ⋯
  await p.click('#sMore'); await p.waitForTimeout(500);
  const m1 = await p.evaluate(() => [...document.querySelectorAll('.more-item')].map((x) => x.dataset.v).join(','));
  expect(m1 === 'edit,details,share,teach', '⋯ meni (v2.4.20: bez videa — videi su u čipu ▶)', m1);
  if (SHOT) await p.screenshot({ path: SHOT + 'more.png' });
  await p.click('.more-item[data-v="share"]'); await p.waitForTimeout(400);
  const m2 = await p.evaluate(() => [...document.querySelectorAll('.more-item')].map((x) => x.dataset.v).join(','));
  expect(m2 === 'share,pdf', '⋯ Podeli → link ili PDF', m2);
  await p.mouse.click(20, 300); await p.waitForTimeout(400);
  await p.click('#sMore'); await p.waitForTimeout(400); await p.click('.more-item[data-v="teach"]'); await p.waitForTimeout(400);
  const m3 = await p.evaluate(() => [...document.querySelectorAll('.more-item')].map((x) => x.dataset.v).join(','));
  expect(m3 === 'toTeacher,check', '⋯ Nastavnik → pošalji / proveri', m3);
  await p.mouse.click(20, 300); await p.waitForTimeout(400);
  // ⚙: nema videa, akorda, vežbe
  await p.click('#sChips [data-sheet="all"]'); await p.waitForTimeout(500);
  const ks = await p.evaluate(() => [...document.querySelectorAll('.song-sheet .ss-item')].map((x) => x.dataset.k));
  expect(!ks.some((k) => ['video', 'chords', 'practice'].includes(k)) && ks.includes('easy') && ks.includes('metro'), '⚙ redovi', ks);
  await p.mouse.click(20, 100); await p.waitForTimeout(500);
  // čip videa → tutorijal otvara YouTube
  await p.click('#sChips [data-pa]'); await p.waitForTimeout(500);
  const vc = await p.evaluate(() => [...document.querySelectorAll('.more-item')].map((x) => x.dataset.v).join(','));
  expect(vc === 'along,tutorial', 'čip videa: snimak / tutorijal', vc);
  const alts = await p.evaluate(() => [...document.querySelectorAll('.more-item .more-alt')].map((x) => x.dataset.v).join(','));
  expect(alts === 'along:change,tutorial:change', 'čip videa: „Promeni“ za oba videa', alts);
  if (SHOT) await p.screenshot({ path: SHOT + 'chip.png' });
  await p.click('.more-item[data-v="tutorial"]'); await p.waitForTimeout(500);
  expect(await p.evaluate(() => (window.__opened || []).some((u) => /bbbbbbbbbbb/.test(u))), 'tutorijal se ne otvara na YouTube-u');
  // „Treba ti tutorijal?“ na kraju „Vežbaj pesmu“
  await p.go('#/vezbe/pesma/' + id, 1500);
  await p.click('[data-plan="tut"]'); await p.waitForTimeout(800);
  const st = await p.evaluate(() => ({ n: (window.__opened || []).length, done: document.querySelector('[data-plan="tut"]').classList.contains('done') }));
  expect(st.n >= 2 && st.done, 'korak 0: tutorijal otvoren i ✓', st);
  if (SHOT) { await p.evaluate(() => document.querySelector('[data-plan="tut"]').scrollIntoView({ block: 'center' })); await p.screenshot({ path: SHOT + 'plan.png' }); }
  expect(!p.errs.length, 'greške', p.errs);
}
