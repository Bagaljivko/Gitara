// v2.4.34: dugo korišćenje bez curenja — posle više krugova (pesme, igre, Vežbaj pesmu, Pevaj uz tekst, Barré, Ritam,
// biblioteka) broj slušalaca na window/document i broj elemenata na stranici ostaju isti; ekran pesme ne učitava igre.
import { open, boot, addSongs, expect } from '../lib.mjs';
export const name = 'bez curenja: slušaoci i elementi isti posle više krugova; ekran pesme bez koda igara';
export const timeout = 200;
export async function run(ctx) {
  const p = await open(ctx, 'phone');
  const cdp = await p.context().newCDPSession(p);
  await boot(p, ctx, '#/tuner', 900);
  const ids = await addSongs(p, 12, { lines: 6 });
  const lis = async () => { let n = 0; const by = {}; for (const expr of ['window', 'document']) { const { result } = await cdp.send('Runtime.evaluate', { expression: expr }); const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId }); for (const l of listeners) { n++; by[expr + ':' + l.type] = (by[expr + ':' + l.type] || 0) + 1; } } return { n, by }; };
  const go = async (h, w = 300) => { await p.evaluate((h) => { location.hash = h; }, h); await p.waitForTimeout(w); };
  const cycle = async () => { for (const id of ids.slice(0, 4)) await go('#/pesma/' + id); for (const g of ['pauk', 'promena', 'pesma/' + ids[0], 'pesma/' + ids[0] + '?m=sing', 'bare', 'rp']) await go('#/vezbe/' + g, 450); await go('#/pesme', 400); await go('#/tuner', 500); };
  await cycle(); const a = await lis(); const n0 = await p.evaluate(() => document.querySelectorAll('*').length);
  await cycle(); await cycle(); const b = await lis(); const n1 = await p.evaluate(() => document.querySelectorAll('*').length);
  const grew = Object.keys(b.by).filter((k) => (b.by[k] || 0) > (a.by[k] || 0)).map((k) => k + ' +' + (b.by[k] - (a.by[k] || 0)));
  expect(!grew.length, 'slušaoci se gomilaju', grew);
  expect(n1 <= n0 + 5, 'elementi se gomilaju', { n0, n1 });
  // ekran pesme (sveža stranica) ne učitava kod igara (staza, slušanje) ni prozor za poređenje
  const q = await open(ctx, 'phone'); await boot(q, ctx, '#/tuner', 900);
  const sid = (await addSongs(q, 2, { lines: 6 }))[0];
  await q.evaluate((h) => { location.hash = h; }, '#/pesma/' + sid); await q.waitForTimeout(1800);
  const mods = await q.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name.replace(/^.*\/src\//, '').replace(/\?.*$/, '')));
  expect(mods.includes('songs.js') && mods.includes('songParts.js'), 'merenje ne radi (songs.js / songParts.js nisu viđeni)', mods.filter((m) => /\.js$/.test(m)));
  const heavy = mods.filter((u) => /^(practiceTrack|practiceListen|practicePitch|pSong|songPracticeUI|songMerge)\.js$/.test(u));
  expect(!heavy.length, 'ekran pesme učitava kod igara', heavy);
  expect(!q.errs.length, 'greške (pesma)', q.errs);
  expect(!p.errs.length, 'greške', p.errs);
}
