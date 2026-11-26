// v2.4.37: Kursevi — kartica u Pesmama (Moji kursevi, „+ Napravi kurs“, predlog sledeće pesme), stranica kursa (pesme po redu,
// uredi redosled), list iz serije („Level 1 · Song 2 of 3“) → kurs sam, sa praznim mestima; red kursa i „Sledeća u kursu“ na putu
// kroz pesmu. Tekst: pesma bez teksta → „Pesma nema tekst“; Nalepi i Pronađi tekst (servis zamenjen u testu) → akordi iznad reči.
import { open, boot, addSong, expect, eq } from '../lib.mjs';
export const name = 'Kursevi: tab, pravljenje sa predlogom, serija sa lista → kurs, kurs na putu kroz pesmu, Pronađi/Nalepi tekst';
export const timeout = 200;

async function seriesPdf(p, n) {
  return p.evaluate(async (n) => {
    if (!window.jspdf) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = './vendor/jspdf.umd.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    const T = (s, x, y, size) => { doc.setFontSize(size); doc.text(s, x, y); };
    T('MY TEST PATH  LEVEL 1', 52, 50, 8.5); T(`Song ${n} of 3`, 490, 50, 8.5);
    T(n === 2 ? 'River Bend' : 'Hill Top', 52, 90, 32); T('No capo', 470, 94, 10); T('Test Band', 52, 110, 13);
    T('THE SONG', 52, 200, 8.5);
    const row = (y, chs) => chs.forEach((c, k) => T(c, 130 + k * 60, y, 11));
    T('VERSE', 52, 240, 9); row(240, n === 2 ? ['Am', 'F', 'C', 'G'] : ['D', 'A', 'Bm', 'G']);
    T('CHORUS', 52, 280, 9); row(280, n === 2 ? ['F', 'G', 'C', 'C'] : ['G', 'A', 'D', 'D']);
    return [...new Uint8Array(doc.output('arraybuffer'))];
  }, n);
}

export async function run(ctx) {
  for (const dev of ['phone', 'desktop']) {
    const p = await open(ctx, dev); await boot(p, ctx, '#/pesme', 900);
    const a = await addSong(p, { title: 'Prva', chords: ['G', 'C', 'D'], text: () => 'ovo je jedan stih pesme', strum: { id: 'folk', sig: '4/4', steps: 'D-DU-UDU' } });
    const b = await addSong(p, { title: 'Druga', chords: ['G', 'C', 'D', 'Em'], text: () => 'drugi stih ove pesme' });
    await addSong(p, { title: 'Teška', chords: ['F', 'Bm', 'C#m', 'G#'], text: () => 'teška pesma ide kasnije' });
    await p.reload(); await p.waitForTimeout(900); // ugrađena kopija: aplikacija čita pesme iznova
    // 1) Kursevi: prazno, + Napravi kurs
    await p.go('#/vezbe?t=k', 1500);
    const empty = await p.evaluate(() => ({ tab: document.querySelector('[data-pt="k"]')?.classList.contains('active'), txt: document.querySelector('#prCourses')?.innerText.replace(/\s+/g, ' ') || '' }));
    expect(empty.tab && /Moji kursevi/i.test(empty.txt) && /nije zaključan/.test(empty.txt), dev + ': kartica Kursevi', empty);
    await p.click('#cNew'); await p.waitForSelector('#nameInput'); await p.fill('#nameInput', 'Leto'); await p.click('.modal-backdrop .btn.primary'); await p.waitForTimeout(1200);
    expect(/^#\/kurs\//.test(await p.evaluate(() => location.hash)), dev + ': otvoren nov kurs');
    // dodaj Prva i Druga (izbor više pesama)
    await p.click('#cAdd'); await p.waitForSelector('.pick-list');
    await p.evaluate((ids) => ids.forEach((id) => { const c = document.querySelector(`.pick-list input[value="${id}"]`); if (c) c.click(); }), [a, b]);
    await p.click('.modal-backdrop .btn.primary'); await p.waitForTimeout(1500);
    const pg = await p.evaluate(() => ({ rows: [...document.querySelectorAll('.crs-list .tch-row b')].map((x) => x.textContent), sug: [...document.querySelectorAll('#cSug .tch-row b')].map((x) => x.textContent), sugSub: document.querySelector('#cSug .tch-row small')?.textContent || '' }));
    eq(pg.rows, ['Druga', 'Prva'], dev + ': pesme po redu (kako su izabrane)');
    expect(pg.sug[0] === 'Teška' && /nova akorda|nov akord/.test(pg.sugSub), dev + ': predlog sledeće pesme sa razlogom', pg);
    // uredi: Prva gore
    await p.click('#cEdit'); await p.waitForTimeout(400);
    await p.click('[data-up="1"]'); await p.waitForTimeout(600);
    eq(await p.evaluate(() => [...document.querySelectorAll('.crs-list .tch-row b')].map((x) => x.textContent)), ['Prva', 'Druga'], dev + ': promena redosleda');
    await p.click('#cEdit'); await p.waitForTimeout(400);
    // 2) list iz serije → kurs sam (3 mesta, pesma 2 na svom mestu)
    await p.go('#/pesme', 800);
    const bytes = await seriesPdf(p, 2);
    p.evaluate(async (bb) => { const Q = await import('./src/pdfQueue.js'); await Q.importPdfs([new File([new Uint8Array(bb)], 'river.pdf', { type: 'application/pdf' })]); }, bytes).catch(() => {});
    await p.waitForSelector('.modal-backdrop .btn.primary', { timeout: 20000 }); await p.click('.modal-backdrop .btn.primary');
    let crs = null;
    for (let i = 0; i < 40 && !crs; i++) { await p.waitForTimeout(500); crs = await p.evaluate(async () => (await (await import('./src/courses.js')).getCourses()).find((c) => c.series) || null); }
    expect(crs && crs.name === 'My Test Path · Level 1' && crs.items.length === 3 && crs.items[1].s && crs.items[0].miss && crs.items[2].miss, dev + ': kurs serije sa praznim mestima', crs);
    await p.go('#/kurs/' + encodeURIComponent(crs.id), 1500);
    const sp = await p.evaluate(() => ({ miss: document.querySelectorAll('.crs-miss').length, imp: !!document.querySelector('[data-imp]'), t: document.querySelector('.crs-list')?.innerText.replace(/\s+/g, ' ') || '' }));
    expect(sp.miss === 2 && sp.imp && /River Bend/.test(sp.t) && /još nije uvezena/.test(sp.t), dev + ': stranica kursa serije', sp);
    // 3) put kroz pesmu: red kursa + „Sledeća u kursu“
    await p.go('#/vezbe/pesma/' + encodeURIComponent(crs.items[1].s), 1800);
    const nav = await p.evaluate(() => ({ top: document.querySelector('.crs-top')?.innerText.replace(/\s+/g, ' ') || '', end: [...document.querySelectorAll('.tch-sec')].map((x) => x.innerText).join('|'), sing: !!document.querySelector('.lp-nd[data-plan="sing"]') }));
    expect(/My Test Path · Level 1/.test(nav.top) && /pesma 2 od 3/.test(nav.top), dev + ': red kursa na putu kroz pesmu', nav);
    expect(/Kurs · My Test Path/i.test(nav.end), dev + ': „Sledeća u kursu“', nav);
    expect(!nav.sing, dev + ': bez teksta nema „Pevaj i sviraj“', nav);
    // 4) tekst: Nalepi (polje) → provera → sačuvaj
    const rid = crs.items[1].s;
    await p.go('#/pesma/' + encodeURIComponent(rid), 1800);
    expect(await p.evaluate(() => !!document.querySelector('#sLyrCard [data-lyr="find"]')), dev + ': kartica „Pesma nema tekst“');
    await p.evaluate(() => { try { Object.defineProperty(navigator, 'clipboard', { value: { readText: () => Promise.reject(new Error('no')) }, configurable: true }); } catch {} });
    await p.click('#sLyrCard [data-lyr="paste"]'); await p.waitForSelector('#lyrTxt');
    await p.fill('#lyrTxt', 'Down by the river bend\nWhere the water meets the end\n\nSing along, sing along\nRiver bend, all night long');
    await p.click('.modal-backdrop .btn.primary'); await p.waitForSelector('.lyr-prev', { timeout: 8000 });
    const prev = await p.evaluate(() => document.querySelector('.lyr-prev').innerText.replace(/\s+/g, ' '));
    expect(/Down by the/.test(prev) && /bend/.test(prev) && /Am/.test(prev) && /REFREN|Refren/i.test(prev), dev + ': provera teksta sa akordima', prev.slice(0, 200));
    await p.click('.modal-backdrop .btn.primary'); await p.waitForTimeout(1200);
    const after = await p.evaluate(async (id) => { const { songs } = await import('./src/db.js'); const s = await songs.get(id); return { card: !!document.querySelector('#sLyrCard [data-lyr]'), txt: (s.sections[0].lines[0] || {}).text, ch: ((s.sections[0].lines[0] || {}).chords || []).length }; }, rid);
    expect(!after.card && /river bend/.test(after.txt) && after.ch >= 1, dev + ': tekst sačuvan, akordi iznad reči', after);
    // 5) Pronađi tekst (servis zamenjen): druga pesma serije
    await p.route('**/lrclib.net/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([{ trackName: 'Hill Top', artistName: 'Test Band', duration: 180, instrumental: false, plainLyrics: 'Up on the hill top\nNever gonna stop\n\nHey hey hill top\nHey hey never stop' }]) }));
    const id2 = await p.evaluate(async () => { const { songs } = await import('./src/db.js'); const F = await import('./src/songformat.js'); const s = await songs.save({ title: 'Hill Top', artist: 'Test Band', key: 'D', sections: F.textToSections('[Verse]\nD      A      Bm     G\n\n[Chorus]\nG      A      D      D') }); return s.id; });
    await p.go('#/pesma/' + encodeURIComponent(id2), 1800);
    await p.click('#sLyrCard [data-lyr="find"]'); await p.waitForSelector('.lyr-prev', { timeout: 10000 });
    const head = await p.evaluate(() => document.querySelector('.lyr-dlg .tch-row b')?.textContent || '');
    expect(/Test Band — Hill Top/.test(head), dev + ': rezultat pretrage', head);
    await p.click('.modal-backdrop .btn.primary'); await p.waitForTimeout(1200);
    const s2 = await p.evaluate(async (id) => { const { songs } = await import('./src/db.js'); const s = await songs.get(id); return s.sections.map((x) => x.lines.map((l) => l.text).join('/')).join(' | '); }, id2);
    expect(/Up on the hill top/.test(s2) && /Hey hey hill top/.test(s2), dev + ': pronađen tekst sačuvan po delovima', s2);
    expect(!p.errs.length, dev + ': greške', p.errs);
    await p.close();
  }
}
