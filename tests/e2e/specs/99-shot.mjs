// privremeno: slika za novosti 2.5.69 (skeniranje — „Gemini piše…“); posle obrisati
import { open, boot } from '../lib.mjs';
export const name = 'shot';
export const timeout = 60;
export async function run(ctx) {
  const p = await open(ctx, 'phone'); await boot(p, ctx, '#/pesme', 900);
  await p.route('https://generativelanguage.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] }] }) });
    await new Promise((r) => setTimeout(r, 30000)); return route.abort().catch(() => {});
  });
  await p.evaluate(async () => {
    const { settings } = await import('./src/db.js'); await settings.set('geminiKey', 'AIzaTEST0000000000000000000000000000000');
    const c = document.createElement('canvas'); c.width = 900; c.height = 1200; const g = c.getContext('2d');
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, 900, 1200); g.strokeStyle = '#b9c4d6'; for (let y = 120; y < 1200; y += 70) { g.beginPath(); g.moveTo(0, y); g.lineTo(900, y); g.stroke(); }
    g.fillStyle = '#222'; g.font = 'italic 46px serif'; g.fillText('Moja pesma', 300, 90);
    const L = [['G', 'Tiho pada kiša na prozor moj'], ['D', 'a ja sviram polako za tebe'], ['Em', 'svaki akord nosi jedan san'], ['C', 'i noć je duga kao more'], ['G', 'Tiho pada kiša na prozor moj'], ['D', 'a pesma ostaje sa nama']];
    let y = 180; for (const [ch, tx] of L) { g.font = 'bold 34px serif'; g.fillText(ch, 120, y); g.font = '38px serif'; g.fillText(tx, 60, y + 50); y += 140; }
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const E = await import('./src/songEditor.js'); E.scanFiles([new File([blob], 'pesma.jpg', { type: 'image/jpeg' })]);
  });
  await p.waitForTimeout(4000);
  await p.evaluate(async () => { const { t } = await import('./src/i18n.js'); document.querySelector('#scanText').textContent = t('scan.stepWriting'); document.querySelector('#scanSecs').textContent = '27 s'; });
  await p.waitForTimeout(300);
  await p.screenshot({ path: ctx.root + '/docs/novosti/img/skeniranje-pise-full.png' });
  await p.close();
}
