// Svaki ekran na svakom uređaju: bez grešaka, bez izlaska van ekrana, bez ključeva umesto teksta, sadržaj prisutan.
import { open, boot, addSong, overflowCheck, rawKeys, expect } from '../lib.mjs';
export const name = 'svi ekrani × telefon, telefon položeno, tablet (oba), računar — bez grešaka i preliva';
export const timeout = 600;
export async function run(ctx) {
  const bad = [];
  for (const dev of ['phone', 'phoneLand', 'tabPort', 'tabLand', 'desk']) {
    const p = await open(ctx, dev);
    await boot(p, ctx);
    const id = await addSong(p, { title: 'Ekrani', sections: 3 });
    await p.evaluate(async (id) => { const { settings } = await import('./src/db.js'); await settings.set('setlists', [{ id: 'slE', name: 'Svirka', songIds: [id], createdAt: Date.now() }]); }, id);
    const routes = [['#/tuner', '#tStartBtn'], ['#/akordi', 'main section'], ['#/pesme', '.song-item, .dk-table tr[data-id]'], ['#/pesme?tab=sl', 'main section'], ['#/pesma/' + id, '#sLyrics .lyr-line, #sLyrics'],
      ['#/uredi/' + id, 'main section'], ['#/setlista/slE', 'main section'], ['#/vezbe', '.pr-card'], ['#/podesavanja', 'main section'],
      ...['pauk', 'skale', 'lovac', 'ritam', 'promena', 'rp', 'sluh', 'pesma'].map((g) => ['#/vezbe/' + g, '.pr-game, main section'])];
    for (const [h, sel] of routes) {
      await p.go(h, 1100);
      const has = await p.$(sel);
      const ov = await overflowCheck(p);
      const keys = await rawKeys(p);
      if (!has) bad.push(`${dev} ${h}: nema „${sel}“`);
      if (ov.page || ov.items.length) bad.push(`${dev} ${h}: preliv ${JSON.stringify(ov)}`);
      if (keys.length) bad.push(`${dev} ${h}: ključevi ${keys.join(',')}`);
      if (p.errs.length) { bad.push(`${dev} ${h}: greške ${p.errs.join(' | ').slice(0, 300)}`); p.errs.length = 0; }
    }
  }
  expect(!bad.length, `${bad.length} problema`, bad.slice(0, 12));
}
