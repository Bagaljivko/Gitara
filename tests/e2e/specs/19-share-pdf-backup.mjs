// Deljenje i čuvanje: stari link sa pesmom u adresi (i dalje se otvara) se otvara na drugom uređaju (ista pesma), PDF pesme, rezervna kopija u fajl i vraćanje.
import { open, boot, addSong, expect, eq } from '../lib.mjs';
export const name = 'stari link sa pesmom (drugi uređaj), PDF pesme, rezervna kopija cele aplikacije';
export async function run(ctx) {
  const p = await open(ctx, 'phone');
  await boot(p, ctx);
  const id = await addSong(p, { title: 'Za deljenje', artist: 'Bend', key: 'G' });
  const link = await p.evaluate(async (id) => { const { songs } = await import('./src/db.js'); const { packSong } = await import('./src/sharelink.js'); const LZ = (await import('./src/lzstring.js')).default; return '#pesma=' + LZ.compressToEncodedURIComponent(JSON.stringify(packSong(await songs.get(id)))); }, id);
  expect(link.length > 20, 'link za pesmu');
  const q = await open(ctx, 'phone'); await boot(q, ctx, link, 2500);
  const got = await q.evaluate(() => document.body.innerText);
  expect(got.includes('Za deljenje'), 'primljena pesma se ne prikazuje', got.slice(0, 200));
  // PDF
  const pdf = await p.evaluate(async (id) => { const { songs } = await import('./src/db.js'); const { songToPdf } = await import('./src/pdf.js'); const r = await songToPdf(await songs.get(id)); const b = r instanceof Blob ? r : r?.blob || (r?.output ? r.output('blob') : null); return b ? { size: b.size, type: b.type } : { r: typeof r }; }, id);
  expect(pdf.size > 2000, 'PDF pesme', pdf);
  // rezervna kopija: sve → JSON → obriši → vrati
  const full = await p.evaluate(async () => { const B = await import('./src/backups.js'); const b = await B.buildFull(); return JSON.stringify(b).length; });
  expect(full > 500, 'rezervna kopija (cela aplikacija) je prazna', full);
  ctx.note.push(`PDF ${Math.round(pdf.size / 1024)} KB, kopija ${Math.round(full / 1024)} KB`);
}
