// v2.4.13: [ ] — akordi u jednom ritmu (istom taktu): prikaz u pesmi i u „Sviraj“, uključi/isključi na računaru
// (klik na akord → [ ]) i na telefonu (Uredi akorde → [ ] U jednom ritmu), čuva se pri deljenju i u tekstu („Uredi pesmu“).
import { open, boot, expect } from '../lib.mjs';
export const name = 'zagrade [ ] oko akorda u jednom ritmu (telefon i računar, deljenje, Sviraj)';
const SONG = { title: 'Zagrade', artist: 'Test', key: 'G', bpm: 90, sections: [{ name: 'Strofa', lines: [
  { text: 'Kad bi bio sad tu pored mene', chords: [{ position: 0, chord: 'G' }, { position: 12, chord: 'D', g: true }, { position: 20, chord: 'Em' }] },
  { text: 'sve bi bilo kao nekad pre', chords: [{ position: 0, chord: 'C' }, { position: 8, chord: 'G' }, { position: 14, chord: 'Am' }] }] }] };
export async function run(ctx) {
  for (const dev of ['phone', 'desk']) {
    const q = await open(ctx, dev); await boot(q, ctx);
    const id = await q.evaluate(async (s) => (await (await import('./src/db.js')).songs.save(s)).id, SONG);
    await q.go('#/pesma/' + id, 1800);
    await q.evaluate(() => document.getElementById('toast')?.remove());
    const br = () => q.evaluate(() => [...document.querySelectorAll('#sLyrics .ch')].map((c) => c.textContent + (c.classList.contains('brk-o') ? '[' : '') + (c.classList.contains('brk-c') ? ']' : '')).join(' '));
    expect(/D\[ Em\]/.test(await br()), dev + ': zagrada se ne prikazuje', await br());
    const g = () => q.evaluate(async (id) => (await (await import('./src/db.js')).songs.get(id)).sections[0].lines[1].chords.map((c) => c.chord + (c.g ? '+' : '')).join(' '), id);
    if (dev === 'desk') {
      // računar: klik na G u drugom redu → [ ] → G i Am u jednom ritmu
      await q.evaluate(() => [...document.querySelectorAll('#sLyrics .ln')][1].querySelectorAll('.ch')[1].click()); await q.waitForTimeout(300);
      expect(await q.$('.qe-pop [data-qe="brk"]'), 'računar: nema dugmeta [ ] na akordu');
      await q.click('.qe-pop [data-qe="brk"]'); await q.waitForTimeout(500);
      expect(await g() === 'C G+ Am', 'računar: [ ] ne povezuje akorde', await g());
      expect(/G\[ Am\]/.test(await br()), 'računar: nova zagrada se ne vidi', await br());
      // isto dugme uklanja
      await q.evaluate(() => [...document.querySelectorAll('#sLyrics .ln')][1].querySelectorAll('.ch')[1].click()); await q.waitForTimeout(300);
      await q.click('.qe-pop [data-qe="brk"]'); await q.waitForTimeout(500);
      expect(await g() === 'C G Am', 'računar: [ ] se ne uklanja', await g());
    } else {
      // telefon: ⋯ → Uredi → Uredi akorde (v2.4.18; ranije ⚙ → Akordi u pesmi) → dodir na G → [ ] U jednom ritmu
      await q.click('#sMore'); await q.waitForTimeout(500);
      await q.click('.more-item[data-v="edit"]'); await q.waitForTimeout(500);
      await q.click('.more-item[data-v="chords"]'); await q.waitForTimeout(600);
      const c = await q.evaluate(() => { const r = [...document.querySelectorAll('#sLyrics .ln')][1].querySelectorAll('.ch')[1].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await q.touchscreen.tap(c.x, c.y); await q.waitForTimeout(500);
      expect(await q.$('.te-sheet [data-te="brk"]'), 'telefon: nema [ ] u uređivanju akorda');
      await q.click('.te-sheet [data-te="brk"]'); await q.waitForTimeout(500);
      expect(await g() === 'C G+ Am', 'telefon: [ ] ne povezuje akorde', await g());
      await q.click('.te-sheet [data-te="done"]').catch(() => {}); await q.click('.te-bar .te-ok').catch(() => {}); await q.waitForTimeout(400);
    }
    // deljenje i tekst (Uredi pesmu) čuvaju zagradu
    const rt = await q.evaluate(async (id) => {
      const { songs } = await import('./src/db.js'); const s = await songs.get(id);
      const C = await import('./src/shareCode.js'); const pkg = C.readPackage(await C.decode(await C.encode(C.makePackage([s]))));
      const F = await import('./src/songformat.js'); const txt = F.sectionsToText(s.sections); const back = F.textToSections(txt);
      return { share: pkg.songs[0].sections[0].lines[0].chords.map((c) => c.chord + (c.g ? '+' : '')).join(' '), text: back[0].lines[0].chords.map((c) => c.chord + (c.g ? '+' : '')).join(' ') };
    }, id);
    expect(rt.share === 'G D+ Em' && rt.text === 'G D+ Em', dev + ': zagrada se gubi pri deljenju / u tekstu', rt);
    if (dev === 'desk') {
      // Sviraj: zagrada i na ekranu za sviranje
      await q.go('#/nastup/' + encodeURIComponent('pesma:' + id) + '?i=0', 1800);
      expect(await q.evaluate(() => !!document.querySelector('.stage-lyrics .ch.brk-o') && !!document.querySelector('.stage-lyrics .ch.brk-c')), 'Sviraj: nema zagrade');
    }
  }
}
