// v2.4.4: uređaji u sinhronizaciji (svaki uređaj svoja stavka 'dev:'), objašnjenja problema običnim rečima,
// metronom i štoperica na pesmi (telefon i računar).
import { open, boot, addSong, expect, appModule } from '../lib.mjs';
export const name = 'sinhronizacija: uređaji i jasni problemi; pesma: metronom i štoperica (telefon i računar)';
export async function run(ctx) {
  const p = await open(ctx, 'phone'); await boot(p, ctx);
  const r = await p.evaluate(async () => {
    const D = await import('./src/devices.js'); const L = (await import('./src/syncLocal.js')).createLocal(); const { settings } = await import('./src/db.js');
    await D.beat({ force: true });
    const meta = await L.meta('dev:' + D.myId());
    await L.write('dev:dOTHER', { name: 'iPhone', at: Date.now() - 3 * 3600e3, ver: '2.4.3' }, { hlc: '1', dirty: false });
    const list = await settings.get('devices', []);
    const read = await L.read('dev:dOTHER');
    const box = document.createElement('div'); box.innerHTML = await D.listHTML(); document.body.appendChild(box);
    const Y = await import('./src/sync.js');
    return { dirty: !!(meta && meta.dirty), n: list.length, read: read && read.name, html: box.innerText, help: ['offline', 'connect', 'quota', 'error', 'newer'].map((s) => Y.statusHelp(s)) };
  });
  expect(r.dirty, 'ovaj uređaj nije spreman za slanje u sinhronizaciju (dev:)');
  expect(r.n === 2 && r.read === 'iPhone', 'stavka drugog uređaja se ne upisuje/čita', r);
  expect(/ovaj uređaj/.test(r.html) && /iPhone/.test(r.html) && /pre 3 h/.test(r.html), 'spisak uređaja', r.html);
  expect(r.help.every((h) => h && h.length > 40) && /sačuvan/.test(r.help.join(' ')), 'objašnjenja problema sinhronizacije', r.help);
  for (const dev of ['phone', 'desk']) {
    const q = await open(ctx, dev, { init: () => localStorage.setItem('marli-songbar', JSON.stringify(['metro', 'timer'])) });
    await boot(q, ctx);
    const id = await addSong(q, { title: 'Alatke', bpm: 96 });
    await q.go('#/pesma/' + id, 1500);
    // telefon/tablet: čipovi na vrhu; računar: dugmad u traci pesme
    const sel = (k) => (dev === 'desk' ? `#sTb [data-tb="${k}"]` : `#sChips [data-sca="${k}"]`);
    const chip = (k) => q.evaluate((s) => document.querySelector(s)?.textContent.trim(), sel(k));
    expect(await chip('metro') && await chip('timer'), dev + ': nema metronoma/štoperice', [await chip('metro'), await chip('timer')]);
    await q.click(sel('metro')); await q.waitForTimeout(400);
    expect(/96 BPM/.test(await chip('metro')), dev + ': metronom ne pokazuje tempo pesme', await chip('metro'));
    await q.click(sel('timer')); await q.waitForTimeout(2300);
    expect(/0:0[23]$/.test(await chip('timer')), dev + ': štoperica ne broji', await chip('timer'));
    await q.click(sel('timer')); const a = await chip('timer'); await q.waitForTimeout(1200);
    expect(a === (await chip('timer')), dev + ': štoperica ne staje na pauzu');
    await q.click(sel('metro')); await q.waitForTimeout(300);
    expect(!/BPM/.test(await chip('metro')), dev + ': metronom se ne gasi');
    if (dev === 'desk') continue; // ⚙ panel je na telefonu/tabletu
    // ⚙: oba reda postoje
    await q.click('#sChips [data-sheet="all"]'); await q.waitForTimeout(400);
    expect(await q.evaluate(() => !!document.querySelector('.song-sheet .ss-item[data-k="metro"]') && !!document.querySelector('.song-sheet .ss-item[data-k="timer"]')), dev + ': nema redova u ⚙');
  }
}
