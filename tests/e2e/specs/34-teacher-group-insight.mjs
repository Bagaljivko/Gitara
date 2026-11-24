// v2.4.16: pesme od nastavnika su odmah u „Sve pesme“ i u grupi „🎓 Od nastavnika“ (telefon: čip, računar: grupa levo)
// — bez biranja foldera („Sačuvaj u…“ ne postoji; po želji „Dodaj u set listu“). Na pesmi: uvid bez štoperice
// (danas, ukupno, dani, vežbe sa zvezdicama); pesma otvorena bez dodira broji se do 10 min.
import { open, boot, addSong, expect } from '../lib.mjs';
export const name = 'pesme od nastavnika u svojoj grupi (bez biranja foldera); uvid na pesmi (danas, ukupno, vežbe)';
export async function run(ctx) {
  for (const dev of ['phone', 'desk']) {
    const p = await open(ctx, dev); await boot(p, ctx, '#/tuner', 900);
    const id = await addSong(p, { title: 'Volio bih da si tu', artist: 'Crvena jabuka', extra: { fromT: { tid: 'T1', name: 'Mile' } } });
    await addSong(p, { title: 'Ruža', artist: 'Bajaga' });
    await p.evaluate(async (id) => {
      const M = await import('./src/teach.js'); await M.setMyTeacher({ name: 'Mile', tid: 'T1', sid: 'S1' });
      const { settings } = await import('./src/db.js'); const A = await import('./src/activity.js'); const d = A.dayNum();
      await settings.set('activity', { v: 1, dev: { dX: { s: { [id]: { p: 8000000, n: 9, x: 1300000, last: Date.now(), d: [d - 3, d - 1, d], td: { d, ms: 840000 } } }, g: {}, days: {} } } });
      const P = await import('./src/practice.js'); await P.saveResult('pesma', { score: 95, tempo: 90 }, [id, '1']); await P.saveResult('pesma', { score: 60, tempo: 70 }, [id, '0']);
    }, id);
    await p.go('#/pesme', 1200);
    if (dev === 'desk') {
      await p.click('[data-g="teacher"]'); await p.waitForTimeout(600);
      const rows = await p.evaluate(() => [...document.querySelectorAll('.dt-title b')].map((b) => b.textContent));
      expect(rows.length === 1 && rows[0] === 'Volio bih da si tu', 'računar: grupa „Od nastavnika“ ne prikazuje samo pesme od nastavnika', rows);
    } else {
      await p.click('#lChips [data-chip="auto:teacher"]'); await p.waitForTimeout(600);
      const L = await p.evaluate(() => ({ n: document.querySelectorAll('#lList .song-item').length, note: !document.getElementById('lTNote').hidden, hash: location.hash }));
      expect(L.n === 1 && L.note && L.hash === '#/pesme', 'telefon: čip „Mile“ treba da filtrira pesme (ne da vodi na stranicu nastavnika)', L);
    }
    await p.go('#/pesma/' + id, 1500);
    const txt = await p.evaluate(() => document.querySelector('#sStats')?.innerText || '');
    expect(/Danas\s*14 min/.test(txt) && /Ukupno\s*2 h 35 min/.test(txt) && /3 dana/.test(txt) && /Refren/.test(txt) && /★★★/.test(txt), dev + ': uvid na pesmi', txt);
  }
  // stranica nastavnika: nova pesma — „U tvojim pesmama“, bez „Sačuvaj u…“
  const s = await open(ctx, 'phone'); await boot(s, ctx, '#/tuner', 900);
  await s.evaluate(async () => {
    const { songs } = await import('./src/db.js'); const x = await songs.save({ title: 'Nova', fromT: { tid: 'T1', name: 'Mile' }, sections: [{ name: 'A', lines: [{ text: 'la', chords: [{ position: 0, chord: 'G' }] }] }] });
    const M = await import('./src/teach.js'); await M.setMyTeacher({ name: 'Mile', tid: 'T1', sid: 'S1', boxNew: [x.id] });
  });
  await s.go('#/od-nastavnika', 1200);
  const h = await s.evaluate(() => document.body.innerText);
  expect(!/Sačuvaj u/.test(h) && /U tvojim pesmama/.test(h) && /Dodaj u set listu/.test(h), 'stranica nastavnika: nova pesma treba da je „U tvojim pesmama“ (bez „Sačuvaj u…“)', h.slice(0, 600));
}
