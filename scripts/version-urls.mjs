// Pri objavi (GitHub Actions): svakom fajlu aplikacije doda broj verzije u adresu (npr. ui.js?v=47).
// Tako telefon nikada ne može da pomeša stari i novi fajl iz keša pregledača (to je davalo prazan ekran:
// novi fajl traži funkciju koje u starom nema). Service worker iste fajlove nalazi i bez ?v= (ignoreSearch).
// Usput u index.html doda <link rel="modulepreload"> za sve fajlove potrebne za prvi ekran, da se
// preuzimaju odjednom, a ne jedan za drugim.
//
// Upotreba: node scripts/version-urls.mjs _site
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] || '_site';
const sw = readFileSync(join(dir, 'sw.js'), 'utf8');
const m = /const CACHE = "gitara-v(\d+)"/.exec(sw);
if (!m) throw new Error('sw.js: CACHE verzija nije pronađena');
const v = m[1];

const SPEC = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.\/[\w.-]+\.js)\2/g;
const srcDir = join(dir, 'src');
const files = readdirSync(srcDir).filter((f) => f.endsWith('.js'));
const deps = new Map(); // fajl → statički uvezeni fajlovi
let count = 0;
for (const f of files) {
  const p = join(srcDir, f);
  const code = readFileSync(p, 'utf8');
  const stat = [];
  const out = code.replace(SPEC, (all, kw, q, spec) => {
    count++;
    if (!/\(\s*$/.test(kw)) stat.push(spec.slice(2)); // „from“ / „import '…'“ = statički; „import(“ = učitava se kasnije
    return `${kw}${q}${spec}?v=${v}${q}`;
  });
  deps.set(f, stat);
  writeFileSync(p, out);
}

// Statički graf od main.js (bez dinamičkih import()) → modulepreload
const seen = new Set();
const walk = (f) => { if (seen.has(f) || !deps.has(f)) return; seen.add(f); deps.get(f).forEach(walk); };
walk('main.js');
seen.delete('main.js');
const preload = [...seen].sort().map((f) => `  <link rel="modulepreload" href="src/${f}?v=${v}">`).join('\n');

let html = readFileSync(join(dir, 'index.html'), 'utf8');
const before = html;
html = html.replace('src="src/main.js"', `src="src/main.js?v=${v}"`)
  .replace('href="src/styles.css"', `href="src/styles.css?v=${v}"`)
  .replace('</head>', `${preload}\n</head>`);
if (html === before || !html.includes(`main.js?v=${v}`)) throw new Error('index.html: main.js nije pronađen');
writeFileSync(join(dir, 'index.html'), html);
console.log(`version-urls: v${v}, ${count} uvoza u ${files.length} fajlova, ${seen.size} modulepreload`);
