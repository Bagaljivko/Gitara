// Bez interneta: posle prve posete aplikacija radi i bez mreže (service worker), pesme su tu.
import { DEVICES, expect } from '../lib.mjs';
export const name = 'radi bez interneta (service worker): ponovno otvaranje, pesme, Vežbe';
export const timeout = 300;
export async function run(ctx) {
  const c = await ctx.browser.newContext({ ...DEVICES.phone });
  ctx.opened.push(c);
  await c.addInitScript(() => { localStorage.setItem('gitara-tour', '1'); localStorage.setItem('gitara-upgraded', '9'); window.__marliTest = { noHints: true }; });
  const p = await c.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.goto(ctx.base + '#/tuner');
  const ok = await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
  expect(ok, 'service worker nije aktivan');
  await p.waitForFunction(async () => { const ks = await caches.keys(); if (!ks.length) return false; const c = await caches.open(ks.find((k) => k.startsWith('gitara-')) || ks[0]); return (await c.keys()).length > 100; }, null, { timeout: 120000, polling: 1000 });
  await p.evaluate(async () => { const { songs } = await import('./src/db.js'); await songs.save({ title: 'Bez mreže', artist: 'A', sections: [{ name: 'S', type: 'verse', lines: [{ text: 'aa', chords: [{ pos: 0, position: 0, chord: 'G' }] }] }] }); });
  await c.setOffline(true);
  await p.reload(); await p.waitForTimeout(2500);
  expect(await p.$('#tStartBtn'), 'tuner se ne otvara bez mreže');
  await p.evaluate(() => { location.hash = '#/pesme'; }); await p.waitForTimeout(1500);
  expect(await p.evaluate(() => document.body.innerText.includes('Bez mreže')), 'pesme se ne vide bez mreže');
  await p.evaluate(() => { location.hash = '#/vezbe/pauk'; }); await p.waitForTimeout(2000);
  expect(await p.$('#prGo'), 'igra se ne otvara bez mreže');
  await c.setOffline(false);
}
