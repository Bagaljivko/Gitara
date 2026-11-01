// Posle `vite build`: pravi dist/sw.js sa listom svih fajlova za rad bez interneta.
import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const dist = new URL('../dist/', import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(relative(dist, p).split('\\').join('/'));
  }
})(dist);

const assets = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map')).sort();
const hash = createHash('sha256');
for (const f of assets) hash.update(f).update(readFileSync(join(dist, f)));
const version = hash.digest('hex').slice(0, 12);
const precache = ['./', ...assets.filter((f) => f !== 'index.html').map((f) => './' + f)];

const sw = `// Generisano pri build-u (scripts/gen-sw.mjs). Ne menjati ručno.
const CACHE = 'gitara-${version}';
const PRECACHE = ${JSON.stringify(precache, null, 1)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gitara-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Gemini API i ostalo idu direktno na mrežu
  if (req.mode === 'navigate') {
    // Stranica: prvo mreža (da dobijemo novu verziju), pa keš kad nema interneta.
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('./', copy));
        return res;
      }).catch(() => caches.match('./', { ignoreSearch: true }))
    );
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
`;
writeFileSync(join(dist, 'sw.js'), sw);
console.log(`sw.js: ${precache.length} fajlova, verzija ${version}`);
