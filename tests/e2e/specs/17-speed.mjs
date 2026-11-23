// Brzina na sporom uređaju (procesor 6× sporiji, 80 pesama): pokretanje, prelazi, pomeranje teksta i liste ~60 sličica.
import { open, boot, addSongs, expect, throttle } from '../lib.mjs';
export const name = 'brzina na starom telefonu (6× sporiji procesor): start, prelazi, glatko pomeranje';
export const timeout = 400;
export async function run(ctx) {
  for (const dev of ['phone', 'desk']) {
    const p = await open(ctx, dev);
    await boot(p, ctx);
    const ids = await addSongs(p, 80, { lines: 30 });
    const cdp = await throttle(p, 6);
    const t0 = Date.now(); await p.reload(); await p.waitForSelector('#tStartBtn', { timeout: 20000 }); const start = Date.now() - t0;
    const times = {};
    for (const [h, sel] of [['#/pesme', '.song-item, .dk-table tr[data-id]'], ['#/pesma/' + ids[3], '#sLyrics .lyr-line, #sLyrics'], ['#/vezbe', '.pr-card'], ['#/podesavanja', '[data-open]']]) {
      await p.go('#/tuner', 800); const t = Date.now(); await p.evaluate((h) => { location.hash = h; }, h); await p.waitForSelector(sel, { timeout: 20000 }); times[h.slice(0, 9)] = Date.now() - t;
    }
    await p.go('#/pesma/' + ids[3], 1500);
    const fps = await p.evaluate(async () => { let n = 0, slow = 0, last = performance.now(); const se = document.scrollingElement; const t0 = performance.now(); await new Promise((r) => { const f = (now) => { if (now - last > 34) slow++; last = now; n++; se.scrollTop += 8; if (now - t0 < 2000) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); }); return { fps: Math.round(n / 2), slow }; });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    expect(start < 4000, `${dev}: pokretanje sporo`, start);
    expect(Math.max(...Object.values(times)) < 3000, `${dev}: prelaz spor`, times);
    expect(fps.fps >= 50, `${dev}: pomeranje teksta nije glatko`, fps);
    ctx.note.push(`${dev}: start ${start} ms, najsporiji prelaz ${Math.max(...Object.values(times))} ms, ${fps.fps} fps`);
  }
}
