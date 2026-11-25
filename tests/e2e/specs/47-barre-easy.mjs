// v2.4.33: Barré — igra (koraci: kažiprst, mali hvat, ceo hvat, promene; akordi iz pesme), lakši hvatovi za barré u pesmi
// (⚙ prekidač; dijagram „Lakši hvat“; važi i u Delovima pesme), korak „Barré akordi“ na putu kroz pesmu.
import { open, boot, addSong, expect, eq } from '../lib.mjs';
export const name = 'Barré: igra po koracima, lakši hvatovi u pesmi, korak na putu kroz pesmu';
export const timeout = 150;
export async function run(ctx) {
  for (const dev of ['phone', 'desktop']) {
    const p = await open(ctx, dev); await boot(p, ctx, '#/tuner', 900);
    const id = await addSong(p, { title: 'Barré pesma', chords: ['C', 'F', 'Am', 'G'], bpm: 90, strum: null });
    // igra iz pesme: barré akordi pesme
    await p.go('#/vezbe/bare?song=' + id, 1500);
    const g = await p.evaluate(() => ({ chips: [...document.querySelectorAll('[data-ch]')].map((b) => b.textContent).join(','), st: [...document.querySelectorAll('[data-st]')].map((b) => b.dataset.st).join(','), go: !!document.querySelector('#prGo:not([hidden])') }));
    expect(g.chips === 'F' && g.st === 'prst,mali,ceo,prom' && g.go, dev + ': Barré iz pesme (akord F, 4 koraka)', g);
    const notes = await p.evaluate(async () => { const B = await import('./src/pBarre.js'); return ['prst', 'mali', 'ceo'].map((s) => B.barreNotes('F', s).map((n) => n.s + ':' + n.f).join(' ')); });
    eq(notes[0], '0:1 1:1 2:1 3:1 4:1 5:1 4:1 3:1 2:1 1:1 0:1', dev + ': kažiprst preko svih žica nagore i nadole');
    eq(notes[1], '2:3 3:2 4:1 5:1 4:1 3:2 2:3', dev + ': mali F (xx3211)');
    await p.click('[data-st="mali"]'); await p.waitForTimeout(200);
    expect(await p.evaluate(() => document.querySelector('[data-st="mali"]').classList.contains('on')), dev + ': izbor koraka');
    // „Promene“ → Promene akorda sa C → F
    await p.click('[data-st="prom"]'); await p.waitForTimeout(1500);
    const pr = await p.evaluate(() => ({ h: decodeURIComponent(location.hash), seq: [...document.querySelectorAll('.cs-seq [data-i] b')].map((b) => b.textContent).join(',') }));
    expect(/promena\?song=.*ch=C-F/.test(pr.h) && pr.seq === 'C,F', dev + ': Promene u barré', pr);
    // put kroz pesmu: korak „Barré akordi: F“
    await p.go('#/vezbe/pesma/' + id, 1500);
    const step = await p.evaluate(() => document.querySelector('.lp-nd[data-plan="bare"]')?.innerText.replace(/\s+/g, ' ') || '');
    expect(/Barré akordi: F/.test(step), dev + ': korak Barré na putu kroz pesmu', step);
    // ⚙ lakši hvatovi za barré → pesma pamti mali F; Delovi pesme koriste taj hvat
    await p.go('#/pesma/' + id, 1500);
    await p.evaluate(() => document.querySelector('#sChips .sc-set')?.click()); await p.waitForTimeout(600);
    await p.evaluate(() => { const m = document.querySelector('.ss-more:not(.open)'); if (m) m.click(); }); await p.waitForTimeout(300);
    const sw = await p.$('[data-ss="eshapes"]');
    expect(sw, dev + ': nema prekidača „Lakši hvatovi za barré“');
    await p.click('[data-ss="eshapes"]'); await p.waitForTimeout(600);
    const sh = await p.evaluate(async (id) => { const { songs } = await import('./src/db.js'); const C = await import('./src/chords.js'); const s = await songs.get(id); return { v: (s.shapes || {}).F, e: C.easyIndex('F') }; }, id);
    expect(sh.v === sh.e && sh.e > 0, dev + ': pesma ne pamti lakši hvat', sh);
    const items = await p.evaluate(async (id) => { const { songs } = await import('./src/db.js'); const s = await songs.get(id); const T = await import('./src/practiceTrack.js'); return T.chordItem('F', 0, 4, { voicing: s.shapes.F }).frets.join(','); }, id);
    eq(items, '-1,-1,3,2,1,1', dev + ': staza koristi lakši F');
    expect(!p.errs.length, dev + ': greške', p.errs);
    await p.close();
  }
}
