// Memorija i skakanje: krug kroz sve ekrane ne ostavlja stare ekrane (čvorovi i osluškivači isti), ekrani ne skaču dok se pune.
import { open, boot, addSong, expect, metrics, throttle } from '../lib.mjs';
export const name = 'bez curenja memorije (telefon, računar) i bez skakanja ekrana (Vežbe, igra, Podešavanja)';
export const timeout = 400;
export async function run(ctx) {
  for (const dev of ['phone', 'desk']) {
    const p = await open(ctx, dev, { init: () => { window.__cls = 0; new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: 'layout-shift', buffered: true }); } });
    await boot(p, ctx, '#/tuner', 1500);
    const id = await addSong(p, { title: 'Memorija', lines: 12 });
    const routes = ['#/pesme', '#/pesma/' + id, '#/vezbe', '#/vezbe/pauk', '#/akordi', '#/podesavanja', '#/vezbe/rp', '#/tuner'];
    const round = async () => { for (const r of routes) await p.go(r, 450); };
    await round(); await round(); const a = await metrics(p);
    await round(); await round(); await round(); const b = await metrics(p);
    expect(b.nodes - a.nodes <= 0 && b.listeners - a.listeners <= 0, `${dev}: curenje posle 3 kruga`, { a, b });
    const cdp = await throttle(p, 4); const cls = {};
    for (const h of ['#/vezbe', '#/vezbe/pauk', '#/podesavanja']) { await p.go('#/tuner', 500); await p.evaluate(() => { window.__cls = 0; }); await p.go(h, 2200); cls[h] = +(await p.evaluate(() => window.__cls)).toFixed(3); }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    expect(Math.max(...Object.values(cls)) < 0.05, `${dev}: ekran skače dok se puni`, cls);
    ctx.note.push(`${dev}: Δčvorova ${b.nodes - a.nodes}, skakanje ≤ ${Math.max(...Object.values(cls))}`);
  }
}
