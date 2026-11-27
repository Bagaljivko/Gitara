// v2.5.62: „Sačuvaj sve“ kad Google Drive uspori (429) — prozor kaže da će se kopija sama sačuvati, i zaista se sačuva
// čim Drive dozvoli (tiho, bez Google prozora); posao čeka samo na ovom uređaju (nije u rezervnoj kopiji).
import { open, boot, expect } from '../lib.mjs';
export const name = 'Sačuvaj sve: Drive usporio → kopija se sama sačuva kasnije';
export const timeout = 120;
export async function run(ctx) {
  const p = await open(ctx, 'phone'); await boot(p, ctx, '#/podesavanja', 900);
  await p.evaluate(async () => { const { settings } = await import('./src/db.js'); await settings.set('drive', { connected: true, folderId2: 'FOLD' }); await settings.set('driveToken2', { t: 'tok', exp: Date.now() + 3600e3, s: 1, f: 1 }); });
  let slow = true, ups = 0, body = '';
  await p.route(/googleapis\.com\/upload\/drive\/v3\/files/, async (r) => {
    ups++;
    if (slow) return r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { code: 429, message: 'Rate Limit Exceeded', errors: [{ reason: 'rateLimitExceeded' }] } }) });
    body = r.request().postData() || ''; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'BK1', modifiedTime: new Date().toISOString() }) });
  });
  await p.route(/googleapis\.com\/drive\/v3\/files/, (r) => (/files\/FOLD/.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"FOLD"}' }) : r.fulfill({ status: 200, contentType: 'application/json', body: '{"files":[]}' })));
  await p.reload(); await p.waitForTimeout(1500);
  await p.evaluate(() => { import('./src/backups.js').then((B) => { window.__sv = B.saveBackup('full'); }); });
  let dlg = '';
  for (let i = 0; i < 40 && !dlg; i++) { await p.waitForTimeout(500); dlg = await p.evaluate(() => document.querySelector('.modal-backdrop .modal')?.innerText || ''); }
  expect(/sama sačuvati/.test(dlg) && /Sačuvaj kao fajl/.test(dlg), 'prozor: kopija će se sama sačuvati', dlg);
  if (process.env.MARLI_SHOTS) await p.screenshot({ path: process.env.MARLI_SHOTS + 'kopija-kasnije.png' });
  const pend = await p.evaluate(() => JSON.parse(localStorage.getItem('marli-bk-pending') || 'null'));
  expect(pend && pend.kind === 'full', 'ručna kopija ne čeka', pend);
  await p.click('.modal-backdrop .modal-actions .btn.primary'); // U redu
  // Drive opet dozvoljava
  slow = false;
  const ok = await p.evaluate(async () => { localStorage.removeItem('marli-drive-cool'); return (await import('./src/backups.js')).runPending(); });
  expect(ok && /"songs"/.test(body), 'kopija se nije sačuvala kad je Drive dozvolio', { ok, len: body.length });
  const left = await p.evaluate(() => ({ pend: localStorage.getItem('marli-bk-pending'), toast: document.body.innerText.includes('Kopija je sačuvana na Google Drive') }));
  expect(!left.pend && left.toast, 'posao ostao / nema poruke', left);
  // posao je samo na ovom uređaju — nije u rezervnoj kopiji
  const inBk = await p.evaluate(async () => { localStorage.setItem('marli-bk-pending', '{"kind":"full","at":1}'); const d = await (await import('./src/backups.js')).buildFull(); localStorage.removeItem('marli-bk-pending'); return JSON.stringify(d.local || {}).includes('marli-bk-pending'); });
  expect(!inBk, 'posao koji čeka je u rezervnoj kopiji');
  expect(!p.errs.length, 'greške', p.errs);
  await p.close();
}
