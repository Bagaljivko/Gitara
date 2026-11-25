// v2.4.17: „Vežbaj pesmu“ — predlog za danas (Promene akorda, Ritam pesme, Pevaj uz tekst, Cela pesma), svaka vežba
// otvorena odmah za tu pesmu (bez biranja), rezultat se pamti uz pesmu (uvid „Promene ★★“); deo počinje odmah (bez panela);
// „Pevaj uz tekst“: tekst sa akordima iznad reči, strelice udaraca, brojanje, sledeći akord.
import { open, boot, addSong, expect } from '../lib.mjs';
export const name = 'Vežbaj pesmu: predlog za danas (promene, ritam, pevanje uz tekst, cela), rezultati uz pesmu';
export const timeout = 200;
const SHOT = process.env.MARLI_SHOTS ? '/tmp/claude-0/-home-user/5acc3b3c-c7ec-5fc4-b0ba-484df35f0a2c/scratchpad/mk/' : '';
export async function run(ctx) {
  const p = await open(ctx, 'phone'); await boot(p, ctx, '#/tuner', 900);
  const id = await addSong(p, { title: 'Volio bih da si tu', artist: 'Crvena jabuka', chords: ['G', 'D', 'Em', 'C'], bpm: 90 });
  await p.go('#/vezbe/pesma/' + id, 1800);
  const plan = await p.evaluate(() => [...document.querySelectorAll('.pl-step')].map((x) => ({ id: x.dataset.plan, on: x.classList.contains('on'), txt: x.innerText.replace(/\s+/g, ' ') })));
  expect(plan.map((x) => x.id).join() === 'chg,rp,sing,all,tut' && plan[0].on && !plan[4].on, 'predlog za danas: 4 koraka (prvi na redu) + tutorijal po želji na kraju', plan);
  expect(/↔/.test(plan[0].txt) && /↓/.test(plan[1].txt) && /BPM/.test(plan[1].txt) && /YouTube/.test(plan[4].txt), 'koraci treba da kažu tačno šta se radi', plan);
  if (SHOT) await p.screenshot({ path: SHOT + 'B-plan.png' });
  // deo počinje odmah (bez iskačućeg panela)
  expect(await p.evaluate(() => !document.querySelector('.spr-sheet')), 'panel je već otvoren');
  // 1) Promene akorda iz pesme: niz iz pesme, bez dijaloga; rezultat uz pesmu
  await p.click('[data-plan="chg"]'); await p.waitForTimeout(1500);
  const chg = await p.evaluate(() => ({ h: location.hash, from: document.querySelector('.cs-fromsong')?.textContent || '', seq: [...document.querySelectorAll('.cs-seq [data-i] b')].map((b) => b.textContent), dlg: !!document.querySelector('.modal-backdrop') }));
  expect(/promena\?song=/.test(chg.h) && /Volio/.test(chg.from) && chg.seq.length >= 2 && !chg.dlg, 'Promene akorda: niz iz pesme (bez biranja)', chg);
  await p.evaluate(async (id) => { const P = await import('./src/practice.js'); await P.saveResult('promena', { score: 85, tempo: 60 }, [id, 'chg']); await P.saveResult('promena', { score: 70, tempo: 60 }, 'seq:G-D-Em'); }, id);
  const bad = await p.evaluate(async () => { const { settings } = await import('./src/db.js'); const st = await settings.get('practice', {}); return Object.keys(st.songs || {}).filter((k) => k.length < 3); });
  expect(!bad.length, 'tekstualni ključ i dalje upisuje „pesmu“ sa jednim slovom', bad);
  // 2) Ritam pesme: vežba te pesme odmah otvorena
  await p.go('#/vezbe/rp?song=' + encodeURIComponent(id), 1800);
  const rp = await p.evaluate(() => ({ card: document.querySelector('.rx-card .rx-h b')?.textContent || '', steps: document.querySelectorAll('.rx-step').length, dlg: !!document.querySelector('.modal-backdrop') }));
  expect(/Volio/.test(rp.card) && rp.steps > 0 && !rp.dlg, 'Ritam pesme: vežba te pesme odmah otvorena', rp);
  // 3) Pevaj uz tekst: delovi, tekst sa akordima iznad reči; ekran igre
  await p.go('#/vezbe/pesma/' + encodeURIComponent(id) + '?m=sing', 1800);
  const sg = await p.evaluate(() => ({ chips: document.querySelectorAll('[data-sk]').length, sw: document.querySelectorAll('.sg-prev .sw').length, first: document.querySelector('.sg-prev .sw')?.dataset.c, go: !document.getElementById('prGo').hidden }));
  expect(sg.chips >= 2 && sg.sw >= 3 && sg.first === 'G' && sg.go, 'Pevaj uz tekst: delovi i akordi iznad reči', sg);
  if (SHOT) await p.screenshot({ path: SHOT + 'B-sing-opts.png' });
  await p.evaluate(() => { window.__marliTest = { ...(window.__marliTest || {}) }; });
  await p.click('#prGo'); await p.waitForTimeout(400);
  expect(await p.$('.gr-dim'), 'Pevaj uz tekst: nema „Spremi se“'); await p.click('.gr-go'); await p.waitForTimeout(6000);
  const run1 = await p.evaluate(() => ({ open: !!document.querySelector('.sg-wrap'), arrows: document.querySelectorAll('.sg-arrows i').length, on: document.querySelectorAll('.sg-arrows i.on').length, ch: document.querySelector('.sg-ch')?.textContent, now: document.querySelectorAll('.sg-lyr .sw.now').length, nx: document.querySelector('.sg-nx small')?.textContent }));
  if (SHOT) await p.screenshot({ path: SHOT + 'B-sing-run.png' });
  expect(run1.open && run1.arrows === 8 && run1.ch && run1.now === 1 && /sledeći|isti|poslednji/.test(run1.nx), 'Pevaj uz tekst: ekran (strelice, akord, reč, sledeći)', run1);
  await p.click('.sg-x'); await p.waitForTimeout(400);
  expect(await p.evaluate(() => !document.querySelector('.sg-wrap')), 'ekran pevanja se ne zatvara');
  // uvid na pesmi: Promene
  await p.go('#/pesma/' + id, 1500);
  const ins = await p.evaluate(() => document.querySelector('#sStats')?.innerText || '');
  expect(/Promene/.test(ins), 'uvid na pesmi ne prikazuje vežbu „Promene“', ins);
  // nazad na plan: Promene urađene danas ✓, Ritam je na redu
  await p.go('#/vezbe/pesma/' + id, 1500);
  const pl2 = await p.evaluate(() => [...document.querySelectorAll('.pl-step')].map((x) => (x.classList.contains('done') ? 'd' : x.classList.contains('on') ? 'o' : '-')).join(''));
  expect(pl2.startsWith('do'), 'urađen korak treba ✓, sledeći na redu', pl2);
  expect(!p.errs.length, 'greške', p.errs);
}
