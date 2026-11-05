// Svako deljenje prolazi kroz shareService.js. Ovaj test pada ako neki drugi deo aplikacije sam poziva meni za
// deljenje ili pravi link sa podacima u adresi — nova deljenja moraju da koriste shareService.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const SRC = new URL('../src/', import.meta.url);
const files = readdirSync(SRC).filter((f) => f.endsWith('.js'));
const read = (f) => readFileSync(new URL(f, SRC), 'utf8');

test('every share path goes through the one share service', () => {
  const offenders = [];
  for (const f of files) {
    if (f === 'shareService.js') continue;
    const s = read(f);
    if (/navigator\s*\.\s*(share|canShare)\b/.test(s)) offenders.push(`${f}: navigator.share`);
    // gradnja linka sa podacima u adresi (#g=… / #pesma=… / #d/…) — samo čitanje je dozvoljeno
    if (/['"`]#(g=|pesma=|d\/)['"`]?\s*\+|\+\s*['"`]#(g=|pesma=|d\/)|\$\{[^}]*\}#(g=|pesma=|d\/)|#d\/\$\{/.test(s.replace(/startsWith\(['"`]#(g=|pesma=|d\/)['"`]\)/g, ''))) offenders.push(`${f}: builds a share link`);
    if (/\bshareLink\s*\(|\bsongLink\s*\(|compressToEncodedURIComponent/.test(s) && f !== 'lzstring.js' && f !== 'shareCode.js') offenders.push(`${f}: data-in-URL encoder`);
  }
  assert.deepEqual(offenders, []);
  // shareCode.js only decodes old links (no link builder anymore)
  assert.ok(!/export (async )?function shareLink/.test(read('shareCode.js')));
  // entry points use the service
  for (const [f, re] of [['songs.js', /shareService\.js'\)\)\.shareSong\(/], ['setlistsView.js', /shareService\.js'\)\)\.shareSetlist\(/], ['settingsView.js', /shareApp\(/], ['tabView.js', /shareService\.js'\)\)\.shareFile\(/]]) assert.match(read(f), re, f);
  // the short link format
  assert.match(read('shareService.js'), /`\$\{SHARE_BASE\}#d\/\$\{fileId\}`/);
  assert.match(read('shareConfig.js'), /SHARE_BASE = 'https:\/\/bagaljivko\.github\.io\/Gitara\/'/);
});
