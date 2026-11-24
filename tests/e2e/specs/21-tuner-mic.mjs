// Tuner uz „gitaru“ (lažni mikrofon): prepoznaje žice i odstupanje; žica se označi tek kad je tačna,
// posle zvuka ostaje poslednje očitavanje, prikazuje se sledeća žica; preciznost u podešavanjima.
import { open, boot, expect, fakeMic } from '../lib.mjs';
export const name = 'tuner uz gitaru: žice, centi, označavanje samo tačne, „Sledeća“, zadržano očitavanje, preciznost, referentni ton, povratak u aplikaciju';
export const timeout = 300;
export async function run(ctx) {
  const p = await open(ctx, 'phone', { init: fakeMic });
  await p.context().grantPermissions(['microphone']);
  await boot(p, ctx, '#/tuner', 1200);
  await p.click('#tStartBtn'); await p.waitForTimeout(1500);
  const read = () => p.evaluate(() => ({ note: document.getElementById('tNote')?.textContent.trim(), cents: document.getElementById('tCents')?.textContent.trim(), state: document.getElementById('tMeter')?.dataset.state, held: document.getElementById('tMeter')?.classList.contains('held'), done: [...document.querySelectorAll('.knob.done')].map((k) => +k.dataset.s), next: [...document.querySelectorAll('.knob.next')].map((k) => +k.dataset.s) }));
  const num = (c) => parseInt((c || '0').replace('−', '-').replace(/[^\d+-]/g, '')) || 0;
  // 1) E2 malo nisko (−8 c): prikaz tačan, ali žica se NE označi
  await p.evaluate(() => window.__tone(40 - 0.08)); await p.waitForTimeout(1800);
  let r = await read();
  expect(r.note.startsWith('E') && num(r.cents) <= -6 && num(r.cents) >= -10, 'E −8 c pogrešno prikazano', r);
  expect(!r.done.includes(0), 'žica 8 centi nisko je označena kao naštimovana', r);
  await p.evaluate(() => window.__tone(null)); await p.waitForTimeout(400);
  // 2) tačan E2 → označena; posle zvuka ostaje poslednje očitavanje (prigušeno), pa „Sledeća: 5. žica“
  await p.evaluate(() => window.__tone(40)); await p.waitForTimeout(1500);
  r = await read(); expect(r.done.includes(0), 'tačna E žica nije označena', r);
  await p.evaluate(() => window.__tone(null)); await p.waitForTimeout(900);
  r = await read(); expect(r.held && r.note.startsWith('E'), 'posle zvuka ne ostaje poslednje očitavanje', r);
  await p.waitForTimeout(2200);
  r = await read(); expect(r.next.includes(1) && /5/.test(r.cents), 'ne prikazuje sledeću žicu', r);
  // 3) A i D tačno, A+20 c prikazano kao +20
  for (const [m, k] of [[45, 'A'], [50, 'D']]) { await p.evaluate((m) => window.__tone(m), m); await p.waitForTimeout(1300); r = await read(); expect(r.note.startsWith(k) && Math.abs(num(r.cents)) <= 3, 'tuner nije prepoznao ' + k, r); await p.evaluate(() => window.__tone(null)); await p.waitForTimeout(400); }
  await p.evaluate(() => window.__tone(45.2)); await p.waitForTimeout(1300); r = await read(); await p.evaluate(() => window.__tone(null));
  expect(r.note.startsWith('A') && num(r.cents) >= 15 && num(r.cents) <= 25, 'viši ton nije prikazan kao „+“ odstupanje', r);
  ctx.note.push('E −8 c ne označava, tačna da, ' + r.cents);
  // 4) preciznost u podešavanjima tunera
  await p.waitForTimeout(2600); await p.click('#tSet'); await p.waitForTimeout(500);
  await p.click('[data-prec="precise"]'); await p.waitForTimeout(300);
  expect(await p.evaluate(async () => (await (await import('./src/db.js')).settings.get('tunerPrec')) === 'precise'), 'preciznost se ne čuva');
  await p.keyboard.press('Escape'); await p.evaluate(() => document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove())); await p.waitForTimeout(300);
  // 5) referentni ton: dug pritisak → zvoni i posle 3 s; dodir bilo gde ga gasi
  const k = await (await p.$('.knob[data-s="1"] .knob-hit')).boundingBox();
  await p.mouse.move(k.x + k.width / 2, k.y + k.height / 2); await p.mouse.down(); await p.waitForTimeout(600); await p.mouse.up();
  await p.waitForTimeout(3500);
  expect(await p.evaluate(() => !!document.querySelector('.knob[data-s="1"].ringing')), 'referentni ton ne zvoni i posle 3 s');
  await p.mouse.click(20, 300); await p.waitForTimeout(400);
  expect(await p.evaluate(() => !document.querySelector('.knob.ringing')), 'dodir ne gasi referentni ton');
  // 6) aplikacija sklonjena pa vraćena: mikrofon se sam uključi
  const vis = (hidden) => p.evaluate((h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
  await vis(true); await p.waitForTimeout(500);
  expect(await p.evaluate(() => !document.getElementById('tStart').hidden), 'mikrofon se nije ugasio kad je aplikacija sklonjena');
  await vis(false); await p.waitForTimeout(1500);
  expect(await p.evaluate(() => document.getElementById('tStart').hidden), 'mikrofon se nije sam uključio po povratku');
}
