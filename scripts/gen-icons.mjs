// Pravi neprozirne PNG ikonice iz SVG-a (koristi Playwright/Chromium). Pokreće se ručno: npm run icons
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';

const dir = new URL('../icons/', import.meta.url);
const jobs = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-maskable-192.png', 192],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
  ['icon.svg', 'apple-touch-icon.png', 180],
  ['icon.svg', 'favicon-32.png', 32],
  // v1.73: ista slika i pod novim imenima (manifest i iPhone koriste nova — telefon lakše primeti promenu ikonice)
  ['icon.svg', 'marli-192.png', 192],
  ['icon.svg', 'marli-512.png', 512],
  ['icon.svg', 'marli-apple-touch-180.png', 180],
  ['icon-maskable.svg', 'marli-maskable-192.png', 192],
  ['icon-maskable.svg', 'marli-maskable-512.png', 512],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [src, out, size] of jobs) {
  const svg = readFileSync(new URL(src, dir), 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:#000">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete)).catch(() => {}); await page.waitForTimeout(200); // fotografija u ikonici
  await page.screenshot({ path: new URL(out, dir).pathname, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('icon', out);
}
await browser.close();
