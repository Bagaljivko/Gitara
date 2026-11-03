// Ažurira listu fajlova u sw.js i povećava verziju keša: node scripts/update-sw.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const sw = readFileSync('sw.js', 'utf8');
const src = readdirSync('src').filter((f) => /\.(js|css)$/.test(f)).sort().map((f) => `src/${f}`);
const files = ['./', 'index.html', 'privacy.html', 'manifest.webmanifest', ...src,
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'assets/headstock.webp'];
// vendor/jspdf + fonts/ su u LAZY listi u sw.js (preuzimaju se u pozadini)
// Veliki fajlovi koji se preuzimaju u pozadini posle instalacije (PDF i snimci gitare)
const lazy = ['vendor/jspdf.umd.min.js', 'fonts/DejaVuSansMono.ttf', 'fonts/DejaVuSansMono-Bold.ttf',
  ...readdirSync('assets/guitar').filter((f) => f.endsWith('.mp3')).sort((a, b) => parseInt(a) - parseInt(b)).map((f) => `assets/guitar/${f}`)];
const m = sw.match(/const CACHE = "gitara-v(\d+)";/);
const next = Number(m[1]) + 1;
const out = sw
  .replace(m[0], `const CACHE = "gitara-v${next}";`)
  .replace(/const SHELL = \[[\s\S]*?\];/, `const SHELL = [\n${files.map((f) => `  "${f}"`).join(',\n')}\n];`)
  .replace(/const LAZY = \[[\s\S]*?\];/, `const LAZY = [${lazy.map((f) => `"${f}"`).join(', ')}];`);
writeFileSync('sw.js', out);
console.log(`sw.js: gitara-v${next}, ${files.length} fajlova + ${lazy.length} u pozadini`);
