// Uređivanje pesme: naslov i tekst se menjaju i čuvaju; pesma posle čuvanja prikazuje izmenu; Otkaži ne menja ništa.
import { open, boot, addSong, expect, eq } from '../lib.mjs';
export const name = 'uređivanje pesme (telefon i računar): naslov, tekst, Sačuvaj, Otkaži';
export async function run(ctx) {
  for (const dev of ['phone', 'desk']) {
    const p = await open(ctx, dev);
    await boot(p, ctx);
    const id = await addSong(p, { title: 'Stari naslov', sections: 1, lines: 2 });
    await p.go('#/uredi/' + id, 1500);
    expect(await p.$('#eTitle'), dev + ': editor se nije otvorio');
    await p.fill('#eTitle', 'Novi naslov');
    const txt = await p.inputValue('#eText').catch(() => null);
    if (txt !== null) await p.fill('#eText', txt.replace('stih broj 1', 'izmenjen stih'));
    await p.click('#eSave'); await p.waitForTimeout(1500);
    const s = await p.evaluate(async (id) => (await (await import('./src/db.js')).songs.get(id)), id);
    eq(s.title, 'Novi naslov', dev + ': naslov');
    if (txt !== null) expect(JSON.stringify(s.sections).includes('izmenjen stih'), dev + ': tekst nije sačuvan');
    expect(/#\/pesma\//.test(await p.evaluate(() => location.hash)) || dev === 'desk', dev + ': posle čuvanja nije na pesmi');
    // Otkaži
    await p.go('#/uredi/' + id, 1300); await p.fill('#eTitle', 'NE ČUVAJ');
    await p.click('#eCancel'); await p.waitForTimeout(800);
    await p.evaluate(() => document.querySelector('.modal-backdrop .btn.danger, .modal-backdrop [data-v="discard"], .modal-backdrop .btn.primary')?.click()); await p.waitForTimeout(600);
    eq((await p.evaluate(async (id) => (await (await import('./src/db.js')).songs.get(id)), id)).title, 'Novi naslov', dev + ': Otkaži je sačuvao izmenu');
  }
}
