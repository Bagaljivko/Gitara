// v2.5.6: jedno odbrojavanje — izbor 3 / 5 / 10 s uz „Počni“ (pamti se); uspravno ništa ne broji („Okreni telefon“ kaže
// koliko će trajati); položeno: 10 · 9 … 4, pa odbrojavanje metronoma (3 · 2 · 1 · Kreni); dodir po stazi = odmah.
import { open, boot, expect, eq, fakeMic } from '../lib.mjs';
export const name = 'jedno odbrojavanje: izbor uz Počni, uspravno čeka, položeno broji, dodir = odmah';
export const timeout = 150;

export async function run(ctx) {
  // uspravno: izbor i „Okreni telefon“
  const p = await open(ctx, 'phone', { init: fakeMic }); await p.context().grantPermissions(['microphone']);
  await boot(p, ctx, '#/vezbe/promena', 2000);
  await p.evaluate(() => document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove()));
  eq(await p.evaluate(() => [...document.querySelectorAll('#prReady [data-rs]')].map((b) => b.textContent + (b.classList.contains('active') ? '*' : ''))), ['3 s', '5 s*', '10 s'], 'izbor uz Počni (5 s podrazumevano)');
  await p.click('#prReady [data-rs="10"]');
  eq(await p.evaluate(() => localStorage.getItem('marli-ready-secs')), '10', 'izbor se pamti');
  await p.click('#prGo'); await p.waitForTimeout(1500);
  const up = await p.evaluate(() => ({ dim: !!document.querySelector('.gr-dim'), rot: document.querySelector('.trk-rot-ready')?.textContent || '', big: document.querySelector('.trk-big')?.textContent || '' }));
  expect(!up.dim && /10 s/.test(up.rot) && !up.big, 'uspravno: ništa ne broji, „Okreni telefon“ kaže 10 s', up);
  await p.close();
  // položeno: broji 10, 9… sa „Spremi se“; dodir = odmah
  const q = await open(ctx, 'phoneLand', { init: fakeMic }); await q.context().grantPermissions(['microphone']);
  await boot(q, ctx, '#/vezbe/promena', 2000);
  await q.evaluate(() => { localStorage.setItem('marli-ready-secs', '10'); document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove()); });
  await q.click('#prGo'); await q.waitForTimeout(400);
  await q.evaluate(() => document.querySelectorAll('.modal-backdrop .btn.primary').forEach((b) => b.click()));
  const seen = new Set(); let cap = '';
  for (let i = 0; i < 10; i++) { await q.waitForTimeout(250); const r = await q.evaluate(() => ({ b: document.querySelector('.trk-big')?.textContent || '', c: document.querySelector('.trk-captxt')?.textContent || '' })); if (r.b) seen.add(r.b); if (r.c) cap = r.c; }
  expect(seen.has('10') && /Spremi se/.test(cap), 'položeno: odbrojavanje kreće (10 …) uz „Spremi se“', { seen: [...seen], cap });
  await q.evaluate(() => { const cw = document.querySelector('.trk-cw'); cw.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await q.waitForTimeout(3500);
  const after = await q.evaluate(() => ({ c: document.querySelector('.trk-captxt')?.textContent || '' }));
  expect(!/Spremi se/.test(after.c), 'dodir po stazi: kreće odmah (bez čekanja 10 s)', after);
  await q.close();
}
