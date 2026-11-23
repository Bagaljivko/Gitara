// Tuner uz „gitaru“ (lažni mikrofon): prepoznaje žicu (A, D, E) i odstupanje — tačan ton ≈ 0 centi, viši ton „+“.
import { open, boot, expect, fakeMic } from '../lib.mjs';
export const name = 'tuner uz gitaru (lažni mikrofon): prepoznaje žice i odstupanje u centima';
export async function run(ctx) {
  const p = await open(ctx, 'phone', { init: fakeMic });
  await p.context().grantPermissions(['microphone']);
  await boot(p, ctx, '#/tuner', 1200);
  await p.click('#tStartBtn'); await p.waitForTimeout(1500);
  const read = () => p.evaluate(() => ({ note: document.getElementById('tNote')?.textContent.trim(), cents: document.getElementById('tCents')?.textContent.trim() }));
  const got = {};
  for (const [m, want] of [[45, 'A'], [50, 'D'], [40, 'E']]) {
    await p.evaluate((m) => window.__tone(m), m); await p.waitForTimeout(1300);
    got[want] = await read();
    await p.evaluate(() => window.__tone(null)); await p.waitForTimeout(400);
  }
  for (const k of ['A', 'D', 'E']) expect(got[k].note && got[k].note.startsWith(k), 'tuner nije prepoznao ' + k, got);
  const c = parseInt((got.A.cents || '0').replace(/[^\d+−-]/g, '').replace('−', '-')) || 0;
  expect(Math.abs(c) <= 5, 'tačan ton A nije oko 0 centi', got.A);
  // malo viši ton (A + 20 centi)
  await p.evaluate(() => window.__tone(45.2)); await p.waitForTimeout(1300);
  const hi = await read(); await p.evaluate(() => window.__tone(null));
  const ch = parseInt((hi.cents || '0').replace('−', '-').replace(/[^\d+-]/g, '')) || 0;
  expect(hi.note.startsWith('A') && ch >= 10 && ch <= 30, 'viši ton nije prikazan kao „+“ odstupanje', hi);
  ctx.note.push(`A ${got.A.cents}, A+20 ${hi.cents}`);
}
