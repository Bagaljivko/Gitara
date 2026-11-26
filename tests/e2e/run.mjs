// MARLI browser testovi: node tests/e2e/run.mjs [--only ime,ime] [--built] [--base URL] [--list]
//   --built  testira kopiju kakva se objavljuje (isti koraci kao .github/workflows/deploy.yml: verzija u adresama + minify)
//   --base   testira već pokrenut server (npr. objavljenu stranicu)
// Testovi se izvršavaju jedan po jedan (nikad paralelno). Izveštaj: tests/e2e/last-report.txt
import { readdirSync, writeFileSync, mkdtempSync, cpSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { chromium, Fail } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const only = arg('--only') ? arg('--only').split(',') : null;

// --- statički server (bez zavisnosti) ---
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.ico': 'image/x-icon' };
function serve(dir) {
  return new Promise((res) => {
    const srv = createServer((req, rsp) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
      try { const buf = readFileSync(join(dir, p)); rsp.writeHead(200, { 'content-type': TYPES[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream', 'cache-control': 'no-store' }); rsp.end(buf); }
      catch { rsp.writeHead(404); rsp.end('not found'); }
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}
function buildCopy() {
  const out = mkdtempSync(join(tmpdir(), 'marli-built-'));
  for (const f of ['index.html', 'privacy.html', 'manifest.webmanifest', 'sw.js', 'src', 'icons', 'screenshots', 'assets', 'vendor', 'fonts', 'courses']) cpSync(join(ROOT, f), join(out, f), { recursive: true });
  mkdirSync(join(out, 'docs'), { recursive: true }); cpSync(join(ROOT, 'docs/novosti'), join(out, 'docs/novosti'), { recursive: true });
  execSync(`node scripts/version-urls.mjs ${out}`, { cwd: ROOT, stdio: 'inherit' });
  execSync(`npx --yes esbuild@0.24.2 ${out}/src/*.js --minify --target=es2022 --format=esm --outdir=${out}/src --allow-overwrite --log-level=warning`, { cwd: ROOT, stdio: 'inherit', shell: '/bin/bash' });
  execSync(`npx --yes esbuild@0.24.2 ${out}/src/styles.css ${out}/src/practice.css ${out}/src/freeplay.css --minify --outdir=${out}/src --allow-overwrite --log-level=warning`, { cwd: ROOT, stdio: 'inherit', shell: '/bin/bash' });
  return out;
}

const specs = readdirSync(join(HERE, 'specs')).filter((f) => f.endsWith('.mjs')).sort();
if (args.includes('--list')) { for (const f of specs) { const m = await import(pathToFileURL(join(HERE, 'specs', f))); console.log(f.replace('.mjs', '').padEnd(22), m.name); } process.exit(0); }

let srv = null, base = arg('--base');
if (!base) { const dir = args.includes('--built') ? buildCopy() : ROOT; srv = await serve(dir); base = `http://127.0.0.1:${srv.address().port}/`; }
const ver = readFileSync(join(ROOT, 'src/version.js'), 'utf8').match(/APP_VERSION = '([\d.]+)'/)[1];
const browser = await chromium.launch();
const lines = []; let pass = 0, fail = 0; const t0 = Date.now();
const log = (s) => { lines.push(s); console.log(s); };
log(`MARLI ${ver} — e2e ${new Date().toISOString()} — ${base}${args.includes('--built') ? ' (objavljena kopija)' : ''}`);
for (const f of specs) {
  const id = f.replace('.mjs', '');
  if (only && !only.some((o) => id.includes(o))) continue;
  const m = await import(pathToFileURL(join(HERE, 'specs', f)));
  const ctx = { browser, base, ver, root: ROOT, opened: [], note: [] };
  const ts = Date.now(); let res = 'PASS', detail = '';
  try {
    await Promise.race([m.run(ctx), new Promise((_, rej) => setTimeout(() => rej(new Fail('vreme isteklo (' + (m.timeout || 240) + ' s)')), (m.timeout || 240) * 1000))]);
    for (const pg of ctx.opened.flatMap((c) => c.pages())) if (pg.errs && pg.errs.length && !m.allowErrors) throw new Fail('greške na stranici', pg.errs.slice(0, 5));
  } catch (e) { res = 'FAIL'; detail = (e.message || String(e)).split('\n')[0] + (e.detail !== undefined ? ' ' + JSON.stringify(e.detail).slice(0, 900) : ''); }
  for (const c of ctx.opened) await c.close().catch(() => {});
  if (res === 'PASS') pass++; else fail++;
  log(`${res} ${id} — ${m.name} (${((Date.now() - ts) / 1000).toFixed(0)} s)${ctx.note.length ? ' · ' + ctx.note.join(' · ') : ''}${detail ? '\n     ' + detail : ''}`);
}
log(`DONE ${pass} PASS, ${fail} FAIL, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
writeFileSync(join(HERE, 'last-report.txt'), lines.join('\n') + '\n');
await browser.close(); srv?.close();
process.exit(fail ? 1 : 0);
