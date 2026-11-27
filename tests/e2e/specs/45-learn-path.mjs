// v2.4.31: „Nauči ovu pesmu“ — put kroz pesmu iz sadržaja pesme (novi akordi, najteže promene, ritam, deo po deo,
// pevanje, cela pesma; tutorijal po želji). Ništa nije zaključano; predložen je prvi neurađen korak. „Prošli put“ sa
// Ponovi / Sledeće. Ulaz na ekranu pesme (korak i traka). „▶ odavde“ uz delove pesme → Pevaj uz tekst od tog dela.
import { open, boot, addSong, expect, eq, fakeMic } from '../lib.mjs';
export const name = 'Nauči ovu pesmu: otvoren put, prošli put, ulaz na pesmi, ▶ odavde, poznati akordi';
export const timeout = 150;
export async function run(ctx) {
  for (const dev of ['phone', 'desktop']) {
    const p = await open(ctx, dev, { init: fakeMic }); await p.context().grantPermissions(['microphone']); await boot(p, ctx, '#/tuner', 900);
    const id = await addSong(p, { title: 'Volio bih da si tu', artist: 'Crvena jabuka', chords: ['Em', 'D', 'Am', 'B7'], bpm: 90 });
    // poznati akordi: Em i D (čist prolaz ranije) → novi su Am i H7
    await p.evaluate(async () => { const S = await import('./src/songPath.js'); await S.addKnown(['Em', 'D']); });
    await p.go('#/vezbe/pesma/' + id, 1800);
    const st = await p.evaluate(() => ({ ids: [...document.querySelectorAll('.lp-nd')].map((x) => x.dataset.plan + (x.classList.contains('on') ? '*' : x.classList.contains('done') ? '✓' : '')).join(','), chips: [...document.querySelectorAll('.lp-nd[data-plan="ak"] .lp-cs span')].map((x) => x.className + ':' + x.textContent).join('|'), last: !!document.querySelector('.lp-last'), cnt: document.querySelector('.lp-cnt')?.textContent }));
    eq(st.ids, 'ak*,chg,rp,deo,sing,all,tut', dev + ': koraci puta, prvi predložen');
    expect(/new:Am/.test(st.chips) && /new:H7/.test(st.chips) && /ok:Em/.test(st.chips) && !st.last && st.cnt === '0 od 6', dev + ': novi akordi istaknuti, bez „prošli put“', st);
    // ništa nije zaključano: „Cela pesma“ se otvara iako ništa pre nije urađeno
    await p.click('.lp-nd[data-plan="all"]'); await p.waitForTimeout(700);
    expect(await p.evaluate(() => !!document.querySelector('.pr-game.running')), dev + ': cela pesma se ne otvara (zaključano?)'); // v2.5.6: odbrojavanje je na stazi
    await p.evaluate(() => document.getElementById('prGo')?.click()); await p.waitForTimeout(400); // stop
    // „Upoznaj akorde“ → Promene sa novim akordima (uz poznat susedni), rezultat [pesma, 'ak']
    await p.go('#/vezbe/pesma/' + id, 1500);
    await p.click('.lp-nd[data-plan="ak"]'); await p.waitForTimeout(1500);
    const ak = await p.evaluate(() => ({ h: decodeURIComponent(location.hash), seq: [...document.querySelectorAll('.cs-seq [data-i] b')].map((b) => b.textContent).join(',') }));
    expect(/promena\?song=.*&ch=/.test(ak.h) && /Am/.test(ak.seq) && /H7/.test(ak.seq), dev + ': „Upoznaj akorde“ ne otvara Promene sa novim akordima', ak);
    await p.evaluate(async (id) => { const P = await import('./src/practice.js'); await P.saveResult('promena', { score: 88, tempo: 60, chords: ['Am', 'B7', 'Em'] }, [id, 'ak']); await new Promise((r) => setTimeout(r, 30)); /* „Prošli put“ = najnoviji — ne dva u istoj milisekundi (povremeno je bio „Akordi“) */ await P.saveResult('promena', { score: 62, tempo: 55 }, [id, 'chg']); }, id);
    await p.go('#/vezbe/pesma/' + id, 1500);
    const st2 = await p.evaluate(() => ({ ids: [...document.querySelectorAll('.lp-nd')].map((x) => x.dataset.plan + (x.classList.contains('on') ? '*' : x.classList.contains('done') ? '✓' : '')).join(','), last: document.querySelector('.lp-last')?.innerText.replace(/\s+/g, ' ') || '', cnt: document.querySelector('.lp-cnt')?.textContent }));
    eq(st2.ids, 'ak✓,chg*,rp,deo,sing,all,tut', dev + ': urađen korak ✓, predlog sledeći');
    expect(/Prošli put · danas/i.test(st2.last) && /Promene — 62%/.test(st2.last) && /Ponovi/.test(st2.last) && /Sledeće: Ritam/.test(st2.last) && st2.cnt === '1 od 6', dev + ': „Prošli put“', st2);
    const known = await p.evaluate(async () => [...(await (await import('./src/songPath.js')).knownChords())].sort().join());
    eq(known, 'Am,B7,D,Em', dev + ': akordi iz čiste runde postaju poznati');
    // Ponovi → ista vežba (Promene pesme)
    await p.click('.lp-last [data-plan="again"]'); await p.waitForTimeout(1200);
    expect(/#\/vezbe\/promena\?song=/.test(await p.evaluate(() => location.hash)), dev + ': Ponovi ne otvara poslednju vežbu');
    // ekran pesme: ulaz „Nauči ovu pesmu“ sa korakom i trakom; ▶ odavde uz delove
    await p.go('#/pesma/' + id, 1600);
    const en = await p.evaluate(() => { const c = document.querySelector('.lp-entry'); return c ? { t: c.innerText.replace(/\s+/g, ' '), bars: c.querySelectorAll('.lp-steps i').length, d: c.querySelectorAll('.lp-steps i.d').length, c: c.querySelectorAll('.lp-steps i.c').length } : null; });
    expect(en && /Nauči ovu pesmu/.test(en.t) && /korak 2 od 6/.test(en.t) && en.bars === 6 && en.d === 1 && en.c === 1, dev + ': ulaz na ekranu pesme', en);
    const pills = await p.evaluate(() => document.querySelectorAll('.lyrics .od-pill').length);
    expect(pills >= 2, dev + ': nema „▶ odavde“ uz delove', pills);
    await p.evaluate(() => document.querySelectorAll('.lyrics .od-pill')[1].click()); await p.waitForTimeout(1500);
    const sg = await p.evaluate(() => ({ h: location.hash, sum: document.querySelector('.sg-sum')?.textContent.replace(/\s+/g, ' ') || '' }));
    expect(/m=sing&from=1/.test(sg.h) && /Refren/.test(sg.sum), dev + ': ▶ odavde ne otvara Pevaj uz tekst od tog dela', sg);
    expect(!p.errs.length, dev + ': greške', p.errs);
    await p.close();
  }
}
