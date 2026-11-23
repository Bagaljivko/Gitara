// Obilasci: prvi put (telefon i računar), „Sve što MARLI ume“, Nazad/Esc, za nastavnike na primer-podacima (podaci se ne menjaju).
import { open, boot, expect } from '../lib.mjs';
export const name = 'obilasci: prvi put (telefon, računar), sve mogućnosti, nastavnici bez izmene podataka';
export const timeout = 420;
const step = (p) => p.evaluate(() => { const pn = document.querySelector('.tg-panel'); return pn ? { t: pn.querySelector('h2')?.textContent.trim(), hole: !document.querySelector('.tg-hole')?.hidden, demo: !!pn.querySelector('.tg-demo') } : null; });
async function walk(p, max = 40) { const seen = []; for (let k = 0; k < max; k++) { await p.waitForTimeout(1200); const s = await step(p); if (!s) break; seen.push(s); const nx = await p.$('.tg-next'); if (nx) await nx.click(); else { const ch = await p.$('.tg-choice:last-child'); if (!ch) break; await ch.click(); } } return seen; }
export async function run(ctx) {
  // telefon: nov korisnik → dobrodošlica → obilazak
  let p = await open(ctx, 'phone', { fresh: true, init: () => localStorage.setItem('marli-welcome-test', '1') });
  await boot(p, ctx, '', 2000);
  await p.waitForSelector('.welcome-modal', { timeout: 8000 }).catch(() => {});
  const wel = await p.evaluate(() => document.querySelector('.welcome-modal')?.textContent.trim().slice(0, 60));
  expect(/MARLI/.test(wel || ''), 'nema dobrodošlice za novog korisnika', wel);
  await p.evaluate(() => document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove()));
  await p.evaluate(async () => (await import('./src/tour2.js')).startTour('first'));
  const first = await walk(p, 20);
  expect(first.length >= 10 && first.filter((s) => s.hole).length >= 4, 'prvi obilazak (telefon)', first.map((s) => s.t));
  await p.evaluate(async () => (await import('./src/tour2.js')).startTour('full'));
  await p.waitForTimeout(1200); await p.click('.tg-next'); await p.waitForTimeout(1200); const a = await step(p); await p.click('.tg-prev'); await p.waitForTimeout(1200); const b = await step(p);
  expect(a && b && a.t !== b.t, 'Nazad u obilasku', { a, b });
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  expect(!(await step(p)), 'Esc ne zatvara obilazak');
  // računar
  const d = await open(ctx, 'desk'); await boot(d, ctx, '#/pesme', 1500);
  await d.evaluate(async () => (await import('./src/tour2.js')).startTour('first'));
  const fd = await walk(d, 20);
  expect(fd.length >= 8, 'prvi obilazak (računar)', fd.length);
  // nastavnici: primer-podaci, ništa se ne upisuje
  const snap = () => p.evaluate(async () => { const { settings } = await import('./src/db.js'); return JSON.stringify([await settings.get('teacher', null), await settings.get('students', null), await settings.get('myTeacher', null)]); });
  const before = await snap();
  await p.evaluate(async () => (await import('./src/tour2.js')).startTour('teacher'));
  const tt = await walk(p, 30);
  expect(tt.length >= 14 && tt.filter((s) => s.demo).length >= 8, 'obilazak za nastavnike', { n: tt.length, demos: tt.filter((s) => s.demo).length });
  expect(before === (await snap()), 'obilazak za nastavnike je promenio podatke');
}
