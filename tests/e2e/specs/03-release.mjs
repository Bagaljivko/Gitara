// Pre objave: verzija svuda ista, Šta je novo i stranica novosti imaju unos, sw.js ima sve fajlove,
// nema ključeva/tajni ni oznaka modela u kodu, srpski i engleski imaju iste ključeve.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '../lib.mjs';
export const name = 'objava: verzija, Šta je novo, novosti, sw.js, bez tajni, prevodi potpuni';
export async function run(ctx) {
  const R = ctx.root, rd = (f) => readFileSync(join(R, f), 'utf8');
  const v = ctx.ver, major = v.split('.').slice(0, 2).join('.');
  const wn = rd('src/whatsnew.js'); const top = wn.match(/NOTES = \[\s*\{ v: '([\d.]+)'/);
  expect(top && top[1] === v, 'Šta je novo: prvi unos nije ' + v, top && top[1]);
  const docs = rd('docs/novosti/index.html');
  expect(docs.includes(`id="v${v}"`) || docs.includes(`id="v${major}"`), 'docs/novosti nema odeljak za ' + v);
  const sec = docs.slice(docs.indexOf(`id="v${v}"`) > 0 ? docs.indexOf(`id="v${v}"`) : docs.indexOf(`id="v${major}"`)); const img = sec.slice(0, sec.indexOf('</section>')).match(/src="(img\/[^"]+)"/);
  expect(img && existsSync(join(R, 'docs/novosti', img[1])), 'odeljak novosti bez snimka ekrana', img && img[1]);
  const sw = rd('sw.js'); const src = readdirSync(join(R, 'src')).filter((f) => /\.(js|css)$/.test(f));
  const missing = src.filter((f) => !sw.includes(`"src/${f}"`)); expect(!missing.length, 'sw.js ne kešira (pokreni node scripts/update-sw.mjs)', missing);
  const stale = [...sw.matchAll(/"src\/([^"]+)"/g)].map((m) => m[1]).filter((f) => !src.includes(f)); expect(!stale.length, 'sw.js ima fajlove kojih nema', stale);
  // tajne i oznake modela
  const leaks = [];
  // izuzetak: javni ključ pregledača za kratke linkove (shareConfig.js, SHARE_API_KEY — ograničen na Drive API i adresu aplikacije)
  for (const f of src) { const s = rd('src/' + f).split('\n').filter((l) => !(f === 'shareConfig.js' && /^export const SHARE_API_KEY = /.test(l))).join('\n'); if (/AIza[0-9A-Za-z_-]{30,}/.test(s)) leaks.push(f + ': Google ključ'); if (/claude-(opus|sonnet|haiku|fable)-\d/i.test(s)) leaks.push(f + ': oznaka modela'); if (/ghp_[0-9A-Za-z]{20,}|sk-[A-Za-z0-9]{30,}/.test(s)) leaks.push(f + ': token'); }
  expect(!leaks.length, 'tajne ili oznake modela u kodu', leaks);
  // prevodi: svaki srpski ključ ima engleski (i obrnuto)
  const keys = (s) => new Set([...s.matchAll(/^\s+'([\w.-]+)':/gm)].map((m) => m[1]));
  const sr = keys(rd('src/i18n.js')), en = keys(rd('src/i18n-en.js'));
  // isti ključ dvaput u istom fajlu: važi samo poslednji (prvi je mrtav tekst i zbunjuje)
  const dups = (s) => { const seen = new Set(), d = []; for (const m of s.matchAll(/^\s+'([\w.-]+)':/gm)) { if (seen.has(m[1])) d.push(m[1]); seen.add(m[1]); } return d; };
  const dd = [...dups(rd('src/i18n.js')).map((k) => 'sr ' + k), ...dups(rd('src/i18n-en.js')).map((k) => 'en ' + k)];
  expect(!dd.length, 'ključ prevoda dvaput u istom fajlu', dd);
  const noEn = [...sr].filter((k) => !en.has(k)), noSr = [...en].filter((k) => !sr.has(k));
  expect(!noEn.length, 'ključevi bez engleskog prevoda', noEn.slice(0, 20));
  expect(!noSr.length, 'engleski ključevi kojih nema na srpskom', noSr.slice(0, 20));
  ctx.note.push(`${src.length} fajlova u sw.js, ${sr.size} ključeva`);
}
