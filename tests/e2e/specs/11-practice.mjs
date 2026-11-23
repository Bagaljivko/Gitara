// Vežbe: sve igre na meniju, „Danas“, svaka igra se otvara (dugme Počni ili izbor), bez skakanja; Ritam i promene.
import { open, boot, addSong, expect } from '../lib.mjs';
export const name = 'Vežbe: 8 igara, Danas, svaka igra se otvara (telefon i računar)';
const GAMES = ['pauk', 'skale', 'lovac', 'ritam', 'promena', 'rp', 'sluh', 'pesma'];
export async function run(ctx) {
  for (const dev of ['phone', 'desk']) {
    const p = await open(ctx, dev);
    await boot(p, ctx);
    await addSong(p, { title: 'Za vežbu' });
    await p.go('#/vezbe', 1500);
    const cards = await p.evaluate(() => [...document.querySelectorAll('.pr-cards .pr-card')].map((a) => a.getAttribute('href').split('/').pop()));
    expect(GAMES.every((g) => cards.includes(g)), dev + ': nedostaju igre', cards);
    expect(await p.$('#prToday'), dev + ': nema kartice Danas');
    for (const g of GAMES) {
      await p.go('#/vezbe/' + g, 1600);
      const st = await p.evaluate(() => ({ title: document.querySelector('.pr-gtitle')?.textContent.trim(), go: !!document.querySelector('#prGo:not([hidden])'), loading: !!document.querySelector('.pr-loading'), body: !!document.querySelector('.pr-stage, .rx-tabs, .rx-card') }));
      expect(st.title && !st.loading && (st.go || st.body), `${dev} ${g}: ekran igre`, st);
    }
  }
}
