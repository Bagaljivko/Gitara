// Igra sa „gitarom“ (lažni mikrofon svira tačne note): Pauk, „Čekaj me — početnik sam“ — cela runda do rezultata.
import { open, boot, expect, fakeMic } from '../lib.mjs';
export const name = 'igra uz gitaru (lažni mikrofon): Pauk „Čekaj me“ (telefon položen) — cela runda, „Čisto odsvirano“';
export const timeout = 300;
const OPEN = [40, 45, 50, 55, 59, 64];
const seq = () => { const s = []; for (let st = 0; st < 6; st++) for (let k = 0; k < 4; k++) s.push(OPEN[st] + 1 + k); for (let st = 5; st >= 0; st--) for (let k = 3; k >= 0; k--) s.push(OPEN[st] + 2 + k); return s; };
export async function run(ctx) {
  const p = await open(ctx, 'phoneLand', { init: fakeMic }); // staza igre je položena (uspravno traži okretanje)
  await p.context().grantPermissions(['microphone']);
  await boot(p, ctx, '#/vezbe/pauk', 2000);
  await p.evaluate(() => { localStorage.setItem('gitara-pr-waittip', '1'); localStorage.setItem('gitara-pr-pauk-start', '1'); });
  const w = await p.$('#prWait'); if (w && !(await w.isChecked())) { await p.evaluate(() => document.getElementById('prWait').click()); await p.waitForTimeout(400); }
  await p.evaluate(() => document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove()));
  await p.click('#prGo'); await p.waitForTimeout(3500);
  expect(await p.evaluate(() => window.__micReady), 'igra nije uključila mikrofon');
  await p.evaluate(() => document.querySelectorAll('.modal-backdrop .btn.primary').forEach((b) => b.click()));
  let played = 0, retries = 0;
  const combo = () => p.evaluate(() => parseInt(document.querySelector('.trk-combo')?.textContent) || 0);
  for (const m of seq()) {
    if (await p.evaluate(() => { const r = document.querySelector('.trk-res'); return r && !r.hidden; })) break;
    const c0 = await combo();
    for (let k = 0; k < 3; k++) {
      await p.evaluate((m) => window.__tone(m), m); await p.waitForTimeout(650);
      await p.evaluate(() => window.__tone(null)); await p.waitForTimeout(200);
      if ((await combo()) > c0 || (await p.evaluate(() => !document.querySelector('.trk-res')?.hidden))) break;
      retries++;
    }
    played++;
  }
  await p.waitForTimeout(2500);
  const res = await p.evaluate(() => { const r = document.querySelector('.trk-res'); return r && !r.hidden ? { txt: r.innerText.replace(/\s+/g, ' ').slice(0, 160), combo: parseInt(document.querySelector('.trk-combo')?.textContent) || 0 } : null; });
  expect(res, 'runda se nije završila posle ' + played + ' nota', await p.evaluate(() => ({ wait: document.getElementById('prWait')?.checked, combo: document.querySelector('.trk-combo')?.textContent, trk: !!document.querySelector('.trk'), running: document.querySelector('.pr-game')?.classList.contains('running'), modal: document.querySelector('.modal-backdrop')?.innerText?.slice(0, 80) })));
  expect(/Čisto/.test(res.txt) && res.combo >= 20, 'sve note tačne, a rezultat nije „Čisto“', res);
  ctx.note.push(`${played} nota, niz ${res.combo}, „Čisto“, ponovljeno ${retries}`);
}
