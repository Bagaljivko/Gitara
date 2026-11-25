// v2.4.27: dve verzije iste pesme — najava „Uporedi“, poređenje (kartice, razlike po delovima), Spoji u jednu
// (izabran tekst + tvoje vežbanje, setliste, veza sa nastavnikom), Poništi, Zadrži samo svoju (nove izmene pitaju ponovo), Ostavi obe.
import { open, boot, expect, eq } from '../lib.mjs';
export const name = 'dve verzije pesme: uporedi, spoji (tekst + istorija), poništi, zadrži samo jednu, ostavi obe';
export const timeout = 120;
export async function run(ctx) {
  for (const dev of ['phone', 'desktop']) {
    const p = await open(ctx, dev);
    await boot(p, ctx, '#/tuner', 900);
    const ids = await p.evaluate(async () => {
      const { songs, settings } = await import('./src/db.js');
      const L = (text, cs) => ({ text, chords: cs.map(([pos, chord]) => ({ pos, position: pos, chord })) });
      const mk = (last, extra) => ({ title: 'Volio bih da si tu', artist: 'Crvena jabuka', key: 'Em', bpm: 91, sections: [
        { name: 'Strofa 1', type: 'verse', lines: [L('Volio bih da si tu', [[0, 'Em'], [12, 'D']])] },
        { name: 'Refren', type: 'chorus', lines: [L('Nocas zvezde padat ce', [[0, 'Am'], [6, 'D'], [13, 'G'], [19, last]])] }, ...extra] });
      const T = await songs.save({ ...mk('H7', [{ name: 'Solo', type: 'other', lines: [L('', [[0, 'Em']])] }]), fromT: { tid: 't1', name: 'Mile' }, src: 'F1:0', folders: [] });
      const M = await songs.save({ ...mk('Em', []), title: 'Volio Bih Da Si Tu (live)', strum: { id: 'pop', sig: '4/4', steps: 'D-DUD-DU' }, folders: [] });
      await settings.set('practice', { songs: { [M.id]: { 0: { best: 90, plays: 5 }, all: { best: 88, plays: 3 } }, [T.id]: { 1: { best: 60, plays: 1 } } } });
      await settings.set('setlists', [{ v: 1, id: 'sl1', name: 'Svirka', songIds: [T.id, 'x'] }]);
      return { t: T.id, m: M.id };
    });
    await p.go('#/pesme', 1500);
    const note = await p.evaluate(() => { const b = document.getElementById('lDup'); return b && !b.hidden ? b.innerText : ''; });
    expect(/Volio bih da si tu/.test(note) && /nastavnika/.test(note), 'nema najave „dve verzije“ na listi', note);
    await p.click('#lDup .mg-go'); await p.waitForTimeout(400);
    const scr = await p.evaluate(() => ({ cards: [...document.querySelectorAll('.mg-v')].map((x) => x.innerText.replace(/\s+/g, ' ')), rows: [...document.querySelectorAll('.mg-r')].map((x) => x.innerText.replace(/\s+/g, ' ')), on: document.querySelector('.mg-v.on .who')?.textContent }));
    expect(scr.cards.length === 2 && /Mile/.test(scr.cards[0]) && /Tvoja/.test(scr.cards[1]) && /3 dela/.test(scr.cards[0]) && /2 dela/.test(scr.cards[1]) && /Pop/.test(scr.cards[1]) && /8×/.test(scr.cards[1]), 'kartice verzija', scr);
    expect(/Strofa 1 isto/.test(scr.rows[0]) && /Refren drugi akordi/.test(scr.rows[1]) && /Solo samo: Mile/.test(scr.rows[2]), 'razlike po delovima', scr.rows);
    await p.click('.mg-r[data-r="1"]'); await p.waitForTimeout(150);
    eq(await p.evaluate(() => [...document.querySelectorAll('.mg-x mark')].map((m) => m.textContent).join()), 'H7,Em', 'različiti akordi označeni');
    const fits = await p.evaluate(() => document.querySelector('.mg-wrap').scrollWidth <= innerWidth + 1);
    expect(fits, 'ekran poređenja je širi od ekrana');
    // Spoji: tekst od Mileta, istorija tvoja
    await p.click('[data-do="merge"]'); await p.waitForTimeout(700);
    const m1 = await p.evaluate(async (ids) => { const { songs, settings } = await import('./src/db.js'); const all = (await songs.all()).filter((s) => /volio/i.test(s.title)); const s = all[0];
      const st = await settings.get('practice', {}); const sl = await settings.get('setlists', []);
      return { n: all.length, id: s.id, last: s.sections[1].lines[0].chords[3].chord, parts: s.sections.length, fromT: s.fromT && s.fromT.name, src: s.src, keep: !!s.keepMine, strum: s.strum && s.strum.id, pr: Object.keys(st.songs || {}), best0: st.songs[s.id][0].best, has1: !!st.songs[s.id][1], set: sl[0].songIds.join() }; }, ids);
    expect(m1.n === 1 && m1.id === ids.m && m1.last === 'B7' && m1.parts === 3 && m1.fromT === 'Mile' && m1.src === 'F1:0' && !m1.keep && m1.strum === 'pop' && m1.best0 === 90 && m1.has1 && m1.set === ids.m + ',x', 'Spoji: tekst nastavnika + tvoje vežbanje, ritam, setlista, veza', m1);
    expect(await p.evaluate(() => /Spojeno/.test(document.querySelector('.toast')?.textContent || '')), 'nema poruke „Spojeno“ sa Poništi');
    await p.evaluate(() => [...document.querySelectorAll('.toast button')].find((b) => /Poništi/.test(b.textContent))?.click()); await p.waitForTimeout(700);
    const u = await p.evaluate(async () => { const { songs, settings } = await import('./src/db.js'); const all = (await songs.all()).filter((s) => /volio/i.test(s.title)); return { n: all.length, set: (await settings.get('setlists', []))[0].songIds.length }; });
    expect(u.n === 2 && u.set === 2, 'Poništi ne vraća obe verzije', u);
    // Zadrži samo svoju → nova verzija od nastavnika stiže posebno i pita ponovo
    await p.go('#/pesma/' + ids.m, 1500);
    expect(await p.evaluate(() => { const b = document.getElementById('sDup'); return !!b && !b.hidden; }), 'nema najave na ekranu pesme');
    await p.evaluate(() => document.querySelector('.modal-backdrop .btn.primary, .modal-backdrop button')?.click()); await p.waitForTimeout(300); // jednokratno: „Prethodne verzije“
    await p.click('#sDup .mg-go'); await p.waitForTimeout(400);
    await p.click(`.mg-v[data-v="${ids.m}"]`); await p.waitForTimeout(150);
    const keepTxt = await p.evaluate(() => document.querySelector('[data-do="keep"]').innerText);
    expect(/Tvoja/.test(keepTxt) && /pitaju ponovo/.test(keepTxt), 'Zadrži samo svoju: tekst', keepTxt);
    await p.click('[data-do="keep"]'); await p.waitForTimeout(800);
    const k = await p.evaluate(async (ids) => { const { songs } = await import('./src/db.js'); const I = await import('./src/shareImport.js');
      const all = (await songs.all()).filter((s) => /volio/i.test(s.title)); const s = all[0];
      const before = { n: all.length, src: s.src, keep: !!s.keepMine, last: s.sections[1].lines[0].chords[3].chord };
      await I.importTagged({ kind: 'song', songs: [{ title: 'Volio bih da si tu', artist: 'Crvena jabuka', sections: [{ name: 'Refren', lines: [{ text: 'nova', chords: [] }] }] }] }, 'F1', { fromT: { tid: 't1', name: 'Mile' } });
      const after = (await songs.all()).filter((x) => /volio/i.test(x.title)); const mine = after.find((x) => x.id === ids.m);
      return { before, n2: after.length, mineSrc: mine.src || '', mineLast: mine.sections[1].lines[0].chords[3].chord }; }, ids);
    expect(k.before.n === 1 && k.before.src === 'F1:0' && k.before.keep && k.before.last === 'Em' && k.n2 === 2 && !k.mineSrc && k.mineLast === 'Em', 'Zadrži svoju: nova izmena od nastavnika stiže posebno (tvoj tekst ostaje)', k);
    // Ostavi obe → nema više najave
    await p.go('#/pesme', 1400);
    expect(await p.evaluate(() => { const b = document.getElementById('lDup'); return !!b && !b.hidden; }), 'nova verzija: nema najave');
    await p.click('#lDup .mg-go'); await p.waitForTimeout(300); await p.click('[data-do="both"]'); await p.waitForTimeout(300);
    await p.go('#/tuner', 400); await p.go('#/pesme', 1200);
    expect(await p.evaluate(() => { const b = document.getElementById('lDup'); return !b || b.hidden; }), 'Ostavi obe: najava se vraća');
    eq(await p.evaluate(async () => { const M = await import('./src/songMerge.js'); return M.normKey('Đurđevdan (Live 1990)!') + '|' + M.normKey('Ðurdjevdan'); }), 'djurdjevdan|djurdjevdan', 'normKey');
    await p.close();
  }
}
