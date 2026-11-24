// v2.4.5: „Podešavanja pesme“ (telefon) — pozadina se ne pomera, ✕ / Esc / prevuci nadole / dodir van zatvaraju,
// red „Ritam“ sa predlogom se ne preklapa; ekran ostaje upaljen ceo put dok je pesma otvorena.
import { open, boot, addSong, expect, overflowCheck } from '../lib.mjs';
export const name = 'podešavanja pesme: zaključan skrol, zatvaranje, ritam bez preklapanja; ekran upaljen dok je pesma otvorena';
export async function run(ctx) {
  for (const lang of ['sr', 'en']) {
    const q = await open(ctx, 'phone', { lang });
    await boot(q, ctx);
    const id = await addSong(q, { title: 'Ritam', strum: null, lines: 30, extra: { suggestStrum: { id: 'folk' } } });
    await q.go('#/pesma/' + id, 1500);
    const openSheet = async () => { await q.click('#sChips [data-sheet="all"]'); await q.waitForTimeout(400); expect(await q.$('.ss-backdrop'), lang + ': list se ne otvara'); };
    const isClosed = () => q.evaluate(() => !document.querySelector('.ss-backdrop'));
    await openSheet();
    // ritam: oznaka vidljiva i ne ide preko dugmadi
    const r = await q.evaluate(() => { const l = document.querySelector('.ss-item[data-k="rhythm"] .ss-l').getBoundingClientRect(); const s = document.querySelector('.ss-item[data-k="rhythm"] .ss-sug').getBoundingClientRect(); return { w: l.width, gap: s.left - l.right }; });
    expect(r.w > 80 && r.gap >= 0, lang + ': red Ritam se preklapa', r);
    { const o = await overflowCheck(q); expect(!o.page && !o.items.length, lang + ': nešto izlazi van ekrana', o); }
    // pozadina se ne pomera
    await q.mouse.move(200, 60); await q.mouse.wheel(0, 700); await q.waitForTimeout(300);
    expect(await q.evaluate(() => scrollY) === 0, lang + ': pesma ispod se pomera dok je list otvoren');
    // ✕
    await q.click('.ss-x'); await q.waitForTimeout(250); expect(await isClosed(), lang + ': ✕ ne zatvara');
    expect(await q.evaluate(() => getComputedStyle(document.documentElement).overflow) !== 'hidden', lang + ': skrol ostaje zaključan posle zatvaranja');
    // Esc
    await openSheet(); await q.keyboard.press('Escape'); await q.waitForTimeout(250); expect(await isClosed(), lang + ': Esc ne zatvara');
    // prevuci zaglavlje nadole
    await openSheet();
    const h = await q.evaluate(() => { const b = document.querySelector('.ss-head .sheet-title').getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; });
    await q.mouse.move(h.x, h.y); await q.mouse.down(); await q.mouse.move(h.x, h.y + 60, { steps: 4 }); await q.mouse.move(h.x, h.y + 140, { steps: 4 }); await q.mouse.up(); await q.waitForTimeout(300);
    expect(await isClosed(), lang + ': prevlačenje nadole ne zatvara');
    // kratko povlačenje vraća list
    await openSheet();
    await q.mouse.move(h.x, h.y); await q.mouse.down(); await q.mouse.move(h.x, h.y + 30, { steps: 3 }); await q.mouse.up(); await q.waitForTimeout(300);
    expect(!(await isClosed()) && await q.evaluate(() => !document.querySelector('.song-sheet').style.transform), lang + ': kratko povlačenje ne vraća list');
    // dodir van lista
    await q.mouse.click(200, 30); await q.waitForTimeout(250); expect(await isClosed(), lang + ': dodir van lista ne zatvara');
    // v2.4.6: otvara se do pola visine; povuci nagore → cela visina; „Samo u ⚙“ se sklapa i pamti
    await q.evaluate(() => localStorage.removeItem('marli-ss-more'));
    await openSheet();
    const hh = () => q.evaluate(() => document.querySelector('.song-sheet').getBoundingClientRect().height);
    const vh = await q.evaluate(() => innerHeight), h1 = await hh();
    expect(h1 <= vh * 0.57, lang + ': list se ne otvara do pola visine', [h1, vh]);
    const g = await q.evaluate(() => { const b = document.querySelector('.ss-head .sheet-title').getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; });
    // praćenje prsta: sa otvorenim „Samo u ⚙“ (dovoljno sadržaja za ceo ekran)
    await q.click('.ss-more'); await q.waitForTimeout(300);
    await q.evaluate(() => document.querySelector('.song-sheet').classList.add('half')); await q.waitForTimeout(300);
    const h2 = await hh();
    { const b = await q.evaluate(() => { const r = document.querySelector('.ss-head .sheet-title').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; }); g.x = b.x; g.y = b.y; } // zaglavlje se pomerilo (list je promenio visinu)
    await q.mouse.move(g.x, g.y); await q.mouse.down(); await q.mouse.move(g.x, g.y - 60, { steps: 6 }); await q.waitForTimeout(50);
    const mid = await hh();
    expect(mid > h2 + 40, lang + ': list ne prati prst nagore', [h2, mid]);
    await q.mouse.move(g.x, g.y + 40, { steps: 6 }); await q.waitForTimeout(50);
    expect(await hh() < h2 - 20, lang + ': list ne prati prst nadole', [h2, await hh()]);
    await q.mouse.move(g.x, g.y - 260, { steps: 12 }); await q.waitForTimeout(150); await q.mouse.up(); await q.waitForTimeout(400); // jasno iznad sredine između pola i celog ekrana
    await q.click('.ss-more'); await q.waitForTimeout(300);
    expect(await q.evaluate(() => !document.querySelector('.song-sheet').classList.contains('half')), lang + ': povlačenje nagore ne širi list');
    const hidden = () => q.evaluate(() => [...document.querySelectorAll('.ss-item')].filter((x) => x.offsetParent === null).length);
    const n0 = await hidden();
    expect(n0 > 0, lang + ': „Samo u ⚙“ nije sklopljeno');
    await q.click('.ss-more'); await q.waitForTimeout(400);
    expect(await hidden() === 0, lang + ': „Samo u ⚙“ se ne otvara');
    // poslednji dodirnut red: veličina teksta (+), zatvori, otvori — red je vidljiv
    await q.click('.ss-item[data-k="size"] [data-ss="z+"]'); await q.waitForTimeout(300);
    await q.keyboard.press('Escape'); await q.waitForTimeout(250);
    await openSheet();
    const vis = await q.evaluate(() => { const r = document.querySelector('.ss-item[data-k="size"]').getBoundingClientRect(), s = document.querySelector('.song-sheet').getBoundingClientRect(); return r.top >= s.top && r.bottom <= s.bottom + 1; });
    expect(vis && await hidden() === 0, lang + ': list ne pamti poslednji red / otvoreno „Samo u ⚙“', [vis, await hidden()]);
    // Primeni predlog ritma → „Poništi“ vraća
    await q.click('.ss-item[data-k="rhythm"] [data-ss="rh-apply"]'); await q.waitForTimeout(400);
    const strum = () => q.evaluate(async (id) => !!(await (await import('./src/db.js')).songs.get(id)).strum, id);
    expect(await strum(), lang + ': ritam nije primenjen');
    expect(await q.evaluate(() => { const t = document.querySelector('#toast.show .toast-action'); if (!t) return false; const r = t.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === t; }), lang + ': „Poništi“ nije vidljivo iznad lista');
    await q.click('#toast .toast-action'); await q.waitForTimeout(400);
    expect(!(await strum()) && await q.$('.ss-item[data-k="rhythm"] [data-ss="rh-apply"]'), lang + ': „Poništi“ ne vraća predlog ritma');
    await q.keyboard.press('Escape'); await q.waitForTimeout(200);
  }
  // setlista od nastavnika: oznaka u spisku (telefon) i u bočnoj traci (računar)
  for (const dev of ['phone', 'desk']) {
    const p = await open(ctx, dev); await boot(p, ctx);
    await p.evaluate(async () => { const C = await import('./src/collections.js'); const a = await C.addSetlist('Od Mile'); await C.updateSetlist(a.id, { fromT: { tid: 't1', name: 'Mila' } }); await C.addSetlist('Moja'); });
    await addSong(p, { title: 'X' }); await p.go(dev === 'desk' ? '#/pesme' : '#/pesme?tab=sl', 1500);
    const b = await p.evaluate((dev) => dev === 'desk'
      ? [...document.querySelectorAll('.ds-it[data-set]')].map((x) => x.textContent.replace(/\s+/g, ' ').trim() + (x.querySelector('.ds-tch') ? ' [T]' : ''))
      : [...document.querySelectorAll('#lSlPane .slp-item')].map((x) => x.textContent.replace(/\s+/g, ' ').trim() + (x.querySelector('.tch-badge') ? ' [T]' : '')), dev);
    expect(b.some((x) => /Od Mile.*\[T\]/.test(x)) && b.some((x) => /Moja/.test(x) && !/\[T\]/.test(x)), dev + ': setlista od nastavnika nema oznaku', b);
  }
  // ekran: pesma — bez odbrojavanja; setlista — odbrojava minute
  const q = await open(ctx, 'phone'); await boot(q, ctx);
  const w = await q.evaluate(async () => {
    const W = await import('./src/wakelock.js'); const long = []; const st = window.setTimeout;
    window.setTimeout = (fn, ms, ...a) => { if (ms >= 60000) long.push(ms); return st(fn, ms, ...a); };
    const out = {};
    W.setWakeZone(null); W.setWakeZone('song'); document.dispatchEvent(new Event('pointerdown'));
    out.song = { timers: long.length, act: W.wakeState().byActivity };
    W.setWakeZone('setlist'); out.setlist = { timers: long.length, act: W.wakeState().byActivity };
    W.setWakeZone(null); window.setTimeout = st; return out;
  });
  expect(w.song.act && w.song.timers === 0, 'pesma: ekran ima odbrojavanje (treba da ostane upaljen ceo put)', w);
  expect(w.setlist.act && w.setlist.timers === 1, 'setlista: nema odbrojavanja minuta', w);
}
